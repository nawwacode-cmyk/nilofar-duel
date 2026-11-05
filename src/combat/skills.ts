import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { scene } from '../render/stage';
import { emit, burst, explosion } from '../render/particles';
import { fx } from '../game/state';
import { S, ch, opp, clones, walls, strikes, isLocal } from '../game/state';
import { base, chest, clipFor, tintModel } from '../fighters/fighter';
import { play, pr } from '../audio/audio';
import { portalRing } from '../fx/effects';
import { applyDmg } from './damage';
import { fire } from './actions';
import { G, DMG } from '../data/rules';
import { ICE, SHADOW, LIGHT, ARCH } from '../data/palettes';
import { V, C, rnd, pick, clamp, angleDelta } from '../core/util';
import type { CastOrder, Fighter, Projectile, Wall, Clone } from '../core/types';
import { after } from '../game/schedule';

/** Visual + gameplay side of each skill. `o.remote` means it was cast on the other device. */
/** Skills replayed by cast kind on both devices. */
export const SKFX: Record<string, (c: Fighter, o: CastOrder) => void> = {
  portal(c, o) {
    portalRing(o.x, o.z, c.pal);
    after(0.25, () => portalRing(o.dx, o.dz, c.pal));
    play('m_fire_swoosh', { vol: 0.7, x: o.x });
    after(0.3, () => play('m_whoosh', { vol: 0.6, x: o.dx }));
    c.warpT = 0.75; c.invT = 0.75;
    // The opponent loses track while she is inside the portal and for a moment after she steps out behind them.
    opp(c).turnLockT = 0.75 + G.portalBlind;
    if (!o.remote) c.warpTo = [o.dx, o.dz];
  },
  blink(c, o) {
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const k = i / n; const x = o.x + (o.dx - o.x) * k, z = o.z + (o.dz - o.z) * k;
      for (let y = 0.2; y < 1.8; y += 0.4) emit(x + rnd(0.12), y + rnd(0.15), z + rnd(0.12), rnd(0.3), rnd(0.3), rnd(0.3), pick(LIGHT), 0.12, 0.35, { t: 'spark' });
    }
    explosion(V(o.dx, 0.9, o.dz), LIGHT, 0.5);
    play('m_shock', { vol: 0.6, x: o.dx, dur: 1 });
    if (!o.remote) { c.x = o.dx; c.z = o.dz; c.invT = 0.25; c.vx = c.vz = 0; const t = opp(c); c.ry = Math.atan2(t.x - c.x, t.z - c.z); }
    c.light.intensity = 30;
  },
  wall(c, o) { spawnWall(c.idx, o.x, o.z, o.y); },
  clones(c, o) { spawnClones(c, o.x, o.z, o.y, !o.remote); },
  army(c, o) { spawnArmy(c, o.x, o.z, o.y); },
  melee(c, o) { meleeHit(c, o.dx, o.dz); },
  veil(c, o) {
    // Ehab leaves a perfect illusion of himself where he stood and, unseen, steps out behind his opponent.
    // Deliberately quiet: a faint shimmer and a soft sound, so the trick is not given away.
    c.veilT = G.veilT;
    spawnDecoy(c, o.x, o.z, o.y);
    for (let i = 0; i < 10; i++) emit(o.x + rnd(0.4), 0.2 + Math.random() * 1.6, o.z + rnd(0.4), rnd(0.2), 0.3, rnd(0.2), pick(ARCH), 0.08, 0.5, { t: 'twirl', a: 0.5 });
    play('m_sparkle', { vol: 0.25, x: o.x, dur: 0.8 });
    c.warpT = 0.75; c.invT = Math.max(c.invT, 0.45);
    // The opponent loses track of him like after Reem's portal.
    opp(c).turnLockT = Math.max(opp(c).turnLockT, 0.75 + G.portalBlind);
    if (!o.remote && (o.dx || o.dz)) c.warpTo = [o.dx, o.dz];
  },
};

/**
 * Leaving the veil: any spell cast while hidden reveals Ehab.
 * Called for local and replayed casts alike, so both devices agree.
 */
