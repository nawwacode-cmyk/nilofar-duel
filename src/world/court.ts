import * as THREE from 'three';
import { renderer, scene } from '../render/stage';
import { emit } from '../render/particles';
import { getBytes } from '../assets/loader';
import { FIRE } from '../data/palettes';
import { C, rnd, pick } from '../core/util';
import type { ArenaEnv } from './arena';

/** Everything of this arena lives under one group so arenas can be switched by visibility. */
export const courtRoot = new THREE.Group();
export const COURT_ENV: ArenaEnv = { moon: [-4, 12, 3], moonColor: 0x9db4ff, moonI: 1.15, rim: [1.5, 4, -8], rimI: 0.9, fog: 0x0b1430, fogD: 0.028, bg: 0x070b18 };

/**
 * Loads the photogrammetry courtyard from court.bin:
 * [u32 header length][JSON header][pad to 4][u16 positions][u16 uvs][i8 normals].
 */
export async function loadCourt() {
  const bin = await getBytes('models/court.bin.gz');
  const dv = new DataView(bin.buffer); const hl = dv.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(bin.subarray(4, 4 + hl))) as { n: number; lo: number[]; sc: number[] };
  let o = 4 + hl; o += (4 - (o % 4)) % 4; const n = h.n;
  const q = new Uint16Array(bin.buffer, o, n * 3); o += n * 6;
  const uq = new Uint16Array(bin.buffer, o, n * 2); o += n * 4;
  const nq = new Int8Array(bin.buffer, o, n * 3);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
  const off = [-1.0, -0.351, 1.0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = h.lo[k] + q[i * 3 + k] * h.sc[k] + off[k]; nor[i * 3 + k] = nq[i * 3 + k] / 127; }
    uv[i * 2] = uq[i * 2] / 65535; uv[i * 2 + 1] = uq[i * 2 + 1] / 65535;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const tex = await new THREE.TextureLoader().loadAsync(renderer.capabilities.maxTextureSize >= 8192 && !matchMedia('(pointer: coarse)').matches ? 'models/court4k.webp' : 'models/court2k.webp');
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0x7d8bb4, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false; m.receiveShadow = true; courtRoot.add(m);
  patchFloorHole(m, mat);
  buildHeightGrid(m);
  makeTorches();
  scene.add(courtRoot);
}

/**
 * The photogrammetry scan has a hole in the floor at the arena centre (a well opening in the real courtyard).
 * Cover it with a disc that re-uses the court texture from a nearby patch of floor, with a soft feathered edge.
 * UVs are found by ray-casting the scan, so the patch matches the stone's scale and orientation.
 */
function patchFloorHole(court: THREE.Mesh, courtMat: THREE.MeshLambertMaterial) {
  const HOLE = { x: 0.25, z: 0 }, R = 1.4, SRC = { x: 2.6, z: 0 };
  const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
  const uvAt = (x: number, z: number) => { rc.set(new THREE.Vector3(x, 4, z), down); return rc.intersectObject(court, false)[0]?.uv ?? null; };
  const u0 = uvAt(SRC.x, SRC.z), ux = uvAt(SRC.x + 0.5, SRC.z), uz = uvAt(SRC.x, SRC.z + 0.5);
  if (!u0 || !ux || !uz) return;
  // UV change per metre along world x and z (local Jacobian of the scan's texture mapping).
  const dx = ux.clone().sub(u0).multiplyScalar(2), dz = uz.clone().sub(u0).multiplyScalar(2);
  const disc = new THREE.CircleGeometry(R, 48);
  disc.rotateX(-Math.PI / 2);
  const pos = disc.attributes.position, uv = disc.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    uv.setXY(i, u0.x + dx.x * lx + dz.x * lz, u0.y + dx.y * lx + dz.y * lz);
  }
  // Radial alpha: solid to 75 % of the radius, then feathered.
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!; const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.75, '#fff'); gr.addColorStop(1, '#000');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const alpha = new THREE.CanvasTexture(c);
  // alphaMap uses the mesh UVs, so draw it through a separate UV set (maskUv) covering the disc 0..1.
  const uv2 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv2[i * 2] = pos.getX(i) / (2 * R) + 0.5; uv2[i * 2 + 1] = pos.getZ(i) / (2 * R) + 0.5; }
  disc.setAttribute('maskUv', new THREE.BufferAttribute(uv2, 2));
  const mat = new THREE.MeshLambertMaterial({ map: courtMat.map, color: courtMat.color, alphaMap: alpha, transparent: true, depthWrite: false });
  mat.onBeforeCompile = sh => {
    // Sample the alpha mask with maskUv instead of the texture-atlas UVs.
    sh.vertexShader = sh.vertexShader.replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\nattribute vec2 maskUv;\nvarying vec2 vMaskUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMaskUv = maskUv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <uv_pars_fragment>', '#include <uv_pars_fragment>\nvarying vec2 vMaskUv;')
      .replace('#include <alphamap_fragment>', 'diffuseColor.a *= texture2D( alphaMap, vMaskUv ).g;');
  };
  const patch = new THREE.Mesh(disc, mat); patch.receiveShadow = true;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  patch.position.set(HOLE.x, 0.02, HOLE.z); patch.renderOrder = 1;
  courtRoot.add(patch);
}

