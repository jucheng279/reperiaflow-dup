import pako from 'pako';
import { modeFromHueBucket, rgbaToGray8, rgb16ToGray16, type GrayscaleMode } from './grayscale';
import type { GrayscaleBuffer, RgbaBuffer } from './bufferTypes';
import { computeColorStats, type ColorStats } from './colorStats';
import {
  isTiffFile,
  DEFAULT_TIFF_STRETCH_MODE,
  type TiffMetadata,
  type TiffSourceInfo,
  type TiffStretchContext,
  type TiffStretchMode,
} from './tiff';
import { decodeTiffFile } from '../../workers/tiffClient';

export interface FileMetadata {
  sizeBytes: number;
  mimeType: string;
  lastModified: number;
  bitDepth?: number;
  channels?: number;
}

export interface DecodeResult {
  width: number;
  height: number;
  gray: GrayscaleBuffer;
  rgba?: RgbaBuffer;
  color?: ColorStats;
  grayscaleMode: GrayscaleMode;
  pageIndex?: number;
  pageCount?: number;
  tiffSource?: TiffSourceInfo;
  tiffStretchMode?: TiffStretchMode;
  tiffStretchContext?: TiffStretchContext;
  tiffMetadata?: TiffMetadata;
}

export function detectBitDepthFromHeader(header: Uint8Array): { bitDepth: number; channels: number } | null {
  // PNG: signature 137 80 78 71 13 10 26 10, IHDR at offset 8
  if (
    header.length >= 29 &&
    header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
  ) {
    const bitDepth = header[24];
    const colorType = header[25];
    let channels = 1;
    if (colorType === 2) channels = 3;       // RGB
    else if (colorType === 4) channels = 2;  // Gray+Alpha
    else if (colorType === 6) channels = 4;  // RGBA
    return { bitDepth, channels };
  }
  // BMP: signature "BM", bpp at offset 28
  if (header.length >= 30 && header[0] === 0x42 && header[1] === 0x4d) {
    const bpp = header[28] | (header[29] << 8);
    const channels = bpp >= 24 ? 3 : 1;
    return { bitDepth: bpp >= 24 ? 8 : bpp, channels };
  }
  return null;
}

export async function fileMetadataFromFileAsync(file: File): Promise<FileMetadata> {
  const base: FileMetadata = {
    sizeBytes: file.size,
    mimeType: file.type || 'application/octet-stream',
    lastModified: file.lastModified,
  };
  try {
    const slice = file.slice(0, 30);
    const buf = await slice.arrayBuffer();
    const header = new Uint8Array(buf);
    const info = detectBitDepthFromHeader(header);
    if (info) {
      base.bitDepth = info.bitDepth;
      base.channels = info.channels;
    }
  } catch { /* ignore */ }
  return base;
}

export function fileMetadataFromFile(file: File): FileMetadata {
  return {
    sizeBytes: file.size,
    mimeType: file.type || 'application/octet-stream',
    lastModified: file.lastModified,
  };
}

export async function decodeFileToGray(file: File): Promise<DecodeResult> {
  const results = await decodeFileToPages(file);
  return results[0];
}

