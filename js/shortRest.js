// js/shortRest.js — short rest widget: one rest available between combats,
// refreshed after every battle.

import { heroRoster, reviveUnit } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, showFloatingDamage } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';

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

  if (_tutArrowEl) { _markTutorialSeen(); _hideTutArrow(); }

  updateHeroUI();
  _render();

  // The party is on its feet again — release any dialogue that was banked because a hero was
  // lying dead (see the gate in dagnaEvent.js). Fired AFTER the revives above, so the gate
  // re-checks against live heroes.
  window.dispatchEvent(new CustomEvent('shortrest:taken'));
}
