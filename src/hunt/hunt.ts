import * as THREE from 'three';
import { scene, camera, renderer, moon, rim, hemi } from '../render/stage';
import { emit, burst, explosion } from '../render/particles';
import { lightFlash } from '../render/lights';
import { S } from '../game/state';
import { runScheduled, after } from '../game/schedule';
import { ensureModel, makeFighter, dropFighter, anim, tipPos, chest, applyGrip, applyGroundContact, resetChar } from '../fighters/fighter';
import { shieldMesh, flash, dmgText } from '../fx/effects';
import { readMove } from '../input/input';
import { hideArenas, showArena } from '../world/arena';
import { hud, updateButtons } from '../ui/hud';
import { play, musicOn, musicOff } from '../audio/audio';
import { G } from '../data/rules';
import { V, rnd, pick, clamp, angleDelta, $ } from '../core/util';
import { viewSize, toLocal } from '../core/view';
import type { Fighter } from '../core/types';
import { packGltf, packNav } from './assets';
import { navHeight, navMove, navNearestFree, navCorridor, navWalkOn, type Nav } from './nav';
import { monsters, targetable, tuning, DIFFS, spawnMonster, updateMonster, hurtMonster, clearMonsters, loadMonster, type Monster, type Prey } from './monsters';
import { STAGES, type StageId, type StageDef } from './stages';
import { drawMinimap, buildMinimap } from './minimap';
import { toMenu } from '../game/flow';
import { playScene, monsterCard, hint, initStory } from './story';
import { veil } from '../ui/transitions';

/**
 * «رحلة الصيّادين»: the wizard walks a large stage seen from behind (third-person camera the player can turn by
 * dragging), fights the monsters on the way and reaches the stage's gate. Movement is relative to the camera,
 * floors and walls come from the stage's navigation grid.
 */
export const H = {
  stage: 'forest' as StageId, def: STAGES.forest as StageDef,
  nav: null as Nav | null, map: null as THREE.Object3D | null,
  /** Camera heading (radians, 0 = looking along +z) and when the player last turned it by hand. */
  yaw: 0, dragAt: -9,
  phase: 'play' as 'play' | 'dead' | 'won',
  kills: 0, ri: 0,
  gate: null as THREE.Group | null,
  /** A story scene is running: monsters and controls wait, the camera circles the wizard. */
  cine: false, cineAt: 0, cineLen: 20,
  /** Kinds of monster already introduced with a name card. */
  seen: new Set<string>(),
};

const BOLT = { dmg: 12, sp: 24, life: 1.4, cost: 4, cd: 0.32 };
const NOVA = { dmg: 40, radius: 6.5 };
const DODGE_SPEED = 9;

/* ---------- loading and leaving ---------- */
const FAR0 = camera.far;
let fogSaved: THREE.Scene["fog"] = null, bgSaved: THREE.Color | THREE.Texture | null = null;

function skyTexture([top, horizon]: [string, string]) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d')!; const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(0.7, horizon); g.addColorStop(1, horizon);
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function applyEnv(d: StageDef) {
  const e = d.env;
  fogSaved = scene.fog; bgSaved = scene.background as THREE.Color | THREE.Texture | null;
  scene.fog = new THREE.Fog(new THREE.Color(e.sky[1]).multiplyScalar(0.8), e.fog[0], e.fog[1]);
  scene.background = skyTexture(e.sky);
  moon.color.setHex(e.sunColor); moon.intensity = e.sunI;
  const [sky, ground, hi] = e.hemi; hemi.color.setHex(sky); hemi.groundColor.setHex(ground); hemi.intensity = hi;
  rim.intensity = 0.4;
  renderer.toneMappingExposure = e.exposure;
  const sc = moon.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 120; sc.updateProjectionMatrix();
  camera.far = 400; camera.updateProjectionMatrix();
}

