import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { scene, BLOB } from '../render/stage';
import { clips, findBone, loadFbx, loadGlb, retarget } from '../assets/loader';
import { faceForward, renameTripoBones, retargetClips } from '../assets/retarget';
import { ROSTER } from '../data/roster';
import { V } from '../core/util';
import { CLIP_NAMES, type ClipName, type Fighter } from '../core/types';

/** Prepared base models, one per roster entry; fighters are skeleton clones of these. */
export const base: THREE.Object3D[] = [];

/** Approximate gzipped sizes, for the progress bar before the server answers. */
const MODEL_BYTES: Record<string, number> = { arissa: 2_280_000, ganfaul: 1_270_000, nightshade: 1_220_000, pelegrini: 985_000, ehab: 530_000 };
/** Mixamo model whose skeleton drives the retargeting of Tripo rigs (Qasem: a man of similar build). */
const RETARGET_SRC = 3;
/** Clips baked for models with their own skeleton (Tripo); others use the shared clips renamed. */
const ownClips: Partial<Record<number, Record<ClipName, THREE.AnimationClip>>> = {};

/** Clip for any clone of roster model ri. */
export function clipFor(ri: number, k: ClipName, model: THREE.Object3D) {
  return ownClips[ri]?.[k] ?? retarget(k, model);
}
const pending: Promise<void>[] = [];

/** Wand transform in the right hand's space for retargeted rigs (copied from the source model's fist). */
const wandXf: Partial<Record<number, { q: THREE.Quaternion; p: THREE.Vector3; s: number }>> = {};

/**
 * Retargeted hands turn exactly like the source's (same change of world rotation from rest), so a wand fixed
 * in the same world-space relation to the hand at rest stays right in every animation.
 */
function wandFrom(ri: number, src: THREE.Object3D, tgt: THREE.Object3D) {
  src.updateMatrixWorld(true); tgt.updateMatrixWorld(true);
  const sh = findBone(src, /RightHand$/), th = findBone(tgt, /RightHand$/); if (!sh || !th) return;
  const tmp = new THREE.Group();
  attachWand({ hand: sh, model: src, grip: [] } as unknown as Fighter, tmp);
  const tS = th.getWorldScale(V()).x;
  const rel = th.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(sh.getWorldQuaternion(new THREE.Quaternion()));
  const q = rel.clone().multiply(tmp.quaternion);
  // Hands differ in size, so the grip point is this hand's own palm: ~6 cm past the wrist along the forearm line.
  const palm = th.worldToLocal(th.parent!.getWorldPosition(V())).normalize().multiplyScalar(-0.06 / tS);
  wandXf[ri] = { q, p: palm.addScaledVector(V(0, 1, 0).applyQuaternion(q), -0.06 / tS), s: 1 / tS };
}

/**
 * Loads one roster model on demand (gzipped FBX), once. The menus use static portraits,
 * so the title screen never waits for the 3D characters; matches await only the two fighters they need.
 */
export function ensureModel(i: number): Promise<void> {
  const r = ROSTER[i];
  pending[i] ??= r.rig === 'tripo'
    ? Promise.all([loadGlb(`models/${r.file}.glb.gz`, MODEL_BYTES[r.file]), ensureModel(RETARGET_SRC)]).then(([m]) => {
      renameTripoBones(m); faceForward(m); prepBase(i, m);
      const src = SkeletonUtils.clone(base[RETARGET_SRC]);
      wandFrom(i, src, m);
      ownClips[i] = retargetClips(src, Object.fromEntries(CLIP_NAMES.filter(k => clips[k]).map(k => [k, retarget(k, src)])) as Record<ClipName, THREE.AnimationClip>, m);
    })
    : loadFbx(`models/${r.file}.fbx.gz`, MODEL_BYTES[r.file]).then(m => prepBase(i, m));
  return pending[i];
}
export const modelReady = (i: number) => !!base[i];
export const ensureModels = (ids: number[]) => Promise.all(ids.map(ensureModel)).then(() => undefined);

