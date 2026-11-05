import * as THREE from 'three';
import { renderer, composer, moon, scene } from './stage';
import { setDynamicLights } from './lights';
import { setPostTier } from './post';
import { setCharTier } from './charLight';
import { settings, onSettingChange } from '../settings/settings';

/**
 * Three quality tiers, picked from the device and then adjusted by measured frame rate during fights.
 * The chosen tier is remembered so the next launch starts at the right level.
 */
export type Tier = 0 | 1 | 2; // low, medium, high
let onTier: (() => void) | null = null;
/** Called after every tier change (systems that rebuild per tier, e.g. the arena atmosphere). */
export function onTierChange(fn: () => void) { onTier = fn; }
const KEY = 'asrar.quality';
let tier: Tier = 2;
export const getTier = () => tier;

function initialTier(): Tier {
  if (settings.quality !== 'auto') return settings.quality;
  const saved = localStorage.getItem(KEY);
  if (saved === '0' || saved === '1' || saved === '2') return +saved as Tier;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse) return cores >= 8 ? 1 : 0;
  return 2;
}

export function applyTier(t: Tier) {
  tier = t;
  localStorage.setItem(KEY, String(t));
  const dpr = Math.min(devicePixelRatio || 1, [1, 1.25, 1.5][t]);
  renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr);
  const shadows = t >= 1;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  moon.castShadow = shadows;
  const size = t === 2 ? 2048 : 1024;
  if (moon.shadow.mapSize.x !== size) { moon.shadow.mapSize.set(size, size); moon.shadow.map?.dispose(); moon.shadow.map = null; }
  setDynamicLights(t >= 1);
  setPostTier(t); setCharTier(t);
  onTier?.();
  // Materials must recompile when shadow support toggles.
  scene.traverse(o => { const m = (o as THREE.Mesh).material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { x.needsUpdate = true; }); });
  dispatchEvent(new Event('resize'));
}

export function initQuality() {
  applyTier(initialTier());
  onSettingChange(k => { if (k === 'quality') { if (settings.quality === 'auto') localStorage.removeItem(KEY); applyTier(initialTier()); } });
}

/** On-screen frame-rate counter (Settings → Graphics): average fps over the last second and the slowest frame. */
let fAcc = 0, fN = 0, fWorst = 0;
function showFps(rdt: number, fighting: boolean) {
  const el = document.getElementById('fpsInd'); if (!el) return;
  const on = settings.fps && fighting;
  if (el.hidden === on) el.hidden = !on;
  if (!on) return;
  fAcc += rdt; fN++; fWorst = Math.max(fWorst, rdt);
  if (fAcc < 1) return;
  const fps = Math.round(fN / fAcc), worst = Math.round(1000 * fWorst);
  el.textContent = fps + ' FPS · ' + ['منخفضة', 'متوسطة', 'عالية'][tier] + ' · أبطأ إطار ' + worst + 'ms';
  el.className = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'bad';
  fAcc = 0; fN = 0; fWorst = 0;
}

/** Drops one tier when fights average under 30 fps for 4 s (never raises automatically). */
let acc = 0, frames = 0, cooldown = 0;
export function monitorFps(rdt: number, fighting: boolean) {
  showFps(rdt, fighting);
  if (!fighting || settings.quality !== 'auto') { acc = 0; frames = 0; return; }
  cooldown = Math.max(0, cooldown - rdt);
  acc += rdt; frames++;
  if (acc < 4) return;
  const fps = frames / acc; acc = 0; frames = 0;
  if (fps < 30 && tier > 0 && cooldown <= 0) { applyTier((tier - 1) as Tier); cooldown = 6; console.info('quality ->', tier, 'fps was', fps.toFixed(0)); }
}

/** Bloom works at half resolution normally, quarter on the low tier. */
export const bloomScale = () => (tier === 0 ? 0.25 : 0.5);
