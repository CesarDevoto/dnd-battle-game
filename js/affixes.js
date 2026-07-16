// js/affixes.js — rolled item affixes. See docs/loot-affix-design.md.
//
// An item's numbers are DERIVED from (slot, affix, rarity) — never written per item. A drop
// is a base (name/icon/slot/material) + a rolled rarity + affixes rolled from that slot's
// table below. "Cloth Hood" is ONE base; a green one and a purple one are the same base with
// different rolls. That's why 360 bases need no per-rarity duplicates.
//
// Imports dice.js only (itself a leaf), so this module stays node-testable.

import { roll, parseDiceFormula } from './dice.js';

// ── Slot tables ───────────────────────────────────────────────────────────────
// One entry per stat the slot OWNS (the allocation is locked in the design doc: each stat
// appears on exactly one slot type). `dice` is keyed by rarity, and a tier with NO entry
// means the stat can't roll there — that's the doc's ⛔ gating expressed as absence rather
// than as a separate rule.
//
// `key` is what the engine consumes (see affixTotal). Adding a slot here is DATA, not code.
export const SLOT_AFFIXES = {
  head: {
    mitigation_pct: {
      label: 'Damage mitigation',
      fmt:   v => `+${v}% damage mitigation`,
      // Anchored to Rage (10%, temporary, twice a day). Overshoots it from orange up — a
      // deliberate call, recorded in the doc. 2d6+4 / 3d6+6 are BELL curves, so a typical
      // red is ~16%, not its 24% max.
      dice:  { green: '1d2', blue: '1d4+1', purple: '1d6+2', orange: '2d6+4', red: '3d6+6' },
    },
    spell_damage_pct: {
      label: 'Spell damage',
      fmt:   v => `+${v}% spell damage`,
      // Steep because it's a PERCENTAGE of a small number: Fire Bolt is 1d10 (avg 5.5), so
      // even +30% is ~+1.7. Gated to blue+ (user's call), which is what keeps green a clean
      // one-stat tier rather than a lottery.
      dice:  { blue: '1d4+2', purple: '1d6+6', orange: '1d8+12', red: '1d10+20' },
    },
    // NOT YET: spell slots (blue+, band-scoped 1d2 @ lv1-3 / lv4-6 / lv7-9). It's designed,
    // but the slot totals are pending a lowering pass and the affix would need to write
    // spellSlotsMaxByLevel — retune it together with that pass, not before.
  },
  // Slots 2-15 are UNBUILT ON PURPOSE. Which stat each owns is already locked in the doc's
  // allocation table, but the dice-per-tier are real design decisions and the rule is one
  // slot at a time. An item in a slot with no table here simply rolls no affixes.
  // Suggested next: wrist — it forces the calibration where precisionHitBonusForLevel (+1%
  // hit) is a whole L4 class passive, yet the old catalog handed +1% hit to its weakest
  // green item.
};

// ── Affix count ───────────────────────────────────────────────────────────────
// How many of a slot's stats land on one item, per tier: [min, max]. The second variety
// axis — two blue hats differ in WHICH stats they carry, not just the numbers.
//
// ⚠ It can never exceed the stats a slot actually owns. Head implements 2 today, so it
// saturates at 2 from blue on; orange/red separate by BIGGER numbers, not more of them.
// Thin slots (Chest = AC% only, Legs = Max HP only) will have no count axis at all: always 1.
// Don't paste a generic 2-3/3-4 ladder into a slot without the stats to fill it.
export const AFFIX_COUNT = {
  head: { grey: [0, 1], green: [1, 1], blue: [1, 2], purple: [2, 2], orange: [2, 2], red: [2, 2] },
};

// Fisher-Yates on a copy — picks are WITHOUT replacement, so one item can't roll the same
// stat twice (which would read as "+2% mitigation, +3% mitigation" on one hat).
function _shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Roll the affixes for one dropped item. Returns [] for a slot with no table yet, a rarity
// that gates everything out, or a count roll of 0 — all legitimate, all meaning "plain base".
export function rollAffixes(base, rarity) {
  const table = SLOT_AFFIXES[base?.slot];
  if (!table || !rarity) return [];

  // Eligible = has dice AT THIS TIER. A stat gated above this rarity simply isn't here.
  const eligible = Object.entries(table).filter(([, a]) => a.dice?.[rarity]);
  if (!eligible.length) return [];

  const [lo, hi] = AFFIX_COUNT[base.slot]?.[rarity] ?? [0, 0];
  const want = Math.min(eligible.length, lo + Math.floor(Math.random() * (hi - lo + 1)));
  if (want <= 0) return [];

  return _shuffled(eligible).slice(0, want).map(([key, a]) => {
    const f     = parseDiceFormula(a.dice[rarity]);
    const value = f ? roll(f).total : 0;
    return { key, label: a.label, value, display: a.fmt(value) };
  });
}

// ── Consumption ───────────────────────────────────────────────────────────────
// Sum one affix across everything a hero has EQUIPPED. This is the single primitive every
// consumer uses — combat asks `affixTotal(u, 'mitigation_pct')` and doesn't care which slot
// it came from, so wiring a new affix is one call at the place its stat is applied.
//
// Bag contents are deliberately ignored: carrying a hat is not wearing it.
export function affixTotal(hero, key) {
  const eq = hero?.equipment;
  if (!eq) return 0;
  let total = 0;
  for (const slotKey of Object.keys(eq)) {
    for (const a of eq[slotKey]?.affixes ?? []) {
      if (a.key === key) total += a.value;
    }
  }
  return total;
}
