import * as THREE from 'three';
import { scene, camera, renderer } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { showQuickDialogue, showChoiceUI, registerDialogueScene } from './dagnaEvent.js';
import { units, setUnitWalking } from './units.js';
import { addQuest } from './quests.js';
import { mkExclamationMarker } from './propBuilders.js';
import { isMarkerSeen, setMarkerSeen } from './exclamationMarkers.js';
import { isPrecombat } from './precombat.js';
import { registerPostCombatHandler } from './postCombat.js';
import { getQuestFlag } from './quests.js';
import { isDevMode } from './devMode.js';

// ── Floosh guide system ───────────────────────────────────────────────────────
// After quest accepted, Floosh walks NE toward the haunted_wood portal (82, -82).
// He stops if no hero is within 40 ft (16 WU) and resumes when one gets close.
// During combat he sinks into terrain; on post-combat he rises and says "Shall we?"

const _GUIDE_WAYPOINTS = [
  { x: 20,  z: 58 },
  { x: 36,  z: 40 },
  { x: 52,  z: 18 },
  { x: 66,  z:  -8 },
  { x: 76,  z: -45 },
  { x: 82,  z: -78 },
];
let _waypointMarkers = [];

function _spawnWaypointMarkers() {
  _clearWaypointMarkers();
  const geo = new THREE.SphereGeometry(0.35, 8, 8);
  _GUIDE_WAYPOINTS.forEach((wp, i) => {
    const mat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0x00ffff : 0xff6600, wireframe: false });
    const m   = new THREE.Mesh(geo, mat);
    m.position.set(wp.x, getTerrainHeight(wp.x, wp.z) + 0.5, wp.z);
    m.frustumCulled = false;
    scene.add(m);
    _waypointMarkers.push(m);
  });
}

function _clearWaypointMarkers() {
  _waypointMarkers.forEach(m => { m.geometry.dispose(); m.material.dispose(); scene.remove(m); });
  _waypointMarkers = [];
}

const _GUIDE_SPEED   = 3.5;    // WU/s
const _GUIDE_STOP_SQ = 16 * 16; // 40 ft = 16 WU squared
const _SINK_SPEED    = 2.0;    // WU/s sink/rise rate
const _SINK_DEPTH    = 1.8;    // WU below terrain when hidden

let _guiding      = false;
let _guideDone    = false;
let _guideWpIdx   = 0;
let _flooshUnit   = null;
let _guideBaseY   = 0;
let _guidePaused  = false;
let _guideSinking = false;
let _guideSunk    = false; // true while underground, prevents movement until post-combat rises Floosh
let _guideRising  = false;
let _shallWeDone  = null; // post-combat done() held until dialogue closes

function _getFloosh() {
  if (!_flooshUnit) _flooshUnit = units.find(u => u.type === 'grassling' && u.team === 'npc');
  return _flooshUnit;
}

function _startGuide() {
  const f = _getFloosh();
  if (!f) return;
  _guiding    = true;
  _guideDone  = false;
  _guideWpIdx = 0;
  _guidePaused = false;
}

