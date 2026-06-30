// js/shortRest.js — short rest widget: 2 uses per level, reset on level-up

import { heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, showFloatingDamage } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';

const SR_MAX = 2;
const LS_KEY = 'dnd_sr_used';

let _used = 0;

export function initShortRest() {
  _used = Math.min(SR_MAX, parseInt(localStorage.getItem(LS_KEY) ?? '0', 10));
  _render();
  document.getElementById('srw-btn')?.addEventListener('click', _executeRest);
  window.addEventListener('combat:start',  _render);
  window.addEventListener('combat:ended',  _render);
  window.addEventListener('hero:levelup',  _onLevelup);
}

function _onLevelup() {
  _used = 0;
  localStorage.setItem(LS_KEY, '0');
  _render();
}

function _render() {
  const btn  = document.getElementById('srw-btn');
  const pip0 = document.getElementById('srw-pip-0');
  const pip1 = document.getElementById('srw-pip-1');
  if (!btn) return;

  const remaining  = SR_MAX - _used;
  btn.disabled     = combatPhase || remaining <= 0;
  btn.title        = remaining <= 0  ? 'No short rests remaining — refresh on level-up'
                   : combatPhase     ? 'Cannot rest during combat'
                   : `Heroes gain 1dHP+Con hit points and added spell slots per short rest. (${remaining} remaining)`;

  if (pip0) pip0.classList.toggle('used', _used >= 1);
  if (pip1) pip1.classList.toggle('used', _used >= 2);
}

function _executeRest() {
  if (combatPhase || _used >= SR_MAX) return;

  _used++;
  localStorage.setItem(LS_KEY, String(_used));

  for (const h of heroRoster) {
    if (h.hp <= 0) {
      // Leugren falling triggers the Dagna sequence (deferred); other dead heroes
      // revive at 1 HP — they'll spawn correctly on next zone load.
      if (h.type !== 'dwarf') h.hp = 1;
      continue;
    }
    if (h.hp >= h.maxHp) continue;

    const def    = UNIT_TYPES[h.type];
    const die    = def?.hitDie ?? 8;
    const con    = def?.abilities?.con ?? 10;
    const conMod = Math.floor((con - 10) / 2);
    const rolled = Math.ceil(Math.random() * die);
    const healed = Math.max(1, rolled + conMod);
    const prev   = h.hp;
    h.hp = Math.min(h.maxHp, h.hp + healed);
    const actual = h.hp - prev;

    if (actual > 0) showFloatingDamage(h, `+${actual}`, '#55cc55');
  }

  // Restore 2 spell slots per hero (capped at max)
  for (const h of heroRoster) {
    const maxSlots = UNIT_TYPES[h.type]?.spellSlots ?? 0;
    if (maxSlots <= 0) continue;
    h.spellSlots = Math.min(maxSlots, (h.spellSlots ?? 0) + 2);
  }

  updateHeroUI();
  _render();
}
