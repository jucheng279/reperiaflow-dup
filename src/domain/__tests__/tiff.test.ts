import { describe, it, expect } from 'vitest';
import { applyTiffStretch, type TiffStretchContext } from '../image/tiff';

function buildUint16Raw(values: number[], littleEndian: boolean): Uint8Array {
  const raw = new Uint8Array(values.length * 2);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < values.length; i++) view.setUint16(i * 2, values[i], littleEndian);
  return raw;
}

function buildFloat32Raw(values: number[], littleEndian: boolean): Uint8Array {
  const raw = new Uint8Array(values.length * 4);
  const view = new DataView(raw.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i], littleEndian);
  return raw;
}

describe('applyTiffStretch', () => {
  it('produces identical gray output for little-endian and big-endian uint16 input', () => {
    const values = [0, 1000, 2500, 5000, 10000, 20000, 40000, 65535];
    const le: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const be: TiffStretchContext = {
      ...le,
      raw: buildUint16Raw(values, false),
      littleEndian: false,
    };
    const leOut = applyTiffStretch(le, 'minmax');
    const beOut = applyTiffStretch(be, 'minmax');
    expect(Array.from(leOut.gray)).toEqual(Array.from(beOut.gray));
  });

  it('minmax stretch reports correct display range and spans full gray output', () => {
    const values = [100, 200, 300, 400, 500];
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { gray, displayMin, displayMax } = applyTiffStretch(ctx, 'minmax');
    expect(displayMin).toBe(100);
    expect(displayMax).toBe(500);
    expect(gray[0]).toBe(0);
    expect(gray[4]).toBeGreaterThanOrEqual(254);
    expect(gray[4]).toBeLessThanOrEqual(255);
    for (let i = 1; i < gray.length; i++) {
      expect(gray[i]).toBeGreaterThanOrEqual(gray[i - 1]);
    }
  });

  it('invert reverses monotonicity of gray output', () => {
    const values = [100, 200, 300, 400, 500];
    const normal: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const inverted: TiffStretchContext = { ...normal, invert: true };
    const a = applyTiffStretch(normal, 'minmax').gray;
    const b = applyTiffStretch(inverted, 'minmax').gray;
    for (let i = 1; i < a.length; i++) {
      expect(a[i]).toBeGreaterThanOrEqual(a[i - 1]);
      expect(b[i]).toBeLessThanOrEqual(b[i - 1]);
    }
  });

  it('handles NaN in float32 input without throwing', () => {
    const values = [0, 0.25, NaN, 0.75, 1];
    const ctx: TiffStretchContext = {
      kind: 'float32',
      raw: buildFloat32Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { gray } = applyTiffStretch(ctx, 'minmax');
    expect(gray[2]).toBe(0);
    expect(gray[0]).toBe(0);
    expect(gray[4]).toBe(255);
  });

  it('decodes BE-on-disk 16-bit bytes correctly after a UTIF-style in-place swap', () => {
    // Simulate UTIF2's contract: raw bytes on disk are big-endian, then UTIF
    // performs an in-place byte swap so downstream code receives LE bytes.
    const values = [100, 1234, 40000, 55000];
    const beBytes = buildUint16Raw(values, false);
    for (let i = 0; i < beBytes.length; i += 2) {
      const t = beBytes[i];
      beBytes[i] = beBytes[i + 1];
      beBytes[i + 1] = t;
    }
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: beBytes,
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { displayMin, displayMax, gray } = applyTiffStretch(ctx, 'minmax');
    expect(displayMin).toBe(100);
    expect(displayMax).toBe(55000);
    expect(gray[0]).toBe(0);
    expect(gray[3]).toBeGreaterThanOrEqual(254);
  });

  it('decodes BE-on-disk 16-bit bytes via the DataView fallback (DNG-style, no UTIF swap)', () => {
    const values = [250, 3000, 12000, 60000];
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, false),
      pixelCount: values.length,
      invert: false,
      littleEndian: false,
    };
    const { displayMin, displayMax } = applyTiffStretch(ctx, 'minmax');
    expect(displayMin).toBe(250);
    expect(displayMax).toBe(60000);
  });

  it('matches Fiji ShortProcessor.create8BitImage byte-for-byte for uint16 minmax', () => {
    // Verified against imagej/ImageJ ShortProcessor.create8BitImage:
    //   scale = 256 / (max - min + 1)
    //   byte  = (int)((v - min) * scale + 0.5)   <- round-half-up
    // For values [100, 200, 300, 400, 500] with min=100, max=500:
    //   scale = 256/401 = 0.638403...
    //   v=100 -> 0.5    -> 0
    //   v=200 -> 64.34  -> 64
    //   v=300 -> 128.18 -> 128
    //   v=400 -> 192.02 -> 192
    //   v=500 -> 255.86 -> 255 (clamp)
    const values = [100, 200, 300, 400, 500];
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { gray } = applyTiffStretch(ctx, 'minmax');
    expect(Array.from(gray)).toEqual([0, 64, 128, 192, 255]);
  });

  it('rounds 16-bit half-step values up like Fiji (catches truncation regressions)', () => {
    // With min=0, max=510 the 16-bit scale is 256/511 ≈ 0.50098.
    // v=255 -> 127.75 + 0.5 = 128.25 -> 128
    // (truncation without +0.5 would have produced 127, off-by-one.)
    const values = [0, 255, 510];
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { gray } = applyTiffStretch(ctx, 'minmax');
    expect(gray[1]).toBe(128);
  });

  it('matches Fiji FloatProcessor.create8BitImage byte-for-byte for float32 minmax', () => {
    // Verified against imagej/ImageJ FloatProcessor.create8BitImage:
    //   scale = 255 / (max - min)
    //   byte  = (int)((v - min) * scale + 0.5)
    const values = [0, 0.5, 1];
    const ctx: TiffStretchContext = {
      kind: 'float32',
      raw: buildFloat32Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { gray } = applyTiffStretch(ctx, 'minmax');
    expect(Array.from(gray)).toEqual([0, 128, 255]);
  });

  it('applies Fiji 0.35% saturation budget split across both ends (not 0.7%)', () => {
    // Fiji clips saturated/200 = 0.175% at each end. With 1000 pixels, the
    // per-end threshold is floor(1000 * 0.00175) = 1. The strict
    // `count > threshold` comparison means a single outlier per end is
    // enough to be clipped, leaving the dense bulk as the new display range.
    const values: number[] = [100];
    for (let i = 0; i < 998; i++) values.push(1000);
    values.push(9000);
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const { displayMin, displayMax } = applyTiffStretch(ctx, 'percentile');
    expect(displayMin).toBe(1000);
    expect(displayMax).toBe(1000);
  });

  it('returns a gray buffer only (no rgba field)', () => {
    const values = [0, 100, 200];
    const ctx: TiffStretchContext = {
      kind: 'uint16',
      raw: buildUint16Raw(values, true),
      pixelCount: values.length,
      invert: false,
      littleEndian: true,
    };
    const result = applyTiffStretch(ctx, 'minmax');
    expect(result.gray).toBeInstanceOf(Uint8Array);
    expect((result as unknown as { rgba?: unknown }).rgba).toBeUndefined();
  });
});
