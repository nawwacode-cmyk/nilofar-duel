import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { scene, BLOB } from '../render/stage';
import { emit, burst } from '../render/particles';
import { play } from '../audio/audio';
import { V, C, rnd, angleDelta, clamp } from '../core/util';
import { packGltf, packClips } from './assets';
import { navHeight, navMove, navNearestFree, type Nav } from './nav';
import type { Palette } from '../core/types';

/**
 * Monsters of the Hunters mode. Mixamo ones (skeleton, villagers, the boss…) share packed clips renamed onto their
 * bones like the wizards; Sketchfab ones (wolf, spider, great wolf) carry their own animations.
 */
export type MonId = 'wolf' | 'spider' | 'skeleton' | 'ghost' | 'greatwolf' | 'villager' | 'parasite' | 'warden' | 'mutant';
type ClipKey = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'die' | 'rise' | 'roar';

export interface MonDef {
  name: string; file: string;
  /** Standing height (m) the model is scaled to, and body radius for collisions/hits. */
  h: number; r: number;
  hp: number; walk: number; run: number; dmg: number; range: number;
  /** Seconds from the start of an attack to the moment it lands, and rest after it. */
  windup: number; rest: number;
  /** Distance at which it notices the player. */
  aggro: number;
  /** Clip per action: packed clip names for Mixamo, a substring of the model's own clip names otherwise. */
  clips: Partial<Record<ClipKey, string>>;
  mixamo?: boolean;
  /** Turn the model so it faces +Z (radians), for models authored facing elsewhere. */
  yaw?: number;
  /** Colour multiplier for the whole model (e.g. a darker coat). */
  tint?: [number, number, number];
  /** Floats above the ground (ghost). */
  float?: number; ghost?: boolean;
  /** No attack clip: leaps at the player instead. */
  lunge?: boolean;
  /** Clip playback speed per metre/second of movement (gait matching). */
  gait?: number;
  blood: Palette;
}

const DARK: Palette = [C(0.35, 0.05, 0.05), C(0.2, 0.02, 0.02)];
const BONE: Palette = [C(0.9, 0.85, 0.7), C(0.5, 0.45, 0.35)];
const SPIRIT: Palette = [C(0.6, 1.4, 2.6), C(0.3, 0.8, 2)];
const ICHOR: Palette = [C(0.35, 0.6, 0.1), C(0.15, 0.3, 0.05)];

