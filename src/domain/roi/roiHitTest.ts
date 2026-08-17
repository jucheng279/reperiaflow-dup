import type { Point, RoiShape } from './roiTypes';

export function hitTestRoi(roi: RoiShape, p: Point, tol: number): boolean {
  switch (roi.type) {
    case 'rectangle':
      return pointInRect(p, roi.x, roi.y, roi.w, roi.h, tol);
    case 'ellipse':
      return pointInEllipse(p, roi.x, roi.y, roi.w, roi.h, tol);
    case 'polygon':
    case 'freehand':
      return pointInPolygon(p, roi.points) || pointNearPolyline(p, roi.points, tol, true);
    case 'line':
      return pointNearSegment(p, { x: roi.x1, y: roi.y1 }, { x: roi.x2, y: roi.y2 }, tol);
    case 'freehandLine':
      return pointNearPolyline(p, roi.points, tol, false);
    case 'point':
    case 'pointArrow': {
      const r = Math.max(tol, 6);
      for (const q of roi.points) {
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        if (dx * dx + dy * dy <= r * r) return true;
      }
      return false;
    }
  }
}

export function pickRoiAt(rois: readonly RoiShape[], p: Point, tol: number): number {
  for (let i = rois.length - 1; i >= 0; i--) {
    if (hitTestRoi(rois[i], p, tol)) return i;
  }
  return -1;
}

function pointInRect(p: Point, x: number, y: number, w: number, h: number, tol: number): boolean {
  const x0 = Math.min(x, x + w) - tol;
  const x1 = Math.max(x, x + w) + tol;
  const y0 = Math.min(y, y + h) - tol;
  const y1 = Math.max(y, y + h) + tol;
  return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
}

function pointInEllipse(p: Point, x: number, y: number, w: number, h: number, tol: number): boolean {
  const a = Math.abs(w / 2) + tol;
  const b = Math.abs(h / 2) + tol;
  if (a <= 0 || b <= 0) return false;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = (p.x - cx) / a;
  const dy = (p.y - cy) / b;
  return dx * dx + dy * dy <= 1;
}

function pointInPolygon(p: Point, pts: Point[]): boolean {
  if (pts.length < 3) return false;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointNearPolyline(p: Point, pts: Point[], tol: number, closed: boolean): boolean {
  if (pts.length < 2) return false;
  const end = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < end; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (pointNearSegment(p, a, b, tol)) return true;
  }
  return false;
}

function pointNearSegment(p: Point, a: Point, b: Point, tol: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx;
  const ey = p.y - cy;
  return ex * ex + ey * ey <= tol * tol;
}

export function roiCentroid(roi: RoiShape): Point {
  switch (roi.type) {
    case 'rectangle':
    case 'ellipse':
      return { x: roi.x + roi.w / 2, y: roi.y + roi.h / 2 };
    case 'polygon':
    case 'freehand':
    case 'freehandLine':
    case 'point':
    case 'pointArrow': {
      const pts = roi.points;
      if (pts.length === 0) return { x: 0, y: 0 };
      let sx = 0;
      let sy = 0;
      for (const p of pts) {
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / pts.length, y: sy / pts.length };
    }
    case 'line':
      return { x: (roi.x1 + roi.x2) / 2, y: (roi.y1 + roi.y2) / 2 };
  }
}
