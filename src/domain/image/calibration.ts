export type CalibrationSource = 'none' | 'set-scale' | 'manual' | 'tiff-metadata';

export interface Calibration {
  pixelWidth: number;
  pixelHeight: number;
  unit: string;
  source: CalibrationSource;
}

export const NO_CALIBRATION: Calibration = {
  pixelWidth: 1,
  pixelHeight: 1,
  unit: 'px',
  source: 'none',
};

export function isCalibrated(c: Calibration): boolean {
  return c.source !== 'none';
}

export function unitLabel(c: Calibration): string {
  return isCalibrated(c) ? c.unit : 'px';
}

export function areaUnitLabel(c: Calibration): string {
  return isCalibrated(c) ? `${c.unit}^2` : 'px^2';
}

export function pixelsToLength(lengthPx: number, c: Calibration): number {
  if (!isCalibrated(c)) return lengthPx;
  // Use the geometric mean so diagonals work for non-square pixels.
  const s = Math.sqrt(c.pixelWidth * c.pixelHeight);
  return lengthPx * s;
}

export function pixelsToArea(areaPx: number, c: Calibration): number {
  if (!isCalibrated(c)) return areaPx;
  return areaPx * c.pixelWidth * c.pixelHeight;
}

/**
 * Derive calibration from a Set Scale drawing: a line of known pixel length
 * corresponds to a user-entered real length in `unit`.
 */
export function calibrationFromLine(
  pixelLength: number,
  knownLength: number,
  unit: string,
): Calibration {
  if (pixelLength <= 0 || knownLength <= 0 || !unit.trim()) return NO_CALIBRATION;
  const pxSize = knownLength / pixelLength;
  return {
    pixelWidth: pxSize,
    pixelHeight: pxSize,
    unit: unit.trim(),
    source: 'set-scale',
  };
}