export const MONSTERS: Record<MonId, MonDef> = {
  wolf: { name: 'ذئب الظلال', file: 'm_wolf', h: 1.05, r: 0.45, hp: 40, walk: 1.6, run: 6.4, dmg: 9, range: 1.7, windup: 0.35, rest: 0.9, aggro: 16,
    clips: { idle: '04_Idle', walk: '02_walk', run: '01_Run', roar: '03_creep' }, yaw: Math.PI / 2, tint: [0.32, 0.3, 0.36], lunge: true, gait: 0.2, blood: DARK },
  spider: { name: 'العنكبوت العملاق', file: 'm_spider', h: 1.15, r: 0.9, hp: 90, walk: 1.4, run: 4.6, dmg: 14, range: 2.3, windup: 0.5, rest: 1.2, aggro: 14,
    clips: { idle: 'ArmatureAction', walk: 'Spider walking', run: 'Spider running' }, lunge: true, gait: 0.25, blood: ICHOR },
  skeleton: { name: 'حارس العظام', file: 'm_skeleton', h: 1.85, r: 0.4, hp: 60, walk: 0.9, run: 3.4, dmg: 12, range: 1.7, windup: 0.75, rest: 0.8, aggro: 13, mixamo: true,
    clips: { idle: 'ZombieIdle', walk: 'ZombieWalk', run: 'ZombieRunning', attack: 'ZombieAttack', hit: 'ZombieReactionHit', die: 'ZombieDying', rise: 'ZombieStandUp', roar: 'ZombieScream' }, gait: 0.3, blood: BONE },
  ghost: { name: 'الروح الهائمة', file: 'm_ghost', h: 1.8, r: 0.4, hp: 55, walk: 1.2, run: 3.8, dmg: 10, range: 1.6, windup: 0.6, rest: 1, aggro: 15, mixamo: true,
    clips: { idle: 'Floating', walk: 'Floating', run: 'Floating', attack: 'ZombieAttack', hit: 'ZombieReactionHit', die: 'ZombieDying' }, float: 0.35, ghost: true, blood: SPIRIT },
  greatwolf: { name: 'الذئب الرمادي الأكبر', file: 'm_greatwolf', h: 2.6, r: 1.1, hp: 320, walk: 1.8, run: 5.6, dmg: 24, range: 3, windup: 0.6, rest: 1.1, aggro: 20,
    // Clip names are opaque; identified by length and motion: .006 long and still, c5210 a 0.67 s gallop, .004 the sword swing.
    clips: { idle: '.006', walk: '.001', run: 'c5210', attack: '.004', roar: '.002' }, gait: 0.2, blood: DARK },
  villager: { name: 'قروي ملعون', file: 'm_villager', h: 1.75, r: 0.4, hp: 55, walk: 0.9, run: 3.2, dmg: 11, range: 1.6, windup: 0.75, rest: 0.8, aggro: 12, mixamo: true,
    clips: { idle: 'ZombieIdle', walk: 'ZombieWalk', run: 'ZombieRunning', attack: 'ZombieBiting', hit: 'ZombieReactionHit', die: 'ZombieDying', rise: 'ZombieStandUp', roar: 'ZombieScream' }, gait: 0.3, blood: DARK },
  parasite: { name: 'الطفيلي', file: 'm_parasite', h: 1.8, r: 0.4, hp: 70, walk: 1.2, run: 4.4, dmg: 13, range: 1.7, windup: 0.6, rest: 0.7, aggro: 14, mixamo: true,
    clips: { idle: 'ZombieIdle', walk: 'ZombieWalk', run: 'ZombieRunning', attack: 'ZombieAttack', hit: 'ZombieReactionHit', die: 'ZombieDying', roar: 'ZombieScream' }, gait: 0.3, blood: ICHOR },
  warden: { name: 'حارس الطاحونة', file: 'm_warden', h: 2.3, r: 0.7, hp: 260, walk: 1.1, run: 3.6, dmg: 22, range: 2.2, windup: 0.85, rest: 1, aggro: 16, mixamo: true,
    clips: { idle: 'MutantIdle', walk: 'MutantWalking', run: 'MutantRun', attack: 'MutantSwiping', die: 'MutantDying', roar: 'MutantRoaring' }, gait: 0.3, blood: DARK },
  mutant: { name: 'الموء', file: 'm_mutant', h: 2.7, r: 0.9, hp: 900, walk: 1.2, run: 4.2, dmg: 26, range: 2.6, windup: 0.8, rest: 0.9, aggro: 30, mixamo: true,
    clips: { idle: 'MutantIdle', walk: 'MutantWalking', run: 'MutantRun', attack: 'MutantSwiping', die: 'MutantDying', roar: 'MutantRoaring' }, gait: 0.3, blood: ICHOR },
};

/** Monster states; their index is what travels over the network. */
export const STATES = ['buried', 'rise', 'idle', 'wander', 'chase', 'attack', 'hurt', 'dead'] as const;
export type MonState = typeof STATES[number];
export interface Monster {
  /** Same number on both devices in co-op (given by the host). */
  uid: number;
  /** Moved by the host's snapshots instead of its own AI (co-op guest). */
  puppet: boolean; nx: number; nz: number; nry: number;
  /** Rage multiplier of speed (the boss). */
  speedMul: number;
  /** Which player it is after (index into the preys). */
  target: number;
  id: MonId; def: MonDef; root: THREE.Group; model: THREE.Object3D; mixer: THREE.AnimationMixer;
  acts: Partial<Record<ClipKey, THREE.AnimationAction>>; cur: THREE.AnimationAction | null;
  blob: THREE.Mesh; mats: THREE.MeshStandardMaterial[];
  x: number; z: number; ry: number; vx: number; vz: number;
  hp: number; state: MonState; t: number; hitT: number; flash: number;
  homeX: number; homeZ: number; wx: number; wz: number;
  /** Has hit the player in this attack already; leap velocity while lunging. */
  struck: boolean; lx: number; lz: number;
  gone: boolean;
}

