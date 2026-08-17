import UTIF from 'utif2/UTIF.js';
import { rgb16ToGray16, type GrayscaleMode } from './grayscale';

export type TiffSampleFormat = 'uint' | 'int' | 'float' | 'unknown';
export type TiffConversion =
  | 'passthrough-8bit'
  | 'auto-contrast-16-uint'
  | 'auto-contrast-16-int'
  | 'auto-contrast-16-rgb'
  | 'auto-contrast-float'
  | 'utif-rgba-fallback';

export type TiffStretchMode = 'percentile' | 'minmax';
export const DEFAULT_TIFF_STRETCH_MODE: TiffStretchMode = 'minmax';

export interface TiffSourceInfo {
  bitsPerSample: number;
  samplesPerPixel: number;
  sampleFormat: TiffSampleFormat;
  photometric: number;
  conversion: TiffConversion;
  nativeMin: number | null;
  nativeMax: number | null;
  displayMin: number | null;
  displayMax: number | null;
  stretchMethod: 'percentile-0.35' | 'full-minmax' | 'passthrough' | 'utif-fallback';
}

export type TiffStretchKind = 'uint16' | 'int16' | 'float32';

export interface TiffStretchContext {
  kind: TiffStretchKind;
  raw: Uint8Array;
  pixelCount: number;
  invert: boolean;
  littleEndian: boolean;
}

export interface TiffPage {
  width: number;
  height: number;
  rgba?: Uint8ClampedArray;
  gray?: Uint8Array;
  isGrayscale: boolean;
  source: TiffSourceInfo;
  stretchMode: TiffStretchMode;
  stretchContext?: TiffStretchContext;
  metadata: TiffMetadata;
  detectedGrayscaleMode?: GrayscaleMode;
}

export type DescriptionKind = 'imagej' | 'ome' | 'plain' | 'none';

export interface ImageJStackInfo {
  channels?: number;
  slices?: number;
  frames?: number;
  unit?: string;
  spacing?: number;
  hyperstack?: boolean;
  mode?: string;
  loop?: boolean;
  fps?: number;
  raw: Record<string, string>;
}

export interface OmeChannelInfo {
  index: number;
  name?: string;
  fluor?: string;
  excitationNm?: number;
  emissionNm?: number;
  color?: string;
  samplesPerPixel?: number;
  illuminationType?: string;
  contrastMethod?: string;
}

export interface OmeMetadata {
  imageName?: string;
  imageId?: string;
  acquisitionDate?: string;
  description?: string;
  dimensionOrder?: string;
  pixelType?: string;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  sizeC?: number;
  sizeT?: number;
  physicalSizeX?: number;
  physicalSizeY?: number;
  physicalSizeZ?: number;
  physicalSizeXUnit?: string;
  physicalSizeYUnit?: string;
  physicalSizeZUnit?: string;
  timeIncrement?: number;
  timeIncrementUnit?: string;
  channels: OmeChannelInfo[];
}

export type PixelSizeSource = 'ome' | 'tiff-resolution' | 'imagej';

export interface PixelSizeInfo {
  x: number;
  y: number;
  unit: string;
  source: PixelSizeSource;
}

export interface RawTiffTag {
  tag: number;
  name?: string;
  value: string;
}

export interface TiffMetadata {
  pageIndex: number;
  pageCount: number;
  imageDescription?: string;
  descriptionKind: DescriptionKind;
  imagej?: ImageJStackInfo;
  ome?: OmeMetadata;
  pixelSize?: PixelSizeInfo;
  software?: string;
  dateTime?: string;
  make?: string;
  model?: string;
  artist?: string;
  copyright?: string;
  hostComputer?: string;
  documentName?: string;
  orientation?: number;
  resolutionUnit?: number;
  xResolution?: number;
  yResolution?: number;
  compression: number;
  compressionLabel: string;
  photometric: number;
  photometricLabel: string;
  sampleFormatLabel: string;
  rowsPerStrip?: number;
  planarConfiguration?: number;
  rawTags: RawTiffTag[];
}

export function isTiffFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/tiff' || type === 'image/tif' || type === 'image/x-tiff') {
    return true;
  }
  const name = file.name.toLowerCase();
  return name.endsWith('.tif') || name.endsWith('.tiff');
}

interface UtifIfd {
  width: number;
  height: number;
  data: Uint8Array;
  isLE?: boolean;
  [key: string]: unknown;
}

// Fiji's ContrastEnhancer.stretchHistogram uses
//   threshold = (int)(pixelCount * saturated / 200)
// where the default `saturated` parameter is 0.35 (percent). The /200 (not
// /100) splits the saturation budget between the dark and bright ends, so the
// effective per-end fraction is 0.35 / 200 = 0.00175.
const SATURATION_FRACTION = 0.00175;

function tagArray(ifd: UtifIfd, tag: string): number[] | null {
  const v = ifd[tag];
  if (Array.isArray(v)) return v as number[];
  return null;
}

function tagAscii(ifd: UtifIfd, tag: string): string | undefined {
  const v = ifd[tag];
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') {
    return (v[0] as string).replace(/\0+$/g, '').trim() || undefined;
  }
  if (v instanceof Uint8Array) {
    let out = '';
    for (let i = 0; i < v.length; i++) {
      const c = v[i];
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out.trim() || undefined;
  }
  return undefined;
}

function tagRational(ifd: UtifIfd, tag: string): number | undefined {
  const v = ifd[tag];
  if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0])) {
    const pair = v[0] as unknown as [number, number];
    if (pair.length === 2 && typeof pair[0] === 'number' && typeof pair[1] === 'number') {
      if (pair[1] === 0) return undefined;
      return pair[0] / pair[1];
    }
  }
  return undefined;
}