function _tickGuide(dt) {
  if (!_guiding || _guideDone) return;
  const f = _getFloosh();
  if (!f) return;

  const gx = f.grp.position.x;
  const gz = f.grp.position.z;

  // Animate sinking into terrain during combat
  if (_guideSinking) {
    f.grp.position.y -= _SINK_SPEED * dt;
    if (f.grp.position.y <= _guideBaseY - _SINK_DEPTH) {
      f.grp.position.y = _guideBaseY - _SINK_DEPTH;
      f.grp.visible    = false;
      _guideSinking    = false;
      _guideSunk       = true; // freeze movement until post-combat raises Floosh
    }
    return;
  }

  // Animate rising back up after combat
  if (_guideRising) {
    f.grp.visible     = true;
    f.grp.position.y += _SINK_SPEED * dt;
    if (f.grp.position.y >= _guideBaseY) {
      f.grp.position.y = _guideBaseY;
      _guideRising     = false;
      setUnitWalking(f, false);
      showQuickDialogue([{ s: 'Floosh', t: "Shall we?" }], () => {
        _shallWeDone?.();
        _shallWeDone = null;
      });
    }
    return;
  }

  // Sink when combat starts; stay frozen (_guideSunk) until post-combat handler raises Floosh
  if (!isPrecombat()) {
    if (!_guideSinking && !_guideSunk) {
      _guideBaseY   = getTerrainHeight(gx, gz);
      _guideSinking = true;
      _guidePaused  = false;
      setUnitWalking(f, false);
    }
    return;
  }
  // Between combat-end and the priority-100 post-combat handler firing, do not move while sunk.
  if (_guideSunk) return;

  // Stop if no hero within 40 ft
  const heroNearby = units.some(u => {
    if (u.team !== 'blue' || u.hp <= 0) return false;
    const dx = u.grp.position.x - gx, dz = u.grp.position.z - gz;
    return dx * dx + dz * dz <= _GUIDE_STOP_SQ;
  });

  if (!heroNearby) {
    if (!_guidePaused) { _guidePaused = true; setUnitWalking(f, false); }
    return;
  }
  _guidePaused = false;

  // Reached all waypoints
  if (_guideWpIdx >= _GUIDE_WAYPOINTS.length) {
    _guideDone = true;
    setUnitWalking(f, false);
    return;
  }

  // Move toward next waypoint
  const wp  = _GUIDE_WAYPOINTS[_guideWpIdx];
  const dx  = wp.x - gx;
  const dz  = wp.z - gz;
  const len = Math.sqrt(dx * dx + dz * dz);

  if (len < 0.5) { _guideWpIdx++; return; }

  const step = Math.min(_GUIDE_SPEED * dt, len);
  f.grp.position.x += (dx / len) * step;
  f.grp.position.z += (dz / len) * step;
  f.grp.position.y  = getTerrainHeight(f.grp.position.x, f.grp.position.z);
  f.grp.rotation.y  = Math.atan2(dx / len, dz / len);
  setUnitWalking(f, true);
}

// After all post-combat handlers (loot, Dagna, etc.) rise Floosh and prompt "Shall we?"
registerPostCombatHandler(100, (_ctx, done) => {
  if (!_guiding || _guideDone) { done(); return; }
  const f = _getFloosh();
  if (!f) { done(); return; }
  _guideBaseY  = getTerrainHeight(f.grp.position.x, f.grp.position.z);
  f.grp.position.y = _guideBaseY - _SINK_DEPTH; // ensure below ground before rising
  f.grp.visible    = false;
  _guideSunk    = false; // allow _tickGuide to process the rising animation
  _guideRising  = true;
  _shallWeDone  = done; // held until player closes "Shall we?" dialogue
});

// ── Floosh intro — one-shot, persisted via localStorage ───────────────────────

const _KEY_INTRO      = 'dnd-floosh-intro-seen';
const _MARKER_ID      = 'floosh_quest';         // shared with exclamationMarkers persistence
const _KEY_QUEST_DONE = 'dnd-floosh-quest-done';

// Grassling (Floosh) world position in bleakmire_woods
const _FLOOSH_X  = 6.71;
const _FLOOSH_Z  = 71.66;
const _PROX_SQ   = 36;    // 15 ft = 6 WU  →  6² = 36

let _watchingProximity  = false;
let _flooshQuestPending = false;  // true if proximity triggered during combat
let _flooshExcl         = null;   // "!" sprite above Floosh
let _flooshExclT        = 0;
let _flooshQMark        = null;   // grey "?" sprite — quest active but not yet resolved
let _flooshQMarkT       = 0;

const _INTRO_LINES = [
  { s: 'Milo',    t: "Ahead! I've lost the tracks! What now?" },
  { s: 'Leugren', t: "We must keep looking! Those fiends can't have gotten far!" },
  { s: 'Floosh',  t: "Hail, noble giants! Over here!" },
];

const _QUEST_LINES = [
  { s: 'Floosh', t: "I am Floosh, voice of King Sproutling the Third, Lord of the fields of Neverwinter Wood, and his verdant kin. By your path you must be following the goblin spoor." },
  { s: 'Gobo',   t: "Aye, those green-skinned cretins took two of our friends prisoner. Can you help us find them?" },
  { s: 'Floosh', t: "What's wrong with green skin? Verily, I know the path the goblins took, but beware for our woods are cursed! Shambling zombies and undead roam the forest, devouring every beast they find. No deer, no rabbits — nothing to leave noble droppings to nourish our soil. Our people wither!" },
  { s: 'Floosh', t: "Rid our forest of these abominations, brave ones, and I shall personally guide you straight to the goblins you seek. This I swear on the deepest roots." },
];

const _ACCEPT_LINES = [
  { s: 'Gobo',   t: "You've got yourself a deal, little sprout. Point us toward the undead." },
  { s: 'Floosh', t: "Follow me when you are ready! May the soil strengthen your steps!" },
];

