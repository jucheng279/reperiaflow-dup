import { useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Up'], description: 'Previous image' },
      { keys: ['Down'], description: 'Next image' },
      { keys: ['Left'], description: 'Decrease threshold' },
      { keys: ['Right'], description: 'Increase threshold' },
      { keys: ['Shift', '+', 'Left/Right'], description: 'Coarse threshold step' },
    ],
  },
  {
    title: 'Measurement',
    shortcuts: [
      { keys: ['Space'], description: 'Measure current image' },
      { keys: ['Enter'], description: 'Measure current and advance' },
      { keys: ['S'], description: 'Skip current image' },
    ],
  },
  {
    title: 'ROI Tools',
    shortcuts: [
      { keys: ['R'], description: 'Rectangle tool' },
      { keys: ['E'], description: 'Ellipse tool' },
      { keys: ['P'], description: 'Polygon tool' },
      { keys: ['F'], description: 'Freehand tool' },
      { keys: ['L'], description: 'Line tool' },
      { keys: ['N'], description: 'Freehand line tool' },
    ],
  },
  {
    title: 'Panels',
    shortcuts: [
      { keys: ['T'], description: 'Toggle results window' },
      { keys: ['I'], description: 'Toggle metadata panel' },
      { keys: ['H'], description: 'Hold to hide overlay (fluorescence)' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['Z'], description: 'Zoom to bright region' },
      { keys: ['0'], description: 'Fit image to view' },
      { keys: ['Shift/Ctrl', '+', 'Scroll'], description: 'Zoom in/out' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['Delete'], description: 'Remove selected ROI or current image' },
      { keys: ['Backspace'], description: 'Remove selected ROI or current image' },
    ],
  },
];

export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm dark:bg-slate-950/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={onClose}
    >
      <div
        className="theme-transition flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="rounded-full bg-blue-100 p-2 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              <Keyboard size={16} />
            </div>
            <h3
              id="shortcuts-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              Keyboard Shortcuts
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="theme-transition inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {GROUPS.map((group) => (
              <section key={group.title}>
                <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {group.title}
                </h4>
                <ul className="space-y-1.5">
                  {group.shortcuts.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="text-slate-700 dark:text-slate-300">{s.description}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.keys.map((k, ki) =>
                          k === '+' ? (
                            <span key={ki} className="text-slate-400 dark:text-slate-500">
                              +
                            </span>
                          ) : (
                            <kbd
                              key={ki}
                              className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                            >
                              {k}
                            </kbd>
                          ),
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            Shortcuts are disabled while typing in text inputs. Some shortcuts only apply to the
            active image mode or when a session is in progress.
          </p>
        </div>
      </div>
    </div>
  );
}
