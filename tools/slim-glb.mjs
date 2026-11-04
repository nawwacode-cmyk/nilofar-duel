// Shrinks a character GLB for the web: every embedded image is resized (max 1024 px) and re-encoded as JPEG
// with ffmpeg, then the binary chunk is rebuilt. Geometry, skin and materials are untouched.
// Usage: node tools/slim-glb.mjs <in.glb> <out.glb> [maxSize=1024]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , src, dst, maxArg] = process.argv;
const MAX = +(maxArg || 1024);
const buf = readFileSync(src);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
const dir = mkdtempSync(join(tmpdir(), 'slimglb-'));

// Collect each bufferView's bytes; replace image views with re-encoded JPEGs.
const views = json.bufferViews.map(v => bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
(json.images || []).forEach((img, i) => {
  const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
  const inF = join(dir, `i${i}.${ext}`), outF = join(dir, `o${i}.jpg`);
  writeFileSync(inF, views[img.bufferView]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', inF, '-vf', `scale='min(${MAX},iw)':'min(${MAX},ih)':force_original_aspect_ratio=decrease`, '-q:v', '4', outF]);
  views[img.bufferView] = readFileSync(outF);
  img.mimeType = 'image/jpeg';
  console.log(`image ${i}: ${(json.bufferViews[img.bufferView].byteLength / 1024) | 0}K -> ${(views[img.bufferView].length / 1024) | 0}K`);
});

// Re-pack the binary chunk with 4-byte alignment.
const parts = []; let off = 0;
json.bufferViews.forEach((v, i) => {
  const pad = (4 - (off % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
  v.byteOffset = off; v.byteLength = views[i].length; parts.push(views[i]); off += views[i].length;
});
const newBin = Buffer.concat(parts, off); const binPad = (4 - (newBin.length % 4)) % 4;
json.buffers[0].byteLength = newBin.length;
let jsonStr = JSON.stringify(json); while (jsonStr.length % 4) jsonStr += ' ';
const jsonBuf = Buffer.from(jsonStr);
const total = 12 + 8 + jsonBuf.length + 8 + newBin.length + binPad;
const out = Buffer.alloc(total); let o = 0;
out.writeUInt32LE(0x46546c67, o); out.writeUInt32LE(2, o + 4); out.writeUInt32LE(total, o + 8); o += 12;
out.writeUInt32LE(jsonBuf.length, o); out.writeUInt32LE(0x4e4f534a, o + 4); o += 8; jsonBuf.copy(out, o); o += jsonBuf.length;
out.writeUInt32LE(newBin.length + binPad, o); out.writeUInt32LE(0x004e4942, o + 4); o += 8; newBin.copy(out, o);
writeFileSync(dst, out);
console.log(`${(buf.length / 1048576).toFixed(2)} MB -> ${(out.length / 1048576).toFixed(2)} MB`);
