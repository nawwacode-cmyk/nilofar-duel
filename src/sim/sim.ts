import { S, projs } from '../game/state';
import { tick } from '../game/loop';
import { setupFighters, startMatch, toMenu } from '../game/flow';
import { ensureModels } from '../fighters/fighter';
import { updateFx } from '../fx/effects';
import { setMuted, isMuted } from '../audio/audio';
import { ROSTER } from '../data/roster';

/**
 * Balance simulator (debug builds: window.__dbg.balance). The computer plays both sides with the real game
 * code — same rules, AI, timings — at a fixed 30 Hz step and without rendering, far faster than real time.
 * Every ordered pairing is played, so both sides of the arena are covered.
 */
export interface BalanceReport {
  games: number;
  /** wins[a][b] = matches wizard a won against wizard b. */
  wins: number[][];
  /** Overall win rate per wizard. */
  rate: Record<string, number>;
  avgSeconds: number;
}

const STEP = 1 / 30, MAX_SECONDS = 300;
/** Last simulated step, readable from the console if a run ever stalls. */
export const trace = { last: '' };

export async function runBalance(gamesPerPairing = 20, diff = 2, onProgress?: (done: number, total: number) => void): Promise<BalanceReport> {
  const wasMuted = isMuted();
  setMuted(true); S.sim = true; S.mode = 'ai'; S.diff = diff;
  await ensureModels(ROSTER.map((_, i) => i));
  const n = ROSTER.length;
  const wins = ROSTER.map(() => ROSTER.map(() => 0));
  let done = 0, seconds = 0; const total = n * (n - 1) * gamesPerPairing;
  try {
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      for (let g = 0; g < gamesPerPairing; g++) {
        setupFighters(a, b); startMatch();
        let steps = 0; const maxSteps = MAX_SECONDS / STEP;
        while (S.state !== 'end' && steps < maxSteps) {
          const t0 = performance.now();
          tick(STEP); updateFx(STEP); steps++;
          const ms = performance.now() - t0;
          trace.last = `${ROSTER[a].id}-${ROSTER[b].id} g${g} step ${steps} state ${S.state} projs ${projs.length} ms ${ms.toFixed(1)}`;
          if (ms > 100) console.warn('slow sim step', trace.last);
          if (steps % 300 === 0) await new Promise(r => setTimeout(r, 0)); // keep the page responsive
        }
        const t = steps * STEP;
        const w = S.CH.find(c => c && c.wins >= 2);
        if (w) wins[w.idx === 0 ? a : b][w.idx === 0 ? b : a]++;
        seconds += t; done++; onProgress?.(done, total);
      }
    }
  } finally {
    S.sim = false; setMuted(wasMuted); toMenu();
  }
  const rate: Record<string, number> = {};
  ROSTER.forEach((r, i) => {
    const won = wins[i].reduce((x, y) => x + y, 0);
    const played = 2 * (n - 1) * gamesPerPairing;
    rate[r.id] = Math.round((won / played) * 1000) / 10;
  });
  return { games: done, wins, rate, avgSeconds: Math.round(seconds / Math.max(1, done)) };
}
