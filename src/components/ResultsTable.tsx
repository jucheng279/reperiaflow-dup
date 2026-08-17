import { useState, type ReactNode } from 'react';
import { ArrowUpDown, Check, Clipboard, Download, Layers, Trash2 } from 'lucide-react';
import { useSessionStore } from '../domain/session/sessionStore';
import {
  rowsToCsv,
  rowsToHtmlTable,
  rowsToTsv,
  type CsvColumn,
} from '../domain/measurement/csv';
import { downloadText } from '../utils/download';
import type { MeasurementRow } from '../domain/measurement/measurementTypes';
import type { ResultsViewMode } from '../domain/session/uiTypes';

type SortKey = keyof MeasurementRow;

interface ColumnDef {
  key: SortKey;
  label: string;
  render: (r: MeasurementRow) => ReactNode;
  titleOf?: (r: MeasurementRow) => string | undefined;
  visible: (rows: MeasurementRow[]) => boolean;
  csvValue: (r: MeasurementRow) => string | number | null;
}

const hasAnyNumber = (rows: MeasurementRow[], key: keyof MeasurementRow): boolean =>
  rows.some((r) => {
    const v = r[key];
    return typeof v === 'number' && v !== 0 && !Number.isNaN(v);
  });

const anyCalibrated = (rows: MeasurementRow[]): boolean =>
  rows.some((r) => r.unit !== 'px');

const anyThresholdBound = (rows: MeasurementRow[]): boolean =>
  rows.some((r) => r.thresholdMin != null || r.thresholdMax != null);

