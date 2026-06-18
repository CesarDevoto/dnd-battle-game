import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { UNIT_TYPES } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { isDevMode } from './devMode.js';
import { combatPhase } from './combat.js';
import { getActiveZone } from './zoneLoader.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _open         = false;
let _selectedType = null;
let _selectedIdx  = -1;
let _activeZoneId = null;
let _spawns       = [];   // { type, x, z, round, every, patrol[], _mesh, _wpMeshes[] }
let _addingWP     = false;

// ── Raycasting ────────────────────────────────────────────────────────────────

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── Spawn-point ring markers ──────────────────────────────────────────────────

function _mkMarkerMesh(x, z) {
  const geo  = new THREE.RingGeometry(0.55, 0.85, 28);
  const mat  = new THREE.MeshBasicMaterial({
    color: 0xff6600, transparent: true, opacity: 0.78,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 5;
  mesh.position.set(x, getTerrainHeight(x, z) + 0.18, z);
  scene.add(mesh);
  return mesh;
}

function _removeMarkerMesh(s) {
  if (!s._mesh) return;
  scene.remove(s._mesh);
  s._mesh.geometry.dispose();
  s._mesh.material.dispose();
  s._mesh = null;
}

function _syncMarkerColors() {
  _spawns.forEach((s, i) => {
    if (!s._mesh) return;
    s._mesh.material.color.setHex(i === _selectedIdx ? 0xffee44 : 0xff6600);
    s._mesh.material.opacity = i === _selectedIdx ? 0.92 : 0.78;
  });
}

// ── Patrol waypoint sphere markers ────────────────────────────────────────────

const _WP_MAT = new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false });

function _mkWPMesh(x, z) {
  const geo  = new THREE.SphereGeometry(0.22, 8, 8);
  const mesh = new THREE.Mesh(geo, _WP_MAT);
  mesh.position.set(x, getTerrainHeight(x, z) + 0.30, z);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function _clearWPMeshes(s) {
  (s._wpMeshes ?? []).forEach(m => { scene.remove(m); m.geometry.dispose(); });
  s._wpMeshes = [];
}

function _rebuildWPMeshes(s) {
  _clearWPMeshes(s);
  (s.patrol ?? []).forEach(wp => {
    s._wpMeshes.push(_mkWPMesh(wp.x, wp.z));
  });
}

// ── Add / remove / clear spawns ───────────────────────────────────────────────

function _addSpawn(x, z) {
  const round = parseInt(document.getElementById('se-round-input')?.value, 10) || 1;
  const every = parseInt(document.getElementById('se-every-input')?.value, 10) || 0;
  const s = {
    type:      _selectedType,
    x:         +x.toFixed(2),
    z:         +z.toFixed(2),
    round:     Math.max(1, round),
    every:     Math.max(0, every),
    patrol:    [],
    _mesh:     null,
    _wpMeshes: [],
  };
  s._mesh = _mkMarkerMesh(s.x, s.z);
  _spawns.push(s);
  _selectedIdx = _spawns.length - 1;
  _syncMarkerColors();
  _rebuildList();
  _rebuildPatrolUI();
  _updateStatus();
}

function _deleteSpawn(idx) {
  if (idx < 0 || idx >= _spawns.length) return;
  _exitAddWPMode();
  _clearWPMeshes(_spawns[idx]);
  _removeMarkerMesh(_spawns[idx]);
  _spawns.splice(idx, 1);
  if (_selectedIdx >= _spawns.length) _selectedIdx = _spawns.length - 1;
  _syncMarkerColors();
  _rebuildList();
  _rebuildPatrolUI();
  _updateStatus();
}

function _clearAll() {
  _exitAddWPMode();
  _spawns.forEach(s => { _clearWPMeshes(s); _removeMarkerMesh(s); });
  _spawns      = [];
  _selectedIdx = -1;
  _rebuildList();
  _rebuildPatrolUI();
  _updateStatus();
}

// ── Select spawn ──────────────────────────────────────────────────────────────

function _select(idx) {
  _exitAddWPMode();
  if (_selectedIdx >= 0 && _selectedIdx < _spawns.length) {
    _clearWPMeshes(_spawns[_selectedIdx]);
  }
  _selectedIdx = idx;
  if (idx >= 0 && idx < _spawns.length) {
    _rebuildWPMeshes(_spawns[idx]);
    const s  = _spawns[idx];
    const ri = document.getElementById('se-round-input');
    const ei = document.getElementById('se-every-input');
    if (ri) ri.value = s.round;
    if (ei) ei.value = s.every;
  }
  _syncMarkerColors();
  _rebuildList();
  _rebuildPatrolUI();
  _updateStatus();
}

// ── Patrol UI section ─────────────────────────────────────────────────────────

function _rebuildPatrolUI() {
  const section = document.getElementById('se-patrol-section');
  if (!section) return;

  const s = _selectedIdx >= 0 ? _spawns[_selectedIdx] : null;
  if (!s) { section.style.display = 'none'; return; }
  section.style.display = '';

  const name = UNIT_TYPES[s.type]?.name ?? s.type;
  document.getElementById('se-patrol-title').textContent = `Patrol — ${name}`;

  _refreshWPList(s);
  _syncAddWPBtn();
}

function _refreshWPList(s) {
  const el = document.getElementById('se-wp-list');
  if (!el || !s) return;
  const path = s.patrol ?? [];
  if (!path.length) {
    el.innerHTML = '<div class="se-wp-empty">No waypoints</div>';
    return;
  }
  el.innerHTML = path.map((wp, i) =>
    `<div class="se-wp-row">
      <span class="se-wp-idx">${i + 1}</span>
      <span class="se-wp-coords">x:${wp.x.toFixed(1)} z:${wp.z.toFixed(1)}</span>
      <button class="se-wp-del" data-idx="${i}">×</button>
    </div>`
  ).join('');
  el.querySelectorAll('.se-wp-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      s.patrol.splice(idx, 1);
      _rebuildWPMeshes(s);
      _refreshWPList(s);
    });
  });
}

