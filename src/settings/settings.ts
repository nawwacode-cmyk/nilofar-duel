/**
 * Player settings, saved on the device (localStorage). Every system reads from `settings`;
 * the settings screen writes through `setSetting`, which persists and notifies listeners.
 */
export type QualityMode = 'auto' | 0 | 1 | 2;
export type InputMode = 'auto' | 'touch' | 'keyboard' | 'gamepad';

export interface Settings {
  music: number;        // 0..1
  sfx: number;          // 0..1
  voices: boolean;      // wizards' shouts and the announcer, with subtitles
  quality: QualityMode; // auto = pick from device and lower when slow
  shake: number;        // 0..1 camera shake strength
  flashes: boolean;     // screen flashes and hit white-outs
  dmgNumbers: boolean;  // floating damage numbers
  fps: boolean;         // frame-rate counter on screen (for checking performance)
  btnScale: number;     // 0.8..1.3 touch button size
  btnOpacity: number;   // 0.35..1
  leftHanded: boolean;  // stick on the right, buttons on the left
  inputMode: InputMode; // how the game is played; auto = touch on phones, keyboard on computers, controller when one is used
  padSens: number;      // 0.8..2.5 controller stick gain (higher = full speed with less push)
  padDead: number;      // 0.03..0.3 controller stick dead zone
  /** Per-button drag offsets in px (from the default layout), set in the button editor. */
  btnPos: Record<string, [number, number]>;
}

const KEY = 'asrar.settings';
const DEFAULTS: Settings = { music: 0.8, sfx: 1, voices: true, quality: 'auto', shake: 1, flashes: true, dmgNumbers: true, fps: false, btnScale: 1, btnOpacity: 1, leftHanded: false, inputMode: 'auto', padSens: 1.7, padDead: 0.1, btnPos: {} };

function load(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

export const settings: Settings = load();
const listeners: ((k: keyof Settings) => void)[] = [];

export function onSettingChange(fn: (k: keyof Settings) => void) { listeners.push(fn); }

export function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
  settings[k] = v;
  localStorage.setItem(KEY, JSON.stringify(settings));
  for (const fn of listeners) fn(k);
}

export function resetSettings() {
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) setSetting(k, structuredCloneSafe(DEFAULTS[k]));
}
const structuredCloneSafe = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
