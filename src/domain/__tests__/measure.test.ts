import { describe, it, expect } from 'vitest';
import { measure } from '../measurement/measure';
import { buildThresholdMask } from '../threshold/thresholdEngine';
import { rasterizeRoi } from '../roi/roiRasterize';

describe('measure', () => {
  it('counts only inside ROI and threshold', () => {
    const gray = new Uint8Array([10, 50, 100, 150, 200, 250, 10, 20, 30]);
    const threshold = buildThresholdMask(gray, { min: 100, max: 255 });
    const roi = new Uint8Array([1, 1, 1, 0, 0, 0, 1, 1, 1]);
    const r = measure(gray, threshold, roi);
    expect(r.roiAreaPx).toBe(6);
    expect(r.thresholdedAreaPx).toBe(1); // only value 100 qualifies inside ROI
    expect(r.integratedDensity).toBe(100);
  });

  it('integrates correctly over a rectangle', () => {
    const w = 4;
    const h = 4;
    const gray = new Uint8Array(w * h).fill(200);
    const thresh = buildThresholdMask(gray, { min: 0, max: 255 });
    const roi = rasterizeRoi({ type: 'rectangle', x: 0, y: 0, w: 2, h: 2 }, w, h);
    const r = measure(gray, thresh, roi.data);
    expect(r.roiAreaPx).toBe(4);
    expect(r.thresholdedAreaPx).toBe(4);
    expect(r.integratedDensity).toBe(4 * 200);
  });

  it('throws on length mismatch', () => {
    expect(() => measure(new Uint8Array(3), new Uint8Array(4), new Uint8Array(3))).toThrow();
  });
});
