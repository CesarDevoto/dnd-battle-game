import * as THREE from 'three';
import { scene, camera, renderer, ground, controls, grid } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { IS_DEV } from './devConfig.js';

// ── Reference-image overlay ───────────────────────────────────────────────────
// A dev-only "blueprint underlay": import a 2D image, lay it flat on the ground,
// and stretch/move/rotate/fade it as a guide to build a zone on top of. Stored
// per-zone in localStorage (never touches the zone file or the repo, never
// ships to players). Toggle it off once the zone is built.

const LS_PREFIX = 'dnd-refimg-';   // + zoneId

// ── Overlay mesh (a flat, scalable textured plane in a yaw group) ─────────────
let _group   = null;    // holds the plane; carries position / rotation.y / scale
let _plane   = null;
let _tex     = null;

// ── State (mirrors what we persist) ──────────────────────────────────────────
let _zoneId  = null;
let _state   = null;    // { url, x, z, w, h, rotDeg, opacity, visible } | null
let _moveMode = false;
let _dragging = false;
const _grab   = new THREE.Vector2();   // offset from center to cursor at grab

function _defaultState(url) {
  const gs = _gs();
  return { url, x: 0, z: 0, w: gs, h: gs, rotDeg: 0, opacity: 0.8, visible: true };
}

function _gs() { return ground.geometry.parameters?.width ?? 216; }

// ── Build / dispose the mesh ─────────────────────────────────────────────────
function _disposeMesh() {
  if (_group) { scene.remove(_group); }
  _plane?.geometry.dispose();
  _plane?.material.dispose();
  _tex?.dispose();
  _group = _plane = _tex = null;
  _setGridOnTop(false);
}

// The reference plane hovers above the ground with no depth write, so from an
// overhead view it draws over the grid. The grid ships at renderOrder 2 — the
// SAME as the plane — so they tie and the (closer) plane wins the distance sort.
// While the guide is visible, bump the grid above the plane so it floats on top
// of the picture (buildings still occlude the grid normally — the image is the
// only thing not writing depth). Restored to the grid's real default otherwise.
const _PLANE_ORDER      = 2;
const _GRID_BASE_ORDER  = grid?.renderOrder ?? 2;
function _setGridOnTop(on) {
  if (!grid) return;
  grid.renderOrder = on ? _PLANE_ORDER + 2 : _GRID_BASE_ORDER;
}

function _buildMesh(url) {
  _disposeMesh();
  _tex = new THREE.TextureLoader().load(url, () => {}, undefined, () => {
    _setStatus('Failed to load image', 'error');
  });
  _tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: _tex, transparent: true, opacity: _state?.opacity ?? 0.8,
    // depthTest ON + depthWrite OFF: the blueprint is a GROUND DECAL. It's subdivided and draped
    // onto the terrain surface (_conformToTerrain), so hills never clip it — AND, because it
    // respects depth, props and heroes standing on it render fully OVER it instead of being washed
    // out by it. (An earlier depthTest:false version drew over everything, hiding the props.)
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
  // Subdivided so it can bend over the terrain rather than sitting flat at one height.
  _plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 32, 32), mat);
  _plane.rotation.x = -Math.PI / 2;      // lay flat
  _plane.renderOrder = _PLANE_ORDER;
  _group = new THREE.Group();
  _group.add(_plane);
  scene.add(_group);
  _applyState();
}

const _cv = new THREE.Vector3();
// Bend the plane's vertices so the picture drapes ~0.2 WU above the terrain everywhere (a ground
// decal), instead of a flat sheet at one height. Called whenever the overlay moves/scales/rotates.
function _conformToTerrain() {
  if (!_plane || !_state) return;
  const posAttr = _plane.geometry.attributes.position;
  const centreH = getTerrainHeight(_state.x, _state.z);   // group base y is this + 0.2
  _group.updateMatrixWorld(true);
  for (let i = 0; i < posAttr.count; i++) {
    // World XZ of this vertex (its local Z=0; the group transform is baked into matrixWorld).
    _cv.set(posAttr.getX(i), posAttr.getY(i), 0);
    _plane.localToWorld(_cv);
    // Local +Z maps straight to world +Y here (plane flat, group scale.y=1, only Y-rotation), so
    // this offset lifts each vertex to its own terrain height while the group base holds the +0.2.
    posAttr.setZ(i, getTerrainHeight(_cv.x, _cv.z) - centreH);
  }
  posAttr.needsUpdate = true;
}

