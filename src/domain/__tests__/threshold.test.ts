import { describe, it, expect } from 'vitest';
import { buildThresholdMask, countThresholdPositive } from '../threshold/thresholdEngine';
import { clampRange } from '../threshold/thresholdTypes';

describe('buildThresholdMask', () => {
  it('marks inclusive min/max range', () => {
    const gray = new Uint8Array([0, 40, 128, 200, 255]);
    const mask = buildThresholdMask(gray, { min: 40, max: 200 });
    expect(Array.from(mask)).toEqual([0, 1, 1, 1, 0]);
  });

  it('empty range produces all-zero mask', () => {
    const gray = new Uint8Array([10, 20, 30]);
    const mask = buildThresholdMask(gray, { min: 100, max: 110 });
    expect(countThresholdPositive(mask)).toBe(0);
  });
});

describe('clampRange', () => {
  it('clamps to 0..255 and swaps inverted bounds', () => {
    expect(clampRange({ min: -5, max: 300 })).toEqual({ min: 0, max: 255 });
    expect(clampRange({ min: 200, max: 100 })).toEqual({ min: 100, max: 200 });
  });
});