const COMPRESSION_LABELS: Record<number, string> = {
  1: 'none',
  2: 'CCITT 1D',
  3: 'CCITT Group 3',
  4: 'CCITT Group 4',
  5: 'LZW',
  6: 'OldJPEG',
  7: 'JPEG',
  8: 'Deflate',
  32773: 'PackBits',
  32946: 'Deflate (Adobe)',
  34712: 'JPEG 2000',
  34887: 'LERC',
  50000: 'Zstd',
  50001: 'WebP',
};

const PHOTOMETRIC_LABELS: Record<number, string> = {
  0: 'WhiteIsZero',
  1: 'BlackIsZero',
  2: 'RGB',
  3: 'Palette',
  4: 'TransparencyMask',
  5: 'CMYK',
  6: 'YCbCr',
  8: 'CIELab',
  9: 'ICCLab',
  10: 'ITULab',
};

function sampleFormatLabel(fmt: TiffSampleFormat, bps: number): string {
  switch (fmt) {
    case 'uint':
      return `${bps}-bit unsigned`;
    case 'int':
      return `${bps}-bit signed`;
    case 'float':
      return `${bps}-bit float`;
    default:
      return `${bps}-bit`;
  }
}

const KNOWN_TAG_NAMES: Record<number, string> = {
  254: 'NewSubfileType',
  256: 'ImageWidth',
  257: 'ImageLength',
  258: 'BitsPerSample',
  259: 'Compression',
  262: 'PhotometricInterpretation',
  266: 'FillOrder',
  269: 'DocumentName',
  270: 'ImageDescription',
  271: 'Make',
  272: 'Model',
  273: 'StripOffsets',
  274: 'Orientation',
  277: 'SamplesPerPixel',
  278: 'RowsPerStrip',
  279: 'StripByteCounts',
  282: 'XResolution',
  283: 'YResolution',
  284: 'PlanarConfiguration',
  296: 'ResolutionUnit',
  305: 'Software',
  306: 'DateTime',
  315: 'Artist',
  316: 'HostComputer',
  317: 'Predictor',
  320: 'ColorMap',
  338: 'ExtraSamples',
  339: 'SampleFormat',
  33432: 'Copyright',
  34665: 'EXIF IFD',
  34853: 'GPS IFD',
  50838: 'ImageJ-MetaData byte counts',
  50839: 'ImageJ-MetaData',
};

function formatTagValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value;
  }
  if (value instanceof Uint8Array) {
    return `Uint8Array(${value.length})`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length <= 8) {
      return value
        .map((v) => (Array.isArray(v) ? `${v[0]}/${v[1]}` : String(v)))
        .join(', ');
    }
    return `${value.slice(0, 6).map((v) => (Array.isArray(v) ? `${v[0]}/${v[1]}` : String(v))).join(', ')}, ... (${value.length} values)`;
  }
  return String(value);
}

function collectRawTags(ifd: UtifIfd): RawTiffTag[] {
  const out: RawTiffTag[] = [];
  for (const key of Object.keys(ifd)) {
    if (!key.startsWith('t')) continue;
    const num = Number.parseInt(key.slice(1), 10);
    if (!Number.isFinite(num)) continue;
    out.push({ tag: num, name: KNOWN_TAG_NAMES[num], value: formatTagValue(ifd[key]) });
  }
  out.sort((a, b) => a.tag - b.tag);
  return out;
}

export function parseImageJDescription(text: string): ImageJStackInfo | null {
  if (!text.includes('ImageJ=') && !text.includes('ImageJ ')) return null;
  const raw: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key.length === 0) continue;
    raw[key] = val;
  }
  const numeric = (k: string): number | undefined => {
    const v = raw[k];
    if (v == null) return undefined;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (k: string): boolean | undefined => {
    const v = raw[k];
    if (v == null) return undefined;
    return v === 'true';
  };
  return {
    channels: numeric('channels'),
    slices: numeric('slices'),
    frames: numeric('frames'),
    unit: raw['unit'] || undefined,
    spacing: numeric('spacing'),
    hyperstack: bool('hyperstack'),
    mode: raw['mode'] || undefined,
    loop: bool('loop'),
    fps: numeric('fps'),
    raw,
  };
}