registerDialogueScene({ id: 'dlg_floosh_intro', name: 'Floosh — Zone Entry',   lines: _INTRO_LINES });
registerDialogueScene({ id: 'dlg_floosh_quest', name: 'Floosh — Quest Offer',  lines: _QUEST_LINES });
registerDialogueScene({ id: 'dlg_floosh_accept', name: 'Floosh — Accept Quest', lines: _ACCEPT_LINES });

function _spawnFlooshExcl() {
  if (_flooshExcl) return;
  _flooshExcl = mkExclamationMarker();
  const y = getTerrainHeight(_FLOOSH_X, _FLOOSH_Z) + 2.5;
  _flooshExcl.position.set(_FLOOSH_X, y, _FLOOSH_Z);
  scene.add(_flooshExcl);
  _flooshExclT = 0;
}

function _removeFlooshExcl() {
  if (!_flooshExcl) return;
  scene.remove(_flooshExcl);
  _flooshExcl.userData.sprite?.material.map?.dispose();
  _flooshExcl.userData.sprite?.material.dispose();
  _flooshExcl = null;
}

// ── Grey "?" marker — quest active, waiting for ghoul kill ────────────────────

function _mkFlooshQMark() {
  const W = 64, H = 96;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 86px Arial Black, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 8;
  ctx.strokeText('?', W / 2, H / 2);
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText('?', W / 2, H / 2);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  const worldH = 1.0;
  spr.scale.set((W / H) * worldH, worldH, 1);
  spr.frustumCulled = false;
  const grp = new THREE.Group();
  grp.add(spr);
  grp.userData.sprite     = spr;
  grp.userData.baseScaleX = spr.scale.x;
  grp.userData.baseScaleY = spr.scale.y;
  return grp;
}

function _spawnFlooshQMark() {
  if (_flooshQMark) return;
  _flooshQMark  = _mkFlooshQMark();
  _flooshQMarkT = 0;
  const y = getTerrainHeight(_FLOOSH_X, _FLOOSH_Z) + 2.5;
  _flooshQMark.position.set(_FLOOSH_X, y, _FLOOSH_Z);
  scene.add(_flooshQMark);
}

function _removeFlooshQMark() {
  if (!_flooshQMark) return;
  scene.remove(_flooshQMark);
  _flooshQMark.userData.sprite?.material.map?.dispose();
  _flooshQMark.userData.sprite?.material.dispose();
  _flooshQMark = null;
}

export function setFlooshQuestDone() {
  try { localStorage.setItem(_KEY_QUEST_DONE, '1'); } catch {}
  _removeFlooshQMark();
}

function _showQuestReminderDialogue() {
  showQuickDialogue(
    [{ s: 'Floosh', t: "Did you find the undead source haunting our forest?" }],
    () => showChoiceUI([{ label: 'Close', onPick: () => {} }]),
  );
}

// onDone: called after the full sequence completes; used by post-combat handler
// to advance the post-combat chain. Omit for immediate precombat triggers.
function _startQuestDialogue(onDone = null) {
  _watchingProximity  = false;
  _flooshQuestPending = false;
  _removeFlooshExcl();
  setMarkerSeen(_MARKER_ID);
  showQuickDialogue(_QUEST_LINES, () => {
    showChoiceUI([
      { label: 'Accept Quest', onPick: () => showQuickDialogue(_ACCEPT_LINES, () => {
          addQuest('floosh_undead', 'Cleanse the Haunted Wood', "Rid Neverwinter Wood of the undead plaguing it. Floosh has sworn to guide you straight to the goblins once the forest is cleansed.");
          _spawnFlooshQMark();
          _startGuide();
          onDone?.();
        }) },
      { label: 'Decline', onPick: onDone },
    ]);
  });
}

// ── Post-combat deferred quest trigger ────────────────────────────────────────
// If a hero was already within 15 ft of Floosh when combat started, the ! stays
// visible through the fight and the quest dialogue fires here instead.

registerPostCombatHandler(5, (ctx, done) => {
  if (!_flooshQuestPending) { done(); return; }
  _startQuestDialogue(done);
});

