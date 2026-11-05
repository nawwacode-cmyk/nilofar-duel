import { S, net, ch, me, opp, strikes, walls, clones } from './state';
import { makeFighter, dropFighter, resetChar, anim, chest, altCostume } from '../fighters/fighter';
import { play, musicOn, musicOff } from '../audio/audio';
import { explosion } from '../render/particles';
import { setShield } from '../combat/actions';
import { clearProjectiles } from '../combat/projectiles';
import { killWall, killClone } from '../combat/skills';
import { leaveNet } from '../net/online';
import { banner, hud } from '../ui/hud';
import { skillLabel } from '../data/roster';
import { TXT } from '../data/text';
import { trainKo, trainReset } from './training';
import { restoreArena } from '../world/arena';
import { $ } from '../core/util';
import type { Fighter } from '../core/types';

/** Match = best of three rounds. States: intro -> fight -> ko -> (next round | end). */
export function setupFighters(a: number, b: number) {
  dropFighter(S.CH[0]); dropFighter(S.CH[1]);
  S.CH = [makeFighter(a, 0), makeFighter(b, 1)];
  if (a === b) altCostume(S.CH[1] as Fighter);
}

/** Wizard name, tagged "(أنت)" / "(الحاسوب)" / "(صديقك)" when both fighters are the same wizard. */
function label(c: Fighter) {
  if (ch(0).ri !== ch(1).ri) return c.R.name;
  return `${c.R.name} ${c === me() ? TXT.youTag : TXT.oppTag(S.mode === 'online')}`;
}

function clearArena() {
  clearProjectiles(); strikes.length = 0;
  walls.slice().forEach(killWall); clones.slice().forEach(c => killClone(c, false));
}

export function startMatch() {
  S.CH.forEach(c => { if (c) c.wins = 0; });
  S.round = 0;
  $('end').hidden = true; $('hud').hidden = false; $('ctl').hidden = false; $('pauseBtn').hidden = false; $('rematch').hidden = true;
  if (S.mode === 'train') trainReset();
  $('bSk').textContent = skillLabel(me().R);
  const R = me().R; $('bSk2').hidden = !R.skill2; if (R.ab2) $('bSk2').textContent = R.ab2[1].split(' ')[0];
  walls.slice().forEach(killWall); clones.slice().forEach(c => killClone(c, false));
  S.CH.forEach((c, i) => {
    if (!c) return;
    $('n' + i).textContent = label(c); $('e' + i).textContent = c.R.elem;
    const av = $<HTMLImageElement>('av' + i); av.src = `models/portraits/${c.R.id}_face.webp`; av.classList.toggle('alt', !!c.tint);
    document.documentElement.style.setProperty('--p' + i, c.hex);
  });
  musicOn(); newRound();
}

export function newRound() {
  S.round++;
  clearArena();
  S.CH.forEach(c => c && resetChar(c));
  hud(); S.state = 'intro'; S.stateT = 0; S.slowmo = 1;
  if (S.mode === 'train') banner(TXT.training, TXT.versus(label(ch(0)), label(ch(1))));
  else banner(TXT.round(S.round), TXT.versus(label(ch(0)), label(ch(1))));
  play('m_drums', { vol: 0.9 }); play('c_chant', { vol: 0.35 });
}


export function ko(c: Fighter) {
  if (S.state !== 'fight' || trainKo(c)) return;
  c.dead = true; anim(c, 'death', { once: true, force: true }); setShield(c, false);
  const w = opp(c); w.wins = (w.wins || 0) + 1; hud();
  S.state = 'ko'; S.stateT = 0; S.slowmo = 0.35;
  banner(w.wins >= 2 ? TXT.matchWon(w.R, label(w)) : TXT.roundWon(w.R, label(w)));
  explosion(chest(c), w.pal, 1.6); play('m_whoosh', { vol: 0.8 }); play('m_epic', { vol: 1 }); play('c_huge', { vol: 0.6 });
}

export function endMatch() {
  const w = S.CH.find(c => c && c.wins >= 2) as Fighter;
  S.state = 'end'; banner(''); musicOff(); play('c_loud', { vol: 0.6 });
  $('endT').textContent = TXT.endTitle(w.R, label(w));
  $('endP').textContent = S.mode === 'online'
    ? (w.idx === net.me ? TXT.endOnlineWin : TXT.endOnlineLose)
    : (w.idx === 0 ? TXT.endAiWin : TXT.endAiLose);
  $('end').hidden = false; $('ctl').hidden = true; $('pauseBtn').hidden = true;
}

/** Menus cover the canvas, so no fighters are kept on stage there (also frees their GPU memory). */
export function clearFighters() {
  dropFighter(S.CH[0]); dropFighter(S.CH[1]);
  S.CH = [null, null];
}

export function toMenu() {
  if (S.mode === 'train') restoreArena();
  S.state = 'menu'; musicOff();
  ['end', 'hud', 'ctl', 'sWrap', 'pauseBtn', 'pause', 'rematch', 'combo'].forEach(id => { $(id).hidden = true; });
  S.paused = false;
  banner(''); clearProjectiles(); strikes.length = 0;
  leaveNet(); S.mode = 'ai'; clearFighters(); $('menu').hidden = false;
}
