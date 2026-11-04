import type { Fighter, GameState, Mode, Projectile, Strike, Wall, Clone, FxFn } from '../core/types';

/** Mutable session state shared by all systems. One instance per page. */
export const S = {
  mode: 'ai' as Mode,
  diff: 1,
  state: 'load' as GameState,
  round: 0,
  /** Game time (scaled by slow-motion). */
  T: 0,
  slowmo: 1,
  /** Real time since the current state started. */
  stateT: 0,
  /** Selected roster index on the menu. */
  sel: 0,
  shake: 0,
  strugReady: 0,
  projId: 0,
  CH: [null, null] as [Fighter | null, Fighter | null],
  /** Balance simulator running: the computer plays both sides, nothing is rendered. */
  sim: false,
  /** Offline pause menu open: the duel is frozen. */
  paused: false,
};

/** Network session data (kept here so gameplay code can read it without importing the network layer). */
export const net = {
  me: 0 as 0 | 1,
  peer: null as string | null,
  seen: new Set<number | string>(),
  casts: [] as (string | number)[][],
  code: '',
  oppRi: 0,
  myId: Math.random().toString(36).slice(2, 10),
  /** Struggle sync: host id/result, guest mash counter. */
  sg: 0, sr: null as [number, number] | null, lastSg: 0, hostS: 0, oppMc: 0, oppMcId: 0,
  /** Something important happened (a cast, our HP changed): send state now instead of at the next tick. */
  urgent: false,
  /** Fatal Blow hits confirmed by our device as the victim (sent to the attacker) / last one we applied. */
  fb: 0, lastFb: 0,
};

export const projs: Projectile[] = [];
export const strikes: Strike[] = [];
export const walls: Wall[] = [];
export const clones: Clone[] = [];
export const fx: FxFn[] = [];

/** Both fighters exist whenever a duel or showcase is running. */
export const ch = (i: 0 | 1 | number): Fighter => S.CH[i] as Fighter;
export const opp = (c: Fighter): Fighter => ch(1 - c.idx);
export const me = (): Fighter => ch(S.mode === 'online' ? net.me : 0);
/** True when this device is authoritative for the fighter (always offline; only own fighter online). */
export const isLocal = (c: Fighter) => S.mode !== 'online' || c.idx === net.me;
export const inMenus = () => S.state === 'menu' || S.state === 'online' || S.state === 'title';