function parseFloatAttr(el: Element | null, attr: string): number | undefined {
  if (!el) return undefined;
  const v = el.getAttribute(attr);
  if (v == null) return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseIntAttr(el: Element | null, attr: string): number | undefined {
  if (!el) return undefined;
  const v = el.getAttribute(attr);
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function strAttr(el: Element | null, attr: string): string | undefined {
  if (!el) return undefined;
  const v = el.getAttribute(attr);
  return v == null || v.length === 0 ? undefined : v;
}

function isOmeXml(text: string): boolean {
  return /<\s*OME[\s>]/.test(text) || /xmlns(:[^=]+)?="http:\/\/www\.openmicroscopy\.org/.test(text);
}

export function parseOmeXml(text: string): OmeMetadata | null {
  if (typeof DOMParser === 'undefined') return null;
  if (!isOmeXml(text)) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const image = doc.getElementsByTagName('Image')[0] || null;
  if (!image) return null;
  const pixels = image.getElementsByTagName('Pixels')[0] || null;
  const channels: OmeChannelInfo[] = [];
  if (pixels) {
    const channelEls = pixels.getElementsByTagName('Channel');
    for (let i = 0; i < channelEls.length; i++) {
      const c = channelEls[i];
      let color: string | undefined;
      const colorAttr = c.getAttribute('Color');
      if (colorAttr) {
        const n = Number.parseInt(colorAttr, 10);
        if (Number.isFinite(n)) {
          const r = (n >> 24) & 0xff;
          const g = (n >> 16) & 0xff;
          const b = (n >> 8) & 0xff;
          color = `rgb(${r}, ${g}, ${b})`;
        } else {
          color = colorAttr;
        }
      }
      channels.push({
        index: i,
        name: strAttr(c, 'Name'),
        fluor: strAttr(c, 'Fluor'),
        excitationNm: parseFloatAttr(c, 'ExcitationWavelength'),
        emissionNm: parseFloatAttr(c, 'EmissionWavelength'),
        color,
        samplesPerPixel: parseIntAttr(c, 'SamplesPerPixel'),
        illuminationType: strAttr(c, 'IlluminationType'),
        contrastMethod: strAttr(c, 'ContrastMethod'),
      });
    }
  }
  const description = image.getElementsByTagName('Description')[0]?.textContent?.trim() || undefined;
  return {
    imageName: strAttr(image, 'Name'),
    imageId: strAttr(image, 'ID'),
    acquisitionDate: image.getElementsByTagName('AcquisitionDate')[0]?.textContent?.trim() || undefined,
    description,
    dimensionOrder: strAttr(pixels, 'DimensionOrder'),
    pixelType: strAttr(pixels, 'Type'),
    sizeX: parseIntAttr(pixels, 'SizeX'),
    sizeY: parseIntAttr(pixels, 'SizeY'),
    sizeZ: parseIntAttr(pixels, 'SizeZ'),
    sizeC: parseIntAttr(pixels, 'SizeC'),
    sizeT: parseIntAttr(pixels, 'SizeT'),
    physicalSizeX: parseFloatAttr(pixels, 'PhysicalSizeX'),
    physicalSizeY: parseFloatAttr(pixels, 'PhysicalSizeY'),
    physicalSizeZ: parseFloatAttr(pixels, 'PhysicalSizeZ'),
    physicalSizeXUnit: strAttr(pixels, 'PhysicalSizeXUnit'),
    physicalSizeYUnit: strAttr(pixels, 'PhysicalSizeYUnit'),
    physicalSizeZUnit: strAttr(pixels, 'PhysicalSizeZUnit'),
    timeIncrement: parseFloatAttr(pixels, 'TimeIncrement'),
    timeIncrementUnit: strAttr(pixels, 'TimeIncrementUnit'),
    channels,
  };
}

function detectDescriptionKind(text: string | undefined): DescriptionKind {
  if (!text) return 'none';
  if (isOmeXml(text)) return 'ome';
  if (/^ImageJ[=\s]/m.test(text) || text.startsWith('ImageJ')) return 'imagej';
  return 'plain';
}

function resolutionUnitToLabel(code: number | undefined): string {
  switch (code) {
    case 2:
      return 'inch';
    case 3:
      return 'cm';
    default:
      return 'none';
  }
}

function derivePixelSize(
  ome: OmeMetadata | undefined,
  imagej: ImageJStackInfo | undefined,
  xRes: number | undefined,
  yRes: number | undefined,
  resolutionUnit: number | undefined,
): PixelSizeInfo | undefined {
  if (ome && ome.physicalSizeX && ome.physicalSizeY) {
    return {
      x: ome.physicalSizeX,
      y: ome.physicalSizeY,
      unit: ome.physicalSizeXUnit || 'um',
      source: 'ome',
    };
  }
  if (imagej && imagej.spacing && imagej.unit) {
    return { x: imagej.spacing, y: imagej.spacing, unit: imagej.unit, source: 'imagej' };
  }
  if (xRes && yRes && resolutionUnit && resolutionUnit !== 1) {
    const unitLabel = resolutionUnitToLabel(resolutionUnit);
    return {
      x: 1 / xRes,
      y: 1 / yRes,
      unit: `${unitLabel}/px`,
      source: 'tiff-resolution',
    };
  }
  return undefined;
}

function buildTiffMetadata(
  ifd: UtifIfd,
  pageIndex: number,
  pageCount: number,
  bitsPerSample: number,
  sampleFormat: TiffSampleFormat,
  photometric: number,
  compression: number,
): TiffMetadata {
  const description = tagAscii(ifd, 't270');
  const descriptionKind = detectDescriptionKind(description);
  const imagej =
    descriptionKind === 'imagej' && description
      ? parseImageJDescription(description) ?? undefined
      : undefined;
  const ome =
    descriptionKind === 'ome' && description ? parseOmeXml(description) ?? undefined : undefined;
  const xResolution = tagRational(ifd, 't282');
  const yResolution = tagRational(ifd, 't283');
  const resolutionUnitArr = tagArray(ifd, 't296');
  const resolutionUnit =
    resolutionUnitArr && resolutionUnitArr.length > 0 ? resolutionUnitArr[0] : undefined;
  const orientationArr = tagArray(ifd, 't274');
  const orientation = orientationArr && orientationArr.length > 0 ? orientationArr[0] : undefined;
  const rowsPerStripArr = tagArray(ifd, 't278');
  const rowsPerStrip =
    rowsPerStripArr && rowsPerStripArr.length > 0 ? rowsPerStripArr[0] : undefined;
  const planarArr = tagArray(ifd, 't284');
  const planarConfiguration = planarArr && planarArr.length > 0 ? planarArr[0] : undefined;
  return {
    pageIndex,
    pageCount,
    imageDescription: description,
    descriptionKind,
    imagej,
    ome,
    pixelSize: derivePixelSize(ome, imagej, xResolution, yResolution, resolutionUnit),
    software: tagAscii(ifd, 't305'),
    dateTime: tagAscii(ifd, 't306'),
    make: tagAscii(ifd, 't271'),
    model: tagAscii(ifd, 't272'),
    artist: tagAscii(ifd, 't315'),
    copyright: tagAscii(ifd, 't33432'),
    hostComputer: tagAscii(ifd, 't316'),
    documentName: tagAscii(ifd, 't269'),
    orientation,
    resolutionUnit,
    xResolution,
    yResolution,
    compression,
    compressionLabel: COMPRESSION_LABELS[compression] ?? `unknown (${compression})`,
    photometric,
    photometricLabel: PHOTOMETRIC_LABELS[photometric] ?? `unknown (${photometric})`,
    sampleFormatLabel: sampleFormatLabel(sampleFormat, bitsPerSample),
    rowsPerStrip,
    planarConfiguration,
    rawTags: collectRawTags(ifd),
  };
}

function sampleFormatFromTag(tag: number[] | null): TiffSampleFormat {
  if (!tag || tag.length === 0) return 'uint';
  switch (tag[0]) {
    case 1:
      return 'uint';
    case 2:
      return 'int';
    case 3:
      return 'float';
    default:
      return 'unknown';
  }
}

function isAligned(raw: Uint8Array, bytesPerElement: number): boolean {
  return raw.byteOffset % bytesPerElement === 0;
}

// Mirrors Fiji's ContrastEnhancer.stretchHistogram exactly:
//   threshold = (int)(pixelCount * saturated / 200);
//   i = -1; count = 0;
//   do { i++; count += histogram[i]; found = count > threshold; }
//     while (!found && i < hsize-1);
//   hmin = i;
//   i = hsize; count = 0;
//   do { i--; count += histogram[i]; found = count > threshold; }
//     while (!found && i > 0);
//   hmax = i;
// Note the strict `count > threshold` comparison.
function percentileRangeFromHistogram(
  histogram: Uint32Array,
  totalSamples: number,
  indexToValue: (i: number) => number,
): { lo: number; hi: number } {
  if (totalSamples <= 0) return { lo: 0, hi: 0 };
  const hsize = histogram.length;
  const threshold = Math.floor(totalSamples * SATURATION_FRACTION);

  let i = -1;
  let count = 0;
  let found = false;
  do {
    i++;
    count += histogram[i];
    found = count > threshold;
  } while (!found && i < hsize - 1);
  const loIdx = i;

  i = hsize;
  count = 0;
  found = false;
  do {
    i--;
    count += histogram[i];
    found = count > threshold;
  } while (!found && i > 0);
  let hiIdx = i;

  if (hiIdx < loIdx) hiIdx = hsize - 1;
  return { lo: indexToValue(loIdx), hi: indexToValue(hiIdx) };
}

// Mirrors Fiji's ShortProcessor.create8BitImage exactly (verified against
// imagej/ImageJ ij/process/ShortProcessor.java):
//   double scale = 256.0 / (max - min + 1);
//   value = (pixels[i] & 0xffff) - min;
//   if (value < 0) value = 0;
//   value = (int)(value * scale + 0.5);   // round-half-up
//   if (value > 255) value = 255;
// Both the +0.5 rounding term and the +1 in the denominator are load-bearing.
// Inversion is applied to the resulting byte (matches our existing pipeline,
// which feeds the inverted gray buffer to the threshold mask). If a future
// experiment shows Fiji's threshold operates on un-inverted bytes via an
// inverted display LUT, the inversion can be deferred to render time.
function stretchIntegerToGray(
  src: Uint16Array | Int16Array,
  pixelCount: number,
  lo: number,
  hi: number,
  invert: boolean,
): Uint8Array {
  const gray = new Uint8Array(pixelCount);
  const loInt = lo | 0;
  const hiInt = hi | 0;
  const span = hiInt - loInt + 1;
  if (!(span > 0)) {
    if (invert) gray.fill(255);
    return gray;
  }
  const scale = 256 / span;
  for (let i = 0; i < pixelCount; i++) {
    const v = src[i];
    let byte: number;
    if (v < loInt) {
      byte = 0;
    } else {
      byte = ((v - loInt) * scale + 0.5) | 0;
      if (byte > 255) byte = 255;
    }
    if (invert) byte = 255 - byte;
    gray[i] = byte;
  }
  return gray;
}

// Mirrors Fiji's FloatProcessor.create8BitImage exactly (verified against
// imagej/ImageJ ij/process/FloatProcessor.java):
//   double scale = 255.0 / (max - min);
//   value = pixels[i] - min;
//   if (value < 0.0) value = 0.0;
//   ivalue = (int)(value * scale + 0.5);
//   if (ivalue > 255) ivalue = 255;
// Denominator is plain `(max - min)` (no +1, unlike the 16-bit path).
function stretchFloatToGray(
  src: Float32Array,
  pixelCount: number,
  lo: number,
  hi: number,
  invert: boolean,
): Uint8Array {
  const gray = new Uint8Array(pixelCount);
  const span = hi - lo;
  if (!(span > 0)) {
    if (invert) gray.fill(255);
    return gray;
  }
  const scale = 255 / span;
  for (let i = 0; i < pixelCount; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) {
      gray[i] = invert ? 255 : 0;
      continue;
    }
    let value = v - lo;
    if (value < 0) value = 0;
    let byte = (value * scale + 0.5) | 0;
    if (byte > 255) byte = 255;
    if (invert) byte = 255 - byte;
    gray[i] = byte;
  }
  return gray;
}

const INTENSITY_SORT_FLOOR_16BIT = 300;
const INTENSITY_SORT_FLOOR_FLOAT = 8;

export function computeNativeMean(ctx: TiffStretchContext): number {
  const { raw, pixelCount, littleEndian } = ctx;
  if (pixelCount === 0) return 0;
  let sum = 0;
  switch (ctx.kind) {
    case 'uint16': {
      const src = u16View(raw, pixelCount, littleEndian);
      for (let i = 0; i < pixelCount; i++) {
        if (src[i] > INTENSITY_SORT_FLOOR_16BIT) sum += src[i];
      }
      break;
    }
    case 'int16': {
      const src = i16View(raw, pixelCount, littleEndian);
      for (let i = 0; i < pixelCount; i++) {
        if (src[i] > INTENSITY_SORT_FLOOR_16BIT) sum += src[i];
      }
      break;
    }
    case 'float32': {
      const src = f32View(raw, pixelCount, littleEndian);
      for (let i = 0; i < pixelCount; i++) {
        const v = src[i];
        if (Number.isFinite(v) && v > INTENSITY_SORT_FLOOR_FLOAT) sum += v;
      }
      break;
    }
  }
  return sum / pixelCount;
}


function u16View(
  raw: Uint8Array,
  pixelCount: number,
  littleEndian: boolean,
): Uint16Array {
  if (littleEndian && isAligned(raw, 2)) {
    return new Uint16Array(raw.buffer, raw.byteOffset, pixelCount);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, pixelCount * 2);
  const out = new Uint16Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) out[i] = view.getUint16(i * 2, littleEndian);
  return out;
}

