import * as THREE from 'three';
import { scene, camera, renderer, ground } from './scene.js';
import { units, buildUnit, ensureModels, getClipNamesForType, applyUnitAnimOverride, serializeZoneEnemies } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { getGroundHeight } from './terrain.js';
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
    s.unit.grp.position.set(s.x, getGroundHeight(s.x, s.z) + s.hoverY, s.z);
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
  nu.grp.position.y   = getGroundHeight(nu.grp.position.x, nu.grp.position.z) + nu.hoverY;
  if (src.detectRange      != null) nu.detectRange      = src.detectRange;
  if (src.socialAggroRange != null) nu.socialAggroRange = src.socialAggroRange;
  if (src.roams)                    nu.roams            = src.roams;
  if (src.roamMode)                 nu.roamMode         = src.roamMode;
  if (src.wanderRadius     != null) nu.wanderRadius     = src.wanderRadius;
  if (src.roamGroup)                nu.roamGroup        = src.roamGroup;
  // A duplicate that inherits a roamGroup is a FOLLOWER, so it deliberately does NOT get a
  // copy of the route. Two path-holders in one band would make the leader depend on units[]
  // order — which a respawn reshuffles, silently re-anchoring the formation. Ungrouped
  // roamers still clone their waypoints exactly as before.
  if (!nu.roamGroup && src.patrolPath?.length) nu.patrolPath = src.patrolPath.map(p => ({ x: p.x, z: p.z }));
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
  // Deliberately moving a unit in the editor DOES move its spawn point — that's the
  // one case where the saved position should follow the live one.
  if (_selectedUnit.spawn) {
    _selectedUnit.spawn.x = _selectedUnit.grp.position.x;
    _selectedUnit.spawn.z = _selectedUnit.grp.position.z;
  }
  _syncRing();
  _updateStatus();
}

function _adjustY(delta) {
  if (!_selectedUnit) return;
  const u = _selectedUnit;
  u.hoverY = (u.hoverY ?? 0) + delta;
  // Immediately push Y so the ring stays in sync without waiting for the next tick
  u.grp.position.y = getGroundHeight(u.grp.position.x, u.grp.position.z) + u.hoverY;
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

  const enemies = serializeZoneEnemies();

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
    // Models load per zone now (ensureModels in units.js), so a type the CURRENT zone doesn't
    // spawn — e.g. a giant rat dropped into the Warrens — has no GLB in the cache, and buildUnit
    // would place a grey PLACEHOLDER BOX. Warm it the instant you pick it from the list, so it's
    // in hand by the time you click to place. (Placement also awaits, below, to catch a fast click.)
    ensureModels([_selectedType]);
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
        nu.grp.position.y = getGroundHeight(nu.grp.position.x, nu.grp.position.z) + nu.hoverY;
        if (src.detectRange      != null) nu.detectRange      = src.detectRange;
        if (src.socialAggroRange != null) nu.socialAggroRange = src.socialAggroRange;
        if (src.roams)                    nu.roams            = src.roams;
        if (src.roamMode)                 nu.roamMode         = src.roamMode;
        if (src.wanderRadius     != null) nu.wanderRadius     = src.wanderRadius;
        if (src.roamGroup)                nu.roamGroup        = src.roamGroup;
        // Grouped duplicate = follower, no route copy — see the note in _duplicateNpc.
        if (!nu.roamGroup && src.patrolPath?.length) nu.patrolPath = src.patrolPath.map(p => ({ x: p.x, z: p.z }));
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
        const type = _selectedType;
        const x = +pt.x.toFixed(2), z = +pt.z.toFixed(2);
        // Guarantee the model is in hand before building, so placing a type the zone doesn't
        // spawn drops the real asset instead of a placeholder box. Resolves instantly if the
        // select-time prefetch already finished.
        ensureModels([type]).then(() => {
          buildUnit(x, z, team, type, _typeAnimDefaults[type] ?? null);
          _updateStatus();
        });
      }
    }
    _updateStatus();
  }, true);

  // Keyboard
  const NUDGE = 0.5;
  const MICRO_NUDGE = 0.05;   // Ctrl+Arrow: 1/10 of NUDGE for fine placement
  const DUP_STEP = 2.0;
  window.addEventListener('keydown', e => {
    if (!_open) return;
    // ⚠ These are BARE single-key shortcuts on the window, so they fire while you type in
    // any editor field: Backspace DELETES the selected unit, r rotates it, -/= rescale it,
    // []_adjust Y, arrows nudge and shift+arrow duplicates. Harmless while every control was
    // a checkbox or number spinner; the AI panel's free-text Roam group field made it
    // destructive (typing an id silently deleted a warg). Ignore keys aimed at a field.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); _undo(); return; }
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); if (e.shiftKey) { _duplicateNpc(-DUP_STEP, 0);     } else { if (!e.repeat) _snapshot(); _nudge(-(e.ctrlKey ? MICRO_NUDGE : NUDGE), 0);     } break;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) { _duplicateNpc( DUP_STEP, 0);     } else { if (!e.repeat) _snapshot(); _nudge( (e.ctrlKey ? MICRO_NUDGE : NUDGE), 0);     } break;
      case 'ArrowUp':    e.preventDefault(); if (e.shiftKey) { _duplicateNpc(0,     -DUP_STEP); } else { if (!e.repeat) _snapshot(); _nudge(0,     -(e.ctrlKey ? MICRO_NUDGE : NUDGE)); } break;
      case 'ArrowDown':  e.preventDefault(); if (e.shiftKey) { _duplicateNpc(0,      DUP_STEP); } else { if (!e.repeat) _snapshot(); _nudge(0,      (e.ctrlKey ? MICRO_NUDGE : NUDGE)); } break;
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
