import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { units, buildUnit, getClipNamesForType, applyUnitAnimOverride } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { activeEnv } from './environments.js';
import { openAIPanel, closeAIPanel } from './npcAIEditor.js';
import { isDevMode } from './devMode.js';
import { combatPhase } from './combat.js';

let _open         = false;
let _selectedType = null;
let _selectedUnit = null;
let _activeZoneId = null;

export const isNpcEditorOpen = () => _open;

// ── Per-type animation defaults (persisted to localStorage) ──────────────────
const _TYPE_ANIM_KEY = 'dnd-type-anim-defaults';
let _typeAnimDefaults = {};
try { _typeAnimDefaults = JSON.parse(localStorage.getItem(_TYPE_ANIM_KEY) ?? '{}'); } catch {}

function _saveTypeAnimDefault(type, overrides) {
  if (overrides && Object.keys(overrides).length) {
    _typeAnimDefaults[type] = { ...overrides };
  } else {
    delete _typeAnimDefaults[type];
  }
  try { localStorage.setItem(_TYPE_ANIM_KEY, JSON.stringify(_typeAnimDefaults)); } catch {}
}

// ── Selection ring (red to distinguish from army.js gold ring) ────────────────
const _ring = new THREE.Mesh(
  new THREE.RingGeometry(0.85, 1.10, 32),
  new THREE.MeshBasicMaterial({
    color: 0xff3311, transparent: true, opacity: 0.82,
    side: THREE.DoubleSide, depthWrite: false,
  })
);
_ring.rotation.x = -Math.PI / 2;
_ring.visible = false;
scene.add(_ring);