function i16View(
  raw: Uint8Array,
  pixelCount: number,
  littleEndian: boolean,
): Int16Array {
  if (littleEndian && isAligned(raw, 2)) {
    return new Int16Array(raw.buffer, raw.byteOffset, pixelCount);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, pixelCount * 2);
  const out = new Int16Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) out[i] = view.getInt16(i * 2, littleEndian);
  return out;
}

function f32View(
  raw: Uint8Array,
  pixelCount: number,
  littleEndian: boolean,
): Float32Array {
  if (littleEndian && isAligned(raw, 4)) {
    return new Float32Array(raw.buffer, raw.byteOffset, pixelCount);
  }
  const view = new DataView(raw.buffer, raw.byteOffset, pixelCount * 4);
  const out = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) out[i] = view.getFloat32(i * 4, littleEndian);
  return out;
}

function convertUint16(
  raw: Uint8Array,
  pixelCount: number,
  invert: boolean,
  mode: TiffStretchMode,
  littleEndian: boolean,
): { gray: Uint8Array; min: number; max: number; displayMin: number; displayMax: number } {
  if (raw.byteLength < pixelCount * 2) {
    throw new Error('16-bit TIFF data is shorter than expected');
  }
  const src = u16View(raw, pixelCount, littleEndian);
  const histogram = new Uint32Array(65536);
  let min = 0xffff;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const v = src[i];
    histogram[v]++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max < min) {
    min = 0;
    max = 0;
  }
  const { lo, hi } =
    mode === 'minmax'
      ? { lo: min, hi: max }
      : percentileRangeFromHistogram(histogram, pixelCount, (i) => i);
  const gray = stretchIntegerToGray(src, pixelCount, lo, hi, invert);
  return { gray, min, max, displayMin: lo, displayMax: hi };
}

