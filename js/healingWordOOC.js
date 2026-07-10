// js/healingWordOOC.js — Leugren's out-of-combat Healing Word.
//
// No dedicated widget: when Leugren is the selected (precombat-controlled)
// hero and outside combat, his Healing Word appears on the hotbar (KeyQ,
// same slot it uses in combat) instead of a separate box on screen. One use
// between combats — resets the moment the next combat ends. Clicking it
// shows the same green targeting rings used in combat (startOOCHealTargeting
// in combat.js) — click a ring to cast, click elsewhere to cancel.

import { heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import {
  combatPhase, showFloatingDamage, addLog,
  startOOCHealTargeting, cancelOOCHealTargeting,
} from './combat.js';
import { updateHeroUI } from './heroPortraits.js';
import { bindHotkey, updateHotkeyRanges } from './hotbar.js';

let _used     = false;
let _selected = null;   // currently PC-selected hero (from pc-hero:selected)
let _picking  = false;  // true while the green targeting rings are up

export function initHealingWordOOC() {
  window.addEventListener('pc-hero:selected',   e => { _selected = e.detail?.hero ?? null; _stopPicking(); _render(); });
  window.addEventListener('pc-hero:deselected', () => { _selected = null; _stopPicking(); _render(); });
  window.addEventListener('combat:start',       () => { _picking = false; _render(); });
  window.addEventListener('combat:ended',       () => { _used = false; _render(); });
}

function _canCast() {
  return !combatPhase && !_used && !!_selected && _selected.type === 'dwarf' && _selected.hp > 0;
}

// Exposed so the Skills & Spells window's Healing Word button (a plain click,
// via combat.js's `healing_word` ability handler) behaves identically to the
// hotbar KeyQ binding when out of combat.
export function canHealingWordOOC() { return _canCast(); }
export function triggerHealingWordOOC() {
  if (!_canCast()) return;
  _picking ? _stopPicking() : _startPicking();
}

function _render() {
  // combat.js's own _rebuildHotbar owns KeyQ during actual turns (it's
  // Leugren's in-combat Healing Word slot too) — never touch it once a
  // fight is live, only manage it for the precombat/exploration phase.
  if (combatPhase) return;
  // Out of combat, combat.js's OOC hotbar system auto-fills KeyQ for EVERY
  // hero (fire_bolt for Rasec, rage for Gobo, etc.). Only Leugren's Q is
  // Healing Word, so this module only manages it for the dwarf — and it must
  // never unbind KeyQ, or another hero's auto-assigned ability gets wiped
  // (that's the bug where only Leugren's Q showed out of combat).
  if (_selected?.type !== 'dwarf') return;
  if (!_canCast()) {
    // Used up (or Leugren's down) — leave combat.js's auto-assigned Healing
    // Word in place and just refresh its greyed state rather than blanking Q.
    updateHotkeyRanges();
    return;
  }
  // Castable: override with the picking-aware binding (adds the CHOOSE TARGET
  // label and the click-to-toggle-rings flow on top of the base handler).
  bindHotkey('KeyQ', false,
    _picking
      ? '<span class="hb-ready">CHOOSE<br>TARGET</span>'
      : '<img class="hb-spell-img-fill" src="assets/spells and skills/healingword.jpg">',
    () => { _picking ? _stopPicking() : _startPicking(); },
    _canCast,
    'action'
  );
  updateHotkeyRanges();
}

function _startPicking() {
  if (!_canCast()) return;
  _picking = true;
  startOOCHealTargeting(_selected, target => {
    _picking = false;
    if (target) _cast(target);
    else _render();
  });
  _render();
}

function _stopPicking() {
  if (!_picking) return;
  _picking = false;
  cancelOOCHealTargeting();
}

function _cast(target) {
  const caster = _selected;
  if (!_canCast() || !caster) { _render(); return; }
  // Don't spend the heal on an ally already at full HP — keep it available.
  if (target.hp >= target.maxHp) {
    showFloatingDamage(target, 'Full HP', '#8fd0ff');
    addLog(`${UNIT_TYPES[target.type]?.name ?? target.type} is already at full health — Healing Word not spent.`, 'heal');
    _render();
    return;
  }
  _used = true;

  const wisMod = Math.floor(((UNIT_TYPES.dwarf?.abilities?.wis ?? 10) - 10) / 2);
  const healed = Math.max(1, Math.ceil(Math.random() * 8) + wisMod);
  const prev   = target.hp;
  target.hp    = Math.min(target.maxHp, target.hp + healed);
  const actual = target.hp - prev;

  const targetName = UNIT_TYPES[target.type]?.name ?? target.type;
  showFloatingDamage(target, `+${actual}`, '#55cc55');
  addLog(`${UNIT_TYPES.dwarf.name} casts Healing Word on ${targetName}, restoring ${actual} HP`, 'heal');

  updateHeroUI();
  _render();
}
