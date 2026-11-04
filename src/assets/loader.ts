import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CLIP_NAMES, type ClipName } from '../core/types';
import { fetchBytes, fetchJson } from './net';

const loader = new FBXLoader();

/** Bytes of a (possibly gzipped) file, with progress and retries — see net.ts. */
export const getBytes = fetchBytes;

export async function loadFbx(url: string, expect = 0) {
  const b = await fetchBytes(url, expect);
  return loader.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, '');
}

/** Shared animation clips (Mixamo), loaded once and retargeted per fighter. */
export const clips = {} as Record<ClipName, THREE.AnimationClip>;

/** anims.json (built by tools/pack-anims.mjs): per clip a duration and [trackName, 'q'|'v', times, values]. */
type PackedClips = Record<ClipName, { d: number; t: [string, 'q' | 'v', number[], number[]][] }>;

/**
 * Loads all animation clips from one packed file (~0.3 MB over the network instead of ~7 MB of FBX).
 * The packing already keeps rotations + vertical hip motion only, so animations never move fighters on the floor.
 */
export async function loadClips() {
  const packed = await fetchJson<PackedClips>('models/anims.json', 300_000);
  for (const k of CLIP_NAMES) {
    const c = packed[k];
    clips[k] = new THREE.AnimationClip(k, c.d, c.t.map(([name, kind, times, values]) =>
      kind === 'q' ? new THREE.QuaternionKeyframeTrack(name, times, values) : new THREE.VectorKeyframeTrack(name, times, values)));
  }
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
