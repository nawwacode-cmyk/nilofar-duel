// Builds an optional content pack (downloaded inside the Android app on demand, see src/assets/packs.ts).
// Every file of <src dir> is split into parts of at most PART bytes, so a dropped connection only re-downloads one part
// and no file in the repository exceeds GitHub's limits. Output: public/packs/<id>/manifest.json + parts.
// Usage: node tools/make-pack.mjs <src dir> <pack id> [part MB = 4]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [, , src, id, mb] = process.argv;
const PART = Math.round((+mb || 4) * 1048576);
const out = `public/packs/${id}`;
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

const files = []; let total = 0, n = 0; const hash = createHash('sha1');
for (const name of readdirSync(src).sort()) {
  if (!statSync(join(src, name)).isFile()) continue;
  const buf = readFileSync(join(src, name)); const parts = []; hash.update(name).update(buf);
  for (let o = 0; o < buf.length || (o === 0 && buf.length === 0); o += PART) {
    const p = `p${String(n++).padStart(4, '0')}.bin`;
    writeFileSync(join(out, p), buf.subarray(o, o + PART)); parts.push(p);
    if (buf.length === 0) break;
  }
  files.push({ name, size: buf.length, parts });
  total += buf.length;
}
// The version changes whenever the content does, so installed copies know they are out of date.
const version = hash.digest('hex').slice(0, 10);
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ id, version, total, part: PART, files }));
console.log(`${id}: ${files.length} files, ${(total / 1048576).toFixed(1)} MB in ${n} parts, version ${version}`);
