// Revise this namespace when the pity curve, featured odds or stored format changes.
const namespace = 'signal-pmf-v1';
const maxStoredEntries = 24;
const available = new Map();
const pending = new Map();
let database;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!database) database = new Promise(resolve => {
    const request = indexedDB.open(namespace, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('tables', {keyPath:'key'});
      store.createIndex('savedAt','savedAt');
    };
    request.onerror = request.onblocked = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  }).catch(() => null);
  return database;
}

async function stored(key) {
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise((resolve,reject) => {
    const req = db.transaction('tables').objectStore('tables').get(key);
    req.onsuccess = () => resolve(req.result?.value);
    req.onerror = () => reject(req.error);
  }).catch(() => undefined);
}

async function save(key,value) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise((resolve,reject) => {
    const tx = db.transaction('tables','readwrite');
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
    const store = tx.objectStore('tables');
    store.put({ key, value, savedAt: Date.now() });
    const size = store.count();
    size.onsuccess = () => {
      let excess = size.result - maxStoredEntries;
      if (excess <= 0) return;
      const oldest = store.index('savedAt').openKeyCursor();
      oldest.onsuccess = () => {
        const cursor = oldest.result;
        if (!cursor || excess <= 0) return;
        store.delete(cursor.primaryKey);
        if (--excess > 0) cursor.continue();
      };
    };
  }).catch(() => {}); // A full or unavailable device store still permits calculation.
}

export function getTable(key, build) {
  if (available.has(key)) {
    const value = available.get(key);
    available.delete(key);
    available.set(key,value);
    return Promise.resolve(value);
  }
  if (pending.has(key)) return pending.get(key);
  const lookup = (async () => {
    let value = await stored(key);
    if (value === undefined) {
      value = await build();
      // Let the report use the in-memory table before IndexedDB clones and commits it.
      setTimeout(() => save(key,value), 0);
    }
    available.set(key,value);
    if (available.size > 6) available.delete(available.keys().next().value);
    return value;
  })().finally(() => pending.delete(key));
  pending.set(key,lookup);
  return lookup;
}
