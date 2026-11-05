import * as THREE from 'three';
import { renderer, scene } from '../render/stage';
import { emit } from '../render/particles';
import { getBytes } from '../assets/loader';
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
};

/**
 * The episcopal palace courtyard of Girona (photogrammetry by Giravolt, CC BY 4.0), shrunk by
 * tools/decim-scan.mjs into palace .bin + webp atlases: [u32 header length][JSON header][pad][u16 pos][u16 uv][i8 normal].
 * Header groups map triangle ranges to materials (a texture atlas or a flat colour).
 */
export async function loadPalace() {
  const bin = await getBytes('models/girona.bin.gz');
  const dv = new DataView(bin.buffer, bin.byteOffset); const hl = dv.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(bin.subarray(4, 4 + hl))) as {
    n: number; lo: number[]; sc: number[]; uv: [number, number]; groups: { start: number; count: number; mat: number }[]; mats: { tex?: number; color?: number[] }[];
  };
  let o = 4 + hl; o += (4 - (o % 4)) % 4; const n = h.n;
  const q = new Uint16Array(bin.buffer, bin.byteOffset + o, n * 3); o += n * 6;
  const uq = new Uint16Array(bin.buffer, bin.byteOffset + o, n * 2); o += n * 4;
  const nq = new Int8Array(bin.buffer, bin.byteOffset + o, n * 3);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = h.lo[k] + q[i * 3 + k] * h.sc[k]; nor[i * 3 + k] = nq[i * 3 + k] / 127; }
    uv[i * 2] = h.uv[0] + (uq[i * 2] / 65535) * h.uv[1]; uv[i * 2 + 1] = h.uv[0] + (uq[i * 2 + 1] / 65535) * h.uv[1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  h.groups.forEach(gr => g.addGroup(gr.start, gr.count, gr.mat));

  // Phones get 2k atlases; large screens with big textures get 4k.
  const big = renderer.capabilities.maxTextureSize >= 8192 && !matchMedia('(pointer: coarse)').matches;
  const texIds = [...new Set(h.mats.filter(m => m.tex !== undefined).map(m => m.tex!))];
  const loader = new THREE.TextureLoader();
  const tex = new Map(await Promise.all(texIds.map(async i => {
    const t = await loader.loadAsync(`models/girona_${i}_${big ? '4k' : '2k'}.webp`);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return [i, t] as const;
  })));
  // The scan's photos already hold the real sunlight, so the lights only add a soft extra shading on top.
  const mats = h.mats.map(m => m.tex !== undefined
    ? new THREE.MeshLambertMaterial({ map: tex.get(m.tex), side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color: new THREE.Color(...(m.color as [number, number, number])), side: THREE.DoubleSide }));
  const mesh = new THREE.Mesh(g, mats);
  mesh.frustumCulled = false; mesh.receiveShadow = true; palaceRoot.add(mesh);
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
