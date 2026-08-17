import { create } from 'zustand';
import type {
  GlobalRange,
  ImageMode,
  IngestProgress,
  NormalizationMode,
  SessionImage,
  SessionState,
} from './sessionTypes';
import { selectedRoi } from './sessionTypes';
import type {
  EllipseRoi,
  FreehandRoi,
  Point,
  PolygonRoi,
  RectangleRoi,
  RoiShape,
  RoiType,
} from '../roi/roiTypes';

type ClosedRoiShape = RectangleRoi | EllipseRoi | PolygonRoi | FreehandRoi;
import {
  isClosedRoi,
  isOpenRoi,
  isPointRoi,
  roiPathLengthPx,
  roiPointCount,
} from '../roi/roiTypes';
import { buildRoiOwnerMap, hasAnyClosedRoi } from '../roi/roiOwnerMap';
import type { ThresholdRange } from '../threshold/thresholdTypes';
import type { MeasurementRow } from '../measurement/measurementTypes';
import {
  clampRange,
  type ThresholdScrollTarget,
} from '../threshold/thresholdTypes';
import { defaultThreshold } from '../threshold/presets';
import { buildThresholdMask, buildSegmentedThresholdMask } from '../threshold/thresholdEngine';
import { rasterizeRoi } from '../roi/roiRasterize';
import { measure, measureArea } from '../measurement/measure';
import { newId, newUuid } from '../../utils/ids';
import { runWithConcurrency } from '../../utils/concurrencyPool';
import { adaptiveConcurrency } from '../../utils/deviceConcurrency';
import { measureBatchInWorkers } from '../../workers/measureClient';
import type { MeasureImageInput } from '../../workers/measureWorker';
import { restoreBuffersBatch } from '../image/bufferCache';
import { applyGainToGray, decodeFileToPages, fileMetadataFromFileAsync } from '../image/decode';
import type { TiffMetadata } from '../image/tiff';
import { buildPreviewBitmap, buildPreviewGray, buildPreviewRgba, computePreviewDimensions } from '../image/preview';
import { recalibrateRow } from '../measurement/measurementTypes';
import type { PreviewSortMode, ResultsViewMode, ResultsWindowState, SidebarDisplayMode } from './uiTypes';
import {
  modeFromHueBucket,
  rgbaToGray8,
  type GrayscaleMode,
} from '../image/grayscale';
import {
  DEFAULT_TIFF_STRETCH_MODE,
  isGlobalNormalizationEligible,
  buildPreviewStretchContext,
  stretchPreviewContext,
  computeNativeMean,
  type TiffStretchMode,
} from '../image/tiff';
import { applyTiffStretchAsync, applyTiffStretchFixedAsync } from '../../workers/tiffClient';
import {
  NO_CALIBRATION,
  pixelsToArea,
  pixelsToLength,
  type Calibration,
} from '../image/calibration';
import {
  touch as lruTouch,
  remove as lruRemove,
  clearLru,
  clearBufferCache,
  purgeBuffers,
  persistAndGetEvictedIds,
  shellify,
  shellifyDeferred,
  buildPersistEntry,
  flushPendingPersists,
  ensureHydrated,
  isHydrated,
  rehydrateImage,
  pushHistory,
  computeHotSet,
  computeDelta,
  resetMainThreadDb,
  clearPersistConfirmed,
  type PendingPersist,
} from '../image/memoryTier';
import { HOT_CAPACITY } from '../image/lruManager';
import { reconcile, cancelReconciliation, type PostRestoreTransform } from '../image/hydrationReconciler';
import { sortedImages } from '../image/previewSort';
import {
  type BatchProgress,
  BATCH_IDLE,
  runBatch,
  abortBatch as abortBatchProcessor,
  notifyReconcilerBusy,
  notifyReconcilerIdle,
} from '../image/batchProcessor';
import type { CachedBuffers } from '../image/bufferCache';

export const DISPLAY_GAIN_MIN = 0.25;
export const DISPLAY_GAIN_MAX = 20;
export const DISPLAY_GAIN_DEFAULT = 1;

function clampDisplayGain(gain: number): number {
  if (!Number.isFinite(gain)) return DISPLAY_GAIN_DEFAULT;
  if (gain < DISPLAY_GAIN_MIN) return DISPLAY_GAIN_MIN;
  if (gain > DISPLAY_GAIN_MAX) return DISPLAY_GAIN_MAX;
  return gain;
}

const INTENSITY_SORT_FLOOR_8BIT = 14;

function computePreviewMeanFromGray(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > INTENSITY_SORT_FLOOR_8BIT) sum += data[i];
  }
  return sum / data.length;
}

export type DisplayGainSource = 'slider' | 'reset' | 'inherit';

function parseKeywordInput(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );
}

export type RoiTool =
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'freehand'
  | 'line'
  | 'freehandLine'
  | 'point'
  | 'pointArrow'
  | 'setScale';

export interface SessionStore extends SessionState {
  rows: MeasurementRow[];
  error: string | null;
  overlayOpacity: number;
  thresholdOverlayEnabled: boolean;
  activeTool: RoiTool;
  resultsWindow: ResultsWindowState;
  sidebarDisplayMode: SidebarDisplayMode;
  previewFullscreen: boolean;
  secondarySelectedIds: string[];
  previewSortMode: PreviewSortMode;
  resultsViewMode: ResultsViewMode;
  pendingScalePrompt: { imageId: string; pixelLength: number } | null;
  thresholdScrollTarget: ThresholdScrollTarget;
  metadataPanel: { open: boolean; imageId: string | null };
  setThresholdScrollTarget: (t: ThresholdScrollTarget) => void;
  openMetadataPanel: (imageId?: string | null) => void;
  closeMetadataPanel: () => void;
  toggleMetadataPanel: () => void;

  addFiles: (files: File[]) => Promise<void>;
  dismissIngestErrors: () => void;
  setError: (msg: string | null) => void;

  updateThreshold: (range: ThresholdRange) => void;
  updateSelectedRoiThreshold: (range: ThresholdRange) => void;
  toggleSelectedRoiIndex: (index: number) => void;
  applyThresholdToImages: (scope: 'all' | 'remaining') => void;
  hydrateThreshold: (range: ThresholdRange) => void;
  setOverlayOpacity: (v: number) => void;
  toggleThresholdOverlayEnabled: () => void;

  toggleResultsWindow: () => void;
  setResultsWindowOpen: (open: boolean) => void;
  setResultsWindowRect: (rect: { x: number; y: number; width: number; height: number }) => void;
  hydrateResultsWindow: (state: ResultsWindowState) => void;

  setSidebarDisplayMode: (mode: SidebarDisplayMode) => void;
  hydrateSidebarDisplayMode: (mode: SidebarDisplayMode) => void;
  setPreviewFullscreen: (open: boolean) => void;
  setPreviewSortMode: (mode: PreviewSortMode) => void;
  setResultsViewMode: (mode: ResultsViewMode) => void;
  toggleSecondarySelection: (imageId: string) => void;
  clearSecondarySelection: () => void;
  skipSecondarySelected: () => void;
  skipAfterLastSelected: (sortedIds: string[]) => void;
  skipBeforeFirstSelected: (sortedIds: string[]) => void;
  skipAllExceptSelected: () => void;
  unskipSecondarySelected: () => void;
  unskipAfterLastSelected: (sortedIds: string[]) => void;
  unskipBeforeFirstSelected: (sortedIds: string[]) => void;
  unskipAllExceptSelected: () => void;

  setImageGrayscaleMode: (imageId: string, mode: GrayscaleMode) => void;
  resetImageGrayscaleMode: (imageId: string) => void;

  setImageTiffStretchMode: (imageId: string, mode: TiffStretchMode) => void;
  resetImageTiffStretchMode: (imageId: string) => void;

  setNormalizationMode: (mode: NormalizationMode) => void;

  setActiveIndex: (i: number) => void;
  nextImage: () => void;
  prevImage: () => void;
  skipActive: () => void;
  unskipActive: () => void;
  removeImage: (imageId: string) => void;
  removeSelectedImages: () => void;
  removeSkippedImages: () => void;
  clearAllImages: () => void;
  skipByKeywords: (input: string) => number;
  unskipByKeywords: (input: string) => number;
  removeSkipKeywordFilter: (keyword: string) => number;
  measureAndNext: () => Promise<void>;
  measureOnly: () => Promise<void>;
  measureAllPending: () => Promise<void>;
  measureAll: () => Promise<void>;

  addRoi: (roi: RoiShape) => void;
  addPointClick: (p: Point, variant?: 'point' | 'pointArrow') => void;
  updateSelectedRoi: (roi: RoiShape) => void;
  clearSelectedRoi: () => void;
  clearAllRois: () => void;
  setSelectedRoiIndex: (index: number) => void;
  setActiveTool: (t: RoiTool) => void;

  setImagingMode: (mode: ImageMode) => void;
  setCalibration: (imageId: string, calibration: Calibration) => void;
  setCalibrationForAll: (calibration: Calibration) => void;
  requestScalePromptFromRoi: () => void;
  clearScalePrompt: () => void;

  deleteRow: (id: string) => void;
  clearResults: () => void;
  resetAllMeasurements: () => void;

  setImageColorLabel: (imageId: string, label: string | null) => void;

  previousImageId: string | null;
  setImageDisplayGain: (imageId: string, gain: number) => void;
  resetImageDisplayGain: (imageId: string) => void;
  inheritDisplayGainFromPrevious: (imageId: string) => void;
  applyDisplayGainToAll: (gain: number) => void;
  hydrateImage: (imageId: string) => Promise<void>;

  autoZoomEnabled: boolean;
  toggleAutoZoom: () => void;

  batchProgress: BatchProgress;
  setGrayscaleModeForAll: (mode: GrayscaleMode) => void;
  abortBatch: () => void;
}

const EMPTY_GRAY = { width: 0, height: 0, data: new Uint8Array(0) };

function makeLoadingPlaceholder(id: string, fileName: string): SessionImage {
  return {
    id,
    fileName,
    width: 0,
    height: 0,
    gray: EMPTY_GRAY,
    status: 'loading',
    rois: [],
    selectedRoiIndex: -1,
    calibration: NO_CALIBRATION,
    grayscaleMode: 'average',
    grayscaleModeUserSet: false,
    userColorLabel: null,
  };
}

function pickActiveAfterIngest(
  images: SessionImage[],
  prevActiveIndex: number,
): number {
  if (prevActiveIndex >= 0 && prevActiveIndex < images.length) return prevActiveIndex;
  for (let i = 0; i < images.length; i++) {
    const status = images[i].status;
    if (status === 'pending' || status === 'measured') return i;
    if (status === 'loading') return -1;
  }
  return -1;
}

function replacePlaceholderWithImages(
  _get: StoreGet,
  set: StoreSet,
  placeholderId: string,
  decoded: SessionImage[],
): void {
  set((s) => {
    const idx = s.images.findIndex((img) => img.id === placeholderId);
    if (idx < 0) return {};
    const filters = s.skipKeywordFilters;
    const filtered =
      filters.length === 0
        ? decoded
        : decoded.map((img) => {
            const name = img.fileName.toLowerCase();
            return filters.some((t) => name.includes(t))
              ? { ...img, status: 'skipped' as const }
              : img;
          });
    const next = s.images.slice();
    next.splice(idx, 1, ...filtered);
    const newActive = pickActiveAfterIngest(next, s.activeIndex);
    const threshold =
      newActive >= 0 ? thresholdRestoredFromImage(s.threshold, next[newActive]) : s.threshold;
    const images =
      newActive >= 0 ? snapshotThresholdOnActive(next, newActive, threshold, s.imagingMode) : next;
    return {
      images,
      activeIndex: newActive,
      threshold,
    };
  });
}

