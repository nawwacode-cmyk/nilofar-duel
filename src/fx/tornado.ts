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

/**
 * The tornado's body in 3D: a few hundred soft dust puffs orbiting a centre on a rising helix (narrow and fast at the
 * ground, wide and slower above), so the funnel really wraps around whoever stands in it — puffs pass in front of
 * and behind them as the camera sees it.
 */
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.45, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  // Grain, so puffs read as dust rather than balls.
  const d = x.getImageData(0, 0, 64, 64);
  for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] *= 0.65 + Math.random() * 0.35;
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let puffTex: THREE.Texture | null = null;

export interface Vortex { group: THREE.Group; update(dt: number, opacity: number, grow: number): void; dispose(): void }

export function makeVortex(height = 3.8, count = 240): Vortex {
  puffTex ??= puffTexture();
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const st = Array.from({ length: count }, (_, i) => ({ h: Math.random(), a: Math.random() * Math.PI * 2, j: 0.8 + Math.random() * 0.5, i }));
  const base = [new THREE.Color(0.52, 0.47, 0.4), new THREE.Color(0.7, 0.66, 0.6), new THREE.Color(0.38, 0.35, 0.31)];
  st.forEach((_, i) => { const c = base[i % 3]; col.set([c.r, c.g, c.b], i * 3); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.9, map: puffTex, vertexColors: true, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 3;
  const group = new THREE.Group(); group.add(pts);
  let t = 0;
  return {
    group,
    update(dt, opacity, grow) {
      t += dt;
      for (const s of st) {
        // Rise; when at the top, start again at the ground.
        s.h += dt * 0.32 * s.j; if (s.h > 1) s.h -= 1;
        const r = (0.28 + Math.pow(s.h, 1.3) * 1.05) * grow * s.j;
        s.a += dt * (7.5 - s.h * 4.5) * s.j;
        const sway = Math.sin(s.h * 3 + t * 1.7) * 0.18 * s.h;
        pos[s.i * 3] = Math.cos(s.a) * r + sway; pos[s.i * 3 + 1] = s.h * height * grow; pos[s.i * 3 + 2] = Math.sin(s.a) * r;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = opacity * 0.55; mat.size = 0.55 + grow * 0.6;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
