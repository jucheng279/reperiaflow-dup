import { useEffect, useRef, useState } from 'react';
import { Crop, Layers, Loader2 } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { pulseThresholdDragging, setThresholdDragging } from '../workers/thresholdClient';
import {
  applyThresholdWheel,
  type ThresholdRange,
  type ThresholdScrollTarget,
} from '../domain/threshold/thresholdTypes';
import {
  activeThresholdRange,
  type SessionImage,
} from '../domain/session/sessionTypes';
import { isClosedRoi } from '../domain/roi/roiTypes';
import {
  GRAYSCALE_MODES,
  GRAYSCALE_MODE_LABELS,
  type GrayscaleMode,
} from '../domain/image/grayscale';
import {
  DEFAULT_TIFF_STRETCH_MODE,
  isGlobalNormalizationEligible,
  type TiffStretchMode,
} from '../domain/image/tiff';

type StretchSelection = TiffStretchMode | 'global';

const releaseSliderSelection = (e: { currentTarget: HTMLInputElement }) => {
  e.currentTarget.blur();
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  if (sel && sel.rangeCount > 0) sel.removeAllRanges();
};

// Slider drag tracking. We mark dragging on the threshold-range sliders only
// (not opacity), so the central viewer can switch to its downsampled
// interactive build while the user is scrubbing min/max and run a final
// full-resolution commit on release.
const beginThresholdDrag = () => {
  setThresholdDragging(true);
};

const endThresholdDrag = (e: { currentTarget: HTMLInputElement }) => {
  setThresholdDragging(false);
  releaseSliderSelection(e);
};

// Keyboard arrow keys auto-repeat at ~30 Hz; treat the whole burst as one
// drag so we don't alternate commit/interactive per keystroke. The pulse
// stays true until 250 ms after the last keydown, then a single commit fires.
const pulseThresholdKey = () => {
  pulseThresholdDragging(250);
};

