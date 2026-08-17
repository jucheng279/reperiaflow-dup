import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  SkipForward,
  Undo2,
  Filter,
  Check,
  Circle,
  MinusCircle,
  Sun,
  Moon,
  FolderUp,
  X,
  List,
  Image as ImageIcon,
  ImagePlus,
  Upload,
  Loader2,
  AlertTriangle,
  HelpCircle,
  Eraser,
  Maximize2,
} from 'lucide-react';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { PreviewCard } from './PreviewCard';
import { useSessionStore } from '../domain/session/sessionStore';
import { swatchCss } from '../domain/image/colorStats';
import type { ColorStats } from '../domain/image/colorStats';
import type { ImageMode, ImageStatus, SessionImage } from '../domain/session/sessionTypes';
import type { SidebarDisplayMode } from '../domain/session/uiTypes';
import { useTheme } from '../contexts/ThemeContext';
import { useFileDrop } from '../hooks/useFileDrop';
import { sortedImages } from '../domain/image/previewSort';
import {
  filterAndSortSupportedImages,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  type FilterResult,
} from '../utils/readDroppedItems';

export function SessionSidebar() {
  const images = useSessionStore((s) => s.images);
  const activeIndex = useSessionStore((s) => s.activeIndex);
  const rows = useSessionStore((s) => s.rows);
  const addFiles = useSessionStore((s) => s.addFiles);
  const setError = useSessionStore((s) => s.setError);
  const setActiveIndex = useSessionStore((s) => s.setActiveIndex);
  const skipActive = useSessionStore((s) => s.skipActive);
  const unskipActive = useSessionStore((s) => s.unskipActive);
  const skipByKeywords = useSessionStore((s) => s.skipByKeywords);
  const skipKeywordFilters = useSessionStore((s) => s.skipKeywordFilters);
  const removeSkipKeywordFilter = useSessionStore((s) => s.removeSkipKeywordFilter);
  const resultsOpen = useSessionStore((s) => s.resultsWindow.open);
  const toggleResults = useSessionStore((s) => s.toggleResultsWindow);
  const imagingMode = useSessionStore((s) => s.imagingMode);
  const setImagingMode = useSessionStore((s) => s.setImagingMode);
  const removeImage = useSessionStore((s) => s.removeImage);
  const clearAllImages = useSessionStore((s) => s.clearAllImages);
  const sidebarDisplayMode = useSessionStore((s) => s.sidebarDisplayMode);
  const setSidebarDisplayMode = useSessionStore((s) => s.setSidebarDisplayMode);
  const setPreviewFullscreen = useSessionStore((s) => s.setPreviewFullscreen);
  const normalizationMode = useSessionStore((s) => s.normalizationMode);
  const globalRange = useSessionStore((s) => s.globalRange);
  const previewSortMode = useSessionStore((s) => s.previewSortMode);
  const ingest = useSessionStore((s) => s.ingest);
  const dismissIngestErrors = useSessionStore((s) => s.dismissIngestErrors);
  const activeImage = images[activeIndex] ?? null;
  const ingesting = ingest.total > 0 && ingest.completed < ingest.total;
  const ingestPct =
    ingest.total === 0 ? 0 : Math.min(100, Math.round((ingest.completed / ingest.total) * 100));
  const { theme, toggleTheme } = useTheme();

  const sorted = useMemo(
    () => sortedImages(images, previewSortMode),
    [images, previewSortMode],
  );

  const listRef = useRef<HTMLUListElement | null>(null);
  const activeItemRef = useRef<HTMLLIElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const uploadMenuRef = useRef<HTMLDivElement | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [keywordFeedback, setKeywordFeedback] = useState<string | null>(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    if (!uploadMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!uploadMenuRef.current) return;
      if (!uploadMenuRef.current.contains(e.target as Node)) setUploadMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUploadMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [uploadMenuOpen]);

  useEffect(() => {
    if (!keywordFeedback) return;
    const t = setTimeout(() => setKeywordFeedback(null), 2800);
    return () => clearTimeout(t);
  }, [keywordFeedback]);

  useEffect(() => {
    const container = listRef.current;
    const item = activeItemRef.current;
    if (!container || !item) return;
    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    if (iRect.top < cRect.top || iRect.bottom > cRect.bottom) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeIndex, sidebarDisplayMode]);

  const runKeywordSkip = () => {
    const trimmed = keywordInput.trim();
    if (!trimmed) return;
    const count = skipByKeywords(trimmed);
    setKeywordFeedback(
      count === 0 ? 'No filenames matched.' : `Skipped ${count} image${count === 1 ? '' : 's'}.`,
    );
    setKeywordInput('');
  };

  const keywordDisabled = keywordInput.trim().length === 0;
  const unskipActiveDisabled = !activeImage || activeImage.status !== 'skipped';

  const handleResult = (result: FilterResult) => {
    if (result.accepted.length === 0) {
      if (result.rejected > 0) {
        setError(`No supported images found. Accepted: ${SUPPORTED_IMAGE_LABEL}.`);
      }
      return;
    }
    void addFiles(result.accepted);
    if (result.rejected > 0) {
      setError(
        `Skipped ${result.rejected} unsupported file${result.rejected === 1 ? '' : 's'}. Accepted: ${SUPPORTED_IMAGE_LABEL}.`,
      );
    }
  };

  const { isDragging, handlers } = useFileDrop(handleResult);

  return (
    <aside
      className={
        'theme-transition relative flex h-full w-72 flex-shrink-0 flex-col border-r bg-white dark:bg-slate-900/80 ' +
        (isDragging
          ? 'border-blue-500 ring-2 ring-inset ring-blue-500/30 dark:border-cyan-400 dark:ring-cyan-400/30'
          : 'border-slate-200 dark:border-slate-700')
      }
      {...handlers}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="flex-1">
          <h1 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">Reperia Flow</h1>
        </div>
        <div ref={uploadMenuRef} className="relative">
          <button
            onClick={() => setUploadMenuOpen((v) => !v)}
            title="Upload images or folder"
            aria-label="Upload"
            aria-haspopup="menu"
            aria-expanded={uploadMenuOpen}
            className="theme-transition inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
          >
            <Upload size={14} />
          </button>
          {uploadMenuOpen && (
            <div
              role="menu"
              className="theme-transition absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800"
            >
              <button
                role="menuitem"
                onClick={() => {
                  setUploadMenuOpen(false);
                  fileInput.current?.click();
                }}
                className="theme-transition flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60"
              >
                <ImagePlus size={14} />
                Upload image
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setUploadMenuOpen(false);
                  folderInput.current?.click();
                }}
                className="theme-transition flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60"
              >
                <FolderUp size={14} />
                Upload folder
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => setShortcutsOpen(true)}
          title="Keyboard shortcuts"
          aria-label="Show keyboard shortcuts"
          className="theme-transition inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
        >
          <HelpCircle size={14} />
        </button>
        <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle color theme"
          className="theme-transition inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={SUPPORTED_IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const result = filterAndSortSupportedImages(Array.from(e.target.files ?? []));
            handleResult(result);
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          // @ts-expect-error non-standard folder picker attributes
          webkitdirectory=""
          directory=""
          mozdirectory=""
          onChange={(e) => {
            const result = filterAndSortSupportedImages(Array.from(e.target.files ?? []));
            handleResult(result);
            e.target.value = '';
          }}
        />
      </div>

      <div className={`px-3 pt-3 space-y-1.5 ${skipKeywordFilters.length > 0 ? 'pb-1' : 'pb-3'}`}>
        <div className="flex items-center gap-1.5">
          <button
            title="Skip current image (S)"
            aria-label="Skip current image"
            onClick={skipActive}
            className="theme-transition inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500"
          >
            <SkipForward size={14} />
          </button>
          <button
            title="Unskip current image"
            aria-label="Unskip current image"
            onClick={unskipActive}
            disabled={unskipActiveDisabled}
            className="theme-transition inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-500 dark:disabled:hover:border-slate-700 dark:disabled:hover:bg-slate-800"
          >
            <Undo2 size={14} />
          </button>
          <input
            type="text"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runKeywordSkip();
              }
            }}
            placeholder="txr, dapi"
            aria-label="Keywords to skip, comma separated"
            className="theme-transition min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-cyan-400 dark:focus:ring-cyan-400"
          />
          <button
            onClick={runKeywordSkip}
            disabled={keywordDisabled}
            aria-label="Skip all images matching keywords"
            title="Skip all matching filenames"
            className="theme-transition inline-flex h-7 items-center justify-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none dark:bg-cyan-500 dark:text-slate-900 dark:shadow-none dark:hover:bg-cyan-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
          >
            <Filter size={12} />
            Skip
          </button>
        </div>
        {keywordFeedback && (
          <p className="text-[10px] font-medium text-blue-600 dark:text-cyan-300">
            {keywordFeedback}
          </p>
        )}
        {skipKeywordFilters.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {skipKeywordFilters.map((keyword) => (
              <span
                key={keyword}
                className="theme-transition inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-0.5 pl-2 pr-1 text-[10px] font-medium text-blue-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-200"
              >
                <span className="max-w-[120px] truncate" title={keyword}>
                  {keyword}
                </span>
                <button
                  type="button"
                  onClick={() => removeSkipKeywordFilter(keyword)}
                  title={`Remove "${keyword}" filter`}
                  aria-label={`Remove ${keyword} filter`}
                  className="theme-transition inline-flex h-4 w-4 items-center justify-center rounded-full text-blue-500 hover:bg-blue-100 hover:text-blue-800 dark:text-cyan-300 dark:hover:bg-cyan-400/20 dark:hover:text-cyan-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {(ingesting || ingest.errors.length > 0) && (
        <div className="px-3 pb-2">
          {ingesting && (
            <div className="theme-transition rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 dark:border-cyan-500/40 dark:bg-cyan-500/10">
              <div className="flex items-center justify-between text-[10px] font-medium text-blue-700 dark:text-cyan-200">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" />
                  Decoding {ingest.completed} of {ingest.total}
                </span>
                <span>{ingestPct}%</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-blue-100 dark:bg-cyan-500/20">
                <div
                  className="h-full bg-blue-500 transition-[width] duration-200 dark:bg-cyan-300"
                  style={{ width: `${ingestPct}%` }}
                />
              </div>
            </div>
          )}
          {!ingesting && ingest.errors.length > 0 && (
            <button
              onClick={dismissIngestErrors}
              title="Dismiss errors"
              className="theme-transition flex w-full items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] font-medium text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20"
            >
              <span className="inline-flex items-center gap-1.5">
                <AlertTriangle size={11} />
                {ingest.errors.length} file{ingest.errors.length === 1 ? '' : 's'} failed to decode
              </span>
              <X size={11} />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={() => {
            if (images.length === 0) return;
            const msg = `Remove all ${images.length} uploaded image${images.length === 1 ? '' : 's'}? This cannot be undone.`;
            if (window.confirm(msg)) clearAllImages();
          }}
          disabled={images.length === 0}
          title="Clear all uploaded images"
          aria-label="Clear all uploaded images"
          className="theme-transition inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-red-500/50 dark:hover:bg-red-500/10 dark:hover:text-red-200 dark:disabled:hover:border-slate-600 dark:disabled:hover:bg-slate-800 dark:disabled:hover:text-slate-200"
        >
          <Eraser size={12} />
          <span>All</span>
        </button>
        <DisplayModeToggle
          mode={sidebarDisplayMode}
          onChange={setSidebarDisplayMode}
        />
        <ImagingModeToggle
          mode={imagingMode}
          onChange={setImagingMode}
        />
        <button
          onClick={toggleResults}
          title={resultsOpen ? 'Hide results (T)' : 'Show results (T)'}
          className={
            'theme-transition flex flex-1 items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium ' +
            (resultsOpen
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-100'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-slate-400')
          }
        >
          <span className="flex items-center gap-1.5">
            <span>Results</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
              {rows.length}
            </span>
          </span>
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden border-t border-slate-200 dark:border-slate-800">
        {sidebarDisplayMode === 'preview' && images.length > 0 && (
          <button
            type="button"
            onClick={() => setPreviewFullscreen(true)}
            title="Expand previews to fullscreen"
            aria-label="Expand previews to fullscreen"
            className="theme-transition absolute left-0 top-0 z-10 inline-flex h-7 w-7 items-center justify-center rounded-br-md bg-white/70 text-slate-600 backdrop-blur-sm hover:bg-white/90 hover:text-slate-900 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:bg-slate-800/90 dark:hover:text-slate-100"
          >
            <Maximize2 size={14} />
          </button>
        )}
        <ul
          ref={listRef}
          className="h-full overflow-y-auto"
        >
          {sorted.map(({ image: img, originalIndex }) => {
            const isGlobalMin =
              normalizationMode === 'global' && globalRange?.minImageId === img.id;
            const isGlobalMax =
              normalizationMode === 'global' && globalRange?.maxImageId === img.id;
            return sidebarDisplayMode === 'preview' ? (
              <PreviewCard
                key={img.id}
                image={img}
                active={originalIndex === activeIndex}
                itemRef={originalIndex === activeIndex ? activeItemRef : undefined}
                onSelect={() => setActiveIndex(originalIndex)}
                onRemove={() => removeImage(img.id)}
                isGlobalMin={isGlobalMin}
                isGlobalMax={isGlobalMax}
              />
            ) : (
              <CompactListItem
                key={img.id}
                image={img}
                active={originalIndex === activeIndex}
                itemRef={originalIndex === activeIndex ? activeItemRef : undefined}
                onSelect={() => setActiveIndex(originalIndex)}
                onRemove={() => removeImage(img.id)}
                isGlobalMin={isGlobalMin}
                isGlobalMax={isGlobalMax}
              />
            );
          })}
          {images.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
              Drop images or a folder here, or use the Upload button.
            </li>
          )}
        </ul>
      </div>
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-blue-500/10 backdrop-blur-[1px] dark:bg-cyan-400/10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-blue-600 shadow-md dark:bg-slate-900 dark:text-cyan-300">
            <FolderUp size={22} />
          </div>
          <p className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-blue-700 shadow-sm dark:bg-slate-900/90 dark:text-cyan-200">
            Drop to import
          </p>
        </div>
      )}
    </aside>
  );
}

function ImagingModeToggle({
  mode,
  onChange,
}: {
  mode: ImageMode;
  onChange: (mode: ImageMode) => void;
}) {
  const isFluorescence = mode !== 'brightfield';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isFluorescence}
      aria-label={isFluorescence ? 'Switch to brightfield' : 'Switch to fluorescence'}
      title={isFluorescence ? 'Switch to brightfield' : 'Switch to fluorescence'}
      onClick={() => onChange(isFluorescence ? 'brightfield' : 'fluorescence')}
      className="theme-transition relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-md border border-slate-300 bg-slate-200 p-0.5 dark:border-slate-600 dark:bg-slate-700"
    >
      <span
        className={
          'absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-slate-100 ' +
          (isFluorescence ? 'translate-x-full' : 'translate-x-0')
        }
        aria-hidden="true"
      />
      <span
        className={
          'relative z-10 flex h-full w-1/2 items-center justify-center text-[10px] font-semibold transition-colors ' +
          (isFluorescence ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-800')
        }
      >
        BF
      </span>
      <span
        className={
          'relative z-10 flex h-full w-1/2 items-center justify-center text-[10px] font-semibold transition-colors ' +
          (isFluorescence ? 'text-slate-700 dark:text-slate-800' : 'text-slate-400 dark:text-slate-500')
        }
      >
        FL
      </span>
    </button>
  );
}

