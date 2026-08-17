import type { ThresholdRange } from './thresholdTypes';

/**
 * Build a binary mask the same size as `gray`.
 * mask[i] = 1 when min <= gray[i] <= max, else 0.
 */
export function buildThresholdMask(
  gray: Uint8Array,
  range: ThresholdRange,
  out?: Uint8Array,
): Uint8Array {
  const mask = out && out.length === gray.length ? out : new Uint8Array(gray.length);
  const { min, max } = range;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    mask[i] = v >= min && v <= max ? 1 : 0;
  }
  return mask;
}

/**
 * Build a binary mask where each pixel is selected by the threshold range
 * corresponding to its owning ROI. `ownerMap[i]` values:
 *   - 0     -> use `mainRange`
 *   - k+1   -> use `rangesByOwner[k]` (fallback to mainRange if missing/null)
 */
export function buildSegmentedThresholdMask(
  gray: Uint8Array,
  ownerMap: Uint16Array,
  mainRange: ThresholdRange,
  rangesByOwner: Array<ThresholdRange | null | undefined>,
  out?: Uint8Array,
): Uint8Array {
  const mask = out && out.length === gray.length ? out : new Uint8Array(gray.length);
  const mainMin = mainRange.min;
  const mainMax = mainRange.max;
  const mins = new Int32Array(rangesByOwner.length);
  const maxs = new Int32Array(rangesByOwner.length);
  for (let k = 0; k < rangesByOwner.length; k++) {
    const r = rangesByOwner[k] ?? mainRange;
    mins[k] = r.min;
    maxs[k] = r.max;
  }
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    const owner = ownerMap[i];
    if (owner === 0) {
      mask[i] = v >= mainMin && v <= mainMax ? 1 : 0;
    } else {
      const k = owner - 1;
      mask[i] = v >= mins[k] && v <= maxs[k] ? 1 : 0;
    }
  }
  return mask;
}

export function countThresholdPositive(mask: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) c++;
  return c;
}
