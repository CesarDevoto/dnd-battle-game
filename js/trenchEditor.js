import * as THREE from 'three';
import { scene, camera, renderer, ground, rebuildGrid } from './scene.js';
import { getTerrainHeight, getTerrainTrenches, setTerrainTrenches, rebuildTerrainGeometry } from './terrain.js';
import { isBarrierModeActive } from './barrierEditor.js';
import { IS_DEV } from './devConfig.js';

let _drawMode      = false;
let _currentPath   = null;   // the in-progress path object — already live in getTerrainTrenches()
let _activeZoneId  = null;
let _visibleInDev  = false;  // only true while terrain editor is open

let _previewLine = null;     // rubber-band from last committed point to cursor

const COL_TRENCH  = 0xcc6633;
const COL_PREVIEW = 0xffaa77;

// path object → { line, dots[] } — keyed by reference so undo/clear/reload
// never has to keep a parallel index in sync with getTerrainTrenches()
const _visuals = new Map();

// ── Geometry helpers ──────────────────────────────────────────────────────────

function _buildSegLineGeo(x1, z1, x2, z2) {
  const STEPS = 10;
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.28, z));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function _buildPathLineGeo(points) {
  const STEPS_PER_SEG = 6;
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const startJ = i === 0 ? 0 : 1; // skip duplicate vertex at shared joints
    for (let j = startJ; j <= STEPS_PER_SEG; j++) {
      const t = j / STEPS_PER_SEG;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.28, z));
    }
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function _lineMesh(x1, z1, x2, z2, color, opacity = 1) {
  const line = new THREE.Line(
    _buildSegLineGeo(x1, z1, x2, z2),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, depthTest: false }),
  );
  line.renderOrder = 20;
  scene.add(line);
  return line;
}

function _pathLineMesh(points, color) {
  const line = new THREE.Line(
    _buildPathLineGeo(points),
    new THREE.LineBasicMaterial({ color, depthWrite: false, depthTest: false }),
  );
  line.renderOrder = 20;
  line.visible = _visibleInDev;
  scene.add(line);
  return line;
}

function _dotMesh(x, z, color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthWrite: false, depthTest: false }),
  );
  m.position.set(x, getTerrainHeight(x, z) + 0.38, z);
  m.renderOrder = 20;
  m.visible = _visibleInDev;
  scene.add(m);
  return m;
}

function _disposeObj(obj) {
  scene.remove(obj);
  obj.geometry?.dispose();
  obj.material?.dispose();
}

// ── Per-path visual bookkeeping ────────────────────────────────────────────────

function _disposePathVisual(path) {
  const v = _visuals.get(path);
  if (!v) return;
  if (v.line) _disposeObj(v.line);
  v.dots.forEach(_disposeObj);
  _visuals.delete(path);
}

function _rebuildPathVisual(path) {
  _disposePathVisual(path);
  if (!IS_DEV) return;
  const line = _pathLineMesh(path.points, COL_TRENCH);
  const dots = path.points.map(p => {
    const d = _dotMesh(p.x, p.z, COL_TRENCH);
    d.visible = _visibleInDev;
    return d;
  });
  _visuals.set(path, { line, dots });
}

function _disposeAllVisuals() {
  for (const path of _visuals.keys()) _disposePathVisual(path);
}

// ── Terrain mesh refresh ────────────────────────────────────────────────────────

function _refreshTerrain() {
  rebuildTerrainGeometry(ground);
  rebuildGrid();
}

// ── Draw mode ─────────────────────────────────────────────────────────────────

export function isTrenchModeActive() { return _drawMode; }

export function getCurrentTrenches() {
  return getTerrainTrenches().map(({ points, h, r, pr }) => {
    const out = { points: points.map(p => ({ x: p.x, z: p.z })), h, r };
    if (pr) out.pr = pr;
    return out;
  });
}

function _finalizeCurrentPath() {
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  if (!_currentPath) return;
  if (_currentPath.points.length < 2) {
    setTerrainTrenches(getTerrainTrenches().filter(p => p !== _currentPath));
    _disposePathVisual(_currentPath);
    _refreshTerrain();
  }
  _currentPath = null;
}

function _setDrawMode(on) {
  if (on && isBarrierModeActive()) {
    _flashStatus('Finish/cancel barrier drawing first');
    return;
  }
  _drawMode = on;
  if (!on) _finalizeCurrentPath();
  const btn = document.getElementById('te-trench-draw-btn');
  if (btn) {
    btn.textContent = on ? 'CANCEL DRAW' : 'DRAW TRENCH';
    btn.classList.toggle('active', on);
  }
  _updateStatus();
  _updateCounter();
}

// Called from terrainEditor's capture-phase click handler when _drawMode is true
export function handleTrenchClick(pt, defaults) {
  const x = +pt.x.toFixed(2), z = +pt.z.toFixed(2);
  if (!_currentPath) {
    _currentPath = { points: [{ x, z }], h: defaults.h, r: defaults.r };
    if (defaults.pr > 0) _currentPath.pr = defaults.pr;
    setTerrainTrenches([...getTerrainTrenches(), _currentPath]);
  } else {
    _currentPath.points.push({ x, z });
  }
  _refreshTerrain();
  _rebuildPathVisual(_currentPath);
  _updateStatus();
  _updateCounter();
}