function markPlaceholderError(
  _get: StoreGet,
  set: StoreSet,
  placeholderId: string,
  fileName: string,
  message: string,
): void {
  set((s) => {
    const images = s.images.map((img) =>
      img.id === placeholderId
        ? { ...img, status: 'error' as const, decodeError: message }
        : img,
    );
    const errors = [...s.ingest.errors, { fileName, message }];
    const newActive = pickActiveAfterIngest(images, s.activeIndex);
    const threshold =
      newActive >= 0 && newActive !== s.activeIndex
        ? thresholdRestoredFromImage(s.threshold, images[newActive])
        : s.threshold;
    const nextImages =
      newActive >= 0 && newActive !== s.activeIndex
        ? snapshotThresholdOnActive(images, newActive, threshold, s.imagingMode)
        : images;
    return {
      images: nextImages,
      activeIndex: newActive,
      threshold,
      ingest: { ...s.ingest, errors },
    };
  });
}

function bumpIngestCompleted(set: StoreSet): void {
  set((s) => ({
    ingest: { ...s.ingest, completed: Math.min(s.ingest.total, s.ingest.completed + 1) },
  }));
}

function fullImageMask(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height);
  data.fill(1);
  return data;
}

function findNextPending(images: SessionImage[], from: number): number {
  for (let i = from + 1; i < images.length; i++) {
    if (images[i].status === 'pending') return i;
  }
  for (let i = 0; i <= from && i < images.length; i++) {
    if (images[i].status === 'pending') return i;
  }
  return -1;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessionId: newId('sess'),
  phase: 'empty',
  images: [],
  activeIndex: -1,
  threshold: defaultThreshold(),
  imagingMode: 'fluorescence',
  rows: [],
  error: null,
  overlayOpacity: 0.5,
  thresholdOverlayEnabled: true,
  activeTool: 'rectangle',
  resultsWindow: { open: false, x: 24, y: 80, width: 720, height: 420 },
  sidebarDisplayMode: 'preview',
  previewFullscreen: false,
  secondarySelectedIds: [],
  previewSortMode: 'queue',
  resultsViewMode: 'batched',
  pendingScalePrompt: null,
  thresholdScrollTarget: 'min',
  normalizationMode: 'per-image',
  globalRange: null,
  tiffStretchPending: 0,
  ingest: { total: 0, completed: 0, errors: [] },
  batchProgress: BATCH_IDLE,
  skipKeywordFilters: [],
  metadataPanel: { open: false, imageId: null },
  previousImageId: null,
  autoZoomEnabled: true,

  setThresholdScrollTarget: (t) => set({ thresholdScrollTarget: t }),

  openMetadataPanel: (imageId) => {
    const s = get();
    const id = imageId ?? s.images[s.activeIndex]?.id ?? null;
    if (!id) return;
    set({ metadataPanel: { open: true, imageId: id } });
  },
  closeMetadataPanel: () => set({ metadataPanel: { open: false, imageId: null } }),
  toggleMetadataPanel: () => {
    const s = get();
    if (s.metadataPanel.open) {
      set({ metadataPanel: { open: false, imageId: null } });
      return;
    }
    const id = s.images[s.activeIndex]?.id ?? null;
    if (!id) return;
    set({ metadataPanel: { open: true, imageId: id } });
  },

  setError: (msg) => set({ error: msg }),

  toggleResultsWindow: () => {
    const s = get();
    set({ resultsWindow: { ...s.resultsWindow, open: !s.resultsWindow.open } });
  },

  setResultsWindowOpen: (open) => {
    const s = get();
    if (s.resultsWindow.open === open) return;
    set({ resultsWindow: { ...s.resultsWindow, open } });
  },

  setResultsWindowRect: (rect) => {
    const s = get();
    set({ resultsWindow: { ...s.resultsWindow, ...rect } });
  },

  hydrateResultsWindow: (state) => set({ resultsWindow: state }),

  setSidebarDisplayMode: (mode) => {
    const s = get();
    if (s.sidebarDisplayMode === mode) return;
    set({ sidebarDisplayMode: mode });
  },

  hydrateSidebarDisplayMode: (mode) => set({ sidebarDisplayMode: mode }),
  setPreviewFullscreen: (open) => set(open ? { previewFullscreen: true } : { previewFullscreen: false, secondarySelectedIds: [] }),
  setPreviewSortMode: (mode) => {
    set({ previewSortMode: mode });
    triggerSmartHydration(get, set);
  },
  setResultsViewMode: (mode) => set({ resultsViewMode: mode }),

  toggleSecondarySelection: (imageId) => {
    const ids = get().secondarySelectedIds;
    const idx = ids.indexOf(imageId);
    if (idx >= 0) {
      set({ secondarySelectedIds: ids.filter((id) => id !== imageId) });
    } else {
      set({ secondarySelectedIds: [...ids, imageId] });
    }
  },

  clearSecondarySelection: () => set({ secondarySelectedIds: [] }),

  skipSecondarySelected: () => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const idSet = new Set(s.secondarySelectedIds);
    const images = s.images.map((img) =>
      idSet.has(img.id) && (img.status === 'pending' || img.status === 'measured')
        ? { ...img, status: 'skipped' as const, wasMeasured: img.status === 'measured' || undefined }
        : img,
    );
    const activeImg = images[s.activeIndex];
    const needsAdvance = activeImg && activeImg.status === 'skipped';
    set({ images, secondarySelectedIds: [] });
    if (needsAdvance) get().nextImage();
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  skipAfterLastSelected: (sortedIds) => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const selectedSet = new Set(s.secondarySelectedIds);
    let lastIdx = -1;
    for (let i = 0; i < sortedIds.length; i++) {
      if (selectedSet.has(sortedIds[i])) lastIdx = i;
    }
    const toSkip = new Set<string>();
    for (let i = lastIdx + 1; i < sortedIds.length; i++) {
      if (!selectedSet.has(sortedIds[i])) toSkip.add(sortedIds[i]);
    }
    const images = s.images.map((img) =>
      toSkip.has(img.id) && (img.status === 'pending' || img.status === 'measured')
        ? { ...img, status: 'skipped' as const, wasMeasured: img.status === 'measured' || undefined }
        : img,
    );
    const activeImg = images[s.activeIndex];
    const needsAdvance = activeImg && activeImg.status === 'skipped';
    set({ images, secondarySelectedIds: [] });
    if (needsAdvance) get().nextImage();
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  skipBeforeFirstSelected: (sortedIds) => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const selectedSet = new Set(s.secondarySelectedIds);
    let firstIdx = sortedIds.length;
    for (let i = 0; i < sortedIds.length; i++) {
      if (selectedSet.has(sortedIds[i])) { firstIdx = i; break; }
    }
    const toSkip = new Set<string>();
    for (let i = 0; i < firstIdx; i++) {
      if (!selectedSet.has(sortedIds[i])) toSkip.add(sortedIds[i]);
    }
    const images = s.images.map((img) =>
      toSkip.has(img.id) && (img.status === 'pending' || img.status === 'measured')
        ? { ...img, status: 'skipped' as const, wasMeasured: img.status === 'measured' || undefined }
        : img,
    );
    const activeImg = images[s.activeIndex];
    const needsAdvance = activeImg && activeImg.status === 'skipped';
    set({ images, secondarySelectedIds: [] });
    if (needsAdvance) get().nextImage();
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  skipAllExceptSelected: () => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const selectedSet = new Set(s.secondarySelectedIds);
    const images = s.images.map((img) =>
      !selectedSet.has(img.id) && (img.status === 'pending' || img.status === 'measured')
        ? { ...img, status: 'skipped' as const, wasMeasured: img.status === 'measured' || undefined }
        : img,
    );
    const activeImg = images[s.activeIndex];
    const needsAdvance = activeImg && activeImg.status === 'skipped';
    set({ images, secondarySelectedIds: [] });
    if (needsAdvance) get().nextImage();
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  unskipSecondarySelected: () => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const idSet = new Set(s.secondarySelectedIds);
    let anyPending = false;
    const images = s.images.map((img) => {
      if (!idSet.has(img.id) || img.status !== 'skipped') return img;
      const restored = img.wasMeasured ? 'measured' as const : 'pending' as const;
      if (restored === 'pending') anyPending = true;
      return { ...img, status: restored, wasMeasured: undefined };
    });
    const phase: SessionState['phase'] = anyPending && s.phase === 'done' ? 'working' : s.phase;
    set({ images, secondarySelectedIds: [], phase });
    triggerSmartHydration(get, set);
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  unskipAfterLastSelected: (sortedIds) => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const selectedSet = new Set(s.secondarySelectedIds);
    let lastIdx = -1;
    for (let i = 0; i < sortedIds.length; i++) {
      if (selectedSet.has(sortedIds[i])) lastIdx = i;
    }
    const toUnskip = new Set<string>();
    for (let i = lastIdx + 1; i < sortedIds.length; i++) {
      if (!selectedSet.has(sortedIds[i])) toUnskip.add(sortedIds[i]);
    }
    let anyPending = false;
    const images = s.images.map((img) => {
      if (!toUnskip.has(img.id) || img.status !== 'skipped') return img;
      const restored = img.wasMeasured ? 'measured' as const : 'pending' as const;
      if (restored === 'pending') anyPending = true;
      return { ...img, status: restored, wasMeasured: undefined };
    });
    const phase: SessionState['phase'] = anyPending && s.phase === 'done' ? 'working' : s.phase;
    set({ images, secondarySelectedIds: [], phase });
    triggerSmartHydration(get, set);
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  unskipBeforeFirstSelected: (sortedIds) => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const selectedSet = new Set(s.secondarySelectedIds);
    let firstIdx = sortedIds.length;
    for (let i = 0; i < sortedIds.length; i++) {
      if (selectedSet.has(sortedIds[i])) { firstIdx = i; break; }
    }
    const toUnskip = new Set<string>();
    for (let i = 0; i < firstIdx; i++) {
      if (!selectedSet.has(sortedIds[i])) toUnskip.add(sortedIds[i]);
    }
    let anyPending = false;
    const images = s.images.map((img) => {
      if (!toUnskip.has(img.id) || img.status !== 'skipped') return img;
      const restored = img.wasMeasured ? 'measured' as const : 'pending' as const;
      if (restored === 'pending') anyPending = true;
      return { ...img, status: restored, wasMeasured: undefined };
    });
    const phase: SessionState['phase'] = anyPending && s.phase === 'done' ? 'working' : s.phase;
    set({ images, secondarySelectedIds: [], phase });
    triggerSmartHydration(get, set);
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  unskipAllExceptSelected: () => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const selectedSet = new Set(s.secondarySelectedIds);
    let anyPending = false;
    const images = s.images.map((img) => {
      if (selectedSet.has(img.id) || img.status !== 'skipped') return img;
      const restored = img.wasMeasured ? 'measured' as const : 'pending' as const;
      if (restored === 'pending') anyPending = true;
      return { ...img, status: restored, wasMeasured: undefined };
    });
    const phase: SessionState['phase'] = anyPending && s.phase === 'done' ? 'working' : s.phase;
    set({ images, secondarySelectedIds: [], phase });
    triggerSmartHydration(get, set);
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  setImageGrayscaleMode: (imageId, mode) => {
    const s = get();
    const images = s.images.map((img) => {
      if (img.id !== imageId) return img;
      if (img.grayscaleMode === mode && img.grayscaleModeUserSet) return img;
      if (!img.rgba) {
        return { ...img, grayscaleMode: mode, grayscaleModeUserSet: true };
      }
      const gray = rgbaToGray8(img.rgba.data, img.width, img.height, mode);
      return {
        ...img,
        grayscaleMode: mode,
        grayscaleModeUserSet: true,
        gray,
      };
    });
    set({ images });
    const updated = get().images.find((i) => i.id === imageId);
    if (updated && updated.gray) {
      const entry = buildPersistEntry(updated);
      if (entry) flushPendingPersists([entry]).catch(() => void 0);
      const prev = updated.previewBitmap;
      buildPreviewBitmap(updated.gray.data, updated.width, updated.height).then(
        ({ bitmap, previewGray }) => {
          const previewMeanIntensity = computePreviewMeanFromGray(previewGray.data);
          set({
            images: get().images.map((i) =>
              i.id === imageId ? { ...i, previewBitmap: bitmap, previewGray, previewMeanIntensity } : i,
            ),
          });
          if (prev && typeof prev.close === 'function') prev.close();
        },
      );
    }
  },

  resetImageGrayscaleMode: (imageId) => {
    const s = get();
    const images = s.images.map((img) => {
      if (img.id !== imageId) return img;
      if (!img.color) return img;
      const detected = modeFromHueBucket(img.color.hueBucket);
      if (img.grayscaleMode === detected && !img.grayscaleModeUserSet) return img;
      if (!img.rgba) {
        return { ...img, grayscaleMode: detected, grayscaleModeUserSet: false };
      }
      const gray = rgbaToGray8(img.rgba.data, img.width, img.height, detected);
      return {
        ...img,
        grayscaleMode: detected,
        grayscaleModeUserSet: false,
        gray,
      };
    });
    set({ images });
    const updated = get().images.find((i) => i.id === imageId);
    if (updated && updated.gray) {
      const entry = buildPersistEntry(updated);
      if (entry) flushPendingPersists([entry]).catch(() => void 0);
      const prev = updated.previewBitmap;
      buildPreviewBitmap(updated.gray.data, updated.width, updated.height).then(
        ({ bitmap, previewGray }) => {
          const previewMeanIntensity = computePreviewMeanFromGray(previewGray.data);
          set({
            images: get().images.map((i) =>
              i.id === imageId ? { ...i, previewBitmap: bitmap, previewGray, previewMeanIntensity } : i,
            ),
          });
          if (prev && typeof prev.close === 'function') prev.close();
        },
      );
    }
  },

  setImageTiffStretchMode: (imageId, mode) => {
    set({ tiffStretchPending: get().tiffStretchPending + 1 });
    applyTiffStretchToImage(get, set, imageId, mode, true)
      .catch(() => void 0)
      .finally(() => {
        set({ tiffStretchPending: Math.max(0, get().tiffStretchPending - 1) });
      });
  },

  resetImageTiffStretchMode: (imageId) => {
    set({ tiffStretchPending: get().tiffStretchPending + 1 });
    applyTiffStretchToImage(get, set, imageId, DEFAULT_TIFF_STRETCH_MODE, false)
      .catch(() => void 0)
      .finally(() => {
        set({ tiffStretchPending: Math.max(0, get().tiffStretchPending - 1) });
      });
  },

  setNormalizationMode: (mode) => {
    const s = get();
    if (s.normalizationMode === mode) return;
    set({ normalizationMode: mode });
    set({ tiffStretchPending: get().tiffStretchPending + 1 });
    const work =
      mode === 'global'
        ? reconcileGlobalNormalization(get, set)
        : (() => {
            set({ globalRange: null });
            return restoreAllPerImageStretch(get, set);
          })();
    work
      .catch(() => void 0)
      .finally(() => {
        set({ tiffStretchPending: Math.max(0, get().tiffStretchPending - 1) });
      });
  },

  addFiles: async (files) => {
    if (files.length === 0) return;

    const placeholders: SessionImage[] = files.map((file) =>
      makeLoadingPlaceholder(newId('img'), file.name),
    );
    const placeholderIds = placeholders.map((p) => p.id);

    set((s) => {
      const merged = [...s.images, ...placeholders];
      const startingFromEmpty = s.images.length === 0 && merged.length > 0;
      const ingestPrev = s.ingest;
      const ingestActive = ingestPrev.completed >= ingestPrev.total;
      const ingest: IngestProgress = ingestActive
        ? { total: files.length, completed: 0, errors: [] }
        : {
            total: ingestPrev.total + files.length,
            completed: ingestPrev.completed,
            errors: ingestPrev.errors,
          };
      return {
        images: merged,
        activeIndex: startingFromEmpty ? -1 : s.activeIndex,
        phase: merged.length > 0 ? (s.phase === 'empty' ? 'working' : s.phase) : 'empty',
        ingest,
      };
    });

    const PERSIST_BATCH_SIZE = 8;
    const pendingPersists: PendingPersist[] = [];
    let flushPromise: Promise<void> = Promise.resolve();
    let hydratedCount = 0;

    const tasks = files.map((file, i) => async () => {
      const placeholderId = placeholderIds[i];
      const fileMeta = await fileMetadataFromFileAsync(file);
      try {
        const pages = await decodeFileToPages(file);
        if (pages.length === 0) {
          throw new Error('No decodable pages found.');
        }
        const decoded: SessionImage[] = [];
        for (const page of pages) {
          const {
            width,
            height,
            gray,
            rgba,
            color,
            grayscaleMode,
            pageIndex,
            pageCount,
            tiffSource,
            tiffStretchMode,
            tiffStretchContext,
            tiffMetadata,
          } = page;
          const { bitmap: previewBitmap, previewGray } = await buildPreviewBitmap(gray.data, width, height);
          const previewRgba = rgba
            ? buildPreviewRgba(rgba.data, width, height)
            : null;
          const previewDims = computePreviewDimensions(width, height);
          const previewStretchContext = tiffStretchContext
            ? buildPreviewStretchContext(tiffStretchContext, width, height, previewDims.width, previewDims.height)
            : undefined;
          const previewMeanIntensity = previewStretchContext
            ? computeNativeMean(previewStretchContext)
            : computePreviewMeanFromGray(previewGray.data);
          const fileName =
            pageCount && pageCount > 1
              ? `${file.name} (page ${(pageIndex ?? 0) + 1}/${pageCount})`
              : file.name;
          let img: SessionImage = {
            id: newId('img'),
            fileName,
            width,
            height,
            gray,
            rgba,
            color,
            userColorLabel: null,
            status: 'pending',
            rois: [],
            selectedRoiIndex: -1,
            calibration: calibrationFromTiffMetadata(tiffMetadata) ?? NO_CALIBRATION,
            grayscaleMode,
            grayscaleModeUserSet: false,
            previewBitmap,
            previewRgba,
            previewGray,
            tiffSource,
            tiffStretchMode,
            tiffStretchModeUserSet: false,
            tiffStretchContext,
            previewStretchContext,
            tiffMetadata,
            fileMetadata: fileMeta,
            previewMeanIntensity,
          };
          const keepHydrated = hydratedCount < HOT_CAPACITY;
          if (keepHydrated) {
            hydratedCount++;
            lruTouch(img.id);
            const entry = buildPersistEntry(img);
            if (entry) pendingPersists.push(entry);
            decoded.push(img);
          } else {
            const { shell, pending } = shellifyDeferred(img);
            if (pending) pendingPersists.push(pending);
            decoded.push(shell);
          }
        }
        // Flush to IndexedDB in batches to bound memory during bulk uploads
        if (pendingPersists.length >= PERSIST_BATCH_SIZE) {
          const batch = pendingPersists.splice(0);
          flushPromise = flushPromise.then(() => flushPendingPersists(batch).then(() => void 0));
        }
        replacePlaceholderWithImages(get, set, placeholderId, decoded);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markPlaceholderError(get, set, placeholderId, file.name, message);
      } finally {
        bumpIngestCompleted(set);
      }
    });

    await runWithConcurrency(tasks, adaptiveConcurrency);

    // Flush any remaining entries
    if (pendingPersists.length > 0) {
      const batch = pendingPersists.splice(0);
      flushPromise = flushPromise.then(() => flushPendingPersists(batch).then(() => void 0));
    }
    await flushPromise;

    if (get().activeIndex < 0 && get().images.length > 0) {
      const firstValid = get().images.findIndex(
        (img) => img.status !== 'loading' && img.status !== 'error',
      );
      if (firstValid >= 0) {
        set({ activeIndex: firstValid });
        lruTouch(get().images[firstValid].id);
        pushHistory(get().images[firstValid].id);
      }
    }
    triggerEviction(get, set);

    // Seed the smart hydration hot set now that upload is complete
    const finalState = get();
    const { ids: seedIds, sortedActiveIndex: seedActive } = sortAwareIds(finalState);
    const seedSkipped = new Set(finalState.images.filter((img) => img.status === 'skipped').map((img) => img.id));
    prevHotSet = computeHotSet(seedIds, seedActive, seedSkipped);

    if (get().normalizationMode === 'global') {
      await reconcileGlobalNormalization(get, set);
    }
  },

  dismissIngestErrors: () =>
    set((s) => ({ ingest: { ...s.ingest, errors: [] } })),

  updateThreshold: (range) => {
    const clamped = clampRange(range);
    const s = get();
    const img = s.images[s.activeIndex];
    if (img) {
      const selIdx = img.selectedRoiIndex;
      const selected = selIdx >= 0 ? img.rois[selIdx] : null;
      if (selected && isClosedRoi(selected)) {
        const rois = img.rois.slice();
        rois[selIdx] = { ...(selected as ClosedRoiShape), threshold: clamped };
        const images = s.images.slice();
        images[s.activeIndex] = { ...img, rois };
        set({ images });
        return;
      }
    }
    set({
      threshold: clamped,
      images: snapshotThresholdOnActive(s.images, s.activeIndex, clamped, s.imagingMode),
    });
  },

  updateSelectedRoiThreshold: (range) => {
    const clamped = clampRange(range);
    const s = get();
    const img = s.images[s.activeIndex];
    if (!img) return;
    const selIdx = img.selectedRoiIndex;
    if (selIdx < 0) return;
    const selected = img.rois[selIdx];
    if (!isClosedRoi(selected)) return;
    const rois = img.rois.slice();
    rois[selIdx] = { ...(selected as ClosedRoiShape), threshold: clamped };
    const images = s.images.slice();
    images[s.activeIndex] = { ...img, rois };
    set({ images });
  },

  toggleSelectedRoiIndex: (index) => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    if (index < 0 || index >= img.rois.length) return;
    const next = img.selectedRoiIndex === index ? -1 : index;
    if (next === img.selectedRoiIndex) return;
    const images = s.images.slice();
    images[idx] = { ...img, selectedRoiIndex: next };
    set({ images });
  },

  applyThresholdToImages: (scope) => {
    const s = get();
    const range = s.threshold;
    if (!range) return;
    if (s.imagingMode === 'brightfield') return;
    const images = s.images.map((img) => {
      if (img.status === 'skipped') return img;
      const targeted = scope === 'all' ? true : img.status !== 'measured';
      if (!targeted) return img;
      const snap = img.lastViewedThreshold;
      if (snap && snap.min === range.min && snap.max === range.max) return img;
      return { ...img, lastViewedThreshold: { min: range.min, max: range.max } };
    });
    set({ images });
  },

  hydrateThreshold: (range) => {
    set({ threshold: clampRange(range) });
  },

  setOverlayOpacity: (v) => set({ overlayOpacity: Math.max(0, Math.min(1, v)) }),

  toggleThresholdOverlayEnabled: () => set((s) => ({ thresholdOverlayEnabled: !s.thresholdOverlayEnabled })),

  toggleAutoZoom: () => set((s) => ({ autoZoomEnabled: !s.autoZoomEnabled })),

  setActiveIndex: (i) => {
    const s = get();
    if (i < 0 || i >= s.images.length) return;
    const target = s.images[i];
    if (target.status === 'loading') return;
    if (target.status === 'error' && target.decodeError !== 'Buffer cache miss') return;
    if (i === s.activeIndex) return;
    if (target.status === 'error' && target.decodeError === 'Buffer cache miss') {
      // Attempt rehydration for cache-miss images when user clicks them
      attemptRehydration(get, set, target.id);
    }
    const previousImageId = s.images[s.activeIndex]?.id ?? s.previousImageId;
    const threshold = thresholdRestoredFromImage(s.threshold, target);
    const images = snapshotThresholdOnActive(s.images, i, threshold, s.imagingMode);
    set({ activeIndex: i, threshold, images, previousImageId });
    lruTouch(target.id);
    pushHistory(target.id);
    triggerSmartHydration(get, set);
  },

  nextImage: () => {
    const s = get();
    const next = findNextPending(s.images, s.activeIndex);
    if (next < 0) {
      set({ phase: 'done' });
      return;
    }
    if (next === s.activeIndex) return;
    const previousImageId = s.images[s.activeIndex]?.id ?? s.previousImageId;
    const threshold = thresholdRestoredFromImage(s.threshold, s.images[next]);
    const images = snapshotThresholdOnActive(s.images, next, threshold, s.imagingMode);
    set({ activeIndex: next, threshold, images, previousImageId });
    lruTouch(s.images[next].id);
    pushHistory(s.images[next].id);
    triggerSmartHydration(get, set);
  },

  prevImage: () => {
    const s = get();
    if (s.activeIndex > 0) {
      const next = s.activeIndex - 1;
      const previousImageId = s.images[s.activeIndex]?.id ?? s.previousImageId;
      const threshold = thresholdRestoredFromImage(s.threshold, s.images[next]);
      const images = snapshotThresholdOnActive(s.images, next, threshold, s.imagingMode);
      set({ activeIndex: next, threshold, images, previousImageId });
      lruTouch(s.images[next].id);
      pushHistory(s.images[next].id);
      triggerSmartHydration(get, set);
    }
  },

  skipActive: () => {
    const s = get();
    if (s.activeIndex < 0) return;
    const current = s.images[s.activeIndex];
    if (current.status !== 'pending' && current.status !== 'measured') return;
    const images = s.images.slice();
    images[s.activeIndex] = {
      ...current,
      status: 'skipped',
      wasMeasured: current.status === 'measured' || undefined,
    };
    set({ images });
    get().nextImage();
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  unskipActive: () => {
    const s = get();
    if (s.activeIndex < 0) return;
    const current = s.images[s.activeIndex];
    if (current.status !== 'skipped') return;
    const restoredStatus = current.wasMeasured ? 'measured' as const : 'pending' as const;
    const images = s.images.slice();
    images[s.activeIndex] = { ...current, status: restoredStatus, wasMeasured: undefined };
    const phase: SessionState['phase'] =
      restoredStatus === 'pending' && s.phase === 'done' ? 'working' : s.phase;
    set({ images, phase });
    triggerSmartHydration(get, set);
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  removeImage: (imageId) => {
    const s = get();
    const idx = s.images.findIndex((img) => img.id === imageId);
    if (idx < 0) return;
    const removed = s.images[idx];
    if (removed.previewBitmap && typeof removed.previewBitmap.close === 'function') {
      removed.previewBitmap.close();
    }
    lruRemove(imageId);
    purgeBuffers(imageId).catch(() => void 0);
    const filteredImages = s.images.filter((img) => img.id !== imageId);
    const rows = s.rows.filter((r) => r.imageId !== imageId);

    let activeIndex = s.activeIndex;
    if (filteredImages.length === 0) {
      activeIndex = -1;
    } else if (idx < s.activeIndex) {
      activeIndex = s.activeIndex - 1;
    } else if (idx === s.activeIndex) {
      activeIndex = Math.min(s.activeIndex, filteredImages.length - 1);
    }

    const activeChanged = idx === s.activeIndex && activeIndex >= 0;
    const threshold = activeChanged
      ? thresholdRestoredFromImage(s.threshold, filteredImages[activeIndex])
      : s.threshold;
    const images = activeChanged
      ? snapshotThresholdOnActive(filteredImages, activeIndex, threshold, s.imagingMode)
      : filteredImages;

    const hasUnfinished = images.some(
      (img) => img.status === 'pending' || img.status === 'loading',
    );
    const phase: SessionState['phase'] =
      images.length === 0 ? 'empty' : hasUnfinished ? 'working' : 'done';

    set({
      images,
      rows,
      activeIndex,
      threshold,
      phase,
      pendingScalePrompt:
        s.pendingScalePrompt?.imageId === imageId ? null : s.pendingScalePrompt,
    });
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  removeSelectedImages: () => {
    const s = get();
    if (s.secondarySelectedIds.length === 0) return;
    const idsToRemove = new Set(s.secondarySelectedIds);
    for (const img of s.images) {
      if (idsToRemove.has(img.id)) {
        if (img.previewBitmap && typeof img.previewBitmap.close === 'function') {
          img.previewBitmap.close();
        }
        lruRemove(img.id);
        purgeBuffers(img.id).catch(() => void 0);
      }
    }
    const filteredImages = s.images.filter((img) => !idsToRemove.has(img.id));
    const rows = s.rows.filter((r) => !idsToRemove.has(r.imageId));

    let activeIndex = s.activeIndex;
    if (filteredImages.length === 0) {
      activeIndex = -1;
    } else {
      const activeImage = s.images[s.activeIndex];
      if (activeImage && idsToRemove.has(activeImage.id)) {
        activeIndex = Math.min(s.activeIndex, filteredImages.length - 1);
      } else if (activeImage) {
        activeIndex = filteredImages.findIndex((img) => img.id === activeImage.id);
      }
    }

    const activeChanged =
      activeIndex >= 0 &&
      filteredImages[activeIndex]?.id !== s.images[s.activeIndex]?.id;
    const threshold = activeChanged
      ? thresholdRestoredFromImage(s.threshold, filteredImages[activeIndex])
      : s.threshold;
    const images = activeChanged
      ? snapshotThresholdOnActive(filteredImages, activeIndex, threshold, s.imagingMode)
      : filteredImages;

    const hasUnfinished = images.some(
      (img) => img.status === 'pending' || img.status === 'loading',
    );
    const phase: SessionState['phase'] =
      images.length === 0 ? 'empty' : hasUnfinished ? 'working' : 'done';

    set({
      images,
      rows,
      activeIndex,
      threshold,
      phase,
      secondarySelectedIds: [],
      pendingScalePrompt:
        s.pendingScalePrompt && idsToRemove.has(s.pendingScalePrompt.imageId)
          ? null
          : s.pendingScalePrompt,
    });
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  removeSkippedImages: () => {
    const s = get();
    const skipped = s.images.filter((img) => img.status === 'skipped');
    if (skipped.length === 0) return;
    const idsToRemove = new Set(skipped.map((img) => img.id));
    for (const img of skipped) {
      if (img.previewBitmap && typeof img.previewBitmap.close === 'function') {
        img.previewBitmap.close();
      }
      lruRemove(img.id);
      purgeBuffers(img.id).catch(() => void 0);
    }
    const filteredImages = s.images.filter((img) => img.status !== 'skipped');
    const rows = s.rows.filter((r) => !idsToRemove.has(r.imageId));

    let activeIndex = s.activeIndex;
    if (filteredImages.length === 0) {
      activeIndex = -1;
    } else {
      const activeImage = s.images[s.activeIndex];
      if (activeImage && idsToRemove.has(activeImage.id)) {
        activeIndex = Math.min(s.activeIndex, filteredImages.length - 1);
      } else if (activeImage) {
        activeIndex = filteredImages.findIndex((img) => img.id === activeImage.id);
      }
    }

    const activeChanged =
      activeIndex >= 0 &&
      filteredImages[activeIndex]?.id !== s.images[s.activeIndex]?.id;
    const threshold = activeChanged
      ? thresholdRestoredFromImage(s.threshold, filteredImages[activeIndex])
      : s.threshold;
    const images = activeChanged
      ? snapshotThresholdOnActive(filteredImages, activeIndex, threshold, s.imagingMode)
      : filteredImages;

    const hasUnfinished = images.some(
      (img) => img.status === 'pending' || img.status === 'loading',
    );
    const phase: SessionState['phase'] =
      images.length === 0 ? 'empty' : hasUnfinished ? 'working' : 'done';

    set({
      images,
      rows,
      activeIndex,
      threshold,
      phase,
      secondarySelectedIds: s.secondarySelectedIds.filter((id) => !idsToRemove.has(id)),
      pendingScalePrompt:
        s.pendingScalePrompt && idsToRemove.has(s.pendingScalePrompt.imageId)
          ? null
          : s.pendingScalePrompt,
    });
    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }
  },

  clearAllImages: () => {
    const s = get();
    if (s.images.length === 0) return;
    for (const img of s.images) {
      if (img.previewBitmap && typeof img.previewBitmap.close === 'function') {
        img.previewBitmap.close();
      }
    }
    clearLru();
    clearPersistConfirmed();
    cancelReconciliation();
    prevHotSet = new Set();
    resetMainThreadDb().catch(() => void 0);
    clearBufferCache().catch(() => void 0);
    set({
      images: [],
      rows: [],
      activeIndex: -1,
      phase: 'empty',
      threshold: defaultThreshold(),
      pendingScalePrompt: null,
      globalRange: null,
      ingest: { total: 0, completed: 0, errors: [] },
      metadataPanel: { open: false, imageId: null },
      previousImageId: null,
    });
  },

  skipByKeywords: (input) => {
    const tokens = parseKeywordInput(input);
    if (tokens.length === 0) return 0;

    const s = get();
    const skippedPendingIds = new Set<string>();
    const skippedIds = new Set<string>();
    const images = s.images.map((img) => {
      if (img.status !== 'pending' && img.status !== 'measured') return img;
      const name = img.fileName.toLowerCase();
      const matches = tokens.some((t) => name.includes(t));
      if (!matches) return img;
      skippedIds.add(img.id);
      if (img.status === 'pending') skippedPendingIds.add(img.id);
      return {
        ...img,
        status: 'skipped' as const,
        wasMeasured: img.status === 'measured' || undefined,
      };
    });

    const existing = new Set(s.skipKeywordFilters);
    const mergedFilters = [...s.skipKeywordFilters];
    for (const t of tokens) {
      if (!existing.has(t)) {
        existing.add(t);
        mergedFilters.push(t);
      }
    }

    // Only delete rows for images that were pending (not measured)
    const rows = skippedPendingIds.size > 0
      ? s.rows.filter((r) => !skippedPendingIds.has(r.imageId))
      : s.rows;

    set({ images, rows, skipKeywordFilters: mergedFilters });

    const activeImage = images[s.activeIndex];
    if (activeImage && activeImage.status !== 'pending' && activeImage.status !== 'measured') {
      get().nextImage();
    }

    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }

    return skippedIds.size;
  },

  removeSkipKeywordFilter: (keyword) => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return 0;
    const s = get();
    if (!s.skipKeywordFilters.includes(normalized)) return 0;

    let anyPending = false;
    const restoredIds = new Set<string>();
    const images = s.images.map((img) => {
      if (img.status !== 'skipped') return img;
      const name = img.fileName.toLowerCase();
      if (!name.includes(normalized)) return img;
      restoredIds.add(img.id);
      const restored = img.wasMeasured ? 'measured' as const : 'pending' as const;
      if (restored === 'pending') anyPending = true;
      return { ...img, status: restored, wasMeasured: undefined };
    });

    const skipKeywordFilters = s.skipKeywordFilters.filter((k) => k !== normalized);
    const phase: SessionState['phase'] =
      anyPending && s.phase === 'done' ? 'working' : s.phase;

    set({ images, skipKeywordFilters, phase });
    triggerSmartHydration(get, set);

    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }

    return restoredIds.size;
  },

  unskipByKeywords: (input) => {
    const tokens = parseKeywordInput(input);
    if (tokens.length === 0) return 0;

    const s = get();
    let anyPending = false;
    const restoredIds = new Set<string>();
    const images = s.images.map((img) => {
      if (img.status !== 'skipped') return img;
      const name = img.fileName.toLowerCase();
      const matches = tokens.some((t) => name.includes(t));
      if (!matches) return img;
      restoredIds.add(img.id);
      const restored = img.wasMeasured ? 'measured' as const : 'pending' as const;
      if (restored === 'pending') anyPending = true;
      return { ...img, status: restored, wasMeasured: undefined };
    });

    if (restoredIds.size === 0) return 0;

    const phase: SessionState['phase'] = anyPending && s.phase === 'done' ? 'working' : s.phase;
    set({ images, phase });
    triggerSmartHydration(get, set);

    if (get().normalizationMode === 'global') {
      reconcileGlobalNormalization(get, set).catch(() => void 0);
    }

    return restoredIds.size;
  },

  measureAndNext: async () => {
    const s = get();
    const img = s.images[s.activeIndex];
    if (!img || !img.gray) return;

    const input = buildMeasureInput(img, s.threshold, s.activeIndex, s.imagingMode);
    if (!input) {
      const row = buildMeasurementRow(img, s.imagingMode, s.threshold, s.activeIndex);
      if (!row) return;
      const images = s.images.slice();
      images[s.activeIndex] = { ...img, status: 'measured' };
      set({ images, rows: [...s.rows, row], error: null });
      get().nextImage();
      return;
    }

    try {
      const results = await measureBatchInWorkers([input]);
      const r = results[0];
      if (r?.row) {
        const images = get().images.slice();
        images[s.activeIndex] = { ...images[s.activeIndex], status: 'measured' };
        set({ images, rows: [...get().rows, r.row as unknown as MeasurementRow], error: null });
      }
    } catch {
      const row = buildMeasurementRow(img, s.imagingMode, s.threshold, s.activeIndex);
      if (!row) return;
      const images = get().images.slice();
      images[s.activeIndex] = { ...images[s.activeIndex], status: 'measured' };
      set({ images, rows: [...get().rows, row], error: null });
    }

    get().nextImage();
  },

  measureOnly: async () => {
    const s = get();
    const img = s.images[s.activeIndex];
    if (!img || !img.gray) return;

    const input = buildMeasureInput(img, s.threshold, s.activeIndex, s.imagingMode);
    if (!input) {
      const row = buildMeasurementRow(img, s.imagingMode, s.threshold, s.activeIndex);
      if (!row) return;
      const images = s.images.slice();
      images[s.activeIndex] = { ...img, status: 'measured' };
      set({ images, rows: [...s.rows, row], error: null });
      return;
    }

    try {
      const results = await measureBatchInWorkers([input]);
      const r = results[0];
      if (r?.row) {
        const images = get().images.slice();
        images[s.activeIndex] = { ...images[s.activeIndex], status: 'measured' };
        set({ images, rows: [...get().rows, r.row as unknown as MeasurementRow], error: null });
      }
    } catch {
      const row = buildMeasurementRow(img, s.imagingMode, s.threshold, s.activeIndex);
      if (!row) return;
      const images = get().images.slice();
      images[s.activeIndex] = { ...images[s.activeIndex], status: 'measured' };
      set({ images, rows: [...get().rows, row], error: null });
    }
  },

  measureAllPending: async () => {
    const s = get();
    const pendingIndices: number[] = [];
    s.images.forEach((img, i) => {
      if (img.status === 'pending') pendingIndices.push(i);
    });
    if (pendingIndices.length === 0) return;

    const result = await measureBatchPipelined(get, set, pendingIndices, s.threshold);
    const batchId = crypto.randomUUID();
    const batchTime = Date.now();
    for (const row of result.newRows) {
      row.batchId = batchId;
      row.measuredAt = batchTime;
    }
    result.newRows.sort((a, b) => a.queueIndex - b.queueIndex);

    set((cur) => {
      const imgs = cur.images.slice();
      for (const u of result.measuredUpdates) {
        imgs[u.index] = {
          ...imgs[u.index],
          status: 'measured',
          lastViewedThreshold: { min: u.threshold.min, max: u.threshold.max },
        };
      }
      const anyPendingLeft = imgs.some((img) => img.status === 'pending');
      const errorMsg =
        result.brightfieldSkipped > 0
          ? `Measured ${result.newRows.length} image${result.newRows.length === 1 ? '' : 's'}. Skipped ${result.brightfieldSkipped} brightfield image${result.brightfieldSkipped === 1 ? '' : 's'} (draw an ROI first).`
          : null;
      return {
        images: imgs,
        rows: [...cur.rows, ...result.newRows],
        error: errorMsg,
        phase: anyPendingLeft ? 'working' : 'done',
      };
    });

    const finalImages = get().images;
    const anyPendingLeft = finalImages.some((img) => img.status === 'pending');
    if (anyPendingLeft) {
      get().nextImage();
    }
    triggerSmartHydration(get, set);
  },

  measureAll: async () => {
    const s = get();
    if (s.images.length === 0) return;

    const indices = s.images
      .map((img, i) => (img.status !== 'skipped' ? i : -1))
      .filter((i) => i >= 0);

    const result = await measureBatchPipelined(get, set, indices, s.threshold);
    const batchId = crypto.randomUUID();
    const batchTime = Date.now();
    for (const row of result.newRows) {
      row.batchId = batchId;
      row.measuredAt = batchTime;
    }
    result.newRows.sort((a, b) => a.queueIndex - b.queueIndex);

    set((cur) => {
      const imgs = cur.images.slice();
      for (const u of result.measuredUpdates) {
        imgs[u.index] = {
          ...imgs[u.index],
          status: 'measured',
          lastViewedThreshold: { min: u.threshold.min, max: u.threshold.max },
        };
      }
      const errorMsg =
        result.brightfieldSkipped > 0
          ? `Measured ${result.newRows.length} image${result.newRows.length === 1 ? '' : 's'}. Skipped ${result.brightfieldSkipped} brightfield image${result.brightfieldSkipped === 1 ? '' : 's'} (draw an ROI first).`
          : null;
      return {
        images: imgs,
        rows: [...cur.rows, ...result.newRows],
        error: errorMsg,
        phase: imgs.some((img) => img.status === 'pending') ? 'working' : 'done',
      };
    });
    triggerSmartHydration(get, set);
  },

  addRoi: (roi) => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    const seeded =
      isClosedRoi(roi) && !(roi as { threshold?: ThresholdRange }).threshold
        ? { ...roi, threshold: { min: s.threshold.min, max: s.threshold.max } }
        : roi;
    const rois = [...img.rois, seeded];
    const images = s.images.slice();
    images[idx] = { ...img, rois, selectedRoiIndex: rois.length - 1 };
    set({ images });
  },

  addPointClick: (p, variant = 'point') => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    const selIdx = img.selectedRoiIndex;
    const selected = selIdx >= 0 ? img.rois[selIdx] : null;
    const rois = img.rois.slice();
    let newSelIdx = selIdx;
    if (selected && selected.type === variant) {
      rois[selIdx] = { type: variant, points: [...selected.points, p] };
    } else {
      rois.push({ type: variant, points: [p] });
      newSelIdx = rois.length - 1;
    }
    const images = s.images.slice();
    images[idx] = { ...img, rois, selectedRoiIndex: newSelIdx };
    set({ images });
  },

  updateSelectedRoi: (roi) => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    if (img.selectedRoiIndex < 0) return;
    const rois = img.rois.slice();
    rois[img.selectedRoiIndex] = roi;
    const images = s.images.slice();
    images[idx] = { ...img, rois };
    set({ images });
  },

  clearSelectedRoi: () => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    if (img.selectedRoiIndex < 0) return;
    const rois = img.rois.slice();
    rois.splice(img.selectedRoiIndex, 1);
    const images = s.images.slice();
    images[idx] = { ...img, rois, selectedRoiIndex: -1 };
    set({ images });
  },

  clearAllRois: () => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    if (img.rois.length === 0) return;
    const images = s.images.slice();
    images[idx] = { ...img, rois: [], selectedRoiIndex: -1 };
    set({ images });
  },

  setSelectedRoiIndex: (index) => {
    const s = get();
    const idx = s.activeIndex;
    if (idx < 0) return;
    const img = s.images[idx];
    const clamped = index < 0 || index >= img.rois.length ? -1 : index;
    if (clamped === img.selectedRoiIndex) return;
    const images = s.images.slice();
    images[idx] = { ...img, selectedRoiIndex: clamped };
    set({ images });
  },

  setActiveTool: (t) => set({ activeTool: t }),

  setImagingMode: (mode) => {
    set({ imagingMode: mode });
  },

  setCalibration: (imageId, calibration) => {
    const s = get();
    const images = s.images.map((img) =>
      img.id === imageId ? { ...img, calibration } : img,
    );
    const rows = s.rows.map((r) =>
      r.imageId !== imageId ? r : recalibrateRow(r, calibration),
    );
    set({ images, rows });
  },

  setCalibrationForAll: (calibration) => {
    const s = get();
    const images = s.images.map((img) => ({ ...img, calibration }));
    const rows = s.rows.map((r) => recalibrateRow(r, calibration));
    set({ images, rows });
  },

  requestScalePromptFromRoi: () => {
    const s = get();
    const img = s.images[s.activeIndex];
    if (!img) return;
    const roi = selectedRoi(img);
    if (!roi || !isOpenRoi(roi)) return;
    const pixelLength = roiPathLengthPx(roi);
    if (pixelLength < 3) return;
    set({ pendingScalePrompt: { imageId: img.id, pixelLength } });
  },

  clearScalePrompt: () => set({ pendingScalePrompt: null }),

  deleteRow: (id) => {
    const s = get();
    set({ rows: s.rows.filter((r) => r.id !== id) });
  },
  clearResults: () => set({ rows: [] }),

  resetAllMeasurements: () => {
    const s = get();
    const hasMeasured = s.images.some(
      (img) => img.status === 'measured' || img.wasMeasured,
    );
    if (!hasMeasured) return;

    const images = s.images.map((img) => {
      if (img.status === 'measured') return { ...img, status: 'pending' as const };
      if (img.wasMeasured) return { ...img, wasMeasured: undefined };
      return img;
    });

    const anyPending = images.some((img) => img.status === 'pending');
    const firstPending = images.findIndex((img) => img.status === 'pending');
    const nextActive = firstPending >= 0 ? firstPending : s.activeIndex;

    set({
      images,
      activeIndex: nextActive,
      phase: anyPending ? 'working' : s.phase,
      error: null,
    });
  },

  setImageColorLabel: (imageId, label) => {
    const s = get();
    const images = s.images.map((img) =>
      img.id === imageId ? { ...img, userColorLabel: label } : img,
    );
    set({ images });
  },

  setImageDisplayGain: (imageId, gain) => {
    applyImageDisplayGain(get, set, imageId, gain, 'slider');
  },

  resetImageDisplayGain: (imageId) => {
    const target = get().images.find((i) => i.id === imageId);
    if (!target || target.displayGain == null) return;
    applyImageDisplayGain(get, set, imageId, DISPLAY_GAIN_DEFAULT, 'reset');
  },

  inheritDisplayGainFromPrevious: (imageId) => {
    const s = get();
    const prevId = s.previousImageId;
    if (!prevId || prevId === imageId) return;
    const prev = s.images.find((i) => i.id === prevId);
    if (!prev) return;
    const target = s.images.find((i) => i.id === imageId);
    if (!target) return;
    const desired = prev.displayGain ?? DISPLAY_GAIN_DEFAULT;
    const current = target.displayGain ?? DISPLAY_GAIN_DEFAULT;
    if (desired === current) return;
    applyImageDisplayGain(get, set, imageId, desired, 'inherit');
  },

  applyDisplayGainToAll: (gain) => {
    const clamped = clampDisplayGain(gain);
    const ids = get()
      .images.filter((img) => img.status !== 'skipped')
      .map((img) => img.id);
    for (const id of ids) {
      applyImageDisplayGain(get, set, id, clamped, 'slider');
    }
  },

  hydrateImage: async (imageId) => {
    const s = get();
    const img = s.images.find((i) => i.id === imageId);
    if (!img || isHydrated(img)) return;
    const result = await ensureHydrated(s.images, imageId);
    const freshImg = get().images.find((i) => i.id === imageId);
    if (freshImg && isHydrated(freshImg)) return;
    if (result.changed && result.target) {
      let restored = result.target;
      if (restored.grayscaleModeUserSet && restored.rgba) {
        const newGray = rgbaToGray8(
          restored.rgba.data,
          restored.width,
          restored.height,
          restored.grayscaleMode,
        );
        restored = { ...restored, gray: newGray };
      }
      if (restored.previewMeanIntensity == null) {
        if (restored.previewStretchContext) {
          restored = { ...restored, previewMeanIntensity: computeNativeMean(restored.previewStretchContext) };
        } else if (restored.previewGray) {
          restored = { ...restored, previewMeanIntensity: computePreviewMeanFromGray(restored.previewGray.data) };
        }
      }
      if (get().normalizationMode === 'global' && get().globalRange) {
        const transform = buildGlobalStretchTransform(get().globalRange!);
        restored = await transform(restored);
      } else if (get().normalizationMode === 'per-image') {
        const transform = buildLinearStretchTransform();
        restored = await transform(restored);
      }
      set((cur) => ({
        images: cur.images.map((im) =>
          im.id === imageId ? restored : im,
        ),
      }));
      triggerSmartHydration(get, set);
      if (restored.tiffStretchModeUserSet && restored.tiffStretchContext) {
        const mode = restored.tiffStretchMode ?? DEFAULT_TIFF_STRETCH_MODE;
        await applyTiffStretchToImageForce(get, set, imageId, mode, true).catch(() => void 0);
      }
      const gain = get().images.find((i) => i.id === imageId)?.displayGain;
      if (gain != null && gain !== DISPLAY_GAIN_DEFAULT) {
        rebuildPreviewForGain(get, set, imageId);
      }
    }
  },

  setGrayscaleModeForAll: (mode) => {
    const s = get();
    const hydratedUpdates: string[] = [];
    const dehydratedIds: string[] = [];

    const images = s.images.map((img) => {
      if (img.status === 'skipped' || img.status === 'loading' || img.status === 'error') return img;
      if (img.grayscaleMode === mode && img.grayscaleModeUserSet) return img;
      if (isHydrated(img) && img.rgba) {
        hydratedUpdates.push(img.id);
        const gray = rgbaToGray8(img.rgba.data, img.width, img.height, mode);
        return {
          ...img,
          grayscaleMode: mode,
          grayscaleModeUserSet: true,
          gray,
        };
      }
      if (!isHydrated(img)) {
        dehydratedIds.push(img.id);
      }
      return { ...img, grayscaleMode: mode, grayscaleModeUserSet: true };
    });
    set({ images });

    for (const id of hydratedUpdates) {
      const updated = get().images.find((i) => i.id === id);
      if (updated && updated.gray) {
        const entry = buildPersistEntry(updated);
        if (entry) flushPendingPersists([entry]).catch(() => void 0);
        const prev = updated.previewBitmap;
        buildPreviewBitmap(updated.gray.data, updated.width, updated.height).then(
          ({ bitmap, previewGray }) => {
            const previewMeanIntensity = computePreviewMeanFromGray(previewGray.data);
            set({
              images: get().images.map((i) =>
                i.id === id ? { ...i, previewBitmap: bitmap, previewGray, previewMeanIntensity } : i,
              ),
            });
            if (prev && typeof prev.close === 'function') prev.close();
          },
        );
      }
    }

    if (dehydratedIds.length > 0) {
      const widths = new Map<string, number>();
      const heights = new Map<string, number>();
      for (const img of get().images) {
        widths.set(img.id, img.width);
        heights.set(img.id, img.height);
      }

      runBatch({
        imageIds: dehydratedIds,
        widths,
        heights,
        label: 'Applying grayscale mode',
        processFn: async (_imageId, buffers) => {
          if (!buffers.rgba) return null;
          const newGray = rgbaToGray8(buffers.rgba.data, buffers.rgba.width, buffers.rgba.height, mode);
          const payload: CachedBuffers = { gray: newGray.data.buffer.slice(0) };
          payload.rgba = buffers.rgba.data.buffer.slice(0);
          if (buffers.tiffStretchContext) {
            const ctx = buffers.tiffStretchContext;
            payload.tiffRaw = ctx.raw.buffer.slice(0);
            payload.tiffKind = ctx.kind;
            payload.tiffPixelCount = ctx.pixelCount;
            payload.tiffInvert = ctx.invert;
            payload.tiffLittleEndian = ctx.littleEndian;
          }
          return payload;
        },
        onProgress: (progress) => set({ batchProgress: progress }),
        onItemDone: (imageId, updatedGray) => {
          const prev = get().images.find((i) => i.id === imageId)?.previewBitmap;
          buildPreviewBitmap(updatedGray.data, updatedGray.width, updatedGray.height).then(
            ({ bitmap, previewGray }) => {
              if (!bitmap) return;
              set({
                images: get().images.map((i) =>
                  i.id === imageId ? { ...i, previewBitmap: bitmap, previewGray } : i,
                ),
              });
              if (prev && typeof prev.close === 'function') prev.close();
            },
          );
        },
      }).catch(() => void 0);
    }
  },

  abortBatch: () => {
    abortBatchProcessor();
    set({ batchProgress: BATCH_IDLE });
  },
}));