/** Loads a stage (map, navigation grid, its monster types) and the wizard; `onStep` reports progress text. */
export async function loadHunt(ri: number, stage: StageId, onStep: (t: string) => void = () => {}) {
  const d = STAGES[stage];
  onStep('جارٍ تجهيز ' + d.name + '…');
  const types = [...new Set(d.groups.flatMap(g => g.m))];
  const [g, nav] = await Promise.all([packGltf(d.map), packNav(d.map), ensureModel(ri), ...types.map(t => loadMonster(t))]);
  if (d.corridor) navCorridor(nav, d.paths, d.corridor);
  const map = g.scene;
  if (d.walkOn) {
    const want = new Set(d.walkOn), meshes: { pos: ArrayLike<number>; idx: ArrayLike<number> | null }[] = [];
    map.updateMatrixWorld(true);
    map.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh || !want.has((m.material as THREE.Material).name)) return;
      const g2 = m.geometry.clone().applyMatrix4(m.matrixWorld);
      meshes.push({ pos: g2.attributes.position.array, idx: g2.index ? g2.index.array : null });
    });
    navWalkOn(nav, meshes, d.walkPad ?? 1.5);
  }
  H.stage = stage; H.def = d; H.nav = nav; H.ri = ri;
  map.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.receiveShadow = true; m.castShadow = false; } });
  H.map = map;
}

/** Starts the loaded stage: hides the duel arenas, places the wizard and the monsters, shows the hunt HUD. */
export async function startHunt() {
  const d = H.def, nav = H.nav!;
  S.mode = 'hunt'; hideArenas(); applyEnv(d);
  scene.add(H.map!);
  buildMinimap(H.map!, nav, d.paths);
  const p = makeFighter(H.ri, 0); S.CH = [p, null];
  resetChar(p); p.mana = 100;
  [p.x, p.z] = navNearestFree(nav, d.start[0], d.start[1]);
  p.ry = d.startYaw; H.yaw = d.startYaw; H.phase = 'play'; H.kills = 0;
  H.gate = makeGate(d.gate[0], d.gate[1]);
  clearMonsters();
  for (const gr of d.groups) {
    if (gr.chance !== undefined && Math.random() > gr.chance) continue;
    gr.m.forEach((id, k) => void spawnMonster(id, gr.at[0] + Math.cos(k * 2.1) * 1.8 * Math.min(1, k), gr.at[1] + Math.sin(k * 2.1) * 1.8 * Math.min(1, k), nav, gr.rise));
  }
  document.documentElement.classList.add('hunting');
  $('hud').hidden = false; $('ctl').hidden = false; $('pauseBtn').hidden = false; $('hunt').hidden = false; $('hEnd').hidden = true;
  $('n0').textContent = p.R.name; $('e0').textContent = p.R.elem;
  $<HTMLImageElement>('av0').src = `models/portraits/${p.R.id}_face.webp`;
  document.documentElement.style.setProperty('--p0', p.hex);
  $('hObj').textContent = d.objective;
  S.state = 'fight'; S.stateT = 0; S.paused = false;
  musicOn();
  H.seen.clear();
  $('hLoad').hidden = true;
  if (H.stage === 'forest' && !retrying) await cutscene('intro', 22);
  retrying = false;
  hint('اسحب على الشاشة لتدوير الكاميرا، واتبع الطريق الذهبي في الخريطة.');
}
let retrying = false;

/** Hides the play HUD, runs a story scene with the camera circling the wizard, then gives control back. */
async function cutscene(id: Parameters<typeof playScene>[0], len: number) {
  H.cine = true; H.cineAt = S.T; H.cineLen = len; atkHeld = false;
  for (const k of ['hud', 'ctl', 'pauseBtn', 'hunt']) $(k).hidden = true;
  await playScene(id);
  H.cine = false;
  if (H.phase === 'play') for (const k of ['hud', 'ctl', 'pauseBtn', 'hunt']) $(k).hidden = false;
}

