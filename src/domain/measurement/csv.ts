import type { MeasurementRow } from './measurementTypes';

export interface CsvColumn {
  label: string;
  value: (r: MeasurementRow) => string | number | null;
}

const DEFAULT_COLUMNS: CsvColumn[] = [
  { label: 'id', value: (r) => r.id },
  { label: 'imageId', value: (r) => r.imageId },
  { label: 'fileName', value: (r) => r.fileName },
  { label: 'queueIndex', value: (r) => r.queueIndex },
  { label: 'profile', value: (r) => r.profile },
  { label: 'imageMode', value: (r) => r.imageMode },
  { label: 'roiType', value: (r) => r.roiType },
  { label: 'unit', value: (r) => r.unit },
  { label: 'pixelWidth', value: (r) => r.pixelWidth },
  { label: 'pixelHeight', value: (r) => r.pixelHeight },
  { label: 'lengthPx', value: (r) => r.lengthPx },
  { label: 'lengthCal', value: (r) => r.lengthCal },
  { label: 'count', value: (r) => r.count },
  { label: 'thresholdSource', value: (r) => r.thresholdSource ?? '' },
  { label: 'thresholdMin', value: (r) => r.thresholdMin },
  { label: 'thresholdMax', value: (r) => r.thresholdMax },
  { label: 'thresholdedAreaPx', value: (r) => r.thresholdedAreaPx },
  { label: 'thresholdedAreaCal', value: (r) => r.thresholdedAreaCal },
  { label: 'integratedDensity', value: (r) => r.integratedDensity },
  { label: 'measuredAtIso', value: (r) => r.measuredAtIso },
];

export function rowsToCsv(
  rows: MeasurementRow[],
  columns: CsvColumn[] = DEFAULT_COLUMNS,
): string {
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const r of rows) {
    lines.push(columns.map((c) => formatCsvValue(c.value(r))).join(','));
  }
  return lines.join('\n');
}

function formatCsvValue(v: string | number | null): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return csvEscape(v);
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToTsv(
  rows: MeasurementRow[],
  columns: CsvColumn[] = DEFAULT_COLUMNS,
): string {
  const lines = [columns.map((c) => tsvEscape(c.label)).join('\t')];
  for (const r of rows) {
    lines.push(columns.map((c) => formatTsvValue(c.value(r))).join('\t'));
  }
  return lines.join('\r\n');
}

function formatTsvValue(v: string | number | null): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return tsvEscape(v);
}

function tsvEscape(s: string): string {
  return s.replace(/[\t\r\n]+/g, ' ');
}

export function rowsToHtmlTable(
  rows: MeasurementRow[],
  columns: CsvColumn[] = DEFAULT_COLUMNS,
): string {
  const cellStyle = ' style="white-space:nowrap;"';
  const head = `<thead><tr>${columns
    .map((c) => `<th${cellStyle}>${htmlEscape(c.label)}</th>`)
    .join('')}</tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (r) =>
        `<tr>${columns
          .map((c) => `<td${cellStyle}>${formatHtmlValue(c.value(r))}</td>`)
          .join('')}</tr>`,
    )
    .join('')}</tbody>`;
  return `<table style="white-space:nowrap;border-collapse:collapse;">${head}${body}</table>`;
}

function formatHtmlValue(v: string | number | null): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return htmlEscape(v);
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
