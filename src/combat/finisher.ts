import { S, net, opp, isLocal } from '../game/state';
import { anim, chest, tipPos } from '../fighters/fighter';
import { emit, explosion, burst } from '../render/particles';
import { lightFlash } from '../render/lights';
import { play } from '../audio/audio';
import { flash, dmgText } from '../fx/effects';
import { banner } from '../ui/hud';
import { after } from '../game/schedule';
import { applyDmg } from './damage';
import { SKFX } from './skills';
import { fire } from './actions';
import { TXT } from '../data/text';
import { V, rnd, pick } from '../core/util';
import type { CastOrder, Fighter } from '../core/types';

/**
 * Mortal-Kombat-style finishers, built to stay fair:
 *
 * Fatal Blow (الضربة القاتلة) — a comeback move. Unlocks when YOUR health is under 30 %, once per match.
 *   A visible wind-up gives the opponent time to dodge or shield; a miss puts it on a 10 s cooldown
 *   (still unused). A hit plays a short cinematic and deals 30 % of the victim's max health.
 *   Online, the victim's device decides hit/miss like every other attack and tells the attacker.
 *
 * Fatality (القضاء الأخير) — after the deciding round the loser stays dazed ("اقضِ عليه!") for a few seconds;
 *   the winner may press the finisher button for an elemental execution. It never changes the result.
 */
export const FB = { hpGate: 0.3, windup: 0.65, range: 8, cone: 0.5, dmgFrac: 0.3, missCd: 10, cineTime: 2.6, finishWindow: 4.5 };

interface Cine { att: Fighter; vic: Fighter; kind: 'fatal' | 'fatality'; t: number }
let cine: Cine | null = null;
export const getCine = () => cine;

export function fatalReady(c: Fighter) {
  return S.state === 'fight' && !c.dead && !c.fbUsed && c.fbCd <= 0 && c.hp <= c.R.hp * FB.hpGate && c.stunT <= 0 && c.castT <= 0.1 && c.dodgeT <= 0;
}
/** The local player's finisher button: Fatal Blow in a fight, Fatality while the loser is dazed. */
export function finisherAvailable(c: Fighter) {
  return fatalReady(c) || (S.state === 'finish' && !opp(c).dead && c.wins >= 2 && !cine);
}

/** Button / key press. */
export function useFinisher(c: Fighter) {
  if (S.state === 'finish') { if (finisherAvailable(c)) fire(c, { kind: 'fatality', x: c.x, y: (Math.random() * 1e6) | 0, z: c.z, dx: 0, dy: 0, dz: 0 }); return; }
  if (!fatalReady(c)) return;
  c.fbCd = FB.windup + FB.missCd; // cleared to "used" if it connects
  fire(c, { kind: 'fatal', x: c.x, y: (Math.random() * 1e6) | 0, z: c.z, dx: 0, dy: 0, dz: 0 });
}

/* ---------- Fatal Blow: wind-up on every device, resolution on the victim's ---------- */
function fatalWindup(c: Fighter, o: CastOrder) {
  c.castT = FB.windup; anim(c, 'special', { once: true, speed: 0.9, force: true });
  play(c.R.ss, { vol: 1, x: c.x }); play('c_chant', { vol: 0.5 });
  banner(TXT.fatalBlow);
  // Charging aura so the opponent can see it coming.
  const t0 = S.T;
  const aura = () => {
    if (S.T - t0 > FB.windup || c.dead) return;
    const p = chest(c);
    for (let i = 0; i < 6; i++) { const a = Math.random() * 6.28, r = 0.6 + Math.random() * 0.4; emit(p.x + Math.cos(a) * r, 0.1 + Math.random() * 1.8, p.z + Math.sin(a) * r, -Math.cos(a) * 0.8, 0.6, -Math.sin(a) * 0.8, pick(c.pal), 0.22, 0.4, { t: 'magic', drag: 1 }); }
    flash(c, 18); after(0.03, aura);
  };
  aura();
  after(FB.windup, () => resolveFatal(c, o.y));
}

