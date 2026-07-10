import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS, SCENE, GROUND_SIZE, GRID_DIVISIONS, WORLD_UNITS_PER_SQUARE } from './constants.js';

let _sceneGS = GROUND_SIZE;
export function setSceneGroundSize(s) { _sceneGS = s; }
import { buildTerrainMesh, buildCeilingMesh, getTerrainHeight, getGroundHeight, getUncarvedHeight } from './terrain.js';
import { ceilingMaterial, applyRevealShader } from './caveReveal.js';
import { isEditModeActive } from './devConfig.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sceneBackground);
scene.fog = new THREE.FogExp2(COLORS.fogBase, SCENE.fogDensity);

export const camera = new THREE.PerspectiveCamera(
  SCENE.cameraFov,
  window.innerWidth / window.innerHeight,
  SCENE.cameraNear,
  SCENE.cameraFar
);
camera.position.set(...SCENE.cameraPos);

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = SCENE.orbitDamping;
controls.minDistance    = SCENE.orbitMaxDist;   // locked — no zoom
controls.maxDistance    = SCENE.orbitMaxDist;
controls.enableRotate   = false;
controls.enableZoom     = false;
controls.enablePan      = false;   // play mode: right-mouse is our custom camera swivel, not pan
controls.target.set(0, 0, 29);

export const ambient = new THREE.AmbientLight(COLORS.ambient, SCENE.ambientIntensity);
scene.add(ambient);

export const moon = new THREE.DirectionalLight(COLORS.moonlight, SCENE.moonIntensity);
moon.position.set(...SCENE.moonPos);
moon.castShadow = true;
moon.shadow.mapSize.set(SCENE.shadowMapSize, SCENE.shadowMapSize);
moon.shadow.camera.left   = -SCENE.shadowExtent;
moon.shadow.camera.right  =  SCENE.shadowExtent;
moon.shadow.camera.top    =  SCENE.shadowExtent;
moon.shadow.camera.bottom = -SCENE.shadowExtent;
moon.shadow.camera.far    = SCENE.orbitMaxDist;
scene.add(moon);

export const fire = new THREE.DirectionalLight(COLORS.rimFire, SCENE.fireIntensity);
fire.position.set(...SCENE.firePos);
scene.add(fire);

const groundMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true,
});
export const ground = buildTerrainMesh(groundMat);
scene.add(ground);

// Cave ceiling — its own material (caveReveal) so it can fade a soft patch around
// heroes who go under the roof. syncCaveRevealMaterial keeps its map/colour/rough
// matched to the ground. Hidden until a cave zone loads (toggled by zoneLoader);
// follows the original hill contour so the hill reads as intact with the cave a
// hole in its side.
export const ceiling = buildCeilingMesh(ceilingMaterial);
ceiling.visible = false;
scene.add(ceiling);

// ── Terrain-conforming grid ───────────────────────────────────────────────────
// Instead of a flat GridHelper we build LineSegments whose vertices are sampled
// from getTerrainHeight, subdividing each cell into SUB steps so the lines hug
// hills and valleys.  rebuildGrid() is called by environments.js whenever the
// terrain changes (biome switch).

const _GRID_SUB    = 4;     // sub-steps per cell — captures fine terrain detail
const _GRID_Y_LIFT = 0.07;  // world-units above the surface (avoids z-fighting)

// smoothstep — how much real roof (rock overhead) is at (x,z): 0 on open ground,
// 1 under the tunnel. Matches the blanket's aRoof so the grid fades identically.
function _gss(a, b, t) { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); }
function _gridRoof(x, z) { return _gss(0.6, 2.5, getUncarvedHeight(x, z) - getTerrainHeight(x, z)); }

const _FLOOR_H = (x, z) => getTerrainHeight(x, z);                 // carved terrain / tunnel floor
const _SURF_H  = (x, z) => getGroundHeight(x, z, 'surface');      // surface / blanket

