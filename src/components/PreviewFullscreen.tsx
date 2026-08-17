import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ListX,
  Minimize2,
  SkipForward,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { PreviewCard } from './PreviewCard';
import { ConfirmDialog } from './ConfirmDialog';
import { sortedImages } from '../domain/image/previewSort';
import type { PreviewSortMode } from '../domain/session/uiTypes';

const SORT_OPTIONS: { value: PreviewSortMode; label: string }[] = [
  { value: 'queue', label: 'Queue Order' },
  { value: 'intensity', label: 'Intensity' },
];

export function PreviewFullscreen() {
  const images = useSessionStore((s) => s.images);
  const activeIndex = useSessionStore((s) => s.activeIndex);
  const setActiveIndex = useSessionStore((s) => s.setActiveIndex);
  const removeImage = useSessionStore((s) => s.removeImage);
  const setPreviewFullscreen = useSessionStore((s) => s.setPreviewFullscreen);
  const normalizationMode = useSessionStore((s) => s.normalizationMode);
  const globalRange = useSessionStore((s) => s.globalRange);
  const previewSortMode = useSessionStore((s) => s.previewSortMode);
  const setPreviewSortMode = useSessionStore((s) => s.setPreviewSortMode);
  const secondarySelectedIds = useSessionStore((s) => s.secondarySelectedIds);
  const toggleSecondarySelection = useSessionStore((s) => s.toggleSecondarySelection);
  const skipSecondarySelected = useSessionStore((s) => s.skipSecondarySelected);
  const skipAfterLastSelected = useSessionStore((s) => s.skipAfterLastSelected);
  const skipBeforeFirstSelected = useSessionStore((s) => s.skipBeforeFirstSelected);
  const skipAllExceptSelected = useSessionStore((s) => s.skipAllExceptSelected);
  const unskipSecondarySelected = useSessionStore((s) => s.unskipSecondarySelected);
  const unskipAfterLastSelected = useSessionStore((s) => s.unskipAfterLastSelected);
  const unskipBeforeFirstSelected = useSessionStore((s) => s.unskipBeforeFirstSelected);
  const unskipAllExceptSelected = useSessionStore((s) => s.unskipAllExceptSelected);
  const removeSelectedImages = useSessionStore((s) => s.removeSelectedImages);
  const removeSkippedImages = useSessionStore((s) => s.removeSkippedImages);

  const [menuOpen, setMenuOpen] = useState(false);
  const [unskipMenuOpen, setUnskipMenuOpen] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteSkippedOpen, setConfirmDeleteSkippedOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const unskipMenuRef = useRef<HTMLDivElement>(null);
  const deleteMenuRef = useRef<HTMLDivElement>(null);

  const secondarySet = useMemo(() => new Set(secondarySelectedIds), [secondarySelectedIds]);

  const sorted = useMemo(
    () => sortedImages(images, previewSortMode),
    [images, previewSortMode],
  );

  const sortedIds = useMemo(() => sorted.map((e) => e.image.id), [sorted]);

  const hasSelection = secondarySelectedIds.length > 0;
  const skippedCount = useMemo(() => images.filter((img) => img.status === 'skipped').length, [images]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (menuOpen) { setMenuOpen(false); return; }
        if (unskipMenuOpen) { setUnskipMenuOpen(false); return; }
        if (deleteMenuOpen) { setDeleteMenuOpen(false); return; }
        setPreviewFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setPreviewFullscreen, menuOpen, unskipMenuOpen, deleteMenuOpen]);

  useEffect(() => {
    if (!menuOpen && !unskipMenuOpen && !deleteMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (unskipMenuOpen && unskipMenuRef.current && !unskipMenuRef.current.contains(e.target as Node)) {
        setUnskipMenuOpen(false);
      }
      if (deleteMenuOpen && deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setDeleteMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen, unskipMenuOpen, deleteMenuOpen]);

  const handleSkipAfter = useCallback(() => {
    skipAfterLastSelected(sortedIds);
    setMenuOpen(false);
  }, [skipAfterLastSelected, sortedIds]);

  const handleSkipBefore = useCallback(() => {
    skipBeforeFirstSelected(sortedIds);
    setMenuOpen(false);
  }, [skipBeforeFirstSelected, sortedIds]);

  const handleSkipExcept = useCallback(() => {
    skipAllExceptSelected();
    setMenuOpen(false);
  }, [skipAllExceptSelected]);

  const handleUnskipAfter = useCallback(() => {
    unskipAfterLastSelected(sortedIds);
    setUnskipMenuOpen(false);
  }, [unskipAfterLastSelected, sortedIds]);

  const handleUnskipBefore = useCallback(() => {
    unskipBeforeFirstSelected(sortedIds);
    setUnskipMenuOpen(false);
  }, [unskipBeforeFirstSelected, sortedIds]);

  const handleUnskipExcept = useCallback(() => {
    unskipAllExceptSelected();
    setUnskipMenuOpen(false);
  }, [unskipAllExceptSelected]);

  const disabledItemCls =
    'flex w-full items-center gap-2.5 px-3 py-2 text-xs cursor-not-allowed text-slate-400 dark:text-slate-500';
  const enabledItemCls =
    'flex w-full items-center gap-2.5 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-950">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          All Previews
          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
            {images.length} image{images.length === 1 ? '' : 's'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {/* Skip selected */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={skipSecondarySelected}
              disabled={!hasSelection}
              title={hasSelection ? `Skip ${secondarySelectedIds.length} selected image${secondarySelectedIds.length === 1 ? '' : 's'} (S)` : 'Select images to skip'}
              aria-label="Skip selected images"
              className={
                'theme-transition inline-flex h-[30px] items-center gap-1.5 rounded-l-md border px-2.5 text-xs font-medium ' +
                (hasSelection
                  ? 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:border-amber-500 dark:hover:bg-amber-900/50'
                  : 'cursor-not-allowed border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500')
              }
            >
              <SkipForward size={14} />
              <span>Skip{hasSelection ? ` ${secondarySelectedIds.length}` : ''}</span>
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={!hasSelection}
                title="More skip options"
                aria-label="More skip options"
                className={
                  'theme-transition -ml-px inline-flex h-[30px] items-center rounded-r-md border px-1.5 ' +
                  (hasSelection
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:border-amber-500 dark:hover:bg-amber-900/50'
                    : 'cursor-not-allowed border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500')
                }
              >
                <ChevronDown size={14} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={handleSkipBefore}
                    disabled={!hasSelection}
                    className={hasSelection ? enabledItemCls : disabledItemCls}
                  >
                    <ChevronsLeft size={14} className="shrink-0" />
                    <span className="font-medium">Skip all before</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSkipAfter}
                    disabled={!hasSelection}
                    className={hasSelection ? enabledItemCls : disabledItemCls}
                  >
                    <ChevronsRight size={14} className="shrink-0" />
                    <span className="font-medium">Skip all after</span>
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={handleSkipExcept}
                    disabled={!hasSelection}
                    className={hasSelection ? enabledItemCls : disabledItemCls}
                  >
                    <ListX size={14} className="shrink-0" />
                    <span className="font-medium">Skip all except selected</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* Unskip selected */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={unskipSecondarySelected}
              disabled={!hasSelection}
              title={hasSelection ? `Unskip ${secondarySelectedIds.length} selected image${secondarySelectedIds.length === 1 ? '' : 's'}` : 'Select images to unskip'}
              aria-label="Unskip selected images"
              className={
                'theme-transition inline-flex h-[30px] items-center gap-1.5 rounded-l-md border px-2.5 text-xs font-medium ' +
                (hasSelection
                  ? 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:border-amber-500 dark:hover:bg-amber-900/50'
                  : 'cursor-not-allowed border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500')
              }
            >
              <Undo2 size={14} />
              <span>Unskip{hasSelection ? ` ${secondarySelectedIds.length}` : ''}</span>
            </button>
            <div className="relative" ref={unskipMenuRef}>
              <button
                type="button"
                onClick={() => setUnskipMenuOpen((v) => !v)}
                disabled={!hasSelection}
                title="More unskip options"
                aria-label="More unskip options"
                className={
                  'theme-transition -ml-px inline-flex h-[30px] items-center rounded-r-md border px-1.5 ' +
                  (hasSelection
                    ? 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:border-amber-500 dark:hover:bg-amber-900/50'
                    : 'cursor-not-allowed border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500')
                }
              >
                <ChevronDown size={14} className={unskipMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {unskipMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={handleUnskipBefore}
                    disabled={!hasSelection}
                    className={hasSelection ? enabledItemCls : disabledItemCls}
                  >
                    <ChevronsLeft size={14} className="shrink-0" />
                    <span className="font-medium">Unskip all before</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleUnskipAfter}
                    disabled={!hasSelection}
                    className={hasSelection ? enabledItemCls : disabledItemCls}
                  >
                    <ChevronsRight size={14} className="shrink-0" />
                    <span className="font-medium">Unskip all after</span>
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-700" />
                  <button
                    type="button"
                    onClick={handleUnskipExcept}
                    disabled={!hasSelection}
                    className={hasSelection ? enabledItemCls : disabledItemCls}
                  >
                    <ListX size={14} className="shrink-0" />
                    <span className="font-medium">Unskip all except selected</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          {/* Delete selected */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={!hasSelection}
              title={hasSelection ? `Delete ${secondarySelectedIds.length} selected image${secondarySelectedIds.length === 1 ? '' : 's'}` : 'Select images to delete'}
              aria-label="Delete selected images"
              className={
                'theme-transition inline-flex h-[30px] items-center gap-1.5 rounded-l-md border px-2.5 text-xs font-medium ' +
                (hasSelection
                  ? 'border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100 dark:border-rose-600 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:border-rose-500 dark:hover:bg-rose-900/50'
                  : 'cursor-not-allowed border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500')
              }
            >
              <Trash2 size={14} />
              <span>Delete{hasSelection ? ` ${secondarySelectedIds.length}` : ''}</span>
            </button>
            <div className="relative" ref={deleteMenuRef}>
              <button
                type="button"
                onClick={() => setDeleteMenuOpen((v) => !v)}
                title="More delete options"
                aria-label="More delete options"
                className={
                  'theme-transition -ml-px inline-flex h-[30px] items-center rounded-r-md border px-1.5 ' +
                  (hasSelection || skippedCount > 0
                    ? 'border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100 dark:border-rose-600 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:border-rose-500 dark:hover:bg-rose-900/50'
                    : 'cursor-not-allowed border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500')
                }
                disabled={!hasSelection && skippedCount === 0}
              >
                <ChevronDown size={14} className={deleteMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {deleteMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => { setDeleteMenuOpen(false); setConfirmDeleteSkippedOpen(true); }}
                    disabled={skippedCount === 0}
                    className={skippedCount > 0 ? enabledItemCls : disabledItemCls}
                  >
                    <Trash2 size={14} className="shrink-0" />
                    <span className="font-medium">Delete all skipped ({skippedCount})</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800">
            <ArrowUpDown size={14} className="text-slate-500 dark:text-slate-400" />
            <select
              value={previewSortMode}
              onChange={(e) => setPreviewSortMode(e.target.value as PreviewSortMode)}
              className="bg-transparent text-xs font-medium text-slate-700 outline-none dark:text-slate-200"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setPreviewFullscreen(false)}
            title="Close fullscreen preview (Esc)"
            aria-label="Close fullscreen preview"
            className="theme-transition inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </header>
      <ul className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {sorted.map(({ image: img, originalIndex }) => {
            const isGlobalMin =
              normalizationMode === 'global' && globalRange?.minImageId === img.id;
            const isGlobalMax =
              normalizationMode === 'global' && globalRange?.maxImageId === img.id;
            return (
              <PreviewCard
                key={img.id}
                image={img}
                active={originalIndex === activeIndex}
                secondarySelected={secondarySet.has(img.id)}
                onSelect={() => toggleSecondarySelection(img.id)}
                onDoubleClick={() => { setActiveIndex(originalIndex); setPreviewFullscreen(false); }}
                onRemove={() => removeImage(img.id)}
                isGlobalMin={isGlobalMin}
                isGlobalMax={isGlobalMax}
                className="border-b-0"
              />
            );
          })}
        </div>
      </ul>
      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete selected images"
        message={`Permanently remove ${secondarySelectedIds.length} selected image${secondarySelectedIds.length === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => { removeSelectedImages(); setConfirmDeleteOpen(false); }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
      <ConfirmDialog
        open={confirmDeleteSkippedOpen}
        title="Delete all skipped images"
        message={`Permanently remove ${skippedCount} skipped image${skippedCount === 1 ? '' : 's'}? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => { removeSkippedImages(); setConfirmDeleteSkippedOpen(false); }}
        onCancel={() => setConfirmDeleteSkippedOpen(false)}
      />
    </div>
  );
}
