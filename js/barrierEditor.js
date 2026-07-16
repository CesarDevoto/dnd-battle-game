import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { getGroundHeight, raySurfacePoint, caveLayersActive } from './terrain.js';
import { barrierSegments, loadBarriersData } from './environments.js';
import { IS_DEV } from './devConfig.js';

let _drawMode      = false;
let _startPt       = null;   // {x,z} — first click while drawing
let _barriers      = [];     // [{x1,z1,x2,z2, line, dot1, dot2}] — visual + data
let _activeZoneId  = null;
let _visibleInDev  = false;  // only true while terrain editor is open

// Shift+click drag state: { idx, which: 'dot1'|'dot2' } or null
let _dragDot = null;

// Plain-click selection (for delete). Index into _barriers, or -1.
let _selIdx = -1;

// Live preview objects while placing second point
let _previewLine = null;
let _startDot    = null;

const COL_BARRIER  = 0xffdd00;   // 'under' (ground / tunnel-floor) barriers — yellow
const COL_BLANKET  = 0x2a6bff;   // 'surface' (blanket-top) barriers — blue
const COL_PREVIEW  = 0xffee88;
const COL_SELECT   = 0xff3344;   // highlight for the click-selected barrier

// Which cave layer newly-drawn barriers are pinned to: 'under' = ground / tunnel floor,
// 'surface' = the hilltop blanket over a tunnel. Mirrors the prop/NPC editors' FLOOR/BLANKET.
let _drawLayer = 'under';
const _layerColor = (layer) => (layer === 'surface' ? COL_BLANKET : COL_BARRIER);

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Visuals ride the walkable surface for the barrier's own layer: the blanket for
// 'surface', the carved floor for 'under' (and legacy/undefined). getGroundHeight falls
// back to the plain terrain height in non-cave zones.
function _buildLineGeo(x1, z1, x2, z2, layer = 'under') {
  const STEPS = 10;
  const pts = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = x1 + (x2 - x1) * t;
    const z = z1 + (z2 - z1) * t;
    pts.push(new THREE.Vector3(x, getGroundHeight(x, z, layer) + 0.28, z));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

function _lineMesh(x1, z1, x2, z2, color, opacity = 1, layer = 'under') {
  const line = new THREE.Line(
    _buildLineGeo(x1, z1, x2, z2, layer),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, depthTest: false }),
  );
  line.renderOrder = 20;
  scene.add(line);
  return line;
}

function _dotMesh(x, z, color, layer = 'under') {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 6),
    new THREE.MeshBasicMaterial({ color, depthWrite: false, depthTest: false }),
  );
  m.position.set(x, getGroundHeight(x, z, layer) + 0.38, z);
  m.renderOrder = 20;
  scene.add(m);
  return m;
}

function _disposeObj(obj) {
  scene.remove(obj);
  obj.geometry?.dispose();
  obj.material?.dispose();
}

// ── Barrier management ────────────────────────────────────────────────────────

