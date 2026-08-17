import { describe, it, expect, beforeEach, vi } from 'vitest';

type DecodedPage = {
  width: number;
  height: number;
  gray: { width: number; height: number; data: Uint8Array };
  rgba?: { width: number; height: number; data: Uint8ClampedArray };
  color?: unknown;
  grayscaleMode: string;
  pageIndex?: number;
  pageCount?: number;
};

const pending: Array<{
  resolve: (pages: DecodedPage[]) => void;
  reject: (err: unknown) => void;
  fileName: string;
}> = [];

vi.mock('../image/decode', () => ({
  decodeFileToGray: vi.fn(),
  grayToImageData: vi.fn(),
  applyGainToGray: (data: Uint8Array) => data,
  fileMetadataFromFile: (file: File) => ({ name: file.name, size: file.size }),
  fileMetadataFromFileAsync: async (file: File) => ({ name: file.name, size: file.size }),
  decodeFileToPages: vi.fn((file: File) => {
    return new Promise<DecodedPage[]>((resolve, reject) => {
      pending.push({ resolve, reject, fileName: file.name });
    });
  }),
}));

vi.mock('../image/preview', () => ({
  buildPreviewBitmap: vi.fn().mockResolvedValue({ bitmap: null, previewGray: { data: new Uint8Array(0), width: 0, height: 0 } }),
  computePreviewDimensions: vi.fn().mockReturnValue({ width: 4, height: 4 }),
}));

import { useSessionStore } from '../session/sessionStore';
import { defaultThreshold } from '../threshold/presets';

function makePage(fill: number): DecodedPage {
  const w = 4;
  const h = 4;
  return {
    width: w,
    height: h,
    gray: { width: w, height: h, data: new Uint8Array(w * h).fill(fill) },
    grayscaleMode: 'average',
  };
}

function resolveByFileName(name: string, pages: DecodedPage[]): void {
  const idx = pending.findIndex((p) => p.fileName === name);
  if (idx < 0) throw new Error(`no pending decode for ${name}`);
  const entry = pending.splice(idx, 1)[0];
  entry.resolve(pages);
}

function rejectByFileName(name: string, message: string): void {
  const idx = pending.findIndex((p) => p.fileName === name);
  if (idx < 0) throw new Error(`no pending decode for ${name}`);
  const entry = pending.splice(idx, 1)[0];
  entry.reject(new Error(message));
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('ingest ordering', () => {
  beforeEach(() => {
    pending.length = 0;
    useSessionStore.setState({
      sessionId: 'test',
      phase: 'empty',
      images: [],
      activeIndex: -1,
      threshold: defaultThreshold(),
      rows: [],
      error: null,
      ingest: { total: 0, completed: 0, errors: [] },
      skipKeywordFilters: [],
      normalizationMode: 'per-image',
      globalRange: null,
    });
  });

  it('selects the first dropped image even when later files decode first', async () => {
    const files = ['a.png', 'b.png', 'c.png', 'd.png'].map(
      (n) => new File([new Uint8Array([0])], n),
    );
    const addPromise = useSessionStore.getState().addFiles(files);

    await flush();

    resolveByFileName('c.png', [makePage(30)]);
    await flush();
    expect(useSessionStore.getState().activeIndex).toBe(-1);

    resolveByFileName('b.png', [makePage(20)]);
    await flush();
    expect(useSessionStore.getState().activeIndex).toBe(-1);

    resolveByFileName('a.png', [makePage(10)]);
    await flush();
    expect(useSessionStore.getState().activeIndex).toBe(0);

    resolveByFileName('d.png', [makePage(40)]);
    await addPromise;

    const st = useSessionStore.getState();
    expect(st.activeIndex).toBe(0);
    expect(st.images[0].fileName).toBe('a.png');
  });

  it('falls through to the next eligible image when the first file errors', async () => {
    const files = ['a.png', 'b.png', 'c.png'].map(
      (n) => new File([new Uint8Array([0])], n),
    );
    const addPromise = useSessionStore.getState().addFiles(files);

    await flush();

    resolveByFileName('b.png', [makePage(20)]);
    await flush();
    expect(useSessionStore.getState().activeIndex).toBe(-1);

    rejectByFileName('a.png', 'decode failed');
    await flush();

    const st = useSessionStore.getState();
    expect(st.images[0].status).toBe('error');
    expect(st.activeIndex).toBe(1);
    expect(st.images[1].fileName).toBe('b.png');

    resolveByFileName('c.png', [makePage(30)]);
    await addPromise;
    expect(useSessionStore.getState().activeIndex).toBe(1);
  });
});
