const DB_NAME = 'image-buffer-cache';
const STORE_NAME = 'buffers';
const DB_VERSION = 3;

export interface CachedBuffers {
  gray: ArrayBuffer;
  rgba?: ArrayBuffer;
  tiffRaw?: ArrayBuffer;
  tiffKind?: string;
  tiffPixelCount?: number;
  tiffInvert?: boolean;
  tiffLittleEndian?: boolean;
}

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

export async function persistBuffers(id: string, data: CachedBuffers): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function persistBuffersBatch(
  entries: Array<{ id: string; data: CachedBuffers }>,
): Promise<void> {
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

export async function restoreBuffers(id: string): Promise<CachedBuffers | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function restoreBuffersBatch(
  ids: string[],
): Promise<Map<string, CachedBuffers>> {
  if (ids.length === 0) return new Map();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const results = new Map<string, CachedBuffers>();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) results.set(id, req.result);
      };
    }
    tx.oncomplete = () => resolve(results);
    tx.onerror = () => reject(tx.error);
  });
}

export async function purgeBuffers(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function resetConnection(): Promise<void> {
  if (dbPromise) {
    try { (await dbPromise).close(); } catch { /* already closed */ }
  }
  dbPromise = null;
}

export function clearBufferCache(): Promise<void> {
  dbPromise = null;
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
