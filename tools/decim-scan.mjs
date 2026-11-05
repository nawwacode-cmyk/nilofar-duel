// Shrinks a photogrammetry arena (Sketchfab GLB scan) into the game's compact .bin + webp textures.
// Vertex clustering: fine cells around the duel floor, coarse cells for distant walls; per-corner uvs are kept,
// so texture atlases stay sharp across seams. Positions are moved so the arena centre is the origin and the
// floor is y = 0, then rotated about Y.
//
// Usage: node tools/decim-scan.mjs <in.glb> <name> <config.json>
// config: { cx, cz, floorY, rotY (deg), shift?: [x, z] after rotation, remove?: [{ x, y, z: [min, max] }], fine: { r, yMax, cell }, coarse: { cell }, crop: { r, yMax } }
// Output: public/play/models/<name>.bin.gz and public/play/models/<name>_<i>_{2k,4k}.webp
//
// .bin layout (v2): [u32 header length][JSON header][pad to 4][u16 positions][u16 uvs][i8 normals]
// header: { n, lo, sc, uv: [lo, span], groups: [{ start, count, mat }], mats: [{ tex?: index, color?: [r,g,b] }] }
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGlb, primitives } from './scan-lib.mjs';

const [, , src, name, cfgPath] = process.argv;
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const glb = readGlb(src);
const prims = primitives(glb);
const rot = (cfg.rotY * Math.PI) / 180, cs = Math.cos(rot), sn = Math.sin(rot);

// 1. Collect triangles in arena space, dropping what is far away or high up.
const P = [], U = [], M = [];
for (const p of prims) {
  const { pos, uv, idx } = p;
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]].map(i => {
      const x = pos[i * 3] - cfg.cx, y = pos[i * 3 + 1] - cfg.floorY, z = pos[i * 3 + 2] - cfg.cz;
      return [x * cs + z * sn + (cfg.shift?.[0] ?? 0), y, -x * sn + z * cs + (cfg.shift?.[1] ?? 0), uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0];
    });
    const mx = (v[0][0] + v[1][0] + v[2][0]) / 3, my = (v[0][1] + v[1][1] + v[2][1]) / 3, mz = (v[0][2] + v[1][2] + v[2][2]) / 3;
    if (Math.hypot(mx, mz) > cfg.crop.r || my > cfg.crop.yMax) continue;
    // Boxes to clear (e.g. plants between the camera and the duel), in arena space.
    if ((cfg.remove || []).some(b => mx > b.x[0] && mx < b.x[1] && my > b.y[0] && my < b.y[1] && mz > b.z[0] && mz < b.z[1])) continue;
    // Scans spread uvs over several unit tiles (UDIM-like) and textures repeat: move each triangle into the
    // tile of its centre so all uvs stay near 0..1 (stored over UV_LO..UV_LO+UV_SPAN, see below).
    const ou = Math.floor((v[0][3] + v[1][3] + v[2][3]) / 3), ov = Math.floor((v[0][4] + v[1][4] + v[2][4]) / 3);
    for (const c of v) { P.push(c[0], c[1], c[2]); U.push(c[3] - ou, c[4] - ov); }
    M.push(p.material);
  }
}
const nIn = M.length;

// 2. Cluster corner positions; fine cells near the duel floor.
const key = new Map(); const cl = new Int32Array(P.length / 3); let K = 0; const sum = [];
for (let k = 0; k < P.length / 3; k++) {
  const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
  const fine = Math.hypot(x, z) < cfg.fine.r && y < cfg.fine.yMax;
  const c = fine ? cfg.fine.cell : cfg.coarse.cell;
  const s = `${fine ? 1 : 0},${Math.floor(x / c)},${Math.floor(y / c)},${Math.floor(z / c)}`;
  let id = key.get(s); if (id === undefined) { id = K++; key.set(s, id); sum.push(0, 0, 0, 0); }
  cl[k] = id; sum[id * 4] += x; sum[id * 4 + 1] += y; sum[id * 4 + 2] += z; sum[id * 4 + 3]++;
}
const CP = new Float32Array(K * 3); for (let i = 0; i < K; i++) for (let a = 0; a < 3; a++) CP[i * 3 + a] = sum[i * 4 + a] / sum[i * 4 + 3];

