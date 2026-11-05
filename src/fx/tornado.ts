import * as THREE from 'three';

/**
 * A believable tornado funnel (the technique popularised in three.js courses for smoke and twisters): an open
 * cylinder bent into a funnel (narrow at the ground, wide at the top) that sways, textured by scrolling fractal
 * noise in a shader so the walls look like twisting dust and air rather than a solid cone. Two layers spinning at
 * different speeds give it depth. Pair it with particles at the base (dust, debris).
 */
const vert = `
uniform float uTime; uniform float uSpin;
varying vec2 vUv; varying float vH;
void main() {
  vUv = uv; float h = uv.y; vH = h;
  vec3 p = position;
  // Funnel: thin near the ground, opening towards the sky, with a lazy S-shaped sway that travels up.
  float r = mix(0.16, 1.0, pow(h, 1.35));
  p.xz *= r;
  p.x += sin(h * 3.2 + uTime * 2.1) * 0.28 * h;
  p.z += cos(h * 2.7 + uTime * 1.7) * 0.22 * h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const frag = `
uniform float uTime; uniform float uSpin; uniform float uOpacity; uniform vec3 uDark; uniform vec3 uLight;
varying vec2 vUv; varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  // Streaks wrap around the funnel (x) and climb (y) while it spins.
  vec2 q = vec2(vUv.x * 6.0 + vUv.y * 2.2 - uTime * uSpin, vUv.y * 3.0 - uTime * 0.9);
  float n = fbm(q * vec2(1.0, 2.6));
  float a = smoothstep(0.42, 0.78, n);
  a *= smoothstep(0.0, 0.12, vH) * (1.0 - smoothstep(0.82, 1.0, vH)); // soft at the ground and the top
  vec3 col = mix(uDark, uLight, n);
  gl_FragColor = vec4(col, a * uOpacity);
}`;

export interface Twister { group: THREE.Group; update(dt: number, opacity: number): void; dispose(): void }

/** A funnel `height` metres tall whose top is `width` metres across. */
export function makeTwister(height = 3.2, width = 1.5, dark = new THREE.Color(0.32, 0.38, 0.45), light = new THREE.Color(0.86, 0.93, 1)): Twister {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 24, true);
  geo.translate(0, 0.5, 0);
  const layers = [{ spin: 1.6, s: 1, o: 0.85 }, { spin: 2.6, s: 0.72, o: 0.7 }].map(L => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: Math.random() * 10 }, uSpin: { value: L.spin }, uOpacity: { value: 0 }, uDark: { value: dark }, uLight: { value: light } },
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(width * 0.5 * L.s, height, width * 0.5 * L.s);
    group.add(m);
    return { mat, o: L.o };
  });
  return {
    group,
    update(dt, opacity) { for (const l of layers) { l.mat.uniforms.uTime.value += dt; l.mat.uniforms.uOpacity.value = opacity * l.o; } },
    dispose() { geo.dispose(); for (const l of layers) l.mat.dispose(); },
  };
}
