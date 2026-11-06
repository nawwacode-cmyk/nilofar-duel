import { clamp } from '../core/util';
import { settings, onSettingChange } from '../settings/settings';

/** WebAudio playback of the real recorded samples in public/play/sfx. */
const AudioCtx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
const AC = new AudioCtx();
const master = AC.createGain(); master.gain.value = 0.8; master.connect(AC.destination);
const musicGain = AC.createGain(); musicGain.connect(master);
/** Sound effects bus (everything except the music), so music and effects have separate volumes. */
const sfxGain = AC.createGain(); sfxGain.connect(master);
let intensity = 0;
function applyVolumes() { musicGain.gain.value = 0.22 * settings.music * (1 + 0.55 * intensity); sfxGain.gain.value = settings.sfx; }
/** Music swells as the duel gets close (0 calm … 1 someone is nearly down). */
export function setMusicIntensity(x: number) {
  const v = Math.max(0, Math.min(1, x));
  if (Math.abs(v - intensity) < 0.02) return;
  intensity = v; applyVolumes();
}
applyVolumes();
onSettingChange(k => { if (k === 'music' || k === 'sfx') applyVolumes(); });

const SND: Record<string, AudioBuffer> = {};
const SNAMES = ['fire1', 'fire2', 'fire3', 'fire4', 'fire5', 'ice1', 'ice2', 'ice3', 'ice4', 'ice5', 'bolt1', 'bolt2', 'bolt3', 'bolt4', 'bolt5', 'shadow1', 'shadow2', 'shadow3', 'shadow4', 'shadow5', 'shield', 'shield2', 'boom1', 'boom2', 'ko', 'cast1', 'cast2', 'cast3', 'hum', 'parry', 'glass', 'tap', 'step0', 'step1', 'step2', 'step3', 'music', 'm_fire_beam', 'm_energy', 'm_fire_cast', 'm_fireball', 'm_meteor', 'm_fire_swoosh', 'm_fire_expl', 'm_ice', 'm_ice_thin', 'm_arcane', 'm_fastmagic', 'm_sparkle', 'm_waves', 'm_cast_long', 'm_thunder', 'm_shock', 'm_epic', 'm_blast', 'm_shatter', 'm_drums', 'c_huge', 'c_loud', 'c_amb', 'c_chant', 'm_whoosh', 'm_light',
  // Kenney "Impact Sounds" (CC0): body blows, heavy thuds, ice shards.
  'k_punch0', 'k_punch1', 'k_punch2', 'k_punch3', 'k_punch4', 'k_thud0', 'k_thud1', 'k_thud2', 'k_ice0', 'k_ice1', 'k_ice2'];

let muted = false;
export const isMuted = () => muted;

/** Loads every sample; a missing file only silences that sound. */
export async function loadSounds() {
  await Promise.all(SNAMES.map(async n => {
    try { const r = await fetch('sfx/' + n + '.mp3'); SND[n] = await AC.decodeAudioData(await r.arrayBuffer()); }
    catch (e) { console.warn('sound missing', n, e); }
  }));
}

/** More samples loaded in the background (combat voices): the game does not wait for them. */
export async function loadExtra(names: string[]) {
  for (const n of names) {
    if (SND[n]) continue;
    try { const r = await fetch('sfx/' + n + '.mp3'); SND[n] = await AC.decodeAudioData(await r.arrayBuffer()); }
    catch { /* only that line stays silent */ }
  }
}

/** Browsers start audio suspended until a user gesture. */
export function unlock() { if (AC.state === 'suspended') void AC.resume(); }

export interface PlayOpts { vol?: number; rate?: number; x?: number; dur?: number }

/** One-shot sample, panned by world x, with slight pitch variation. */
export function play(n: string, { vol = 1, rate = 1, x = 0, dur }: PlayOpts = {}) {
  const b = SND[n]; if (!b || muted) return null;
  const s = AC.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
  const g = AC.createGain(); g.gain.value = vol;
  const p = AC.createStereoPanner ? AC.createStereoPanner() : null;
  if (p) { p.pan.value = clamp(x / 6, -0.8, 0.8); s.connect(g).connect(p).connect(sfxGain); } else s.connect(g).connect(sfxGain);
  if (dur) s.start(0, 0, dur); else s.start();
  return { s, g };
}
/** Random variant name, e.g. pr('fire') -> 'fire1'..'fire5'. */
export const pr = (b: string, n = 5) => b + (1 + ((Math.random() * n) | 0));

let music: AudioBufferSourceNode | null = null;
let amb: AudioBufferSourceNode | null = null;

function loopNode(n: string, vol: number, dest: AudioNode = sfxGain) {
  if (!SND[n]) return null;
  const s = AC.createBufferSource(); s.buffer = SND[n]; s.loop = true;
  const g = AC.createGain(); g.gain.value = vol; s.connect(g).connect(dest); s.start();
  return s;
}

/** Background music plus crowd ambience. */
export function musicOn() {
  if (music || muted || !SND.music) return;
  music = loopNode('music', 1, musicGain);
  amb = loopNode('c_amb', 0.12);
}
export function musicOff() {
  for (const n of [music, amb]) { try { n?.stop(); } catch { /* already stopped */ } }
  music = null; amb = null;
}

let hum: { s: AudioBufferSourceNode | null; s2: AudioBufferSourceNode | null } | null = null;
/** Looping beam sound during the struggle. */
export function startHum() { if (!muted) hum = { s: loopNode('m_fire_beam', 0.75), s2: loopNode('m_energy', 0.55) }; }
export function setHumRate(r: number) { if (hum?.s2) hum.s2.playbackRate.value = r; }
export function stopHum() {
  if (!hum) return;
  try { hum.s?.stop(); hum.s2?.stop(); } catch { /* already stopped */ }
  hum = null;
}

export function setMuted(m: boolean) { muted = m; if (m) { musicOff(); stopHum(); } }
