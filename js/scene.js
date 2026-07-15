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

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });

// ── Adaptive resolution ───────────────────────────────────────────────────────
// The render cost scales with the SQUARE of the pixel ratio: on a 4K laptop, a ratio of
// 2 is 4× the fragment work of 1080p, which is why the game can run fine on one machine
// and crawl on another with a nominally similar GPU. Cap at 1.5 rather than 2 (the
// difference is barely visible, the cost is not), then adapt downward if frames are
// actually slow — a weak GPU gets a playable game instead of a pretty slideshow.
const MAX_DPR = Math.min(window.devicePixelRatio, 1.5);
const MIN_DPR = 0.75;
let _dpr = MAX_DPR;

renderer.setPixelRatio(_dpr);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

// Sample frames and walk the pixel ratio down when the GPU can't keep up (and back up
// when it can). Deliberately sluggish: it only acts on a ~45-frame average, waits out a
// cooldown after every change, and ignores the first few seconds entirely — otherwise the
// load-time hitches would drag the resolution down and it would never recover.
const _RES = {
  acc: 0, frames: 0, cooldown: 0, warmup: 4,
  SAMPLE:   45,     // frames per decision
  DOWN_FPS: 45,     // below this → drop resolution
  UP_FPS:   75,     // comfortably above target → try raising it back
  STEP:     0.25,
};

export function tickAdaptiveResolution(dt) {
  if (_RES.warmup > 0) { _RES.warmup -= dt; return; }   // ignore the loading storm
  if (_RES.cooldown > 0) _RES.cooldown -= dt;

  _RES.acc += dt;
  _RES.frames++;
  if (_RES.frames < _RES.SAMPLE) return;

  const fps = _RES.frames / _RES.acc;
  _RES.acc = 0;
  _RES.frames = 0;
  if (_RES.cooldown > 0) return;

  let next = _dpr;
  if      (fps < _RES.DOWN_FPS && _dpr > MIN_DPR) next = Math.max(MIN_DPR, _dpr - _RES.STEP);
  else if (fps > _RES.UP_FPS   && _dpr < MAX_DPR) next = Math.min(MAX_DPR, _dpr + _RES.STEP);
  if (next === _dpr) return;

  _dpr = next;
  // setPixelRatio alone doesn't resize the drawing buffer — setSize must follow it.
  renderer.setPixelRatio(_dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  _RES.cooldown = fps < _RES.DOWN_FPS ? 3 : 6;   // slower to climb back than to bail out
  console.info(`[perf] ${fps.toFixed(0)} fps → pixel ratio ${_dpr.toFixed(2)}`);
}

export function getPixelRatio() { return _dpr; }

// Compile every shader program the current scene needs, NOW, instead of letting three.js
// do it lazily on first draw.
//
// This is the fix for "choppy for the first few minutes, then fine". Three.js compiles a
// GLSL program the first time each material/light combination is actually rendered, and
// each compile stalls the main thread for tens of milliseconds. So the game hitches on
// the first goblin, the first fire bolt, the first fog patch — and smooths out only once
// everything has been drawn once. Doing it here moves those stalls behind the loading
// screen, where nobody can see them.
//
// compileAsync yields between programs (no long frame-blocking stall); the sync compile()
// is the fallback. Failures are swallowed — a precompile is an optimisation, and must
// never be the reason the game won't start.
export function precompileScene() {
  try {
    if (typeof renderer.compileAsync === 'function') {
      return renderer.compileAsync(scene, camera).catch(() => {});
    }
    renderer.compile(scene, camera);
  } catch { /* never block startup on a precompile */ }
  return Promise.resolve();
}

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

// ── Dev camera pose persistence ───────────────────────────────────────────────
// Save/restore the free camera position + orbit target to localStorage so a zone
// reload in dev view returns to where you were instead of snapping to the party.
export function saveCameraPose(key) {
  try {
    localStorage.setItem(key, JSON.stringify({
      p: [camera.position.x, camera.position.y, camera.position.z],
      t: [controls.target.x, controls.target.y, controls.target.z],
    }));
  } catch {}
}
export function restoreCameraPose(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const { p, t } = JSON.parse(raw);
    camera.position.set(p[0], p[1], p[2]);
    controls.target.set(t[0], t[1], t[2]);
    controls.update();
    return true;
  } catch { return false; }
}

// ── Top-view toggle ───────────────────────────────────────────────────────────

// ── Scroll zoom ───────────────────────────────────────────────────────────────
const TOP_VIEW_Y_DEFAULT = 50;
const TOP_VIEW_Y_MIN     = 12;
const TOP_VIEW_Y_MAX     = 62;
// Regular view: each notch tightens orbit by 1 WU and narrows FOV 2°.
// The zoom-in floor is SCENE.orbitMinDist, so the closest notch sits exactly on the orbit
// distance the scene already declares as its minimum (20 WU default -> 10 WU, i.e. 10
// notches). It used to stop at 6, which bottomed out at 14 WU — well short of that floor.
const REG_ZOOM_ORBIT     = 1;    // WU closer per notch
const REG_ZOOM_FOV       = 2;    // degrees narrower per notch
const REG_ZOOM_MAX       = Math.floor(
  (SCENE.orbitMaxDist - SCENE.orbitMinDist) / REG_ZOOM_ORBIT);

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
  // No-op while the editor is active. Top view pins controls.min/maxDistance to _topViewY and
  // re-pins them EVERY FRAME (updateCameraFocus below), which overrides the editor's free
  // camera (devMode's 0.3–1200 dolly + pan/rotate) and snaps it back the moment you move it.
  // Worse, toggling back OUT restores the PLAY-view limits — it has no idea the editor was on
  // — so the free camera stays clamped afterwards and only recovers by cycling dev mode.
  // The editor already has free look, so top-down adds nothing there. Guarded HERE rather
  // than on the keybind so every caller is covered, not just the G key.
  if (isEditModeActive()) return;

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
  // Opening the editor WHILE top view is on would otherwise strand the camera: the pin below
  // runs every frame, and toggleTopView is now a no-op in the editor, so G couldn't undo it.
  // Release top view and let devMode own the camera — don't touch min/maxDistance on the way
  // out, since devMode's _applyCamera has already set its own free-dolly limits.
  if (_topViewActive && isEditModeActive()) {
    _topViewActive   = false;
    _topViewSavedPos = null;
    _topViewSavedTgt = null;
  }

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
const _CAM_CLEARANCE = 3;                     // WU the lens must stay above the ground beneath it
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
  // Reject any swivel that would carry the lens onto ground taller than its own height —
  // otherwise orbiting past a steep hill drops the camera behind/under the terrain and you
  // see the void beneath it. The swivel is a horizontal orbit, so the height never changes;
  // we just refuse the azimuths where the new XZ pokes into a hillside and keep the last one.
  const camX = controls.target.x + _swivelOffset.x;
  const camZ = controls.target.z + _swivelOffset.z;
  const camY = controls.target.y + _swivelOffset.y;
  if (camY < getTerrainHeight(camX, camZ) + _CAM_CLEARANCE) return;
  camera.position.set(camX, camY, camZ);
});
function _endSwivel() { _swivelActive = false; }
window.addEventListener('pointerup',     e => { if (e.button === 2) _endSwivel(); });
window.addEventListener('pointercancel', _endSwivel);
window.addEventListener('blur',          _endSwivel);
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
