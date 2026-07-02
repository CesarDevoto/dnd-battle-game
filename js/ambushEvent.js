import * as THREE from 'three';
import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { showQuickDialogue, showChoiceUI, registerDialogueScene } from './dagnaEvent.js';
import { units } from './units.js';
import { registerPostCombatHandler } from './postCombat.js';
import { clearAllExclamations, trackExclamation, isMarkerSeen } from './exclamationMarkers.js';
import { mkExclamationMarker } from './propBuilders.js';
import { setQuestFlag, addQuest } from './quests.js';

// ── Injected to avoid circular dep (zoneLoader → combat → ambushEvent → zoneLoader) ──
let _getActiveZoneIdFn = null;

export function initAmbush({ getActiveZoneId }) {
  _getActiveZoneIdFn = getActiveZoneId;
}

// ── Dialogue ──────────────────────────────────────────────────────────────────
const _LINES = [
  { s: 'Leugren', t: "Gods… This was my cousin Gundren's mare, Maggie. And that brown stallion yonder — that's Sildar's mount from Neverwinter." },
  { s: 'Gobo',    t: "These goblin arrows did the deed, no doubt about it." },
  { s: 'Rasec',   t: "Saddlebags are stripped clean. And Gundren's map case… it's empty. Strange — none of these filthy little bastards has the map on them." },
  { s: 'Milo',    t: "Oi! Over here! Tracks! A dozen or more goblins have been back and forth along this trail… and I'd stake a silver that these two heavy sets of prints were prisoners — dwarves or men — being hauled north." },
];

registerDialogueScene({ id: 'dlg_ambush_victory', name: 'Goblin Ambush — After Battle', lines: _LINES, onDone: () => _showFootsteps() });

// ── Pursuit dialogue ──────────────────────────────────────────────────────────
const _PURSUIT_LINES = [
  { s: 'Leugren', t: "They've taken my uncle and Sildar! We must go after them!" },
  { s: 'Rasec',   t: "Leugren, wait… What of the horses and the wagon? We still have a contract to deliver these provisions to Barthen's in Phandalin." },
];

const _PURSUIT_CHOICES = [
  { label: 'Follow the tracks', pursue: true,  lines: [{ s: 'Milo', t: "This way! The tracks lead north — follow me!" }] },
  { label: 'Head to Phandalin', pursue: false, lines: [{ s: 'Gobo', t: "Smart. Let's head back to the wagon and get these supplies to Phandalin before anything else goes wrong." }] },
];

function _buildChoices() {
  return _PURSUIT_CHOICES.map(ch => ({
    label:  ch.label,
    onPick: () => {
      if (ch.pursue) {
        setQuestFlag('goblin_pursuit');
        addQuest('goblin_pursuit', 'Follow the Goblin Tracks',
          "Track the goblins north to rescue Gundren Rockseeker and Sildar Hallwinter.");
      }
      showQuickDialogue(ch.lines);
    },
  }));
}

registerDialogueScene({
  id: 'dlg_pursuit',
  name: 'Goblin Ambush — Pursue or Deliver?',
  lines: _PURSUIT_LINES,
  onDone: () => showChoiceUI(_buildChoices()),
});

// ── Zone load — spawn ! near horses ──────────────────────────────────────────
const _STAR_X = 15.2, _STAR_Z = 10.79;

window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'road_to_phandelver') return;
  if (isMarkerSeen('horses_road') || _dialogueFired) return;
  const star = mkExclamationMarker();
  star.position.set(_STAR_X, getTerrainHeight(_STAR_X, _STAR_Z) + 1.2, _STAR_Z);
  scene.add(star);
  trackExclamation(star, _STAR_X, _STAR_Z, { id: 'horses_road' });
});

// ── Post-combat handler (priority 30) ────────────────────────────────────────
// Fires once after the goblin ambush combat ends. Goblins must be dead (hp<=0)
// in the units array — guards against other combats in the zone triggering it.
let _dialogueFired = false;

registerPostCombatHandler(30, (ctx, done) => {
  if (_dialogueFired) { done(); return; }
  if (_getActiveZoneIdFn?.() !== 'road_to_phandelver') { done(); return; }
  _dialogueFired = true;
  clearAllExclamations();
  setTimeout(() => showQuickDialogue(_LINES, () => {
    _showFootsteps();
    done();
  }), 400);
});

// ── Pursuit trigger: fires after first hero move post-footsteps ───────────────
let _waitingForMove = false;
let _heroPositions  = null;
let _pursuitFired   = false;

function _startPursuitWatch() {
  _waitingForMove = true;
  _heroPositions  = new Map();
  for (const u of units) {
    if (u.team === 'blue') {
      _heroPositions.set(u, { x: u.grp.position.x, z: u.grp.position.z });
    }
  }
}

function _startPursuit() {
  if (_pursuitFired) return;
  _pursuitFired = true;
  showQuickDialogue(_PURSUIT_LINES, () => showChoiceUI(_buildChoices()));
}

