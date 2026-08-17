import type { RefObject } from 'react';
import type { SessionImage } from '../domain/session/sessionTypes';
import { GrayscaleThumbnail } from './GrayscaleThumbnail';

export function PreviewCard({
  image,
  active,
  itemRef,
  onSelect,
  onDoubleClick,
  onRemove,
  isGlobalMin,
  isGlobalMax,
  secondarySelected,
  className,
}: {
  image: SessionImage;
  active: boolean;
  itemRef?: RefObject<HTMLLIElement>;
  onSelect: () => void;
  onDoubleClick?: () => void;
  onRemove: () => void;
  isGlobalMin?: boolean;
  isGlobalMax?: boolean;
  secondarySelected?: boolean;
  className?: string;
}) {
  let bgClass: string;
  if (active) bgClass = 'bg-blue-50 dark:bg-slate-800';
  else if (secondarySelected) bgClass = 'bg-amber-50 dark:bg-amber-900/20';
  else bgClass = 'bg-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60';

  let borderClass: string;
  if (active) borderClass = 'border-blue-500 dark:border-cyan-400';
  else if (secondarySelected) borderClass = 'border-amber-500 dark:border-amber-400';
  else borderClass = 'border-slate-200 dark:border-slate-700';

  return (
    <li ref={itemRef} className={`group relative border-b border-slate-200 dark:border-slate-800 ${className ?? ''}`}>
      <button
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        className={'theme-transition block w-full p-2 text-left ' + bgClass}
      >
        <div
          className={'relative overflow-hidden rounded-md border ' + borderClass}
        >
          <GrayscaleThumbnail image={image} />
          {secondarySelected && (
            <div className="pointer-events-none absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm">
              <Check size={12} />
            </div>
          )}
          {(isGlobalMin || isGlobalMax) && (
            <div className="pointer-events-none absolute right-1 top-1 flex gap-1">
              <ExtremumBadge isMin={!!isGlobalMin} isMax={!!isGlobalMax} />
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-3 text-[10px] text-white">
            <StatusIcon status={image.status} />
            <span className="truncate">{image.fileName}</span>
            <SourceBadge image={image} />
            <span className="ml-auto text-[9px] text-slate-200">
              {image.status === 'loading'
                ? 'decoding\u2026'
                : image.status === 'error'
                  ? 'failed'
                  : `${image.width}x${image.height}`}
            </span>
          </div>
        </div>
      </button>
      <RemoveButton fileName={image.fileName} onRemove={onRemove} />
    </li>
  );
}

import {
  Check,
  Circle,
  MinusCircle,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';
import type { ImageStatus } from '../domain/session/sessionTypes';

function StatusIcon({ status }: { status: ImageStatus }) {
  if (status === 'measured') return <Check size={12} className="text-emerald-600 dark:text-emerald-400" />;
  if (status === 'skipped') return <MinusCircle size={12} className="text-amber-600 dark:text-amber-400" />;
  if (status === 'loading') return <Loader2 size={12} className="animate-spin text-blue-500 dark:text-cyan-300" />;
  if (status === 'error') return <AlertTriangle size={12} className="text-red-500 dark:text-red-300" />;
  return <Circle size={12} className="text-slate-400 dark:text-slate-500" />;
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
      title = `16-bit unsigned auto-contrast stretched to 8-bit (${native}, ${display}).`;
      break;
    case 'auto-contrast-16-rgb':
      label = '16-bit';
      title = `16-bit RGB auto-contrast stretched to 8-bit (${native}, ${display}).`;
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
