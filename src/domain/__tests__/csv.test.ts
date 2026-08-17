import { describe, it, expect } from 'vitest';
import { rowsToCsv } from '../measurement/csv';
import type { MeasurementRow } from '../measurement/measurementTypes';

const row: MeasurementRow = {
  id: 'r1',
  imageId: 'i1',
  fileName: 'a,b.png',
  queueIndex: 0,
  profile: 'fluorescence',
  imageMode: 'fluorescence',
  thresholdSource: 'threshold',
  thresholdMin: 10,
  thresholdMax: 20,
  roiType: 'rectangle',
  roiAreaPx: 100,
  thresholdedAreaPx: 50,
  thresholdedAreaCal: null,
  integratedDensity: 1234.5,
  lengthPx: null,
  lengthCal: null,
  count: null,
  areaCal: 100,
  pixelWidth: 1,
  pixelHeight: 1,
  unit: 'px',
  measuredAtIso: '2024-01-01T00:00:00.000Z',
  measuredAt: 1704067200000,
  batchId: null,
};

describe('rowsToCsv', () => {
  it('emits header + escaped rows', () => {
    const csv = rowsToCsv([row]);
    const lines = csv.split('\n');
    expect(lines[0].startsWith('id,imageId,fileName')).toBe(true);
    expect(lines[1]).toContain('"a,b.png"');
  });

  it('handles empty input', () => {
    const csv = rowsToCsv([]);
    expect(csv.split('\n').length).toBe(1);
  });
});
