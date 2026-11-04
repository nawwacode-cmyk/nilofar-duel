import * as THREE from 'three';
import { camera, renderer, composer, bloom } from '../render/stage';
import { setParticleScale } from '../render/particles';
import { bloomScale } from '../render/quality';
import { fovPunch } from '../fx/impact';
import { S, ch, inMenus } from '../game/state';
import { V, clamp, rnd, reduceMotion } from '../core/util';

/**
 * Fixed side-on camera: always looks from +z, only pans and zooms to frame both wizards.
 * (The project owner asked that it never rotates around the arena.)
 */
const camPos = V(0, 1.4, 3), camLook = V(0, 1.1, 0);
const tp = V(), tl = V();
const LIM = 5.5;

export function updCamera(dt: number) {
  const portrait = innerWidth / innerHeight < 1;
  if (S.state === 'menu' || S.state === 'online' || S.state === 'load' || S.state === 'title') {
    const c = ch(0); const a = S.T * 0.15;
    if (S.state === 'title') { tp.set(Math.sin(S.T * 0.07) * 2.2, 2.2, 4.6); tl.set(0, 1.4, -2); }
    else if (innerWidth < innerHeight) { tp.set(c.x + Math.sin(a) * 0.3, 1.15, c.z + 3.4); tl.set(c.x, 0.55, c.z); }
    else { tp.set(c.x + 0.95 + Math.sin(a) * 0.3, 1.35, c.z + 2.9); tl.set(c.x + 0.95, 1.15, c.z); }
  } else {
    const a = ch(0), b = ch(1);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const spanX = Math.abs(a.x - b.x), spanZ = Math.abs(a.z - b.z);
    const dist = clamp(spanX * 0.8 + spanZ * 0.4 + 3.4, 4.8, 9);
    if (portrait) { camera.fov = 64; tp.set(mx * 0.85, 2.8 + dist * 0.35, Math.min(LIM, mz + dist * 0.85)); tl.set(mx, 0.8, mz - 0.4); }
    else {
      let cz = mz + dist, extra = 0;
      if (cz > LIM) { extra = cz - LIM; cz = LIM; }
      camera.fov = 42 + extra * 7; tp.set(mx * 0.9, 1.5 + dist * 0.09 + extra * 0.15, cz); tl.set(mx, 1.05, mz);
    }
    if (S.state === 'struggle') {
      const sd = clamp(spanX * 0.5 + 1.8, 2.6, 4.6);
      tp.set(mx, portrait ? 1.6 : 1.0, Math.min(LIM, mz + (portrait ? sd * 1.7 : sd))); tl.set(mx, 1.25, mz); camera.fov = portrait ? 66 : 40;
    }
    if (S.state === 'ko') { const d = S.CH.find(c => c?.dead) || a; tp.set(d.x * 0.8, 1.2, Math.min(LIM, d.z + 3.4)); tl.set(d.x, 0.6, d.z); }
    camera.updateProjectionMatrix();
  }
  if (inMenus()) camera.fov = 42;
  else camera.fov += fovPunch(dt);
  camera.updateProjectionMatrix();
  camPos.lerp(tp, 1 - Math.pow(0.02, dt)); camLook.lerp(tl, 1 - Math.pow(0.02, dt));
  camera.position.copy(camPos); camera.position.y += Math.sin(S.T * 0.4) * 0.03;
  if (S.shake > 0 && !reduceMotion) { camera.position.x += rnd(S.shake); camera.position.y += rnd(S.shake); }
  S.shake *= Math.pow(0.02, dt);
  camera.lookAt(camLook);
}

export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  bloom.resolution.set(w * bloomScale(), h * bloomScale());
  setParticleScale((h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(21))));
}

/** Debug-only fixed camera (set via ?debug window.__dbg.camAt); null = normal camera. */
let debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
export function setDebugCamera(pos: [number, number, number] | null, look?: [number, number, number]) {
  debugCam = pos && look ? { pos: V(...pos), look: V(...look) } : null;
}
export function applyDebugCamera() { if (debugCam) { camera.position.copy(debugCam.pos); camera.lookAt(debugCam.look); } }
