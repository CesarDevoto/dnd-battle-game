import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { barrierSegments, loadBarriersData } from './environments.js';
import { IS_DEV } from './devConfig.js';

let _drawMode      = false;
let _startPt       = null;   // {x,z} — first click while drawing
let _barriers      = [];     // [{x1,z1,x2,z2, line, dot1, dot2}] — visual + data
let _activeZoneId  = null;
let _visibleInDev  = false;  // only true while terrain editor is open

// Live preview objects while placing second point
let _previewLine = null;
let _startDot    = null;

const COL_BARRIER  = 0xffdd00;
const COL_PREVIEW  = 0xffee88;

// ── Geometry helpers ──────────────────────────────────────────────────────────

function _buildLineGeo(x1, z1, x2, z2) {
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

function _lineMesh(x1, z1, x2, z2, color, opacity = 1) {
  const line = new THREE.Line(
    _buildLineGeo(x1, z1, x2, z2),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }),
  );
  line.renderOrder = 6;
  scene.add(line);
  return line;
}

function _dotMesh(x, z, color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthWrite: false }),
  );
  m.position.set(x, getTerrainHeight(x, z) + 0.38, z);
  m.renderOrder = 6;
  scene.add(m);
  return m;
}

function _disposeObj(obj) {
  scene.remove(obj);
  obj.geometry?.dispose();
  obj.material?.dispose();
}

// ── Barrier management ────────────────────────────────────────────────────────

function _addBarrier(x1, z1, x2, z2) {
  barrierSegments.push({ x1, z1, x2, z2 });
  const entry = { x1, z1, x2, z2, line: null, dot1: null, dot2: null };
  if (IS_DEV) {
    entry.line = _lineMesh(x1, z1, x2, z2, COL_BARRIER);
    entry.dot1 = _dotMesh(x1, z1, COL_BARRIER);
    entry.dot2 = _dotMesh(x2, z2, COL_BARRIER);
    entry.line.visible = _visibleInDev;
    entry.dot1.visible = _visibleInDev;
    entry.dot2.visible = _visibleInDev;
  }
  _barriers.push(entry);
  _updateCounter();
}

function _removeAt(idx) {
  const b = _barriers[idx];
  if (!b) return;
  if (b.line) _disposeObj(b.line);
  if (b.dot1) _disposeObj(b.dot1);
  if (b.dot2) _disposeObj(b.dot2);
  _barriers.splice(idx, 1);
  barrierSegments.splice(idx, 1);
  _updateCounter();
}

function _clearAll() {
  for (let i = _barriers.length - 1; i >= 0; i--) _removeAt(i);
  _cancelDraw();
  _updateStatus();
}

function _cancelDraw() {
  if (_startDot)    { _disposeObj(_startDot);    _startDot    = null; }
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _startPt = null;
}

// ── Draw mode ─────────────────────────────────────────────────────────────────

export function isBarrierModeActive() { return _drawMode; }
export function getCurrentBarriers() { return _barriers.map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 })); }

function _setDrawMode(on) {
  _drawMode = on;
  if (!on) _cancelDraw();
  const btn = document.getElementById('te-barrier-draw-btn');
  if (btn) {
    btn.textContent = on ? 'CANCEL DRAW' : 'DRAW BARRIER';
    btn.classList.toggle('active', on);
  }
  _updateStatus();
}

// Called from terrainEditor's capture-phase click handler when _drawMode is true
export function handleBarrierClick(pt) {
  if (!_startPt) {
    _startPt = { x: +pt.x.toFixed(2), z: +pt.z.toFixed(2) };
    if (IS_DEV) _startDot = _dotMesh(_startPt.x, _startPt.z, COL_PREVIEW);
    _updateStatus();
  } else {
    const x1 = _startPt.x, z1 = _startPt.z;
    const x2 = +pt.x.toFixed(2), z2 = +pt.z.toFixed(2);
    _cancelDraw();
    _addBarrier(x1, z1, x2, z2);
    // Chain: next click continues from this endpoint
    _startPt = { x: x2, z: z2 };
    if (IS_DEV) _startDot = _dotMesh(x2, z2, COL_PREVIEW);
    _updateStatus();
  }
}

