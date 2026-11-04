import * as THREE from 'three';

/** Typed getElementById; every id used by the game exists in web/play/index.html. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Uniform random in [-a, a]. */
export const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
export const pick = <T>(a: readonly T[]): T => a[(Math.random() * a.length) | 0];
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
/** Shortest signed angle from a to b. */
export const angleDelta = (from: number, to: number) => { const d = to - from; return Math.atan2(Math.sin(d), Math.cos(d)); };
