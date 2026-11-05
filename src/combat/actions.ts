import { S, net, opp, clones } from '../game/state';
import { anim, tipPos, chest } from '../fighters/fighter';
import { play } from '../audio/audio';
import { emit } from '../render/particles';
import { flash, shieldMesh } from '../fx/effects';
import { spawnProj } from './projectiles';
import { SKFX, spawnStrike, unveilCast, MELEE } from './skills';
import { G } from '../data/rules';
import { V, C, rnd, pick, clamp } from '../core/util';
import type { CastOrder, Fighter, ProjKind } from '../core/types';
import { after } from '../game/schedule';

/**
 * Executes a cast locally and queues it for the peer when online.
 * Casts are replayed on the other device by netRecv with remote=true.
 */
export function fire(c: Fighter, o: CastOrder) {
  if (o.kind === 'thunder') { unveilCast(c); spawnStrike(c.idx, o.x, o.z); }
  else if (o.kind in SKFX) { if (o.kind !== 'veil') unveilCast(c); SKFX[o.kind as keyof typeof SKFX](c, o); }
  else { const p = spawnProj({ ...o, kind: o.kind as ProjKind, owner: c.idx }); o.id = p.id; unveilCast(c); }
  if (S.mode === 'online' && c.idx === net.me) {
    net.casts.push([o.id ?? ++S.projId, o.kind, +o.x.toFixed(3), +o.y.toFixed(3), +o.z.toFixed(3), +o.dx.toFixed(3), +o.dy.toFixed(3), +o.dz.toFixed(3)]);
    if (net.casts.length > 8) net.casts.shift();
    net.urgent = true;
  }
}

/** Wand tip and aim vector at the opponent's chest (AI sometimes targets a clone). */
function aimAt(c: Fighter): [ReturnType<typeof V>, ReturnType<typeof V>] {
  const s = tipPos(c);
  let t = chest(opp(c));
  // In the balance simulator both sides are the computer, so both are fooled the same way.
  if (S.mode !== 'online' && (c.idx === 1 || S.sim)) {
    const cs = clones.filter(k => k.owner !== c.idx);
    const decoy = cs.find(k => k.decoy);
    // The computer cannot see a veiled Ehab: it attacks his illusion (or guesses).
    if (decoy) t = V(decoy.x, 1.3, decoy.z);
    else if (opp(c).veilT > 0) t.set(t.x + rnd(2.5), 1.3, t.z + rnd(2.5));
    else if (cs.length && Math.random() < 0.6) { const k = pick(cs); t = V(k.x, 1.3, k.z); }
  }
  const d = t.sub(s); d.y *= 0.55;
  // Wizards cast where they face: with the target outside the cone (e.g. right after a portal behind them)
  // the spell flies straight ahead and misses until they have turned around.
  const fx = Math.sin(c.ry), fz = Math.cos(c.ry), h = Math.hypot(d.x, d.z) || 1;
  if ((d.x * fx + d.z * fz) / h < G.castCone) { d.x = fx * h; d.z = fz * h; }
  return [s, d];
}

export function castBolt(c: Fighter) {
  if (c.dead || c.stunT > 0 || c.shieldOn || c.cdA > 0 || c.dodgeT > 0 || c.castT > 0.1) return;
  if (melee(c)) return;
  if (c.mana < G.boltCost) return;
  c.cdA = c.R.bolt.cd; c.mana -= G.boltCost; c.castT = 0.36;
  anim(c, 'bolt', { once: true, speed: 1.7, force: true });
  play(c.R.cs, { vol: 0.45, x: c.x, dur: 1.1 });
  after(0.17, () => {
    if (c.dead || S.state !== 'fight') return;
    const [s, d] = aimAt(c);
    fire(c, { kind: c.R.bolt.kind, x: s.x, y: s.y, z: s.z, dx: d.x, dy: d.y, dz: d.z }); flash(c, 8);
    for (let i = 0; i < 8; i++) emit(s.x, s.y, s.z, rnd(1) + d.x * 0.1, rnd(1), rnd(1) + d.z * 0.1, pick(c.pal), 0.18, 0.25, { t: 'spark' });
  });
}