export function unveilCast(c: Fighter) {
  if (c.veilT <= 0) return;
  c.veilT = 0;
  for (const cl of clones.slice()) if (cl.owner === c.idx && cl.decoy) killClone(cl);
  for (let i = 0; i < 10; i++) emit(c.x + rnd(0.3), 0.2 + Math.random() * 1.6, c.z + rnd(0.3), rnd(0.3), 0.3, rnd(0.3), pick(ARCH), 0.08, 0.4, { t: 'spark', a: 0.6 });
  play('m_light', { vol: 0.3, x: c.x, dur: 0.8 });
}

/* ---------- close combat ---------- */
/** The shove lands on the victim's device (victim authority); both devices show it. */
function meleeHit(c: Fighter, dx: number, dz: number) {
  const o = opp(c);
  play('m_whoosh', { vol: 0.5, x: c.x, rate: 1.4 });
  after(0.1, () => {
    if (c.dead || o.dead || S.state !== 'fight') return;
    if (Math.hypot(o.x - c.x, o.z - c.z) > G.meleeRange + 0.4) return; // stepped away in time
    const h = chest(o);
    for (let i = 0; i < 14; i++) emit(h.x + rnd(0.15), h.y + rnd(0.2), h.z + rnd(0.15), dx * 2 + rnd(1), rnd(1), dz * 2 + rnd(1), pick(c.pal), 0.1, 0.3, { t: 'spark' });
    play('tap', { vol: 0.9, x: o.x, rate: 0.6 }); play('boom1', { vol: 0.25, x: o.x, rate: 1.6 });
    if (!isLocal(o) || o.dodgeT > 0.05 || o.invT > 0) return;
    // A raised shield takes the blow but is still pushed back.
    if (!o.shieldOn) applyDmg(o, DMG.melee, c);
    o.vx = dx * G.meleePush; o.vz = dz * G.meleePush; o.knockT = 0.35;
  });
  if (isLocal(c)) { c.vx = -dx * 2.5; c.vz = -dz * 2.5; c.knockT = 0.15; } // recoil
}

/* ---------- Ehab's illusion army ---------- */
/**
 * Illusions of Ehab multiply in a ring around the opponent and hold them (stun), then all strike at once.
 * Dodging or being invulnerable at the moment they appear escapes it; a raised shield shortens the hold and
 * softens the blow. Stun and damage are applied on the victim's device; both devices show the scene.
 */
const ARMY = 8, ARMY_R = 1.9, ARMY_STRIKE = 1.0;
function spawnArmy(c: Fighter, x: number, z: number, seed: number) {
  const v = opp(c);
  const escaped = v.dodgeT > 0.05 || v.invT > 0, shielded = v.shieldOn;
  const tint = c.tint ?? new THREE.Color(1, 1, 1);
  const units = Array.from({ length: ARMY }, (_, k) => {
    const a = (k / ARMY) * Math.PI * 2 + (seed % 100) / 100;
    const m = SkeletonUtils.clone(base[c.ri]);
    m.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      mesh.material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(mt => {
        const n = mt.clone() as THREE.MeshStandardMaterial; n.transparent = true; n.opacity = 0.8; n.depthWrite = false;
        n.color?.multiply(tint); if (n.emissive) n.emissive.setRGB(0.35, 0.24, 0.05); return n;
      })[0];
    });
    const g = new THREE.Group(); g.add(m); m.position.y = c.model.position.y;
    const px = x + Math.cos(a) * ARMY_R, pz = z + Math.sin(a) * ARMY_R;
    g.position.set(px, 0, pz); g.rotation.y = Math.atan2(x - px, z - pz); scene.add(g);
    const mx = new THREE.AnimationMixer(m);
    const idle = mx.clipAction(clipFor(c.ri, 'idle', m)), hit = mx.clipAction(clipFor(c.ri, 'bolt', m));
    idle.time = Math.random(); idle.play();
    for (let i = 0; i < 10; i++) emit(px + rnd(0.3), 0.2 + Math.random() * 1.6, pz + rnd(0.3), rnd(0.5), 0.5, rnd(0.5), pick(ARCH), 0.12, 0.5, { t: 'twirl' });
    return { g, mx, idle, hit, px, pz };
  });
  play('m_arcane', { vol: 0.8, x }); play('m_cast_long', { vol: 0.5, x });
  emit(x, 0.05, z, 0, 0, 0, ARCH[1], 0.8, 1.2, { t: 'rune', spin: 1.5, grow: 4 });
  if (!escaped && isLocal(v) && S.state === 'fight') v.stunT = Math.max(v.stunT, shielded ? G.armyStunShielded : G.armyStun);
  let t = 0, struck = false;
  fx.push(dt => {
    t += dt;
    for (const u of units) u.mx.update(dt);
    if (!struck && t > ARMY_STRIKE) {
      struck = true;
      for (const u of units) { u.idle.stop(); u.hit.reset().setLoop(THREE.LoopOnce, 1).play(); }
      play('m_blast', { vol: 0.8, x }); S.shake = Math.max(S.shake, 0.12);
      explosion(V(v.x, 1, v.z), ARCH, 1.1);
      if (!escaped && isLocal(v) && S.state === 'fight' && !v.dead) applyDmg(v, shielded ? DMG.armyShielded : DMG.army, c);
    }
    // Dash in for the strike, then fade away.
    const k = clamp((t - ARMY_STRIKE + 0.25) / 0.25, 0, 1);
    for (const u of units) {
      u.g.position.set(u.px + (v.x - u.px) * k * 0.55, 0, u.pz + (v.z - u.pz) * k * 0.55);
      if (t > ARMY_STRIKE + 0.3) u.g.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) (mesh.material as THREE.Material).opacity = Math.max(0, 0.8 - (t - ARMY_STRIKE - 0.3) * 2); });
    }
    if (t < ARMY_STRIKE + 0.75) return true;
    for (const u of units) { scene.remove(u.g); u.mx.stopAllAction(); }
    return false;
  });
}

