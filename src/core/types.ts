import type * as THREE from 'three';

export type Palette = readonly THREE.Color[];
export type GameState = 'load' | 'title' | 'menu' | 'online' | 'intro' | 'fight' | 'ko' | 'struggle' | 'end';
export type Mode = 'ai' | 'online' | 'train';

export type BoltKind = 'fire' | 'ice' | 'shadow' | 'spark' | 'gold';
export type ProjKind = BoltKind | 'meteor' | 'spear' | 'curse' | 'shmini' | 'orb' | 'gale';
export type SpecialKind = 'meteor' | 'spears' | 'curse' | 'thunder' | 'orbs' | 'gale';
export type SkillKind = 'portal' | 'wall' | 'clones' | 'blink' | 'veil' | 'army' | 'bloom' | 'thorns' | 'gust' | 'tornado';
/** Everything that can travel over the network as a "cast". */
export type CastKind = ProjKind | SkillKind | 'thunder' | 'melee';

export const CLIP_NAMES = ['idle', 'bolt', 'beam', 'special', 'hit', 'death', 'block', 'evade', 'walkF', 'walkB', 'walkL', 'walkR', 'punch', 'kick', 'hook', 'shoved'] as const;
export type ClipName = typeof CLIP_NAMES[number];

/** [label, name, description] shown in the character sheet. */
export type Ability = readonly [string, string, string];

export interface WizardDef {
  id: 'reem' | 'siraj' | 'layla' | 'qasem' | 'ehab' | 'sara' | 'abed';
  name: string;
  female: boolean;
  file: string;
  elem: string;
  hp: number;
  speed: number;
  pal: Palette;
  css: string;
  lc: number;
  bolt: { kind: BoltKind; cd: number };
  spec: SpecialKind;
  dodgeCost: number;
  snd: 'fire' | 'ice' | 'shadow' | 'bolt';
  cs: string;
  ss: string;
  stat: readonly [number, number, number];
  story: string;
  ab: readonly [Ability, Ability, Ability];
  /** Material Symbols ligature for the element. */
  icon: string;
  skill: { k: SkillKind; cost: number; cd: number };
  /** Optional fourth ability with its own button (Ehab, the archmage). */
  skill2?: { k: SkillKind; cost: number; cd: number }; ab2?: Ability;
  /** Model format: Mixamo FBX (default) or a Tripo-rigged GLB whose animations are retargeted at load. */
  rig?: 'tripo';
}

export interface ShieldFx { hit(): void; off(): void }

export interface Fighter {
  R: WizardDef; ri: number; idx: 0 | 1;
  root: THREE.Group; model: THREE.Object3D; pal: Palette; hex: string;
  mixer: THREE.AnimationMixer; actions: Partial<Record<ClipName, THREE.AnimationAction>>;
  hand: THREE.Bone | null; chestB: THREE.Bone | null; headB: THREE.Bone | null;
  wand: THREE.Group; light: THREE.PointLight; blob: THREE.Mesh;
  /** Mirror match: colour multiplier of the second fighter's "shadow" costume (also used for his illusions). */
  tint?: THREE.Color;
  cur: THREE.AnimationAction | null; curName?: ClipName;
  x: number; z: number; vx: number; vz: number; ry: number;
  hp: number; mana: number;
  cdA: number; cdD: number; cdS: number; cdK: number; cdK2: number;
  castT: number; hitT: number; slowT: number; stunT: number; invT: number; warpT: number; dodgeT: number;
  shieldT: number; shieldOn: boolean; shHP: number; shield: ShieldFx | null; wantShield: boolean;
  dodgeDir: THREE.Vector3; dead: boolean; inX: number; inZ: number; stepAcc: number;
  wins: number; warpTo: [number, number] | null;
  /** Hit feel: material flash 0..1, knock-back time left, per-fighter cloned materials. */
  hitFlash: number; knockT: number; mats: THREE.MeshPhongMaterial[];
  /** Lost track of the opponent (e.g. they vanished into a portal): cannot turn while > 0. */
  turnLockT: number;
  /** Ehab's veil: invisible to the opponent while > 0 (broken by casting). */
  veilT: number; alpha?: number;
  /** Online, remote fighter only: last HP confirmed by its owner and our not-yet-confirmed predicted hits. */
  authHp: number; pend: { d: number; t: number }[];
  /** Element rim light on the body (uniforms shared by all of the fighter's materials). */
  rimU: { color: { value: THREE.Color }; strength: { value: number } };
  /** Finger bones curled around the wand every frame (after the animation mixer). */
  grip: { bone: THREE.Bone; q: THREE.Quaternion }[];
  /** Network-interpolation targets for the remote fighter. */
  nx?: number; nz?: number; nry?: number;
}

export interface CastOrder {
  kind: CastKind; x: number; y: number; z: number; dx: number; dy: number; dz: number;
  id?: number | string; remote?: boolean;
}

export interface ProjSpec { r: number; dmg: number; sp: number; pw: number; trail: string; slow?: number; aoe?: number; home?: number; life?: number; /** Throws the victim back (m/s). */ push?: number }

export interface Projectile extends ProjSpec {
  id: number | string; owner: 0 | 1; kind: ProjKind;
  pos: THREE.Vector3; vel: THREE.Vector3; core: THREE.Mesh; pal: Palette;
  life: number; remote: boolean; age: number; dead?: boolean; seenByAi?: boolean;
  /** Light trail following it (fx/vfx.ts). */
  ribbon?: { push(p: THREE.Vector3): void; end(): void };
}

export interface Strike { owner: 0 | 1; x: number; z: number; t: number; remote?: boolean; done?: boolean }
export interface Wall { owner: 0 | 1; x: number; z: number; ry: number; g: THREE.Group; t: number }
export interface Clone {
  owner: 0 | 1; g: THREE.Group; mx: THREE.AnimationMixer; act: Record<'idle' | 'walkL' | 'walkR' | 'bolt', THREE.AnimationAction>;
  x: number; z: number; ox: number; oz: number; sgn: number; t: number; fireT: number; owned: boolean; ph: number;
  /** A still illusion of its owner (Ehab's veil) instead of a moving, firing shadow clone. */
  decoy?: boolean;
}

/** A per-frame effect; return false to remove it. */
export type FxFn = (dt: number) => boolean;
