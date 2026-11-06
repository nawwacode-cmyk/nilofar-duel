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
  /** Fighters by slot: [0, 1] in a duel, [0, 1, 2, 3] in 2 vs 2 (0+2 against 1+3). */
  CH: [null, null] as (Fighter | null)[],
  /** 2 vs 2 match. */
  team: false,
  /** Slots played by the computer (on this device; online, the host runs them). */
  ai: [false, true, false, false] as boolean[],
  /** Balance simulator running: the computer plays both sides, nothing is rendered. */
  sim: false,
  /** Offline pause menu open: the duel is frozen. */
  paused: false,
};

/** Network session data (kept here so gameplay code can read it without importing the network layer). */
export const net = {
  me: 0 as number,
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
  /** Connection health (ms, performance.now clock): last packet from the peer, round trip, the peer's last
   *  timestamp and when it arrived (echoed back so the peer can measure its round trip). */
  lastRecv: 0, rtt: 0, peerTs: 0, peerTsAt: 0,
  /** The duel is frozen while the peer's packets have stopped arriving; our own link to the server is down. */
  waiting: false, selfDown: false,
  /** 2 vs 2 online (the host's choice, read by the guest from presence) and the computer's two wizards. */
  team: false, ais: [0, 0] as [number, number],
};
/** The other player's slot online: 1 in a duel; in 2 vs 2 the host is 0 and the guest 2. */
export const peerIdx = () => (net.team ? (net.me === 0 ? 2 : 0) : 1 - net.me);

export const projs: Projectile[] = [];
export const strikes: Strike[] = [];
export const walls: Wall[] = [];
export const clones: Clone[] = [];
export const fx: FxFn[] = [];

/** Both fighters exist whenever a duel or showcase is running. */
export const ch = (i: number): Fighter => S.CH[i] as Fighter;
/** Different teams (slots 0 and 2 against 1 and 3). */
export const foe = (a: number, b: number) => (a & 1) !== (b & 1);
export const fighters = (): Fighter[] => S.CH.filter((c): c is Fighter => !!c);
/** Living enemies of a fighter. */
export const enemies = (c: Fighter) => fighters().filter(o => foe(o.idx, c.idx) && !o.dead);
/**
 * The enemy a wizard faces and casts at. In a duel, the other one. In 2 vs 2, the nearest living enemy, kept
 * until another is clearly closer (1.5 m), so nobody flicks between two enemies at a similar distance.
 */
export function opp(c: Fighter): Fighter {
  if (!S.team) return ch(1 - c.idx);
  const es = enemies(c);
  const cur = c.tgt !== undefined ? S.CH[c.tgt] : null;
  if (!es.length) return cur ?? ch(c.idx ^ 1);
  const d = (o: Fighter) => Math.hypot(o.x - c.x, o.z - c.z);
  let best = es[0]; for (const o of es) if (d(o) < d(best)) best = o;
  if (!cur || cur.dead || !foe(cur.idx, c.idx) || d(best) < d(cur) - 1.5) c.tgt = best.idx;
  return ch(c.tgt!);
}
export const me = (): Fighter => ch(S.mode === 'online' ? net.me : 0);
/** The second player on the same device (2 vs 2 against the computer). */
export const p2 = (): Fighter | null => (S.team && S.mode !== 'online' && !S.ai[2] ? S.CH[2] : null);
export const isAi = (c: Fighter) => !!S.ai[c.idx];
/** True when this device is authoritative for the fighter: always offline; online, its own wizard, and the
 *  computer's wizards on the host. */
export const isLocal = (c: Fighter) => S.mode !== 'online' || c.idx === net.me || (net.me === 0 && isAi(c));
export const inMenus = () => S.state === 'menu' || S.state === 'online' || S.state === 'title';
