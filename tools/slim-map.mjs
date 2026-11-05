// Turns a game-ready map GLB (Sketchfab scene with many materials, alpha foliage) into a light, flattened GLB for
// the Hunters pack, plus a navigation grid. Unlike decim-scan.mjs the geometry is kept as authored (foliage would not
// survive vertex clustering); instead transforms are baked, triangles outside the crop box dropped, primitives merged
// per material, textures resized (JPEG for opaque, PNG for cut-out) and "BLEND" foliage turned into alpha "MASK".
//
// Usage: node tools/slim-map.mjs <in.glb> <out name> <config.json>
// config: { center: [x, y, z]       world point that becomes the origin (y = ground there)
//           scale?: 1, rotY?: 0      applied after centring (degrees)
//           crop: { x: [min, max], z: [min, max], y?: [min, max] }   in output coordinates
//           texMax?: 1024, texMaxBig?: 2048 for materials listed in bigTex
//           drop?: [material names], ground: [material names used for the floor height], slopeFrom?: [terrain only],
//           solid: [material names that block walking], nav: { x: [min,max], z: [min,max], step: 0.5 } }
// Output: <out>.glb.gz and <out>.nav.gz in public/packs-src/hunters (then tools/make-pack.mjs).
// .nav: [u32 header length][JSON {x0, z0, step, nx, nz}][pad 4][f32 heights nx*nz][u8 walk nx*nz]
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGlb, primitives } from './scan-lib.mjs';

const [, , src, name, cfgPath] = process.argv;
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const OUT = 'assets-src/hunters/pack'; mkdirSync(OUT, { recursive: true });
const glb = readGlb(src), { json } = glb;
const prims = primitives(glb);
const S = cfg.scale ?? 1, rot = ((cfg.rotY ?? 0) * Math.PI) / 180, cs = Math.cos(rot), sn = Math.sin(rot);
const [cx, cy, cz] = cfg.center;
const tf = (x, y, z) => { const X = (x - cx) * S, Y = (y - cy) * S, Z = (z - cz) * S; return [X * cs + Z * sn, Y, -X * sn + Z * cs]; };
const inBox = (x, y, z) => x >= cfg.crop.x[0] && x <= cfg.crop.x[1] && z >= cfg.crop.z[0] && z <= cfg.crop.z[1] && (!cfg.crop.y || (y >= cfg.crop.y[0] && y <= cfg.crop.y[1]));
const matName = i => json.materials[i]?.name ?? `m${i}`;
const drop = new Set(cfg.drop ?? []), ground = new Set(cfg.ground ?? []), solid = new Set(cfg.solid ?? []);

// ---------- 1. merge kept triangles per material ----------
const byMat = new Map();
for (const p of prims) {
  const mn = matName(p.material); if (drop.has(mn)) continue;
  let g = byMat.get(p.material); if (!g) { g = { pos: [], nor: [], uv: [], idx: [], map: new Map() }; byMat.set(p.material, g); }
  const remap = new Map();
  for (let t = 0; t < p.idx.length; t += 3) {
    const v = [p.idx[t], p.idx[t + 1], p.idx[t + 2]];
    const w = v.map(i => tf(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]));
    const mx = (w[0][0] + w[1][0] + w[2][0]) / 3, my = (w[0][1] + w[1][1] + w[2][1]) / 3, mz = (w[0][2] + w[1][2] + w[2][2]) / 3;
    if (!inBox(mx, my, mz)) continue;
    for (let k = 0; k < 3; k++) {
      let ni = remap.get(v[k]);
      if (ni === undefined) {
        ni = g.pos.length / 3; remap.set(v[k], ni);
        g.pos.push(...w[k]);
        if (p.nor) { const i = v[k] * 3, x = p.nor[i], z = p.nor[i + 2]; g.nor.push(x * cs + z * sn, p.nor[i + 1], -x * sn + z * cs); } else g.nor.push(0, 1, 0);
        if (p.uv) g.uv.push(p.uv[v[k] * 2], p.uv[v[k] * 2 + 1]); else g.uv.push(0, 0);
      }
      g.idx.push(ni);
    }
  }
}