function _syncAddWPBtn() {
  const btn = document.getElementById('se-add-wp-btn');
  if (!btn) return;
  btn.textContent  = _addingWP ? '✋ Done adding' : '📍 Add Waypoint';
  btn.classList.toggle('active', _addingWP);
}

function _enterAddWPMode() {
  _addingWP = true;
  _syncAddWPBtn();
}

function _exitAddWPMode() {
  _addingWP = false;
  _syncAddWPBtn();
}

// ── Load spawns from active zone ──────────────────────────────────────────────

function _loadFromZone() {
  _clearAll();
  const zone = getActiveZone();
  if (!zone?.spawns?.length) return;
  for (const s of zone.spawns) {
    _spawns.push({
      type:      s.type,
      x:         s.x,
      z:         s.z,
      round:     s.round ?? 1,
      every:     s.every ?? 0,
      patrol:    (s.patrol ?? []).map(p => ({ x: p.x, z: p.z })),
      _mesh:     _mkMarkerMesh(s.x, s.z),
      _wpMeshes: [],
    });
  }
  _syncMarkerColors();
  _rebuildList();
  _rebuildPatrolUI();
  _updateStatus();
}

// ── Save to zone file ─────────────────────────────────────────────────────────

async function _saveToZone() {
  if (!_activeZoneId) { _setSave('No zone loaded', 'error'); return; }
  const payload = _spawns.map(s => {
    const o = { type: s.type, x: s.x, z: s.z, round: s.round };
    if (s.every > 0)          o.every  = s.every;
    if (s.patrol?.length >= 2) {
      o.roams    = true;
      o.roamMode = 'patrol';
      o.patrol   = s.patrol.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
    }
    return o;
  });
  _setSave('Saving…', '');
  try {
    const r    = await fetch('/__save_zone_spawns', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ zoneId: _activeZoneId, spawns: payload }),
    });
    const data = await r.json();
    if (data.ok) {
      _setSave(`Saved ${payload.length} spawn${payload.length !== 1 ? 's' : ''} ✓`, 'ok');
      setTimeout(() => _setSave('', ''), 3000);
    } else {
      _setSave(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    _setSave(`Failed: ${e.message}`, 'error');
  }
}