/** Back to the menus: removes everything the hunt added and restores the duel arena and camera. */
export function endHunt() {
  clearMonsters(); clearBolts();
  if (H.map) scene.remove(H.map);
  if (H.gate) { scene.remove(H.gate); H.gate = null; }
  dropFighter(S.CH[0]); S.CH = [null, null];
  if (fogSaved !== null) scene.fog = fogSaved;
  if (bgSaved !== null) scene.background = bgSaved;
  camera.far = FAR0; camera.updateProjectionMatrix();
  document.documentElement.classList.remove('hunting');
  $('hunt').hidden = true; $('hEnd').hidden = true;
  showArena(); musicOff();
}

/* ---------- the gate at the end of a stage ---------- */
function makeGate(x: number, z: number) {
  const g = new THREE.Group();
  const y = H.nav ? navHeight(H.nav, x, z) : 0;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 12, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 0.7), toneMapped: false }));
  ring.position.y = 1.9; g.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.8, 0.35), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
  disc.position.y = 1.9; g.add(disc);
  const L = new THREE.PointLight(0xffc870, 6, 14, 1.6); L.position.y = 2; g.add(L);
  g.position.set(x, y, z); scene.add(g);
  return g;
}

/* ---------- the player's spells ---------- */
interface Bolt { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number; target: Monster | null }
const bolts: Bolt[] = [];
function clearBolts() { bolts.forEach(b => scene.remove(b.mesh)); bolts.length = 0; }

/** Closest living monster in front of the player (within 70° of the camera or the wizard), for auto-aim. */
function aimTarget(p: Fighter): Monster | null {
  let best: Monster | null = null, bs = Infinity;
  for (const m of monsters) {
    if (!targetable(m)) continue;
    const dx = m.x - p.x, dz = m.z - p.z, d = Math.hypot(dx, dz);
    if (d > 26) continue;
    const a = Math.atan2(dx, dz), off = Math.min(Math.abs(angleDelta(H.yaw, a)), Math.abs(angleDelta(p.ry, a)));
    if (off > 1.25) continue;
    const s = d + off * 6;
    if (s < bs) { bs = s; best = m; }
  }
  return best;
}

function castBolt(p: Fighter) {
  if (p.dead || p.cdA > 0 || p.dodgeT > 0 || p.shieldOn || p.mana < BOLT.cost || p.castT > 0.1) return;
  p.cdA = BOLT.cd; p.mana -= BOLT.cost; p.castT = 0.3;
  const t = aimTarget(p);
  if (t) p.ry = Math.atan2(t.x - p.x, t.z - p.z);
  anim(p, 'bolt', { once: true, speed: 1.8, force: true });
  play(p.R.cs, { vol: 0.4, dur: 1.1 });
  after(0.15, () => {
    if (p.dead || S.mode !== 'hunt') return;
    const s = tipPos(p);
    const aim = t && targetable(t) ? V(t.x, navHeight(H.nav!, t.x, t.z) + t.def.h * 0.55 + (t.def.float ?? 0), t.z) : V(p.x + Math.sin(p.ry) * 20, s.y, p.z + Math.cos(p.ry) * 20);
    const vel = aim.sub(s).normalize().multiplyScalar(BOLT.sp);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: p.pal[2].clone().multiplyScalar(1.3), toneMapped: false }));
    mesh.position.copy(s); scene.add(mesh);
    bolts.push({ mesh, pos: s.clone(), vel, life: BOLT.life, target: t });
    flash(p, 8);
    for (let i = 0; i < 8; i++) emit(s.x, s.y, s.z, rnd(1), rnd(1), rnd(1), pick(p.pal), 0.16, 0.25, { t: 'spark' });
  });
}

