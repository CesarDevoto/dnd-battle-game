import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { IS_DEV } from './devConfig.js';
import { initVisionBlockers, setVisionBlockerOverlayVisible } from './visionBlockers.js';

let _drawMode     = false;
let _startPt      = null;
let _segs         = [];       // [{x1,z1,x2,z2, line, dot1, dot2}]
let _activeZoneId = null;
let _visible      = false;
let _overlayOn    = true;

let _previewLine = null;
let _startDot    = null;

const COL = 0x00ccff;
const COL_PRE = 0x88eeff;

// ── Geometry ──────────────────────────────────────────────────────────────────

function _buildLineGeo(x1, z1, x2, z2) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.32, z));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function _lineMesh(x1, z1, x2, z2, color, opacity = 1) {
  const line = new THREE.Line(
    _buildLineGeo(x1, z1, x2, z2),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false }),
  );
  line.renderOrder = 7;
  scene.add(line);
  return line;
}

function _dotMesh(x, z, color) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthWrite: false }),
  );
  m.position.set(x, getTerrainHeight(x, z) + 0.42, z);
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

function _addSeg(x1, z1, x2, z2) {
  const entry = { x1, z1, x2, z2, line: null, dot1: null, dot2: null };
  if (IS_DEV) {
    entry.line = _lineMesh(x1, z1, x2, z2, COL);
    entry.dot1 = _dotMesh(x1, z1, COL);
    entry.dot2 = _dotMesh(x2, z2, COL);
    entry.line.visible = _visible;
    entry.dot1.visible = _visible;
    entry.dot2.visible = _visible;
  }
  _segs.push(entry);
  _rebuildOverlay();
  _updateCounter();
}

function _removeAt(idx) {
  const s = _segs[idx];
  if (!s) return;
  if (s.line) _dispose(s.line);
  if (s.dot1) _dispose(s.dot1);
  if (s.dot2) _dispose(s.dot2);
  _segs.splice(idx, 1);
  _rebuildOverlay();
  _updateCounter();
}

function _clearAll() {
  for (let i = _segs.length - 1; i >= 0; i--) _removeAt(i);
  _cancelDraw();
  _updateStatus();
}

function _rebuildOverlay() {
  initVisionBlockers(_segs.map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 })));
}

// ── Draw mode ─────────────────────────────────────────────────────────────────

function _cancelDraw() {
  if (_startDot)    { _dispose(_startDot);    _startDot    = null; }
  if (_previewLine) { _dispose(_previewLine); _previewLine = null; }
  _startPt = null;
}

export function isVisionBlockerModeActive() { return _drawMode; }

function _setDrawMode(on) {
  _drawMode = on;
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
    // Chain: next click continues from this endpoint
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
  if (!arr?.length) return;
  for (const b of arr) {
    const entry = { x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2,
      line: IS_DEV ? _lineMesh(b.x1, b.z1, b.x2, b.z2, COL) : null,
      dot1: IS_DEV ? _dotMesh(b.x1, b.z1, COL) : null,
      dot2: IS_DEV ? _dotMesh(b.x2, b.z2, COL) : null,
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
  const payload = _segs.map(({ x1, z1, x2, z2 }) => ({ x1, z1, x2, z2 }));
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
  if (!visible) _cancelDraw();
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function _updateStatus() {
  const el = document.getElementById('te-vb-status');
  if (!el) return;
  if (!_drawMode)      el.textContent = 'Click DRAW to place vision blockers';
  else if (!_startPt)  el.textContent = 'Click terrain — start point…';
  else                 el.textContent = 'Click terrain — end point (chains)…';
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

  // Preview line
  renderer.domElement.addEventListener('mousemove', e => {
    if (!_drawMode || !_startPt) return;
    handleVisionBlockerMouseMove(_groundPt(e.clientX, e.clientY));
  });

  // Escape exits draw mode
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape' && _drawMode) _setDrawMode(false);
  });

  _updateStatus();
  _updateCounter();
}