function triggerEviction(get: StoreGet, set: StoreSet): void {
  awaitEviction(get, set).catch(() => void 0);
}

async function awaitEviction(get: StoreGet, set: StoreSet): Promise<void> {
  const s = get();
  const activeId = s.images[s.activeIndex]?.id ?? null;
  const skippedIds = new Set(s.images.filter((img) => img.status === 'skipped').map((img) => img.id));
  const evictedIds = await persistAndGetEvictedIds(s.images, activeId, skippedIds);
  if (evictedIds.length === 0) return;
  const evictedSet = new Set(evictedIds);
  set((current) => ({
    images: current.images.map((img) =>
      evictedSet.has(img.id) && isHydrated(img) ? shellify(img) : img,
    ),
  }));
}

let prevHotSet: Set<string> = new Set();

function isIngestComplete(s: { ingest: IngestProgress }): boolean {
  return s.ingest.total === 0 || s.ingest.completed >= s.ingest.total;
}

function buildGlobalStretchTransform(range: GlobalRange): PostRestoreTransform {
  return async (img: SessionImage): Promise<SessionImage> => {
    if (!img.tiffStretchContext) return img;
    if (!isGlobalNormalizationEligible(img.tiffStretchContext)) return img;
    if (img.tiffSource?.displayMin === range.min && img.tiffSource?.displayMax === range.max) return img;
    try {
      const result = await applyTiffStretchFixedAsync(img.tiffStretchContext, range.min, range.max);
      const newGray = { width: img.width, height: img.height, data: result.gray };
      const nextTiffSource = img.tiffSource
        ? { ...img.tiffSource, displayMin: result.displayMin, displayMax: result.displayMax, stretchMethod: result.stretchMethod }
        : img.tiffSource;
      const { bitmap, previewGray } = await buildPreviewBitmap(newGray.data, img.width, img.height);
      const prev = img.previewBitmap;
      if (prev && typeof prev.close === 'function') prev.close();
      return { ...img, gray: newGray, tiffSource: nextTiffSource, previewBitmap: bitmap ?? img.previewBitmap, previewGray: previewGray ?? img.previewGray };
    } catch {
      return img;
    }
  };
}