function updBolts(dt: number, p: Fighter) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    // Gentle homing on the chosen target so aiming on a phone stays forgiving.
    if (b.target && targetable(b.target)) {
      const t = b.target, want = V(t.x, navHeight(H.nav!, t.x, t.z) + t.def.h * 0.55 + (t.def.float ?? 0), t.z).sub(b.pos).normalize();
      b.vel.lerp(want.multiplyScalar(BOLT.sp), Math.min(1, dt * 5));
    }
    b.pos.addScaledVector(b.vel, dt); b.mesh.position.copy(b.pos);
    for (let k = 0; k < 3; k++) emit(b.pos.x + rnd(0.05), b.pos.y + rnd(0.05), b.pos.z + rnd(0.05), -b.vel.x * 0.03 + rnd(0.2), rnd(0.2), -b.vel.z * 0.03 + rnd(0.2), pick(p.pal), 0.12 + Math.random() * 0.1, 0.25, { t: p.R.bolt.kind === 'fire' ? 'flame' : 'spark', drag: 2 });
    let hit: Monster | null = null;
    for (const m of monsters) {
      if (!targetable(m)) continue;
      const fy = navHeight(H.nav!, m.x, m.z) + (m.def.float ?? 0);
      if (Math.hypot(b.pos.x - m.x, b.pos.z - m.z) < m.def.r + 0.25 && b.pos.y > fy - 0.2 && b.pos.y < fy + m.def.h + 0.2) { hit = m; break; }
    }
    const ground = b.pos.y < navHeight(H.nav!, b.pos.x, b.pos.z);
    if (hit || ground || b.life <= 0) {
      if (hit && hurtMonster(hit, BOLT.dmg, p.x, p.z)) onKill(hit);
      if (hit || ground) { burst(b.pos, p.pal, 22, 2.5, 0.4, 0.09); play('m_blast', { vol: 0.25, rate: 1.4 }); }
      scene.remove(b.mesh); b.mesh.geometry.dispose(); bolts.splice(i, 1);
    }
  }
}

/** The special: a burst of the wizard's element around them that hits every monster close by. */
function castNova(p: Fighter) {
  if (p.dead || p.dodgeT > 0 || p.mana < G.spCost || p.castT > 0.1) return;
  p.mana -= G.spCost; p.castT = 0.8;
  anim(p, 'special', { once: true, speed: 1.3, force: true }); play(p.R.ss, { vol: 0.8 });
  after(0.45, () => {
    if (p.dead || S.mode !== 'hunt') return;
    const c = V(p.x, navHeight(H.nav!, p.x, p.z) + 0.6, p.z);
    explosion(c, p.pal, 2.2); lightFlash(c.x, c.y + 1, c.z, p.pal, 20, 0.4);
    emit(p.x, c.y - 0.5, p.z, 0, 0, 0, p.pal[1], 1, 0.7, { t: 'rune', spin: 1.5, grow: 9 });
    play('m_fire_expl', { vol: 0.9 }); S.shake = Math.max(S.shake, 0.18);
    for (const m of monsters) {
      if (!targetable(m)) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d < NOVA.radius + m.def.r && hurtMonster(m, Math.round(NOVA.dmg * (d < 3 ? 1 : 0.7)), p.x, p.z)) onKill(m);
    }
  });
}

function dodge(p: Fighter) {
  if (p.dead || p.cdD > 0 || p.mana < p.R.dodgeCost || p.dodgeT > 0) return;
  setShield(p, false);
  p.mana -= p.R.dodgeCost; p.cdD = G.dodgeCd; p.dodgeT = 0.42;
  const [ix, iz] = readMove();
  const [wx, wz] = worldMove(ix, iz);
  const L = Math.hypot(wx, wz);
  p.dodgeDir.set(L > 0.2 ? wx / L : -Math.sin(p.ry), 0, L > 0.2 ? wz / L : -Math.cos(p.ry));
  anim(p, 'evade', { once: true, speed: 1.9, force: true }); play('m_sparkle', { vol: 0.4, dur: 1.2 });
  for (let i = 0; i < 16; i++) emit(p.x + rnd(0.3), navHeight(H.nav!, p.x, p.z) + 0.1 + Math.random() * 1.5, p.z + rnd(0.3), rnd(0.6), 0.5, rnd(0.6), pick(p.pal), 0.2, 0.5, { t: 'twirl' });
}

function setShield(p: Fighter, on: boolean) {
  if (on && !p.shieldOn && !p.dead && p.dodgeT <= 0 && p.cdS <= 0 && p.mana > 5) {
    p.shieldOn = true; p.shieldT = S.T; p.shield = shieldMesh(p); anim(p, 'block', { force: true }); play('m_waves', { vol: 0.5 });
  }
  if (!on && p.shieldOn) { p.shieldOn = false; p.cdS = G.shCd * 0.5; p.shield?.off(); p.shield = null; }
}