// 3. Keep non-degenerate, non-duplicate triangles; smooth normals on the clustered vertices.
const keep = []; const seen = new Set();
for (let t = 0; t < nIn; t++) {
  const a = cl[t * 3], b = cl[t * 3 + 1], c = cl[t * 3 + 2];
  if (a === b || b === c || a === c) continue;
  const s = [a, b, c].sort((x, y) => x - y).join(','); if (seen.has(s)) continue; seen.add(s);
  keep.push(t);
}
const VN = new Float32Array(K * 3);
for (const t of keep) {
  const [a, b, c] = [cl[t * 3], cl[t * 3 + 1], cl[t * 3 + 2]];
  const ux = CP[b * 3] - CP[a * 3], uy = CP[b * 3 + 1] - CP[a * 3 + 1], uz = CP[b * 3 + 2] - CP[a * 3 + 2];
  const vx = CP[c * 3] - CP[a * 3], vy = CP[c * 3 + 1] - CP[a * 3 + 1], vz = CP[c * 3 + 2] - CP[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const i of [a, b, c]) { VN[i * 3] += nx; VN[i * 3 + 1] += ny; VN[i * 3 + 2] += nz; }
}

// 4. Sort by material into groups and write quantized arrays.
keep.sort((x, y) => M[x] - M[y]);
const n = keep.length * 3;
const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
const groups = [];
keep.forEach((t, i) => {
  if (!groups.length || groups[groups.length - 1].mat !== M[t]) groups.push({ start: i * 3, count: 0, mat: M[t] });
  groups[groups.length - 1].count += 3;
  for (let k = 0; k < 3; k++) {
    const c = cl[t * 3 + k], o = i * 3 + k;
    pos.set(CP.subarray(c * 3, c * 3 + 3), o * 3);
    const L = Math.hypot(VN[c * 3], VN[c * 3 + 1], VN[c * 3 + 2]) || 1;
    nor[o * 3] = VN[c * 3] / L; nor[o * 3 + 1] = VN[c * 3 + 1] / L; nor[o * 3 + 2] = VN[c * 3 + 2] / L;
    uv[o * 2] = U[(t * 3 + k) * 2]; uv[o * 2 + 1] = U[(t * 3 + k) * 2 + 1];
  }
});
const lo = [0, 1, 2].map(a => { let m = Infinity; for (let i = a; i < pos.length; i += 3) m = Math.min(m, pos[i]); return m; });
const hi = [0, 1, 2].map(a => { let m = -Infinity; for (let i = a; i < pos.length; i += 3) m = Math.max(m, pos[i]); return m; });
const sc = hi.map((h, a) => (h - lo[a]) / 65535 || 1);
const pq = new Uint16Array(n * 3); for (let i = 0; i < n * 3; i++) pq[i] = Math.round((pos[i] - lo[i % 3]) / sc[i % 3]);
const UV_LO = -0.5, UV_SPAN = 2;
const uq = new Uint16Array(n * 2); for (let i = 0; i < n * 2; i++) uq[i] = Math.max(0, Math.min(65535, Math.round(((uv[i] - UV_LO) / UV_SPAN) * 65535)));
const nq = new Int8Array(n * 3); for (let i = 0; i < n * 3; i++) nq[i] = Math.max(-127, Math.min(127, Math.round(nor[i] * 127)));

// 5. Materials: textured ones point at a converted texture, the rest keep their flat colour.
const { json } = glb; const texOut = new Map(); const dir = mkdtempSync(join(tmpdir(), 'scan-'));
const mats = groups.map(g => {
  const m = json.materials[g.mat] || {}; const pbr = m.pbrMetallicRoughness || {};
  if (pbr.baseColorTexture) {
    const img = json.textures[pbr.baseColorTexture.index].source;
    if (!texOut.has(img)) texOut.set(img, texOut.size);
    return { tex: texOut.get(img) };
  }
  return { color: (pbr.baseColorFactor || [0.8, 0.8, 0.8]).slice(0, 3) };
});
for (const [img, i] of texOut) {
  const im = json.images[img], bv = json.bufferViews[im.bufferView];
  const raw = join(dir, `t${i}`); writeFileSync(raw, glb.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength));
  for (const [tag, px] of [['2k', 2048], ['4k', 4096]]) {
    const out = `public/play/models/${name}_${i}_${tag}.webp`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', `scale='min(${px},iw)':'min(${px},ih)':force_original_aspect_ratio=decrease`, '-quality', '82', out]);
  }
}
const hdr = Buffer.from(JSON.stringify({ n, lo, sc, uv: [UV_LO, UV_SPAN], groups: groups.map((g, i) => ({ start: g.start, count: g.count, mat: i })), mats }));
const pad = Buffer.alloc((4 - ((4 + hdr.length) % 4)) % 4);
const len = Buffer.alloc(4); len.writeUInt32LE(hdr.length);
const bin = Buffer.concat([len, hdr, pad, Buffer.from(pq.buffer), Buffer.from(uq.buffer), Buffer.from(nq.buffer)]);
writeFileSync(`public/play/models/${name}.bin.gz`, gzipSync(bin, { level: 9 }));
console.log(`triangles ${nIn} -> ${keep.length}, textures ${texOut.size}, bin ${(bin.length / 1048576).toFixed(1)} MB, bounds`, lo.map(v => v.toFixed(1)), hi.map(v => v.toFixed(1)));
