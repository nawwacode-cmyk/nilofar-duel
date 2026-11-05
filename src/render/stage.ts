import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { $ } from '../core/util';

/** Renderer, scene, camera and post-processing chain. */
export const renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('c'), antialias: false, powerPreference: 'high-performance' });
export const DPR = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070b18);
scene.fog = new THREE.FogExp2(0x0b1430, 0.028);

export const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 120);

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.65, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/**
 * Final cinematic grade (runs after tone mapping, in display space):
 * gentle S-curve contrast, cool shadows / warm highlights split-tone, vignette,
 * a red edge pulse when the local player is in danger, and a white flash for big impacts.
 */
export const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.38 }, uDanger: { value: 0 }, uFlash: { value: 0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float uVig,uDanger,uFlash,uSat;uniform vec3 uLift,uGain;varying vec2 vUv;
  void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 col=c.rgb;
    float l=dot(col,vec3(.2126,.7152,.0722));
    col=mix(col,col*col*(3.-2.*col),.28);
    col+=mix(vec3(-.012,.0,.03),vec3(.035,.018,-.02),smoothstep(.15,.75,l));
    col=col*uGain+uLift*(1.-col);
    col=mix(vec3(dot(col,vec3(.2126,.7152,.0722))),col,uSat);
    vec2 q=vUv-.5;float r=dot(q,q);
    col*=1.-uVig*smoothstep(.12,.55,r);
    col=mix(col,vec3(.55,0.,0.),uDanger*smoothstep(.1,.5,r)*.55);
    col+=uFlash;
    gl_FragColor=vec4(clamp(col,0.,1.),c.a);}`,
});
composer.addPass(grade);

/** Soft round contact shadow used under each fighter. */
export const BLOB = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

/** Sky/ground ambient; each arena sets its own colours (see world/arena.ts). */
export const hemi = new THREE.HemisphereLight(0x6a80c0, 0x10121a, 1.05);
scene.add(hemi);

/** Moonlight: the only shadow caster. The shadow frustum covers the fighting area only. */
export const moon = new THREE.DirectionalLight(0x9db4ff, 1.15);
moon.position.set(-4, 12, 3);
moon.target.position.set(0, 0, -1);
moon.shadow.camera.left = -7; moon.shadow.camera.right = 7; moon.shadow.camera.top = 6; moon.shadow.camera.bottom = -6;
moon.shadow.camera.near = 2; moon.shadow.camera.far = 30;
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.02;
scene.add(moon, moon.target);

/** Cool back-light from behind the arena, outlining the wizards against the dark courtyard. */
export const rim = new THREE.DirectionalLight(0x8fb0ff, 0.9);
rim.position.set(1.5, 4, -8);
scene.add(rim);
