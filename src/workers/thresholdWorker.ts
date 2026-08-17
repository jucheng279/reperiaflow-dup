/// <reference lib="webworker" />

// Worker holds the gray buffer for the active page so successive threshold
// updates during a slider drag don't have to repost the gray data. It also
// emits the overlay as RGBA directly, sparing the main thread from looping
// over the mask to construct ImageData.
//
// During interactive drags the caller may request a downsampled overlay by
// passing factor > 1 (2 or 4). The worker keeps a cached downsampled gray
// per page+factor and reuses RGBA backing buffers in a small pool so each
// frame doesn't allocate a fresh ArrayBuffer.

interface SetGrayRequest {
  type: 'setGray';
  pageId: string;
  width: number;
  height: number;
  gray: Uint8Array;
}

interface BuildRequest {
  type: 'build';
  reqId: number;
  pageId: string;
  min: number;
  max: number;
  r: number;
  g: number;
  b: number;
  a: number;
  factor: 1 | 2 | 4;
}

interface RecycleRequest {
  type: 'recycle';
  pageId: string;
  factor: 1 | 2 | 4;
  buffer: ArrayBuffer;
}

interface ClearPageRequest {
  type: 'clearPage';
  pageId: string;
}

interface AbortRequest {
  type: 'abort';
  reqId: number;
}

interface BuildResponse {
  type: 'built';
  reqId: number;
  pageId: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  factor: 1 | 2 | 4;
  min: number;
  max: number;
  rgba: Uint8ClampedArray;
  elapsedMs: number;
}

interface BuildSkippedResponse {
  type: 'skipped';
  reqId: number;
  pageId: string;
  reason: 'no-gray';
}

type Request = SetGrayRequest | BuildRequest | RecycleRequest | ClearPageRequest | AbortRequest;
type Response = BuildResponse | BuildSkippedResponse;

// Most-recent reqId the main thread has marked stale. The worker checks this
// at the start of each build so a flurry of queued requests collapses to the
// freshest one without running each scan to completion.
let latestAbortReqId = 0;

interface PageEntry {
  width: number;
  height: number;
  gray: Uint8Array;
  // Cached downsampled grays keyed by factor (2, 4). factor=1 reuses `gray`.
  grayByFactor: Map<2 | 4, { width: number; height: number; gray: Uint8Array }>;
  // Pool of recycled RGBA buffers keyed by factor.
  rgbaPool: Map<1 | 2 | 4, ArrayBuffer[]>;
}

const pages = new Map<string, PageEntry>();

function downsample(
  gray: Uint8Array,
  width: number,
  height: number,
  factor: 2 | 4,
): { width: number; height: number; gray: Uint8Array } {
  const dw = Math.max(1, Math.floor(width / factor));
  const dh = Math.max(1, Math.floor(height / factor));
  const out = new Uint8Array(dw * dh);
  // Box-filter average. For factor 2 this is 4 samples; factor 4 is 16.
  // Cheap, predictable, and good enough for a live preview.
  for (let y = 0; y < dh; y++) {
    const sy0 = y * factor;
    for (let x = 0; x < dw; x++) {
      const sx0 = x * factor;
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        const sy = sy0 + dy;
        if (sy >= height) break;
        const row = sy * width;
        for (let dx = 0; dx < factor; dx++) {
          const sx = sx0 + dx;
          if (sx >= width) break;
          sum += gray[row + sx];
          n++;
        }
      }
      out[y * dw + x] = n > 0 ? (sum / n) | 0 : 0;
    }
  }
  return { width: dw, height: dh, gray: out };
}

function getGrayForFactor(
  entry: PageEntry,
  factor: 1 | 2 | 4,
): { width: number; height: number; gray: Uint8Array } {
  if (factor === 1) {
    return { width: entry.width, height: entry.height, gray: entry.gray };
  }
  const cached = entry.grayByFactor.get(factor);
  if (cached) return cached;
  const built = downsample(entry.gray, entry.width, entry.height, factor);
  entry.grayByFactor.set(factor, built);
  return built;
}

function takeRgba(entry: PageEntry, factor: 1 | 2 | 4, length: number): Uint8ClampedArray {
  const pool = entry.rgbaPool.get(factor);
  if (pool && pool.length > 0) {
    const buf = pool.pop()!;
    if (buf.byteLength === length) {
      const view = new Uint8ClampedArray(buf);
      // Caller is responsible for filling every byte; we zero alpha-only paths
      // by clearing the buffer here so out-of-range pixels stay transparent.
      view.fill(0);
      return view;
    }
    // Wrong size (shouldn't normally happen) - drop and allocate fresh.
  }
  return new Uint8ClampedArray(length);
}

self.onmessage = (e: MessageEvent<Request>) => {
  const msg = e.data;
  if (msg.type === 'setGray') {
    pages.set(msg.pageId, {
      width: msg.width,
      height: msg.height,
      gray: msg.gray,
      grayByFactor: new Map(),
      rgbaPool: new Map(),
    });
    return;
  }
  if (msg.type === 'abort') {
    // The main thread has decided that any build with reqId <= abortReqId is
    // stale (the user moved the slider again). We can't preempt a build
    // already running in this turn of the event loop, but if multiple build
    // messages have piled up in the port we drop them by recording the
    // newest aborted reqId and skipping below.
    if (msg.reqId > latestAbortReqId) latestAbortReqId = msg.reqId;
    return;
  }
  if (msg.type === 'clearPage') {
    pages.delete(msg.pageId);
    return;
  }
  if (msg.type === 'recycle') {
    const entry = pages.get(msg.pageId);
    if (!entry) return;
    let pool = entry.rgbaPool.get(msg.factor);
    if (!pool) {
      pool = [];
      entry.rgbaPool.set(msg.factor, pool);
    }
    if (pool.length < 2) pool.push(msg.buffer);
    return;
  }
  if (msg.type === 'build') {
    if (msg.reqId <= latestAbortReqId) {
      const skipped: BuildSkippedResponse = {
        type: 'skipped',
        reqId: msg.reqId,
        pageId: msg.pageId,
        reason: 'no-gray',
      };
      (self as unknown as Worker).postMessage(skipped);
      return;
    }
    const entry = pages.get(msg.pageId);
    if (!entry) {
      const skipped: BuildSkippedResponse = {
        type: 'skipped',
        reqId: msg.reqId,
        pageId: msg.pageId,
        reason: 'no-gray',
      };
      (self as unknown as Worker).postMessage(skipped);
      return;
    }
    const t0 = performance.now();
    const layer = getGrayForFactor(entry, msg.factor);
    const { gray, width, height } = layer;
    const rgbaLen = gray.length * 4;
    const rgba = takeRgba(entry, msg.factor, rgbaLen);
    const { min, max, r, g, b, a } = msg;
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      const v = gray[i];
      if (v >= min && v <= max) {
        rgba[p] = r;
        rgba[p + 1] = g;
        rgba[p + 2] = b;
        rgba[p + 3] = a;
      }
    }
    const elapsedMs = performance.now() - t0;
    const resp: BuildResponse = {
      type: 'built',
      reqId: msg.reqId,
      pageId: msg.pageId,
      width,
      height,
      sourceWidth: entry.width,
      sourceHeight: entry.height,
      factor: msg.factor,
      min,
      max,
      rgba,
      elapsedMs,
    };
    (self as unknown as Worker).postMessage(resp, [rgba.buffer]);
  }
};

export type {
  Request,
  Response,
  BuildRequest,
  BuildResponse,
  SetGrayRequest,
  RecycleRequest,
  ClearPageRequest,
  AbortRequest,
};
