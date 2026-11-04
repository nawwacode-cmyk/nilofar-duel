import { S, inMenus } from '../game/state';
import { ensureModel, ensureModels } from '../fighters/fighter';
import { play, unlock, isMuted, setMuted, musicOn } from '../audio/audio';
import { setupFighters, startMatch, toMenu } from '../game/flow';
import { code4, leaveNet, onlineStart } from '../net/online';
import { onDownloadProgress } from '../assets/net';
import { ROSTER, skillLabel } from '../data/roster';
import { TXT } from '../data/text';
import { $ } from '../core/util';
import { getArena, setArena, type ArenaId } from '../world/arena';

/** Portraits are pre-rendered images (public/play/models/portraits), so menus never wait for 3D models. */
const portrait = (i: number) => `models/portraits/${ROSTER[i].id}.webp`;

/** Character select: portrait grid + story, stats and abilities of the selected wizard. */
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
  $('dName').textContent = R.name; $('dElem').textContent = R.elem; $('dStory').textContent = R.story;
  const stats = [['favorite', TXT.stats.hp, R.stat[0], String(R.hp)], ['speed', TXT.stats.speed, R.stat[1], R.speed.toFixed(1)], ['bolt', TXT.stats.power, R.stat[2], '']] as const;
  $('dStats').replaceChildren(...stats.flatMap(([ic, n, v, t]) => {
    const bar = el('i'); bar.style.setProperty('--v', String(v));
    return [el('span', 'ic', ic), el('span', '', n), bar, el('em', '', t)];
  }));
  $('dAbT').textContent = TXT.abilitiesOf(R);
  const abIcons = ['swords', 'auto_awesome', R.icon];
  $('dAb').replaceChildren(...R.ab.map(([k, n, d], i) => {
    const row = el('div', 'abl');
    const name = el('b', '', n); name.append(el('small', '', `${k} · ${TXT.abilityKeys[i]}`));
    row.append(el('span', 'ic', abIcons[i]), name, el('span', '', d));
    return row;
  }));
  $('bSk').textContent = skillLabel(R);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
}

export function initMenus() {
  $('mute').onclick = () => {
    unlock(); setMuted(!isMuted());
    $('mute').firstElementChild!.textContent = isMuted() ? 'volume_off' : 'volume_up';
    $('mute').setAttribute('aria-label', isMuted() ? TXT.muteOn : TXT.muteOff);
    if (!isMuted() && S.state !== 'menu') musicOn();
  };
  $('enter').onclick = () => { unlock(); $('title').hidden = true; $('menu').hidden = false; S.state = 'menu'; play('m_drums', { vol: 0.6 }); };
  $('backTitle').onclick = () => { $('menu').hidden = true; $('title').hidden = false; S.state = 'title'; };
  $('diff').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
    S.diff = +(b.dataset.d || 1);
    $('diff').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  const arenaBtns = $('arena').querySelectorAll<HTMLButtonElement>('button');
  const markArena = () => arenaBtns.forEach(x => x.classList.toggle('on', x.dataset.arena === getArena()));
  arenaBtns.forEach(b => b.onclick = () => { void setArena(b.dataset.arena as ArenaId); markArena(); });
  markArena();
  $('mAI').onclick = () => {
    unlock(); S.mode = 'ai'; $('menu').hidden = true;
    let o = (Math.random() * 3) | 0; if (o >= S.sel) o++;
    void startWhenLoaded([S.sel, o], () => { setupFighters(S.sel, o); startMatch(); });
  };
  $('mOn').onclick = () => { unlock(); $('menu').hidden = true; $('online').hidden = false; $('oWait').hidden = true; $('oCreate').hidden = false; $('oErr').hidden = true; S.state = 'online'; };
  $('oBack').onclick = () => { leaveNet(); $('online').hidden = true; $('menu').hidden = false; S.state = 'menu'; };
  $('oCreate').onclick = async () => { unlock(); const c = code4(); $('oCode').textContent = c; $('oCreate').hidden = true; $('oWait').hidden = false; $('oErr').hidden = true; await onlineStart(true, c); };
  $('oJoin').onclick = async () => {
    unlock(); const c = $<HTMLInputElement>('code').value.trim().toUpperCase();
    if (c.length !== 4) { $('oErr').hidden = false; $('oErr').textContent = TXT.online.badCode; return; }
    $('oErr').hidden = true; $('onTxt').textContent = TXT.online.searching; await onlineStart(false, c);
  };
  $('again').onclick = () => { unlock(); $('end').hidden = true; startMatch(); };
  $('toMenu').onclick = toMenu;
}


/**
 * Runs a match once both fighters' models are downloaded. On slow connections the start button shows the
 * download progress meanwhile (the menu stays usable until then).
 */
export async function startWhenLoaded(ids: number[], go: () => void) {
  const btn = $<HTMLButtonElement>('mAI'), label = btn.querySelector('.col');
  const old = label?.innerHTML ?? '';
  let shown = false;
  const t = setTimeout(() => { shown = true; btn.disabled = true; }, 150);
  onDownloadProgress((l, tot) => { if (shown && label) label.textContent = TXT.loadingFighters(Math.round((l / Math.max(1, tot)) * 100)); });
  try { await ensureModels(ids); }
  finally { clearTimeout(t); onDownloadProgress(null); btn.disabled = false; if (label) label.innerHTML = old; }
  if (inMenus()) go();
}
