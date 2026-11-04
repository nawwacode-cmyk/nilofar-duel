import * as THREE from 'three';
import { CLIP_NAMES, type ClipName } from '../core/types';

/**
 * Retargeting Mixamo animations onto characters with other skeletons (e.g. Tripo rigs).
 *
 * Bones are first renamed to Mixamo names so the rest of the game (hand, chest, head lookups) works unchanged.
 * Each clip is then sampled on a Mixamo model and, per frame, every mapped bone gets the same change of
 * world orientation relative to its rest pose. A per-bone alignment rotates the target's rest direction onto
 * the source's (so an A-pose rig follows T-pose animations without lowered arms). Unmapped bones keep their
 * rest orientation relative to their parent.
 */
const TRIPO: Record<string, string> = {
  Hip: 'Hips', Waist: 'Spine', Spine01: 'Spine1', Spine02: 'Spine2', NeckTwist01: 'Neck', Head: 'Head',
  L_Clavicle: 'LeftShoulder', L_Upperarm: 'LeftArm', L_Forearm: 'LeftForeArm', L_Hand: 'LeftHand',
  R_Clavicle: 'RightShoulder', R_Upperarm: 'RightArm', R_Forearm: 'RightForeArm', R_Hand: 'RightHand',
  L_Thigh: 'LeftUpLeg', L_Calf: 'LeftLeg', L_Foot: 'LeftFoot', L_ToeBase: 'LeftToeBase',
  R_Thigh: 'RightUpLeg', R_Calf: 'RightLeg', R_Foot: 'RightFoot', R_ToeBase: 'RightToeBase',
};
/** Child used to measure a bone's direction (rest-pose alignment). */
const CHILD: Record<string, string> = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};

export function renameTripoBones(root: THREE.Object3D) {
  root.traverse(o => { if ((o as THREE.Bone).isBone && TRIPO[o.name]) o.name = 'mixamorig' + TRIPO[o.name]; });
}

/**
 * Turns a rig to face +Z like the Mixamo models (Tripo exports may face another axis).
 * Forward is derived from the hands: (left − right) × up.
 */
export function faceForward(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const l = boneBySuffix(root, 'LeftHand'), r = boneBySuffix(root, 'RightHand');
  if (!l || !r) return;
  const f = wp(l).sub(wp(r)).cross(new THREE.Vector3(0, 1, 0)); f.y = 0;
  if (f.lengthSq() < 1e-8) return;
  root.rotation.y -= Math.atan2(f.x, f.z);
  root.updateMatrixWorld(true);
}

const boneBySuffix =(root: THREE.Object3D, suffix: string) => {
  let f: THREE.Bone | null = null;
  root.traverse(o => { if (!f && (o as THREE.Bone).isBone && (o.name.endsWith(':' + suffix) || o.name.endsWith('mixamorig' + suffix) || o.name === suffix)) f = o as THREE.Bone; });
  return f as THREE.Bone | null;
};
const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/**
 * @param srcModel a Mixamo model at rest (fresh clone), already scaled like the target
 * @param srcClips clips already renamed for srcModel's bones
 * @param tgt the target model at rest (bones renamed with renameTripoBones)
 */
