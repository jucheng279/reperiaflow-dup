import type { ThresholdRange } from '../threshold/thresholdTypes';

export type RoiType =
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'freehand'
  | 'line'
  | 'freehandLine'
  | 'point'
  | 'pointArrow'
  | 'full'
  | 'combined';

export interface Point {
  x: number;
  y: number;
}

export interface RectangleRoi {
  type: 'rectangle';
  x: number;
  y: number;
  w: number;
  h: number;
  threshold?: ThresholdRange;
}

export interface EllipseRoi {
  type: 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  threshold?: ThresholdRange;
}

export interface PolygonRoi {
  type: 'polygon';
  points: Point[];
  closed: boolean;
  threshold?: ThresholdRange;
}

export interface FreehandRoi {
  type: 'freehand';
  points: Point[];
  threshold?: ThresholdRange;
}

export interface LineRoi {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FreehandLineRoi {
  type: 'freehandLine';
  points: Point[];
}

export interface PointRoi {
  type: 'point';
  points: Point[];
}

export interface PointArrowRoi {
  type: 'pointArrow';
  points: Point[];
}

export type RoiShape =
  | RectangleRoi
  | EllipseRoi
  | PolygonRoi
  | FreehandRoi
  | LineRoi
  | FreehandLineRoi
  | PointRoi
  | PointArrowRoi;

export interface RoiMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export function isClosedRoi(roi: RoiShape): boolean {
  return (
    roi.type === 'rectangle' ||
    roi.type === 'ellipse' ||
    roi.type === 'polygon' ||
    roi.type === 'freehand'
  );
}

export function isOpenRoi(roi: RoiShape): boolean {
  return roi.type === 'line' || roi.type === 'freehandLine';
}

export function isPointRoi(roi: RoiShape): roi is PointRoi | PointArrowRoi {
  return roi.type === 'point' || roi.type === 'pointArrow';
}

export function roiPointCount(roi: RoiShape): number {
  return roi.type === 'point' || roi.type === 'pointArrow' ? roi.points.length : 0;
}

export function getRoiThreshold(
  roi: RoiShape,
  fallback: ThresholdRange,
): ThresholdRange {
  if (!isClosedRoi(roi)) return fallback;
  const t = (roi as RectangleRoi | EllipseRoi | PolygonRoi | FreehandRoi).threshold;
  return t ?? fallback;
}

export function roiPathLengthPx(roi: RoiShape): number {
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
