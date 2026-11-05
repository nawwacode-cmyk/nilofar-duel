import * as THREE from 'three';
import { scene, camera, renderer, moon, rim, hemi } from '../render/stage';
import { emit, burst, explosion } from '../render/particles';
import { lightFlash } from '../render/lights';
import { S } from '../game/state';
import { runScheduled, after } from '../game/schedule';
import { ensureModel, makeFighter, dropFighter, anim, tipPos, chest, applyGrip, applyGroundContact, resetChar, altCostume } from '../fighters/fighter';
import { shieldMesh, flash, dmgText } from '../fx/effects';
import { readMove } from '../input/input';
import { hideArenas, showArena } from '../world/arena';
import { hud, updateButtons } from '../ui/hud';
import { play, musicOn, musicOff } from '../audio/audio';
import { G } from '../data/rules';
import { V, C, rnd, pick, clamp, angleDelta, $ } from '../core/util';
import { viewSize, toLocal } from '../core/view';
import { CLIP_NAMES, type Fighter, type Palette } from '../core/types';
import { packGltf, packNav, dropGltf } from './assets';
import { navHeight, navMove, navNearestFree, navCorridor, navWalkOn, type Nav } from './nav';
import { monsters, targetable, tuning, DIFFS, STATES, MONSTERS, spawnMonster, updateMonster, updatePuppet, setNet, hurtMonster, fromBehind, clearMonsters, loadMonster, type Monster, type MonId, type Prey, type Hurter } from './monsters';
import { STAGES, type StageId, type StageDef, type SpawnGroup } from './stages';
import { drawMinimap, buildMinimap } from './minimap';
import { toMenu } from '../game/flow';
import { playScene, speak, monsterCard, hint, initStory } from './story';
import { spawnHazard, updateHazards, clearHazards, type HazardKind } from './hazards';
import { boss, startBoss, endBoss, bossTick } from './boss';
import { coop, coopSend, coopLeave, coopOpen, onCoopMessage, onPartnerLeft, online, isHost } from './coop';
import { veil } from '../ui/transitions';
import type { SceneId } from './script';
import { cut, addCutaway } from './cutaway';
import { castKit, kitArgs, updateKits, clearKits, healFx, KIT_NAMES, HEROES, type Hero, type Slot, type KitCtx } from './kits';
import { stunMonster, pushMonster } from './monsters';
import { ROSTER } from '../data/roster';

/**
 * «رحلة الصيّادين»: forest → village → swamp boss, alone or with a friend.
 * The wizard walks a large stage seen from behind (third-person camera turned by dragging); movement is relative to
 * the camera, floors and walls come from the stage's navigation grid. In co-op the host runs the monsters, the boss
 * and the stage flow (see coop.ts); each device runs its own wizard and health.
 */
export const H = {
  stage: 'forest' as StageId, def: STAGES.forest as StageDef,
  nav: null as Nav | null, map: null as THREE.Object3D | null,
  /** Camera heading (radians, 0 = looking along +z) and when the player last turned it by hand. */
  yaw: 0, dragAt: -9,
  phase: 'play' as 'play' | 'dead' | 'won' | 'lost',
  kills: 0, ri: 0,
  /** The friend's wizard in co-op (-1 alone). */
  partnerRi: -1,
  gate: null as THREE.Group | null,
  /** A story scene is running: monsters and controls wait, the camera circles the wizard. */
  cine: false, cineAt: 0, cineLen: 20,
  /** Kinds of monster already introduced with a name card. */
  seen: new Set<string>(),
  /** Village waves: current index and when it started; monsters left (shown in the objective). */
  wave: -1, waveAt: 0, remaining: 0,
  /** Co-op: the guest has loaded this stage (host), and which stage the partner reported. */
  ready: false, peerStage: '' as string,
  /** Seconds standing next to a fallen friend (they revive at REVIVE_S). */
  reviveT: 0, downAt: 0, bossDownAt: 0,
  /** Ehab's veil: unseen until this time; the next spell from hiding is doubled. */
  hiddenUntil: 0, veilBonus: false,
};

const BOLT = { dmg: 12, sp: 24, life: 1.4, cost: 4, cd: 0.32 };
/** Story mode is its own fight: much more health than a duel, and monsters hit and last far harder
 *  (on top of the chosen difficulty) — the heroes' four abilities make up for it. */
const HUNT_HP = 600, MON_HP = 1.6, MON_DMG = 2.4;
const DODGE_SPEED = 9, REVIVE_S = 2.5, REVIVE_R = 2.2, BACKSTAB = 1.6;
/** Co-op: monsters are tougher with two hunters, the boss most of all. */
const COOP_HP = 1.3, COOP_BOSS_HP = 1.7;
const DARK: Palette = [C(0.35, 0.05, 0.05), C(0.2, 0.02, 0.02)];
const GATE_OBJ = 'ادخل البوابة قرب الطاحونة';
const GOLDEN: Palette = [C(2.6, 2, 0.7), C(3, 2.6, 1.2)];

const me = () => S.CH[0];
const mate = () => S.CH[1];

/* ---------- loading and leaving ---------- */
const FAR0 = camera.far;
let saved: { fog: THREE.Scene['fog']; bg: THREE.Scene['background'] } | null = null;

function skyTexture([top, horizon]: [string, string]) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const x = c.getContext('2d')!; const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(0.7, horizon); g.addColorStop(1, horizon);
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function applyEnv(d: StageDef) {
  const e = d.env;
  saved ??= { fog: scene.fog, bg: scene.background };
  scene.fog = new THREE.Fog(new THREE.Color(e.sky[1]).multiplyScalar(0.8), e.fog[0], e.fog[1]);
  scene.background = skyTexture(e.sky);
  moon.color.setHex(e.sunColor); moon.intensity = e.sunI;
  const [sky, ground, hi] = e.hemi; hemi.color.setHex(sky); hemi.groundColor.setHex(ground); hemi.intensity = hi;
  rim.intensity = 0.4;
  renderer.toneMappingExposure = e.exposure;
  const sc = moon.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 120; sc.updateProjectionMatrix();
  camera.far = 400; camera.updateProjectionMatrix();
}

