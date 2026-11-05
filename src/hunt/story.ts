import { isMuted } from '../audio/audio';
import { settings } from '../settings/settings';
import { $ } from '../core/util';
import { SCENES, BESTIARY, type SceneId } from './script';

/**
 * Story scenes of the Hunters mode: cinema bars, the narrator's (English) voice and the Arabic subtitle typed out
 * while he speaks. The game freezes the monsters and the player's controls while a scene runs (see hunt.ts) and
 * moves the camera itself. «تخطٍّ» ends the scene at once.
 */
let skip: (() => void) | null = null;
export const inScene = () => skip !== null;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Plays one line: voice (if sound is on) and the subtitle typed over ~60 % of it. Resolves when it is over. */
function line(key: string, ar: string, cancelled: () => boolean) {
  return new Promise<void>(resolve => {
    const sub = $('stSub');
    sub.textContent = ''; sub.classList.remove('out');
    const a = new Audio(`voice/${key}.mp3`);
    a.volume = Math.min(1, settings.sfx * 1.1);
    let dur = 0.9 + ar.length * 0.065, typeT = dur * 0.6, start = performance.now(), done = false;
    const finish = () => { if (done) return; done = true; a.pause(); resolve(); };
    if (!isMuted()) {
      a.addEventListener('loadedmetadata', () => { if (Number.isFinite(a.duration)) { dur = a.duration + 0.5; typeT = Math.min(a.duration * 0.65, ar.length * 0.06); start = performance.now(); } }, { once: true });
      void a.play().catch(() => { /* autoplay refused: the subtitle still runs on its own clock */ });
    }
    // Typewriter: reveal whole characters; Arabic letters join naturally as they appear.
    const tick = () => {
      if (cancelled()) { finish(); return; }
      const t = (performance.now() - start) / 1000;
      const n = Math.min(ar.length, Math.ceil((t / Math.max(0.3, typeT)) * ar.length));
      if (sub.textContent!.length !== n) sub.textContent = ar.slice(0, n);
      if (t >= dur) { finish(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Runs a scene; `onEnd` also fires when skipped. */
export async function playScene(id: SceneId) {
  const box = $('story');
  let cancelled = false;
  box.hidden = false; box.classList.remove('out', 'say');
  await new Promise<void>(r => { skip = () => { cancelled = true; r(); }; void (async () => {
    await wait(500);
    for (const l of SCENES[id]) {
      if (cancelled) break;
      await line(l.key, l.ar, () => cancelled);
      if (cancelled) break;
      $('stSub').classList.add('out'); await wait(250);
    }
    r();
  })(); });
  skip = null;
  box.classList.add('out'); await wait(350);
  box.hidden = true; box.classList.remove('out'); $('stSub').textContent = '';
}

export function initStory() {
  $('stSkip').onclick = () => skip?.();
  addEventListener('keydown', e => { if (skip && (e.code === 'Escape' || e.code === 'Enter')) { e.stopImmediatePropagation(); skip(); } }, true);
}

/* ---------- monster name cards and hints ---------- */
let cardTimer = 0;
/** "Name — one line" card under the objective, the first time a kind of monster attacks. */
export function monsterCard(name: string, id: string) {
  const c = $('mCard');
  $('mcName').textContent = name; $('mcTxt').textContent = BESTIARY[id] ?? '';
  c.hidden = false; c.classList.remove('out');
  clearTimeout(cardTimer);
  cardTimer = window.setTimeout(() => { c.classList.add('out'); cardTimer = window.setTimeout(() => { c.hidden = true; }, 400); }, 3800);
}

let hintTimer = 0;
/** A short tip above the controls. */
export function hint(t: string, ms = 4500) {
  const h = $('hHint');
  h.textContent = t; h.hidden = false; h.classList.remove('out');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => { h.classList.add('out'); hintTimer = window.setTimeout(() => { h.hidden = true; }, 400); }, ms);
}

/** A narrator line during play: subtitle only (no bars, no skip), the game keeps running. Ignored during a scene. */
export async function speak(id: SceneId) {
  if (skip) return;
  const box = $('story');
  box.hidden = false; box.classList.add('say'); box.classList.remove('out');
  for (const l of SCENES[id]) { await line(l.key, l.ar, () => skip !== null); $('stSub').classList.add('out'); await wait(250); }
  if (skip) return; // a scene took over the box
  box.hidden = true; box.classList.remove('say'); $('stSub').textContent = '';
}