export function retargetClips(srcModel: THREE.Object3D, srcClips: Record<ClipName, THREE.AnimationClip>, tgt: THREE.Object3D, fps = 30) {
  srcModel.updateMatrixWorld(true); tgt.updateMatrixWorld(true);
  const names = Object.values(TRIPO);
  const pairs = names.map(n => ({ n, s: boneBySuffix(srcModel, n), t: boneBySuffix(tgt, n) })).filter(p => p.s && p.t) as { n: string; s: THREE.Bone; t: THREE.Bone }[];
  const rest = new Map<THREE.Bone, { sBind: THREE.Quaternion; tBind: THREE.Quaternion; align: THREE.Quaternion }>();
  for (const p of pairs) {
    const align = new THREE.Quaternion();
    const ch = CHILD[p.n];
    const sc = ch && boneBySuffix(srcModel, ch), tc = ch && boneBySuffix(tgt, ch);
    if (sc && tc) {
      const sd = wp(sc).sub(wp(p.s)).normalize(), td = wp(tc).sub(wp(p.t)).normalize();
      if (sd.lengthSq() > 0 && td.lengthSq() > 0) align.setFromUnitVectors(td, sd);
    }
    rest.set(p.t, { sBind: wq(p.s), tBind: wq(p.t), align });
  }
  const srcOf = new Map(pairs.map(p => [p.t, p.s] as const));
  // Target bones in parent-before-child order, with their rest local rotations.
  const tBones: THREE.Bone[] = []; tgt.traverse(o => { if ((o as THREE.Bone).isBone) tBones.push(o as THREE.Bone); });
  const restLocal = new Map(tBones.map(b => [b, b.quaternion.clone()] as const));
  const sHips = boneBySuffix(srcModel, 'Hips'), tHips = boneBySuffix(tgt, 'Hips');
  const sHipY0 = sHips ? wp(sHips).y : 1, tHipY0 = tHips ? wp(tHips).y : 1;
  const tHipPos0 = tHips ? tHips.position.clone() : new THREE.Vector3();

  const mixer = new THREE.AnimationMixer(srcModel);
  const out = {} as Record<ClipName, THREE.AnimationClip>;
  const world = new Map<THREE.Object3D, THREE.Quaternion>();
  const tmp = new THREE.Quaternion(), inv = new THREE.Quaternion();
  for (const k of CLIP_NAMES) {
    const clip = srcClips[k]; if (!clip) continue;
    mixer.stopAllAction(); const action = mixer.clipAction(clip); action.reset().play();
    const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times: number[] = []; const vals = new Map(pairs.map(p => [p.t, [] as number[]] as const)); const hipVals: number[] = [];
    for (let f = 0; f < frames; f++) {
      const t = Math.min(clip.duration, f / fps); times.push(t);
      action.time = t; mixer.update(0); srcModel.updateMatrixWorld(true);
      world.clear();
      for (const b of tBones) {
        const parentW = b.parent && world.has(b.parent) ? world.get(b.parent)! : (b.parent ? wq(b.parent) : new THREE.Quaternion());
        const r = rest.get(b);
        let W: THREE.Quaternion;
        if (r) {
          // delta of the source bone from its rest, applied to the aligned target rest
          const delta = wq(srcOf.get(b)!).multiply(inv.copy(r.sBind).invert());
          W = delta.multiply(tmp.copy(r.align)).multiply(r.tBind);
          const local = inv.copy(parentW).invert().multiply(W);
          vals.get(b)!.push(local.x, local.y, local.z, local.w);
        } else W = parentW.clone().multiply(restLocal.get(b)!);
        world.set(b, W);
      }
      if (sHips && tHips) {
        // Vertical hip motion only, scaled by hip height (the game keeps fighters' x/z itself).
        const dy = (wp(sHips).y - sHipY0) * (tHipY0 / sHipY0);
        const pq = tHips.parent ? wq(tHips.parent).invert() : new THREE.Quaternion();
        const ps = tHips.parent ? tHips.parent.getWorldScale(new THREE.Vector3()) : new THREE.Vector3(1, 1, 1);
        const d = new THREE.Vector3(0, dy, 0).applyQuaternion(pq).divide(ps);
        hipVals.push(tHipPos0.x + d.x, tHipPos0.y + d.y, tHipPos0.z + d.z);
      }
    }
    const tracks: THREE.KeyframeTrack[] = pairs.map(p => new THREE.QuaternionKeyframeTrack(p.t.name + '.quaternion', times, vals.get(p.t)!));
    if (tHips && hipVals.length) tracks.push(new THREE.VectorKeyframeTrack(tHips.name + '.position', times, hipVals));
    out[k] = new THREE.AnimationClip(k, clip.duration, tracks);
  }
  mixer.stopAllAction();
  return out;
}