function _applyState() {
  if (!_group || !_state) return;
  const y = getTerrainHeight(_state.x, _state.z) + 0.2;   // hover just above ground
  _group.position.set(_state.x, y, _state.z);
  _group.rotation.y = _state.rotDeg * Math.PI / 180;
  _group.scale.set(_state.w, 1, _state.h);
  _group.visible = _state.visible;
  if (_plane) _plane.material.opacity = _state.opacity;
  _conformToTerrain();
  _setGridOnTop(_state.visible);   // grid floats over the picture while it's shown
}

// ── Persistence (dev-local, per zone) ────────────────────────────────────────
function _save() {
  if (!_zoneId || !_state) return;
  try {
    localStorage.setItem(LS_PREFIX + _zoneId, JSON.stringify(_state));
  } catch (e) {
    // Data URLs can blow past the ~5MB quota — keep the overlay for this
    // session but warn that it won't survive a reload.
    _setStatus('Image too large to save — kept for this session only', 'error');
  }
}

function _load(zoneId) {
  _disposeMesh();
  _state = null;
  _moveMode = false; _dragging = false;
  _setMoveBtn(false);
  let raw = null;
  try { raw = localStorage.getItem(LS_PREFIX + zoneId); } catch {}
  if (raw) {
    try {
      _state = JSON.parse(raw);
      _buildMesh(_state.url);
    } catch { _state = null; }
  }
  _syncInputs();
  _updateUI();
}

// ── Import ───────────────────────────────────────────────────────────────────
function _importFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    _state = _defaultState(reader.result);
    _buildMesh(_state.url);
    _save();
    _syncInputs();
    _updateUI();
    _setStatus('Imported ✓', 'ok');
  };
  reader.onerror = () => _setStatus('Could not read file', 'error');
  reader.readAsDataURL(file);
}

// ── Drag to move ─────────────────────────────────────────────────────────────
export function isRefMoveActive() { return _moveMode; }

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── UI helpers ───────────────────────────────────────────────────────────────
function _setStatus(msg, cls) {
  const el = document.getElementById('ri-status');
  if (!el) return;
  el.textContent = msg;
  el.className = cls ? `te-save-status-${cls}` : 'te-status-small';
}

function _setMoveBtn(on) {
  const btn = document.getElementById('ri-move-btn');
  if (btn) { btn.textContent = on ? 'STOP MOVING' : 'MOVE IMAGE'; btn.classList.toggle('active', on); }
}

function _updateUI() {
  const has = !!_state;
  const showBtn = document.getElementById('ri-show-btn');
  if (showBtn) showBtn.textContent = _state?.visible ? 'HIDE' : 'SHOW';
  ['ri-opacity','ri-width','ri-height','ri-rot','ri-move-btn','ri-fit-btn','ri-fitzone-btn','ri-show-btn','ri-clear-btn']
    .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = !has; });
  if (!has) _setStatus('Import an image to use as a build guide', '');
}

function _syncInputs() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  if (!_state) return;
  set('ri-opacity', _state.opacity);
  set('ri-width',   Math.round(_state.w));
  set('ri-height',  Math.round(_state.h));
  set('ri-rot',     Math.round(_state.rotDeg));
}

