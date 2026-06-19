import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, setFollowUnit, focusCameraOnUnit } from './scene.js';
import { units, corpses } from './units.js';
import { getTerrainHeight } from './terrain.js';

// Injected at init time to avoid circular deps (both importers of combat.js)
let _removeUnitsFn      = null;
let _loadZoneFn         = null;
let _freezePrecombatFn  = null;

export function initDagna({ removeUnits, loadZone, setPrecombatFrozen }) {
  _removeUnitsFn     = removeUnits;
  _loadZoneFn        = loadZone;
  _freezePrecombatFn = setPrecombatFrozen;
}

// ── One-time state ────────────────────────────────────────────────────────────
let _heroDiedThisCombat = false;
let _dagnaSeen           = false;   // intro sequence played once per session
let _leugrenLastPos      = new THREE.Vector3(0, 0, 20);

let _inStyxZone      = false;
let _styxKillCount   = 0;
let _styxMissionDone = false;
let _styxDagnaSeen   = false;

// ── Portal ────────────────────────────────────────────────────────────────────
let _portal = null; // { grp, meshes, pGeo, vels, age, openT }

// ── Dagna ─────────────────────────────────────────────────────────────────────
const _loader = new GLTFLoader();
let _dagnaGrp        = null;
let _dagnaMixer      = null;
let _dagnaWalkAction = null;

let _moveActive = false;
let _moveStart  = new THREE.Vector3();
let _moveEnd    = new THREE.Vector3();
let _moveCurr   = 0;
let _moveDur    = 0;
let _moveOnDone = null;

// ── Dialogue ──────────────────────────────────────────────────────────────────
let _dlgEl     = null;
let _lines     = [];
let _lineIdx   = 0;
let _dlgOnDone = null;

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

export function onCombatEnd() {
  if (!_heroDiedThisCombat || _dagnaSeen) return;
  _dagnaSeen = true;
  _heroDiedThisCombat = false;
  setTimeout(_startIntroA, 800);
}

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
  if (_dagnaMixer) _dagnaMixer.update(dt);
  _tickPortal(dt);
  _tickMove(dt);
}

// ═════════════════════════════════════════════════════════════════════════════
//  PORTAL
// ═════════════════════════════════════════════════════════════════════════════

function _buildPortal(x, y, z) {
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.x = -Math.PI / 2;  // flat on the ground
  grp.scale.setScalar(0);

  // Layered rings: center fill → outer glow edge
  const rings = [
    { r0: 0.00, r1: 0.55, color: 0x1177ff, op: 0.18 },
    { r0: 0.52, r1: 0.80, color: 0x33ccee, op: 0.48 },
    { r0: 0.78, r1: 1.05, color: 0x00aacc, op: 0.65 },
    { r0: 1.03, r1: 1.28, color: 0x0077cc, op: 0.80 },
    { r0: 1.26, r1: 1.48, color: 0x0044aa, op: 0.88 },
    { r0: 1.46, r1: 1.60, color: 0x99eeff, op: 0.95 },
  ];

  const meshes = rings.map(({ r0, r1, color, op }) => {
    const geo = r0 === 0
      ? new THREE.CircleGeometry(r1, 64)
      : new THREE.RingGeometry(r0, r1, 64);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: op,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;  // after opaque terrain/env (0) so depth test works; characters still occlude it
    grp.add(mesh);
    return { mat, base: op };
  });

  // Swirling particles (in group's local XY → world XZ after rotation)
  const N   = 200;
  const pGeo = new THREE.BufferGeometry();
  const pos  = new Float32Array(N * 3);
  const vels = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.15 + Math.random() * 1.45;
    pos[i * 3]     = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    vels.push({ a, r, spd: 0.25 + Math.random() * 1.1, dir: Math.random() < 0.5 ? 1 : -1 });
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0x55ddff, size: 0.055, transparent: true, opacity: 0.88, depthWrite: false,
  });
  const pts = new THREE.Points(pGeo, pMat);
  pts.renderOrder = 2;
  grp.add(pts);

  scene.add(grp);
  _portal = { grp, meshes, pGeo, vels, age: 0, openT: 0 };
}

function _tickPortal(dt) {
  if (!_portal) return;
  _portal.age += dt;

  // Ease-out scale open over 1.2 s
  if (_portal.openT < 1) {
    _portal.openT = Math.min(1, _portal.openT + dt / 1.2);
    const s = 1 - (1 - _portal.openT) ** 2;
    _portal.grp.scale.setScalar(s);
  }

  // Pulse ring opacity
  const pulse = 0.07 * Math.sin(_portal.age * 2.8);
  _portal.meshes.forEach(({ mat, base }) => {
    mat.opacity = Math.max(0.04, base + pulse);
  });

  // Spin particles
  const pa = _portal.pGeo.attributes.position;
  _portal.vels.forEach((v, i) => {
    v.a += v.spd * v.dir * dt;
    pa.setXY(i, Math.cos(v.a) * v.r, Math.sin(v.a) * v.r);
  });
  pa.needsUpdate = true;
}

