import * as THREE from 'three';
import { scene, camera } from '../render/stage';
import { emit } from '../render/particles';
import { fx } from '../game/state';
import { headPos } from '../fighters/fighter';
import { rnd, pick } from '../core/util';
import type { Fighter, Palette, ShieldFx } from '../core/types';

/** Boosts the fighter's wand light (decays every frame in updChar). */
export function flash(c: Fighter, a: number) { c.light.intensity = Math.max(c.light.intensity, a); }

/** Floating damage / status text above a fighter's head. */
export function dmgText(c: Fighter, txt: string, col: string) {
  const p = headPos(c).project(camera);
  const el = document.createElement('div'); el.className = 'dmg'; el.style.color = col; el.textContent = txt;
  el.style.left = ((p.x + 1) / 2) * innerWidth + 'px'; el.style.top = ((1 - p.y) / 2) * innerHeight + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1200);
}

/** Hexagon-patterned bubble shield; fades in, flashes on hit, fades out after off(). */
export function shieldMesh(c: Fighter): ShieldFx {
  const col = c.pal[1].clone().multiplyScalar(0.9);
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uC: { value: col }, uO: { value: 0 }, uT: { value: 0 }, uHit: { value: 0 } },
    vertexShader: `varying vec3 vN;varying vec3 vV;varying vec3 vP;void main(){vP=position;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 uC;uniform float uO,uT,uHit;varying vec3 vN;varying vec3 vV;varying vec3 vP;
    void main(){float f=pow(1.-abs(dot(vN,vV)),2.2);float hex=abs(sin(vP.y*22.+uT*3.)*sin(atan(vP.z,vP.x)*14.));float l=smoothstep(.9,1.,hex)*.6;gl_FragColor=vec4(uC*(f*1.5+l*f+.04+uHit*.8)*uO,1.);}`,
  }));
  m.scale.set(0.8, 1.1, 0.8); scene.add(m);
  let off = false, t = 0;
  const u = (m.material as THREE.ShaderMaterial).uniforms;
  fx.push(dt => {
    t += dt; u.uT.value = t; u.uHit.value *= Math.pow(0.02, dt);
    u.uO.value = off ? Math.max(0, u.uO.value - dt * 5) : Math.min(1, u.uO.value + dt * 8);
    m.position.set(c.x, 1, c.z);
    if (Math.random() < 0.3) emit(c.x + rnd(0.7), 0.2 + Math.random() * 1.6, c.z + rnd(0.7), 0, 0.3, 0, pick(c.pal), 0.12, 0.4, { t: 'rune' });
    if (off && u.uO.value <= 0) { scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); return false; }
    return true;
  });
  return { hit() { u.uHit.value = 1; }, off() { off = true; } };
}

/** Fire portal ring that faces the camera (Reem's skill). */
export function portalRing(x: number, z: number, pal: Palette) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 10, 48), new THREE.MeshBasicMaterial({ color: pal[1].clone().multiplyScalar(1.6), toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.set(x, 1.05, z); m.scale.set(0.01, 0.01, 0.01); scene.add(m);
  let t = 0;
  const L = new THREE.PointLight(0xff8a3d, 0, 5, 1.5); L.position.set(x, 1, z); scene.add(L);
  fx.push(dt => {
    t += dt;
    const k = t < 0.25 ? t / 0.25 : t > 1.1 ? Math.max(0, 1 - (t - 1.1) / 0.3) : 1;
    m.scale.set(k, k * 1.5, k); m.quaternion.copy(camera.quaternion); L.intensity = 10 * k;
    for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28; emit(x + Math.cos(a) * 0.62 * k, 1.05 + Math.sin(a) * 0.93 * k, z, rnd(0.2), 0.3, rnd(0.2), pick(pal), 0.14, 0.4, { t: 'flame', drag: 1 }); }
    if (Math.random() < 0.5) emit(x, 1.05, z, 0, 0, 0, pal[0], 0.9 * k, 0.12, { t: 'twirl', spin: 5 });
    if (t > 1.4) { scene.remove(m, L); m.geometry.dispose(); return false; }
    return true;
  });
}

/** Runs and prunes all per-frame effects. */
export function updateFx(dt: number) { for (let i = fx.length - 1; i >= 0; i--) if (!fx[i](dt)) fx.splice(i, 1); }
