import * as THREE from 'three';
import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { units } from './units.js';

const WAKE_SQ  = 72 * 72;   // 180 ft — wake threshold (WU²)
const SLEEP_SQ = 80 * 80;   // 200 ft — sleep threshold (WU²)

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

// ── Trail waypoints — mushroom positions defining the path ────────────────────
const _WAYPOINTS = [
  { x:  -0.55, z:  87.39 },
  { x:  -4.28, z:  73.41 },
  { x: -10.91, z:  59.30 },
  { x: -24.77, z:  44.59 },
  { x: -31.30, z:  37.81 },
  { x: -40.41, z:  26.65 },
  { x: -46.67, z:  19.93 },
  { x: -40.04, z:   5.15 },
  { x: -27.06, z:   2.18 },
  { x: -14.22, z:  -0.53 },
  { x:  -3.53, z:  -6.23 },
  { x:   4.70, z: -14.73 },
  { x:  15.26, z: -25.68 },
  { x:  27.44, z: -36.56 },
  { x:  36.75, z: -41.42 },
  { x:  43.66, z: -52.30 },
  { x:  54.58, z: -60.17 },
  { x:  61.97, z: -74.27 },
  { x:  67.39, z: -90.14 },
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
const _COLOR_A   = new THREE.Color(0x0d2e0d);
const _COLOR_B   = new THREE.Color(0xd4a017);
const _COLOR_TMP = new THREE.Color();

function _showFootsteps() {
  _hideFootsteps();
  _texLeft  = _makeFootTex(false);
  _texRight = _makeFootTex(true);

  for (const { perpNudge, startOffset } of _WALKERS) {
    for (const { px, pz, yaw, isLeft, sign } of _buildTrail(perpNudge, startOffset)) {
      const py  = getTerrainHeight(px, pz);
      const mat = new THREE.MeshBasicMaterial({
        map:         isLeft ? _texLeft : _texRight,
        color:       _COLOR_A.clone(),
        transparent: true,
        alphaTest:   0.08,
        depthWrite:  false,
        depthTest:   false,
        side:        THREE.DoubleSide,
      });
      const geo = new THREE.PlaneGeometry(0.45, 0.70);
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

// ── Tick: distance cull + pulse color ────────────────────────────────────────
export function tickRoadToCragmaw(dt) {
  if (!_meshes.length) return;

  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);

  _t += dt * 1.4;
  _COLOR_TMP.lerpColors(_COLOR_A, _COLOR_B, Math.sin(_t) * 0.5 + 0.5);

  for (const m of _meshes) {
    let nearSq = Infinity;
    for (const h of heroes) {
      const dx = m.position.x - h.grp.position.x;
      const dz = m.position.z - h.grp.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < nearSq) nearSq = d2;
    }

    if (m.visible) {
      if (nearSq > SLEEP_SQ) m.visible = false;
    } else {
      if (nearSq < WAKE_SQ)  m.visible = true;
    }

    if (m.visible) m.material.color.copy(_COLOR_TMP);
  }
}

// ── Zone lifecycle ────────────────────────────────────────────────────────────
window.addEventListener('zone:loaded',  e => { if (e.detail?.id === 'road_to_cragmaw') _showFootsteps(); });
window.addEventListener('zone:loading', _hideFootsteps);
