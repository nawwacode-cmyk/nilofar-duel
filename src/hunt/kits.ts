import * as THREE from 'three';
import { scene } from '../render/stage';
import { emit, burst, explosion } from '../render/particles';
import { lightFlash } from '../render/lights';
import { play } from '../audio/audio';
import { S } from '../game/state';
import { tipPos, chest } from '../fighters/fighter';
import { V, rnd, pick, angleDelta } from '../core/util';
import { ARCH, FLORA, WIND } from '../data/palettes';
import type { Fighter } from '../core/types';
import { navHeight, type Nav } from './nav';
import { monsters, targetable, type Monster } from './monsters';

/**
 * The three story heroes' abilities against monsters (special, skill, and the fourth "power"). Each ability is one
 * function run on the caster's device (`mine`: deals damage, heals, hides) and replayed on the friend's device for
 * show only (`mine` false), from the same arguments (angle and points chosen by the caster).
 */
export type Hero = 'ehab' | 'sara' | 'abed';
export type Slot = 'sp' | 'sk' | 'sk2';
export const HEROES: Hero[] = ['ehab', 'sara', 'abed'];

export interface KitCtx {
  nav: Nav;
  /** A spell of ours landed (host applies, guest reports); optional hold and throw-back. */
  hit: (m: Monster, dmg: number, opts?: { stun?: number; push?: [number, number, number] }) => void;
  heal: (who: 'me' | 'mate', amount: number) => void;
  hide: (seconds: number) => void;
  mate: Fighter | null;
}

/** Names on the buttons and in the hero sheet. */
export const KIT_NAMES: Record<Hero, Record<Slot, string>> = {
  ehab: { sp: 'حكم الذهب', sk: 'حجاب الخداع', sk2: 'جيش الأوهام' },
  sara: { sp: 'عاصفة البتلات', sk: 'زهرة الشفاء', sk2: 'سجن الأشواك' },
  abed: { sp: 'الدوّامة', sk: 'عصف الريح', sk2: 'الإعصار' },
};

/** Things that live on for a while (homing orbs, the tornado, the thorn field). */
const live: ((dt: number) => boolean)[] = [];
export function updateKits(dt: number) { for (let i = live.length - 1; i >= 0; i--) if (!live[i](dt)) live.splice(i, 1); }
export function clearKits() { live.length = 0; }

const alive = () => monsters.filter(targetable);
const near = (x: number, z: number, r: number) => alive().filter(m => Math.hypot(m.x - x, m.z - z) < r + m.def.r);
const body = (m: Monster, nav: Nav) => V(m.x, navHeight(nav, m.x, m.z) + m.def.h * 0.55 + (m.def.float ?? 0), m.z);

/** Arguments the caster decides (sent to the friend): facing angle and a target point. */
export interface KitArgs { a: number; x: number; z: number; u?: number[] }

/** Chooses the arguments for a cast: towards the nearest monster in front, else straight ahead. */
export function kitArgs(p: Fighter, slot: Slot, hero: Hero): KitArgs {
  const ahead = (d: number) => ({ x: p.x + Math.sin(p.ry) * d, z: p.z + Math.cos(p.ry) * d });
  const cand = alive().map(m => ({ m, d: Math.hypot(m.x - p.x, m.z - p.z) })).filter(c => c.d < 18).sort((a, b) => a.d - b.d);
  const first = cand[0]?.m;
  const a = first ? Math.atan2(first.x - p.x, first.z - p.z) : p.ry;
  if (hero === 'ehab' && slot === 'sp') return { a, x: p.x, z: p.z, u: cand.slice(0, 5).map(c => c.m.uid) };
  if (hero === 'sara' && slot === 'sk2') { const t = first ?? null; const pt = t ? { x: t.x, z: t.z } : ahead(5); return { a, ...pt }; }
  return { a, x: p.x, z: p.z };
}

export function castKit(hero: Hero, slot: Slot, p: Fighter, args: KitArgs, mine: boolean, ctx: KitCtx) {
  KIT[hero][slot](p, args, mine, ctx);
}

