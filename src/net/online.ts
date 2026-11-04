import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { S, net, ch, isLocal } from '../game/state';
import { anim, ensureModels } from '../fighters/fighter';
import { play } from '../audio/audio';
import { dmgText, flash, shieldMesh } from '../fx/effects';
import { spawnProj } from '../combat/projectiles';
import { SKFX, spawnStrike } from '../combat/skills';
import { getStruggle, startStruggle, endStruggle } from '../game/struggle';
import { setupFighters, startMatch, ko, toMenu } from '../game/flow';
import { banner } from '../ui/hud';
import { TXT } from '../data/text';
import { $ } from '../core/util';
import { impact } from '../fx/impact';
import { CLIP_NAMES, type CastKind, type Fighter, type ProjKind, type Projectile } from '../core/types';
import { G } from '../data/rules';
import { remoteFatalHit } from '../combat/finisher';

/**
 * Online duels over Supabase Realtime (broadcast + presence, no tables).
 * Each device is authoritative for its own fighter: position, animation, HP and which hits landed on it.
 * State is broadcast 20x/s; casts ride along with unique ids so the peer replays each exactly once.
 */
declare global { interface Window { NILOFAR_CONFIG?: { supabaseUrl?: string; supabaseKey?: string } } }

let sb: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;

/** The Supabase library is only downloaded when someone opens online play (keeps the first load small). */
async function getClient() {
  if (sb) return sb;
  const C = window.NILOFAR_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) return null;
  const { createClient } = await import('@supabase/supabase-js');
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
  const client = await getClient();
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
      const a = net.me === 0 ? S.sel : net.oppRi, b = net.me === 0 ? net.oppRi : S.sel;
      $('onTxt').textContent = TXT.loadingFighters(0);
      void ensureModels([a, b]).then(() => { if (net.peer) { setupFighters(a, b); startMatch(); } });
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
interface Packet { from: string; st: number[]; cs?: (string | number)[][]; fb?: number; sg?: number; ss?: number; sr?: [number, number] | null; mc?: number; mcid?: number }

export function netSend() {
  if (S.mode !== 'online' || !channel || !net.peer) return;
  const c = ch(net.me); const strug = getStruggle();
  const payload: Packet = {
    from: net.myId,
    st: [+c.x.toFixed(2), +c.z.toFixed(2), +c.ry.toFixed(2), c.curName ? CLIP_NAMES.indexOf(c.curName) : -1, c.shieldOn ? 1 : 0, Math.round(c.hp), Math.round(c.mana), c.dodgeT > 0 ? 1 : 0],
    cs: net.casts, fb: net.fb || 0, sg: net.sg || 0, ss: strug ? +strug.s.toFixed(3) : 0, sr: net.sr || null, mc: strug ? strug.my : 0, mcid: strug ? strug.id : 0,
  };
  net.urgent = false;
  channel.send({ type: 'broadcast', event: 'st', payload }).catch(() => { /* dropped packets are fine at 20 Hz */ });
}

/* ---------- hit prediction on the attacker's side ---------- */
const PREDICT_MS = 600;
const sev = (d: number, isKo: boolean) => (isKo ? 1 : Math.min(0.9, Math.max(0.15, d / 40)));

/**
 * Our projectile reached the remote fighter: show the hit now instead of after a network round trip.
 * The damage stays "pending" until the victim's device confirms it (its HP drops); if it never does
 * (they blocked or dodged on their screen) it expires and the bar returns to the authoritative value.
 */
export function predictHit(o: Fighter, p: Projectile) {
  if (S.state !== 'fight' || o.dead) return;
  if (o.shieldOn) { o.shield?.hit(); return; }
  const vl = Math.hypot(p.vel.x, p.vel.z) || 1;
  const back = (p.vel.x * Math.sin(o.ry) + p.vel.z * Math.cos(o.ry)) / vl > G.backDot;
  const d = Math.round(p.dmg * (back ? G.backstabMult : 1));
  o.pend.push({ d, t: performance.now() });
  o.hp = Math.max(0, o.hp - d);
  if (back) dmgText(o, TXT.backstab, '#ff8a5c');
  dmgText(o, '−' + d, ch(net.me).hex); flash(o, 12); impact(o, ch(net.me), sev(d, false));
}

/** Applies the victim's authoritative HP: confirms predicted hits, shows unpredicted damage, drops stale guesses. */
function reconcileHp(o: Fighter, auth: number) {
  let drop = o.authHp - auth;
  o.authHp = auth;
  if (drop > 0 && S.state === 'fight') {
    while (drop > 0.5 && o.pend.length) {
      const q = o.pend[0];
      if (q.d <= drop + 0.5) { drop -= q.d; o.pend.shift(); } else { q.d -= drop; drop = 0; }
    }
    // Damage we did not predict (thunder strike, area damage, beam struggle, clones): show it now.
    if (drop > 0.5) { const d = Math.round(drop); dmgText(o, '−' + d, ch(net.me).hex); flash(o, 12); impact(o, ch(net.me), sev(d, auth <= 0)); }
  }
  expirePredictions(o);
  if (auth <= 0 && !o.dead && S.state === 'fight') ko(o);
}

/** Drops guesses the victim never confirmed (also called every frame, so a silent peer cannot freeze them). */
export function expirePredictions(o: Fighter) {
  if (!o.pend.length) return;
  const now = performance.now();
  o.pend = o.pend.filter(q => now - q.t < PREDICT_MS);
  o.hp = Math.max(0, o.authHp - o.pend.reduce((a, q) => a + q.d, 0));
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
  reconcileHp(o, st[5]);
  if (pp.fb) remoteFatalHit(pp.fb);
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
