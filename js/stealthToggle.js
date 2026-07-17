// js/stealthToggle.js — the MOVE widget's Stealth button (out of combat).
//
// Sets per-hero `hero.sneaking`, which drives two things: the surprise/ambush contest at combat
// start (combat.js _determineSurprise) and a 66% out-of-combat walk speed (precombat.js). The set
// of heroes flagged follows the current MOVE mode, per the user's rule:
//   • Group move → all four heroes sneak.
//   • Solo move  → only the currently selected/active hero sneaks.
// One button, toggling: press once to start sneaking, again to stop.
import { units, setUnitSneaking } from './units.js';
import { combatPhase, showCenterAlert, addLog, unitLabel } from './combat.js';
import { isGroupMove } from './groupMove.js';
import { selectedUnit } from './army.js';

// Start a hero sneaking: apply the ghostly look. No roll stored — the detection-shrink reads their
// live stealth strength (heroStealthPct) and the surprise contest rolls a fresh d100 spot check.
function _startSneak(h) { setUnitSneaking(h, true); }

const _heroes = () => units.filter(u => u.team === 'blue' && u.hp > 0);
export function anyHeroSneaking() { return _heroes().some(h => h.sneaking); }

export function updateStealthBtnUI() {
  document.getElementById('gm-stealth-btn')?.classList.toggle('active', anyHeroSneaking());
}

function _toggle() {
  if (combatPhase) return;   // stealth is set up BEFORE the fight
  const heroes = _heroes();
  if (!heroes.length) return;

  if (anyHeroSneaking()) {
    heroes.forEach(h => setUnitSneaking(h, false));
    showCenterAlert('Not sneaking', '#888888');
    addLog('The party stops sneaking.', 'move');
  } else if (isGroupMove()) {
    heroes.forEach(_startSneak);
    showCenterAlert('Sneaking…', '#88cc66');
    addLog('The whole party moves stealthily (66% speed) — trying to get the drop on the enemy.', 'move');
  } else {
    // Solo move: only the active hero sneaks ahead. `selectedUnit` is a live binding from army.js.
    const h = selectedUnit;
    if (!h || h.team !== 'blue' || h.hp <= 0) return;
    _startSneak(h);
    showCenterAlert('Sneaking…', '#88cc66');
    addLog(`${unitLabel(h)} sneaks ahead (66% speed).`, 'move');
  }
  updateStealthBtnUI();
}

export function initStealthToggle() {
  document.getElementById('gm-stealth-btn')?.addEventListener('click', _toggle);
  // Leaving combat clears any lingering sneak state so the button doesn't read "active" post-fight.
  window.addEventListener('combat:ended', () => { _heroes().forEach(h => setUnitSneaking(h, false)); updateStealthBtnUI(); });
  updateStealthBtnUI();
}
