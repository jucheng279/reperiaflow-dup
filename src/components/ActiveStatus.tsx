import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import { swatchCss, type ColorStats } from '../domain/image/colorStats';

export function ActiveStatus() {
  const active = useSessionStore((s) => s.images[s.activeIndex] ?? null);
  const idx = useSessionStore((s) => s.activeIndex);
  const total = useSessionStore((s) => s.images.length);
  const activeRange = useSessionStore((s) => s.threshold);
  const setImageColorLabel = useSessionStore((s) => s.setImageColorLabel);
  const openMetadataPanel = useSessionStore((s) => s.openMetadataPanel);
  const metadataOpen = useSessionStore((s) => s.metadataPanel.open);

  if (!active) return null;
  return (
    <div className="theme-transition border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{active.fileName}</span>
        <span className="text-slate-400 dark:text-slate-500">
          {idx + 1} / {total}
        </span>
        {active.color && (
          <ColorBadge
            color={active.color}
            userLabel={active.userColorLabel ?? null}
            onChange={(label) => setImageColorLabel(active.id, label)}
          />
        )}
        <button
          type="button"
          onClick={() => openMetadataPanel(active.id)}
          aria-pressed={metadataOpen}
          title="Image info (i)"
          className={`ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition ${
            metadataOpen
              ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-cyan-500/60 dark:bg-cyan-500/10 dark:text-cyan-200'
              : 'border-slate-200 bg-slate-100 text-slate-700 hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-200'
          }`}
        >
          <Info size={12} />
          Info
        </button>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          Threshold {activeRange.min}-{activeRange.max}
        </span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {active.status === 'pending' ? 'editing' : active.status}
        </span>
      </div>
    </div>
  );
}

function ColorBadge({
  color,
  userLabel,
  onChange,
}: {
  color: ColorStats;
  userLabel: string | null;
  onChange: (label: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(userLabel ?? '');

  useEffect(() => {
    setDraft(userLabel ?? '');
  }, [userLabel]);

  const autoLabel = color.sampledPixels === 0 ? 'no color' : color.hueBucket;
  const displayLabel = userLabel && userLabel.trim().length > 0 ? userLabel : autoLabel;

  const commit = () => {
    const trimmed = draft.trim();
    onChange(trimmed.length === 0 ? null : trimmed);
    setEditing(false);
  };

  return (
    <div className="group relative flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
      <span
        className="inline-block h-3 w-3 rounded-sm border border-slate-300 dark:border-slate-900/60"
        style={{ backgroundColor: swatchCss(color) }}
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(userLabel ?? '');
              setEditing(false);
            }
          }}
          placeholder={autoLabel}
          className="w-28 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-slate-700 hover:text-blue-700 dark:text-slate-200 dark:hover:text-cyan-200"
          title="Click to set a custom label"
        >
          {displayLabel}
        </button>
      )}
      <InfoDot />
    </div>
  );
}

function InfoDot() {
  return (
    <span className="relative">
      <Info size={12} className="text-slate-400 dark:text-slate-500" />
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-5 z-20 w-64 rounded border border-slate-200 bg-white p-2 text-[11px] leading-snug text-slate-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        Color is detected from displayed pixels. The exact excitation or emission wavelength can not be recovered from an RGB image; use OME-TIFF metadata or a channel tag in the filename to record wavelength.
      </span>
    </span>
  );
}