export function ThresholdPanel() {
  const threshold = useSessionStore((s) => s.threshold);
  const overlayOpacity = useSessionStore((s) => s.overlayOpacity);
  const updateThreshold = useSessionStore((s) => s.updateThreshold);
  const setOpacity = useSessionStore((s) => s.setOverlayOpacity);
  const active = useSessionStore((s) => s.images[s.activeIndex] ?? null);
  const setImageGrayscaleMode = useSessionStore((s) => s.setImageGrayscaleMode);
  const setGrayscaleModeForAll = useSessionStore((s) => s.setGrayscaleModeForAll);
  const batchProgress = useSessionStore((s) => s.batchProgress);
  const abortBatch = useSessionStore((s) => s.abortBatch);
  const setImageTiffStretchMode = useSessionStore((s) => s.setImageTiffStretchMode);
  const normalizationMode = useSessionStore((s) => s.normalizationMode);
  const setNormalizationMode = useSessionStore((s) => s.setNormalizationMode);
  const images = useSessionStore((s) => s.images);
  const applyThresholdToImages = useSessionStore((s) => s.applyThresholdToImages);
  const globalEligibleCount = images.reduce(
    (n, img) => n + (img.status !== 'skipped' && isGlobalNormalizationEligible(img.tiffStretchContext) ? 1 : 0),
    0,
  );

  const imagingMode = useSessionStore((s) => s.imagingMode);
  const isBrightfield = imagingMode === 'brightfield';

  const selectedRoiShape =
    active && active.selectedRoiIndex >= 0
      ? active.rois[active.selectedRoiIndex] ?? null
      : null;
  const isRoiMode = !!(selectedRoiShape && isClosedRoi(selectedRoiShape));
  const activeRange: ThresholdRange = activeThresholdRange(active, threshold);
  const selectedRoiNumber = isRoiMode
    ? (active?.selectedRoiIndex ?? -1) + 1
    : 0;

  const scrollTarget = useSessionStore((s) => s.thresholdScrollTarget);
  const setThresholdScrollTarget = useSessionStore((s) => s.setThresholdScrollTarget);
  const wheelAreaRef = useRef<HTMLDivElement | null>(null);
  const rangeRef = useRef(activeRange);
  const targetRef = useRef<ThresholdScrollTarget>(scrollTarget);

  rangeRef.current = activeRange;
  targetRef.current = scrollTarget;

  const onRangeChange = (patch: Partial<ThresholdRange>) => {
    updateThreshold({ ...rangeRef.current, ...patch });
  };

  useEffect(() => {
    if (isBrightfield) return;
    const el = wheelAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const next = applyThresholdWheel(
        e.deltaY,
        e.shiftKey,
        targetRef.current,
        rangeRef.current,
      );
      if (next) {
        pulseThresholdDragging();
        updateThreshold(next);
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [updateThreshold, isBrightfield]);

  if (isBrightfield) {
    return null;
  }

  return (
    <section className="theme-transition space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 dark:shadow-none">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          {isRoiMode ? `ROI #${selectedRoiNumber} Threshold` : 'Threshold'}
        </h2>
        {isRoiMode ? (
          <span
            className="theme-transition inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            title="Click the selected ROI again on the image to exit ROI mode"
          >
            <Crop size={12} />
            ROI mode
          </span>
        ) : (
          <ApplyThresholdButtons
            images={images}
            activeRange={activeRange}
            onApply={applyThresholdToImages}
          />
        )}
      </header>

      <div ref={wheelAreaRef} className="select-none">
        <RangeSliders
          range={activeRange}
          onChange={onRangeChange}
          scrollTarget={scrollTarget}
          onSelectTarget={setThresholdScrollTarget}
          opacity={overlayOpacity}
          onOpacityChange={setOpacity}
        />
      </div>

      {active && active.color && (
        <GrayscaleModeControl
          mode={active.grayscaleMode}
          onChange={(m) => setImageGrayscaleMode(active.id, m)}
          onApplyAll={(m) => setGrayscaleModeForAll(m)}
          imageCount={images.filter((i) => i.status !== 'skipped' && i.status !== 'loading' && i.status !== 'error').length}
        />
      )}

      {active && active.tiffStretchContext && (
        <TiffStretchModeControl
          value={
            normalizationMode === 'global'
              ? 'global'
              : active.tiffStretchMode ?? DEFAULT_TIFF_STRETCH_MODE
          }
          globalEligible={globalEligibleCount > 0}
          onChange={(next) => {
            if (next === 'global') {
              setNormalizationMode('global');
              return;
            }
            if (normalizationMode === 'global') {
              setNormalizationMode('per-image');
            }
            setImageTiffStretchMode(active.id, next);
          }}
        />
      )}

      {batchProgress.active && (
        <BatchProgressBar
          label={batchProgress.label}
          completed={batchProgress.completed}
          total={batchProgress.total}
          onCancel={abortBatch}
        />
      )}
    </section>
  );
}

function BatchProgressBar({
  label,
  completed,
  total,
  onCancel,
}: {
  label: string;
  completed: number;
  total: number;
  onCancel: () => void;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
        <span>
          {label}: {completed}/{total}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          Cancel
        </button>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className="h-full rounded-full bg-blue-500 transition-[width] duration-150 dark:bg-cyan-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function countOverwrites(
  images: SessionImage[],
  scope: 'all' | 'remaining',
  range: ThresholdRange,
): { affected: number; overwrites: number } {
  let affected = 0;
  let overwrites = 0;
  for (const img of images) {
    if (img.status === 'skipped') continue;
    const targeted = scope === 'all' ? true : img.status !== 'measured';
    if (!targeted) continue;
    affected++;
    const snap = img.lastViewedThreshold;
    if (snap && (snap.min !== range.min || snap.max !== range.max)) overwrites++;
  }
  return { affected, overwrites };
}

function ApplyThresholdButtons({
  images,
  activeRange,
  onApply,
}: {
  images: SessionImage[];
  activeRange: ThresholdRange;
  onApply: (scope: 'all' | 'remaining') => void;
}) {
  const allStats = countOverwrites(images, 'all', activeRange);
  const remainingStats = countOverwrites(images, 'remaining', activeRange);
  const [applyingScope, setApplyingScope] = useState<'all' | 'remaining' | null>(null);

  const handleClick = (scope: 'all' | 'remaining') => {
    if (applyingScope) return;
    const stats = scope === 'all' ? allStats : remainingStats;
    if (stats.affected === 0) return;
    if (stats.overwrites > 0) {
      const msg =
        `${stats.overwrites} image${stats.overwrites === 1 ? '' : 's'} already ` +
        `${stats.overwrites === 1 ? 'has' : 'have'} a different threshold. ` +
        `Overwrite with current threshold (${activeRange.min}-${activeRange.max})?`;
      if (!window.confirm(msg)) return;
    }
    setApplyingScope(scope);
    requestAnimationFrame(() => {
      try {
        onApply(scope);
      } finally {
        setApplyingScope(null);
      }
    });
  };

  const baseClass =
    'theme-transition inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ' +
    'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300 ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-400/60 ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-blue-50 disabled:hover:border-blue-200 ' +
    'dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200 ' +
    'dark:hover:bg-cyan-500/20 dark:hover:border-cyan-400/50 ' +
    'dark:disabled:hover:bg-cyan-500/10 dark:disabled:hover:border-cyan-500/30';

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => handleClick('all')}
        disabled={allStats.affected === 0 || applyingScope !== null}
        aria-busy={applyingScope === 'all'}
        title="Apply current threshold to every image"
        aria-label="Apply current threshold to every image"
        className={baseClass}
      >
        {applyingScope === 'all' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <>
            <Layers size={12} />
            All
          </>
        )}
      </button>
      <button
        type="button"
        onClick={() => handleClick('remaining')}
        disabled={remainingStats.affected === 0 || applyingScope !== null}
        aria-busy={applyingScope === 'remaining'}
        title="Apply current threshold to images not yet measured"
        aria-label="Apply current threshold to images not yet measured"
        className={baseClass}
      >
        {applyingScope === 'remaining' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          'Remaining'
        )}
      </button>
    </div>
  );
}