function ColorSwatch({ color }: { color: ColorStats | undefined }) {
  if (!color || color.sampledPixels === 0) {
    return (
      <span
        title="No color detected"
        className="inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
      />
    );
  }
  return (
    <span
      title={color.hueBucket}
      className="inline-block h-3 w-3 flex-shrink-0 rounded-sm border border-slate-300/60 shadow-[0_0_0_1px_rgba(148,163,184,0.2)] dark:border-slate-900/60"
      style={{ backgroundColor: swatchCss(color) }}
    />
  );
}

function SourceBadge({ image }: { image: SessionImage }) {
  const src = image.tiffSource;
  if (!src) return null;
  let label: string | null = null;
  let title = '';
  const native = `native ${src.nativeMin ?? '?'}-${src.nativeMax ?? '?'}`;
  const display = `display ${src.displayMin ?? '?'}-${src.displayMax ?? '?'}`;
  switch (src.conversion) {
    case 'auto-contrast-16-uint':
      label = '16-bit';
      title = `16-bit unsigned TIFF auto-contrast stretched to 8-bit (${native}, ${display}).`;
      break;
    case 'auto-contrast-16-int':
      label = '16i';
      title = `16-bit signed TIFF auto-contrast stretched to 8-bit (${native}, ${display}).`;
      break;
    case 'auto-contrast-float':
      label = '32f';
      title = `32-bit float TIFF auto-contrast stretched to 8-bit (${native}, ${display}).`;
      break;
    case 'utif-rgba-fallback':
      label = 'auto';
      title = `TIFF decoded via fallback path (bps=${src.bitsPerSample}, fmt=${src.sampleFormat}).`;
      break;
    case 'passthrough-8bit':
    default:
      return null;
  }
  if (!label) return null;
  return (
    <span
      title={title}
      className="flex-shrink-0 rounded bg-slate-200 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-200"
    >
      {label}
    </span>
  );
}