type Fn = (p: Fighter, g: KitArgs, mine: boolean, ctx: KitCtx) => void;
const KIT: Record<Hero, Record<Slot, Fn>> = {
  ehab: {
    /** Five golden orbs rise, then each homes on one of the nearest monsters. */
    sp(p, g, mine, ctx) {
      play('m_epic', { vol: 0.5, dur: 1.5 });
      const targets = (g.u ?? []).map(u => monsters.find(m => m.uid === u)).filter(Boolean) as Monster[];
      for (let k = 0; k < 5; k++) {
        const t = targets[k % Math.max(1, targets.length)] ?? null;
        const pos = tipPos(p).clone(), vel = V(Math.sin(g.a + (k - 2) * 0.5) * 4, 4.5, Math.cos(g.a + (k - 2) * 0.5) * 4);
        let life = 3;
        live.push(dt => {
          life -= dt;
          if (t && targetable(t)) vel.lerp(body(t, ctx.nav).sub(pos).normalize().multiplyScalar(13), Math.min(1, dt * 3.5));
          else vel.y -= dt * 4;
          pos.addScaledVector(vel, dt);
          for (let i = 0; i < 2; i++) emit(pos.x + rnd(0.05), pos.y + rnd(0.05), pos.z + rnd(0.05), rnd(0.3), rnd(0.3), rnd(0.3), pick(ARCH), 0.16, 0.3, { t: 'magic' });
          emit(pos.x, pos.y, pos.z, 0, 0, 0, ARCH[1], 0.5, 0.05, { t: 'glow', a: 0.6 });
          if (t && targetable(t) && pos.distanceTo(body(t, ctx.nav)) < t.def.r + 0.3) {
            burst(pos, ARCH, 24, 3, 0.4, 0.1, 'star'); play('m_blast', { vol: 0.3, rate: 1.3 });
            if (mine) ctx.hit(t, 34);
            return false;
          }
          return life > 0 && pos.y > navHeight(ctx.nav, pos.x, pos.z);
        });
      }
    },
    /** Gone from sight: monsters lose him for five seconds; the first spell from hiding hits twice as hard. */
    sk(p, _g, mine, ctx) {
      for (let i = 0; i < 24; i++) emit(p.x + rnd(0.5), p.root.position.y + Math.random() * 1.8, p.z + rnd(0.5), rnd(0.3), 0.4, rnd(0.3), pick(ARCH), 0.1, 0.6, { t: 'twirl', a: 0.6 });
      play('m_sparkle', { vol: 0.4 });
      if (mine) ctx.hide(5);
    },
    /** Illusions spring up around every monster nearby, hold them, then all strike at once. */
    sk2(p, g, mine, ctx) {
      play('m_epic', { vol: 0.7 }); lightFlash(p.x, p.root.position.y + 2, p.z, ARCH, 18, 0.5);
      const caught = near(g.x, g.z, 8);
      for (const m of caught) {
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; emit(m.x + Math.cos(a) * 1.3, navHeight(ctx.nav, m.x, m.z) + 1, m.z + Math.sin(a) * 1.3, 0, 0.2, 0, pick(ARCH), 0.5, 0.7, { t: 'glow', a: 0.7 }); }
        if (mine) ctx.hit(m, 0, { stun: 1.6 });
      }
      let t = 0, struck = false;
      live.push(dt => {
        t += dt;
        if (!struck && t > 0.6) {
          struck = true;
          for (const m of caught) { if (!targetable(m)) continue; burst(body(m, ctx.nav), ARCH, 30, 3, 0.5, 0.12, 'star'); if (mine) ctx.hit(m, 45); }
          play('m_fire_expl', { vol: 0.6, rate: 1.2 });
        }
        return t < 0.7;
      });
    },
  },
  sara: {
    /** Five petals fan out and curl onto the monsters in front. */
    sp(p, g, mine, ctx) {
      play('m_light', { vol: 0.6 });
      for (let k = 0; k < 5; k++) {
        const a = g.a + (k - 2) * 0.28, pos = tipPos(p).clone(), vel = V(Math.sin(a) * 16, 0, Math.cos(a) * 16);
        let life = 1.4, target: Monster | null = null;
        live.push(dt => {
          life -= dt;
          target ??= alive().filter(m => Math.abs(angleDelta(a, Math.atan2(m.x - pos.x, m.z - pos.z))) < 0.5 && Math.hypot(m.x - pos.x, m.z - pos.z) < 20).sort((x, y) => Math.hypot(x.x - pos.x, x.z - pos.z) - Math.hypot(y.x - pos.x, y.z - pos.z))[0] ?? null;
          if (target && targetable(target)) vel.lerp(body(target, ctx.nav).sub(pos).normalize().multiplyScalar(16), Math.min(1, dt * 4));
          pos.addScaledVector(vel, dt);
          emit(pos.x, pos.y, pos.z, rnd(0.3), rnd(0.3), rnd(0.3), pick(FLORA), 0.18, 0.35, { t: 'star', spin: 6 });
          if (target && targetable(target) && pos.distanceTo(body(target, ctx.nav)) < target.def.r + 0.3) {
            burst(pos, FLORA, 16, 2, 0.4, 0.08, 'star'); if (mine) ctx.hit(target, 18); return false;
          }
          return life > 0;
        });
      }
    },
    /** Flowers open around her: health back for her, and for her friend if close; slows and holds fall away. */
    sk(p, _g, mine, ctx) {
      const y = p.root.position.y;
      play('m_sparkle', { vol: 0.7 }); play('m_light', { vol: 0.4, rate: 1.2 });
      for (let i = 0; i < 50; i++) { const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 2; emit(p.x + Math.cos(a) * r, y + 0.05, p.z + Math.sin(a) * r, 0, 0.6 + Math.random(), 0, pick(FLORA), 0.18, 1.2, { t: 'star' }); }
      emit(p.x, y + 0.05, p.z, 0, 0, 0, FLORA[1], 0.8, 1, { t: 'rune', spin: 0.8, grow: 5 });
      if (!mine) return;
      ctx.heal('me', 120);
      const q = ctx.mate;
      if (q && !q.dead && Math.hypot(q.x - p.x, q.z - p.z) < 7) ctx.heal('mate', 80);
    },
    /** Thorns burst out under the nearest monster: everything in the ring is held and bleeds. */
    sk2(_p, g, mine, ctx) {
      const R = 4.5, y = navHeight(ctx.nav, g.x, g.z) + 0.06;
      const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R, 64), new THREE.MeshBasicMaterial({ color: FLORA[1].clone(), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(g.x, y, g.z); scene.add(ring);
      play('m_whoosh', { vol: 0.6, rate: 0.7 });
      let t = 0, tick = 0, burstDone = false, caught: Monster[] = [];
      live.push(dt => {
        t += dt;
        (ring.material as THREE.MeshBasicMaterial).opacity = t < 0.5 ? 0.4 + 0.5 * Math.abs(Math.sin(t * 14)) : Math.max(0, 0.6 * (1 - (t - 0.5) / 3));
        // A flag, not "t - dt < 0.5": float sums make that test miss its one frame.
        if (t >= 0.5 && !burstDone) {
          burstDone = true; caught = near(g.x, g.z, R);
          play('m_blast', { vol: 0.7, rate: 1.2 });
          for (let i = 0; i < 60; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * R; emit(g.x + Math.cos(a) * r, y, g.z + Math.sin(a) * r, 0, 3 + Math.random() * 3, 0, pick(FLORA), 0.15, 0.7, { t: 'spark', drag: 3 }); }
          if (mine) for (const m of caught) ctx.hit(m, 30, { stun: 3 });
        }
        if (t > 0.5 && (tick += dt) > 0.5) {
          tick = 0;
          for (const m of caught) if (targetable(m)) { emit(m.x, navHeight(ctx.nav, m.x, m.z) + 0.8, m.z, rnd(0.5), 1, rnd(0.5), pick(FLORA), 0.2, 0.5, { t: 'spark' }); if (mine) ctx.hit(m, 6); }
        }
        if (t > 3.5) { scene.remove(ring); ring.geometry.dispose(); (ring.material as THREE.Material).dispose(); return false; }
        return true;
      });
    },
  },
  abed: {
    /** A slow ball of wind homes in and bursts, throwing the pack around it. */
    sp(p, g, mine, ctx) {
      play('m_waves', { vol: 0.7 });
      const pos = tipPos(p).clone(), vel = V(Math.sin(g.a) * 9, 0, Math.cos(g.a) * 9);
      let life = 2.6;
      const boom = () => {
        explosion(pos, WIND, 1.8); play('m_fire_expl', { vol: 0.7, rate: 1.3 }); S.shake = Math.max(S.shake, 0.12);
        if (mine) for (const m of near(pos.x, pos.z, 3)) { const dx = m.x - pos.x, dz = m.z - pos.z, L = Math.hypot(dx, dz) || 1; ctx.hit(m, 50, { push: [dx / L, dz / L, 7] }); }
      };
      live.push(dt => {
        life -= dt;
        const t = alive().filter(m => Math.hypot(m.x - pos.x, m.z - pos.z) < 16).sort((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) - Math.hypot(b.x - pos.x, b.z - pos.z))[0];
        if (t) vel.lerp(body(t, ctx.nav).sub(pos).normalize().multiplyScalar(9), Math.min(1, dt * 2.5));
        pos.addScaledVector(vel, dt);
        for (let i = 0; i < 5; i++) { const a = Math.random() * Math.PI * 2; emit(pos.x + Math.cos(a) * 0.4, pos.y + rnd(0.3), pos.z + Math.sin(a) * 0.4, -Math.sin(a) * 3, rnd(0.5), Math.cos(a) * 3, pick(WIND), 0.16, 0.3, { t: 'twirl' }); }
        if ((t && pos.distanceTo(body(t, ctx.nav)) < t.def.r + 0.5) || life <= 0 || pos.y < navHeight(ctx.nav, pos.x, pos.z)) { boom(); return false; }
        return true;
      });
    },
    /** A cone of wind ahead: everything in it is hurt and thrown back. */
    sk(p, g, mine, ctx) {
      play('m_whoosh', { vol: 0.9, rate: 0.8 }); play('m_waves', { vol: 0.4 });
      const y = p.root.position.y;
      for (let i = 0; i < 70; i++) { const a = g.a + rnd(0.6), sp = 8 + Math.random() * 8; emit(p.x + Math.sin(g.a) * 0.6, y + 0.3 + Math.random() * 1.4, p.z + Math.cos(g.a) * 0.6, Math.sin(a) * sp, rnd(0.5), Math.cos(a) * sp, pick(WIND), 0.16, 0.5, { t: 'twirl', drag: 2.5 }); }
      if (!mine) return;
      const dx = Math.sin(g.a), dz = Math.cos(g.a);
      for (const m of near(p.x, p.z, 7)) {
        const ex = m.x - p.x, ez = m.z - p.z, L = Math.hypot(ex, ez) || 1;
        if ((ex * dx + ez * dz) / L > 0.45) ctx.hit(m, 25, { push: [dx, dz, 10] });
      }
    },
    /** A tornado rolls ahead for four seconds, drawing monsters in and grinding them. */
    sk2(p, g, mine, ctx) {
      const pos = V(p.x + Math.sin(g.a) * 1.5, 0, p.z + Math.cos(g.a) * 1.5), dir = V(Math.sin(g.a), 0, Math.cos(g.a));
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: WIND[1].clone().multiplyScalar(0.7), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      mesh.rotation.x = Math.PI; scene.add(mesh);
      play('m_waves', { vol: 0.9, rate: 0.6, dur: 4 });
      let t = 0, tick = 0;
      live.push(dt => {
        t += dt;
        pos.addScaledVector(dir, 4 * dt);
        const y = navHeight(ctx.nav, pos.x, pos.z);
        mesh.position.set(pos.x, y + 2.1, pos.z); mesh.rotation.y += dt * 10;
        for (let i = 0; i < 6; i++) { const r = Math.random(), a = Math.random() * Math.PI * 2; emit(pos.x + Math.cos(a) * (0.3 + r * 1.1), y + r * 4, pos.z + Math.sin(a) * (0.3 + r * 1.1), -Math.sin(a) * 4, 1, Math.cos(a) * 4, pick(WIND), 0.16, 0.45, { t: 'twirl' }); }
        if ((tick += dt) > 0.35) {
          tick = 0;
          if (mine) for (const m of near(pos.x, pos.z, 2.6)) { const dx = pos.x - m.x, dz = pos.z - m.z, L = Math.hypot(dx, dz) || 1; ctx.hit(m, 9, { push: [dx / L, dz / L, 3] }); }
        }
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.35 * Math.min(1, (4 - t) / 0.4);
        if (t >= 4) { scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); return false; }
        return true;
      });
    },
  },
};

/** Health-giving glow on a wizard (used when a heal lands on either device). */
export function healFx(p: Fighter, amount: number) {
  burst(chest(p), FLORA, 24, 2, 0.8, 0.1, 'star');
  void amount;
}
