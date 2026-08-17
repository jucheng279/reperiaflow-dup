import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleSlash, Download, Eye, EyeOff, Focus, Loader2 } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import {
  activeThresholdRange,
  selectedRoi,
} from '../domain/session/sessionTypes';
import {
  grayToImageDataWithGain,
  rgbaToImageDataWithGain,
} from '../domain/image/decode';
import {
  DISPLAY_GAIN_DEFAULT,
  DISPLAY_GAIN_MAX,
  DISPLAY_GAIN_MIN,
} from '../domain/session/sessionStore';
import type { Point, RoiShape } from '../domain/roi/roiTypes';
import { isClosedRoi } from '../domain/roi/roiTypes';
import { pickRoiAt } from '../domain/roi/roiHitTest';
import { buildRoiOwnerMap } from '../domain/roi/roiOwnerMap';
import { drawShape, drawOpenLine, drawPointMarkers, drawPointArrowMarkers } from './roiDraw';
import { calibrationFromLine, isCalibrated, type Calibration } from '../domain/image/calibration';
import { applyThresholdWheel } from '../domain/threshold/thresholdTypes';
import { exportCompositeImage } from '../utils/exportImage';
import { detectHotspot } from '../domain/image/hotspotDetect';
import { animateView } from '../utils/animateView';

interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

type EditTarget =
  | { kind: 'rect-corner'; corner: 0 | 1 | 2 | 3 }
  | { kind: 'ellipse-corner'; corner: 0 | 1 | 2 | 3 }
  | { kind: 'vertex'; index: number }
  | { kind: 'line-end'; which: 1 | 2 };

interface ScalePrompt {
  pixelLength: number;
  line: { x1: number; y1: number; x2: number; y2: number };
}

