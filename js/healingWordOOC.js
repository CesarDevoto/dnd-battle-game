// js/healingWordOOC.js — Leugren's out-of-combat Healing Word: one free use
// between combats, resets the moment a new combat ends.

import { heroRoster, units } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, showFloatingDamage, addLog } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';

let _used = false;

export function initHealingWordOOC() {
  document.getElementById('hw-btn')?.addEventListener('click', _executeHeal);
  window.addEventListener('combat:start', _render);
  window.addEventListener('combat:ended', () => { _used = false; _render(); });
  _render();
}

function _leugren()      { return heroRoster.find(h => h.type === 'dwarf' && h.hp > 0) ?? null; }
function _mostWounded()  {
  return units
    .filter(u => u.team === 'blue' && u.hp > 0 && u.hp < u.maxHp)
    .reduce((best, u) => (!best || u.hp < best.hp) ? u : best, null);
}

function _render() {
  const btn = document.getElementById('hw-btn');
  if (!btn) return;
  const leugren = _leugren();
  const target  = _mostWounded();
  const canUse  = !combatPhase && !_used && !!leugren && !!target;

  btn.disabled = !canUse;
  btn.title    = combatPhase   ? 'Cannot use during combat'
               : _used         ? 'Already used — resets after your next combat'
               : !leugren      ? 'Leugren must be alive to cast this'
               : !target       ? 'No wounded ally to heal'
               :                 'Leugren casts Healing Word on the most wounded ally (once between combats)';

  document.getElementById('hw-pip-0')?.classList.toggle('used', _used);
}

function _executeHeal() {
  if (combatPhase || _used) return;
  const leugren = _leugren();
  const target  = _mostWounded();
  if (!leugren || !target) return;

  _used = true;

  const wisMod = Math.floor(((UNIT_TYPES.dwarf?.abilities?.wis ?? 10) - 10) / 2);
  const healed = Math.max(1, Math.ceil(Math.random() * 8) + wisMod);
  const prev   = target.hp;
  target.hp    = Math.min(target.maxHp, target.hp + healed);
  const actual = target.hp - prev;

  showFloatingDamage(target, `+${actual}`, '#55cc55');
  addLog(`${UNIT_TYPES.dwarf.name} casts Healing Word on ${UNIT_TYPES[target.type]?.name ?? target.type}, restoring ${actual} HP`, 'heal');

  updateHeroUI();
  _render();
}
