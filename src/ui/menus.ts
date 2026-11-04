import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { S, inMenus } from '../game/state';
import { base } from '../fighters/fighter';
import { findBone, retarget } from '../assets/loader';
import { play, unlock, isMuted, setMuted, musicOn } from '../audio/audio';
import { setupFighters, startMatch, showcase, toMenu } from '../game/flow';
import { code4, leaveNet, onlineStart } from '../net/online';
import { ROSTER, skillLabel } from '../data/roster';
import { TXT } from '../data/text';
import { $, V } from '../core/util';

const portraits: string[] = [];

/** Renders one lit head-and-shoulders portrait per wizard into data URLs (offscreen renderer, then disposed). */
export function makePortraits() {
  const W = 240, H = 300;
  const r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r2.setSize(W, H); r2.outputColorSpace = THREE.SRGBColorSpace; r2.toneMapping = THREE.ACESFilmicToneMapping;
  const cam = new THREE.PerspectiveCamera(26, W / H, 0.05, 20);
  ROSTER.forEach((R, i) => {
    const sc = new THREE.Scene(); const m = SkeletonUtils.clone(base[i]); m.rotation.y = -0.35; sc.add(m);
    const mx = new THREE.AnimationMixer(m); mx.clipAction(retarget('idle', m)).play(); mx.update(1.2);
    sc.add(new THREE.HemisphereLight(0x8090c0, 0x101018, 1.4));
    const key = new THREE.DirectionalLight(R.lc, 3.2); key.position.set(-1.5, 2, 1.5); sc.add(key);
    const rim = new THREE.DirectionalLight(0x9db4ff, 2.2); rim.position.set(1.5, 2, -1.5); sc.add(rim);
    const fill = new THREE.PointLight(R.lc, 6, 4, 1.5); fill.position.set(0.4, 1.3, 0.8); sc.add(fill);
    m.updateMatrixWorld(true);
    const head = findBone(m, /Head$/); const hp = V(0, 1.55, 0); if (head) head.getWorldPosition(hp);
    cam.position.set(hp.x - 0.25, hp.y - 0.05, hp.z + 1.55); cam.lookAt(hp.x, hp.y - 0.28, hp.z);
    r2.render(sc, cam); portraits[i] = r2.domElement.toDataURL('image/png'); mx.stopAllAction();
  });
  r2.dispose(); r2.forceContextLoss();
}

/** Character select: portrait grid + story, stats and abilities of the selected wizard. */
export function buildRoster() {
  const roster = $('roster');
  roster.replaceChildren(...ROSTER.map((r, i) => {
    const b = document.createElement('button');
    b.className = 'cc' + (i === S.sel ? ' on' : ''); b.dataset.i = String(i); b.style.setProperty('--c', r.css);
    const img = document.createElement('img'); img.alt = r.name; img.src = portraits[i] || '';
    const name = document.createElement('b'); name.textContent = r.name;
    b.append(img, name);
    b.onclick = () => { unlock(); if (S.sel === i) return; S.sel = i; buildRoster(); showcase(); play(ROSTER[S.sel].ss, { vol: 0.5 }); };
    return b;
  }));
  const R = ROSTER[S.sel];
  $('detail').style.setProperty('--c', R.css);
  $('dName').textContent = R.name; $('dElem').textContent = R.elem; $('dStory').textContent = R.story;
  $('dStats').replaceChildren(...([[TXT.stats.hp, R.stat[0], String(R.hp)], [TXT.stats.speed, R.stat[1], R.speed.toFixed(1)], [TXT.stats.power, R.stat[2], '']] as const).flatMap(([n, v, t]) => {
    const s = document.createElement('span'); s.textContent = n;
    const i = document.createElement('i'); i.style.setProperty('--v', String(v));
    const e = document.createElement('em'); e.textContent = t;
    return [s, i, e];
  }));
  $('dAb').replaceChildren(...R.ab.map(([k, n, d]) => {
    const row = document.createElement('div'); row.className = 'abl';
    const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
    const nn = document.createElement('b'); nn.textContent = n;
    const dd = document.createElement('span'); dd.textContent = d;
    row.append(kk, nn, dd); return row;
  }));
  $('bSk').textContent = skillLabel(R);
}

export function initMenus() {
  $('mute').onclick = () => {
    unlock(); setMuted(!isMuted());
    $('mute').textContent = isMuted() ? TXT.muteOn : TXT.muteOff;
    if (!isMuted() && S.state !== 'menu') musicOn();
  };
  $('enter').onclick = () => { unlock(); $('title').hidden = true; $('menu').hidden = false; S.state = 'menu'; showcase(); play('m_drums', { vol: 0.6 }); };
  $('backTitle').onclick = () => { $('menu').hidden = true; $('title').hidden = false; S.state = 'title'; };
  $('diff').querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
    S.diff = +(b.dataset.d || 1);
    $('diff').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('mAI').onclick = () => {
    unlock(); S.mode = 'ai'; $('menu').hidden = true;
    let o = (Math.random() * 3) | 0; if (o >= S.sel) o++;
    setupFighters(S.sel, o); startMatch();
  };
  $('mOn').onclick = () => { unlock(); $('menu').hidden = true; $('online').hidden = false; $('oWait').hidden = true; $('oErr').hidden = true; S.state = 'online'; };
  $('oBack').onclick = () => { leaveNet(); $('online').hidden = true; $('menu').hidden = false; S.state = 'menu'; };
  $('oCreate').onclick = async () => { unlock(); const c = code4(); $('oCode').textContent = c; $('oWait').hidden = false; $('oErr').hidden = true; await onlineStart(true, c); };
  $('oJoin').onclick = async () => {
    unlock(); const c = $<HTMLInputElement>('code').value.trim().toUpperCase();
    if (c.length !== 4) { $('oErr').hidden = false; $('oErr').textContent = TXT.online.badCode; return; }
    $('oErr').hidden = true; $('onTxt').textContent = TXT.online.searching; await onlineStart(false, c);
  };
  $('again').onclick = () => { unlock(); $('end').hidden = true; startMatch(); };
  $('toMenu').onclick = toMenu;
}

export { inMenus };
