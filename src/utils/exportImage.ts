import type { RoiShape } from '../domain/roi/roiTypes';
import { drawShape, drawPointMarkers, drawPointArrowMarkers } from '../components/roiDraw';

export interface ExportImageOptions {
  baseCanvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  rois: RoiShape[];
  selectedRoiIndex: number;
  width: number;
  height: number;
  overlayVisible: boolean;
  overlayOpacity: number;
  fileName: string;
}

export function exportCompositeImage(opts: ExportImageOptions): void {
  const {
    baseCanvas,
    overlayCanvas,
    rois,
    selectedRoiIndex,
    width,
    height,
    overlayVisible,
    overlayOpacity,
    fileName,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(baseCanvas, 0, 0, width, height);

  if (overlayVisible && overlayOpacity > 0) {
    ctx.globalAlpha = overlayOpacity;
    ctx.drawImage(overlayCanvas, 0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const scale = 1;
  rois.forEach((r, i) => {
    if (i === selectedRoiIndex) return;
    if (r.type === 'point') {
      drawPointMarkers(ctx, r.points, scale, false);
      return;
    }
    if (r.type === 'pointArrow') {
      drawPointArrowMarkers(ctx, r.points, scale, false);
      return;
    }
    drawShape(ctx, r, false, scale);
  });
  const selected = selectedRoiIndex >= 0 ? rois[selectedRoiIndex] : null;
  if (selected) {
    if (selected.type === 'point') {
      drawPointMarkers(ctx, selected.points, scale, true);
    } else if (selected.type === 'pointArrow') {
      drawPointArrowMarkers(ctx, selected.points, scale, true);
    } else {
      drawShape(ctx, selected, true, scale);
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_export.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