/** Button presses while hunting (the duel's input layer forwards them here). */
export function huntPress(a: string, on: boolean) {
  const p = S.CH[0]; if (!p || H.phase !== 'play' || H.cine) return;
  if (a === 'atk') atkHeld = on;
  if (a === 'sh') p.wantShield = on;
  if (!on) return;
  if (a === 'atk') castBolt(p);
  if (a === 'sp') castNova(p);
  if (a === 'dg') dodge(p);
}
let atkHeld = false, lastHurt = -99;

/* ---------- monsters hurting the player ---------- */
function onKill(m: Monster) {
  H.kills++;
  void m;
}

const prey: Prey = {
  x: 0, z: 0, dead: false, dodging: false,
  hurt(dmg: number, from: Monster) {
    const p = S.CH[0]; if (!p || p.dead) return;
    const d = Math.max(1, Math.round(dmg * tuning.dmg * (p.shieldOn ? 0.25 : 1)));
    p.hp -= d; p.hitFlash = 1; lastHurt = S.T;
    dmgText(p, '−' + d, '#ff6a5c');
    if (p.shieldOn) p.shield?.hit();
    else { p.hitT = 0.3; anim(p, 'hit', { once: true, speed: 1.4, force: true }); }
    const dx = p.x - from.x, dz = p.z - from.z, L = Math.hypot(dx, dz) || 1;
    p.vx = (dx / L) * 4; p.vz = (dz / L) * 4; p.knockT = 0.2;
    burst(chest(p), from.def.blood, 12, 2, 0.4, 0.08);
    play('c_hit' + (1 + ((Math.random() * 3) | 0)), { vol: 0.5 });
    S.shake = Math.max(S.shake, 0.08 + d * 0.004);
    if (p.hp <= 0) die(p);
  },
};

function die(p: Fighter) {
  p.hp = 0; p.dead = true; setShield(p, false); H.phase = 'dead';
  anim(p, 'death', { once: true, force: true });
  play('c_huge', { vol: 0.5 }); musicOff();
  after(2.2, () => { if (H.phase === 'dead') showEnd(false); });
}

function showEnd(won: boolean) {
  $('hEndT').textContent = won ? 'عبرتَ ' + H.def.name : 'سقطتَ في ' + H.def.name;
  $('hEndP').textContent = won ? (H.kills ? `هزمتَ ${H.kills} من وحوشها. ` : 'عبرتَها دون قتال. ') + 'المرحلة التالية قيد الإنشاء.' : 'الوحوش هنا لا ترحم. خذ نفَسًا، ثم حاول مجددًا.';
  $('hRetry').hidden = won;
  $('hEnd').hidden = false;
  for (const k of ['ctl', 'hud', 'hunt', 'pauseBtn', 'mCard', 'hHint']) $(k).hidden = true;
}

/** Restarts the current stage from its beginning (after a defeat). */
export function retryHunt() {
  const keep = H.map;
  clearMonsters(); clearBolts();
  if (H.gate) { scene.remove(H.gate); H.gate = null; }
  dropFighter(S.CH[0]); S.CH = [null, null];
  scene.remove(keep!);
  retrying = true;
  void startHunt();
}

/* ---------- per frame ---------- */
/** Joystick (x right, z down) → world direction for the current camera heading. */
function worldMove(ix: number, iz: number): [number, number] {
  const fx = Math.sin(H.yaw), fz = Math.cos(H.yaw);
  return [fx * -iz + -fz * ix, fz * -iz + fx * ix];
}

const TIMERS = ['cdA', 'cdD', 'castT', 'hitT', 'cdS', 'invT', 'stunT', 'slowT'] as const;

