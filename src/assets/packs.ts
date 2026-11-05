/**
 * Optional content packs (e.g. the Hunters mode): not part of the app download, fetched on demand and kept on the
 * device. A pack is a manifest plus parts of at most a few MB (tools/make-pack.mjs). Parts are stored in IndexedDB
 * one by one, so an interrupted download resumes from the last missing part instead of starting over.
 */
export interface PackManifest { id: string; version: string; total: number; part: number; files: { name: string; size: number; parts: string[] }[] }
export interface PackState { installed: boolean; version?: string; have: number; total: number }

const SITE = 'https://nawwacode-cmyk.github.io/nilofar-duel/';
/** Inside the app the pages are local, so packs come from the website; on the web they sit next to the game. */
const packBase = (id: string) => new URL(`packs/${id}/`, isApp() ? SITE : new URL('../', location.href)).href;

export const isApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
/** Packs are offered in the Android app; ?debug enables them on the web for testing. */
export const packsAvailable = () => isApp() || new URLSearchParams(location.search).has('debug');

/* ---------- IndexedDB: store "parts" (key "<pack>/<part>" → bytes), store "meta" (key pack → {version, done}) ---------- */
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('asrar-packs', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('parts'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => { const r = fn(d.transaction(store, mode).objectStore(store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const getKeys = (prefix: string) => tx('parts', 'readonly', s => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')));

async function manifest(id: string): Promise<PackManifest> {
  const r = await fetch(packBase(id) + 'manifest.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('manifest ' + r.status);
  return r.json() as Promise<PackManifest>;
}

/** What is on the device. `have` counts the bytes of parts already stored (for a paused download). */
export async function packState(id: string): Promise<PackState> {
  const meta = await tx<{ version: string; total: number; done: boolean } | undefined>('meta', 'readonly', s => s.get(id));
  if (!meta) return { installed: false, have: 0, total: 0 };
  const keys = await getKeys(id + '/');
  return { installed: meta.done, version: meta.version, have: keys.length, total: meta.total };
}

let active: AbortController | null = null;
export const downloading = () => !!active;
export function cancelDownload() { active?.abort(); }

/**
 * Downloads (or resumes, or updates) a pack. `onProgress(bytesDone, bytesTotal)`.
 * Each part is retried a few times; on failure the parts already stored are kept for the next attempt.
 */
export async function downloadPack(id: string, onProgress: (done: number, total: number) => void) {
  if (active) throw new Error('busy');
  active = new AbortController(); const sig = active.signal;
  try {
    void navigator.storage?.persist?.(); // ask the system not to clear it under storage pressure
    const m = await manifest(id);
    const old = await tx<{ version: string } | undefined>('meta', 'readonly', s => s.get(id));
    if (old && old.version !== m.version) await removePack(id); // new content: start clean
    await tx('meta', 'readwrite', s => s.put({ version: m.version, total: m.total, done: false }, id));
    const have = new Set((await getKeys(id + '/')).map(String));
    let done = 0;
    // Bytes already on the device count as done.
    for (const f of m.files) for (const p of f.parts) if (have.has(`${id}/${p}`)) done += partSize(m, f, p);
    onProgress(done, m.total);
    for (const f of m.files) for (const p of f.parts) {
      if (have.has(`${id}/${p}`)) continue;
      const bytes = await fetchPart(packBase(id) + p, sig);
      await tx('parts', 'readwrite', s => s.put(bytes, `${id}/${p}`));
      done += bytes.byteLength; onProgress(done, m.total);
    }
    // The file list is kept on the device so an installed pack also works offline.
    await tx('meta', 'readwrite', s => s.put({ version: m.version, total: m.total, done: true, files: m.files }, id));
  } finally { active = null; }
}
/** Every part is m.part bytes except the last one of a file. */
function partSize(m: PackManifest, f: PackManifest['files'][number], p: string) {
  const k = f.parts.indexOf(p);
  return Math.min(m.part, f.size - k * m.part);
}

async function fetchPart(url: string, signal: AbortSignal) {
  let err: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { signal, cache: 'no-store' });
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return await r.arrayBuffer();
    } catch (e) {
      if (signal.aborted) throw e;
      err = e; await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

/** Removes a pack from the device. */
export async function removePack(id: string) {
  const keys = await getKeys(id + '/');
  for (const k of keys) await tx('parts', 'readwrite', s => s.delete(k));
  await tx('meta', 'readwrite', s => s.delete(id));
}

/** A file of an installed pack, as bytes (the game loads models and textures from these). */
export async function packFile(id: string, name: string): Promise<Uint8Array> {
  const meta = await tx<{ files?: PackManifest['files'] } | undefined>('meta', 'readonly', s => s.get(id));
  const parts = meta?.files?.find(f => f.name === name)?.parts;
  if (!parts) throw new Error('missing ' + name);
  const bufs = await Promise.all(parts.map(p => tx<ArrayBuffer>('parts', 'readonly', s => s.get(`${id}/${p}`))));
  const out = new Uint8Array(bufs.reduce((n, b) => n + b.byteLength, 0)); let o = 0;
  for (const b of bufs) { out.set(new Uint8Array(b), o); o += b.byteLength; }
  return out;
}

/** Download size of a pack, read from its manifest on the server (nothing is downloaded). */
export async function packSize(id: string) { return (await manifest(id)).total; }
