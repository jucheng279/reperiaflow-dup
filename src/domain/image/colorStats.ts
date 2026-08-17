export type HueBucket =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'magenta'
  | 'gray';

export interface ColorStats {
  meanR: number;
  meanG: number;
  meanB: number;
  meanHue: number;
  hueBucket: HueBucket;
  sampledPixels: number;
}

const BACKGROUND_LUMA_THRESHOLD = 8;

export function computeColorStats(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): ColorStats {
  const n = width * height;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumS = 0;
  let sumHueX = 0;
  let sumHueY = 0;
  let sampled = 0;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const luma = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
    if (luma < BACKGROUND_LUMA_THRESHOLD) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    const { h, s } = rgbToHs(r, g, b);
    sumS += s;
    // Weight circular-mean by saturation so unsaturated pixels don't pull the hue.
    const rad = (h * Math.PI) / 180;
    sumHueX += Math.cos(rad) * s;
    sumHueY += Math.sin(rad) * s;
    sampled++;
  }

  if (sampled === 0) {
    return {
      meanR: 0,
      meanG: 0,
      meanB: 0,
      meanHue: 0,
      hueBucket: 'gray',
      sampledPixels: 0,
    };
  }

  const meanR = sumR / sampled;
  const meanG = sumG / sampled;
  const meanB = sumB / sampled;
  const meanS = sumS / sampled;
  let meanHue = (Math.atan2(sumHueY, sumHueX) * 180) / Math.PI;
  if (meanHue < 0) meanHue += 360;

  const hueBucket = classifyHue(meanHue, meanS);

  return {
    meanR,
    meanG,
    meanB,
    meanHue,
    hueBucket,
    sampledPixels: sampled,
  };
}

function rgbToHs(r: number, g: number, b: number): { h: number; s: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s };
}

function classifyHue(hue: number, saturation: number): HueBucket {
  if (saturation < 0.12) return 'gray';
  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 200) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 345) return 'magenta';
  return 'red';
}

export function swatchCss(stats: ColorStats): string {
  const r = Math.round(stats.meanR);
  const g = Math.round(stats.meanG);
  const b = Math.round(stats.meanB);
  return `rgb(${r}, ${g}, ${b})`;
}
