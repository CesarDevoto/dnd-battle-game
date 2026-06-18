import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { units } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { activeEnv } from './environments.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _unit      = null;
let _zoneId    = null;
let _addingWP  = false;   // click-to-add-waypoint mode
let _panelOpen = false;

// 3-D yellow sphere markers for patrol waypoints
const _wpMarkers = [];
const _WP_MAT    = new THREE.MeshBasicMaterial({ color: 0xffcc00, depthTest: false });

// ── Panel DOM (injected once at init) ─────────────────────────────────────────

function _injectPanel() {
  if (document.getElementById('npc-ai-panel')) return;
  const div = document.createElement('div');
  div.id = 'npc-ai-panel';
  div.innerHTML = `
<div class="npc-ai-header">
  <span id="npc-ai-title">AI Settings</span>
  <button id="npc-ai-close" class="npc-ai-close-btn">×</button>
</div>
<div class="npc-ai-body">

  <div class="npc-ai-row">
    <label class="npc-ai-label">Aggro radius</label>
    <input id="npc-ai-detect" type="number" class="npc-ai-num" min="1" max="200" step="1">
    <span class="npc-ai-unit">wu</span>
  </div>

  <div class="npc-ai-row">
    <label class="npc-ai-label" style="color:#cc88ff">Social aggro radius</label>
    <input id="npc-ai-social" type="number" class="npc-ai-num" min="0" max="200" step="1">
    <span class="npc-ai-unit">wu</span>
  </div>

  <div class="npc-ai-row npc-ai-check-row">
    <input id="npc-ai-roams" type="checkbox">
    <label for="npc-ai-roams">Roams</label>
  </div>

  <div id="npc-ai-roam-block" class="npc-ai-subblock" style="display:none">
    <div class="npc-ai-row">
      <label class="npc-ai-radio-lbl">
        <input type="radio" name="npc-ai-mode" value="patrol"> Patrol path
      </label>
      <label class="npc-ai-radio-lbl">
        <input type="radio" name="npc-ai-mode" value="wander"> Wander
      </label>
    </div>

    <div id="npc-ai-patrol-block">
      <div class="npc-ai-wp-label">Waypoints</div>
      <div id="npc-ai-wp-list"></div>
      <button id="npc-ai-add-wp" class="npc-ai-btn">📍 Click terrain to add</button>
    </div>

    <div id="npc-ai-wander-block" style="display:none">
      <div class="npc-ai-row">
        <label class="npc-ai-label">Wander radius</label>
        <input id="npc-ai-wander-r" type="number" class="npc-ai-num" min="1" max="100" value="10">
        <span class="npc-ai-unit">wu</span>
      </div>
    </div>
  </div>

  <div class="npc-ai-divider"></div>

  <div class="npc-ai-row npc-ai-check-row">
    <input id="npc-ai-stealthed" type="checkbox">
    <label for="npc-ai-stealthed">Stealthed</label>
    <span class="npc-ai-hint">(invisible until spotted)</span>
  </div>

  <div class="npc-ai-divider"></div>

  <div class="npc-ai-section-label">Attack preference</div>
  <div class="npc-ai-atk-group">
    <label class="npc-ai-radio-lbl">
      <input type="radio" name="npc-ai-atk" value="default"> Default
    </label>
    <label class="npc-ai-radio-lbl">
      <input type="radio" name="npc-ai-atk" value="ranged"> Ranged first
    </label>
    <label class="npc-ai-radio-lbl">
      <input type="radio" name="npc-ai-atk" value="melee"> Melee first
    </label>
  </div>

  <div class="npc-ai-divider"></div>

  <div class="npc-ai-footer">
    <button id="npc-ai-save" class="npc-ai-btn npc-ai-save-btn">💾 Save to Zone</button>
    <span id="npc-ai-status" class="npc-ai-status"></span>
  </div>
</div>`;
  document.getElementById('app')?.appendChild(div);
}

// ── 3-D waypoint markers ──────────────────────────────────────────────────────

function _clearWPMarkers() {
  _wpMarkers.forEach(m => scene.remove(m));
  _wpMarkers.length = 0;
}

function _rebuildWPMarkers() {
  _clearWPMarkers();
  if (!_unit?.patrolPath) return;
  _unit.patrolPath.forEach((wp, i) => {
    const geo  = new THREE.SphereGeometry(0.22, 8, 8);
    const mesh = new THREE.Mesh(geo, _WP_MAT);
    mesh.position.set(wp.x, getTerrainHeight(wp.x, wp.z) + 0.30, wp.z);
    mesh.frustumCulled = false;
    scene.add(mesh);
    _wpMarkers.push(mesh);
  });
}

// ── Waypoint list HTML ────────────────────────────────────────────────────────

