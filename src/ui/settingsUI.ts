import { S, inMenus } from '../game/state';
import { settings, setSetting, resetSettings, onSettingChange, type QualityMode, type Settings } from '../settings/settings';
import { toMenu } from '../game/flow';
import { unlock } from '../audio/audio';
import { $ } from '../core/util';
import { toLocal } from '../core/view';
import { trainSummary } from '../game/training';
import { openPack } from './packUI';

/* =================== settings screen =================== */
type Row =
  | { k: keyof Settings; type: 'range'; label: string; hint?: string; min: number; max: number; step: number; fmt: (v: number) => string }
  | { k: keyof Settings; type: 'toggle'; label: string; hint?: string }
  | { k: keyof Settings; type: 'seg'; label: string; hint?: string; options: [string | number, string][] }
  | { type: 'action'; label: string; hint?: string; btn: string; run: () => void };

const pct = (v: number) => Math.round(v * 100) + '%';
const TABS: Record<string, Row[]> = {
  sound: [
    { k: 'music', type: 'range', label: 'الموسيقى', min: 0, max: 1, step: 0.05, fmt: pct },
    { k: 'sfx', type: 'range', label: 'المؤثرات الصوتية', hint: 'التعاويذ والضربات والخطوات', min: 0, max: 1, step: 0.05, fmt: pct },
  ],
  graphics: [
    { k: 'quality', type: 'seg', label: 'جودة الرسوميات', hint: 'التلقائي يختار حسب جهازك ويخفّض عند البطء', options: [['auto', 'تلقائي'], [0, 'منخفضة'], [1, 'متوسطة'], [2, 'عالية']] },
  ],
  motion: [
    { k: 'shake', type: 'range', label: 'اهتزاز الكاميرا', min: 0, max: 1, step: 0.1, fmt: pct },
    { k: 'flashes', type: 'toggle', label: 'ومضات الضربات', hint: 'وميض الشاشة والشخصية عند الإصابة' },
    { k: 'dmgNumbers', type: 'toggle', label: 'أرقام الضرر' },
  ],
  controls: [
    { k: 'btnScale', type: 'range', label: 'حجم الأزرار', min: 0.8, max: 1.3, step: 0.05, fmt: pct },
    { k: 'btnOpacity', type: 'range', label: 'وضوح الأزرار', min: 0.35, max: 1, step: 0.05, fmt: pct },
    { k: 'leftHanded', type: 'toggle', label: 'وضع اليد اليسرى', hint: 'عصا الحركة يمينًا والأزرار يسارًا' },
    { type: 'action', label: 'أماكن الأزرار', hint: 'اسحب كل زر إلى المكان الذي يريحك', btn: 'تخصيص', run: () => startControlEditor() },
  ],
  downloads: [
    { type: 'action', label: 'رحلة الصيّادين', hint: 'حزمة طور اختيارية: تنزيل أو حذف من الجهاز', btn: 'إدارة', run: () => { void openPack(); } },
  ],
};

let tab = 'sound';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
}

function renderPanel() {
  const panel = $('setPanel');
  panel.replaceChildren(...TABS[tab].map(r => {
    const row = el('div', 'srow');
    const lab = el('div'); lab.append(el('b', '', r.label)); if (r.hint) lab.append(el('small', '', r.hint));
    const ctl = el('div', 'ctl');
    if (r.type === 'range') {
      const v = settings[r.k] as number;
      const out = el('span', 'val', r.fmt(v));
      const inp = el('input'); inp.type = 'range'; inp.min = String(r.min); inp.max = String(r.max); inp.step = String(r.step); inp.value = String(v);
      inp.setAttribute('aria-label', r.label);
      inp.oninput = () => { const n = +inp.value; out.textContent = r.fmt(n); setSetting(r.k, n as never); };
      ctl.append(inp, out);
    } else if (r.type === 'toggle') {
      const b = el('button', 'tgl' + (settings[r.k] ? ' on' : '')); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', String(!!settings[r.k])); b.setAttribute('aria-label', r.label);
      b.onclick = () => { setSetting(r.k, !settings[r.k] as never); renderPanel(); };
      ctl.append(b);
    } else if (r.type === 'seg') {
      const seg = el('div', 'seg');
      for (const [v, t] of r.options) {
        const b = el('button', settings[r.k] === v ? 'on' : '', t);
        b.onclick = () => { setSetting(r.k, v as never); renderPanel(); };
        seg.append(b);
      }
      ctl.append(seg);
    } else {
      const b = el('button', 'gbtn dark', r.btn); b.style.height = '32px'; b.onclick = r.run; ctl.append(b);
    }
    row.append(lab, ctl);
    return row;
  }));
  $('setTabs').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
}

export function openSettings() { unlock(); renderPanel(); $('settings').hidden = false; }
function closeSettings() { $('settings').hidden = true; }

/* =================== applying settings =================== */
export function applyControlSettings() {
  const root = document.documentElement;
  root.style.setProperty('--btn-scale', String(settings.btnScale));
  root.style.setProperty('--btn-op', String(settings.btnOpacity));
  root.classList.toggle('lefty', settings.leftHanded);
  document.querySelectorAll<HTMLElement>('#btns .b').forEach(b => {
    const o = settings.btnPos[b.id]; const x = o ? o[0] * (settings.leftHanded ? -1 : 1) : 0, y = o ? o[1] : 0;
    b.style.translate = o ? `${x}px ${y}px` : '';
  });
}

