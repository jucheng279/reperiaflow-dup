import { useEffect, useRef, useState } from 'react';
import { Square, Circle, PenTool, Spline, Minus, ArrowUp, PenLine, MousePointerClick, Ruler, Trash2, PencilLine, Copy, type LucideIcon } from 'lucide-react';
import { useSessionStore, type RoiTool } from '../domain/session/sessionStore';
import { describeRoi } from '../domain/roi/roiGeometry';
import { selectedRoi } from '../domain/session/sessionTypes';
import { calibrationFromLine, isCalibrated, unitLabel, type Calibration } from '../domain/image/calibration';
import { isOpenRoi, isPointRoi, roiPathLengthPx } from '../domain/roi/roiTypes';

interface ToolDef {
  id: RoiTool;
  label: string;
  hint: string;
  icon: LucideIcon;
  group: 'closed' | 'open' | 'point' | 'scale';
}

const TOOLS: ToolDef[] = [
  { id: 'rectangle', label: 'Rectangle', hint: 'R', icon: Square, group: 'closed' },
  { id: 'ellipse', label: 'Ellipse', hint: 'E', icon: Circle, group: 'closed' },
  { id: 'polygon', label: 'Polygon', hint: 'P', icon: Spline, group: 'closed' },
  { id: 'freehand', label: 'Freehand', hint: 'F', icon: PenTool, group: 'closed' },
  { id: 'line', label: 'Line', hint: 'L', icon: Minus, group: 'open' },
  { id: 'freehandLine', label: 'Freehand line', hint: 'N', icon: PenLine, group: 'open' },
  { id: 'point', label: 'Point (click to count)', hint: '', icon: MousePointerClick, group: 'point' },
  { id: 'pointArrow', label: 'Point arrow (click to count)', hint: '', icon: ArrowUp, group: 'point' },
  { id: 'setScale', label: 'Set Scale', hint: '', icon: Ruler, group: 'scale' },
];

