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

// Selection on an already-finalized trench, for post-hoc editing — independent of
// _currentPath (the in-progress draw) and of terrainEditor's own control-point
// selection.
//   _selScope 'point' → edits hit the one selected point (_selIdx into _selPath.points)
//   _selScope 'path'  → edits hit EVERY point on _selPath
// r and pr live on the path itself, so they were always trench-wide; scope only
// changes what h, the arrow-key nudge, and Delete apply to.
// Click a dot to select a point; click the connecting line to select the whole
// trench. (Shift+click is already spoken for — it drags barrier dots.)
let _selPath  = null;
let _selIdx   = -1;
let _selScope = 'point';

const COL_TRENCH  = 0xcc6633;
const COL_PREVIEW = 0xffaa77;
const COL_SEL     = 0xffdd44;  // whole-trench selection — matches the selection ring
const COL_HILL    = 0xff8833;  // positive h (rise)
const COL_VALLEY  = 0x3388ff;  // negative h (dip) — matches terrainEditor's control-point convention

function _dotColor(h) { return h >= 0 ? COL_HILL : COL_VALLEY; }

// path object → { line, dots[] } — keyed by reference so undo/clear/reload
// never has to keep a parallel index in sync with getTerrainTrenches()
const _visuals = new Map();

const _selRing = new THREE.Mesh(
  new THREE.RingGeometry(0.35, 0.55, 24),
  new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.9,
    side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
);
_selRing.rotation.x  = -Math.PI / 2;
_selRing.renderOrder = 21;
_selRing.visible     = false;
scene.add(_selRing);

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
  const line = _pathLineMesh(path.points, _isPathSelected(path) ? COL_SEL : COL_TRENCH);
  const dots = path.points.map((p, idx) => {
    const d = _dotMesh(p.x, p.z, _dotColor(p.h ?? path.h ?? 0));
    d.visible = _visibleInDev;
    d.userData = { path, idx };
    return d;
  });
  _visuals.set(path, { line, dots });
  _syncSelectionRing();
}

function _disposeAllVisuals() {
  for (const path of _visuals.keys()) _disposePathVisual(path);
}

// The whole trench lights up when it's the thing being edited, so it's obvious
// that an h/nudge/Delete is about to hit every point rather than one.
function _isPathSelected(path) { return path === _selPath && _selScope === 'path'; }

function _refreshLineColors() {
  for (const [path, v] of _visuals) {
    v.line?.material.color.setHex(_isPathSelected(path) ? COL_SEL : COL_TRENCH);
  }
}

// ── Terrain mesh refresh ────────────────────────────────────────────────────────

function _refreshTerrain() {
  rebuildTerrainGeometry(ground);
  rebuildGrid();
}

// ── Draw mode ─────────────────────────────────────────────────────────────────

export function isTrenchModeActive() { return _drawMode; }