export function ImageViewer() {
  const active = useSessionStore((s) => s.images[s.activeIndex] ?? null);
  const overlayOpacity = useSessionStore((s) => s.overlayOpacity);
  const thresholdOverlayEnabled = useSessionStore((s) => s.thresholdOverlayEnabled);
  const toggleThresholdOverlayEnabled = useSessionStore((s) => s.toggleThresholdOverlayEnabled);
  const activeTool = useSessionStore((s) => s.activeTool);
  const addRoi = useSessionStore((s) => s.addRoi);
  const addPointClick = useSessionStore((s) => s.addPointClick);
  const updateSelectedRoi = useSessionStore((s) => s.updateSelectedRoi);
  const setSelectedRoiIndex = useSessionStore((s) => s.setSelectedRoiIndex);
  const toggleSelectedRoiIndex = useSessionStore((s) => s.toggleSelectedRoiIndex);
  const setActiveTool = useSessionStore((s) => s.setActiveTool);
  const setCalibration = useSessionStore((s) => s.setCalibration);
  const setCalibrationForAll = useSessionStore((s) => s.setCalibrationForAll);
  const pendingScalePrompt = useSessionStore((s) => s.pendingScalePrompt);
  const clearScalePrompt = useSessionStore((s) => s.clearScalePrompt);
  const thresholdRange = useSessionStore((s) => s.threshold);
  const updateThreshold = useSessionStore((s) => s.updateThreshold);
  const thresholdScrollTarget = useSessionStore((s) => s.thresholdScrollTarget);
  const setImageDisplayGain = useSessionStore((s) => s.setImageDisplayGain);
  const resetImageDisplayGain = useSessionStore((s) => s.resetImageDisplayGain);
  const inheritDisplayGainFromPrevious = useSessionStore(
    (s) => s.inheritDisplayGainFromPrevious,
  );
  const applyDisplayGainToAll = useSessionStore((s) => s.applyDisplayGainToAll);
  const images = useSessionStore((s) => s.images);
  const previousImage = useSessionStore((s) =>
    s.previousImageId ? s.images.find((i) => i.id === s.previousImageId) ?? null : null,
  );
  const displayGain = active?.displayGain ?? DISPLAY_GAIN_DEFAULT;
  const previousGainValue =
    previousImage && previousImage.id !== active?.id
      ? previousImage.displayGain ?? DISPLAY_GAIN_DEFAULT
      : null;
  const canInheritPrevious =
    previousGainValue !== null && previousGainValue !== displayGain;
  const canApplyAll = images.some(
    (img) =>
      img.status !== 'skipped' &&
      img.id !== active?.id &&
      (img.displayGain ?? DISPLAY_GAIN_DEFAULT) !== displayGain,
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const overlayUpgradeRafRef = useRef<number | null>(null);
  const overlayUpgradeTimerRef = useRef<number | null>(null);
  const overlayLastFactorRef = useRef<1 | 2 | 4>(1);
  const overlayScratchRef = useRef<HTMLCanvasElement | null>(null);
  const tuningLoggedRef = useRef<string | null>(null);
  const ownerMapCacheRef = useRef<{
    key: string;
    map: Uint16Array;
    width: number;
    height: number;
  } | null>(null);
  const prevOverlayInputsRef = useRef<{
    activeId: string | null;
    mainMin: number;
    mainMax: number;
    geom: string;
    thresholds: string;
  } | null>(null);

  const [view, setView] = useState<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const viewRef = useRef<ViewState>(view);
  viewRef.current = view;
  const activeIdRef = useRef<string | null>(null);
  const [draft, setDraft] = useState<RoiShape | null>(null);
  const [scalePrompt, setScalePrompt] = useState<ScalePrompt | null>(null);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dpr, setDpr] = useState<number>(
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  );
  const dragStart = useRef<Point | null>(null);
  const isDrawingMulti = useRef(false);
  const editing = useRef<EditTarget | null>(null);
  const scaleDraft = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const userAdjustedView = useRef(false);
  const pendingPickRef = useRef<{
    roiIndex: number;
    clientX: number;
    clientY: number;
    imagePoint: Point;
  } | null>(null);

  const hydrateImage = useSessionStore((s) => s.hydrateImage);
  const autoZoomEnabled = useSessionStore((s) => s.autoZoomEnabled);
  const toggleAutoZoom = useSessionStore((s) => s.toggleAutoZoom);
  const imagingMode = useSessionStore((s) => s.imagingMode);
  const isBrightfield = imagingMode === 'brightfield';
  const needsHydration = active !== null && active.hydrated === false;
  const autoZoomCancelRef = useRef<(() => void) | null>(null);
  const autoZoomDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoZoomAppliedForId = useRef<string | null>(null);

  useEffect(() => {
    if (active && needsHydration) {
      hydrateImage(active.id);
    }
  }, [active?.id, needsHydration, hydrateImage]);

  // Signature that captures only ROI geometry (shape + coordinates). Used to
  // invalidate the cached owner map when ROIs change but keep it stable when
  // only per-ROI thresholds change.
  const roiGeomSignature = useMemo(() => {
    if (!active) return '';
    return active.rois
      .map((r) => {
        if (r.type === 'rectangle' || r.type === 'ellipse') {
          return `${r.type}:${r.x},${r.y},${r.w},${r.h}`;
        }
        if (r.type === 'polygon' || r.type === 'freehand') {
          return `${r.type}:${r.points.map((p) => `${p.x},${p.y}`).join(';')}`;
        }
        return `${r.type}`;
      })
      .join('|');
  }, [active]);

  // Signature for per-ROI thresholds. Used only for overlay repaint deps.
  const roiThresholdSignature = useMemo(() => {
    if (!active) return '';
    return active.rois
      .map((r) => {
        if (isClosedRoi(r)) {
          const t = (r as { threshold?: { min: number; max: number } }).threshold;
          return t ? `${t.min}-${t.max}` : 'x';
        }
        return '.';
      })
      .join(',');
  }, [active]);

  useEffect(() => {
    const c = baseRef.current;
    if (!c || !active || !active.gray) return;
    c.width = active.width;
    c.height = active.height;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (isBrightfield && active.rgba) {
      ctx.putImageData(rgbaToImageDataWithGain(active.rgba, displayGain), 0, 0);
    } else {
      ctx.putImageData(grayToImageDataWithGain(active.gray, displayGain), 0, 0);
    }
  }, [
    active?.id,
    active?.width,
    active?.height,
    active?.gray,
    active?.rgba,
    isBrightfield,
    displayGain,
  ]);

  // Paint the threshold overlay synchronously on the main thread inside a
  // single rAF, matching the sidebar preview's proven strategy. The sidebar
  // has never frozen during held arrow keys or rapid clicks because it has
  // no worker round-trip, no in-flight gate, no paint cache, no drag-state
  // coupling, and no commit debounce. We use the same path here so the
  // central viewer can't stall for any of those reasons either.
  useEffect(() => {
    if (!active || !active.gray) return;
    const c = overlayRef.current;
    if (!c) return;
    const cancelUpgrade = () => {
      if (overlayUpgradeTimerRef.current !== null) {
        clearTimeout(overlayUpgradeTimerRef.current);
        overlayUpgradeTimerRef.current = null;
      }
      if (overlayUpgradeRafRef.current !== null) {
        cancelAnimationFrame(overlayUpgradeRafRef.current);
        overlayUpgradeRafRef.current = null;
      }
    };
    if (isBrightfield) {
      if (overlayRafRef.current !== null) {
        cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
      cancelUpgrade();
      if (c.width !== active.width) c.width = active.width;
      if (c.height !== active.height) c.height = active.height;
      const ctx = c.getContext('2d');
      ctx?.clearRect(0, 0, c.width, c.height);
      return;
    }
    // Pass A: fast, size-gated factor. Pass B: full-res upgrade scheduled
    // ~150 ms after the last threshold change, cancelled on any new
    // activity. Activity is detected purely via prop changes (no drag or
    // key flag is read inside the effect), which is what keeps the
    // first-drag stall and key-hold stutter from returning.
    const UPGRADE_DEBOUNCE_MS = 150;
    // Per-ROI threshold arrays. If any closed ROI has its own threshold (all
    // do once drawn, since addRoi seeds them), we paint the overlay via a
    // per-pixel owner lookup so each ROI's region respects its own range.
    const rois = active.rois;
    const closedOwners: boolean[] = rois.map((r) => isClosedRoi(r));
    const anyClosed = closedOwners.some(Boolean);
    const mainMin = thresholdRange.min;
    const mainMax = thresholdRange.max;
    let ownerMap: Uint16Array | null = null;
    const mins = new Int32Array(rois.length);
    const maxs = new Int32Array(rois.length);
    for (let k = 0; k < rois.length; k++) {
      if (!closedOwners[k]) continue;
      const t = (rois[k] as { threshold?: { min: number; max: number } }).threshold;
      mins[k] = t ? t.min : mainMin;
      maxs[k] = t ? t.max : mainMax;
    }
    if (anyClosed) {
      const cacheKey = `${active.id}|${roiGeomSignature}`;
      const cached = ownerMapCacheRef.current;
      if (
        cached &&
        cached.key === cacheKey &&
        cached.width === active.width &&
        cached.height === active.height
      ) {
        ownerMap = cached.map;
      } else {
        ownerMap = buildRoiOwnerMap(rois, active.width, active.height);
        ownerMapCacheRef.current = {
          key: cacheKey,
          map: ownerMap,
          width: active.width,
          height: active.height,
        };
      }
    }
    const drawAt = (factor: 1 | 2 | 4, isUpgrade: boolean) => {
      if (!active.gray) return;
      if (c.width !== active.width) c.width = active.width;
      if (c.height !== active.height) c.height = active.height;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const gray = active.gray.data;
      const w = active.width;
      const h = active.height;
      const pixels = w * h;
      const t0 = performance.now();
      const selectPixel = (i: number, v: number): boolean => {
        if (ownerMap) {
          const owner = ownerMap[i];
          if (owner === 0) return v >= mainMin && v <= mainMax;
          const k = owner - 1;
          return v >= mins[k] && v <= maxs[k];
        }
        return v >= mainMin && v <= mainMax;
      };
      if (factor === 1) {
        const imageData = ctx.createImageData(w, h);
        const rgba = imageData.data;
        for (let i = 0; i < gray.length; i++) {
          const v = gray[i];
          if (selectPixel(i, v)) {
            const o = i * 4;
            rgba[o] = 239;
            rgba[o + 1] = 68;
            rgba[o + 2] = 68;
            rgba[o + 3] = 255;
          }
        }
        ctx.putImageData(imageData, 0, 0);
      } else {
        const sw = Math.ceil(w / factor);
        const sh = Math.ceil(h / factor);
        const small = new ImageData(sw, sh);
        const rgba = small.data;
        for (let sy = 0; sy < sh; sy++) {
          const y = sy * factor;
          const rowStart = y * w;
          const outRowStart = sy * sw * 4;
          for (let sx = 0; sx < sw; sx++) {
            const srcIdx = rowStart + sx * factor;
            const v = gray[srcIdx];
            if (selectPixel(srcIdx, v)) {
              const o = outRowStart + sx * 4;
              rgba[o] = 239;
              rgba[o + 1] = 68;
              rgba[o + 2] = 68;
              rgba[o + 3] = 255;
            }
          }
        }
        const scratch = overlayScratchRef.current ?? document.createElement('canvas');
        overlayScratchRef.current = scratch;
        if (scratch.width !== sw) scratch.width = sw;
        if (scratch.height !== sh) scratch.height = sh;
        const sctx = scratch.getContext('2d');
        if (!sctx) return;
        sctx.putImageData(small, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scratch, 0, 0, sw, sh, 0, 0, w, h);
      }
      if (import.meta.env.DEV && (isUpgrade || tuningLoggedRef.current !== active.id)) {
        if (!isUpgrade) tuningLoggedRef.current = active.id;
        console.debug(
          '[threshold overlay]%s pixels=%d factor=%d fill=%sms',
          isUpgrade ? ' upgrade' : '',
          pixels,
          factor,
          (performance.now() - t0).toFixed(2),
        );
      }
    };
    const prev = prevOverlayInputsRef.current;
    const imageSwitched = !prev || prev.activeId !== active.id;
    const geomChanged = !!prev && prev.geom !== roiGeomSignature;
    const thresholdChanged =
      !!prev &&
      (prev.mainMin !== mainMin ||
        prev.mainMax !== mainMax ||
        prev.thresholds !== roiThresholdSignature);
    const useDownsamplePath = imageSwitched || (thresholdChanged && !geomChanged);
    prevOverlayInputsRef.current = {
      activeId: active.id,
      mainMin,
      mainMax,
      geom: roiGeomSignature,
      thresholds: roiThresholdSignature,
    };
    const draw = () => {
      overlayRafRef.current = null;
      const w = active.width;
      const h = active.height;
      const pixels = w * h;
      // Budget ~2 MP at full res; scale down by factor^2 above that. Capped
      // at 4 so the overlay stays crisp rather than chunky.
      const BUDGET = 2_000_000;
      const sizeFactor: 1 | 2 | 4 = pixels <= BUDGET ? 1 : pixels <= BUDGET * 4 ? 2 : 4;
      const factor: 1 | 2 | 4 = useDownsamplePath ? sizeFactor : 1;
      overlayLastFactorRef.current = factor;
      drawAt(factor, false);
      cancelUpgrade();
      if (factor !== 1) {
        overlayUpgradeTimerRef.current = window.setTimeout(() => {
          overlayUpgradeTimerRef.current = null;
          overlayUpgradeRafRef.current = requestAnimationFrame(() => {
            overlayUpgradeRafRef.current = null;
            drawAt(1, true);
          });
        }, UPGRADE_DEBOUNCE_MS);
      }
    };
    if (overlayRafRef.current !== null) cancelAnimationFrame(overlayRafRef.current);
    overlayRafRef.current = requestAnimationFrame(draw);
    return () => {
      if (overlayRafRef.current !== null) {
        cancelAnimationFrame(overlayRafRef.current);
        overlayRafRef.current = null;
      }
      cancelUpgrade();
    };
  }, [
    active?.id,
    active?.width,
    active?.height,
    active?.gray,
    thresholdRange.min,
    thresholdRange.max,
    isBrightfield,
    roiGeomSignature,
    roiThresholdSignature,
  ]);

  useLayoutEffect(() => {
    if (!active) return;
    // Cancel animations/timers synchronously before browser can fire pending rAFs
    if (autoZoomCancelRef.current) { autoZoomCancelRef.current(); autoZoomCancelRef.current = null; }
    if (autoZoomDelayRef.current) { clearTimeout(autoZoomDelayRef.current); autoZoomDelayRef.current = null; }
    autoZoomAppliedForId.current = null;
    activeIdRef.current = active.id;
    userAdjustedView.current = false;
    setDraft(null);
    isDrawingMulti.current = false;
    editing.current = null;
    scaleDraft.current = null;
    pendingPickRef.current = null;
    setScalePrompt(null);
    setOverlayHidden(false);

    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    setWrapSize((prev) =>
      prev.w === rect.width && prev.h === rect.height
        ? prev
        : { w: rect.width, h: rect.height },
    );
    const scale = Math.min(rect.width / active.width, rect.height / active.height, 1) * 0.95;
    const offsetX = (rect.width - active.width * scale) / 2;
    const offsetY = (rect.height - active.height * scale) / 2;
    setView({ scale, offsetX, offsetY });
  }, [active?.id, needsHydration]);

  useEffect(() => {
    if (!active || !active.gray || isBrightfield || !autoZoomEnabled) return;
    if (autoZoomAppliedForId.current === active.id) return;
    const imageId = active.id;
    const grayData = active.gray.data;
    const imgW = active.width;
    const imgH = active.height;

    const timer = setTimeout(() => {
      autoZoomDelayRef.current = null;
      if (autoZoomAppliedForId.current === imageId) return;
      autoZoomAppliedForId.current = imageId;
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const hotspot = detectHotspot(grayData, imgW, imgH);
      if (!hotspot) return;
      const fromView = viewRef.current;
      const targetScale = Math.min(
        rect.width / hotspot.width,
        rect.height / hotspot.height,
      ) * 0.9;
      const toView = {
        scale: targetScale,
        offsetX: rect.width / 2 - (hotspot.x + hotspot.width / 2) * targetScale,
        offsetY: rect.height / 2 - (hotspot.y + hotspot.height / 2) * targetScale,
      };
      if (autoZoomCancelRef.current) autoZoomCancelRef.current();
      autoZoomCancelRef.current = animateView(fromView, toView, 400, (v) => {
        if (activeIdRef.current !== imageId) return;
        setView(v);
      });
      userAdjustedView.current = true;
    }, 500);

    autoZoomDelayRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (autoZoomDelayRef.current === timer) autoZoomDelayRef.current = null;
    };
  }, [active?.id, active?.gray, isBrightfield, autoZoomEnabled]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.scale === 'number') {
        userAdjustedView.current = true;
        setView(detail);
      }
    };
    window.addEventListener('autozoom-frame', handler);
    return () => window.removeEventListener('autozoom-frame', handler);
  }, []);

  useEffect(() => {
    if (!active) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const rect = wrap.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        setWrapSize((prev) =>
          prev.w === rect.width && prev.h === rect.height
            ? prev
            : { w: rect.width, h: rect.height },
        );
        if (userAdjustedView.current) return;
        const scale = Math.min(rect.width / active.width, rect.height / active.height, 1) * 0.95;
        const offsetX = (rect.width - active.width * scale) / 2;
        const offsetY = (rect.height - active.height * scale) / 2;
        setView({ scale, offsetX, offsetY });
      });
    });
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [active?.id, active?.width, active?.height]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mql: MediaQueryList | null = null;
    const listen = () => {
      const next = window.devicePixelRatio || 1;
      setDpr(next);
      mql = window.matchMedia(`(resolution: ${next}dppx)`);
      mql.addEventListener('change', listen, { once: true });
    };
    listen();
    return () => {
      mql?.removeEventListener('change', listen);
    };
  }, []);

  useEffect(() => {
    const clearDrag = () => {
      dragStart.current = null;
    };
    window.addEventListener('pointercancel', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      window.removeEventListener('pointercancel', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, []);

  useEffect(() => {
    if (!overlayHidden) return;
    const release = () => setOverlayHidden(false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', release);
    };
  }, [overlayHidden]);

  useEffect(() => {
    if (isBrightfield) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== 'h' && e.key !== 'H') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setOverlayHidden(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'h' && e.key !== 'H') return;
      setOverlayHidden(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isBrightfield]);

  useEffect(() => {
    if (!pendingScalePrompt || !active) return;
    if (pendingScalePrompt.imageId !== active.id) return;
    setScalePrompt({
      pixelLength: pendingScalePrompt.pixelLength,
      line: { x1: 0, y1: 0, x2: 0, y2: 0 },
    });
  }, [pendingScalePrompt, active?.id]);

  useEffect(() => {
    const c = drawRef.current;
    if (!c || !active) return;
    const wrap = wrapRef.current;
    const cssW = wrapSize.w || wrap?.clientWidth || 0;
    const cssH = wrapSize.h || wrap?.clientHeight || 0;
    if (cssW === 0 || cssH === 0) return;
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));
    if (c.width !== pxW) c.width = pxW;
    if (c.height !== pxH) c.height = pxH;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(
      dpr * view.scale,
      0,
      0,
      dpr * view.scale,
      dpr * view.offsetX,
      dpr * view.offsetY,
    );
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const selIdx = active.selectedRoiIndex;
    active.rois.forEach((r, i) => {
      if (i === selIdx && !draft) return;
      if (r.type === 'point') {
        drawPointMarkers(ctx, r.points, view.scale, false);
        return;
      }
      if (r.type === 'pointArrow') {
        drawPointArrowMarkers(ctx, r.points, view.scale, false);
        return;
      }
      drawShape(ctx, r, false, view.scale);
    });
    const selected = draft ?? (selIdx >= 0 ? active.rois[selIdx] : null);
    if (selected) {
      if (selected.type === 'point') {
        drawPointMarkers(ctx, selected.points, view.scale, true);
      } else if (selected.type === 'pointArrow') {
        drawPointArrowMarkers(ctx, selected.points, view.scale, true);
      } else {
        drawShape(ctx, selected, true, view.scale);
        if (!draft) drawHandles(ctx, selected, view.scale);
      }
    }
    if (scaleDraft.current) {
      const { x1, y1, x2, y2 } = scaleDraft.current;
      drawOpenLine(ctx, [{ x: x1, y: y1 }, { x: x2, y: y2 }], view.scale, '#f59e0b');
    }
  }, [
    active,
    active?.rois,
    active?.selectedRoiIndex,
    draft,
    view.scale,
    view.offsetX,
    view.offsetY,
    wrapSize.w,
    wrapSize.h,
    dpr,
  ]);

  const wheelActiveRange = activeThresholdRange(active, thresholdRange);
  const rangeRef = useRef(wheelActiveRange);
  const scrollTargetRef = useRef(thresholdScrollTarget);
  rangeRef.current = wheelActiveRange;
  scrollTargetRef.current = thresholdScrollTarget;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!active) return;
      if (e.shiftKey || e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        const factor = delta < 0 ? 1.1 : 0.9;
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        userAdjustedView.current = true;
        if (autoZoomDelayRef.current) { clearTimeout(autoZoomDelayRef.current); autoZoomDelayRef.current = null; }
        if (autoZoomCancelRef.current) { autoZoomCancelRef.current(); autoZoomCancelRef.current = null; }
        setView((prev) => {
          const newScale = Math.min(20, Math.max(0.05, prev.scale * factor));
          const ix = (mx - prev.offsetX) / prev.scale;
          const iy = (my - prev.offsetY) / prev.scale;
          return {
            scale: newScale,
            offsetX: mx - ix * newScale,
            offsetY: my - iy * newScale,
          };
        });
        return;
      }
      if (isBrightfield) return;
      e.preventDefault();
      const next = applyThresholdWheel(
        e.deltaY,
        false,
        scrollTargetRef.current,
        rangeRef.current,
      );
      if (next) updateThreshold(next);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [active, isBrightfield, updateThreshold]);

  const toImage = (clientX: number, clientY: number): Point => {
    const wrap = wrapRef.current!;
    const rect = wrap.getBoundingClientRect();
    const x = (clientX - rect.left - view.offsetX) / view.scale;
    const y = (clientY - rect.top - view.offsetY) / view.scale;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active) return;
    if (e.button === 1 || e.shiftKey) {
      if (autoZoomDelayRef.current) { clearTimeout(autoZoomDelayRef.current); autoZoomDelayRef.current = null; }
      if (autoZoomCancelRef.current) { autoZoomCancelRef.current(); autoZoomCancelRef.current = null; }
      dragStart.current = { x: e.clientX - view.offsetX, y: e.clientY - view.offsetY };
      const captureTarget = wrapRef.current ?? (e.target as Element);
      try {
        captureTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore if capture cannot be acquired
      }
      return;
    }
    const p = toImage(e.clientX, e.clientY);

    if (activeTool === 'setScale') {
      scaleDraft.current = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'point') {
      addPointClick(p, 'point');
      return;
    }

    if (activeTool === 'pointArrow') {
      addPointClick(p, 'pointArrow');
      return;
    }

    if (!isDrawingMulti.current) {
      const current = selectedRoi(active);
      if (current) {
        const hit = hitTestHandle(current, p, 10 / view.scale);
        if (hit) {
          editing.current = hit;
          (e.target as Element).setPointerCapture(e.pointerId);
          return;
        }
      }
      const pickedIdx = pickRoiAt(active.rois, p, 6 / view.scale);
      if (pickedIdx >= 0) {
        pendingPickRef.current = {
          roiIndex: pickedIdx,
          clientX: e.clientX,
          clientY: e.clientY,
          imagePoint: p,
        };
        (e.target as Element).setPointerCapture(e.pointerId);
        return;
      }
    }

    switch (activeTool) {
      case 'rectangle':
        setDraft({ type: 'rectangle', x: p.x, y: p.y, w: 0, h: 0 });
        (e.target as Element).setPointerCapture(e.pointerId);
        break;
      case 'ellipse':
        setDraft({ type: 'ellipse', x: p.x, y: p.y, w: 0, h: 0 });
        (e.target as Element).setPointerCapture(e.pointerId);
        break;
      case 'freehand':
        setDraft({ type: 'freehand', points: [p] });
        (e.target as Element).setPointerCapture(e.pointerId);
        break;
      case 'freehandLine':
        setDraft({ type: 'freehandLine', points: [p] });
        (e.target as Element).setPointerCapture(e.pointerId);
        break;
      case 'line':
        setDraft({ type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        (e.target as Element).setPointerCapture(e.pointerId);
        break;
      case 'polygon':
        if (!isDrawingMulti.current) {
          isDrawingMulti.current = true;
          setDraft({ type: 'polygon', points: [p, p], closed: false });
        } else {
          setDraft((d) => {
            if (!d || d.type !== 'polygon') return d;
            return { ...d, points: [...d.points.slice(0, -1), p, p] };
          });
        }
        break;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!active) return;
    if (dragStart.current) {
      // Snapshot the drag origin into locals. React may defer this setView
      // updater past pointerup, which clears dragStart.current; reading the
      // ref inside the updater would throw and blank the app.
      const originX = dragStart.current.x;
      const originY = dragStart.current.y;
      const { clientX, clientY } = e;
      userAdjustedView.current = true;
      setView((v) => ({
        ...v,
        offsetX: clientX - originX,
        offsetY: clientY - originY,
      }));
      return;
    }

    if (pendingPickRef.current) {
      const dx = e.clientX - pendingPickRef.current.clientX;
      const dy = e.clientY - pendingPickRef.current.clientY;
      const DRAG_THRESHOLD = 4;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        const origin = pendingPickRef.current.imagePoint;
        pendingPickRef.current = null;
        switch (activeTool) {
          case 'rectangle':
            setDraft({ type: 'rectangle', x: origin.x, y: origin.y, w: 0, h: 0 });
            break;
          case 'ellipse':
            setDraft({ type: 'ellipse', x: origin.x, y: origin.y, w: 0, h: 0 });
            break;
          case 'freehand':
            setDraft({ type: 'freehand', points: [origin] });
            break;
          case 'freehandLine':
            setDraft({ type: 'freehandLine', points: [origin] });
            break;
          case 'line':
            setDraft({ type: 'line', x1: origin.x, y1: origin.y, x2: origin.x, y2: origin.y });
            break;
          default:
            break;
        }
      }
      return;
    }

    const p = toImage(e.clientX, e.clientY);

    if (scaleDraft.current) {
      scaleDraft.current = { ...scaleDraft.current, x2: p.x, y2: p.y };
      // Force a redraw.
      setView((v) => ({ ...v }));
      return;
    }

    if (editing.current) {
      const current = selectedRoi(active);
      if (current) {
        const next = applyHandleDrag(current, editing.current, p);
        if (next) updateSelectedRoi(next);
      }
      return;
    }

    setDraft((d) => {
      if (!d) return d;
      if (d.type === 'rectangle' || d.type === 'ellipse') {
        return { ...d, w: p.x - d.x, h: p.y - d.y };
      }
      if (d.type === 'freehand' || d.type === 'freehandLine') {
        return { ...d, points: [...d.points, p] };
      }
      if (d.type === 'line') {
        return { ...d, x2: p.x, y2: p.y };
      }
      if (d.type === 'polygon' && isDrawingMulti.current) {
        return { ...d, points: [...d.points.slice(0, -1), p] };
      }
      return d;
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStart.current) {
      dragStart.current = null;
      const captureTarget = wrapRef.current ?? (e.target as Element);
      try {
        captureTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // ignore if capture was never acquired
      }
      return;
    }
    if (pendingPickRef.current) {
      const pickedIdx = pendingPickRef.current.roiIndex;
      pendingPickRef.current = null;
      if (pickedIdx === active?.selectedRoiIndex) {
        toggleSelectedRoiIndex(pickedIdx);
      } else {
        setSelectedRoiIndex(pickedIdx);
      }
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      return;
    }
    if (scaleDraft.current) {
      const { x1, y1, x2, y2 } = scaleDraft.current;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const pixelLength = Math.sqrt(dx * dx + dy * dy);
      if (pixelLength >= 3) {
        setScalePrompt({ pixelLength, line: { x1, y1, x2, y2 } });
      } else {
        scaleDraft.current = null;
      }
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      return;
    }
    if (editing.current) {
      editing.current = null;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      return;
    }
    if (!active || !draft) return;
    if (draft.type === 'polygon') return;
    if (draft.type === 'rectangle' || draft.type === 'ellipse') {
      if (Math.abs(draft.w) < 2 || Math.abs(draft.h) < 2) {
        setDraft(null);
        return;
      }
    }
    if (draft.type === 'freehand' && draft.points.length < 3) {
      setDraft(null);
      return;
    }
    if (draft.type === 'freehandLine' && draft.points.length < 2) {
      setDraft(null);
      return;
    }
    if (draft.type === 'line') {
      const dx = draft.x2 - draft.x1;
      const dy = draft.y2 - draft.y1;
      if (Math.sqrt(dx * dx + dy * dy) < 2) {
        setDraft(null);
        return;
      }
    }
    addRoi(draft);
    setDraft(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const onDoubleClick = () => {
    if (draft?.type === 'polygon' && isDrawingMulti.current) {
      const pts = draft.points.slice(0, -1);
      if (pts.length >= 3) addRoi({ type: 'polygon', points: pts, closed: true });
      setDraft(null);
      isDrawingMulti.current = false;
    }
  };

  const onScaleSubmit = (knownLength: number, unit: string, applyToAll: boolean) => {
    if (!active || !scalePrompt) return;
    const calibration = calibrationFromLine(scalePrompt.pixelLength, knownLength, unit);
    if (applyToAll) {
      setCalibrationForAll(calibration);
    } else {
      setCalibration(active.id, calibration);
    }
    const fromReuse = pendingScalePrompt !== null;
    scaleDraft.current = null;
    setScalePrompt(null);
    clearScalePrompt();
    if (!fromReuse) setActiveTool('rectangle');
  };

  const onScaleCancel = () => {
    scaleDraft.current = null;
    setScalePrompt(null);
    clearScalePrompt();
  };

  const handleExport = useCallback(() => {
    if (!active || !baseRef.current || !overlayRef.current) return;
    const overlayShowing = !isBrightfield && thresholdOverlayEnabled && !overlayHidden;
    exportCompositeImage({
      baseCanvas: baseRef.current,
      overlayCanvas: overlayRef.current,
      rois: active.rois,
      selectedRoiIndex: active.selectedRoiIndex,
      width: active.width,
      height: active.height,
      overlayVisible: overlayShowing,
      overlayOpacity,
      fileName: active.fileName,
    });
  }, [active, isBrightfield, thresholdOverlayEnabled, overlayHidden, overlayOpacity]);

  const canvasStyle = useMemo(
    () => ({
      transform: `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`,
      transformOrigin: '0 0',
      imageRendering: 'pixelated' as const,
    }),
    [view],
  );

  if (!active) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-500 dark:text-slate-400">
        No image selected
      </div>
    );
  }

  if (needsHydration) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Loading image data...</span>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      data-image-viewer
      className="theme-transition relative h-full w-full overflow-hidden bg-slate-100 dark:bg-slate-900"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{ touchAction: 'none', cursor: dragStart.current ? 'grabbing' : 'crosshair' }}
    >
      <canvas ref={baseRef} className="absolute left-0 top-0" style={canvasStyle} />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute left-0 top-0 transition-opacity duration-150"
        style={{
          ...canvasStyle,
          opacity: isBrightfield || !thresholdOverlayEnabled || overlayHidden ? 0 : overlayOpacity,
        }}
      />
      <canvas
        ref={drawRef}
        className="pointer-events-none absolute inset-0"
        style={{ width: '100%', height: '100%' }}
      />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/80 px-2 py-1 text-xs text-slate-100 shadow-sm dark:bg-black/60 dark:text-slate-200">
        {active.width}x{active.height} | zoom {view.scale.toFixed(2)}x | {imagingMode}
        {isBrightfield ? ' (no threshold)' : ''}
      </div>
      <DisplayGainControl
        value={displayGain}
        onChange={(g) => setImageDisplayGain(active.id, g)}
        onReset={() => resetImageDisplayGain(active.id)}
        canInheritPrevious={canInheritPrevious}
        previousGainValue={previousGainValue}
        onInheritPrevious={() => inheritDisplayGainFromPrevious(active.id)}
        canApplyAll={canApplyAll}
        onApplyAll={() => applyDisplayGainToAll(displayGain)}
      />
      {!isBrightfield && (
        <button
          type="button"
          aria-label="Press and hold to hide threshold overlay"
          title="Press and hold (or hold H) to preview without threshold"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            setOverlayHidden(true);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
            setOverlayHidden(false);
          }}
          onPointerCancel={() => setOverlayHidden(false)}
          onPointerLeave={() => setOverlayHidden(false)}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className={`absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-all duration-150 select-none ${
            overlayHidden
              ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-50 scale-95'
              : 'border-slate-300/70 bg-white/85 text-slate-700 hover:bg-white hover:text-slate-900 dark:border-slate-600/60 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
          style={{ touchAction: 'none' }}
        >
          {overlayHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
      {!isBrightfield && (
        <button
          type="button"
          aria-label="Toggle threshold overlay on all images"
          title={thresholdOverlayEnabled ? 'Hide threshold overlay on all images' : 'Show threshold overlay on all images'}
          onClick={(e) => {
            e.stopPropagation();
            toggleThresholdOverlayEnabled();
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={`absolute right-1 top-9 inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-all duration-150 select-none ${
            !thresholdOverlayEnabled
              ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-50 scale-95'
              : 'border-slate-300/70 bg-white/85 text-slate-700 hover:bg-white hover:text-slate-900 dark:border-slate-600/60 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          {thresholdOverlayEnabled ? <Circle className="h-4 w-4" /> : <CircleSlash className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        aria-label="Export image as PNG"
        title="Export current view as PNG"
        onClick={(e) => {
          e.stopPropagation();
          handleExport();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={`absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-all duration-150 select-none border-slate-300/70 bg-white/85 text-slate-700 hover:bg-white hover:text-slate-900 dark:border-slate-600/60 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800 ${
          isBrightfield ? 'top-1' : 'top-[4.25rem]'
        }`}
      >
        <Download className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={autoZoomEnabled ? 'Auto-zoom is ON (click to disable)' : 'Auto-zoom is OFF (click to enable)'}
        title={`Auto-zoom to bright region ${autoZoomEnabled ? 'ON' : 'OFF'} (Z)`}
        onClick={(e) => {
          e.stopPropagation();
          toggleAutoZoom();
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={`absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur-sm transition-all duration-150 select-none ${
          isBrightfield ? 'top-9' : 'top-[6.25rem]'
        } ${
          autoZoomEnabled
            ? 'border-slate-300/70 bg-white/85 text-slate-700 hover:bg-white hover:text-slate-900 dark:border-slate-600/60 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800'
            : 'border-cyan-400/60 bg-cyan-500/20 text-cyan-50 scale-95'
        }`}
      >
        <Focus className="h-4 w-4" />
      </button>
      {scalePrompt && (
        <SetScaleDialog
          pixelLength={scalePrompt.pixelLength}
          onSubmit={onScaleSubmit}
          onCancel={onScaleCancel}
          showApplyAll={images.length > 1}
          existingCalibration={active?.calibration}
        />
      )}
    </div>
  );
}

function DisplayGainControl({
  value,
  onChange,
  onReset,
  canInheritPrevious,
  previousGainValue,
  onInheritPrevious,
  canApplyAll,
  onApplyAll,
}: {
  value: number;
  onChange: (gain: number) => void;
  onReset: () => void;
  canInheritPrevious: boolean;
  previousGainValue: number | null;
  onInheritPrevious: () => void;
  canApplyAll: boolean;
  onApplyAll: () => void;
}) {
  const isAdjusted = value !== DISPLAY_GAIN_DEFAULT;
  return (
    <div
      className="absolute bottom-2 right-2 flex items-center gap-2 rounded-md border border-slate-200/70 bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur-sm dark:border-slate-700/70 dark:bg-slate-900/85"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
        title="Display only - does not change threshold"
      >
        Display
      </span>
      <input
        type="range"
        min={DISPLAY_GAIN_MIN}
        max={DISPLAY_GAIN_MAX}
        step={0.1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-56 accent-blue-600 dark:accent-cyan-400"
      />
      <span
        className={`min-w-[5ch] text-center text-xs tabular-nums ${
          isAdjusted
            ? 'font-semibold text-blue-600 dark:text-cyan-300'
            : 'text-slate-600 dark:text-slate-300'
        }`}
      >
        {value.toFixed(2)}x
      </span>
      <button
        type="button"
        onClick={onReset}
        disabled={!isAdjusted}
        title="Reset to 1.00x"
        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-500 dark:text-slate-200 dark:hover:border-slate-300 dark:hover:bg-slate-800"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={onInheritPrevious}
        disabled={!canInheritPrevious}
        title={
          previousGainValue !== null
            ? `Apply gain from previously viewed image (${previousGainValue.toFixed(2)}x)`
            : 'No previous image'
        }
        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-500 dark:text-slate-200 dark:hover:border-slate-300 dark:hover:bg-slate-800"
      >
        Previous
      </button>
      <button
        type="button"
        onClick={onApplyAll}
        disabled={!canApplyAll}
        title="Apply current gain to every image"
        aria-label="Apply current gain to every image"
        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-500 dark:text-slate-200 dark:hover:border-slate-300 dark:hover:bg-slate-800"
      >
        All
      </button>
    </div>
  );
}

function SetScaleDialog({
  pixelLength,
  onSubmit,
  onCancel,
  showApplyAll,
  existingCalibration,
}: {
  pixelLength: number;
  onSubmit: (knownLength: number, unit: string, applyToAll: boolean) => void;
  onCancel: () => void;
  showApplyAll: boolean;
  existingCalibration?: Calibration;
}) {
  const hasExisting = existingCalibration && isCalibrated(existingCalibration);
  const [knownLength, setKnownLength] = useState(
    hasExisting ? String(+(pixelLength * existingCalibration.pixelWidth).toPrecision(6)) : ''
  );
  const [unit, setUnit] = useState(hasExisting ? existingCalibration.unit : 'um');
  const parsed = parseFloat(knownLength);
  const valid = Number.isFinite(parsed) && parsed > 0 && unit.trim().length > 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 dark:bg-black/50">
      <div className="w-80 rounded-lg border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Set Scale</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Drawn line = {pixelLength.toFixed(2)} px. Enter the real-world length it represents.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-slate-600 dark:text-slate-300">
            Known length
            <input
              autoFocus
              type="number"
              step="any"
              value={knownLength}
              onChange={(e) => setKnownLength(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-transparent dark:bg-slate-800 dark:text-slate-100 dark:focus:border-cyan-400"
              placeholder="e.g. 50"
            />
          </label>
          <label className="block text-xs text-slate-600 dark:text-slate-300">
            Unit
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-transparent dark:bg-slate-800 dark:text-slate-100 dark:focus:border-cyan-400"
              placeholder="e.g. um, mm, nm"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-transparent"
          >
            Cancel
          </button>
          {showApplyAll && (
            <button
              disabled={!valid}
              onClick={() => valid && onSubmit(parsed, unit, true)}
              className="rounded border border-blue-600 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:border-cyan-500 dark:text-cyan-400 dark:hover:bg-cyan-400/10"
            >
              Apply All
            </button>
          )}
          <button
            disabled={!valid}
            onClick={() => valid && onSubmit(parsed, unit, false)}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 dark:bg-cyan-500 dark:text-slate-900 dark:hover:bg-cyan-400"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function rectCorners(roi: { x: number; y: number; w: number; h: number }): Point[] {
  return [
    { x: roi.x, y: roi.y },
    { x: roi.x + roi.w, y: roi.y },
    { x: roi.x + roi.w, y: roi.y + roi.h },
    { x: roi.x, y: roi.y + roi.h },
  ];
}

function drawHandles(ctx: CanvasRenderingContext2D, roi: RoiShape, scale: number): void {
  const r = 5 / scale;
  ctx.lineWidth = Math.max(1 / scale, 1);
  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#22d3ee';
  const drawDot = (p: Point) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  if (roi.type === 'rectangle' || roi.type === 'ellipse') {
    rectCorners(roi).forEach(drawDot);
  } else if (roi.type === 'polygon') {
    roi.points.forEach(drawDot);
  } else if (roi.type === 'line') {
    drawDot({ x: roi.x1, y: roi.y1 });
    drawDot({ x: roi.x2, y: roi.y2 });
  }
  // freehand / freehandLine have too many points to show handles individually.
}

function hitTestHandle(roi: RoiShape, p: Point, tol: number): EditTarget | null {
  const near = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= tol * tol;
  if (roi.type === 'rectangle') {
    const corners = rectCorners(roi);
    for (let i = 0; i < 4; i++) if (near(p, corners[i])) return { kind: 'rect-corner', corner: i as 0 | 1 | 2 | 3 };
  } else if (roi.type === 'ellipse') {
    const corners = rectCorners(roi);
    for (let i = 0; i < 4; i++) if (near(p, corners[i])) return { kind: 'ellipse-corner', corner: i as 0 | 1 | 2 | 3 };
  } else if (roi.type === 'polygon') {
    for (let i = 0; i < roi.points.length; i++) if (near(p, roi.points[i])) return { kind: 'vertex', index: i };
  } else if (roi.type === 'line') {
    if (near(p, { x: roi.x1, y: roi.y1 })) return { kind: 'line-end', which: 1 };
    if (near(p, { x: roi.x2, y: roi.y2 })) return { kind: 'line-end', which: 2 };
  }
  return null;
}

function applyHandleDrag(roi: RoiShape, target: EditTarget, p: Point): RoiShape | null {
  if (target.kind === 'rect-corner' && roi.type === 'rectangle') {
    const r = resizeRect(roi, target.corner, p);
    return { ...roi, x: r.x, y: r.y, w: r.w, h: r.h };
  }
  if (target.kind === 'ellipse-corner' && roi.type === 'ellipse') {
    const r = resizeRect({ type: 'rectangle', x: roi.x, y: roi.y, w: roi.w, h: roi.h }, target.corner, p);
    return { ...roi, x: r.x, y: r.y, w: r.w, h: r.h };
  }
  if (target.kind === 'vertex' && roi.type === 'polygon') {
    const points = roi.points.slice();
    points[target.index] = p;
    return { ...roi, points };
  }
  if (target.kind === 'line-end' && roi.type === 'line') {
    return target.which === 1
      ? { ...roi, x1: p.x, y1: p.y }
      : { ...roi, x2: p.x, y2: p.y };
  }
  return null;
}

function resizeRect(
  roi: { type: 'rectangle'; x: number; y: number; w: number; h: number },
  corner: 0 | 1 | 2 | 3,
  p: Point,
): { type: 'rectangle'; x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = roi;
  const x1 = x + w;
  const y1 = y + h;
  switch (corner) {
    case 0:
      w = x1 - p.x;
      h = y1 - p.y;
      x = p.x;
      y = p.y;
      break;
    case 1:
      w = p.x - x;
      h = y1 - p.y;
      y = p.y;
      break;
    case 2:
      w = p.x - x;
      h = p.y - y;
      break;
    case 3:
      w = x1 - p.x;
      h = p.y - y;
      x = p.x;
      break;
  }
  return { type: 'rectangle', x, y, w, h };
}