export function RoiToolbar() {
  const activeTool = useSessionStore((s) => s.activeTool);
  const setTool = useSessionStore((s) => s.setActiveTool);
  const active = useSessionStore((s) => s.images[s.activeIndex] ?? null);
  const mode = useSessionStore((s) => s.imagingMode);
  const clearSelectedRoi = useSessionStore((s) => s.clearSelectedRoi);
  const clearAllRois = useSessionStore((s) => s.clearAllRois);
  const setSelectedRoiIndex = useSessionStore((s) => s.setSelectedRoiIndex);
  const setCalibration = useSessionStore((s) => s.setCalibration);
  const setCalibrationForAll = useSessionStore((s) => s.setCalibrationForAll);
  const requestScalePromptFromRoi = useSessionStore((s) => s.requestScalePromptFromRoi);
  const images = useSessionStore((s) => s.images);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [manualScaleOpen, setManualScaleOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [popoverOpen]);

  if (!active) return null;

  const calibration = active.calibration;
  const closedTools = TOOLS.filter((t) => t.group === 'closed');
  const openTools = TOOLS.filter((t) => t.group === 'open');
  const pointTools = TOOLS.filter((t) => t.group === 'point');
  const scaleTool = TOOLS.find((t) => t.group === 'scale')!;
  const rois = active.rois;
  const selectedIdx = active.selectedRoiIndex;
  const selRoi = selectedRoi(active);
  const reusableRoi = selRoi && isOpenRoi(selRoi) ? selRoi : null;
  const reusablePx = reusableRoi ? roiPathLengthPx(reusableRoi) : 0;
  const canReuse = reusableRoi !== null && reusablePx >= 3;

  return (
    <section className="theme-transition space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60 dark:shadow-none">
      <header className="relative flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
          ROI
          {rois.length > 0 && (
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setPopoverOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
              title="Show drawn ROIs"
              className={
                'theme-transition inline-flex h-5 min-w-[20px] items-center justify-center rounded px-1.5 text-[10px] font-medium ' +
                (popoverOpen
                  ? 'bg-cyan-500 text-white shadow-sm dark:bg-cyan-400 dark:text-slate-900'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600')
              }
            >
              {rois.length}
            </button>
          )}
        </h2>
        {popoverOpen && rois.length > 0 && (
          <div
            ref={popoverRef}
            role="dialog"
            className="theme-transition absolute left-0 top-full z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-600 dark:bg-slate-800"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Drawn ROIs
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {rois.length} total
              </span>
            </div>
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {rois.map((roi, i) => (
                <li key={i}>
                  <button
                    onClick={() => setSelectedRoiIndex(i)}
                    className={
                      'theme-transition flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] ' +
                      (i === selectedIdx
                        ? 'border-cyan-400 bg-cyan-50 text-cyan-900 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-slate-700/40')
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={
                          'inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold ' +
                          (i === selectedIdx
                            ? 'bg-cyan-500 text-white dark:bg-cyan-400 dark:text-slate-900'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200')
                        }
                      >
                        {i + 1}
                      </span>
                      <span>{describeRoi(roi)}</span>
                    </span>
                    <span className="text-[9px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {isPointRoi(roi) ? 'count' : isOpenRoi(roi) ? 'length' : 'area'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center gap-2">
          {rois.length > 0 && (
            <button
              onClick={clearSelectedRoi}
              disabled={selectedIdx < 0}
              title="Remove the currently selected ROI"
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:border-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:text-red-300"
            >
              <Trash2 size={12} /> clear
            </button>
          )}
          {rois.length > 1 && (
            <button
              onClick={clearAllRois}
              title="Remove all ROIs on this image"
              className="text-[10px] text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-300"
            >
              clear all
            </button>
          )}
        </div>
      </header>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Area
        </div>
        <div className="grid grid-cols-4 gap-2">
          {closedTools.map((t) => (
            <ToolButton key={t.id} tool={t} active={activeTool === t.id} onSelect={setTool} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 grid grid-cols-4 gap-2 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span className="col-span-2 flex items-center">
            Length
            {mode === 'brightfield' && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[9px] normal-case text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                brightfield
              </span>
            )}
          </span>
          <span className="col-span-2">Point</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {openTools.map((t) => (
            <ToolButton key={t.id} tool={t} active={activeTool === t.id} onSelect={setTool} />
          ))}
          {pointTools.map((t) => (
            <ToolButton key={t.id} tool={t} active={activeTool === t.id} onSelect={setTool} />
          ))}
        </div>
      </div>

      <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-slate-700">
        <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
          <span>Scale</span>
          <div className="flex items-center gap-2">
            {isCalibrated(calibration) && images.length > 1 && (
              <button
                onClick={() => setCalibrationForAll(calibration)}
                title="Apply this scale to all images"
                className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-cyan-300"
              >
                <Copy size={10} /> apply to all
              </button>
            )}
            {isCalibrated(calibration) && (
              <button
                onClick={() => setCalibration(active.id, { pixelWidth: 1, pixelHeight: 1, unit: 'px', source: 'none' })}
                className="text-[10px] text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-300"
              >
                clear
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canReuse ? (
            <button
              onClick={requestScalePromptFromRoi}
              title={`Use the selected ${reusableRoi!.type} (${reusablePx.toFixed(1)} px) as the scale reference.`}
              className="theme-transition inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-amber-400 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100 dark:bg-amber-400/10 dark:text-amber-100 dark:hover:bg-amber-400/20"
            >
              <Ruler size={12} /> Set Scale
            </button>
          ) : (
            <button
              onClick={() => setTool(scaleTool.id)}
              title="Draw a line over a known length to calibrate pixel size."
              className={
                'theme-transition inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ' +
                (activeTool === 'setScale'
                  ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-slate-700/40')
              }
            >
              <Ruler size={12} /> Set Scale
            </button>
          )}
          <button
            onClick={() => setManualScaleOpen(true)}
            title="Enter scale manually (pixels per unit)"
            className="theme-transition inline-flex items-center justify-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-slate-700/40"
          >
            <PencilLine size={12} /> Manual
          </button>
        </div>
        <span className="block rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
          {isCalibrated(calibration)
            ? `1 px = ${calibration.pixelWidth.toPrecision(3)} ${calibration.unit}`
            : `uncalibrated (${unitLabel(calibration)})`}
        </span>
        {canReuse && (
          <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
            selected line ({reusablePx.toFixed(1)} px)
          </p>
        )}
      </div>

      {manualScaleOpen && (
        <ManualScaleDialog
          onSubmit={(pixelDistance, knownLength, unit, applyToAll) => {
            const cal = calibrationFromLine(pixelDistance, knownLength, unit);
            if (cal.source === 'none') return;
            if (applyToAll) {
              setCalibrationForAll(cal);
            } else {
              setCalibration(active.id, cal);
            }
            setManualScaleOpen(false);
          }}
          onCancel={() => setManualScaleOpen(false)}
          showApplyAll={images.length > 1}
          existingCalibration={active?.calibration}
        />
      )}
    </section>
  );
}

function ToolButton({
  tool,
  active,
  onSelect,
}: {
  tool: ToolDef;
  active: boolean;
  onSelect: (t: RoiTool) => void;
}) {
  const Icon = tool.icon;
  return (
    <button
      onClick={() => onSelect(tool.id)}
      title={tool.hint ? `${tool.label} (${tool.hint})` : tool.label}
      className={
        'theme-transition relative flex aspect-square items-center justify-center rounded-md border text-[11px] ' +
        (active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-100'
          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:border-slate-400 dark:hover:bg-slate-700/40')
      }
    >
      {tool.hint && (
        <span className="absolute right-1 top-1 rounded bg-slate-100 px-1 text-[9px] text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
          {tool.hint}
        </span>
      )}
      <Icon size={20} />
    </button>
  );
}

function ManualScaleDialog({
  onSubmit,
  onCancel,
  showApplyAll,
  existingCalibration,
}: {
  onSubmit: (pixelDistance: number, knownLength: number, unit: string, applyToAll: boolean) => void;
  onCancel: () => void;
  showApplyAll: boolean;
  existingCalibration?: Calibration;
}) {
  const hasExisting = existingCalibration && isCalibrated(existingCalibration);
  const [pixelDistance, setPixelDistance] = useState(hasExisting ? '1' : '');
  const [knownLength, setKnownLength] = useState(
    hasExisting ? String(+existingCalibration.pixelWidth.toPrecision(6)) : ''
  );
  const [unit, setUnit] = useState(hasExisting ? existingCalibration.unit : 'um');

  const parsedPx = parseFloat(pixelDistance);
  const parsedLen = parseFloat(knownLength);
  const valid =
    Number.isFinite(parsedPx) &&
    parsedPx > 0 &&
    Number.isFinite(parsedLen) &&
    parsedLen > 0 &&
    unit.trim().length > 0;

  const inputClass =
    'mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-transparent dark:bg-slate-800 dark:text-slate-100 dark:focus:border-cyan-400';

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/60">
      <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
        Manual Set Scale
      </h4>
      <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
        Enter a known pixel distance and the real-world length it represents.
      </p>
      <div className="mt-3 space-y-2">
        <label className="block text-[11px] text-slate-600 dark:text-slate-300">
          Distance in pixels
          <input
            autoFocus
            type="number"
            step="any"
            value={pixelDistance}
            onChange={(e) => setPixelDistance(e.target.value)}
            className={inputClass}
            placeholder="e.g. 100"
          />
        </label>
        <label className="block text-[11px] text-slate-600 dark:text-slate-300">
          Known length
          <input
            type="number"
            step="any"
            value={knownLength}
            onChange={(e) => setKnownLength(e.target.value)}
            className={inputClass}
            placeholder="e.g. 50"
          />
        </label>
        <label className="block text-[11px] text-slate-600 dark:text-slate-300">
          Unit
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={inputClass}
            placeholder="e.g. um, mm, nm"
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded border border-slate-200 px-2.5 py-1 text-[11px] text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:border-slate-400"
        >
          Cancel
        </button>
        {showApplyAll && (
          <button
            disabled={!valid}
            onClick={() => valid && onSubmit(parsedPx, parsedLen, unit, true)}
            className="rounded border border-blue-600 px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40 dark:border-cyan-500 dark:text-cyan-400 dark:hover:bg-cyan-400/10"
          >
            Apply All
          </button>
        )}
        <button
          disabled={!valid}
          onClick={() => valid && onSubmit(parsedPx, parsedLen, unit, false)}
          className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40 dark:bg-cyan-500 dark:text-slate-900 dark:hover:bg-cyan-400"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
