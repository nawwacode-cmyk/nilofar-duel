import { S, ch } from '../game/state';
import { anim, chest } from '../fighters/fighter';
import { play } from '../audio/audio';
import { emit, burst } from '../render/particles';
import { dmgText, flash } from '../fx/effects';
import { setShield, fire } from './actions';
import { ko } from '../game/flow';
import { impact } from '../fx/impact';
import { opp } from '../game/state';
import { G, DMG } from '../data/rules';
import { GOLD } from '../data/palettes';
import { TXT } from '../data/text';
import { V, pick, clamp } from '../core/util';
import type { Fighter, Projectile } from '../core/types';

export type HitResult = 'miss' | 'parry' | 'block' | 'hit';

/**
 * Resolves a projectile hitting a fighter. Runs only on the victim's device (victim authority).
 * Raising the shield within G.parryWin seconds before impact reflects the bolt.
 */
export function takeHit(c: Fighter, p: Projectile): HitResult {
  const att = ch(p.owner);
  if (c.dodgeT > 0.08 || c.invT > 0) return 'miss';
  if (c.shieldOn) {
    if (S.T - c.shieldT < G.parryWin && p.kind !== 'meteor') {
      c.shield?.hit(); play('parry', { vol: 0.7, x: c.x }); play('m_light', { vol: 0.6, x: c.x });
      burst(p.pos, GOLD, 50, 3, 0.5, 0.18, 'star');
      const s = chest(c), d = chest(att).sub(s);
      fire(c, { kind: c.R.bolt.kind, x: s.x, y: s.y, z: s.z, dx: d.x, dy: d.y * 0.6, dz: d.z });
      c.mana = Math.min(100, c.mana + 15); dmgText(c, TXT.parry, 'var(--gold)');
      return 'parry';
    }
    c.shield?.hit(); play('shield2', { vol: 0.5, x: c.x, rate: 1.3 }); c.shHP -= p.dmg;
    if (p.kind === 'meteor') applyDmg(c, Math.round(p.dmg * DMG.meteorThroughShield), att);
    if (c.shHP <= 0) breakShield(c);
    return 'block';
  }
  applyDmg(c, p.dmg, att);
  if (p.slow) c.slowT = Math.max(c.slowT, p.slow);
  return 'hit';
}

function breakShield(c: Fighter) {
  const p = chest(c); setShield(c, false); c.cdS = 4.5; c.stunT = 0.9; play('m_shatter', { vol: 1, x: c.x });
  for (let i = 0; i < 70; i++) { const v = V().randomDirection(); emit(p.x + v.x * 0.8, p.y + v.y, p.z + v.z * 0.8, v.x * 4, v.y * 3 + 1, v.z * 4, pick(c.pal), 0.12, 0.8, { t: 'star', grav: -6, drag: 1 }); }
  dmgText(c, TXT.shieldBroken, '#fff'); anim(c, 'hit', { once: true, speed: 0.9, force: true });
  impact(c, opp(c), 0.6);
}

export function applyDmg(c: Fighter, d: number, att: Fighter) {
  if (c.dead || S.state !== 'fight') return;
  c.hp = Math.max(0, c.hp - d); dmgText(c, '−' + d, att.hex); c.hitT = 0.35;
  S.shake = Math.max(S.shake, d > 15 ? 0.15 : 0.06); flash(c, 12);
  if (c.castT <= 0 && !c.shieldOn && c.dodgeT <= 0) anim(c, 'hit', { once: true, speed: 1.4, force: true });
  impact(c, att, c.hp <= 0 ? 1 : clamp(d / 40, 0.15, 0.9));
  play('tap', { vol: 0.6, x: c.x, rate: 0.7 });
  if (c.hp <= 0) ko(c);
}
