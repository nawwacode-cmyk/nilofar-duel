import * as THREE from 'three';
import { scene } from '../render/stage';
import { emit, burst, explosion } from '../render/particles';
import { S, net, ch, me, opp, isLocal, projs, strikes } from './state';
import { anim, tipPos, chest } from '../fighters/fighter';
import { play, startHum, stopHum, setHumRate } from '../audio/audio';
import { flash } from '../fx/effects';
import { setShield } from '../combat/actions';
import { killProj } from '../combat/projectiles';
import { applyDmg } from '../combat/damage';
import { banner } from '../ui/hud';
import { G, DMG, AI_LEVELS } from '../data/rules';
import { WHITE } from '../data/palettes';
import { TXT } from '../data/text';
import { $, V, clamp, rnd, pick } from '../core/util';
import type { Palette, Projectile } from '../core/types';

/**
 * Beam struggle: two bolts colliding lock both wizards in a tug-of-war.
 * strug.s runs from -1 (player 1 wins) to +1 (player 0 wins). Offline the AI mashes at a
 * difficulty-based rate; online the host integrates both mash counters and broadcasts the result.
 */
interface Beam { a: { core: THREE.Mesh; glow: THREE.Mesh }; b: { core: THREE.Mesh; glow: THREE.Mesh }; s: number }
interface Struggle { s: number; ai: number; acc: number; acc0: number; id: number; my: number; mySeen: number; oppSeen: number }

let beam: Beam | null = null;
let strug: Struggle | null = null;
export const getStruggle = () => strug;

const UP = V(0, 1, 0);
function placeCyl(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = V().subVectors(b, a); const L = d.length();
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.scale.set(r, L, r);
}

function beamMesh(pal: Palette) {
  const mat = (col: THREE.Color, op = 1) => new THREE.MeshBasicMaterial({ color: col, toneMapped: false, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), mat(pal[2].clone().multiplyScalar(1.2)));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), mat(pal[1].clone().multiplyScalar(0.7), 0.6));
  scene.add(core, glow);
  return { core, glow };
}

export function startStruggle(pa: Projectile | null, pb: Projectile | null, sid?: number) {
  S.state = 'struggle'; S.stateT = 0;
  projs.slice().forEach(p => { if (!p.dead) { if (p !== pa && p !== pb) burst(p.pos, p.pal, 10, 2); killProj(p, false); } });
  strikes.length = 0; S.slowmo = 1;
  S.CH.forEach(c => { if (!c) return; setShield(c, false); anim(c, 'beam', { force: true }); c.castT = 0; });
  beam = { a: beamMesh(ch(0).pal), b: beamMesh(ch(1).pal), s: 0 };
  strug = { s: 0, ai: AI_LEVELS[S.diff].struggle + Math.random() * 1.5, acc: 0, acc0: 0, id: sid || ((Math.random() * 1e9) | 0), my: 0, mySeen: 0, oppSeen: 0 };
  if (S.mode === 'online' && net.me === 0) { net.sg = strug.id; net.sr = null; }
  banner(''); $('sTitle').textContent = TXT.struggle;
  $('sWrap').hidden = false; $('ctl').hidden = true;
  startHum();
  play('m_blast', { vol: 1 }); play('c_chant', { vol: 0.4 });
}

export function mash() {
  if (!strug) return;
  strug.my++;
  if (S.mode !== 'online') strug.s = clamp(strug.s + (me().idx === 0 ? 0.05 : -0.05), -1, 1);
  const t = tipPos(me());
  for (let i = 0; i < 6; i++) emit(t.x, t.y, t.z, rnd(1.5), rnd(1.5), rnd(1.5), pick(me().pal), 0.1, 0.3, { t: 'spark' });
}

