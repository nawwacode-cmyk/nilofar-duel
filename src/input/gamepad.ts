import { settings } from '../settings/settings';

/**
 * Game controllers (PlayStation, Xbox and others in the browser's "standard" layout), read every frame.
 * The left stick has a small dead zone and a sensitivity gain, so the wizard reaches full speed with a short push;
 * when the stick or d-pad is used it takes priority over the keyboard and the touch stick.
 *
 * PlayStation layout:  ✕ attack (hold)   ○ dodge   □ special   △ skill   R1 fourth ability
 *                      L1 / L2 shield (hold)   R2 attack   OPTIONS pause   left stick / d-pad move
 */
export type PadAction = 'atk' | 'sh' | 'dg' | 'sp' | 'sk' | 'sk2' | 'pause';
const MAP: [number, PadAction][] = [[0, 'atk'], [7, 'atk'], [1, 'dg'], [2, 'sp'], [3, 'sk'], [5, 'sk2'], [4, 'sh'], [6, 'sh'], [9, 'pause']];

const held = new Map<PadAction, boolean>();
export const pad = { x: 0, z: 0, active: false, connected: false, lastUsed: 0 };

function shape(v: number) {
  const dead = settings.padDead, a = Math.abs(v);
  if (a <= dead) return 0;
  // Rescale past the dead zone, then the sensitivity gain: higher reaches full speed with less push.
  return Math.sign(v) * Math.min(1, ((a - dead) / (1 - dead)) * settings.padSens);
}

/** Polls the first connected controller; `press` gets every button change. Returns true if it is in use. */
export function pollPad(press: (a: PadAction, on: boolean) => void) {
  const gp = (navigator.getGamepads?.() ?? []).find(g => g && g.connected) ?? null;
  pad.connected = !!gp;
  if (!gp) { pad.x = pad.z = 0; pad.active = false; return false; }
  let x = shape(gp.axes[0] ?? 0), z = shape(gp.axes[1] ?? 0);
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) z = -1; if (b(13)) z = 1;
  const L = Math.hypot(x, z); if (L > 1) { x /= L; z /= L; }
  pad.x = x; pad.z = z;
  let any = L > 0;
  // One logical action can come from two buttons (✕ and R2, L1 and L2): it is down while either is.
  const now = new Map<PadAction, boolean>();
  for (const [i, a] of MAP) now.set(a, (now.get(a) ?? false) || b(i));
  for (const [a, on] of now) {
    if (on) any = true;
    if (on !== (held.get(a) ?? false)) { held.set(a, on); press(a, on); }
  }
  if (any) pad.lastUsed = performance.now();
  pad.active = any;
  return any;
}
