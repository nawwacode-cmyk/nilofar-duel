import { S } from '../game/state';
import { me } from '../game/state';
import { unlock } from '../audio/audio';
import { castBolt, castSpecial, castSkill, castSkill2, dodge } from '../combat/actions';
import { mash } from '../game/struggle';
import { isEditingControls } from '../ui/settingsUI';
import { $ } from '../core/util';
import { toLocal, localRect } from '../core/view';

/** Touch joystick + on-screen buttons + keyboard, merged into one intent per frame. */
type Action = 'atk' | 'sh' | 'dg' | 'sp' | 'sk' | 'sk2';

const input = { x: 0, z: 0, keys: {} as Record<string, boolean> };
export let atkHeld = false;

/**
 * Input buffer: a press that comes a moment too early (cooldown not over, still casting, a little mana short)
 * is kept for BUFFER_S and fires on the first frame it can, so no press feels swallowed.
 */
const BUFFER_S = 0.2;
let buffered: { a: Action; until: number } | null = null;
const CASTS: Partial<Record<Action, typeof castBolt>> = { atk: castBolt, dg: dodge, sp: castSpecial, sk: castSkill, sk2: castSkill2 };

/** Every successful cast or dodge costs mana, so a drop means it went off. */
function tryCast(a: Action) {
  const c = me(), m = c.mana;
  CASTS[a]?.(c);
  return c.mana < m;
}

export function press(a: Action, on: boolean) {
  if (!S.CH[0] || S.paused || isEditingControls()) return;
  const c = me();
  if (S.state === 'struggle') { if (on) mash(); return; }
  if (a === 'atk') atkHeld = on;
  if (a === 'sh') c.wantShield = on;
  if (on && CASTS[a] && S.state === 'fight') buffered = tryCast(a) ? null : { a, until: performance.now() / 1000 + BUFFER_S };
}

/** Called every frame: retries a buffered press until it fires or expires. */
export function pumpInput() {
  if (!buffered) return;
  if (S.state !== 'fight' || S.paused || performance.now() / 1000 > buffered.until) { buffered = null; return; }
  if (tryCast(buffered.a)) buffered = null;
}

const KM: Record<string, Action> = { KeyJ: 'atk', Space: 'atk', KeyK: 'sh', KeyL: 'dg', ShiftLeft: 'dg', KeyI: 'sp', KeyE: 'sp', KeyU: 'sk', KeyQ: 'sk', KeyY: 'sk2' };

/** Normalised movement vector from stick + WASD/arrows. */
export function readMove(): [number, number] {
  let x = input.x, z = input.z; const k = input.keys;
  if (k.KeyA || k.ArrowLeft) x -= 1;
  if (k.KeyD || k.ArrowRight) x += 1;
  if (k.KeyW || k.ArrowUp) z -= 1;
  if (k.KeyS || k.ArrowDown) z += 1;
  const L = Math.hypot(x, z); if (L > 1) { x /= L; z /= L; }
  return [x, z];
}

export function initInput() {
  const stickZone = $('stickZone'), stick = $('stick'), knob = $('knob');
  let stickId: number | null = null, stickC = { x: 0, y: 0 };
  const moveStick = (e: PointerEvent) => {
    const p = toLocal(e.clientX, e.clientY);
    let dx = p.x - stickC.x, dy = p.y - stickC.y; const L = Math.hypot(dx, dy), M = 50;
    if (L > M) { dx *= M / L; dy *= M / L; }
    knob.style.transform = `translate(${dx}px,${dy}px)`; input.x = dx / M; input.z = dy / M;
  };
  stickZone.addEventListener('pointerdown', e => {
    unlock(); stickId = e.pointerId;
    try { stickZone.setPointerCapture(e.pointerId); } catch { /* some browsers refuse capture; plain move events still work */ }
    const r = localRect(stickZone); stickC = toLocal(e.clientX, e.clientY);
    stick.style.right = 'auto'; stick.style.left = stickC.x - r.left + 'px'; stick.style.top = stickC.y - r.top + 'px'; moveStick(e);
  });
  stickZone.addEventListener('pointermove', e => { if (e.pointerId === stickId) moveStick(e); });
  const stickEnd = (e: PointerEvent) => { if (e.pointerId !== stickId) return; stickId = null; input.x = input.z = 0; knob.style.transform = ''; };
  (['pointerup', 'pointercancel', 'lostpointercapture'] as const).forEach(ev => stickZone.addEventListener(ev, stickEnd));

  document.querySelectorAll<HTMLButtonElement>('.b').forEach(b => {
    const a = b.dataset.a as Action;
    b.addEventListener('pointerdown', e => { e.preventDefault(); unlock(); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ } press(a, true); });
    const up = () => { b.classList.remove('on'); press(a, false); };
    (['pointerup', 'pointercancel', 'lostpointercapture'] as const).forEach(ev => b.addEventListener(ev, up));
    b.addEventListener('contextmenu', e => e.preventDefault());
  });

  addEventListener('keydown', e => {
    if (S.state === 'menu' || S.state === 'load') return;
    input.keys[e.code] = true; const a = KM[e.code];
    if (a) { e.preventDefault(); if (!e.repeat) { unlock(); press(a, true); } }
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => { input.keys[e.code] = false; const a = KM[e.code]; if (a) press(a, false); });
  $('sMash').addEventListener('pointerdown', e => { e.preventDefault(); unlock(); mash(); });
}
