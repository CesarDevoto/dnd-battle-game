// js/owlScoutOOC.js — Rasec's out-of-combat Arcane Scout (the owl does a reconnaissance pass).
//
// Mirrors healingWordOOC.js: when Rasec is the PC-selected hero out of combat AND his owl is summoned,
// Arcane Scout takes his KeyQ hotbar slot. ONE scout pass between combats plus belt Resource-regen
// extra passes; the pool resets when the next combat ends. A pass reveals hidden enemies within scout
// range (MAX_SCOUT_RANGE) of Rasec — the owl "flies out and back", so you learn what's ahead.
//
// The owl leaves Rasec's shoulder, flies out ahead (the direction Rasec faces) and back, revealing
// hidden enemies it passes near along the way (familiar.js startFamiliarScout drives the flight; this
// module supplies the reveal via the per-frame progress callback).

import { heroRoster, units } from './units.js';
import { UNIT_TYPES, WORLD_UNITS_PER_SQUARE } from './constants.js';
import { combatPhase, showFloatingDamage, addLog, showCenterAlert } from './combat.js';
import { bindHotkey, updateHotkeyRanges } from './hotbar.js';
import { affixTotal } from './affixes.js';
import { isFamiliarSummoned, isFamiliarScouting, startFamiliarScout } from './familiar.js';

const MAX_SCOUT_RANGE = 10 * WORLD_UNITS_PER_SQUARE;   // how far ahead the owl flies
const REVEAL_RADIUS   = 5 * WORLD_UNITS_PER_SQUARE;    // hidden enemies within this of the owl are seen

let _usedCount = 0;      // scout passes spent since the last combat ended
let _selected  = null;
let _initDone  = false;

function _maxUses() {
  const rasec = _selected?.type === 'elf' ? _selected : heroRoster.find(h => h.type === 'elf');
  return 1 + (rasec ? affixTotal(rasec, 'resource_regen') : 0);
}

export function initOwlScoutOOC() {
  if (_initDone) return; _initDone = true;
  window.addEventListener('pc-hero:selected',   e => { _selected = e.detail?.hero ?? null; _render(); });
  window.addEventListener('pc-hero:deselected', () => { _selected = null; _render(); });
  window.addEventListener('combat:start',       () => _render());
  window.addEventListener('combat:ended',       () => { _usedCount = 0; _render(); });
}

function _canUse() {
  return !combatPhase && !!_selected && _selected.type === 'elf' &&
         _selected.hp > 0 && isFamiliarSummoned() && !isFamiliarScouting() && _usedCount < _maxUses();
}

function _render() {
  if (combatPhase) return;
  if (_selected?.type !== 'elf') return;
  // No owl out → leave Rasec's auto-assigned Fire Bolt on KeyQ; only claim the slot when scouting is
  // actually available (owl summoned), so we never blank his cantrip for a scout he can't do.
  if (!isFamiliarSummoned()) { updateHotkeyRanges(); return; }
  bindHotkey('KeyQ', false,
    '<span class="hb-ready">ARCANE<br>SCOUT</span>',
    _use,
    _canUse,
    'action',
  );
  updateHotkeyRanges();
}

function _use() {
  const hero = _selected;
  if (!_canUse() || !hero) { _render(); return; }

  // Scout ahead in the direction Rasec is facing (his last movement heading). rotation.y is a
  // yaw where forward = (sin, cos), matching how the movement code orients units.
  const yaw  = hero.grp.rotation.y;
  const dest = {
    x: hero.grp.position.x + Math.sin(yaw) * MAX_SCOUT_RANGE,
    z: hero.grp.position.z + Math.cos(yaw) * MAX_SCOUT_RANGE,
  };

  const seen = new Set();
  const started = startFamiliarScout(dest, {
    // Fires each frame with the owl's ground position — reveal any hidden enemy it flies near.
    onProgress: (ox, oz) => {
      for (const u of units) {
        if (u.team !== 'red' || u.hp <= 0 || u.grp.visible || seen.has(u)) continue;
        const dx = u.grp.position.x - ox, dz = u.grp.position.z - oz;
        if (dx * dx + dz * dz > REVEAL_RADIUS * REVEAL_RADIUS) continue;
        u.grp.visible = true;                 // reveal as the owl passes (momentary; persistence TBD)
        showFloatingDamage(u, '!', '#c9a0e6');
        seen.add(u);
      }
    },
    onDone: () => {
      const name = UNIT_TYPES.elf?.name ?? 'Rasec';
      addLog(seen.size > 0
        ? `${name}'s owl returns from scouting — ${seen.size} hidden ${seen.size === 1 ? 'enemy' : 'enemies'} spotted!`
        : `${name}'s owl scouts ahead and returns — nothing hidden nearby.`, 'move');
      _render();   // re-enable the button (or grey it if the pool's now empty)
    },
  });
  if (!started) { _render(); return; }         // owl busy — don't spend the pass

  _usedCount++;
  showCenterAlert('Scouting…', '#c9a0e6');
  _render();                                    // grey the button while the owl is out
}
