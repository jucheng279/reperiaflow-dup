/// <reference lib="webworker" />

import type { ThresholdRange } from '../domain/threshold/thresholdTypes';
import type { RoiShape } from '../domain/roi/roiTypes';
import type { RoiType } from '../domain/roi/roiTypes';
import type { MeasurementProfile } from '../domain/measurement/measurementTypes';
import type { ImageMode } from '../domain/session/sessionTypes';

// ---------- Inlined helpers (self-contained, no cross-file imports at runtime) ----------

function isClosedRoi(roi: RoiShape): boolean {
  return (
    roi.type === 'rectangle' ||
    roi.type === 'ellipse' ||
    roi.type === 'polygon' ||
    roi.type === 'freehand'
  );
}

function isOpenRoi(roi: RoiShape): boolean {
  return roi.type === 'line' || roi.type === 'freehandLine';
}

function isPointRoi(roi: RoiShape): boolean {
  return roi.type === 'point' || roi.type === 'pointArrow';
}

function roiPointCount(roi: RoiShape): number {
  return roi.type === 'point' || roi.type === 'pointArrow' ? roi.points.length : 0;
}

function roiPathLengthPx(roi: RoiShape): number {
  if (roi.type === 'line') {
    const dx = roi.x2 - roi.x1;
    const dy = roi.y2 - roi.y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
  if (roi.type === 'freehandLine') {
    let total = 0;
    for (let i = 1; i < roi.points.length; i++) {
      const dx = roi.points[i].x - roi.points[i - 1].x;
      const dy = roi.points[i].y - roi.points[i - 1].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
  }
  return 0;
}

interface Point { x: number; y: number }

function rasterizeRoi(roi: RoiShape, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height);
  switch (roi.type) {
    case 'rectangle':
      fillRect(data, width, height, roi.x, roi.y, roi.w, roi.h);
      break;
    case 'ellipse':
      fillEllipse(data, width, height, roi.x, roi.y, roi.w, roi.h);
      break;
    case 'polygon':
    case 'freehand': {
      const pts = roi.points;
      if (pts.length >= 3) fillPolygon(data, width, height, pts);
      break;
    }
  }
  return data;
}

function fillRect(data: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number): void {
  const x0 = Math.max(0, Math.floor(Math.min(x, x + rw)));
  const y0 = Math.max(0, Math.floor(Math.min(y, y + rh)));
  const x1 = Math.min(w, Math.ceil(Math.max(x, x + rw)));
  const y1 = Math.min(h, Math.ceil(Math.max(y, y + rh)));
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx < x1; xx++) data[row + xx] = 1;
  }
}

function fillEllipse(data: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number): void {
  const cx = x + rw / 2;
  const cy = y + rh / 2;
  const a = Math.abs(rw / 2);
  const b = Math.abs(rh / 2);
  if (a <= 0 || b <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - a));
  const y0 = Math.max(0, Math.floor(cy - b));
  const x1 = Math.min(w, Math.ceil(cx + a));
  const y1 = Math.min(h, Math.ceil(cy + b));
  const a2 = a * a;
  const b2 = b * b;
  for (let yy = y0; yy < y1; yy++) {
    const dy = yy + 0.5 - cy;
    const row = yy * w;
    for (let xx = x0; xx < x1; xx++) {
      const dx = xx + 0.5 - cx;
      if ((dx * dx) / a2 + (dy * dy) / b2 <= 1) data[row + xx] = 1;
    }
  }
}

function fillPolygon(data: Uint8Array, w: number, h: number, pts: Point[]): void {
  const n = pts.length;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const ys = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if ((a.y <= ys && b.y > ys) || (b.y <= ys && a.y > ys)) {
        const t = (ys - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    const row = y * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx = Math.max(0, Math.ceil(xs[k] - 0.5));
      const ex = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = sx; x <= ex; x++) data[row + x] = 1;
    }
  }
}

function unionClosedRoiMask(rois: RoiShape[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const roi of rois) {
    const mask = rasterizeRoi(roi, width, height);
    for (let i = 0; i < out.length; i++) {
      if (mask[i]) out[i] = 1;
    }
  }
  return out;
}

function buildRoiOwnerMap(rois: RoiShape[], width: number, height: number): Uint16Array {
  const owner = new Uint16Array(width * height);
  for (let k = 0; k < rois.length; k++) {
    const roi = rois[k];
    if (!isClosedRoi(roi)) continue;
    const mask = rasterizeRoi(roi, width, height);
    const tag = k + 1;
    for (let i = 0; i < owner.length; i++) {
      if (mask[i]) owner[i] = tag;
    }
  }
  return owner;
}