/** Every monster kind a stage can need (groups, waves, the boss and what it summons). */
function stageMonsters(d: StageDef): MonId[] {
  const all = [...d.groups, ...(d.waves ?? []).flat()].flatMap(g => g.m);
  if (d.boss) all.push(d.boss.id, 'skeleton');
  return [...new Set(all)];
}

/** Loads a stage (map, navigation grid, its monster kinds) and the wizards; `onStep` reports progress text. */
export async function loadHunt(ri: number, stage: StageId, onStep: (t: string) => void = () => {}) {
  const d = STAGES[stage];
  onStep('جارٍ تجهيز ' + d.name + '…');
  const [g, nav] = await Promise.all([packGltf(d.map), packNav(d.map), ensureModel(ri), H.partnerRi >= 0 ? ensureModel(H.partnerRi) : null, ...stageMonsters(d).map(t => loadMonster(t))]);
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
  const cutSet = new Set(d.cutaway ?? []);
  map.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.receiveShadow = true; m.castShadow = false;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (cutSet.has(mt.name)) addCutaway(mt);
  });
  H.stage = stage; H.def = d; H.nav = nav; H.ri = ri; H.map = map;
}

/** Starts the loaded stage: places the wizards and (host) the monsters, shows the HUD, plays the stage's intro. */
export async function startHunt(retry = false) {
  const d = H.def, nav = H.nav!;
  S.mode = 'hunt'; hideArenas(); applyEnv(d);
  scene.add(H.map!);
  buildMinimap(H.map!, nav, d.paths);
  dropFighter(S.CH[0]); dropFighter(S.CH[1]);
  const p = storyFighter(H.ri, 0); p.mana = 100;
  [p.x, p.z] = navNearestFree(nav, d.start[0] + (coop.role === 'guest' ? 1.6 : 0), d.start[1]);
  p.ry = d.startYaw;
  let q: Fighter | null = null;
  if (H.partnerRi >= 0 && coop.peer) {
    q = storyFighter(H.partnerRi, 1);
    if (H.partnerRi === H.ri) altCostume(q);
    [q.x, q.z] = navNearestFree(nav, d.start[0] + (coop.role === 'guest' ? 0 : 1.6), d.start[1]); q.ry = d.startYaw;
    net = { x: q.x, z: q.z, ry: q.ry, clip: 0, dead: false, dodge: false };
  }
  S.CH = [p, q];
  H.yaw = d.startYaw; H.phase = 'play'; H.kills = 0; H.wave = -1; H.waveAt = 0; H.reviveT = 0; H.bossDownAt = 0;
  H.ready = !online() || coop.role === 'guest'; H.seen.clear();
  clearMonsters(); clearBolts(); clearHazards(); clearKits(); endBoss(); unhide(p);
  if (H.gate) { scene.remove(H.gate); H.gate = null; }
  const hero = heroOf(p);
  $('bSk').textContent = KIT_NAMES[hero].sk.split(' ')[0]; $('bSk2').textContent = KIT_NAMES[hero].sk2.split(' ')[0];
  $('bSk2').hidden = false;
  if (isHost()) {
    if (!d.waves && !d.boss) H.gate = makeGate(d.gate[0], d.gate[1]);
    spawnGroups(d.groups);
    if (d.waves) startWave(0);
    if (d.boss) void hostSpawn(d.boss.id, d.boss.at[0], d.boss.at[1], false, online() ? COOP_BOSS_HP : 1).then(m => { m.ry = Math.atan2(d.start[0] - m.x, d.start[1] - m.z); startBoss(m); });
  }
  const R = document.documentElement;
  R.classList.add('hunting'); R.classList.toggle('duo', !!q);
  for (const k of ['hud', 'ctl', 'pauseBtn', 'hunt']) $(k).hidden = false;
  $('hEnd').hidden = true; $('bossBar').hidden = !d.boss;
  $('n0').textContent = p.R.name; $('e0').textContent = p.R.elem;
  $<HTMLImageElement>('av0').src = `models/portraits/${p.R.id}_face.webp`;
  R.style.setProperty('--p0', p.hex);
  if (q) {
    $('n1').textContent = q.R.name + (q.ri === p.ri ? ' (صديقك)' : ''); $('e1').textContent = q.R.elem;
    $<HTMLImageElement>('av1').src = `models/portraits/${q.R.id}_face.webp`;
    R.style.setProperty('--p1', q.hex);
  }
  $('hObj').textContent = d.objective;
  if (d.boss) $('bossName').textContent = MONSTERS[d.boss.id].name;
  S.state = 'fight'; S.stateT = 0; S.paused = false;
  musicOn();
  $('hLoad').hidden = true;
  if (coop.role === 'guest') coopSend('ready', { s: H.stage });
  if (d.intro && !retry) await cutscene(d.intro, d.intro === 'intro' ? 22 : 12);
  if (H.stage === 'forest') hint('اسحب على الشاشة لتدوير الكاميرا، واتبع الطريق الذهبي في الخريطة.');
  else if (d.boss) hint('ضرباتك من خلفه أقوى بكثير. والمراوغة تُنجيك من موجاته.');
}

/** Hides the play HUD, runs a story scene with the camera circling the wizard, then gives control back. */
async function cutscene(id: SceneId, len: number) {
  H.cine = true; H.cineAt = S.T; H.cineLen = len; atkHeld = false;
  for (const k of ['hud', 'ctl', 'pauseBtn', 'hunt', 'bossBar']) $(k).hidden = true;
  await playScene(id);
  H.cine = false;
  if (H.phase === 'play') { for (const k of ['hud', 'ctl', 'pauseBtn', 'hunt']) $(k).hidden = false; $('bossBar').hidden = !H.def.boss; }
}

