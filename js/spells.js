// ════════════════════════════════════════════════════════════════════════════
//  SPELLS — Leugren (Dwarf Cleric) spell definitions, bless condition,
//            spell-slot helpers
// ════════════════════════════════════════════════════════════════════════════

export const SPELLS = {
  // ── Cantrips (level 0) ──────────────────────────────────────────────────────
  sacred_flame: {
    key:        'sacred_flame',
    name:       'Sacred Flame',
    level:      0,
    actionType: 'action',
    rangeFt:    60,
    dice:       1,
    sides:      8,
    saveType:   'dex',
    saveDC:     12,
    imgSrc:     'assets/spells and skills/sacred flame.jpg',
    desc:       '60 ft · 1d8 radiant · DEX save DC 12 negates',
  },
  healing_word: {
    key:        'healing_word',
    name:       'Healing Word',
    level:      0,
    actionType: 'action',
    rangeFt:    60,
    healDice:   1,
    healSides:  8,
    imgSrc:     'assets/spells and skills/healingword.jpg',
    desc:       '60 ft · 1d8+WIS hp restored',
  },
  // ── Level 1 ─────────────────────────────────────────────────────────────────
  cure_wounds: {
    key:        'cure_wounds',
    name:       'Cure Wounds',
    level:      1,
    actionType: 'action',
    rangeFt:    5,
    healDice:   2,
    healSides:  6,
    healMod:    2,
    imgSrc:     'assets/spells and skills/cure wounds.jpg',
    desc:       'Touch · 2d6+2 hp restored',
  },
  bless: {
    key:           'bless',
    name:          'Bless',
    level:         1,
    actionType:    'action',
    concentration: true,
    imgSrc:        'assets/spells and skills/bless.jpg',
    desc:          'Party · all allies · +1d2×5% to atk & saves · conc',
  },
  // Channel Divinity, not a spell — level 0 so it costs NO slot (hasSpellSlot/spendSpellSlot
  // both early-return on level <= 0). Its cost is instead a per-combat charge, u.turnUndeadUses,
  // reset in the per-combat block in combat.js. Level 0 also parks it in the S&S CANTRIP row,
  // which is the only row in that window that doesn't imply a slot.
  turn_undead: {
    key:        'turn_undead',
    name:       'Turn Undead',
    level:      0,
    actionType: 'action',
    rangeFt:    30,
    saveType:   'wis',
    saveDC:     13,
    duration:   10,          // 1 minute = 10 rounds, same clock as Bless/Sleep
    undeadOnly: true,
    desc:       '30 ft · Undead only · WIS DC 13 or Frightened + Incapacitated for 1 min · flees from you · ends early if it takes damage · once per combat',
  },
  sanctuary: {
    key:        'sanctuary',
    name:       'Sanctuary',
    level:      1,
    actionType: 'bonus',
    rangeFt:    30,
    saveType:   'wis',
    saveDC:     13,
    duration:   10,
    desc:       '30 ft · Bonus action · click an ally to ward them · an enemy must pass WIS DC 13 to attack them at all, or it must pick a different target · 1 min · ends if the warded ally attacks',
  },
};

// ── Bless condition state ─────────────────────────────────────────────────────
export const blessedUnits = new Set();   // Set<unit object>
export let concentrating      = null;    // unit currently concentrating
export let concentratingSpell = '';      // name of the spell being concentrated on
let _blessRoundsLeft = 0;
export function getBlessRoundsLeft() { return _blessRoundsLeft; }

export function applyBless(caster, targets) {
  blessedUnits.clear();
  _blessRoundsLeft    = 10;   // 1 minute = 10 rounds
  concentrating       = caster;
  concentratingSpell  = 'Bless';
  targets.forEach(u => blessedUnits.add(u));
}

export function clearBless() {
  blessedUnits.clear();
  _blessRoundsLeft    = 0;
  concentrating       = null;
  concentratingSpell  = '';
}

export function tickBless() {
  if (!_blessRoundsLeft) return;
  _blessRoundsLeft--;
  if (_blessRoundsLeft <= 0) clearBless();
}