function convertInt16(
  raw: Uint8Array,
  pixelCount: number,
  invert: boolean,
  mode: TiffStretchMode,
  littleEndian: boolean,
): { gray: Uint8Array; min: number; max: number; displayMin: number; displayMax: number } {
  if (raw.byteLength < pixelCount * 2) {
    throw new Error('16-bit TIFF data is shorter than expected');
  }
  const src = i16View(raw, pixelCount, littleEndian);
  const histogram = new Uint32Array(65536);
  let min = 0x7fff;
  let max = -0x8000;
  for (let i = 0; i < pixelCount; i++) {
    const v = src[i];
    histogram[v + 0x8000]++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max < min) {
    min = 0;
    max = 0;
  }
  const { lo, hi } =
    mode === 'minmax'
      ? { lo: min, hi: max }
      : percentileRangeFromHistogram(histogram, pixelCount, (i) => i - 0x8000);
  const gray = stretchIntegerToGray(src, pixelCount, lo, hi, invert);
  return { gray, min, max, displayMin: lo, displayMax: hi };
}

function convertUint8Grayscale(
  raw: Uint8Array,
  pixelCount: number,
  invert: boolean,
): { gray: Uint8Array; min: number; max: number } {
  if (raw.byteLength < pixelCount) {
    throw new Error('8-bit TIFF data is shorter than expected');
  }
  const gray = new Uint8Array(pixelCount);
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    let v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
    gray[i] = invert ? 255 - v : v;
  }
  if (max < min) {
    min = 0;
    max = 0;
  }
  return { gray, min, max };
}

function convertFloat32(
  raw: Uint8Array,
  pixelCount: number,
  invert: boolean,
  mode: TiffStretchMode,
  littleEndian: boolean,
): { gray: Uint8Array; min: number; max: number; displayMin: number; displayMax: number } {
  if (raw.byteLength < pixelCount * 4) {
    throw new Error('32-bit float TIFF data is shorter than expected');
  }
  const src = f32View(raw, pixelCount, littleEndian);
  let min = Infinity;
  let max = -Infinity;
  let finiteCount = 0;
  for (let i = 0; i < pixelCount; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) continue;
    finiteCount++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || finiteCount === 0) {
    return { gray: new Uint8Array(pixelCount), min: 0, max: 0, displayMin: 0, displayMax: 0 };
  }
  const bins = 4096;
  const histogram = new Uint32Array(bins);
  const span = max - min;
  for (let i = 0; i < pixelCount; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) continue;
    let idx = Math.floor(((v - min) / span) * (bins - 1));
    if (idx < 0) idx = 0;
    else if (idx >= bins) idx = bins - 1;
    histogram[idx]++;
  }
  let lo: number;
  let hi: number;
  if (mode === 'minmax') {
    lo = min;
    hi = max;
  } else {
    const { lo: loBin, hi: hiBin } = percentileRangeFromHistogram(
      histogram,
      finiteCount,
      (i) => i,
    );
    lo = min + (loBin / (bins - 1)) * span;
    hi = min + (hiBin / (bins - 1)) * span;
  }
  const gray = stretchFloatToGray(src, pixelCount, lo, hi, invert);
  return { gray, min, max, displayMin: lo, displayMax: hi };
}

interface GrayscaleConversion {
  gray: Uint8Array;
  conversion: TiffConversion;
  stretchMethod: TiffSourceInfo['stretchMethod'];
  min: number | null;
  max: number | null;
  displayMin: number | null;
  displayMax: number | null;
  stretchContext?: TiffStretchContext;
}

function methodForStretchMode(mode: TiffStretchMode): 'percentile-0.35' | 'full-minmax' {
  return mode === 'minmax' ? 'full-minmax' : 'percentile-0.35';
}

type GrayFormat =
  | { kind: 'uint8' }
  | { kind: 'uint16'; conversion: TiffConversion }
  | { kind: 'int16'; conversion: TiffConversion }
  | { kind: 'float32'; conversion: TiffConversion };

