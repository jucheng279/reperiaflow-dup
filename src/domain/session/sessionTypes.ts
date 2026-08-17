import type { GrayscaleBuffer, RgbaBuffer } from '../image/bufferTypes';
import type { ColorStats } from '../image/colorStats';
import type { GrayscaleMode } from '../image/grayscale';
import type { ThresholdRange } from '../threshold/thresholdTypes';
import type { RoiShape } from '../roi/roiTypes';
import { getRoiThreshold } from '../roi/roiTypes';
import type { Calibration } from '../image/calibration';
import type { FileMetadata } from '../image/decode';
import type {
  TiffMetadata,
  TiffSourceInfo,
  TiffStretchContext,
  TiffStretchMode,
  PreviewStretchContext,
} from '../image/tiff';

export type ImageMode = 'brightfield' | 'fluorescence';

export type ImageStatus = 'pending' | 'measured' | 'skipped' | 'loading' | 'error';

export interface SessionImage {
  id: string;
  fileName: string;
  width: number;
  height: number;
  gray: GrayscaleBuffer | null;
  rgba?: RgbaBuffer;
  status: ImageStatus;
  decodeError?: string;
  rois: RoiShape[];
  selectedRoiIndex: number;
  calibration: Calibration;
  grayscaleMode: GrayscaleMode;
  grayscaleModeUserSet: boolean;
  color?: ColorStats;
  userColorLabel?: string | null;
  previewBitmap?: ImageBitmap | null;
  previewRgba?: { data: Uint8ClampedArray; width: number; height: number } | null;
  previewGray?: { data: Uint8Array; width: number; height: number } | null;
  tiffSource?: TiffSourceInfo;
  tiffStretchMode?: TiffStretchMode;
  tiffStretchModeUserSet?: boolean;
  tiffStretchContext?: TiffStretchContext;
  previewStretchContext?: PreviewStretchContext;
  tiffMetadata?: TiffMetadata;
  fileMetadata?: FileMetadata;
  lastViewedThreshold?: ThresholdRange | null;
  displayGain?: number;
  hydrated?: boolean;
  wasMeasured?: boolean;
  previewMeanIntensity?: number;
}

export type Phase = 'empty' | 'working' | 'done';

export type NormalizationMode = 'per-image' | 'global';

export interface GlobalRange {
  min: number;
  max: number;
  imageCount: number;
  minImageId: string | null;
  maxImageId: string | null;
}

export interface IngestErrorEntry {
  fileName: string;
  message: string;
}

export interface IngestProgress {
  total: number;
  completed: number;
  errors: IngestErrorEntry[];
}

export interface SessionState {
  sessionId: string;
  phase: Phase;
  images: SessionImage[];
  activeIndex: number;
  threshold: ThresholdRange;
  imagingMode: ImageMode;
  normalizationMode: NormalizationMode;
  globalRange: GlobalRange | null;
  tiffStretchPending: number;
  ingest: IngestProgress;
  skipKeywordFilters: string[];
}

export function isReadyImage(img: SessionImage): boolean {
  return img.status !== 'loading' && img.status !== 'error';
}

export function selectedRoi(img: SessionImage): RoiShape | null {
  if (img.selectedRoiIndex < 0 || img.selectedRoiIndex >= img.rois.length) return null;
  return img.rois[img.selectedRoiIndex];
}

export function activeThresholdRange(
  img: SessionImage | null,
  fallback: ThresholdRange,
): ThresholdRange {
  if (!img) return fallback;
  const sel = selectedRoi(img);
  if (!sel) return fallback;
  return getRoiThreshold(sel, fallback);
}