function _setSave(msg, cls) {
  const el = document.getElementById('se-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `se-save-status-${cls}` : '';
}

// ── UI ────────────────────────────────────────────────────────────────────────

function _rebuildList() {
  const el = document.getElementById('se-spawn-list');
  if (!el) return;
  if (!_spawns.length) {
    el.innerHTML = '<div class="se-empty">No spawns configured</div>';
    return;
  }
  el.innerHTML = _spawns.map((s, i) => {
    const name  = UNIT_TYPES[s.type]?.name ?? s.type;
    const rep   = s.every > 0 ? ` +${s.every}` : '';
    const wpCnt = s.patrol?.length ?? 0;
    const wpTag = wpCnt >= 2 ? ` <span class="se-patrol-tag">${wpCnt}wp</span>` : '';
    const cls   = i === _selectedIdx ? ' se-spawn-row-sel' : '';
    return `<div class="se-spawn-row${cls}" data-idx="${i}">
      <span class="se-spawn-info">R${s.round}${rep} — ${name}${wpTag}</span>
      <button class="se-del-btn" data-idx="${i}" title="Delete">×</button>
    </div>`;
  }).join('');
}

function _updateStatus() {
  const el = document.getElementById('se-status');
  if (!el) return;
  if (_selectedIdx >= 0 && _selectedIdx < _spawns.length) {
    const s    = _spawns[_selectedIdx];
    const name = UNIT_TYPES[s.type]?.name ?? s.type;
    const rep  = s.every > 0 ? `every ${s.every} rounds` : 'one-shot';
    const wp   = s.patrol?.length ?? 0;
    el.innerHTML = `<b>${name}</b><br>x:${s.x} z:${s.z}<br>Round ${s.round} · ${rep}${wp >= 2 ? ` · patrol ${wp}pts` : ''}`;
  } else {
    el.textContent = _selectedType
      ? 'Click terrain to place a spawn point'
      : 'Select a type, then click terrain';
  }
  const cnt = document.getElementById('se-counter');
  if (cnt) cnt.textContent = `Spawns: ${_spawns.length}`;
}

function _updateTypeBtns() {
  document.querySelectorAll('.se-type-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.type === _selectedType)
  );
  const lbl = document.getElementById('se-selected-label');
  if (lbl) {
    const def = UNIT_TYPES[_selectedType];
    lbl.textContent = def ? `${def.name}  HP ${def.hp}  AC ${def.ac}` : '—';
  }
}

function _applySearch(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('.se-type-btn').forEach(btn => {
    btn.style.display = btn.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

function _buildTypeList() {
  const listEl = document.getElementById('se-type-list');
  if (!listEl) return;
  listEl.innerHTML = Object.entries(UNIT_TYPES)
    .filter(([, d]) => d.team === 'red')
    .map(([k, d]) => `<button class="se-type-btn" data-type="${k}">${d.name}</button>`)
    .join('');
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('.se-type-btn');
    if (!btn) return;
    _selectedType = btn.dataset.type;
    _updateTypeBtns();
    _updateStatus();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSpawnEditor() {
  _buildTypeList();
  _updateStatus();

  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _loadFromZone();
  });

  document.getElementById('spawn-editor-btn')?.addEventListener('click', () => {
    _open = !_open;
    const panel = document.getElementById('spawn-editor-panel');
    if (panel) panel.style.display = _open ? 'block' : 'none';
    document.getElementById('spawn-editor-btn').classList.toggle('active', _open);
    if (!_open) _exitAddWPMode();
  });

  document.getElementById('se-collapse-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const body = document.getElementById('se-body');
    if (!body) return;
    const col = body.classList.toggle('collapsed');
    e.currentTarget.textContent = col ? '▲' : '▼';
  });

  document.getElementById('se-search')?.addEventListener('input', e => _applySearch(e.target.value));
  document.getElementById('se-save-btn')?.addEventListener('click', _saveToZone);
  document.getElementById('se-clear-btn')?.addEventListener('click', _clearAll);

  document.getElementById('se-round-input')?.addEventListener('change', e => {
    if (_selectedIdx < 0 || _selectedIdx >= _spawns.length) return;
    _spawns[_selectedIdx].round = Math.max(1, parseInt(e.target.value, 10) || 1);
    _rebuildList();
    _updateStatus();
  });
  document.getElementById('se-every-input')?.addEventListener('change', e => {
    if (_selectedIdx < 0 || _selectedIdx >= _spawns.length) return;
    _spawns[_selectedIdx].every = Math.max(0, parseInt(e.target.value, 10) || 0);
    _rebuildList();
    _updateStatus();
  });

  // Spawn list: select row or delete
  document.getElementById('se-spawn-list')?.addEventListener('click', e => {
    const del = e.target.closest('.se-del-btn');
    if (del) { _deleteSpawn(parseInt(del.dataset.idx, 10)); return; }
    const row = e.target.closest('.se-spawn-row');
    if (row) _select(parseInt(row.dataset.idx, 10));
  });

  // Add-waypoint toggle
  document.getElementById('se-add-wp-btn')?.addEventListener('click', () => {
    if (_addingWP) _exitAddWPMode();
    else           _enterAddWPMode();
  });

  // Clear waypoints for selected spawn
  document.getElementById('se-clear-wp-btn')?.addEventListener('click', () => {
    const s = _selectedIdx >= 0 ? _spawns[_selectedIdx] : null;
    if (!s) return;
    s.patrol = [];
    _clearWPMeshes(s);
    _refreshWPList(s);
    _rebuildList();
    _updateStatus();
  });

  // Canvas click — place spawn OR add waypoint
  renderer.domElement.addEventListener('click', e => {
    if (!isDevMode() || combatPhase || !_open) return;

    // Waypoint placement mode takes priority
    if (_addingWP) {
      const s = _selectedIdx >= 0 ? _spawns[_selectedIdx] : null;
      if (!s) return;
      const pt = _groundPt(e.clientX, e.clientY);
      if (!pt) return;
      e.stopImmediatePropagation();
      s.patrol.push({ x: +pt.x.toFixed(2), z: +pt.z.toFixed(2) });
      s._wpMeshes.push(_mkWPMesh(pt.x, pt.z));
      _refreshWPList(s);
      _rebuildList();
      _updateStatus();
      return;
    }

    // Normal placement
    if (!_selectedType) return;
    const pt = _groundPt(e.clientX, e.clientY);
    if (pt) {
      e.stopImmediatePropagation();
      _addSpawn(pt.x, pt.z);
    }
  }, true);

  window.addEventListener('keydown', e => {
    if (!_open) return;
    if (e.key === 'Escape') {
      if (_addingWP) { _exitAddWPMode(); return; }
      _select(-1);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !_addingWP && _selectedIdx >= 0) {
      _deleteSpawn(_selectedIdx);
    }
  });
}
