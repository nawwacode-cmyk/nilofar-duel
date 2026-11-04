import { S, opp } from '../game/state';
import { anim, tipPos, headPos, applyGrip } from './fighter';
import { setShield } from '../combat/actions';
import { play } from '../audio/audio';
import { emit } from '../render/particles';
import { G } from '../data/rules';
import { GOLD, ICE } from '../data/palettes';
import { V, C, clamp, rnd, pick, angleDelta } from '../core/util';
import type { Fighter } from '../core/types';

/** Floor dust kicked up by feet, landings and knock-back slides. */
function dust(c: Fighter, n: number, sp: number) {
  for (let i = 0; i < n; i++) emit(c.x + rnd(0.25), 0.05, c.z + rnd(0.25), rnd(sp), 0.15 + Math.random() * 0.25, rnd(sp), DUST, 0.22 + Math.random() * 0.2, 0.7 + Math.random() * 0.5, { t: 'smoke', smoke: 1, grow: 0.7, a: 0.28, drag: 2.5 });
}
const DUST = C(0.32, 0.34, 0.42);

const TIMERS =['cdA', 'cdD', 'castT', 'hitT', 'slowT', 'stunT', 'cdS', 'cdK', 'invT'] as const;
const fwd = V(), right = V();

/**
 * Per-frame fighter simulation. `local` fighters are simulated here (movement, mana, shield);
 * remote fighters are interpolated toward the last network state.
 */
export function updChar(c: Fighter, dt: number, local: boolean) {
  for (const k of TIMERS) c[k] = Math.max(0, c[k] - dt);
  const o = opp(c);
  if (c.warpT > 0) {
    c.warpT -= dt; const w = c.warpT;
    c.root.visible = !(w > 0.12 && w < 0.6);
    if (local && c.warpTo && w < 0.45) { c.x = c.warpTo[0]; c.z = c.warpTo[1]; c.vx = c.vz = 0; c.warpTo = null; }
    if (c.warpT <= 0) c.root.visible = true;
  }
  if (local) {
    if (S.state === 'fight' && !c.dead) {
      c.mana = Math.min(100, c.mana + G.regen * dt);
      if (c.shieldOn) {
        c.mana -= G.shieldDrain * dt;
        if (c.mana <= 0 || S.T - c.shieldT > G.shMax) { c.mana = Math.max(0, c.mana); setShield(c, false); }
      }
      if (c.wantShield && !c.shieldOn) setShield(c, true);
      if (!c.wantShield && c.shieldOn) setShield(c, false);
      const sp = c.stunT > 0 ? 0 : c.R.speed * (c.slowT > 0 ? 0.5 : 1) * (c.shieldOn ? 0.45 : 1) * (c.castT > 0 ? 0.35 : 1);
      if (c.dodgeT > 0) {
        c.dodgeT -= dt; c.vx = c.dodgeDir.x * 7.5; c.vz = c.dodgeDir.z * 7.5;
        if (c.dodgeT <= 0) dust(c, 10, 1.2); // landing puff
      } else if (c.knockT > 0) {
        // Knock-back slide: input ignored, friction only.
        c.knockT -= dt; const f = Math.pow(0.015, dt); c.vx *= f; c.vz *= f;
        if (Math.random() < 0.5) dust(c, 1, 0.5);
      } else { c.vx += (c.inX * sp - c.vx) * Math.min(1, dt * 12); c.vz += (c.inZ * sp - c.vz) * Math.min(1, dt * 12); }
      c.x = clamp(c.x + c.vx * dt, -G.bx, G.bx); c.z = clamp(c.z + c.vz * dt, G.zMin, G.zMax);
      // Soft body separation so wizards never overlap.
      const dx = c.x - o.x, dz = c.z - o.z, dd = Math.hypot(dx, dz);
      if (dd < 1.1 && dd > 0) { c.x += (dx / dd) * (1.1 - dd) * 0.5; c.z += (dz / dd) * (1.1 - dd) * 0.5; }
    } else { c.vx *= 0.8; c.vz *= 0.8; c.dodgeT = Math.max(0, c.dodgeT - dt); }
    if (S.state === 'fight' || S.state === 'intro' || S.state === 'ko' || S.state === 'struggle') {
      c.ry += angleDelta(c.ry, Math.atan2(o.x - c.x, o.z - c.z)) * Math.min(1, dt * 10);
    }
    if (!c.dead && c.dodgeT <= 0 && c.castT <= 0 && c.hitT <= 0 && S.state !== 'struggle') {
      if (c.shieldOn) anim(c, 'block');
      else {
        fwd.set(Math.sin(c.ry), 0, Math.cos(c.ry)); right.set(-Math.cos(c.ry), 0, Math.sin(c.ry));
        const vf = c.vx * fwd.x + c.vz * fwd.z, vr = c.vx * right.x + c.vz * right.z, spd = Math.hypot(c.vx, c.vz);
        if (spd < 0.35) anim(c, 'idle');
        else {
          anim(c, Math.abs(vf) > Math.abs(vr) ? (vf > 0 ? 'walkF' : 'walkB') : (vr > 0 ? 'walkR' : 'walkL'), { speed: clamp(spd / 1.5, 0.7, 2) });
          c.stepAcc += spd * dt;
          if (c.stepAcc > 0.75) { c.stepAcc = 0; play('step' + ((Math.random() * 4) | 0), { vol: 0.25, x: c.x }); dust(c, 3, 0.4); }
        }
      }
    }
  } else if (c.nx !== undefined && c.nz !== undefined && c.nry !== undefined) {
    c.x += (c.nx - c.x) * Math.min(1, dt * 14); c.z += (c.nz - c.z) * Math.min(1, dt * 14);
    c.ry += angleDelta(c.ry, c.nry) * Math.min(1, dt * 14);
  }
  c.root.position.set(c.x, 0, c.z); c.root.rotation.y = c.ry; c.blob.position.set(c.x, 0.012, c.z);
  c.mixer.update(dt);
  applyGrip(c);
  tipPos(c, c.light.position);
  c.light.intensity *= Math.pow(0.12, dt); c.light.intensity = Math.max(c.light.intensity, 1.4);
  if (!c.dead && Math.random() < 0.5) { const p = c.light.position; emit(p.x, p.y, p.z, rnd(0.05), 0.15, rnd(0.05), pick(c.pal), 0.08, 0.4, { t: Math.random() < 0.5 ? 'magic' : 'spark' }); }
  if (c.stunT > 0 && Math.random() < 0.6) { const h = headPos(c); const a = S.T * 8; emit(h.x + Math.cos(a) * 0.25, h.y - 0.1, h.z + Math.sin(a) * 0.25, 0, 0, 0, GOLD[0], 0.1, 0.25, { t: 'star' }); }
  if (c.slowT > 0 && Math.random() < 0.5) emit(c.x + rnd(0.3), 0.2 + Math.random() * 1.4, c.z + rnd(0.3), 0, -0.2, 0, pick(ICE), 0.15, 0.6, { t: 'star' });
}
