// Packs the Mixamo animation FBX files in assets-src/anims (~7 MB) into one compact JSON (public/play/models/anims.json).
// Same processing as the game used at runtime (cleanClip): rotations + vertical hip motion only.
// Values are rounded (4 decimals for quaternions, 3 for hip height, 4 for times) — invisible at game scale.
// Run: node tools/pack-anims.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const NAMES = ['idle', 'bolt', 'beam', 'special', 'hit', 'death', 'block', 'evade', 'walkF', 'walkB', 'walkL', 'walkR', 'punch', 'kick', 'hook', 'shoved'];
const loader = new FBXLoader();
const r = (v, d) => Math.round(v * d) / d;
const out = {};
let before = 0;
for (const n of NAMES) {
  const buf = readFileSync(`assets-src/anims/${n}.fbx`); before += buf.length;
  const obj = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), '');
  const clip = obj.animations[0];
  const tracks = [];
  for (const t of clip.tracks) {
    const hips = /Hips\.position$/.test(t.name);
    if (!t.name.endsWith('.quaternion') && !hips) continue;
    const v = Array.from(t.values);
    if (hips) { const x0 = v[0], z0 = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; } }
    // Drop tracks that never move (one key is enough).
    const stride = hips ? 3 : 4; let still = true;
    for (let i = stride; i < v.length && still; i++) if (Math.abs(v[i] - v[i % stride]) > 1e-4) still = false;
    const times = still ? [0] : Array.from(t.times).map(x => r(x, 1e4));
    const vals = (still ? v.slice(0, stride) : v).map(x => r(x, hips ? 1e3 : 1e4));
    tracks.push([t.name.replace(/^mixamorig\d*:?/, 'mixamorig'), hips ? 'v' : 'q', times, vals]);
  }
  out[n] = { d: r(clip.duration, 1e4), t: tracks };
}
const json = JSON.stringify(out);
writeFileSync('public/play/models/anims.json', json);
console.log(`FBX ${(before / 1048576).toFixed(2)} MB -> JSON ${(json.length / 1048576).toFixed(2)} MB (gzip ${(gzipSync(json).length / 1048576).toFixed(2)} MB)`);