/** Removes the current stage's objects (map stays loaded unless `freeMap`). */
async function clearStage(freeMap: boolean) {
  clearMonsters(); clearBolts(); clearHazards(); clearKits(); endBoss();
  if (H.gate) { scene.remove(H.gate); H.gate = null; }
  if (H.map) scene.remove(H.map);
  if (freeMap) { await dropGltf(H.def.map); H.map = null; }
}

/** Back to the menus: removes everything the hunt added and restores the duel arena and camera. */
export function endHunt() {
  coopLeave();
  void clearStage(false);
  dropFighter(S.CH[0]); dropFighter(S.CH[1]); S.CH = [null, null];
  if (saved) { scene.fog = saved.fog; scene.background = saved.bg; saved = null; }
  camera.far = FAR0; camera.updateProjectionMatrix();
  document.documentElement.classList.remove('hunting', 'duo');
  for (const k of ['hunt', 'hEnd', 'bossBar', 'story', 'mCard', 'hHint']) $(k).hidden = true;
  H.partnerRi = -1;
  showArena(); musicOff();
}

/* ---------- spawning (host) ---------- */
const packSpawn = (m: Monster) => [m.uid, m.id, +m.x.toFixed(2), +m.z.toFixed(2), STATES.indexOf(m.state), Math.round(m.hp)];

async function hostSpawn(id: MonId, x: number, z: number, rise = false, hpMul = online() ? COOP_HP : 1) {
  const m = await spawnMonster(id, x, z, H.nav!, rise, undefined, false, hpMul);
  coopSend('spawn', { s: H.stage, l: [packSpawn(m)] });
  return m;
}

function spawnGroups(groups: SpawnGroup[]) {
  for (const gr of groups) {
    if (gr.chance !== undefined && Math.random() > gr.chance) continue;
    gr.m.forEach((id, k) => void hostSpawn(id, gr.at[0] + Math.cos(k * 2.1) * 1.8 * Math.min(1, k), gr.at[1] + Math.sin(k * 2.1) * 1.8 * Math.min(1, k), gr.rise));
  }
}

function startWave(k: number) {
  H.wave = k; H.waveAt = S.T;
  spawnGroups(H.def.waves![k]);
  const say = H.def.waveSay?.[k];
  if (say) sayAll(say);
}

function sayAll(id: SceneId) { void speak(id); coopSend('say', { id }); }

/** Monsters still to beat in a wave stage: the living ones plus every later wave. */
function remaining() {
  const alive = monsters.filter(m => m.state !== 'dead' && !m.gone).length;
  return alive + (H.def.waves ?? []).slice(H.wave + 1).reduce((s, w) => s + w.reduce((t, g) => t + g.m.length, 0), 0);
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

function openGate() {
  const [x, z] = H.def.gate;
  H.gate = makeGate(x, z); coopSend('gate', { x, z });
  hint('انفتحت البوابة قرب الطاحونة.'); play('m_epic', { vol: 0.6 });
}

/* ---------- spells ---------- */
interface Bolt { mesh: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; life: number; target: Monster | null; pal: Palette; trail: string; mine: boolean }
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

const aimPoint = (t: Monster) => V(t.x, navHeight(H.nav!, t.x, t.z) + t.def.h * 0.55 + (t.def.float ?? 0), t.z);

function launch(from: Fighter, to: THREE.Vector3, target: Monster | null, mine: boolean) {
  const s = tipPos(from);
  const vel = to.clone().sub(s).normalize().multiplyScalar(BOLT.sp);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: from.pal[2].clone().multiplyScalar(1.3), toneMapped: false }));
  mesh.position.copy(s); scene.add(mesh);
  bolts.push({ mesh, pos: s.clone(), vel, life: BOLT.life, target, pal: from.pal, trail: from.R.bolt.kind === 'fire' ? 'flame' : 'spark', mine });
  flash(from, 8);
  for (let i = 0; i < 8; i++) emit(s.x, s.y, s.z, rnd(1), rnd(1), rnd(1), pick(from.pal), 0.16, 0.25, { t: 'spark' });
}

function castBolt(p: Fighter) {
  if (p.dead || p.cdA > 0 || p.dodgeT > 0 || p.shieldOn || p.mana < BOLT.cost || p.castT > 0.1) return;
  p.cdA = BOLT.cd; p.mana -= BOLT.cost; p.castT = 0.3; unhide(p);
  const t = aimTarget(p);
  if (t) p.ry = Math.atan2(t.x - p.x, t.z - p.z);
  anim(p, 'bolt', { once: true, speed: 1.8, force: true });
  play(p.R.cs, { vol: 0.4, dur: 1.1 });
  after(0.15, () => {
    if (p.dead || S.mode !== 'hunt') return;
    const to = t && targetable(t) ? aimPoint(t) : V(p.x + Math.sin(p.ry) * 20, tipPos(p).y, p.z + Math.cos(p.ry) * 20);
    launch(p, to, t, true);
    coopSend('cast', { k: 'b', x: +to.x.toFixed(2), y: +to.y.toFixed(2), z: +to.z.toFixed(2) });
  });
}