// ── Rasec (Elf Mage) spells ───────────────────────────────────────────────────
export const ELF_SPELLS = {
  // ── Cantrips (level 0) ──────────────────────────────────────────────────────
  fire_bolt: {
    key:        'fire_bolt',
    name:       'Fire Bolt',
    level:      0,
    actionType: 'action',
    imgSrc:     'assets/spells and skills/firebolt.jpg',
    rangeFt:    90,
    dice:       1,
    sides:      10,
    statMod:    'int',
    desc:       '90 ft · to hit INT+prof · 1d10+INT fire dmg',
  },
  // ── Level 1 ─────────────────────────────────────────────────────────────────
  mage_armor: {
    key:        'mage_armor',
    name:       'Mage Armor',
    level:      1,
    actionType: 'action',
    imgSrc:     'assets/spells and skills/magearmor.jpg',
    desc:       'Self · +3 AC until long rest · stacks with base AC',
  },
  magic_missile: {
    key:       'magic_missile',
    name:      'Magic Missile',
    level:     1,
    actionType:'action',
    imgSrc:    'assets/spells and skills/magicmissile.jpg',
    rangeFt:   90,
    darts:     4,
    dice:      1,
    sides:     4,
    flatBonus: 1,
    desc:      '90 ft · 4 darts · 1d4+1 each · auto-hit · free once per combat, then 1 spell slot',
  },
  // ⚠ This definition was MISSING until 2026-07-20 while castSleep() in combat.js already
  // read spell.poolDice/poolSides/duration off it — the function would have thrown on the
  // first cast. Nothing could reach it (Sleep was in no UI pool), so it never surfaced.
  // Field names here are load-bearing for castSleep; don't rename without grepping it.
  sleep: {
    key:       'sleep',
    name:      'Sleep',
    level:     1,
    actionType:'action',
    rangeFt:   90,
    poolDice:  5,     // 5d8 HP pool, spent lowest-current-HP enemy first
    poolSides: 8,
    duration:  10,    // 1 minute = 10 rounds; any damage wakes the sleeper
    desc:      '90 ft · 5d8 HP pool · puts the weakest enemies in range to sleep, lowest HP first · 1 min · any damage wakes them',
  },
  burning_hands: {
    key:       'burning_hands',
    name:      'Burning Hands',
    level:     1,
    actionType:'action',
    rangeFt:   15,
    dice:      3,
    sides:     6,
    saveStat:  'dex',
    saveDC:    13,
    desc:      '15 ft cone · 3d6 fire · DEX DC 13 for half',
  },
  // Conjuration ritual — castable both in and out of combat via the
  // find_familiar ability handler (combat.js _ABILITY_HANDLERS). Gated to L4 via
  // LEVEL_SPELLS (below) so it appears in the level-up window, Skills & Spells
  // window, and character sheet as a prepared L1 spell.
  find_familiar: {
    key:        'find_familiar',
    name:       'Find Familiar',
    level:      1,
    actionType: 'action',
    ritual:     true,
    minLevel:   4,
    imgSrc:     'assets/spells and skills/find familiar.jpg',
    desc:       'Summon a loyal owl familiar with 1 HP that rides your shoulder · does not attack but acts on its own initiative in combat · can scout, deliver touch spells or do Help action giving you advantage attacking his target · may be summoned only ONCE PER COMBAT, so if he falls he is gone until the fight ends',
  },
};

// House rule: no spell reaches farther than 90 ft. Clamp every spell's range
// once, here, so any future spell defined with a larger rangeFt is capped
// automatically — no need to touch the many call sites that read spell.rangeFt.
// (Remember to write "90 ft" in the spell's desc string too; those are manual.)
export const MAX_SPELL_RANGE_FT = 90;
for (const _pool of [SPELLS, ELF_SPELLS]) {
  for (const _sp of Object.values(_pool)) {
    if (typeof _sp.rangeFt === 'number' && _sp.rangeFt > MAX_SPELL_RANGE_FT) {
      _sp.rangeFt = MAX_SPELL_RANGE_FT;
    }
  }
}

// Spells available from level 1
export const STARTING_SPELLS = {
  dwarf: new Set(['healing_word']),
  elf:   new Set(['fire_bolt']),
};

// Abilities/spells that unlock at specific levels (keyed by required level).
// Values are action/bonus-action keys used by both the tendencies system
// and _tryHeroAction in combat.js. Add new entries here as heroes gain abilities.
export const LEVEL_SPELLS = {
  dwarf:    { 2: ['bless'], 3: ['sacred_flame'], 4: ['cure_wounds'], 5: ['turn_undead'], 6: ['sanctuary'] },
  elf:      { 2: ['mage_armor'], 3: ['magic_missile'], 4: ['find_familiar'], 5: ['sleep'], 6: ['burning_hands'] },
  human:    { 5: ['defensive_stance'], 6: ['reckless_attack'], 7: ['second_wind'] },
  halfling: { 2: ['hide'], 3: ['smoke_mirrors'], 5: ['sleight_of_hand'], 6: ['pick_locks'] },
};

// Single source of truth for "can this hero use this ability yet" — used by
// the tendencies-window option filter, the level-up auto-append listener,
// and the actual action-execution guards in combat.js. Abilities not listed
// in LEVEL_SPELLS have no gate (available from level 1).
export function abilityMinLevel(heroType, key) {
  const levels = LEVEL_SPELLS[heroType];
  if (!levels) return 1;
  for (const [lvl, keys] of Object.entries(levels)) {
    if (keys.includes(key)) return Number(lvl);
  }
  return 1;
}

