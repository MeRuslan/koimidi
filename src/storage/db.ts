/**
 * The IndexedDB database "koimidi": imported files, finger edits and practice
 * progress. Version 2 added "fingerings", version 3 "progress". Every call
 * opens and closes the database, so an older tab never blocks an upgrade.
 */
const DB = 'koimidi';
const VERSION = 3;
export const STORE = 'files';
export const FINGERS = 'fingerings';
export const PROGRESS = 'progress';
export type StoreName = typeof STORE | typeof FINGERS | typeof PROGRESS;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'id' });
        st.createIndex('openedAt', 'openedAt');
      }
      if (!db.objectStoreNames.contains(FINGERS)) db.createObjectStore(FINGERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

export function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, t: IDBTransaction) => IDBRequest<T> | void,
  stores: StoreName | StoreName[] = STORE,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const store = t.objectStore(Array.isArray(stores) ? stores[0] : stores);
        let result: T | undefined;
        const req = fn(store, t);
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => {
          db.close();
          resolve(result as T);
        };
        t.onerror = () => {
          db.close();
          reject(t.error ?? new Error('IndexedDB transaction failed'));
        };
      }),
  );
}