function _refreshWPList() {
  const el = document.getElementById('npc-ai-wp-list');
  if (!el) return;
  const path = _unit?.patrolPath ?? [];
  el.innerHTML = path.map((wp, i) =>
    `<div class="npc-ai-wp-row">
      <span class="npc-ai-wp-idx">${i + 1}</span>
      <span class="npc-ai-wp-coords">x:${wp.x.toFixed(1)} z:${wp.z.toFixed(1)}</span>
      <button class="npc-ai-wp-del" data-idx="${i}">×</button>
    </div>`
  ).join('');

  el.querySelectorAll('.npc-ai-wp-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      _unit.patrolPath.splice(idx, 1);
      if (!_unit.patrolPath.length) _unit.patrolPath = null;
      _refreshWPList();
      _rebuildWPMarkers();
    });
  });
}

// ── Section visibility helpers ────────────────────────────────────────────────

function _applyRoamVis() {
  const roams = document.getElementById('npc-ai-roams')?.checked ?? false;
  const el = document.getElementById('npc-ai-roam-block');
  if (el) el.style.display = roams ? '' : 'none';
  if (roams) _applyModeVis();
}

function _applyModeVis() {
  const mode = document.querySelector('input[name="npc-ai-mode"]:checked')?.value ?? 'patrol';
  const pb = document.getElementById('npc-ai-patrol-block');
  const wb = document.getElementById('npc-ai-wander-block');
  if (pb) pb.style.display = mode === 'patrol' ? '' : 'none';
  if (wb) wb.style.display = mode === 'wander'  ? '' : 'none';
}

// ── Populate panel from unit ──────────────────────────────────────────────────

function _populate() {
  if (!_unit) {
    document.getElementById('npc-ai-title').textContent = 'AI Settings';
    document.getElementById('npc-ai-wp-list').innerHTML = '';
    document.getElementById('npc-ai-detect').value = '';
    document.getElementById('npc-ai-roams').checked = false;
    _applyRoamVis();
    _clearWPMarkers();
    return;
  }
  const def = UNIT_TYPES[_unit.type];

  document.getElementById('npc-ai-title').textContent =
    `AI — ${def?.name ?? _unit.type}`;

  const detectEl = document.getElementById('npc-ai-detect');
  detectEl.value       = _unit.detectRange != null ? _unit.detectRange : '';
  detectEl.placeholder = `${def?.detect ?? 20}`;

  const socialEl = document.getElementById('npc-ai-social');
  socialEl.value       = _unit.socialAggroRange != null ? _unit.socialAggroRange : '';
  socialEl.placeholder = '10';

  document.getElementById('npc-ai-roams').checked = _unit.roams ?? false;

  const mode = _unit.roamMode ?? 'patrol';
  const modeInput = document.querySelector(`input[name="npc-ai-mode"][value="${mode}"]`);
  if (modeInput) modeInput.checked = true;

  document.getElementById('npc-ai-wander-r').value = _unit.wanderRadius ?? 10;

  document.getElementById('npc-ai-stealthed').checked = _unit.stealthed ?? false;

  const pref = _unit.attackPref ?? 'default';
  const prefInput = document.querySelector(`input[name="npc-ai-atk"][value="${pref}"]`);
  if (prefInput) prefInput.checked = true;

  _applyRoamVis();
  _refreshWPList();
  _rebuildWPMarkers();
}

// ── Read panel → unit ─────────────────────────────────────────────────────────

function _applyToUnit() {
  if (!_unit) return;

  const detectVal = parseFloat(document.getElementById('npc-ai-detect').value);
  _unit.detectRange = Number.isFinite(detectVal) ? detectVal : null;

  const socialVal = parseFloat(document.getElementById('npc-ai-social').value);
  _unit.socialAggroRange = Number.isFinite(socialVal) ? socialVal : null;

  _unit.roams = document.getElementById('npc-ai-roams').checked;

  const mode = document.querySelector('input[name="npc-ai-mode"]:checked')?.value ?? 'patrol';
  _unit.roamMode = mode;

  const wr = parseFloat(document.getElementById('npc-ai-wander-r').value);
  _unit.wanderRadius = Number.isFinite(wr) ? wr : 10;

  // patrolPath already lives on _unit (managed by waypoint add/delete)

  _unit.stealthed  = document.getElementById('npc-ai-stealthed').checked;
  _unit.attackPref = document.querySelector('input[name="npc-ai-atk"]:checked')?.value ?? 'default';
}

// ── Save all enemies to zone ──────────────────────────────────────────────────

