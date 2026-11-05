import * as THREE from 'three';
import { scene, moon, rim, hemi, renderer } from '../render/stage';
import { G } from '../data/rules';
import { loadCourt, courtRoot, COURT_ENV, updateCourtAmbience, courtFloorAt } from './court';
import { loadTerrace, terraceRoot, TERRACE_ENV, updateTerraceAmbience } from './terrace';
import { loadPalace, palaceRoot, PALACE_ENV, updatePalaceAmbience, palaceFloorAt } from './palace';
import { captureArenaEnv, setDaylight } from '../render/charLight';

/** Lighting and atmosphere that belong to an arena. */
export interface ArenaEnv {
  moon: [number, number, number]; moonColor: number; moonI: number;
  rim: [number, number, number]; rimI: number;
  fog: number; fogD: number; bg: number;
  /** Optional (night defaults): ambient sky/ground light, exposure, sky gradient top→horizon,
   *  duel-area bounds, how far back the camera may go (+z) and the half-size of the shadow frustum. */
  hemi?: [number, number, number]; exposure?: number; sky?: [string, string];
  bounds?: { bx: number; zMin: number; zMax: number }; camLim?: number; shadow?: number;
  /** Round obstacles fighters cannot walk through: [x, z, radius]. */
  obstacles?: [number, number, number][];
}

/** The night arenas' duel area (the original game's bounds). */
const NIGHT = { hemi: [0x6a80c0, 0x10121a, 1.05] as [number, number, number], exposure: 1.15, bounds: { bx: 4.6, zMin: -4.3, zMax: 2.4 }, camLim: 5.5, shadow: 7 };
let camLim = NIGHT.camLim;
let obst: [number, number, number][] = [];
/** Round obstacles of the current arena. */
export const obstacles = () => obst;
/** Furthest the camera may move towards the viewer in the current arena. */
export const cameraLimit = () => camLim;

/** A vertical gradient for daytime skies (drawn as the screen background). */
function skyTexture([top, horizon]: [string, string]) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d')!; const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(0.75, horizon); g.addColorStop(1, horizon);
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export type ArenaId = 'court' | 'terrace' | 'palace';
interface Arena { root: THREE.Group; env: ArenaEnv; load: () => Promise<void>; ambience: (rdt: number) => void; loading?: Promise<void> }

/** The arenas: scanned stone courtyard, moonlit castle terrace, sunlit palace courtyard. Each loads on first use. */
const ARENAS: Record<ArenaId, Arena> = {
  court: { root: courtRoot, env: COURT_ENV, load: loadCourt, ambience: updateCourtAmbience },
  terrace: { root: terraceRoot, env: TERRACE_ENV, load: loadTerrace, ambience: updateTerraceAmbience },
  palace: { root: palaceRoot, env: PALACE_ENV, load: loadPalace, ambience: updatePalaceAmbience },
};

const KEY = 'asrar.arena';
const saved = localStorage.getItem(KEY);
let current: ArenaId = saved === 'court' || saved === 'palace' ? saved : 'terrace';
export const getArena = () => current;

function ensure(id: ArenaId) { const a = ARENAS[id]; a.loading ??= a.load(); return a.loading; }

function applyEnv(e: ArenaEnv) {
  moon.position.set(...e.moon); moon.color.setHex(e.moonColor); moon.intensity = e.moonI; moon.target.position.set(0, 0, -1);
  rim.position.set(...e.rim); rim.intensity = e.rimI;
  scene.fog = new THREE.FogExp2(e.fog, e.fogD);
  scene.background = e.sky ? skyTexture(e.sky) : new THREE.Color(e.bg);
  const [sky, ground, hi] = e.hemi ?? NIGHT.hemi; hemi.color.setHex(sky); hemi.groundColor.setHex(ground); hemi.intensity = hi;
  renderer.toneMappingExposure = e.exposure ?? NIGHT.exposure;
  const s = e.shadow ?? NIGHT.shadow, sc = moon.shadow.camera;
  sc.left = -s; sc.right = s; sc.top = s * 0.86; sc.bottom = -s * 0.86; sc.updateProjectionMatrix();
  // The duel area follows the arena (both online players always share the host's arena).
  Object.assign(G as unknown as Record<string, number>, e.bounds ?? NIGHT.bounds);
  camLim = e.camLim ?? NIGHT.camLim;
  obst = e.obstacles ?? [];
}

/** Shows one arena (loading it if needed) and hides the other. */
export async function setArena(id: ArenaId, remember = true) {
  current = id; if (remember) localStorage.setItem(KEY, id);
  await ensure(id);
  if (current !== id) return; // a later choice won
  for (const [k, a] of Object.entries(ARENAS)) a.root.visible = k === id;
  applyEnv(ARENAS[id].env);
  // The wizards' reflections and ambient light come from this arena.
  setDaylight((ARENAS[id].env.exposure ?? 1) > 1.4);
  captureArenaEnv(ARENAS[id].root);
}

/** Boot: load the remembered arena; warm up the other one in the background. */
export async function loadArenas(onLoaded: () => void) {
  await setArena(current);
  onLoaded();
  // On slow or data-saving connections the other arena is only fetched when it is actually chosen.
  const net = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (net?.saveData || /(^|-)2g|3g/.test(net?.effectiveType ?? '')) return;
  // Then warm up the others one after another.
  setTimeout(() => {
    void (Object.keys(ARENAS) as ArenaId[]).filter(k => k !== current).reduce((p, k) => p.then(() => ensure(k)).then(() => { ARENAS[k].root.visible = current === k; }), Promise.resolve());
  }, 1500);
}

/** Back to the player's own choice after a mode that uses a fixed arena (training). */
export function restoreArena() {
  const saved = localStorage.getItem(KEY) as ArenaId | null;
  const id: ArenaId = saved === 'court' || saved === 'palace' ? saved : 'terrace';
  if (id !== current) void setArena(id);
}

export function updateAmbience(rdt: number) { ARENAS[current].ambience(rdt); }

/** Floor height under a point of the current arena (the terrace is flat). */
export function floorAt(x: number, z: number) { return current === 'court' ? courtFloorAt(x, z) : current === 'palace' ? palaceFloorAt(x, z) : 0; }
