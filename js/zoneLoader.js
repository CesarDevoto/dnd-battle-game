import * as THREE from 'three';
import { scene } from './scene.js';
import { units, buildUnit, corpses, modelsReady, setUnitStealth } from './units.js';
import { setTerrainControlPoints, setTerrainSeed, setActiveGroundSize } from './terrain.js';
import { UNIT_TYPES, GROUND_SIZE } from './constants.js';
import { setSceneGroundSize } from './scene.js';
import { removeUnits, resetToSetup } from './army.js';
import { setEnv, setEnvSkipProps, clearProps, addUnitDungeonLight } from './environments.js';
import { loadZoneProps, clearEditorProps, prewarmGLBs } from './propEditor.js';
import { getTerrainHeight } from './terrain.js';
import { renderHeroPortrait } from './heroPortraits.js';
import { isDevMode } from './devMode.js';
import { turnOrder, addLog, registerPendingSpawnCheck } from './combat.js';
import { applyHeroSkin } from './heroSkins.js';
import { ZONE as ZONE_DUNGEON_ENTRANCE } from './zones/zone_dungeon_entrance.js';
import { ZONE as ZONE_CRAGMAW_ENTRANCE } from './zones/zone_road_to_cragmaw.js';
import { ZONE as ZONE_RIVER_STYX } from './zones/zone_river_styx.js';

// ── Registry ──────────────────────────────────────────────────────────────────

const _registry = {};
const ZONE_ORDER = [ZONE_DUNGEON_ENTRANCE, ZONE_CRAGMAW_ENTRANCE, ZONE_RIVER_STYX];
ZONE_ORDER.forEach(z => { _registry[z.id] = z; });

// Kick off parallel GLB fetches for every prop in every zone immediately at
// module load time — cache is warm before the user ever switches zones.
prewarmGLBs([...new Set(ZONE_ORDER.flatMap(z => (z.props ?? []).map(p => p.model)))]);

// ── State ─────────────────────────────────────────────────────────────────────

let _active      = null;
let _exitsLive   = false;
let _transitioning = false;
let _exitMeshes  = [];
let _exitT       = 0;

export function getActiveZone()  { return _active; }
export function getAllZones()     { return Object.values(_registry); }

// ── Wave spawner ──────────────────────────────────────────────────────────────
// Each entry: { type, x, z, round, every?, yOff?, scale?, roams?, ... }
// `round`  — first round to fire (1-based)
// `every`  — if set, repeats every N rounds after the first fire; omit for one-shot

let _pendingSpawns    = [];
const _firedOneshotIdx = new Set();

// Tell combat.js not to declare victory while unfired one-shot spawns remain.
registerPendingSpawnCheck(() =>
  _pendingSpawns.some((s, i) => !s.every && !_firedOneshotIdx.has(i))
);

function _tickSpawns(roundNum) {
  _pendingSpawns.forEach((s, idx) => {
    if (roundNum < s.round) return;
    const delta = roundNum - s.round;
    if (s.every) {
      if (delta % s.every !== 0) return;
    } else {
      if (delta !== 0) return;
      _firedOneshotIdx.add(idx);
    }

    const u = buildUnit(s.x, s.z, 'red', s.type, s.animOverrides ?? null);
    if (s.yOff)                           u.hoverY = s.yOff;
    if (s.scale != null && s.scale !== 1) u.grp.scale.set(s.scale, s.scale, s.scale);
    if (s.patrol?.length >= 2)            { u.patrolPath = s.patrol; u._patrolIdx = 0; }
    if (s.detectRange != null)            u.detectRange = s.detectRange;
    if (s.roams)                          u.roams = true;
    if (s.roamMode)                       u.roamMode = s.roamMode;
    if (s.wanderRadius != null)           u.wanderRadius = s.wanderRadius;
    if (s.stealthed)                      { if (!isDevMode()) setUnitStealth(u, true); else u.stealthed = true; }

    // Reinforcements are immediately hostile
    u.aggro = true;
    // Roll initiative and insert at correct sorted position
    const def     = UNIT_TYPES[s.type] ?? {};
    const dexMod  = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
    const bonus   = (def.initiative ?? 0) + dexMod;
    u.initiative  = Math.floor(Math.random() * 20) + 1 + bonus;
    turnOrder.push(u);
  });
}

