import type { ProjKind, ProjSpec } from '../core/types';

/** Core combat tuning. Changing these changes game balance. */
export const G = {
  boltCost: 6, spCost: 55, dodgeCd: 0.8, regen: 13, shieldDrain: 14, parryWin: 0.22,
  bx: 4.6, bz: 4.3, zMin: -4.3, zMax: 2.4,
  shMax: 1.5, shCd: 3, shHP: 40, strugCd: 7,
  /** Max turning speed in a fight (rad/s): a half turn takes ~0.55 s, so getting behind someone matters. */
  turnRate: 5.7,
  /** Seconds the opponent cannot turn after Reem steps out of her portal. */
  portalBlind: 0.6,
  /** Spells only leave within this cone of the facing direction (cos of the half-angle, 75°). */
  castCone: 0.26,
  /** A hit from behind (projectile travelling along the victim's facing) ignores the shield and hurts more. */
  backDot: 0.35, backstabMult: 1.5,
  /** Ehab's veil: seconds unseen; the first spell cast out of it hurts this much more. */
  veilT: 3, veilMult: 1.4,
} as const;

export const PSPEC: Record<ProjKind, ProjSpec> = {
  fire: { r: 0.13, dmg: 10, sp: 15, pw: 1, trail: 'flame' },
  ice: { r: 0.12, dmg: 9, sp: 16, pw: 1, trail: 'spark', slow: 0.7 },
  shadow: { r: 0.13, dmg: 8, sp: 14, pw: 1, trail: 'twirl' },
  spark: { r: 0.1, dmg: 8, sp: 24, pw: 1, trail: 'spark' },
  meteor: { r: 0.34, dmg: 34, sp: 9.5, pw: 3, trail: 'flame', aoe: 1.6 },
  spear: { r: 0.13, dmg: 13, sp: 17, pw: 2, trail: 'spark', slow: 2 },
  curse: { r: 0.15, dmg: 28, sp: 5, pw: 2, trail: 'twirl', home: 2.4, life: 4.5 },
  shmini: { r: 0.09, dmg: 5, sp: 13, pw: 1, trail: 'twirl' },
  gold: { r: 0.13, dmg: 11, sp: 19, pw: 1, trail: 'magic' },
  orb: { r: 0.14, dmg: 9, sp: 10, pw: 2, trail: 'magic', home: 3.2, life: 3 },
};

/** Fixed damage numbers outside PSPEC. */
export const DMG = {
  thunder: 36, thunderShielded: 12, thunderRadius: 1.15,
  aoe: 20, aoeShielded: 8, meteorThroughShield: 0.35,
  struggleWin: 42, struggleDraw: 15,
} as const;

/** AI difficulty table: easy / normal / hard. */
export const AI_LEVELS = [
  { rate: 0.7, dodge: 0.25, parry: 0.05, react: 0.35, skill: 0.25, struggle: 4.5 },
  { rate: 1.3, dodge: 0.5, parry: 0.2, react: 0.22, skill: 0.5, struggle: 6 },
  { rate: 2.1, dodge: 0.8, parry: 0.45, react: 0.12, skill: 0.9, struggle: 7.5 },
] as const;
