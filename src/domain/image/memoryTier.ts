import type { SessionImage } from '../session/sessionTypes';
import type { GrayscaleBuffer, RgbaBuffer } from './bufferTypes';
import type { TiffStretchContext } from './tiff';
import * as lru from './lruManager';
import { restoreBuffers, resetConnection as resetMainThreadDb, type CachedBuffers } from './bufferCache';
import {
  persistBuffersOffThread,
  persistBuffersBatchOffThread,
  purgeBuffersOffThread,
  clearBufferCacheOffThread,
} from '../../workers/idbClient';
import { idbConcurrency } from '../../utils/deviceConcurrency';

export { clearBufferCacheOffThread as clearBufferCache };
export { resetMainThreadDb };
export { purgeBuffersOffThread as purgeBuffers };
export { touch, remove, clear as clearLru, getEvictionCandidates, pushHistory, computeHotSet, computeDelta } from './lruManager';

// Tracks image IDs that have been successfully written to IndexedDB at least once.
const persistConfirmed = new Set<string>();

export function isPersistConfirmed(imageId: string): boolean {
  return persistConfirmed.has(imageId);
}

export function markPersistConfirmed(imageId: string): void {
  persistConfirmed.add(imageId);
}

export function clearPersistConfirmed(): void {
  persistConfirmed.clear();
}

export function isHydrated(img: SessionImage): boolean {
  return img.hydrated !== false;
}

export function shellify(img: SessionImage): SessionImage {
  return {
    ...img,
    gray: null,
    rgba: undefined,
    tiffStretchContext: undefined,
    hydrated: false,
    // previewStretchContext is intentionally preserved -- it's small (~60KB)
    // and allows re-stretching previews without rehydrating the full image
  };
}

function buildCachePayload(img: SessionImage): CachedBuffers {
  const payload: CachedBuffers = {
    gray: img.gray!.data.buffer.slice(0),
  };
  if (img.rgba) {
    payload.rgba = img.rgba.data.buffer.slice(0);
  }
  if (img.tiffStretchContext) {
    const ctx = img.tiffStretchContext;
    payload.tiffRaw = ctx.raw.buffer.slice(0);
    payload.tiffKind = ctx.kind;
    payload.tiffPixelCount = ctx.pixelCount;
    payload.tiffInvert = ctx.invert;
    payload.tiffLittleEndian = ctx.littleEndian;
  }
  return payload;
}

export async function evictImage(img: SessionImage): Promise<SessionImage> {
  if (!isHydrated(img) || img.status === 'loading') return img;
  if (!img.gray) return img;
  const payload = buildCachePayload(img);
  try {
    await persistBuffersOffThread(img.id, payload);
    persistConfirmed.add(img.id);
  } catch {
    return img;
  }
  return shellify(img);
}

export async function persistAndShellify(img: SessionImage): Promise<SessionImage> {
  if (!img.gray) return shellify(img);
  try {
    const payload = buildCachePayload(img);
    await persistBuffersOffThread(img.id, payload);
    persistConfirmed.add(img.id);
  } catch {
    // Persist failed -- keep image hydrated to avoid data loss
    return img;
  }
  return shellify(img);
}

export interface PendingPersist {
  id: string;
  data: CachedBuffers;
}

export function shellifyDeferred(img: SessionImage): { shell: SessionImage; pending: PendingPersist | null } {
  if (!img.gray) return { shell: shellify(img), pending: null };
  const pending: PendingPersist = { id: img.id, data: buildCachePayload(img) };
  return { shell: shellify(img), pending };
}

export function buildPersistEntry(img: SessionImage): PendingPersist | null {
  if (!img.gray) return null;
  const payload: CachedBuffers = {
    gray: img.gray.data.buffer.slice(0),
  };
  if (img.rgba) {
    payload.rgba = img.rgba.data.buffer.slice(0);
  }
  if (img.tiffStretchContext) {
    const ctx = img.tiffStretchContext;
    payload.tiffRaw = ctx.raw.buffer.slice(0);
    payload.tiffKind = ctx.kind;
    payload.tiffPixelCount = ctx.pixelCount;
    payload.tiffInvert = ctx.invert;
    payload.tiffLittleEndian = ctx.littleEndian;
  }
  return { id: img.id, data: payload };
}