function _addBarrier(x1, z1, x2, z2, layer = _drawLayer) {
  barrierSegments.push({ x1, z1, x2, z2, layer });
  const col = _layerColor(layer);
  const entry = { x1, z1, x2, z2, layer, line: null, dot1: null, dot2: null };
  if (IS_DEV) {
    entry.line = _lineMesh(x1, z1, x2, z2, col, 1, layer);
    entry.dot1 = _dotMesh(x1, z1, col, layer);
    entry.dot2 = _dotMesh(x2, z2, col, layer);
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
  // Keep the selection index valid as the array shifts underneath it.
  if      (idx === _selIdx) _selIdx = -1;
  else if (idx <   _selIdx) _selIdx--;
  _updateCounter();
}

function _clearAll() {
  _selIdx = -1;
  for (let i = _barriers.length - 1; i >= 0; i--) _removeAt(i);
  _dragDot = null;
  _cancelDraw();
  _updateStatus();
}

function _cancelDraw() {
  if (_startDot)    { _disposeObj(_startDot);    _startDot    = null; }
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _startPt = null;
}

function _rebuildBarrierVisuals(idx) {
  const b = _barriers[idx];
  if (!b) return;
  if (b.line) { _disposeObj(b.line); b.line = null; }
  if (b.dot1) { _disposeObj(b.dot1); b.dot1 = null; }
  if (b.dot2) { _disposeObj(b.dot2); b.dot2 = null; }
  const col = _layerColor(b.layer);
  b.line = _lineMesh(b.x1, b.z1, b.x2, b.z2, col, 1, b.layer);
  b.dot1 = _dotMesh(b.x1, b.z1, col, b.layer);
  b.dot2 = _dotMesh(b.x2, b.z2, col, b.layer);
  b.line.visible = _visibleInDev;
  b.dot1.visible = _visibleInDev;
  b.dot2.visible = _visibleInDev;
}

// ── Draw mode ─────────────────────────────────────────────────────────────────

export function isBarrierModeActive() { return _drawMode; }
export function getCurrentBarriers() { return _barriers.map(({ x1, z1, x2, z2, layer }) => ({ x1, z1, x2, z2, layer })); }

export function getBarrierDrawLayer() { return _drawLayer; }
export function setBarrierDrawLayer(layer) {
  _drawLayer = layer === 'surface' ? 'surface' : 'under';
  document.getElementById('be-layer-floor')?.classList.toggle('active', _drawLayer === 'under');
  document.getElementById('be-layer-blanket')?.classList.toggle('active', _drawLayer === 'surface');
  _updateStatus();
}
export function undoLastBarrier() {
  if (_startPt) { _cancelDraw(); _updateStatus(); }
  else if (_barriers.length) _removeAt(_barriers.length - 1);
}

function _setDrawMode(on) {
  _drawMode = on;
  if (on) clearBarrierSelection();   // don't hold a selection while drawing
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
    if (IS_DEV) _startDot = _dotMesh(_startPt.x, _startPt.z, COL_PREVIEW, _drawLayer);
    _updateStatus();
  } else {
    const x1 = _startPt.x, z1 = _startPt.z;
    const x2 = +pt.x.toFixed(2), z2 = +pt.z.toFixed(2);
    _cancelDraw();
    _addBarrier(x1, z1, x2, z2);
    // Chain: next click continues from this endpoint
    _startPt = { x: x2, z: z2 };
    if (IS_DEV) _startDot = _dotMesh(x2, z2, COL_PREVIEW, _drawLayer);
    _updateStatus();
  }
}

// Called from terrainEditor's mousemove when _drawMode + _startPt are set
export function handleBarrierMouseMove(pt) {
  if (!_startPt || !pt) return;
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _previewLine = _lineMesh(_startPt.x, _startPt.z, pt.x, pt.z, COL_PREVIEW, 0.5, _drawLayer);
}

// ── Shift+click drag ──────────────────────────────────────────────────────────

export function isDraggingBarrierDot() { return _dragDot !== null; }

// Raycasts against all visible barrier dots. Enters drag mode if hit. Returns true if hit.
export function pickBarrierDotAt(cx, cy) {
  if (!_visibleInDev || !IS_DEV) return false;
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  const rc  = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const candidates = [];
  _barriers.forEach((b, i) => {
    if (b.dot1) candidates.push({ mesh: b.dot1, idx: i, which: 'dot1' });
    if (b.dot2) candidates.push({ mesh: b.dot2, idx: i, which: 'dot2' });
  });
  const hits = rc.intersectObjects(candidates.map(c => c.mesh), false);
  if (!hits.length) return false;
  const found = candidates.find(c => c.mesh === hits[0].object);
  if (!found) return false;
  clearBarrierSelection();
  _dragDot = { idx: found.idx, which: found.which };
  _updateStatus();
  return true;
}

