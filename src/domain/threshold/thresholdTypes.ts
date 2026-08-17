export interface ThresholdRange {
  min: number;
  max: number;
}

export type ThresholdSource = 'threshold';

export function clampRange(r: ThresholdRange): ThresholdRange {
  let min = Math.round(r.min);
  let max = Math.round(r.max);
  if (min < 0) min = 0;
  if (max > 255) max = 255;
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

export type ThresholdScrollTarget = 'min' | 'max';

export function applyThresholdWheel(
  deltaY: number,
  shiftKey: boolean,
  target: ThresholdScrollTarget,
  range: ThresholdRange,
): ThresholdRange | null {
  const dir: 1 | -1 = deltaY < 0 ? 1 : -1;
  return applyThresholdStep(dir, shiftKey, target, range);
}

export function applyThresholdStep(
  direction: 1 | -1,
  shiftKey: boolean,
  target: ThresholdScrollTarget,
  range: ThresholdRange,
): ThresholdRange | null {
  const step = shiftKey ? 5 : 1;
  const delta = direction * step;
  const { min, max } = range;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (target === 'min') {
    const next = clamp(min + delta, 0, max);
    return next === min ? null : { min: next, max };
  }
  const next = clamp(max + delta, min, 255);
  return next === max ? null : { min, max: next };
}