function StatusIcon({ status }: { status: ImageStatus }) {
  if (status === 'measured') return <Check size={12} className="text-emerald-600 dark:text-emerald-400" />;
  if (status === 'skipped') return <MinusCircle size={12} className="text-amber-600 dark:text-amber-400" />;
  if (status === 'loading') return <Loader2 size={12} className="animate-spin text-blue-500 dark:text-cyan-300" />;
  if (status === 'error') return <AlertTriangle size={12} className="text-red-500 dark:text-red-300" />;
  return <Circle size={12} className="text-slate-400 dark:text-slate-500" />;
}

function DisplayModeToggle({
  mode,
  onChange,
}: {
  mode: SidebarDisplayMode;
  onChange: (mode: SidebarDisplayMode) => void;
}) {
  const isPreview = mode === 'preview';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isPreview}
      aria-label={isPreview ? 'Switch to compact list' : 'Switch to image previews'}
      title={isPreview ? 'Switch to compact list' : 'Switch to image previews'}
      onClick={() => onChange(isPreview ? 'compact' : 'preview')}
      className="theme-transition relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-md border border-slate-300 bg-slate-200 p-0.5 dark:border-slate-600 dark:bg-slate-700"
    >
      <span
        className={
          'absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-slate-100 ' +
          (isPreview ? 'translate-x-full' : 'translate-x-0')
        }
        aria-hidden="true"
      />
      <span
        className={
          'relative z-10 flex h-full w-1/2 items-center justify-center transition-colors ' +
          (isPreview ? 'text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-800')
        }
      >
        <List size={12} />
      </span>
      <span
        className={
          'relative z-10 flex h-full w-1/2 items-center justify-center transition-colors ' +
          (isPreview ? 'text-slate-700 dark:text-slate-800' : 'text-slate-400 dark:text-slate-500')
        }
      >
        <ImageIcon size={12} />
      </span>
    </button>
  );
}

