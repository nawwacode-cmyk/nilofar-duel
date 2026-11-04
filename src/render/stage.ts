import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
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

/** Soft round contact shadow used under each fighter. */
export const BLOB = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

scene.add(new THREE.HemisphereLight(0x6a80c0, 0x10121a, 1.2));
export const moon = new THREE.DirectionalLight(0x9db4ff, 0.8);
moon.position.set(-4, 12, -3);
scene.add(moon);