/** A spell of ours hit a monster: the host applies it (back hits on the boss count more), the guest reports it. */
type HitOpts = { stun?: number; push?: [number, number, number] };
function hitMonster(m: Monster, dmg: number, fx: number, fz: number, o: HitOpts = {}, local = true) {
  // Ehab's first spell from hiding hits twice as hard.
  if (local && dmg > 0 && H.veilBonus) { dmg *= 2; H.veilBonus = false; floatText(m, 'من الخفاء!', '#ffd76a'); }
  if (!isHost()) {
    coopSend('hit', { u: m.uid, d: dmg, x: +fx.toFixed(2), z: +fz.toFixed(2), st: o.stun, p: o.push });
    if (dmg > 0) { m.flash = 1; burst(V(m.x, m.root.position.y + m.def.h * 0.6, m.z), m.def.blood, 10, 2, 0.4, 0.08); }
    return;
  }
  if (dmg > 0 && boss.m === m && fromBehind(m, fx, fz)) { dmg = Math.round(dmg * BACKSTAB); floatText(m, 'من الخلف!', '#ffd76a'); }
  if (dmg > 0 && hurtMonster(m, dmg, fx, fz)) { H.kills++; return; }
  if (o.stun) stunMonster(m, o.stun);
  if (o.push) pushMonster(m, o.push[0], o.push[1], o.push[2]);
}

function updBolts(dt: number) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    // Gentle homing on the chosen target so aiming on a phone stays forgiving.
    if (b.target && targetable(b.target)) b.vel.lerp(aimPoint(b.target).sub(b.pos).normalize().multiplyScalar(BOLT.sp), Math.min(1, dt * 5));
    b.pos.addScaledVector(b.vel, dt); b.mesh.position.copy(b.pos);
    for (let k = 0; k < 3; k++) emit(b.pos.x + rnd(0.05), b.pos.y + rnd(0.05), b.pos.z + rnd(0.05), -b.vel.x * 0.03 + rnd(0.2), rnd(0.2), -b.vel.z * 0.03 + rnd(0.2), pick(b.pal), 0.12 + Math.random() * 0.1, 0.25, { t: b.trail as never, drag: 2 });
    let hit: Monster | null = null;
    for (const m of monsters) {
      if (!targetable(m)) continue;
      const fy = navHeight(H.nav!, m.x, m.z) + (m.def.float ?? 0);
      if (Math.hypot(b.pos.x - m.x, b.pos.z - m.z) < m.def.r + 0.25 && b.pos.y > fy - 0.2 && b.pos.y < fy + m.def.h + 0.2) { hit = m; break; }
    }
    const ground = b.pos.y < navHeight(H.nav!, b.pos.x, b.pos.z);
    if (hit || ground || b.life <= 0) {
      // Only our own spells deal damage here; the friend's are drawn for show (their device reports the hits).
      if (hit && b.mine) { const p = me(); hitMonster(hit, BOLT.dmg, p?.x ?? b.pos.x, p?.z ?? b.pos.z); }
      if (hit || ground) { burst(b.pos, b.pal, 22, 2.5, 0.4, 0.09); play('m_blast', { vol: 0.25, rate: 1.4 }); }
      scene.remove(b.mesh); b.mesh.geometry.dispose(); bolts.splice(i, 1);
    }
  }
}

function novaFx(p: Fighter) {
  const c = V(p.x, navHeight(H.nav!, p.x, p.z) + 0.6, p.z);
  explosion(c, p.pal, 2.2); lightFlash(c.x, c.y + 1, c.z, p.pal, 20, 0.4);
  emit(p.x, c.y - 0.5, p.z, 0, 0, 0, p.pal[1], 1, 0.7, { t: 'rune', spin: 1.5, grow: 9 });
  play('m_fire_expl', { vol: 0.9 }); S.shake = Math.max(S.shake, 0.18);
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
  const p = me(); if (!p || p.dead || H.phase !== 'play' || H.cine) return;
  if (a === 'atk') atkHeld = on;
  if (a === 'sh') p.wantShield = on;
  if (!on) return;
  if (a === 'atk') castBolt(p);
  if (a === 'sp' || a === 'sk' || a === 'sk2') castSlot(p, a);
  if (a === 'dg') dodge(p);
}
let atkHeld = false, lastHurt = -99;

/** Short floating text above a monster (back hits). */
function floatText(m: Monster, txt: string, col: string) {
  const v = V(m.x, m.root.position.y + m.def.h + 0.3, m.z).project(camera);
  if (v.z > 1) return;
  const el = document.createElement('div'); el.className = 'dmg'; el.style.color = col; el.textContent = txt;
  const { w, h } = viewSize();
  el.style.left = ((v.x + 1) / 2) * w + 'px'; el.style.top = ((1 - v.y) / 2) * h + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1100);
}

/* ---------- monsters hurting the players ---------- */
/** Our own wizard, as monsters and hazards see it. */
const myPrey: Prey = {
  x: 0, z: 0, dead: false, dodging: false,
  hurt(dmg: number, from: Hurter) {
    const p = me(); if (!p || p.dead || H.phase !== 'play') return;
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
    if (p.hp <= 0) fall(p);
  },
};
/** The friend's wizard on the host: hits are sent to their device, which applies them. */
const matePrey: Prey = {
  x: 0, z: 0, dead: false, dodging: false,
  hurt(dmg: number, from: Hurter) { coopSend('hurt', { d: dmg, x: +from.x.toFixed(2), z: +from.z.toFixed(2) }); },
};

/** Down to zero: alone that is the end of the attempt; with a friend we lie down until they revive us. */
function fall(p: Fighter) {
  p.hp = 0; p.dead = true; setShield(p, false); atkHeld = false;
  anim(p, 'death', { once: true, force: true });
  play('c_huge', { vol: 0.5 });
  if (!mate()) { H.phase = 'dead'; musicOff(); after(2.2, () => { if (H.phase === 'dead') showEnd('dead'); }); return; }
  H.downAt = S.T;
  hint('سقطتَ! يستطيع صديقك إنعاشك إن وقف بجانبك.', 6000);
}

function revive(p: Fighter) {
  p.dead = false; p.hp = Math.round(p.R.hp * 0.4); H.reviveT = 0;
  anim(p, 'idle', { force: true });
  burst(chest(p), GOLDEN, 40, 3, 0.8, 0.12, 'star'); play('m_sparkle', { vol: 0.7 });
  hint('عُدتَ إلى القتال!');
}

