import type { Monster, Prey, MonId } from './monsters';
import { playClip } from './monsters';
import type { HazardKind } from './hazards';
import type { SceneId } from './script';

/**
 * «الموء», the swamp boss, in three phases by health (runs on the host / solo player only):
 * 1. above 60 %: fights in close, and calls up skeleton guards every 14 s;
 * 2. 60–25 %: rage — faster, and sends a ring of swamp energy every 7 s (dodge through it);
 * 3. below 25 %: the swamp rises — roots burst under every player every 3 s, rings every 10 s.
 * His back is his weak spot (see fromBehind in monsters.ts).
 */
export interface BossHooks {
  summon: (id: MonId, x: number, z: number) => void;
  hazard: (kind: HazardKind, x: number, z: number) => void;
  say: (id: SceneId) => void;
}

export const boss = { m: null as Monster | null, phase: 1, maxHp: 1, summonAt: 0, waveAt: 0, rootAt: 0, t: 0 };

export function startBoss(m: Monster) {
  Object.assign(boss, { m, phase: 1, maxHp: m.hp, summonAt: 8, waveAt: 0, rootAt: 0, t: 0 });
}
export function endBoss() { boss.m = null; }

export function bossTick(dt: number, preys: Prey[], hooks: BossHooks) {
  const m = boss.m; if (!m || m.state === 'dead' || m.state === 'buried') return;
  boss.t += dt;
  const f = m.hp / boss.maxHp;
  const phase = f > 0.6 ? 1 : f > 0.25 ? 2 : 3;
  if (phase > boss.phase) {
    boss.phase = phase; playClip(m, 'roar');
    if (phase === 2) { m.speedMul = 1.3; boss.waveAt = boss.t + 2.5; hooks.say('bossRage'); }
    if (phase === 3) { m.speedMul = 1.45; boss.rootAt = boss.t + 2; boss.waveAt = boss.t + 6; hooks.say('bossSwamp'); }
  }
  const alive = preys.filter(p => !p.dead);
  if (!alive.length) return;
  if (boss.phase === 1 && boss.t > boss.summonAt) {
    boss.summonAt = boss.t + 14;
    for (const s of [-1, 1]) hooks.summon('skeleton', m.x + Math.cos(m.ry + s * 1.2) * 3, m.z + Math.sin(m.ry + s * 1.2) * 3);
  }
  if (boss.phase >= 2 && boss.t > boss.waveAt) { boss.waveAt = boss.t + (boss.phase === 2 ? 7 : 10); hooks.hazard('wave', m.x, m.z); }
  if (boss.phase === 3 && boss.t > boss.rootAt) { boss.rootAt = boss.t + 3; for (const p of alive) hooks.hazard('root', p.x, p.z); }
}
