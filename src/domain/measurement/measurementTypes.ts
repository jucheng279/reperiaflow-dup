import type { RoiType } from '../roi/roiTypes';
import type { ThresholdSource } from '../threshold/thresholdTypes';
import type { ImageMode } from '../session/sessionTypes';
import { pixelsToArea, pixelsToLength, type Calibration } from '../image/calibration';

export type MeasurementProfile = 'fluorescence' | 'brightfield';

export interface MeasurementResult {
  roiAreaPx: number;
  thresholdedAreaPx: number;
  integratedDensity: number;
}

export interface BrightfieldMeasurementResult {
  roiAreaPx: number;
  lengthPx: number;
}

export interface MeasurementRow {
  id: string;
  imageId: string;
  fileName: string;
  queueIndex: number;
  profile: MeasurementProfile;
  imageMode: ImageMode;
  roiType: RoiType;
  measuredAtIso: string;
  measuredAt: number;
  batchId: string | null;

  // Fluorescence fields (null for brightfield).
  thresholdSource: ThresholdSource | null;
  thresholdMin: number | null;
  thresholdMax: number | null;
  thresholdedAreaPx: number | null;
  thresholdedAreaCal: number | null;
  integratedDensity: number | null;

  // Shared area measurement (present for both profiles when ROI is closed).
  roiAreaPx: number;

  // Brightfield length measurement (null for fluorescence and for closed brightfield ROIs).
  lengthPx: number | null;

  // Manual click count from point ROIs (null when no point ROI was drawn).
  count: number | null;

  // Calibration snapshot at measurement time.
  pixelWidth: number;
  pixelHeight: number;
  unit: string;
  areaCal: number | null;
  lengthCal: number | null;
}

export function recalibrateRow(row: MeasurementRow, cal: Calibration): MeasurementRow {
  return {
    ...row,
    pixelWidth: cal.pixelWidth,
    pixelHeight: cal.pixelHeight,
    unit: cal.unit,
    areaCal: null,
    thresholdedAreaCal:
      row.thresholdedAreaPx == null ? null : pixelsToArea(row.thresholdedAreaPx, cal),
    lengthCal: row.lengthPx == null ? null : pixelsToLength(row.lengthPx, cal),
  };
}