function buildLinearStretchTransform(): PostRestoreTransform {
  return async (img: SessionImage): Promise<SessionImage> => {
    if (!img.tiffStretchContext) return img;
    if (!isGlobalNormalizationEligible(img.tiffStretchContext)) return img;
    try {
      const mode = img.tiffStretchMode ?? DEFAULT_TIFF_STRETCH_MODE;
      const result = await applyTiffStretchAsync(img.tiffStretchContext, mode);
      const newGray = { width: img.width, height: img.height, data: result.gray };
      const nextTiffSource = img.tiffSource
        ? { ...img.tiffSource, displayMin: result.displayMin, displayMax: result.displayMax, stretchMethod: result.stretchMethod }
        : img.tiffSource;
      const { bitmap, previewGray } = await buildPreviewBitmap(newGray.data, img.width, img.height);
      const prev = img.previewBitmap;
      if (prev && typeof prev.close === 'function') prev.close();
      return { ...img, gray: newGray, tiffSource: nextTiffSource, previewBitmap: bitmap ?? img.previewBitmap, previewGray: previewGray ?? img.previewGray };
    } catch {
      return img;
    }
  };
}

async function attemptRehydration(get: StoreGet, set: StoreSet, imageId: string): Promise<void> {
  const img = get().images.find((i) => i.id === imageId);
  if (!img || img.status !== 'error' || img.decodeError !== 'Buffer cache miss') return;
  // Mark as non-hydrated so rehydrateImage will attempt IDB read
  const dehydrated: SessionImage = { ...img, hydrated: false, status: 'pending', decodeError: undefined };
  const restored = await rehydrateImage(dehydrated);
  if (restored.status === 'error') return;
  // Apply stretch transform for 16-bit images
  let final = restored;
  const s = get();
  if (restored.tiffStretchContext) {
    const postRestore = s.normalizationMode === 'global' && s.globalRange
      ? buildGlobalStretchTransform(s.globalRange)
      : buildLinearStretchTransform();
    final = await postRestore(restored);
  }
  set((cur) => ({
    images: cur.images.map((i) => (i.id === imageId ? final : i)),
  }));
}