// ── Footprint texture (canvas-drawn silhouette) ───────────────────────────────
// Returns a CanvasTexture with a bare-foot silhouette: heel, arch, ball, 5 toes.
// Pass mirror=true for the left foot (flipped horizontally).
function _makeFootTex(mirror = false) {
  const W = 48, H = 84;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  if (mirror) { c.translate(W, 0); c.scale(-1, 1); }

  c.fillStyle = '#fff';

  // Heel — wide oval at bottom
  c.beginPath();
  c.ellipse(W * 0.50, H * 0.84, W * 0.28, H * 0.11, 0, 0, Math.PI * 2);
  c.fill();

  // Arch — narrow bridge connecting heel to ball
  c.beginPath();
  c.ellipse(W * 0.54, H * 0.63, W * 0.17, H * 0.18, 0, 0, Math.PI * 2);
  c.fill();

  // Ball of foot — wider oval
  c.beginPath();
  c.ellipse(W * 0.47, H * 0.41, W * 0.29, H * 0.12, 0, 0, Math.PI * 2);
  c.fill();

  // 5 toes: pinky (left) → big toe (right), fanning slightly upward
  const toes = [
    { x: 0.18, y: 0.25, rx: 0.065, ry: 0.072 },  // pinky
    { x: 0.32, y: 0.19, rx: 0.075, ry: 0.085 },
    { x: 0.48, y: 0.16, rx: 0.085, ry: 0.095 },  // middle
    { x: 0.64, y: 0.19, rx: 0.075, ry: 0.085 },
    { x: 0.78, y: 0.25, rx: 0.072, ry: 0.080 },  // big toe
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

// ── Footstep tracks ───────────────────────────────────────────────────────────
let _meshes   = [];
let _texLeft  = null;
let _texRight = null;
let _t        = 0;
let _fadeIn   = 0;;
const _COLOR_A   = new THREE.Color(0x1a0a04);  // dark brown
const _COLOR_B   = new THREE.Color(0x4a2010);  // mid brown
const _COLOR_TMP = new THREE.Color();

// Waypoints traced by mushroom props — defines the trail path
const _WAYPOINTS = [
  { x: 15.34, z: 14.79 },
  { x: 13.17, z: 16.86 },
  { x: 10.34, z: 18.93 },
  { x:  6.71, z: 19.90 },
  { x:  2.49, z: 17.98 },
  { x: -0.65, z: 15.71 },
  { x: -3.82, z: 11.32 },
  { x: -8.02, z:  6.93 },
  { x:-11.03, z:  3.45 },
  { x:-15.39, z: -1.58 },
  { x:-18.81, z: -6.43 },
  { x:-23.32, z:-11.23 },
  { x:-27.95, z:-12.98 },
  { x:-32.52, z:-14.14 },
  { x:-37.46, z:-14.74 },
  { x:-41.60, z:-15.98 },
  { x:-45.60, z:-17.04 },
];

// Three walkers: perpendicular nudge (WU) + along-trail start offset (WU)
const _WALKERS = [
  { perpNudge: -0.45, startOffset: 0.0  },
  { perpNudge:  0.0,  startOffset: 0.55 },
  { perpNudge:  0.40, startOffset: 1.1  },
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

function _showFootsteps() {
  _hideFootsteps();
  _fadeIn = 0;

  _texLeft  = _makeFootTex(false);
  _texRight = _makeFootTex(true);

  for (const { perpNudge, startOffset } of _WALKERS) {
    for (const { px, pz, yaw, isLeft, sign } of _buildTrail(perpNudge, startOffset)) {
      const py = getTerrainHeight(px, pz);

      const mat = new THREE.MeshBasicMaterial({
        map: isLeft ? _texLeft : _texRight,
        color: _COLOR_A.clone(),
        transparent: true,
        opacity: 0,
        alphaTest: 0.0,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.DoubleSide,
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

  _startPursuitWatch();
}

function _hideFootsteps() {
  for (const m of _meshes) {
    m.geometry.dispose();
    m.material.dispose();
    scene.remove(m);
  }
  _meshes = [];
  _texLeft?.dispose();  _texLeft  = null;
  _texRight?.dispose(); _texRight = null;
}

// ── Tick (called from main.js animation loop) ─────────────────────────────────
export function tickAmbush(dt) {
  if (_meshes.length) {
    _t += dt * 1.4;
    _COLOR_TMP.lerpColors(_COLOR_A, _COLOR_B, Math.sin(_t) * 0.5 + 0.5);
    const opacity = _fadeIn < 1 ? (_fadeIn = Math.min(1, _fadeIn + dt / 1.5)) : 1;
    for (const m of _meshes) {
      m.material.color.copy(_COLOR_TMP);
      if (opacity < 1) m.material.opacity = opacity;
    }
  }

  if (_waitingForMove && _heroPositions) {
    for (const [u, pos] of _heroPositions) {
      const dx = u.grp.position.x - pos.x;
      const dz = u.grp.position.z - pos.z;
      if (dx * dx + dz * dz > 0.25) {
        _waitingForMove = false;
        _heroPositions  = null;
        _startPursuit();
        break;
      }
    }
  }
}

// ── Cleanup on zone change ────────────────────────────────────────────────────
window.addEventListener('zone:loading', () => {
  _hideFootsteps();
  _dialogueFired  = false;
  _waitingForMove = false;
  _heroPositions  = null;
  _pursuitFired   = false;
});