function _buildGridGeo(heightFn, withRoof) {
  const GS   = _sceneGS;
  const DIVS = Math.round(GS / WORLD_UNITS_PER_SQUARE);  // always 1 cell = 1 grid square
  const CELL = GS / DIVS;
  const STEP = CELL / _GRID_SUB;
  const half = GS * 0.5;

  // Pre-compute all heights (and roof factors) on a (DIVS*SUB+1)² sub-grid
  const pts = DIVS * _GRID_SUB + 1;
  const h   = new Float32Array(pts * pts);
  const r   = withRoof ? new Float32Array(pts * pts) : null;
  for (let iz = 0; iz < pts; iz++) {
    for (let ix = 0; ix < pts; ix++) {
      const x = -half + ix * STEP, z = -half + iz * STEP;
      h[iz * pts + ix] = heightFn(x, z) + _GRID_Y_LIFT;
      if (r) r[iz * pts + ix] = _gridRoof(x, z);
    }
  }

  // Build vertex pairs for LineSegments (each pair = one segment)
  const verts = [];
  const roof  = withRoof ? [] : null;

  // Lines running in X (constant Z row)
  for (let iz = 0; iz <= DIVS; iz++) {
    const row = iz * _GRID_SUB;
    for (let ix = 0; ix < DIVS * _GRID_SUB; ix++) {
      const x0 = -half + ix * STEP, x1 = -half + (ix + 1) * STEP;
      const z  = -half + iz * CELL;
      verts.push(x0, h[row * pts + ix], z, x1, h[row * pts + (ix + 1)], z);
      if (roof) roof.push(r[row * pts + ix], r[row * pts + (ix + 1)]);
    }
  }

  // Lines running in Z (constant X column)
  for (let ix = 0; ix <= DIVS; ix++) {
    const col = ix * _GRID_SUB;
    for (let iz = 0; iz < DIVS * _GRID_SUB; iz++) {
      const z0 = -half + iz * STEP, z1 = -half + (iz + 1) * STEP;
      const x  = -half + ix * CELL;
      verts.push(x, h[iz * pts + col], z0, x, h[(iz + 1) * pts + col], z1);
      if (roof) roof.push(r[iz * pts + col], r[(iz + 1) * pts + col]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  if (roof) geo.setAttribute('aRoof', new THREE.Float32BufferAttribute(roof, 1));
  return geo;
}

// Floor grid — follows the carved terrain (tunnel floor); the default grid.
export const grid = new THREE.LineSegments(
  _buildGridGeo(_FLOOR_H, false),
  new THREE.LineBasicMaterial({
    color: COLORS.gridMain, transparent: true, opacity: 0.3, depthTest: true, depthWrite: false,
  })
);
grid.renderOrder = 2;
grid.visible = false;
scene.add(grid);

// Blanket grid — rides the surface (blanket) in cave zones and fades with the roof
// via the shared reveal shader, so revealing the party also opens the roof grid.
const _ceilingGridMat = new THREE.LineBasicMaterial({
  color: COLORS.gridMain, opacity: 0.3, depthTest: true, depthWrite: false,
});
applyRevealShader(_ceilingGridMat);
export const ceilingGrid = new THREE.LineSegments(_buildGridGeo(_SURF_H, true), _ceilingGridMat);
ceilingGrid.renderOrder = 3;
ceilingGrid.visible = false;
scene.add(ceilingGrid);

let _caveGridActive = false;
export function setCeilingGridActive(on) {
  _caveGridActive = on;
  ceilingGrid.visible = on && grid.visible;
}

export function rebuildGrid() {
  grid.geometry.dispose();
  grid.geometry = _buildGridGeo(_FLOOR_H, false);
  ceilingGrid.geometry.dispose();
  ceilingGrid.geometry = _buildGridGeo(_SURF_H, true);
}

const gridBtn = document.getElementById('grid-toggle-btn');
gridBtn.textContent = 'Grid Off';
gridBtn.classList.add('off');
gridBtn.addEventListener('click', function () {
  setGridVisible(!grid.visible);
});

export function setGridVisible(v) {
  grid.visible = v;
  ceilingGrid.visible = v && _caveGridActive;
  gridBtn.textContent = v ? 'Grid On' : 'Grid Off';
  gridBtn.classList.toggle('off', !v);
}

export const divider = new THREE.Mesh(
  new THREE.PlaneGeometry(GROUND_SIZE, SCENE.dividerWidth),
  new THREE.MeshBasicMaterial({ color: COLORS.divider })
);
divider.rotation.x = -Math.PI / 2;
divider.position.set(0, 0.02, 16);
divider.visible = false;
scene.add(divider);

(() => {
  const COUNT = SCENE.starCount;
  const pos   = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 400;
    pos[i * 3 + 1] = Math.random() * 130 + 20;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 400;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: COLORS.stars, size: SCENE.starSize, sizeAttenuation: true
  })));
})();