function sortAwareIds(s: SessionStore): { ids: string[]; sortedActiveIndex: number } {
  const sorted = sortedImages(s.images, s.previewSortMode);
  const ids = sorted.map((e) => e.image.id);
  const activeId = s.images[s.activeIndex]?.id;
  const sortedActiveIndex = activeId != null ? ids.indexOf(activeId) : -1;
  return { ids, sortedActiveIndex };
}

function triggerSmartHydration(get: StoreGet, set: StoreSet): void {
  const s = get();
  if (!isIngestComplete(s)) {
    triggerEviction(get, set);
    return;
  }
  const { ids: imageIds, sortedActiveIndex } = sortAwareIds(s);
  const skippedIds = new Set(s.images.filter((img) => img.status === 'skipped').map((img) => img.id));
  const nextHot = computeHotSet(imageIds, sortedActiveIndex, skippedIds);
  const delta = computeDelta(prevHotSet, nextHot);
  prevHotSet = nextHot;

  if (delta.toHydrate.length === 0 && delta.toEvict.length === 0) return;
  const hydratedIds = delta.toHydrate;
  notifyReconcilerBusy();

  const postRestore: PostRestoreTransform | undefined =
    s.normalizationMode === 'global' && s.globalRange
      ? buildGlobalStretchTransform(s.globalRange)
      : buildLinearStretchTransform();

  reconcile(hydratedIds, delta.toEvict, get, set, postRestore)
    .catch(() => void 0)
    .finally(() => notifyReconcilerIdle());
}


