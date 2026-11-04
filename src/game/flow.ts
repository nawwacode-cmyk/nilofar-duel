import { S, net, ch, me, opp, strikes, walls, clones } from './state';
import { makeFighter, dropFighter, resetChar, anim, chest } from '../fighters/fighter';
import { play, musicOn, musicOff } from '../audio/audio';
import { emit, explosion } from '../render/particles';
import { setShield } from '../combat/actions';
import { clearProjectiles } from '../combat/projectiles';
import { killWall, killClone } from '../combat/skills';
import { leaveNet } from '../net/online';
import { banner, hud } from '../ui/hud';
import { ROSTER, skillLabel } from '../data/roster';
import { TXT } from '../data/text';
import { $, rnd, pick } from '../core/util';
import type { Fighter } from '../core/types';

/** Match = best of three rounds. States: intro -> fight -> ko -> (next round | end). */
export function setupFighters(a: number, b: number) {
  dropFighter(S.CH[0]); dropFighter(S.CH[1]);
  S.CH = [makeFighter(a, 0), makeFighter(b, 1)];
}

function clearArena() {
  clearProjectiles(); strikes.length = 0;
  walls.slice().forEach(killWall); clones.slice().forEach(c => killClone(c, false));
}

export function startMatch() {
  S.CH.forEach(c => { if (c) c.wins = 0; });
  S.round = 0;
  $('end').hidden = true; $('hud').hidden = false; $('ctl').hidden = false;
  $('bSk').textContent = skillLabel(me().R);
  walls.slice().forEach(killWall); clones.slice().forEach(c => killClone(c, false));
  S.CH.forEach((c, i) => {
    if (!c) return;
    $('n' + i).textContent = c.R.name; $('e' + i).textContent = c.R.elem;
    document.documentElement.style.setProperty('--p' + i, c.R.css);
  });
  musicOn(); newRound();
}

export function newRound() {
  S.round++;
  clearArena();
  S.CH.forEach(c => c && resetChar(c));
  hud(); S.state = 'intro'; S.stateT = 0; S.slowmo = 1;
  banner(TXT.round(S.round), TXT.versus(ch(0).R.name, ch(1).R.name));
  play('m_drums', { vol: 0.9 }); play('c_chant', { vol: 0.35 });
}

export function ko(c: Fighter) {
  if (S.state !== 'fight') return;
  c.dead = true; anim(c, 'death', { once: true, force: true }); setShield(c, false);
  const w = opp(c); w.wins = (w.wins || 0) + 1; hud();
  S.state = 'ko'; S.stateT = 0; S.slowmo = 0.35;
  banner(w.wins >= 2 ? TXT.matchWon(w.R) : TXT.roundWon(w.R));
  explosion(chest(c), w.pal, 1.6); play('m_whoosh', { vol: 0.8 }); play('m_epic', { vol: 1 }); play('c_huge', { vol: 0.6 });
}

export function endMatch() {
  const w = S.CH.find(c => c && c.wins >= 2) as Fighter;
  S.state = 'end'; banner(''); musicOff(); play('c_loud', { vol: 0.6 });
  $('endT').textContent = TXT.endTitle(w.R);
  $('endP').textContent = S.mode === 'online'
    ? (w.idx === net.me ? TXT.endOnlineWin : TXT.endOnlineLose)
    : (w.idx === 0 ? TXT.endAiWin : TXT.endAiLose);
  $('end').hidden = false; $('ctl').hidden = true;
}

/** Character-select backdrop: the chosen wizard posing; the second fighter exists (hidden) for camera math. */
export function showcase() {
  dropFighter(S.CH[0]); dropFighter(S.CH[1]);
  const c = makeFighter(S.sel, 0); c.x = 0; c.z = 0; c.ry = 0;
  const o = makeFighter((S.sel + 1) % 4, 1); o.x = 2.5; o.z = -3; o.root.visible = false;
  S.CH = [c, o];
  const R = ROSTER[S.sel];
  document.documentElement.style.setProperty('--p0', R.css);
  emit(0, 0.05, 0, 0, 0, 0, R.pal[1], 0.4, 0.9, { t: 'rune', spin: 1.5, grow: 3 });
  for (let i = 0; i < 30; i++) emit(rnd(0.4), 0.1 + Math.random() * 1.6, rnd(0.4), rnd(0.4), 1, rnd(0.4), pick(R.pal), 0.1, 0.7, { t: 'spark' });
}

export function toMenu() {
  S.state = 'menu'; musicOff();
  ['end', 'hud', 'ctl', 'sWrap'].forEach(id => { $(id).hidden = true; });
  banner(''); clearProjectiles(); strikes.length = 0;
  leaveNet(); S.mode = 'ai'; showcase(); $('menu').hidden = false;
}
