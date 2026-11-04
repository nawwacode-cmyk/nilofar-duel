import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CLIP_NAMES, type ClipName } from '../core/types';

const loader = new FBXLoader();

export async function getBytes(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export const loadFbx = async (url: string) => loader.parse((await getBytes(url)).buffer as ArrayBuffer, '');

/** Shared animation clips (Mixamo), loaded once and retargeted per fighter. */
export const clips = {} as Record<ClipName, THREE.AnimationClip>;

/** Keeps rotations + vertical hip motion only, so animations never move the fighter on the floor. */
function cleanClip(clip: THREE.AnimationClip) {
  clip.tracks = clip.tracks.filter(t => t.name.endsWith('.quaternion') || /Hips\.position$/.test(t.name));
  for (const t of clip.tracks) if (/Hips\.position$/.test(t.name)) {
    const v = t.values, x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
  return clip;
}

export async function loadClips(onEach: () => void) {
  await Promise.all(CLIP_NAMES.map(k => loadFbx(`models/${k}.fbx`).then(o => { clips[k] = cleanClip(o.animations[0]); onEach(); })));
}

export function findBone(root: THREE.Object3D, re: RegExp): THREE.Bone | null {
  let f: THREE.Bone | null = null;
  root.traverse(o => { if (!f && (o as THREE.Bone).isBone && re.test(o.name)) f = o as THREE.Bone; });
  return f;
}

/** Clone of a shared clip with bone names matching this model's skeleton prefix. */
export function retarget(name: ClipName, model: THREE.Object3D) {
  const hips = findBone(model, /Hips$/);
  const pre = hips ? hips.name.replace(/Hips$/, '') : 'mixamorig';
  const cl = clips[name].clone();
  cl.tracks.forEach(t => { t.name = t.name.replace(/^mixamorig\d*:?/, pre); });
  return cl;
}
