import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { S, net, ch, isLocal } from '../game/state';
import { anim, ensureModels } from '../fighters/fighter';
import { play } from '../audio/audio';
import { dmgText, flash, shieldMesh } from '../fx/effects';
import { spawnProj } from '../combat/projectiles';
import { SKFX, spawnStrike, unveilCast } from '../combat/skills';
import { getStruggle, startStruggle, endStruggle } from '../game/struggle';
import { setupFighters, startMatch, ko, toMenu } from '../game/flow';
import { banner } from '../ui/hud';
import { TXT } from '../data/text';
import { $ } from '../core/util';
import { impact } from '../fx/impact';
import { CLIP_NAMES, type CastKind, type Fighter, type ProjKind, type Projectile } from '../core/types';
import { G } from '../data/rules';
import { ROSTER } from '../data/roster';
import { getArena, setArena, type ArenaId } from '../world/arena';
import { versus } from '../ui/transitions';

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
  // Tell the peer we left on purpose, so it ends the duel at once instead of waiting for a reconnection.
  if (channel && net.peer) void channel.send({ type: 'broadcast', event: 'bye', payload: { from: net.myId } });
  const c = channel; channel = null; net.peer = null; net.waiting = false; net.selfDown = false;
  if (c && sb) { const s = sb; setTimeout(() => { try { void s.removeChannel(c); } catch (e) { console.warn(e); } }, 300); }
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
    const st = chn.presenceState<{ role?: string; ch?: number; ar?: ArenaId }>();
    const others = Object.entries(st).filter(([k]) => k !== net.myId).map(([k, v]) => ({ key: k, ...(v[0] || {}) }));
    const peer = others.find(p => p.role === (host ? 'g' : 'h'));
    if (peer && !net.peer && (S.state === 'menu' || S.state === 'online')) {
      net.peer = peer.key; net.oppRi = +(peer.ch ?? 0) || 0; $('online').hidden = true; S.mode = 'online';
      const a = net.me === 0 ? S.sel : net.oppRi, b = net.me === 0 ? net.oppRi : S.sel;
      $('onTxt').textContent = TXT.loadingFighters(0);
      // Both play in the host's arena (arenas differ in size, so positions only agree in the same one).
      const arena = host ? getArena() : peer.ar ?? getArena();
      const mine = net.me === 0 ? a : b, theirs = net.me === 0 ? b : a;
      void versus(mine, theirs, Promise.all([ensureModels([a, b]), setArena(arena)])).then(() => { if (net.peer) { setupFighters(a, b); startMatch(); } });
    }
    // A peer missing from presence is handled by checkConnection (it may only be a short network drop).
  });
  chn.on('broadcast', { event: 'bye' }, ({ payload }) => {
    if (!net.peer || !payload || payload.from !== net.peer) return;
    net.peer = null; net.waiting = false;
    if (S.state !== 'menu') { banner(TXT.online.peerLeft); setTimeout(toMenu, 2200); }
  });
  chn.on('broadcast', { event: 'st' }, ({ payload }) => { if (net.peer && payload && payload.from === net.peer) netRecv(payload as Packet); });
  chn.on('broadcast', { event: 'rm' }, ({ payload }) => { if (net.peer && payload && payload.from === net.peer) onRematch(payload as RmMsg); });
  chn.subscribe(async status => {
    // The client rejoins by itself after a drop; we only track the state for the connection indicator.
    if (status === 'SUBSCRIBED') { net.selfDown = false; await chn.track({ role: host ? 'h' : 'g', ch: S.sel, ar: getArena() }); }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (net.peer) net.selfDown = true; else if (status !== 'CLOSED') showError(TXT.online.connectFail);
    }
  });
  channel = chn;
}

/** st = [x, z, ry, clipIndex, shield, hp, mana, dodging]; cs = recent casts. */
interface Packet { from: string; ts?: number; e?: [number, number]; st: number[]; cs?: (string | number)[][]; fb?: number; sg?: number; ss?: number; sr?: [number, number] | null; mc?: number; mcid?: number }