export function isAbilityUnlocked(heroType, level, key) {
  return (level ?? 1) >= abilityMinLevel(heroType, key);
}

import { dndLevelFor } from './constants.js';

// ── Full-caster spell slot table (5e) ─────────────────────────────────────────
// dndLevelFor + proficiencyBonusFor live in constants.js next to the other level
// curves (rage uses, sneak dice) — they're general progression, not spell-specific.
// Mapping recap: floor(gameLevel/5)+1, so game 1–4 → D&D 1 and our level 5 IS D&D 2.
// Indexed [dndLevel - 1] → slots per spell level, index 0 = 1st-level slots.
//
// ONE table for BOTH casters. Rasec (Elf Mage) and Leugren (Dwarf Cleric) are both
// FULL casters, and 5e gives full casters an identical slot progression — the wizard
// and cleric tables differ only in their class columns (Channel Divinity, cantrips
// known, prepared-spell counts), never in a single slot cell. Do not fork this per
// hero: it would be duplicated data that cannot legally diverge.
const FULL_CASTER_SLOTS = [
  /*  1 */ [2],
  /*  2 */ [3],
  /*  3 */ [4, 2],
  /*  4 */ [4, 3],
  /*  5 */ [4, 3, 2],
  /*  6 */ [4, 3, 3],
  /*  7 */ [4, 3, 3, 1],
  /*  8 */ [4, 3, 3, 2],
  /*  9 */ [4, 3, 3, 3, 1],
  /* 10 */ [4, 3, 3, 3, 2],
  /* 11 */ [4, 3, 3, 3, 2, 1],
  /* 12 */ [4, 3, 3, 3, 2, 1],
  /* 13 */ [4, 3, 3, 3, 2, 1, 1],
  /* 14 */ [4, 3, 3, 3, 2, 1, 1],
  /* 15 */ [4, 3, 3, 3, 2, 1, 1, 1],
  /* 16 */ [4, 3, 3, 3, 2, 1, 1, 1],
  /* 17 */ [4, 3, 3, 3, 2, 1, 1, 1, 1],
  /* 18 */ [4, 3, 3, 3, 3, 1, 1, 1, 1],
  /* 19 */ [4, 3, 3, 3, 3, 2, 1, 1, 1],
  /* 20 */ [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const FULL_CASTERS = new Set(['elf', 'dwarf']);
export function isFullCaster(type) { return FULL_CASTERS.has(type); }

// Max slots per spell level for a hero at a given GAME level. Returns a fresh array
// (never the table row) so callers can't mutate the table.
export function maxSlotsForLevel(heroType, gameLevel) {
  if (!isFullCaster(heroType)) return [];
  return [...FULL_CASTER_SLOTS[dndLevelFor(gameLevel) - 1]];
}

// Same row, addressed by D&D level rather than game level — for the XP table panel,
// which renders one row per D&D level rather than per hero level.
export function slotsForDndLevel(dndLvl) {
  return [...(FULL_CASTER_SLOTS[Math.max(1, Math.min(20, dndLvl)) - 1] ?? [])];
}

// A spell's level, from either pool (SPELLS = cleric, ELF_SPELLS = mage). Level 0 =
// cantrip = free. Unknown keys fall back to 1 rather than 0, so a spell that forgets
// to declare its level costs a slot instead of silently becoming an infinite cantrip.
export function spellLevelOf(key) {
  return (SPELLS[key] ?? ELF_SPELLS[key])?.level ?? 1;
}

// ── Slot accounting ───────────────────────────────────────────────────────────
// Heroes carry `spellSlotsByLevel` (array, index 0 = 1st-level slots REMAINING) and
// `spellSlotsMaxByLevel`. Enemies keep the old FLAT numeric `spellSlots` — they're
// statblocks, not D&D classes, and have no per-level table to draw from. The helpers
// below read both shapes so enemy casters keep working untouched.
//
// The old flat hero fields are GONE on purpose. Leaving `u.spellSlots` as a number on
// heroes while adding an array beside it would be two sources of truth that drift; and
// an array left under the old name would silently pass the old `(u.spellSlots ?? 0) <= 0`
// guards ([] <= 0 is TRUE, [2] <= 0 is false), failing quietly instead of loudly.

// Can `u` cast a spell of `spellLevel`? Level 0 (cantrip) is always free.
// 5e upcasting: a higher slot can pay for a lower-level spell, never the reverse.
export function hasSpellSlot(u, spellLevel = 1) {
  if (!u || spellLevel <= 0) return true;
  if (Array.isArray(u.spellSlotsByLevel)) {
    for (let i = spellLevel - 1; i < u.spellSlotsByLevel.length; i++) {
      if ((u.spellSlotsByLevel[i] ?? 0) > 0) return true;
    }
    return false;
  }
  return (u.spellSlots ?? 0) > 0;   // enemy flat pool
}

// Spend the LOWEST slot that can pay for `spellLevel` — never burn a 5th-level slot on
// a 1st-level spell while a 1st sits unused. Returns true if a slot was spent.
export function spendSpellSlot(u, spellLevel = 1) {
  if (!u || spellLevel <= 0) return true;
  if (Array.isArray(u.spellSlotsByLevel)) {
    for (let i = spellLevel - 1; i < u.spellSlotsByLevel.length; i++) {
      if ((u.spellSlotsByLevel[i] ?? 0) > 0) { u.spellSlotsByLevel[i]--; return true; }
    }
    return false;
  }
  if ((u.spellSlots ?? 0) <= 0) return false;
  u.spellSlots--;
  return true;
}

// Total remaining slots across every level — for the AI's "do I have casts left" check
// and any UI that wants one number rather than a per-level breakdown.
export function totalSpellSlots(u) {
  if (!u) return 0;
  if (Array.isArray(u.spellSlotsByLevel)) return u.spellSlotsByLevel.reduce((a, b) => a + (b ?? 0), 0);
  return u.spellSlots ?? 0;
}
export function totalSpellSlotsMax(u) {
  if (!u) return 0;
  if (Array.isArray(u.spellSlotsMaxByLevel)) return u.spellSlotsMaxByLevel.reduce((a, b) => a + (b ?? 0), 0);
  return u.spellSlotsMax ?? 0;
}

// Restore up to `n` slots, LOWEST level first (short rest). Lowest-first is the
// generous-but-not-abusable read: it hands back the cantrip-tier casting you burn most,
// never a 9th-level slot.
export function restoreSpellSlots(u, n) {
  if (!Array.isArray(u?.spellSlotsByLevel)) {
    if (u && u.spellSlots !== undefined) u.spellSlots = Math.min(u.spellSlotsMax ?? 0, (u.spellSlots ?? 0) + n);
    return;
  }
  let left = n;
  for (let i = 0; i < u.spellSlotsByLevel.length && left > 0; i++) {
    const room = (u.spellSlotsMaxByLevel[i] ?? 0) - (u.spellSlotsByLevel[i] ?? 0);
    const give = Math.min(room, left);
    u.spellSlotsByLevel[i] += give;
    left -= give;
  }
}

// Grow a hero's slots to match a new level WITHOUT refilling what they've spent: the
// per-level delta is added to the remaining pool, mirroring the old level-up behaviour.
export function syncSlotsToLevel(u) {
  if (!u || !isFullCaster(u.type)) return;
  const next = maxSlotsForLevel(u.type, u.level ?? 1);
  const prevMax = u.spellSlotsMaxByLevel ?? [];
  const cur     = u.spellSlotsByLevel ?? [];
  u.spellSlotsByLevel    = next.map((mx, i) => (cur[i] ?? 0) + Math.max(0, mx - (prevMax[i] ?? 0)));
  u.spellSlotsMaxByLevel = next;
}

// ── Spell slot initialisation (called when battle begins) ─────────────────────
// ⚠ SLOTS ARE PER-COMBAT, NOT PER-DAY. rollInitiative() calls this at the start of
// every fight and it refills to max. That makes the 5e table — which is balanced as a
// budget for a whole adventuring day of 6–8 encounters — a per-FIGHT allowance here:
// at D&D 3 that's 4×1st + 2×2nd every single combat. Deliberately left as-is for now;
// the user plans to lower the totals to suit a per-combat refill (deferred 2026-07-16).
// Consequence: shortRest's slot restore is correct code with no observable effect,
// since the next combat refills anyway. It only matters if slots ever go per-day.
export function initSpellSlots(units) {
  units.forEach(u => {
    if (!isFullCaster(u.type)) return;
    const lvl = u.level ?? 1;
    u.spellSlotsMaxByLevel = maxSlotsForLevel(u.type, lvl);
    u.spellSlotsByLevel    = [...u.spellSlotsMaxByLevel];
    u.preparedSpells       = new Set(STARTING_SPELLS[u.type]);
    // Add any spells that unlock at or below the hero's current level
    for (const [reqLvl, keys] of Object.entries(LEVEL_SPELLS[u.type] ?? {})) {
      if (lvl >= +reqLvl) keys.forEach(k => u.preparedSpells.add(k));
    }
  });
}