function applyImageDisplayGain(
  get: StoreGet,
  set: StoreSet,
  imageId: string,
  gain: number,
  source: DisplayGainSource,
): void {
  const clamped = clampDisplayGain(gain);
  const s = get();
  const target = s.images.find((i) => i.id === imageId);
  if (!target) return;
  const current = target.displayGain ?? DISPLAY_GAIN_DEFAULT;
  if (current === clamped && source !== 'reset') return;
  const next: SessionImage =
    clamped === DISPLAY_GAIN_DEFAULT
      ? (() => {
          const { displayGain: _ignored, ...rest } = target;
          void _ignored;
          return rest as SessionImage;
        })()
      : { ...target, displayGain: clamped };
  const images = s.images.map((img) => (img.id === imageId ? next : img));
  set({ images });
  rebuildPreviewForGain(get, set, imageId);
}

function rebuildPreviewForGain(
  get: StoreGet,
  set: StoreSet,
  imageId: string,
): void {
  const img = get().images.find((i) => i.id === imageId);
  if (!img || img.width === 0 || img.height === 0 || !img.gray) return;
  const rawGray = img.gray.data;
  const previewGray = buildPreviewGray(rawGray, img.width, img.height);
  const gain = img.displayGain ?? DISPLAY_GAIN_DEFAULT;
  const source = applyGainToGray(rawGray, gain);
  const prev = img.previewBitmap;
  buildPreviewBitmap(source, img.width, img.height).then(({ bitmap }) => {
    if (!bitmap) return;
    set({
      images: get().images.map((i) =>
        i.id === imageId ? { ...i, previewBitmap: bitmap, previewGray } : i,
      ),
    });
    if (prev && typeof prev.close === 'function') prev.close();
  });
}

