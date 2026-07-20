// js/pickLocksOOC.js — Milo's out-of-combat lockpicking.
//
// Mirrors healingWordOOC.js: when Milo is the PC-selected hero out of combat, Pick Locks takes his
// KeyQ hotbar slot. He gets ONE attempt between combats plus belt Resource-regen extra attempts (a
// second try at a lock he flubbed); the pool resets when the next combat ends.
//
// ⚠ THERE ARE STILL NO LOCKS IN THE WORLD. Everything else is now real: the L6 gate, the
// thieves'-tools requirement, the resource pool, the hotbar surfacing, and _attempt()'s
// Sleight of Hand roll vs the lock DC. The ONE remaining stub is _nearestLock() — give it a
// prop/container within REACH carrying `.locked` + `.lockDC` and the ability works end to end.
// An attempt is only consumed when a real lock is worked; clicking with nothing in reach is free.

import { heroRoster } from './units.js';
import { UNIT_TYPES, WORLD_UNITS_PER_SQUARE } from './constants.js';
import { combatPhase, showFloatingDamage, addLog } from './combat.js';
import { bindHotkey, updateHotkeyRanges } from './hotbar.js';
import { affixTotal } from './affixes.js';
import { isAbilityUnlocked } from './spells.js';
import { rollSleightOfHand } from './skills.js';

const REACH = 1.5 * WORLD_UNITS_PER_SQUARE;   // must be within ~1.5 squares of the lock
const UNLOCK_LEVEL   = 6;                     // Milo's first Pick Locks (user, 2026-07-20)
const TOOLS_ITEM_ID  = 'thieves_tools';       // js/items.js — issued in his starting bag
const DEFAULT_LOCK_DC = 15;                   // "a normal lock", per the user's spec

// The kit has to be CARRIED, not merely owned — so this walks the live bag contents rather
// than trusting a flag set at build. Selling or dropping the tools disables the ability,
// which is the intended consequence of making it an item at all.
function _hasTools(hero) {
  const eq = hero?.equipment;
  if (!eq) return false;
  for (let n = 1; n <= 4; n++) {
    const bag = eq[`bag-${n}`];
    if (!bag?.contents) continue;
    if (bag.contents.some(it => it?.id === TOOLS_ITEM_ID)) return true;
  }
  return false;
}

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
         isAbilityUnlocked(_selected.type, _selected.level ?? 1, 'pick_locks') &&
         _hasTools(_selected) &&
         _selected.hp > 0 && _usedCount < _maxUses();
}

function _render() {
  if (combatPhase) return;
  if (_selected?.type !== 'halfling') return;
  // Below L6 the slot stays free for whatever else Milo has bound there, rather than
  // showing a permanently-dead PICK LOCK button from level 1 (mirrors secondWindOOC).
  if ((_selected.level ?? 1) < UNLOCK_LEVEL) { updateHotkeyRanges(); return; }
  bindHotkey('KeyQ', false,
    '<span class="hb-ready">PICK<br>LOCK</span>',
    _use,
    _canUse,
    'action',
  );
  updateHotkeyRanges();
}

// Roll Sleight of Hand vs the lock's DC. Consumes an attempt whether or not it opens —
// Resource-regen on a belt is what buys a retry. Split out from _use so that when the lock
// SYSTEM lands, _nearestLock is the only thing left to write.
function _attempt(hero, lock) {
  _usedCount++;
  const dc  = lock.lockDC ?? DEFAULT_LOCK_DC;
  const res = rollSleightOfHand(hero, dc);
  const who = UNIT_TYPES.halfling?.name ?? 'Milo';

  if (res.success) {
    lock.locked = false;
    showFloatingDamage(hero, '🔓 PICKED', '#66ddbb');
    addLog(`${who} picks the lock — Sleight of Hand ${res.roll}+${res.mod} vs DC ${dc}.`, 'heal');
  } else {
    showFloatingDamage(hero, 'JAMMED', '#bbbbbb');
    addLog(`${who} fumbles the pick — Sleight of Hand ${res.roll}+${res.mod} vs DC ${dc}. ` +
           `${Math.max(0, _maxUses() - _usedCount)} attempt(s) left.`, 'move');
  }
  return res.success;
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

  _attempt(hero, lock);
  _render();
}