/* ---------- Ehab's decoy ---------- */
function spawnDecoy(c: Fighter, x: number, z: number, ry: number) {
  for (const cl of clones.slice()) if (cl.owner === c.idx && cl.decoy) killClone(cl, false);
  const m = SkeletonUtils.clone(base[c.ri]);
  // The illusion must look exactly like him, mirror-match costume included.
  if (c.tint) { m.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(x => x.clone()) : mesh.material.clone(); }); tintModel(m, c.tint); }
  const g = new THREE.Group(); g.add(m); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  m.position.y = c.model.position.y;
  const mx = new THREE.AnimationMixer(m);
  const act = { idle: mx.clipAction(clipFor(c.ri, 'idle', m)), walkL: mx.clipAction(clipFor(c.ri, 'walkL', m)), walkR: mx.clipAction(clipFor(c.ri, 'walkR', m)), bolt: mx.clipAction(clipFor(c.ri, 'bolt', m)) };
  act.idle.play();
  clones.push({ owner: c.idx, g, mx, act, x, z, ox: x, oz: z, sgn: 1, t: G.veilT, fireT: 99, owned: true, ph: 0, decoy: true });
}

/* ---------- ice wall ---------- */
function spawnWall(owner: 0 | 1, x: number, z: number, ry: number) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const mat = new THREE.MeshStandardMaterial({ color: 0xcfefff, emissive: 0x2a7ad0, emissiveIntensity: 0.55, transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0.1, flatShading: true, depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const h = 1.4 + Math.random() * 1.1;
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.22 + Math.random() * 0.12, h, 5), mat);
    sp.position.set(-1.2 + i * 0.3 + rnd(0.05), h / 2, rnd(0.08)); sp.rotation.z = rnd(0.12); g.add(sp);
  }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 0.22, 6, 3, 1), mat); slab.position.y = 0.75; g.add(slab);
  g.position.y = -2.4; scene.add(g);
  walls.push({ owner, x, z, ry, g, t: 5 });
  play('m_ice', { vol: 0.8, x }); play('m_shatter', { vol: 0.35, x, rate: 1.4 });
  for (let i = 0; i < 40; i++) emit(x + rnd(1.3), 0.1, z + rnd(0.3), rnd(1), 2 + Math.random() * 2, rnd(1), pick(ICE), 0.14, 0.7, { t: 'star', grav: -5 });
  for (let i = 0; i < 8; i++) emit(x + rnd(1.3), 0.2, z + rnd(0.3), rnd(0.3), 0.4, rnd(0.3), C(0.6, 0.7, 0.8), 0.7, 1.4, { t: 'smoke', smoke: 1, grow: 0.6, a: 0.35 });
}

