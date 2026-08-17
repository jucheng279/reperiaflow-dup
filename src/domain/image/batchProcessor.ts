import { restoreBuffers } from './bufferCache';
import { persistBuffersOffThread } from '../../workers/idbClient';
import type { CachedBuffers } from './bufferCache';
import type { GrayscaleBuffer, RgbaBuffer } from './bufferTypes';
import type { TiffStretchContext } from './tiff';

export interface RestoredBuffers {
  gray: GrayscaleBuffer;
  rgba: RgbaBuffer | undefined;
  tiffStretchContext: TiffStretchContext | undefined;
}

export interface BatchProgress {
  active: boolean;
  label: string;
  completed: number;
  total: number;
}

export const BATCH_IDLE: BatchProgress = {
  active: false,
  label: '',
  completed: 0,
  total: 0,
};

type ProcessFn = (imageId: string, buffers: RestoredBuffers) => Promise<CachedBuffers | null>;

let reconcilerBusy = false;
let reconcilerResolve: (() => void) | null = null;

export function notifyReconcilerBusy(): void {
  reconcilerBusy = true;
}

export function notifyReconcilerIdle(): void {
  reconcilerBusy = false;
  if (reconcilerResolve) {
    reconcilerResolve();
    reconcilerResolve = null;
  }
}

const RECONCILER_TIMEOUT_MS = 5000;

function waitForReconciler(): Promise<void> {
  if (!reconcilerBusy) return Promise.resolve();
  return new Promise((resolve) => {
    reconcilerResolve = resolve;
    setTimeout(() => {
      if (reconcilerResolve === resolve) {
        reconcilerResolve = null;
        reconcilerBusy = false;
        resolve();
      }
    }, RECONCILER_TIMEOUT_MS);
  });
}

let currentAbort: AbortController | null = null;

export function abortBatch(): void {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
}

export interface BatchRunOptions {
  imageIds: string[];
  widths: Map<string, number>;
  heights: Map<string, number>;
  label: string;
  processFn: ProcessFn;
  onProgress: (progress: BatchProgress) => void;
  onItemDone: (imageId: string, updatedGray: GrayscaleBuffer) => void;
}

export async function runBatch(opts: BatchRunOptions): Promise<void> {
  const { imageIds, widths, heights, label, processFn, onProgress, onItemDone } = opts;
  if (imageIds.length === 0) return;

  abortBatch();
  const controller = new AbortController();
  currentAbort = controller;
  const signal = controller.signal;

  const total = imageIds.length;
  let completed = 0;

  onProgress({ active: true, label, completed: 0, total });

  for (const imageId of imageIds) {
    if (signal.aborted) break;

    await waitForReconciler();
    if (signal.aborted) break;

    const cached = await restoreBuffers(imageId);
    if (signal.aborted) break;
    if (!cached) {
      completed++;
      onProgress({ active: true, label, completed, total });
      continue;
    }

    const w = widths.get(imageId) ?? 0;
    const h = heights.get(imageId) ?? 0;
    if (w === 0 || h === 0) {
      completed++;
      onProgress({ active: true, label, completed, total });
      continue;
    }

    const gray: GrayscaleBuffer = { width: w, height: h, data: new Uint8Array(cached.gray) };
    let rgba: RgbaBuffer | undefined;
    if (cached.rgba) {
      rgba = { width: w, height: h, data: new Uint8ClampedArray(cached.rgba) };
    }
    let tiffStretchContext: TiffStretchContext | undefined;
    if (cached.tiffRaw && cached.tiffKind) {
      tiffStretchContext = {
        kind: cached.tiffKind as TiffStretchContext['kind'],
        raw: new Uint8Array(cached.tiffRaw),
        pixelCount: cached.tiffPixelCount!,
        invert: cached.tiffInvert!,
        littleEndian: cached.tiffLittleEndian!,
      };
    }

    const result = await processFn(imageId, { gray, rgba, tiffStretchContext });
    if (signal.aborted) break;

    if (result) {
      const graySnapshot = new Uint8Array(result.gray.slice(0));
      await persistBuffersOffThread(imageId, result);
      if (signal.aborted) break;
      const updatedGray: GrayscaleBuffer = {
        width: w,
        height: h,
        data: graySnapshot,
      };
      onItemDone(imageId, updatedGray);
    }

    completed++;
    onProgress({ active: true, label, completed, total });

    await new Promise((r) => setTimeout(r, 0));
  }

  if (currentAbort === controller) {
    currentAbort = null;
  }
  onProgress(BATCH_IDLE);
}