// Called from terrainEditor's mousemove when _drawMode + _startPt are set
export function handleBarrierMouseMove(pt) {
  if (!_startPt || !pt) return;
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _previewLine = _lineMesh(_startPt.x, _startPt.z, pt.x, pt.z, COL_PREVIEW, 0.5);
}

// ── Load barriers from zone (called by zoneLoader) ────────────────────────────

export function loadBarrierVisuals(arr) {
  // Clear existing visuals + collision data, then restore from zone array
  for (let i = _barriers.length - 1; i >= 0; i--) _removeAt(i);
  _cancelDraw();
  _setDrawMode(false);
  loadBarriersData(arr);
  if (!IS_DEV || !arr?.length) return;
  for (const b of arr) {
    const entry = { x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2,
      line: _lineMesh(b.x1, b.z1, b.x2, b.z2, COL_BARRIER),
      dot1: _dotMesh(b.x1, b.z1, COL_BARRIER),
      dot2: _dotMesh(b.x2, b.z2, COL_BARRIER),
    };
    entry.line.visible = _visibleInDev;
    entry.dot1.visible = _visibleInDev;
    entry.dot2.visible = _visibleInDev;
    _barriers.push(entry);
  }
  _updateCounter();
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function _saveBarriers() {
  if (!_activeZoneId) { _setSaveStatus('No zone loaded', 'error'); return; }
  const payload = _barriers.map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 }));
  _setSaveStatus('Saving…', '');
  try {
    const res  = await fetch('/__save_zone_barriers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ zoneId: _activeZoneId, barriers: payload }),
    });
    const json = await res.json();
    if (json.ok) {
      _setSaveStatus(`Saved ${payload.length} barrier${payload.length !== 1 ? 's' : ''} ✓`, 'ok');
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
  const el = document.getElementById('te-barrier-status');
  if (!el) return;
  if (!_drawMode)        el.textContent = 'Click DRAW to place barriers';
  else if (!_startPt)   el.textContent = 'Click terrain — start point…';
  else                  el.textContent = 'Click terrain — end point…';
}

function _updateCounter() {
  const el = document.getElementById('te-barrier-counter');
  if (el) el.textContent = `Barriers: ${_barriers.length}`;
}

function _setSaveStatus(msg, cls) {
  const el = document.getElementById('te-barrier-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `te-save-status-${cls}` : '';
}

// ── Raycasting (for preview mousemove) ────────────────────────────────────────

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── Visibility (controlled by terrain editor open/close) ──────────────────────

export function setBarrierVisualsVisible(visible) {
  _visibleInDev = visible;
  for (const b of _barriers) {
    if (b.line) b.line.visible = visible;
    if (b.dot1) b.dot1.visible = visible;
    if (b.dot2) b.dot2.visible = visible;
  }
  if (!visible) _cancelDraw();
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initBarrierEditor() {
  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _updateCounter();
    _updateStatus();
  });

  document.getElementById('te-barrier-draw-btn')
    ?.addEventListener('click', () => _setDrawMode(!_drawMode));

  document.getElementById('te-barrier-clear-btn')
    ?.addEventListener('click', () => {
      if (_barriers.length && !confirm(`Remove all ${_barriers.length} barrier(s)?`)) return;
      _clearAll();
    });

  document.getElementById('te-barrier-save-btn')
    ?.addEventListener('click', _saveBarriers);

  // Preview line while drawing
  renderer.domElement.addEventListener('mousemove', e => {
    if (!_drawMode || !_startPt) return;
    handleBarrierMouseMove(_groundPt(e.clientX, e.clientY));
  });

  // Escape exits draw mode
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape' && _drawMode) _setDrawMode(false);
  });

  _updateStatus();
  _updateCounter();
}