function resolveFatal(c: Fighter, id: number) {
  setTimeoutBanner();
  const v = opp(c);
  if (S.state !== 'fight' || c.dead || v.dead) return;
  if (!isLocal(v)) return; // the victim's device decides, then tells the attacker (net.fb)
  const dx = v.x - c.x, dz = v.z - c.z, d = Math.hypot(dx, dz) || 1;
  const facing = (dx * Math.sin(c.ry) + dz * Math.cos(c.ry)) / d;
  const dodged = v.dodgeT > 0.08 || v.invT > 0, blocked = v.shieldOn;
  if (d > FB.range || facing < FB.cone || dodged || blocked) {
    if (blocked) { v.shield?.hit(); burst(chest(v), c.pal, 40, 3, 0.5, 0.15, 'star'); }
    dmgText(v, dodged ? TXT.fatalDodged : TXT.fatalBlocked, '#fff');
    return;
  }
  if (S.mode === 'online') net.fb = id;
  startCine(c, v, 'fatal');
}

/** Online: the victim reported that our Fatal Blow connected. */
export function remoteFatalHit(id: number) {
  if (net.lastFb === id) return; net.lastFb = id;
  const me = S.CH[net.me], v = S.CH[1 - net.me];
  if (me && v && S.state === 'fight') startCine(me, v, 'fatal');
}

/* ---------- Fatality (after the deciding round) ---------- */
function fatalityStart(c: Fighter) {
  if (S.state !== 'finish' || cine) return;
  startCine(c, opp(c), 'fatality');
}

/* ---------- the cinematic itself ---------- */
function startCine(att: Fighter, vic: Fighter, kind: Cine['kind']) {
  if (kind === 'fatal') att.fbUsed = true;
  cine = { att, vic, kind, t: 0 };
  S.state = 'cine'; S.stateT = 0; S.slowmo = 0.6;
  banner(kind === 'fatal' ? TXT.fatalBlow : TXT.fatality);
  anim(att, 'beam', { force: true }); anim(vic, 'hit', { once: true, speed: 0.5, force: true });
  play('m_blast', { vol: 1 }); play('m_epic', { vol: 0.9 });
}

/** Elemental show around the victim, by the attacker's element. */
function cineFx(c: Cine, dt: number) {
  const v = chest(c.vic), a = tipPos(c.att), pal = c.att.pal, el = c.att.R.id;
  // A beam from the wand to the victim for the whole scene.
  for (let i = 0; i < 10; i++) { const p = V().lerpVectors(a, v, Math.random()); emit(p.x + rnd(0.05), p.y + rnd(0.05), p.z + rnd(0.05), rnd(0.3), rnd(0.3), rnd(0.3), pick(pal), 0.14, 0.25, { t: 'spark', drag: 2 }); }
  if (el === 'reem') { // meteor rain
    if (Math.random() < dt * 10) { const x = c.vic.x + rnd(1.2), z = c.vic.z + rnd(1.2); explosion(V(x, 0.3, z), pal, 0.7); lightFlash(x, 1, z, pal, 18, 0.3); }
  } else if (el === 'siraj') { // ice spikes closing in
    for (let i = 0; i < 4; i++) { const ang = Math.random() * 6.28, r = 1.4 - c.t * 0.45; emit(c.vic.x + Math.cos(ang) * r, 0.1, c.vic.z + Math.sin(ang) * r, 0, 2.5 + Math.random() * 2, 0, pick(pal), 0.2, 0.5, { t: 'star', grav: -4 }); }
  } else if (el === 'layla') { // shadow tendrils spiralling up
    for (let i = 0; i < 6; i++) { const ang = c.t * 7 + i * 1.05, r = 0.7; emit(c.vic.x + Math.cos(ang) * r, 0.1 + c.t * 0.6, c.vic.z + Math.sin(ang) * r, 0, 1.2, 0, pick(pal), 0.3, 0.7, { t: 'twirl', drag: 1 }); }
  } else if (el === 'ehab') { // the archmage's judgement: a ring of golden runes closing in, then pillars of light
    for (let i = 0; i < 8; i++) { const ang = c.t * 2.5 + i * 0.785, r = Math.max(0.35, 1.6 - c.t * 0.5); emit(c.vic.x + Math.cos(ang) * r, 0.15 + (i % 2) * 1.2, c.vic.z + Math.sin(ang) * r, 0, 0.2, 0, pick(pal), 0.22, 0.35, { t: 'magic' }); }
    if (Math.random() < dt * 3) emit(c.vic.x, 0.05, c.vic.z, 0, 0, 0, pal[1], 0.6, 0.8, { t: 'rune', spin: 2, grow: 3 });
    if (Math.random() < dt * 6) { const x = c.vic.x + rnd(0.6), z = c.vic.z + rnd(0.6); for (let y = 0; y < 7; y += 0.35) emit(x, y, z, 0, 0, 0, pick(pal), 0.35, 0.3, { t: 'glow', spin: 0, a: 0.6 }); lightFlash(x, 2, z, pal, 20, 0.2); }
  } else { // lightning storm
    if (Math.random() < dt * 14) { const x = c.vic.x + rnd(0.8), z = c.vic.z + rnd(0.8); for (let y = 0; y < 8; y += 0.3) emit(x + rnd(0.1), y, z + rnd(0.1), 0, 0, 0, pick(pal), 0.45, 0.2, { t: 'spark' }); lightFlash(x, 2, z, pal, 22, 0.15); play('bolt' + (1 + ((Math.random() * 5) | 0)), { vol: 0.4, x }); }
  }
  flash(c.att, 15); S.shake = Math.max(S.shake, 0.02);
}

