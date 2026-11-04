import { S } from './state';

/**
 * Delays in game time (S.T) instead of wall-clock setTimeout: they respect hit-stop and slow motion,
 * and the balance simulator can run matches faster than real time with identical timing.
 */
const queue: { at: number; fn: () => void }[] = [];

export function after(seconds: number, fn: () => void) { queue.push({ at: S.T + seconds, fn }); }

/** Runs everything that is due (called once per simulation step). */
export function runScheduled() {
  let ran = 0;
  for (let i = 0; i < queue.length;) {
    if (queue[i].at <= S.T) {
      const { fn } = queue[i]; queue.splice(i, 1); fn();
      // Safety net: a task that keeps re-scheduling itself "now" must never freeze the game.
      if (++ran > 500) { console.error('schedule: runaway tasks, dropping', queue.length); queue.length = 0; return; }
    } else i++;
  }
}
