/**
 * Navigation grid of a Hunters stage (written by tools/slim-map.mjs): floor height and a "blocked" flag per cell.
 * Format: [u32 header length][JSON {x0, z0, step, nx, nz}][pad to 4][f32 heights nx*nz][u8 blocked nx*nz].
 */
export interface Nav { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array; b: Uint8Array }

export function parseNav(bytes: Uint8Array): Nav {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hl = dv.getUint32(0, true);
  const hdr = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + hl))) as Omit<Nav, 'h' | 'b'>;
  const o = (4 + hl + 3) & ~3, n = hdr.nx * hdr.nz;
  // Copy out so the float view is aligned whatever the source buffer's offset.
  const h = new Float32Array(bytes.slice(o, o + n * 4).buffer);
  const b = bytes.slice(o + n * 4, o + n * 5);
  return { ...hdr, h, b };
}

const cell = (n: Nav, x: number, z: number) => [(x - n.x0) / n.step, (z - n.z0) / n.step] as const;

/** Floor height (bilinear between cell centres; clamped at the grid's edge). */
export function navHeight(n: Nav, x: number, z: number) {
  let [fx, fz] = cell(n, x, z);
  fx = Math.min(n.nx - 1.001, Math.max(0, fx)); fz = Math.min(n.nz - 1.001, Math.max(0, fz));
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * n.nx + i;
  const a = n.h[k], b = n.h[k + 1], c = n.h[k + n.nx], d = n.h[k + n.nx + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** True where nobody can stand: solids, steep slopes, holes, and everything outside the grid. */
export function navBlocked(n: Nav, x: number, z: number) {
  const [fx, fz] = cell(n, x, z), i = Math.round(fx), j = Math.round(fz);
  if (i < 0 || j < 0 || i >= n.nx || j >= n.nz) return true;
  return n.b[j * n.nx + i] === 1;
}

/** Free around a body of radius r (centre plus four points on its rim). */
function free(n: Nav, x: number, z: number, r: number) {
  return !navBlocked(n, x, z) && !navBlocked(n, x + r, z) && !navBlocked(n, x - r, z) && !navBlocked(n, x, z + r) && !navBlocked(n, x, z - r);
}

/** Moves a body by (dx, dz), sliding along walls (one axis at a time when the full step is blocked). */
export function navMove(n: Nav, x: number, z: number, dx: number, dz: number, r = 0.3): [number, number] {
  if (free(n, x + dx, z + dz, r)) return [x + dx, z + dz];
  if (dx && free(n, x + dx, z, r)) return [x + dx, z];
  if (dz && free(n, x, z + dz, r)) return [x, z + dz];
  return [x, z];
}

/** Nearest free point to (x, z) (spiral search), for spawns that landed on a tree. */
export function navNearestFree(n: Nav, x: number, z: number, r = 0.4): [number, number] {
  if (free(n, x, z, r)) return [x, z];
  for (let d = n.step; d < 12; d += n.step) for (let a = 0; a < 16; a++) {
    const px = x + Math.cos((a / 16) * Math.PI * 2) * d, pz = z + Math.sin((a / 16) * Math.PI * 2) * d;
    if (free(n, px, pz, r)) return [px, pz];
  }
  return [x, z];
}

/** Straight-line walkability between two points (sampled every half cell), used for line of sight and chasing. */
export function navClear(n: Nav, ax: number, az: number, bx: number, bz: number) {
  const L = Math.hypot(bx - ax, bz - az), s = Math.max(1, Math.ceil(L / (n.step * 0.5)));
  for (let k = 1; k < s; k++) if (navBlocked(n, ax + ((bx - ax) * k) / s, az + ((bz - az) * k) / s)) return false;
  return true;
}

/** Blocks every cell farther than `width` metres from the given polylines (a stage's route). */
export function navCorridor(n: Nav, paths: [number, number][][], width: number) {
  const segs: number[][] = [];
  for (const p of paths) for (let k = 1; k < p.length; k++) segs.push([...p[k - 1], ...p[k]]);
  const w2 = width * width;
  for (let j = 0; j < n.nz; j++) for (let i = 0; i < n.nx; i++) {
    const x = n.x0 + i * n.step, z = n.z0 + j * n.step;
    let best = Infinity;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; if (best <= w2) break; }
    }
    if (best > w2) n.b[j * n.nx + i] = 1;
  }
}

/**
 * Keeps walking on the stage's detailed ground only: cells farther than `pad` metres from any surface of the given
 * materials (road, leaves, gravel…) are blocked. Large maps surround their playable part with low-detail hills
 * (aerial-photo terrain behind a wall of tree cards) that look fine from afar but must not be walked on.
 */
export function navWalkOn(n: Nav, meshes: { pos: ArrayLike<number>; idx: ArrayLike<number> | null }[], pad: number) {
  const near = new Uint8Array(n.nx * n.nz);
  const mark = (x: number, z: number) => {
    const i = Math.round((x - n.x0) / n.step), j = Math.round((z - n.z0) / n.step);
    if (i >= 0 && j >= 0 && i < n.nx && j < n.nz) near[j * n.nx + i] = 1;
  };
  // Mark the cells under every triangle (sampled at the cell spacing).
  for (const { pos, idx } of meshes) {
    const count = idx ? idx.length : pos.length / 3;
    for (let t = 0; t < count; t += 3) {
      const a = (idx ? idx[t] : t) * 3, b = (idx ? idx[t + 1] : t + 1) * 3, c = (idx ? idx[t + 2] : t + 2) * 3;
      const L = Math.max(Math.hypot(pos[b] - pos[a], pos[b + 2] - pos[a + 2]), Math.hypot(pos[c] - pos[a], pos[c + 2] - pos[a + 2]), Math.hypot(pos[c] - pos[b], pos[c + 2] - pos[b + 2]));
      const s = Math.max(1, Math.ceil(L / n.step));
      for (let u = 0; u <= s; u++) for (let v = 0; v <= s - u; v++) {
        const wa = 1 - (u + v) / s, wb = u / s, wc = v / s;
        mark(pos[a] * wa + pos[b] * wb + pos[c] * wc, pos[a + 2] * wa + pos[b + 2] * wb + pos[c + 2] * wc);
      }
    }
  }
  // Grow by the padding, then block whatever is left out.
  const r = Math.round(pad / n.step), r2 = r * r, ok = new Uint8Array(near.length);
  for (let j = 0; j < n.nz; j++) for (let i = 0; i < n.nx; i++) {
    if (!near[j * n.nx + i]) continue;
    for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
      const I = i + a, J = j + b;
      if (a * a + b * b <= r2 && I >= 0 && J >= 0 && I < n.nx && J < n.nz) ok[J * n.nx + I] = 1;
    }
  }
  for (let k = 0; k < ok.length; k++) if (!ok[k]) n.b[k] = 1;
}