export function castSpecial(c: Fighter) {
  if (c.dead || c.stunT > 0 || c.shieldOn || c.mana < G.spCost || c.dodgeT > 0 || c.castT > 0.1) return;
  c.mana -= G.spCost; c.castT = 0.9;
  anim(c, 'special', { once: true, speed: 1.25, force: true }); play(c.R.ss, { vol: 0.8, x: c.x });
  const p = chest(c);
  for (let i = 0; i < 30; i++) emit(p.x + rnd(0.5), 0.1 + Math.random() * 1.8, p.z + rnd(0.5), rnd(0.3), 1.2, rnd(0.3), pick(c.pal), 0.25, 0.7, { t: 'magic' });
  emit(c.x, 0.05, c.z, 0, 0, 0, c.pal[1], 0.5, 0.8, { t: 'rune', spin: 1.5, grow: 3 });
  after(0.48, () => {
    if (c.dead || S.state !== 'fight') return;
    const [s, d] = aimAt(c); const o = opp(c);
    switch (c.R.spec) {
      case 'meteor':
        play('m_meteor', { vol: 0.7, x: c.x });
        fire(c, { kind: 'meteor', x: s.x, y: s.y, z: s.z, dx: d.x, dy: d.y, dz: d.z }); break;
      case 'spears': {
        const b = Math.atan2(d.x, d.z);
        for (const a of [-0.2, 0, 0.2]) fire(c, { kind: 'spear', x: s.x, y: s.y, z: s.z, dx: Math.sin(b + a), dy: d.y / Math.hypot(d.x, d.z), dz: Math.cos(b + a) });
        break;
      }
      case 'curse': fire(c, { kind: 'curse', x: s.x, y: s.y + 0.2, z: s.z, dx: d.x, dy: 0.3, dz: d.z }); break;
      case 'thunder': fire(c, { kind: 'thunder', x: o.x, y: 0, z: o.z, dx: 0, dy: 0, dz: 0 }); break;
      case 'orbs': {
        // Five golden orbs fan out wide, then curve in on the opponent from every side.
        const b = Math.atan2(d.x, d.z);
        for (const a of [-0.6, -0.3, 0, 0.3, 0.6]) fire(c, { kind: 'orb', x: s.x, y: s.y + 0.1, z: s.z, dx: Math.sin(b + a), dy: 0.15, dz: Math.cos(b + a) });
        play('m_epic', { vol: 0.5, x: c.x, dur: 1.5 });
        break;
      }
    }
    flash(c, 22); S.shake = Math.max(S.shake, 0.05);
  });
}

/** Dash along input (or sideways relative to the opponent when standing still). */
export function dodge(c: Fighter) {
  if (c.dead || c.stunT > 0 || c.cdD > 0 || c.mana < c.R.dodgeCost || c.dodgeT > 0) return;
  setShield(c, false);
  c.mana -= c.R.dodgeCost; c.cdD = G.dodgeCd; c.dodgeT = 0.5; play('m_sparkle', { vol: 0.4, x: c.x, dur: 1.2 });
  let dx = c.inX, dz = c.inZ;
  if (Math.hypot(dx, dz) < 0.2) {
    const o = opp(c); const ax = o.x - c.x, az = o.z - c.z; const L = Math.hypot(ax, az) || 1; const s = c.z > 0 ? 1 : -1;
    dx = (-az / L) * s; dz = (ax / L) * s;
  }
  c.dodgeDir.set(dx, 0, dz).normalize(); anim(c, 'evade', { once: true, speed: 1.9, force: true });
  for (let i = 0; i < 20; i++) emit(c.x + rnd(0.3), 0.1 + Math.random() * 1.5, c.z + rnd(0.3), rnd(0.6), 0.5, rnd(0.6), pick(c.pal), 0.2, 0.5, { t: 'twirl' });
  for (let i = 0; i < 5; i++) emit(c.x + rnd(0.3), 0.1, c.z + rnd(0.3), rnd(0.6), 0.3, rnd(0.6), C(0.2, 0.2, 0.25), 0.5, 0.8, { t: 'smoke', smoke: 1, grow: 0.8, a: 0.4 });
}

export function setShield(c: Fighter, on: boolean) {
  if (on && !c.shieldOn && !c.dead && c.dodgeT <= 0 && c.stunT <= 0 && c.cdS <= 0 && c.mana > 5) {
    c.shieldOn = true; c.shieldT = S.T; c.shHP = G.shHP; c.shield = shieldMesh(c);
    anim(c, 'block', { force: true }); play('m_waves', { vol: 0.6, x: c.x });
  }
  if (!on && c.shieldOn) { c.shieldOn = false; c.cdS = G.shCd; if (c.shield) { c.shield.off(); c.shield = null; } }
}

/**
 * Close combat: when the two wizards are almost touching, the attack button becomes a shove with the wand hand
 * that throws the opponent back, so duels return to spell range. Free of mana, same rhythm as the basic bolt.
 */
