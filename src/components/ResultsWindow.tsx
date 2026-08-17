import { useEffect, useRef, useState } from 'react';
import { X, Table2 } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { ResultsTable } from './ResultsTable';

interface DragState {
  pointerX: number;
  pointerY: number;
  startX: number;
  startY: number;
}

export function ResultsWindow() {
  const win = useSessionStore((s) => s.resultsWindow);
  const rows = useSessionStore((s) => s.rows);
  const setOpen = useSessionStore((s) => s.setResultsWindowOpen);
  const setRect = useSessionStore((s) => s.setResultsWindowRect);

  const [pos, setPos] = useState({ x: win.x, y: win.y });
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    setPos({ x: win.x, y: win.y });
  }, [win.x, win.y]);

  const clampPos = (x: number, y: number) => ({
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - 80)),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 120)),
  });

  const onPointerMove = (e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.pointerX;
    const dy = e.clientY - drag.pointerY;
    setPos(clampPos(drag.startX + dx, drag.startY + dy));
  };

  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    setPos((p) => {
      setRect({ x: p.x, y: p.y, width: win.width, height: win.height });
      return p;
    });
  };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  if (!win.open) return null;

  return (
    <div
      className="theme-transition fixed z-40 overflow-auto rounded-lg border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:shadow-black/50"
      style={{
        left: pos.x,
        top: pos.y,
        minWidth: 260,
        minHeight: 120,
        maxWidth: '95vw',
        maxHeight: '95vh',
      }}
      role="dialog"
      aria-label="Measurement results"
    >
      <header
        onPointerDown={startDrag}
        className="theme-transition sticky top-0 z-10 flex cursor-move items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-3 py-2 select-none backdrop-blur dark:border-slate-700 dark:bg-slate-800/95"
      >
        <Table2 size={14} className="text-blue-600 dark:text-cyan-300" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Results</h2>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {rows.length}
        </span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          aria-label="Close results window"
        >
          <X size={14} />
        </button>
      </header>
      <ResultsTable />
    </div>
  );
}
