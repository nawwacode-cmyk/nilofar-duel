import * as THREE from 'three';
import { S, isLocal } from '../game/state';
import { grade } from '../render/stage';
import { lightFlash } from '../render/lights';
import { chest } from '../fighters/fighter';
import { reduceMotion } from '../core/util';
import { settings } from '../settings/settings';
import type { Fighter } from '../core/types';
import { rimStrength } from '../render/charLight';
import { play, setMusicIntensity } from '../audio/audio';

/**
 * Hit feel: hit-stop (a few frames of near-freeze), white flash on the victim's materials,
 * knock-back, a camera punch, a screen flash on heavy hits and the low-health danger vignette.
 */
let hitstop = 0;
let punch = 0;
let flashScreen = 0;

/** Severity 0..1 (light bolt ~0.2, meteor/thunder ~0.8, KO 1). */
export function impact(victim: Fighter, attacker: Fighter, severity: number) {
  hitstop = Math.max(hitstop, 0.035 + 0.11 * severity);
  punch = Math.max(punch, severity);
  if (severity >= 0.6 && !reduceMotion) flashScreen = Math.max(flashScreen, 0.12 * severity);
  // Heavy blows land with a body thud under the spell's own sound.
  if (severity >= 0.45) { play('k_thud' + ((Math.random() * 3) | 0), { vol: 0.35 + 0.5 * severity, x: victim.x, rate: 0.85 }); if (severity >= 0.75) play('boom1', { vol: 0.35, x: victim.x, rate: 0.7 }); }
  victim.hitFlash = 1;
  const p = chest(victim);
  lightFlash(p.x, p.y, p.z, attacker.pal, 10 + 18 * severity, 0.18 + 0.2 * severity);
  if (isLocal(victim) && !victim.dead) {
    // Push the victim away from the attacker; decays through normal movement smoothing.
    const dx = victim.x - attacker.x, dz = victim.z - attacker.z, L = Math.hypot(dx, dz) || 1;
    const k = 1.5 + 5 * severity;
    victim.vx += (dx / L) * k; victim.vz += (dz / L) * k;
    victim.knockT = 0.12 + 0.18 * severity;
  }
}

/** Returns the time scale for this frame (near-zero during hit-stop). Real time keeps flowing for UI. */
export function timeScale(rdt: number) {
  if (hitstop <= 0) return 1;
  hitstop -= rdt;
  return 0.06;
}

/** Field-of-view kick in degrees, decays quickly. */
export function fovPunch(rdt: number) { punch *= Math.pow(0.0005, rdt); return reduceMotion ? 0 : -2.2 * punch; }

const white = new THREE.Color(1, 1, 1);
/** Per-frame material flash + post effects. */
export function updateImpactFx(rdt: number, me: Fighter | null) {
  flashScreen = Math.max(0, flashScreen - rdt * 0.9);
  grade.uniforms.uFlash.value = settings.flashes ? flashScreen : 0;
  const danger = me && S.state === 'fight' && !me.dead ? Math.max(0, 1 - me.hp / (me.R.hp * 0.3)) : 0;
  const pulse = danger > 0 ? danger * (0.65 + 0.35 * Math.sin(S.T * 7)) : 0;
  // Music gets more intense as either wizard nears defeat.
  const low = S.state === 'fight' ? Math.max(...S.CH.map(c => (c && !c.dead ? 1 - c.hp / c.R.hp : 0))) : 0;
  setMusicIntensity(low);
  grade.uniforms.uDanger.value += (pulse - grade.uniforms.uDanger.value) * Math.min(1, rdt * 6);
  for (const c of S.CH) {
    if (!c || !c.mats) continue;
    if (c.hitFlash > 0) c.hitFlash = Math.max(0, c.hitFlash - rdt * 9);
    c.rimU.strength.value = c.veilT > 0 ? 0 : rimStrength(c.light.intensity);
    const k = c.hitFlash * c.hitFlash;
    for (const m of c.mats) m.emissive.copy(m.userData.baseEmissive).lerp(white, settings.flashes ? k * 0.45 : 0);
  }
}
