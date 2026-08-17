import type { RoiShape, RoiMask, Point } from './roiTypes';

export function rasterizeRoi(roi: RoiShape, width: number, height: number): RoiMask {
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
  return { width, height, data };
}

function fillRect(
  data: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
): void {
  const x0 = Math.max(0, Math.floor(Math.min(x, x + rw)));
  const y0 = Math.max(0, Math.floor(Math.min(y, y + rh)));
  const x1 = Math.min(w, Math.ceil(Math.max(x, x + rw)));
  const y1 = Math.min(h, Math.ceil(Math.max(y, y + rh)));
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx < x1; xx++) data[row + xx] = 1;
  }
}

function fillEllipse(
  data: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
): void {
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

// Even-odd scanline polygon fill.
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
