import * as THREE from 'three';
import { scene } from '../render/stage';
import { emit, burst, explosion } from '../render/particles';
import { S, net, ch, projs, clones, isLocal } from '../game/state';
import { chest } from '../fighters/fighter';
import { play, pr } from '../audio/audio';
import { takeHit, applyDmg } from './damage';
import { wallHit, killClone } from './skills';
import { startStruggle } from '../game/struggle';
import { predictHit } from '../net/online';
import { G, PSPEC, DMG } from '../data/rules';
import { ICE, WHITE } from '../data/palettes';
import { V, C, rnd, pick } from '../core/util';
import type { Clone, ProjKind, Projectile } from '../core/types';
import { takeRibbon, impactFx, elementOf } from '../fx/vfx';

interface SpawnOrder { kind: ProjKind; owner: 0 | 1; x: number; y: number; z: number; dx: number; dy: number; dz: number; id?: number | string; remote?: boolean }

export function spawnProj(o: SpawnOrder): Projectile {
  const sp = PSPEC[o.kind]; const pal = ch(o.owner).pal;
  const core = new THREE.Mesh(new THREE.SphereGeometry(sp.r * 0.55, 14, 10), new THREE.MeshBasicMaterial({ color: pal[2].clone().multiplyScalar(1.3), toneMapped: false }));
  if (o.kind === 'spear' || o.kind === 'spark') core.scale.set(0.6, 0.6, 3);
  if (o.kind === 'gale') core.scale.set(3.2, 0.35, 0.8);
  scene.add(core);
  const d = V(o.dx, o.dy, o.dz).normalize();
  const p: Projectile = { ...sp, id: o.id ?? ++S.projId, owner: o.owner, kind: o.kind, pos: V(o.x, o.y, o.z), vel: d.multiplyScalar(sp.sp), core, pal, life: sp.life || 2.2, remote: !!o.remote, age: 0 };
  p.ribbon = takeRibbon(pal, sp.r);
  projs.push(p);
  return p;
}

export function killProj(p: Projectile, boom = true) {
  scene.remove(p.core); p.core.geometry.dispose(); (p.core.material as THREE.Material).dispose(); p.dead = true;
  p.ribbon?.end();
  if (!boom) return;
  impactFx(elementOf(ch(p.owner)), p.pos, p.pal, p.aoe ? 0.9 : p.dmg >= 15 ? 0.6 : 0.25);
  const snd = ch(p.owner).R.snd;
  if (p.aoe) {
    explosion(p.pos, p.pal, 1.4); play('m_fire_expl', { vol: 1, x: p.pos.x }); play(pr(snd), { vol: 0.8, x: p.pos.x });
    S.shake = Math.max(S.shake, 0.16);
  } else {
    burst(p.pos, p.pal, 35, 3, 0.45, 0.1);
    emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, p.pal[2], 0.4, 0.15, { t: 'flare', spin: 0 });
    play(pr(snd), { vol: 0.55, x: p.pos.x, rate: 1.15 });
  }
}

/** Area damage when an AoE projectile ends (victim's device only). */
function aoeCheck(p: Projectile) {
  if (!p.aoe || S.state !== 'fight') return;
  const t = ch(1 - p.owner);
  if (isLocal(t) && !t.dead && Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < p.aoe && t.dodgeT <= 0.08)
    applyDmg(t, t.shieldOn ? DMG.aoeShielded : DMG.aoe, ch(p.owner));
}