function grayFormatFor(
  bitsPerSample: number,
  sampleFormat: TiffSampleFormat,
): GrayFormat | null {
  if (bitsPerSample === 8 && (sampleFormat === 'uint' || sampleFormat === 'unknown')) {
    return { kind: 'uint8' };
  }
  if (bitsPerSample === 16 && (sampleFormat === 'uint' || sampleFormat === 'unknown')) {
    return { kind: 'uint16', conversion: 'auto-contrast-16-uint' };
  }
  if (bitsPerSample === 16 && sampleFormat === 'int') {
    return { kind: 'int16', conversion: 'auto-contrast-16-int' };
  }
  if (bitsPerSample === 32 && sampleFormat === 'float') {
    return { kind: 'float32', conversion: 'auto-contrast-float' };
  }
  return null;
}

function decodeGrayscalePage(
  ifd: UtifIfd,
  width: number,
  height: number,
  bitsPerSample: number,
  sampleFormat: TiffSampleFormat,
  photometric: number,
  stretchMode: TiffStretchMode,
): GrayscaleConversion | null {
  const invert = photometric === 0;
  const pixelCount = width * height;
  const raw = ifd.data;
  if (!raw) return null;
  const format = grayFormatFor(bitsPerSample, sampleFormat);
  if (!format) return null;

  if (format.kind === 'uint8') {
    const { gray, min, max } = convertUint8Grayscale(raw, pixelCount, invert);
    return {
      gray,
      conversion: 'passthrough-8bit',
      stretchMethod: 'passthrough',
      min,
      max,
      displayMin: min,
      displayMax: max,
    };
  }

  // UTIF.decodeImage byte-swaps 16-bit pixel data in place to little-endian for
  // non-DNG files; 32-bit samples are left in file-native byte order. Derive the
  // effective endianness of ifd.data per sample size to match that contract.
  const fileIsLE = ifd.isLE !== false;
  const isDng = ifd['t33422'] != null;
  const littleEndian =
    format.kind === 'float32' ? fileIsLE : fileIsLE || !isDng;
  const bytesPerElement = format.kind === 'float32' ? 4 : 2;
  const byteLength = pixelCount * bytesPerElement;
  const result =
    format.kind === 'uint16'
      ? convertUint16(raw, pixelCount, invert, stretchMode, littleEndian)
      : format.kind === 'int16'
        ? convertInt16(raw, pixelCount, invert, stretchMode, littleEndian)
        : convertFloat32(raw, pixelCount, invert, stretchMode, littleEndian);
  return {
    gray: result.gray,
    conversion: format.conversion,
    stretchMethod: methodForStretchMode(stretchMode),
    min: result.min,
    max: result.max,
    displayMin: result.displayMin,
    displayMax: result.displayMax,
    stretchContext: {
      kind: format.kind,
      raw: copyRawSlice(raw, byteLength),
      pixelCount,
      invert,
      littleEndian,
    },
  };
}

interface Rgb16Conversion extends GrayscaleConversion {
  rgba: Uint8ClampedArray;
  grayscaleMode: GrayscaleMode;
}

function decodeRgb16Page(
  ifd: UtifIfd,
  width: number,
  height: number,
  samplesPerPixel: number,
  stretchMode: TiffStretchMode,
  grayscaleMode: GrayscaleMode,
): Rgb16Conversion | null {
  const pixelCount = width * height;
  const raw = ifd.data;
  if (!raw) return null;
  const bytesNeeded = pixelCount * samplesPerPixel * 2;
  if (raw.byteLength < bytesNeeded) return null;

  const fileIsLE = ifd.isLE !== false;
  const isDng = ifd['t33422'] != null;
  const littleEndian = fileIsLE || !isDng;

  // Extract interleaved 16-bit RGB samples (ignore alpha if spp=4)
  const rgb16 = new Uint16Array(pixelCount * 3);
  const view = new DataView(raw.buffer, raw.byteOffset, bytesNeeded);
  for (let i = 0; i < pixelCount; i++) {
    const srcOff = i * samplesPerPixel * 2;
    rgb16[i * 3] = view.getUint16(srcOff, littleEndian);
    rgb16[i * 3 + 1] = view.getUint16(srcOff + 2, littleEndian);
    rgb16[i * 3 + 2] = view.getUint16(srcOff + 4, littleEndian);
  }

  // Convert to 16-bit grayscale at full precision
  const gray16 = rgb16ToGray16(rgb16, pixelCount, grayscaleMode);

  // Build histogram and compute range for the grayscale values
  const histogram = new Uint32Array(65536);
  let min = 0xffff;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const v = gray16[i];
    histogram[v]++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max < min) { min = 0; max = 0; }

  const { lo, hi } =
    stretchMode === 'minmax'
      ? { lo: min, hi: max }
      : percentileRangeFromHistogram(histogram, pixelCount, (idx) => idx);

  // Stretch grayscale to 8-bit
  const gray = stretchIntegerToGray(gray16, pixelCount, lo, hi, false);

  // Also stretch RGB channels to 8-bit for color preview
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  // Per-channel range for RGB stretch
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
    const span = chMax[c] - chMin[c] + 1;
    const scale = span > 0 ? 256 / span : 1;
    for (let i = 0; i < pixelCount; i++) {
      let byte = ((rgb16[i * 3 + c] - chMin[c]) * scale + 0.5) | 0;
      if (byte < 0) byte = 0;
      if (byte > 255) byte = 255;
      rgba[i * 4 + c] = byte;
    }
  }
  for (let i = 0; i < pixelCount; i++) rgba[i * 4 + 3] = 255;

  // Build stretch context from the 16-bit grayscale data so re-stretch works
  const grayRaw = new Uint8Array(gray16.buffer, gray16.byteOffset, gray16.byteLength);
  const stretchCtx: TiffStretchContext = {
    kind: 'uint16',
    raw: copyRawSlice(grayRaw, pixelCount * 2),
    pixelCount,
    invert: false,
    littleEndian: true,
  };

  return {
    gray,
    rgba,
    grayscaleMode,
    conversion: 'auto-contrast-16-rgb',
    stretchMethod: methodForStretchMode(stretchMode),
    min,
    max,
    displayMin: lo,
    displayMax: hi,
    stretchContext: stretchCtx,
  };
}