/** Tones down Mixamo's glossy materials and scales every model to 1.78 m. */
function prepBase(i: number, m: THREE.Object3D) {
  m.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(mt => {
      const p = mt as THREE.MeshPhongMaterial;
      if (p.shininess !== undefined) p.shininess = Math.min(p.shininess, 20);
      if (p.specular) p.specular.multiplyScalar(0.4);
    });
  });
  // Skinned GLBs keep their vertices in bind space, so measure the posed (precise) bounds for them.
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m, ROSTER[i].rig === 'tripo');
  const h = box.max.y - box.min.y || 170;
  m.scale.setScalar(1.78 / h);
  base[i] = m;
}

function makeWand(col: number) {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.34, 8), new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.55 }));
  stick.position.y = 0.17; g.add(stick);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.014, 0.09, 10), new THREE.MeshStandardMaterial({ color: 0x4a2d1a, roughness: 0.4, metalness: 0.3 }));
  g.add(grip);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 6, 14), new THREE.MeshStandardMaterial({ color: 0xc9a46a, metalness: 0.9, roughness: 0.25 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), toneMapped: false }));
  tip.position.y = 0.35; g.add(tip);
  g.userData.tip = tip;
  return g;
}

export function makeFighter(ri: number, side: 0 | 1): Fighter {
  const R = ROSTER[ri];
  const m = SkeletonUtils.clone(base[ri]);
  const g = new THREE.Group(); g.add(m); scene.add(g);
  const mixer = new THREE.AnimationMixer(m);
  const actions: Fighter['actions'] = {};
  for (const k of CLIP_NAMES) if (clips[k]) actions[k] = mixer.clipAction(clipFor(ri, k, m));
  const wand = makeWand(R.lc);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);
  const light = new THREE.PointLight(R.lc, 0, 6, 1.5); scene.add(light);
  const c = {
    R, ri, idx: side, root: g, model: m, pal: R.pal, hex: R.css, mixer, actions,
    hand: findBone(m, /RightHand$/), chestB: findBone(m, /Spine2$/) || findBone(m, /Spine1$/), headB: findBone(m, /Head$/),
    wand, light, blob, cur: null, shield: null, wins: 0, warpTo: null, dodgeDir: V(),
    hitFlash: 0, knockT: 0, mats: [], grip: [],
  } as unknown as Fighter;
  // Own copies of the materials so hit flashes affect only this fighter (mirror matches share a model).
  m.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(mt => {
      const n = mt.clone() as THREE.MeshPhongMaterial;
      if (n.emissive) { n.userData.baseEmissive = n.emissive.clone(); c.mats.push(n); }
      return n;
    });
    mesh.material = mats.length === 1 ? mats[0] : mats;
  });
  g.updateMatrixWorld(true);
  footCorr[ri] ??= measureFootCorrection(c);
  if (c.hand) attachWand(c, wand); else { wand.position.set(0.3, 1.2, 0.3); g.add(wand); }
  resetChar(c);
  return c;
}

/** Multiplies every material colour of a (cloned) model, e.g. for the mirror-match costume. */
export function tintModel(model: THREE.Object3D, tint: THREE.Color) {
  model.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (m as THREE.MeshStandardMaterial).color?.multiply(tint);
  });
}

/**
 * Mirror match (both players picked the same wizard): like a fighting game's alternate costume, the second
 * fighter is darker and cooler and casts in other colours (hue turned by a third), so everyone can tell them apart.
 */
export function altCostume(c: Fighter) {
  const turn = (col: THREE.Color) => new THREE.Color(col.b, col.r, col.g);
  c.tint = new THREE.Color(0.6, 0.62, 0.8);
  tintModel(c.model, c.tint);
  c.pal = c.pal.map(turn);
  c.hex = '#' + turn(new THREE.Color(c.R.css)).getHexString();
  c.light.color = turn(c.light.color);
  const tip = c.wand.userData.tip as THREE.Mesh;
  (tip.material as THREE.MeshBasicMaterial).color = turn((tip.material as THREE.MeshBasicMaterial).color);
}

