// js/affixes.js — rolled item affixes. See docs/loot-affix-design.md.
//
// An item's numbers are DERIVED from (slot, affix, rarity) — never written per item. A drop
// is a base (name/icon/slot/material) + a rolled rarity + affixes rolled from that slot's
// table below. "Cloth Hood" is ONE base; a green one and a purple one are the same base with
// different rolls. That's why 360 bases need no per-rarity duplicates.
//
// Imports dice.js only (itself a leaf), so this module stays node-testable.

import { roll, parseDiceFormula } from './dice.js';
import { UNIT_TYPES } from './constants.js';

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
  wrist: {
    hit_pct: {
      label: 'Hit chance',
      fmt:   v => `+${v}% hit chance`,
      // ⚠ WRIST IS A PAIR — wrist-l and wrist-r draw from the same pool and affixTotal sums
      // BOTH, so every number here lands TWICE. A red wrist is +7-12%, but a red PAIR is
      // +14-24%, taking a baseline 55% swing to ~79%. Price the pair, not the item.
      //
      // Ceiling matters: rollToHit clamps 5-95, so a ladder much above this wastes rolls at
      // the top (a "punchy" option peaked at a +40% pair, which caps outright).
      // Scale check: +1 attack bonus = +5% hit, so a red pair is worth ~4 attack bonus.
      //
      // ⚠ Green CAN roll 1%, which equals precisionHitBonusForLevel — an entire L4 class
      // passive — off the cheapest tier. Known and accepted (gear should eventually outdo a
      // low-level passive); the fix, if wanted, is to scale Precision when Rage's flat 10%
      // gets its level curve, since they're the same kind of frozen class number.
      dice:  { green: '1d2', blue: '1d3+1', purple: '1d4+2', orange: '1d6+3', red: '1d6+6' },
    },
    // The doc calls this bundle "STR/DEX", but they're TWO keys, not one: a single str_dex
    // affix couldn't say WHICH stat it granted, and the answer matters — dex on Gobo (a STR
    // attacker) is a dud. Split, `affixTotal(u, 'str')` reads directly, and the count row
    // makes a wrist roll exactly one of hit_pct | str | dex.
    //
    // ⚠ EVEN ONLY (user's call). Modifiers are floor((score-10)/2) and the heroes' relevant
    // scores are mostly EVEN (Gobo STR 16 / DEX 14, Milo DEX 16, Rasec DEX 14, Leugren
    // STR 14), so an ODD bonus is INVISIBLE: 16 -> 17 is still a +3 modifier. `mult` doubles
    // the roll so every point granted actually moves a modifier.
    //
    // Purple+ chase per the doc: an ability score pumps hit AND damage (and DEX also AC and
    // saves), so it's a multiplier, not a linear boost.
    //
    // They do NOT stack with hit_pct — see AFFIX_COUNT.wrist, which is 1 for this slot. That's
    // load-bearing: wrist is a PAIR so everything doubles, hit_pct's red pair already reaches
    // +14-24% against rollToHit's 95 clamp, and even-only STR/DEX has a FLOOR of +4/pair =
    // +2 mod = +10% hit. Both together would put a red pair at +34-54% — rolls thrown away
    // above the ceiling. One stat per wrist keeps every tier under the clamp and makes the
    // pair a decision.
    str: {
      label: 'Strength',
      fmt:   v => `+${v} Strength`,
      mult:  2,
      dice:  { purple: '1d1', orange: '1d2', red: '1d2+1' },   // x2 -> +2 | +2/+4 | +4/+6
    },
    dex: {
      label: 'Dexterity',
      fmt:   v => `+${v} Dexterity`,
      mult:  2,
      dice:  { purple: '1d1', orange: '1d2', red: '1d2+1' },
    },
  },
  // The remaining 13 slots are UNBUILT ON PURPOSE. Which stat each owns is already locked in
  // the doc's allocation table, but dice-per-tier are real design decisions and the rule is
  // one slot at a time. An item in a slot with no table here simply rolls no affixes.
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
  head:  { grey: [0, 1], green: [1, 1], blue: [1, 2], purple: [2, 2], orange: [2, 2], red: [2, 2] },
  // Wrist stays at 1 even though it owns TWO stats from purple up — deliberately, not because
  // it's thin. STR/DEX must not stack with hit_pct on the same wrist: the slot is a PAIR so
  // both double, hit_pct's red pair already reaches +14-24% against rollToHit's 95 clamp, and
  // even-only STR/DEX has a floor of +10% hit per pair. Both together = +34-54% on a red pair,
  // i.e. rolls thrown away above the ceiling. One stat per wrist keeps every tier under the
  // clamp AND makes the pair a decision (two hit%, two STR/DEX, or one of each).
  wrist: { grey: [0, 1], green: [1, 1], blue: [1, 1], purple: [1, 1], orange: [1, 1], red: [1, 1] },
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
    // `mult` scales the roll AFTER the dice — it exists because parseDiceFormula only speaks
    // NdS±M, which cannot express "even numbers only" (2d2 is 2,3,4). STR/DEX needs that:
    // an odd score bump is invisible against an even base score.
    const value = f ? roll(f).total * (a.mult ?? 1) : 0;
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

// A unit's ability SCORE including gear, and the modifier that falls out of it.
//
// UNIT_TYPES.abilities is a STATIC base — the str/dex affixes add to it. Everything that
// wants an ability must come through here, or gear silently won't apply: the raw pattern
// `Math.floor(((UNIT_TYPES[u.type].abilities.dex ?? 10) - 10) / 2)` appears ~28 times in
// combat.js alone, and each one is a place a +2 DEX wrist would be ignored.
//
// Takes the UNIT, not a def: a def has no equipment, so it cannot know about gear. That's
// why the old inline reads can't just be patched in place — several only hold the def.
export function abilityScoreOf(unit, stat) {
  const base = UNIT_TYPES[unit?.type]?.abilities?.[stat] ?? 10;
  return base + affixTotal(unit, stat);
}
export function abilityModOf(unit, stat) {
  return Math.floor((abilityScoreOf(unit, stat) - 10) / 2);
}
