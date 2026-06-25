import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { IS_DEV } from './devConfig.js';
import { initVisionBlockers, setVisionBlockerOverlayVisible } from './visionBlockers.js';

let _drawMode      = false;
let _startPt       = null;
let _segs          = [];       // [{x1,z1,x2,z2,y,lineId, line,dot1,dot2}]
let _activeZoneId  = null;
let _visible       = false;
let _overlayOn     = true;
let _selectedLineId = -1;     // which lineId group is selected (-1 = none)
let _lineCounter   = 0;       // increments each time draw mode is turned on
let _currentLineId = 0;

let _previewLine = null;
let _startDot    = null;

const COL     = 0x00ccff;
const COL_SEL = 0xffffff;
const COL_PRE = 0x88eeff;
const Y_STEP  = 0.25;

// ── Geometry ──────────────────────────────────────────────────────────────────

function _buildLineGeo(x1, z1, x2, z2, yOff = 0) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.32 + yOff, z));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function _lineMesh(x1, z1, x2, z2, color, opacity = 1, yOff = 0) {
  const line = new THREE.Line(
    _buildLineGeo(x1, z1, x2, z2, yOff),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }),
  );
  line.renderOrder = 7;
  scene.add(line);
  return line;
}

function _dotMesh(x, z, color, yOff = 0) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthWrite: false }),
  );
  m.position.set(x, getTerrainHeight(x, z) + 0.42 + yOff, z);
  m.renderOrder = 7;
  scene.add(m);
  return m;
}

function _dispose(obj) {
  scene.remove(obj);
  obj.geometry?.dispose();
  obj.material?.dispose();
}

// ── Segment management ────────────────────────────────────────────────────────

function _rebuildSegVisual(idx) {
  const s = _segs[idx];
  if (!s || !IS_DEV) return;
  if (s.line) _dispose(s.line);
  if (s.dot1) _dispose(s.dot1);
  if (s.dot2) _dispose(s.dot2);
  const col  = s.lineId === _selectedLineId ? COL_SEL : COL;
  const yOff = s.y ?? 0;
  s.line = _lineMesh(s.x1, s.z1, s.x2, s.z2, col, 1, yOff);
  s.dot1 = _dotMesh(s.x1, s.z1, col, yOff);
  s.dot2 = _dotMesh(s.x2, s.z2, col, yOff);
  s.line.visible = _visible;
  s.dot1.visible = _visible;
  s.dot2.visible = _visible;
}

function _rebuildGroupVisuals(lineId) {
  _segs.forEach((s, i) => { if (s.lineId === lineId) _rebuildSegVisual(i); });
}

function _selectLineId(lineId) {
  const prev = _selectedLineId;
  _selectedLineId = lineId;
  if (prev !== -1) _rebuildGroupVisuals(prev);
  if (lineId !== -1) _rebuildGroupVisuals(lineId);
  _updateStatus();
}

function _addSeg(x1, z1, x2, z2) {
  const entry = { x1, z1, x2, z2, y: 0, lineId: _currentLineId, line: null, dot1: null, dot2: null };
  _segs.push(entry);
  // Deselect old group visuals, then select new one
  const prev = _selectedLineId;
  _selectedLineId = _currentLineId;
  if (prev !== -1 && prev !== _currentLineId) _rebuildGroupVisuals(prev);
  _rebuildSegVisual(_segs.length - 1);
  _rebuildOverlay();
  _updateCounter();
  _updateStatus();
}

function _removeAt(idx) {
  const s = _segs[idx];
  if (!s) return;
  if (s.line) _dispose(s.line);
  if (s.dot1) _dispose(s.dot1);
  if (s.dot2) _dispose(s.dot2);
  const removedLineId = s.lineId;
  _segs.splice(idx, 1);
  // If selected group still has segments, keep it; otherwise select last segment's group
  const groupStillExists = _segs.some(seg => seg.lineId === removedLineId);
  if (!groupStillExists && _selectedLineId === removedLineId) {
    _selectedLineId = _segs.length > 0 ? _segs[_segs.length - 1].lineId : -1;
  }
  _rebuildOverlay();
  _updateCounter();
  _updateStatus();
}

function _clearAll() {
  for (let i = _segs.length - 1; i >= 0; i--) _removeAt(i);
  _selectedLineId = -1;
  _cancelDraw();
  _updateStatus();
}

