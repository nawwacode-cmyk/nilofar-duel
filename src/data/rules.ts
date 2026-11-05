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
  /** Ehab's veil: seconds unseen. No damage bonus: like every skill it only creates an opening. */
  veilT: 6,
  /** Ehab's illusion army: how long the opponent is held, and how long it stays held when it had its shield up. */
  armyStun: 1.5, armyStunShielded: 0.5,
  /** Close combat: within this distance the attack button shoves/strikes instead of casting. */
  meleeRange: 1.6, meleePush: 7.5,
} as const;

export const PSPEC: Record<ProjKind, ProjSpec> = {
  // Basic bolts: same damage, speed and size for every wizard (only the look differs).
  fire: { r: 0.12, dmg: 9, sp: 17, pw: 1, trail: 'flame' },
  ice: { r: 0.12, dmg: 9, sp: 17, pw: 1, trail: 'spark' },
  shadow: { r: 0.12, dmg: 9, sp: 17, pw: 1, trail: 'twirl' },
  spark: { r: 0.12, dmg: 9, sp: 17, pw: 1, trail: 'spark' },
  gold: { r: 0.12, dmg: 9, sp: 17, pw: 1, trail: 'magic' },
  // Specials: each deals 30 when it connects (spread ones split it across what usually lands).
  meteor: { r: 0.34, dmg: 30, sp: 9.5, pw: 2, trail: 'flame', aoe: 1.6 },
  spear: { r: 0.13, dmg: 15, sp: 17, pw: 2, trail: 'spark' },
  curse: { r: 0.15, dmg: 30, sp: 5, pw: 2, trail: 'twirl', home: 2.4, life: 4.5 },
  orb: { r: 0.14, dmg: 6, sp: 10, pw: 2, trail: 'magic', home: 3.2, life: 3 },
  // Layla's clones: small, so the skill distracts rather than out-damages.
  shmini: { r: 0.09, dmg: 3, sp: 13, pw: 1, trail: 'twirl' },
};

/** Fixed damage numbers outside PSPEC. */
export const DMG = {
  thunder: 30, thunderShielded: 10, thunderRadius: 1.15,
  aoe: 15, aoeShielded: 6, meteorThroughShield: 0.35,
  struggleWin: 42, struggleDraw: 15,
  army: 30, armyShielded: 10, melee: 6,
} as const;

/** AI difficulty table: easy / normal / hard. */
export const AI_LEVELS = [
  { rate: 0.7, dodge: 0.25, parry: 0.05, react: 0.35, skill: 0.25, struggle: 4.5 },
  { rate: 1.3, dodge: 0.5, parry: 0.2, react: 0.22, skill: 0.5, struggle: 6 },
  { rate: 2.1, dodge: 0.8, parry: 0.45, react: 0.12, skill: 0.9, struggle: 7.5 },
] as const;
