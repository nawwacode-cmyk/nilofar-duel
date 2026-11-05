import { $ } from '../core/util';

declare const __APP_VERSION__: string;
const REPO = 'nawwacode-cmyk/nilofar-duel';

/** The Android app wraps the game in a WebView (Capacitor); the web version is always current anyway. */
const inApp = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
const num = (v: string) => +(v.match(/(\d+)$/)?.[1] ?? 0);

/**
 * Android app only: asks GitHub for the latest release and, when it is newer than this build, shows a button on
 * the title screen that downloads it (Capacitor opens external links in the system browser).
 */
export async function checkForUpdate() {
  if (!inApp() || __APP_VERSION__ === 'dev') return;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return;
    const rel = await r.json() as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
    const latest = rel.tag_name.replace(/^v/, '');
    if (num(latest) <= num(__APP_VERSION__)) return;
    const apk = rel.assets.find(a => a.name.endsWith('.apk'));
    if (!apk) return;
    $('updTxt').textContent = `تحديث جديد متوفر (${latest})`;
    const b = $('upd'); b.hidden = false;
    b.onclick = () => { location.href = apk.browser_download_url; };
  } catch { /* offline: try again next launch */ }
}