function copyRawSlice(src: Uint8Array, byteLength: number): Uint8Array {
  const copy = new Uint8Array(byteLength);
  copy.set(src.subarray(0, byteLength));
  return copy;
}

export interface TiffStretchResult {
  gray: Uint8Array;
  displayMin: number;
  displayMax: number;
  stretchMethod: 'percentile-0.35' | 'full-minmax';
}

export function applyTiffStretch(
  ctx: TiffStretchContext,
  mode: TiffStretchMode,
): TiffStretchResult {
  const { raw, pixelCount, invert, littleEndian } = ctx;
  let converted;
  switch (ctx.kind) {
    case 'uint16':
      converted = convertUint16(raw, pixelCount, invert, mode, littleEndian);
      break;
    case 'int16':
      converted = convertInt16(raw, pixelCount, invert, mode, littleEndian);
      break;
    case 'float32':
      converted = convertFloat32(raw, pixelCount, invert, mode, littleEndian);
      break;
  }
  return {
    gray: converted.gray,
    displayMin: converted.displayMin,
    displayMax: converted.displayMax,
    stretchMethod: methodForStretchMode(mode),
  };
}

// Used by the "Global min to max" path in sessionStore.reconcileGlobalNormalization.
// This routes through the same Fiji-aligned helpers (stretchIntegerToGray /
// stretchFloatToGray) as the per-image path — DO NOT introduce a parallel
// stretch routine here; both paths must stay byte-identical to ImageJ/Fiji.
export function applyTiffStretchFixed(
  ctx: TiffStretchContext,
  lo: number,
  hi: number,
): TiffStretchResult {
  const { raw, pixelCount, invert, littleEndian } = ctx;
  let gray: Uint8Array;
  switch (ctx.kind) {
    case 'uint16':
      gray = stretchIntegerToGray(
        u16View(raw, pixelCount, littleEndian),
        pixelCount,
        lo,
        hi,
        invert,
      );
      break;
    case 'int16':
      gray = stretchIntegerToGray(
        i16View(raw, pixelCount, littleEndian),
        pixelCount,
        lo,
        hi,
        invert,
      );
      break;
    case 'float32':
      gray = stretchFloatToGray(
        f32View(raw, pixelCount, littleEndian),
        pixelCount,
        lo,
        hi,
        invert,
      );
      break;
  }
  return {
    gray,
    displayMin: lo,
    displayMax: hi,
    stretchMethod: 'full-minmax',
  };
}

export function isGlobalNormalizationEligible(ctx?: TiffStretchContext): boolean {
  if (!ctx) return false;
  return ctx.kind === 'uint16' || ctx.kind === 'int16' || ctx.kind === 'float32';
}

export interface PreviewStretchContext {
  kind: TiffStretchKind;
  raw: Uint8Array;
  pixelCount: number;
  width: number;
  height: number;
  invert: boolean;
  littleEndian: boolean;
}

export function buildPreviewStretchContext(
  ctx: TiffStretchContext,
  srcWidth: number,
  srcHeight: number,
  previewWidth: number,
  previewHeight: number,
): PreviewStretchContext {
  const pixelCount = previewWidth * previewHeight;
  const bytesPerPixel = ctx.kind === 'float32' ? 4 : 2;
  const raw = new Uint8Array(pixelCount * bytesPerPixel);
  const xRatio = srcWidth / previewWidth;
  const yRatio = srcHeight / previewHeight;

  if (ctx.kind === 'float32') {
    const srcView = f32View(ctx.raw, ctx.pixelCount, ctx.littleEndian);
    const dst = new Float32Array(raw.buffer);
    for (let y = 0; y < previewHeight; y++) {
      const srcY = Math.min(Math.floor(y * yRatio), srcHeight - 1);
      for (let x = 0; x < previewWidth; x++) {
        const srcX = Math.min(Math.floor(x * xRatio), srcWidth - 1);
        dst[y * previewWidth + x] = srcView[srcY * srcWidth + srcX];
      }
    }
  } else if (ctx.kind === 'uint16') {
    const srcView = u16View(ctx.raw, ctx.pixelCount, ctx.littleEndian);
    const dst = new Uint16Array(raw.buffer);
    for (let y = 0; y < previewHeight; y++) {
      const srcY = Math.min(Math.floor(y * yRatio), srcHeight - 1);
      for (let x = 0; x < previewWidth; x++) {
        const srcX = Math.min(Math.floor(x * xRatio), srcWidth - 1);
        dst[y * previewWidth + x] = srcView[srcY * srcWidth + srcX];
      }
    }
  } else {
    const srcView = i16View(ctx.raw, ctx.pixelCount, ctx.littleEndian);
    const dst = new Int16Array(raw.buffer);
    for (let y = 0; y < previewHeight; y++) {
      const srcY = Math.min(Math.floor(y * yRatio), srcHeight - 1);
      for (let x = 0; x < previewWidth; x++) {
        const srcX = Math.min(Math.floor(x * xRatio), srcWidth - 1);
        dst[y * previewWidth + x] = srcView[srcY * srcWidth + srcX];
      }
    }
  }

  return {
    kind: ctx.kind,
    raw,
    pixelCount,
    width: previewWidth,
    height: previewHeight,
    invert: ctx.invert,
    littleEndian: true,
  };
}

