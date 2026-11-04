import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { scene, BLOB } from '../render/stage';
import { clips, findBone, loadFbx, retarget } from '../assets/loader';
import { ROSTER } from '../data/roster';
import { V } from '../core/util';
import { CLIP_NAMES, type ClipName, type Fighter } from '../core/types';

/** Prepared base models, one per roster entry; fighters are skeleton clones of these. */
export const base: THREE.Object3D[] = [];

export async function loadRosterModels(onEach: () => void) {
  const models = await Promise.all(ROSTER.map(r => loadFbx(`models/${r.file}.fbx`).then(m => { onEach(); return m; })));
  models.forEach((m, i) => prepBase(i, m));
}

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
  const box = new THREE.Box3().setFromObject(m);
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
  for (const k of CLIP_NAMES) if (clips[k]) actions[k] = mixer.clipAction(retarget(k, m));
  const wand = makeWand(R.lc);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);
  const light = new THREE.PointLight(R.lc, 0, 6, 1.5); scene.add(light);
  const c = {
    R, ri, idx: side, root: g, model: m, pal: R.pal, hex: R.css, mixer, actions,
    hand: findBone(m, /RightHand$/), chestB: findBone(m, /Spine2$/) || findBone(m, /Spine1$/), headB: findBone(m, /Head$/),
    wand, light, blob, cur: null, shield: null, wins: 0, warpTo: null, dodgeDir: V(),
  } as unknown as Fighter;
  g.updateMatrixWorld(true);
  if (c.hand) {
    const ws = c.hand.getWorldScale(V()).x || m.scale.x;
    wand.scale.setScalar(1 / ws); wand.position.set(0, 0.085 / ws, 0.02 / ws); wand.rotation.set(Math.PI * 0.45, 0, 0);
    c.hand.add(wand);
  } else { wand.position.set(0.3, 1.2, 0.3); g.add(wand); }
  resetChar(c);
  return c;
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
    cdK: 0, invT: 0, warpT: 0, dead: false, inX: 0, inZ: 0, wantShield: false, stepAcc: 0,
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