/* ---------- loading ---------- */
interface Base { scene: THREE.Object3D; clips: Partial<Record<ClipKey, THREE.AnimationClip>>; scale: number; off: THREE.Vector3 }
const bases = new Map<MonId, Promise<Base>>();

function renameFor(clip: THREE.AnimationClip, model: THREE.Object3D) {
  let pre = 'mixamorig';
  model.traverse(o => { if (/Hips$/.test(o.name) && (o as THREE.Bone).isBone) pre = o.name.replace(/Hips$/, ''); });
  const c = clip.clone(); c.tracks.forEach(t => { t.name = t.name.replace(/^mixamorig\d*:?/, pre); }); return c;
}

/** Loads a monster type once: model, clips, and the scale/offset that stands it on the floor at its height. */
export function loadMonster(id: MonId): Promise<Base> {
  let p = bases.get(id);
  if (p) return p;
  p = (async () => {
    const d = MONSTERS[id];
    const [g, packed] = await Promise.all([packGltf(d.file), d.mixamo ? packClips() : Promise.resolve(null)]);
    const clips: Base['clips'] = {};
    for (const [k, n] of Object.entries(d.clips) as [ClipKey, string][]) {
      const c = packed ? packed[n] : g.animations.find(a => a.name.includes(n));
      if (c) clips[k] = packed ? renameFor(c, g.scene) : c;
    }
    // Only the animated body: Sketchfab scenes may carry display bases or props, which would skew the size.
    const drop: THREE.Object3D[] = [];
    g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) drop.push(o); });
    drop.forEach(o => o.removeFromParent());
    // Measure the posed model (first frame of idle): skinned bind poses can be far from the real silhouette.
    const probe = SkeletonUtils.clone(g.scene), mx = new THREE.AnimationMixer(probe);
    if (clips.idle) { mx.clipAction(clips.idle).play(); mx.update(0); }
    probe.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(probe, true), size = box.getSize(V());
    const scale = d.h / (size.y || 1);
    const off = V(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2).multiplyScalar(scale);
    return { scene: g.scene, clips, scale, off };
  })();
  bases.set(id, p); p.catch(() => bases.delete(id));
  return p;
}

/** Difficulty: multipliers of monster health and damage (صيّاد مبتدئ / صيّاد / صيّاد أسطوري). */
export const DIFFS = [{ name: 'صيّاد مبتدئ', hp: 0.75, dmg: 0.6 }, { name: 'صيّاد', hp: 1, dmg: 1 }, { name: 'صيّاد أسطوري', hp: 1.35, dmg: 1.45 }] as const;
export const tuning = { hp: 1, dmg: 1 };

/* ---------- live monsters ---------- */
export const monsters: Monster[] = [];
/** Can be seen, aimed at and hit (not dead, not still under the ground). */
export const targetable = (m: Monster) => !m.gone && m.state !== 'dead' && m.state !== 'buried';

