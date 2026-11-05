import { S, me } from '../game/state';
import { G } from '../data/rules';
import { $ } from '../core/util';

/** Health/mana bars and round pips for both sides. */
export function hud() {
  S.CH.forEach((c, i) => {
    if (!c) return;
    $('hp' + i).style.transform = `scaleX(${Math.max(0, c.hp) / c.R.hp})`;
    const hn = Math.ceil(Math.max(0, c.hp)) + ' / ' + c.R.hp;
    if ($('hn' + i).textContent !== hn) $('hn' + i).textContent = hn;
    $('mp' + i).style.transform = `scaleX(${c.mana / 100})`;
    $('pw' + i).querySelectorAll('i').forEach((e, k) => e.classList.toggle('on', k < (c.wins || 0)));
  });
}

/** Big centre text with optional subtitle; empty string hides it. */
export function banner(t: string, s = '') {
  const b = $('banner');
  b.innerHTML = '';
  b.append(t);
  if (s) { const sm = document.createElement('small'); sm.textContent = s; b.append(sm); }
  b.style.opacity = t ? '1' : '0';
}

/** Cooldown sweep (--cd 0..1) on each touch button. */
export function updateButtons() {
  const c = me();
  const set = (id: string, v: number) => $(id).style.setProperty('--cd', v.toFixed(2));
  set('bAtk', c.cdA / c.R.bolt.cd);
  set('bDg', c.cdD / G.dodgeCd);
  set('bSh', c.shieldOn ? 0 : c.cdS / G.shCd);
  set('bSp', 1 - Math.min(1, c.mana / G.spCost));
  $('bSp').classList.toggle('ready', c.mana >= G.spCost);
  set('bSk', Math.max(c.cdK / c.R.skill.cd, c.mana < c.R.skill.cost ? 0.999 : 0));
  const K2 = c.R.skill2; if (K2) set('bSk2', Math.max(c.cdK2 / K2.cd, c.mana < K2.cost ? 0.999 : 0));
}
