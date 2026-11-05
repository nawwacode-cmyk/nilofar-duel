import * as THREE from 'three';
import { scene, camera } from '../render/stage';
import { emit } from '../render/particles';
import { getTier } from '../render/quality';
import { shockDistort } from '../render/post';
import { play } from '../audio/audio';
import { burstSheet } from './flipbook';
import { floorAt } from '../world/arena';
import { C, rnd, pick } from '../core/util';
import type { Fighter, Palette } from '../core/types';

/**
 * Dimensional spell effects, all pooled (nothing is allocated during a fight):
 * - ribbons: camera-facing light trails that follow a projectile through 3D space and fade from the head;
 * - rings: an expanding ring on the ground plus, for heavy hits, a glowing dome (fresnel shell);
 * - decals: an element's mark left on the floor (scorch, frost, cracks, stain, glyph, petals, wind swirl);
 * - lightning: branching arcs from the sky, flickering for a moment;
 * - impactFx: the element-specific mix of the above for a hit or explosion.
 * Low tier keeps the old sprite effects only; medium adds ribbons/rings/decals; high adds distortion and more detail.
 */
export type Element = 'fire' | 'ice' | 'shadow' | 'spark' | 'gold' | 'flora' | 'wind';
const BY_ID: Record<string, Element> = { reem: 'fire', siraj: 'ice', layla: 'shadow', qasem: 'spark', ehab: 'gold', sara: 'flora', abed: 'wind' };
export const elementOf = (f: Fighter): Element => BY_ID[f.R.id] ?? 'gold';

/* ---------- ribbons ---------- */
const SEG = 10;
interface Ribbon { mesh: THREE.Mesh; pts: THREE.Vector3[]; n: number; width: number; alive: boolean; fade: number; mat: THREE.ShaderMaterial }
const ribbons: Ribbon[] = [];
const ribbonVert = `attribute float aT; varying float vT; void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;
const ribbonFrag = `uniform vec3 uColor; uniform vec3 uCore; uniform float uAlpha; varying float vT;
  void main(){ float a = pow(1.0 - vT, 1.6) * uAlpha; gl_FragColor = vec4(mix(uColor, uCore, pow(1.0 - vT, 6.0)) * a, 1.0); }`;

function newRibbon(): Ribbon {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SEG * 2 * 3), t = new Float32Array(SEG * 2), idx: number[] = [];
  for (let i = 0; i < SEG; i++) { t[i * 2] = t[i * 2 + 1] = i / (SEG - 1); if (i < SEG - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1)); g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({ vertexShader: ribbonVert, fragmentShader: ribbonFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uAlpha: { value: 1 } } });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
  return { mesh, pts: Array.from({ length: SEG }, () => new THREE.Vector3()), n: 0, width: 0.1, alive: false, fade: 0, mat };
}

export interface RibbonHandle { push(p: THREE.Vector3): void; end(): void }
const NOOP: RibbonHandle = { push() {}, end() {} };

/** A trail for a projectile (radius r) in its palette's colours; push its position each frame, end() when it dies. */
export function takeRibbon(pal: Palette, r: number): RibbonHandle {
  if (getTier() === 0) return NOOP;
  let rb = ribbons.find(x => !x.alive && x.fade <= 0);
  if (!rb) { if (ribbons.length >= 32) return NOOP; rb = newRibbon(); ribbons.push(rb); }
  const b = rb; b.alive = true; b.n = 0; b.fade = 1; b.width = Math.max(0.05, r * 0.7); b.mesh.visible = true;
  const body = pal[1].clone(), m = Math.max(body.r, body.g, body.b) || 1;
  (b.mat.uniforms.uColor.value as THREE.Color).copy(body.multiplyScalar(0.9 / m));
  (b.mat.uniforms.uCore.value as THREE.Color).copy(pal[pal.length - 1]).multiplyScalar(0.55);
  b.mat.uniforms.uAlpha.value = 1;
  return {
    push(p) { for (let i = SEG - 1; i > 0; i--) b.pts[i].copy(b.pts[i - 1]); b.pts[0].copy(p); if (b.n === 0) for (const q of b.pts) q.copy(p); b.n = Math.min(SEG, b.n + 1); },
    end() { b.alive = false; },
  };
}

const side = new THREE.Vector3(), dir = new THREE.Vector3(), view = new THREE.Vector3();
function updRibbons(dt: number) {
  for (const b of ribbons) {
    if (!b.mesh.visible) continue;
    if (!b.alive) { b.fade -= dt * 3.5; b.mat.uniforms.uAlpha.value = Math.max(0, b.fade); if (b.fade <= 0) { b.mesh.visible = false; continue; } }
    const pos = b.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < SEG; i++) {
      const p = b.pts[i], q = b.pts[Math.min(SEG - 1, i + 1)], o = b.pts[Math.max(0, i - 1)];
      dir.subVectors(o, q); if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
      view.subVectors(camera.position, p);
      side.crossVectors(dir, view).normalize().multiplyScalar(b.width * (1 - i / SEG * 0.7));
      pos.setXYZ(i * 2, p.x + side.x, p.y + side.y, p.z + side.z); pos.setXYZ(i * 2 + 1, p.x - side.x, p.y - side.y, p.z - side.z);
    }
    pos.needsUpdate = true;
  }
}

/* ---------- rings and domes ---------- */
interface Ring { mesh: THREE.Mesh; dome: THREE.Mesh; t: number; dur: number; size: number; on: boolean }
const rings: Ring[] = [];
const ringGeo = new THREE.RingGeometry(0.82, 1, 64);
const domeGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const domeVert = `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const domeFrag = `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.5); gl_FragColor = vec4(uColor * f * uAlpha, 1.0); }`;