let nextUid = 1;
/** Spawns a monster. `uid` comes from the host in co-op; `puppet` makes it follow snapshots (guest). */
export async function spawnMonster(id: MonId, x: number, z: number, nav: Nav, rise = false, uid = nextUid++, puppet = false, hpMul = 1): Promise<Monster> {
  nextUid = Math.max(nextUid, uid + 1);
  const d = MONSTERS[id], b = await loadMonster(id);
  const model = SkeletonUtils.clone(b.scene);
  const inner = new THREE.Group(); inner.add(model);
  model.scale.setScalar(b.scale); model.position.copy(b.off); inner.rotation.y = d.yaw ?? 0;
  const root = new THREE.Group(); root.add(inner); scene.add(root);
  const mats: THREE.MeshStandardMaterial[] = [];
  model.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.castShadow = true; m.frustumCulled = false;
    m.material = (Array.isArray(m.material) ? m.material : [m.material]).map(mt => {
      const n = mt.clone() as THREE.MeshStandardMaterial;
      if (d.ghost) { n.transparent = true; n.opacity = 0.55; n.depthWrite = false; n.emissive = C(0.25, 0.5, 0.9); n.emissiveIntensity = 0.6; }
      if (d.tint) n.color?.multiply(C(...d.tint));
      if (n.emissive) n.userData.e0 = n.emissive.clone();
      mats.push(n); return n;
    }) as unknown as THREE.Material;
    if (Array.isArray(m.material) && m.material.length === 1) m.material = m.material[0];
  });
  const mixer = new THREE.AnimationMixer(model), acts: Monster['acts'] = {};
  for (const [k, c] of Object.entries(b.clips) as [ClipKey, THREE.AnimationClip][]) acts[k] = mixer.clipAction(c);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(d.r * 3, d.r * 3), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);
  if (!puppet) [x, z] = navNearestFree(nav, x, z, d.r * 0.6);
  const m: Monster = {
    uid, puppet, nx: x, nz: z, nry: 0, speedMul: 1, target: 0,
    id, def: d, root, model, mixer, acts, cur: null, blob, mats,
    x, z, ry: Math.random() * Math.PI * 2, vx: 0, vz: 0, hp: Math.round(d.hp * tuning.hp * hpMul), state: 'idle', t: Math.random() * 3, hitT: 0, flash: 0,
    homeX: x, homeZ: z, wx: x, wz: z, struck: false, lx: 0, lz: 0, gone: false,
  };
  // Risers wait under the ground until the player comes close (see updateMonster).
  if (rise && acts.rise) { m.state = 'buried'; root.visible = false; blob.visible = false; }
  else act(m, 'idle');
  m.nry = m.ry;
  monsters.push(m);
  return m;
}

function act(m: Monster, k: ClipKey, once = false, speed = 1) {
  const a = m.acts[k] ?? (k === 'run' ? m.acts.walk : k === 'walk' ? m.acts.run : undefined) ?? m.acts.idle;
  if (!a) return 0;
  if (m.cur === a) { a.timeScale = speed; return 0; }
  a.reset(); a.timeScale = speed; a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = once;
  a.enabled = true; a.setEffectiveWeight(1);
  if (m.cur) a.crossFadeFrom(m.cur, 0.2, false);
  a.play(); m.cur = a;
  return a.getClip().duration / speed;
}

export function removeMonster(m: Monster) {
  scene.remove(m.root, m.blob); m.mixer.stopAllAction(); m.gone = true;
  m.mats.forEach(mt => mt.dispose());
}
export function clearMonsters() { monsters.forEach(removeMonster); monsters.length = 0; }

/** What a monster needs from the hunt: where the player is and how to hurt them. */
/** Something that hurts a player: where it came from and what it bleeds (a monster, or a boss hazard). */
export interface Hurter { x: number; z: number; def: { blood: Palette } }
/** A player as the monsters see it: where they are and how to hurt them. */
export interface Prey { x: number; z: number; dead: boolean; dodging: boolean; hurt: (dmg: number, from: Hurter) => void }

/** Damage from the player's spells. Returns true when it killed the monster. */
export function hurtMonster(m: Monster, dmg: number, fromX: number, fromZ: number) {
  if (m.state === 'dead' || m.state === 'buried') return false;
  m.hp -= dmg; m.flash = 1;
  const p = V(m.x, m.def.h * 0.6 + (m.def.float ?? 0), m.z);
  burst(p, m.def.blood, 14, 2.2, 0.5, 0.09);
  if (m.hp <= 0) { kill(m); return true; }
  // Being shot wakes it up and draws it to the shooter.
  if (m.state === 'idle' || m.state === 'wander') { m.state = 'chase'; roar(m); }
  // Small monsters flinch; big ones only when the hit is heavy.
  if (m.state !== 'attack' && (m.def.hp < 150 || dmg >= 25)) {
    m.state = 'hurt'; m.hitT = 0.35; m.t = 0;
    if (m.acts.hit) act(m, 'hit', true, 1.4);
    const dx = m.x - fromX, dz = m.z - fromZ, L = Math.hypot(dx, dz) || 1;
    m.vx = (dx / L) * 2.2; m.vz = (dz / L) * 2.2;
  }
  return false;
}

