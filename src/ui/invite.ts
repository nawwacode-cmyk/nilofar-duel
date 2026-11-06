import { S } from '../game/state';
import { code4, leaveNet, onlineStart } from '../net/online';
import { ROSTER } from '../data/roster';
import { unlock } from '../audio/audio';
import { $ } from '../core/util';
import { veil } from './transitions';

/**
 * Invite links instead of typing room codes. The inviter picks a wizard, taps «ادعُ صديقًا» and shares a link
 * (system share sheet, WhatsApp, or copy). Opening the link starts the game on the wizard selection with an
 * invitation bar; the friend picks a wizard and taps «انضم», and the duel starts. The link always points to the
 * website, so it opens on any device.
 */
const SITE = 'https://nawwacode-cmyk.github.io/nilofar-duel/play/';
const inviteUrl = (code: string) => `${SITE}?join=${code}`;
const valid = (c: string | null) => !!c && /^[A-Z0-9]{4}$/.test(c);
let pending = '';

function inviteText(code: string) {
  return `${ROSTER[S.sel].name} يتحدّاك في مبارزة سحرة في «أسرار الظلام»! افتح الرابط واختر ساحرك:\n${inviteUrl(code)}`;
}

async function share(code: string) {
  const text = inviteText(code);
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    try { await nav.share({ title: 'أسرار الظلام', text }); return 'shared'; }
    catch (e) { if ((e as DOMException).name === 'AbortError') return 'cancelled'; }
  }
  // No share sheet (desktop browsers, the Android WebView): open WhatsApp with the message ready.
  // In a new window (or the WhatsApp app): this page must stay open, it holds the room.
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  return 'whatsapp';
}

async function copy(code: string) {
  try { await navigator.clipboard.writeText(inviteText(code)); return true; } catch { return false; }
}

/** Host: make a room, share the link, wait in the online screen. */
async function invite() {
  unlock();
  const c = code4();
  $('oCode').textContent = c; $('oCreate').hidden = true; $('oWait').hidden = false; $('oErr').hidden = true;
  $('onTxt').textContent = 'أُرسلت الدعوة. ستبدأ المبارزة فور دخول صديقك.';
  void onlineStart(true, c);
  await share(c);
}

/** The game was opened from an invitation: remember the code and clean the address bar. */
export function readInvite() {
  const q = new URLSearchParams(location.search), c = q.get('join')?.toUpperCase() ?? null;
  if (!valid(c)) return false;
  pending = c!;
  q.delete('join');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  return true;
}

/** Shows the wizard selection with the invitation bar (called instead of the title screen). */
export function showInvite() {
  $('title').hidden = true; $('menu').hidden = false; S.state = 'menu';
  // The friend button becomes the way in: pick a wizard, then tap it.
  const b = $('mOn'); b.classList.add('invited'); b.querySelector('.col')!.textContent = 'انضم إلى صديقك';
}

export function initInvite() {
  $('oCreate').onclick = () => void invite();
  $('oShare').onclick = () => { const c = $('oCode').textContent || ''; if (valid(c)) void share(c); };
  $('oCopy').onclick = async () => {
    const c = $('oCode').textContent || ''; if (!valid(c)) return;
    $('oCopy').textContent = (await copy(c)) ? 'نُسخ الرابط ✓' : 'تعذّر النسخ';
    setTimeout(() => { $('oCopy').textContent = 'نسخ الرابط'; }, 2000);
  };
  const friend = $('mOn').onclick;
  $('mOn').onclick = e => {
    if (!pending) { friend?.call($('mOn'), e); return; }
    unlock();
    const c = pending; pending = '';
    const b = $('mOn'); b.classList.remove('invited'); b.querySelector('.col')!.textContent = 'تحدَّ صديقًا';
    void veil(() => {
      $('menu').hidden = true; $('online').hidden = false; $('oWait').hidden = true; $('oCreate').hidden = false; $('oErr').hidden = true;
      $<HTMLInputElement>('code').value = c; S.state = 'online';
      $('onTxt').textContent = 'جارٍ الدخول إلى مبارزة صديقك…';
    }).then(() => { leaveNet(); void onlineStart(false, c); });
  };
}