function _rebuildOverlay() {
  initVisionBlockers(_segs.map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 })));
  setVisionBlockerOverlayVisible(_overlayOn);
}

function _adjustSelectedY(delta) {
  if (_selectedLineId === -1) return;
  _segs.forEach((s, i) => {
    if (s.lineId !== _selectedLineId) return;
    s.y = +((s.y ?? 0) + delta).toFixed(3);
    _rebuildSegVisual(i);
  });
  _updateStatus();
}

// ── Draw mode ─────────────────────────────────────────────────────────────────

function _cancelDraw() {
  if (_startDot)    { _dispose(_startDot);    _startDot    = null; }
  if (_previewLine) { _dispose(_previewLine); _previewLine = null; }
  _startPt = null;
}

export function isVisionBlockerModeActive() { return _drawMode; }
export function getCurrentVisionBlockers() {
  return _segs.map(({ x1, z1, x2, z2, y, lineId }) => ({ x1, z1, x2, z2, y: y ?? 0, lineId }));
}
export function undoLastVisionBlocker() {
  if (_startPt) { _cancelDraw(); _updateStatus(); }
  else if (_segs.length) _removeAt(_segs.length - 1);
}
export function hasSelectedVisionBlocker() { return _selectedLineId !== -1; }
export function adjustSelectedVisionBlockerY(delta) { _adjustSelectedY(delta); }

// Raycasts against all visible VB dots; selects the group if hit. Returns true if hit.
export function pickVisionBlockerDotAt(cx, cy) {
  if (!_visible || !IS_DEV) return false;
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  const rc  = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const candidates = [];
  _segs.forEach((s, i) => {
    if (s.dot1) candidates.push({ mesh: s.dot1, idx: i });
    if (s.dot2) candidates.push({ mesh: s.dot2, idx: i });
  });
  const hits = rc.intersectObjects(candidates.map(c => c.mesh), false);
  if (!hits.length) return false;
  const found = candidates.find(c => c.mesh === hits[0].object);
  if (!found) return false;
  _selectLineId(_segs[found.idx].lineId);
  return true;
}

function _setDrawMode(on) {
  _drawMode = on;
  if (on) _currentLineId = ++_lineCounter;
  if (!on) _cancelDraw();
  const btn = document.getElementById('te-vb-draw-btn');
  if (btn) {
    btn.textContent = on ? 'CANCEL DRAW' : 'DRAW BLOCKER';
    btn.classList.toggle('active', on);
  }
  _updateStatus();
}

export function handleVisionBlockerClick(pt) {
  if (!_startPt) {
    _startPt = { x: +pt.x.toFixed(2), z: +pt.z.toFixed(2) };
    if (IS_DEV) _startDot = _dotMesh(_startPt.x, _startPt.z, COL_PRE);
    _updateStatus();
  } else {
    const x1 = _startPt.x, z1 = _startPt.z;
    const x2 = +pt.x.toFixed(2), z2 = +pt.z.toFixed(2);
    _cancelDraw();
    _addSeg(x1, z1, x2, z2);
    _startPt = { x: x2, z: z2 };
    if (IS_DEV) _startDot = _dotMesh(x2, z2, COL_PRE);
    _updateStatus();
  }
}

export function handleVisionBlockerMouseMove(pt) {
  if (!_startPt || !pt) return;
  if (_previewLine) { _dispose(_previewLine); _previewLine = null; }
  _previewLine = _lineMesh(_startPt.x, _startPt.z, pt.x, pt.z, COL_PRE, 0.5);
}

// ── Load from zone ─────────────────────────────────────────────────────────────

