import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { S, net, ch, isLocal, peerIdx } from '../game/state';
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
import { computerPair } from '../ui/menus';

/**
 * Online duels over Supabase Realtime (broadcast + presence, no tables).
 * Each device is authoritative for its own fighter: position, animation, HP and which hits landed on it.
 * State is broadcast 20x/s; casts ride along with unique ids so the peer replays each exactly once.
 */
declare global { interface Window { NILOFAR_CONFIG?: { supabaseUrl?: string; supabaseKey?: string } } }

let sb: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;

/** The Supabase library is only downloaded when someone opens online play (keeps the first load small). */
export async function getClient() {
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
  const c = channel; channel = null; net.peer = null; net.waiting = false; net.selfDown = false; net.lastRecv = 0;
  if (c && sb) { const s = sb; setTimeout(() => { try { void s.removeChannel(c); } catch (e) { console.warn(e); } }, 300); }
}

/** 4-char room code without look-alike characters (no I, L, O, 0, 1). */
export function code4() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = '';
  for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

const showError = (msg: string) => { $('oErr').hidden = false; $('oErr').textContent = msg; };

/** Duel by default; `team` (host only): 2 vs 2, the two players together against two computer wizards. */
export async function onlineStart(host: boolean, code: string, team = false) {
  const client = await getClient();
  if (!client) { showError(TXT.online.disabled); return; }
  leaveNet();
  net.team = host && team; net.code = code; net.me = host ? 0 : 1;
  if (net.team) net.ais = computerPair([S.sel]); net.seen.clear(); net.casts = []; net.peer = null;
  // A new session starts with a clean connection record: the last packet of a previous duel must not count,
  // or the next duel would think the friend went silent minutes ago and end at once.
  net.lastRecv = 0; net.rtt = 0; net.peerTs = 0; net.peerTsAt = 0; net.waiting = false; net.selfDown = false;
  const chn = client.channel('duel-' + code.toLowerCase(), { config: { presence: { key: net.myId }, broadcast: { self: false, ack: false } } });
  chn.on('presence', { event: 'sync' }, () => {
    const st = chn.presenceState<{ role?: string; ch?: number; ar?: ArenaId; tm?: number; ai?: [number, number] }>();
    const others = Object.entries(st).filter(([k]) => k !== net.myId).map(([k, v]) => ({ key: k, ...(v[0] || {}) }));
    const peer = others.find(p => p.role === (host ? 'g' : 'h'));
    if (peer && !net.peer && (S.state === 'menu' || S.state === 'online')) {
      net.peer = peer.key; net.oppRi = +(peer.ch ?? 0) || 0; $('online').hidden = true; S.mode = 'online';
      net.lastRecv = performance.now(); // grace while both load their wizards
      // The guest learns from the host whether this is 2 vs 2 (then it plays slot 2, the host's partner).
      if (!host) { net.team = !!peer.tm; if (net.team) { net.me = 2; net.ais = peer.ai ?? [0, 1]; } }
      S.ai = net.team ? [false, true, false, true] : [false, false, false, false];
      const hostRi = host ? S.sel : net.oppRi, guestRi = host ? net.oppRi : S.sel;
      $('onTxt').textContent = TXT.loadingFighters(0);
      // Both play in the host's arena (arenas differ in size, so positions only agree in the same one).
      const arena = host ? getArena() : peer.ar ?? getArena();
      startOnline(hostRi, guestRi, arena);
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
    if (status === 'SUBSCRIBED') { net.selfDown = false; await chn.track({ role: host ? 'h' : 'g', ch: S.sel, ar: getArena(), ...(net.team ? { tm: 1, ai: net.ais } : {}) }); }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (net.peer) net.selfDown = true; else if (status !== 'CLOSED') showError(TXT.online.connectFail);
    }
  });
  channel = chn;
}

/** Versus screen, then the match: a duel (host vs guest) or 2 vs 2 (host + guest vs the computer's pair). */
function startOnline(hostRi: number, guestRi: number, arena?: ArenaId) {
  const [b, d] = net.ais;
  const all = net.team ? [hostRi, b, guestRi, d] : [hostRi, guestRi];
  const mine = net.me === 0 ? hostRi : guestRi, theirs = net.team ? b : net.me === 0 ? guestRi : hostRi;
  const names: [string, string] | undefined = net.team ? [ROSTER[hostRi].name + ' و' + ROSTER[guestRi].name, ROSTER[b].name + ' و' + ROSTER[d].name] : undefined;
  void versus(mine, theirs, Promise.all([ensureModels(all), arena ? setArena(arena) : null]), 1800, names).then(() => {
    if (!net.peer) return;
    if (net.team) setupFighters(hostRi, b, guestRi, d); else setupFighters(hostRi, guestRi);
    startMatch();
  });
}

