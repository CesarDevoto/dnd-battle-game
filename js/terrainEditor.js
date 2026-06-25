import * as THREE from 'three';
import { scene, camera, renderer, ground, rebuildGrid } from './scene.js';
import { getTerrainHeight, setTerrainControlPoints, getTerrainControlPoints,
         rebuildTerrainGeometry, getTerrainSeed } from './terrain.js';
import { activeEnv } from './environments.js';
import { isBarrierModeActive, handleBarrierClick, handleBarrierMouseMove, setBarrierVisualsVisible } from './barrierEditor.js';
import { isVisionBlockerModeActive, handleVisionBlockerClick, handleVisionBlockerMouseMove, setVisionBlockerVisualsVisible } from './visionBlockerEditor.js';

let _open           = false;
let _selectedIdx    = -1;
let _activeZoneId   = null;
let _markersVisible = true;

// Defaults for newly placed points
let _defaultH   = 3.0;
let _defaultR   = 8.0;
let _defaultPR  = 0.0;

// ── Undo history ──────────────────────────────────────────────────────────────
const _history  = [];
const MAX_UNDO  = 50;

function _pushHistory() {
  _history.push(JSON.parse(JSON.stringify(getTerrainControlPoints())));
  if (_history.length > MAX_UNDO) _history.shift();
}

function _undo() {
  if (!_history.length) return;
  setTerrainControlPoints(_history.pop());
  _selectedIdx = -1;
  _rebuildAllMarkers();
  _rebuild();
}

export const isTerrainEditorOpen = () => _open;

// ── Visual markers ────────────────────────────────────────────────────────────
// Each entry mirrors a control point: { sphere, ring, innerRing } Three.js objects.
const _markers = [];

const _selRing = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.65, 32),
  new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.9,
    side: THREE.DoubleSide, depthWrite: false }),
);
_selRing.rotation.x = -Math.PI / 2;
_selRing.visible = false;
scene.add(_selRing);

function _markerColor(h) {
  return h >= 0 ? 0xff8833 : 0x3388ff;
}

function _createMarker(cp, idx) {
  const y = getTerrainHeight(cp.x, cp.z);

  // Sphere at centre
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 10, 6),
    new THREE.MeshBasicMaterial({ color: _markerColor(cp.h) }),
  );
  sphere.position.set(cp.x, y + 0.4, cp.z);
  sphere.userData.cpIdx = idx;
  scene.add(sphere);

  // Outer ring showing base radius
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(cp.r - 0.12, cp.r + 0.12, 64),
    new THREE.MeshBasicMaterial({ color: _markerColor(cp.h), transparent: true,
      opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cp.x, y + 0.08, cp.z);
  scene.add(ring);

  // Inner yellow ring showing plateau radius (only when pr > 0)
  let innerRing = null;
  const pr = cp.pr ?? 0;
  if (pr > 0) {
    innerRing = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.05, pr - 0.12), pr + 0.12, 64),
      new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true,
        opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.set(cp.x, y + 0.12, cp.z);
    scene.add(innerRing);
  }

  const _show    = _open && _markersVisible;
  sphere.visible = _show;
  ring.visible   = _show;
  if (innerRing) innerRing.visible = _show;
  _markers[idx] = { sphere, ring, innerRing };
}

function _removeMarker(idx) {
  const m = _markers[idx];
  if (!m) return;
  scene.remove(m.sphere); m.sphere.geometry.dispose(); m.sphere.material.dispose();
  scene.remove(m.ring);   m.ring.geometry.dispose();   m.ring.material.dispose();
  if (m.innerRing) { scene.remove(m.innerRing); m.innerRing.geometry.dispose(); m.innerRing.material.dispose(); }
  _markers[idx] = null;
}

function _rebuildAllMarkers() {
  // Dispose all existing
  _markers.forEach((_, i) => _removeMarker(i));
  _markers.length = 0;
  const pts = getTerrainControlPoints();
  pts.forEach((cp, i) => _createMarker(cp, i));
  _syncSelRing();
}

function _refreshMarkerPositions() {
  const pts = getTerrainControlPoints();
  pts.forEach((cp, i) => {
    const m = _markers[i];
    if (!m) return;
    const y = getTerrainHeight(cp.x, cp.z);
    m.sphere.position.set(cp.x, y + 0.4, cp.z);
    m.ring.position.set(cp.x, y + 0.08, cp.z);
    if (m.innerRing) m.innerRing.position.set(cp.x, y + 0.12, cp.z);
  });
  _syncSelRing();
}

