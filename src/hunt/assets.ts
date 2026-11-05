import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gunzipSync } from 'fflate';
import { packFile } from '../assets/packs';
import { parseNav, type Nav } from './nav';

/**
 * Files of the Hunters pack. They come from the device (IndexedDB, see assets/packs.ts); with ?debug&huntsrc=<url>
 * they are fetched from that folder instead (development: the unpacked files, no download needed).
 */
const PACK = 'hunters';
const src = new URLSearchParams(location.search).get('huntsrc');

async function bytes(name: string) {
  let b: Uint8Array;
  if (src && new URLSearchParams(location.search).has('debug')) {
    const r = await fetch(src.replace(/\/?$/, '/') + name); if (!r.ok) throw new Error(name + ' ' + r.status);
    b = new Uint8Array(await r.arrayBuffer());
  } else b = await packFile(PACK, name);
  return b.length > 2 && b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b;
}

const gltfs = new Map<string, Promise<GLTF>>();
/** A glTF of the pack, parsed once. */
export function packGltf(name: string): Promise<GLTF> {
  let p = gltfs.get(name);
  if (!p) {
    p = bytes(name + '.glb.gz').then(b => new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, ''));
    gltfs.set(name, p);
    p.catch(() => gltfs.delete(name));
  }
  return p;
}

export async function packNav(name: string): Promise<Nav> { return parseNav(await bytes(name + '.nav.gz')); }

type PackedClips = Record<string, { d: number; t: [string, 'q' | 'v', number[], number[]][] }>;
let animsP: Promise<Record<string, THREE.AnimationClip>> | null = null;
/** The monsters' Mixamo clips (ZombieWalk, MutantRoaring…), same packing as the wizards' anims.json. */
export function packClips() {
  animsP ??= bytes('anims.json.gz').then(b => {
    const packed = JSON.parse(new TextDecoder().decode(b)) as PackedClips, out: Record<string, THREE.AnimationClip> = {};
    for (const [k, c] of Object.entries(packed)) out[k] = new THREE.AnimationClip(k, c.d, c.t.map(([name, kind, times, values]) =>
      kind === 'q' ? new THREE.QuaternionKeyframeTrack(name, times, values) : new THREE.VectorKeyframeTrack(name, times, values)));
    return out;
  });
  return animsP;
}
