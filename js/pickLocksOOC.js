// js/pickLocksOOC.js — Milo's out-of-combat lockpicking.
//
// Mirrors healingWordOOC.js: when Milo is the PC-selected hero out of combat, Pick Locks takes his
// KeyQ hotbar slot. He gets ONE attempt between combats plus belt Resource-regen extra attempts (a
// second try at a lock he flubbed); the pool resets when the next combat ends.
//
// ⚠ THERE IS NO LOCK SYSTEM YET (user knows — built now so the belt affix has a Milo consumer). The
// resource pool + hotbar surfacing are real; the lock INTERACTION is a stub. To finish it later:
// implement _nearestLock() (find a prop/container within reach carrying `.locked` + `.lockDC`) and
// _attempt() (d100 Sleight-of-Hand vs lockDC; success unlocks, failure spends the attempt). An
// attempt is only consumed when a real lock is worked — clicking with nothing in reach is free.

import { heroRoster } from './units.js';
import { UNIT_TYPES, WORLD_UNITS_PER_SQUARE } from './constants.js';
import { combatPhase, showFloatingDamage, addLog } from './combat.js';
import { bindHotkey, updateHotkeyRanges } from './hotbar.js';
import { affixTotal } from './affixes.js';

const REACH = 1.5 * WORLD_UNITS_PER_SQUARE;   // must be within ~1.5 squares of the lock

let _usedCount = 0;      // pick attempts spent since the last combat ended
let _selected  = null;
let _initDone  = false;

function _maxUses() {
  const milo = _selected?.type === 'halfling' ? _selected : heroRoster.find(h => h.type === 'halfling');
  return 1 + (milo ? affixTotal(milo, 'resource_regen') : 0);
}

export function initPickLocksOOC() {
  if (_initDone) return; _initDone = true;
  window.addEventListener('pc-hero:selected',   e => { _selected = e.detail?.hero ?? null; _render(); });
  window.addEventListener('pc-hero:deselected', () => { _selected = null; _render(); });
  window.addEventListener('combat:start',       () => _render());
  window.addEventListener('combat:ended',       () => { _usedCount = 0; _render(); });
}

// Stub: no lock system yet, so nothing is ever in reach. Fill this in when lockable containers exist.
function _nearestLock() {
  return null;
}

function _canUse() {
  return !combatPhase && !!_selected && _selected.type === 'halfling' &&
         _selected.hp > 0 && _usedCount < _maxUses();
}

function _render() {
  if (combatPhase) return;
  if (_selected?.type !== 'halfling') return;
  bindHotkey('KeyQ', false,
    '<span class="hb-ready">PICK<br>LOCK</span>',
    _use,
    _canUse,
    'action',
  );
  updateHotkeyRanges();
}

function _use() {
  const hero = _selected;
  if (!_canUse() || !hero) { _render(); return; }

  const lock = _nearestLock();
  if (!lock) {
    // Nothing to pick — don't burn an attempt on empty air.
    showFloatingDamage(hero, 'No lock in reach', '#bbbbbb');
    addLog(`${UNIT_TYPES.halfling?.name ?? 'Milo'} looks for a lock but finds none within reach.`, 'move');
    _render();
    return;
  }

  // When locks exist: _attempt(lock) rolls d100 Sleight-of-Hand vs lock.lockDC, unlocks on success,
  // and consumes _usedCount++ whether it opens or not (Resource-regen = more tries). Not built yet.
  _render();
}
