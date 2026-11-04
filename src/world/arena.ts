import * as THREE from 'three';
import { scene, moon, rim } from '../render/stage';
import { loadCourt, courtRoot, COURT_ENV, updateCourtAmbience, courtFloorAt } from './court';
import { loadTerrace, terraceRoot, TERRACE_ENV, updateTerraceAmbience } from './terrace';

/** Lighting and atmosphere that belong to an arena. */
export interface ArenaEnv {
  moon: [number, number, number]; moonColor: number; moonI: number;
  rim: [number, number, number]; rimI: number;
  fog: number; fogD: number; bg: number;
}

export type ArenaId = 'court' | 'terrace';
interface Arena { root: THREE.Group; env: ArenaEnv; load: () => Promise<void>; ambience: (rdt: number) => void; loading?: Promise<void> }

/** Both arenas: the scanned stone courtyard and the moonlit castle terrace. Each loads on first use. */
const ARENAS: Record<ArenaId, Arena> = {
  court: { root: courtRoot, env: COURT_ENV, load: loadCourt, ambience: updateCourtAmbience },
  terrace: { root: terraceRoot, env: TERRACE_ENV, load: loadTerrace, ambience: updateTerraceAmbience },
};

const KEY = 'asrar.arena';
let current: ArenaId = localStorage.getItem(KEY) === 'court' ? 'court' : 'terrace';
export const getArena = () => current;

function ensure(id: ArenaId) { const a = ARENAS[id]; a.loading ??= a.load(); return a.loading; }

function applyEnv(e: ArenaEnv) {
  moon.position.set(...e.moon); moon.color.setHex(e.moonColor); moon.intensity = e.moonI; moon.target.position.set(0, 0, -1);
  rim.position.set(...e.rim); rim.intensity = e.rimI;
  scene.fog = new THREE.FogExp2(e.fog, e.fogD);
  scene.background = new THREE.Color(e.bg);
}

/** Shows one arena (loading it if needed) and hides the other. */
export async function setArena(id: ArenaId) {
  current = id; localStorage.setItem(KEY, id);
  await ensure(id);
  if (current !== id) return; // a later choice won
  for (const [k, a] of Object.entries(ARENAS)) a.root.visible = k === id;
  applyEnv(ARENAS[id].env);
}

/** Boot: load the remembered arena; warm up the other one in the background. */
export async function loadArenas(onLoaded: () => void) {
  await setArena(current);
  onLoaded();
  // On slow or data-saving connections the other arena is only fetched when it is actually chosen.
  const net = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (net?.saveData || /(^|-)2g|3g/.test(net?.effectiveType ?? '')) return;
  const other: ArenaId = current === 'court' ? 'terrace' : 'court';
  setTimeout(() => { void ensure(other).then(() => { ARENAS[other].root.visible = current === other; }); }, 1500);
}

export function updateAmbience(rdt: number) { ARENAS[current].ambience(rdt); }

/** Floor height under a point of the current arena (the terrace is flat). */
export function floorAt(x: number, z: number) { return current === 'court' ? courtFloorAt(x, z) : 0; }
