import type { BrightfieldMeasurementResult, MeasurementResult } from './measurementTypes';

/**
 * Fluorescence single-pass measurement.
 *   roiAreaPx         = count of pixels where roiMask = 1
 *   thresholdedAreaPx = count of pixels where roiMask = 1 AND thresholdMask = 1
 *   integratedDensity = sum of gray intensities for pixels counted in thresholdedAreaPx
 */
export function measure(
  gray: Uint8Array,
  thresholdMask: Uint8Array,
  roiMask: Uint8Array,
): MeasurementResult {
  if (gray.length !== thresholdMask.length || gray.length !== roiMask.length) {
    throw new Error('measure: buffer length mismatch');
  }
  let roiAreaPx = 0;
  let thresholdedAreaPx = 0;
  let integratedDensity = 0;
  for (let i = 0; i < gray.length; i++) {
    if (roiMask[i]) {
      roiAreaPx++;
      if (thresholdMask[i]) {
        thresholdedAreaPx++;
        integratedDensity += gray[i];
      }
    }
  }
  return { roiAreaPx, thresholdedAreaPx, integratedDensity };
}

/**
 * Brightfield measurement uses a closed ROI mask for area only; no threshold, no intensity sum.
 */
export function measureArea(roiMask: Uint8Array): BrightfieldMeasurementResult {
  let roiAreaPx = 0;
  for (let i = 0; i < roiMask.length; i++) if (roiMask[i]) roiAreaPx++;
  return { roiAreaPx, lengthPx: 0 };
}