export function killWall(w: Wall) {
  const i = walls.indexOf(w); if (i < 0) return;
  walls.splice(i, 1); scene.remove(w.g);
  burst(V(w.x, 1, w.z), ICE, 70, 4, 0.8, 0.12, 'star');
  play('m_shatter', { vol: 0.5, x: w.x });
}

export function updWalls(dt: number) {
  for (const w of walls.slice()) {
    w.t -= dt; w.g.position.y += (0 - w.g.position.y) * Math.min(1, dt * 10);
    if (Math.random() < 0.3) emit(w.x + rnd(1.2), 0.1 + Math.random() * 2, w.z, 0, 0.2, 0, pick(ICE), 0.1, 0.5, { t: 'star' });
    if (w.t <= 0) killWall(w);
  }
}

/** Enemy wall in the projectile's path, if any (wall-local box test). */
export function wallHit(p: Projectile) {
  for (const w of walls) {
    if (w.owner === p.owner) continue;
    const dx = p.pos.x - w.x, dz = p.pos.z - w.z; const c = Math.cos(w.ry), s = Math.sin(w.ry);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < 1.35 && Math.abs(lz) < 0.35 && p.pos.y < 2.4) return w;
  }
  return null;
}

/* ---------- shadow clones ---------- */
function spawnClones(c: Fighter, x: number, z: number, seed: number, owned: boolean) {
  for (let k = 0; k < 2; k++) {
    const m = SkeletonUtils.clone(base[c.ri]);
    m.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(mt => {
        const n = mt.clone() as THREE.MeshPhongMaterial; n.transparent = true; n.opacity = 0.72;
        if (n.emissive) n.emissive.setRGB(0.25, 0.05, 0.4); n.color?.multiplyScalar(0.6); return n;
      });
      mesh.material = mats.length === 1 ? mats[0] : mats;
    });
    const g = new THREE.Group(); g.add(m); scene.add(g);
    const mx = new THREE.AnimationMixer(m);
    const act = { idle: mx.clipAction(clipFor(c.ri, 'idle', m)), walkL: mx.clipAction(clipFor(c.ri, 'walkL', m)), walkR: mx.clipAction(clipFor(c.ri, 'walkR', m)), bolt: mx.clipAction(clipFor(c.ri, 'bolt', m)) };
    act.walkL.play();
    const sgn = k ? 1 : -1;
    clones.push({ owner: c.idx, g, mx, act, x, z, ox: x, oz: z, sgn, t: 6.5, fireT: 0.9 + k * 0.5 + ((seed >> k) % 5) * 0.1, owned, ph: (seed % 100) / 10 + k * 2 });
    for (let i = 0; i < 25; i++) emit(x + rnd(0.4), 0.1 + Math.random() * 1.6, z + rnd(0.4), rnd(1.5) + sgn * 1.5, 0.3, rnd(1.5), pick(SHADOW), 0.2, 0.6, { t: 'twirl' });
  }
  play('m_arcane', { vol: 0.7, x });
}

export function killClone(cl: Clone, puff = true) {
  const i = clones.indexOf(cl); if (i < 0) return;
  clones.splice(i, 1); scene.remove(cl.g); cl.mx.stopAllAction();
  if (puff) {
    const pal = cl.decoy ? ARCH : SHADOW;
    for (let k = 0; k < 30; k++) emit(cl.x + rnd(0.3), 0.2 + Math.random() * 1.5, cl.z + rnd(0.3), rnd(1), 0.6, rnd(1), pick(pal), 0.25, 0.6, { t: 'twirl' });
    for (let k = 0; k < 6; k++) emit(cl.x, 0.8, cl.z, rnd(0.4), 0.3, rnd(0.4), C(0.08, 0.04, 0.12), 0.8, 1.2, { t: 'smoke', smoke: 1, grow: 0.6, a: 0.5 });
    play('m_fastmagic', { vol: 0.4, x: cl.x, rate: 0.7, dur: 1 });
  }
}