function updPlayer(p: Fighter, dt: number) {
  const nav = H.nav!;
  for (const k of TIMERS) p[k] = Math.max(0, p[k] - dt);
  if (!p.dead) {
    p.mana = Math.min(100, p.mana + G.regen * dt);
    // Out of combat for a while: wounds close slowly.
    if (S.T - lastHurt > 6) p.hp = Math.min(p.R.hp, p.hp + 6 * dt);
    if (p.shieldOn) { p.mana -= G.shieldDrain * dt; if (p.mana <= 0 || S.T - p.shieldT > G.shMax * 2) setShield(p, false); }
    if (p.wantShield && !p.shieldOn) setShield(p, true);
    if (!p.wantShield && p.shieldOn) setShield(p, false);
    if (atkHeld && !H.cine) castBolt(p);
    const [ix, iz] = H.cine || H.phase !== 'play' ? [0, 0] : readMove();
    const [wx, wz] = worldMove(ix, iz);
    const run = p.R.speed * 1.45 * (p.shieldOn ? 0.45 : 1) * (p.castT > 0 ? 0.5 : 1);
    if (p.dodgeT > 0) { p.dodgeT -= dt; p.vx = p.dodgeDir.x * DODGE_SPEED; p.vz = p.dodgeDir.z * DODGE_SPEED; }
    else if (p.knockT > 0) { p.knockT -= dt; const f = Math.pow(0.02, dt); p.vx *= f; p.vz *= f; }
    else { p.vx += (wx * run - p.vx) * Math.min(1, dt * 10); p.vz += (wz * run - p.vz) * Math.min(1, dt * 10); }
    [p.x, p.z] = navMove(nav, p.x, p.z, p.vx * dt, p.vz * dt, 0.3);
    // Face where we walk (casting turns towards the target instead, see castBolt).
    if (Math.hypot(wx, wz) > 0.15 && p.castT <= 0 && p.dodgeT <= 0) p.ry += clamp(angleDelta(p.ry, Math.atan2(wx, wz)), -10 * dt, 10 * dt);
    // The camera slowly swings behind a wizard who keeps walking, unless the player turned it recently.
    if (Math.hypot(wx, wz) > 0.5 && S.T - H.dragAt > 1.5 && iz < 0.3) H.yaw += angleDelta(H.yaw, p.ry) * Math.min(1, dt * 0.9);
    if (p.dodgeT <= 0 && p.castT <= 0 && p.hitT <= 0) {
      const spd = Math.hypot(p.vx, p.vz);
      if (p.shieldOn) anim(p, 'block');
      else if (spd < 0.4) anim(p, 'idle');
      else {
        anim(p, 'walkF', { speed: clamp(spd / 2.2, 0.8, 2.1) });
        p.stepAcc += spd * dt;
        if (p.stepAcc > 1.1) { p.stepAcc = 0; play('step' + ((Math.random() * 4) | 0), { vol: 0.25 }); }
      }
    }
  }
  const fy = navHeight(nav, p.x, p.z);
  p.root.position.set(p.x, fy, p.z); p.root.rotation.y = p.ry; p.blob.position.set(p.x, fy + 0.03, p.z);
  p.mixer.update(dt);
  applyGroundContact(p); applyGrip(p);
  tipPos(p, p.light.position);
  p.light.intensity *= Math.pow(0.12, dt); p.light.intensity = Math.max(p.light.intensity, 1.4);
  if (!p.dead && Math.random() < 0.4) { const t = p.light.position; emit(t.x, t.y, t.z, rnd(0.05), 0.15, rnd(0.05), pick(p.pal), 0.08, 0.4, { t: 'magic' }); }
}