// ---------- 2. navigation grid: floor height from ground materials, blocked where solids stand ----------
const N = cfg.nav, nx = Math.round((N.x[1] - N.x[0]) / N.step) + 1, nz = Math.round((N.z[1] - N.z[0]) / N.step) + 1;
const height = new Float32Array(nx * nz).fill(-1e9), block = new Uint8Array(nx * nz);
// Slope is judged on the terrain alone: roads and decals lie a few cm above it and would look like steps.
const terrain = new Float32Array(nx * nz).fill(-1e9), slopeFrom = new Set(cfg.slopeFrom ?? cfg.ground ?? []);
function raster(g, fn) {
  const P = g.pos;
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, c = g.idx[t + 2] * 3;
    const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], qx = P[c], qz = P[c + 2];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, qx) - N.x[0]) / N.step)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, qx) - N.x[0]) / N.step));
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, qz) - N.z[0]) / N.step)), j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, qz) - N.z[0]) / N.step));
    if (i0 > i1 || j0 > j1) continue;
    const det = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz); if (Math.abs(det) < 1e-12) { fn(-1, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, i0, j0); continue; }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = N.x[0] + i * N.step, z = N.z[0] + j * N.step;
      const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / det, l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / det, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      fn(j * nx + i, l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1]);
    }
  }
}
for (const [m, g] of byMat) if (ground.has(matName(m))) raster(g, (k, y) => { if (k >= 0 && y > height[k]) height[k] = y; });
for (const [m, g] of byMat) if (slopeFrom.has(matName(m))) raster(g, (k, y) => { if (k >= 0 && y > terrain[k]) terrain[k] = y; });
for (let k = 0; k < terrain.length; k++) if (terrain[k] < -1e8) terrain[k] = height[k] > -1e8 ? height[k] : 0;
// Fill holes in the floor from neighbours.
for (let pass = 0; pass < 6; pass++) for (let k = 0; k < height.length; k++) if (height[k] < -1e8) {
  const i = k % nx, j = (k / nx) | 0; let s = 0, n = 0;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const h = height[jj * nx + ii]; if (h > -1e8) { s += h; n++; } }
  if (n) height[k] = s / n;
}
for (let k = 0; k < height.length; k++) if (height[k] < -1e8) { height[k] = 0; block[k] = 1; }
// Solids (trunks, rocks, fences) between knee and head height block a cell; so does a steep slope.
const solidCell = (g) => { const P = g.pos; for (let v = 0; v < P.length; v += 3) {
  const i = Math.round((P[v] - N.x[0]) / N.step), j = Math.round((P[v + 2] - N.z[0]) / N.step); if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
  const k = j * nx + i, dy = P[v + 1] - height[k]; if (dy > 0.35 && dy < 2.2) block[k] = 1; } };
for (const [m, g] of byMat) if (solid.has(matName(m))) solidCell(g);
for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const k = j * nx + i, gx = (terrain[k + 1] - terrain[k - 1]) / (2 * N.step), gz = (terrain[k + nx] - terrain[k - nx]) / (2 * N.step);
  if (Math.hypot(gx, gz) > 0.9) block[k] = 1; // steeper than ~42°
}
{
  const hdr = Buffer.from(JSON.stringify({ x0: N.x[0], z0: N.z[0], step: N.step, nx, nz }));
  const len = Buffer.alloc(4); len.writeUInt32LE(hdr.length);
  const pad = Buffer.alloc((4 - ((4 + hdr.length) % 4)) % 4);
  writeFileSync(join(OUT, `${name}.nav.gz`), gzipSync(Buffer.concat([len, hdr, pad, Buffer.from(height.buffer), Buffer.from(block.buffer)]), { level: 9 }));
}

