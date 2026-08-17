export const HOT_CAPACITY = 15;
const NEIGHBOR_RADIUS = 5;
const HISTORY_CAPACITY = 5;

const order: string[] = [];
const selectionHistory: string[] = [];

export function touch(imageId: string): void {
  const idx = order.indexOf(imageId);
  if (idx >= 0) order.splice(idx, 1);
  order.unshift(imageId);
}

export function getEvictionCandidates(skippedIds?: Set<string>): string[] {
  if (!skippedIds || skippedIds.size === 0) {
    if (order.length <= HOT_CAPACITY) return [];
    return order.slice(HOT_CAPACITY);
  }
  // Skipped images always count as eviction candidates; only non-skipped
  // images occupy the HOT_CAPACITY slots.
  const candidates: string[] = [];
  let kept = 0;
  for (const id of order) {
    if (skippedIds.has(id)) {
      candidates.push(id);
    } else if (kept >= HOT_CAPACITY) {
      candidates.push(id);
    } else {
      kept++;
    }
  }
  return candidates;
}

export function remove(imageId: string): void {
  const idx = order.indexOf(imageId);
  if (idx >= 0) order.splice(idx, 1);
  const hIdx = selectionHistory.indexOf(imageId);
  if (hIdx >= 0) selectionHistory.splice(hIdx, 1);
}

export function clear(): void {
  order.length = 0;
  selectionHistory.length = 0;
}

export function isTracked(imageId: string): boolean {
  return order.includes(imageId);
}

export function pushHistory(imageId: string): void {
  const idx = selectionHistory.indexOf(imageId);
  if (idx >= 0) selectionHistory.splice(idx, 1);
  selectionHistory.unshift(imageId);
  if (selectionHistory.length > HISTORY_CAPACITY) {
    selectionHistory.length = HISTORY_CAPACITY;
  }
}

export function getHistory(): readonly string[] {
  return selectionHistory;
}

export interface HotSetDelta {
  toHydrate: string[];
  toEvict: string[];
}

export function computeHotSet(
  imageIds: string[],
  activeIndex: number,
  skippedIds?: Set<string>,
): Set<string> {
  const hot = new Set<string>();
  if (activeIndex < 0 || activeIndex >= imageIds.length) return hot;

  hot.add(imageIds[activeIndex]);

  // Collect up to NEIGHBOR_RADIUS non-skipped neighbors in each direction
  let collected = 0;
  for (let i = activeIndex + 1; i < imageIds.length && collected < NEIGHBOR_RADIUS; i++) {
    if (skippedIds && skippedIds.has(imageIds[i])) continue;
    hot.add(imageIds[i]);
    collected++;
  }
  collected = 0;
  for (let i = activeIndex - 1; i >= 0 && collected < NEIGHBOR_RADIUS; i--) {
    if (skippedIds && skippedIds.has(imageIds[i])) continue;
    hot.add(imageIds[i]);
    collected++;
  }

  for (const id of selectionHistory) {
    if (hot.size >= HOT_CAPACITY) break;
    if (skippedIds && skippedIds.has(id)) continue;
    hot.add(id);
  }

  return hot;
}

export function computeDelta(
  prevHot: Set<string>,
  nextHot: Set<string>,
): HotSetDelta {
  const toHydrate: string[] = [];
  const toEvict: string[] = [];

  for (const id of nextHot) {
    if (!prevHot.has(id)) toHydrate.push(id);
  }
  for (const id of prevHot) {
    if (!nextHot.has(id)) toEvict.push(id);
  }

  return { toHydrate, toEvict };
}
