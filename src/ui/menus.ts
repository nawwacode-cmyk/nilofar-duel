import { S, inMenus } from '../game/state';
import { ensureModel, ensureModels } from '../fighters/fighter';
import { play, unlock, isMuted, setMuted, musicOn } from '../audio/audio';
import { setupFighters, startMatch, toMenu } from '../game/flow';
import { code4, leaveNet, onlineStart, requestRematch } from '../net/online';
import { ROSTER, skillLabel } from '../data/roster';
import { TXT } from '../data/text';
import { $ } from '../core/util';
import { getArena, setArena, type ArenaId } from '../world/arena';
import { veil, versus } from './transitions';

/** Portraits are pre-rendered images (public/play/models/portraits), so menus never wait for 3D models. */
const portrait = (i: number) => `models/portraits/${ROSTER[i].id}.webp`;

/** Character select: the wizards in a revolving gallery (selected one in front), name and element under it. */
export function buildRoster() {
  const n = ROSTER.length;
  const roster = $('roster');
  if (roster.childElementCount !== n) roster.replaceChildren(...ROSTER.map((r, i) => {
    const b = el('button', 'fc'); b.style.setProperty('--c', r.css); b.setAttribute('aria-label', `${r.name}، ${r.elem}`);
    const img = document.createElement('img'); img.alt = ''; img.src = portrait(i); img.decoding = 'async';
    b.append(img);
    b.onclick = () => select(i);
    return b;
  }));
  [...roster.children].forEach((b, i) => {
    let off = i - S.sel; if (off > n / 2) off -= n; if (off < -n / 2) off += n;
    const e = b as HTMLElement, a = Math.abs(off);
    // RTL: the next wizard sits to the left.
    e.style.transform = `translateX(${-off * 78}%) translateZ(${-a * 160}px) rotateY(${off * 18}deg) scale(${1 - a * 0.08})`;
    e.style.zIndex = String(10 - a); e.style.opacity = a > 1 ? '0.45' : '1'; e.style.filter = off ? 'brightness(.6)' : 'none';
    e.classList.toggle('c', off === 0); e.setAttribute('aria-pressed', String(off === 0));
  });
  const R = ROSTER[S.sel];
  $('detail').style.setProperty('--c', R.css);
  $('dName').textContent = R.name; $('dElem').textContent = R.elem;
  $('bSk').textContent = skillLabel(R);
}

function select(i: number) {
  unlock(); if (S.sel === i) return;
  S.sel = i; buildRoster(); void ensureModel(i); play(ROSTER[S.sel].ss, { vol: 0.5 });
}

/** Arrows, swipes and the side-bar buttons of the select screen. */
function initGallery() {
  const n = ROSTER.length;
  $('rNext').onclick = () => select((S.sel + 1) % n);
  $('rPrev').onclick = () => select((S.sel + n - 1) % n);
  let x0: number | null = null;
  $('roster').addEventListener('pointerdown', e => { x0 = e.clientX; });
  $('roster').addEventListener('pointerup', e => {
    if (x0 === null) return; const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 40) select((S.sel + (dx > 0 ? 1 : n - 1)) % n); // swipe right → next (RTL)
  });
  $('mMute').onclick = () => $('mute').click();
}

/** Story and abilities of the selected wizard. */
function openLore() {
  const R = ROSTER[S.sel];
  $('loreBox').style.setProperty('--c', R.css); $('lIcon').textContent = R.icon;
  $('lName').textContent = R.name; $('lElem').textContent = R.elem; $('lStory').textContent = R.story;
  $('lAbT').textContent = TXT.abilitiesOf(R);
  const abIcons = ['swords', 'auto_awesome', R.icon, 'auto_awesome'];
  $('lAb').replaceChildren(...[...R.ab, ...(R.ab2 ? [R.ab2] : [])].map(([k, n, d], i) => {
    const row = el('div', 'abl');
    const name = el('b', '', n); name.append(el('small', '', `${k} · ${TXT.abilityKeys[i]}`));
    row.append(el('span', 'ic', abIcons[i]), name, el('span', '', d));
    return row;
  }));
  $('lore').hidden = false;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
}

