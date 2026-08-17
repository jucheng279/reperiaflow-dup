import { useEffect, useMemo, useRef } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import type { SessionImage } from '../domain/session/sessionTypes';
import { useSessionStore } from '../domain/session/sessionStore';
import { isClosedRoi, type RoiShape } from '../domain/roi/roiTypes';
import { buildRoiOwnerMap } from '../domain/roi/roiOwnerMap';
import { drawShape, drawPointMarkers, drawPointArrowMarkers } from './roiDraw';

interface OwnerMapCache {
  key: string;
  map: Uint16Array;
  width: number;
  height: number;
}

function scaleRoisForPreview(
  rois: RoiShape[],
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): RoiShape[] {
  const sx = dstW / srcW;
  const sy = dstH / srcH;
  return rois.map((r) => {
    switch (r.type) {
      case 'rectangle':
      case 'ellipse':
        return { ...r, x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy };
      case 'polygon':
      case 'freehand':
      case 'point':
      case 'pointArrow':
        return { ...r, points: r.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) };
      case 'line':
        return { ...r, x1: r.x1 * sx, y1: r.y1 * sy, x2: r.x2 * sx, y2: r.y2 * sy };
      case 'freehandLine':
        return { ...r, points: r.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) };
      default:
        return r;
    }
  });
}

