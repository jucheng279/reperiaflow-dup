const SUPPORTED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'avif',
  'tif',
  'tiff',
]);
const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
  'image/webp',
  'image/avif',
  'image/tiff',
  'image/tif',
  'image/x-tiff',
]);

export const SUPPORTED_IMAGE_ACCEPT = [
  ...Array.from(SUPPORTED_MIME_TYPES),
  '.tif',
  '.tiff',
].join(',');
export const SUPPORTED_IMAGE_LABEL = 'PNG, JPG, GIF, BMP, WebP, AVIF, TIFF';

export function isSupportedImage(file: File): boolean {
  if (!file || file.size === 0) return false;
  if (file.name.startsWith('.')) return false;
  if (file.type && SUPPORTED_MIME_TYPES.has(file.type)) return true;
  const dot = file.name.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = file.name.slice(dot + 1).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export interface FilterResult {
  accepted: File[];
  rejected: number;
}

export function filterSupportedImages(files: File[]): FilterResult {
  const accepted: File[] = [];
  let rejected = 0;
  for (const f of files) {
    if (isSupportedImage(f)) accepted.push(f);
    else rejected += 1;
  }
  return { accepted, rejected };
}

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function filePathForSort(f: File): string {
  const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length > 0 ? rel : f.name;
}

export function compareFilesNatural(a: File, b: File): number {
  return naturalCollator.compare(filePathForSort(a), filePathForSort(b));
}

export function sortFilesNatural(files: File[]): File[] {
  return [...files].sort(compareFilesNatural);
}

export function filterAndSortSupportedImages(files: File[]): FilterResult {
  const result = filterSupportedImages(files);
  result.accepted.sort(compareFilesNatural);
  return result;
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all.push(...batch);
          pump();
        }
      }, reject);
    };
    pump();
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  acc: File[],
  stats: { rejected: number },
): Promise<void> {
  if (entry.isFile) {
    try {
      const file = await entryToFile(entry as FileSystemFileEntry);
      if (isSupportedImage(file)) acc.push(file);
      else stats.rejected += 1;
    } catch {
      stats.rejected += 1;
    }
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    children.sort((a, b) => naturalCollator.compare(a.name, b.name));
    for (const child of children) {
      await walkEntry(child, acc, stats);
    }
  }
}

export async function readDroppedItems(dataTransfer: DataTransfer): Promise<FilterResult> {
  const items = dataTransfer.items;
  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const files: File[] = [];
      const stats = { rejected: 0 };
      for (const entry of entries) {
        await walkEntry(entry, files, stats);
      }
      return { accepted: files, rejected: stats.rejected };
    }
  }
  return filterSupportedImages(Array.from(dataTransfer.files));
}

export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}