function CompactListItem({
  image,
  active,
  itemRef,
  onSelect,
  onRemove,
  isGlobalMin,
  isGlobalMax,
}: {
  image: SessionImage;
  active: boolean;
  itemRef?: RefObject<HTMLLIElement>;
  onSelect: () => void;
  onRemove: () => void;
  isGlobalMin?: boolean;
  isGlobalMax?: boolean;
}) {
  return (
    <li ref={itemRef} className="group relative">
      <button
        onClick={onSelect}
        className={
          'theme-transition flex w-full items-center gap-2 border-b px-3 py-2 pr-8 text-left text-xs ' +
          (active
            ? 'border-slate-200 bg-blue-50 text-slate-900 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100'
            : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/60')
        }
      >
        <StatusIcon status={image.status} />
        <ColorSwatch color={image.color} />
        <span className="truncate">{image.fileName}</span>
        <SourceBadge image={image} />
        <ExtremumBadge isMin={!!isGlobalMin} isMax={!!isGlobalMax} />
        <span className="ml-auto text-[10px] text-slate-400 dark:text-slate-500">
          {image.status === 'loading'
            ? 'decoding…'
            : image.status === 'error'
              ? 'failed'
              : `${image.width}x${image.height}`}
        </span>
      </button>
      <RemoveButton fileName={image.fileName} onRemove={onRemove} />
    </li>
  );
}


function RemoveButton({
  fileName,
  onRemove,
}: {
  fileName: string;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      title="Remove image"
      aria-label={`Remove ${fileName}`}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className="theme-transition absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded bg-white/80 text-slate-500 opacity-0 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-300"
    >
      <X size={12} />
    </button>
  );
}

function ExtremumBadge({ isMin, isMax }: { isMin: boolean; isMax: boolean }) {
  if (!isMin && !isMax) return null;
  if (isMin && isMax) {
    return (
      <span
        title="Holds both the lowest and highest pixel in the batch"
        className="pointer-events-auto flex-shrink-0 rounded bg-slate-700 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white shadow-sm dark:bg-slate-200 dark:text-slate-900"
      >
        Min/Max
      </span>
    );
  }
  if (isMin) {
    return (
      <span
        title="Holds the lowest pixel in the batch"
        className="pointer-events-auto flex-shrink-0 rounded bg-cyan-600 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white shadow-sm dark:bg-cyan-400 dark:text-slate-900"
      >
        Min
      </span>
    );
  }
  return (
    <span
      title="Holds the highest pixel in the batch"
      className="pointer-events-auto flex-shrink-0 rounded bg-amber-600 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white shadow-sm dark:bg-amber-400 dark:text-slate-900"
    >
      Max
    </span>
  );
}

