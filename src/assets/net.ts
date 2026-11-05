import { gunzipSync } from 'fflate';

/**
 * Downloads for slow and unreliable connections:
 * - byte-level progress (shared by all downloads so the loading bar always moves),
 * - a stalled download (no bytes for STALL_MS) is aborted and retried, up to RETRIES times,
 * - *.gz files are inflated in JS (fflate works in every browser, unlike DecompressionStream).
 */
const STALL_MS = 20000, RETRIES = 4;

type ProgressFn = (loaded: number, total: number) => void;
const jobs = new Map<string, { loaded: number; total: number }>();
let listener: ProgressFn | null = null;

/** Receives combined progress of every download in flight or finished since the last reset. */
export function onDownloadProgress(fn: ProgressFn | null) { listener = fn; }
export function resetDownloadProgress() { jobs.clear(); }
function report() {
  if (!listener) return;
  let l = 0, t = 0; for (const j of jobs.values()) { l += j.loaded; t += Math.max(j.total, j.loaded); }
  listener(l, t);
}

async function attempt(url: string, job: { loaded: number; total: number }, expect: number): Promise<Uint8Array> {
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(), STALL_MS);
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), STALL_MS); };
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (r.status === 404 && url.endsWith('.gz')) throw new NoGz();
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    const len = +(r.headers.get('content-length') || 0);
    // content-length is the compressed size when the server gzips on the fly; only trust it for our .gz files.
    job.total = url.endsWith('.gz') && len ? len : Math.max(expect, len); job.loaded = 0; report();
    if (!r.body) { const b = new Uint8Array(await r.arrayBuffer()); job.loaded = b.length; report(); return b; }
    const reader = r.body.getReader(); const parts: Uint8Array[] = []; let n = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bump(); parts.push(value); n += value.length; job.loaded = n; report();
    }
    const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  } finally { clearTimeout(timer); }
}

/**
 * Fetches a file as bytes with progress and retries; inflates *.gz.
 * `expect` is an approximate size used for the progress bar before the server answers.
 */
class NoGz extends Error {}

export async function fetchBytes(url: string, expect = 0): Promise<Uint8Array> {
  const job = { loaded: 0, total: expect }; jobs.set(url, job); report();
  let lastErr: unknown;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const b = await attempt(url, job, expect).catch(e => {
        // Android's APK packaging stores *.gz assets inflated and without the extension: use that copy.
        if (e instanceof NoGz) return attempt(url.slice(0, -3), job, expect);
        throw e;
      });
      job.loaded = job.total = b.length; report();
      // Some servers send .gz with Content-Encoding: gzip, so the browser has already inflated it:
      // only inflate when the gzip magic bytes are actually there.
      return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b;
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T>(url: string, expect = 0): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url, expect))) as T;
}
