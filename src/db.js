/**
 * IndexedDB wrapper (promises) with versioned migrations, atomic multi-store transactions,
 * export/import and friendly errors. All workout data lives here; localStorage is never used for it.
 */
export const DB_NAME = 'shield-fitness';
export const DB_VERSION = 1;
export const APP_ID = 'shield-fitness';

const STORES = {
  settings: { keyPath: 'key' },
  exercises: { keyPath: 'id' },
  days: { keyPath: 'id' },
  warmups: { keyPath: 'id' },
  sessions: { keyPath: 'id', indexes: [['date', 'date'], ['status', 'status']] },
  setLogs: { keyPath: 'id', indexes: [['sessionId', 'sessionId'], ['exerciseId', 'exerciseId'], ['ts', 'ts']] },
  bodyMetrics: { keyPath: 'id', indexes: [['date', 'date']] },
  photos: { keyPath: 'id', indexes: [['date', 'date']] },
  programState: { keyPath: 'key' },
  coreTests: { keyPath: 'id', indexes: [['date', 'date']] },
  daily: { keyPath: 'date' },
};
export const STORE_NAMES = Object.keys(STORES);

/** Migrations run in order for every version above the user's current one. Add new entries, never edit old ones. */
const MIGRATIONS = {
  1: (db) => {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.createObjectStore(name, { keyPath: def.keyPath });
      for (const [n, kp] of def.indexes || []) os.createIndex(n, kp);
    }
  },
};

let dbp = null;
export function humanError(e) {
  const n = e?.name || '';
  if (n === 'QuotaExceededError') return 'Your device storage is full. Free some space (or export a backup and delete old photos), then try again.';
  if (n === 'VersionError') return 'This data was saved by a newer version of the app. Reload to update.';
  if (n === 'InvalidStateError' || n === 'SecurityError') return 'Your browser is blocking local storage (private mode?). Open the app in a normal tab.';
  return e?.message || 'Something went wrong while saving.';
}

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v]?.(db, req.transaction);
    };
    req.onblocked = () => reject(new Error('Another tab is using an older version of the app. Close other Shield tabs and reload.'));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

const p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Run `fn(getStore)` inside one transaction; resolves after commit. */
export async function tx(names, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Save was cancelled.'));
    Promise.resolve(fn((n) => t.objectStore(n))).then((v) => { out = v; }).catch((e) => { try { t.abort(); } catch { /* noop */ } reject(e); });
  });
}
export const get = (s, k) => tx([s], 'readonly', (o) => p(o(s).get(k)));
export const getAll = (s) => tx([s], 'readonly', (o) => p(o(s).getAll()));
export const put = (s, v) => tx([s], 'readwrite', (o) => p(o(s).put(v)));
export const putMany = (s, vs) => tx([s], 'readwrite', (o) => Promise.all(vs.map((v) => p(o(s).put(v)))));
export const del = (s, k) => tx([s], 'readwrite', (o) => p(o(s).delete(k)));
export const delMany = (s, ks) => tx([s], 'readwrite', (o) => Promise.all(ks.map((k) => p(o(s).delete(k)))));
export const clear = (s) => tx([s], 'readwrite', (o) => p(o(s).clear()));
export const byIndex = (s, idx, key) => tx([s], 'readonly', (o) => p(o(s).index(idx).getAll(key)));
export const count = (s) => tx([s], 'readonly', (o) => p(o(s).count()));

/* ---------- Backup ---------- */
const blobToData = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
const dataToBlob = async (d) => (await fetch(d)).blob();

export async function exportAll() {
  const data = {};
  for (const n of STORE_NAMES) data[n] = await getAll(n);
  data.photos = await Promise.all(data.photos.map(async (ph) => ({ ...ph, blob: ph.blob ? await blobToData(ph.blob) : null })));
  return { app: APP_ID, schema: DB_VERSION, exportedAt: Date.now(), data };
}

const KEYS = Object.fromEntries(Object.entries(STORES).map(([n, d]) => [n, d.keyPath]));
/** Throws a readable Error if the file is not a valid backup. */
export function validateBackup(json) {
  if (!json || json.app !== APP_ID) throw new Error('This file is not a Shield Fitness backup.');
  if (!Number.isInteger(json.schema) || json.schema > DB_VERSION) throw new Error('This backup is from a newer app version. Update the app first.');
  if (!json.data || typeof json.data !== 'object') throw new Error('The backup file has no data.');
  for (const [n, list] of Object.entries(json.data)) {
    if (!STORES[n]) continue;
    if (!Array.isArray(list)) throw new Error(`Backup section "${n}" is damaged.`);
    for (const r of list) if (!r || r[KEYS[n]] === undefined) throw new Error(`Backup section "${n}" has a record without an id.`);
  }
  return true;
}
/** Count records that are new vs already present (by id) for the import preview. */
export async function previewImport(json) {
  validateBackup(json);
  const rows = [];
  for (const n of STORE_NAMES) {
    const incoming = json.data[n] || [];
    if (!incoming.length) continue;
    const have = new Set((await getAll(n)).map((r) => r[KEYS[n]]));
    rows.push({ store: n, total: incoming.length, fresh: incoming.filter((r) => !have.has(r[KEYS[n]])).length });
  }
  return rows;
}
/** mode "replace" wipes everything first; "merge" only adds records whose id does not exist (no duplicates). */
export async function importBackup(json, mode) {
  validateBackup(json);
  const prepared = {};
  for (const n of STORE_NAMES) {
    let list = json.data[n] || [];
    if (n === 'photos') list = await Promise.all(list.map(async (ph) => ({ ...ph, blob: ph.blob ? await dataToBlob(ph.blob) : null })));
    prepared[n] = list;
  }
  await tx(STORE_NAMES, 'readwrite', async (o) => {
    for (const n of STORE_NAMES) {
      const os = o(n);
      if (mode === 'replace') await p(os.clear());
      const have = mode === 'merge' ? new Set((await p(os.getAllKeys()))) : null;
      for (const r of prepared[n]) if (!have || !have.has(r[KEYS[n]])) await p(os.put(r));
    }
  });
}
export async function wipeAll() { await tx(STORE_NAMES, 'readwrite', (o) => Promise.all(STORE_NAMES.map((n) => p(o(n).clear())))); }