export async function decodeFileToPages(
  file: File,
  tiffStretchMode?: TiffStretchMode,
): Promise<DecodeResult[]> {
  if (isTiffFile(file)) {
    const pages = await decodeTiffFile(file, tiffStretchMode);
    return pages.map((page, index) => {
      if (page.isGrayscale && page.gray) {
        const { width, height } = page;
        return {
          width,
          height,
          gray: { width, height, data: page.gray },
          grayscaleMode: 'average' as GrayscaleMode,
          pageIndex: index,
          pageCount: pages.length,
          tiffSource: page.source,
          tiffStretchMode: page.stretchMode,
          tiffStretchContext: page.stretchContext,
          tiffMetadata: page.metadata,
        };
      }
      // 16-bit RGB: gray already computed at full precision, rgba available for preview
      if (page.detectedGrayscaleMode && page.gray) {
        const { width, height } = page;
        const rgba: RgbaBuffer | undefined = page.rgba
          ? { width, height, data: page.rgba }
          : undefined;
        const color = page.rgba
          ? computeColorStats(page.rgba, width, height)
          : undefined;
        return {
          width,
          height,
          gray: { width, height, data: page.gray },
          rgba,
          color,
          grayscaleMode: page.detectedGrayscaleMode,
          pageIndex: index,
          pageCount: pages.length,
          tiffSource: page.source,
          tiffStretchMode: page.stretchMode,
          tiffStretchContext: page.stretchContext,
          tiffMetadata: page.metadata,
        };
      }
      if (!page.rgba) {
        throw new Error(`TIFF page ${index + 1}: missing decoded pixel data`);
      }
      return rgbaToDecodeResult(
        page.rgba,
        page.width,
        page.height,
        index,
        pages.length,
        page.source,
        page.stretchMode,
        page.stretchContext,
        page.metadata,
      );
    });
  }
  // Detect 16-bit non-TIFF images and route through high-bit-depth pipeline
  const header = new Uint8Array(await file.slice(0, 30).arrayBuffer());
  const headerInfo = detectBitDepthFromHeader(header);
  if (headerInfo && headerInfo.bitDepth === 16) {
    const result = await decode16BitPng(file);
    if (result) return [result];
  }

  const result = await decodeStandardImage(file);
  return [result];
}