export function GrayscaleThumbnail({ image }: { image: SessionImage }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ownerMapCacheRef = useRef<OwnerMapCache | null>(null);
  const thresholdOverlayEnabled = useSessionStore((s) => s.thresholdOverlayEnabled);

  const snapshot = image.lastViewedThreshold ?? null;
  const isBrightfield = useSessionStore((s) => s.imagingMode) === 'brightfield';
  const snapMin = snapshot?.min ?? 0;
  const snapMax = snapshot?.max ?? 255;
  const gain = Number.isFinite(image.displayGain) ? (image.displayGain as number) : 1;
  const gainActive = gain !== 1;
  const ready = image.status !== 'loading' && image.status !== 'error';

  const rois = image.rois;

  const roiGeomSignature = useMemo(() => {
    return rois
      .map((r) => {
        if (r.type === 'rectangle' || r.type === 'ellipse') {
          return `${r.type}:${r.x},${r.y},${r.w},${r.h}`;
        }
        if (r.type === 'line') return `line:${r.x1},${r.y1},${r.x2},${r.y2}`;
        if (r.type === 'polygon' ||
            r.type === 'freehand' || r.type === 'freehandLine' ||
            r.type === 'point' || r.type === 'pointArrow') {
          return `${r.type}:${r.points.map((p) => `${p.x},${p.y}`).join('|')}`;
        }
        return (r as { type: string }).type;
      })
      .join(';');
  }, [rois]);

  const roiThresholdSignature = useMemo(() => {
    return rois
      .map((r) => {
        const t = (r as { threshold?: { min: number; max: number } }).threshold;
        return t ? `${t.min}-${t.max}` : '_';
      })
      .join(';');
  }, [rois]);

  const closedRoiCount = useMemo(
    () => rois.reduce((acc, r) => acc + (isClosedRoi(r) ? 1 : 0), 0),
    [rois],
  );

  const hasCustomRoiThreshold = useMemo(() => {
    return rois.some((r) => {
      if (!isClosedRoi(r)) return false;
      const t = (r as { threshold?: { min: number; max: number } }).threshold;
      return !!t && (t.min !== snapMin || t.max !== snapMax);
    });
  }, [rois, snapMin, snapMax]);

  const globalThresholdActive =
    !isBrightfield && snapshot != null && (snapshot.min > 0 || snapshot.max < 255);
  const thresholdActive = !isBrightfield && thresholdOverlayEnabled && (globalThresholdActive || hasCustomRoiThreshold);
  const hasRoiOutlines = rois.length > 0;

  useEffect(() => {
    if (!ready) return;
    const draw = () => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const colorSource = isBrightfield ? image.previewRgba : null;
      const needsPixelLoop = thresholdActive || gainActive;
      // For dehydrated images (no full gray buffer), apply gain via canvas
      // brightness filter on the high-quality previewBitmap instead of doing
      // a per-pixel loop on the low-res nearest-neighbor previewGray.
      const useGainFilter = gainActive && !thresholdActive && !image.gray && !!image.previewBitmap;

      // Fast path: bitmap draw (with optional brightness filter for dehydrated gain)
      if ((!needsPixelLoop || useGainFilter) && !hasRoiOutlines && image.previewBitmap && !colorSource) {
        const bitmap = image.previewBitmap;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (useGainFilter) {
          ctx.filter = `brightness(${gain})`;
        }
        ctx.drawImage(bitmap, 0, 0);
        return;
      }

      // Determine canvas dimensions and source data
      let canvasW: number;
      let canvasH: number;

      if (colorSource) {
        canvasW = colorSource.width;
        canvasH = colorSource.height;
      } else {
        const graySource = image.gray
          ? { w: image.width, h: image.height }
          : image.previewGray
            ? { w: image.previewGray.width, h: image.previewGray.height }
            : null;
        canvasW = graySource ? graySource.w : image.width;
        canvasH = graySource ? graySource.h : image.height;
      }

      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (colorSource) {
        // Brightfield color path: render RGBA with gain
        const imageData = ctx.createImageData(canvasW, canvasH);
        const src = colorSource.data;
        const dst = imageData.data;
        const pixelCount = canvasW * canvasH;
        if (gainActive) {
          for (let i = 0; i < pixelCount; i++) {
            const o = i * 4;
            const r = src[o] * gain;
            const g = src[o + 1] * gain;
            const b = src[o + 2] * gain;
            dst[o] = r < 0 ? 0 : r > 255 ? 255 : r;
            dst[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
            dst[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
            dst[o + 3] = src[o + 3];
          }
        } else {
          dst.set(src);
        }
        ctx.putImageData(imageData, 0, 0);
      } else {
        // Grayscale path
        const graySource = image.gray
          ? { data: image.gray.data, w: image.width, h: image.height }
          : image.previewGray
            ? { data: image.previewGray.data, w: image.previewGray.width, h: image.previewGray.height }
            : null;

        if (!graySource) {
          if (image.previewBitmap) {
            if (useGainFilter) ctx.filter = `brightness(${gain})`;
            ctx.drawImage(image.previewBitmap, 0, 0, canvasW, canvasH);
            if (useGainFilter) ctx.filter = 'none';
          }
        } else if ((!needsPixelLoop || useGainFilter) && image.previewBitmap) {
          if (useGainFilter) ctx.filter = `brightness(${gain})`;
          ctx.drawImage(image.previewBitmap, 0, 0, canvasW, canvasH);
          if (useGainFilter) ctx.filter = 'none';
        } else {
          const imageData = ctx.createImageData(canvasW, canvasH);
          const gray = graySource.data;
          const rgba = imageData.data;

          if (thresholdActive) {
            const mainMin = snapMin;
            const mainMax = snapMax;
            const mins = new Int32Array(rois.length);
            const maxs = new Int32Array(rois.length);
            const closed: boolean[] = rois.map((r) => isClosedRoi(r));
            for (let k = 0; k < rois.length; k++) {
              if (!closed[k]) continue;
              const t = (rois[k] as { threshold?: { min: number; max: number } }).threshold;
              mins[k] = t ? t.min : mainMin;
              maxs[k] = t ? t.max : mainMax;
            }

            let ownerMap: Uint16Array | null = null;
            if (closedRoiCount > 0) {
              const cacheKey = `${image.id}|${roiGeomSignature}|${canvasW}x${canvasH}`;
              const cached = ownerMapCacheRef.current;
              if (
                cached &&
                cached.key === cacheKey &&
                cached.width === canvasW &&
                cached.height === canvasH
              ) {
                ownerMap = cached.map;
              } else {
                const scaledRois = canvasW === image.width
                  ? rois
                  : scaleRoisForPreview(rois, image.width, image.height, canvasW, canvasH);
                ownerMap = buildRoiOwnerMap(scaledRois, canvasW, canvasH);
                ownerMapCacheRef.current = {
                  key: cacheKey,
                  map: ownerMap,
                  width: canvasW,
                  height: canvasH,
                };
              }
            }

            for (let i = 0; i < gray.length; i++) {
              const raw = gray[i];
              const gv = raw * gain;
              const cv = gv < 0 ? 0 : gv > 255 ? 255 : gv;
              const o = i * 4;
              let inRange = false;
              if (ownerMap) {
                const owner = ownerMap[i];
                if (owner === 0) {
                  inRange = raw >= mainMin && raw <= mainMax;
                } else {
                  const k = owner - 1;
                  inRange = raw >= mins[k] && raw <= maxs[k];
                }
              } else {
                inRange = raw >= mainMin && raw <= mainMax;
              }
              if (inRange) {
                rgba[o] = 239;
                rgba[o + 1] = 68;
                rgba[o + 2] = 68;
              } else {
                rgba[o] = cv;
                rgba[o + 1] = cv;
                rgba[o + 2] = cv;
              }
              rgba[o + 3] = 255;
            }
          } else {
            for (let i = 0; i < gray.length; i++) {
              const gv = gray[i] * gain;
              const cv = gv < 0 ? 0 : gv > 255 ? 255 : gv;
              const o = i * 4;
              rgba[o] = cv;
              rgba[o + 1] = cv;
              rgba[o + 2] = cv;
              rgba[o + 3] = 255;
            }
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }

      if (hasRoiOutlines) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const scaleX = canvasW / image.width;
        const scaleY = canvasH / image.height;
        const displayedWidth = canvas.clientWidth || canvas.getBoundingClientRect().width || 0;
        const outlineScale = displayedWidth > 0
          ? Math.max(displayedWidth / canvasW, 0.05)
          : 0.5;
        const selIdx = image.selectedRoiIndex;
        if (scaleX !== 1 || scaleY !== 1) {
          ctx.scale(scaleX, scaleY);
        }
        rois.forEach((r, i) => {
          const selected = i === selIdx;
          if (r.type === 'point') {
            drawPointMarkers(ctx, r.points, outlineScale / scaleX, selected);
            return;
          }
          if (r.type === 'pointArrow') {
            drawPointArrowMarkers(ctx, r.points, outlineScale / scaleX, selected);
            return;
          }
          drawShape(ctx, r, selected, outlineScale / scaleX);
        });
        ctx.restore();
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    image.id,
    image.previewBitmap,
    image.previewRgba,
    image.previewGray,
    image.gray,
    image.width,
    image.height,
    image.selectedRoiIndex,
    rois,
    roiGeomSignature,
    roiThresholdSignature,
    closedRoiCount,
    thresholdActive,
    hasRoiOutlines,
    snapMin,
    snapMax,
    gain,
    gainActive,
    isBrightfield,
    ready,
  ]);

  if (image.status === 'loading') {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 dark:bg-slate-900">
        <Loader2 size={20} className="animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    );
  }
  if (image.status === 'error') {
    return (
      <div
        title={image.decodeError ?? 'Failed to decode'}
        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300"
      >
        <AlertTriangle size={20} />
        <span className="px-2 text-[10px]">Decode failed</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="block h-auto w-full bg-slate-900"
        style={{ imageRendering: 'auto' }}
      />
      {gainActive && (
        <span className="pointer-events-none absolute left-1 top-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm ring-1 ring-white/10">
          {gain.toFixed(2)}x
        </span>
      )}
    </div>
  );
}