export async function flushPendingPersists(entries: PendingPersist[]): Promise<string[]> {
  if (entries.length === 0) return [];
  try {
    await persistBuffersBatchOffThread(entries);
    for (const e of entries) persistConfirmed.add(e.id);
    return [];
  } catch {
    // Batch failed -- try individually to salvage what we can
    const failed: string[] = [];
    for (const entry of entries) {
      try {
        await persistBuffersOffThread(entry.id, entry.data);
        persistConfirmed.add(entry.id);
      } catch {
        failed.push(entry.id);
      }
    }
    return failed;
  }
}

export async function rehydrateImage(img: SessionImage): Promise<SessionImage> {
  if (isHydrated(img)) return img;
  let cached = await restoreBuffers(img.id);
  if (!cached) {
    // Retry once after a short delay -- persist may still be in-flight
    await new Promise((r) => setTimeout(r, 80));
    cached = await restoreBuffers(img.id);
  }
  if (!cached) {
    return { ...img, hydrated: true, status: 'error', decodeError: 'Buffer cache miss' };
  }
  const gray: GrayscaleBuffer = {
    width: img.width,
    height: img.height,
    data: new Uint8Array(cached.gray),
  };
  let rgba: RgbaBuffer | undefined;
  if (cached.rgba) {
    rgba = {
      width: img.width,
      height: img.height,
      data: new Uint8ClampedArray(cached.rgba),
    };
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
  lru.touch(img.id);
  return { ...img, gray, rgba, tiffStretchContext, hydrated: true };
}

export async function evictColdImages(
  images: SessionImage[],
  activeId: string | null,
  skippedIds?: Set<string>,
): Promise<{ images: SessionImage[]; changed: boolean }> {
  const candidates = lru.getEvictionCandidates(skippedIds);
  if (candidates.length === 0) return { images, changed: false };

  const toEvict = new Set(candidates.filter((id) => id !== activeId));
  if (toEvict.size === 0) return { images, changed: false };

  const next = [...images];
  let changed = false;
  const evictions: Promise<void>[] = [];

  for (let i = 0; i < next.length; i++) {
    const img = next[i];
    if (!toEvict.has(img.id)) continue;
    if (!isHydrated(img) || !img.gray) continue;
    changed = true;
    const idx = i;
    evictions.push(
      evictImage(img).then((shell) => {
        next[idx] = shell;
      }),
    );
  }
  await Promise.all(evictions);
  return { images: next, changed };
}

const EVICTION_BATCH_LIMIT = idbConcurrency;

export async function persistAndGetEvictedIds(
  images: SessionImage[],
  activeId: string | null,
  skippedIds?: Set<string>,
): Promise<string[]> {
  const candidates = lru.getEvictionCandidates(skippedIds);
  if (candidates.length === 0) return [];

  const toEvict = new Set(candidates.filter((id) => id !== activeId));
  if (toEvict.size === 0) return [];

  const persisted: string[] = [];
  const work: Array<{ id: string; promise: Promise<boolean> }> = [];

  for (const img of images) {
    if (work.length >= EVICTION_BATCH_LIMIT) break;
    if (!toEvict.has(img.id)) continue;
    if (!isHydrated(img) || !img.gray) continue;
    const payload = buildCachePayload(img);
    const id = img.id;
    work.push({
      id,
      promise: persistBuffersOffThread(id, payload)
        .then(() => { persistConfirmed.add(id); return true; })
        .catch(() => false),
    });
  }

  const results = await Promise.all(work.map((w) => w.promise));
  for (let i = 0; i < work.length; i++) {
    if (results[i]) persisted.push(work[i].id);
  }
  return persisted;
}

export async function ensureHydrated(
  images: SessionImage[],
  imageId: string,
): Promise<{ images: SessionImage[]; target: SessionImage | null; changed: boolean }> {
  const idx = images.findIndex((img) => img.id === imageId);
  if (idx < 0) return { images, target: null, changed: false };
  const img = images[idx];
  if (isHydrated(img)) {
    lru.touch(img.id);
    return { images, target: img, changed: false };
  }
  const restored = await rehydrateImage(img);
  const next = [...images];
  next[idx] = restored;
  return { images: next, target: restored, changed: true };
}