function _handleDotDrag(pt) {
  if (!_dragDot || !pt) return;
  const b = _barriers[_dragDot.idx];
  if (!b) return;
  const x = +pt.x.toFixed(2), z = +pt.z.toFixed(2);
  const dot = _dragDot.which === 'dot1' ? b.dot1 : b.dot2;
  if (dot) dot.position.set(x, getGroundHeight(x, z, b.layer) + 0.38, z);
  const x1 = _dragDot.which === 'dot1' ? x : b.x1;
  const z1 = _dragDot.which === 'dot1' ? z : b.z1;
  const x2 = _dragDot.which === 'dot2' ? x : b.x2;
  const z2 = _dragDot.which === 'dot2' ? z : b.z2;
  if (b.line) { _disposeObj(b.line); b.line = _lineMesh(x1, z1, x2, z2, _layerColor(b.layer), 1, b.layer); b.line.visible = _visibleInDev; }
}

export function finalizeBarrierDotDrag(pt) {
  if (!_dragDot) return;
  if (!pt) { cancelBarrierDotDrag(); return; }
  const b  = _barriers[_dragDot.idx];
  const bs = barrierSegments[_dragDot.idx];
  if (!b || !bs) { _dragDot = null; _updateStatus(); return; }
  const x = +pt.x.toFixed(2), z = +pt.z.toFixed(2);
  if (_dragDot.which === 'dot1') { b.x1 = bs.x1 = x; b.z1 = bs.z1 = z; }
  else                            { b.x2 = bs.x2 = x; b.z2 = bs.z2 = z; }
  _dragDot = null;
  _rebuildBarrierVisuals(_barriers.indexOf(b));
  _updateStatus();
}

export function cancelBarrierDotDrag() {
  if (!_dragDot) return;
  const idx = _dragDot.idx;
  _dragDot = null;
  _rebuildBarrierVisuals(idx);
  _updateStatus();
}

// ── Click-select & delete (for already-placed barriers) ──────────────────────
// A plain click on a barrier line selects it (highlighted); Delete removes it.
// Mirrors the trench-point select/delete flow.

export function hasSelectedBarrier() { return _selIdx >= 0; }

function _applyBarrierColor(idx, color) {
  const b = _barriers[idx];
  if (!b) return;
  b.line?.material.color.set(color);
  b.dot1?.material.color.set(color);
  b.dot2?.material.color.set(color);
}

export function clearBarrierSelection() {
  if (_selIdx >= 0) _applyBarrierColor(_selIdx, _layerColor(_barriers[_selIdx]?.layer));
  _selIdx = -1;
}

// Raycasts against visible barrier lines. Selects + highlights on hit.
// Returns true if a barrier was hit (so the caller skips its own click action).
export function selectBarrierAt(cx, cy) {
  if (!_visibleInDev || !IS_DEV) return false;
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  const rc  = new THREE.Raycaster();
  rc.params.Line.threshold = 0.7;   // WU pick tolerance around the thin line
  rc.setFromCamera(ndc, camera);
  const lines = _barriers.map(b => b.line).filter(l => l && l.visible);
  const hits  = rc.intersectObjects(lines, false);
  if (!hits.length) return false;
  const idx = _barriers.findIndex(b => b.line === hits[0].object);
  if (idx < 0) return false;
  clearBarrierSelection();
  _selIdx = idx;
  _applyBarrierColor(idx, COL_SELECT);
  _updateStatus();
  return true;
}

export function deleteSelectedBarrier() {
  if (_selIdx < 0) return;
  const idx = _selIdx;
  _selIdx = -1;             // clear first so _removeAt's index fix-up is a no-op
  _removeAt(idx);
  _updateStatus();
}

// ── Load barriers from zone (called by zoneLoader) ────────────────────────────