export function stretchPreviewContext(
  ctx: PreviewStretchContext,
  lo: number,
  hi: number,
): Uint8Array {
  const { raw, pixelCount, invert } = ctx;
  switch (ctx.kind) {
    case 'uint16':
      return stretchIntegerToGray(
        new Uint16Array(raw.buffer, raw.byteOffset, pixelCount),
        pixelCount, lo, hi, invert,
      );
    case 'int16':
      return stretchIntegerToGray(
        new Int16Array(raw.buffer, raw.byteOffset, pixelCount),
        pixelCount, lo, hi, invert,
      );
    case 'float32':
      return stretchFloatToGray(
        new Float32Array(raw.buffer, raw.byteOffset, pixelCount),
        pixelCount, lo, hi, invert,
      );
  }
}

export async function decodeTiffBuffer(
  buffer: ArrayBuffer,
  stretchMode: TiffStretchMode = DEFAULT_TIFF_STRETCH_MODE,
): Promise<TiffPage[]> {
  let ifds: UtifIfd[];
  try {
    ifds = UTIF.decode(buffer) as unknown as UtifIfd[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Not a valid TIFF file: ${msg}`);
  }

  if (!ifds || ifds.length === 0) {
    throw new Error('TIFF contains no images');
  }

  const pages: TiffPage[] = [];
  for (let i = 0; i < ifds.length; i++) {
    const ifd = ifds[i];
    try {
      UTIF.decodeImage(buffer, ifd as unknown as UTIF.IFD);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(`Failed to decode TIFF page ${i + 1}: ${msg}`);
    }

    const width = ifd.width;
    const height = ifd.height;
    if (!width || !height || width <= 0 || height <= 0) {
      throw new Error(`TIFF page ${i + 1} has invalid dimensions ${width}x${height}`);
    }

    const bps = tagArray(ifd, 't258');
    const spp = tagArray(ifd, 't277');
    const photo = tagArray(ifd, 't262');
    const fmt = tagArray(ifd, 't339');
    const compression = tagArray(ifd, 't259');

    const bitsPerSample = bps && bps.length > 0 ? bps[0] : 8;
    const samplesPerPixel = spp && spp.length > 0 ? spp[0] : bps ? bps.length : 1;
    const photometric = photo && photo.length > 0 ? photo[0] : 1;
    const sampleFormat = sampleFormatFromTag(fmt);

    let rgba: Uint8ClampedArray | undefined;
    let gray: Uint8Array | undefined;
    let conversion: TiffConversion = 'utif-rgba-fallback';
    let stretchMethod: TiffSourceInfo['stretchMethod'] = 'utif-fallback';
    let nativeMin: number | null = null;
    let nativeMax: number | null = null;
    let displayMin: number | null = null;
    let displayMax: number | null = null;
    let stretchContext: TiffStretchContext | undefined;
    let nativeGrayscale = false;
    let detectedGrayscaleMode: GrayscaleMode | undefined;

    const isGrayscale =
      samplesPerPixel === 1 && (photometric === 0 || photometric === 1);
    const isRgb16 =
      !isGrayscale &&
      bitsPerSample === 16 &&
      samplesPerPixel >= 3 &&
      photometric === 2 &&
      (sampleFormat === 'uint' || sampleFormat === 'unknown');

    if (isGrayscale) {
      try {
        const converted = decodeGrayscalePage(
          ifd,
          width,
          height,
          bitsPerSample,
          sampleFormat,
          photometric,
          stretchMode,
        );
        if (converted) {
          gray = converted.gray;
          nativeGrayscale = true;
          conversion = converted.conversion;
          stretchMethod = converted.stretchMethod;
          nativeMin = converted.min;
          nativeMax = converted.max;
          displayMin = converted.displayMin;
          displayMax = converted.displayMax;
          stretchContext = converted.stretchContext;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`TIFF page ${i + 1}: native grayscale decode failed (${msg}); falling back`);
      }
    }

    if (!gray && isRgb16) {
      try {
        const converted = decodeRgb16Page(
          ifd,
          width,
          height,
          samplesPerPixel,
          stretchMode,
          'average',
        );
        if (converted) {
          gray = converted.gray;
          rgba = converted.rgba;
          detectedGrayscaleMode = converted.grayscaleMode;
          conversion = converted.conversion;
          stretchMethod = converted.stretchMethod;
          nativeMin = converted.min;
          nativeMax = converted.max;
          displayMin = converted.displayMin;
          displayMax = converted.displayMax;
          stretchContext = converted.stretchContext;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.warn(`TIFF page ${i + 1}: 16-bit RGB decode failed (${msg}); falling back`);
      }
    }

    if (!gray) {
      if (isGrayscale) {
        console.warn(
          `TIFF page ${i + 1}: unsupported grayscale format (bps=${bitsPerSample}, fmt=${sampleFormat}); falling back to utif2 toRGBA8`,
        );
      }
      const rgba8 = UTIF.toRGBA8(ifd as unknown as UTIF.IFD);
      rgba = new Uint8ClampedArray(rgba8.buffer, rgba8.byteOffset, rgba8.byteLength);
      conversion = 'utif-rgba-fallback';
      stretchMethod = 'utif-fallback';
    }

    console.info(
      `[TIFF] page ${i + 1}/${ifds.length} ${width}x${height} bps=${bitsPerSample} fmt=${sampleFormat} photo=${photometric} spp=${samplesPerPixel} cmp=${compression?.[0] ?? '?'} native=[${nativeMin}..${nativeMax}] display=[${displayMin}..${displayMax}] -> ${conversion}`,
    );

    const metadata = buildTiffMetadata(
      ifd,
      i,
      ifds.length,
      bitsPerSample,
      sampleFormat,
      photometric,
      compression && compression.length > 0 ? compression[0] : 1,
    );

    pages.push({
      width,
      height,
      rgba,
      gray,
      isGrayscale: nativeGrayscale,
      source: {
        bitsPerSample,
        samplesPerPixel,
        sampleFormat,
        photometric,
        conversion,
        nativeMin,
        nativeMax,
        displayMin,
        displayMax,
        stretchMethod,
      },
      stretchMode,
      stretchContext,
      metadata,
      detectedGrayscaleMode,
    });
  }
  return pages;
}
