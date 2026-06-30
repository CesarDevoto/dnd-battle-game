import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, ambient, moon, fire, setFollowUnit, focusCameraOnUnit } from './scene.js';
import { units, corpses } from './units.js';
import { getTerrainHeight } from './terrain.js';
import { registerPostCombatHandler } from './postCombat.js';
import { updateXPBar } from './progression.js';

// Injected at init time to avoid circular deps (both importers of combat.js)
let _removeUnitsFn      = null;
let _loadZoneFn         = null;
let _freezePrecombatFn  = null;
let _endCombatFn        = null;
let _getActiveZoneFn    = null;

// Track the most recent non-styx zone so the outro can teleport heroes back.
let _origZoneId = null;
window.addEventListener('zone:loaded', e => {
  if (e.detail?.id && e.detail.id !== 'river_styx') _origZoneId = e.detail.id;
});

export function initDagna({ removeUnits, loadZone, setPrecombatFrozen, endCombat, getActiveZone }) {
  _removeUnitsFn     = removeUnits;
  _loadZoneFn        = loadZone;
  _freezePrecombatFn = setPrecombatFrozen;
  _endCombatFn       = endCombat;
  _getActiveZoneFn   = getActiveZone;
  _initPortalGeometry();  // pre-build once so GPU buffers upload on frame 1
  _buildDlgPanel();
}

// ── One-time state ────────────────────────────────────────────────────────────
let _heroDiedThisCombat = false;
let _dagnaSeen          = false;   // intro sequence played once per session
let _leugrenLastPos      = new THREE.Vector3(0, 0, 20);

let _inStyxZone      = false;
let _styxKillCount   = 0;
let _styxMissionDone = false;
let _styxDagnaSeen   = false;

// ── Portal ────────────────────────────────────────────────────────────────────
// Pre-built once at init and kept permanently in scene (avoids GPU buffer-upload
// stall on first appearance). Parked at y=-9999 when inactive.
let _portalGrp    = null; // Three.js Group, always in scene after init
let _portalMeshes = null; // { mat, base }[] for opacity pulsing
let _portalPGeo   = null; // particle BufferGeometry
let _portalVels   = null; // particle velocity data
let _portal       = null; // active animation state, null when idle
let _portalLight  = null; // THREE.PointLight added/removed per-sequence

// ── Dagna ─────────────────────────────────────────────────────────────────────
const _loader = new GLTFLoader();
let _dagnaGrp        = null;
let _dagnaMixer      = null;
let _dagnaIdleAction = null;
let _dagnaWalkAction = null;
let _dagnaLight      = null; // THREE.PointLight parented to Dagna's group

// ── Scene light fade ──────────────────────────────────────────────────────────
let _lightFade    = null;  // { t, dur, sAmb, sMoon, sFire, eAmb, eMoon, eFire, cb }
let _savedLights  = null;  // { amb, moon, fire } intensities at dim time
let _lightsDimmed = false;

let _moveActive = false;
let _moveStart  = new THREE.Vector3();
let _moveEnd    = new THREE.Vector3();
let _moveCurr   = 0;
let _moveDur    = 0;
let _moveOnDone = null;

// ── Dialogue ──────────────────────────────────────────────────────────────────
let _dlgEl        = null;
let _lines        = [];
let _lineIdx      = 0;
let _dlgOnDone    = null;
let _forcePreview = false;  // set before async sequence so _showLines picks it up

// ── Kill counter element ──────────────────────────────────────────────────────
let _killsEl = null;

// ═════════════════════════════════════════════════════════════════════════════
//  EXPORTED HOOKS  (called from combat.js)
// ═════════════════════════════════════════════════════════════════════════════

export function onHeroDied(u) {
  if (u.team !== 'blue') return;
  if (u.type === 'dwarf') _leugrenLastPos.copy(u.grp.position);
  if (!_dagnaSeen) _heroDiedThisCombat = true;
}

// Called from endBattle() (party wipe) — Dagna still appears on full defeat.
export function onCombatEnd() {
  if (!_heroDiedThisCombat || _dagnaSeen) return;
  _dagnaSeen = true;
  _heroDiedThisCombat = false;
  _freezePrecombatFn?.(true); // lock movement/aggro for the entire Dagna sequence
  setTimeout(_startIntroA, 800);
}