export function netSend() {
  if (S.mode !== 'online' || !channel || !net.peer) return;
  const c = ch(net.me); const strug = getStruggle();
  const now = performance.now();
  const payload: Packet = {
    from: net.myId, ts: Math.round(now),
    // Echo of the peer's last timestamp and how long we held it: the peer computes its round trip from it.
    e: net.peerTs ? [net.peerTs, Math.round(now - net.peerTsAt)] : undefined,
    st: [+c.x.toFixed(2), +c.z.toFixed(2), +c.ry.toFixed(2), c.curName ? CLIP_NAMES.indexOf(c.curName) : -1, c.shieldOn ? 1 : 0, Math.round(c.hp), Math.round(c.mana), c.dodgeT > 0 ? 1 : 0],
    cs: net.casts, sg: net.sg || 0, ss: strug ? +strug.s.toFixed(3) : 0, sr: net.sr || null, mc: strug ? strug.my : 0, mcid: strug ? strug.id : 0,
  };
  net.urgent = false;
  channel.send({ type: 'broadcast', event: 'st', payload }).catch(() => { /* dropped packets are fine at 20 Hz */ });
}

/* ---------- rematch in the same room ---------- */
/**
 * Either player presses "new duel": both get REMATCH_S seconds to pick a wizard (each sees the other's pick),
 * then the host announces the final pair and both start together. Nobody leaves the room.
 */
const REMATCH_S = 10;
type RmMsg = { from: string; t: 'start' | 'pick' | 'go'; ri?: number; a?: number; b?: number };
const rm = { active: false, mine: 0, theirs: 0, timer: 0 };

function sendRm(m: Omit<RmMsg, 'from'>) { void channel?.send({ type: 'broadcast', event: 'rm', payload: { from: net.myId, ...m } }); }

export function requestRematch() { if (!rm.active) { sendRm({ t: 'start' }); beginRematch(); } }

function beginRematch() {
  rm.active = true;
  rm.mine = ch(net.me).ri; rm.theirs = ch(1 - net.me).ri;
  $('end').hidden = true; $('rematch').hidden = false;
  renderRematch();
  let left = REMATCH_S; $('rCount').textContent = String(left);
  clearInterval(rm.timer);
  rm.timer = window.setInterval(() => {
    left--; $('rCount').textContent = String(Math.max(0, left));
    if (left > 0) return;
    clearInterval(rm.timer);
    if (net.me === 0) { const a = rm.mine, b = rm.theirs; sendRm({ t: 'go', a, b }); goRematch(a, b); }
  }, 1000);
}

function renderRematch() {
  $('rRoster').replaceChildren(...ROSTER.map((r, i) => {
    const b = document.createElement('button');
    b.className = 'wcard' + (i === rm.mine ? ' on' : ''); b.style.setProperty('--c', r.css);
    const img = document.createElement('img'); img.alt = ''; img.src = `models/portraits/${r.id}.webp`;
    const plate = document.createElement('span'); plate.className = 'plate';
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = r.icon;
    const nm = document.createElement('b'); nm.textContent = r.name;
    plate.append(ic, nm); b.append(img, plate);
    b.onclick = () => { rm.mine = i; S.sel = i; sendRm({ t: 'pick', ri: i }); renderRematch(); };
    return b;
  }));
  $('rPeer').textContent = TXT.online.peerPicked(ROSTER[rm.theirs].name);
}

function goRematch(hostRi: number, guestRi: number) {
  rm.active = false; clearInterval(rm.timer);
  const a = hostRi, b = guestRi;
  $('rematch').hidden = true;
  void versus(net.me === 0 ? a : b, net.me === 0 ? b : a, ensureModels([a, b])).then(() => {
    if (!net.peer) return;
    setupFighters(a, b); startMatch();
  });
}

