import type { RealtimeChannel } from '@supabase/supabase-js';
import { getClient } from '../net/online';

/**
 * Co-op transport for «رحلة الصيّادين» (Supabase Realtime broadcast + presence, like the duels, own channel).
 * The host runs the monsters, the boss and the stage flow; each player is authoritative for their own wizard.
 * Messages (all carry `from`):
 *  go     host → guest   start: difficulty and the host's wizard
 *  ready  guest → host   stage loaded (host answers with sync)
 *  pl     both           own wizard: [x, z, ry, clip, hp, mana, dead, shield, dodging]
 *  snap   host → guest   monsters [[uid, x, z, ry, state, hp]], kills, remaining
 *  spawn/sync host → guest  new monsters / everything alive (after ready)
 *  hit    guest → host   a spell hit a monster {u, d, x, z}
 *  hurt   host → guest   a monster or hazard hit the guest {d, x, z, b}
 *  hz     host → guest   boss hazard {k, x, z}
 *  cast   both           spell visuals {k: 'b' | 'n', x, y, z}
 *  say / gate / stage / wipe / retry   stage flow (host → guest)
 */
export type Role = 'solo' | 'host' | 'guest';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = Record<string, any>;

export const coop = {
  role: 'solo' as Role, code: '', peer: null as string | null, peerRi: 0,
  myId: Math.random().toString(36).slice(2, 10),
  /** performance.now() of the last message from the partner. */
  lastRecv: 0,
};

let channel: RealtimeChannel | null = null;
let handler: (ev: string, p: Payload) => void = () => {};
let onPeer: (ri: number) => void = () => {};
let onLeft: () => void = () => {};

export const online = () => coop.role !== 'solo';
export const isHost = () => coop.role !== 'guest';

/** Where incoming game messages go (set by hunt.ts). */
export function onCoopMessage(fn: typeof handler) { handler = fn; }
export function onPartnerLeft(fn: () => void) { onLeft = fn; }

export function coopSend(ev: string, p: Payload = {}) {
  if (!channel || !coop.peer) return;
  channel.send({ type: 'broadcast', event: 'm', payload: { from: coop.myId, ev, ...p } }).catch(() => { /* dropped packets are fine */ });
}

/** Opens a room: as host it waits for a guest, as guest it joins the host's code. `peer` fires when both are in. */
export async function coopOpen(host: boolean, code: string, myRi: number, peer: (ri: number) => void, fail: (msg: string) => void) {
  const client = await getClient();
  if (!client) { fail('اللعب عبر الإنترنت غير متاح في هذه النسخة.'); return; }
  coopLeave();
  coop.role = host ? 'host' : 'guest'; coop.code = code; coop.peer = null; onPeer = peer;
  const chn = client.channel('hunt-' + code.toLowerCase(), { config: { presence: { key: coop.myId }, broadcast: { self: false, ack: false } } });
  chn.on('presence', { event: 'sync' }, () => {
    const st = chn.presenceState<{ role?: string; ri?: number }>();
    const other = Object.entries(st).filter(([k]) => k !== coop.myId).map(([k, v]) => ({ key: k, ...(v[0] || {}) })).find(p => p.role === (host ? 'g' : 'h'));
    if (other && !coop.peer) { coop.peer = other.key; coop.peerRi = +(other.ri ?? 0) || 0; coop.lastRecv = performance.now(); onPeer(coop.peerRi); }
  });
  // Presence "leave" also fires on short network hiccups, so a partner only counts as gone after saying bye or
  // after SILENT_MS without any message (a heartbeat keeps quiet moments, like loading a stage, alive).
  chn.on('broadcast', { event: 'm' }, ({ payload }) => {
    if (!payload || payload.from !== coop.peer) return;
    coop.lastRecv = performance.now();
    if (payload.ev === 'bye') { partnerGone(); return; }
    if (payload.ev === 'ka') return;
    handler(payload.ev, payload);
  });
  chn.subscribe(async status => {
    if (status === 'SUBSCRIBED') await chn.track({ role: host ? 'h' : 'g', ri: myRi });
    if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !coop.peer) fail('تعذّر الاتصال. تحقّق من الإنترنت وحاول مجددًا.');
  });
  channel = chn;
  clearInterval(beat);
  beat = window.setInterval(() => {
    if (!coop.peer) return;
    coopSend('ka');
    if (performance.now() - coop.lastRecv > SILENT_MS) partnerGone();
  }, 2000);
}
const SILENT_MS = 45000;
let beat = 0;

function partnerGone() {
  if (!coop.peer) return;
  coop.peer = null;
  onLeft();
}

/** Leaves the room (tells the partner first) and goes back to solo. */
export function coopLeave() {
  if (channel && coop.peer) coopSend('bye');
  clearInterval(beat);
  const c = channel; channel = null; coop.peer = null; coop.role = 'solo';
  if (c) void getClient().then(sb => setTimeout(() => { try { void sb?.removeChannel(c); } catch { /* already gone */ } }, 300));
}
