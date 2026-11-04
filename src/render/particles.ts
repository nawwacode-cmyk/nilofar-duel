import * as THREE from 'three';
import { scene } from './stage';
import { V, C, rnd, pick } from '../core/util';
import type { Palette } from '../core/types';

/** Tiles in the Kenney 8x3 particle atlas (models/fx.png). */
const TILE = { flame: [0, 1, 2, 3], smoke: [4, 5, 6], spark: [7, 8, 9], star: [10, 11], magic: [12, 13, 19], twirl: [14, 21], glow: [15, 23], ring: [16], flare: [17], scorch: [18], trace: [20], rune: [22] } as const;
export type Tile = keyof typeof TILE;

const fxTex = new THREE.TextureLoader().load('models/fx.png');

interface ParticleSystem {
  max: number; g: THREE.BufferGeometry; m: THREE.ShaderMaterial;
  A: { pos: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array; tile: Float32Array; rot: Float32Array };
  vel: Float32Array; life: Float32Array; maxL: Float32Array; grav: Float32Array; drag: Float32Array; rs: Float32Array; grow: Float32Array; a0: Float32Array;
  head: number;
}

/** Fixed-size ring buffer of point sprites; no allocation per particle. */
function makeSystem(max: number, additive: boolean): ParticleSystem {
  const g = new THREE.BufferGeometry();
  const A = { pos: new Float32Array(max * 3), col: new Float32Array(max * 3), size: new Float32Array(max), alpha: new Float32Array(max), tile: new Float32Array(max), rot: new Float32Array(max) };
  for (const [n, a, s] of [['position', A.pos, 3], ['color', A.col, 3], ['size', A.size, 1], ['alpha', A.alpha, 1], ['tile', A.tile, 1], ['rot', A.rot, 1]] as const)
    g.setAttribute(n, new THREE.BufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, map: { value: fxTex } }, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute float size,alpha,tile,rot;attribute vec3 color;varying vec3 vC;varying float vA,vT,vR;uniform float uScale;
    void main(){vC=color;vA=alpha;vT=tile;vR=rot;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=size*uScale/max(.1,-mv.z);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform sampler2D map;varying vec3 vC;varying float vA,vT,vR;
    void main(){vec2 p=gl_PointCoord-.5;float c=cos(vR),s=sin(vR);p=vec2(c*p.x-s*p.y,s*p.x+c*p.y)+.5;if(p.x<0.||p.y<0.||p.x>1.||p.y>1.)discard;
    vec2 uv=vec2((mod(vT,8.)+p.x)/8.,1.-(floor(vT/8.)+p.y)/3.);vec4 t=texture2D(map,uv);float a=t.a*t.r*vA;` +
      (additive ? `gl_FragColor=vec4(vC*a,1.);}` : `if(a<.01)discard;gl_FragColor=vec4(vC,a);}`),
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  return { max, g, m, A, vel: new Float32Array(max * 3), life: new Float32Array(max), maxL: new Float32Array(max), grav: new Float32Array(max), drag: new Float32Array(max), rs: new Float32Array(max), grow: new Float32Array(max), a0: new Float32Array(max), head: 0 };
}

export const ADD = makeSystem(6000, true);
export const SMK = makeSystem(900, false);

export interface EmitOpts { t?: Tile; smoke?: boolean | number; grav?: number; drag?: number; spin?: number; grow?: number; a?: number }

export function emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, size: number, life: number, o: EmitOpts = {}) {
  const S = o.smoke ? SMK : ADD; const i = S.head; S.head = (S.head + 1) % S.max; const k = i * 3, A = S.A;
  A.pos[k] = x; A.pos[k + 1] = y; A.pos[k + 2] = z; S.vel[k] = vx; S.vel[k + 1] = vy; S.vel[k + 2] = vz;
  A.col[k] = c.r; A.col[k + 1] = c.g; A.col[k + 2] = c.b;
  A.size[i] = size; S.life[i] = S.maxL[i] = life; S.grav[i] = o.grav || 0; S.drag[i] = o.drag || 0;
  A.tile[i] = pick(TILE[o.t || 'glow']); A.rot[i] = Math.random() * 6.28; S.rs[i] = o.spin ?? rnd(2); S.grow[i] = o.grow || 0;
  S.a0[i] = o.a ?? 1; A.alpha[i] = S.a0[i];
}

function updSys(S: ParticleSystem, dt: number) {
  const A = S.A;
  for (let i = 0; i < S.max; i++) {
    if (S.life[i] <= 0) { A.alpha[i] = 0; continue; }
    S.life[i] -= dt; const k = i * 3; S.vel[k + 1] += S.grav[i] * dt;
    const dr = Math.max(0, 1 - S.drag[i] * dt); S.vel[k] *= dr; S.vel[k + 1] *= dr; S.vel[k + 2] *= dr;
    A.pos[k] += S.vel[k] * dt; A.pos[k + 1] += S.vel[k + 1] * dt; A.pos[k + 2] += S.vel[k + 2] * dt;
    if (A.pos[k + 1] < 0.02) { A.pos[k + 1] = 0.02; S.vel[k + 1] *= -0.25; }
    A.rot[i] += S.rs[i] * dt; A.size[i] += S.grow[i] * dt;
    const t = S.life[i] / S.maxL[i];
    A.alpha[i] = t > 0 ? S.a0[i] * Math.min(1, t * 2.2) * Math.min(1, (1 - t) * 14 + 0.15) : 0;
  }
  for (const n of ['position', 'color', 'size', 'alpha', 'tile', 'rot']) S.g.attributes[n].needsUpdate = true;
}

export function updateParticles(dt: number) { updSys(ADD, dt); updSys(SMK, dt); }
/** Keeps sprite size consistent with viewport height. */
export function setParticleScale(s: number) { ADD.m.uniforms.uScale.value = SMK.m.uniforms.uScale.value = s; }

export function burst(p: THREE.Vector3, pal: Palette, n = 60, sp = 3, life = 0.7, size = 0.12, t: Tile = 'spark') {
  for (let i = 0; i < n; i++) {
    const v = V().randomDirection().multiplyScalar(sp * (0.3 + Math.random() * 0.7));
    emit(p.x, p.y, p.z, v.x, v.y + 0.6, v.z, pick(pal), size * (0.5 + Math.random()), life * (0.5 + Math.random() * 0.7), { t, grav: -3, drag: 1.5 });
  }
}

export function explosion(p: THREE.Vector3, pal: Palette, big = 1) {
  for (let i = 0; i < 14 * big; i++) { const v = V().randomDirection().multiplyScalar(1.5 * big); emit(p.x, p.y, p.z, v.x, v.y * 0.6 + 0.5, v.z, pick(pal), 0.3 * big + Math.random() * 0.25, 0.45 + Math.random() * 0.3, { t: 'flame', drag: 3, grow: 0.5 }); }
  for (let i = 0; i < 8 * big; i++) { const v = V().randomDirection().multiplyScalar(0.8); emit(p.x, p.y, p.z, v.x, v.y * 0.3 + 0.6, v.z, C(0.12, 0.12, 0.16), 0.8 * big, 1.4 + Math.random(), { t: 'smoke', smoke: 1, drag: 1.2, grow: 1, a: 0.55, spin: rnd(0.6) }); }
  burst(p, pal, 50 * big, 5 * big, 0.6, 0.18);
  emit(p.x, p.y, p.z, 0, 0, 0, pal[2], 0.8 * big, 0.2, { t: 'flare', spin: 0 });
  emit(p.x, 0.05, p.z, 0, 0, 0, pal[1], 0.4, 0.35, { t: 'ring', spin: 0, grow: 4 * big });
}