function roar(m: Monster) {
  if (m.acts.roar && Math.random() < 0.5) play('c_huge', { vol: 0.25, rate: m.def.h > 2 ? 0.7 : 1.3 });
}

function kill(m: Monster) {
  m.state = 'dead'; m.t = 0; m.hp = 0;
  if (m.acts.die) act(m, 'die', true, 1.2);
  else m.cur?.fadeOut(0.3);
  play('m_whoosh', { vol: 0.35 });
}

function tintFlash(m: Monster) {
  for (const mt of m.mats) if (mt.emissive && mt.userData.e0) mt.emissive.copy(mt.userData.e0 as THREE.Color).lerp(C(1, 0.25, 0.2), m.flash);
}

const tmp = V();
/** Per-frame update of one monster: senses, steering on the nav grid, attacks, animation and death. */
export function updateMonster(m: Monster, dt: number, nav: Nav, preys: Prey[]) {
  const d = m.def;
  m.t += dt; m.flash = Math.max(0, m.flash - dt * 4);
  tintFlash(m);
  // After the closest living player; keeps the current one unless another is clearly closer.
  let best = -1, bd = Infinity;
  preys.forEach((q, i) => { if (q.dead) return; const e = Math.hypot(q.x - m.x, q.z - m.z) - (i === m.target ? 2 : 0); if (e < bd) { bd = e; best = i; } });
  if (best >= 0) m.target = best;
  const prey = preys[m.target] ?? preys[0];
  const dx = prey.x - m.x, dz = prey.z - m.z, dist = Math.hypot(dx, dz);
  let want = 0, face: number | null = null;

  switch (m.state) {
    case 'buried':
      if (!prey.dead && dist < d.aggro * 0.8) {
        m.state = 'rise'; m.t = 0; m.ry = Math.atan2(dx, dz); m.root.visible = m.blob.visible = true;
        m.root.position.set(m.x, navHeight(nav, m.x, m.z), m.z); m.root.rotation.y = m.ry; act(m, 'rise', true, 1.3);
        for (let i = 0; i < 14; i++) emit(m.x + rnd(0.6), navHeight(nav, m.x, m.z) + 0.1, m.z + rnd(0.6), rnd(0.8), 0.6 + Math.random(), rnd(0.8), C(0.25, 0.2, 0.15), 0.3, 0.9, { t: 'smoke', smoke: 1, grow: 0.8, a: 0.5 });
      }
      return;
    case 'rise': if (m.t > (m.acts.rise?.getClip().duration ?? 1) / 1.3 * 0.9) { m.state = 'chase'; } break;
    case 'idle': case 'wander': {
      if (!prey.dead && dist < d.aggro) { m.state = 'chase'; roar(m); break; }
      // Stroll between random points near home.
      const wd = Math.hypot(m.wx - m.x, m.wz - m.z);
      if (m.state === 'idle') { if (m.t > 2.5 + Math.random() * 3) { m.state = 'wander'; m.t = 0; m.wx = m.homeX + rnd(6); m.wz = m.homeZ + rnd(6); } }
      else if (wd < 0.6 || m.t > 8) { m.state = 'idle'; m.t = 0; }
      else { want = d.walk; face = Math.atan2(m.wx - m.x, m.wz - m.z); }
      break;
    }
    case 'chase': {
      // Give up far from home or when the player is down; walk back.
      if (prey.dead || (d.hp < 500 && Math.hypot(m.x - m.homeX, m.z - m.homeZ) > 45)) { m.state = 'wander'; m.t = 0; m.wx = m.homeX; m.wz = m.homeZ; break; }
      face = Math.atan2(dx, dz);
      if (dist < d.range * 0.85) { m.state = 'attack'; m.t = 0; m.struck = false; act(m, d.lunge ? 'run' : 'attack', true, d.lunge ? 1.6 : 1.1); }
      else want = (dist > 6 ? d.run : Math.max(d.walk, d.run * 0.7)) * m.speedMul;
      break;
    }
    case 'attack': {
      face = m.t < d.windup ? Math.atan2(dx, dz) : null;
      // Leapers jump in at the end of the wind-up.
      if (d.lunge && m.t >= d.windup && m.t < d.windup + 0.25) { const L = dist || 1; if (!m.lx && !m.lz) { m.lx = (dx / L) * 7; m.lz = (dz / L) * 7; } m.vx = m.lx; m.vz = m.lz; }
      if (!m.struck && m.t >= d.windup) {
        m.struck = true; m.lx = m.lz = 0;
        if (!prey.dead && !prey.dodging && dist < d.range + 0.5) prey.hurt(d.dmg, m);
      }
      if (m.t > d.windup + d.rest) { m.state = 'chase'; m.t = 0; }
      break;
    }
    case 'hurt': m.hitT -= dt; if (m.hitT <= 0) m.state = 'chase'; break;
    case 'dead': {
      // Lie still a moment, then sink into the ground with a few motes.
      if (!m.acts.die) m.root.rotation.z = Math.min(Math.PI / 2, m.t * 4) * (m.id === 'spider' ? 0 : 1);
      if (m.t > 2.2) {
        m.root.position.y -= dt * 0.6;
        if (Math.random() < 0.3) emit(m.x + rnd(d.r), m.root.position.y + 0.3, m.z + rnd(d.r), 0, 0.6, 0, d.blood[0], 0.2, 0.8, { t: 'smoke', smoke: 1, a: 0.3 });
      }
      if (m.t > 4.5) removeMonster(m);
      m.mixer.update(dt);
      return;
    }
  }

  // Steering: accelerate towards the wanted speed along the facing, knock-back/leap decays by friction.
  if (face !== null) m.ry += clamp(angleDelta(m.ry, face), -6 * dt, 6 * dt);
  if (m.state === 'hurt' || (m.state === 'attack' && d.lunge)) { const f = Math.pow(0.02, dt); m.vx *= f; m.vz *= f; }
  else { const tx = Math.sin(m.ry) * want, tz = Math.cos(m.ry) * want; m.vx += (tx - m.vx) * Math.min(1, dt * 6); m.vz += (tz - m.vz) * Math.min(1, dt * 6); }
  const nx = navMove(nav, m.x, m.z, m.vx * dt, m.vz * dt, d.r * 0.5);
  // Stuck against a wall while chasing: try sidestepping.
  if (want > 0 && nx[0] === m.x && nx[1] === m.z) m.ry += (Math.random() < 0.5 ? 1 : -1) * 1.2;
  [m.x, m.z] = nx;
  // Keep a little space from the other monsters and from the player.
  for (const o of monsters) {
    if (o === m || o.state === 'dead') continue;
    const ex = m.x - o.x, ez = m.z - o.z, e = Math.hypot(ex, ez), min = (d.r + o.def.r) * 0.8;
    if (e < min && e > 1e-3) { const [a, b] = navMove(nav, m.x, m.z, (ex / e) * (min - e) * 0.5, (ez / e) * (min - e) * 0.5, d.r * 0.5); m.x = a; m.z = b; }
  }
  for (const q of preys) {
    if (q.dead) continue;
    const ex = q.x - m.x, ez = q.z - m.z, e = Math.hypot(ex, ez);
    if (e < d.r + 0.35 && e > 1e-3) { m.x -= (ex / e) * (d.r + 0.35 - e); m.z -= (ez / e) * (d.r + 0.35 - e); }
  }

  // Animation by speed (attack/hurt/rise play their own).
  const spd = Math.hypot(m.vx, m.vz);
  if (m.state !== 'attack' && m.state !== 'hurt' && m.state !== 'rise') {
    if (spd < 0.3) act(m, 'idle');
    else if (spd < (d.walk + d.run) / 2) act(m, 'walk', false, clamp(spd * (d.gait ?? 0.3) / Math.max(0.2, d.walk * (d.gait ?? 0.3)), 0.6, 1.6));
    else act(m, 'run', false, clamp(spd / d.run, 0.7, 1.4));
  }
  const fy = navHeight(nav, m.x, m.z), fl = d.float ? d.float + Math.sin(m.t * 2) * 0.08 : 0;
  m.root.position.set(m.x, fy + fl, m.z); m.root.rotation.y = m.ry;
  m.blob.position.set(m.x, fy + 0.03, m.z);
  m.mixer.update(dt);
  if (d.ghost && Math.random() < 0.3) { tmp.set(m.x + rnd(0.4), fy + fl + Math.random() * d.h, m.z + rnd(0.4)); emit(tmp.x, tmp.y, tmp.z, 0, 0.3, 0, SPIRIT[0], 0.12, 0.8, { t: 'magic' }); }
}

