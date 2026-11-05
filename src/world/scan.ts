import * as THREE from 'three';
import { renderer } from '../render/stage';
import { getBytes } from '../assets/loader';

/**
 * Loads a photogrammetry arena shrunk by tools/decim-scan.mjs: models/<name>.bin.gz plus <name>_<i>_{2k,4k}.webp.
 * .bin: [u32 header length][JSON header][pad to 4][u16 positions][u16 uvs][i8 normals]; header groups map
 * triangle ranges to materials (a texture atlas or a flat colour). `tint` darkens/colours the textures (night).
 */
export async function loadScan(name: string, tint = 0xffffff) {
  const bin = await getBytes(`models/${name}.bin.gz`);
  const dv = new DataView(bin.buffer, bin.byteOffset); const hl = dv.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(bin.subarray(4, 4 + hl))) as {
    n: number; lo: number[]; sc: number[]; uv: [number, number]; groups: { start: number; count: number; mat: number }[]; mats: { tex?: number; color?: number[] }[];
  };
  let o = 4 + hl; o += (4 - (o % 4)) % 4; const n = h.n;
  const q = new Uint16Array(bin.buffer, bin.byteOffset + o, n * 3); o += n * 6;
  const uq = new Uint16Array(bin.buffer, bin.byteOffset + o, n * 2); o += n * 4;
  const nq = new Int8Array(bin.buffer, bin.byteOffset + o, n * 3);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) { pos[i * 3 + k] = h.lo[k] + q[i * 3 + k] * h.sc[k]; nor[i * 3 + k] = nq[i * 3 + k] / 127; }
    uv[i * 2] = h.uv[0] + (uq[i * 2] / 65535) * h.uv[1]; uv[i * 2 + 1] = h.uv[0] + (uq[i * 2 + 1] / 65535) * h.uv[1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  h.groups.forEach(gr => g.addGroup(gr.start, gr.count, gr.mat));

  // Phones get 2k atlases; large screens with big textures get 4k.
  const big = renderer.capabilities.maxTextureSize >= 8192 && !matchMedia('(pointer: coarse)').matches;
  const texIds = [...new Set(h.mats.filter(m => m.tex !== undefined).map(m => m.tex!))];
  const loader = new THREE.TextureLoader();
  const tex = new Map(await Promise.all(texIds.map(async i => {
    const t = await loader.loadAsync(`models/${name}_${i}_${big ? '4k' : '2k'}.webp`);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return [i, t] as const;
  })));
  // The scans' photos already hold their real light, so scene lights only add soft shading on top.
  const mats = h.mats.map(m => m.tex !== undefined
    ? new THREE.MeshLambertMaterial({ map: tex.get(m.tex), color: tint, side: THREE.DoubleSide })
    : new THREE.MeshLambertMaterial({ color: new THREE.Color(...(m.color as [number, number, number])).multiply(new THREE.Color(tint)), side: THREE.DoubleSide }));
  const mesh = new THREE.Mesh(g, mats);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  return mesh;
}

/** A canvas radial gradient used by fog banks. */
let fogTex: THREE.CanvasTexture | null = null;
function fogTexture() {
  if (fogTex) return fogTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!; const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#ffffffff'); gr.addColorStop(0.45, '#ffffffaa'); gr.addColorStop(1, '#ffffff00');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  fogTex = new THREE.CanvasTexture(c); return fogTex;
}

/**
 * Soft fog banks hiding where a scan simply ends (cut walls, holes, missing roofs): a few overlapping,
 * camera-facing puffs per spot. `spots` are [x, y, z, size].
 */
export function fogBanks(root: THREE.Object3D, spots: [number, number, number, number][], color: number, opacity: number) {
  const mat = new THREE.SpriteMaterial({ map: fogTexture(), color, transparent: true, opacity, depthWrite: false, fog: false });
  for (const [x, y, z, s] of spots) {
    for (let k = 0; k < 3; k++) {
      const sp = new THREE.Sprite(mat);
      sp.position.set(x + (k - 1) * s * 0.35, y + (k % 2) * s * 0.15, z + (k - 1) * 0.3);
      sp.scale.set(s * (1.1 + k * 0.15), s * 0.8, 1);
      sp.renderOrder = 2; root.add(sp);
    }
  }
}