let uiAt = 0;
export function huntTick(rdt: number) {
  const dt = rdt * S.slowmo;
  S.T += dt; S.stateT += rdt;
  runScheduled();
  const p = S.CH[0]; if (!p || !H.nav) return dt;
  updPlayer(p, dt);
  if (H.cine) { p.root.updateMatrixWorld(); return dt; }
  prey.x = p.x; prey.z = p.z; prey.dead = p.dead; prey.dodging = p.dodgeT > 0;
  for (const m of monsters.slice()) if (!m.gone) updateMonster(m, dt, H.nav, prey);
  for (let i = monsters.length - 1; i >= 0; i--) if (monsters[i].gone) monsters.splice(i, 1);
  updBolts(dt, p);
  // First time a kind of monster comes for the player: its name card.
  for (const m of monsters) if (m.state === 'chase' && !H.seen.has(m.id)) {
    if (!H.seen.size) hint('الهجوم يصوّب تلقائيًا نحو أقرب وحش أمامك. المراوغة تُفلتك من قفزاتها.');
    H.seen.add(m.id); monsterCard(m.def.name, m.id);
  }
  // Gate: shimmer, and the stage is won on stepping into it.
  if (H.gate) {
    H.gate.children[0].rotation.z += dt * 0.6;
    if (Math.random() < 0.5) emit(H.gate.position.x + rnd(1.4), H.gate.position.y + 0.4 + Math.random() * 3, H.gate.position.z + rnd(0.3), 0, 0.4, 0, new THREE.Color(2.4, 1.7, 0.6), 0.12, 1, { t: 'magic' });
    if (H.phase === 'play' && Math.hypot(p.x - H.gate.position.x, p.z - H.gate.position.z) < 2.2) {
      H.phase = 'won'; play('m_epic', { vol: 0.8 });
      p.vx = p.vz = 0; anim(p, 'idle');
      void cutscene(H.stage === 'forest' ? 'forestEnd' : 'forestEnd', 10).then(() => showEnd(true));
    }
  }
  // Shadows follow the wizard (the frustum covers only the area around them).
  const fy = navHeight(H.nav, p.x, p.z), e = H.def.env.sun;
  moon.position.set(p.x + e[0], fy + e[1], p.z + e[2]); moon.target.position.set(p.x, fy, p.z); moon.target.updateMatrixWorld();
  hud(); updateButtons();
  if (S.T - uiAt > 0.1) { uiAt = S.T; drawMinimap(p, H.yaw, monsters, H.gate?.position ?? null); }
  return dt;
}

/* ---------- camera ---------- */
const camPos = V(), camLook = V(), tp = V(), tl = V();
let camInit = false;
export function huntCamera(dt: number) {
  const p = S.CH[0]; if (!p || !H.nav) return;
  const { w, h } = viewSize(), portrait = w < h;
  const dist = portrait ? 7.5 : 6.2, hgt = portrait ? 3.6 : 2.8;
  const fy = navHeight(H.nav, p.x, p.z), fx = Math.sin(H.yaw), fz = Math.cos(H.yaw);
  tp.set(p.x - fx * dist, fy + hgt, p.z - fz * dist);
  if (H.cine) {
    // Crane shot: from high behind the wizard, looking down the road ahead, slowly down to the play camera.
    const u = Math.min(1, (S.T - H.cineAt) / H.cineLen), e = 1 - (1 - u) * (1 - u);
    const th = H.yaw + Math.PI + (1 - e) * 0.35, r = dist + (1 - e) * 3;
    tp.set(p.x + Math.sin(th) * r, fy + hgt + (1 - e) * 7, p.z + Math.cos(th) * r);
  }
  // Hills: never under the ground, and if a slope hides the wizard, come in front of it.
  // First rise over the hill (like a crane), and only if that is not enough, move in front of it.
  const hy = fy + 1.5, nav = H.nav;
  const blocked = (cx: number, cy: number, cz: number) => {
    for (let k = 1; k <= 12; k++) { const u = k / 12; if (navHeight(nav, p.x + (cx - p.x) * u, p.z + (cz - p.z) * u) + 0.5 > hy + (cy - hy) * u) return u; }
    return 0;
  };
  if (blocked(tp.x, tp.y, tp.z)) {
    let up = 0; for (const extra of [1.5, 3, 4.5, 6]) if (!blocked(tp.x, tp.y + extra, tp.z)) { up = extra; break; }
    if (up) tp.y += up;
    else { const u = blocked(tp.x, tp.y + 6, tp.z), back = Math.max(0.3, u - 1 / 12); tp.set(p.x + (tp.x - p.x) * back, hy + (tp.y + 6 - hy) * back, p.z + (tp.z - p.z) * back); }
  }
  tp.y = Math.max(tp.y, navHeight(H.nav, tp.x, tp.z) + 1.2);
  tl.set(p.x + fx * 2.5, fy + 1.4, p.z + fz * 2.5);
  if (H.cine) { const u = Math.min(1, (S.T - H.cineAt) / H.cineLen), ahead = 2.5 + (1 - u) * 14; tl.set(p.x + fx * ahead, fy + 1.3, p.z + fz * ahead); }
  if (!camInit || S.stateT < 0.05) { camPos.copy(tp); camLook.copy(tl); camInit = true; }
  camPos.lerp(tp, 1 - Math.pow(0.0005, dt)); camLook.lerp(tl, 1 - Math.pow(0.0005, dt));
  camera.fov = portrait ? 62 : 55; camera.updateProjectionMatrix();
  camera.position.copy(camPos);
  if (S.shake > 0) { camera.position.x += rnd(S.shake); camera.position.y += rnd(S.shake); }
  S.shake *= Math.pow(0.02, dt);
  camera.lookAt(camLook);
}

