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
import { netSend } from '../net/online';
import { atkHeld, readMove } from '../input/input';
import { updCamera } from '../camera/camera';
import { updateAmbience } from '../world/court';
import { updateFx } from '../fx/effects';
import { banner, hud, updateButtons } from '../ui/hud';
import { play } from '../audio/audio';
import { TXT } from '../data/text';

const clock = new THREE.Clock();
let netAcc = 0;

/** One frame: state machine, simulation, effects, camera, render. dt is capped at 50 ms. */
function frame() {
  const rdt = Math.min(0.05, clock.getDelta());
  const dt = rdt * S.slowmo;
  S.T += dt; S.stateT += rdt;
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
      const m = me(); const [ix, iz] = readMove(); m.inX = ix; m.inZ = iz;
      if (atkHeld && S.state === 'fight') castBolt(m);
      if (S.mode === 'ai' && S.state === 'fight') aiThink(ch(1), dt);
    }
    if (S.state === 'struggle') updStruggle(rdt);
    S.CH.forEach(c => c && updChar(c, dt, S.mode !== 'online' || c.idx === net.me || S.state === 'menu'));
    updProjs(dt); updStrikes(dt); updWalls(dt); updClones(dt);
    if (!inMenus()) { hud(); updateButtons(); }
    netAcc += rdt;
    if (S.mode === 'online' && netAcc > 0.05) { netAcc = 0; netSend(); }
  }
  updateAmbience(rdt);
  updateFx(dt);
  updateParticles(dt);
  if (S.CH[0]) updCamera(rdt);
  // Title/select/online screens cover the canvas with the castle artwork, so skip the GPU work there.
  if (!inMenus()) composer.render();
  requestAnimationFrame(frame);
}

export function startLoop() { requestAnimationFrame(frame); }
