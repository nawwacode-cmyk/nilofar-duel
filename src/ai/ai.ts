import { S, opp, projs, strikes } from '../game/state';
import { castBolt, castSpecial, castSkill, castSkill2, dodge } from '../combat/actions';
import { G, AI_LEVELS } from '../data/rules';
import { V } from '../core/util';
import type { Fighter, Projectile } from '../core/types';
import { after } from '../game/schedule';

/** Computer opponent: keeps a preferred range, strafes, reacts to incoming spells, uses skills. */
type AiState = { t: number; strafe: number; nextAtk: number; shieldUntil: number; skT: number };
/** One brain per side, so the balance simulator can let the computer play both fighters. */
const brains: [AiState, AiState] = [0, 1].map(() => ({ t: 0, strafe: 1, nextAtk: 1, shieldUntil: 0, skT: 0 })) as [AiState, AiState];

/** Most imminent enemy projectile that will pass within reach in the next 0.7 s. */
function findThreat(c: Fighter): { p: Projectile | null; t: number } {
  let threat: Projectile | null = null, tmin = 9;
  for (const p of projs) {
    if (p.dead || p.owner === c.idx) continue;
    const rel = V(c.x - p.pos.x, 0, c.z - p.pos.z); const v2 = V(p.vel.x, 0, p.vel.z); const sp = v2.length();
    if (sp < 0.1) continue;
    const t = rel.dot(v2) / (sp * sp);
    if (t < 0 || t > 0.7) continue;
    const miss = rel.clone().addScaledVector(v2, -t).length();
    if (miss < p.r + 0.55 && t < tmin) { tmin = t; threat = p; }
  }
  return { p: threat, t: tmin };
}

export function aiThink(c: Fighter, dt: number) {
  const o = opp(c); const D = AI_LEVELS[S.diff]; const ai = brains[c.idx];
  ai.t += dt;
  const ax = o.x - c.x, az = o.z - c.z, dist = Math.hypot(ax, az) || 1;
  const want = 5.8 + Math.sin(ai.t * 0.5) * 1.2;
  if (Math.random() < dt * 0.5) ai.strafe *= -1;
  let mx = (ax / dist) * (dist - want) * 0.6 + (-az / dist) * ai.strafe * 0.7;
  let mz = (az / dist) * (dist - want) * 0.6 + (ax / dist) * ai.strafe * 0.7;
  // Run from thunder marks.
  for (const s of strikes) if (s.owner !== c.idx && !s.done && Math.hypot(c.x - s.x, c.z - s.z) < 1.6 && Math.random() < D.dodge * dt * 8) { mx = c.x - s.x; mz = c.z - s.z; }
  if (c.z > G.zMax - 0.7) mz = Math.min(mz, -0.7);
  if (c.z < G.zMin + 0.7) mz = Math.max(mz, 0.7);
  const L = Math.hypot(mx, mz); if (L > 1) { mx /= L; mz /= L; }
  c.inX = mx; c.inZ = mz;

  const { p: threat, t: tmin } = findThreat(c);
  if (threat && !threat.seenByAi) {
    threat.seenByAi = true; const r = Math.random();
    if (r < D.parry && threat.kind !== 'meteor') after(Math.max(0, tmin - 0.12), () => { if (!c.dead) { c.wantShield = true; ai.shieldUntil = S.T + 0.5; } });
    else if (r < D.dodge) after((D.react), () => { if (c.mana >= c.R.dodgeCost) dodge(c); else { c.wantShield = true; ai.shieldUntil = S.T + 0.6; } });
  }
  if (ai.shieldUntil && S.T > ai.shieldUntil) { c.wantShield = false; ai.shieldUntil = 0; }

  const K = c.R.skill.k; ai.skT -= dt;
  if (c.cdK <= 0 && c.mana >= c.R.skill.cost + 5 && ai.skT <= 0 && Math.random() < dt * D.skill) {
    if (K === 'wall' && threat) { castSkill(c); ai.skT = 2; }
    else if (K === 'blink' && threat && tmin < 0.45) { castSkill(c); ai.skT = 1; }
    else if (K === 'portal' && (dist > 6 || Math.random() < 0.3)) { castSkill(c); ai.skT = 3; after(0.9, () => { if (!c.dead) castBolt(c); }); }
    else if (K === 'clones') { castSkill(c); ai.skT = 3; }
    // Vanish when something is incoming or at random, slip aside, then strike from hiding.
    else if (K === 'bloom' && (c.hp < c.R.hp * 0.55 || c.slowT > 0)) { castSkill(c); ai.skT = 3; }
    else if (K === 'gust' && (dist < 4.2 || (threat && tmin < 0.6))) { castSkill(c); ai.skT = 2; }
    else if (K === 'veil' && (threat || Math.random() < 0.25)) { castSkill(c); ai.skT = 4; ai.strafe *= -1; after(1.2 + Math.random(), () => { if (!c.dead) castBolt(c); }); }
  }
  // Fourth ability (Ehab's army) when the opponent is within reach and not mid-dodge.
  const K2 = c.R.skill2;
  if (K2 && c.cdK2 <= 0 && c.mana >= K2.cost + 5 && dist < 8 && o.dodgeT <= 0 && Math.random() < dt * D.skill * 0.6) castSkill2(c);
  ai.nextAtk -= dt;
  if (ai.nextAtk <= 0 && !c.shieldOn) {
    ai.nextAtk = (0.5 + Math.random()) / D.rate;
    if (c.mana >= G.spCost + 10 && Math.random() < 0.25) castSpecial(c);
    else if (c.mana > G.boltCost + 8) castBolt(c);
  }
}