async function _save() {
  if (!_zoneId) { _setStatus('No zone loaded', 'error'); return; }

  _applyToUnit();

  const enemies = units
    .filter(u => u.team === 'red')
    .map(u => {
      const e = {
        type: u.type,
        x:    +u.grp.position.x.toFixed(2),
        z:    +u.grp.position.z.toFixed(2),
      };
      if (u.hoverY && Math.abs(u.hoverY) > 0.001)  e.yOff  = +u.hoverY.toFixed(3);
      const s = +u.grp.scale.x.toFixed(3);
      if (Math.abs(s - 1) > 0.001)                  e.scale = s;

      // AI settings (omit defaults)
      if (u.detectRange != null)                     e.detectRange       = u.detectRange;
      if (u.socialAggroRange != null)                e.socialAggroRange  = u.socialAggroRange;
      if (u.roams)                                   e.roams        = true;
      if (u.roams && u.roamMode && u.roamMode !== 'patrol') e.roamMode = u.roamMode;
      if (u.roams && u.roamMode === 'wander')        e.wanderRadius = u.wanderRadius ?? 10;
      if (u.patrolPath?.length >= 2)                 e.patrol       = u.patrolPath.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
      if (u.stealthed)                               e.stealthed    = true;
      if (u.attackPref && u.attackPref !== 'default') e.attackPref  = u.attackPref;
      if (u.animOverrides && Object.keys(u.animOverrides).length) e.animOverrides = { ...u.animOverrides };

      return e;
    });

  _setStatus('Saving…', '');
  try {
    const r    = await fetch('/__save_zone_enemies', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ zoneId: _zoneId, enemies, biome: activeEnv }),
    });
    const data = await r.json();
    if (data.ok) {
      _setStatus(`Saved ✓`, 'ok');
      setTimeout(() => _setStatus('', ''), 3000);
    } else {
      _setStatus(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    _setStatus(`Failed: ${e.message}`, 'error');
  }
}

function _setStatus(msg, cls) {
  const el = document.getElementById('npc-ai-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `npc-ai-status npc-ai-status-${cls}` : 'npc-ai-status';
}

// ── Waypoint placement raycasting ─────────────────────────────────────────────

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── Click handler: unit selection when panel is open ──────────────────────────

renderer.domElement.addEventListener('click', e => {
  if (!_panelOpen || _addingWP) return;
  if (document.getElementById('app')?.classList.contains('play-mode')) return;
  // Pick a red unit under the cursor
  _ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const meshes = units.filter(u => u.team === 'red' && u.hp > 0).map(u => u.grp).filter(Boolean);
  const hits   = _rc.intersectObjects(meshes, true);
  if (!hits.length) return;
  // Walk up to find the unit whose grp was hit
  let obj = hits[0].object;
  while (obj && !units.find(u => u.grp === obj)) obj = obj.parent;
  const picked = obj ? units.find(u => u.grp === obj) : null;
  if (!picked) return;
  e.stopImmediatePropagation();
  _unit = picked;
  _populate();
}, false);

// ── Click handler: waypoint placement ─────────────────────────────────────────

renderer.domElement.addEventListener('click', e => {
  if (!_addingWP || !_unit) return;
  const pt = _groundPt(e.clientX, e.clientY);
  if (!pt) return;
  e.stopImmediatePropagation();
  if (!_unit.patrolPath) _unit.patrolPath = [];
  _unit.patrolPath.push({ x: +pt.x.toFixed(2), z: +pt.z.toFixed(2) });
  _refreshWPList();
  _rebuildWPMarkers();
  // Stay in add mode so user can keep clicking
}, true);

// ── Public API ────────────────────────────────────────────────────────────────

export function openAIPanel(unit) {
  _unit = unit;
  _panelOpen = true;
  _exitAddWPMode();
  _populate();
  document.getElementById('npc-ai-panel').style.display = 'flex';
  document.getElementById('npc-ai-editor-btn')?.classList.add('active');
}

export function closeAIPanel() {
  _unit = null;
  _panelOpen = false;
  _exitAddWPMode();
  _clearWPMarkers();
  document.getElementById('npc-ai-panel').style.display = 'none';
  document.getElementById('npc-ai-editor-btn')?.classList.remove('active');
}

export function isAIPanelOpen() { return _panelOpen; }

function _exitAddWPMode() {
  _addingWP = false;
  const btn = document.getElementById('npc-ai-add-wp');
  if (btn) { btn.textContent = '📍 Click terrain to add'; btn.classList.remove('active'); }
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initNpcAIEditor() {
  _injectPanel();

  window.addEventListener('zone:loaded', e => { _zoneId = e.detail?.id ?? null; });

  // Standalone toggle button
  document.getElementById('npc-ai-editor-btn')?.addEventListener('click', () => {
    if (_panelOpen) closeAIPanel();
    else            openAIPanel(null);
  });

  // Close button
  document.getElementById('npc-ai-close')?.addEventListener('click', closeAIPanel);

  // Roams toggle
  document.getElementById('npc-ai-roams')?.addEventListener('change', _applyRoamVis);

  // Roam mode radio
  document.querySelectorAll('input[name="npc-ai-mode"]').forEach(r =>
    r.addEventListener('change', _applyModeVis)
  );

  // Add-waypoint mode toggle
  document.getElementById('npc-ai-add-wp')?.addEventListener('click', () => {
    _addingWP = !_addingWP;
    const btn = document.getElementById('npc-ai-add-wp');
    if (_addingWP) {
      btn.textContent = '✋ Done adding';
      btn.classList.add('active');
    } else {
      _exitAddWPMode();
    }
  });

  // Save
  document.getElementById('npc-ai-save')?.addEventListener('click', _save);
}
