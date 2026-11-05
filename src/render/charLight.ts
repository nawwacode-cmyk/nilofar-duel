import * as THREE from 'three';
import { renderer, scene } from './stage';

/**
 * Character look: the wizards stop being flat cut-outs laid over the arena.
 * - Their old Phong materials (Mixamo FBX) become PBR (MeshStandard) with roughness/metal guessed from the
 *   source shininess and material names; Tripo GLBs already are PBR.
 * - Image-based lighting from the arena itself: when an arena is shown, it is rendered once into a prefiltered
 *   environment map (PMREM) from chest height, so cloth, skin and metal pick up the arena's own colours.
 * - A rim of light in the wizard's element colour (fresnel, added to emission) that flares while they cast.
 * Low tier: no environment map, softer rim.
 */
let tier: 0 | 1 | 2 = 2;
/** Bright daylight arenas need far less added rim and reflection than night ones. */
let daylight = false;
export function setDaylight(on: boolean) { daylight = on; for (const m of users) m.envMapIntensity = on ? 0.45 : 0.85; }
let env: THREE.Texture | null = null;
let pmrem: THREE.PMREMGenerator | null = null;
const users = new Set<THREE.MeshStandardMaterial>();

export function setCharTier(t: 0 | 1 | 2) {
  tier = t;
  for (const m of users) { m.envMap = t >= 1 ? env : null; m.needsUpdate = true; }
}

const METAL = /metal|armor|armour|sword|blade|buckle|gold|silver|iron|steel|chain|ring|clasp|crown/i;

/** Phong/Lambert → Standard, keeping maps and colours. PBR materials from generated models (Tripo) often come
 *  fully metallic and glossy, which looks like chrome under image lighting: they are toned to cloth-like values. */
export function toPBR(m: THREE.Material): THREE.Material {
  const p = m as THREE.MeshPhongMaterial;
  const sm = m as THREE.MeshStandardMaterial;
  if (sm.isMeshStandardMaterial) { sm.metalness = Math.min(sm.metalness, METAL.test(m.name) ? 0.6 : 0.2); sm.roughness = Math.max(sm.roughness, 0.5); return m; }
  if (!(p.isMeshPhongMaterial || (m as THREE.MeshLambertMaterial).isMeshLambertMaterial)) return m;
  const shin = p.shininess ?? 20;
  const metal = METAL.test(m.name) ? 0.65 : 0.04;
  const s = new THREE.MeshStandardMaterial({
    name: m.name, map: p.map, normalMap: p.normalMap, color: p.color.clone(), emissive: p.emissive?.clone() ?? new THREE.Color(0),
    emissiveMap: p.emissiveMap, alphaMap: p.alphaMap, transparent: p.transparent, opacity: p.opacity, alphaTest: p.alphaTest, side: p.side,
    roughness: THREE.MathUtils.clamp(1 - shin / 90, 0.42, 0.88), metalness: metal,
  });
  if (p.normalMap) s.normalScale.copy(p.normalScale);
  return s;
}

/** Adds the element rim to a (per-fighter) material; the returned uniforms drive colour and strength. */
export function addRim(m: THREE.MeshStandardMaterial, rim: { color: { value: THREE.Color }; strength: { value: number } }) {
  m.envMap = tier >= 1 ? env : null;
  m.envMapIntensity = daylight ? 0.45 : 0.85;
  users.add(m);
  m.onBeforeCompile = sh => {
    sh.uniforms.uRimColor = rim.color; sh.uniforms.uRimStrength = rim.strength;
    sh.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimStrength;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      { float f = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRimColor * (pow(f, 3.0) * uRimStrength); }`);
  };
  m.customProgramCacheKey = () => 'rim';
  m.needsUpdate = true;
}

export function releaseMaterial(m: THREE.Material) { users.delete(m as THREE.MeshStandardMaterial); }

/** Rim strength for this tier, plus a flare from the wand light while casting (light 1.4 at rest, up to ~30). */
export function rimStrength(wandLight: number) {
  const base = (tier === 0 ? 0.35 : 0.6) * (daylight ? 0.35 : 1);
  return base + Math.min(1.2, Math.max(0, wandLight - 1.4) / 18) * (daylight ? 0.4 : 1);
}

/**
 * Renders the visible arena into the environment map, seen from chest height at the duel's centre.
 * Everything else in the scene (fighters, particles, effects) is hidden for that one capture.
 */
export function captureArenaEnv(arenaRoot: THREE.Object3D) {
  pmrem ??= new THREE.PMREMGenerator(renderer);
  const hidden: THREE.Object3D[] = [];
  for (const o of scene.children) if (o !== arenaRoot && o.visible && !(o as THREE.Light).isLight) { o.visible = false; hidden.push(o); }
  const y0 = arenaRoot.position.y;
  arenaRoot.position.y = y0 - 1.3; arenaRoot.updateMatrixWorld(true);
  const rt = pmrem.fromScene(scene, 0.03, 0.1, 200);
  arenaRoot.position.y = y0; arenaRoot.updateMatrixWorld(true);
  hidden.forEach(o => { o.visible = true; });
  const old = env;
  env = rt.texture;
  for (const m of users) { m.envMap = tier >= 1 ? env : null; m.needsUpdate = true; }
  old?.dispose();
}