/**
 * Co-op guest: the host runs the monsters; here they glide to the last snapshot and play the matching animation.
 * `setNet` applies a snapshot entry, `updatePuppet` runs every frame.
 */
export function setNet(m: Monster, x: number, z: number, ry: number, st: number, hp: number) {
  const state = STATES[st] ?? 'idle', was = m.state;
  m.nx = x; m.nz = z; m.nry = ry; if (hp < m.hp) m.flash = 1; m.hp = hp;
  if (state === was) return;
  m.state = state; m.t = 0;
  if (state === 'buried') { m.root.visible = m.blob.visible = false; return; }
  m.root.visible = m.blob.visible = true;
  if (was === 'buried') { m.x = x; m.z = z; m.ry = ry; }
  if (state === 'rise') act(m, 'rise', true, 1.3);
  else if (state === 'attack') act(m, m.def.lunge ? 'run' : 'attack', true, m.def.lunge ? 1.6 : 1.1);
  else if (state === 'hurt' && m.acts.hit) act(m, 'hit', true, 1.4);
  else if (state === 'dead') kill(m);
}

export function updatePuppet(m: Monster, dt: number, nav: Nav) {
  const d = m.def;
  m.t += dt; m.flash = Math.max(0, m.flash - dt * 4); tintFlash(m);
  if (m.state === 'buried') return;
  if (m.state === 'dead') {
    if (m.t > 2.2) m.root.position.y -= dt * 0.6;
    if (m.t > 4.5) removeMonster(m);
    m.mixer.update(dt); return;
  }
  const px = m.x, pz = m.z, k = Math.min(1, dt * 10);
  m.x += (m.nx - m.x) * k; m.z += (m.nz - m.z) * k; m.ry += angleDelta(m.ry, m.nry) * k;
  const spd = Math.hypot(m.x - px, m.z - pz) / Math.max(dt, 1e-3);
  if (m.state !== 'attack' && m.state !== 'hurt' && m.state !== 'rise') {
    if (spd < 0.3) act(m, 'idle');
    else if (spd < (d.walk + d.run) / 2) act(m, 'walk');
    else act(m, 'run', false, clamp(spd / d.run, 0.7, 1.4));
  }
  const fy = navHeight(nav, m.x, m.z), fl = d.float ? d.float + Math.sin(m.t * 2) * 0.08 : 0;
  m.root.position.set(m.x, fy + fl, m.z); m.root.rotation.y = m.ry; m.blob.position.set(m.x, fy + 0.03, m.z);
  m.mixer.update(dt);
}

/** True when a hit from (x, z) lands on the monster's back (the boss's weak spot). */
export function fromBehind(m: Monster, x: number, z: number) {
  const dx = x - m.x, dz = z - m.z, L = Math.hypot(dx, dz) || 1;
  return (dx * Math.sin(m.ry) + dz * Math.cos(m.ry)) / L < -0.35;
}

/** Plays a one-off clip (the boss's roar when it changes phase). */
export function playClip(m: Monster, k: ClipKey) { return act(m, k, true); }
