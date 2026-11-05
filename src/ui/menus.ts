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

/** Character select: portrait grid + the selected wizard's poster, name and opening line (story & abilities in the lore window). */
export function buildRoster() {
  const roster = $('roster');
  roster.replaceChildren(...ROSTER.map((r, i) => {
    const b = el('button', 'wcard' + (i === S.sel ? ' on' : ''));
    b.style.setProperty('--c', r.css); b.setAttribute('aria-pressed', String(i === S.sel)); b.setAttribute('aria-label', `${r.name}، ${r.elem}`);
    const img = document.createElement('img'); img.alt = ''; img.src = portrait(i); img.decoding = 'async';
    const plate = el('span', 'plate'); plate.append(el('span', 'ic', r.icon), el('b', '', r.name));
    b.append(img, el('span', 'gem'), plate);
    b.onclick = () => { unlock(); if (S.sel === i) return; S.sel = i; buildRoster(); void ensureModel(i); play(ROSTER[S.sel].ss, { vol: 0.5 }); };
    return b;
  }));
  const R = ROSTER[S.sel];
  $('detail').style.setProperty('--c', R.css);
  $('dIcon').textContent = R.icon;
  $('dName').textContent = R.name; $('dElem').textContent = R.elem;
  const img = $<HTMLImageElement>('dImg'); if (!img.src.endsWith(portrait(S.sel))) { img.src = portrait(S.sel); img.style.animation = 'none'; void img.offsetWidth; img.style.animation = ''; }
  // First sentence of the story as a teaser.
  $('dTag').textContent = (R.story.match(/^[^.!؟]+[.!؟]/)?.[0] ?? R.story).trim();
  $('bSk').textContent = skillLabel(R);
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
  buildTitle();
  $('mute').onclick = () => {
    unlock(); setMuted(!isMuted());
    $('mute').firstElementChild!.textContent = isMuted() ? 'volume_off' : 'volume_up';
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
