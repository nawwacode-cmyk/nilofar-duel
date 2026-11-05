import * as THREE from 'three';
import { loopFlame, flipFlames } from '../fx/flipbook';
import { scene } from '../render/stage';
import { loadScan } from './scan';
import { emit } from '../render/particles';
import { FIRE } from '../data/palettes';
import { C, rnd, pick } from '../core/util';
import type { ArenaEnv } from './arena';
import { heightGrid } from './heightgrid';

/** Everything of this arena lives under one group so arenas can be switched by visibility. */
export const courtRoot = new THREE.Group();
/** Wider duel area between the two arcades; the well in the middle is an obstacle. */
export const COURT_ENV: ArenaEnv = {
  moon: [-4, 12, 3], moonColor: 0x9db4ff, moonI: 1.15, rim: [1.5, 4, -8], rimI: 0.9, fog: 0x0b1430, fogD: 0.028, bg: 0x070b18,
  bounds: { bx: 6.2, zMin: -6, zMax: 3.6 }, camLim: 6.8, shadow: 9, obstacles: [[0, -0.25, 1.55]],
  grade: { lift: [0, 0.012, 0.03], gain: [1.06, 1.0, 0.94], sat: 1.08 },
};

/**
 * The scanned stone courtyard (Reials Col·legis, Tortosa — Giravolt, CC BY 4.0), exactly as scanned, the well in the
 * middle included: tools/decim-scan.mjs (assets-src/arenas/court.json) → court2.bin.gz. Fighters walk around the well.
 */
export async function loadCourt() {
  const m = await loadScan('court2', 0x7d8bb4);
  courtRoot.add(m);
  buildHeightGrid(m);
  makeTorches();
  scene.add(courtRoot);
}

/** Floor heights over the duel area (the centre well opening is covered by the floor patch at y ≈ 0.02). */
const GRID = { x0: -7, z0: -6.5, step: 0.25, nx: 57, nz: 45 };
let sample: ((x: number, z: number) => number) | null = null;
function buildHeightGrid(court: THREE.Mesh) { sample = heightGrid(court, GRID, 1.2, -0.12, 0.18, 0.02); }

/** Floor height of the stone courtyard at (x, z). */
export function courtFloorAt(x: number, z: number) { return sample ? sample(x, z) : 0; }

const torches: { g: THREE.Group; L: THREE.PointLight; s: number }[] = [];

function makeTorches() {
  for (const [x, z] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 4.6], [5.3, 4.6]]) {
    const g = new THREE.Group(); g.position.set(x, 2.5, z);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.05, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x2a1d14, metalness: 0.6, roughness: 0.4 }));
    cup.position.y = -0.12; g.add(cup);
    const L = new THREE.PointLight(0xff8a3d, 6, 11, 1.6); L.position.y = 0.2; g.add(L);
    courtRoot.add(g); torches.push({ g, L, s: Math.random() * 10 });
    loopFlame(courtRoot, x, 2.43, z, 0.55);
  }
}

/** Torch flicker, flame/smoke sprites and floating embers. Uses real (unscaled) time. */
export function updateCourtAmbience(rdt: number) {
  for (const t of torches) {
    t.s += rdt * 9;
    const f = 1 + Math.sin(t.s) * 0.08 + Math.sin(t.s * 2.7) * 0.06 + rnd(0.03);
    t.L.intensity = 6 * f; const p = t.g.position;
    if (!flipFlames() && Math.random() < 0.8) emit(p.x + rnd(0.05), p.y, p.z + rnd(0.05), rnd(0.08), 0.7 + Math.random() * 0.4, rnd(0.08), pick(FIRE), 0.22 + Math.random() * 0.12, 0.45, { t: 'flame', drag: 1, spin: rnd(1) });
    else if (Math.random() < 0.25) emit(p.x + rnd(0.05), p.y + 0.3, p.z + rnd(0.05), rnd(0.2), 0.8 + Math.random(), rnd(0.2), C(1.6, 0.6, 0.15), 0.035, 1.2, { t: 'spark', drag: 0.6 });
    if (Math.random() < 0.15) emit(p.x, p.y + 0.4, p.z, rnd(0.1), 0.5, rnd(0.1), C(0.08, 0.08, 0.1), 0.35, 2, { t: 'smoke', smoke: 1, grow: 0.4, a: 0.35 });
  }
  if (Math.random() < 0.5) emit(rnd(5), 0.05, rnd(5), rnd(0.1), 0.25 + Math.random() * 0.3, rnd(0.1), C(1.4, 0.55, 0.15), 0.06, 5, { t: 'spark' });
}
