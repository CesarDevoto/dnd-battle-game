// js/combatSpeed.js — ONE dial for how fast combat plays out.
//
// Automated mode has nobody reading each beat, so it runs the same choreography at a higher
// rate: animations play faster, walking is quicker, and every fixed "let the player see it"
// pause shrinks by the same factor. Manual mode is untouched at 1.0 — a human IS reading those
// beats, and the pauses are what make a turn legible.
//
// A LEAF module on purpose. The factor has to be readable from units.js (animation timeScale)
// AND combat.js (movement + turn-flow delays), but combatAutomation.js — which owns the mode —
// already imports units.js, so units.js importing IT back would close a cycle. Nothing is
// imported here, so anyone can read the dial.
//
// Tuning: 1.0 is real time. Raising AUTO_COMBAT_SPEED speeds the whole automated turn
// proportionally, so animation, movement and pauses stay in the ratio they were authored in —
// which is the point. Trimming individual timeouts by hand is how they drift out of sync with
// the animations they were meant to cover.
export const AUTO_COMBAT_SPEED = 2.2;

let _factor = 1;

export function setCombatSpeedFactor(f) {
  _factor = (Number.isFinite(f) && f > 0) ? f : 1;
}

export function combatSpeed() { return _factor; }

// Scale a human-authored delay by the current factor. Every fixed turn-flow pause goes through
// this so there is one place to reason about pacing. Floors at 1ms: a 0ms setTimeout still
// yields to the event loop, but returning 0 from a "wait" reads as a bug at the call site.
export function spd(ms) { return Math.max(1, Math.round(ms / _factor)); }