function newRing(): Ring {
  const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
  mesh.rotation.x = -Math.PI / 2; mesh.visible = false; scene.add(mesh);
  const dome = new THREE.Mesh(domeGeo, new THREE.ShaderMaterial({ vertexShader: domeVert, fragmentShader: domeFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } } }));
  dome.visible = false; scene.add(dome);
  return { mesh, dome, t: 0, dur: 0.5, size: 2, on: false };
}

/** Expanding ground ring (and a glowing dome when heavy) at x, z. */
export function shockRing(x: number, z: number, pal: Palette, size = 2, heavy = false) {
  if (getTier() === 0) return;
  let r = rings.find(k => !k.on);
  if (!r) { if (rings.length >= 10) return; r = newRing(); rings.push(r); }
  r.on = true; r.t = 0; r.dur = heavy ? 0.6 : 0.4; r.size = size;
  const y = floorAt(x, z) + 0.04;
  r.mesh.position.set(x, y, z); r.mesh.visible = true;
  (r.mesh.material as THREE.MeshBasicMaterial).color.copy(pal[1]).multiplyScalar(0.55);
  r.dome.visible = heavy; r.dome.position.set(x, y, z);
  (r.dome.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(pal[pal.length - 1]);
}

function updRings(dt: number) {
  for (const r of rings) {
    if (!r.on) continue;
    r.t += dt; const k = r.t / r.dur, e = 1 - Math.pow(1 - Math.min(1, k), 3);
    r.mesh.scale.setScalar(0.2 + e * r.size);
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    if (r.dome.visible) { r.dome.scale.set(0.3 + e * r.size * 0.8, 0.3 + e * r.size * 0.6, 0.3 + e * r.size * 0.8); (r.dome.material as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.max(0, 1 - k) * 1.4; }
    if (k >= 1) { r.on = false; r.mesh.visible = r.dome.visible = false; }
  }
}

/* ---------- ground decals ---------- */
/** One canvas texture per element, drawn once. */
function decalTexture(e: Element) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d')!, h = S / 2;
  const rand = (a: number) => (Math.random() - 0.5) * 2 * a;
  const radial = (stops: [number, string][]) => { const g = x.createRadialGradient(h, h, 0, h, h, h); for (const [o, col] of stops) g.addColorStop(o, col); x.fillStyle = g; x.fillRect(0, 0, S, S); };
  if (e === 'fire') {
    radial([[0, 'rgba(10,6,4,0.95)'], [0.45, 'rgba(25,12,6,0.8)'], [0.75, 'rgba(60,25,8,0.35)'], [1, 'rgba(0,0,0,0)']]);
    // Glowing embers in the char.
    for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, r = Math.random() * h * 0.65; x.fillStyle = `rgba(255,${100 + Math.random() * 90 | 0},20,${0.3 + Math.random() * 0.5})`; x.beginPath(); x.arc(h + Math.cos(a) * r, h + Math.sin(a) * r, 1 + Math.random() * 2.5, 0, 6.28); x.fill(); }
  } else if (e === 'ice') {
    radial([[0, 'rgba(210,240,255,0.75)'], [0.5, 'rgba(160,215,255,0.45)'], [1, 'rgba(0,0,0,0)']]);
    x.strokeStyle = 'rgba(235,250,255,0.85)';
    for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28; let px = h, py = h; x.lineWidth = 1 + Math.random() * 2; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 5; s++) { px += Math.cos(a + rand(0.4)) * h * 0.18; py += Math.sin(a + rand(0.4)) * h * 0.18; x.lineTo(px, py); } x.stroke(); }
  } else if (e === 'spark') {
    radial([[0, 'rgba(20,20,30,0.85)'], [0.35, 'rgba(15,15,20,0.4)'], [1, 'rgba(0,0,0,0)']]);
    for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28; let px = h, py = h; x.lineWidth = 2.5; x.strokeStyle = 'rgba(8,8,12,0.95)'; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 7; s++) { px += Math.cos(a + rand(0.7)) * h * 0.14; py += Math.sin(a + rand(0.7)) * h * 0.14; x.lineTo(px, py); } x.stroke(); }
  } else if (e === 'shadow') {
    for (let i = 0; i < 14; i++) { const g = x.createRadialGradient(h + rand(50), h + rand(50), 0, h, h, h * (0.5 + Math.random() * 0.5)); g.addColorStop(0, 'rgba(40,10,60,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, S, S); }
  } else if (e === 'gold') {
    x.strokeStyle = 'rgba(255,215,120,0.9)'; x.lineWidth = 3;
    for (const r of [0.9, 0.72]) { x.beginPath(); x.arc(h, h, h * r, 0, 6.28); x.stroke(); }
    x.lineWidth = 2; x.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * 6.28; x.lineTo(h + Math.cos(a) * h * 0.72, h + Math.sin(a) * h * 0.72); } x.closePath(); x.stroke();
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; x.fillStyle = 'rgba(255,230,150,0.9)'; x.fillRect(h + Math.cos(a) * h * 0.81 - 3, h + Math.sin(a) * h * 0.81 - 3, 6, 6); }
  } else if (e === 'flora') {
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, r = Math.random() * h * 0.8; x.save(); x.translate(h + Math.cos(a) * r, h + Math.sin(a) * r); x.rotate(Math.random() * 6.28); x.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${90 + Math.random() * 80 | 0},${190 + Math.random() * 60 | 0},${0.5 + Math.random() * 0.4})`; x.beginPath(); x.ellipse(0, 0, 7, 3.5, 0, 0, 6.28); x.fill(); x.restore(); }
  } else {
    x.strokeStyle = 'rgba(70,65,60,0.55)';
    for (let i = 0; i < 6; i++) { x.lineWidth = 3 + Math.random() * 3; x.beginPath(); for (let s = 0; s < 60; s++) { const t = s / 60, a = t * 5 + i, r = t * h * 0.9; x.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r); } x.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const decalTex = new Map<Element, THREE.Texture>();
interface Decal { mesh: THREE.Mesh; t: number; life: number; on: boolean; glow: boolean }
const decals: Decal[] = [];
const decalGeo = new THREE.PlaneGeometry(1, 1);
const GLOWING: Element[] = ['fire', 'gold', 'spark'];

/** Leaves the element's mark on the floor at x, z (size in metres). Oldest is reused when the pool is full. */
export function groundMark(e: Element, x: number, z: number, size = 1.4) {
  if (getTier() === 0) return;
  let tex = decalTex.get(e); if (!tex) { tex = decalTexture(e); decalTex.set(e, tex); }
  let d = decals.find(k => !k.on);
  if (!d) {
    if (decals.length < (getTier() === 2 ? 24 : 12)) {
      const mesh = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1; scene.add(mesh);
      d = { mesh, t: 0, life: 7, on: false, glow: false }; decals.push(d);
    } else d = decals.reduce((a, b) => (a.t > b.t ? a : b));
  }
  const m = d.mesh.material as THREE.MeshBasicMaterial;
  m.map = tex; m.needsUpdate = true;
  m.blending = e === 'gold' || e === 'ice' ? THREE.AdditiveBlending : THREE.NormalBlending;
  d.on = true; d.t = 0; d.life = e === 'gold' ? 3 : 7; d.glow = GLOWING.includes(e);
  d.mesh.visible = true; d.mesh.position.set(x, floorAt(x, z) + 0.025, z);
  d.mesh.rotation.z = Math.random() * 6.28; d.mesh.scale.setScalar(size);
  m.color.setRGB(1, 1, 1);
}

function updDecals(dt: number) {
  for (const d of decals) {
    if (!d.on) continue;
    d.t += dt; const k = d.t / d.life;
    const m = d.mesh.material as THREE.MeshBasicMaterial;
    m.opacity = Math.min(1, (1 - k) * 2.5);
    // Burning/charged marks glow white-hot first and cool down.
    if (d.glow) { const h = Math.max(0, 1 - d.t / 1.2); m.color.setRGB(1 + h * 1.5, 1 + h * 0.8, 1 + h * 0.3); }
    if (k >= 1) { d.on = false; d.mesh.visible = false; }
  }
}

/* ---------- lightning ---------- */
interface Bolt { mesh: THREE.Mesh; t: number; on: boolean }
const bolts: Bolt[] = [];
/** Branching arcs from the sky down to (x, z) that flicker for ~0.3 s. */
export function lightning(x: number, z: number, pal: Palette) {
  if (getTier() === 0) return;
  let b = bolts.find(k => !k.on);
  if (!b) { if (bolts.length >= 3) return; b = { mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })), t: 0, on: false }; b.mesh.frustumCulled = false; scene.add(b.mesh); bolts.push(b); }
  // Main bolt from 9 m up, jagged, plus a few branches; quads face the camera (built once per strike).
  const verts: number[] = [], y0 = floorAt(x, z);
  const toCam = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(x, y0 + 3, z)).setY(0).normalize();
  const sideV = new THREE.Vector3(-toCam.z, 0, toCam.x);
  const branch = (sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, w: number, depth: number) => {
    const n = 10; let px = sx, py = sy, pz = sz;
    for (let i = 1; i <= n; i++) {
      const t = i / n, j = i === n ? 0 : 1;
      const nx = sx + (ex - sx) * t + rnd(0.35) * j * w * 6, ny = sy + (ey - sy) * t, nz = sz + (ez - sz) * t + rnd(0.35) * j * w * 6;
      const sx2 = sideV.x * w, sz2 = sideV.z * w;
      verts.push(px - sx2, py, pz - sz2, px + sx2, py, pz + sz2, nx + sx2, ny, nz + sz2, px - sx2, py, pz - sz2, nx + sx2, ny, nz + sz2, nx - sx2, ny, nz - sz2);
      if (depth > 0 && Math.random() < 0.25) branch(nx, ny, nz, nx + rnd(1.6), ny - 1.5 - Math.random() * 2, nz + rnd(1.6), w * 0.55, depth - 1);
      px = nx; py = ny; pz = nz;
    }
  };
  branch(x + rnd(1.5), y0 + 9, z + rnd(0.5), x, y0 + 0.05, z, 0.06, 2);
  const g = b.mesh.geometry as THREE.BufferGeometry;
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.computeBoundingSphere();
  (b.mesh.material as THREE.MeshBasicMaterial).color.copy(pal[pal.length - 1]).multiplyScalar(2.2);
  b.on = true; b.t = 0; b.mesh.visible = true;
}
function updBolts(dt: number) {
  for (const b of bolts) {
    if (!b.on) continue;
    b.t += dt;
    (b.mesh.material as THREE.MeshBasicMaterial).opacity = b.t > 0.32 ? 0 : (Math.random() < 0.75 ? 1 : 0.25);
    if (b.t > 0.32) { b.on = false; b.mesh.visible = false; }
  }
}

/* ---------- per-element impact ---------- */
/**
 * The element's own impact: ring, floor mark, pressure wave and a few element particles.
 * `power` 0..1 (bolt ~0.25, special ~0.8). Call where a spell hits something or explodes.
 */
export function impactFx(e: Element, p: THREE.Vector3, pal: Palette, power = 0.3) {
  const tier = getTier();
  if (tier === 0) return;
  const heavy = power >= 0.6, fy = floorAt(p.x, p.z), nearFloor = p.y - fy < 1.6;
  shockRing(p.x, p.z, pal, 0.7 + power * 1.6, heavy);
  if (nearFloor || heavy) groundMark(e, p.x, p.z, 0.8 + power * 1.6);
  if (tier === 2 && (heavy || e === 'fire')) shockDistort(p.x, p.y, p.z, 1.2 + power * 3, heavy ? 1 : 0.5);
  const n = tier === 2 ? 1 : 0.5;
  // Real explosion footage for fire (and every heavy blast); a smoke puff in the element's colour otherwise.
  if (e === 'fire' || heavy) burstSheet('explosion', p.x, p.y + (heavy ? 0.3 : 0), p.z, heavy ? 2 + power : 0.9, heavy ? 1.1 : 0.55, e === 'fire' ? undefined : pal[0].clone().multiplyScalar(0.45).addScalar(0.45));
  else burstSheet('smoke', p.x, p.y, p.z, 0.9, 0.8, pal[1].clone().multiplyScalar(0.25).addScalar(0.55));
  if (e === 'ice') play('k_ice' + ((Math.random() * 3) | 0), { vol: 0.5, x: p.x });
  if (e === 'fire') for (let i = 0; i < 18 * n; i++) emit(p.x + rnd(0.3), p.y, p.z + rnd(0.3), rnd(2), 1 + Math.random() * 2.5, rnd(2), C(2.8, 1 + Math.random(), 0.2), 0.05, 1.2 + Math.random(), { t: 'spark', grav: -2.5, drag: 0.8 });
  else if (e === 'ice') for (let i = 0; i < 16 * n; i++) emit(p.x, p.y, p.z, rnd(3), 1 + Math.random() * 2, rnd(3), pick(pal), 0.12 + Math.random() * 0.1, 0.8, { t: 'star', grav: -8, drag: 0.5, spin: rnd(8) });
  else if (e === 'spark') { if (heavy) lightning(p.x, p.z, pal); for (let i = 0; i < 12 * n; i++) emit(p.x + rnd(0.4), fy + 0.05, p.z + rnd(0.4), rnd(4), 0.5, rnd(4), pick(pal), 0.08, 0.25, { t: 'spark' }); }
  else if (e === 'shadow') for (let i = 0; i < 10 * n; i++) emit(p.x + rnd(0.4), p.y, p.z + rnd(0.4), rnd(0.5), 0.6, rnd(0.5), C(0.15, 0.05, 0.25), 0.6, 1.4, { t: 'smoke', smoke: 1, grow: 0.8, a: 0.5 });
  else if (e === 'flora') for (let i = 0; i < 16 * n; i++) emit(p.x, p.y, p.z, rnd(2), 1 + Math.random() * 1.5, rnd(2), pick(pal), 0.14, 1.4, { t: 'star', grav: -1.2, drag: 1.2, spin: rnd(5) });
  else if (e === 'wind') for (let i = 0; i < 14 * n; i++) { const a = Math.random() * 6.28; emit(p.x, fy + 0.2 + Math.random(), p.z, Math.cos(a) * 4, 0.3, Math.sin(a) * 4, C(0.6, 0.6, 0.6), 0.5, 0.7, { t: 'smoke', smoke: 1, grow: 1, a: 0.35 }); }
}

export function updateVfx(dt: number) { updRibbons(dt); updRings(dt); updDecals(dt); updBolts(dt); }
