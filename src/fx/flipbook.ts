import * as THREE from 'three';
import { scene, camera } from '../render/stage';
import { getTier } from '../render/quality';

/**
 * Real simulated fire, explosions and smoke (Unity Labs "Free VFX image sequences & flipbooks", CC0) played as
 * camera-facing sprites that blend each frame into the next. Pooled: nothing is created during a fight.
 * - loops (torches, braziers): stay alive, cycle through the sheet;
 * - one-shots (explosions, impact smoke): play once, then return to the pool.
 */
interface Sheet { url: string; cols: number; rows: number; frames: number; additive: boolean; tex?: THREE.Texture }
export const SHEETS = {
  flame: { url: 'models/fx_flame.webp', cols: 16, rows: 4, frames: 64, additive: true },
  explosion: { url: 'models/fx_explosion.webp', cols: 5, rows: 5, frames: 25, additive: false },
  smoke: { url: 'models/fx_smoke.webp', cols: 8, rows: 8, frames: 64, additive: false },
} satisfies Record<string, Sheet>;
type SheetId = keyof typeof SHEETS;

const loader = new THREE.TextureLoader();
function tex(s: Sheet) {
  if (!s.tex) { s.tex = loader.load(s.url); s.tex.colorSpace = THREE.SRGBColorSpace; s.tex.generateMipmaps = false; s.tex.minFilter = THREE.LinearFilter; }
  return s.tex;
}

const vert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;
const frag = (additive: boolean) => `uniform sampler2D uMap; uniform float uFrame, uCols, uRows, uFrames, uAlpha; uniform vec3 uTint; varying vec2 vUv;
vec4 cell(float f){ float i = mod(f, uCols), j = floor(f / uCols); return texture2D(uMap, vec2((i + vUv.x) / uCols, 1. - (j + 1. - vUv.y) / uRows)); }
void main(){ float f0 = floor(uFrame); vec4 c = mix(cell(f0), cell(min(f0 + 1., uFrames - 1.)), uFrame - f0);
  ${additive ? 'gl_FragColor = vec4(c.rgb * uTint * uAlpha, 1.);' : 'if (c.a < .01) discard; gl_FragColor = vec4(c.rgb * uTint, c.a * uAlpha);'} }`;

interface Sprite { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; sheet: Sheet; t: number; dur: number; loop: boolean; on: boolean; rise: number }
const pool: Sprite[] = [];
const quad = new THREE.PlaneGeometry(1, 1);

function make(id: SheetId): Sprite {
  const s = SHEETS[id];
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag(s.additive), transparent: true, depthWrite: false,
    blending: s.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uMap: { value: tex(s) }, uFrame: { value: 0 }, uCols: { value: s.cols }, uRows: { value: s.rows }, uFrames: { value: s.frames }, uAlpha: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } },
  });
  const mesh = new THREE.Mesh(quad, mat); mesh.frustumCulled = false; mesh.renderOrder = 2;
  return { mesh, mat, sheet: s, t: 0, dur: 1, loop: false, on: false, rise: 0 };
}

/** A looping flame standing at (x, y, z) inside `parent` (an arena root, so it shows only with its arena). */
export function loopFlame(parent: THREE.Object3D, x: number, y: number, z: number, height: number) {
  const sp = make('flame');
  sp.loop = true; sp.on = true; sp.dur = 2.4 + Math.random() * 0.6; sp.t = Math.random() * sp.dur;
  sp.mesh.scale.set(height * 0.5, height, 1); sp.mesh.position.set(x, y + height * 0.42, z);
  parent.add(sp.mesh); loops.push(sp);
  return sp;
}
const loops: Sprite[] = [];

/** One-shot sheet at a point: explosion (size in metres), or a smoke puff tinted by the element. */
export function burstSheet(id: 'explosion' | 'smoke', x: number, y: number, z: number, size: number, dur = 0.9, tint?: THREE.Color) {
  if (getTier() === 0) return;
  let sp = pool.find(k => !k.on && k.sheet === SHEETS[id]);
  if (!sp) { if (pool.length >= 16) return; sp = make(id); pool.push(sp); scene.add(sp.mesh); }
  sp.on = true; sp.t = 0; sp.dur = dur; sp.loop = false; sp.mesh.visible = true; sp.rise = id === 'smoke' ? 0.6 : 0.25;
  sp.mesh.position.set(x, y, z); sp.mesh.scale.set(size, size, 1);
  sp.mat.uniforms.uTint.value.copy(tint ?? new THREE.Color(1, 1, 1));
}

export function updateFlipbooks(dt: number) {
  const tier = getTier();
  for (const sp of loops) {
    sp.mesh.visible = tier > 0;
    if (!sp.mesh.visible) continue;
    sp.t = (sp.t + dt) % sp.dur;
    sp.mat.uniforms.uFrame.value = (sp.t / sp.dur) * (sp.sheet.frames - 1);
    sp.mesh.quaternion.copy(camera.quaternion);
  }
  for (const sp of pool) {
    if (!sp.on) continue;
    sp.t += dt; const k = sp.t / sp.dur;
    if (k >= 1) { sp.on = false; sp.mesh.visible = false; continue; }
    sp.mat.uniforms.uFrame.value = k * (sp.sheet.frames - 1);
    sp.mat.uniforms.uAlpha.value = Math.min(1, (1 - k) * 4);
    sp.mesh.position.y += sp.rise * dt;
    sp.mesh.quaternion.copy(camera.quaternion);
  }
}

/** While the flipbook flames are shown (medium/high), the old sprite flames are skipped. */
export const flipFlames = () => getTier() > 0;