function _removePortal() {
  if (!_portal) return;
  scene.remove(_portal.grp);
  _portal = null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DAGNA MODEL
// ═════════════════════════════════════════════════════════════════════════════

function _spawnDagna(at, facing, onReady) {
  _loader.load('/assets/models/dagna.glb', gltf => {
    _dagnaGrp = gltf.scene;
    _dagnaGrp.position.copy(at);
    _dagnaGrp.rotation.y = facing;
    scene.add(_dagnaGrp);

    const clips = gltf.animations ?? [];
    _dagnaMixer = new THREE.AnimationMixer(_dagnaGrp);

    const walkClip = clips.find(c => /walk/i.test(c.name))
                  ?? clips.find(c => /run/i.test(c.name))
                  ?? clips[1]
                  ?? clips[0];
    if (walkClip) {
      _dagnaWalkAction = _dagnaMixer.clipAction(walkClip);
      _dagnaWalkAction.play();
    }
    onReady?.();
  });
}

function _removeDagna() {
  if (!_dagnaGrp) return;
  scene.remove(_dagnaGrp);
  _dagnaGrp = null;
  _dagnaMixer = null;
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
}

function _tickMove(dt) {
  if (!_moveActive || !_dagnaGrp) return;
  _moveCurr = Math.min(_moveCurr + dt, _moveDur);
  _dagnaGrp.position.lerpVectors(_moveStart, _moveEnd, _moveCurr / _moveDur);
  if (_moveCurr >= _moveDur) {
    _moveActive = false;
    if (_dagnaWalkAction) { _dagnaWalkAction.stop(); _dagnaWalkAction = null; }
    const cb = _moveOnDone;
    _moveOnDone = null;
    cb?.();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  DIALOGUE
// ═════════════════════════════════════════════════════════════════════════════

const _LINES_A = [
  { s: 'Dagna',   t: "Death has embraced thy fellowship disciple Leugren... but yer harmony in battle did not go unnoticed." },
  { s: 'Leugren', t: "Who are ye?" },
  { s: 'Dagna',   t: "I am Dagna Ironfaith.  Our lord, the Soul Forger offers yer fellowship renewal — if yer worthy." },
  { s: 'Leugren', t: "Bless ye Moradin!  Lord Father Creator! Yes Dagna! How might we prove our worth!" },
  { s: 'Dagna',   t: "Have ye heard of the eternal Blood War?" },
  { s: 'Leugren', t: "Fables speak of abyssal and infernal horrors locked in endless struggle in outer planes." },
  { s: 'Dagna',   t: "Precisely.  For a chance at life's renewal, ye and yer fellowship must now play a small part." },
  { s: 'Leugren', t: "Anything is better than death!  What must we do?" },
  { s: 'Dagna',   t: "Yer souls are temporarily delivered to Avernus - first of the Nine Hells - where the wretched River Styx burns." },
  { s: 'Leugren', t: "But... but if death came so easily among us in this mortal realm how does our Lord expect us to..." },
  { s: 'Dagna',   t: "Yes. Your talents are feeble things, barely fledged. But remember this — Even the smallest pebble can start an avalanche that buries mountains." },
  { s: 'Dagna',   t: "Come...", goStyx: true },
];

const _LINES_B = [
  { s: 'Dagna',   t: "Behold the River Styx.  Demons pour forth from the curdling rift into this infernal land to exact destruction wherever they may." },
  { s: 'Leugren', t: "Demons!!!" },
  { s: 'Dagna',   t: "And devils shall join them in their dance of death... Are you ready?" },
  { s: 'Leugren', t: "I don't know what we can possibly do here but... yes... we are ready..." },
  { s: 'Dagna',   t: "Your fellowship is to do the Lord's favor and slay six abyssal or infernal foes in our Father's name.  Only then shall ye be restored to life." },
  { s: 'Leugren', t: "It shall be done!" },
  { s: 'Dagna',   t: "Stand with honor brother." },
];

const _LINES_OUT = [
  { s: 'Dagna', t: "Victory is yours, brother. Our god has seen fit to restore your lives. Go with honor." },
];

function _buildDlgUI() {
  if (_dlgEl) return;
  _dlgEl = document.createElement('div');
  _dlgEl.id = 'dagna-dialogue';
  _dlgEl.innerHTML = `
    <div class="dagna-dlg-row">
      <img class="dagna-dlg-bust" id="dagna-bust-left"
           src="/assets/Pictures%20Cutscenes%20Icons/dagnabust.jpg" />
      <div class="dagna-dlg-bubble">
        <div class="dagna-dlg-speaker"></div>
        <div class="dagna-dlg-text"></div>
        <div class="dagna-dlg-footer">
          <button class="dagna-dlg-btn">Continue</button>
        </div>
      </div>
      <img class="dagna-dlg-bust" id="dagna-bust-right"
           src="/assets/Pictures%20Cutscenes%20Icons/leugrenbust.jpg" />
    </div>`;
  document.body.appendChild(_dlgEl);
  _dlgEl.querySelector('.dagna-dlg-btn').addEventListener('click', _onContinue);
}

function _showLines(lines, onDone) {
  _buildDlgUI();
  _lines     = lines;
  _lineIdx   = 0;
  _dlgOnDone = onDone;
  _renderLine();
  _dlgEl.style.display = 'flex';
}

function _hideDlg() {
  if (_dlgEl) _dlgEl.style.display = 'none';
}

function _renderLine() {
  const l = _lines[_lineIdx];
  const isDagna = l.s === 'Dagna';
  _dlgEl.querySelector('.dagna-dlg-speaker').textContent = l.s;
  _dlgEl.querySelector('.dagna-dlg-text').textContent    = l.t;
  _dlgEl.querySelector('#dagna-bust-left').style.visibility  = isDagna  ? 'visible' : 'hidden';
  _dlgEl.querySelector('#dagna-bust-right').style.visibility = !isDagna ? 'visible' : 'hidden';
  const isLast = _lineIdx === _lines.length - 1;
  _dlgEl.querySelector('.dagna-dlg-btn').textContent = isLast ? 'Farewell' : 'Continue';
}

function _onContinue() {
  const l = _lines[_lineIdx];
  if (l?.goStyx) {
    _hideDlg();
    _doStyxTransition();
    return;
  }
  _lineIdx++;
  if (_lineIdx >= _lines.length) {
    _hideDlg();
    const cb = _dlgOnDone;
    _dlgOnDone = null;
    cb?.();
  } else {
    _renderLine();
  }
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
  const px = lp.x + 4.5;  // 15 ft ≈ 4.5 WU
  return { x: px, y: getTerrainHeight(px, lp.z) + 0.06, z: lp.z };
}

function _openPortalAndWalk(pp, lp, onArrived) {
  _buildPortal(pp.x, pp.y, pp.z);
  // Wait for portal open animation before spawning Dagna inside it
  setTimeout(() => {
    const gy       = getTerrainHeight(lp.x, lp.z) + 0.05;
    const spawnAt  = new THREE.Vector3(pp.x, gy, pp.z);
    const walkTo   = new THREE.Vector3(lp.x + 0.8, gy, lp.z);
    const facing   = Math.atan2(walkTo.x - spawnAt.x, walkTo.z - spawnAt.z);
    _spawnDagna(spawnAt, facing, () => {
      _startMove(spawnAt, walkTo, 4.0, onArrived);
    });
  }, 1350);
}

// ── Intro part A: fires after first combat ends in which a hero died ──────────
function _startIntroA() {
  // Pan camera to Leugren before the portal opens
  const leugren = units.find(u => u.team === 'blue' && u.type === 'dwarf');
  if (leugren) {
    setFollowUnit(leugren);
  } else {
    focusCameraOnUnit({ grp: { position: _leugrenLastPos } });
  }

  const lp = _getLeugrenPos();
  const pp = _portalSpot(lp);
  _openPortalAndWalk(pp, lp, () => {
    _showLines(_LINES_A, null);
  });
}

// ── Zone transition on "Come..." ──────────────────────────────────────────────
function _doStyxTransition() {
  _removeDagna();
  _removePortal();

  // Clear all blue units + corpses — loadZone will rebuild all 4 heroes fresh
  if (_removeUnitsFn) _removeUnitsFn(u => u.team === 'blue');
  for (let i = corpses.length - 1; i >= 0; i--) {
    if (corpses[i].team === 'blue') {
      scene.remove(corpses[i].grp);
      corpses.splice(i, 1);
    }
  }

  if (_loadZoneFn) _loadZoneFn('river_styx', false);
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
  const lp = _getLeugrenPos();
  const pp = _portalSpot(lp);
  _openPortalAndWalk(pp, lp, () => {
    _showLines(_LINES_OUT, () => {
      _removeDagna();
      _removePortal();
      _hideKills();
      // Narrative "lives restored" — restore hero HP
      units.filter(u => u.team === 'blue').forEach(u => { u.hp = u.maxHp; });
    });
  });
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