async function copyRichTable(tsv: string, html: string): Promise<boolean> {
  try {
    if (
      navigator.clipboard &&
      window.isSecureContext &&
      typeof window.ClipboardItem !== 'undefined'
    ) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(tsv);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const container = document.createElement('div');
    container.setAttribute('contenteditable', 'true');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.opacity = '0';
    container.innerHTML = html;
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('copy');
    sel?.removeAllRanges();
    document.body.removeChild(container);
    if (ok) return true;
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = tsv;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function ResultsTable() {
  const rows = useSessionStore((s) => s.rows);
  const deleteRow = useSessionStore((s) => s.deleteRow);
  const viewMode = useSessionStore((s) => s.resultsViewMode);
  const setViewMode = useSessionStore((s) => s.setResultsViewMode);
  const [sortKey, setSortKey] = useState<SortKey>('queueIndex');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [copied, setCopied] = useState(false);

  const isFlat = viewMode === 'flat';

  const columns: ColumnDef[] = [
    {
      key: 'fileName',
      label: 'File',
      visible: () => true,
      render: (r) => <span title={r.fileName}>{r.fileName}</span>,
      titleOf: (r) => r.fileName,
      csvValue: (r) => r.fileName,
    },
    {
      key: 'queueIndex',
      label: '#',
      visible: () => true,
      render: (r) => r.queueIndex + 1,
      csvValue: (r) => r.queueIndex + 1,
    },
    {
      key: 'imageMode',
      label: 'Mode',
      visible: () => true,
      render: (r) => <span className="capitalize">{r.imageMode}</span>,
      csvValue: (r) => r.imageMode,
    },
    {
      key: 'roiType',
      label: 'ROI',
      visible: () => true,
      render: (r) =>
        r.roiType === 'full' ? 'Full image' : r.roiType === 'combined' ? 'Combined' : r.roiType,
      csvValue: (r) =>
        r.roiType === 'full' ? 'Full image' : r.roiType === 'combined' ? 'Combined' : r.roiType,
    },
    {
      key: 'unit',
      label: 'Unit',
      visible: anyCalibrated,
      render: (r) => r.unit,
      csvValue: (r) => r.unit,
    },
    {
      key: 'count',
      label: 'Count',
      visible: (rs) => rs.some((r) => r.count != null),
      render: (r) => (r.count == null ? '-' : r.count),
      csvValue: (r) => r.count,
    },
    {
      key: 'lengthPx',
      label: 'Len px',
      visible: (rs) => hasAnyNumber(rs, 'lengthPx'),
      render: (r) => fmt(r.lengthPx),
      csvValue: (r) => r.lengthPx,
    },
    {
      key: 'lengthCal',
      label: 'Length',
      visible: (rs) => anyCalibrated(rs) && hasAnyNumber(rs, 'lengthCal'),
      render: (r) => fmt(r.lengthCal),
      csvValue: (r) => r.lengthCal,
    },
    {
      key: 'thresholdedAreaPx',
      label: 'Area px',
      visible: (rs) => hasAnyNumber(rs, 'thresholdedAreaPx'),
      render: (r) => fmt(r.thresholdedAreaPx),
      csvValue: (r) => r.thresholdedAreaPx,
    },
    {
      key: 'thresholdedAreaCal',
      label: 'Area',
      visible: (rs) => anyCalibrated(rs),
      render: (r) => fmt(r.thresholdedAreaCal),
      csvValue: (r) => r.thresholdedAreaCal,
    },
    {
      key: 'integratedDensity',
      label: 'IntDens',
      visible: (rs) => hasAnyNumber(rs, 'integratedDensity'),
      render: (r) => fmt(r.integratedDensity),
      csvValue: (r) => r.integratedDensity,
    },
    {
      key: 'thresholdMin',
      label: 'Min',
      visible: anyThresholdBound,
      render: (r) => fmt(r.thresholdMin),
      csvValue: (r) => r.thresholdMin,
    },
    {
      key: 'thresholdMax',
      label: 'Max',
      visible: anyThresholdBound,
      render: (r) => fmt(r.thresholdMax),
      csvValue: (r) => r.thresholdMax,
    },
  ];

  const visibleColumns = columns.filter((c) => c.visible(rows));

  const activeSortKey: SortKey = visibleColumns.some((c) => c.key === sortKey)
    ? sortKey
    : 'queueIndex';

  const isDefaultSort = activeSortKey === 'queueIndex' && sortDir === 1;

  const sorted = [...rows].sort((a, b) => {
    if (isDefaultSort) {
      if (isFlat) {
        return a.queueIndex - b.queueIndex;
      }
      if (a.measuredAt !== b.measuredAt) return b.measuredAt - a.measuredAt;
      return a.queueIndex - b.queueIndex;
    }
    const av = a[activeSortKey];
    const bv = b[activeSortKey];
    if (av === bv) return a.queueIndex - b.queueIndex;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av > bv ? 1 : -1) * sortDir;
  });

  const groupBoundarySet = new Set<number>();
  if (!isFlat && isDefaultSort && sorted.length > 1) {
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const prevGroup = prev.batchId ?? prev.id;
      const curGroup = cur.batchId ?? cur.id;
      if (prevGroup !== curGroup) groupBoundarySet.add(i);
    }
  }

  const onSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(1);
    }
  };

  const csvColumns = (): CsvColumn[] =>
    visibleColumns.map((c) => ({ label: c.label, value: c.csvValue }));

  const onExport = () => {
    if (!rows.length) return;
    downloadText(
      `measurements-${new Date().toISOString().slice(0, 19)}.csv`,
      rowsToCsv(sorted, csvColumns()),
      'text/csv',
    );
  };

  const onCopy = async () => {
    if (!rows.length) return;
    const cols = csvColumns();
    const ok = await copyRichTable(rowsToTsv(sorted, cols), rowsToHtmlTable(sorted, cols));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const btnClass =
    'inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition-colors hover:border-blue-400 hover:text-blue-700 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-cyan-400 dark:hover:text-cyan-200';

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onCopy}
            disabled={rows.length === 0}
            className={btnClass}
            aria-label="Copy results to clipboard"
            title="Copy results to clipboard"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Clipboard size={12} /> Copy
              </>
            )}
          </button>
          <button
            onClick={onExport}
            disabled={rows.length === 0}
            className={btnClass}
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>
      <div>
        <table className="w-max text-[11px]">
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <tr>
              {visibleColumns.map((c) => (
                <Th
                  key={c.key as string}
                  col={c.key as string}
                  label={c.label}
                  onClick={() => onSort(c.key)}
                />
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => (
              <tr
                key={r.id}
                className={`border-t text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/40 ${groupBoundarySet.has(idx) ? 'border-t-2 border-slate-300 dark:border-slate-600' : 'border-slate-200 dark:border-slate-800'}`}
              >
                {visibleColumns.map((c) => (
                  <td
                    key={c.key as string}
                    className="whitespace-nowrap px-2 py-1"
                    title={c.titleOf?.(r)}
                  >
                    {c.render(r)}
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  <button
                    aria-label="Delete row"
                    onClick={() => deleteRow(r.id)}
                    className="text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-2 py-8 text-center text-xs text-slate-400 dark:text-slate-500"
                >
                  No measurements yet. Press Enter to measure the active image.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ResultsViewMode;
  onChange: (mode: ResultsViewMode) => void;
}) {
  const segmentClass = (active: boolean) =>
    `inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
      active
        ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
        : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
    }`;

  return (
    <div className="inline-flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
      <button
        className={segmentClass(value === 'batched')}
        onClick={() => onChange('batched')}
        title="Group results by measurement batch"
      >
        <Layers size={10} />
        Batched
      </button>
      <button
        className={segmentClass(value === 'flat')}
        onClick={() => onChange('flat')}
        title="Sort all results as a single flat list by queue order"
      >
        <ArrowUpDown size={10} />
        Sorted
      </button>
    </div>
  );
}

function fmt(v: number | null): string {
  if (v == null) return '-';
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

function Th({
  col,
  label,
  onClick,
}: {
  col: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <th
      onClick={onClick}
      className="cursor-pointer whitespace-nowrap px-2 py-1 text-left font-medium hover:text-blue-700 dark:hover:text-cyan-200"
      data-col={col}
    >
      {label}
    </th>
  );
}