window.addEventListener('round:start', e => _tickSpawns(e.detail.round));

// ── Exit markers ──────────────────────────────────────────────────────────────

function _clearExits() {
  _exitMeshes.forEach(m => scene.remove(m));
  _exitMeshes = [];
  _exitsLive  = false;
}

function _buildExitMarker(exit) {
  const wx = exit.x;
  const wz = exit.z;
  const y  = getTerrainHeight(wx, wz) + 0.15;

  // Outer glow ring
  const outerGeo = new THREE.RingGeometry(1.5, 2.2, 40);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(wx, y, wz);
  outer.userData.exit = exit;
  outer.visible = false;

  // Inner fill disc
  const innerGeo = new THREE.CircleGeometry(1.4, 40);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(wx, y + 0.01, wz);
  inner.visible = false;

  scene.add(outer);
  scene.add(inner);
  _exitMeshes.push(outer, inner);
  return outer;
}

// ── Load a zone ───────────────────────────────────────────────────────────────

export function loadZone(id, repositionHeroes = false) {
  const zone = _registry[id];
  if (!zone) { console.warn(`[zoneLoader] Unknown zone: ${id}`); return; }

  _active = zone;
  _transitioning = false;
  window.dispatchEvent(new CustomEvent('zone:loading'));
  _clearExits();
  _pendingSpawns = (zone.spawns ?? []).slice();  // fresh copy for this zone
  _firedOneshotIdx.clear();

  // Hide short rest panel if open from previous zone
  const srPanel = document.getElementById('short-rest-panel');
  if (srPanel) srPanel.style.display = 'none';

  // Remove all enemies (living)
  removeUnits(u => u.team === 'red');

  // Remove enemy corpses left by death animations
  for (let i = corpses.length - 1; i >= 0; i--) {
    if (corpses[i].team === 'red') {
      scene.remove(corpses[i].grp);
      corpses.splice(i, 1);
    }
  }

  // Apply ground size before biome switch so terrain + grid are rebuilt at the right scale
  const zoneGS = zone.groundSize ?? GROUND_SIZE;
  setActiveGroundSize(zoneGS);
  setSceneGroundSize(zoneGS);

  // Apply terrain control points + seed before biome switch so they're baked into the rebuild
  setTerrainControlPoints(zone.terrain ?? []);
  if (zone.terrainSeed) setTerrainSeed(zone.terrainSeed);

  // Switch biome — skip random props if zone defines its own
  clearEditorProps();
  if (zone.props?.length) {
    setEnvSkipProps(zone.biome, zone.ambient);
    loadZoneProps(zone.props);  // async; props load in after biome switch
  } else {
    setEnv(zone.biome, zone.ambient);
  }
  // Place heroes (initial load) or reposition existing ones (zone transition)
  if (repositionHeroes) {
    const heroes = units.filter(u => u.team === 'blue');
    zone.heroEntry.forEach((pos, i) => {
      const h = heroes[i];
      if (!h) return;
      h.grp.position.set(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
      if (h.anchor) {
        h.anchor.x = pos.x;
        h.anchor.z = pos.z;
      }
    });
  } else {
    // Fresh load — place heroes if none exist yet
    const existing = units.filter(u => u.team === 'blue');
    if (existing.length === 0) {
      zone.heroEntry.forEach(pos => {
        const u = buildUnit(pos.x, pos.z, 'blue', pos.type);
        renderHeroPortrait(u);
      });
    }
  }

  // Re-attach dungeon lights to existing heroes after any env switch
  // (setEnv always clears them; buildUnit only runs on first load)
  units.filter(u => u.team === 'blue').forEach(u => addUnitDungeonLight(u.grp));

  // Apply zone-specific hero skin — must run after heroes are built
  applyHeroSkin(zone.heroSkin ?? null);

  // Place enemies
  zone.enemies.forEach(e => {
    const u = buildUnit(e.x, e.z, 'red', e.type, e.animOverrides ?? null);
    if (e.yOff)                           u.hoverY = e.yOff;
    if (e.scale != null && e.scale !== 1) u.grp.scale.set(e.scale, e.scale, e.scale);
    if (e.patrol?.length >= 2)            { u.patrolPath = e.patrol; u._patrolIdx = 0; }
    // AI settings
    if (e.detectRange != null)      u.detectRange      = e.detectRange;
    if (e.socialAggroRange != null) u.socialAggroRange = e.socialAggroRange;
    if (e.roams)                    u.roams            = true;
    if (e.roamMode)             u.roamMode     = e.roamMode;
    if (e.wanderRadius != null) u.wanderRadius = e.wanderRadius;
    if (e.stealthed)            { if (!isDevMode()) setUnitStealth(u, true); else u.stealthed = true; }
    if (e.attackPref)           u.attackPref   = e.attackPref;
  });

  // Build exit markers (hidden until victory)
  zone.exits.forEach(exit => _buildExitMarker(exit));

  // Update zone label in UI
  _updateZoneLabel();

  // Remember last zone so HMR reloads restore it automatically
  try { localStorage.setItem('dnd-last-zone', id); } catch {}

  // Fire event so other systems can react
  window.dispatchEvent(new CustomEvent('zone:loaded', { detail: { id } }));
}

// ── Activate exits after victory ──────────────────────────────────────────────

export function activateExits() {
  const isFinal = !_active?.exits.length;

  if (isFinal) return;

  _exitsLive = true;
  _exitMeshes.forEach(m => { m.visible = true; });

  const targetId = _active.exits[0]?.targetZone;
  if (targetId) _showShortRestPanel(targetId);

  // Update zone progress dots
  _updateZoneProgress();
}

function _showShortRestPanel(targetZoneId) {
  const panel   = document.getElementById('short-rest-panel');
  const rowsEl  = document.getElementById('sr-hero-rows');
  const rollBtn = document.getElementById('sr-roll-btn');
  const skipBtn = document.getElementById('sr-skip-btn');
  if (!panel || !rowsEl) return;

  const heroes = units.filter(u => u.team === 'blue');

  // Build hero rows
  rowsEl.innerHTML = heroes.map((h, i) => {
    const pct = Math.max(0, h.hp / h.maxHp);
    const lowCls = pct <= 0.25 ? ' crit' : pct <= 0.50 ? ' low' : '';
    return `<div class="sr-row" data-idx="${i}">
      <span class="sr-row-name">${UNIT_TYPES[h.type]?.name ?? h.type}</span>
      <div class="sr-hp-wrap">
        <div class="sr-hp-bar-bg"><div class="sr-hp-bar-fill${lowCls}" style="width:${(pct*100).toFixed(1)}%"></div></div>
        <div class="sr-hp-text">
          <span class="sr-hp-cur">${h.hp}</span>
          <span>/ ${h.maxHp}</span>
        </div>
      </div>
      <span class="sr-heal-amt" data-idx="${i}"></span>
    </div>`;
  }).join('');

  if (rollBtn) {
    rollBtn.disabled = false;
    rollBtn.onclick = () => {
      rollBtn.disabled = true;
      heroes.forEach((h, i) => {
        if (h.hp >= h.maxHp) {
          document.querySelector(`.sr-heal-amt[data-idx="${i}"]`).textContent = '—';
          return;
        }
        const def = UNIT_TYPES[h.type];
        const die = def?.hitDie ?? 8;
        const con = def?.abilities?.con ?? 10;
        const conMod = Math.floor((con - 10) / 2);
        const rolled = Math.ceil(Math.random() * die);
        const healed = Math.max(1, rolled + conMod);
        const prev = h.hp;
        h.hp = Math.min(h.maxHp, h.hp + healed);
        const actual = h.hp - prev;

        // Update row visuals
        const pct = h.hp / h.maxHp;
        const lowCls = pct <= 0.25 ? ' crit' : pct <= 0.50 ? ' low' : '';
        const fillEl = rowsEl.querySelectorAll('.sr-hp-bar-fill')[i];
        const curEl  = rowsEl.querySelectorAll('.sr-hp-cur')[i];
        const amtEl  = document.querySelector(`.sr-heal-amt[data-idx="${i}"]`);
        if (fillEl) { fillEl.className = `sr-hp-bar-fill${lowCls}`; fillEl.style.width = `${(pct*100).toFixed(1)}%`; }
        if (curEl)  curEl.textContent = h.hp;
        if (amtEl)  amtEl.textContent = actual > 0 ? `+${actual}` : '—';
      });
    };
  }

  if (skipBtn) {
    skipBtn.onclick = () => {
      panel.style.display = 'none';
      _triggerNextZone(targetZoneId);
    };
  }

  panel.style.display = 'block';
}

function _triggerNextZone(targetId) {
  const outcomeEl = document.getElementById('battle-outcome');
  if (outcomeEl) { outcomeEl.style.display = 'none'; outcomeEl.className = ''; }
  loadZone(targetId, true);
  _showSetupAfterTransition();
}

// ── Per-frame tick ────────────────────────────────────────────────────────────

export function tickZone(dt) {
  _exitT += dt;
  if (!_exitsLive || _exitMeshes.length < 2) return;

  // Pulse outer ring + inner disc
  const pulse = 0.35 + Math.sin(_exitT * 2.8) * 0.25;
  for (let i = 0; i < _exitMeshes.length; i += 2) {
    const outer = _exitMeshes[i];
    const inner = _exitMeshes[i + 1];
    if (outer) { outer.material.opacity = pulse; outer.rotation.z += dt * 0.9; }
    if (inner) inner.material.opacity = pulse * 0.18;
  }
}

// ── Zone UI init ──────────────────────────────────────────────────────────────

function _updateZoneLabel() {
  const el = document.getElementById('zone-current-name');
  if (el) el.textContent = _active ? `Active: ${_active.name}` : '';
  document.querySelectorAll('.zone-btn').forEach(btn => {
    btn.classList.toggle('active-zone', btn.dataset.zone === _active?.id);
  });
  _updateZoneProgress();
}

function _updateZoneProgress() {
  const el = document.getElementById('zone-progress-dots');
  if (!el) return;
  const activeIdx = ZONE_ORDER.findIndex(z => z.id === _active?.id);
  el.innerHTML = ZONE_ORDER.map((z, i) => {
    const cls = i < activeIdx ? 'zp-dot cleared' : i === activeIdx ? 'zp-dot active' : 'zp-dot';
    return `<span class="${cls}" title="${z.name}"></span>`;
  }).join('');
}

export function initZoneUI() {
  // ── Zone row helpers ────────────────────────────────────────────────────
  function _makeZoneRow(id, name) {
    const row = document.createElement('div');
    row.className = 'zone-row';
    row.innerHTML = `<button class="zone-btn s-btn" data-zone="${id}">⚔ ${name}</button><button class="zone-del-btn" data-zone="${id}" title="Delete zone">×</button>`;
    return row;
  }

  function _promptDelete(row, id, name) {
    row.classList.add('zone-confirm-row');
    row.innerHTML = '';

    const text = document.createElement('div');
    text.className   = 'zone-confirm-text';
    text.textContent = `Delete "${name}"?`;

    const btns = document.createElement('div');
    btns.className = 'zone-confirm-btns';

    const yesBtn = document.createElement('button');
    yesBtn.className   = 's-btn';
    yesBtn.textContent = 'YES';
    yesBtn.addEventListener('click', async () => {
      yesBtn.disabled = noBtn.disabled = true;
      try {
        const res  = await fetch('/__delete_zone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        delete _registry[id];
        row.remove();
      } catch (err) {
        console.error('[deleteZone]', err);
        _restoreRow(row, id, name);
      }
    });

    const noBtn = document.createElement('button');
    noBtn.className   = 's-btn';
    noBtn.textContent = 'NO';
    noBtn.addEventListener('click', () => _restoreRow(row, id, name));

    btns.appendChild(yesBtn);
    btns.appendChild(noBtn);
    row.appendChild(text);
    row.appendChild(btns);
  }

  function _restoreRow(row, id, name) {
    row.classList.remove('zone-confirm-row');
    row.innerHTML = `<button class="zone-btn s-btn" data-zone="${id}">⚔ ${name}</button><button class="zone-del-btn" data-zone="${id}" title="Delete zone">×</button>`;
  }

  // Zone list — rebuild from ZONE_ORDER every init (survives HMR reloads)
  const listEl = document.getElementById('zone-list');
  if (listEl) {
    listEl.innerHTML = '';
    ZONE_ORDER.forEach(zone => listEl.appendChild(_makeZoneRow(zone.id, zone.name)));

    listEl.addEventListener('click', e => {
      const loadBtn = e.target.closest('.zone-btn');
      if (loadBtn) { loadZone(loadBtn.dataset.zone, false); return; }

      const delBtn = e.target.closest('.zone-del-btn');
      if (delBtn) {
        const row     = delBtn.closest('.zone-row');
        const id      = delBtn.dataset.zone;
        const loadBtn = row?.querySelector('.zone-btn');
        const name    = _registry[id]?.name ?? loadBtn?.textContent.replace('⚔ ', '').trim() ?? id;
        if (row && id) _promptDelete(row, id, name);
      }
    });
  }

  // ── New zone creation ────────────────────────────────────────────────────
  const newZoneBtn = document.getElementById('zone-new-btn');
  const createForm = document.getElementById('zone-create-form');
  const nameInput  = document.getElementById('zone-name-input');
  const confirmBtn = document.getElementById('zone-create-confirm-btn');
  const cancelBtn  = document.getElementById('zone-create-cancel-btn');
  const statusEl   = document.getElementById('zone-current-name');

  function _showCreateForm() {
    if (createForm) createForm.style.display = 'block';
    if (newZoneBtn) newZoneBtn.style.display = 'none';
    nameInput?.focus();
  }
  function _hideCreateForm() {
    if (createForm) createForm.style.display = 'none';
    if (newZoneBtn) newZoneBtn.style.display = '';
    if (nameInput)  nameInput.value = '';
  }

  newZoneBtn?.addEventListener('click', _showCreateForm);
  cancelBtn?.addEventListener('click', _hideCreateForm);

  async function _createZone() {
    const name = nameInput?.value.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!id) return;

    if (confirmBtn) confirmBtn.disabled = true;
    try {
      const res  = await fetch('/__create_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const mod  = await import(`./zones/zone_${id}.js`);
      const zone = mod.ZONE;
      _registry[zone.id] = zone;

      listEl?.appendChild(_makeZoneRow(zone.id, zone.name));
      _hideCreateForm();
      loadZone(zone.id, false);  // switch to new zone + set localStorage for HMR auto-resume
    } catch (err) {
      console.error('[createZone]', err);
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  confirmBtn?.addEventListener('click', _createZone);
  nameInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  _createZone();
    if (e.key === 'Escape') _hideCreateForm();
  });

  // #next-zone-btn is now only used as a fallback; rest panel handles the flow.
  // Keep listener in case it's triggered directly (e.g., skip-rest path already calls _triggerNextZone).

  // React to zone:victory
  window.addEventListener('zone:victory', () => {
    if (_active) activateExits();
  });

  // Auto-resume last zone after HMR page reload; fall back to first zone for new players
  try {
    const lastZone = localStorage.getItem('dnd-last-zone');
    const startZone = (lastZone && _registry[lastZone]) ? lastZone : ZONE_ORDER[0].id;
    modelsReady.then(() => loadZone(startZone, false));
  } catch {}
}

function _fullReset() {
  const srPanel = document.getElementById('short-rest-panel');
  if (srPanel) srPanel.style.display = 'none';
  const nextBtn = document.getElementById('next-zone-btn');
  if (nextBtn) nextBtn.style.display = 'none';
  clearEditorProps();
  removeUnits(() => true);
  // Clear hero corpses too
  for (let i = corpses.length - 1; i >= 0; i--) {
    scene.remove(corpses[i].grp);
  }
  corpses.length = 0;
  _clearExits();
  _active = null;
  _updateZoneLabel();
  resetToSetup();
  const setupZones     = document.getElementById('setup-panel-zones');
  const setupCutscenes = document.getElementById('setup-panel-cutscenes');
  const startWrap      = document.getElementById('start-battle-btn-wrap');
  if (setupZones)     setupZones.style.display     = '';
  if (setupCutscenes) setupCutscenes.style.display = '';
  if (startWrap)      startWrap.style.display      = '';
}

function _showSetupAfterTransition() {
  resetToSetup();
  ['setup-panel-zones', 'setup-panel-cutscenes', 'start-battle-btn-wrap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
}