function onRematch(m: RmMsg) {
  if (m.t === 'start') { if (!rm.active) beginRematch(); }
  else if (m.t === 'pick' && m.ri !== undefined) { rm.theirs = m.ri; if (rm.active) renderRematch(); }
  else if (m.t === 'go' && m.a !== undefined && m.b !== undefined && net.me === 1) goRematch(m.a, m.b);
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
  const now = performance.now();
  net.lastRecv = now;
  if (pp.ts) { net.peerTs = pp.ts; net.peerTsAt = now; }
  if (pp.e) { const r = now - pp.e[0] - pp.e[1]; if (r >= 0 && r < 10000) net.rtt = net.rtt ? net.rtt * 0.8 + r * 0.2 : r; }
  const o = S.CH[1 - net.me]; const st = pp.st;
  if (!st || !o || isLocal(o)) return;
  o.nx = st[0]; o.nz = st[1]; o.nry = st[2];
  const an = CLIP_NAMES[st[3]];
  if (an && an !== o.curName && !o.dead) anim(o, an, { once: ONE_SHOT.includes(an), force: true, speed: an === 'bolt' ? 1.7 : an === 'evade' ? 1.9 : 1 });
  if (st[4] && !o.shieldOn) { o.shieldOn = true; o.shieldT = S.T; o.shield = shieldMesh(o); play('shield', { vol: 0.4, x: o.x }); }
  else if (!st[4] && o.shieldOn) { o.shieldOn = false; o.shield?.off(); o.shield = null; }
  reconcileHp(o, st[5]);
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
    if (kind === 'thunder') { unveilCast(o); spawnStrike(o.idx, x, z, true); }
    else if (kind in SKFX) { if (kind !== 'veil') unveilCast(o); SKFX[kind as keyof typeof SKFX](o, { kind, x, y, z, dx, dy, dz, remote: true }); }
    else { unveilCast(o); spawnProj({ owner: o.idx, kind: kind as ProjKind, x, y, z, dx, dy, dz, remote: true, id: 'r' + id }); }
    play(o.R.snd === 'bolt' ? 'cast3' : 'cast2', { vol: 0.35, x: o.x, rate: 1.3 });
  }
}

/* ---------- connection health ---------- */
/** No packets for this long: freeze the duel and wait; this long: give up. */
const FREEZE_MS = 3000, GIVE_UP_MS = 30000;
const DUEL_STATES = ['intro', 'fight', 'ko', 'struggle'];
let indAt = 0;

/**
 * Called every frame online. A short network drop freezes the duel on both devices (each stops hearing the
 * other) and it resumes where it was when packets flow again; after GIVE_UP_MS the duel ends.
 * Also refreshes the connection indicator (bottom left).
 */
export function checkConnection() {
  const ind = $('netInd');
  if (S.mode !== 'online' || !net.peer) { ind.hidden = true; net.waiting = false; return; }
  const now = performance.now(), quiet = net.lastRecv ? now - net.lastRecv : 0;
  const inDuel = DUEL_STATES.includes(S.state);
  const lost = inDuel && quiet > FREEZE_MS;
  if (lost && quiet > GIVE_UP_MS) { net.waiting = false; banner(TXT.online.peerGone); setTimeout(toMenu, 2200); net.peer = null; return; }
  if (lost !== net.waiting) { net.waiting = lost; if (!lost) banner(''); }
  if (lost) banner(net.selfDown ? TXT.online.lostSelf : TXT.online.lostPeer(Math.ceil((GIVE_UP_MS - quiet) / 1000)));
  if (now - indAt < 400) return;
  indAt = now; ind.hidden = false;
  const down = net.selfDown || quiet > FREEZE_MS, ms = Math.round(net.rtt);
  const [cls, word, icon] = down ? ['down', TXT.online.net.down, 'wifi_off'] : quiet > 1500 || ms > 600 ? ['bad', TXT.online.net.bad, 'network_wifi_1_bar']
    : ms > 300 ? ['weak', TXT.online.net.weak, 'network_wifi_2_bar'] : ms > 150 ? ['ok', TXT.online.net.ok, 'network_wifi_3_bar'] : ['good', TXT.online.net.good, 'signal_wifi_4_bar'];
  ind.className = cls; ind.firstElementChild!.textContent = icon;
  // The latency is wrapped in an LTR isolate so "82 ms" is not reversed inside the Arabic label.
  // The latency sits in an LTR isolate so "82 ms" is not reversed inside the Arabic label.
  ind.lastElementChild!.textContent = down || !ms ? word : `${word} · ⁦${ms} ms⁩`;
}
