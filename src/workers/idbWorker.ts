const DB_NAME = 'image-buffer-cache';
const STORE_NAME = 'buffers';
const DB_VERSION = 3;

interface CachedBuffers {
  gray: ArrayBuffer;
  rgba?: ArrayBuffer;
  tiffRaw?: ArrayBuffer;
  tiffKind?: string;
  tiffPixelCount?: number;
  tiffInvert?: boolean;
  tiffLittleEndian?: boolean;
}

type MsgPersist = { type: 'persist'; id: string; data: CachedBuffers; seq: number };
type MsgPersistBatch = { type: 'persistBatch'; entries: Array<{ id: string; data: CachedBuffers }>; seq: number };
type MsgPurge = { type: 'purge'; id: string; seq: number };
type MsgClear = { type: 'clear'; seq: number };

type InMsg = MsgPersist | MsgPersistBatch | MsgPurge | MsgClear;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (db.objectStoreNames.contains('linear-stretched')) {
        db.deleteObjectStore('linear-stretched');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function persist(id: string, data: CachedBuffers): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persistBatch(entries: Array<{ id: string; data: CachedBuffers }>): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const { id, data } of entries) {
      store.put(data, id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function purge(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function clear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'persist':
        await persist(msg.id, msg.data);
        break;
      case 'persistBatch':
        await persistBatch(msg.entries);
        break;
      case 'purge':
        await purge(msg.id);
        break;
      case 'clear':
        await clear();
        break;
    }
    self.postMessage({ seq: msg.seq, ok: true });
  } catch (err) {
    self.postMessage({ seq: msg.seq, ok: false, error: String(err) });
  }
};