type EndKind = 'dead' | 'wipe' | 'left' | 'final';
function showEnd(kind: EndKind) {
  const name = H.def.name;
  const T: Record<EndKind, [string, string]> = {
    dead: ['سقطتَ في ' + name, 'الوحوش هنا لا ترحم. خذ نفَسًا، ثم حاول مجددًا.'],
    wipe: ['سقطتما في ' + name, isHost() ? 'لا بأس، ستعودان معًا إلى بداية المرحلة.' : 'بانتظار صديقك ليعيد المحاولة…'],
    left: ['انقطع الاتصال بصديقك', 'غادر صديقك الرحلة أو انقطع اتصاله.'],
    final: ['انتهت الرحلة', (H.partnerRi >= 0 ? 'هزمتما الموء معًا' : 'هزمتَ الموء') + '، ونامتِ الغابة أخيرًا.'],
  };
  $('hEndT').textContent = T[kind][0]; $('hEndP').textContent = T[kind][1];
  $('hRetry').hidden = !(kind === 'dead' || (kind === 'wipe' && isHost()));
  $('hEnd').hidden = false;
  for (const k of ['ctl', 'hud', 'hunt', 'pauseBtn', 'mCard', 'hHint', 'bossBar']) $(k).hidden = true;
  if (kind === 'final') { musicOff(); play('m_epic', { vol: 0.9 }); }
}

/** Starts the current stage over (after a defeat), keeping the map loaded. */
export function retryHunt() {
  if (online() && isHost()) coopSend('retry');
  $('hEnd').hidden = true;
  void clearStage(false).then(() => startHunt(true));
}

/** The stage is done (gate reached or boss beaten): its closing scene, then the next stage or the journey's end. */
async function advance() {
  if (H.phase === 'won') return;
  H.phase = 'won'; atkHeld = false;
  const p = me(); if (p) { p.vx = p.vz = 0; if (p.dead) revive(p); anim(p, 'idle'); }
  if (isHost()) coopSend('stage', { s: H.stage });
  play('m_epic', { vol: 0.8 });
  await cutscene(H.def.end, 10);
  const next = H.def.next;
  if (!next) { showEnd('final'); return; }
  const d = STAGES[next];
  $('hlName').textContent = d.name; $('hlTxt').textContent = 'جارٍ التجهيز…'; $('hLoad').hidden = false;
  try {
    await clearStage(true);
    await loadHunt(H.ri, next, t => { $('hlTxt').textContent = t; });
    await startHunt();
  } catch (e) {
    console.error(e);
    $('hlTxt').textContent = 'تعذّر فتح المرحلة: ' + (e instanceof Error ? e.message : String(e));
    setTimeout(() => { $('hLoad').hidden = true; void veil(toMenu); }, 3500);
  }
}

/* ---------- co-op messages ---------- */
/** The friend's wizard as last reported (interpolated every frame). */
let net = { x: 0, z: 0, ry: 0, clip: 0, dead: false, dodge: false };
let pending: { u: number; d: number; x: number; z: number; st?: number; p?: [number, number, number] }[] = [];
let sendAt = 0, snapAt = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onMessage(ev: string, p: any) {
  const q = mate();
  switch (ev) {
    case 'go':
      if (coop.role === 'guest' && S.mode !== 'hunt' && $('hLoad').hidden) {
        setTuning(DIFFS[p.diff] ? p.diff : 1);
        void playHunt('forest', p.ri);
      }
      break;
    case 'pl': if (q) {
      const a = p.a as number[];
      net = { x: a[0], z: a[1], ry: a[2], clip: a[3], dead: !!a[6], dodge: !!a[8] };
      matePrey.hidden = !!a[9]; setAlpha(q, a[9] ? 0.15 : 1);
      q.hp = a[4]; q.mana = a[5];
      if (a[7] && !q.shieldOn) { q.shieldOn = true; q.shield = shieldMesh(q); }
      if (!a[7] && q.shieldOn) { q.shieldOn = false; q.shield?.off(); q.shield = null; }
      if (net.dead && !q.dead) { q.dead = true; anim(q, 'death', { once: true, force: true }); if (!me()?.dead) hint('سقط صديقك! قف بجانبه لتُنعشه.', 6000); }
      if (!net.dead && q.dead) { q.dead = false; anim(q, 'idle', { force: true }); }
    } break;
    case 'ready': H.peerStage = p.s; break;
    case 'cast': if (q && H.nav) { if (p.k === 'n') novaFx(q); else launch(q, V(p.x, p.y, p.z), null, false); } break;
    case 'hit': if (isHost()) pending.push({ u: p.u, d: p.d, x: p.x, z: p.z, st: p.st, p: p.p }); break;
    case 'kit': if (q && H.nav) castKit(p.h as Hero, p.s as Slot, q, { a: p.a, x: p.x, z: p.z, u: p.u }, false, kitCtx()); break;
    case 'heal': { const m = me(); if (m && !m.dead) healMe(m, p.v); } break;
    case 'hurt': { const m = me(); if (m && m.dodgeT <= 0) myPrey.hurt(p.d, { x: p.x, z: p.z, def: { blood: DARK } }); } break;
    case 'hz': if (H.nav) spawnHazard(p.k as HazardKind, p.x, p.z, H.nav); break;
    case 'say': void speak(p.id as SceneId); break;
    case 'gate': if (!H.gate && H.nav) { H.gate = makeGate(p.x, p.z); hint('انفتحت البوابة قرب الطاحونة.'); $('hObj').textContent = GATE_OBJ; } break;
    case 'stage': if (p.s === H.stage) void advance(); break;
    case 'wipe': H.phase = 'lost'; showEnd('wipe'); break;
    case 'retry': retryHunt(); break;
    case 'spawn': case 'sync':
      if (p.s === H.stage && H.nav) for (const [u, id, x, z, st, hp] of p.l as [number, MonId, number, number, number, number][]) {
        if (monsters.some(m => m.uid === u)) continue;
        void spawnMonster(id, x, z, H.nav, STATES[st] === 'buried', u, true).then(m => { m.hp = hp; setNet(m, x, z, m.ry, st, hp); });
      }
      break;
    case 'snap':
      if (H.nav) {
        for (const [u, x, z, ry, st, hp] of p.m as number[][]) { const m = monsters.find(k => k.uid === u); if (m) setNet(m, x, z, ry, st, hp); }
        H.kills = p.k;
        if (p.r !== undefined) $('hObj').textContent = `${H.def.objective} — بقي ${p.r}`;
      }
      break;
  }
}