function RangeSliders({
  range,
  onChange,
  scrollTarget,
  onSelectTarget,
  opacity,
  onOpacityChange,
}: {
  range: ThresholdRange;
  onChange: (p: Partial<ThresholdRange>) => void;
  scrollTarget: ThresholdScrollTarget;
  onSelectTarget: (t: ThresholdScrollTarget) => void;
  opacity: number;
  onOpacityChange: (v: number) => void;
}) {
  return (
    <div className="space-y-0">
      <SliderRow
        label="Min"
        value={range.min}
        active={scrollTarget === 'min'}
        onFocusRow={() => onSelectTarget('min')}
        onChange={(v) => onChange({ min: v })}
      />
      <SliderRow
        label="Max"
        value={range.max}
        active={scrollTarget === 'max'}
        onFocusRow={() => onSelectTarget('max')}
        onChange={(v) => onChange({ max: v })}
      />
      <OpacityRow value={opacity} onChange={onOpacityChange} />
    </div>
  );
}

function OpacityRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="theme-transition rounded px-2 py-0">
      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
        <span>Opacity</span>
        <input
          type="number"
          min={0}
          max={100}
          value={pct}
          onChange={(e) => {
            const n = parseInt(e.target.value || '0', 10);
            const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
            onChange(clamped / 100);
          }}
          className="w-12 rounded border border-slate-200 bg-white px-1 py-0.5 text-center text-slate-900 dark:border-transparent dark:bg-slate-700 dark:text-slate-100"
        />
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={releaseSliderSelection}
        onMouseUp={releaseSliderSelection}
        onTouchEnd={releaseSliderSelection}
        className="my-0 block w-full accent-blue-600 dark:accent-cyan-400"
      />
    </div>
  );
}

