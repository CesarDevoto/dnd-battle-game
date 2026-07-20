// js/skills.js — hero SKILL checks (as opposed to abilities, which are activated).
//
// There is no general skill system in this game and this file is not an attempt to build one.
// It exists because Sleight of Hand (Milo, L5) is a proficiency, not a button: nothing to put
// on the hotbar, no action to spend — it is the roll something ELSE asks for. Today the only
// caller is Pick Locks (L6). Keep it that narrow until a second caller actually exists.
//
// Rolls use the same d100 ladder as rollSave/rollToHit in combat.js rather than a raw d20, so
// a "DC 15" here means what it means everywhere else in this codebase. See the note on
// Burning Hands in combat.js for what happens when one check quietly uses a different scale.

import { proficiencyBonusFor } from './constants.js';
import { abilityModOf } from './affixes.js';
import { isAbilityUnlocked } from './spells.js';

// Milo alone has Sleight of Hand, and only from level 5.
export function hasSleightOfHand(hero) {
  return !!hero && hero.type === 'halfling' &&
         isAbilityUnlocked(hero.type, hero.level ?? 1, 'sleight_of_hand');
}

// DEX modifier, plus proficiency ONLY when the hero is trained in the skill. `withTools`
// is the thieves'-tools clause from the Pick Locks rules: proficiency applies to a lock
// only while the kit is actually carried, so an untooled Milo still rolls — just worse.
export function sleightOfHandMod(hero, { withTools = true } = {}) {
  if (!hero) return 0;
  const dex = abilityModOf(hero, 'dex');
  const trained = hasSleightOfHand(hero) && withTools;
  return dex + (trained ? proficiencyBonusFor(hero.level ?? 1) : 0);
}

// Roll a Sleight of Hand check against `dc`. Mirrors rollSave's d100 shape and clamp so the
// result reads the same way in the log as every other roll the player sees.
// Returns { roll, mod, total, dc, success, chance }.
export function rollSleightOfHand(hero, dc, opts = {}) {
  const mod    = sleightOfHandMod(hero, opts);
  const chance = Math.max(5, Math.min(95, ((mod + 20 - dc) / 20) * 100));
  const r      = Math.floor(Math.random() * 100) + 1;
  return {
    roll: r, mod, dc, chance,
    total: r + mod,
    success: r >= 100 - chance,
  };
}
