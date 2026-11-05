import * as THREE from 'three';
import { camera } from '../render/stage';

/**
 * Abed's tornado: real simulated footage ("Tornado Sand 01 - Front", CGHEVEN, free licence) baked into a flipbook
 * (8 × 6 frames, 144 × 288 each: the twister forming from the ground, then standing and twisting). It is drawn on a
 * plane that always turns to the camera, blending each frame into the next so the motion stays smooth.
 * Fetched only when Abed is in a match; until it has arrived the shader funnel (fx/tornado.ts) stands in.
 */
const COLS = 8, ROWS = 6, FRAMES = COLS * ROWS;
let tex: THREE.Texture | null = null, loading: Promise<void> | null = null;

export function ensureTornadoModel() {
  loading ??= new THREE.TextureLoader().loadAsync('models/fx_tornado.webp')
    .then(t => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; tex = t; })
    .catch(e => { console.warn('tornado flipbook', e); loading = null; });
  return loading;
}

const vert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const frag = `
uniform sampler2D uMap; uniform float uFrame; uniform float uOpacity; uniform vec3 uTint;
varying vec2 vUv;
vec4 cell(float f) {
  float i = mod(f, ${COLS.toFixed(1)}), j = floor(f / ${COLS.toFixed(1)});
  vec2 uv = vec2((i + vUv.x) / ${COLS.toFixed(1)}, 1.0 - (j + 1.0 - vUv.y) / ${ROWS.toFixed(1)});
  return texture2D(uMap, uv);
}
void main() {
  float f0 = floor(uFrame), k = uFrame - f0;
  vec4 c = mix(cell(f0), cell(min(f0 + 1.0, ${(FRAMES - 1).toFixed(1)})), k);
  gl_FragColor = vec4(c.rgb * uTint, c.a * uOpacity);
}`;

export interface TornadoModel { group: THREE.Group; update(dt: number, opacity: number): void; dispose(): void }

/** A tornado `height` metres tall standing on the ground, or null while the flipbook is still downloading. */
export function makeTornadoModel(height = 4.4, life = 3.6): TornadoModel | null {
  if (!tex) return null;
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uMap: { value: tex }, uFrame: { value: 0 }, uOpacity: { value: 0 }, uTint: { value: new THREE.Color(0.55, 0.52, 0.5) } },
  });
  const geo = new THREE.PlaneGeometry(height * 0.5, height); geo.translate(0, height / 2 - 0.05, 0);
  const plane = new THREE.Mesh(geo, mat); plane.renderOrder = 2; plane.frustumCulled = false;
  const group = new THREE.Group(); group.add(plane);
  let t = 0;
  return {
    group,
    update(dt, opacity) {
      t += dt;
      // Forms quickly from the ground (the footage's first third), then keeps twisting.
      mat.uniforms.uFrame.value = Math.min(FRAMES - 1, (FRAMES - 1) * Math.pow(Math.min(1, t / life), 0.75));
      mat.uniforms.uOpacity.value = opacity;
      // Turn to the camera around the vertical axis only, so it stays upright.
      group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
