import { memo, useState } from 'react';
import { Layers, Loader2, RotateCcw } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { ConfirmDialog } from './ConfirmDialog';

const Spinner = memo(function Spinner({ visible, label }: { visible: boolean; label: string }) {
  return (
    <span
      className={`absolute inset-0 flex items-center justify-center transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      aria-hidden={!visible}
    >
      <Loader2
        size={16}
        className="animate-spin [will-change:transform]"
        aria-label={label}
      />
    </span>
  );
});

export function ActionBar() {
  const active = useSessionStore((s) => s.images[s.activeIndex] ?? null);
  const imagingMode = useSessionStore((s) => s.imagingMode);
  const measureAndNext = useSessionStore((s) => s.measureAndNext);
  const measureOnly = useSessionStore((s) => s.measureOnly);
  const measureAllPending = useSessionStore((s) => s.measureAllPending);
  const measureAll = useSessionStore((s) => s.measureAll);
  const resetAllMeasurements = useSessionStore((s) => s.resetAllMeasurements);
  const totalCount = useSessionStore((s) => s.images.length);
  const pendingCount = useSessionStore((s) =>
    s.images.reduce((n, img) => (img.status === 'pending' ? n + 1 : n), 0),
  );
  const hasMeasured = useSessionStore(
    (s) => s.images.some((img) => img.status === 'measured'),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isMeasuringAll, setIsMeasuringAll] = useState(false);
  const [isMeasuringRemaining, setIsMeasuringRemaining] = useState(false);

  const runDeferred = (work: () => Promise<void> | void): Promise<void> =>
    new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          try {
            await work();
          } finally {
            resolve();
          }
        });
      });
    });

  const handleMeasureAll = async () => {
    if (isMeasuringAll) return;
    setIsMeasuringAll(true);
    const minVisible = new Promise((r) => setTimeout(r, 250));
    try {
      await Promise.all([runDeferred(() => measureAll()), minVisible]);
    } finally {
      setIsMeasuringAll(false);
    }
  };

  const handleMeasureRemaining = async () => {
    if (isMeasuringRemaining) return;
    setIsMeasuringRemaining(true);
    const minVisible = new Promise((r) => setTimeout(r, 250));
    try {
      await Promise.all([runDeferred(() => measureAllPending()), minVisible]);
    } finally {
      setIsMeasuringRemaining(false);
    }
  };

  if (!active) return null;

  const needsRoi = imagingMode === 'brightfield' && active.rois.length === 0;

  return (
    <section className="theme-transition space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 dark:shadow-none">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">Measure</h2>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={!hasMeasured}
          className="theme-transition inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-rose-500/60 dark:hover:bg-rose-500/10 dark:hover:text-rose-200 dark:disabled:hover:border-slate-600 dark:disabled:hover:bg-slate-800 dark:disabled:hover:text-slate-300"
          title="Reset all measured images back to pending"
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Reset measurements?"
        message="This will revert all measured images back to pending. Recorded results, skipped images, ROIs, and thresholds are preserved."
        confirmLabel="Reset"
        onConfirm={() => {
          resetAllMeasurements();
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
      <div className="grid w-full grid-cols-5 gap-2">
        <button
          onClick={() => void measureOnly()}
          disabled={needsRoi}
          className="theme-transition relative col-span-2 inline-flex w-full items-center justify-center whitespace-nowrap rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:bg-teal-500 dark:text-slate-900 dark:shadow-none dark:hover:bg-teal-400 dark:disabled:bg-slate-600 dark:disabled:text-slate-400"
          title="Record a measurement for the current image without advancing"
        >
          Current
          <kbd className="pointer-events-none absolute right-0.5 top-0.5 rounded border border-white/40 bg-white/15 px-0.5 text-[8px] font-medium leading-none tracking-wide text-white/90 dark:border-slate-900/30 dark:bg-slate-900/15 dark:text-slate-900/80">
            Space
          </kbd>
        </button>
        <button
          onClick={measureAndNext}
          disabled={needsRoi}
          className="theme-transition relative col-span-3 inline-flex w-full items-center justify-center whitespace-nowrap rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:bg-emerald-500 dark:text-slate-900 dark:shadow-none dark:hover:bg-emerald-400 dark:disabled:bg-slate-600 dark:disabled:text-slate-400"
        >
          Current + Next
          <kbd className="pointer-events-none absolute right-0.5 top-0.5 rounded border border-white/40 bg-white/15 px-0.5 text-[8px] font-medium leading-none tracking-wide text-white/90 dark:border-slate-900/30 dark:bg-slate-900/15 dark:text-slate-900/80">
            Enter
          </kbd>
        </button>
      </div>
      <div className="grid w-full grid-cols-2 gap-2">
        <button
          onClick={() => void handleMeasureAll()}
          disabled={totalCount === 0 || isMeasuringAll}
          aria-busy={isMeasuringAll}
          className="theme-transition relative inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:bg-amber-500 dark:text-slate-900 dark:shadow-none dark:hover:bg-amber-400 dark:disabled:bg-slate-600 dark:disabled:text-slate-400"
          title="Measure every image using its ROI when present, otherwise the full image. Appends a new row per image."
        >
          <Spinner visible={isMeasuringAll} label="Measuring all images" />
          <span className={`inline-flex items-center gap-2 transition-opacity duration-100 ${isMeasuringAll ? 'opacity-0' : 'opacity-100'}`}>
            <Layers size={14} />
            All
          </span>
        </button>
        <button
          onClick={() => void handleMeasureRemaining()}
          disabled={pendingCount === 0 || isMeasuringRemaining}
          aria-busy={isMeasuringRemaining}
          className="theme-transition relative inline-flex min-h-[42px] w-full items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:bg-cyan-500 dark:text-slate-900 dark:shadow-none dark:hover:bg-cyan-400 dark:disabled:bg-slate-600 dark:disabled:text-slate-400"
          title="Measure every remaining image using its ROI when present, otherwise the full image."
        >
          <Spinner visible={isMeasuringRemaining} label="Measuring remaining images" />
          <span className={`transition-opacity duration-100 ${isMeasuringRemaining ? 'opacity-0' : 'opacity-100'}`}>
            Remaining
          </span>
        </button>
      </div>
    </section>
  );
}
