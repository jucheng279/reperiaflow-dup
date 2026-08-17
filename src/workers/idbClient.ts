import type { CachedBuffers } from '../domain/image/bufferCache';

type MsgPersist = { type: 'persist'; id: string; data: CachedBuffers; seq: number };
type MsgPersistBatch = { type: 'persistBatch'; entries: Array<{ id: string; data: CachedBuffers }>; seq: number };
type MsgPurge = { type: 'purge'; id: string; seq: number };
type MsgClear = { type: 'clear'; seq: number };

type OutMsg = MsgPersist | MsgPersistBatch | MsgPurge | MsgClear;

interface Reply {
  seq: number;
  ok: boolean;
  error?: string;
}

const PERSIST_TIMEOUT_MS = 15_000;

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function getWorker(): Worker {
  if (workerBroken) {
    throw new Error('IDB worker is broken');
  }
  if (!worker) {
    worker = new Worker(new URL('./idbWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const { seq: s, ok, error } = e.data;
      const p = pending.get(s);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(s);
      if (ok) p.resolve();
      else p.reject(new Error(error ?? 'IDB worker error'));
    };
    worker.onerror = () => {
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('IDB worker crashed'));
      }
      pending.clear();
    };
  }
  return worker;
}

function collectTransferables(data: CachedBuffers): Transferable[] {
  const t: Transferable[] = [data.gray];
  if (data.rgba) t.push(data.rgba);
  if (data.tiffRaw) t.push(data.tiffRaw);
  return t;
}

function send(msg: OutMsg, transferables: Transferable[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(msg.seq);
      reject(new Error('IDB worker timeout'));
    }, PERSIST_TIMEOUT_MS);
    pending.set(msg.seq, { resolve, reject, timer });
    try {
      getWorker().postMessage(msg, transferables);
    } catch (e) {
      clearTimeout(timer);
      pending.delete(msg.seq);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export function persistBuffersOffThread(id: string, data: CachedBuffers): Promise<void> {
  const s = ++seq;
  const transferables = collectTransferables(data);
  return send({ type: 'persist', id, data, seq: s }, transferables);
}

export function persistBuffersBatchOffThread(
  entries: Array<{ id: string; data: CachedBuffers }>,
): Promise<void> {
  if (entries.length === 0) return Promise.resolve();
  const s = ++seq;
  const transferables: Transferable[] = [];
  for (const entry of entries) {
    transferables.push(...collectTransferables(entry.data));
  }
  return send({ type: 'persistBatch', entries, seq: s }, transferables);
}

export function purgeBuffersOffThread(id: string): Promise<void> {
  const s = ++seq;
  return send({ type: 'purge', id, seq: s });
}

export function clearBufferCacheOffThread(): Promise<void> {
  const s = ++seq;
  return send({ type: 'clear', seq: s });
}