// Called from terrainEditor's mousemove when _drawMode + _currentPath are set
export function handleTrenchMouseMove(pt) {
  if (!_currentPath || !pt) return;
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  const last = _currentPath.points[_currentPath.points.length - 1];
  _previewLine = _lineMesh(last.x, last.z, pt.x, pt.z, COL_PREVIEW, 0.5);
  _previewLine.visible = _visibleInDev;
}

export function undoLastTrench() {
  if (_currentPath) {
    _currentPath.points.pop();
    if (_currentPath.points.length === 0) {
      setTerrainTrenches(getTerrainTrenches().filter(p => p !== _currentPath));
      _disposePathVisual(_currentPath);
      _currentPath = null;
    } else {
      _rebuildPathVisual(_currentPath);
    }
    _refreshTerrain();
    _updateStatus();
    _updateCounter();
    return;
  }
  const paths = getTerrainTrenches();
  if (!paths.length) return;
  const last = paths[paths.length - 1];
  setTerrainTrenches(paths.slice(0, -1));
  _disposePathVisual(last);
  _refreshTerrain();
  _updateCounter();
}

function _clearAll() {
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _currentPath = null;
  _disposeAllVisuals();
  setTerrainTrenches([]);
  _refreshTerrain();
  _updateStatus();
  _updateCounter();
}

// ── Load trenches from zone (called by zoneLoader) ────────────────────────────

export function loadTrenchVisuals(arr) {
  _disposeAllVisuals();
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _currentPath = null;
  _drawMode = false;
  setTerrainTrenches(arr ?? []);
  for (const path of getTerrainTrenches()) _rebuildPathVisual(path);
  _updateStatus();
  _updateCounter();
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function _saveTrenches() {
  if (!_activeZoneId) { _setSaveStatus('No zone loaded', 'error'); return; }
  const payload = getCurrentTrenches();
  _setSaveStatus('Saving…', '');
  try {
    const res  = await fetch('/__save_zone_trenches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ zoneId: _activeZoneId, trenches: payload }),
    });
    const json = await res.json();
    if (json.ok) {
      _setSaveStatus(`Saved ${payload.length} trench${payload.length !== 1 ? 'es' : ''} ✓`, 'ok');
      setTimeout(() => _setSaveStatus('', ''), 3000);
    } else {
      _setSaveStatus(`Error: ${json.error}`, 'error');
    }
  } catch (e) {
    _setSaveStatus(`Failed: ${e.message}`, 'error');
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function _updateStatus() {
  const el = document.getElementById('te-trench-status');
  if (!el) return;
  if (!_drawMode)         el.textContent = 'Click DRAW TRENCH, then click a chain of points';
  else if (!_currentPath) el.textContent = 'Click terrain — start point…';
  else                    el.textContent = `Click terrain — next point… (${_currentPath.points.length} so far)`;
}

function _flashStatus(msg) {
  const el = document.getElementById('te-trench-status');
  if (!el) return;
  el.textContent = msg;
  setTimeout(_updateStatus, 1600);
}

function _updateCounter() {
  const el = document.getElementById('te-trench-counter');
  if (el) el.textContent = `Trenches: ${getTerrainTrenches().length}`;
}

function _setSaveStatus(msg, cls) {
  const el = document.getElementById('te-trench-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `te-save-status-${cls}` : '';
}

// ── Raycasting (for click/preview) ────────────────────────────────────────────

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── Visibility (controlled by terrain editor open/close) ──────────────────────

export function setTrenchVisualsVisible(visible) {
  _visibleInDev = visible;
  for (const { line, dots } of _visuals.values()) {
    if (line) line.visible = visible;
    dots.forEach(d => { d.visible = visible; });
  }
  if (_previewLine) _previewLine.visible = visible;
  if (!visible) _setDrawMode(false); // reset draw mode so it doesn't persist on reopen
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTrenchEditor() {
  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _updateCounter();
    _updateStatus();
  });

  document.getElementById('te-trench-draw-btn')
    ?.addEventListener('click', () => _setDrawMode(!_drawMode));

  document.getElementById('te-trench-clear-btn')
    ?.addEventListener('click', () => {
      const n = getTerrainTrenches().length;
      if (n && !confirm(`Remove all ${n} trench${n !== 1 ? 'es' : ''}?`)) return;
      _clearAll();
    });

  document.getElementById('te-trench-save-btn')
    ?.addEventListener('click', _saveTrenches);

  renderer.domElement.addEventListener('mousemove', e => {
    if (!_drawMode || !_currentPath) return;
    handleTrenchMouseMove(_groundPt(e.clientX, e.clientY));
  });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape' && _drawMode) _setDrawMode(false);
  });

  _updateStatus();
  _updateCounter();
}
