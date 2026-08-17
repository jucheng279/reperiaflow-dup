const PREVIEW_MAX_WIDTH = 288;
const PREVIEW_MAX_HEIGHT = 200;

export interface PreviewResult {
  bitmap: ImageBitmap | null;
  previewGray: { data: Uint8Array; width: number; height: number };
}

export function computePreviewDimensions(width: number, height: number) {
  const scale = Math.min(1, PREVIEW_MAX_WIDTH / width, PREVIEW_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function buildPreviewGray(
  gray: Uint8Array,
  srcWidth: number,
  srcHeight: number,
): { data: Uint8Array; width: number; height: number } {
  const { width: tw, height: th } = computePreviewDimensions(srcWidth, srcHeight);
  if (tw === srcWidth && th === srcHeight) {
    return { data: new Uint8Array(gray), width: tw, height: th };
  }
  const out = new Uint8Array(tw * th);
  const xRatio = srcWidth / tw;
  const yRatio = srcHeight / th;
  for (let y = 0; y < th; y++) {
    const srcY = Math.min(Math.floor(y * yRatio), srcHeight - 1);
    for (let x = 0; x < tw; x++) {
      const srcX = Math.min(Math.floor(x * xRatio), srcWidth - 1);
      out[y * tw + x] = gray[srcY * srcWidth + srcX];
    }
  }
  return { data: out, width: tw, height: th };
}

export async function buildPreviewBitmap(
  gray: Uint8Array,
  width: number,
  height: number,
): Promise<PreviewResult> {
  const previewGray = buildPreviewGray(gray, width, height);

  if (typeof createImageBitmap !== 'function') {
    return { bitmap: null, previewGray };
  }

  const { width: tw, height: th } = computePreviewDimensions(width, height);

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 255;
  }
  const source = new ImageData(rgba, width, height);

  let bitmap: ImageBitmap | null;
  try {
    bitmap = await createImageBitmap(source, {
      resizeWidth: tw,
      resizeHeight: th,
      resizeQuality: 'medium',
    });
  } catch {
    bitmap = await createImageBitmap(source);
  }

  return { bitmap, previewGray };
}

export function buildPreviewRgba(
  rgba: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const { width: tw, height: th } = computePreviewDimensions(srcWidth, srcHeight);
  if (tw === srcWidth && th === srcHeight) {
    return { data: new Uint8ClampedArray(rgba), width: tw, height: th };
  }
  const out = new Uint8ClampedArray(tw * th * 4);
  const xRatio = srcWidth / tw;
  const yRatio = srcHeight / th;
  for (let y = 0; y < th; y++) {
    const srcY = Math.min(Math.floor(y * yRatio), srcHeight - 1);
    for (let x = 0; x < tw; x++) {
      const srcX = Math.min(Math.floor(x * xRatio), srcWidth - 1);
      const si = (srcY * srcWidth + srcX) * 4;
      const di = (y * tw + x) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return { data: out, width: tw, height: th };
}