export function updProjs(dt: number) {
  for (const p of projs) {
    if (p.dead) continue;
    p.life -= dt; p.age += dt;
    if (p.home) {
      const want = chest(ch(1 - p.owner)).sub(p.pos).normalize();
      const v = p.vel.clone().normalize(); v.lerp(want, Math.min(1, p.home * dt)).normalize();
      p.vel.copy(v.multiplyScalar(Math.min(10, p.vel.length() + dt * 2.5)));
    }
    p.pos.addScaledVector(p.vel, dt); p.core.position.copy(p.pos); p.ribbon?.push(p.pos);
    if (p.kind === 'spear' || p.kind === 'spark' || p.kind === 'gale') p.core.lookAt(p.pos.clone().add(p.vel));
    const n = p.aoe ? 6 : 4;
    for (let i = 0; i < n; i++) emit(p.pos.x + rnd(p.r * 0.4), p.pos.y + rnd(p.r * 0.4), p.pos.z + rnd(p.r * 0.4), -p.vel.x * 0.04 + rnd(0.25), rnd(0.25) + 0.2, -p.vel.z * 0.04 + rnd(0.25), pick(p.pal), p.r * (1 + Math.random() * 1.1), 0.22 + Math.random() * 0.2, { t: p.trail as never, drag: 2 });
    emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, p.pal[1], p.r * 3.2, 0.05, { t: 'glow', spin: 0, a: 0.5 });
    if (p.aoe && Math.random() < 0.4) emit(p.pos.x, p.pos.y, p.pos.z, rnd(0.2), 0.4, rnd(0.2), C(0.1, 0.1, 0.12), 0.4, 1, { t: 'smoke', smoke: 1, grow: 0.6, a: 0.4 });

    if (p.life <= 0 || Math.abs(p.pos.x) > G.bx + 1.2 || p.pos.z > G.zMax + 2.6 || p.pos.z < G.zMin - 1.4 || p.pos.y < 0.05) { aoeCheck(p); killProj(p); continue; }
    if (wallHit(p)) { burst(p.pos, ICE, 30, 3, 0.4, 0.1, 'star'); play('m_ice_thin', { vol: 0.35, x: p.pos.x, dur: 0.8 }); killProj(p, false); continue; }

    let hitC: Clone | null = null;
    for (const cl of clones) if (cl.owner !== p.owner && Math.hypot(p.pos.x - cl.x, p.pos.z - cl.z) < p.r + 0.4 && p.pos.y < 2) { hitC = cl; break; }
    if (hitC) {
      killClone(hitC); killProj(p, !p.aoe);
      // Preserved from the original: an AoE hitting a clone also explodes in place.
      if (p.aoe) { aoeCheck(p); killProj(p); }
      continue;
    }

    const tgt = ch(1 - p.owner);
    // A veiled Ehab is hard to hit: only spells that come straight at him connect.
    const body = tgt.shieldOn ? 0.8 : tgt.veilT > 0 ? 0.14 : 0.38;
    if (!tgt.dead && S.state === 'fight' && Math.hypot(p.pos.x - tgt.x, p.pos.z - tgt.z) < p.r + body && p.pos.y < 2.1) {
      if (isLocal(tgt)) { const r = takeHit(tgt, p); if (r === 'miss') continue; killProj(p, r !== 'parry'); }
      else { if (tgt.dodgeT > 0) continue; predictHit(tgt, p); killProj(p); }
    }
  }
  // Two enemy projectiles meeting mid-air: start a beam struggle (host decides online) or cancel by power.
  for (let i = 0; i < projs.length; i++) for (let j = i + 1; j < projs.length; j++) {
    const a = projs[i], b = projs[j];
    if (a.dead || b.dead || a.owner === b.owner) continue;
    if (a.pos.distanceTo(b.pos) < a.r + b.r + 0.05) {
      if (S.state === 'fight' && S.T > S.strugReady && (S.mode !== 'online' || net.me === 0)) { startStruggle(a, b); break; }
      burst(a.pos.clone().lerp(b.pos, 0.5), WHITE, 30, 3, 0.4, 0.12, 'star'); play('m_blast', { vol: 0.5 });
      if (a.pw <= b.pw) killProj(a);
      if (b.pw <= a.pw) killProj(b);
    }
  }
  for (let i = projs.length - 1; i >= 0; i--) if (projs[i].dead) projs.splice(i, 1);
}

export function clearProjectiles() { projs.slice().forEach(p => killProj(p, false)); projs.length = 0; }
