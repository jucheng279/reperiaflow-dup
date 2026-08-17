import type { RoiShape } from './roiTypes';
import { isClosedRoi } from './roiTypes';
import { rasterizeRoi } from './roiRasterize';

/**
 * Build a per-pixel owner map for a stack of ROIs.
 *   - Value 0 means "no ROI owns this pixel" (uses main threshold).
 *   - Value k+1 means "ROI at index k (in the original rois array) owns this pixel".
 *
 * ROIs are iterated in array order so later-added (higher index) ROIs overwrite
 * earlier ones in overlapping regions. Only closed ROIs own pixels; open and
 * point ROIs are ignored (their indexes never appear in the owner map).
 */
export function buildRoiOwnerMap(
  rois: RoiShape[],
  width: number,
  height: number,
): Uint16Array {
  const owner = new Uint16Array(width * height);
  for (let k = 0; k < rois.length; k++) {
    const roi = rois[k];
    if (!isClosedRoi(roi)) continue;
    const mask = rasterizeRoi(roi, width, height).data;
    const tag = k + 1;
    for (let i = 0; i < owner.length; i++) {
      if (mask[i]) owner[i] = tag;
    }
  }
  return owner;
}

export function hasAnyClosedRoi(rois: RoiShape[]): boolean {
  for (const r of rois) if (isClosedRoi(r)) return true;
  return false;
}
