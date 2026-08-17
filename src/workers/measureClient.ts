import type {
  MeasureImageInput,
  MeasureRowResult,
  MeasureBatchResponse,
} from './measureWorker';

interface PendingBatch {
  resolve: (results: MeasureBatchResponse['results']) => void;
  reject: (err: Error) => void;
}

const POOL_SIZE = Math.min(navigator.hardwareConcurrency || 4, 8);

let pool: Worker[] | null = null;
let poolBroken = false;
let reqCounter = 0;
const pending = new Map<number, PendingBatch>();
let nextWorkerIdx = 0;

function getPool(): Worker[] | null {
  if (poolBroken) return null;
  if (typeof Worker === 'undefined') return null;
  if (pool) return pool;
  try {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL('./measureWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<MeasureBatchResponse>) => {
        const data = e.data;
        if (data.type === 'measureBatchDone') {
          const entry = pending.get(data.reqId);
          if (entry) {
            pending.delete(data.reqId);
            entry.resolve(data.results);
          }
        }
      };
      w.onerror = () => {
        poolBroken = true;
        pool?.forEach((wk) => wk.terminate());
        pool = null;
        for (const entry of pending.values()) {
          entry.reject(new Error('Measure worker crashed'));
        }
        pending.clear();
      };
      pool.push(w);
    }
  } catch {
    poolBroken = true;
    pool = null;
  }
  return pool;
}

function splitIntoBatches<T>(items: T[], numBatches: number): T[][] {
  const batches: T[][] = Array.from({ length: numBatches }, () => []);
  for (let i = 0; i < items.length; i++) {
    batches[i % numBatches].push(items[i]);
  }
  return batches;
}

export interface MeasureBatchResult {
  imageId: string;
  row: MeasureRowResult | null;
  isBrightfieldSkipped: boolean;
}

export async function measureBatchInWorkers(
  items: MeasureImageInput[],
): Promise<MeasureBatchResult[]> {
  if (items.length === 0) return [];

  const workers = getPool();
  if (!workers) {
    throw new Error('Measure workers unavailable');
  }

  const numWorkers = workers.length;
  const batches = splitIntoBatches(items, numWorkers);
  const promises: Promise<MeasureBatchResult[]>[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (batch.length === 0) continue;
    const reqId = ++reqCounter;
    const workerIdx = (nextWorkerIdx++) % numWorkers;
    const w = workers[workerIdx];

    const transferables: ArrayBuffer[] = [];
    for (const item of batch) {
      if (item.gray.buffer instanceof ArrayBuffer) {
        transferables.push(item.gray.buffer);
      }
    }

    const promise = new Promise<MeasureBatchResult[]>((resolve, reject) => {
      pending.set(reqId, { resolve, reject });
    });
    promises.push(promise);

    w.postMessage(
      { type: 'measureBatch', reqId, items: batch },
      transferables,
    );
  }

  const allResults = await Promise.all(promises);
  return allResults.flat();
}

export function prewarmMeasureWorkers(): void {
  getPool();
}
