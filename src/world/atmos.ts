import * as THREE from 'three';
import { scene } from '../render/stage';
import { emit } from '../render/particles';
import { getTier } from '../render/quality';
import { C, rnd } from '../core/util';

/**
 * Arena atmosphere on top of each arena's own ambience:
 * - light shafts: soft additive beams slanting along the key light (moon or sun), with slow drifting dust in them
 *   (a noise pattern scrolled in the shader), fading at the ends so no edge shows;
 * - floating motes lit by the beams.
 * Medium tier: two shafts and fewer motes; high: four shafts; low: none.
 */
const vert = `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const frag = `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv; varying vec3 vW;
float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  float across = sin(vUv.x * 3.14159);                 // soft sides
  float along = smoothstep(0., .25, vUv.y) * smoothstep(1., .55, vUv.y); // fades at the source and on the floor
  float dust = .55 + .45 * n(vec2(vUv.x * 6., vUv.y * 3. - uTime * .15)) * n(vW.xz * 1.7 + uTime * .05);
  gl_FragColor = vec4(uColor * across * across * along * dust * uAlpha, 1.);
}`;

interface Shaft { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }
const shafts: Shaft[] = [];
const group = new THREE.Group(); scene.add(group);
let preset: Preset | null = null, t = 0, acc = 0;

export interface Preset {
  /** Direction the light travels (from the source towards the floor). */
  dir: [number, number, number];
  /** Ground points where beams land (the first two are used on medium). */
  spots: [number, number][];
  color: number; alpha: number; width: number; length: number;
  motes: number; moteColor: [number, number, number];
}

export function setAtmosphere(p: Preset | null) {
  preset = p;
  for (const s of shafts) { group.remove(s.mesh); s.mesh.geometry.dispose(); s.mat.dispose(); }
  shafts.length = 0;
  const tier = getTier();
  if (!p || tier === 0) return;
  const d = new THREE.Vector3(...p.dir).normalize();
  const n = tier === 2 ? p.spots.length : Math.min(2, p.spots.length);
  for (let i = 0; i < n; i++) {
    const [x, z] = p.spots[i];
    const geo = new THREE.PlaneGeometry(p.width, p.length, 1, 1);
    geo.translate(0, p.length / 2, 0);  // v = 0 at the floor, 1 at the source
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(p.color) }, uTime: { value: Math.random() * 20 }, uAlpha: { value: p.alpha } } });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    // Lean the beam back towards the light source; two crossed planes read as a volume from any side.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate());
    const twin = mesh.clone(); twin.rotateY(Math.PI / 2);
    group.add(mesh, twin); shafts.push({ mesh, mat }, { mesh: twin, mat });
  }
}

export function updateAtmosphere(dt: number) {
  t += dt;
  for (const s of shafts) s.mat.uniforms.uTime.value = t;
  const p = preset; if (!p || getTier() === 0) return;
  // Motes per second, carried over between frames so slow rates still emit.
  acc += p.motes * (getTier() === 2 ? 1 : 0.5) * dt;
  while (acc >= 1) {
    acc -= 1;
    emit(rnd(7), 0.3 + Math.random() * 3.2, rnd(4) - 0.5, rnd(0.04), 0.03 + Math.random() * 0.05, rnd(0.04), C(...p.moteColor), 0.025 + Math.random() * 0.02, 7, { t: 'glow', a: 0.55, drag: 0.3 });
  }
}

/** Per arena: moonbeams through the court's arcades, moonlight over the terrace, sun shafts in the palace yard. */
export const ATMOS: Record<string, Preset> = {
  court: { dir: [0.35, -1, 0.35], spots: [[-3.5, -3.8], [3.8, -4.2], [-0.5, -5], [5.5, -1]], color: 0x5a78c8, alpha: 0.22, width: 1.6, length: 9, motes: 6, moteColor: [0.7, 0.8, 1.3] },
  terrace: { dir: [-0.6, -1, -0.8], spots: [[-4, -3], [4.5, -3.6], [0, -4.4], [-7, -1.5]], color: 0x6a80d0, alpha: 0.16, width: 1.8, length: 10, motes: 5, moteColor: [0.75, 0.85, 1.3] },
  palace: { dir: [-0.45, -1, -0.4], spots: [[-4, -2.5], [3.5, -2.8], [0.2, -3.2], [6.5, -1]], color: 0xffd9a0, alpha: 0.13, width: 1.5, length: 11, motes: 8, moteColor: [1.4, 1.25, 0.95] },
};
