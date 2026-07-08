// js/shortRest.js — short rest widget: one rest available between combats,
// refreshed after every battle.

import { heroRoster, reviveUnit } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, showFloatingDamage } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';

const SR_MAX = 1;
const LS_KEY = 'dnd_sr_used';

let _used = 0;

export function initShortRest() {
  _used = Math.min(SR_MAX, parseInt(localStorage.getItem(LS_KEY) ?? '0', 10));
  // Only one rest now — hide the second pip if it's in the markup.
  const pip1 = document.getElementById('srw-pip-1');
  if (pip1) pip1.style.display = 'none';
  _render();
  document.getElementById('srw-btn')?.addEventListener('click', _executeRest);
  window.addEventListener('combat:start',  _render);
  // A fresh short rest becomes available after every combat.
  window.addEventListener('combat:ended',  _refresh);
}

function _refresh() {
  _used = 0;
  localStorage.setItem(LS_KEY, '0');
  _render();
}

function _render() {
  const btn  = document.getElementById('srw-btn');
  const pip0 = document.getElementById('srw-pip-0');
  if (!btn) return;

  const available = _used < SR_MAX;
  btn.disabled    = combatPhase || !available;
  btn.title       = 'One short rest between combats. ' + (
                      combatPhase   ? 'Cannot rest during combat'
                    : !available    ? 'Already rested — a new one is available after the next combat'
                    : 'Revives fallen heroes, heals 1dHP+Con, and restores spell slots.'
                    );

  if (pip0) pip0.classList.toggle('used', _used >= 1);
}

function _executeRest() {
  if (combatPhase || _used >= SR_MAX) return;

  _used++;
  localStorage.setItem(LS_KEY, String(_used));

  for (const h of heroRoster) {
    if (h.hp <= 0) {
      // Any dead hero revives at 1 HP on a short rest — pulled out of their
      // corpse pose and back into the live unit list so they show up correctly
      // without a zone reload. (The one-shot Dagna sequence that fires on the
      // first-ever hero death handles its own full-party revive, so there's no
      // need to special-case Leugren here — doing so left him stranded dead.)
      h.hp = 1;
      reviveUnit(h);
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
