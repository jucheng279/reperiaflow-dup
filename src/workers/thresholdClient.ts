import type {
  Response,
  BuildRequest,
  SetGrayRequest,
  RecycleRequest,
  ClearPageRequest,
} from './thresholdWorker';
import { buildThresholdMask } from '../domain/threshold/thresholdEngine';

// Page-aware threshold dispatcher with rAF coalescing and adaptive
// downsampling.
//
// Why this is shaped the way it is:
//   - Slider drags fire many input events per frame. Coalescing with a rAF
//     tick stops the worker from queueing more requests than the display can
//     show.
//   - The first build for a page is timed; if it exceeds the interactive
//     budget we automatically fall back to factor 2 (or 4) for subsequent
//     interactive (drag) builds. Commits always run at factor 1 so the final
//     overlay is exact.
//   - Returned RGBA buffers are recycled back into the worker pool to avoid
//     per-frame ArrayBuffer allocations (which spike GC pauses).
//   - On `visibilitychange -> visible` we drop any in-flight or queued
//     request because background tabs throttle the worker; the next user
//     interaction (or the explicit re-request the caller issues) will
//     rebuild from the live state.

export type DownsampleFactor = 1 | 2 | 4;

export interface OverlayResult {
  pageId: string;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  factor: DownsampleFactor;
  min: number;
  max: number;
}

type ResultListener = (result: OverlayResult) => void;

export type ThresholdMode = 'interactive' | 'commit';

interface PendingSpec {
  pageId: string;
  width: number;
  height: number;
  min: number;
  max: number;
  color: { r: number; g: number; b: number; a: number };
  mode: ThresholdMode;
  listener: ResultListener;
}

let worker: Worker | null = null;
let workerInitialized = false;
let reqCounter = 0;
let inFlight: {
  reqId: number;
  listener: ResultListener;
} | null = null;
let queued: PendingSpec | null = null;
let rafScheduled = false;
const installedPages = new Set<string>();

const INTERACTIVE_BUDGET_MS = 12;
const interactiveFactorByPage = new Map<string, DownsampleFactor>();
const pageSize = new Map<string, { width: number; height: number }>();

// Heuristic starting factor based on image size. Tuned so multi-megapixel
// images skip the slow full-res measurement frame on the very first drag.
function heuristicFactor(width: number, height: number): DownsampleFactor {
  const mp = (width * height) / 1_000_000;
  if (mp >= 12) return 4;
  if (mp >= 2) return 2;
  return 1;
}

function getInteractiveFactor(pageId: string): DownsampleFactor {
  const cached = interactiveFactorByPage.get(pageId);
  if (cached) return cached;
  const size = pageSize.get(pageId);
  if (size) {
    const seeded = heuristicFactor(size.width, size.height);
    interactiveFactorByPage.set(pageId, seeded);
    return seeded;
  }
  return 1;
}

function bumpInteractiveFactor(pageId: string, elapsedMs: number, used: DownsampleFactor): void {
  if (used !== getInteractiveFactor(pageId)) return;
  if (elapsedMs <= INTERACTIVE_BUDGET_MS) return;
  const next: DownsampleFactor = used === 1 ? 2 : used === 2 ? 4 : 4;
  if (next !== used) {
    interactiveFactorByPage.set(pageId, next);
  }
}

function getWorker(): Worker | null {
  if (workerInitialized) return worker;
  workerInitialized = true;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./thresholdWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<Response>) => {
      const data = e.data;
      const slot = inFlight;
      const reqMatches = slot && slot.reqId === data.reqId;
      inFlight = null;
      if (data.type === 'built' && slot && reqMatches) {
        bumpInteractiveFactor(data.pageId, data.elapsedMs, data.factor);
        slot.listener({
          pageId: data.pageId,
          rgba: data.rgba,
          width: data.width,
          height: data.height,
          sourceWidth: data.sourceWidth,
          sourceHeight: data.sourceHeight,
          factor: data.factor,
          min: data.min,
          max: data.max,
        });
      } else if (data.type === 'built') {
        recycleBuffer(data.pageId, data.factor, data.rgba.buffer);
      }
      pumpSoon();
    };
    worker.onerror = () => {
      worker = null;
      installedPages.clear();
      inFlight = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function pumpSoon(): void {
  if (rafScheduled || !queued) return;
  rafScheduled = true;
  const flush = () => {
    rafScheduled = false;
    pump();
  };
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(flush);
  } else {
    setTimeout(flush, 0);
  }
}

function pump(): void {
  if (inFlight || !queued) return;
  const w = getWorker();
  const spec = queued;
  queued = null;
  if (!w) {
    runOnMainThread(spec);
    return;
  }
  if (!installedPages.has(spec.pageId)) {
    runOnMainThread(spec);
    return;
  }
  const reqId = ++reqCounter;
  inFlight = { reqId, listener: spec.listener };
  const factor: DownsampleFactor =
    spec.mode === 'commit' ? 1 : getInteractiveFactor(spec.pageId);
  const req: BuildRequest = {
    type: 'build',
    reqId,
    pageId: spec.pageId,
    min: spec.min,
    max: spec.max,
    r: spec.color.r,
    g: spec.color.g,
    b: spec.color.b,
    a: spec.color.a,
    factor,
  };
  w.postMessage(req);
}

