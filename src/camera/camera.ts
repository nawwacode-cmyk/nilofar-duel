import * as THREE from 'three';
import { camera, renderer, composer, bloom } from '../render/stage';
import { setParticleScale } from '../render/particles';
import { bloomScale } from '../render/quality';
import { resizePost } from '../render/post';
import { fovPunch } from '../fx/impact';
import { settings } from '../settings/settings';
import { S, ch, inMenus } from '../game/state';
import { V, clamp, rnd, reduceMotion } from '../core/util';
import { viewSize, updateRotation } from '../core/view';
import { cameraLimit } from '../world/arena';

/**
 * Fixed side-on camera: always looks from +z, only pans and zooms to frame both wizards.
 * (The project owner asked that it never rotates around the arena.)
 */
const camPos = V(0, 1.4, 3), camLook = V(0, 1.1, 0);
const tp = V(), tl = V();

/** Cinematic focus: during a special or a fourth ability the camera leans in on the caster for a moment. */
let focus: { idx: number; until: number } | null = null;
export function focusOn(idx: number, seconds: number) { if (!reduceMotion) focus = { idx, until: S.T + seconds }; }

export function updCamera(dt: number) {
  const LIM = cameraLimit();
  const { w: vw, h: vh } = viewSize();
  const portrait = vw / vh < 1;
  if (S.state === 'menu' || S.state === 'online' || S.state === 'load' || S.state === 'title') {
    const c = ch(0); const a = S.T * 0.15;
    if (S.state === 'title') { tp.set(Math.sin(S.T * 0.07) * 2.2, 2.2, 4.6); tl.set(0, 1.4, -2); }
    else if (vw < vh) { tp.set(c.x + Math.sin(a) * 0.3, 1.15, c.z + 3.4); tl.set(c.x, 0.55, c.z); }
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
      // Wide arenas: if both wizards (plus a margin) do not fit horizontally from where the camera may stand, open the
      // field of view instead of backing out of the arena.
      const fit = 2 * THREE.MathUtils.radToDeg(Math.atan((spanX / 2 + 1.3) / (camera.aspect * Math.max(1, cz - mz))));
      camera.fov = Math.min(64, Math.max(camera.fov, fit));
    }
    if (S.state === 'struggle') {
      const sd = clamp(spanX * 0.5 + 1.8, 2.6, 4.6);
      tp.set(mx, portrait ? 1.6 : 1.0, Math.min(LIM, mz + (portrait ? sd * 1.7 : sd))); tl.set(mx, 1.25, mz); camera.fov = portrait ? 66 : 40;
    }
    if (S.state === 'ko') {
      // A slow half-orbit around the fallen wizard.
      const d = S.CH.find(c => c?.dead) || a, ang = -0.5 + Math.min(1, S.stateT / 2.6) * 0.9;
      tp.set(d.x + Math.sin(ang) * 3.4, 1.15, Math.min(LIM, d.z + Math.cos(ang) * 3.4)); tl.set(d.x, 0.6, d.z);
    }
    if (S.state === 'intro' && !reduceMotion) {
      // Round start: from wide and high to the side, swooping down into the fight framing.
      const k = Math.min(1, S.stateT / 1.7), e = 1 - Math.pow(1 - k, 3);
      tp.x += (1 - e) * -3.2; tp.y += (1 - e) * 2.6; tp.z = Math.min(LIM, tp.z + (1 - e) * 1.2);
    }
    if (focus && S.state === 'fight') {
      if (S.T > focus.until) focus = null;
      else {
        const f = S.CH[focus.idx];
        if (f) { const k = 0.28; tl.x += (f.x - tl.x) * k; tl.y += (1.2 - tl.y) * k; tp.x += (f.x - tp.x) * k * 0.8; tp.z -= Math.min(1.2, Math.max(0, tp.z - f.z - 3)) * k; camera.fov -= 3; }
      }
    }
    camera.updateProjectionMatrix();
  }
  if (inMenus()) camera.fov = 42;
  else camera.fov += fovPunch(dt);
  camera.updateProjectionMatrix();
  camPos.lerp(tp, 1 - Math.pow(0.02, dt)); camLook.lerp(tl, 1 - Math.pow(0.02, dt));
  camera.position.copy(camPos); camera.position.y += Math.sin(S.T * 0.4) * 0.03;
  const sh = S.shake * settings.shake;
  if (sh > 0 && !reduceMotion) { camera.position.x += rnd(sh); camera.position.y += rnd(sh); }
  S.shake *= Math.pow(0.02, dt);
  camera.lookAt(camLook);
}

export function resize() {
  updateRotation();
  const { w, h } = viewSize();
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  bloom.resolution.set(w * bloomScale(), h * bloomScale());
  resizePost(w, h, renderer.getPixelRatio());
  setParticleScale((h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(21))));
}

/** Debug-only fixed camera (set via ?debug window.__dbg.camAt); null = normal camera. */
let debugCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
export function setDebugCamera(pos: [number, number, number] | null, look?: [number, number, number]) {
  debugCam = pos && look ? { pos: V(...pos), look: V(...look) } : null;
}
export function applyDebugCamera() { if (debugCam) { camera.position.copy(debugCam.pos); camera.lookAt(debugCam.look); } }
