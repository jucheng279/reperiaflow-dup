import { useEffect } from 'react';
import { useSessionStore } from '../domain/session/sessionStore';
import { sortedImages } from '../domain/image/previewSort';
import { activeThresholdRange } from '../domain/session/sessionTypes';
import { applyThresholdStep } from '../domain/threshold/thresholdTypes';
import { detectHotspot } from '../domain/image/hotspotDetect';
import { animateView } from '../utils/animateView';

let autoZoomAnimCancel: (() => void) | null = null;

export function useHotkeys() {
  const setTool = useSessionStore((s) => s.setActiveTool);
  const measureAndNext = useSessionStore((s) => s.measureAndNext);
  const measureOnly = useSessionStore((s) => s.measureOnly);
  const skip = useSessionStore((s) => s.skipActive);
  const phase = useSessionStore((s) => s.phase);
  const toggleResults = useSessionStore((s) => s.toggleResultsWindow);
  const toggleMetadata = useSessionStore((s) => s.toggleMetadataPanel);
  const updateThreshold = useSessionStore((s) => s.updateThreshold);
  const setActiveIndex = useSessionStore((s) => s.setActiveIndex);
  const removeImage = useSessionStore((s) => s.removeImage);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (target instanceof HTMLInputElement) {
        if (target.type === 'range') return;
        const blockingTypes = new Set([
          'text',
          'number',
          'search',
          'email',
          'tel',
          'url',
          'password',
        ]);
        if (blockingTypes.has(target.type)) return;
      }
      const state = useSessionStore.getState();
      const active = state.images[state.activeIndex] ?? null;
      const mode = state.imagingMode;

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const images = state.images;
        if (images.length === 0) return;
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        const sorted = sortedImages(images, state.previewSortMode);
        const currentPos = sorted.findIndex((s) => s.originalIndex === state.activeIndex);
        const startPos = currentPos < 0
          ? delta === 1 ? 0 : sorted.length - 1
          : currentPos + delta;
        let next = -1;
        for (let i = startPos; i >= 0 && i < sorted.length; i += delta) {
          const img = sorted[i].image;
          if (img.status === 'pending' || img.status === 'measured') {
            next = sorted[i].originalIndex;
            break;
          }
        }
        if (next >= 0 && next !== state.activeIndex) setActiveIndex(next);
        return;
      }

      if (
        mode === 'fluorescence' &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const dir: 1 | -1 = e.key === 'ArrowRight' ? 1 : -1;
        const range = activeThresholdRange(active, state.threshold);
        const next = applyThresholdStep(dir, e.shiftKey, state.thresholdScrollTarget, range);
        if (next) updateThreshold(next);
        return;
      }
      if (e.key.toLowerCase() === 't') return toggleResults();
      if (e.key.toLowerCase() === 'i') return toggleMetadata();

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const image = state.images[state.activeIndex];
        if (!image) return;
        if (image.selectedRoiIndex >= 0) {
          e.preventDefault();
          state.clearSelectedRoi();
          return;
        }
        e.preventDefault();
        removeImage(image.id);
        return;
      }

      if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey) {
        if (!active || !active.gray) return;
        e.preventDefault();
        dispatchAutoZoom(active.gray.data, active.width, active.height);
        return;
      }

      if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
        if (!active) return;
        e.preventDefault();
        dispatchFitView(active.width, active.height);
        return;
      }

      if (phase !== 'working') return;
      switch (e.key.toLowerCase()) {
        case 'r':
          return setTool('rectangle');
        case 'e':
          return setTool('ellipse');
        case 'p':
          return setTool('polygon');
        case 'f':
          return setTool('freehand');
        case 'l':
          return setTool('line');
        case 'n':
          return setTool('freehandLine');
        case 's': {
          if (state.previewFullscreen) {
            if (state.secondarySelectedIds.length > 0) state.skipSecondarySelected();
            return;
          }
          return skip();
        }
      }
      if (e.key === 'Enter') measureAndNext();
      if (e.key === ' ') {
        e.preventDefault();
        measureOnly();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    setTool,
    measureAndNext,
    measureOnly,
    skip,
    phase,
    toggleResults,
    toggleMetadata,
    updateThreshold,
    setActiveIndex,
    removeImage,
  ]);
}

function getViewerRect(): DOMRect | null {
  const el = document.querySelector('[data-image-viewer]');
  return el ? el.getBoundingClientRect() : null;
}

export function dispatchAutoZoom(grayData: Uint8Array, imgWidth: number, imgHeight: number) {
  const rect = getViewerRect();
  if (!rect || rect.width === 0 || rect.height === 0) return;
  const hotspot = detectHotspot(grayData, imgWidth, imgHeight);
  if (!hotspot) return;
  const currentScale = Math.min(rect.width / imgWidth, rect.height / imgHeight, 1) * 0.95;
  const fromView = {
    scale: currentScale,
    offsetX: (rect.width - imgWidth * currentScale) / 2,
    offsetY: (rect.height - imgHeight * currentScale) / 2,
  };
  const targetScale = Math.min(rect.width / hotspot.width, rect.height / hotspot.height) * 0.9;
  const toView = {
    scale: targetScale,
    offsetX: rect.width / 2 - (hotspot.x + hotspot.width / 2) * targetScale,
    offsetY: rect.height / 2 - (hotspot.y + hotspot.height / 2) * targetScale,
  };
  if (autoZoomAnimCancel) autoZoomAnimCancel();
  autoZoomAnimCancel = animateView(fromView, toView, 300, (v) => {
    window.dispatchEvent(new CustomEvent('autozoom-frame', { detail: v }));
  });
}

export function dispatchFitView(imgWidth: number, imgHeight: number) {
  const rect = getViewerRect();
  if (!rect || rect.width === 0 || rect.height === 0) return;
  const scale = Math.min(rect.width / imgWidth, rect.height / imgHeight, 1) * 0.95;
  const v = {
    scale,
    offsetX: (rect.width - imgWidth * scale) / 2,
    offsetY: (rect.height - imgHeight * scale) / 2,
  };
  window.dispatchEvent(new CustomEvent('autozoom-frame', { detail: v }));
}