type StoreGet = () => SessionStore;
type StoreSet = (partial: Partial<SessionStore> | ((s: SessionStore) => Partial<SessionStore>)) => void;

const PIPELINE_CHUNK_SIZE = 32;

interface MeasureBatchPipelineResult {
  newRows: MeasurementRow[];
  brightfieldSkipped: number;
  measuredUpdates: Array<{ index: number; threshold: { min: number; max: number } }>;
}

async function measureBatchPipelined(
  get: StoreGet,
  _set: StoreSet,
  indices: number[],
  globalThreshold: ThresholdRange,
): Promise<MeasureBatchPipelineResult> {
  const imagingMode = get().imagingMode;
  const newRows: MeasurementRow[] = [];
  let brightfieldSkipped = 0;
  const measuredUpdates: MeasureBatchPipelineResult['measuredUpdates'] = [];

  // Split indices into chunks to pipeline IDB reads with worker dispatch
  for (let chunkStart = 0; chunkStart < indices.length; chunkStart += PIPELINE_CHUNK_SIZE) {
    const chunk = indices.slice(chunkStart, chunkStart + PIPELINE_CHUNK_SIZE);

    // Identify which images in this chunk need IDB hydration
    const coldIds: string[] = [];
    const coldIndexMap = new Map<string, number>();
    for (const i of chunk) {
      const img = get().images[i];
      if (!isHydrated(img)) {
        coldIds.push(img.id);
        coldIndexMap.set(img.id, i);
      }
    }

    // Batch-read all cold buffers in a single IDB transaction
    let restoredBuffers: Map<string, { gray: ArrayBuffer; rgba?: ArrayBuffer; tiffRaw?: ArrayBuffer; tiffKind?: string; tiffPixelCount?: number; tiffInvert?: boolean; tiffLittleEndian?: boolean }> = new Map();
    if (coldIds.length > 0) {
      try {
        restoredBuffers = await restoreBuffersBatch(coldIds);
      } catch {
        // IDB failed -- these images will fallback to main-thread measurement
      }
    }

    // Build worker inputs for this chunk
    const workerInputs: Array<{ index: number; input: MeasureImageInput; threshold: ThresholdRange }> = [];
    const fallbackIndices: number[] = [];

    for (const i of chunk) {
      const img = get().images[i];
      const snap = img.lastViewedThreshold;
      const imgRange = snap ? { min: snap.min, max: snap.max } : globalThreshold;

      if (img.gray) {
        // Hot image: must copy since transfer detaches the backing buffer
        const input = buildMeasureInputDirect(img, new Uint8Array(img.gray.data), imgRange, i, imagingMode);
        workerInputs.push({ index: i, input, threshold: imgRange });
      } else if (restoredBuffers.has(img.id)) {
        // Cold image: use IDB buffer directly (not stored in state, safe to transfer)
        const cached = restoredBuffers.get(img.id)!;
        const grayData = new Uint8Array(cached.gray);
        const input = buildMeasureInputDirect(img, grayData, imgRange, i, imagingMode);
        workerInputs.push({ index: i, input, threshold: imgRange });
      } else {
        fallbackIndices.push(i);
      }
    }

    // Dispatch chunk to workers
    if (workerInputs.length > 0) {
      try {
        const results = await measureBatchInWorkers(workerInputs.map((w) => w.input));
        for (let ri = 0; ri < results.length; ri++) {
          const wr = results[ri];
          const wi = workerInputs[ri];
          if (wr.row) {
            newRows.push(wr.row as unknown as MeasurementRow);
            measuredUpdates.push({ index: wi.index, threshold: wi.threshold });
          } else if (wr.isBrightfieldSkipped) {
            brightfieldSkipped++;
          }
        }
      } catch {
        for (const w of workerInputs) fallbackIndices.push(w.index);
      }
    }

    // Fallback: main-thread measurement for images that couldn't go to workers
    for (const i of fallbackIndices) {
      const img = get().images[i];
      const snap = img.lastViewedThreshold;
      const imgRange = snap ? { min: snap.min, max: snap.max } : globalThreshold;
      // Ensure hydration for fallback
      if (!isHydrated(img)) {
        const result = await ensureHydrated(get().images, img.id);
        if (result.changed && result.target) {
          _set((cur) => ({
            images: cur.images.map((im) =>
              im.id === result.target!.id ? result.target! : im,
            ),
          }));
        }
      }
      const current = get().images[i];
      const row = buildMeasurementRow(current, get().imagingMode, imgRange, i);
      if (!row) {
        if (get().imagingMode === 'brightfield') brightfieldSkipped++;
        continue;
      }
      newRows.push(row);
      measuredUpdates.push({ index: i, threshold: imgRange });
    }
  }

  return { newRows, brightfieldSkipped, measuredUpdates };
}

function buildMeasureInputDirect(
  img: SessionImage,
  grayData: Uint8Array,
  threshold: ThresholdRange,
  queueIndex: number,
  imagingMode: ImageMode,
): MeasureImageInput {
  return {
    imageId: img.id,
    fileName: img.fileName,
    gray: grayData,
    width: img.width,
    height: img.height,
    rois: img.rois,
    mode: imagingMode,
    threshold,
    calibration: img.calibration,
    queueIndex,
  };
}

function buildMeasureInput(
  img: SessionImage,
  threshold: ThresholdRange,
  queueIndex: number,
  imagingMode: ImageMode,
): MeasureImageInput | null {
  if (!img.gray) return null;
  return buildMeasureInputDirect(img, new Uint8Array(img.gray.data), threshold, queueIndex, imagingMode);
}