/** Dragging anywhere outside the joystick and the buttons turns the camera. */
export function initHunt() {
  const cv = renderer.domElement;
  let id: number | null = null, lx = 0;
  cv.addEventListener('pointerdown', e => { if (S.mode !== 'hunt') return; id = e.pointerId; lx = toLocal(e.clientX, e.clientY).x; });
  cv.addEventListener('pointermove', e => {
    if (S.mode !== 'hunt' || e.pointerId !== id) return;
    const x = toLocal(e.clientX, e.clientY).x, dx = x - lx; lx = x;
    H.yaw -= dx * 0.008; H.dragAt = S.T;
  });
  const up = (e: PointerEvent) => { if (e.pointerId === id) id = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  // Keyboard: Q/E would clash with skills, so the camera turns with the mouse drag or the , and . keys.
  addEventListener('keydown', e => { if (S.mode !== 'hunt') return; if (e.code === 'Comma') { H.yaw += 0.2; H.dragAt = S.T; } if (e.code === 'Period') { H.yaw -= 0.2; H.dragAt = S.T; } });
  $('hRetry').onclick = () => { $('hEnd').hidden = true; retryHunt(); };
  $('hMenu').onclick = () => void veil(toMenu);
  initStory();
}

/**
 * From the menus into a stage: a loading screen with the stage's name while the map, its monsters and the wizard
 * are read from the device, then the stage. On failure the reason is shown and the menu comes back.
 */
export async function playHunt(stage: StageId = 'forest') {
  const d = STAGES[stage];
  const lv = DIFFS[huntDiff()]; tuning.hp = lv.hp; tuning.dmg = lv.dmg;
  $('hlName').textContent = d.name; $('hlTxt').textContent = 'جارٍ التجهيز…';
  $('hLoad').hidden = false; $('menu').hidden = true; $('pack').hidden = true; $('title').hidden = true;
  try {
    await loadHunt(S.sel, stage, t => { $('hlTxt').textContent = t; });
    await startHunt();
    $('hLoad').hidden = true;
  } catch (e) {
    console.error(e);
    $('hlTxt').textContent = 'تعذّر فتح المرحلة: ' + (e instanceof Error ? e.message : String(e));
    setTimeout(() => { $('hLoad').hidden = true; $('menu').hidden = false; S.state = 'menu'; }, 3500);
  }
}

// ?debug: the hunt's internals for automated browser checks.
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __hunt: { H, monsters, spawnMonster, packGltf, huntTick, huntPress, huntCamera, navHeight, updPlayer: (dt: number) => updPlayer(S.CH[0]!, dt) } });

const DIFF_KEY = 'asrar.huntDiff';
/** Chosen difficulty (0..2, default the middle one), kept on the device. */
export function huntDiff() { const v = +(localStorage.getItem(DIFF_KEY) ?? 1); return v >= 0 && v <= 2 ? v : 1; }
export function setHuntDiff(v: number) { localStorage.setItem(DIFF_KEY, String(v)); }
