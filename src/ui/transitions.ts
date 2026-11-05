import { ROSTER } from '../data/roster';
import { TXT } from '../data/text';
import { onDownloadProgress } from '../assets/net';
import { $ } from '../core/util';

/**
 * Nothing opens abruptly: screens change behind a short loading veil (spinning sigil), and every duel starts
 * from a "versus" screen that faces the two wizards while their models load — like a real fighting game.
 */
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fade in the veil, switch screens behind it, hold briefly, fade out. */
export async function veil(swap: () => void | Promise<void>, hold = 420) {
  const v = $('veil');
  v.hidden = false; v.classList.remove('out');
  if (!calm()) await wait(180);
  await swap();
  if (!calm()) await wait(hold);
  v.classList.add('out');
  await wait(calm() ? 0 : 220);
  v.hidden = true; v.classList.remove('out');
}

/** Versus screen for wizards a (left, the player) and b: stays until `ready` resolves and at least `min` ms passed. */
export async function versus(a: number, b: number, ready: Promise<unknown>, min = 1800) {
  const A = ROSTER[a], B = ROSTER[b];
  $<HTMLImageElement>('vsA').src = `models/portraits/${A.id}.webp`; $('vsAn').textContent = A.name; $('vsA').parentElement!.style.setProperty('--c', A.css);
  $<HTMLImageElement>('vsB').src = `models/portraits/${B.id}.webp`; $('vsBn').textContent = B.name; $('vsB').parentElement!.style.setProperty('--c', B.css);
  const txt = $('vsTxt'); txt.textContent = TXT.preparing;
  const vs = $('vs'); vs.hidden = false; vs.classList.remove('out');
  onDownloadProgress((l, t) => { txt.textContent = TXT.loadingFighters(Math.round((l / Math.max(1, t)) * 100)); });
  try { await Promise.all([ready, wait(calm() ? 300 : min)]); }
  finally { onDownloadProgress(null); }
  vs.classList.add('out');
  await wait(calm() ? 0 : 300);
  vs.hidden = true; vs.classList.remove('out');
}
