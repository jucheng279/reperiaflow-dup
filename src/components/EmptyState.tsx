import { useRef } from 'react';
import { Upload, ImagePlus, FolderUp } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { useFileDrop } from '../hooks/useFileDrop';
import {
  filterAndSortSupportedImages,
  SUPPORTED_IMAGE_ACCEPT,
  SUPPORTED_IMAGE_LABEL,
  type FilterResult,
} from '../utils/readDroppedItems';

export function EmptyState() {
  const addFiles = useSessionStore((s) => s.addFiles);
  const setError = useSessionStore((s) => s.setError);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

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
    <div className="flex h-full w-full items-center justify-center p-8" {...handlers}>
      <div
        className={
          'theme-transition relative w-full max-w-lg rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-150 ' +
          (isDragging
            ? 'scale-[1.02] border-blue-500 bg-blue-50 shadow-lg ring-4 ring-blue-500/20 dark:border-cyan-400 dark:bg-cyan-500/10 dark:ring-cyan-400/20'
            : 'border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800/40 dark:shadow-none')
        }
      >
        <div
          className={
            'mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-150 ' +
            (isDragging
              ? 'bg-blue-100 text-blue-700 dark:bg-cyan-400/20 dark:text-cyan-200'
              : 'bg-blue-50 text-blue-600 dark:bg-cyan-500/10 dark:text-cyan-300')
          }
        >
          {isDragging ? <FolderUp size={28} /> : <ImagePlus size={28} />}
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {isDragging ? 'Drop to import' : 'Start a measurement session'}
        </h2>
        {isDragging && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-400">
            Release to add these images to your session.
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => fileInput.current?.click()}
            className="theme-transition inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 dark:bg-cyan-500 dark:text-slate-900 dark:shadow-none dark:hover:bg-cyan-400"
          >
            <Upload size={14} /> Upload images
          </button>
          <button
            onClick={() => folderInput.current?.click()}
            title="Upload a folder (including subfolders)"
            aria-label="Upload a folder including subfolders"
            className="theme-transition inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:shadow-none dark:hover:border-slate-500"
          >
            <FolderUp size={14} /> Upload folder
          </button>
        </div>
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
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Or drag and drop files or a folder anywhere.
        </p>
      </div>
    </div>
  );
}