function isPng(header: Uint8Array): boolean {
  return (
    header.length >= 8 &&
    header[0] === 0x89 && header[1] === 0x50 &&
    header[2] === 0x4e && header[3] === 0x47
  );
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

async function decode16BitPng(
  file: File,
): Promise<DecodeResult | null> {
  if (!isPng(new Uint8Array(await file.slice(0, 8).arrayBuffer()))) return null;

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Parse IHDR
  const ihdrLen = (bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11];
  if (ihdrLen < 13) return null;
  const ihdr = new DataView(buf, 16, ihdrLen);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const bitDepth = ihdr.getUint8(8);
  const colorType = ihdr.getUint8(9);
  if (bitDepth !== 16) return null;

  let spp: number;
  if (colorType === 0) spp = 1;
  else if (colorType === 2) spp = 3;
  else if (colorType === 4) spp = 2;
  else if (colorType === 6) spp = 4;
  else return null;

  // Collect all IDAT chunks
  const idatChunks: Uint8Array[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const chunkLen = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(pos + 8, pos + 8 + chunkLen));
    }
    pos += 12 + chunkLen;
  }
  if (idatChunks.length === 0) return null;

  // Concatenate and decompress IDAT data
  let totalLen = 0;
  for (const c of idatChunks) totalLen += c.length;
  const compressed = new Uint8Array(totalLen);
  let off = 0;
  for (const c of idatChunks) { compressed.set(c, off); off += c.length; }

  let raw: Uint8Array;
  try {
    raw = pako.inflate(compressed);
  } catch { return null; }

  // Reverse PNG filtering to get raw pixel bytes
  const bytesPerPixel = spp * 2;
  const stride = width * bytesPerPixel;
  const expectedLen = height * (1 + stride);
  if (raw.length < expectedLen) return null;

  const pixels = new Uint8Array(height * stride);
  const prev = new Uint8Array(stride); // previous row, starts as zeros
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + stride);
    const filterType = raw[rowOff];
    const srcRow = raw.subarray(rowOff + 1, rowOff + 1 + stride);
    const dstOff = y * stride;

    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? pixels[dstOff + x - bytesPerPixel] : 0;
      const b = prev[x];
      const c = x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      let val = srcRow[x];
      switch (filterType) {
        case 0: break;
        case 1: val = (val + a) & 0xff; break;
        case 2: val = (val + b) & 0xff; break;
        case 3: val = (val + ((a + b) >> 1)) & 0xff; break;
        case 4: val = (val + paethPredictor(a, b, c)) & 0xff; break;
        default: return null;
      }
      pixels[dstOff + x] = val;
    }
    prev.set(pixels.subarray(dstOff, dstOff + stride));
  }

  // Parse 16-bit big-endian samples
  const pixelCount = width * height;
  const view = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);

  const isRgb = spp >= 3;
  const isGray = spp === 1 || spp === 2;

  if (isGray) {
    // 16-bit grayscale (with optional alpha)
    const gray16 = new Uint16Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      gray16[i] = view.getUint16(i * bytesPerPixel, false);
    }
    // Build histogram for stretch
    const histogram = new Uint32Array(65536);
    let min = 0xffff, max = 0;
    for (let i = 0; i < pixelCount; i++) {
      const v = gray16[i];
      histogram[v]++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max < min) { min = 0; max = 0; }
    const lo = min, hi = max;
    const span = hi - lo + 1;
    const scale = span > 0 ? 256 / span : 1;
    const gray8 = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      let byte = ((gray16[i] - lo) * scale + 0.5) | 0;
      if (byte < 0) byte = 0;
      if (byte > 255) byte = 255;
      gray8[i] = byte;
    }
    // Build stretch context from grayscale data (little-endian copy)
    const grayLE = new Uint8Array(pixelCount * 2);
    const leView = new DataView(grayLE.buffer);
    for (let i = 0; i < pixelCount; i++) leView.setUint16(i * 2, gray16[i], true);

    const stretchContext: TiffStretchContext = {
      kind: 'uint16',
      raw: grayLE,
      pixelCount,
      invert: false,
      littleEndian: true,
    };
    const source: TiffSourceInfo = {
      bitsPerSample: 16,
      samplesPerPixel: spp,
      sampleFormat: 'uint',
      photometric: 1,
      conversion: 'auto-contrast-16-uint',
      nativeMin: min,
      nativeMax: max,
      displayMin: lo,
      displayMax: hi,
      stretchMethod: 'full-minmax',
    };
    return {
      width, height,
      gray: { width, height, data: gray8 },
      grayscaleMode: 'average',
      tiffSource: source,
      tiffStretchMode: DEFAULT_TIFF_STRETCH_MODE,
      tiffStretchContext: stretchContext,
    };
  }

  if (isRgb) {
    // 16-bit RGB (with optional alpha)
    const rgb16 = new Uint16Array(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
      const base = i * bytesPerPixel;
      rgb16[i * 3] = view.getUint16(base, false);
      rgb16[i * 3 + 1] = view.getUint16(base + 2, false);
      rgb16[i * 3 + 2] = view.getUint16(base + 4, false);
    }

    const grayscaleMode: GrayscaleMode = 'average';
    const gray16 = rgb16ToGray16(rgb16, pixelCount, grayscaleMode);

    // Histogram for stretch
    const histogram = new Uint32Array(65536);
    let min = 0xffff, max = 0;
    for (let i = 0; i < pixelCount; i++) {
      const v = gray16[i];
      histogram[v]++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max < min) { min = 0; max = 0; }
    const lo = min, hi = max;

    // Stretch grayscale to 8-bit
    const span = hi - lo + 1;
    const scale = span > 0 ? 256 / span : 1;
    const gray8 = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      let byte = ((gray16[i] - lo) * scale + 0.5) | 0;
      if (byte < 0) byte = 0;
      if (byte > 255) byte = 255;
      gray8[i] = byte;
    }

    // Stretch RGB to 8-bit for preview
    const rgba8 = new Uint8ClampedArray(pixelCount * 4);
    const chMin = [0xffff, 0xffff, 0xffff];
    const chMax = [0, 0, 0];
    for (let i = 0; i < pixelCount; i++) {
      for (let c = 0; c < 3; c++) {
        const v = rgb16[i * 3 + c];
        if (v < chMin[c]) chMin[c] = v;
        if (v > chMax[c]) chMax[c] = v;
      }
    }
    for (let c = 0; c < 3; c++) {
      const chSpan = chMax[c] - chMin[c] + 1;
      const chScale = chSpan > 0 ? 256 / chSpan : 1;
      for (let i = 0; i < pixelCount; i++) {
        let byte = ((rgb16[i * 3 + c] - chMin[c]) * chScale + 0.5) | 0;
        if (byte < 0) byte = 0;
        if (byte > 255) byte = 255;
        rgba8[i * 4 + c] = byte;
      }
    }
    for (let i = 0; i < pixelCount; i++) rgba8[i * 4 + 3] = 255;

    // Build stretch context from 16-bit grayscale
    const grayLE = new Uint8Array(pixelCount * 2);
    const leView = new DataView(grayLE.buffer);
    for (let i = 0; i < pixelCount; i++) leView.setUint16(i * 2, gray16[i], true);

    const stretchContext: TiffStretchContext = {
      kind: 'uint16',
      raw: grayLE,
      pixelCount,
      invert: false,
      littleEndian: true,
    };
    const color = computeColorStats(rgba8, width, height);
    const source: TiffSourceInfo = {
      bitsPerSample: 16,
      samplesPerPixel: spp,
      sampleFormat: 'uint',
      photometric: 2,
      conversion: 'auto-contrast-16-rgb',
      nativeMin: min,
      nativeMax: max,
      displayMin: lo,
      displayMax: hi,
      stretchMethod: 'full-minmax',
    };
    return {
      width, height,
      gray: { width, height, data: gray8 },
      rgba: { width, height, data: rgba8 },
      color,
      grayscaleMode,
      tiffSource: source,
      tiffStretchMode: DEFAULT_TIFF_STRETCH_MODE,
      tiffStretchContext: stretchContext,
    };
  }

  return null;
}