// ── Init ─────────────────────────────────────────────────────────────────────
export function initReferenceOverlay() {
  window.addEventListener('zone:loaded', e => {
    _zoneId = e.detail?.id ?? null;
    if (_zoneId) _load(_zoneId);
  });

  // Drop move mode when the terrain editor closes.
  document.getElementById('terrain-editor-btn')?.addEventListener('click', () => {
    if (_moveMode) { _moveMode = false; _dragging = false; _setMoveBtn(false); controls.enabled = true; }
  });

  if (!IS_DEV) return;   // overlay is a dev build-guide only

  document.getElementById('ri-file')?.addEventListener('change', e => {
    _importFile(e.target.files?.[0]);
    e.target.value = '';   // allow re-importing the same file
  });

  document.getElementById('ri-opacity')?.addEventListener('input', e => {
    if (!_state) return; _state.opacity = parseFloat(e.target.value); _applyState(); _save();
  });
  document.getElementById('ri-width')?.addEventListener('input', e => {
    if (!_state) return; _state.w = Math.max(1, parseFloat(e.target.value) || 1); _applyState(); _save();
  });
  document.getElementById('ri-height')?.addEventListener('input', e => {
    if (!_state) return; _state.h = Math.max(1, parseFloat(e.target.value) || 1); _applyState(); _save();
  });
  document.getElementById('ri-rot')?.addEventListener('input', e => {
    if (!_state) return; _state.rotDeg = parseFloat(e.target.value) || 0; _applyState(); _save();
  });

  // FIT IMG — stretch the image to fill the current zone (image → zone).
  document.getElementById('ri-fit-btn')?.addEventListener('click', () => {
    if (!_state) return;
    const gs = _gs();
    _state.x = 0; _state.z = 0; _state.w = gs; _state.h = gs; _state.rotDeg = 0;
    _applyState(); _syncInputs(); _save();
  });

  // FIT ZONE — resize the zone's GROUND to match the image (zone → image). The ground is square, so
  // it's sized to the image's larger side, rounded UP to a multiple of 4 (zone-system constraint).
  // zoneLoader applies + persists it (and reloads the zone to rebuild terrain/grid at the new size).
  document.getElementById('ri-fitzone-btn')?.addEventListener('click', () => {
    if (!_state) return;
    const gs = Math.max(4, Math.ceil(Math.max(_state.w, _state.h) / 4) * 4);
    // Centre the image first: the ground is always centred on origin, so an off-centre image would
    // otherwise fall partly outside the resized ground. Now picture and ground line up.
    _state.x = 0; _state.z = 0;
    _applyState(); _syncInputs(); _save();
    window.dispatchEvent(new CustomEvent('zone:fitToRef', { detail: { groundSize: gs } }));
    _setStatus(`Zone ground → ${gs} WU (reloading…)`, 'ok');
  });

  document.getElementById('ri-show-btn')?.addEventListener('click', () => {
    if (!_state) return; _state.visible = !_state.visible; _applyState(); _save(); _updateUI();
  });

  document.getElementById('ri-clear-btn')?.addEventListener('click', () => {
    if (!_state) return;
    if (!confirm('Remove the reference image for this zone?')) return;
    _disposeMesh();
    _state = null;
    try { localStorage.removeItem(LS_PREFIX + _zoneId); } catch {}
    _moveMode = false; _dragging = false; _setMoveBtn(false); controls.enabled = true;
    _updateUI();
    _setStatus('Removed', '');
  });

  document.getElementById('ri-move-btn')?.addEventListener('click', () => {
    _moveMode = !_moveMode;
    if (!_moveMode && _dragging) { _dragging = false; controls.enabled = true; }
    _setMoveBtn(_moveMode);
    _setStatus(_moveMode ? 'Drag the image to reposition it' : '', _moveMode ? '' : '');
  });

  // ── Drag handlers (capture phase — beat OrbitControls) ──────────────────────
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!_moveMode || !_state || e.button !== 0) return;
    const gp = _groundPt(e.clientX, e.clientY);
    if (!gp) return;
    e.stopImmediatePropagation();
    controls.enabled = false;
    _dragging = true;
    _grab.set(_state.x - gp.x, _state.z - gp.z);   // keep grab point under cursor
  }, true);

  renderer.domElement.addEventListener('pointermove', e => {
    if (!_dragging || !_state) return;
    e.stopImmediatePropagation();
    const gp = _groundPt(e.clientX, e.clientY);
    if (!gp) return;
    _state.x = +(gp.x + _grab.x).toFixed(2);
    _state.z = +(gp.z + _grab.y).toFixed(2);
    _applyState();
  }, true);

  window.addEventListener('pointerup', () => {
    if (!_dragging) return;
    _dragging = false;
    controls.enabled = true;
    _save();
  }, true);

  _updateUI();
}
