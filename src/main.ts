import './ui/styles.css';
import * as THREE from 'three';
import { S, net, ch } from './game/state';
import { loadClips } from './assets/loader';
import { onDownloadProgress, resetDownloadProgress } from './assets/net';
import { ensureModel, ensureModels, makeFighter, dropFighter, anim, applyGroundContact } from './fighters/fighter';
import { loadArenas, floorAt, setArena, type ArenaId } from './world/arena';
import { setupFighters, startMatch } from './game/flow';
import { G } from './data/rules';
import { loadSounds } from './audio/audio';
import { resize, setDebugCamera } from './camera/camera';
import { initLights } from './render/lights';
import { initQuality } from './render/quality';
import { initInput } from './input/input';
import { initMenus, buildRoster } from './ui/menus';
import { initSettingsUI } from './ui/settingsUI';
import { checkForUpdate } from './ui/update';
import { initTraining } from './game/training';
import { initPackUI } from './ui/packUI';
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
  initSettingsUI(); initTraining(); initPackUI();
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
    // Let the opening splash (CSS, ~2.4 s from page start) finish before the title replaces the loading screen.
    const splashLeft = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 2400 - performance.now();
    if (splashLeft > 0) await new Promise(r => setTimeout(r, splashLeft));
    $('load').hidden = true; $('title').hidden = false;
    startLoop();
    void checkForUpdate();
    // ?debug&shot=<arena>[&edge]: jump straight into a frozen duel there (for headless screenshots of arenas).
    const q = new URLSearchParams(location.search), shot = q.get('shot');
    if (q.has('debug') && shot) {
      await setArena(shot as ArenaId); await ensureModels([0, 3]);
      setupFighters(0, 3); startMatch(); $('title').hidden = true;
      setTimeout(() => {
        S.state = 'fight';
        if (q.has('edge')) { ch(0).x = -G.bx; ch(1).x = G.bx; ch(0).z = G.zMin; ch(1).z = G.zMax; }
        setTimeout(() => { S.paused = true; }, 1500);
      }, 2200);
    }
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
