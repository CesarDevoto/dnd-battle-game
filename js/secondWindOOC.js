// js/secondWindOOC.js — Gobo's out-of-combat Second Wind (a martial's self-patch between fights).
//
// Mirrors healingWordOOC.js: when Gobo is the PC-selected hero out of combat, his Second Wind takes
// the KeyQ hotbar slot (his combat KeyQ ability is greyed OOC anyway; combat.js re-seeds it the moment
// a fight starts). One self-heal between combats, PLUS belt Resource-regen extra uses; the pool
// resets when the next combat ends. Unlocks at level 6. No targeting — Gobo heals himself.

import { heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, showFloatingDamage, addLog } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';
import { bindHotkey, updateHotkeyRanges } from './hotbar.js';
import { ABILITY_META } from './abilityRegistry.js';
import { applyHeal, affixTotal } from './affixes.js';

// Level 7 (user, 2026-07-20 — was 6, moved up one to make room for Reckless Attack at 6).
// Also declared in LEVEL_SPELLS.human so the level-up modal and isAbilityUnlocked agree;
// keep the two in step if this ever moves again.
const UNLOCK_LEVEL = 7;

let _usedCount = 0;       // Second Winds spent since the last combat ended
let _selected  = null;    // currently PC-selected hero
let _initDone  = false;

// Base 1 use + belt Resource-regen (extra OUT-OF-COMBAT uses), read LIVE off Gobo's gear so equipping
// a belt between fights raises the cap immediately; consumed uses persist until the next combat resets.
function _maxUses() {
  const gobo = _selected?.type === 'human' ? _selected : heroRoster.find(h => h.type === 'human');
  return 1 + (gobo ? affixTotal(gobo, 'resource_regen') : 0);
}

export function initSecondWindOOC() {
  if (_initDone) return; _initDone = true;
  window.addEventListener('pc-hero:selected',   e => { _selected = e.detail?.hero ?? null; _render(); });
  window.addEventListener('pc-hero:deselected', () => { _selected = null; _render(); });
  window.addEventListener('combat:start',       () => _render());
  window.addEventListener('combat:ended',       () => { _usedCount = 0; _render(); });
}

function _canUse() {
  return !combatPhase && !!_selected && _selected.type === 'human' &&
         (_selected.level ?? 1) >= UNLOCK_LEVEL && _selected.hp > 0 &&
         _selected.hp < _selected.maxHp && _usedCount < _maxUses();
}

function _render() {
  // combat.js owns KeyQ during actual turns; only manage it out of combat, and only for Gobo.
  if (combatPhase) return;
  if (_selected?.type !== 'human') return;
  if ((_selected.level ?? 1) < UNLOCK_LEVEL) { updateHotkeyRanges(); return; }
  bindHotkey('KeyQ', false,
    `<img class="hb-spell-img-fill" src="${ABILITY_META.second_wind.imgSrc}" alt="Second Wind">`,
    _use,
    _canUse,
    'action',
  );
  updateHotkeyRanges();
}

function _use() {
  const hero = _selected;
  if (!_canUse() || !hero) { _render(); return; }
  _usedCount++;

  const healed = Math.max(1, Math.ceil(Math.random() * 8) + 2);   // 1d8+2
  const actual = applyHeal(hero, healed, { caster: hero });

  showFloatingDamage(hero, `+${actual}`, '#ffcc44');
  addLog(`${UNIT_TYPES.human?.name ?? 'Gobo'} uses Second Wind, recovering ${actual} HP`, 'heal');
  updateHeroUI();
  _render();
}