function _syncRing() {
  if (_selectedUnit) {
    _ring.position.set(
      _selectedUnit.grp.position.x,
      _selectedUnit.grp.position.y + 0.14,
      _selectedUnit.grp.position.z,
    );
    _ring.visible = true;
  } else {
    _ring.visible = false;
  }
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

function _pickRedUnit(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  for (const u of units) {
    if ((u.team === 'red' || u.team === 'npc') && _rc.intersectObject(u.grp, true).length) return u;
  }
  return null;
}

// ── Undo history ─────────────────────────────────────────────────────────────

const _history   = [];
const MAX_HISTORY = 50;

function _snapshot() {
  _history.push(units.filter(u => u.team === 'red').map(u => ({
    unit:   u,
    x:      u.grp.position.x,
    z:      u.grp.position.z,
    hoverY: u.hoverY ?? 0,
    scaleX: u.grp.scale.x,
    rotY:   u.grp.rotation.y,
  })));
  if (_history.length > MAX_HISTORY) _history.shift();
}

function _undo() {
  if (!_history.length) return;
  const snap    = _history.pop();
  const snapSet = new Set(snap.map(s => s.unit));
  const currRed = units.filter(u => u.team === 'red');
  const currSet = new Set(currRed);

  // Remove units added after the snapshot
  for (const u of currRed) {
    if (!snapSet.has(u)) {
      scene.remove(u.grp);
      u.barEl?.remove();
      const i = units.indexOf(u);
      if (i >= 0) units.splice(i, 1);
    }
  }

  // Re-add units deleted after the snapshot
  for (const s of snap) {
    if (!currSet.has(s.unit)) {
      scene.add(s.unit.grp);
      if (s.unit.barEl) document.getElementById('hud')?.appendChild(s.unit.barEl);
      units.push(s.unit);
    }
  }

  // Restore transforms
  for (const s of snap) {
    s.unit.hoverY = s.hoverY;
    s.unit.grp.position.set(s.x, getTerrainHeight(s.x, s.z) + s.hoverY, s.z);
    s.unit.grp.scale.setScalar(s.scaleX);
    s.unit.grp.rotation.y = s.rotY;
    if (s.unit.anchor) { s.unit.anchor.x = s.x; s.unit.anchor.z = s.z; }
  }

  _selectedUnit = null;
  _ring.visible = false;
  _updateStatus();
}

// ── Remove a unit from scene, HUD, and units[] ────────────────────────────────
function _removeUnit(u) {
  scene.remove(u.grp);
  u.barEl?.remove();
  const i = units.indexOf(u);
  if (i >= 0) units.splice(i, 1);
}

// ── Duplicate selected NPC offset by (dx, dz) ────────────────────────────────
function _duplicateNpc(dx, dz) {
  if (!_selectedUnit) return;
  const src    = _selectedUnit;
  const ovCopy = src.animOverrides && Object.keys(src.animOverrides).length ? { ...src.animOverrides } : null;
  _snapshot();
  const nu = buildUnit(+(src.grp.position.x + dx).toFixed(2), +(src.grp.position.z + dz).toFixed(2), src.team, src.type, ovCopy);
  nu.grp.scale.setScalar(src.grp.scale.x);
  nu.grp.rotation.y   = src.grp.rotation.y;
  nu.hoverY           = src.hoverY ?? 0;
  nu.grp.position.y   = getTerrainHeight(nu.grp.position.x, nu.grp.position.z) + nu.hoverY;
  if (src.detectRange      != null) nu.detectRange      = src.detectRange;
  if (src.socialAggroRange != null) nu.socialAggroRange = src.socialAggroRange;
  if (src.roams)                    nu.roams            = src.roams;
  if (src.roamMode)                 nu.roamMode         = src.roamMode;
  if (src.wanderRadius     != null) nu.wanderRadius     = src.wanderRadius;
  if (src.patrolPath?.length)       nu.patrolPath       = src.patrolPath.map(p => ({ x: p.x, z: p.z }));
  if (src.stealthed)                nu.stealthed        = src.stealthed;
  if (src.attackPref)               nu.attackPref       = src.attackPref;
  _selectedUnit = nu;
  _syncRing();
  if (nu.team !== 'npc') openAIPanel(nu);
  _showAnimPanel(nu);
  _updateStatus();
}

// ── Nudge / Y / scale ────────────────────────────────────────────────────────
function _nudge(dx, dz) {
  if (!_selectedUnit) return;
  _selectedUnit.grp.position.x += dx;
  _selectedUnit.grp.position.z += dz;
  _selectedUnit.anchor.x = _selectedUnit.grp.position.x;
  _selectedUnit.anchor.z = _selectedUnit.grp.position.z;
  _syncRing();
  _updateStatus();
}

function _adjustY(delta) {
  if (!_selectedUnit) return;
  const u = _selectedUnit;
  u.hoverY = (u.hoverY ?? 0) + delta;
  // Immediately push Y so the ring stays in sync without waiting for the next tick
  u.grp.position.y = getTerrainHeight(u.grp.position.x, u.grp.position.z) + u.hoverY;
  u.anchor.y = u.grp.position.y + u.anchorY;
  _syncRing();
  _updateStatus();
}

function _adjustScale(factor) {
  if (!_selectedUnit) return;
  _selectedUnit.grp.scale.multiplyScalar(factor);
  _updateStatus();
}

// ── Animation override panel ──────────────────────────────────────────────────

const _ANIM_ROLES = ['idle', 'walk', 'run', 'attack', 'rangedAttack', 'spellCast', 'death'];
const _ANIM_LABELS = {
  idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Melee Atk',
  rangedAttack: 'Ranged Atk', spellCast: 'Spell Cast', death: 'Death',
};

function _injectAnimPanel() {
  if (document.getElementById('ne-anim-panel')) return;
  const div = document.createElement('div');
  div.id = 'ne-anim-panel';
  div.style.display = 'none';
  div.innerHTML = `
    <div class="ne-anim-header">ANIMATIONS</div>
    <div id="ne-anim-body" class="ne-anim-body"></div>
    <div class="ne-anim-footer">
      <button id="ne-anim-save-default" class="ne-anim-default-btn">Set as Type Default</button>
    </div>
  `;
  document.getElementById('app')?.appendChild(div);
  div.querySelector('#ne-anim-body').addEventListener('change', e => {
    const sel = e.target.closest('select[data-role]');
    if (!sel || !_selectedUnit) return;
    const idx = sel.value !== '' ? parseInt(sel.value, 10) : null;
    applyUnitAnimOverride(_selectedUnit, sel.dataset.role, idx);
  });
  div.querySelector('#ne-anim-save-default').addEventListener('click', () => {
    if (!_selectedUnit) return;
    _saveTypeAnimDefault(_selectedUnit.type, _selectedUnit.animOverrides);
    const btn = document.getElementById('ne-anim-save-default');
    const typeName = UNIT_TYPES[_selectedUnit.type]?.name ?? _selectedUnit.type;
    if (btn) {
      btn.textContent = 'Saved ✓';
      setTimeout(() => { if (btn) btn.textContent = `Update ${typeName} Default`; }, 1800);
    }
  });
}

function _showAnimPanel(unit) {
  _injectAnimPanel();
  const panel = document.getElementById('ne-anim-panel');
  const body  = document.getElementById('ne-anim-body');
  if (!panel || !body) return;
  const clipNames = getClipNamesForType(unit.type);
  if (!clipNames.length) { panel.style.display = 'none'; return; }
  const ov = unit.animOverrides ?? {};
  body.innerHTML = _ANIM_ROLES.map(role => `
    <div class="ne-anim-row">
      <span class="ne-anim-label">${_ANIM_LABELS[role]}</span>
      <select class="ne-anim-select" data-role="${role}">
        <option value="">— auto —</option>
        ${clipNames.map((n, i) => `<option value="${i}"${ov[role] === i ? ' selected' : ''}>${i}: ${n}</option>`).join('')}
      </select>
    </div>`).join('');
  const btn = document.getElementById('ne-anim-save-default');
  const typeName = UNIT_TYPES[unit.type]?.name ?? unit.type;
  const hasDefault = !!(_typeAnimDefaults[unit.type] && Object.keys(_typeAnimDefaults[unit.type]).length);
  if (btn) btn.textContent = hasDefault ? `Update ${typeName} Default` : `Set as ${typeName} Default`;
  panel.style.display = 'block';
}

function _hideAnimPanel() {
  const panel = document.getElementById('ne-anim-panel');
  if (panel) panel.style.display = 'none';
}

// ── Save to zone ──────────────────────────────────────────────────────────────
async function _saveToZone() {
  if (!_activeZoneId) { _setSave('No zone loaded', 'error'); return; }

  const enemies = units
    .filter(u => u.team === 'red' || u.team === 'npc' || UNIT_TYPES[u.type]?.team === 'npc')
    .map(u => {
      const canonicalTeam = UNIT_TYPES[u.type]?.team ?? u.team;
      const e = { type: u.type, x: +u.grp.position.x.toFixed(2), z: +u.grp.position.z.toFixed(2) };
      if (canonicalTeam !== 'red') e.team = canonicalTeam;
      if (u.hoverY && Math.abs(u.hoverY) > 0.001)  e.yOff  = +u.hoverY.toFixed(3);
      const r = +u.grp.rotation.y.toFixed(4);
      if (Math.abs(r) > 0.0001)                     e.rotY  = r;
      const s = +u.grp.scale.x.toFixed(3);
      if (Math.abs(s - 1) > 0.001)                  e.scale = s;
      // Preserve AI properties so NPC editor save never strips roaming/patrol data
      if (u.detectRange != null)                     e.detectRange  = u.detectRange;
      if (u.roams)                                   e.roams        = true;
      if (u.roams && u.roamMode && u.roamMode !== 'patrol') e.roamMode = u.roamMode;
      if (u.roams && u.roamMode === 'wander')        e.wanderRadius = u.wanderRadius ?? 10;
      if (u.patrolPath?.length >= 2)                 e.patrol       = u.patrolPath.map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }));
      if (u.stealthed)                               e.stealthed    = true;
      if (u.attackPref && u.attackPref !== 'default') e.attackPref  = u.attackPref;
      if (u.animOverrides && Object.keys(u.animOverrides).length) e.animOverrides = { ...u.animOverrides };
      return e;
    });

  _setSave('Saving…', '');
  try {
    const r    = await fetch('/__save_zone_enemies', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ zoneId: _activeZoneId, enemies, biome: activeEnv }),
    });
    const data = await r.json();
    if (data.ok) {
      _setSave(`Saved ${enemies.length} enemies ✓`, 'ok');
      setTimeout(() => _setSave('', ''), 3000);
    } else {
      _setSave(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    _setSave(`Failed: ${e.message}`, 'error');
  }
}