/** Called every frame while S.state === 'cine' (real time). */
export function updateCine(rdt: number) {
  const c = cine; if (!c) return;
  c.t += rdt; cineFx(c, rdt);
  if (c.t < FB.cineTime) return;
  cine = null; S.slowmo = 1;
  explosion(chest(c.vic), c.att.pal, 2); lightFlash(c.vic.x, 1.2, c.vic.z, c.att.pal, 30, 0.5); S.shake = 0.3;
  if (c.kind === 'fatal') {
    S.state = 'fight'; banner('');
    if (isLocal(c.vic)) applyDmg(c.vic, Math.round(c.vic.R.hp * FB.dmgFrac), c.att);
    anim(c.att, 'idle', { force: true });
  } else {
    c.vic.dead = true; anim(c.vic, 'death', { once: true, force: true });
    banner(TXT.fatality); S.state = 'ko'; S.stateT = 0;
  }
}

/** Enter the "finish them" phase instead of ending the match at once. */
export function beginFinish(loser: Fighter) {
  S.state = 'finish'; S.stateT = 0; S.slowmo = 1;
  anim(loser, 'hit', { once: true, speed: 0.35, force: true });
  banner(TXT.finishHim(loser.R));
  play('c_chant', { vol: 0.6 });
}

/** Called every frame in 'finish': dazed loser sways; timeout falls back to a normal knockout. */
export function updateFinish(dt: number) {
  const w = S.CH.find(c => c && c.wins >= 2), l = w && opp(w);
  if (!w || !l) return;
  if (Math.random() < dt * 6) { const h = chest(l); emit(h.x + rnd(0.3), h.y + 0.6, h.z + rnd(0.3), 0, 0.2, 0, w.pal[1], 0.1, 0.4, { t: 'star' }); }
  if (S.stateT > FB.finishWindow && !cine) {
    l.dead = true; anim(l, 'death', { once: true, force: true });
    banner(''); S.state = 'ko'; S.stateT = 1.5;
  }
}

/** The computer finishes its opponent too (offline only). */
export function aiFinisher(w: Fighter) { after(1 + Math.random(), () => { if (S.state === 'finish' && Math.random() < 0.7) useFinisher(w); }); }

let bannerTimer = 0;
function setTimeoutBanner() { clearTimeout(bannerTimer); bannerTimer = window.setTimeout(() => { if (S.state === 'fight') banner(''); }, 600); }

Object.assign(SKFX, {
  fatal: (c: Fighter, o: CastOrder) => fatalWindup(c, o),
  fatality: (c: Fighter) => fatalityStart(c),
});
