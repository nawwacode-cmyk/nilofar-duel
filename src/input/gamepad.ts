import { settings } from '../settings/settings';

/**
 * Game controllers (PlayStation, Xbox and others in the browser's "standard" layout), read every frame.
 * The left stick has a small dead zone and a sensitivity gain, so the wizard reaches full speed with a short push;
 * when the stick or d-pad is used it takes priority over the keyboard and the touch stick.
 *
 * Default PlayStation layout (the player can reassign every action in the settings, `settings.padMap`):
 *   ✕ attack (hold)   ○ dodge   □ special   △ skill   R1 fourth ability
 *   L1 / L2 shield (hold)   R2 attack   OPTIONS pause   left stick / d-pad move
 *
 * Two players on one device (2 vs 2): with two controllers the first is player 1 and the second player 2;
 * with one controller, player 1 keeps the keyboard and the controller is player 2.
 */
export type PadAction = 'atk' | 'sh' | 'dg' | 'sp' | 'sk' | 'sk2' | 'pause';
export const PAD_ACTIONS: PadAction[] = ['atk', 'sh', 'dg', 'sp', 'sk', 'sk2', 'pause'];
/** Button names in the standard layout (PlayStation symbols). The d-pad (12–15) stays for movement. */
export const PAD_NAMES: Record<number, string> = { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 8: 'SHARE', 9: 'OPTIONS', 10: 'L3', 11: 'R3', 16: 'PS', 17: 'لوحة اللمس' };
export const padName = (i: number) => PAD_NAMES[i] ?? 'زر ' + i;

const connected = () => (navigator.getGamepads?.() ?? []).filter((g): g is Gamepad => !!g && g.connected);

/** While the settings wait for a button to assign, the game ignores the controllers. */
let capture: ((button: number) => void) | null = null;
let captureHeld = new Set<string>();
export function captureButton(fn: ((button: number) => void) | null) {
  capture = fn; captureHeld = new Set();
  for (const gp of connected()) gp.buttons.forEach((b, i) => { if (b.pressed) captureHeld.add(gp.index + ':' + i); });
}

/** Per player (0 = player 1, 1 = player 2 on the same device). */
export interface PadState { x: number; z: number; active: boolean; held: Map<PadAction, boolean> }
const mk = (): PadState => ({ x: 0, z: 0, active: false, held: new Map() });
export const pads: [PadState, PadState] = [mk(), mk()];
/** Player 1's controller (kept as \`pad\` for the input mode and movement priority). */
export const pad = Object.assign(pads[0], { connected: false, lastUsed: 0 });

function shape(v: number) {
  const dead = settings.padDead, a = Math.abs(v);
  if (a <= dead) return 0;
  // Rescale past the dead zone, then the sensitivity gain: higher reaches full speed with less push.
  return Math.sign(v) * Math.min(1, ((a - dead) / (1 - dead)) * settings.padSens);
}

function read(gp: Gamepad, st: PadState, player: number, press: (player: number, a: PadAction, on: boolean) => void) {
  let x = shape(gp.axes[0] ?? 0), z = shape(gp.axes[1] ?? 0);
  const b = (i: number) => !!gp.buttons[i]?.pressed;
  if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) z = -1; if (b(13)) z = 1;
  const L = Math.hypot(x, z); if (L > 1) { x /= L; z /= L; }
  st.x = x; st.z = z;
  let any = L > 0;
  // One logical action can come from two buttons (✕ and R2, L1 and L2): it is down while either is.
  for (const a of PAD_ACTIONS) {
    const on = (settings.padMap[a] ?? []).some(b);
    if (on) any = true;
    if (on !== (st.held.get(a) ?? false)) { st.held.set(a, on); press(player, a, on); }
  }
  st.active = any;
  return any;
}

const release = (st: PadState, player: number, press: (player: number, a: PadAction, on: boolean) => void) => {
  st.x = st.z = 0; st.active = false;
  for (const [a, on] of st.held) if (on) { st.held.set(a, false); press(player, a, false); }
};

/**
 * Polls the controllers; `press` gets every button change with the player it belongs to.
 * `twoPlayers`: a second player is on this device.
 */
export function pollPad(press: (player: number, a: PadAction, on: boolean) => void, twoPlayers = false) {
  const gps = connected();
  pad.connected = gps.length > 0;
  if (capture) {
    // Assigning: the first button pressed on any controller that was not already down (d-pad excluded, it moves).
    for (const gp of gps) gp.buttons.forEach((b, i) => {
      const k = gp.index + ':' + i;
      if (!b.pressed) { captureHeld.delete(k); return; }
      if (capture && !captureHeld.has(k) && (i < 12 || i > 15)) { const fn = capture; capture = null; fn(i); }
    });
    pad.x = pad.z = 0; pad.active = true; pad.lastUsed = performance.now();
    return;
  }
  // Which controller drives which player.
  const own: [Gamepad | null, Gamepad | null] = !twoPlayers ? [gps[0] ?? null, null] : gps.length >= 2 ? [gps[0], gps[1]] : [null, gps[0] ?? null];
  own.forEach((gp, p) => {
    const st = pads[p];
    if (!gp) { release(st, p, press); return; }
    if (read(gp, st, p, press) && p === 0) pad.lastUsed = performance.now();
  });
}