// ---------- 3. textures ----------
const dir = mkdtempSync(join(tmpdir(), 'map-'));
const imgOut = new Map(); // source image index -> { data, mime }
function texture(ti, cut, big) {
  const img = json.textures[ti].source; const key = img + (cut ? 'a' : 'o');
  if (imgOut.has(key)) return key;
  const im = json.images[img], bv = json.bufferViews[im.bufferView];
  const raw = join(dir, `i${img}`); writeFileSync(raw, glb.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  const px = big ? (cfg.texMaxBig ?? 2048) : (cfg.texMax ?? 1024);
  const out = join(dir, `o${img}${cut ? '.png' : '.jpg'}`);
  const vf = `scale='min(${px},iw)':'min(${px},ih)':force_original_aspect_ratio=decrease`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', vf, ...(cut ? ['-pix_fmt', 'rgba'] : ['-q:v', '5']), out]);
  imgOut.set(key, { data: readFileSync(out), mime: cut ? 'image/png' : 'image/jpeg' });
  return key;
}

// ---------- 4. write the GLB ----------
const bufs = []; let off = 0;
const bv = (buf, target) => { const pad = (4 - (off % 4)) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; } bufs.push(buf); const v = { buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) }; off += buf.length; out.bufferViews.push(v); return out.bufferViews.length - 1; };
const out = { asset: { version: '2.0', generator: 'nilofar slim-map' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], buffers: [{}] };
const texIndex = new Map();
let tris = 0;
for (const [m, g] of byMat) {
  if (!g.idx.length) continue;
  const src = json.materials[m] ?? {}, pbr = src.pbrMetallicRoughness ?? {};
  const cut = src.alphaMode === 'BLEND' || src.alphaMode === 'MASK';
  const mat = { name: matName(m), doubleSided: !!src.doubleSided || cut, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } };
  if (pbr.baseColorFactor) mat.pbrMetallicRoughness.baseColorFactor = pbr.baseColorFactor;
  if (cut) { mat.alphaMode = 'MASK'; mat.alphaCutoff = 0.45; }
  if (pbr.baseColorTexture) {
    const key = texture(pbr.baseColorTexture.index, cut, (cfg.bigTex ?? []).includes(mat.name));
    if (!texIndex.has(key)) { const im = imgOut.get(key); out.images.push({ bufferView: bv(im.data), mimeType: im.mime }); out.textures.push({ sampler: 0, source: out.images.length - 1 }); texIndex.set(key, out.textures.length - 1); }
    mat.pbrMetallicRoughness.baseColorTexture = { index: texIndex.get(key) };
  }
  out.materials.push(mat);
  const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor), uv = new Float32Array(g.uv);
  const idx = pos.length / 3 > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx);
  const lo = [0, 1, 2].map(a => { let v = Infinity; for (let i = a; i < pos.length; i += 3) v = Math.min(v, pos[i]); return v; });
  const hi = [0, 1, 2].map(a => { let v = -Infinity; for (let i = a; i < pos.length; i += 3) v = Math.max(v, pos[i]); return v; });
  const acc = (view, type, ct, count, extra = {}) => { out.accessors.push({ bufferView: view, componentType: ct, count, type, ...extra }); return out.accessors.length - 1; };
  const aP = acc(bv(Buffer.from(pos.buffer), 34962), 'VEC3', 5126, pos.length / 3, { min: lo, max: hi });
  const aN = acc(bv(Buffer.from(nor.buffer), 34962), 'VEC3', 5126, nor.length / 3);
  const aT = acc(bv(Buffer.from(uv.buffer), 34962), 'VEC2', 5126, uv.length / 2);
  const aI = acc(bv(Buffer.from(idx.buffer), 34963), 'SCALAR', idx instanceof Uint32Array ? 5125 : 5123, idx.length);
  out.meshes.push({ name: mat.name, primitives: [{ attributes: { POSITION: aP, NORMAL: aN, TEXCOORD_0: aT }, indices: aI, material: out.materials.length - 1 }] });
  out.nodes.push({ mesh: out.meshes.length - 1, name: mat.name }); out.scenes[0].nodes.push(out.nodes.length - 1);
  tris += idx.length / 3;
}
const bin = Buffer.concat(bufs); const binPad = (4 - (bin.length % 4)) % 4; out.buffers[0].byteLength = bin.length + binPad;
let js = JSON.stringify(out); while (js.length % 4) js += ' ';
const jb = Buffer.from(js), total = 12 + 8 + jb.length + 8 + bin.length + binPad;
const glbOut = Buffer.alloc(total); let o = 0;
glbOut.writeUInt32LE(0x46546c67, o); glbOut.writeUInt32LE(2, o + 4); glbOut.writeUInt32LE(total, o + 8); o += 12;
glbOut.writeUInt32LE(jb.length, o); glbOut.writeUInt32LE(0x4e4f534a, o + 4); o += 8; jb.copy(glbOut, o); o += jb.length;
glbOut.writeUInt32LE(bin.length + binPad, o); glbOut.writeUInt32LE(0x004e4942, o + 4); o += 8; bin.copy(glbOut, o);
const gz = gzipSync(glbOut, { level: 9 });
writeFileSync(join(OUT, `${name}.glb.gz`), gz);
let blocked = 0; for (const b of block) blocked += b;
console.log(`${name}: ${tris} triangles, ${out.materials.length} materials, ${out.images.length} images, glb ${(glbOut.length / 1048576).toFixed(1)} MB (gz ${(gz.length / 1048576).toFixed(1)} MB), nav ${nx}x${nz} (${((100 * blocked) / block.length).toFixed(0)}% blocked)`);
