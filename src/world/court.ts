import * as THREE from 'three';
import { renderer, scene } from '../render/stage';
import { emit } from '../render/particles';
import { getBytes } from '../assets/loader';
import { FIRE } from '../data/palettes';
import { C, rnd, pick } from '../core/util';

/**
 * Loads the photogrammetry courtyard from court.bin:
 * [u32 header length][JSON header][pad to 4][u16 positions][u16 uvs][i8 normals].
 */
export async function loadCourt() {
  const bin = await getBytes('models/court.bin');
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
  const tex = await new THREE.TextureLoader().loadAsync(renderer.capabilities.maxTextureSize >= 8192 ? 'models/court4k.jpg' : 'models/court2k.jpg');
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, color: 0x7d8bb4, side: THREE.DoubleSide }));
  m.frustumCulled = false; scene.add(m);
}

const torches: { g: THREE.Group; L: THREE.PointLight; s: number }[] = [];

export function makeTorches() {
  for (const [x, z] of [[-5.3, -5.3], [5.3, -5.3], [-5.3, 4.6], [5.3, 4.6]]) {
    const g = new THREE.Group(); g.position.set(x, 2.5, z);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.05, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x2a1d14, metalness: 0.6, roughness: 0.4 }));
    cup.position.y = -0.12; g.add(cup);
    const L = new THREE.PointLight(0xff8a3d, 6, 11, 1.6); L.position.y = 0.2; g.add(L);
    scene.add(g); torches.push({ g, L, s: Math.random() * 10 });
  }
}

/** Torch flicker, flame/smoke sprites and floating embers. Uses real (unscaled) time. */
export function updateAmbience(rdt: number) {
  for (const t of torches) {
    t.s += rdt * 9;
    const f = 1 + Math.sin(t.s) * 0.08 + Math.sin(t.s * 2.7) * 0.06 + rnd(0.03);
    t.L.intensity = 6 * f; const p = t.g.position;
    if (Math.random() < 0.8) emit(p.x + rnd(0.05), p.y, p.z + rnd(0.05), rnd(0.08), 0.7 + Math.random() * 0.4, rnd(0.08), pick(FIRE), 0.22 + Math.random() * 0.12, 0.45, { t: 'flame', drag: 1, spin: rnd(1) });
    if (Math.random() < 0.15) emit(p.x, p.y + 0.4, p.z, rnd(0.1), 0.5, rnd(0.1), C(0.08, 0.08, 0.1), 0.35, 2, { t: 'smoke', smoke: 1, grow: 0.4, a: 0.35 });
  }
  if (Math.random() < 0.5) emit(rnd(5), 0.05, rnd(5), rnd(0.1), 0.25 + Math.random() * 0.3, rnd(0.1), C(1.4, 0.55, 0.15), 0.06, 5, { t: 'spark' });
}
