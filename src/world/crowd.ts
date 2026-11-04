import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { scene } from '../render/stage';
import { getTier } from '../render/quality';
import { base } from '../fighters/fighter';
import { retarget } from '../assets/loader';
import { play } from '../audio/audio';
import { getCourtMesh } from './court';
import { rnd } from '../core/util';

/**
 * Spectators lining the back and sides of the courtyard. They are skeleton clones of the roster models
 * in darker, desaturated robes, idling out of sync and reacting to big moments.
 * Mixers are ticked at ~30 Hz in two staggered groups to keep the CPU cost low.
 */
interface Spectator { g: THREE.Group; mx: THREE.AnimationMixer; idle: THREE.AnimationAction; cheer: THREE.AnimationAction; flinch: THREE.AnimationAction; busy: number }
const crowd: Spectator[] = [];
let acc = 0, phase = 0;

/**
 * Seats under the back arcade, well behind the duel area so spectators never mix with the fighters.
 * Two staggered rows; the camera always looks towards -z, so this is the row that is always in view.
 */
function seats(): [number, number][] {
  const s: [number, number][] = [];
  for (let x = -4.6; x <= 4.61; x += 1.15) s.push([x + rnd(0.12), -6.6 + rnd(0.12)]);
  for (let x = -4.0; x <= 4.01; x += 1.15) s.push([x + rnd(0.12), -7.4 + rnd(0.12)]);
  return s;
}

const tint = new THREE.Color(0.3, 0.3, 0.36);

export function buildCrowd() {
  // High tier only: phones start on low/medium, so spectators never cost them frames.
  const max = [0, 0, 10][getTier()];
  if (!max) return;
  const court = getCourtMesh(); const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0);
  const all = seats();
  // Spread the chosen seats evenly when the tier limits the count.
  const pickSeats = all.filter((_, i) => i % Math.ceil(all.length / max) === 0 || all.length <= max).slice(0, max);
  pickSeats.forEach(([x, z], i) => {
    const m = SkeletonUtils.clone(base[i % base.length]);
    m.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(mt => {
        const n = mt.clone() as THREE.MeshPhongMaterial; n.color?.multiply(tint); if (n.emissive) n.emissive.setRGB(0, 0, 0); return n;
      });
      mesh.material = mats.length === 1 ? mats[0] : mats;
    });
    const g = new THREE.Group(); g.add(m);
    let y = 0;
    if (court) { rc.set(new THREE.Vector3(x, 3, z), down); const h = rc.intersectObject(court, false)[0]; if (h) y = h.point.y; }
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(0 - x, -0.6 - z); // face the arena centre
    g.scale.setScalar(0.92 + Math.random() * 0.12);
    scene.add(g);
    const mx = new THREE.AnimationMixer(m);
    const idle = mx.clipAction(retarget('idle', m));
    idle.time = Math.random() * 5; idle.timeScale = 0.8 + Math.random() * 0.4; idle.play();
    const cheer = mx.clipAction(retarget('special', m)); cheer.setLoop(THREE.LoopOnce, 1); cheer.clampWhenFinished = false;
    const flinch = mx.clipAction(retarget('hit', m)); flinch.setLoop(THREE.LoopOnce, 1);
    mx.addEventListener('finished', () => { idle.reset().fadeIn(0.3).play(); });
    crowd.push({ g, mx, idle, cheer, flinch, busy: 0 });
  });
}

/** 'cheer' for big hits and knockouts, 'gasp' for shield breaks and near misses. */
export function crowdReact(kind: 'cheer' | 'gasp', share = 0.6) {
  if (!crowd.length) return;
  for (const s of crowd) {
    if (s.busy > 0 || Math.random() > share) continue;
    s.busy = 1.6;
    const a = kind === 'cheer' ? s.cheer : s.flinch;
    setTimeout(() => { a.reset(); a.timeScale = 0.9 + Math.random() * 0.4; a.crossFadeFrom(s.idle, 0.2, false); a.play(); }, Math.random() * 350);
  }
  if (kind === 'cheer') play('c_loud', { vol: 0.25 + share * 0.3 });
}

export function updateCrowd(rdt: number) {
  if (!crowd.length) return;
  acc += rdt;
  if (acc < 1 / 60) return;
  // Alternate halves each tick: every spectator advances at ~30 Hz.
  const step = acc * 2; acc = 0; phase ^= 1;
  for (let i = phase; i < crowd.length; i += 2) { const s = crowd[i]; s.mx.update(step); s.busy = Math.max(0, s.busy - step); }
}
