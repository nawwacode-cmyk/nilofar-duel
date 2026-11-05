import './ui/styles.css';
import * as THREE from 'three';
import { S, net } from './game/state';
import { loadClips } from './assets/loader';
import { onDownloadProgress, resetDownloadProgress } from './assets/net';
import { ensureModel, ensureModels, makeFighter, dropFighter, anim, applyGroundContact } from './fighters/fighter';
import { loadArenas, floorAt } from './world/arena';
import { loadSounds } from './audio/audio';
import { resize, setDebugCamera } from './camera/camera';
import { initLights } from './render/lights';
import { initQuality } from './render/quality';
import { initInput } from './input/input';
import { initMenus, buildRoster } from './ui/menus';
import { initSettingsUI } from './ui/settingsUI';
import { startLoop } from './game/loop';
import { runBalance, trace } from './sim/sim';
import { ROSTER } from './data/roster';
import { TXT } from './data/text';
import { $ } from './core/util';
import { scene, camera, renderer } from './render/stage';

const mb = (b: number) => (b / 1048576).toFixed(1);

/**
 * Boot, tuned for slow connections:
 * 1. Only what the first screens need blocks the title: animations (~0.3 MB) and the chosen arena.
 *    The progress bar counts real bytes, so it moves even on a very slow line.
 * 2. The four character models and the sounds then download in the background (selected wizard first);
 *    starting a duel waits only for its two fighters.
 */
async function boot() {
  initLights();
  initQuality();
  resize();
  addEventListener('resize', resize);
  initInput();
  initMenus();
  initSettingsUI();
  const bar = $('bar').firstElementChild as HTMLElement, pct = $('pct');
  onDownloadProgress((l, t) => {
    const p = Math.min(100, Math.round((l / Math.max(1, t)) * 100));
    bar.style.width = p + '%'; pct.textContent = `${p}% · ${mb(l)}/${mb(t)} MB`;
  });
  try {
    await Promise.all([loadClips(), loadArenas(() => {})]);
    onDownloadProgress(null); resetDownloadProgress();
    S.state = 'title'; buildRoster();
    // ?debug exposes internals for manual inspection and automated browser checks.
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __dbg: { S, net, scene, camera, renderer, THREE, camAt: setDebugCamera, makeFighter, dropFighter, ensureModels, anim, applyGroundContact, floorAt, balance: runBalance, simTrace: trace } });
    $('load').hidden = true; $('title').hidden = false;
    startLoop();
    void preload();
  } catch (e) {
    console.error(e);
    $('loadTxt').textContent = `${TXT.loadFail} (${e instanceof Error ? e.message : String(e)})`;
  }
}

/** Background downloads, one at a time so the selected wizard arrives first. */
async function preload() {
  const order = [S.sel, ...ROSTER.map((_, i) => i).filter(i => i !== S.sel)];
  for (const i of order) await ensureModel(i).catch(e => console.warn('model', i, e));
  await loadSounds().catch(e => console.warn('sounds', e));
}

void boot();