/**
 * Puts the wand inside a closed fist instead of through the palm.
 * Mixamo fingers extend along local +Y and curl around local +X (towards +Z, the palm side),
 * so the fist's hollow sits just in front of the middle-finger root and the wand runs across the palm
 * along local X, tip out on the thumb/index side. Measured from each model's own bones.
 */
function attachWand(c: Fighter, wand: THREE.Group) {
  const hand = c.hand!;
  const ws = hand.getWorldScale(V()).x || c.model.scale.x;
  const bone = (n: string) => findBone(hand, new RegExp(`RightHand${n}$`));
  const mid = bone('Middle1'), idx = bone('Index1');
  const xf = wandXf[c.ri];
  if (xf) { wand.quaternion.copy(xf.q); wand.position.copy(xf.p); wand.scale.setScalar(xf.s); hand.add(wand); return; }
  if (!mid) {
    // No finger bones (Tripo rigs): the wand leaves the palm along the forearm's line, tilted towards the
    // front of the body (measured in the rest pose, where the model faces +Z).
    const fore = hand.parent as THREE.Object3D;
    const dir = hand.worldToLocal(fore.getWorldPosition(V())).normalize().negate();
    const front = hand.worldToLocal(hand.getWorldPosition(V()).add(V(0, 0, 1))).normalize();
    const axis = dir.clone().addScaledVector(front, 0.6).normalize();
    wand.scale.setScalar(1 / ws);
    wand.quaternion.setFromUnitVectors(V(0, 1, 0), axis);
    wand.position.copy(dir).multiplyScalar(0.07 / ws).addScaledVector(axis, -0.06 / ws);
    hand.add(wand);
    return;
  }
  const root = mid ? mid.position.clone() : V(0, 0.09 / ws, 0);
  const fingerLen = (bone('Middle2')?.position.y ?? 0.04 / ws);
  const tipSide = idx && mid && idx.position.x < mid.position.x ? -1 : 1; // thumb side along X
  // Hollow of the fist: slightly back from the knuckles and one finger-segment towards the palm side.
  const center = V(root.x, root.y - fingerLen * 0.15, root.z + fingerLen * 0.75);
  const GRIP = 0.06; // metres from the wand's butt to where it is held
  wand.scale.setScalar(1 / ws);
  // Wand +Y across the palm towards the thumb side, tilted 0.3 rad towards the fingertips like a natural hold.
  wand.rotation.set(0, 0, -tipSide * (Math.PI / 2 - 0.3));
  const axis = V(0, 1, 0).applyEuler(wand.rotation);
  wand.position.copy(center).addScaledVector(axis, -GRIP / ws);
  hand.add(wand);
  // Curl targets per joint (radians about local X). Index slightly looser, thumb wraps over.
  const CURL: [string, number][] = [
    ['Index1', 0.95], ['Index2', 1.15], ['Index3', 0.8],
    ['Middle1', 1.2], ['Middle2', 1.35], ['Middle3', 0.9],
    ['Ring1', 1.25], ['Ring2', 1.35], ['Ring3', 0.9],
    ['Pinky1', 1.3], ['Pinky2', 1.3], ['Pinky3', 0.85],
    ['Thumb2', 0.35], ['Thumb3', 0.5],
  ];
  for (const [n, a] of CURL) { const b = bone(n); if (b) c.grip.push({ bone: b, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)) }); }
}

/**
 * Ground contact. The Mixamo clips were authored on bodies of different proportions, so their hip height
 * puts some wizards' feet ~20 cm under the floor (idle, casting) or ~25 cm above it (Reem walking).
 * For every model and clip we sample the pose once and store the vertical shift that brings the lowest bone
 * (plus a sole thickness) to y = 0; at runtime the shifts of the playing clips are blended by their weights.
 */
const footCorr: Partial<Record<number, Partial<Record<ClipName, number>>>> = {};
const SOLE = 0.02;

