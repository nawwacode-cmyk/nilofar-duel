// Shared helpers for photogrammetry arenas (Sketchfab GLB scans): read every primitive in world space.
import { readFileSync } from 'node:fs';

const CT = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function readGlb(path) {
  const b = readFileSync(path);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString());
  const bl = b.readUInt32LE(20 + jl);
  const bin = b.subarray(28 + jl, 28 + jl + bl);
  return { json, bin };
}

export function accessor({ json, bin }, i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = NC[a.type], T = CT[a.componentType];
  const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 0, size = T.BYTES_PER_ELEMENT * n;
  const out = new (T === Float32Array ? Float32Array : T)(a.count * n);
  if (!stride || stride === size) out.set(new T(bin.buffer.slice(off, off + a.count * size)));
  else for (let k = 0; k < a.count; k++) out.set(new T(bin.buffer.slice(off + k * stride, off + k * stride + size)), k * n);
  return out;
}

const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

/** Every triangle primitive with world-space positions, uvs (if any), indices and material index. */
export function primitives(glb) {
  const { json } = glb, out = [];
  const walk = (ni, parent) => {
    const n = json.nodes[ni], m = mul(parent, local(n));
    if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
      const pos = accessor(glb, p.attributes.POSITION), w = new Float32Array(pos.length);
      for (let k = 0; k < pos.length; k += 3) {
        const x = pos[k], y = pos[k + 1], z = pos[k + 2];
        w[k] = m[0] * x + m[4] * y + m[8] * z + m[12]; w[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; w[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const uv = p.attributes.TEXCOORD_0 !== undefined ? accessor(glb, p.attributes.TEXCOORD_0) : null;
      // Normals rotated by the node's matrix (no non-uniform scale in these scenes) and renormalised.
      let nor = null;
      if (p.attributes.NORMAL !== undefined) {
        const n = accessor(glb, p.attributes.NORMAL); nor = new Float32Array(n.length);
        for (let k = 0; k < n.length; k += 3) {
          const x = n[k], y = n[k + 1], z = n[k + 2];
          const nx = m[0] * x + m[4] * y + m[8] * z, ny = m[1] * x + m[5] * y + m[9] * z, nz = m[2] * x + m[6] * y + m[10] * z;
          const L = Math.hypot(nx, ny, nz) || 1; nor[k] = nx / L; nor[k + 1] = ny / L; nor[k + 2] = nz / L;
        }
      }
      const idx = p.indices !== undefined ? accessor(glb, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      out.push({ pos: w, uv, nor, idx, material: p.material ?? -1 });
    }
    for (const c of n.children || []) walk(c, m);
  };
  for (const r of json.scenes[json.scene || 0].nodes) walk(r, ID);
  return out;
}