function _updateMarkerRadius(idx) {
  const m = _markers[idx];
  if (!m) return;
  const cp = getTerrainControlPoints()[idx];
  m.ring.geometry.dispose();
  m.ring.geometry = new THREE.RingGeometry(cp.r - 0.12, cp.r + 0.12, 64);
  m.sphere.material.color.setHex(_markerColor(cp.h));
  m.ring.material.color.setHex(_markerColor(cp.h));
  // Rebuild inner plateau ring
  if (m.innerRing) { scene.remove(m.innerRing); m.innerRing.geometry.dispose(); m.innerRing.material.dispose(); m.innerRing = null; }
  const pr = cp.pr ?? 0;
  if (pr > 0) {
    const y = getTerrainHeight(cp.x, cp.z);
    m.innerRing = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.05, pr - 0.12), pr + 0.12, 64),
      new THREE.MeshBasicMaterial({ color: 0xffee44, transparent: true,
        opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.innerRing.rotation.x = -Math.PI / 2;
    m.innerRing.position.set(cp.x, y + 0.12, cp.z);
    scene.add(m.innerRing);
  }
}

function _syncSelRing() {
  const pts = getTerrainControlPoints();
  if (_open && _markersVisible && _selectedIdx >= 0 && pts[_selectedIdx]) {
    const cp = pts[_selectedIdx];
    const y  = getTerrainHeight(cp.x, cp.z);
    _selRing.position.set(cp.x, y + 0.5, cp.z);
    _selRing.visible = true;
  } else {
    _selRing.visible = false;
  }
}

export function getMarkersVisible() { return _markersVisible; }
export function setMarkersVisible(visible) { _setMarkersVisible(visible); }

function _setMarkersVisible(visible) {
  _markersVisible = visible;
  const show = _open && visible;
  _markers.forEach(m => {
    if (!m) return;
    m.sphere.visible  = show;
    m.ring.visible    = show;
    if (m.innerRing) m.innerRing.visible = show;
  });
  if (!show) _selRing.visible = false;
  else       _syncSelRing();
  const btn = document.getElementById('te-markers-btn');
  if (btn) btn.textContent = visible ? 'HIDE MARKERS' : 'SHOW MARKERS';
}

