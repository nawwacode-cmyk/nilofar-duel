import { S, ch, projs } from './state';
import { aiThink } from '../ai/ai';
import { resetChar } from '../fighters/fighter';
import { $ } from '../core/util';
import type { Fighter } from '../core/types';

/**
 * Training mode: the player (side 0) against a dummy (side 1) that never wins or loses. The dummy's behaviour is
 * chosen in the panel, health refills, optional infinite mana and no cooldowns, and a live damage readout
 * (last hit, current combo, damage per second).
 */
export type DummyMode = 'idle' | 'move' | 'block' | 'fight';
export const train = { dummy: 'idle' as DummyMode, infMana: true, noCd: false, last: 0, combo: 0, count: 0, best: 0, lastHitAt: -9, hits: [] as { t: number; d: number }[], shieldUntil: 0, uiAt: 0 };

const COMBO_GAP = 1.6, DPS_WINDOW = 3, REFILL_AFTER = 2;

/** Every hit taken in training (called from applyDmg). */
export function trainHit(victim: Fighter, d: number) {
  if (victim.idx !== 1) return;
  if (S.T - train.lastHitAt > COMBO_GAP) { train.combo = 0; train.count = 0; }
  train.last = d; train.combo += d; train.count++; train.lastHitAt = S.T; train.best = Math.max(train.best, train.combo);
  train.hits.push({ t: S.T, d });
}

/** No knock-outs in training: whoever drops to 0 is simply healed. Returns true when it handled the KO. */
export function trainKo(c: Fighter) {
  if (S.mode !== 'train') return false;
  c.hp = c.R.hp; c.dead = false;
  return true;
}

export function trainTick(dt: number) {
  const me = ch(0), dummy = ch(1);
  if (!me || !dummy) return;
  if (train.infMana) me.mana = 100;
  if (train.noCd) { me.cdS = 0; me.cdK = 0; me.cdK2 = 0; me.cdD = 0; }
  // Both refill a moment after the last hit, so long combos can be measured.
  if (S.T - train.lastHitAt > REFILL_AFTER) dummy.hp = Math.min(dummy.R.hp, dummy.hp + dummy.R.hp * dt);
  me.hp = Math.min(me.R.hp, me.hp + me.R.hp * 0.25 * dt);
  if (S.state === 'fight') {
    if (train.dummy === 'fight') aiThink(dummy, dt);
    else if (train.dummy === 'move') { dummy.inX = Math.sin(S.T * 0.9); dummy.inZ = Math.cos(S.T * 0.6) * 0.7; dummy.wantShield = false; }
    else if (train.dummy === 'block') {
      dummy.inX = dummy.inZ = 0;
      // Raise the shield when one of the player's spells comes close.
      if (projs.some(p => p.owner === 0 && !p.dead && Math.hypot(p.pos.x - dummy.x, p.pos.z - dummy.z) < 3.2)) train.shieldUntil = S.T + 0.5;
      dummy.wantShield = S.T < train.shieldUntil; dummy.mana = 100;
    } else { dummy.inX = dummy.inZ = 0; dummy.wantShield = false; }
  }
  // Combo counter: shown while hits keep coming, fades out after the combo ends.
  if (S.T - train.uiAt < 0.1) return;
  train.uiAt = S.T;
  train.hits = train.hits.filter(h => S.T - h.t < DPS_WINDOW);
  const live = S.T - train.lastHitAt <= COMBO_GAP, box = $('combo');
  if (live && train.count > 0) {
    box.hidden = false; box.classList.remove('fade');
    $('cHits').textContent = String(train.count); $('cWord').textContent = train.count === 1 ? 'ضربة' : train.count === 2 ? 'ضربتان' : train.count <= 10 ? 'ضربات' : 'ضربة';
    $('cDmg').textContent = '−' + train.combo;
  } else if (!box.hidden && !box.classList.contains('fade')) { box.classList.add('fade'); setTimeout(() => { if (box.classList.contains('fade')) box.hidden = true; }, 500); }
}

/** Numbers for the pause menu: last hit, best combo, damage per second over the last few seconds. */
export function trainSummary() {
  const dps = Math.round(train.hits.reduce((s, h) => s + h.d, 0) / DPS_WINDOW);
  return `آخر ضربة ${train.last} · أفضل سلسلة ${train.best} · ضرر/ثانية ${dps}`;
}

/** Back to the starting spots, full health, counters cleared. */
export function trainReset() {
  S.CH.forEach(c => c && resetChar(c));
  train.last = train.combo = train.count = 0; train.hits = []; train.lastHitAt = -9; $('combo').hidden = true;
}

export function initTraining() {
  const segBtns = $('tDummy').querySelectorAll<HTMLButtonElement>('button');
  const mark = () => segBtns.forEach(b => b.classList.toggle('on', b.dataset.b === train.dummy));
  segBtns.forEach(b => b.onclick = () => { train.dummy = b.dataset.b as DummyMode; const d = ch(1); if (d) { d.inX = d.inZ = 0; d.wantShield = false; } mark(); });
  mark();
  const tgl = (id: string, key: 'infMana' | 'noCd') => { const b = $(id); b.classList.toggle('on', train[key]); b.onclick = () => { train[key] = !train[key]; b.classList.toggle('on', train[key]); }; };
  tgl('tMana', 'infMana'); tgl('tCd', 'noCd');
  $('tReset').onclick = () => { trainReset(); train.best = 0; $('tStats').textContent = trainSummary(); };
}