async function decodeStandardImage(file: File): Promise<DecodeResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return rgbaToDecodeResult(data, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rgbaToDecodeResult(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pageIndex?: number,
  pageCount?: number,
  tiffSource?: TiffSourceInfo,
  tiffStretchMode?: TiffStretchMode,
  tiffStretchContext?: TiffStretchContext,
  tiffMetadata?: TiffMetadata,
): DecodeResult {
  const color = computeColorStats(data, width, height);
  const grayscaleMode = modeFromHueBucket(color.hueBucket);
  const gray = rgbaToGray8(data, width, height, grayscaleMode);
  const rgba: RgbaBuffer = { width, height, data };
  return {
    width,
    height,
    gray,
    rgba,
    color,
    grayscaleMode,
    pageIndex,
    pageCount,
    tiffSource,
    tiffStretchMode,
    tiffStretchContext,
    tiffMetadata,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = url;
  });
}

export function grayToImageData(gray: GrayscaleBuffer): ImageData {
  const { width, height, data } = gray;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const v = data[i];
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return new ImageData(out, width, height);
}

export function rgbaToImageData(rgba: RgbaBuffer): ImageData {
  return new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height);
}

export function grayToImageDataWithGain(
  gray: GrayscaleBuffer,
  gain: number,
): ImageData {
  if (!Number.isFinite(gain) || gain === 1) return grayToImageData(gray);
  const { width, height, data } = gray;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    const v = data[i] * gain;
    const c = v < 0 ? 0 : v > 255 ? 255 : v;
    out[p] = c;
    out[p + 1] = c;
    out[p + 2] = c;
    out[p + 3] = 255;
  }
  return new ImageData(out, width, height);
}

export function rgbaToImageDataWithGain(rgba: RgbaBuffer, gain: number): ImageData {
  if (!Number.isFinite(gain) || gain === 1) return rgbaToImageData(rgba);
  const { width, height, data } = rgba;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] * gain;
    const g = data[i + 1] * gain;
    const b = data[i + 2] * gain;
    out[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    out[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    out[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    out[i + 3] = data[i + 3];
  }
  return new ImageData(out, width, height);
}

export function applyGainToGray(data: Uint8Array, gain: number): Uint8Array {
  if (!Number.isFinite(gain) || gain === 1) return data;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i] * gain;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}