export const _vec = new THREE.Vector3();

// ── Camera focus / follow ─────────────────────────────────────────────────────

let _followUnit     = null;
let _camFocusActive = false;
const _camFocusLook = new THREE.Vector3();

// Call at the start of each unit's turn to smoothly swing and then follow.
export function setFollowUnit(unit) {
  _followUnit = unit;
  if (unit) _camFocusActive = true;
}

export function getFollowUnit() { return _followUnit; }

// Legacy one-shot focus (still exported so existing callers don't break).
export function focusCameraOnUnit(unit) {
  _camFocusLook.set(unit.grp.position.x, unit.grp.position.y + 1, unit.grp.position.z);
  _camFocusActive = true;
}

// Instantly teleport the camera to look at a unit, preserving orbit angle/distance.
// Use on zone transitions so the camera doesn't lerp from the previous zone position.
export function snapCameraToUnit(unit) {
  if (!unit) return;
  const p = unit.grp.position;
  const newTarget = new THREE.Vector3(p.x, p.y + 1, p.z - 3);
  const delta = newTarget.clone().sub(controls.target);
  controls.target.copy(newTarget);
  camera.position.add(delta);
  _camFocusLook.copy(newTarget);
  _followUnit = unit;
  _camFocusActive = false; // updateCameraFocus re-activates via _followUnit each frame
}

// ── Top-view toggle ───────────────────────────────────────────────────────────

// ── Scroll zoom ───────────────────────────────────────────────────────────────
const TOP_VIEW_Y_DEFAULT = 50;
const TOP_VIEW_Y_MIN     = 12;
const TOP_VIEW_Y_MAX     = 62;
// Regular view: 6 notches max, each tightens orbit by 1 WU and narrows FOV 2°
const REG_ZOOM_MAX       = 6;
const REG_ZOOM_ORBIT     = 1;    // WU closer per notch
const REG_ZOOM_FOV       = 2;    // degrees narrower per notch

let _topViewY    = TOP_VIEW_Y_DEFAULT;
let _topViewActive  = false;
let _topViewSavedPos = null;
let _topViewSavedTgt = null;
let _regZoom     = 0;   // 0 = default, REG_ZOOM_MAX = most zoomed in

renderer.domElement.addEventListener('wheel', e => {
  // Dev/edit mode uses OrbitControls' own free dolly (see devMode.js) — this
  // handler's notch-based min/maxDistance snapping is for play view only and
  // would otherwise clamp every scroll tick back down to ~20 WU.
  if (isEditModeActive()) return;
  e.preventDefault();
  const inward = e.deltaY < 0;
  if (_topViewActive) {
    _topViewY = Math.min(TOP_VIEW_Y_MAX, Math.max(TOP_VIEW_Y_MIN,
      _topViewY + (inward ? -4 : 4)));
    controls.minDistance = _topViewY;
    controls.maxDistance = _topViewY;
  } else {
    _regZoom = Math.min(REG_ZOOM_MAX, Math.max(0, _regZoom + (inward ? 1 : -1)));
    const d = SCENE.orbitMaxDist - _regZoom * REG_ZOOM_ORBIT;
    controls.minDistance = d;
    controls.maxDistance = d;
    camera.fov = SCENE.cameraFov - _regZoom * REG_ZOOM_FOV;
    camera.updateProjectionMatrix();
  }
}, { passive: false });

export function isTopViewActive() { return _topViewActive; }

// ── Camera flip (180° around the target, same height/distance) ──────────────

export function flipCamera() {
  const offset = camera.position.clone().sub(controls.target);
  offset.x = -offset.x;
  offset.z = -offset.z;
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
  controls.update();
}

