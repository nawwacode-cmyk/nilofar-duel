import './ui/styles.css';
import * as THREE from 'three';
import { S } from './game/state';
import { loadClips } from './assets/loader';
import { loadRosterModels } from './fighters/fighter';
import { loadCourt, makeTorches } from './world/court';
import { buildCrowd } from './world/crowd';
import { loadSounds } from './audio/audio';
import { resize, setDebugCamera } from './camera/camera';
import { initLights } from './render/lights';
import { initQuality } from './render/quality';
import { initInput } from './input/input';
import { initMenus, buildRoster, makePortraits } from './ui/menus';
import { showcase } from './game/flow';
import { startLoop } from './game/loop';
import { ROSTER } from './data/roster';
import { CLIP_NAMES } from './core/types';
import { TXT } from './data/text';
import { $ } from './core/util';
import { scene, camera, renderer } from './render/stage';

/** Boot: load everything in parallel with a progress bar, then show the title screen. */
async function boot() {
  initLights();
  initQuality();
  resize();
  addEventListener('resize', resize);
  initInput();
  initMenus();
  const bar = $('bar').firstElementChild as HTMLElement;
  let done = 0; const total = ROSTER.length + CLIP_NAMES.length + 2;
  const pct = $('pct');
  const tick = () => { const p = Math.round((++done / total) * 100); bar.style.width = p + '%'; pct.textContent = p + '%'; };
  try {
    await Promise.all([loadRosterModels(tick), loadClips(tick), loadCourt().then(tick), loadSounds().then(tick)]);
    makeTorches();
    buildCrowd();
    makePortraits();
    S.state = 'title'; buildRoster(); showcase();
    // ?debug exposes internals for manual inspection and automated browser checks.
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __dbg: { S, scene, camera, renderer, THREE, camAt: setDebugCamera } });
    $('load').hidden = true; $('title').hidden = false;
    startLoop();
  } catch (e) {
    console.error(e);
    $('loadTxt').textContent = TXT.loadFail;
  }
}

void boot();
