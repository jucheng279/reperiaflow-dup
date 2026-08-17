import type { Point, RoiShape } from '../domain/roi/roiTypes';
import { isOpenRoi } from '../domain/roi/roiTypes';

export function drawShape(
  ctx: CanvasRenderingContext2D,
  roi: RoiShape,
  selected: boolean = true,
  scale: number = 1,
): void {
  const stroke = selected ? '#22d3ee' : '#94a3b8';
  ctx.lineWidth = (selected ? 2 : 1.25) / scale;
  ctx.strokeStyle = stroke;
  if (isOpenRoi(roi)) {
    const pts = openRoiPoints(roi);
    drawOpenLine(ctx, pts, scale, stroke);
    return;
  }
  const inset = ctx.lineWidth / 2;
  ctx.beginPath();
  switch (roi.type) {
    case 'rectangle': {
      const x0 = Math.min(roi.x, roi.x + roi.w);
      const y0 = Math.min(roi.y, roi.y + roi.h);
      const w0 = Math.abs(roi.w);
      const h0 = Math.abs(roi.h);
      const dx = Math.min(inset, w0 / 2);
      const dy = Math.min(inset, h0 / 2);
      ctx.rect(x0 + dx, y0 + dy, Math.max(w0 - dx * 2, 0), Math.max(h0 - dy * 2, 0));
      break;
    }
    case 'ellipse': {
      const cx = roi.x + roi.w / 2;
      const cy = roi.y + roi.h / 2;
      const rx0 = Math.abs(roi.w / 2);
      const ry0 = Math.abs(roi.h / 2);
      const rx = Math.max(rx0 - Math.min(inset, rx0), 0);
      const ry = Math.max(ry0 - Math.min(inset, ry0), 0);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      break;
    }
    case 'polygon':
    case 'freehand': {
      if (roi.points.length > 0) {
        ctx.moveTo(roi.points[0].x, roi.points[0].y);
        for (let i = 1; i < roi.points.length; i++) ctx.lineTo(roi.points[i].x, roi.points[i].y);
        ctx.closePath();
      }
      break;
    }
  }
  ctx.stroke();
}

export function openRoiPoints(roi: RoiShape): Point[] {
  if (roi.type === 'line') return [{ x: roi.x1, y: roi.y1 }, { x: roi.x2, y: roi.y2 }];
  if (roi.type === 'freehandLine') return roi.points;
  return [];
}

export function drawOpenLine(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  scale: number,
  color: string,
): void {
  if (pts.length < 2) return;
  ctx.lineWidth = 2 / scale;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export function drawPointMarkers(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  scale: number,
  selected: boolean,
): void {
  if (pts.length === 0) return;
  const radius = Math.max(8 / scale, 6);
  const fontPx = Math.max(11 / scale, 9);
  const fill = selected ? '#22d3ee' : '#f97316';
  const text = selected ? '#0f172a' : '#0f172a';
  ctx.save();
  ctx.font = `600 ${fontPx}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineWidth = Math.max(1.25 / scale, 1);
  ctx.strokeStyle = '#0f172a';
  pts.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.fillText(String(i + 1), p.x, p.y);
  });
  ctx.restore();
}

export function drawPointArrowMarkers(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  scale: number,
  selected: boolean,
): void {
  if (pts.length === 0) return;
  const color = selected ? '#22d3ee' : '#f97316';
  const offset = Math.max(4 / scale, 3);
  const length = Math.max(22 / scale, 14);
  const head = Math.max(5 / scale, 4);
  ctx.save();
  ctx.lineWidth = Math.max(1.75 / scale, 1.25);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  pts.forEach((p) => {
    const tipY = p.y + offset;
    const baseY = tipY + length;
    ctx.beginPath();
    ctx.moveTo(p.x, tipY);
    ctx.lineTo(p.x, baseY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x, tipY);
    ctx.lineTo(p.x - head, tipY + head);
    ctx.moveTo(p.x, tipY);
    ctx.lineTo(p.x + head, tipY + head);
    ctx.stroke();
  });
  ctx.restore();
}