export function toggleTopView() {
  _topViewActive = !_topViewActive;
  if (_topViewActive) {
    _topViewSavedPos = camera.position.clone();
    _topViewSavedTgt = controls.target.clone();
    const p = _followUnit ? _followUnit.grp.position : controls.target;
    controls.target.set(p.x, 0, p.z);
    controls.minDistance = _topViewY;
    controls.maxDistance = _topViewY;
    controls.update();
    camera.position.set(p.x, _topViewY, p.z);
    camera.lookAt(p.x, 0, p.z);
  } else {
    if (_topViewSavedPos) {
      camera.position.copy(_topViewSavedPos);
      controls.target.copy(_topViewSavedTgt);
    }
    const d = SCENE.orbitMaxDist - _regZoom * REG_ZOOM_ORBIT;
    controls.minDistance = d;
    controls.maxDistance = d;
    camera.fov = SCENE.cameraFov - _regZoom * REG_ZOOM_FOV;
    camera.updateProjectionMatrix();
    controls.update();
    _topViewSavedPos = null;
    _topViewSavedTgt = null;
  }
}

const _prevTarget = new THREE.Vector3();

export function updateCameraFocus() {
  if (_topViewActive) {
    // Keep camera pinned above follow unit at the scroll-adjusted height.
    // Set min/max distance so controls.update() (called in main.js) positions
    // the camera at exactly _topViewY above the target — no direct position set
    // needed here, preventing the main-loop controls.update() from fighting us.
    const p = _followUnit ? _followUnit.grp.position : controls.target;
    controls.target.set(p.x, 0, p.z);
    controls.minDistance = _topViewY;
    controls.maxDistance = _topViewY;
    return;
  }

  if (_followUnit) {
    const p = _followUnit.grp.position;
    _camFocusLook.set(p.x, p.y + 1, p.z - 3);
    _camFocusActive = true;
  }
  if (!_camFocusActive) return;

  _prevTarget.copy(controls.target);
  controls.target.lerp(_camFocusLook, 0.1);

  camera.position.add(controls.target).sub(_prevTarget);

  if (!_followUnit && controls.target.distanceTo(_camFocusLook) < 0.05) {
    _camFocusActive = false;
  }
}

// ── Right-mouse swivel — orbit the camera horizontally around the follow unit ──
// Play mode only (in edit mode OrbitControls owns the right button for free
// rotate, so we bail when enableRotate is on). The camera keeps its distance and
// height and stays pointed at the unit; only the azimuth changes. Dragging RIGHT
// swings the camera counter-clockwise around the unit (e.g. 6 o'clock → 3
// o'clock, to look "west"); dragging LEFT swings it clockwise (→ 9 o'clock, to
// look "east"). The per-frame follow (updateCameraFocus) only translates the
// camera with the target, so the swivel angle persists once set.
const _SWIVEL_SPEED = 0.006;                 // radians per pixel of horizontal drag
const _SWIVEL_UP    = new THREE.Vector3(0, 1, 0);
const _swivelOffset = new THREE.Vector3();
let _swivelActive   = false;
let _swivelLastX    = 0;

renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 2) return;                // right button only
  if (controls.enableRotate) return;         // edit mode → let OrbitControls handle it
  _swivelActive = true;
  _swivelLastX  = e.clientX;
});
window.addEventListener('pointermove', e => {
  if (!_swivelActive) return;
  const dx = e.clientX - _swivelLastX;
  if (dx === 0) return;
  _swivelLastX = e.clientX;
  // Drag right (dx > 0) → +angle about +Y → offset swings 6→3 o'clock (CCW from above).
  _swivelOffset.copy(camera.position).sub(controls.target);
  _swivelOffset.applyAxisAngle(_SWIVEL_UP, dx * _SWIVEL_SPEED);
  camera.position.copy(controls.target).add(_swivelOffset);
});
function _endSwivel() { _swivelActive = false; }
window.addEventListener('pointerup',     e => { if (e.button === 2) _endSwivel(); });
window.addEventListener('pointercancel', _endSwivel);
window.addEventListener('blur',          _endSwivel);
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
