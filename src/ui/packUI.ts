import { packState, packSize, packUpdateSize, downloadPack, cancelDownload, removePack, downloading, packsAvailable } from '../assets/packs';
import { playHunt, huntDiff, setHuntDiff } from '../hunt/hunt';
import { coopOpen, coopSend, coopLeave, coop } from '../hunt/coop';
import { code4 } from '../net/online';
import { S } from '../game/state';
import { $ } from '../core/util';

/**
 * The optional-pack window: what the mode is, its size, download (with progress, resumable), stop, delete.
 * Opened from the select screen's "Hunters" button and from Settings → Downloads.
 */
const PACK = 'hunters';
const mb = (b: number) => (b / 1048576).toFixed(1);
let size = 0, failed = false, update = 0, duo = false;

async function refresh() {
  const st = await packState(PACK).catch(() => ({ installed: false, have: 0, total: 0 }));
  const busy = downloading();
  const msg = $('pkMsg');
  $('pkStop').hidden = !busy;
  $('pkDl').hidden = busy || (st.installed && !update) || !packsAvailable();
  $('pkPlay').hidden = busy || !st.installed;
  $('pkModeRow').hidden = $('pkPlay').hidden;
  $('pkDuo').hidden = $('pkPlay').hidden || !duo;
  $('pkDiffRow').hidden = $('pkPlay').hidden || (duo && coop.role === 'guest');
  if (duo) $('pkPlay').hidden = true;
  $('pkDel').hidden = busy || (!st.installed && !st.have);
  $('pkBar').hidden = !busy && (st.installed || !st.have);
  $('pkDlTxt').textContent = st.installed && update ? `تحديث (${mb(update)} MB)` : st.have && !st.installed ? 'متابعة التنزيل' : 'تنزيل الطور';
  if (!packsAvailable()) msg.textContent = 'هذا الطور متوفّر في تطبيق أندرويد فقط.';
  else if (st.installed && update) msg.textContent = 'يتوفّر تحديث صغير للطور فيه إصلاحات. يمكنك اللعب الآن أو التحديث أولًا.';
  else if (st.installed) msg.textContent = 'الطور جاهز على جهازك. المرحلة الأولى: غابة الأرواح.';
  else if (busy) msg.textContent = 'جارٍ التنزيل… يمكنك الإيقاف والمتابعة لاحقًا من حيث توقّفت.';
  else if (failed) msg.textContent = 'انقطع التنزيل. تحقّق من اتصالك ثم اضغط «متابعة التنزيل».';
  else if (st.have) msg.textContent = 'التنزيل متوقّف. اضغط «متابعة التنزيل» لإكماله.';
  else msg.textContent = size ? `حجم الحزمة ${mb(size)} ميغابايت، تُحفظ على جهازك ولا تُنزَّل مرة أخرى.` : '';
}

function progress(done: number, total: number) {
  size = total;
  $('pkFill').style.width = (100 * done / Math.max(1, total)).toFixed(1) + '%';
  $('pkPct').textContent = `${mb(done)} / ${mb(total)} MB`;
}

export async function openPack() {
  $('pack').hidden = false; failed = false;
  await refresh();
  if (packsAvailable()) { update = await packUpdateSize(PACK); if (update) await refresh(); }
  if (!size && packsAvailable()) { size = await packSize(PACK).catch(() => 0); await refresh(); }
}

export function initPackUI() {
  $('pkClose').onclick = () => { $('pack').hidden = true; if (S.mode !== 'hunt') coopLeave(); };
  $('pack').onclick = e => { if (e.target === $('pack')) $('pack').hidden = true; };
  $('pkDl').onclick = async () => {
    failed = false;
    const run = downloadPack(PACK, progress);
    await refresh();
    try { await run; update = 0; } catch (e) { failed = !(e instanceof DOMException && e.name === 'AbortError'); }
    await refresh();
  };
  $('pkStop').onclick = () => cancelDownload();
  $('pkPlay').onclick = () => { void playHunt('forest'); };
  // Alone or with a friend: the host makes a code, the guest types it; the game starts when both are in.
  const mBtns = $('pkMode').querySelectorAll<HTMLButtonElement>('button');
  const markMode = () => mBtns.forEach(b => b.classList.toggle('on', (b.dataset.m === 'duo') === duo));
  mBtns.forEach(b => b.onclick = () => { duo = b.dataset.m === 'duo'; if (!duo) coopLeave(); markMode(); void refresh(); });
  markMode();
  const duoMsg = (t: string) => { $('pkDuoMsg').textContent = t; };
  $('pkHost').onclick = () => {
    const code = code4(); $('pkCode').textContent = code; $('pkCode').hidden = false;
    duoMsg('أرسل هذا الرمز لصديقك… بانتظار دخوله.');
    void coopOpen(true, code, S.sel, ri => {
      duoMsg('دخل صديقك! تبدأ الرحلة…');
      // Sent a few times: the guest may still be finishing its subscription.
      for (const t of [0, 800, 1800]) setTimeout(() => coopSend('go', { diff: huntDiff(), ri: S.sel }), t);
      setTimeout(() => void playHunt('forest', ri), 300);
    }, duoMsg);
  };
  $('pkJoin').onclick = () => {
    const code = $<HTMLInputElement>('pkJoinCode').value.trim().toUpperCase();
    if (code.length !== 4) { duoMsg('الرمز أربعة أحرف.'); return; }
    duoMsg('جارٍ البحث عن صديقك…'); $('pkCode').hidden = true;
    void coopOpen(false, code, S.sel, () => duoMsg('وجدنا صديقك! بانتظار أن يبدأ…'), duoMsg);
  };
  const dBtns = $('pkDiff').querySelectorAll<HTMLButtonElement>('button');
  const markDiff = () => dBtns.forEach(b => b.classList.toggle('on', +(b.dataset.d ?? 1) === huntDiff()));
  dBtns.forEach(b => b.onclick = () => { setHuntDiff(+(b.dataset.d ?? 1)); markDiff(); });
  markDiff();
  $('pkDel').onclick = async () => { await removePack(PACK); progress(0, size); await refresh(); };
}