export function loadVisionBlockerVisuals(arr) {
  for (let i = _segs.length - 1; i >= 0; i--) _removeAt(i);
  _cancelDraw();
  _setDrawMode(false);
  _selectedLineId = -1;
  if (!arr?.length) return;
  // Assign lineIds: restore saved ones, or give each segment its own unique id
  for (const b of arr) {
    const lineId = b.lineId != null ? b.lineId : ++_lineCounter;
    if (lineId > _lineCounter) _lineCounter = lineId;
    const entry = { x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2, y: b.y ?? 0, lineId,
      line: IS_DEV ? _lineMesh(b.x1, b.z1, b.x2, b.z2, COL, 1, b.y ?? 0) : null,
      dot1: IS_DEV ? _dotMesh(b.x1, b.z1, COL, b.y ?? 0) : null,
      dot2: IS_DEV ? _dotMesh(b.x2, b.z2, COL, b.y ?? 0) : null,
    };
    if (entry.line) { entry.line.visible = _visible; entry.dot1.visible = _visible; entry.dot2.visible = _visible; }
    _segs.push(entry);
  }
  _rebuildOverlay();
  _updateCounter();
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function _save() {
  if (!_activeZoneId) { _setSaveStatus('No zone loaded', 'error'); return; }
  const payload = _segs.map(({ x1, z1, x2, z2, y, lineId }) => ({ x1, z1, x2, z2, y: y ?? 0, lineId }));
  _setSaveStatus('Saving…', '');
  try {
    const res  = await fetch('/__save_zone_vision_blockers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ zoneId: _activeZoneId, visionBlockers: payload }),
    });
    const json = await res.json();
    if (json.ok) {
      _setSaveStatus(`Saved ${payload.length} blocker${payload.length !== 1 ? 's' : ''} ✓`, 'ok');
      setTimeout(() => _setSaveStatus('', ''), 3000);
    } else {
      _setSaveStatus(`Error: ${json.error}`, 'error');
    }
  } catch (e) {
    _setSaveStatus(`Failed: ${e.message}`, 'error');
  }
}

// ── Visibility ────────────────────────────────────────────────────────────────

export function setVisionBlockerVisualsVisible(visible) {
  _visible = visible;
  for (const s of _segs) {
    if (s.line) s.line.visible = visible;
    if (s.dot1) s.dot1.visible = visible;
    if (s.dot2) s.dot2.visible = visible;
  }
  if (!visible) _setDrawMode(false); // reset draw mode so it doesn't persist on reopen
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function _updateStatus() {
  const el = document.getElementById('te-vb-status');
  if (!el) return;
  if (_drawMode) {
    el.textContent = !_startPt ? 'Click terrain — start point…' : 'Click terrain — end point (chains)…';
    return;
  }
  if (_selectedLineId !== -1) {
    const group = _segs.filter(s => s.lineId === _selectedLineId);
    const y = group.length ? (group[0].y ?? 0).toFixed(2) : '0.00';
    el.textContent = `Line selected (${group.length} seg)  Y=${y}  [ / ] to raise/lower`;
  } else {
    el.textContent = 'Click DRAW to place, or click a blue dot to select';
  }
}

function _updateCounter() {
  const el = document.getElementById('te-vb-counter');
  if (el) el.textContent = `Vision Blockers: ${_segs.length}`;
}

function _setSaveStatus(msg, cls) {
  const el = document.getElementById('te-vb-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `te-save-status-${cls}` : '';
}

// ── Raycasting ────────────────────────────────────────────────────────────────

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initVisionBlockerEditor() {
  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _updateCounter();
    _updateStatus();
  });

  document.getElementById('te-vb-draw-btn')
    ?.addEventListener('click', () => _setDrawMode(!_drawMode));

  document.getElementById('te-vb-clear-btn')
    ?.addEventListener('click', () => {
      if (_segs.length && !confirm(`Remove all ${_segs.length} vision blocker(s)?`)) return;
      _clearAll();
    });

  document.getElementById('te-vb-save-btn')
    ?.addEventListener('click', _save);

  document.getElementById('te-vb-eye-btn')
    ?.addEventListener('click', () => {
      _overlayOn = !_overlayOn;
      setVisionBlockerOverlayVisible(_overlayOn);
      const btn = document.getElementById('te-vb-eye-btn');
      if (btn) {
        btn.textContent = _overlayOn ? '👁' : '👁‍🗨';
        btn.title = _overlayOn ? 'Hide overlay (see through)' : 'Show overlay';
        btn.classList.toggle('active', !_overlayOn);
      }
    });

  renderer.domElement.addEventListener('mousemove', e => {
    if (!_drawMode || !_startPt) return;
    handleVisionBlockerMouseMove(_groundPt(e.clientX, e.clientY));
  });

  // Escape exits draw mode (Ctrl+Z and [ ] are handled centrally in terrainEditor)
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape' && _drawMode) _setDrawMode(false);
  });

  _updateStatus();
  _updateCounter();
}
