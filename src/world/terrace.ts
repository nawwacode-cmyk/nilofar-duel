import * as THREE from 'three';
import { renderer, scene } from '../render/stage';
import { emit } from '../render/particles';
import { FIRE } from '../data/palettes';
import { C, rnd, pick } from '../core/util';
import type { ArenaEnv } from './arena';

export const terraceRoot = new THREE.Group();
/** Moonlight from the painted moon's side (upper left, behind); warm braziers answer from the front. */
export const TERRACE_ENV: ArenaEnv = { moon: [-9, 12, -12], moonColor: 0xb8c6ff, moonI: 1.35, rim: [4, 5, -9], rimI: 0.7, fog: 0x0d1630, fogD: 0.022, bg: 0x0a0f22 };

/**
 * The moonlit castle terrace (second arena, next to the scanned stone courtyard).
 * Foreground is real 3D: wet flagstone floor, stone balustrade and fire braziers (Poly Haven CC0 textures).
 * Beyond the balustrade the castle, moon and sky are the project owner's painting on a distant plane.
 * The camera never rotates, so a far backdrop reads as real depth while costing almost nothing.
 */
const DIR = 'models/terrace/';
const loader = new THREE.TextureLoader();
const aniso = () => Math.min(8, renderer.capabilities.getMaxAnisotropy());

async function pbr(name: string, repeat: [number, number]) {
  const [map, normalMap, roughnessMap] = await Promise.all(['diff', 'nor', 'rough'].map(k => loader.loadAsync(`${DIR}${name}_${k}.jpg`)));
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = aniso(); }
  return { map, normalMap, roughnessMap };
}

/** Balustrade line (z) and the edge of the terrace floor. */
const RAIL_Z = -5.4, FLOOR = { w: 26, d: 17, z: -1.6 };

export async function loadTerrace() {
  const [floorTex, stoneTex, backTex] = await Promise.all([
    pbr('cobblestone_pavement', [FLOOR.w / 2.4, FLOOR.d / 2.4]),
    pbr('castle_wall_slates', [1, 1]),
    loader.loadAsync(DIR + 'backdrop.jpg'),
  ]);

  // Wet flagstones: low roughness so braziers and spells leave bright streaks, cool moonlit tint.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR.w, FLOOR.d), new THREE.MeshStandardMaterial({ ...floorTex, color: 0x8b97b8, roughness: 0.42, metalness: 0.05, normalScale: new THREE.Vector2(1.2, 1.2) }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = FLOOR.z; floor.receiveShadow = true;
  terraceRoot.add(floor);

  buildBalustrade(stoneTex);
  buildBraziers(stoneTex);

  // Painted castle + moon + sky, far behind the balustrade (unlit, no fog: it already has its own atmosphere).
  backTex.colorSpace = THREE.SRGBColorSpace; backTex.anisotropy = aniso();
  const W = 58, H = W * (632 / 1672);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: backTex, fog: false, color: 0xd8dcff }));
  back.position.set(0, -10.5 + H / 2, -24); back.renderOrder = -1;
  terraceRoot.add(back);
  scene.add(terraceRoot);
}

/** Lathe profile of a classical baluster (metres). */
const BALUSTER = [[0, 0], [0.09, 0], [0.09, 0.06], [0.06, 0.1], [0.05, 0.16], [0.085, 0.32], [0.09, 0.4], [0.06, 0.5], [0.04, 0.58], [0.05, 0.64], [0.075, 0.68], [0.075, 0.72], [0, 0.72]].map(([x, y]) => new THREE.Vector2(x, y));

function buildBalustrade(tex: Awaited<ReturnType<typeof pbr>>) {
  const mat = new THREE.MeshStandardMaterial({ ...tex, color: 0x7d86a3, roughness: 0.85 });
  const span = 22, posts = 7;
  const g = new THREE.Group(); g.position.z = RAIL_Z;
  const box = (w: number, h: number, d: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, 0); m.castShadow = m.receiveShadow = true; g.add(m); return m;
  };
  box(span, 0.12, 0.42, 0, 0.06);           // plinth
  box(span, 0.1, 0.34, 0, 0.84);            // handrail
  const balGeo = new THREE.LatheGeometry(BALUSTER, 10);
  const count = Math.round(span / 0.26);
  const inst = new THREE.InstancedMesh(balGeo, mat, count);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < count; i++) { m4.makeTranslation(-span / 2 + 0.13 + i * (span / count), 0.12, 0); inst.setMatrixAt(i, m4); }
  inst.castShadow = true; g.add(inst);
  for (let i = 0; i < posts; i++) box(0.42, 1.0, 0.46, -span / 2 + (i * span) / (posts - 1), 0.5); // square posts
  terraceRoot.add(g);
}

