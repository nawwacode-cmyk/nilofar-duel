import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { S, net, ch, isLocal } from '../game/state';
import { anim } from '../fighters/fighter';
import { play } from '../audio/audio';
import { dmgText, flash, shieldMesh } from '../fx/effects';
import { spawnProj } from '../combat/projectiles';
import { SKFX, spawnStrike } from '../combat/skills';
import { getStruggle, startStruggle, endStruggle } from '../game/struggle';
import { setupFighters, startMatch, ko, toMenu } from '../game/flow';
import { banner } from '../ui/hud';
import { TXT } from '../data/text';
import { $ } from '../core/util';
import { CLIP_NAMES, type CastKind, type ProjKind } from '../core/types';

/**
 * Online duels over Supabase Realtime (broadcast + presence, no tables).
 * Each device is authoritative for its own fighter: position, animation, HP and which hits landed on it.
 * State is broadcast 20x/s; casts ride along with unique ids so the peer replays each exactly once.
 */
declare global { interface Window { NILOFAR_CONFIG?: { supabaseUrl?: string; supabaseKey?: string } } }

let sb: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;

function getClient() {
  if (sb) return sb;
  const C = window.NILOFAR_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) return null;
  sb = createClient(C.supabaseUrl, C.supabaseKey, { realtime: { params: { eventsPerSecond: 40 } } });
  return sb;
}

export function leaveNet() {
  if (channel && sb) { try { void sb.removeChannel(channel); } catch (e) { console.warn(e); } }
  channel = null; net.peer = null;
}

/** 4-char room code without look-alike characters (no I, L, O, 0, 1). */
export function code4() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

const showError = (msg: string) => { $('oErr').hidden = false; $('oErr').textContent = msg; };

export async function onlineStart(host: boolean, code: string) {
  const client = getClient();
  if (!client) { showError(TXT.online.disabled); return; }
  leaveNet();
  net.code = code; net.me = host ? 0 : 1; net.seen.clear(); net.casts = []; net.peer = null;
  const chn = client.channel('duel-' + code.toLowerCase(), { config: { presence: { key: net.myId }, broadcast: { self: false, ack: false } } });
  chn.on('presence', { event: 'sync' }, () => {
    const st = chn.presenceState<{ role?: string; ch?: number }>();
    const others = Object.entries(st).filter(([k]) => k !== net.myId).map(([k, v]) => ({ key: k, ...(v[0] || {}) }));
    const peer = others.find(p => p.role === (host ? 'g' : 'h'));
    if (peer && !net.peer && (S.state === 'menu' || S.state === 'online')) {
      net.peer = peer.key; net.oppRi = +(peer.ch ?? 0) || 0; $('online').hidden = true; S.mode = 'online';
      setupFighters(net.me === 0 ? S.sel : net.oppRi, net.me === 0 ? net.oppRi : S.sel); startMatch();
    }
    if (net.peer && !others.some(p => p.key === net.peer)) {
      net.peer = null;
      if (S.state !== 'menu') { banner(TXT.online.peerLeft); setTimeout(toMenu, 2200); }
    }
  });
  chn.on('broadcast', { event: 'st' }, ({ payload }) => { if (net.peer && payload && payload.from === net.peer) netRecv(payload as Packet); });
  chn.subscribe(async status => {
    if (status === 'SUBSCRIBED') await chn.track({ role: host ? 'h' : 'g', ch: S.sel });
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') showError(TXT.online.connectFail);
  });
  channel = chn;
}

/** st = [x, z, ry, clipIndex, shield, hp, mana, dodging]; cs = recent casts. */
interface Packet { from: string; st: number[]; cs?: (string | number)[][]; sg?: number; ss?: number; sr?: [number, number] | null; mc?: number; mcid?: number }

export function netSend() {
  if (S.mode !== 'online' || !channel || !net.peer) return;
  const c = ch(net.me); const strug = getStruggle();
  const payload: Packet = {
    from: net.myId,
    st: [+c.x.toFixed(2), +c.z.toFixed(2), +c.ry.toFixed(2), c.curName ? CLIP_NAMES.indexOf(c.curName) : -1, c.shieldOn ? 1 : 0, Math.round(c.hp), Math.round(c.mana), c.dodgeT > 0 ? 1 : 0],
    cs: net.casts, sg: net.sg || 0, ss: strug ? +strug.s.toFixed(3) : 0, sr: net.sr || null, mc: strug ? strug.my : 0, mcid: strug ? strug.id : 0,
  };
  channel.send({ type: 'broadcast', event: 'st', payload }).catch(() => { /* dropped packets are fine at 20 Hz */ });
}

const ONE_SHOT = ['bolt', 'special', 'hit', 'death', 'evade'];

function netRecv(pp: Packet) {
  const o = S.CH[1 - net.me]; const st = pp.st;
  if (!st || !o || isLocal(o)) return;
  o.nx = st[0]; o.nz = st[1]; o.nry = st[2];
  const an = CLIP_NAMES[st[3]];
  if (an && an !== o.curName && !o.dead) anim(o, an, { once: ONE_SHOT.includes(an), force: true, speed: an === 'bolt' ? 1.7 : an === 'evade' ? 1.9 : 1 });
  if (st[4] && !o.shieldOn) { o.shieldOn = true; o.shieldT = S.T; o.shield = shieldMesh(o); play('shield', { vol: 0.4, x: o.x }); }
  else if (!st[4] && o.shieldOn) { o.shieldOn = false; o.shield?.off(); o.shield = null; }
  if (st[5] < o.hp && S.state === 'fight') {
    const d = o.hp - st[5]; o.hp = st[5]; dmgText(o, '−' + d, ch(net.me).hex); flash(o, 12);
    if (o.hp <= 0) ko(o);
  } else o.hp = st[5];
  o.mana = st[6]; o.dodgeT = st[7] ? 0.3 : 0;

  if (net.me === 1) {
    if (pp.sg && pp.sg !== net.lastSg) { net.lastSg = pp.sg; if (S.state === 'fight') startStruggle(null, null, pp.sg); }
    net.hostS = pp.ss || 0;
    const strug = getStruggle();
    if (strug && pp.sr && pp.sr[0] === strug.id) endStruggle(pp.sr[1]);
  } else { net.oppMc = pp.mc || 0; net.oppMcId = pp.mcid || 0; }

  for (const k of pp.cs || []) {
    const [id, kind, x, y, z, dx, dy, dz] = k as [number, CastKind, number, number, number, number, number, number];
    if (net.seen.has(id)) continue;
    net.seen.add(id);
    if (kind === 'thunder') spawnStrike(o.idx, x, z, true);
    else if (kind in SKFX) SKFX[kind as keyof typeof SKFX](o, { kind, x, y, z, dx, dy, dz, remote: true });
    else spawnProj({ owner: o.idx, kind: kind as ProjKind, x, y, z, dx, dy, dz, remote: true, id: 'r' + id });
    play(o.R.snd === 'bolt' ? 'cast3' : 'cast2', { vol: 0.35, x: o.x, rate: 1.3 });
  }
}
