import type { GrayscaleBuffer } from './bufferTypes';
import type { HueBucket } from './colorStats';

export type GrayscaleMode =
  | 'average'
  | 'weighted-rgb'
  | 'weighted-rgb-709'
  | 'red'
  | 'green'
  | 'blue'
  | 'max';

export const GRAYSCALE_MODES: readonly GrayscaleMode[] = [
  'red',
  'green',
  'blue',
  'max',
  'average',
  'weighted-rgb',
  'weighted-rgb-709',
];

export const GRAYSCALE_MODE_LABELS: Record<GrayscaleMode, string> = {
  red: 'Red channel',
  green: 'Green channel',
  blue: 'Blue channel',
  max: 'Max channel (for mixed colors)',
  average: 'Average (Fiji default)',
  'weighted-rgb': 'Weighted RGB (BT.601)',
  'weighted-rgb-709': 'Weighted RGB (BT.709)',
};

/**
 * Map a detected hue bucket to the most faithful grayscale conversion.
 * Pure primaries take the single matching channel. Mixed/warm/cool hues
 * go to max-channel, which preserves the brightest component per pixel
 * and therefore works well for pseudo-color LUT images (fire, yellow,
 * orange, cyan, magenta). Neutral images fall back to Fiji's average.
 */
export function modeFromHueBucket(bucket: HueBucket): GrayscaleMode {
  switch (bucket) {
    case 'red':
      return 'red';
    case 'green':
      return 'green';
    case 'blue':
      return 'blue';
    case 'orange':
    case 'yellow':
    case 'cyan':
    case 'magenta':
      return 'max';
    case 'gray':
    default:
      return 'average';
  }
}

export function rgbaToGray8(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  mode: GrayscaleMode = 'weighted-rgb',
): GrayscaleBuffer {
  const n = width * height;
  const out = new Uint8Array(n);
  switch (mode) {
    case 'average': {
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const y = (((rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3) + 0.5) | 0;
        out[i] = y > 255 ? 255 : y;
      }
      break;
    }
    case 'weighted-rgb-709': {
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const y = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2] + 0.5) | 0;
        out[i] = y > 255 ? 255 : y < 0 ? 0 : y;
      }
      break;
    }
    case 'red': {
      for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = rgba[p];
      break;
    }
    case 'green': {
      for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = rgba[p + 1];
      break;
    }
    case 'blue': {
      for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = rgba[p + 2];
      break;
    }
    case 'max': {
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const r = rgba[p];
        const g = rgba[p + 1];
        const b = rgba[p + 2];
        const m = r > g ? r : g;
        out[i] = m > b ? m : b;
      }
      break;
    }
    case 'weighted-rgb':
    default: {
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const y = (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2] + 0.5) | 0;
        out[i] = y > 255 ? 255 : y < 0 ? 0 : y;
      }
      break;
    }
  }
  return { width, height, data: out };
}

/**
 * Convert interleaved 16-bit RGB (3 samples per pixel, Uint16Array) to a
 * 16-bit grayscale Uint16Array, preserving full precision before any
 * 16-to-8 stretch. The caller is responsible for the stretch step.
 */
export function rgb16ToGray16(
  src: Uint16Array,
  pixelCount: number,
  mode: GrayscaleMode = 'weighted-rgb',
): Uint16Array {
  const out = new Uint16Array(pixelCount);
  switch (mode) {
    case 'average': {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) {
        out[i] = ((src[p] + src[p + 1] + src[p + 2]) / 3 + 0.5) | 0;
      }
      break;
    }
    case 'weighted-rgb-709': {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) {
        out[i] = (0.2126 * src[p] + 0.7152 * src[p + 1] + 0.0722 * src[p + 2] + 0.5) | 0;
      }
      break;
    }
    case 'red': {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) out[i] = src[p];
      break;
    }
    case 'green': {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) out[i] = src[p + 1];
      break;
    }
    case 'blue': {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) out[i] = src[p + 2];
      break;
    }
    case 'max': {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) {
        const r = src[p];
        const g = src[p + 1];
        const b = src[p + 2];
        const m = r > g ? r : g;
        out[i] = m > b ? m : b;
      }
      break;
    }
    case 'weighted-rgb':
    default: {
      for (let i = 0, p = 0; i < pixelCount; i++, p += 3) {
        out[i] = (0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2] + 0.5) | 0;
      }
      break;
    }
  }
  return out;
}
