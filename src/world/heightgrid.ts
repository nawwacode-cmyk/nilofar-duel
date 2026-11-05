import type * as THREE from 'three';

/**
 * Floor heights of a scanned arena, sampled once on a regular grid over the duel area and read back bilinearly
 * (scanned floors are not flat, ±15 cm). The grid is filled in one pass over the triangles: each triangle only
 * visits the grid points under it. Same result as a ray cast down from `top`: the highest surface at or below it.
 * (~1500 ray casts against a 200k-triangle scan used to block the page for half a minute on phones.)
 */
export interface Grid { x0: number; z0: number; step: number; nx: number; nz: number }

export function heightGrid(mesh: THREE.Mesh, g: Grid, top: number, clampLo: number, clampHi: number, missing: number) {
  const p = mesh.geometry.attributes.position.array as Float32Array;
  const idx = mesh.geometry.index?.array;
  const tris = idx ? idx.length / 3 : p.length / 9;
  const best = new Float32Array(g.nx * g.nz).fill(-Infinity);
  const { x0, z0, step, nx, nz } = g;
  for (let t = 0; t < tris; t++) {
    const a = (idx ? idx[t * 3] : t * 3) * 3, b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3, c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
    const ax = p[a], az = p[a + 2], bx = p[b], bz = p[b + 2], cx = p[c], cz = p[c + 2];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) / step)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / step));
    if (i0 > i1) continue;
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / step)), j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / step));
    if (j0 > j1) continue;
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue; // vertical triangle: a vertical ray never hits it
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const y = l1 * p[a + 1] + l2 * p[b + 1] + l3 * p[c + 1];
      const k = j * nx + i;
      if (y <= top && y > best[k]) best[k] = y;
    }
  }
  // Missing hits (holes) and outliers are clamped to a sane range around the floor.
  const heights = new Float32Array(nx * nz);
  for (let k = 0; k < best.length; k++) heights[k] = Number.isFinite(best[k]) ? Math.max(clampLo, Math.min(clampHi, best[k])) : missing;
  return (x: number, z: number) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / step)), fz = Math.max(0, Math.min(nz - 1.001, (z - z0) / step));
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
    const a = heights[j * nx + i], b = heights[j * nx + i + 1], c = heights[(j + 1) * nx + i], d = heights[(j + 1) * nx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}
