import type { SessionImage } from '../session/sessionTypes';
import type { PreviewSortMode } from '../session/uiTypes';

export interface SortedEntry {
  image: SessionImage;
  originalIndex: number;
}

function getPreviewMean(img: SessionImage): number {
  if (img.previewMeanIntensity != null) return img.previewMeanIntensity;
  return Infinity;
}

export function sortedImages(
  images: SessionImage[],
  mode: PreviewSortMode,
): SortedEntry[] {
  const entries: SortedEntry[] = images.map((image, i) => ({
    image,
    originalIndex: i,
  }));
  if (mode === 'intensity') {
    entries.sort((a, b) => getPreviewMean(a.image) - getPreviewMean(b.image));
  }
  return entries;
}
