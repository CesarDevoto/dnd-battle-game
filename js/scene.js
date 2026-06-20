import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS, SCENE, GROUND_SIZE, GRID_DIVISIONS, WORLD_UNITS_PER_SQUARE } from './constants.js';

let _sceneGS = GROUND_SIZE;
export function setSceneGroundSize(s) { _sceneGS = s; }
import { buildTerrainMesh, getTerrainHeight } from './terrain.js';

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

export const ground = buildTerrainMesh(
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true })
);
scene.add(ground);

// ── Terrain-conforming grid ───────────────────────────────────────────────────
// Instead of a flat GridHelper we build LineSegments whose vertices are sampled
// from getTerrainHeight, subdividing each cell into SUB steps so the lines hug
// hills and valleys.  rebuildGrid() is called by environments.js whenever the
// terrain changes (biome switch).

const _GRID_SUB    = 4;     // sub-steps per cell — captures fine terrain detail
const _GRID_Y_LIFT = 0.07;  // world-units above the surface (avoids z-fighting)

function _buildGridGeo() {
  const GS   = _sceneGS;
  const DIVS = Math.round(GS / WORLD_UNITS_PER_SQUARE);  // always 1 cell = 1 grid square
  const CELL = GS / DIVS;
  const STEP = CELL / _GRID_SUB;
  const half = GS * 0.5;

  // Pre-compute all heights on a (DIVS*SUB+1)² sub-grid — each point sampled once
  const pts  = DIVS * _GRID_SUB + 1;
  const h    = new Float32Array(pts * pts);
  for (let iz = 0; iz < pts; iz++) {
    for (let ix = 0; ix < pts; ix++) {
      h[iz * pts + ix] = getTerrainHeight(-half + ix * STEP, -half + iz * STEP) + _GRID_Y_LIFT;
    }
  }

  // Build vertex pairs for LineSegments (each pair = one segment)
  const verts = [];

  // Lines running in X (constant Z row)
  for (let iz = 0; iz <= DIVS; iz++) {
    const row = iz * _GRID_SUB;
    for (let ix = 0; ix < DIVS * _GRID_SUB; ix++) {
      const x0 = -half + ix       * STEP;
      const x1 = -half + (ix + 1) * STEP;
      const z  = -half + iz       * CELL;
      verts.push(x0, h[row * pts + ix],       z,
                 x1, h[row * pts + (ix + 1)], z);
    }
  }

  // Lines running in Z (constant X column)
  for (let ix = 0; ix <= DIVS; ix++) {
    const col = ix * _GRID_SUB;
    for (let iz = 0; iz < DIVS * _GRID_SUB; iz++) {
      const z0 = -half + iz       * STEP;
      const z1 = -half + (iz + 1) * STEP;
      const x  = -half + ix       * CELL;
      verts.push(x, h[iz       * pts + col], z0,
                 x, h[(iz + 1) * pts + col], z1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return geo;
}

export const grid = new THREE.LineSegments(
  _buildGridGeo(),
  new THREE.LineBasicMaterial({
    color:       COLORS.gridMain,
    transparent: true,
    opacity:     0.03,
    depthTest:   false,
    depthWrite:  false,
  })
);
grid.renderOrder = 2;
grid.visible = false;
scene.add(grid);

export function rebuildGrid() {
  grid.geometry.dispose();
  grid.geometry = _buildGridGeo();
}

const gridBtn = document.getElementById('grid-toggle-btn');
gridBtn.textContent = 'Grid Off';
gridBtn.classList.add('off');
gridBtn.addEventListener('click', function () {
  setGridVisible(!grid.visible);
});

export function setGridVisible(v) {
  grid.visible = v;
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
