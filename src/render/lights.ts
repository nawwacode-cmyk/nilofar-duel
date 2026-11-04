import * as THREE from 'three';
import { scene } from './stage';
import { projs } from '../game/state';
import type { Palette } from '../core/types';

/**
 * Dynamic lighting from spells. Three.js recompiles every shader when the number of lights changes,
 * so a fixed pool is created once and only colours/intensities change at runtime.
 * - Bolt lights follow the closest projectiles so spells light the floor and the wizards.
 * - Flash lights are short bursts for impacts and explosions.
 */
const BOLT_N = 3, FLASH_N = 3;
const boltLights: THREE.PointLight[] = [];
const flashes: { L: THREE.PointLight; t: number; dur: number; peak: number }[] = [];
let enabled = true;

export function initLights() {
  for (let i = 0; i < BOLT_N; i++) { const L = new THREE.PointLight(0xffffff, 0, 4.5, 1.8); scene.add(L); boltLights.push(L); }
  for (let i = 0; i < FLASH_N; i++) { const L = new THREE.PointLight(0xffffff, 0, 7, 1.6); scene.add(L); flashes.push({ L, t: 0, dur: 1, peak: 0 }); }
}

/** Low quality tier turns dynamic lights off (intensity 0, count unchanged). */
export function setDynamicLights(on: boolean) { enabled = on; }

/** Brightest colour of a palette, normalised to a light colour. */
const lightColor = (pal: Palette, out: THREE.Color) => { out.copy(pal[1]); const m = Math.max(out.r, out.g, out.b) || 1; return out.multiplyScalar(1 / m); };

/** Short light burst at a point (impacts, explosions, KO). */
export function lightFlash(x: number, y: number, z: number, pal: Palette, peak = 14, dur = 0.25) {
  if (!enabled) return;
  // Re-use the flash closest to finishing.
  let f = flashes[0];
  for (const k of flashes) if (k.t / k.dur > f.t / f.dur) f = k;
  f.L.position.set(x, y, z); lightColor(pal, f.L.color); f.t = 0; f.dur = dur; f.peak = peak;
}

export function updateLights(dt: number) {
  let n = 0;
  if (enabled) for (const p of projs) {
    if (p.dead || n >= BOLT_N) continue;
    const L = boltLights[n++];
    L.position.copy(p.pos); lightColor(p.pal, L.color);
    L.intensity = (p.aoe ? 9 : 4) * (0.85 + Math.random() * 0.3);
    L.distance = p.aoe ? 6 : 4.5;
  }
  for (let i = n; i < BOLT_N; i++) boltLights[i].intensity = 0;
  for (const f of flashes) {
    f.t += dt;
    const k = f.t >= f.dur ? 0 : 1 - f.t / f.dur;
    f.L.intensity = enabled ? f.peak * k * k : 0;
  }
}
