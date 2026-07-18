// js/affixes.js — rolled item affixes. See docs/loot-affix-design.md.
//
// An item's numbers are DERIVED from (slot, affix, rarity) — never written per item. A drop
// is a base (name/icon/slot/material) + a rolled rarity + affixes rolled from that slot's
// table below. "Cloth Hood" is ONE base; a green one and a purple one are the same base with
// different rolls. That's why 360 bases need no per-rarity duplicates.
//
// Imports dice.js only (itself a leaf), so this module stays node-testable.

import { roll, parseDiceFormula } from './dice.js';
import { UNIT_TYPES, GRID_SQUARE_FEET } from './constants.js';

// ── Shared rider ladders ──────────────────────────────────────────────────────
// The four Neck damage riders (fire/ice/poison/disease) all share ONE damage ladder and
// ONE save-DC ladder — they differ only in damage type and which save resists them. The
// dice ladder is the user's spec (green 1d2, blue 1d3+1, "and so on"), which is the same
// curve wrist's hit% climbs; DC rises one step per tier so higher-tier riders land full
// damage more often. Unlike the numeric affixes, a rider stores its FORMULA and rerolls
// per hit in combat (like weapon dice) rather than pre-rolling one permanent value.
const RIDER_DICE = { green: '1d2', blue: '1d3+1', purple: '1d4+2', orange: '1d6+3', red: '1d6+6' };
const RIDER_DC   = { green: 12,    blue: 13,      purple: 14,       orange: 15,      red: 16 };

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
  chest: {
    // ⚠ NOT flat AC. This is a percentage-point REDUCTION of the attacker's hit chance — the
    // defensive mirror of wrist's hit_pct, subtracted from the same rollToHit channel. Flat AC
    // is a different thing that chest armour ALREADY provides via computeAC's chest.ac, and
    // this stacks on top of it rather than replacing it.
    //
    // The ladder looks small next to head's mitigation and isn't: -10% against a 55% attacker
    // means 45%, i.e. 18% FEWER HITS, so a point of ac_pct is worth ~1.8 points of mitigation
    // at baseline — and MORE as enemy hit drops, since it's a proportion of a shrinking number.
    // A red chest (2d6+8, a BELL curve, so typically ~15%) alongside a red hat lands around a
    // third less damage taken; that pairing is what the top of this ladder was priced against.
    //
    // ⚠ ATTACK ROLLS ONLY. Save-based AoE and poison never touch rollToHit, so this does
    // nothing against them — exactly like real AC vs a fireball. That asymmetry with
    // mitigation_pct (which covers every damage path) is deliberate and is what keeps the
    // bigger-looking numbers here from outclassing the hat.
    ac_pct: {
      label: 'Armor',
      fmt:   v => `+${v}% armor (attackers' hit chance -${v}%)`,
      dice:  { green: '1d3', blue: '1d4+2', purple: '1d6+4', orange: '1d6+7', red: '2d6+8' },
    },
    // NOT YET: [prof] (Grants proficiency) — blocked on there being no equipment proficiency
    // gating in the code at all, same as head's. Until that exists, chest is a THIN slot: one
    // stat, so no count axis (see AFFIX_COUNT.chest).
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
  neck: {
    // On-hit DAMAGE RIDERS (the doc's "weakest — flat damage riders", concretised into four
    // elements). Each is `rider: true`, so rollAffixes stamps the tier's dice FORMULA + save +
    // DC + type onto the instance and combat rerolls the dice every hit — half damage on a
    // successful save (user's rule). They're `signatureOnly`: they never roll on a generic
    // Necklace, only on their own named amulet (which forces its element via `signatureAffix`),
    // so a plain neck drop can't randomly sprout one. Save stat is the elemental counterplay —
    // fire is dodged (DEX), the rest are endured (CON).
    rider_fire: {
      label: 'Fire rider', rider: true, signatureOnly: true,
      noun: 'fire', damageType: 'fire', saveStat: 'dex', halfOnSave: true,
      dice: RIDER_DICE, dc: RIDER_DC,
    },
    rider_ice: {
      label: 'Ice rider', rider: true, signatureOnly: true,
      noun: 'cold', damageType: 'cold', saveStat: 'con', halfOnSave: true,
      dice: RIDER_DICE, dc: RIDER_DC,
    },
    rider_poison: {
      label: 'Poison rider', rider: true, signatureOnly: true,
      noun: 'poison', damageType: 'poison', saveStat: 'con', halfOnSave: true,
      dice: RIDER_DICE, dc: RIDER_DC,
    },
    rider_disease: {
      label: 'Disease rider', rider: true, signatureOnly: true,
      noun: 'disease', damageType: 'disease', saveStat: 'con', halfOnSave: true,
      dice: RIDER_DICE, dc: RIDER_DC,
    },
    // Healing power, split into TWO affixes (user's call) that share ONE ladder: healing_received
    // reads on whoever is HEALED and lifts heals from every source; healing_done reads on the
    // CASTER and lifts the heals they cast. Both are normal (not signatureOnly) so a plain necklace
    // rolls 1-2 of them (see AFFIX_COUNT.neck); the rider amulets force their rider and skip these.
    // They stack ADDITIVELY inside applyHeal (sum the fractions, one multiply) — same rule as
    // mitigation. Ladder mirrors chest's AC% curve; retune freely.
    healing_received_pct: {
      label: 'Healing received',
      fmt:   v => `+${v}% healing received`,
      dice:  { green: '1d3', blue: '1d4+2', purple: '1d6+4', orange: '1d6+7', red: '2d6+8' },
    },
    healing_done_pct: {
      label: 'Healing power',
      fmt:   v => `+${v}% healing done`,
      dice:  { green: '1d3', blue: '1d4+2', purple: '1d6+4', orange: '1d6+7', red: '2d6+8' },
    },
  },
  cloak: {
    // Saving throws — a percentage-point bonus to ALL saves, added to rollSave's chance channel
    // (the defensive mirror of hit_pct). Ladder MIRRORS head's damage-mitigation numbers exactly
    // (user's call). Situational today: only the spider zone + Morvath force hero saves.
    saving_throw_pct: {
      label: 'Saving throws',
      fmt:   v => `+${v}% to all saving throws`,
      dice:  { green: '1d2', blue: '1d4+1', purple: '1d6+2', orange: '2d6+4', red: '3d6+6' },
    },
    // Stealth + Perception are percentage-point bonuses on the d100 spot engine (spotChance in
    // combat.js — same math as hit%/ac%): stealth% LOWERS an enemy's chance to notice the hero,
    // perception% RAISES the party's chance to notice a sneaker. Both SHARE the saving-throw /
    // damage-mitigation ladder (user's call). Wired: stealth feeds the hide/sneak checks + detection
    // shrink; perception feeds the surprise/ambush contest.
    stealth_pct: {
      label: 'Stealth',
      fmt:   v => `+${v}% Stealth`,
      dice:  { green: '1d2', blue: '1d4+1', purple: '1d6+2', orange: '2d6+4', red: '3d6+6' },
    },
    perception_pct: {
      label: 'Perception',
      fmt:   v => `+${v}% Perception`,
      dice:  { green: '1d2', blue: '1d4+1', purple: '1d6+2', orange: '2d6+4', red: '3d6+6' },
    },
  },
  legs: {
    // Max HP — a FLAT hit-point bonus (the doc's Legs stat). Unlike the % affixes it isn't summed
    // at a read site: maxHp is a stored field read raw in ~28 places with no accessor, so instead
    // equipment.js's syncGearHp BAKES this total into hero.maxHp on equip/unequip (heroes persist,
    // so it carries across zones). Flat HP scales down over levels — a chase stat early, minor late.
    max_hp: {
      label: 'Max HP',
      fmt:   v => `+${v} max HP`,
      // Beefy top end with high FLOORS (user's call) — big flat mods keep the minimums strong so a
      // top-tier drop is never a dud: orange 17–32, red 25–40.
      dice:  { green: '1d4+2', blue: '1d6+4', purple: '2d6+10', orange: '3d6+14', red: '3d6+22' },
    },
  },
  feet: {
    // Boots = movement (the doc's Feet identity). Movement is a flat ft/turn bonus folded into the
    // gear-aware speedOf() accessor; Initiative is a flat bonus to the d20 initiative roll (turn
    // order — a sort, the one remaining d20 that isn't a % contest). Two stats, so count reaches 2.
    // Movement rolls in SQUARES, not feet — a grid game only benefits from WHOLE squares (a stray
    // +2 ft that doesn't buy a 5-ft tile is dead value). speedOf multiplies this by GRID_SQUARE_FEET,
    // and base speeds are all multiples of 5, so every point lands on a clean tile boundary.
    move_speed: {
      label: 'Movement',
      fmt:   v => `+${v * GRID_SQUARE_FEET} ft movement`,
      dice:  { green: '1d2', blue: '1d2+1', purple: '1d3+1', orange: '1d3+2', red: '1d3+3' },
    },
    // Initiative stays a FLAT +N to the d20 initiative roll (not grid-based).
    initiative_bonus: {
      label: 'Initiative',
      fmt:   v => `+${v} initiative`,
      dice:  { green: '1d2', blue: '1d3', purple: '1d3+1', orange: '1d3+3', red: '1d3+5' },
    },
  },
  hands: {
    // Gloves = action economy (the doc's Hands identity). Attack/Cast speed grant extra weapon
    // attacks / spells per turn (user's tiers: none green/blue, 1 at purple & orange, 2 at red).
    // Both are "speeds", so with the orange/red count of 2 at least one speed always lands plus a
    // guaranteed SECOND affix (see AFFIX_COUNT.hands). Life steal heals the wearer for a % of damage
    // dealt, on the healing ladder, and rolls at every tier.
    //
    // MECHANICS WIRED (combat.js, 2026-07-17): life_steal via the on-hit hook in _executeAttack;
    // attack_speed/cast_speed via _spendHeroAction — a MANUAL hero's action consumes an extra of the
    // matching type before turnAttacked finally locks, so they take 1+N attacks/spells and freely
    // choose each (Fire Bolt then Magic Missile, Bless then Heal). ⚠ Automated-mode heroes don't yet
    // get the extras (only the manual attack/cast sites were converted). UNPLAYTESTED.
    attack_speed: {
      label: 'Attack speed',
      fmt:   v => `+${v} extra attack${v > 1 ? 's' : ''}/turn`,
      dice:  { purple: '1d1', orange: '1d1', red: '2d1' },   // 1 · 1 · 2
    },
    cast_speed: {
      label: 'Cast speed',
      fmt:   v => `+${v} extra spell${v > 1 ? 's' : ''}/turn`,
      dice:  { purple: '1d1', orange: '1d1', red: '2d1' },
    },
    life_steal_pct: {
      label: 'Life steal',
      fmt:   v => `+${v}% life steal`,
      dice:  { green: '1d3', blue: '1d3+1', purple: '1d4+2', orange: '1d4+4', red: '2d4+5' },
    },
  },
  belt: {
    // Belt = CON (doc allocation). Same progression as the wrist STR/DEX: `mult: 2` doubles the
    // roll so every point lands on an EVEN score, because an odd ability bump is INVISIBLE (16->17
    // is still a +3 modifier). CON is broad — it feeds HP, CON saves, and unarmored AC — so like
    // STR/DEX it's a purple+ chase stat, no green/blue roll. The other belt stat, Resource regen,
    // is NOT built yet (pending design).
    //
    // CON is fully wired: saves (rollSave) and unarmored AC read abilityModOf('con'), and HP now
    // bakes in via syncGearHp (+5 maxHp per CON modifier, i.e. per +2 CON).
    con: {
      label: 'Constitution',
      fmt:   v => `+${v} Constitution`,
      mult:  2,
      dice:  { purple: '1d1', orange: '1d2', red: '1d2+1' },   // x2 -> +2 | +2/+4 | +4/+6
    },
    // Resource regen = extra OUT-OF-COMBAT uses of a hero's limited OOC ability. Today that's ONLY
    // Leugren's between-combats Healing Word (js/healingWordOOC.js reads affixTotal(hero,
    // 'resource_regen') as bonus charges on top of the base 1); any future OOC-limited ability can
    // read the same key. It does nothing for a hero with no OOC ability (e.g. a martial's belt),
    // which is accepted — CON is the universal half of the slot. Integer charges, so d1/d2 dice.
    resource_regen: {
      label: 'Out-of-combat uses',
      fmt:   v => `+${v} out-of-combat ability use${v > 1 ? 's' : ''}`,
      dice:  { green: '1d1', blue: '1d1', purple: '1d2', orange: '1d2+1', red: '1d3+1' },
    },
  },
  // The remaining slots are UNBUILT ON PURPOSE. Which stat each owns is already locked in
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
  // Chest is genuinely THIN — ac_pct is the only stat it owns until proficiency gating exists,
  // so there's nothing a second pick could land on and the count is 1 at every tier. Tiers
  // separate by SIZE alone here.
  //
  // Grey's [0,1] is INERT, here and in head/wrist alike: no stat in any table above has grey
  // dice, so `eligible` is empty at grey and rollAffixes returns [] before the count is ever
  // read. A grey item is ALWAYS a plain base — the [0,1] is shape-consistency, not a coin flip.
  chest: { grey: [0, 1], green: [1, 1], blue: [1, 1], purple: [1, 1], orange: [1, 1], red: [1, 1] },
  // Wrist stays at 1 even though it owns TWO stats from purple up — deliberately, not because
  // it's thin. STR/DEX must not stack with hit_pct on the same wrist: the slot is a PAIR so
  // both double, hit_pct's red pair already reaches +14-24% against rollToHit's 95 clamp, and
  // even-only STR/DEX has a floor of +10% hit per pair. Both together = +34-54% on a red pair,
  // i.e. rolls thrown away above the ceiling. One stat per wrist keeps every tier under the
  // clamp AND makes the pair a decision (two hit%, two STR/DEX, or one of each).
  wrist: { grey: [0, 1], green: [1, 1], blue: [1, 1], purple: [1, 1], orange: [1, 1], red: [1, 1] },
  // Neck owns two ROLLABLE stats now — healing_received + healing_done — plus the signatureOnly
  // riders (which bypass this row: they roll only via a base's signatureAffix, never the random
  // pool). So this count governs how many healing affixes a plain necklace rolls, saturating at 2.
  // Mirrors head's count shape. A rider amulet ignores this entirely and always rolls just its rider.
  neck:  { grey: [0, 1], green: [1, 1], blue: [1, 2], purple: [1, 2], orange: [2, 2], red: [2, 2] },
  // Cloak owns THREE stats (saves / stealth / perception), so its count can climb to 3 at the top.
  cloak: { grey: [0, 1], green: [1, 1], blue: [1, 2], purple: [2, 2], orange: [2, 3], red: [3, 3] },
  // Legs is a THIN slot — Max HP is the only stat, so the count is always 1; tiers separate by size.
  legs:  { grey: [0, 1], green: [1, 1], blue: [1, 1], purple: [1, 1], orange: [1, 1], red: [1, 1] },
  // Feet owns TWO stats (movement / initiative), so its count can reach 2.
  feet:  { grey: [0, 1], green: [1, 1], blue: [1, 2], purple: [2, 2], orange: [2, 2], red: [2, 2] },
  // Hands: green/blue roll ONLY life steal (speed is purple+). purple = 1 affix. Orange/red = 2, the
  // user's "guaranteed second affix" — and since 2 of the 3 eligible are speeds, a speed always lands.
  hands: { grey: [0, 1], green: [1, 1], blue: [1, 1], purple: [1, 1], orange: [2, 2], red: [2, 2] },
  // Belt owns CON (purple+, even-only) + Resource regen (all tiers). green/blue roll ONLY regen (CON
  // is purple+); purple+ can pair both. Mirrors the hands shape where a gated stat joins from purple.
  belt:  { grey: [0, 1], green: [1, 1], blue: [1, 1], purple: [1, 2], orange: [2, 2], red: [2, 2] },
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

// Build ONE affix instance for a stat at a rarity. Two shapes come out of here:
//   • Numeric affix → pre-rolls one permanent `value` (the stat), displayed via a.fmt.
//   • Damage rider  → stamps the tier's dice FORMULA + save + DC + type, and combat rerolls
//     the dice every hit. It carries no `value`; its numbers happen at swing time, not here.
function _rollOne(key, a, rarity) {
  if (a.rider) {
    const formula = a.dice[rarity];
    const f  = parseDiceFormula(formula);
    const lo = f ? f.count + f.modifier : 0;
    const hi = f ? f.count * f.sides + f.modifier : 0;
    const range  = lo === hi ? `${lo}` : `${lo}–${hi}`;
    const saveDC = a.dc[rarity];
    return {
      key, label: a.label, rider: true,
      dice: formula, damageType: a.damageType, saveStat: a.saveStat,
      saveDC, halfOnSave: a.halfOnSave ?? true,
      display: `On hit: ${range} ${a.noun} damage · ${a.saveStat.toUpperCase()} save DC ${saveDC} for half`,
    };
  }
  const f = parseDiceFormula(a.dice[rarity]);
  // `mult` scales the roll AFTER the dice — it exists because parseDiceFormula only speaks
  // NdS±M, which cannot express "even numbers only" (2d2 is 2,3,4). STR/DEX needs that:
  // an odd score bump is invisible against an even base score.
  const value = f ? roll(f).total * (a.mult ?? 1) : 0;
  return { key, label: a.label, value, display: a.fmt(value) };
}

// Roll the affixes for one dropped item. Returns [] for a slot with no table yet, a rarity
// that gates everything out, or a count roll of 0 — all legitimate, all meaning "plain base".
export function rollAffixes(base, rarity) {
  const table = SLOT_AFFIXES[base?.slot];
  if (!table || !rarity) return [];

  // A SIGNATURE item's whole identity is one bespoke affix — a Fire pendant is Fire at every
  // tier it can roll. It bypasses the random eligible/count logic and just rolls THAT affix at
  // the dropped rarity, or drops as a plain base if the affix is gated out here (e.g. grey, where
  // no rider has dice — a grey Emberheart Pendant is inert flavor, consistent with grey elsewhere).
  if (base.signatureAffix) {
    const a = table[base.signatureAffix];
    return a?.dice?.[rarity] ? [_rollOne(base.signatureAffix, a, rarity)] : [];
  }

  // Random roll. Eligible = has dice AT THIS TIER and is NOT signatureOnly (riders exist only on
  // their named item, never on a generic base). A stat gated above this rarity simply isn't here.
  const eligible = Object.entries(table).filter(([, a]) => a.dice?.[rarity] && !a.signatureOnly);
  if (!eligible.length) return [];

  const [lo, hi] = AFFIX_COUNT[base.slot]?.[rarity] ?? [0, 0];
  const want = Math.min(eligible.length, lo + Math.floor(Math.random() * (hi - lo + 1)));
  if (want <= 0) return [];

  return _shuffled(eligible).slice(0, want).map(([key, a]) => _rollOne(key, a, rarity));
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

// ── Healing ─────────────────────────────────────────────────────────────────
// The single choke point for restoring HP — every heal in the game (Healing Word, Cure Wounds,
// potions, short rest, soul-shard, zone-load) routes through here so the neck's two healing
// affixes apply in ONE place instead of at ~8 inlined sites. Mirrors the applyMitigation/
// damageMitigationOf extraction that let the head mitigation affix plug in cleanly.
//
// Two affixes, summed ADDITIVELY then applied as one multiply (same rule as mitigation, never
// chained): `healing_received_pct` on the TARGET lifts heals from any source; `healing_done_pct`
// on the CASTER (passed as opts.caster, only the cast heals have one) lifts what they heal. Clamps
// to maxHp. Returns the HP actually restored (after the clamp) so callers log the real number.
export function applyHeal(target, amount, { caster = null } = {}) {
  if (!target || !(amount > 0)) return 0;
  const recv  = affixTotal(target, 'healing_received_pct') / 100;
  const given = caster ? affixTotal(caster, 'healing_done_pct') / 100 : 0;
  const boosted = Math.max(1, Math.round(amount * (1 + recv + given)));
  const before  = target.hp ?? 0;
  const maxHp   = target.maxHp ?? before;
  target.hp = Math.min(maxHp, before + boosted);
  return target.hp - before;
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

// A unit's movement speed in ft/turn INCLUDING gear — the boots `move_speed` affix. Same accessor
// pattern as abilityScoreOf: the raw `UNIT_TYPES[u.type]?.speed ?? 30` appeared ~30 times across
// combat.js, and each was a spot a movement bonus would be silently ignored. Enemies carry no gear,
// so affixTotal is 0 for them and this just returns their base speed.
export function speedOf(unit) {
  // move_speed is in SQUARES; convert to feet so the whole-tile bonus lands cleanly on the grid.
  return (UNIT_TYPES[unit?.type]?.speed ?? 30) + affixTotal(unit, 'move_speed') * GRID_SQUARE_FEET;
}
