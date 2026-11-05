import { describe, it, expect, vi, afterEach } from 'vitest';
import { gzipSync } from 'fflate';
import { fetchBytes } from '../src/assets/net';

const res = (status: number, body?: Uint8Array) => new Response(body ?? null, { status });

describe('fetchBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('inflates a gzipped file', async () => {
    const data = new TextEncoder().encode('hello');
    vi.stubGlobal('fetch', vi.fn(async () => res(200, gzipSync(data))));
    expect(new TextDecoder().decode(await fetchBytes('models/a.bin.gz'))).toBe('hello');
  });

  it('falls back to the name without .gz (Android APK stores them inflated)', async () => {
    const data = new TextEncoder().encode('court');
    const f = vi.fn(async (url: string) => (url.endsWith('.gz') ? res(404) : res(200, data)));
    vi.stubGlobal('fetch', f);
    expect(new TextDecoder().decode(await fetchBytes('models/court.bin.gz'))).toBe('court');
    expect(f.mock.calls.map(c => c[0])).toEqual(['models/court.bin.gz', 'models/court.bin']);
  });
});