// ── Footprint texture (canvas-drawn bare-foot silhouette) ─────────────────────
function _makeFootTex(mirror = false) {
  const W = 48, H = 84;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
  c.fillStyle = '#fff';
  c.beginPath();
  c.ellipse(W * 0.50, H * 0.84, W * 0.28, H * 0.11, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(W * 0.54, H * 0.63, W * 0.17, H * 0.18, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(W * 0.47, H * 0.41, W * 0.29, H * 0.12, 0, 0, Math.PI * 2);
  c.fill();
  const toes = [
    { x: 0.18, y: 0.25, rx: 0.065, ry: 0.072 },
    { x: 0.32, y: 0.19, rx: 0.075, ry: 0.085 },
    { x: 0.48, y: 0.16, rx: 0.085, ry: 0.095 },
    { x: 0.64, y: 0.19, rx: 0.075, ry: 0.085 },
    { x: 0.78, y: 0.25, rx: 0.072, ry: 0.080 },
  ];
  toes.forEach(({ x, y, rx, ry }) => {
    c.beginPath();
    c.ellipse(W * x, H * y, W * rx, H * ry, 0, 0, Math.PI * 2);
    c.fill();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

// ── Trail waypoints — heads southwest toward wolves/snakes, stops halfway ─────
const _WAYPOINTS = [
  { x: -0.55, z: 87.39 },  // arrival portal area
  { x: -7.00, z: 72.00 },  // ~halfway to the wolf/snake cluster at (-13, 57)
];

// Three walkers: lateral nudge + along-trail start offset (world units)
const _WALKERS = [
  { perpNudge: -0.45, startOffset: 0.0  },
  { perpNudge:  0.00, startOffset: 0.55 },
  { perpNudge:  0.40, startOffset: 1.10 },
];

function _buildTrail(perpNudge, startOffset) {
  const STEP = 1.7;
  const SIDE = 0.35;
  const prints = [];
  let distAccum = 0;
  let nextPrint = startOffset;
  let printIdx  = 0;

  for (let wi = 0; wi < _WAYPOINTS.length - 1; wi++) {
    const a  = _WAYPOINTS[wi];
    const b  = _WAYPOINTS[wi + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    const ux = dx / segLen, uz = dz / segLen;
    const perpX = -uz, perpZ = ux;

    while (nextPrint <= distAccum + segLen) {
      const along  = nextPrint - distAccum;
      const wx     = a.x + ux * along + perpNudge * perpX;
      const wz     = a.z + uz * along + perpNudge * perpZ;
      const isLeft = printIdx % 2 === 0;
      const sign   = isLeft ? -1 : 1;
      const px     = wx + sign * SIDE * perpX;
      const pz     = wz + sign * SIDE * perpZ;
      const yaw    = Math.atan2(-ux, -uz);
      prints.push({ px, pz, yaw, isLeft, sign });
      nextPrint += STEP;
      printIdx++;
    }
    distAccum += segLen;
  }
  return prints;
}

// ── State ─────────────────────────────────────────────────────────────────────
let _meshes   = [];
let _texLeft  = null;
let _texRight = null;
let _t        = 0;
let _fadeIn   = 0;
const _COLOR_A   = new THREE.Color(0x1a0a04);
const _COLOR_B   = new THREE.Color(0x4a2010);
const _COLOR_TMP = new THREE.Color();

function _showFootsteps() {
  _hideFootsteps();
  _fadeIn   = 0;
  _texLeft  = _makeFootTex(false);
  _texRight = _makeFootTex(true);

  for (const { perpNudge, startOffset } of _WALKERS) {
    for (const { px, pz, yaw, isLeft, sign } of _buildTrail(perpNudge, startOffset)) {
      const py  = getTerrainHeight(px, pz);
      const mat = new THREE.MeshBasicMaterial({
        map:         isLeft ? _texLeft : _texRight,
        color:       _COLOR_A.clone(),
        transparent: true,
        opacity:     0,
        alphaTest:   0.0,
        depthWrite:  false,
        depthTest:   true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side:        THREE.DoubleSide,
      });
      const geo = new THREE.PlaneGeometry(0.22, 0.34);
      const m   = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = yaw + sign * 0.18;
      m.position.set(px, py + 0.06, pz);
      m.renderOrder = 4;
      scene.add(m);
      _meshes.push(m);
    }
  }
}

function _hideFootsteps() {
  for (const m of _meshes) { m.geometry.dispose(); m.material.dispose(); scene.remove(m); }
  _meshes = [];
  _texLeft?.dispose();  _texLeft  = null;
  _texRight?.dispose(); _texRight = null;
}

// ── Tick: footprint fade-in + pulse color, proximity watch ───────────────────
export function tickBleakmireWoods(dt) {
  if (_meshes.length) {
    _t += dt * 1.4;
    _COLOR_TMP.lerpColors(_COLOR_A, _COLOR_B, Math.sin(_t) * 0.5 + 0.5);
    const opacity = _fadeIn < 1 ? (_fadeIn = Math.min(1, _fadeIn + dt / 1.5)) : 1;
    for (const m of _meshes) {
      m.material.color.copy(_COLOR_TMP);
      if (opacity < 1) m.material.opacity = opacity;
    }
  }

  if (_flooshExcl) {
    _flooshExclT += dt;
    const spr = _flooshExcl.userData.sprite;
    if (spr) {
      const pulse = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(_flooshExclT * 2.1));
      spr.scale.set(
        _flooshExcl.userData.baseScaleX * pulse,
        _flooshExcl.userData.baseScaleY * pulse,
        1,
      );
      spr.position.y = Math.sin(_flooshExclT * 1.8) * 0.15;
    }
  }

  if (_flooshQMark) {
    _flooshQMarkT += dt;
    const spr = _flooshQMark.userData.sprite;
    if (spr) {
      const pulse = 0.80 + 0.16 * (0.5 + 0.5 * Math.sin(_flooshQMarkT * 1.6));
      spr.scale.set(
        _flooshQMark.userData.baseScaleX * pulse,
        _flooshQMark.userData.baseScaleY * pulse,
        1,
      );
      spr.position.y = Math.sin(_flooshQMarkT * 1.4) * 0.10;
    }
    // Keep ? above Floosh while he's guiding (he moves)
    if (_guiding && !_guideDone) {
      const f = _getFloosh();
      if (f) {
        _flooshQMark.position.x = f.grp.position.x;
        _flooshQMark.position.z = f.grp.position.z;
        _flooshQMark.position.y = getTerrainHeight(f.grp.position.x, f.grp.position.z) + 2.5;
      }
    }
  }

  _tickGuide(dt);

  if (_watchingProximity) {
    for (const u of units) {
      if (u.team !== 'blue' || u.hp <= 0) continue;
      const dx = u.grp.position.x - _FLOOSH_X;
      const dz = u.grp.position.z - _FLOOSH_Z;
      if (dx * dx + dz * dz <= _PROX_SQ) {
        if (isPrecombat()) {
          _startQuestDialogue();        // immediate: ! disappears + dialogue now
        } else {
          _watchingProximity  = false;
          _flooshQuestPending = true;   // ! stays visible; both deferred to post-combat
        }
        break;
      }
    }
  }
}

// ── Zone lifecycle ────────────────────────────────────────────────────────────
window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'bleakmire_woods') return;
  if (isDevMode()) _spawnWaypointMarkers();

  // Footsteps only if heroes chose to follow the goblin tracks
  if (getQuestFlag('goblin_pursuit')) _showFootsteps();

  // Floosh triggers independently — not gated on any prior quest
  try {
    if (!localStorage.getItem(_KEY_INTRO)) {
      localStorage.setItem(_KEY_INTRO, '1');
      setTimeout(() => {
        showQuickDialogue(_INTRO_LINES, () => {
          if (!isMarkerSeen(_MARKER_ID)) {
            _watchingProximity = true;
            _spawnFlooshExcl();
          }
        });
      }, 1200);
    } else if (!isMarkerSeen(_MARKER_ID)) {
      // Intro already seen but quest not yet triggered — re-arm proximity watch
      _watchingProximity = true;
      _spawnFlooshExcl();
    } else if (!localStorage.getItem(_KEY_QUEST_DONE)) {
      // Quest offered, not yet resolved (ghoul still alive) — grey ? over Floosh
      _spawnFlooshQMark();
    }
  } catch {}
});

window.addEventListener('zone:loading', () => {
  _hideFootsteps();
  _watchingProximity  = false;
  _flooshQuestPending = false;
  _removeFlooshExcl();
  _removeFlooshQMark();
  _guiding      = false;
  _guideDone    = false;
  _guideSinking = false;
  _guideRising  = false;
  _guidePaused  = false;
  _flooshUnit   = null;
  _shallWeDone?.();   // release post-combat chain if heroes zone out mid-rise
  _shallWeDone  = null;
  _clearWaypointMarkers();
});

// ── Floosh click — show quest reminder when ? is active ───────────────────────
const _qRc  = new THREE.Raycaster();
const _qNdc = new THREE.Vector2();

renderer.domElement.addEventListener('click', e => {
  if (!_flooshQMark || !isPrecombat()) return;
  _qNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  _qRc.setFromCamera(_qNdc, camera);
  const hits = _qRc.intersectObject(_flooshQMark.userData.sprite);
  if (!hits.length) return;
  e.stopImmediatePropagation();
  _showQuestReminderDialogue();
});