function partnerLeft() {
  const q = mate(); if (!q && S.mode !== 'hunt') return;
  if (q) { dropFighter(q); S.CH[1] = null; }
  document.documentElement.classList.remove('duo');
  if (S.mode !== 'hunt') return;
  if (coop.role === 'guest') { H.phase = 'lost'; showEnd('left'); return; }
  hint('غادر صديقك الرحلة. تستطيع المتابعة وحدك.', 6000);
  H.ready = true;
}

/* ---------- per frame ---------- */
/** Joystick (x right, z down) → world direction for the current camera heading. */
function worldMove(ix: number, iz: number): [number, number] {
  const fx = Math.sin(H.yaw), fz = Math.cos(H.yaw);
  return [fx * -iz + -fz * ix, fz * -iz + fx * ix];
}

const TIMERS = ['cdA', 'cdD', 'castT', 'hitT', 'cdS', 'invT', 'stunT', 'slowT'] as const;

/** Feet on the floor, animation, wand light: shared by our wizard and the friend's. */
function poseFighter(p: Fighter, dt: number) {
  const fy = navHeight(H.nav!, p.x, p.z);
  p.root.position.set(p.x, fy, p.z); p.root.rotation.y = p.ry; p.blob.position.set(p.x, fy + 0.03, p.z);
  p.mixer.update(dt);
  applyGroundContact(p); applyGrip(p);
  tipPos(p, p.light.position);
  p.light.intensity *= Math.pow(0.12, dt); p.light.intensity = Math.max(p.light.intensity, 1.4);
  if (!p.dead && Math.random() < 0.4) { const t = p.light.position; emit(t.x, t.y, t.z, rnd(0.05), 0.15, rnd(0.05), pick(p.pal), 0.08, 0.4, { t: 'magic' }); }
}