export function updStruggle(dt: number) {
  if (!strug || !beam) return;
  const a = ch(0), b = ch(1);
  // Note: the main loop also advances stateT, so the struggle clock runs at double speed (5.5 units ≈ 2.75 s). Kept as-is for identical timing.
  S.stateT += dt;
  if (S.mode === 'ai') {
    strug.acc += dt * strug.ai * (1 + Math.sin(S.stateT * 3) * 0.25);
    while (strug.acc >= 1) { strug.acc -= 1; strug.s = clamp(strug.s + (me().idx === 0 ? -0.05 : 0.05), -1, 1); }
    // Simulator: side 0 is the computer too and mashes at the same average rate (button-mashing skill is
    // the human's, not the wizard's, so it should not tilt the balance numbers).
    if (S.sim) {
      strug.acc0 += dt * strug.ai * (1 + Math.sin(S.stateT * 2.3 + 1) * 0.25);
      while (strug.acc0 >= 1) { strug.acc0 -= 1; strug.s = clamp(strug.s + 0.05, -1, 1); }
    }
  } else if (net.me === 0) {
    const md = strug.my - strug.mySeen; strug.mySeen = strug.my;
    const oc = net.oppMcId === strug.id ? net.oppMc : 0;
    const od = Math.max(0, oc - strug.oppSeen); strug.oppSeen = Math.max(strug.oppSeen, oc);
    strug.s = clamp(strug.s + (md - od) * 0.05, -1, 1);
  } else strug.s = net.hostS || 0;

  beam.s += (strug.s - beam.s) * 0.2;
  $('sI').style.left = 50 + strug.s * 50 + '%';
  setHumRate(1 + Math.abs(strug.s) * 0.4);
  const A = tipPos(a), B = tipPos(b);
  const mid = V().lerpVectors(A, B, 0.5 + beam.s * 0.45);
  const w = 1 + Math.sin(S.stateT * 30) * 0.15;
  placeCyl(beam.a.core, A, mid, 0.02 * w); placeCyl(beam.a.glow, A, mid, 0.07 * w);
  placeCyl(beam.b.core, B, mid, 0.02 * w); placeCyl(beam.b.glow, B, mid, 0.07 * w);
  for (const [P, pal] of [[A, a.pal], [B, b.pal]] as const) for (let i = 0; i < 14; i++) {
    const p = V().lerpVectors(P, mid, Math.random());
    emit(p.x + rnd(0.06), p.y + rnd(0.06), p.z + rnd(0.06), rnd(0.5), rnd(0.5) + 0.2, rnd(0.5), pick(pal), 0.12 + Math.random() * 0.15, 0.3, { t: Math.random() < 0.5 ? 'flame' : 'spark', drag: 2 });
  }
  for (let i = 0; i < 10; i++) {
    const v = V().randomDirection().multiplyScalar(1.5 + Math.random() * 3);
    emit(mid.x, mid.y, mid.z, v.x, v.y + 1, v.z, Math.random() < 0.5 ? pick(a.pal) : pick(b.pal), 0.15 + Math.random() * 0.15, 0.5, { t: 'spark', grav: -4, drag: 1.2 });
  }
  emit(mid.x, mid.y, mid.z, 0, 0, 0, WHITE[0], 0.45 + Math.random() * 0.3, 0.06, { t: 'flare' });
  for (const c of [a, b]) {
    const p = chest(c);
    for (let i = 0; i < 3; i++) { const ang = S.stateT * 4 + i * 2, r = 0.5 + Math.random() * 0.3; emit(p.x + Math.cos(ang) * r, p.y - 0.6 + Math.random() * 1.4, p.z + Math.sin(ang) * r, rnd(0.3), 0.6, rnd(0.3), pick(c.pal), 0.2, 0.6, { t: 'flame', grav: 0.4, drag: 1 }); }
  }
  flash(a, 10); flash(b, 10); S.shake = Math.max(S.shake, 0.012);
  const decider = S.mode !== 'online' || net.me === 0;
  if (decider && (Math.abs(strug.s) >= 1 || S.stateT > 5.5)) {
    const w = Math.abs(strug.s) < 0.08 ? -1 : strug.s > 0 ? 0 : 1;
    if (S.mode === 'online') net.sr = [strug.id, w];
    endStruggle(w);
  }
}

/** w = winner index, or -1 for a draw (both take damage). */
export function endStruggle(w: number) {
  if (!beam) return;
  const a = ch(0), b = ch(1); const A = tipPos(a), B = tipPos(b);
  for (const s of [beam.a, beam.b]) scene.remove(s.core, s.glow);
  beam = null; stopHum();
  $('sWrap').hidden = true; $('ctl').hidden = false; S.state = 'fight';
  S.CH.forEach(c => c && anim(c, 'idle', { force: true }));
  S.strugReady = S.T + G.strugCd;
  if (w >= 0) {
    const win = ch(w), l = opp(win);
    explosion(chest(l), win.pal, 1.6); play('m_epic', { vol: 1 }); play('c_huge', { vol: 0.5 }); S.shake = 0.25;
    if (isLocal(l)) applyDmg(l, DMG.struggleWin, win);
  } else {
    explosion(V().lerpVectors(A, B, 0.5), WHITE, 1.5); play('boom1', { vol: 1 });
    if (isLocal(a)) applyDmg(a, DMG.struggleDraw, b);
    if (isLocal(b)) applyDmg(b, DMG.struggleDraw, a);
  }
  strug = null;
}
