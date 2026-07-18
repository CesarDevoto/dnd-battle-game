// js/shortRest.js — short rest widget: one rest available between combats,
// refreshed after every battle.

import { heroRoster, reviveUnit, corpses, units } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { restoreSpellSlots } from './spells.js';
import { combatPhase, showFloatingDamage } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';
import { applyHeal } from './affixes.js';

const SR_MAX = 1;
const LS_KEY = 'dnd_sr_used';

// One-time tutorial: the first time a hero ever dies, an arrow bounces over the REST
// widget to teach the player that this is how you get them back on their feet.
const LS_TUT_KEY = 'dnd_sr_tutorial_seen';

let _used = 0;

let _tutArrowEl  = null;
let _tutArmed    = false;   // a hero died this fight and the tutorial hasn't been shown yet

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

  window.addEventListener('hero:died',    _onHeroDied);
  window.addEventListener('combat:ended', _maybeShowTutorial);
}

// ── First-death tutorial arrow ────────────────────────────────────────────────

function _tutorialSeen() {
  try { return !!localStorage.getItem(LS_TUT_KEY); } catch { return false; }
}

function _onHeroDied() {
  if (_tutorialSeen()) return;
  _tutArmed = true;   // shown at combat's end, not now — REST is disabled mid-fight
}

// Fires on combat:ended. Deliberately NOT shown the instant a hero drops: the REST button
// is disabled during combat, so an arrow pointing at a dead control would just be noise.
//
// Note a total party kill does NOT reach here — endBattle() skips the combat:ended event and
// hands off to Dagna, whose River Styx run is what revives a wiped party. The short rest is
// the answer to SOME heroes down, not all of them, and the tutorial correctly stays silent
// on a wipe.
function _maybeShowTutorial() {
  if (!_tutArmed || _tutorialSeen()) return;
  _tutArmed = false;
  // Healed back up before the fight ended (Leugren's Healing Word, say) — no lesson needed
  // right now, and no flag burned: the next hero who actually stays down still gets it.
  if (!heroRoster.some(h => h.hp <= 0)) return;
  _showTutArrow();
}

function _showTutArrow() {
  if (_tutArrowEl) return;
  const widget = document.getElementById('sr-widget');
  if (!widget) return;
  _tutArrowEl = document.createElement('div');
  _tutArrowEl.id = 'srw-tutorial';
  _tutArrowEl.innerHTML =
    `<div class="srw-tut-label">A hero has fallen —<br>rest to raise them</div>` +
    `<div class="srw-tut-arrow">▼</div>`;
  widget.appendChild(_tutArrowEl);
}

function _hideTutArrow() {
  _tutArrowEl?.remove();
  _tutArrowEl = null;
}

// The lesson is only "learned" once the player actually rests with it on screen — dismissing
// it any other way (a new fight, a zone change) would burn the flag without teaching anything,
// so the arrow simply comes back next time.
function _markTutorialSeen() {
  try { localStorage.setItem(LS_TUT_KEY, '1'); } catch {}
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
    // ⚠ "Down" is CORPSE STATE, not hp <= 0. Those two can disagree, and when they did it
    // stranded a hero permanently: levelling up while dead used to add HP to a corpse (fixed
    // in progression.js 2026-07-18), leaving Gobo on 2 HP, still dead, and invisible to an
    // `hp <= 0` test — REST just skipped him every time.
    //
    // corpses[] is what reviveUnit actually reverses, so testing it is testing the real state.
    // The units[] check catches a hero downed by any future path that forgets the corpse list.
    // Keeping this broader than the cause also RECOVERS saves already stuck that way.
    if (h.hp <= 0 || corpses.includes(h) || !units.includes(h)) {
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
    const actual = applyHeal(h, healed);   // rest heal: received-only, no caster

    if (actual > 0) showFloatingDamage(h, `+${actual}`, '#55cc55');
  }

  // Restore 2 spell slots per hero, LOWEST spell level first.
  //
  // This was dead code until 2026-07-16: it capped on `UNIT_TYPES[h.type].spellSlots`,
  // but that field only exists on morvath (the boss). For elf/dwarf it read undefined
  // → 0 → `continue`, so the short rest never restored a single slot despite saying so.
  // restoreSpellSlots reads the hero's own per-level max, and no-ops for non-casters.
  for (const h of heroRoster) restoreSpellSlots(h, 2);

  if (_tutArrowEl) { _markTutorialSeen(); _hideTutArrow(); }

  updateHeroUI();
  _render();

  // The party is on its feet again — release any dialogue that was banked because a hero was
  // lying dead (see the gate in dagnaEvent.js). Fired AFTER the revives above, so the gate
  // re-checks against live heroes.
  window.dispatchEvent(new CustomEvent('shortrest:taken'));
}
