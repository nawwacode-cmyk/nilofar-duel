import * as THREE from 'three';
import { scene, renderer } from '../render/stage';
import { $ } from '../core/util';
import type { Fighter } from '../core/types';
import type { Nav } from './nav';
import type { Monster } from './monsters';

/**
 * Corner map. When a stage starts, the stage is rendered once straight from above (orthographic) and kept as an
 * image; every tenth of a second that image is drawn around the wizard, turned so the camera's view points up,
 * with the monsters (red), the gate (gold, pinned to the rim when far) and the wizard's arrow on top.
 */
let img: HTMLCanvasElement | null = null;
let area = { x0: 0, z0: 0, w: 1, d: 1 };
/** Metres from the centre of the map to its rim. */
const RANGE = 38;

export function buildMinimap(map: THREE.Object3D, nav: Nav, paths: [number, number][][] = []) {
  const w = nav.nx * nav.step, d = nav.nz * nav.step;
  area = { x0: nav.x0, z0: nav.z0, w, d };
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 1, 1200);
  cam.position.set(nav.x0 + w / 2, 500, nav.z0 + d / 2); cam.up.set(0, 0, -1); cam.lookAt(nav.x0 + w / 2, 0, nav.z0 + d / 2);
  const fog = scene.fog; scene.fog = null;
  // Only the stage itself: everything else in the scene is hidden for this one render.
  const hidden: THREE.Object3D[] = [];
  for (const o of scene.children) if (o !== map && o.visible && !(o as THREE.Light).isLight) { o.visible = false; hidden.push(o); }
  renderer.render(scene, cam);
  // Copy right away (same task), before the next frame clears the drawing buffer.
  const PPM = 3, c = document.createElement('canvas');
  c.width = Math.round(w * PPM); c.height = Math.round(d * PPM);
  const x = c.getContext('2d')!;
  x.drawImage(renderer.domElement, 0, 0, c.width, c.height);
  // A slight dark-cool grade so the dots read clearly on top of it.
  x.globalCompositeOperation = 'multiply'; x.fillStyle = '#8a8fa8'; x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'source-over';
  // The route as a faint gold line, so the way on is always readable.
  x.strokeStyle = '#f3cd7799'; x.lineWidth = 2.2 * PPM; x.lineJoin = x.lineCap = 'round';
  for (const p of paths) { x.beginPath(); p.forEach(([px, pz], k) => (k ? x.lineTo : x.moveTo).call(x, (px - nav.x0) * PPM, (pz - nav.z0) * PPM)); x.stroke(); }
  img = c;
  hidden.forEach(o => { o.visible = true; });
  scene.fog = fog;
}

export function drawMinimap(p: Fighter, yaw: number, mons: readonly Monster[], gate: THREE.Vector3 | null, mate: Fighter | null = null) {
  const cv = $<HTMLCanvasElement>('mini'); if (!img) return;
  const S = cv.width, x = cv.getContext('2d')!, k = S / 2 / RANGE;
  x.clearRect(0, 0, S, S);
  x.save();
  x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.clip();
  x.fillStyle = '#0b0d14'; x.fillRect(0, 0, S, S);
  // World → map: centred on the wizard, camera heading up.
  x.translate(S / 2, S / 2); x.rotate(yaw - Math.PI); x.scale(k, k); x.translate(-p.x, -p.z);
  x.drawImage(img, area.x0, area.z0, area.w, area.d);
  x.fillStyle = '#ff4d3d';
  for (const m of mons) {
    if (m.state === 'dead' || m.state === 'buried' || m.gone || Math.hypot(m.x - p.x, m.z - p.z) > RANGE * 1.1) continue;
    x.beginPath(); x.arc(m.x, m.z, (m.def.hp >= 200 ? 4.5 : 3) / k, 0, Math.PI * 2); x.fill();
  }
  // Wizards: arrows along their facing (the friend in blue, ours on top).
  const arrow = (f: Fighter, col: string) => {
    x.save(); x.translate(f.x, f.z); x.rotate(-f.ry); x.scale(1 / k, 1 / k);
    x.fillStyle = col; x.strokeStyle = '#000'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(0, 8); x.lineTo(5.5, -5); x.lineTo(0, -2); x.lineTo(-5.5, -5); x.closePath(); x.fill(); x.stroke();
    x.restore();
  };
  if (mate) arrow(mate, mate.dead ? '#888' : '#7cc8ff');
  arrow(p, '#fff3c4');
  x.restore();
  // Gate: on the map when close, otherwise pinned to the rim in its direction.
  if (gate) {
    const dx = gate.x - p.x, dz = gate.z - p.z, a = yaw - Math.PI;
    let gx = (dx * Math.cos(a) - dz * Math.sin(a)) * k, gy = (dx * Math.sin(a) + dz * Math.cos(a)) * k;
    const L = Math.hypot(gx, gy), max = S / 2 - 9;
    if (L > max) { gx *= max / L; gy *= max / L; }
    x.save(); x.translate(S / 2 + gx, S / 2 + gy); x.rotate(Math.PI / 4);
    x.fillStyle = '#f3cd77'; x.strokeStyle = '#000'; x.lineWidth = 1.5; x.fillRect(-5, -5, 10, 10); x.strokeRect(-5, -5, 10, 10);
    x.restore();
  }
}