function buildMeasurementRow(
  img: SessionImage,
  mode: ImageMode,
  threshold: ThresholdRange,
  queueIndex: number,
): MeasurementRow | null {
  if (!img.gray) return null;
  const nowIso = new Date().toISOString();
  const base = {
    id: newUuid(),
    imageId: img.id,
    fileName: img.fileName,
    queueIndex,
    measuredAtIso: nowIso,
    measuredAt: Date.now(),
    batchId: null as string | null,
    pixelWidth: img.calibration.pixelWidth,
    pixelHeight: img.calibration.pixelHeight,
    unit: img.calibration.unit,
    imageMode: mode,
  };

  const closedRois = img.rois.filter(isClosedRoi);
  const openRois = img.rois.filter(isOpenRoi);
  const pointRois = img.rois.filter(isPointRoi);
  const totalRois = img.rois.length;
  const combinedRoiType: RoiType =
    totalRois === 0 ? 'full' : totalRois === 1 ? img.rois[0].type : 'combined';
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
        lengthCal: hasLength ? pixelsToLength(lengthPx, img.calibration) : null,
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
    const unionMask = unionClosedRoiMask(closedRois, img.width, img.height);
    const result = measureArea(unionMask);
    const summedLengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
    const lengthPx = summedLengthPx > 0 ? summedLengthPx : null;
    return {
      ...base,
      profile: 'brightfield',
      roiType: combinedRoiType,
      roiAreaPx: result.roiAreaPx,
      lengthPx,
      lengthCal: lengthPx == null ? null : pixelsToLength(lengthPx, img.calibration),
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

  // Fluorescence.
  if (totalRois > 0 && closedRois.length === 0 && openRois.length > 0) {
    const lengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
    return {
      ...base,
      profile: 'fluorescence',
      roiType: combinedRoiType,
      roiAreaPx: 0,
      lengthPx,
      lengthCal: pixelsToLength(lengthPx, img.calibration),
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
    closedRois.length > 0 && hasAnyClosedRoi(img.rois)
      ? buildSegmentedThresholdMask(
          img.gray.data,
          buildRoiOwnerMap(img.rois, img.width, img.height),
          range,
          img.rois.map((r) =>
            isClosedRoi(r) ? (r as { threshold?: ThresholdRange }).threshold ?? range : null,
          ),
        )
      : buildThresholdMask(img.gray.data, range);
  const maskData =
    closedRois.length > 0
      ? unionClosedRoiMask(closedRois, img.width, img.height)
      : fullImageMask(img.width, img.height);
  const result = measure(img.gray.data, thresholdMask, maskData);
  const summedLengthPx = openRois.reduce((s, r) => s + roiPathLengthPx(r), 0);
  const lengthPx = summedLengthPx > 0 ? summedLengthPx : null;

  return {
    ...base,
    profile: 'fluorescence',
    roiType: combinedRoiType,
    roiAreaPx: result.roiAreaPx,
    lengthPx,
    lengthCal: lengthPx == null ? null : pixelsToLength(lengthPx, img.calibration),
    areaCal: null,
    thresholdSource: 'threshold',
    thresholdMin: range.min,
    thresholdMax: range.max,
    thresholdedAreaPx: result.thresholdedAreaPx,
    thresholdedAreaCal: pixelsToArea(result.thresholdedAreaPx, img.calibration),
    integratedDensity: result.integratedDensity,
    count,
  };
}

async function applyTiffStretchToImage(
  get: StoreGet,
  set: StoreSet,
  imageId: string,
  mode: TiffStretchMode,
  userSet: boolean,
): Promise<void> {
  const s = get();
  const target = s.images.find((i) => i.id === imageId);
  if (!target || !target.tiffStretchContext) return;
  if (
    target.tiffStretchMode === mode &&
    (target.tiffStretchModeUserSet ?? false) === userSet
  ) {
    return;
  }

  const result = await applyTiffStretchAsync(target.tiffStretchContext, mode);
  const latest = get().images.find((i) => i.id === imageId);
  if (!latest) return;
  const newGray = { width: target.width, height: target.height, data: result.gray };
  const nextTiffSource = target.tiffSource
    ? {
        ...target.tiffSource,
        displayMin: result.displayMin,
        displayMax: result.displayMax,
        stretchMethod: result.stretchMethod,
      }
    : target.tiffSource;

  const images = get().images.map((img) =>
    img.id !== imageId
      ? img
      : {
          ...img,
          gray: newGray,
          tiffStretchMode: mode,
          tiffStretchModeUserSet: userSet,
          tiffSource: nextTiffSource,
        },
  );
  set({ images });

  const updated = get().images.find((i) => i.id === imageId);
  if (!updated || !updated.gray) return;
  const entry = buildPersistEntry(updated);
  if (entry) flushPendingPersists([entry]).catch(() => void 0);
  const prev = updated.previewBitmap;
  buildPreviewBitmap(updated.gray.data, updated.width, updated.height).then(({ bitmap, previewGray }) => {
    if (!bitmap) return;
    set({
      images: get().images.map((i) =>
        i.id === imageId ? { ...i, previewBitmap: bitmap, previewGray } : i,
      ),
    });
    if (prev && typeof prev.close === 'function') prev.close();
  });
}

function thresholdRestoredFromImage(
  threshold: ThresholdRange,
  image: SessionImage | undefined,
): ThresholdRange {
  if (!image) return threshold;
  const snap = image.lastViewedThreshold;
  if (!snap) return threshold;
  if (threshold.min === snap.min && threshold.max === snap.max) return threshold;
  return { min: snap.min, max: snap.max };
}

function snapshotThresholdOnActive(
  images: SessionImage[],
  activeIndex: number,
  range: ThresholdRange,
  imagingMode: ImageMode = 'fluorescence',
): SessionImage[] {
  if (activeIndex < 0 || activeIndex >= images.length) return images;
  if (imagingMode === 'brightfield') return images;
  const target = images[activeIndex];
  const current = target.lastViewedThreshold;
  if (current && current.min === range.min && current.max === range.max) return images;
  const next = images.slice();
  next[activeIndex] = { ...target, lastViewedThreshold: { min: range.min, max: range.max } };
  return next;
}

function rebuildPreviewBitmapFromGray(
  get: StoreGet,
  set: StoreSet,
  imageId: string,
  grayData: Uint8Array,
  width: number,
  height: number,
  prev: ImageBitmap | null | undefined,
): void {
  if (typeof createImageBitmap !== 'function') return;
  const rgba = new Uint8ClampedArray(grayData.length * 4);
  for (let i = 0; i < grayData.length; i++) {
    const v = grayData[i];
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
  const source = new ImageData(rgba, width, height);
  createImageBitmap(source).then((bitmap) => {
    set({
      images: get().images.map((i) =>
        i.id === imageId ? { ...i, previewBitmap: bitmap } : i,
      ),
    });
    if (prev && typeof prev.close === 'function') prev.close();
  }).catch(() => void 0);
}

function isGlobalNormEligibleFromSource(img: SessionImage): boolean {
  if (isHydrated(img)) return isGlobalNormalizationEligible(img.tiffStretchContext);
  const src = img.tiffSource;
  if (!src) return false;
  const { bitsPerSample, sampleFormat } = src;
  if (bitsPerSample === 16 && (sampleFormat === 'uint' || sampleFormat === 'int')) return true;
  if (bitsPerSample === 32 && sampleFormat === 'float') return true;
  return false;
}

function computeGlobalRange(images: SessionImage[]): GlobalRange | null {
  let min = Infinity;
  let max = -Infinity;
  let minImageId: string | null = null;
  let maxImageId: string | null = null;
  let count = 0;
  for (const img of images) {
    if (img.status === 'skipped') continue;
    if (!isGlobalNormEligibleFromSource(img)) continue;
    const src = img.tiffSource;
    if (!src || src.nativeMin == null || src.nativeMax == null) continue;
    if (!Number.isFinite(src.nativeMin) || !Number.isFinite(src.nativeMax)) continue;
    if (src.nativeMin < min) {
      min = src.nativeMin;
      minImageId = img.id;
    }
    if (src.nativeMax > max) {
      max = src.nativeMax;
      maxImageId = img.id;
    }
    count++;
  }
  if (count === 0 || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }
  return { min, max, imageCount: count, minImageId, maxImageId };
}

async function reconcileGlobalNormalization(
  get: StoreGet,
  set: StoreSet,
): Promise<void> {
  const s = get();
  const range = computeGlobalRange(s.images);
  set({ globalRange: range });
  if (!range) return;

  const hydratedTargets = s.images.filter(
    (img) =>
      img.status !== 'skipped' &&
      isHydrated(img) &&
      isGlobalNormalizationEligible(img.tiffStretchContext) &&
      (img.tiffSource?.displayMin !== range.min || img.tiffSource?.displayMax !== range.max),
  );

  for (const img of hydratedTargets) {
    if (!img.tiffStretchContext) continue;
    try {
      const result = await applyTiffStretchFixedAsync(
        img.tiffStretchContext,
        range.min,
        range.max,
      );
      const latest = get().images.find((i) => i.id === img.id);
      if (!latest) continue;
      const newGray = { width: latest.width, height: latest.height, data: result.gray };
      const nextTiffSource = latest.tiffSource
        ? {
            ...latest.tiffSource,
            displayMin: result.displayMin,
            displayMax: result.displayMax,
            stretchMethod: result.stretchMethod,
          }
        : latest.tiffSource;
      set({
        images: get().images.map((i) =>
          i.id !== img.id
            ? i
            : {
                ...i,
                gray: newGray,
                tiffSource: nextTiffSource,
              },
        ),
      });
      const updated = get().images.find((i) => i.id === img.id);
      if (!updated || !updated.gray) continue;
      buildPreviewBitmap(updated.gray.data, updated.width, updated.height).then(
        ({ bitmap, previewGray }) => {
          if (!bitmap) return;
          set({
            images: get().images.map((i) =>
              i.id === img.id ? { ...i, previewBitmap: bitmap, previewGray } : i,
            ),
          });
        },
      );
    } catch {
      // ignore individual failures
    }
  }

  const dehydratedTargets = s.images.filter(
    (img) =>
      img.status !== 'skipped' &&
      !isHydrated(img) &&
      isGlobalNormEligibleFromSource(img) &&
      img.previewStretchContext &&
      (img.tiffSource?.displayMin !== range.min || img.tiffSource?.displayMax !== range.max),
  );

  if (dehydratedTargets.length > 0) {
    for (const img of dehydratedTargets) {
      const ctx = img.previewStretchContext!;
      const stretchedPreviewData = stretchPreviewContext(ctx, range.min, range.max);
      const previewGray = { data: stretchedPreviewData, width: ctx.width, height: ctx.height };
      const imageId = img.id;
      set({
        images: get().images.map((i) =>
          i.id === imageId ? { ...i, previewGray } : i,
        ),
      });
      rebuildPreviewBitmapFromGray(get, set, imageId, stretchedPreviewData, ctx.width, ctx.height, null);
    }
  }
}

async function restoreAllPerImageStretch(
  get: StoreGet,
  set: StoreSet,
): Promise<void> {
  const allEligible = get().images.filter((img) => img.status !== 'skipped' && isGlobalNormEligibleFromSource(img));
  if (allEligible.length === 0) return;

  for (const img of allEligible) {
    if (isHydrated(img) && img.tiffStretchContext) {
      const mode = img.tiffStretchMode ?? DEFAULT_TIFF_STRETCH_MODE;
      const userSet = img.tiffStretchModeUserSet ?? false;
      await applyTiffStretchToImageForce(get, set, img.id, mode, userSet).catch(() => void 0);
    } else if (!isHydrated(img) && img.previewStretchContext && img.tiffSource && img.tiffSource.nativeMin != null && img.tiffSource.nativeMax != null) {
      const ctx = img.previewStretchContext;
      const stretchedPreviewData = stretchPreviewContext(ctx, img.tiffSource.nativeMin, img.tiffSource.nativeMax);
      const previewGray = { data: stretchedPreviewData, width: ctx.width, height: ctx.height };
      set({
        images: get().images.map((i) =>
          i.id === img.id ? { ...i, previewGray, tiffStretchMode: 'minmax' as const } : i,
        ),
      });
      rebuildPreviewBitmapFromGray(get, set, img.id, stretchedPreviewData, ctx.width, ctx.height, null);
    }
  }
}

async function applyTiffStretchToImageForce(
  get: StoreGet,
  set: StoreSet,
  imageId: string,
  mode: TiffStretchMode,
  userSet: boolean,
): Promise<void> {
  const s = get();
  const target = s.images.find((i) => i.id === imageId);
  if (!target || !target.tiffStretchContext) return;

  const result = await applyTiffStretchAsync(target.tiffStretchContext, mode);
  const latest = get().images.find((i) => i.id === imageId);
  if (!latest) return;
  const newGray = { width: target.width, height: target.height, data: result.gray };
  const nextTiffSource = target.tiffSource
    ? {
        ...target.tiffSource,
        displayMin: result.displayMin,
        displayMax: result.displayMax,
        stretchMethod: result.stretchMethod,
      }
    : target.tiffSource;

  const images = get().images.map((img) =>
    img.id !== imageId
      ? img
      : {
          ...img,
          gray: newGray,
          tiffStretchMode: mode,
          tiffStretchModeUserSet: userSet,
          tiffSource: nextTiffSource,
        },
  );
  set({ images });

  const updated = get().images.find((i) => i.id === imageId);
  if (!updated || !updated.gray) return;
  const forceEntry = buildPersistEntry(updated);
  if (forceEntry) flushPendingPersists([forceEntry]).catch(() => void 0);
  const prev = updated.previewBitmap;
  buildPreviewBitmap(updated.gray.data, updated.width, updated.height).then(({ bitmap, previewGray }) => {
    if (!bitmap) return;
    set({
      images: get().images.map((i) =>
        i.id === imageId ? { ...i, previewBitmap: bitmap, previewGray } : i,
      ),
    });
    if (prev && typeof prev.close === 'function') prev.close();
  });
}

function calibrationFromTiffMetadata(meta?: TiffMetadata): Calibration | null {
  if (!meta || !meta.pixelSize) return null;
  const { x, y, unit, source } = meta.pixelSize;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) return null;
  let pixelWidth = x;
  let pixelHeight = y;
  let normUnit = unit;
  if (source === 'tiff-resolution') {
    if (unit === 'cm/px') {
      pixelWidth = x * 10000;
      pixelHeight = y * 10000;
      normUnit = 'um';
    } else if (unit === 'inch/px') {
      pixelWidth = x * 25400;
      pixelHeight = y * 25400;
      normUnit = 'um';
    } else {
      return null;
    }
  } else {
    normUnit = (unit || 'um').replace(/^µ/, 'u');
    if (normUnit === 'micron' || normUnit === 'microns') normUnit = 'um';
  }
  return {
    pixelWidth,
    pixelHeight,
    unit: normUnit,
    source: 'tiff-metadata',
  };
}

function unionClosedRoiMask(rois: RoiShape[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const roi of rois) {
    const mask = rasterizeRoi(roi, width, height).data;
    for (let i = 0; i < out.length; i++) {
      if (mask[i]) out[i] = 1;
    }
  }
  return out;
}