function measureFootCorrection(c: Fighter): Partial<Record<ClipName, number>> {
  const out: Partial<Record<ClipName, number>> = {};
  const bones: THREE.Bone[] = [];
  c.model.traverse(o => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const v = V(), rootY = c.root.position.y;
  for (const k of CLIP_NAMES) {
    const a = c.actions[k]; if (!a) continue;
    c.mixer.stopAllAction(); a.reset().play();
    const dur = a.getClip().duration; let low = Infinity;
    for (let s = 0; s <= 12; s++) {
      a.time = (dur * s) / 12; c.mixer.update(0); c.root.updateMatrixWorld(true);
      for (const b of bones) { b.getWorldPosition(v); if (v.y < low) low = v.y; }
    }
    out[k] = Number.isFinite(low) ? SOLE - (low - rootY) : 0;
  }
  c.mixer.stopAllAction();
  return out;
}

/** Weighted vertical shift of the currently playing clips (call after mixer.update). */
export function applyGroundContact(c: Fighter) {
  const corr = footCorr[c.ri]; if (!corr) return;
  let s = 0, w = 0;
  for (const k of CLIP_NAMES) {
    const a = c.actions[k];
    if (!a || !a.isRunning()) continue;
    const ew = a.getEffectiveWeight(); if (ew <= 0) continue;
    s += ew * (corr[k] ?? 0); w += ew;
  }
  c.model.position.y = w > 0 ? s / w : 0;
}

/** Overrides the animated finger pose with the fist (call after mixer.update). */
export function applyGrip(c: Fighter) {
  for (const g of c.grip) g.bone.quaternion.slerp(g.q, 0.9);
}

export function dropFighter(c: Fighter | null) {
  if (!c) return;
  scene.remove(c.root, c.light, c.blob);
  c.mixer.stopAllAction();
  c.shield?.off();
}

/** Resets a fighter for a new round (side 0 starts left, side 1 right). */
export function resetChar(c: Fighter) {
  const i = c.idx;
  Object.assign(c, {
    x: i === 0 ? -3 : 3, z: -0.6, vx: 0, vz: 0, ry: i === 0 ? Math.PI / 2 : -Math.PI / 2, hp: c.R.hp, mana: 60,
    cdA: 0, cdD: 0, shieldT: -1, shieldOn: false, dodgeT: 0, dodgeDir: V(), castT: 0, hitT: 0, slowT: 0, stunT: 0, cdS: 0, shHP: 0,
    cdK: 0, cdK2: 0, invT: 0, warpT: 0, dead: false, inX: 0, inZ: 0, wantShield: false, stepAcc: 0, hitFlash: 0, knockT: 0, turnLockT: 0, veilT: 0, authHp: c.R.hp, pend: [],
  });
  if (c.shield) { c.shield.off(); c.shield = null; }
  anim(c, 'idle', { force: true });
}

/** Cross-fades to a clip. Returns the clip's duration at the given speed (0 when unchanged). */
export function anim(c: Fighter, n: ClipName, { once = false, speed = 1, fade = 0.18, force = false } = {}) {
  const a = c.actions[n]; if (!a) return 0;
  if (c.cur === a && !force) { a.timeScale = speed; return 0; }
  a.reset(); a.timeScale = speed; a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  a.clampWhenFinished = once; a.enabled = true; a.setEffectiveWeight(1);
  if (c.cur && c.cur !== a) a.crossFadeFrom(c.cur, fade, false);
  a.play(); c.cur = a; c.curName = n;
  return a.getClip().duration / speed;
}

export const tipPos = (c: Fighter, v = V()) => { (c.wand.userData.tip as THREE.Object3D).getWorldPosition(v); return v; };
export const chest = (c: Fighter, v = V()) => { if (c.chestB) c.chestB.getWorldPosition(v); else v.set(c.x, 1.3, c.z); return v; };
export const headPos = (c: Fighter, v = V()) => { if (c.headB) c.headB.getWorldPosition(v); else v.set(c.x, 1.7, c.z); v.y += 0.35; return v; };