// Post-combat handler (priority 20): fires after loot panel on victory only.
// When Dagna fires she unregisters herself — this intro happens exactly once.
// After that, no post-combat slot is consumed for this in future combats.
// Intentionally does NOT call done() when firing — zone change is terminal.
const _unregisterDagnaIntro = registerPostCombatHandler(20, (ctx, done) => {
  if (!_heroDiedThisCombat || _dagnaSeen) { done(); return; }
  _dagnaSeen = true;
  _heroDiedThisCombat = false;
  _unregisterDagnaIntro(); // one-shot: remove from hierarchy permanently
  _freezePrecombatFn?.(true); // lock movement/aggro for the entire Dagna sequence
  setTimeout(_startIntroA, 800);
});

export function onEnemyKilled(u) {
  if (u.team !== 'red' || !_inStyxZone || _styxMissionDone) return;
  _styxKillCount++;
  _refreshKills();
  if (_styxKillCount >= 6) _styxMissionDone = true;
}

export function onHeroTurnStart() {
  if (_styxMissionDone && !_styxDagnaSeen) {
    _styxDagnaSeen = true;
    setTimeout(_startOutro, 400);
  }
}

// Called from main.js animation loop
export function tickDagna(dt) {
  _tickLightFade(dt);
  if (_dagnaMixer) _dagnaMixer.update(dt);
  _tickPortal(dt);
  _tickMove(dt);
  // Keep Dagna's world-space light in sync (no longer parented to her group)
  if (_dagnaGrp && _dagnaLight && _dagnaLight.intensity > 0) {
    _dagnaLight.position.set(_dagnaGrp.position.x, _dagnaGrp.position.y + 1.5, _dagnaGrp.position.z);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PORTAL
// ═════════════════════════════════════════════════════════════════════════════

function _initPortalGeometry() {
  const grp = new THREE.Group();
  grp.position.set(-9999, 0, -9999);  // parked off-screen
  grp.rotation.x = -Math.PI / 2;     // flat on the ground
  grp.scale.setScalar(0);

  const rings = [
    { r0: 0.00, r1: 0.55, color: 0x1177ff, op: 0.18 },
    { r0: 0.52, r1: 0.80, color: 0x33ccee, op: 0.48 },
    { r0: 0.78, r1: 1.05, color: 0x00aacc, op: 0.65 },
    { r0: 1.03, r1: 1.28, color: 0x0077cc, op: 0.80 },
    { r0: 1.26, r1: 1.48, color: 0x0044aa, op: 0.88 },
    { r0: 1.46, r1: 1.60, color: 0x99eeff, op: 0.95 },
  ];

  _portalMeshes = rings.map(({ r0, r1, color, op }) => {
    const geo = r0 === 0
      ? new THREE.CircleGeometry(r1, 64)
      : new THREE.RingGeometry(r0, r1, 64);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: op,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;  // always submitted so buffers upload on frame 1
    grp.add(mesh);
    return { mat, base: op };
  });

  const N   = 200;
  _portalPGeo = new THREE.BufferGeometry();
  const pos  = new Float32Array(N * 3);
  _portalVels = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.15 + Math.random() * 1.45;
    pos[i * 3]     = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    _portalVels.push({ a, r, spd: 0.25 + Math.random() * 1.1, dir: Math.random() < 0.5 ? 1 : -1 });
  }
  _portalPGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0x55ddff, size: 0.055, transparent: true, opacity: 0.88, depthWrite: false,
  });
  const pts = new THREE.Points(_portalPGeo, pMat);
  pts.renderOrder = 2;
  pts.frustumCulled = false;
  grp.add(pts);

  grp.frustumCulled = false;
  scene.add(grp);
  _portalGrp = grp;

  // Pre-add both sequence lights at intensity 0 — adding/removing lights mid-scene
  // invalidates the shader cache key for every lit material, causing a freeze.
  // Keeping them permanently avoids any light-count change during gameplay.
  _portalLight = new THREE.PointLight(0x33aaff, 0, 18, 2);
  _portalLight.position.set(-9999, 0, -9999);
  scene.add(_portalLight);

  _dagnaLight = new THREE.PointLight(0xffcc88, 0, 320, 2);
  _dagnaLight.position.set(-9999, 0, -9999);
  scene.add(_dagnaLight);
}

function _activatePortal(x, y, z) {
  _portalGrp.position.set(x, y, z);
  _portalGrp.scale.setScalar(0);
  // Reset mesh opacities to base values
  _portalMeshes.forEach(({ mat, base }) => { mat.opacity = base; });
  _portal = { age: 0, openT: 0 };
}

