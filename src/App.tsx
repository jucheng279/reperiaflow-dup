import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useSessionStore } from './domain/session/sessionStore';
import { useHotkeys } from './hooks/useHotkeys';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ImageViewer } from './components/ImageViewer';
import { SessionSidebar } from './components/SessionSidebar';
import { ThresholdPanel } from './components/ThresholdPanel';
import { RoiToolbar } from './components/RoiToolbar';
import { ActionBar } from './components/ActionBar';
import { ActiveStatus } from './components/ActiveStatus';
import { ResultsWindow } from './components/ResultsWindow';
import { ErrorToast } from './components/ErrorToast';
import { EmptyState } from './components/EmptyState';
import { MetadataDrawer } from './components/MetadataDrawer';
import { PreviewFullscreen } from './components/PreviewFullscreen';
import { ThemeProvider } from './contexts/ThemeContext';
import { ErrorBoundary } from './components/ErrorBoundary';

function AppShell() {
  useHotkeys();
  const phase = useSessionStore((s) => s.phase);
  const hasImages = useSessionStore((s) => s.images.length > 0);
  const previewFullscreen = useSessionStore((s) => s.previewFullscreen);

  return (
    <div className="theme-transition flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <SessionSidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        {hasImages && <ActiveStatus />}
        <div className="relative flex min-h-0 flex-1">
          <div className="theme-transition relative flex-1 bg-slate-100 dark:bg-slate-900">
            {hasImages ? <ImageViewer /> : <EmptyState />}
            {phase === 'done' && <DoneBanner />}
          </div>
          <aside className="theme-transition flex w-80 flex-col gap-3 overflow-y-auto border-l border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <ThresholdPanel />
            {hasImages && <RoiToolbar />}
            {hasImages && <ActionBar />}
          </aside>
        </div>
      </main>

      <ResultsWindow />
      <MetadataDrawer />
      <ErrorToast />
      {previewFullscreen && <PreviewFullscreen />}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function DoneBanner() {
  const resetAllMeasurements = useSessionStore((s) => s.resetAllMeasurements);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <div className="absolute inset-x-0 top-4 mx-auto flex w-fit items-center gap-2 rounded-full border border-emerald-500/50 bg-emerald-50 py-1.5 pl-4 pr-1.5 text-xs font-medium text-emerald-700 shadow-sm dark:bg-emerald-500/10 dark:text-emerald-200">
        <span>Queue complete. Export results or upload more images.</span>
        <button
          onClick={() => setConfirmOpen(true)}
          className="theme-transition inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 hover:border-emerald-600 hover:bg-white dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:border-emerald-300 dark:hover:bg-emerald-500/20"
          title="Reset all measured images back to pending"
        >
          <RotateCcw size={11} />
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
    </>
  );
}

export default App;