// ── Terrain rebuild helper ────────────────────────────────────────────────────
function _rebuild() {
  rebuildTerrainGeometry(ground);
  rebuildGrid();
  _refreshMarkerPositions();
  _updateStatus();
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

function _pickMarker(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const spheres = _markers.filter(Boolean).map(m => m.sphere);
  const hits = _rc.intersectObjects(spheres, false);
  if (!hits.length) return -1;
  return hits[0].object.userData.cpIdx ?? -1;
}

// ── Mutations ─────────────────────────────────────────────────────────────────
function _place(pt) {
  _pushHistory();
  const pts = getTerrainControlPoints();
  const newPt = { x: +pt.x.toFixed(2), z: +pt.z.toFixed(2), h: _defaultH, r: _defaultR };
  if (_defaultPR > 0) newPt.pr = _defaultPR;
  pts.push(newPt);
  setTerrainControlPoints(pts);
  const idx = pts.length - 1;
  _createMarker(pts[idx], idx);
  _selectedIdx = idx;
  _rebuild();
}

function _removeSelected() {
  if (_selectedIdx < 0) return;
  _pushHistory();
  const pts = getTerrainControlPoints();
  _removeMarker(_selectedIdx);
  pts.splice(_selectedIdx, 1);
  _markers.splice(_selectedIdx, 1);
  // Re-index userData on remaining spheres
  _markers.forEach((m, i) => { if (m) m.sphere.userData.cpIdx = i; });
  setTerrainControlPoints(pts);
  _selectedIdx = -1;
  _rebuild();
}

function _nudge(dx, dz) {
  if (_selectedIdx < 0) return;
  _pushHistory();
  const cp = getTerrainControlPoints()[_selectedIdx];
  cp.x = +(cp.x + dx).toFixed(2);
  cp.z = +(cp.z + dz).toFixed(2);
  _rebuild();
}

function _adjustH(delta) {
  if (_selectedIdx < 0) return;
  _pushHistory();
  const cp = getTerrainControlPoints()[_selectedIdx];
  cp.h = +(cp.h + delta).toFixed(2);
  _updateMarkerRadius(_selectedIdx);
  _rebuild();
}

function _adjustR(delta) {
  if (_selectedIdx < 0) return;
  _pushHistory();
  const cp = getTerrainControlPoints()[_selectedIdx];
  cp.r = Math.max(1, +(cp.r + delta).toFixed(2));
  _updateMarkerRadius(_selectedIdx);
  _rebuild();
}

function _adjustPR(delta) {
  if (_selectedIdx < 0) return;
  _pushHistory();
  const cp = getTerrainControlPoints()[_selectedIdx];
  const newPR = Math.max(0, Math.min(cp.r - 0.5, +((cp.pr ?? 0) + delta).toFixed(2)));
  if (newPR > 0) cp.pr = newPR; else delete cp.pr;
  _updateMarkerRadius(_selectedIdx);
  _rebuild();
}

function _stampFrom(dx, dz) {
  if (_selectedIdx < 0) return;
  _pushHistory();
  const pts = getTerrainControlPoints();
  const src = pts[_selectedIdx];
  const newCp = { x: +(src.x + dx).toFixed(2), z: +(src.z + dz).toFixed(2), h: src.h, r: src.r };
  if (src.pr) newCp.pr = src.pr;
  pts.push(newCp);
  setTerrainControlPoints(pts);
  const idx = pts.length - 1;
  _createMarker(pts[idx], idx);
  _selectedIdx = idx;
  _rebuild();
}

// ── Save to zone ──────────────────────────────────────────────────────────────
async function _saveToZone() {
  if (!_activeZoneId) { _setSave('No zone loaded', 'error'); return; }
  const terrain = getTerrainControlPoints().map(cp => {
    const out = { x: cp.x, z: cp.z, h: cp.h, r: cp.r };
    if (cp.pr) out.pr = cp.pr;
    return out;
  });
  _setSave('Saving…', '');
  try {
    const res  = await fetch('/__save_zone_terrain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body:   JSON.stringify({ zoneId: _activeZoneId, terrain, terrainSeed: getTerrainSeed(), biome: activeEnv }),
    });
    const data = await res.json();
    if (data.ok) {
      _setSave(`Saved ${terrain.length} points ✓`, 'ok');
      setTimeout(() => _setSave('', ''), 3000);
    } else {
      _setSave(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    _setSave(`Failed: ${e.message}`, 'error');
  }
}

function _setSave(msg, cls) {
  const el = document.getElementById('te-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `te-save-status-${cls}` : '';
}

// ── UI updates ────────────────────────────────────────────────────────────────
function _updateStatus() {
  const el = document.getElementById('te-status');
  if (!el) return;
  const pts = getTerrainControlPoints();
  if (_selectedIdx >= 0 && pts[_selectedIdx]) {
    const cp = pts[_selectedIdx];
    el.innerHTML =
      `<b>Point ${_selectedIdx + 1}</b><br>` +
      `x:${cp.x.toFixed(1)} z:${cp.z.toFixed(1)}<br>` +
      `h:${cp.h.toFixed(2)} &nbsp; r:${cp.r.toFixed(2)} &nbsp; pr:${(cp.pr ?? 0).toFixed(2)}<br>` +
      `←→↑↓ move &nbsp; [/] h &nbsp; -/= r &nbsp; ,/. pr &nbsp; Del`;
  } else {
    el.textContent = pts.length
      ? `${pts.length} point${pts.length > 1 ? 's' : ''} · click to select or click terrain to add`
      : 'Click terrain to add a control point';
  }
  const cnt = document.getElementById('te-counter');
  if (cnt) cnt.textContent = `Points: ${pts.length}`;
}

function _updateDefaultInputs() {
  const h  = document.getElementById('te-default-h');
  const r  = document.getElementById('te-default-r');
  const pr = document.getElementById('te-default-pr');
  if (h)  h.value  = _defaultH;
  if (r)  r.value  = _defaultR;
  if (pr) pr.value = _defaultPR;
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initTerrainEditor() {
  _updateDefaultInputs();
  _updateStatus();

  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _selectedIdx  = -1;
    _rebuildAllMarkers();
    _updateStatus();
  });

  document.getElementById('terrain-editor-btn')?.addEventListener('click', () => {
    _open = !_open;
    const panel = document.getElementById('terrain-editor-panel');
    if (panel) panel.style.display = _open ? 'block' : 'none';
    document.getElementById('terrain-editor-btn').classList.toggle('active', _open);
    setBarrierVisualsVisible(_open);
    setVisionBlockerVisualsVisible(_open);
    if (_open) {
      _setMarkersVisible(_markersVisible);
    } else {
      _selectedIdx = -1;
      _setMarkersVisible(_markersVisible); // hides because _open is now false
    }
  });

  document.getElementById('te-collapse-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const body = document.getElementById('te-body');
    if (!body) return;
    const col = body.classList.toggle('collapsed');
    e.currentTarget.textContent = col ? '▲' : '▼';
  });

  document.getElementById('te-markers-btn')?.addEventListener('click', () => _setMarkersVisible(!_markersVisible));
  document.getElementById('te-save-btn')?.addEventListener('click', _saveToZone);

  document.getElementById('te-clear-btn')?.addEventListener('click', () => {
    _markers.forEach((_, i) => _removeMarker(i));
    _markers.length = 0;
    setTerrainControlPoints([]);
    _selectedIdx = -1;
    _rebuild();
  });

  // Default h/r/pr inputs
  document.getElementById('te-default-h')?.addEventListener('input', e => {
    _defaultH = parseFloat(e.target.value) || 3;
  });
  document.getElementById('te-default-r')?.addEventListener('input', e => {
    _defaultR = Math.max(1, parseFloat(e.target.value) || 8);
  });
  document.getElementById('te-default-pr')?.addEventListener('input', e => {
    _defaultPR = Math.max(0, parseFloat(e.target.value) || 0);
  });

  // Capture-phase click
  renderer.domElement.addEventListener('click', e => {
    if (!_open) return;
    e.stopImmediatePropagation();

    // Barrier / vision-blocker draw modes intercept all terrain clicks
    if (isBarrierModeActive()) {
      const pt = _groundPt(e.clientX, e.clientY);
      if (pt) handleBarrierClick(pt);
      return;
    }
    if (isVisionBlockerModeActive()) {
      const pt = _groundPt(e.clientX, e.clientY);
      if (pt) handleVisionBlockerClick(pt);
      return;
    }

    const idx = _pickMarker(e.clientX, e.clientY);
    if (idx >= 0) {
      _selectedIdx = idx;
      _syncSelRing();
      _updateStatus();
      const cp = getTerrainControlPoints()[idx];
      return;
    }
    _selectedIdx = -1;
    _selRing.visible = false;
    const pt = _groundPt(e.clientX, e.clientY);
    if (pt) _place(pt);
    else    _updateStatus();
  }, true);

  const NUDGE = 0.5, HSTEP = 0.5, RSTEP = 0.5, PRSTEP = 0.5, STAMP = 2;
  window.addEventListener('keydown', e => {
    if (!_open) return;
    if (e.target.tagName === 'INPUT') return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); _undo(); return; }
    if (e.shiftKey) {
      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); _stampFrom(-STAMP, 0);  return;
        case 'ArrowRight': e.preventDefault(); _stampFrom( STAMP, 0);  return;
        case 'ArrowUp':    e.preventDefault(); _stampFrom(0, -STAMP);  return;
        case 'ArrowDown':  e.preventDefault(); _stampFrom(0,  STAMP);  return;
      }
    }
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); _nudge(-NUDGE, 0);    break;
      case 'ArrowRight': e.preventDefault(); _nudge( NUDGE, 0);    break;
      case 'ArrowUp':    e.preventDefault(); _nudge(0, -NUDGE);    break;
      case 'ArrowDown':  e.preventDefault(); _nudge(0,  NUDGE);    break;
      case '[':          e.preventDefault(); _adjustH(-HSTEP);     break;
      case ']':          e.preventDefault(); _adjustH( HSTEP);     break;
      case '-':                              _adjustR(-RSTEP);      break;
      case '=': case '+':                    _adjustR( RSTEP);      break;
      case ',':                              _adjustPR(-PRSTEP);    break;
      case '.':                              _adjustPR( PRSTEP);    break;
      case 'Delete': case 'Backspace':       _removeSelected();    break;
      case 'Escape': _selectedIdx = -1; _selRing.visible = false; _updateStatus(); break;
    }
  });
}