function hasAnyClosedRoi(rois: RoiShape[]): boolean {
  for (const r of rois) if (isClosedRoi(r)) return true;
  return false;
}

function buildThresholdMask(gray: Uint8Array, range: ThresholdRange): Uint8Array {
  const mask = new Uint8Array(gray.length);
  const { min, max } = range;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    mask[i] = v >= min && v <= max ? 1 : 0;
  }
  return mask;
}

function buildSegmentedThresholdMask(
  gray: Uint8Array,
  ownerMap: Uint16Array,
  mainRange: ThresholdRange,
  rangesByOwner: Array<ThresholdRange | null | undefined>,
): Uint8Array {
  const mask = new Uint8Array(gray.length);
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
    const o = ownerMap[i];
    if (o === 0) {
      mask[i] = v >= mainMin && v <= mainMax ? 1 : 0;
    } else {
      const k = o - 1;
      mask[i] = v >= mins[k] && v <= maxs[k] ? 1 : 0;
    }
  }
  return mask;
}

function measure(
  gray: Uint8Array,
  thresholdMask: Uint8Array,
  roiMask: Uint8Array,
): { roiAreaPx: number; thresholdedAreaPx: number; integratedDensity: number } {
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

function measureArea(roiMask: Uint8Array): { roiAreaPx: number; lengthPx: number } {
  let roiAreaPx = 0;
  for (let i = 0; i < roiMask.length; i++) if (roiMask[i]) roiAreaPx++;
  return { roiAreaPx, lengthPx: 0 };
}

function pixelsToLength(lengthPx: number, cal: CalibrationData): number {
  if (cal.source === 'none') return lengthPx;
  const s = Math.sqrt(cal.pixelWidth * cal.pixelHeight);
  return lengthPx * s;
}

function pixelsToArea(areaPx: number, cal: CalibrationData): number {
  if (cal.source === 'none') return areaPx;
  return areaPx * cal.pixelWidth * cal.pixelHeight;
}

// ---------- Message types ----------

interface CalibrationData {
  pixelWidth: number;
  pixelHeight: number;
  unit: string;
  source: string;
}

export interface MeasureImageInput {
  imageId: string;
  fileName: string;
  gray: Uint8Array;
  width: number;
  height: number;
  rois: RoiShape[];
  mode: ImageMode;
  threshold: ThresholdRange;
  calibration: CalibrationData;
  queueIndex: number;
}

export interface MeasureRowResult {
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
  thresholdSource: 'threshold' | null;
  thresholdMin: number | null;
  thresholdMax: number | null;
  thresholdedAreaPx: number | null;
  thresholdedAreaCal: number | null;
  integratedDensity: number | null;
  roiAreaPx: number;
  lengthPx: number | null;
  count: number | null;
  pixelWidth: number;
  pixelHeight: number;
  unit: string;
  areaCal: number | null;
  lengthCal: number | null;
}

export interface MeasureBatchRequest {
  type: 'measureBatch';
  reqId: number;
  items: MeasureImageInput[];
}

export interface MeasureBatchResponse {
  type: 'measureBatchDone';
  reqId: number;
  results: Array<{ imageId: string; row: MeasureRowResult | null; isBrightfieldSkipped: boolean }>;
}

export type MeasureWorkerRequest = MeasureBatchRequest;
export type MeasureWorkerResponse = MeasureBatchResponse;

// ---------- Core measurement logic ----------

let uuidCounter = 0;
function workerUuid(): string {
  return `m-${Date.now()}-${++uuidCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildRow(input: MeasureImageInput): MeasureRowResult | null {
  const { gray, width, height, rois, mode, threshold, calibration, queueIndex, imageId, fileName } = input;
  if (!gray || gray.length === 0) return null;

  const nowIso = new Date().toISOString();
  const base = {
    id: workerUuid(),
    imageId,
    fileName,
    queueIndex,
    measuredAtIso: nowIso,
    measuredAt: Date.now(),
    batchId: null as string | null,
    pixelWidth: calibration.pixelWidth,
    pixelHeight: calibration.pixelHeight,
    unit: calibration.unit,
    imageMode: mode,
  };

  const closedRois = rois.filter(isClosedRoi);
  const openRois = rois.filter(isOpenRoi);
  const pointRois = rois.filter(isPointRoi);
  const totalRois = rois.length;
  const combinedRoiType: RoiType =
    totalRois === 0 ? 'full' : totalRois === 1 ? rois[0].type : 'combined';
  const pointTotal = pointRois.reduce((s, r) => s + roiPointCount(r), 0);
  const count = pointRois.length > 0 ? pointTotal : null;

  if (mode === 'brightfield') {
    if (totalRois === 0) return null;
    if (closedRois.length === 0) {
      const lengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
      const hasLength = openRois.length > 0;
      return {
        ...base,
        profile: 'brightfield',
        roiType: combinedRoiType,
        roiAreaPx: 0,
        lengthPx: hasLength ? lengthPx : null,
        lengthCal: hasLength ? pixelsToLength(lengthPx, calibration) : null,
        areaCal: null,
        thresholdSource: null,
        thresholdMin: null,
        thresholdMax: null,
        thresholdedAreaPx: null,
        thresholdedAreaCal: null,
        integratedDensity: null,
        count,
      };
    }
    const unionMask = unionClosedRoiMask(closedRois, width, height);
    const result = measureArea(unionMask);
    const summedLengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
    const lengthPx = summedLengthPx > 0 ? summedLengthPx : null;
    return {
      ...base,
      profile: 'brightfield',
      roiType: combinedRoiType,
      roiAreaPx: result.roiAreaPx,
      lengthPx,
      lengthCal: lengthPx == null ? null : pixelsToLength(lengthPx, calibration),
      areaCal: null,
      thresholdSource: null,
      thresholdMin: null,
      thresholdMax: null,
      thresholdedAreaPx: null,
      thresholdedAreaCal: null,
      integratedDensity: null,
      count,
    };
  }

  // Fluorescence
  if (totalRois > 0 && closedRois.length === 0 && openRois.length > 0) {
    const lengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
    return {
      ...base,
      profile: 'fluorescence',
      roiType: combinedRoiType,
      roiAreaPx: 0,
      lengthPx,
      lengthCal: pixelsToLength(lengthPx, calibration),
      areaCal: null,
      thresholdSource: null,
      thresholdMin: null,
      thresholdMax: null,
      thresholdedAreaPx: null,
      thresholdedAreaCal: null,
      integratedDensity: null,
      count,
    };
  }

  const range = threshold;
  const thresholdMask =
    closedRois.length > 0 && hasAnyClosedRoi(rois)
      ? buildSegmentedThresholdMask(
          gray,
          buildRoiOwnerMap(rois, width, height),
          range,
          rois.map((r) =>
            isClosedRoi(r)
              ? (r as { threshold?: ThresholdRange }).threshold ?? range
              : null,
          ),
        )
      : buildThresholdMask(gray, range);
  const maskData =
    closedRois.length > 0
      ? unionClosedRoiMask(closedRois, width, height)
      : (() => { const d = new Uint8Array(width * height); d.fill(1); return d; })();
  const result = measure(gray, thresholdMask, maskData);
  const summedLengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
  const lengthPx = summedLengthPx > 0 ? summedLengthPx : null;

  return {
    ...base,
    profile: 'fluorescence',
    roiType: combinedRoiType,
    roiAreaPx: result.roiAreaPx,
    lengthPx,
    lengthCal: lengthPx == null ? null : pixelsToLength(lengthPx, calibration),
    areaCal: null,
    thresholdSource: 'threshold',
    thresholdMin: range.min,
    thresholdMax: range.max,
    thresholdedAreaPx: result.thresholdedAreaPx,
    thresholdedAreaCal: pixelsToArea(result.thresholdedAreaPx, calibration),
    integratedDensity: result.integratedDensity,
    count,
  };
}

// ---------- Message handler ----------

self.onmessage = (e: MessageEvent<MeasureWorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'measureBatch') {
    const results: MeasureBatchResponse['results'] = [];
    for (const item of msg.items) {
      const row = buildRow(item);
      const isBrightfieldSkipped = row === null && item.mode === 'brightfield';
      results.push({ imageId: item.imageId, row, isBrightfieldSkipped });
    }
    const resp: MeasureBatchResponse = {
      type: 'measureBatchDone',
      reqId: msg.reqId,
      results,
    };
    (self as unknown as Worker).postMessage(resp);
  }
};
