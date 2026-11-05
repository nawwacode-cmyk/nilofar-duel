import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { camera, composer } from './stage';

/**
 * Extra screen passes, chosen by quality tier:
 * - Anti-aliasing at the end of the chain: SMAA on high (best edges for the cost), FXAA on medium, none on low.
 * - Heat/shock distortion right after the scene render: up to four expanding rings (explosions, heavy impacts)
 *   bend the image like hot air or a pressure wave. Medium and high only.
 */
const MAX_WAVES = 4;
export const distort = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4(0, 0, -1, 0)) }, // x, y (uv), radius (uv), strength
    uAspect: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform vec4 uWaves[${MAX_WAVES}];uniform float uAspect;varying vec2 vUv;
  void main(){vec2 uv=vUv;
    for(int i=0;i<${MAX_WAVES};i++){vec4 w=uWaves[i];if(w.z<0.)continue;
      vec2 d=(vUv-w.xy)*vec2(uAspect,1.);float r=length(d);
      // A thin ring at radius w.z pushes pixels outward; inside it a softer shimmer (hot air).
      float ring=exp(-pow((r-w.z)*28.,2.));float haze=smoothstep(w.z,0.,r)*.25*sin(r*90.-w.z*60.);
      uv-=normalize(d+1e-5)/vec2(uAspect,1.)*w.w*(ring*.022+haze*.004);}
    gl_FragColor=texture2D(tDiffuse,uv);}`,
});

interface Wave { x: number; y: number; z: number; t: number; dur: number; size: number; strength: number }
const waves: Wave[] = [];
let enabled = true;
const tmp = new THREE.Vector3();

/** A pressure ring at a world point (size in metres it reaches, strength 0..1). */
export function shockDistort(x: number, y: number, z: number, size = 3, strength = 1, dur = 0.55) {
  if (!enabled) return;
  if (waves.length >= MAX_WAVES) waves.shift();
  waves.push({ x, y, z, t: 0, dur, size, strength });
}

export function updatePost(dt: number) {
  const u = distort.uniforms.uWaves.value as THREE.Vector4[];
  distort.uniforms.uAspect.value = camera.aspect;
  for (let i = waves.length - 1; i >= 0; i--) { waves[i].t += dt; if (waves[i].t >= waves[i].dur) waves.splice(i, 1); }
  for (let i = 0; i < MAX_WAVES; i++) {
    const w = waves[i];
    if (!w) { u[i].set(0, 0, -1, 0); continue; }
    tmp.set(w.x, w.y, w.z).project(camera);
    if (tmp.z > 1) { u[i].set(0, 0, -1, 0); continue; }
    // World size → screen radius (rough, from distance and the field of view).
    const dist = camera.position.distanceTo(new THREE.Vector3(w.x, w.y, w.z));
    const k = w.t / w.dur, worldR = w.size * (1 - Math.pow(1 - k, 2.2));
    const screenR = worldR / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(0.5, dist));
    u[i].set((tmp.x + 1) / 2, (tmp.y + 1) / 2, screenR, w.strength * (1 - k));
  }
  distort.enabled = enabled && waves.length > 0;
}

export const fxaa = new ShaderPass(FXAAShader);
export const smaa = new SMAAPass(1, 1);

/** Tier 0: no AA, no distortion. 1: FXAA + distortion. 2: SMAA + distortion. */
export function setPostTier(t: 0 | 1 | 2) {
  enabled = t >= 1;
  fxaa.enabled = t === 1;
  smaa.enabled = t === 2;
  if (!enabled) waves.length = 0;
}

export function resizePost(w: number, h: number, dpr: number) {
  fxaa.material.uniforms.resolution.value.set(1 / (w * dpr), 1 / (h * dpr));
  smaa.setSize(w * dpr, h * dpr);
}

// Distortion right after the scene render (bends the lit image before bloom); anti-aliasing last, on the final
// graded image.
composer.insertPass(distort, 1);
composer.addPass(fxaa);
composer.addPass(smaa);