/** Clones orbit beside their owner's target and fire small bolts (only the owning device spawns them). */
export function updClones(dt: number) {
  for (const cl of clones.slice()) {
    cl.t -= dt;
    const own = S.CH[cl.owner], tg = S.CH[1 - cl.owner];
    if (!own || !tg) { killClone(cl, false); continue; }
    if (cl.decoy) {
      // The illusion stands its ground, keeps facing the enemy and dissolves when the veil ends.
      cl.g.rotation.y += angleDelta(cl.g.rotation.y, Math.atan2(tg.x - cl.x, tg.z - cl.z)) * Math.min(1, dt * 4);
      cl.mx.update(dt);
      if (cl.t <= 0 || own.veilT <= 0 || S.state === 'ko') killClone(cl);
      continue;
    }
    const ax = tg.x - cl.x, az = tg.z - cl.z, L = Math.hypot(ax, az) || 1;
    const tx = clamp(cl.ox + cl.sgn * (1.8 + Math.sin(S.T * 1.3 + cl.ph) * 0.8) * (-az / L), -G.bx, G.bx);
    const tz = clamp(cl.oz + cl.sgn * (1.8 + Math.sin(S.T * 1.1 + cl.ph) * 0.8) * (ax / L), G.zMin, G.zMax);
    cl.x += (tx - cl.x) * Math.min(1, dt * 2.5); cl.z += (tz - cl.z) * Math.min(1, dt * 2.5);
    cl.g.position.set(cl.x, 0, cl.z); cl.g.rotation.y = Math.atan2(ax, az); cl.mx.update(dt);
    if (Math.random() < 0.25) emit(cl.x + rnd(0.3), 0.1 + Math.random() * 1.6, cl.z + rnd(0.3), 0, 0.3, 0, pick(SHADOW), 0.12, 0.5, { t: 'twirl' });
    cl.fireT -= dt;
    if (cl.fireT <= 0 && S.state === 'fight') {
      cl.fireT = 1.1 + Math.random() * 0.6;
      cl.act.bolt.reset().setLoop(THREE.LoopOnce, 1).play();
      if (cl.owned) after(0.17, () => {
        if (!clones.includes(cl) || S.state !== 'fight') return;
        const s = V(cl.x, 1.4, cl.z); const d = chest(tg).sub(s); d.y *= 0.5;
        fire(own, { kind: 'shmini', x: s.x, y: s.y, z: s.z, dx: d.x, dy: d.y, dz: d.z });
      });
    }
    if (cl.t <= 0 || S.state === 'ko') killClone(cl);
  }
}

/* ---------- thunder strike ---------- */
export function spawnStrike(owner: 0 | 1, x: number, z: number, remote?: boolean) {
  strikes.push({ owner, x, z, t: 0.75, remote });
  play('bolt1', { vol: 0.3, rate: 1.6, x });
}

export function updStrikes(dt: number) {
  for (const s of strikes) {
    s.t -= dt;
    if (s.t > 0) {
      if (Math.random() < 0.6) emit(s.x + rnd(1), 0.05, s.z + rnd(1), 0, 0.1, 0, LIGHT[0], 0.25, 0.3, { t: 'spark' });
      emit(s.x, 0.05, s.z, 0, 0, 0, LIGHT[1], 2.2, 0.06, { t: 'rune', spin: 4 });
    } else if (!s.done) {
      s.done = true; const o = ch(1 - s.owner);
      for (let y = 0; y < 9; y += 0.25) emit(s.x + rnd(0.15), y, s.z + rnd(0.15), 0, 0, 0, pick(LIGHT), 0.5, 0.25, { t: 'spark' });
      explosion(V(s.x, 0.3, s.z), LIGHT, 1.2);
      play('m_thunder', { vol: 1, x: s.x }); play(pr('bolt'), { vol: 0.6, x: s.x });
      S.shake = Math.max(S.shake, 0.2); ch(s.owner).light.intensity = 40;
      if (isLocal(o) && !o.dead && S.state === 'fight' && Math.hypot(o.x - s.x, o.z - s.z) < DMG.thunderRadius) {
        if (o.dodgeT > 0.08 || o.invT > 0) { /* dodged */ }
        else if (o.shieldOn) { o.shield?.hit(); applyDmg(o, DMG.thunderShielded, ch(s.owner)); }
        else applyDmg(o, DMG.thunder, ch(s.owner));
      }
    }
  }
  for (let i = strikes.length - 1; i >= 0; i--) if (strikes[i].done) strikes.splice(i, 1);
}
