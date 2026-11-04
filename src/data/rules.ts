import type { ProjKind, ProjSpec } from '../core/types';

/** Core combat tuning. Changing these changes game balance. */
export const G = {
  boltCost: 6, spCost: 55, dodgeCd: 0.8, regen: 13, shieldDrain: 14, parryWin: 0.22,
  bx: 4.6, bz: 4.3, zMin: -4.3, zMax: 2.4,
  shMax: 1.5, shCd: 3, shHP: 40, strugCd: 7,
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
