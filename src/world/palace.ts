import * as THREE from 'three';
import { scene } from '../render/stage';
import { loadScan } from './scan';
import { emit } from '../render/particles';
import { C, rnd } from '../core/util';
import { heightGrid } from './heightgrid';
import type { ArenaEnv } from './arena';

/** Everything of this arena lives under one group so arenas can be switched by visibility. */
export const palaceRoot = new THREE.Group();

/**
 * Daylight: a warm high sun (the shadow caster), a bright sky dome as ambient, light haze.
 * The open courtyard is much wider than the other arenas, so the duel area and camera range grow with it.
 */
export const PALACE_ENV: ArenaEnv = {
  moon: [7, 15, 6], moonColor: 0xfff0d8, moonI: 3.2, rim: [-3, 6, -9], rimI: 0.35,
  fog: 0xc9dbee, fogD: 0.011, bg: 0xa9c8ea,
  hemi: [0xcfe2ff, 0x8a7560, 1.8], exposure: 1.6, sky: ['#5b8fd6', '#cfe1f5'],
  bounds: { bx: 6, zMin: -3.4, zMax: 3.4 }, camLim: 9, shadow: 10,
  grade: { lift: [0.015, 0.008, 0], gain: [1.04, 1.0, 0.92], sat: 1.06 },
};

/** The episcopal palace courtyard of Girona (photogrammetry by Giravolt, CC BY 4.0): tools/decim-scan.mjs → girona.bin.gz. */
export async function loadPalace() {
  const mesh = await loadScan('girona');
  palaceRoot.add(mesh);
  sample = heightGrid(mesh, GRID, 1.2, -0.15, 0.25, 0);
  scene.add(palaceRoot);
}

const GRID = { x0: -8, z0: -4.5, step: 0.25, nx: 65, nz: 37 };
let sample: ((x: number, z: number) => number) | null = null;

/** Floor height of the palace courtyard at (x, z). */
export function palaceFloorAt(x: number, z: number) { return sample ? sample(x, z) : 0; }

/** Dust drifting through the sunlight. Uses real (unscaled) time. */
export function updatePalaceAmbience() {
  if (Math.random() < 0.35) emit(rnd(8), 0.4 + Math.random() * 3, rnd(4), rnd(0.05), 0.04, rnd(0.05), C(1.3, 1.2, 0.95), 0.03, 6, { t: 'glow', a: 0.35, drag: 0.5 });
}