/** Wizards fanned out on the title screen (the archmage in the middle); tapping one opens the select screen on it. */
const LINEUP = ['siraj', 'reem', 'ehab', 'layla', 'qasem'];
function buildTitle() {
  const n = LINEUP.length, mid = (n - 1) / 2;
  $('tLine').replaceChildren(...LINEUP.map((id, k) => {
    const i = ROSTER.findIndex(r => r.id === id); const r = ROSTER[i];
    const b = el('button', 'tcard' + (k === mid ? ' mid' : '')); b.setAttribute('aria-label', r.name);
    const off = k - mid;
    b.style.setProperty('--c', r.css); b.style.setProperty('--r', off * 5 + 'deg'); b.style.setProperty('--y', Math.abs(off) * 14 + 'px'); b.style.setProperty('--i', String(k));
    b.style.zIndex = String(3 - Math.abs(off));
    const img = document.createElement('img'); img.alt = ''; img.src = portrait(i); img.decoding = 'async';
    b.append(img, el('b', '', r.name));
    b.onclick = () => { S.sel = i; buildRoster(); void ensureModel(i); $('enter').click(); };
    return b;
  }));
  // Embers: a few dozen sparks with random lanes, sizes and timings (pure CSS animation).
  $('embers').replaceChildren(...Array.from({ length: 26 }, () => {
    const e = el('i');
    e.style.setProperty('--x', (Math.random() * 100).toFixed(1) + '%');
    e.style.setProperty('--s', (2 + Math.random() * 3).toFixed(1) + 'px');
    e.style.setProperty('--d', (7 + Math.random() * 7).toFixed(1) + 's');
    e.style.setProperty('--w', (-Math.random() * 14).toFixed(1) + 's');
    e.style.setProperty('--dx', (Math.random() * 120 - 60).toFixed(0) + 'px');
    return e;
  }));
}

export function initMenus() {
  buildTitle(); initGallery();
  $('mute').onclick = () => {
    unlock(); setMuted(!isMuted());
    $('mute').firstElementChild!.textContent = $('mMute').firstElementChild!.textContent = isMuted() ? 'volume_off' : 'volume_up';
    $('mute').setAttribute('aria-label', isMuted() ? TXT.muteOn : TXT.muteOff);
    if (!isMuted() && S.state !== 'menu') musicOn();
  };
  $('enter').onclick = () => { unlock(); play('m_drums', { vol: 0.6 }); void veil(() => { $('title').hidden = true; $('menu').hidden = false; S.state = 'menu'; }); };
  $('backTitle').onclick = () => void veil(() => { $('menu').hidden = true; $('title').hidden = false; S.state = 'title'; });
  $('dLore').onclick = () => { unlock(); openLore(); };
  $('lClose').onclick = () => { $('lore').hidden = true; };
  $('lore').onclick = e => { if (e.target === $('lore')) $('lore').hidden = true; };
  $('diff').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
    S.diff = +(b.dataset.d || 1);
    $('diff').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  const arenaBtns = $('arena').querySelectorAll<HTMLButtonElement>('button');
  const markArena = () => arenaBtns.forEach(x => x.classList.toggle('on', x.dataset.arena === getArena()));
  arenaBtns.forEach(b => b.onclick = () => { void setArena(b.dataset.arena as ArenaId); markArena(); });
  markArena();
  $('mAI').onclick = async () => {
    unlock(); S.mode = 'ai';
    let o = (Math.random() * (ROSTER.length - 1)) | 0; if (o >= S.sel) o++;
    // Versus screen while both wizards load, then the duel.
    const show = versus(S.sel, o, ensureModels([S.sel, o]));
    $('menu').hidden = true;
    await show;
    if (inMenus()) { setupFighters(S.sel, o); startMatch(); }
  };
  // Training: always in the sunlit palace courtyard (the player's arena choice is kept for duels);
  // the dummy is the next wizard in the gallery.
  $('mTrain').onclick = async () => {
    unlock(); S.mode = 'train';
    const o = (S.sel + 1) % ROSTER.length;
    const show = versus(S.sel, o, Promise.all([ensureModels([S.sel, o]), setArena('palace', false)]), 1000);
    $('menu').hidden = true;
    await show;
    if (inMenus()) { setupFighters(S.sel, o); startMatch(); }
  };
  $('mOn').onclick = () => { unlock(); void veil(() => { $('menu').hidden = true; $('online').hidden = false; $('oWait').hidden = true; $('oCreate').hidden = false; $('oErr').hidden = true; S.state = 'online'; }); };
  $('oBack').onclick = () => { leaveNet(); void veil(() => { $('online').hidden = true; $('menu').hidden = false; S.state = 'menu'; }); };
  $('oCreate').onclick = async () => { unlock(); const c = code4(); $('oCode').textContent = c; $('oCreate').hidden = true; $('oWait').hidden = false; $('oErr').hidden = true; await onlineStart(true, c); };
  $('oJoin').onclick = async () => {
    unlock(); const c = $<HTMLInputElement>('code').value.trim().toUpperCase();
    if (c.length !== 4) { $('oErr').hidden = false; $('oErr').textContent = TXT.online.badCode; return; }
    $('oErr').hidden = true; $('onTxt').textContent = TXT.online.searching; await onlineStart(false, c);
  };
  // Online: both players get 10 s to change wizard in the same room; offline: straight into a new duel.
  $('again').onclick = () => { unlock(); if (S.mode === 'online') { requestRematch(); return; } $('end').hidden = true; startMatch(); };
  $('toMenu').onclick = () => void veil(toMenu);
}