function SliderRow({
  label,
  value,
  active,
  onFocusRow,
  onChange,
}: {
  label: string;
  value: number;
  active: boolean;
  onFocusRow: () => void;
  onChange: (v: number) => void;
}) {
  return (
    <div
      onMouseDown={onFocusRow}
      onFocus={onFocusRow}
      className="theme-transition rounded px-2 py-0"
    >
      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          {label}
          {active && (
            <span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] uppercase tracking-wide text-blue-700 dark:bg-cyan-400/20 dark:text-cyan-200">
              scroll
            </span>
          )}
        </span>
        <input
          type="number"
          min={0}
          max={255}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value || '0', 10))}
          className="w-12 rounded border border-slate-200 bg-white px-1 py-0.5 text-center text-slate-900 dark:border-transparent dark:bg-slate-700 dark:text-slate-100"
        />
      </div>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        onPointerDown={beginThresholdDrag}
        onPointerUp={endThresholdDrag}
        onPointerCancel={endThresholdDrag}
        onMouseUp={endThresholdDrag}
        onTouchStart={beginThresholdDrag}
        onTouchEnd={endThresholdDrag}
        onKeyDown={pulseThresholdKey}
        onBlur={() => setThresholdDragging(false)}
        className="my-0 block w-full accent-blue-600 dark:accent-cyan-400"
      />
    </div>
  );
}

function GrayscaleModeControl({
  mode,
  onChange,
  onApplyAll,
  imageCount,
}: {
  mode: GrayscaleMode;
  onChange: (m: GrayscaleMode) => void;
  onApplyAll: (m: GrayscaleMode) => void;
  imageCount: number;
}) {
  return (
    <div className="select-none">
      <div className="flex items-center gap-1">
        <select
          value={mode}
          onChange={(e) => onChange(e.target.value as GrayscaleMode)}
          className="flex-1 min-w-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-transparent dark:bg-slate-700 dark:text-slate-100 dark:focus:border-cyan-400"
        >
          {GRAYSCALE_MODES.map((m) => (
            <option key={m} value={m}>
              {GRAYSCALE_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {imageCount > 1 && (
          <button
            type="button"
            onClick={() => onApplyAll(mode)}
            title="Apply to all images"
            className="shrink-0 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-transparent dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 dark:hover:text-slate-100"
          >
            All
          </button>
        )}
      </div>
    </div>
  );
}

const TIFF_STRETCH_OPTIONS: {
  value: StretchSelection;
  label: string;
  requiresGlobal?: boolean;
}[] = [
  { value: 'minmax', label: 'Linear min to max' },
  { value: 'percentile', label: 'Auto contrast (percentile 0.35%)' },
  { value: 'global', label: 'Global min to max', requiresGlobal: true },
];

function TiffStretchModeControl({
  value,
  globalEligible,
  onChange,
}: {
  value: StretchSelection;
  globalEligible: boolean;
  onChange: (m: StretchSelection) => void;
}) {
  const pendingCount = useSessionStore((s) => s.tiffStretchPending);
  const [minVisible, setMinVisible] = useState(false);
  const isPending = pendingCount > 0 || minVisible;

  const handleChange = (next: StretchSelection) => {
    setMinVisible(true);
    window.setTimeout(() => setMinVisible(false), 250);
    onChange(next);
  };

  return (
    <div className="select-none relative">
      <select
        value={value}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as StretchSelection)}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 pr-8 text-xs text-slate-900 focus:border-blue-500 focus:outline-none disabled:cursor-wait disabled:opacity-70 dark:border-transparent dark:bg-slate-700 dark:text-slate-100 dark:focus:border-cyan-400"
      >
        {TIFF_STRETCH_OPTIONS.map((opt) => (
          <option
            key={opt.value}
            value={opt.value}
            disabled={opt.requiresGlobal && !globalEligible}
          >
            {opt.label}
          </option>
        ))}
      </select>
      {isPending && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-7 flex items-center text-slate-500 dark:text-slate-300"
        >
          <Loader2 size={12} className="animate-spin" />
        </span>
      )}
    </div>
  );
}