function updPlayer(p: Fighter, dt: number) {
  const nav = H.nav!;
  for (const k of TIMERS) p[k] = Math.max(0, p[k] - dt);
  if (!p.dead) {
    p.mana = Math.min(100, p.mana + G.regen * dt);
    // Out of combat for a while: wounds close slowly.
    if (S.T - lastHurt > 6) p.hp = Math.min(p.R.hp, p.hp + 12 * dt);
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
  poseFighter(p, dt);
}

/** The friend's wizard glides to their last reported state. */
function updMate(q: Fighter, dt: number) {
  const k = Math.min(1, dt * 12);
  q.x += (net.x - q.x) * k; q.z += (net.z - q.z) * k; q.ry += angleDelta(q.ry, net.ry) * k;
  if (!q.dead) { const c = CLIP_NAMES[net.clip]; if (c && c !== q.curName) anim(q, c, { once: c === 'bolt' || c === 'special' || c === 'evade' || c === 'hit' }); }
  poseFighter(q, dt);
  matePrey.x = q.x; matePrey.z = q.z; matePrey.dead = q.dead; matePrey.dodging = net.dodge;
}

let uiAt = 0;
export function huntTick(rdt: number) {
  const dt = rdt * S.slowmo;
  S.T += dt; S.stateT += rdt;
  runScheduled();
  const p = me(), q = mate(); if (!p || !H.nav) return dt;
  updPlayer(p, dt);
  if (q) updMate(q, dt);
  // Our state for the friend, ~12 times a second.
  if (q && S.T - sendAt > 0.08) {
    sendAt = S.T;
    coopSend('pl', { a: [+p.x.toFixed(2), +p.z.toFixed(2), +p.ry.toFixed(2), p.curName ? CLIP_NAMES.indexOf(p.curName) : 0, Math.round(p.hp), Math.round(p.mana), p.dead ? 1 : 0, p.shieldOn ? 1 : 0, p.dodgeT > 0 ? 1 : 0, H.hiddenUntil > S.T ? 1 : 0] });
  }
  if (H.cine) { p.root.updateMatrixWorld(); return dt; }
  myPrey.x = p.x; myPrey.z = p.z; myPrey.dead = p.dead || H.phase !== 'play'; myPrey.dodging = p.dodgeT > 0;
  const nav = H.nav;
  if (isHost()) {
    // The guest just loaded this stage: send it everything alive, then the monsters may move.
    if (!H.ready && H.peerStage === H.stage) {
      H.ready = true;
      coopSend('sync', { s: H.stage, l: monsters.filter(m => !m.gone && m.state !== 'dead').map(packSpawn) });
      if (H.gate) coopSend('gate', { x: H.gate.position.x, z: H.gate.position.z });
    }
    for (const h of pending) { const m = monsters.find(k => k.uid === h.u); if (m && targetable(m)) hitMonster(m, h.d, h.x, h.z, { stun: h.st, push: h.p }, false); }
    pending = [];
    const preys = q ? [myPrey, matePrey] : [myPrey];
    if (H.ready) {
      for (const m of monsters.slice()) if (!m.gone) updateMonster(m, dt, nav, preys);
      bossTick(dt, preys, {
        summon: (id, x, z) => void hostSpawn(id, x, z, true),
        hazard: (k, x, z) => { spawnHazard(k, x, z, nav); coopSend('hz', { k, x: +x.toFixed(2), z: +z.toFixed(2) }); },
        say: id => sayAll(id),
      });
    }
    // Waves: the next one once the current is beaten; the gate after the last.
    if (H.def.waves && H.phase === 'play' && S.T - H.waveAt > 1.5 && !monsters.some(m => m.state !== 'dead' && !m.gone)) {
      if (H.wave < H.def.waves.length - 1) startWave(H.wave + 1); else if (!H.gate) openGate();
    }
    if (H.def.waves) { H.remaining = remaining(); $('hObj').textContent = H.gate ? GATE_OBJ : `${H.def.objective} — بقي ${H.remaining}`; }
    // The boss falls: a moment of silence, then the end of the journey.
    if (boss.m && boss.m.state === 'dead' && H.phase === 'play') { if (!H.bossDownAt) H.bossDownAt = S.T; if (S.T - H.bossDownAt > 2.5) void advance(); }
    // Both hunters down: the attempt is over.
    if (q && p.dead && q.dead && H.phase === 'play' && S.T - H.downAt > 1.2) { H.phase = 'lost'; coopSend('wipe'); showEnd('wipe'); }
    if (q && S.T - snapAt > 0.1) {
      snapAt = S.T;
      coopSend('snap', { m: monsters.filter(m => !m.gone).map(m => [m.uid, +m.x.toFixed(2), +m.z.toFixed(2), +m.ry.toFixed(2), STATES.indexOf(m.state), Math.round(m.hp)]), k: H.kills, r: H.def.waves && !H.gate ? H.remaining : undefined });
    }
  } else for (const m of monsters.slice()) if (!m.gone) updatePuppet(m, dt, nav);
  for (let i = monsters.length - 1; i >= 0; i--) if (monsters[i].gone) monsters.splice(i, 1);
  updBolts(dt);
  updateKits(dt);
  if (H.hiddenUntil && S.T > H.hiddenUntil) unhide(p);
  myPrey.hidden = H.hiddenUntil > S.T;
  updateHazards(dt, nav, p.dead ? null : myPrey);
  // Reviving: our fallen wizard stands up after the friend stayed next to us for a moment.
  if (q && p.dead && H.phase === 'play') {
    const close = !q.dead && Math.hypot(q.x - p.x, q.z - p.z) < REVIVE_R;
    H.reviveT = close ? H.reviveT + dt : Math.max(0, H.reviveT - dt);
    if (close && Math.random() < 0.6) emit(p.x + rnd(0.6), navHeight(nav, p.x, p.z) + 0.2, p.z + rnd(0.6), 0, 1.2, 0, pick(GOLDEN), 0.15, 0.8, { t: 'star' });
    if (H.reviveT >= REVIVE_S) revive(p);
  }
  // First time a kind of monster comes for us: its name card.
  for (const m of monsters) if (m.state === 'chase' && !H.seen.has(m.id)) {
    if (!H.seen.size && H.stage === 'forest') hint('الهجوم يصوّب تلقائيًا نحو أقرب وحش أمامك. المراوغة تُفلتك من قفزاتها.');
    H.seen.add(m.id); monsterCard(m.def.name, m.id);
  }
  // Boss bar (the guest learns the boss's full health from the highest value it has seen).
  if (H.def.boss) {
    const b = monsters.find(m => m.id === H.def.boss!.id);
    if (b) { const full = boss.m === b ? boss.maxHp : bossMaxSeen(b); $('bossFill').style.transform = `scaleX(${Math.max(0, b.hp) / Math.max(1, full)})`; }
  }
  // Gate: shimmer, and (host) the stage is won when either hunter steps into it.
  if (H.gate) {
    const g = H.gate;
    g.children[0].rotation.z += dt * 0.6;
    if (Math.random() < 0.5) emit(g.position.x + rnd(1.4), g.position.y + 0.4 + Math.random() * 3, g.position.z + rnd(0.3), 0, 0.4, 0, new THREE.Color(2.4, 1.7, 0.6), 0.12, 1, { t: 'magic' });
    const inGate = (f: Fighter | null) => !!f && !f.dead && Math.hypot(f.x - g.position.x, f.z - g.position.z) < 2.2;
    if (isHost() && H.phase === 'play' && (inGate(p) || inGate(q))) void advance();
  }
  // Shadows follow the wizard (the frustum covers only the area around them).
  const fy = navHeight(nav, p.x, p.z), e = H.def.env.sun;
  moon.position.set(p.x + e[0], fy + e[1], p.z + e[2]); moon.target.position.set(p.x, fy, p.z); moon.target.updateMatrixWorld();
  hud(); updateButtons();
  if (S.T - uiAt > 0.1) { uiAt = S.T; drawMinimap(p, H.yaw, monsters, H.gate?.position ?? null, q); }
  return dt;
}
const maxSeen = new WeakMap<Monster, number>();
function bossMaxSeen(m: Monster) { const v = Math.max(maxSeen.get(m) ?? 0, m.hp); maxSeen.set(m, v); return v; }

/* ---------- camera ---------- */
const camPos = V(), camLook = V(), tp = V(), tl = V();
let camInit = false;
export function huntCamera(dt: number) {
  const p = me(); if (!p || !H.nav) return;
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
  // Hills: first rise over the hill (like a crane), and only if that is not enough, move in front of it.
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
  cut.cam.value.copy(camera.position); cut.target.value.set(p.x, fy + 1.2, p.z);
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
  $('hRetry').onclick = () => retryHunt();
  $('hMenu').onclick = () => void veil(toMenu);
  initStory();
  onCoopMessage(onMessage);
  onPartnerLeft(partnerLeft);
}

/**
 * From the menus into the journey: a loading screen with the stage's name while the map, its monsters and the
 * wizards are read from the device, then the stage. `partnerRi` is the friend's wizard in co-op.
 */
export async function playHunt(stage: StageId = 'forest', partnerRi = -1) {
  const d = STAGES[stage];
  if (!online()) setTuning(huntDiff());
  H.partnerRi = partnerRi;
  $('hlName').textContent = d.name; $('hlTxt').textContent = 'جارٍ التجهيز…';
  $('hLoad').hidden = false; $('menu').hidden = true; $('pack').hidden = true; $('title').hidden = true;
  try {
    await loadHunt(heroRi(), stage, t => { $('hlTxt').textContent = t; });
    await startHunt();
  } catch (e) {
    console.error(e);
    $('hlTxt').textContent = 'تعذّر فتح المرحلة: ' + (e instanceof Error ? e.message : String(e));
    setTimeout(() => { $('hLoad').hidden = true; coopLeave(); $('menu').hidden = false; S.state = 'menu'; }, 3500);
  }
}

/** Co-op is live: the game must not freeze on pause (the friend keeps playing). */
export const huntOnline = () => S.mode === 'hunt' && online() && !!coop.peer;

// ?debug: the hunt's internals for automated browser checks.
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __hunt: { H, monsters, boss, spawnMonster, packGltf, huntTick, huntPress, huntCamera, navHeight, playHunt, advance, coop, coopOpen, coopSend, updPlayer: (dt: number) => updPlayer(S.CH[0]!, dt) } });

