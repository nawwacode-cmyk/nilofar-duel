// Gzips the heavy models from assets-src/models into public/play/models/*.gz.
// GitHub Pages does not compress .fbx/.bin, so the game downloads the .gz and inflates it with fflate.
// Run: node tools/gzip-models.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
for (const f of readdirSync('assets-src/models')) {
  const src = readFileSync(`assets-src/models/${f}`);
  const gz = gzipSync(src, { level: 9 });
  writeFileSync(`public/play/models/${f}.gz`, gz);
  console.log(`${f}: ${(src.length / 1024) | 0}K -> ${(gz.length / 1024) | 0}K`);
}