function _tickPortal(dt) {
  if (!_portal) return;
  _portal.age += dt;

  // Ease-out scale open over 1.2 s
  if (_portal.openT < 1) {
    _portal.openT = Math.min(1, _portal.openT + dt / 1.2);
    const s = 1 - (1 - _portal.openT) ** 2;
    _portalGrp.scale.setScalar(s);
  }

  // Pulse ring opacity
  const pulse = 0.07 * Math.sin(_portal.age * 2.8);
  _portalMeshes.forEach(({ mat, base }) => {
    mat.opacity = Math.max(0.04, base + pulse);
  });

  // Spin particles
  const pa = _portalPGeo.attributes.position;
  _portalVels.forEach((v, i) => {
    v.a += v.spd * v.dir * dt;
    pa.setXY(i, Math.cos(v.a) * v.r, Math.sin(v.a) * v.r);
  });
  pa.needsUpdate = true;
}

function _removePortal() {
  if (_portalLight) { _portalLight.intensity = 0; _portalLight.position.set(-9999, 0, -9999); }
  if (!_portal) return;
  _portalGrp.position.set(-9999, 0, -9999);
  _portalGrp.scale.setScalar(0);
  _portal = null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DAGNA MODEL
// ═════════════════════════════════════════════════════════════════════════════

function _spawnDagna(at, facing, onReady) {
  _loader.load('/assets/models/dagna.glb', gltf => {
    _dagnaGrp = gltf.scene;
    _dagnaGrp.scale.setScalar(1.15);
    _dagnaGrp.position.copy(at);
    _dagnaGrp.position.y += 0.12;
    _dagnaGrp.rotation.y = facing;
    // renderOrder 3 > portal's 2 so Dagna always draws on top of the portal disk
    _dagnaGrp.traverse(n => { if (n.isMesh || n.isSkinnedMesh) n.renderOrder = 3; });
    scene.add(_dagnaGrp);

    // Activate the pre-built warm light (world-space; position tracked in tickDagna)
    _dagnaLight.position.set(_dagnaGrp.position.x, _dagnaGrp.position.y + 1.5, _dagnaGrp.position.z);
    _dagnaLight.intensity = 12;

    const clips = gltf.animations ?? [];
    _dagnaMixer = new THREE.AnimationMixer(_dagnaGrp);

    const idleClip = clips.find(c => /idle/i.test(c.name)) ?? clips[0];
    const walkClip = clips.find(c => /walk/i.test(c.name))
                  ?? clips.find(c => /run/i.test(c.name))
                  ?? clips[1];
    if (idleClip) {
      _dagnaIdleAction = _dagnaMixer.clipAction(idleClip);
      _dagnaIdleAction.play();
    }
    if (walkClip) {
      _dagnaWalkAction = _dagnaMixer.clipAction(walkClip);
    }
    onReady?.();
  });
}

function _removeDagna() {
  if (!_dagnaGrp) return;
  if (_dagnaLight) { _dagnaLight.intensity = 0; _dagnaLight.position.set(-9999, 0, -9999); }
  scene.remove(_dagnaGrp);
  _dagnaGrp = null;
  _dagnaMixer = null;
  _dagnaIdleAction = null;
  _dagnaWalkAction = null;
  _moveActive = false;
  _moveOnDone = null;
}

function _startMove(from, to, dur, onDone) {
  _moveStart.copy(from);
  _moveEnd.copy(to);
  _moveCurr   = 0;
  _moveDur    = dur;
  _moveOnDone = onDone;
  _moveActive = true;
  if (_dagnaIdleAction && _dagnaWalkAction) {
    _dagnaWalkAction.reset().play();
    _dagnaIdleAction.crossFadeTo(_dagnaWalkAction, 0.3, false);
  } else if (_dagnaWalkAction) {
    _dagnaWalkAction.reset().play();
  }
}

function _tickMove(dt) {
  if (!_moveActive || !_dagnaGrp) return;
  _moveCurr = Math.min(_moveCurr + dt, _moveDur);
  _dagnaGrp.position.lerpVectors(_moveStart, _moveEnd, _moveCurr / _moveDur);
  if (_moveCurr >= _moveDur) {
    _moveActive = false;
    if (_dagnaIdleAction && _dagnaWalkAction) {
      _dagnaIdleAction.reset().play();
      _dagnaWalkAction.crossFadeTo(_dagnaIdleAction, 0.3, false);
    } else if (_dagnaWalkAction) {
      _dagnaWalkAction.stop();
    }
    const cb = _moveOnDone;
    _moveOnDone = null;
    cb?.();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  DIALOGUE
// ═════════════════════════════════════════════════════════════════════════════

const _LINES_A = [
  { s: 'Dagna',   t: "Oh, faithful Leugren... what hath become of thy fallen fellowship?" },
  { s: 'Leugren', t: "Who... who are ye?" },
  { s: 'Dagna',   t: "Rest easy child... I am Dagna Ironfaith, disciple of our Lord, the Soul Forger. I have been searching for thee." },
  { s: 'Leugren', t: "Disciple of... our great Father Moradin?" },
  { s: 'Dagna',   t: "Indeed, and may he wash us in his precious light this and all days." },
  { s: 'Leugren', t: "Why has our Father sent ye Dagna?" },
  { s: 'Dagna',   t: "Thy devotion to our blessed Lord hath not gone unnoticed, brave Leugren. Nor the harmony of thy fellowship, forged in this bloody conflict that hath sown death among thee." },
  { s: 'Dagna',   t: "Though death is great misfortune, it is tempered by the great fortune that our Lord Father's eye hath fallen upon thee. He would set a task before thy fellowship — a grim test. Fulfill it, and he shall restore life among thee." },
  { s: 'Leugren', t: "What... trial does our Father ask of us?" },
  { s: 'Dagna',   t: "A trial that if passed shall boon thy fellowship with life's renewal… yet a trial most dire indeed... But take courage in this truth: even the smallest pebble can loose an avalanche mighty enough to entomb kingdoms." },
  { s: 'Dagna',   t: "Come...", goStyx: true },
];

const _LINES_B = [
  { s: 'Dagna',   t: "Behold the River Styx.  Demons pour forth from the curdling rift into this infernal land to exact destruction wherever they may." },
  { s: 'Leugren', t: "Demons!!!" },
  { s: 'Dagna',   t: "And devils shall join them in their dance of death... Are you ready?" },
  { s: 'Leugren', t: "I don't know what we can possibly do here but... yes... we are ready..." },
  { s: 'Dagna',   t: "Your fellowship is to do the Lord's favor and slay six abyssal or infernal foes in our Father's name. Only then shall thy fellowship be fully restored to life." },
  { s: 'Leugren', t: "It shall be done!" },
  { s: 'Dagna',   t: "Stand with honor brother." },
];

const _LINES_OUT = [
  { s: 'Dagna', t: "Victory is yours, brother. Our god has seen fit to restore your lives. Go with honor." },
];

// ── Waystone first-activation dialogue (one-time, any zone) ──────────────────
const _WAYSTONE_FIRST_KEY = 'dlg_waystone_first_seen';
const _LINES_WAYSTONE_FIRST = [
  { s: 'Rasec', t: 'Behold! A waystone is kindled. These stones are woven together by deep magicks. When more awaken to our hand, we need but step upon them and the world shall bend, carrying us among them in the space of a heartbeat. A most useful sorcery this.' },
];

window.addEventListener('waystone:activated', () => {
  try { if (localStorage.getItem(_WAYSTONE_FIRST_KEY)) return; } catch {}
  try { localStorage.setItem(_WAYSTONE_FIRST_KEY, '1'); } catch {}
  showQuickDialogue(_LINES_WAYSTONE_FIRST);
});

const _SCENES = [
  { id: 'dlg_a',   name: 'The Awakening', lines: _LINES_A },
  { id: 'dlg_b',   name: 'River Styx',    lines: _LINES_B },
  { id: 'dlg_out', name: 'Victory',       lines: _LINES_OUT },
];

// Zone-specific event modules register their dialogues here so they appear in the dev panel.
export function registerDialogueScene({ id, name, lines, onDone }) {
  _SCENES.push({ id, name, lines, onDone });
}

let _isPreview = false;

function _buildDlgUI() {
  if (_dlgEl) return;
  _dlgEl = document.createElement('div');
  _dlgEl.id = 'dagna-dialogue';
  _dlgEl.innerHTML = `
    <div class="dagna-dlg-bubble">
      <img class="dagna-dlg-bust" id="dagna-bust"
           src="/assets/Pictures%20Cutscenes%20Icons/dagnabust.jpg" />
      <div class="dagna-dlg-content">
        <div class="dagna-dlg-speaker"></div>
        <div class="dagna-dlg-text"></div>
        <div class="dagna-dlg-footer">
          <button class="dagna-dlg-btn">Continue</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_dlgEl);
  _dlgEl.querySelector('.dagna-dlg-btn').addEventListener('click', _onContinue);
}

export function showQuickDialogue(lines, onDone) { _showLines(lines, onDone); }

// Shows a set of lines then replaces the Continue button with labelled choice buttons.
// choices = [{ label: string, onPick: fn }]
export function showChoiceUI(choices) {
  _buildDlgUI();
  _dlgEl.style.display = 'flex';

  const footer  = _dlgEl.querySelector('.dagna-dlg-footer');
  const origBtn = footer.querySelector('.dagna-dlg-btn');
  origBtn.style.display = 'none';
  footer.style.justifyContent = 'center';
  footer.style.gap = '12px';

  const tempBtns = [];
  for (const ch of choices) {
    const btn = document.createElement('button');
    btn.className = 'dagna-dlg-btn';
    btn.textContent = ch.label;
    btn.addEventListener('click', () => {
      origBtn.style.display = '';
      footer.style.justifyContent = '';
      footer.style.gap = '';
      tempBtns.forEach(b => b.remove());
      _hideDlg();
      ch.onPick?.();
    });
    footer.appendChild(btn);
    tempBtns.push(btn);
  }
}

function _showLines(lines, onDone, preview = false) {
  _isPreview = preview || _forcePreview;
  _forcePreview = false;
  _buildDlgUI();
  _lines     = lines;
  _lineIdx   = 0;
  _dlgOnDone = onDone;
  _renderLine();
  _dlgEl.style.display = 'flex';
}

const _SEQ_DEFS = [
  { id: 'seq_a', name: 'Dagna Entrance', meta: 'Fade · portal · walk · dialogue A' },
  { id: 'seq_b', name: 'River Styx',     meta: 'Portal · walk · dialogue B' },
  { id: 'seq_out', name: 'Victory',      meta: 'Portal · walk · outro dialogue' },
];

function _runSequencePreview(id) {
  document.getElementById('dlg-log-panel').style.display = 'none';
  if (id === 'seq_a') {
    _forcePreview = true;
    _startIntroA();
  } else if (id === 'seq_b') {
    const lp = _getLeugrenPos(), pp = _portalSpot(lp);
    _addPortalLight(pp);
    _openPortalAndWalk(pp, lp, () => _showLines(_LINES_B, null, true));
  } else if (id === 'seq_out') {
    const lp = _getLeugrenPos(), pp = _portalSpot(lp);
    _addPortalLight(pp);
    _openPortalAndWalk(pp, lp, () => _showLines(_LINES_OUT, null, true));
  }
}

function _buildDlgPanel() {
  const el = document.getElementById('dlg-log-entries');
  if (!el) return;
  el.innerHTML = '';

  // ── Sequences section ──
  const seqHdr = document.createElement('div');
  seqHdr.className = 'dlg-panel-section-hdr';
  seqHdr.textContent = 'SEQUENCES';
  el.appendChild(seqHdr);

  for (const sq of _SEQ_DEFS) {
    const row = document.createElement('div');
    row.className = 'dlg-panel-row dlg-panel-seq-row';
    row.innerHTML =
      `<div class="dlg-panel-info">
        <div class="dlg-panel-name">${sq.name}</div>
        <div class="dlg-panel-meta">${sq.meta}</div>
      </div>
      <button class="dlg-panel-play-btn" data-seq="${sq.id}">&#9654;</button>`;
    el.appendChild(row);
  }

  // ── Dialogues section ──
  const dlgHdr = document.createElement('div');
  dlgHdr.className = 'dlg-panel-section-hdr';
  dlgHdr.textContent = 'DIALOGUES';
  el.appendChild(dlgHdr);

  for (const sc of _SCENES) {
    const lineCount = sc.lines.filter(l => l.t).length;
    const row = document.createElement('div');
    row.className = 'dlg-panel-row';
    row.innerHTML =
      `<div class="dlg-panel-info">
        <div class="dlg-panel-name">${sc.name}</div>
        <div class="dlg-panel-meta">${lineCount} lines · 4 Heroes</div>
      </div>
      <button class="dlg-panel-play-btn" data-id="${sc.id}">&#9654;</button>`;
    el.appendChild(row);
  }

  el.addEventListener('click', e => {
    const btn = e.target.closest('.dlg-panel-play-btn');
    if (!btn) return;
    if (btn.dataset.seq) { _runSequencePreview(btn.dataset.seq); return; }
    const sc = _SCENES.find(s => s.id === btn.dataset.id);
    if (!sc) return;
    document.getElementById('dlg-log-panel').style.display = 'none';
    _showLines(sc.lines, sc.onDone ?? null, true);
  });
}

function _hideDlg() {
  if (_dlgEl) _dlgEl.style.display = 'none';
}

const _BUST_SRC = {
  Dagna:   '/assets/Pictures%20Cutscenes%20Icons/dagnabust.jpg',
  Leugren: '/assets/Pictures%20Cutscenes%20Icons/leugrenbust.jpg',
  Milo:    '/assets/Pictures%20Cutscenes%20Icons/milobust.jpg',
  Gobo:    '/assets/Pictures%20Cutscenes%20Icons/Gobobust.jpg',
  Rasec:   '/assets/Pictures%20Cutscenes%20Icons/Rasecbust.jpg',
  Floosh:  '/assets/Pictures%20Cutscenes%20Icons/grassling.jpg',
};

function _renderLine() {
  const l = _lines[_lineIdx];
  const isDagna   = l.s === 'Dagna';
  const _SPEAKER_CLS = { Leugren: 'dlg-speaker-leugren', Milo: 'dlg-speaker-milo', Gobo: 'dlg-speaker-gobo', Rasec: 'dlg-speaker-rasec', Floosh: 'dlg-speaker-floosh' };
  const speakerEl = _dlgEl.querySelector('.dagna-dlg-speaker');
  speakerEl.textContent = l.s;
  speakerEl.className   = 'dagna-dlg-speaker' + (isDagna ? '' : ` ${_SPEAKER_CLS[l.s] ?? 'dlg-speaker-leugren'}`);
  _dlgEl.querySelector('.dagna-dlg-text').textContent = l.t;
  _dlgEl.querySelector('#dagna-bust').src = _BUST_SRC[l.s] ?? _BUST_SRC.Dagna;
  const isLast = _lineIdx === _lines.length - 1;
  _dlgEl.querySelector('.dagna-dlg-btn').textContent = isLast ? 'Close' : 'Continue';
}

function _previewCleanup() {
  _removeDagna();
  _removePortal();
  if (_lightsDimmed) _restoreLights(1.4);
  _freezePrecombatFn?.(false);
}

function _onContinue() {
  const l = _lines[_lineIdx];
  if (l?.goStyx) {
    if (!_isPreview) { _hideDlg(); _doStyxTransition(); return; }
    _hideDlg();
    _previewCleanup();
    return;
  }
  _lineIdx++;
  if (_lineIdx >= _lines.length) {
    _hideDlg();
    const cb = _dlgOnDone;
    _dlgOnDone = null;
    if (_isPreview) _previewCleanup();
    cb?.();
  } else {
    _renderLine();
  }
}

// ── Light fade helpers ────────────────────────────────────────────────────────
function _dimLights(dur, cb) {
  _savedLights  = { amb: ambient.intensity, moon: moon.intensity, fire: fire.intensity };
  _lightsDimmed = true;
  _lightFade = {
    t: 0, dur,
    sAmb: ambient.intensity, sMoon: moon.intensity, sFire: fire.intensity,
    eAmb: 0,                 eMoon: 0,              eFire: 0,
    cb,
  };
}

function _restoreLights(dur) {
  if (!_savedLights) return;
  _lightFade = {
    t: 0, dur,
    sAmb: ambient.intensity, sMoon: moon.intensity, sFire: fire.intensity,
    eAmb: _savedLights.amb,  eMoon: _savedLights.moon, eFire: _savedLights.fire,
    cb: () => { _lightsDimmed = false; _savedLights = null; },
  };
}

function _tickLightFade(dt) {
  if (!_lightFade) return;
  _lightFade.t = Math.min(_lightFade.t + dt, _lightFade.dur);
  const p    = _lightFade.dur > 0 ? _lightFade.t / _lightFade.dur : 1;
  const ease = p * p * (3 - 2 * p);  // smoothstep
  ambient.intensity = _lightFade.sAmb  + (_lightFade.eAmb  - _lightFade.sAmb)  * ease;
  moon.intensity    = _lightFade.sMoon + (_lightFade.eMoon - _lightFade.sMoon) * ease;
  fire.intensity    = _lightFade.sFire + (_lightFade.eFire - _lightFade.sFire) * ease;
  if (_lightFade.t >= _lightFade.dur) {
    const cb = _lightFade.cb;
    _lightFade = null;
    cb?.();
  }
}

function _addPortalLight(pp) {
  _portalLight.position.set(pp.x, pp.y + 1.2, pp.z);
  _portalLight.intensity = 14;
}

// ═════════════════════════════════════════════════════════════════════════════
//  SEQUENCES
// ═════════════════════════════════════════════════════════════════════════════

function _getLeugrenPos() {
  const u = units.find(u => u.team === 'blue' && u.type === 'dwarf');
  if (u) return u.grp.position;
  const any = units.find(u => u.team === 'blue');
  if (any) return any.grp.position;
  return _leugrenLastPos;
}

function _portalSpot(lp) {
  const px = lp.x + 7.5;  // 25 ft ≈ 7.5 WU
  const pz = lp.z;
  // Sample terrain at center + 8 points around the portal edge (r=1.65 WU)
  // so the flat disk always clears the highest terrain point beneath it
  const R = 1.65;
  let maxY = getTerrainHeight(px, pz);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    maxY = Math.max(maxY, getTerrainHeight(px + Math.cos(a) * R, pz + Math.sin(a) * R));
  }
  return { x: px, y: maxY + 0.10, z: pz };
}

function _openPortalAndWalk(pp, lp, onArrived) {
  _activatePortal(pp.x, pp.y, pp.z);
  // Wait for portal open animation before spawning Dagna inside it
  setTimeout(() => {
    const gy       = getTerrainHeight(lp.x, lp.z) + 0.05;
    const spawnAt  = new THREE.Vector3(pp.x, gy, pp.z);
    const walkTo   = new THREE.Vector3(lp.x + 3.8, gy, lp.z);
    const facing   = Math.atan2(walkTo.x - spawnAt.x, walkTo.z - spawnAt.z);
    _spawnDagna(spawnAt, facing, () => {
      _startMove(spawnAt, walkTo, 4.0, onArrived);
    });
  }, 1350);
}

// ── Intro part A: fires after first combat ends in which a hero died ──────────
function _startIntroA() {
  // 1. Fade scene to black, then reveal portal and Dagna
  _dimLights(1.6, () => {
    const leugren = units.find(u => u.team === 'blue' && u.type === 'dwarf');
    if (leugren) setFollowUnit(leugren);
    else focusCameraOnUnit({ grp: { position: _leugrenLastPos } });

    const lp = _getLeugrenPos();
    const pp = _portalSpot(lp);
    _addPortalLight(pp);          // 2. Portal glow appears in darkness
    _openPortalAndWalk(pp, lp, () => {
      _showLines(_LINES_A, null); // 3. Dagna (with her own light) has arrived
    });
  });
}

// ── Zone transition on "Come..." ──────────────────────────────────────────────
function _doStyxTransition() {
  _removeDagna();
  _removePortal();

  // Save hero progression before the rebuild so XP/level survive the zone transition
  const _savedProg = {};
  units.filter(u => u.team === 'blue').forEach(u => {
    _savedProg[u.type] = { xp: u.xp ?? 0, level: u.level ?? 1, hpFrac: u.hpFrac ?? 0 };
  });

  // Clear all blue units + corpses — loadZone will rebuild all 4 heroes fresh
  if (_removeUnitsFn) _removeUnitsFn(u => u.team === 'blue');
  for (let i = corpses.length - 1; i >= 0; i--) {
    if (corpses[i].team === 'blue') {
      scene.remove(corpses[i].grp);
      corpses.splice(i, 1);
    }
  }

  if (_loadZoneFn) _loadZoneFn('river_styx', false);

  // Restore XP/level on the freshly built heroes (buildUnit resets these to 0/1)
  units.filter(u => u.team === 'blue').forEach(u => {
    const p = _savedProg[u.type];
    if (!p) return;
    u.xp     = p.xp;
    u.level  = p.level;
    u.hpFrac = p.hpFrac;
  });
  updateXPBar();
  _inStyxZone = true;
  _freezePrecombatFn?.(true);  // hold all enemy movement until dialogue B ends

  // Brief wait for terrain/props/heroes to settle, then part B
  setTimeout(_startIntroB, 2200);
}

// ── Intro part B: first dialogue in River Styx ────────────────────────────────
function _startIntroB() {
  // Pan camera to Leugren in the new zone
  const leugren = units.find(u => u.team === 'blue' && u.type === 'dwarf');
  if (leugren) {
    setFollowUnit(leugren);
  } else {
    const anyBlue = units.find(u => u.team === 'blue');
    if (anyBlue) setFollowUnit(anyBlue);
  }

  const lp = _getLeugrenPos();
  const pp = _portalSpot(lp);
  _openPortalAndWalk(pp, lp, () => {
    _showLines(_LINES_B, () => {
      _removeDagna();
      _removePortal();
      _showKills();
      _freezePrecombatFn?.(false);  // enemies can now roam, detect, and aggro
    });
  });
}

// ── Outro: fires on next hero turn after 6 kills ──────────────────────────────
function _startOutro() {
  _inStyxZone = false;
  _hideKills();

  // End combat immediately — skips loot/post-combat chain.
  // forceCombatExit fires combat:ended which calls enterPrecombat (unfrozen).
  // Immediately re-freeze so _checkAggro can't fire while heroes are still at
  // River Styx coordinates during the zone transition.
  _endCombatFn?.();
  _freezePrecombatFn?.(true);

  // Blinding white flash covers the zone transition
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;z-index:9999;pointer-events:none;transition:opacity 0.08s ease-in';
  document.body.appendChild(flash);

  requestAnimationFrame(() => {
    flash.style.opacity = '1';

    // Load origin zone while screen is white; restore HP
    setTimeout(() => {
      if (_loadZoneFn) _loadZoneFn(_origZoneId ?? 'mausoleum', false);
      units.filter(u => u.team === 'blue').forEach(u => { u.hp = u.maxHp; });

      // Fade out over 1.4 s — zone has settled by the time it clears
      flash.style.transition = 'opacity 1.4s ease-out';
      flash.style.opacity = '0';

      setTimeout(() => {
        flash.remove();
        // Place heroes around the waystone first, then unfreeze so enemies
        // detect from the correct hero positions rather than Styx coordinates.
        _positionHeroesFormation();
        _freezePrecombatFn?.(false);
        const leugren = units.find(u => u.team === 'blue' && u.type === 'dwarf');
        if (leugren) setFollowUnit(leugren);
      }, 1400);
    }, 200);
  });
}

// Place heroes around the waystone in the returned-to zone.
// Fallback: use the zone's heroEntry positions if no waystone is present.
function _positionHeroesFormation() {
  // Try to find a waystone in the scene (set synchronously when the zone prop group is created).
  const wp = new THREE.Vector3();
  let waystoneFound = false;
  scene.traverse(obj => {
    if (obj.userData?.waystoneId) { obj.getWorldPosition(wp); waystoneFound = true; }
  });

  if (waystoneFound) {
    // Position heroes a few WU behind the waystone (toward zone interior).
    const ax = wp.x, az = wp.z + 4;
    const FORM = [
      { type: 'dwarf',    ox: -1, oz:  0 },
      { type: 'halfling', ox:  1, oz:  0 },
      { type: 'human',    ox: -1, oz:  2 },
      { type: 'elf',      ox:  1, oz:  2 },
    ];
    FORM.forEach(({ type, ox, oz }) => {
      const u = units.find(u => u.team === 'blue' && u.type === type);
      if (!u) return;
      const x = ax + ox, z = az + oz;
      const y = getTerrainHeight(x, z);
      u.grp.position.set(x, y, z);
      if (u.anchor) { u.anchor.x = x; u.anchor.y = y; u.anchor.z = z; }
    });
    return;
  }

  // No waystone in zone — use heroEntry positions from the active zone.
  const entry = _getActiveZoneFn?.()?.heroEntry;
  if (entry?.length) {
    entry.forEach(({ type, x, z }) => {
      const u = units.find(u => u.team === 'blue' && u.type === type);
      if (!u) return;
      const y = getTerrainHeight(x, z);
      u.grp.position.set(x, y, z);
      if (u.anchor) { u.anchor.x = x; u.anchor.y = y; u.anchor.z = z; }
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  KILL COUNTER
// ═════════════════════════════════════════════════════════════════════════════

function _showKills() {
  if (!_killsEl) {
    _killsEl = document.createElement('div');
    _killsEl.id = 'styx-kills';
    _killsEl.innerHTML =
      `Kills &nbsp;<span id="styx-kills-n">0</span>` +
      `<span class="styx-kills-sep"> / </span>` +
      `<span class="styx-kills-goal">6</span>`;
    document.body.appendChild(_killsEl);
  }
  _killsEl.style.display = 'flex';
  _refreshKills();
}

function _hideKills() {
  if (_killsEl) _killsEl.style.display = 'none';
}

function _refreshKills() {
  const n = document.getElementById('styx-kills-n');
  if (n) n.textContent = _styxKillCount;
}
