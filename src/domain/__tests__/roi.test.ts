import { describe, it, expect } from 'vitest';
import { rasterizeRoi } from '../roi/roiRasterize';

function count(mask: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) c++;
  return c;
}

describe('rasterizeRoi', () => {
  it('rectangle covers exact pixel count', () => {
    const m = rasterizeRoi({ type: 'rectangle', x: 2, y: 2, w: 4, h: 3 }, 10, 10);
    expect(count(m.data)).toBe(12);
  });

  it('ellipse area approximates PI/4 * w * h', () => {
    const w = 40;
    const h = 40;
    const m = rasterizeRoi({ type: 'ellipse', x: 5, y: 5, w, h }, 50, 50);
    const expected = (Math.PI / 4) * w * h;
    const actual = count(m.data);
    expect(Math.abs(actual - expected) / expected).toBeLessThan(0.05);
  });

  it('polygon matches triangle area', () => {
    const m = rasterizeRoi(
      {
        type: 'polygon',
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
      },
      20,
      20,
    );
    const actual = count(m.data);
    expect(actual).toBeGreaterThan(40);
    expect(actual).toBeLessThan(70);
  });

  it('clips out-of-bounds rectangles', () => {
    const m = rasterizeRoi({ type: 'rectangle', x: -5, y: -5, w: 20, h: 20 }, 10, 10);
    expect(count(m.data)).toBe(100);
  });
});