function melee(c: Fighter) {
  const o = opp(c); const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz);
  if (d > G.meleeRange || o.dead) return false;
  const v = (Math.random() * MELEE.length) | 0, m = MELEE[v];
  c.cdA = c.R.bolt.cd; c.castT = m.hit + 0.15;
  anim(c, m.clip, { once: true, speed: m.speed, force: true });
  fire(c, { kind: 'melee', x: c.x, y: v, z: c.z, dx: dx / (d || 1), dy: 0, dz: dz / (d || 1) });
  return true;
}

/** Character-specific movement/utility skill (U). */
export function castSkill(c: Fighter) {
  const K = c.R.skill;
  if (c.dead || c.stunT > 0 || c.cdK > 0 || c.mana < K.cost || c.castT > 0.1 || c.warpT > 0) return;
  c.mana -= K.cost; c.cdK = K.cd; setShield(c, false);
  const o = opp(c);
  // Exit beside and behind the opponent, on whichever side stays inside the arena (portal and veil).
  const behind = () => {
    const d = V(o.x - c.x, 0, o.z - c.z).normalize();
    const side = o.z + -d.x * 1.4 < G.zMax && o.z + -d.x * 1.4 > G.zMin ? 1 : -1;
    return [clamp(o.x + d.x * 1.9 + -d.z * 1.2 * side, -G.bx, G.bx), clamp(o.z + d.z * 1.9 + d.x * 1.2 * side, G.zMin, G.zMax)];
  };
  if (K.k === 'portal') { const [ex, ez] = behind(); fire(c, { kind: 'portal', x: c.x, y: 0, z: c.z, dx: ex, dy: 0, dz: ez }); }
  if (K.k === 'blink') {
    let dx = c.inX, dz = c.inZ;
    if (Math.hypot(dx, dz) < 0.2) { const ax = o.x - c.x, az = o.z - c.z, L = Math.hypot(ax, az) || 1; const s = c.z > 0 ? -1 : 1; dx = (-az / L) * s; dz = (ax / L) * s; }
    const L = Math.hypot(dx, dz) || 1;
    fire(c, { kind: 'blink', x: c.x, y: 0, z: c.z, dx: clamp(c.x + (dx / L) * 4, -G.bx, G.bx), dy: 0, dz: clamp(c.z + (dz / L) * 4, G.zMin, G.zMax) });
  }
  if (K.k === 'wall') { const d = V(o.x - c.x, 0, o.z - c.z).normalize(); fire(c, { kind: 'wall', x: c.x + d.x * 1.5, y: Math.atan2(d.x, d.z), z: c.z + d.z * 1.5, dx: 0, dy: 0, dz: 0 }); }
  if (K.k === 'clones') fire(c, { kind: 'clones', x: c.x, y: (Math.random() * 1e5) | 0, z: c.z, dx: 0, dy: 0, dz: 0 });
  if (K.k === 'veil') { const [ex, ez] = behind(); fire(c, { kind: 'veil', x: c.x, y: c.ry, z: c.z, dx: ex, dy: 0, dz: ez }); }
  if (K.k === 'bloom') { c.castT = 0.4; anim(c, 'special', { once: true, speed: 1.8, force: true }); fire(c, { kind: 'bloom', x: c.x, y: 0, z: c.z, dx: 0, dy: 0, dz: 0 }); }
  if (K.k === 'gust') { const d = V(o.x - c.x, 0, o.z - c.z).normalize(); c.castT = 0.35; anim(c, 'bolt', { once: true, speed: 1.6, force: true }); fire(c, { kind: 'gust', x: c.x, y: 0, z: c.z, dx: d.x, dy: 0, dz: d.z }); }
}

/** The optional fourth ability (Y): Ehab's illusion army. */
export function castSkill2(c: Fighter) {
  const K = c.R.skill2;
  if (!K || c.dead || c.stunT > 0 || c.cdK2 > 0 || c.mana < K.cost || c.castT > 0.1 || c.warpT > 0) return;
  c.mana -= K.cost; c.cdK2 = K.cd; setShield(c, false); c.castT = 0.5;
  anim(c, 'special', { once: true, speed: 1.6, force: true });
  const o = opp(c);
  // The tornado starts at Abed and chases; the others appear at the opponent.
  if (K.k === 'tornado') { const d = V(o.x - c.x, 0, o.z - c.z).normalize(); fire(c, { kind: 'tornado', x: c.x + d.x, y: 0, z: c.z + d.z, dx: d.x, dy: 0, dz: d.z }); return; }
  fire(c, { kind: K.k, x: o.x, y: (Math.random() * 1e5) | 0, z: o.z, dx: 0, dy: 0, dz: 0 });
}