export function getCurrentTrenches() {
  return getTerrainTrenches().map(({ points, r, pr }) => {
    const out = { points: points.map(p => ({ x: p.x, z: p.z, h: p.h })), r };
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
    _currentPath = { points: [{ x, z, h: defaults.h }], r: defaults.r };
    if (defaults.pr > 0) _currentPath.pr = defaults.pr;
    setTerrainTrenches([...getTerrainTrenches(), _currentPath]);
  } else {
    _currentPath.points.push({ x, z, h: defaults.h });
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
  clearTrenchSelection();
  _refreshTerrain();
  _updateStatus();
  _updateCounter();
}

// ── Point selection & editing — for already-finalized trenches ───────────────
// Independent of draw mode: click an existing point (outside DRAW TRENCH) to
// select it, then use the same move/height/radius keys the control-point
// editor uses. r/pr are path-wide (shared by every point on that trench), so
// adjusting them here edits the whole selected path, not just the one point.

export function hasSelectedTrenchPoint() { return !!_selPath && _selIdx >= 0; }
export function hasSelectedTrench()      { return !!_selPath; }

// Points the current edit applies to: every point on the trench in 'path' scope,
// just the clicked one in 'point' scope.
function _targetPoints() {
  if (!_selPath) return [];
  if (_selScope === 'path') return _selPath.points;
  return _selIdx >= 0 ? [_selPath.points[_selIdx]] : [];
}

export function setTrenchScope(scope) {
  _selScope = scope === 'path' ? 'path' : 'point';
  // Selecting via the line gives no point index; falling back to the first point
  // keeps 'point' scope usable without forcing another click.
  if (_selScope === 'point' && _selPath && _selIdx < 0) _selIdx = 0;
  _refreshLineColors();
  _syncSelectionRing();
  _updateScopeBtn();
  _updateStatus();
}

function _updateScopeBtn() {
  const btn = document.getElementById('te-trench-scope-btn');
  if (!btn) return;
  btn.textContent = _selScope === 'path' ? 'SCOPE: WHOLE TRENCH' : 'SCOPE: POINT';
  btn.classList.toggle('active', _selScope === 'path');
}

function _syncSelectionRing() {
  if (!hasSelectedTrenchPoint() || !_visibleInDev) { _selRing.visible = false; return; }
  const p = _selPath.points[_selIdx];
  const y = getTerrainHeight(p.x, p.z);
  _selRing.position.set(p.x, y + 0.5, p.z);
  _selRing.visible = true;
}

export function clearTrenchSelection() {
  const had = _selPath;
  _selPath = null;
  _selIdx  = -1;
  _selRing.visible = false;
  if (had) _refreshLineColors();
  _updateStatus();
}

function _pickTrenchDot(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const allDots = [];
  for (const { dots } of _visuals.values()) allDots.push(...dots.filter(d => d.visible));
  const hits = _rc.intersectObjects(allDots, false);
  return hits.length ? hits[0].object.userData : null;
}

// Which trench's line is under the cursor, if any. Lines are infinitely thin, so
// picking needs a threshold; keep it tight or it swallows clicks meant for the
// terrain underneath.
function _pickTrenchLine(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const prev = _rc.params.Line.threshold;
  _rc.params.Line.threshold = 0.35;
  let best = null, bestDist = Infinity;
  for (const [path, v] of _visuals) {
    if (!v.line?.visible) continue;
    const hits = _rc.intersectObject(v.line, false);
    if (hits.length && hits[0].distance < bestDist) { bestDist = hits[0].distance; best = path; }
  }
  _rc.params.Line.threshold = prev;
  return best;
}

// Called from terrainEditor's click handler (outside draw mode). Returns true if a
// trench was hit, so the caller skips its own control-point pick/place this click.
// A dot selects that one point; the connecting line selects the whole trench.
export function selectTrenchPointAt(cx, cy) {
  const hit = _pickTrenchDot(cx, cy);
  if (hit) {
    _selPath = hit.path;
    _selIdx  = hit.idx;
    _refreshLineColors();
    _syncSelectionRing();
    _updateScopeBtn();
    _updateStatus();
    return true;
  }
  const path = _pickTrenchLine(cx, cy);
  if (!path) return false;
  _selPath  = path;
  _selIdx   = -1;
  _selScope = 'path';   // clicking the line means "this whole trench"
  _refreshLineColors();
  _syncSelectionRing();
  _updateScopeBtn();
  _updateStatus();
  return true;
}

export function nudgeSelectedTrenchPoint(dx, dz) {
  const pts = _targetPoints();
  if (!pts.length) return;
  for (const p of pts) {
    p.x = +(p.x + dx).toFixed(2);
    p.z = +(p.z + dz).toFixed(2);
  }
  _rebuildPathVisual(_selPath);
  _refreshTerrain();
  _updateStatus();
}

// Delta, not an absolute set, so raising a whole trench keeps the rise/fall shape
// its points were drawn with.
export function adjustSelectedTrenchPointH(delta) {
  const pts = _targetPoints();
  if (!pts.length) return;
  for (const p of pts) {
    const base = p.h ?? _selPath.h ?? 0;
    p.h = +(base + delta).toFixed(2);
  }
  _rebuildPathVisual(_selPath);
  _refreshTerrain();
  _updateStatus();
}

// Flatten every point on the trench to one height — the "make this whole trench
// h = X" case that a delta can't express.
export function setSelectedTrenchH(h) {
  if (!_selPath) return;
  const v = +(+h).toFixed(2);
  if (!Number.isFinite(v)) return;
  for (const p of _targetPoints()) p.h = v;
  _rebuildPathVisual(_selPath);
  _refreshTerrain();
  _updateStatus();
}

// r/pr are stored on the path, so these always were trench-wide.
export function adjustSelectedTrenchR(delta) {
  if (!_selPath) return;
  setSelectedTrenchR(_selPath.r + delta);
}

export function adjustSelectedTrenchPR(delta) {
  if (!_selPath) return;
  setSelectedTrenchPR((_selPath.pr ?? 0) + delta);
}

export function setSelectedTrenchR(r) {
  if (!_selPath || !Number.isFinite(+r)) return;
  _selPath.r = Math.max(1, +(+r).toFixed(2));
  _refreshTerrain();
  _updateStatus();
}

export function setSelectedTrenchPR(pr) {
  if (!_selPath || !Number.isFinite(+pr)) return;
  const v = Math.max(0, +(+pr).toFixed(2));
  if (v > 0) _selPath.pr = v; else delete _selPath.pr;
  _refreshTerrain();
  _updateStatus();
}

// Point scope removes the one point (and the trench with it if too few remain);
// whole-trench scope removes the trench outright — confirmed, since that can be a
// lot of work to lose to a stray keypress.
export function deleteSelectedTrenchPoint() {
  if (!_selPath) return;
  const path = _selPath;

  if (_selScope === 'path') {
    if (!confirm(`Delete this entire trench (${path.points.length} points)?`)) return;
    setTerrainTrenches(getTerrainTrenches().filter(p => p !== path));
    _disposePathVisual(path);
    clearTrenchSelection();
    _refreshTerrain();
    _updateCounter();
    return;
  }

  if (_selIdx < 0) return;
  path.points.splice(_selIdx, 1);
  if (path.points.length < 2) {
    setTerrainTrenches(getTerrainTrenches().filter(p => p !== path));
    _disposePathVisual(path);
  } else {
    _rebuildPathVisual(path);
  }
  clearTrenchSelection();
  _refreshTerrain();
  _updateCounter();
}

// ── Load trenches from zone (called by zoneLoader) ────────────────────────────

export function loadTrenchVisuals(arr) {
  _disposeAllVisuals();
  if (_previewLine) { _disposeObj(_previewLine); _previewLine = null; }
  _currentPath = null;
  _drawMode = false;
  clearTrenchSelection();
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
  _syncSelInputs();   // every mutation and selection change funnels through here
  const el = document.getElementById('te-trench-status');
  if (!el) return;
  if (hasSelectedTrench()) {
    const pts   = _selPath.points;
    const whole = _selScope === 'path';
    const hs    = pts.map(p => p.h ?? _selPath.h ?? 0);
    const hTxt  = whole
      ? (Math.min(...hs) === Math.max(...hs)
          ? Math.min(...hs).toFixed(2)
          : `${Math.min(...hs).toFixed(2)}…${Math.max(...hs).toFixed(2)}`)
      : (pts[_selIdx].h ?? _selPath.h ?? 0).toFixed(2);
    el.innerHTML =
      `<b>${whole ? `Whole trench · ${pts.length} pts` : `Point ${_selIdx + 1}/${pts.length}`}</b> h:${hTxt}<br>` +
      `←→↑↓ move &nbsp; [/] h &nbsp; Del ${whole ? 'removes trench' : 'removes point'}`;
    return;
  }
  if (!_drawMode)         el.textContent = 'Click DRAW TRENCH, then click a chain of points — or click a point (one) / the line (whole trench) to edit';
  else if (!_currentPath) el.textContent = 'Click terrain — start point… (uses current h)';
  else {
    const last = _currentPath.points[_currentPath.points.length - 1];
    el.textContent = `Click terrain — next point… (${_currentPath.points.length} so far, last h=${last.h}) — change h to rise/fall`;
  }
}

// The h/r/pr boxes for the current trench selection. These are the SELECTION's
// values — distinct from the "Default:" row at the top of the panel, which only
// seeds newly-placed points and does nothing to anything that already exists.
// Whichever box is focused is skipped, so a sync never clobbers mid-typing input.
function _syncSelInputs() {
  const row = document.getElementById('te-trench-sel-row');
  if (!row) return;
  if (!hasSelectedTrench() || !_visibleInDev) { row.style.display = 'none'; return; }
  row.style.display = 'flex';

  const whole = _selScope === 'path';
  const lbl   = document.getElementById('te-trench-sel-lbl');
  if (lbl) lbl.textContent = whole ? `Trench (${_selPath.points.length}):` : `Point ${_selIdx + 1}:`;

  // In whole-trench scope the points may hold different heights; show "mixed"
  // rather than a lie. Typing a number then flattens them all to it — use [ and ]
  // instead to shift every point while keeping the drawn rise/fall.
  const hs  = _targetPoints().map(p => p.h ?? _selPath.h ?? 0);
  const hEl = document.getElementById('te-trench-sel-h');
  if (hEl && hEl !== document.activeElement) {
    const mixed = hs.length > 1 && Math.min(...hs) !== Math.max(...hs);
    hEl.value       = mixed ? '' : (hs[0] ?? 0);
    hEl.placeholder = mixed ? 'mixed' : '';
  }
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) el.value = v;
  };
  set('te-trench-sel-r',  _selPath.r);
  set('te-trench-sel-pr', _selPath.pr ?? 0);
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
  if (!visible) { _setDrawMode(false); clearTrenchSelection(); } // don't persist on reopen
  else _syncSelectionRing();
  _syncSelInputs();
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

  document.getElementById('te-trench-scope-btn')
    ?.addEventListener('click', () => setTrenchScope(_selScope === 'path' ? 'point' : 'path'));

  // Live h/r/pr editors for the selected trench — the counterpart of the control
  // point row above. h honours the scope (one point vs every point); r/pr are
  // trench-wide by nature.
  document.getElementById('te-trench-sel-h')?.addEventListener('input', e => {
    if (e.target.value !== '') setSelectedTrenchH(e.target.value);
  });
  document.getElementById('te-trench-sel-r')?.addEventListener('input', e => {
    if (e.target.value !== '') setSelectedTrenchR(e.target.value);
  });
  document.getElementById('te-trench-sel-pr')?.addEventListener('input', e => {
    if (e.target.value !== '') setSelectedTrenchPR(e.target.value);
  });
  ['te-trench-sel-h', 'te-trench-sel-r', 'te-trench-sel-pr'].forEach(id => {
    document.getElementById(id)?.addEventListener('blur', _syncSelInputs);
  });

  document.getElementById('te-trench-save-btn')
    ?.addEventListener('click', _saveTrenches);

  renderer.domElement.addEventListener('mousemove', e => {
    if (!_drawMode || !_currentPath) return;
    handleTrenchMouseMove(_groundPt(e.clientX, e.clientY));
  });

  const NUDGE = 0.5, HSTEP = 0.5, RSTEP = 0.5, PRSTEP = 0.5;
  const MICRO_NUDGE = 0.05;   // Ctrl+Arrow: 1/10 of NUDGE for fine placement
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      if (_drawMode) { _setDrawMode(false); return; }
      if (hasSelectedTrenchPoint()) { clearTrenchSelection(); return; }
    }
    if (!hasSelectedTrench()) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); nudgeSelectedTrenchPoint(-(e.ctrlKey ? MICRO_NUDGE : NUDGE), 0);  break;
      case 'ArrowRight': e.preventDefault(); nudgeSelectedTrenchPoint( (e.ctrlKey ? MICRO_NUDGE : NUDGE), 0);  break;
      case 'ArrowUp':    e.preventDefault(); nudgeSelectedTrenchPoint(0, -(e.ctrlKey ? MICRO_NUDGE : NUDGE));  break;
      case 'ArrowDown':  e.preventDefault(); nudgeSelectedTrenchPoint(0,  (e.ctrlKey ? MICRO_NUDGE : NUDGE));  break;
      case '[': e.preventDefault(); adjustSelectedTrenchPointH(-HSTEP); break;
      case ']': e.preventDefault(); adjustSelectedTrenchPointH( HSTEP); break;
      case 'h': case 'H': {
        e.preventDefault();
        const cur = _selScope === 'path'
          ? (_selPath.points[0].h ?? _selPath.h ?? 0)
          : (_selPath.points[_selIdx].h ?? _selPath.h ?? 0);
        const v = prompt(_selScope === 'path'
          ? `Set h for all ${_selPath.points.length} points of this trench:`
          : 'Set h for this point:', String(cur));
        if (v !== null && v.trim() !== '') setSelectedTrenchH(v);
        break;
      }
      case '-':                     adjustSelectedTrenchR(-RSTEP);     break;
      case '=': case '+':           adjustSelectedTrenchR( RSTEP);     break;
      case ',':                     adjustSelectedTrenchPR(-PRSTEP);   break;
      case '.':                     adjustSelectedTrenchPR( PRSTEP);   break;
      case 'Delete': case 'Backspace': deleteSelectedTrenchPoint();    break;
    }
  });

  _updateScopeBtn();
  _updateStatus();
  _updateCounter();
}