/**
 * The scanned floor is not flat (±15 cm). Its height is sampled once on a 25 cm grid over the duel area
 * and read back bilinearly. The centre well opening is covered by the floor patch at y ≈ 0.02.
 *
 * The grid is filled in one pass over the triangles (each triangle only visits the grid points under it):
 * ~1500 ray casts against the 200k-triangle scan used to block the page for half a minute (minutes on phones).
 * Same result as a ray cast down from y = 1.2: the highest surface at or below that height.
 */
const GRID = { x0: -5.5, z0: -5, step: 0.25, nx: 45, nz: 33 };
const TOP = 1.2;
let heights: Float32Array | null = null;

function buildHeightGrid(court: THREE.Mesh) {
  const p = court.geometry.attributes.position.array as Float32Array;
  const idx = court.geometry.index?.array;
  const tris = idx ? idx.length / 3 : p.length / 9;
  const best = new Float32Array(GRID.nx * GRID.nz).fill(-Infinity);
  const { x0, z0, step, nx, nz } = GRID;
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
      if (y <= TOP && y > best[k]) best[k] = y;
    }
  }
  heights = new Float32Array(nx * nz);
  // Missing hits (the well) and outliers are clamped to a sane range around the floor.
  for (let k = 0; k < best.length; k++) heights[k] = Number.isFinite(best[k]) ? Math.max(-0.12, Math.min(0.18, best[k])) : 0.02;
}

/** Floor height of the stone courtyard at (x, z). */
export function courtFloorAt(x: number, z: number) {
  if (!heights) return 0;
  const fx = Math.max(0, Math.min(GRID.nx - 1.001, (x - GRID.x0) / GRID.step)), fz = Math.max(0, Math.min(GRID.nz - 1.001, (z - GRID.z0) / GRID.step));
  const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, n = GRID.nx;
  const a = heights[j * n + i], b = heights[j * n + i + 1], c = heights[(j + 1) * n + i], d = heights[(j + 1) * n + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const torches: { g: THREE.Group; L: THREE.PointLight; s: number }[] = [];

function makeTorches() {
  for (const [x, z] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 4.6], [5.3, 4.6]]) {
    const g = new THREE.Group(); g.position.set(x, 2.5, z);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.05, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x2a1d14, metalness: 0.6, roughness: 0.4 }));
    cup.position.y = -0.12; g.add(cup);
    const L = new THREE.PointLight(0xff8a3d, 6, 11, 1.6); L.position.y = 0.2; g.add(L);
    courtRoot.add(g); torches.push({ g, L, s: Math.random() * 10 });
  }
}

/** Torch flicker, flame/smoke sprites and floating embers. Uses real (unscaled) time. */
export function updateCourtAmbience(rdt: number) {
  for (const t of torches) {
    t.s += rdt * 9;
    const f = 1 + Math.sin(t.s) * 0.08 + Math.sin(t.s * 2.7) * 0.06 + rnd(0.03);
    t.L.intensity = 6 * f; const p = t.g.position;
    if (Math.random() < 0.8) emit(p.x + rnd(0.05), p.y, p.z + rnd(0.05), rnd(0.08), 0.7 + Math.random() * 0.4, rnd(0.08), pick(FIRE), 0.22 + Math.random() * 0.12, 0.45, { t: 'flame', drag: 1, spin: rnd(1) });
    if (Math.random() < 0.15) emit(p.x, p.y + 0.4, p.z, rnd(0.1), 0.5, rnd(0.1), C(0.08, 0.08, 0.1), 0.35, 2, { t: 'smoke', smoke: 1, grow: 0.4, a: 0.35 });
  }
  if (Math.random() < 0.5) emit(rnd(5), 0.05, rnd(5), rnd(0.1), 0.25 + Math.random() * 0.3, rnd(0.1), C(1.4, 0.55, 0.15), 0.06, 5, { t: 'spark' });
}