/* =================== control layout editor =================== */
const MIN_GAP = 10;
let editing = false;
let draft: Record<string, [number, number]> = {};
let fromPause = false;

export const isEditingControls = () => editing;

function startControlEditor() {
  fromPause = !$('pause').hidden;
  closeSettings(); $('pause').hidden = true;
  editing = true; draft = JSON.parse(JSON.stringify(settings.btnPos));
  document.documentElement.classList.add('editing');
  $('ctl').hidden = false; $('editBar').hidden = false;
}
function endControlEditor(save: boolean) {
  if (save) setSetting('btnPos', draft);
  editing = false; document.documentElement.classList.remove('editing');
  $('editBar').hidden = true;
  if (inMenus() || S.state === 'end') $('ctl').hidden = true;
  applyControlSettings();
  // Back where the editor was opened from (the pause menu stays under the settings screen).
  if (fromPause) $('pause').hidden = false;
  openSettings(); tab = 'controls'; renderPanel();
}

/** Every pair of buttons keeps a 10 px edge gap (they are circles) and stays fully on screen. */
function layoutValid() {
  const bs = [...document.querySelectorAll<HTMLElement>('#btns .b')].map(b => { const r = b.getBoundingClientRect(); return { b, x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2, rect: r }; });
  let ok = true;
  for (const a of bs) a.b.classList.remove('bad');
  for (let i = 0; i < bs.length; i++) {
    const a = bs[i];
    if (a.rect.left < 0 || a.rect.top < 0 || a.rect.right > innerWidth || a.rect.bottom > innerHeight) { a.b.classList.add('bad'); ok = false; }
    for (let j = i + 1; j < bs.length; j++) {
      const b = bs[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r < MIN_GAP) { a.b.classList.add('bad'); b.b.classList.add('bad'); ok = false; }
    }
  }
  return ok;
}

function initEditorDrag() {
  document.querySelectorAll<HTMLElement>('#btns .b').forEach(b => {
    let start: { x: number; y: number; ox: number; oy: number } | null = null;
    b.addEventListener('pointerdown', e => {
      if (!editing) return;
      e.stopImmediatePropagation(); e.preventDefault();
      const p = toLocal(e.clientX, e.clientY); const o = draft[b.id] ?? [0, 0];
      start = { x: p.x, y: p.y, ox: o[0], oy: o[1] };
      try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }, true);
    b.addEventListener('pointermove', e => {
      if (!editing || !start) return;
      const p = toLocal(e.clientX, e.clientY), sc = settings.btnScale, mirror = settings.leftHanded ? -1 : 1;
      const o: [number, number] = [Math.round(start.ox + ((p.x - start.x) / sc) * mirror), Math.round(start.oy + (p.y - start.y) / sc)];
      draft[b.id] = o; b.style.translate = `${o[0] * mirror}px ${o[1]}px`;
      layoutValid();
    });
    const end = () => {
      if (!editing || !start) return;
      if (!layoutValid()) { // revert this button to where it was
        draft[b.id] = [start.ox, start.oy]; b.style.translate = `${start.ox * (settings.leftHanded ? -1 : 1)}px ${start.oy}px`;
        setTimeout(layoutValid, 0);
      }
      start = null;
    };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  });
}

/* =================== pause =================== */
export function showPause() {
  if (S.state === 'end' || inMenus() || editing) return;
  const online = S.mode === 'online';
  if (!online) S.paused = true;
  $('pNote').hidden = !online;
  $('pQuitTxt').textContent = online ? 'مغادرة المبارزة' : 'الخروج إلى القائمة';
  $('pTrain').hidden = S.mode !== 'train';
  if (S.mode === 'train') $('tStats').textContent = trainSummary();
  $('pause').hidden = false;
}
function hidePause() { $('pause').hidden = true; S.paused = false; }

export function initSettingsUI() {
  $('setTabs').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => { tab = b.dataset.tab || 'sound'; renderPanel(); });
  $('setBack').onclick = closeSettings;
  $('setReset').onclick = () => { resetSettings(); renderPanel(); };
  $('tSettings').onclick = openSettings;
  $('mSettings').onclick = openSettings;
  $('pSettings').onclick = openSettings;
  $('pauseBtn').onclick = () => { unlock(); showPause(); };
  $('pResume').onclick = hidePause;
  $('pQuit').onclick = () => { hidePause(); toMenu(); };
  $('editDone').onclick = () => { if (layoutValid()) endControlEditor(true); };
  $('editReset').onclick = () => { draft = {}; document.querySelectorAll<HTMLElement>('#btns .b').forEach(b => { b.style.translate = ''; }); layoutValid(); };
  addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if (!$('settings').hidden) closeSettings();
    else if (!$('pause').hidden) hidePause();
    else showPause();
  });
  initEditorDrag();
  applyControlSettings();
  onSettingChange(k => { if (k === 'btnScale' || k === 'btnOpacity' || k === 'leftHanded' || k === 'btnPos') applyControlSettings(); });
}

export type { QualityMode };
