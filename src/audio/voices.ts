import { play, loadExtra } from './audio';
import { settings } from '../settings/settings';
import { S, net } from '../game/state';
import { $ } from '../core/util';
import type { Fighter } from '../core/types';

/**
 * Combat voices: real recordings (CC0), never synthetic.
 *  - Reem, Layla, Sara: Cici Fyre's «RPG Voice Starter Pack» (three actresses) call out their spells in English,
 *    with an Arabic subtitle under the action.
 *  - Siraj, Qasem, Ehab, Abed: Brandon Song's «Male Adventurer» efforts (shouts, pain), each wizard at his own pitch.
 *  - Announcer: Kenney's «Voiceover Pack: Fighter»; the round banner already says it in Arabic.
 * Files: public/play/sfx/v_*.mp3, loaded in the background after the game starts.
 */
type Line = [file: string, sub?: string];
interface Voice {
  /** Special, skill and fourth ability: spoken lines (picked at random). */
  sp: Line[]; sk: Line[]; sk2?: Line[];
  /** Short efforts (close combat) and pain. */
  eff: string[]; hurt: string[]; die: string;
  /** Playback rate: gives the four men different voices from one actor. */
  rate: number;
}
const FEMALE = (t: number, sp: Line[], sk: Line[], sk2?: Line[]): Voice => ({
  sp, sk, sk2, rate: 1,
  eff: [1, 2, 3].map(i => `v_f${t}_attack${i}`), hurt: [1, 2].map(i => `v_f${t}_damaged${i}`), die: `v_f${t}_damaged3`,
});
const MALE = (rate: number): Voice => ({
  sp: [['v_m_attackbig0'], ['v_m_attackbig2'], ['v_m_attackbig4']], sk: [['v_m_attackbig1'], ['v_m_attackbig3'], ['v_m_attackbig5']], sk2: [['v_m_attackbig4'], ['v_m_attackbig0']], rate,
  eff: ['v_m_attack0', 'v_m_attack3', 'v_m_attack5'], hurt: [0, 1, 2, 3, 4, 5].map(i => `v_m_hurt${i}`), die: 'v_m_death0',
});
const VOICES: Record<string, Voice> = {
  reem: FEMALE(1, [['v_f1_hellstorm', 'عاصفةَ الجحيم!'], ['v_f1_fire', 'نار!']], [['v_f1_burn', 'احترِقْ!']]),
  layla: FEMALE(3, [['v_f3_curse', 'لعنة!']], [['v_f3_hex', 'سِحر!'], ['v_f3_corruption', 'فساد!']]),
  sara: FEMALE(2, [['v_f2_twister', 'دوّامة!'], ['v_f2_cyclone', 'إعصار!']], [['v_f2_wind', 'يا ريح!']], [['v_f2_attack3']]),
  siraj: MALE(0.86), qasem: MALE(1.08), ehab: MALE(0.92), abed: MALE(1),
};
const FILES = [
  ...[1, 2, 3].flatMap(t => ['fire', 'burn', 'hellstorm', 'curse', 'hex', 'corruption', 'cyclone', 'twister', 'wind', 'attack1', 'attack2', 'attack3', 'damaged1', 'damaged2', 'damaged3'].map(w => `v_f${t}_${w}`)),
  ...['attack0', 'attack3', 'attack5', 'attackbig0', 'attackbig1', 'attackbig2', 'attackbig3', 'attackbig4', 'attackbig5', 'hurt0', 'hurt1', 'hurt2', 'hurt3', 'hurt4', 'hurt5', 'death0', 'death1'].map(w => `v_m_${w}`),
  ...['round_1', 'round_2', 'final_round', 'fight', 'flawless_victory', 'you_win', 'you_lose', 'winner'].map(w => `v_a_${w}`),
];
export const loadVoices = () => loadExtra(FILES);

const pick = <T>(a: T[]) => a[(Math.random() * a.length) | 0];
const on = () => settings.voices && !S.sim;
/** One voice at a time per wizard, and not every hit. */
const busy = new Map<Fighter, number>();

function say(c: Fighter, file: string, sub?: string, vol = 0.9) {
  const v = VOICES[c.R.id]; if (!v || !on()) return;
  const now = performance.now();
  if ((busy.get(c) ?? 0) > now) return;
  busy.set(c, now + 700);
  play(file, { vol, x: c.x, rate: v.rate });
  if (sub) subtitle(c, sub);
}

/** Subtitle under the action: speaker in their colour, then the line. */
let subTimer = 0;
function subtitle(c: Fighter, text: string) {
  const el = $('subs');
  el.replaceChildren();
  const who = document.createElement('b'); who.textContent = c.R.name + ': '; who.style.color = c.R.css;
  el.append(who, '«' + text + '»');
  el.hidden = false;
  clearTimeout(subTimer); subTimer = window.setTimeout(() => { el.hidden = true; }, 1400);
}

export function voiceCast(c: Fighter, kind: 'sp' | 'sk' | 'sk2') {
  const v = VOICES[c.R.id]; const lines = v?.[kind]; if (!lines?.length) return;
  const [f, sub] = pick(lines); say(c, f, sub);
}
export function voiceEffort(c: Fighter) { const v = VOICES[c.R.id]; if (v && Math.random() < 0.6) say(c, pick(v.eff), undefined, 0.7); }
/** Pain on a real blow (not every scratch). */
export function voiceHurt(c: Fighter, dmg: number) {
  const v = VOICES[c.R.id]; if (!v || dmg < 12 || Math.random() > 0.65) return;
  say(c, pick(v.hurt), undefined, 0.8);
}
export function voiceDie(c: Fighter) { const v = VOICES[c.R.id]; if (!v) return; busy.delete(c); say(c, v.die); }

/* ---------- announcer ---------- */
function announce(file: string, vol = 1) { if (on()) play(file, { vol, rate: 1 }); }
export function announceRound(n: number) { if (S.mode !== 'train') announce(n === 1 ? 'v_a_round_1' : n === 2 ? 'v_a_round_2' : 'v_a_final_round'); }
export function announceFight() { if (S.mode !== 'train') announce('v_a_fight'); }
/** End of the match: flawless if the winner never lost health, else win/lose from this player's side. */
export function announceMatch(w: Fighter) {
  if (S.mode === 'train') return;
  if (w.hp >= w.R.hp) { announce('v_a_flawless_victory'); return; }
  const mine = S.mode === 'online' ? w.idx === net.me : w.idx === 0;
  announce(mine ? 'v_a_you_win' : 'v_a_you_lose');
}
