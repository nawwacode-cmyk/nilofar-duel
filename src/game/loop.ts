import * as THREE from 'three';
import { composer } from '../render/stage';
import { updateParticles } from '../render/particles';
import { S, net, ch, me, inMenus } from './state';
import { endMatch, newRound } from './flow';
import { updStruggle } from './struggle';
import { updChar } from '../fighters/update';
import { castBolt } from '../combat/actions';
import { updProjs } from '../combat/projectiles';
import { updStrikes, updWalls, updClones } from '../combat/skills';
import { aiThink } from '../ai/ai';
import { netSend, expirePredictions, checkConnection } from '../net/online';
import { trainTick } from './training';
import { atkHeld, readMove, pumpInput } from '../input/input';
import { updCamera, applyDebugCamera } from '../camera/camera';
import { updateAmbience } from '../world/arena';
import { updateFx } from '../fx/effects';
import { banner, hud, updateButtons } from '../ui/hud';
import { play } from '../audio/audio';
import { TXT } from '../data/text';
import { runScheduled } from './schedule';
import { timeScale, updateImpactFx } from '../fx/impact';
import { updateLights } from '../render/lights';
import { monitorFps } from '../render/quality';
import { updatePost } from '../render/post';
import { updateVfx } from '../fx/vfx';
import { updateFlipbooks } from '../fx/flipbook';

const clock = new THREE.Clock();
let netAcc = 0;

/**
 * One step of game logic (state machine, input/AI, fighters, spells). Shared by the real frame loop and the
 * balance simulator (sim/sim.ts), which calls it with a fixed step and no rendering. Returns the scaled dt.
 */
export function tick(rdt: number) {
  // Online duels freeze while the connection is lost (checkConnection), and resume where they were.
  checkConnection();
  const dt = rdt * S.slowmo * timeScale(rdt) * (net.waiting ? 0 : 1);
  S.T += dt; S.stateT += rdt;
  runScheduled();
  if (S.CH[0]) {
    if (S.state === 'intro' && S.stateT > 1.8) {
      S.state = 'fight'; banner(TXT.fight); play('m_epic', { vol: 0.6 });
      setTimeout(() => { if (S.state === 'fight') banner(''); }, 700);
    }
    if (S.state === 'ko' && S.stateT > 2.8) {
      S.slowmo = 1;
      if (S.CH.some(c => c && c.wins >= 2)) endMatch(); else { banner(''); newRound(); }
    }
    if (S.state === 'fight' || S.state === 'intro') {
      if (S.sim) { if (S.state === 'fight') aiThink(ch(0), dt); }
      else { const m = me(); const [ix, iz] = readMove(); m.inX = ix; m.inZ = iz; pumpInput(); if (atkHeld && S.state === 'fight') castBolt(m); }
      if (S.mode === 'ai' && S.state === 'fight') aiThink(ch(1), dt);
      if (S.mode === 'train') trainTick(dt);
    }
    if (S.state === 'struggle') updStruggle(rdt);
    S.CH.forEach(c => c && updChar(c, dt, S.mode !== 'online' || c.idx === net.me || S.state === 'menu'));
    updProjs(dt); updStrikes(dt); updWalls(dt); updClones(dt);
    if (!inMenus()) { hud(); updateButtons(); }
    netAcc += rdt;
    // 20 Hz state, plus an immediate send (capped at 40 Hz) for casts and HP changes.
    if (S.mode === 'online' && (netAcc > 0.05 || (net.urgent && netAcc > 0.025))) { netAcc = 0; netSend(); }
    if (S.mode === 'online') expirePredictions(ch(1 - net.me));
  }
  return dt;
}

/** One rendered frame: game logic, effects, camera, render. dt is capped at 50 ms. */
function frame() {
  const rdt = Math.min(0.05, clock.getDelta());
  if (S.sim) { requestAnimationFrame(frame); return; } // the simulator drives tick() itself
  const dt = S.paused ? 0 : tick(rdt);
  updateAmbience(rdt);
  updateFx(dt);
  updateLights(dt);
  updatePost(rdt);
  updateVfx(dt);
  updateFlipbooks(rdt);
  updateImpactFx(rdt, S.CH[0] ? me() : null);
  monitorFps(rdt, S.state === 'fight');
  updateParticles(dt);
  if (S.CH[0]) { updCamera(rdt); applyDebugCamera(); }
  // Title/select/online screens cover the canvas with the castle artwork, so skip the GPU work there.
  if (!inMenus()) composer.render();
  requestAnimationFrame(frame);
}

export function startLoop() { requestAnimationFrame(frame); }