/* ---------- braziers: stone pedestal + bowl + living fire ---------- */
const fires: { x: number; y: number; z: number; L: THREE.PointLight; s: number; big: boolean }[] = [];

function buildBraziers(tex: Awaited<ReturnType<typeof pbr>>) {
  const stone = new THREE.MeshStandardMaterial({ ...tex, color: 0x7d86a3, roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2420, metalness: 0.7, roughness: 0.45 });
  const bowl = new THREE.LatheGeometry([[0, 0], [0.05, 0], [0.08, 0.04], [0.3, 0.16], [0.36, 0.24], [0.34, 0.26], [0, 0.18]].map(([x, y]) => new THREE.Vector2(x, y)), 18);
  // Two on the balustrade posts, two large ones flanking the arena (like the painting).
  const spots: [number, number, number, boolean][] = [[-3.67, RAIL_Z, 1.0, false], [3.67, RAIL_Z, 1.0, false], [-6.9, -3.4, 1.15, true], [6.9, -3.4, 1.15, true]];
  for (const [x, z, h, big] of spots) {
    const k = big ? 1.5 : 1;
    if (big) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, h, 0.7), stone); p.position.set(x, h / 2, z); p.castShadow = p.receiveShadow = true; terraceRoot.add(p); }
    const b = new THREE.Mesh(bowl, iron); b.scale.setScalar(k * 0.9); b.position.set(x, h, z); terraceRoot.add(b);
    const L = new THREE.PointLight(0xff8a3d, big ? 9 : 6, big ? 11 : 8, 1.6); L.position.set(x, h + 0.5, z); terraceRoot.add(L);
    fires.push({ x, y: h + 0.22 * k, z, L, s: Math.random() * 10, big });
  }
}

const MIST = C(0.32, 0.38, 0.6);

/** Fire flicker, flame/smoke sprites, valley mist beyond the balustrade, floating embers (real time). */
export function updateTerraceAmbience(rdt: number) {
  for (const f of fires) {
    f.s += rdt * 9;
    const fl = 1 + Math.sin(f.s) * 0.08 + Math.sin(f.s * 2.7) * 0.06 + rnd(0.03);
    f.L.intensity = (f.big ? 9 : 6) * fl;
    const n = f.big ? 2 : 1;
    for (let i = 0; i < n; i++) if (Math.random() < 0.85) emit(f.x + rnd(0.12), f.y, f.z + rnd(0.12), rnd(0.1), 0.8 + Math.random() * 0.5, rnd(0.1), pick(FIRE), (f.big ? 0.36 : 0.26) + Math.random() * 0.14, 0.5, { t: 'flame', drag: 1, spin: rnd(1) });
    if (Math.random() < 0.15) emit(f.x, f.y + 0.6, f.z, rnd(0.1), 0.5, rnd(0.1), C(0.08, 0.08, 0.1), 0.4, 2, { t: 'smoke', smoke: 1, grow: 0.4, a: 0.3 });
  }
  // Mist rolling up from the valley behind the balustrade.
  if (Math.random() < 0.35) emit(rnd(11), -0.2, RAIL_Z - 1.5 - Math.random() * 4, rnd(0.15), 0.12, rnd(0.05), MIST, 2.2 + Math.random() * 1.5, 7, { t: 'smoke', smoke: 1, grow: 0.35, a: 0.22, spin: rnd(0.15) });
  if (Math.random() < 0.5) emit(rnd(5), 0.05, rnd(4) - 1, rnd(0.1), 0.25 + Math.random() * 0.3, rnd(0.1), C(1.4, 0.55, 0.15), 0.06, 5, { t: 'spark' });
}
