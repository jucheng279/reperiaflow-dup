import { describe, it, expect } from 'vitest';
import { modeFromHueBucket, rgbaToGray8 } from '../image/grayscale';

describe('rgbaToGray8', () => {
  it('preserves pure gray input (default Weighted RGB)', () => {
    const rgba = new Uint8ClampedArray([100, 100, 100, 255, 42, 42, 42, 255]);
    const g = rgbaToGray8(rgba, 2, 1);
    expect(Array.from(g.data)).toEqual([100, 42]);
  });

  it('weighted-rgb applies BT.601 coefficients', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255]);
    const g = rgbaToGray8(rgba, 1, 1, 'weighted-rgb');
    expect(g.data[0]).toBe(76);
  });

  it('weighted-rgb-709 applies BT.709 coefficients', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255]);
    const g = rgbaToGray8(rgba, 1, 1, 'weighted-rgb-709');
    expect(g.data[0]).toBe(54);
  });

  it('average matches Fiji default (R+G+B)/3', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const g = rgbaToGray8(rgba, 3, 1, 'average');
    expect(Array.from(g.data)).toEqual([85, 85, 85]);
  });

  it('red/green/blue return the raw channel', () => {
    const rgba = new Uint8ClampedArray([10, 200, 30, 255, 50, 123, 255, 255]);
    expect(Array.from(rgbaToGray8(rgba, 2, 1, 'red').data)).toEqual([10, 50]);
    expect(Array.from(rgbaToGray8(rgba, 2, 1, 'green').data)).toEqual([200, 123]);
    expect(Array.from(rgbaToGray8(rgba, 2, 1, 'blue').data)).toEqual([30, 255]);
  });

  it('max returns the brightest channel per pixel', () => {
    const rgba = new Uint8ClampedArray([10, 200, 30, 255, 50, 123, 255, 255, 0, 0, 0, 255]);
    const g = rgbaToGray8(rgba, 3, 1, 'max');
    expect(Array.from(g.data)).toEqual([200, 255, 0]);
  });
});

describe('modeFromHueBucket', () => {
  it('maps pure primaries to single channels', () => {
    expect(modeFromHueBucket('red')).toBe('red');
    expect(modeFromHueBucket('green')).toBe('green');
    expect(modeFromHueBucket('blue')).toBe('blue');
  });

  it('maps mixed hues (orange/yellow/cyan/magenta) to max', () => {
    expect(modeFromHueBucket('orange')).toBe('max');
    expect(modeFromHueBucket('yellow')).toBe('max');
    expect(modeFromHueBucket('cyan')).toBe('max');
    expect(modeFromHueBucket('magenta')).toBe('max');
  });

  it('maps gray to average (Fiji default)', () => {
    expect(modeFromHueBucket('gray')).toBe('average');
  });
});