function _setSave(msg, cls) {
  const el = document.getElementById('ne-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `ne-save-status-${cls}` : '';
}

// ── UI state updates ──────────────────────────────────────────────────────────
function _updateStatus() {
  const el = document.getElementById('ne-status');
  if (el) {
    if (_selectedUnit) {
      const def  = UNIT_TYPES[_selectedUnit.type];
      const name = def?.name ?? _selectedUnit.type;
      const p    = _selectedUnit.grp.position;
      const yOff = (_selectedUnit.hoverY ?? 0).toFixed(2);
      const sc   = _selectedUnit.grp.scale.x.toFixed(2);
      el.innerHTML =
        `<b>${name}</b><br>` +
        `x:${p.x.toFixed(1)} z:${p.z.toFixed(1)} y:${yOff} sc:${sc}<br>` +
        `←→↑↓ move &nbsp; [/] Y &nbsp; -/= scale &nbsp; R rot &nbsp; Del &nbsp; Shift+click clone`;
    } else {
      el.textContent = _selectedType
        ? 'Click terrain to place · click enemy to select'
        : 'Select a type, then click terrain to place';
    }
  }
  const cnt = document.getElementById('ne-counter');
  if (cnt) cnt.textContent = `Enemies: ${units.filter(u => u.team === 'red').length}`;
}

function _updateTypeBtns() {
  document.querySelectorAll('.ne-type-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.type === _selectedType)
  );
  const lbl = document.getElementById('ne-selected-label');
  if (lbl) {
    const def = UNIT_TYPES[_selectedType];
    lbl.textContent = def ? `${def.name}  HP ${def.hp}  AC ${def.ac}` : '—';
  }
}

// ── Search filter ─────────────────────────────────────────────────────────────
function _applySearch(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('.ne-type-btn').forEach(btn => {
    btn.style.display = btn.textContent.toLowerCase().includes(lq) ? '' : 'none';
  });
}

// ── Build type picker list ────────────────────────────────────────────────────
function _buildTypeList() {
  const listEl = document.getElementById('ne-type-list');
  if (!listEl) return;

  const redEntries = Object.entries(UNIT_TYPES).filter(([, d]) => d.team === 'red').sort((a, b) => a[1].name.localeCompare(b[1].name));
  const npcEntries = Object.entries(UNIT_TYPES).filter(([, d]) => d.team === 'npc').sort((a, b) => a[1].name.localeCompare(b[1].name));
  listEl.innerHTML =
    `<div class="ne-section-hdr">ENEMIES</div>` +
    redEntries.map(([k, d]) => `<button class="ne-type-btn" data-type="${k}">${d.name}</button>`).join('') +
    (npcEntries.length
      ? `<div class="ne-section-hdr">FRIENDLY NPCs</div>` +
        npcEntries.map(([k, d]) => `<button class="ne-type-btn ne-npc-btn" data-type="${k}">${d.name}</button>`).join('')
      : '');

  listEl.addEventListener('click', e => {
    const btn = e.target.closest('.ne-type-btn');
    if (!btn) return;
    _selectedType = btn.dataset.type;
    _selectedUnit = null;
    _ring.visible = false;
    _updateTypeBtns();
    _updateStatus();
  });
}

// ── Init (called from main.js) ────────────────────────────────────────────────
export function initNpcEditor() {
  _buildTypeList();
  _updateStatus();

  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _updateStatus();
  });

  // Toggle panel open/closed
  document.getElementById('npc-editor-btn')?.addEventListener('click', () => {
    _open = !_open;
    const panel = document.getElementById('npc-editor-panel');
    if (panel) panel.style.display = _open ? 'block' : 'none';
    document.getElementById('npc-editor-btn').classList.toggle('active', _open);
    if (!_open) { _selectedUnit = null; _ring.visible = false; closeAIPanel(); _hideAnimPanel(); }
  });

  // Collapse body
  document.getElementById('ne-collapse-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const body = document.getElementById('ne-body');
    if (!body) return;
    const col = body.classList.toggle('collapsed');
    e.currentTarget.textContent = col ? '▲' : '▼';
  });

  // Search
  document.getElementById('ne-search')?.addEventListener('input', e => _applySearch(e.target.value));

  // Save
  document.getElementById('ne-save-btn')?.addEventListener('click', _saveToZone);

  // Clear all red + npc units from scene
  document.getElementById('ne-clear-btn')?.addEventListener('click', () => {
    const toRemove = units.filter(u => u.team === 'red' || u.team === 'npc' || UNIT_TYPES[u.type]?.team === 'npc');
    toRemove.forEach(_removeUnit);
    _selectedUnit = null;
    _ring.visible = false;
    _updateStatus();
  });

  // Click capture — runs before army.js bubble listener
  renderer.domElement.addEventListener('click', e => {
    // Never intercept outside dev mode or during active combat
    if (!isDevMode() || combatPhase) return;

    // Shift+click with a unit selected → clone it at the clicked point
    if (e.shiftKey && _open && _selectedUnit) {
      e.stopImmediatePropagation();
      const pt = _groundPt(e.clientX, e.clientY);
      if (pt) {
        _snapshot();
        const src = _selectedUnit;
        const ovCopy = src.animOverrides && Object.keys(src.animOverrides).length
          ? { ...src.animOverrides } : null;
        const nu = buildUnit(+pt.x.toFixed(2), +pt.z.toFixed(2), src.team, src.type, ovCopy);
        nu.grp.scale.setScalar(src.grp.scale.x);
        nu.grp.rotation.y = src.grp.rotation.y;
        nu.hoverY = src.hoverY ?? 0;
        nu.grp.position.y = getTerrainHeight(nu.grp.position.x, nu.grp.position.z) + nu.hoverY;
        if (src.detectRange      != null) nu.detectRange      = src.detectRange;
        if (src.socialAggroRange != null) nu.socialAggroRange = src.socialAggroRange;
        if (src.roams)                    nu.roams            = src.roams;
        if (src.roamMode)                 nu.roamMode         = src.roamMode;
        if (src.wanderRadius     != null) nu.wanderRadius     = src.wanderRadius;
        if (src.patrolPath?.length)       nu.patrolPath       = src.patrolPath.map(p => ({ x: p.x, z: p.z }));
        if (src.stealthed)                nu.stealthed        = src.stealthed;
        if (src.attackPref)               nu.attackPref       = src.attackPref;
        _selectedUnit = nu;
        _syncRing();
        if (nu.team !== 'npc') openAIPanel(nu);
        _showAnimPanel(nu);
      }
      _updateStatus();
      return;
    }

    const hit = _pickRedUnit(e.clientX, e.clientY);
    if (hit) {
      // Clicking an enemy always works — auto-open the panel if needed
      e.stopImmediatePropagation();
      if (!_open) {
        _open = true;
        const panel = document.getElementById('npc-editor-panel');
        if (panel) panel.style.display = 'block';
        document.getElementById('npc-editor-btn')?.classList.add('active');
      }
      _selectedUnit = hit;
      _syncRing();
      _updateStatus();
      if (hit.team !== 'npc') openAIPanel(hit);
      _showAnimPanel(hit);
      return;
    }

    // Only place / deselect if the editor panel is deliberately open
    if (!_open) return;
    e.stopImmediatePropagation();
    _selectedUnit = null;
    _ring.visible = false;
    closeAIPanel();
    _hideAnimPanel();
    if (_selectedType) {
      const pt = _groundPt(e.clientX, e.clientY);
      if (pt) {
        _snapshot();
        const team = UNIT_TYPES[_selectedType]?.team ?? 'red';
        buildUnit(+pt.x.toFixed(2), +pt.z.toFixed(2), team, _selectedType, _typeAnimDefaults[_selectedType] ?? null);
      }
    }
    _updateStatus();
  }, true);

  // Keyboard
  const NUDGE = 0.5;
  const DUP_STEP = 2.0;
  window.addEventListener('keydown', e => {
    if (!_open) return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); _undo(); return; }
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); if (e.shiftKey) { _duplicateNpc(-DUP_STEP, 0);     } else { if (!e.repeat) _snapshot(); _nudge(-NUDGE, 0);     } break;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) { _duplicateNpc( DUP_STEP, 0);     } else { if (!e.repeat) _snapshot(); _nudge( NUDGE, 0);     } break;
      case 'ArrowUp':    e.preventDefault(); if (e.shiftKey) { _duplicateNpc(0,     -DUP_STEP); } else { if (!e.repeat) _snapshot(); _nudge(0,     -NUDGE); } break;
      case 'ArrowDown':  e.preventDefault(); if (e.shiftKey) { _duplicateNpc(0,      DUP_STEP); } else { if (!e.repeat) _snapshot(); _nudge(0,      NUDGE); } break;
      case '[': e.preventDefault(); if (!e.repeat) _snapshot(); _adjustY(-0.25); break;
      case ']': e.preventDefault(); if (!e.repeat) _snapshot(); _adjustY( 0.25); break;
      case '-': if (!e.repeat) _snapshot(); _adjustScale(1 / 1.10); break;
      case '=': case '+': if (!e.repeat) _snapshot(); _adjustScale(1.10); break;
      case 'r': case 'R':
        if (_selectedUnit) { if (!e.repeat) _snapshot(); _selectedUnit.grp.rotation.y += Math.PI / 4; _updateStatus(); }
        break;
      case 'Delete': case 'Backspace':
        if (_selectedUnit) { _snapshot(); _removeUnit(_selectedUnit); _selectedUnit = null; _ring.visible = false; _updateStatus(); }
        break;
      case 'Escape':
        _selectedUnit = null; _ring.visible = false; _updateStatus();
        break;
    }
  });
}