const DIFF_KEY = 'asrar.huntDiff';
/** Chosen difficulty (0..2, default the middle one), kept on the device. */
export function huntDiff() { const v = +(localStorage.getItem(DIFF_KEY) ?? 1); return v >= 0 && v <= 2 ? v : 1; }
export function setHuntDiff(v: number) { localStorage.setItem(DIFF_KEY, String(v)); }

/* ---------- story heroes ---------- */
const HERO_KEY = 'asrar.huntHero';
/** The chosen story hero (Ehab, Sara or Abed), kept on the device. */
export function huntHero(): Hero { const v = localStorage.getItem(HERO_KEY) as Hero | null; return v && HEROES.includes(v) ? v : 'ehab'; }
export function setHuntHero(h: Hero) { localStorage.setItem(HERO_KEY, h); }
export const heroRi = (h: Hero = huntHero()) => ROSTER.findIndex(r => r.id === h);
const heroOf = (f: Fighter): Hero => (HEROES.includes(f.R.id as Hero) ? f.R.id : 'ehab') as Hero;

function setTuning(level: number) { const lv = DIFFS[level] ?? DIFFS[1]; tuning.hp = lv.hp * MON_HP; tuning.dmg = lv.dmg * MON_DMG; }

/** A wizard with story-mode health (their own copy of the roster entry, so duels keep theirs). */
function storyFighter(ri: number, side: 0 | 1) {
  const f = makeFighter(ri, side);
  f.R = { ...f.R, hp: HUNT_HP };
  resetChar(f);
  return f;
}

function setAlpha(f: Fighter, a: number) {
  if ((f.alpha ?? 1) === a) return;
  f.alpha = a;
  f.model.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { mt.transparent = a < 1; mt.opacity = a; mt.depthWrite = a >= 1; }
  });
}
function unhide(p: Fighter) { if (H.hiddenUntil) { H.hiddenUntil = 0; setAlpha(p, 1); } }

function healMe(p: Fighter, amount: number) {
  const step = amount / 6;
  for (let k = 1; k <= 6; k++) after(k * 0.25, () => { if (!p.dead) p.hp = Math.min(p.R.hp, p.hp + step); });
  p.slowT = 0; p.stunT = 0;
  dmgText(p, '+' + amount, '#c7f59a'); healFx(p, amount);
}

function kitCtx(): KitCtx {
  return {
    nav: H.nav!,
    mate: mate(),
    hit: (m, dmg, o) => { const p = me(); hitMonster(m, dmg, p?.x ?? m.x, p?.z ?? m.z, o); },
    heal: (who, n) => { if (who === 'me') { const p = me(); if (p) healMe(p, n); } else { coopSend('heal', { v: n }); const q = mate(); if (q) healFx(q, n); } },
    hide: s => { const p = me(); if (!p) return; H.hiddenUntil = S.T + s; H.veilBonus = true; setAlpha(p, 0.3); },
  };
}

/** Special, skill and power: mana and cooldowns like the duel's, effect from the hero's kit. */
function castSlot(p: Fighter, slot: Slot) {
  if (p.dead || p.dodgeT > 0 || p.castT > 0.1) return;
  const K = slot === 'sk' ? p.R.skill : slot === 'sk2' ? p.R.skill2 : null;
  const cost = slot === 'sp' ? G.spCost : K!.cost;
  if (p.mana < cost) return;
  if (slot === 'sk' && p.cdK > 0) return;
  if (slot === 'sk2' && (p.cdK2 > 0 || !K)) return;
  p.mana -= cost; setShield(p, false);
  if (slot === 'sk') p.cdK = K!.cd;
  if (slot === 'sk2') p.cdK2 = K!.cd;
  const hero = heroOf(p), args = kitArgs(p, slot, hero);
  if (!(hero === 'ehab' && slot === 'sk')) unhide(p);
  p.ry = args.a; p.castT = slot === 'sp' ? 0.7 : 0.45;
  anim(p, slot === 'sk' && hero !== 'abed' ? 'block' : 'special', { once: true, speed: 1.5, force: true });
  play(p.R.ss, { vol: 0.7 });
  after(slot === 'sp' ? 0.4 : 0.2, () => {
    if (p.dead || S.mode !== 'hunt' || !H.nav) return;
    castKit(hero, slot, p, args, true, kitCtx());
    coopSend('kit', { h: hero, s: slot, ...args });
  });
}