const stOf = (c: Fighter) => [+c.x.toFixed(2), +c.z.toFixed(2), +c.ry.toFixed(2), c.curName ? CLIP_NAMES.indexOf(c.curName) : -1, c.shieldOn ? 1 : 0, Math.round(c.hp), Math.round(c.mana), c.dodgeT > 0 ? 1 : 0];

/** st = [x, z, ry, clipIndex, shield, hp, mana, dodging]; ai = the host's computer wizards (2 vs 2); cs = recent casts. */
interface Packet { ai?: number[][]; from: string; ts?: number; e?: [number, number]; st: number[]; cs?: (string | number)[][]; fb?: number; sg?: number; ss?: number; sr?: [number, number] | null; mc?: number; mcid?: number }

export function netSend() {
  if (S.mode !== 'online' || !channel || !net.peer) return;
  const c = ch(net.me); const strug = getStruggle();
  const now = performance.now();
  const payload: Packet = {
    from: net.myId, ts: Math.round(now),
    // Echo of the peer's last timestamp and how long we held it: the peer computes its round trip from it.
    e: net.peerTs ? [net.peerTs, Math.round(now - net.peerTsAt)] : undefined,
    st: stOf(c),
    ai: net.team && net.me === 0 && S.CH[3] ? [stOf(ch(1)), stOf(ch(3))] : undefined,
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
type RmMsg = { from: string; t: 'start' | 'pick' | 'go'; ri?: number; a?: number; b?: number; ai?: [number, number] };
const rm = { active: false, mine: 0, theirs: 0, timer: 0 };

function sendRm(m: Omit<RmMsg, 'from'>) { void channel?.send({ type: 'broadcast', event: 'rm', payload: { from: net.myId, ...m } }); }

export function requestRematch() { if (!rm.active) { sendRm({ t: 'start' }); beginRematch(); } }

function beginRematch() {
  rm.active = true;
  rm.mine = ch(net.me).ri; rm.theirs = ch(peerIdx()).ri;
  $('end').hidden = true; $('rematch').hidden = false;
  renderRematch();
  let left = REMATCH_S; $('rCount').textContent = String(left);
  clearInterval(rm.timer);
  rm.timer = window.setInterval(() => {
    left--; $('rCount').textContent = String(Math.max(0, left));
    if (left > 0) return;
    clearInterval(rm.timer);
    if (net.me === 0) {
      const a = rm.mine, b = rm.theirs;
      if (net.team) net.ais = computerPair([a, b]);
      sendRm({ t: 'go', a, b, ai: net.ais }); goRematch(a, b);
    }
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
  $('rematch').hidden = true;
  startOnline(hostRi, guestRi);
}

function onRematch(m: RmMsg) {
  if (m.t === 'start') { if (!rm.active) beginRematch(); }
  else if (m.t === 'pick' && m.ri !== undefined) { rm.theirs = m.ri; if (rm.active) renderRematch(); }
  else if (m.t === 'go' && m.a !== undefined && m.b !== undefined && net.me !== 0) { if (m.ai) net.ais = m.ai; goRematch(m.a, m.b); }
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

/** A remote wizard's state from its owner: position target, animation, shield, authoritative HP, mana, dodge. */
function applyState(o: Fighter, st: number[]) {
  o.nx = st[0]; o.nz = st[1]; o.nry = st[2];
  const an = CLIP_NAMES[st[3]];
  if (an && an !== o.curName && !o.dead) anim(o, an, { once: ONE_SHOT.includes(an), force: true, speed: an === 'bolt' ? 1.7 : an === 'evade' ? 1.9 : 1 });
  if (st[4] && !o.shieldOn) { o.shieldOn = true; o.shieldT = S.T; o.shield = shieldMesh(o); play('shield', { vol: 0.4, x: o.x }); }
  else if (!st[4] && o.shieldOn) { o.shieldOn = false; o.shield?.off(); o.shield = null; }
  reconcileHp(o, st[5]);
  o.mana = st[6]; o.dodgeT = st[7] ? 0.3 : 0;
}

function netRecv(pp: Packet) {
  const now = performance.now();
  net.lastRecv = now;
  if (pp.ts) { net.peerTs = pp.ts; net.peerTsAt = now; }
  if (pp.e) { const r = now - pp.e[0] - pp.e[1]; if (r >= 0 && r < 10000) net.rtt = net.rtt ? net.rtt * 0.8 + r * 0.2 : r; }
  const o = S.CH[peerIdx()]; const st = pp.st;
  if (!st || !o || isLocal(o)) return;
  applyState(o, st);
  // 2 vs 2, from the host: its computer wizards.
  if (pp.ai && S.CH[3]) { const a1 = S.CH[1], a3 = S.CH[3]; if (a1 && !isLocal(a1)) applyState(a1, pp.ai[0]); if (a3 && !isLocal(a3)) applyState(a3, pp.ai[1]); }

  if (net.me !== 0) {
    if (pp.sg && pp.sg !== net.lastSg) { net.lastSg = pp.sg; if (S.state === 'fight') startStruggle(null, null, pp.sg); }
    net.hostS = pp.ss || 0;
    const strug = getStruggle();
    if (strug && pp.sr && pp.sr[0] === strug.id) endStruggle(pp.sr[1]);
  } else { net.oppMc = pp.mc || 0; net.oppMcId = pp.mcid || 0; }

  for (const k of pp.cs || []) {
    const [id, kind, x, y, z, dx, dy, dz, who] = k as [number, CastKind, number, number, number, number, number, number, number | undefined];
    if (net.seen.has(id)) continue;
    net.seen.add(id);
    // The caster: the other player, or (from the host in 2 vs 2) one of its computer wizards.
    const o = (who !== undefined && S.CH[who] && !isLocal(S.CH[who]!) ? S.CH[who] : S.CH[peerIdx()]) as Fighter;
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
  // The indicator is always on (bottom-left), except over the title screen's credits and the loading screen.
  const ind = $('netInd');
  if (S.state === 'title' || S.state === 'load') { ind.hidden = true; return; }
  if (S.mode !== 'online' || !net.peer) { net.waiting = false; showInternet(ind); return; }
  const now = performance.now(), quiet = net.lastRecv ? now - net.lastRecv : 0;
  const inDuel = DUEL_STATES.includes(S.state);
  const lost = inDuel && quiet > FREEZE_MS;
  if (lost && quiet > GIVE_UP_MS) { net.waiting = false; banner(TXT.online.peerGone); setTimeout(toMenu, 2200); net.peer = null; return; }
  if (lost !== net.waiting) { net.waiting = lost; if (!lost) banner(''); }
  if (lost) banner(net.selfDown ? TXT.online.lostSelf : TXT.online.lostPeer(Math.ceil((GIVE_UP_MS - quiet) / 1000)));
  if (now - indAt < 400) return;
  indAt = now; ind.hidden = false;
  paint(ind, net.selfDown || quiet > FREEZE_MS, quiet > 1500, Math.round(net.rtt));
}

/** Wi-Fi bars and label by quality; the latency sits in an LTR isolate so "82 ms" is not reversed in Arabic. */
function paint(ind: HTMLElement, down: boolean, stale: boolean, ms: number) {
  const [cls, word, icon] = down ? ['down', TXT.online.net.down, 'wifi_off'] : stale || ms > 600 ? ['bad', TXT.online.net.bad, 'network_wifi_1_bar']
    : ms > 300 ? ['weak', TXT.online.net.weak, 'network_wifi_2_bar'] : ms > 150 ? ['ok', TXT.online.net.ok, 'network_wifi_3_bar'] : ['good', TXT.online.net.good, 'signal_wifi_4_bar'];
  ind.className = cls; ind.firstElementChild!.textContent = icon;
  ind.lastElementChild!.textContent = down || !ms ? word : `${word} · \u2066${ms} ms\u2069`;
}

/**
 * Outside online duels: the device's own internet connection, timed every 5 s with a tiny request to the game's
 * server (no data sent). Offline shows the crossed-out Wi-Fi.
 */
const inet = { ms: 0, ok: navigator.onLine, at: 0, busy: false };
async function probe() {
  const url = window.NILOFAR_CONFIG?.supabaseUrl; if (!url) return;
  inet.busy = true; const t = performance.now();
  try { await fetch(url + '/auth/v1/health', { mode: 'no-cors', cache: 'no-store' }); inet.ok = true; inet.ms = Math.round(performance.now() - t); }
  catch { inet.ok = false; inet.ms = 0; }
  finally { inet.busy = false; }
}
function showInternet(ind: HTMLElement) {
  const now = performance.now();
  if (!inet.busy && now - inet.at > 5000) { inet.at = now; void probe(); }
  if (now - indAt < 400) return;
  indAt = now; ind.hidden = false;
  paint(ind, !navigator.onLine || !inet.ok, false, inet.ms);
}