export function loadBarrierVisuals(arr) {
  // Clear existing visuals + collision data, then restore from zone array
  _selIdx = -1;
  for (let i = _barriers.length - 1; i >= 0; i--) _removeAt(i);
  _dragDot = null;
  _cancelDraw();
  _setDrawMode(false);
  loadBarriersData(arr);
  if (!IS_DEV || !arr?.length) return;
  for (const b of arr) {
    const col = _layerColor(b.layer);
    const entry = { x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2, layer: b.layer,
      line: _lineMesh(b.x1, b.z1, b.x2, b.z2, col, 1, b.layer),
      dot1: _dotMesh(b.x1, b.z1, col, b.layer),
      dot2: _dotMesh(b.x2, b.z2, col, b.layer),
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
  const payload = _barriers.map(({ x1, z1, x2, z2, layer }) => ({ x1, z1, x2, z2, layer }));
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
  if (_dragDot)                  el.textContent = 'Moving dot — click to place · Esc to cancel';
  else if (hasSelectedBarrier()) el.textContent = 'Barrier selected — Del removes it · Esc deselects';
  else if (!_drawMode)           el.textContent = 'Click DRAW · click a barrier to select · Shift+click dot to move';
  else {
    const lyr = _drawLayer === 'surface' ? 'BLANKET' : 'FLOOR';
    el.textContent = !_startPt ? `Drawing ${lyr} barrier — click start point…`
                               : `Drawing ${lyr} barrier — click end point…`;
  }
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

// Layer-aware pick. For a 'surface' (blanket) barrier a plain ground raycast is wrong:
// the angled ray passes THROUGH the blanket and hits the carved terrain underneath at a
// shifted XZ, so the endpoint lands on the ground below instead of the blanket the cursor
// is over. raySurfacePoint marches to where the ray first crosses the blanket surface,
// giving the correct XZ (same fix the prop/NPC editors use). 'under' + non-cave zones fall
// back to the plain ground hit.
function _barrierPt(cx, cy, layer = _drawLayer) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  if (layer === 'surface' && caveLayersActive()) {
    const p = raySurfacePoint(_rc.ray, 'surface');
    if (p) return p;
  }
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// The point the barrier tools should use for the cursor: while dragging a dot, follow the
// dragged barrier's own layer; otherwise follow the current draw layer.
export function barrierPointAt(cx, cy) {
  const layer = _dragDot ? (_barriers[_dragDot.idx]?.layer ?? 'under') : _drawLayer;
  return _barrierPt(cx, cy, layer);
}

// ── Visibility (controlled by terrain editor open/close) ──────────────────────

export function setBarrierVisualsVisible(visible) {
  _visibleInDev = visible;
  if (!visible && _dragDot) cancelBarrierDotDrag();
  if (!visible) clearBarrierSelection();
  for (const b of _barriers) {
    if (b.line) b.line.visible = visible;
    if (b.dot1) b.dot1.visible = visible;
    if (b.dot2) b.dot2.visible = visible;
  }
  if (!visible) _setDrawMode(false); // reset draw mode so it doesn't persist on reopen
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

  // FLOOR / BLANKET — which cave layer new barriers are pinned to
  document.getElementById('be-layer-floor')
    ?.addEventListener('click', () => setBarrierDrawLayer('under'));
  document.getElementById('be-layer-blanket')
    ?.addEventListener('click', () => setBarrierDrawLayer('surface'));

  document.getElementById('te-barrier-clear-btn')
    ?.addEventListener('click', () => {
      if (_barriers.length && !confirm(`Remove all ${_barriers.length} barrier(s)?`)) return;
      _clearAll();
    });

  document.getElementById('te-barrier-save-btn')
    ?.addEventListener('click', _saveBarriers);

  // Preview/drag update on mousemove — layer-aware so a blanket barrier follows the blanket.
  renderer.domElement.addEventListener('mousemove', e => {
    const pt = barrierPointAt(e.clientX, e.clientY);
    if (_dragDot) { _handleDotDrag(pt); return; }
    if (!_drawMode || !_startPt) return;
    handleBarrierMouseMove(pt);
  });

  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      if (_dragDot) { cancelBarrierDotDrag(); return; }
      if (hasSelectedBarrier()) { clearBarrierSelection(); _updateStatus(); return; }
      if (_drawMode) _setDrawMode(false);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelectedBarrier()) {
      deleteSelectedBarrier();
    }
  });

  _updateStatus();
  _updateCounter();
}
