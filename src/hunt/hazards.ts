import * as THREE from 'three';
import { scene } from '../render/stage';
import { emit } from '../render/particles';
import { play } from '../audio/audio';
import { C, rnd } from '../core/util';
import type { Palette } from '../core/types';
import { navHeight, type Nav } from './nav';
import type { Prey } from './monsters';

/**
 * The boss's area attacks. The host decides when and where (and sends the same order to the guest); each device
 * draws them and checks only its own wizard, who is authoritative for their own health.
 * - wave: a ring of swamp energy spreading from the boss; jump it with a dodge.
 * - root: a marked circle under a player, then roots burst out of the ground there.
 */
export type HazardKind = 'wave' | 'root';
interface Hazard { kind: HazardKind; x: number; z: number; t: number; mesh: THREE.Mesh; done: boolean; hitMe: boolean }

const WAVE = { speed: 9, max: 17, width: 0.7, dmg: 18 };
const ROOT = { warn: 1.1, radius: 1.7, dmg: 22, life: 1.8 };
const MUD: Palette = [C(0.35, 0.6, 0.15), C(0.15, 0.3, 0.06)];

const list: Hazard[] = [];

export function spawnHazard(kind: HazardKind, x: number, z: number, nav: Nav) {
  const y = navHeight(nav, x, z) + 0.08;
  const geo = kind === 'wave' ? new THREE.RingGeometry(0.92, 1, 64) : new THREE.RingGeometry(ROOT.radius * 0.9, ROOT.radius, 40);
  const mat = new THREE.MeshBasicMaterial({ color: kind === 'wave' ? new THREE.Color(0.9, 2.2, 0.6) : new THREE.Color(2.4, 0.4, 0.2), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z);
  scene.add(mesh);
  list.push({ kind, x, z, t: 0, mesh, done: false, hitMe: false });
  play(kind === 'wave' ? 'm_waves' : 'm_whoosh', { vol: 0.6, rate: 0.7 });
}

export function clearHazards() { for (const h of list) remove(h); list.length = 0; }
function remove(h: Hazard) { scene.remove(h.mesh); h.mesh.geometry.dispose(); (h.mesh.material as THREE.Material).dispose(); h.done = true; }

/** Advances every hazard; `me` is this device's own wizard (null when down). */
export function updateHazards(dt: number, nav: Nav, me: Prey | null) {
  for (const h of list) {
    h.t += dt;
    const mat = h.mesh.material as THREE.MeshBasicMaterial;
    if (h.kind === 'wave') {
      const r = h.t * WAVE.speed;
      h.mesh.scale.setScalar(r); mat.opacity = 0.85 * (1 - r / WAVE.max);
      // The ring follows the ground roughly (sampled at the ring's front towards the player).
      if (Math.random() < 0.6) { const a = Math.random() * Math.PI * 2, px = h.x + Math.cos(a) * r, pz = h.z + Math.sin(a) * r; emit(px, navHeight(nav, px, pz) + 0.2, pz, 0, 0.8, 0, MUD[0], 0.25, 0.5, { t: 'magic' }); }
      if (me && !me.dead && !h.hitMe && !me.dodging && Math.abs(Math.hypot(me.x - h.x, me.z - h.z) - r) < WAVE.width) { h.hitMe = true; me.hurt(WAVE.dmg, { x: h.x, z: h.z, def: { blood: MUD } }); }
      if (r > WAVE.max) remove(h);
    } else {
      // Warning ring that pulses and closes in, then the burst.
      if (h.t < ROOT.warn) { const k = h.t / ROOT.warn; h.mesh.scale.setScalar(1.6 - k * 0.6); mat.opacity = 0.4 + 0.5 * Math.abs(Math.sin(h.t * 12)); }
      else if (!h.hitMe && h.t - dt < ROOT.warn) {
        h.hitMe = true; mat.opacity = 0;
        const y = navHeight(nav, h.x, h.z);
        for (let i = 0; i < 26; i++) emit(h.x + rnd(ROOT.radius * 0.8), y + 0.1, h.z + rnd(ROOT.radius * 0.8), rnd(0.6), 2.5 + Math.random() * 2.5, rnd(0.6), MUD[(Math.random() * 2) | 0], 0.35, 0.9, { t: 'smoke', smoke: 1, grow: 0.6, a: 0.6 });
        play('m_blast', { vol: 0.6, rate: 0.6 });
        if (me && !me.dead && !me.dodging && Math.hypot(me.x - h.x, me.z - h.z) < ROOT.radius) me.hurt(ROOT.dmg, { x: h.x, z: h.z, def: { blood: MUD } });
      }
      if (h.t > ROOT.life) remove(h);
    }
  }
  for (let i = list.length - 1; i >= 0; i--) if (list[i].done) list.splice(i, 1);
}
