import {
  applyTiffStretch as applyTiffStretchSync,
  applyTiffStretchFixed as applyTiffStretchFixedSync,
  decodeTiffBuffer,
  type TiffPage,
  type TiffStretchContext,
  type TiffStretchMode,
  type TiffStretchResult,
} from '../domain/image/tiff';
import type {
  DecodeRequest,
  StretchRequest,
  StretchFixedRequest,
  WorkerResponse,
} from './tiffWorker';

type Pending =
  | { kind: 'decode'; resolve: (pages: TiffPage[]) => void; reject: (err: Error) => void }
  | {
      kind: 'stretch';
      resolve: (result: TiffStretchResult) => void;
      reject: (err: Error) => void;
    };

let worker: Worker | null = null;
let workerBroken = false;
let reqCounter = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./tiffWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const data = e.data;
      const entry = pending.get(data.reqId);
      if (!entry) return;
      pending.delete(data.reqId);
      if (data.type === 'error') {
        entry.reject(new Error(data.message));
        return;
      }
      if (data.type === 'decoded' && entry.kind === 'decode') {
        entry.resolve(data.pages);
        return;
      }
      if (data.type === 'stretched' && entry.kind === 'stretch') {
        entry.resolve(data.result);
        return;
      }
      entry.reject(new Error('TIFF worker response mismatch'));
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const entry of pending.values()) {
        entry.reject(new Error('TIFF worker crashed'));
      }
      pending.clear();
    };
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

export async function decodeTiffFile(
  file: File,
  stretchMode?: TiffStretchMode,
): Promise<TiffPage[]> {
  const buffer = await file.arrayBuffer();
  const w = getWorker();
  if (!w) {
    return decodeTiffBuffer(buffer, stretchMode);
  }
  const reqId = ++reqCounter;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { kind: 'decode', resolve, reject });
    const req: DecodeRequest = { type: 'decode', reqId, buffer, stretchMode };
    w.postMessage(req, [buffer]);
  });
}

export async function applyTiffStretchAsync(
  ctx: TiffStretchContext,
  mode: TiffStretchMode,
): Promise<TiffStretchResult> {
  const w = getWorker();
  if (!w) {
    return applyTiffStretchSync(ctx, mode);
  }
  const rawCopy = new Uint8Array(ctx.raw);
  const ctxCopy: TiffStretchContext = { ...ctx, raw: rawCopy };
  const reqId = ++reqCounter;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { kind: 'stretch', resolve, reject });
    const req: StretchRequest = { type: 'stretch', reqId, ctx: ctxCopy, mode };
    w.postMessage(req, [rawCopy.buffer]);
  });
}

export async function applyTiffStretchFixedAsync(
  ctx: TiffStretchContext,
  lo: number,
  hi: number,
): Promise<TiffStretchResult> {
  const w = getWorker();
  if (!w) {
    return applyTiffStretchFixedSync(ctx, lo, hi);
  }
  const rawCopy = new Uint8Array(ctx.raw);
  const ctxCopy: TiffStretchContext = { ...ctx, raw: rawCopy };
  const reqId = ++reqCounter;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { kind: 'stretch', resolve, reject });
    const req: StretchFixedRequest = { type: 'stretchFixed', reqId, ctx: ctxCopy, lo, hi };
    w.postMessage(req, [rawCopy.buffer]);
  });
}