function runOnMainThread(spec: PendingSpec): void {
  const gray = mainThreadGray.get(spec.pageId);
  if (!gray) return;
  const mask = buildThresholdMask(gray, { min: spec.min, max: spec.max });
  const rgba = new Uint8ClampedArray(mask.length * 4);
  const { r, g, b, a } = spec.color;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i]) {
      rgba[p] = r;
      rgba[p + 1] = g;
      rgba[p + 2] = b;
      rgba[p + 3] = a;
    }
  }
  spec.listener({
    pageId: spec.pageId,
    rgba,
    width: spec.width,
    height: spec.height,
    sourceWidth: spec.width,
    sourceHeight: spec.height,
    factor: 1,
    min: spec.min,
    max: spec.max,
  });
  if (queued) pumpSoon();
}

const mainThreadGray = new Map<string, Uint8Array>();

export function setActivePageGray(
  pageId: string,
  width: number,
  height: number,
  gray: Uint8Array,
): void {
  mainThreadGray.set(pageId, gray);
  pageSize.set(pageId, { width, height });
  const w = getWorker();
  if (!w) return;
  const grayCopy = new Uint8Array(gray);
  const msg: SetGrayRequest = {
    type: 'setGray',
    pageId,
    width,
    height,
    gray: grayCopy,
  };
  installedPages.add(pageId);
  w.postMessage(msg, [grayCopy.buffer]);

  // Seed the per-page interactive factor before any drag. The size-based
  // heuristic is applied synchronously so the very first build picks a
  // factor that fits the interactive budget.
  if (!interactiveFactorByPage.has(pageId)) {
    interactiveFactorByPage.set(pageId, heuristicFactor(width, height));
  }
}

export function requestThresholdOverlay(
  pageId: string,
  width: number,
  height: number,
  min: number,
  max: number,
  color: { r: number; g: number; b: number; a: number },
  mode: ThresholdMode,
  listener: ResultListener,
): void {
  // No cancellation: rAF coalescing in pumpSoon collapses bursts to a
  // single queued spec, so the worker queue never grows beyond one item.
  // Letting the in-flight build finish and paint keeps the central image
  // moving while the user holds an arrow key or clicks rapidly; the next
  // request will overwrite the (at most one frame) stale paint immediately.
  queued = { pageId, width, height, min, max, color, mode, listener };
  pumpSoon();
}

export function recycleBuffer(
  pageId: string,
  factor: DownsampleFactor,
  buffer: ArrayBuffer,
): void {
  const w = getWorker();
  if (!w) return;
  if (!installedPages.has(pageId)) return;
  const msg: RecycleRequest = { type: 'recycle', pageId, factor, buffer };
  try {
    w.postMessage(msg, [buffer]);
  } catch {
    // Buffer already detached. Ignore.
  }
}

export function clearThresholdPage(pageId: string): void {
  installedPages.delete(pageId);
  mainThreadGray.delete(pageId);
  interactiveFactorByPage.delete(pageId);
  pageSize.delete(pageId);
  const w = getWorker();
  if (!w) return;
  const msg: ClearPageRequest = { type: 'clearPage', pageId };
  w.postMessage(msg);
}

export function cancelPendingThreshold(): void {
  // Drop the queued spec so a stale request doesn't run after a visibility
  // change or a fresh drag start. The in-flight build, if any, is allowed
  // to finish; its result paints harmlessly and will be overwritten by the
  // next live request.
  queued = null;
}

// Lightweight pub/sub for the slider-drag state. ThresholdPanel calls
// `setThresholdDragging(true)` on slider pointerdown and `false` on pointerup;
// ImageViewer subscribes so it can switch between interactive (downsampled)
// and commit (full-resolution) builds. We avoid putting this in the global
// store to keep its updates from re-rendering unrelated UI.
type DragListener = (dragging: boolean) => void;
const dragListeners = new Set<DragListener>();
let dragging = false;

export function setThresholdDragging(v: boolean): void {
  if (dragging === v) return;
  dragging = v;
  dragListeners.forEach((l) => l(v));
}

export function getThresholdDragging(): boolean {
  return dragging;
}

export function subscribeThresholdDragging(l: DragListener): () => void {
  dragListeners.add(l);
  return () => {
    dragListeners.delete(l);
  };
}

// Wheel-driven threshold tweaks don't have a clean pointerdown/up boundary,
// so callers pulse the drag flag while a burst is in progress. The flag
// auto-clears `quietMs` after the last pulse so the commit (full-resolution)
// build runs once the user stops scrolling.
let pulseTimer: ReturnType<typeof setTimeout> | null = null;
export function pulseThresholdDragging(quietMs = 180): void {
  setThresholdDragging(true);
  if (pulseTimer !== null) clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => {
    pulseTimer = null;
    setThresholdDragging(false);
  }, quietMs);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      cancelPendingThreshold();
    }
  });
}

export function prewarmThresholdWorker(): void {
  getWorker();
}

if (typeof window !== 'undefined') {
  const schedule =
    (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
      .requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 0));
  schedule(() => prewarmThresholdWorker());
}
