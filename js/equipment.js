// js/equipment.js — item schema, equip/unequip helpers, AC calculation

import { UNIT_TYPES } from './constants.js';
// Safe: spells.js imports constants.js only, so this is a one-way edge. isFullCaster is the
// same predicate the spell-slot table uses — so "can hold a focus" tracks "can cast" by
// construction rather than by a second list someone has to remember to update.
import { isFullCaster } from './spells.js';

// Item schema:
// {
//   id:     String  — unique key e.g. 'leather_boots'
//   name:   String  — display name e.g. 'Leather Boots'
//   slot:   String  — 'head'|'neck'|'chest'|'cloak'|'wrist-l'|'wrist-r'|
//                     'legs'|'hands'|'feet'|'belt'|'ring-l'|'ring-r'|
//                     'main-hand'|'off-hand'|'ammo'|'bag'|'wrist'|'ring'
//   rarity: String  — 'grey'|'green'|'blue'|'purple'|'orange'|'red'
//   icon:   String  — path to icon PNG, e.g. 'assets/items/weapons/handaxe.png'
//   // stat properties (ac, dmg, bonus, etc.) added per-item as needed
// }
//
// Generic catalog slots ('bag', 'wrist', 'ring') aren't real equipment keys —
// any matching item can go into any of that type's boxes. Equipping one
// requires an explicit target key passed as equipItem(hero, item, 'bag-2'),
// equipItem(hero, item, 'wrist-l'), or equipItem(hero, item, 'ring-r').

export const RARITIES = ['grey', 'green', 'blue', 'purple', 'orange', 'red'];

export const RARITY_LABEL = {
  grey:   'Common',
  green:  'Uncommon',
  blue:   'Rare',
  purple: 'Epic',
  orange: 'Legendary',
  red:    'Unique',
};

// ── Currency ──────────────────────────────────────────────────────────────────
// 10 cp = 1 sp · 10 sp = 1 gp · 10 gp = 1 pp   (user's rates, 2026-07-16)
//
// COPPER is the base unit and the only thing values are stored in. Named constants rather
// than a bare `/ 100` so a merchant payout, a price and a wallet can't drift apart.
// hero.currency keeps the four denominations separately ({copper, silver, gold, platinum}),
// so anything paying a hero has to convert FROM copper — see formatCoins for the split logic.
export const CP_PER_SP = 10;
export const CP_PER_GP = 100;
export const CP_PER_PP = 1000;

// ── Sell value ────────────────────────────────────────────────────────────────
// Rarity sets what an item sells for (user's numbers, 2026-07-16).
//
// Stored in COPPER because the ladder spans SIX orders of magnitude: grey is 4 COPPER and
// red is 10,000 GOLD. Gold alone can't hold grey without fractions (0.04 gp), and fractional
// currency leaks into every total it touches. Integers in the smallest unit stay exact.
//
// The x10 steps after grey are deliberate — grey is deliberately worthless (4cp is a rounding
// error next to green's 2gp), so vendoring trash is never a strategy.
export const RARITY_VALUE_CP = {
  grey:         4,   //      4 cp
  green:      200,   //      2 gp   (2 x CP_PER_GP)
  blue:      2000,   //     20 gp
  purple:   20000,   //    200 gp
  orange:  200000,   //  2,000 gp
  red:    1000000,   // 10,000 gp = 1,000 pp
};

// What an item sells for, in copper. An explicit `value` (in GOLD — gems, quest items) WINS
// over the rarity default: a 5,000 gp ruby is worth that because it's a ruby, not because of
// a tier, and the goblin key's value:0 keeps it correctly worthless.
export function itemValueCp(item) {
  if (item?.value != null) return Math.round(item.value * 100);
  return RARITY_VALUE_CP[item?.rarity] ?? 0;
}

// Copper → a readable price. Largest denomination first, empties skipped.
//
// ⚠ Stops at GOLD and does NOT roll into platinum, even though pp exists at 1 pp = 10 gp.
// That's a display choice, not an oversight: a red item reads "10,000 gp" instantly, where
// "1,000 pp" makes the player do arithmetic to compare it with a 200 gp purple. Prices stay
// on one scale; the WALLET still uses all four denominations.
//
// So this is for PRICES. A merchant paying a hero needs the opposite job — copper split into
// {copper, silver, gold, platinum} for hero.currency — and should use CP_PER_PP and friends
// rather than reusing this.
export function formatCoins(cp) {
  const n = Math.max(0, Math.round(cp ?? 0));
  if (!n) return '';
  const gp = Math.floor(n / CP_PER_GP);
  const sp = Math.floor((n % CP_PER_GP) / CP_PER_SP);
  const c  = n % CP_PER_SP;
  const parts = [];
  if (gp) parts.push(`${gp.toLocaleString()} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (c)  parts.push(`${c} cp`);
  return parts.join(' ');
}

// A shield and a two-handed weapon both need the off-hand — equipping one bumps the other.
// Physical constraint, not a class rule, so it applies to any hero (in practice only
// Gobo/Leugren carry shields today).
//
// RETURNS every item this displaced, so callers can re-home them: the slot's previous
// occupant first, then any two-handed casualty.
//
// ⚠ It used to `delete` the two-handed casualty and return nothing, which silently
// DESTROYED it — equipping a greataxe over a shield ate the shield, and dragging still did
// so even after the right-click Equip path started rescuing it by hand. Returning the
// displaced items instead fixes every caller at once, and makes losing one a decision the
// caller has to actively make rather than something that happens to them.
//
// Callers MUST do something with the return value. Dropping it on the floor is the old bug.
export function equipItem(hero, item, slotOverride) {
  // ⚠ Returns null — NOT [] — when proficiency forbids it. Callers already have to handle the
  // return value to re-home displaced items, so a null forces them to notice the refusal
  // rather than silently treating it as "equipped, nothing displaced".
  //
  // Every UI path checks canEquip first and greys the option out; this is the backstop that
  // makes the rule true even if a future caller forgets.
  if (!canEquip(hero, item)) return null;

  if (!hero.equipment) hero.equipment = {};
  const slot = slotOverride ?? item.slot;
  const displaced = [];

  // [0] is always the slot's previous occupant — the plain swap a caller expects.
  if (hero.equipment[slot]) displaced.push(hero.equipment[slot]);

  if (slot === 'off-hand' && hero.equipment['main-hand']?.twoHanded) {
    displaced.push(hero.equipment['main-hand']);
    delete hero.equipment['main-hand'];
  } else if (slot === 'main-hand' && item.twoHanded && hero.equipment['off-hand']) {
    displaced.push(hero.equipment['off-hand']);
    delete hero.equipment['off-hand'];
  }

  hero.equipment[slot] = item;
  syncGearHp(hero);
  return displaced;
}

export function unequipItem(hero, slotId) {
  if (!hero.equipment) return null;
  const item = hero.equipment[slotId] ?? null;
  delete hero.equipment[slotId];
  syncGearHp(hero);
  return item;
}

// The Legs Max-HP affix, baked into hero.maxHp rather than summed at a read site (maxHp is a stored
// field read raw in ~28 places with no accessor). Reconciles maxHp — and current hp — to the gear's
// current total whenever equipment changes; `_gearMaxHp` tracks how much is already applied so this
// is idempotent and only ever moves by the DELTA. Current hp rides with the ceiling (equipping the
// bonus grants it, unequipping removes it), clamped to [1, maxHp] for a living hero; a downed hero
// (hp 0) keeps its 0. Heroes persist across zones, so once baked in the bonus carries.
// +5 HP per CON MODIFIER point. Belt CON is even (mult:2), so `con/2` is the clean modifier count.
// Deliberately level-INDEPENDENT (unlike 5e's per-level HP): base hero HP here is a flat authored
// number, not CON-derived, and keeping this off `level` means syncGearHp stays a pure equip-time
// delta — no need to re-run it on level-up. Tunable via this one constant.
const HP_PER_CON_MOD = 5;

export function syncGearHp(hero) {
  if (!hero) return;
  // Two gear HP sources reconciled together: legs' flat max_hp affix, and belt CON (via its modifier).
  const flatHp = _gearBonus(hero, 'max_hp');
  const conHp  = Math.floor(_gearBonus(hero, 'con') / 2) * HP_PER_CON_MOD;
  const target = flatHp + conHp;
  const delta  = target - (hero._gearMaxHp ?? 0);
  if (delta === 0) return;
  hero.maxHp = Math.max(1, (hero.maxHp ?? 1) + delta);
  if (hero.hp > 0) hero.hp = Math.max(1, Math.min(hero.maxHp, hero.hp + delta));
  hero._gearMaxHp = target;
}

export function getEquipped(hero, slotId) {
  return hero.equipment?.[slotId] ?? null;
}

// ── Bag placement ─────────────────────────────────────────────────────────────
// Bag-1 slot 0 is reserved exclusively for healing potions (anything with a
// `heal` field — today just Potion of Lesser Healing, but greater tiers can slot
// into the same reserved spot later). Non-potions can never land there, and
// potions can never land anywhere else — which is what lets the Digit8 hotbar
// slot and the inventory's Use option both assume bag-1[0] is THE potion.
export function isHealingPotion(item) { return !!item?.heal; }

// ── Where an item can be WORN ─────────────────────────────────────────────────
// An item's `.slot` is a CATALOG slot, not always an equipment key: 'ring'/'wrist' are
// interchangeable PAIRS and 'bag' is one of four, so those expand. Everything else is 1:1.
// Lifted out of a closure in ui.js so the loot auto-equip and the inventory UI can't drift
// apart about which physical slots a ring may occupy.
export const EQUIP_TARGETS = {
  ring:  ['ring-l', 'ring-r'],
  wrist: ['wrist-l', 'wrist-r'],
  bag:   ['bag-1', 'bag-2', 'bag-3', 'bag-4'],
};
export const equipTargetsFor = item => EQUIP_TARGETS[item?.slot] ?? (item?.slot ? [item.slot] : []);

// The first slot this item could be worn in that is currently EMPTY, or null.
//
// Null covers every "don't auto-equip" case in one test, which is why callers need no
// special-casing: a consumable (potions carry no `.slot`, so there are no targets), an item
// the hero isn't proficient with, or a hero whose relevant slots are all already filled —
// auto-equipping over worn gear would silently downgrade a hero, so a full slot means "bag it".
export function firstEmptyEquipSlot(hero, item) {
  if (!hero || !item || !canEquip(hero, item)) return null;
  const eq = hero.equipment ?? {};
  return equipTargetsFor(item).find(k => !eq[k]) ?? null;
}

// Walks a hero's bag-1..bag-4 in order and drops `item` into the first empty (or
// same-item, for stacking) slot. `.contents` arrays are created lazily, same as
// the equipment panel's bag view, so this works on a bag that's never been opened.
//
// Returns false when there's no room. The caller decides what that means: loot
// treats it as "the item is lost", a trade treats it as "cancel the move".
//
// Honours item.qty so trading a stack of 3 potions moves all 3. Loot drops carry
// no qty, so `?? 1` keeps that path behaving exactly as it did.
//
// Lives here rather than in lootPanel.js because the inventory right-click menu
// needs it too, and ui.js → lootPanel.js → heroPortraits.js → ui.js would be a
// circular import. equipment.js is a leaf.
export function placeInFirstEmptyBagSlot(hero, item) {
  const { assignedTo, ...cleanItem } = item;
  const isPotion = isHealingPotion(cleanItem);
  const addQty   = cleanItem.qty ?? 1;

  if (isPotion) {
    const bag1 = hero.equipment?.['bag-1'];
    if (bag1?.slots) {
      if (!bag1.contents) bag1.contents = new Array(bag1.slots).fill(null);
      const slot0 = bag1.contents[0];
      if (slot0 == null) {
        bag1.contents[0] = { ...cleanItem, qty: addQty };
        return true;
      }
      if (slot0.id === cleanItem.id) {
        slot0.qty = (slot0.qty ?? 1) + addQty;
        return true;
      }
      return false; // reserved slot holds a different potion tier — no room
    }
  }

  for (let n = 1; n <= 4; n++) {
    const bag = hero.equipment?.[`bag-${n}`];
    if (!bag?.slots) continue;
    if (!bag.contents) bag.contents = new Array(bag.slots).fill(null);
    const start = n === 1 ? 1 : 0; // slot 0 of bag-1 is potion-reserved
    for (let i = start; i < bag.contents.length; i++) {
      if (bag.contents[i] != null) continue;
      if (isPotion) continue; // potions only ever go in the reserved slot
      bag.contents[i] = { ...cleanItem };
      return true;
    }
  }
  return false; // every bag is full
}

// Sum one affix across equipped gear. A local twin of affixes.js's affixTotal, on purpose:
// affixes.js imports constants.js, and equipment.js is imported by units.js at module load,
// so importing it here would create a cycle for the sake of one summation.
function _gearBonus(hero, key) {
  const eq = hero?.equipment;
  if (!eq) return 0;
  let total = 0;
  for (const slotKey of Object.keys(eq)) {
    for (const a of eq[slotKey]?.affixes ?? []) if (a.key === key) total += a.value;
  }
  return total;
}

// ── Material ──────────────────────────────────────────────────────────────────
// `material` is ONE field doing two jobs, deliberately: it decides who may equip a piece
// (below) and, on chest, how much DEX that armor lets you keep. They're the same axis —
// splitting them into `material` + `armorType` would be two fields that must always agree,
// which is a drift bug waiting to happen.
//
//   cloth   — no proficiency needed (robes, crowns, sandals, plain belts/bracers)
//   leather — D&D Light armor
//   hide    — D&D Medium armor
//   plate   — D&D Heavy armor  (also chain/ring/splint — all Heavy in the book)
//
// An item with NO material (weapons, rings, cloaks, necklaces, bags) is equippable by anyone.
export const MATERIAL_PROF = { leather: 'Light', hide: 'Medium', plate: 'Heavy' };

// How much DEX each material lets you keep. `cloth` is absent on purpose — a cloth chest has
// no `ac`, so computeAC treats it as an empty slot and never consults this.
//
// This used to be binary — `heavy ? no DEX : full DEX` — which silently skipped Medium's cap:
// Hide armor on Milo (DEX 16, +3) read AC 15 when the table says 12 + Dex (max 2) = 14.
export const ARMOR_DEX_CAP = { leather: Infinity, hide: 2, plate: 0 };

// Can this hero equip this item? The single gate — loot assignment, drag-drop, the right-click
// Equip row and equipItem itself all route through here, so there is one answer, not four.
//
// Reads UNIT_TYPES.armorProficiency, which already existed and was already rendered in the
// stat sheet's traits section. Nothing enforced it, so Rasec's own sheet said "cannot wear
// light, medium, or heavy armor" while he was free to wear Plate.
export function canEquip(hero, item) {
  return equipBlockReason(hero, item) === null;
}

// ── Weapons, shields, foci ────────────────────────────────────────────────────
// Weapons resolve against UNIT_TYPES.weaponProficiency, which — like armorProficiency —
// already existed and was already shown in the traits window, and was equally unenforced.
//
// A hero may use a weapon if it's NAMED in their list, or if they have blanket proficiency in
// its category. Gobo is simple+martial, so everything; Rasec is neither and gets only his five
// named (Dagger, Dart, Sling, Quarterstaff, Light Crossbow).
//
// ⚠ Unlike armor, weapons genuinely PARTITION. Milo's named martials (Longsword, Rapier,
// Shortsword, Shortbow, Hand Crossbow) and Leugren's (Battleaxe, Handaxe, Light Hammer,
// Warhammer) are DISJOINT — so "this warhammer is Leugren's" is actually true, which was never
// true of any armor material. Greataxe is martial and unnamed by anyone, so it's Gobo-only.
function _weaponBlock(heroType, item) {
  const wp = UNIT_TYPES[heroType]?.weaponProficiency;
  if (!wp) return null;
  if (wp.weapons?.includes(item.weaponType)) return null;   // named explicitly
  if (item.category === 'simple'  && wp.simple)  return null;
  if (item.category === 'martial' && wp.martial) return null;
  return `Requires ${item.category} weapon proficiency`;
}

// Why a hero can't equip something — the string a greyed button explains itself with.
// Null means they CAN. This is the single source of truth; canEquip is just `=== null`.
export function equipBlockReason(hero, item) {
  const heroType = hero?.type;
  if (!item) return null;

  // Shield — the off-hand's own proficiency flag, separate from the armor list.
  if (item.slot === 'off-hand' && item.ac) {
    return UNIT_TYPES[heroType]?.armorProficiency?.shields ? null : 'Requires shield proficiency';
  }

  // Arcane/divine focus (orb, wand). NOT covered by any book proficiency — it's our rule
  // (user, 2026-07-17): spellcasters only. isFullCaster is the same predicate the spell-slot
  // table uses, so a hero who can cast can hold a focus, by construction.
  if (item.focus) {
    return isFullCaster(heroType) ? null : 'Requires spellcasting';
  }

  // Weapon.
  if (item.weaponType) return _weaponBlock(heroType, item);

  // Armor.
  const need = MATERIAL_PROF[item.material];
  if (!need) return null;                       // cloth, or an item with no material at all
  const prof = UNIT_TYPES[heroType]?.armorProficiency?.armor ?? [];
  return prof.includes(need) ? null : `Requires ${need} armor proficiency`;
}

// How good a material is, for a hero who can wear it. Only meaningful on CHEST, where it
// literally sets AC (cloth 10 → plate 18); elsewhere it's the identity ladder — the heaviest
// thing a hero is trained in is the thing that "looks like theirs".
export const MATERIAL_RANK = { plate: 3, hide: 2, leather: 1, cloth: 0 };

// Every material a hero may wear, BEST first. Derived from canEquip rather than hand-listed,
// so it can never drift from the gate.
//
//   Rasec   → [cloth]
//   Milo    → [leather, cloth]
//   Gobo    → [hide, leather, cloth]
//   Leugren → [plate, hide, leather, cloth]
//
// Note it's a NESTED hierarchy, not a partition: Leugren can wear anything Gobo can. That's
// why loot coverage targets the HERO and then reads their ceiling here, rather than trying to
// treat materials as if each belonged to one hero.
export function materialLadder(heroType) {
  return Object.keys(MATERIAL_RANK)
    .filter(m => canEquip({ type: heroType }, { material: m }))
    .sort((a, b) => MATERIAL_RANK[b] - MATERIAL_RANK[a]);
}

// Hero AC: chest armor sets the base, and its armorType decides the DEX it grants (see
// ARMOR_DEX_CAP). No chest item → Unarmored: 10 + DEX mod, or 10 + DEX mod + CON mod for units
// with `unarmoredDefense: true` in UNIT_TYPES (e.g. Gobo's Barbarian feature — lost the moment
// any chest armor, light/medium/heavy, is worn).
// Shield (off-hand) always adds its flat ac bonus on top.
export function computeAC(hero) {
  const def      = UNIT_TYPES[hero.type] ?? {};
  const ab       = def.abilities ?? {};
  // DEX folds in gear (the wrist dex affix); CON has no affix yet, so it reads the statblock.
  // Deliberately inlined rather than importing affixes.js: that module imports constants.js
  // and equipment.js is imported BY units.js at load — routing it through here would build a
  // cycle for one addition. affixTotal's shape is trivial and stable.
  const dexMod   = Math.floor(((ab.dex ?? 10) + _gearBonus(hero, 'dex') - 10) / 2);
  const conMod   = Math.floor(((ab.con ?? 10) - 10) / 2);

  // A chest item with no real ac (e.g. a cosmetic robe/linen at ac: 0) isn't
  // armor — treat it like an empty slot so unarmored/Unarmored Defense math
  // still applies instead of flooring AC at the item's literal ac value.
  const chest = hero.equipment?.chest ?? null;
  let ac;
  if (chest?.ac) {
    // `?? 'leather'` covers a chest with an `ac` but no material (none today, but a hand-added
    // entry could) — full DEX is the lenient read, and silently granting no DEX would be worse.
    const mat = chest.material ?? 'leather';
    // ⚠ plate is a flat 0, NOT Math.min(dexMod, 0). Min would SUBTRACT for a low-DEX wearer —
    // plate on a DEX 8 unit would read 17 instead of 18. In 5e heavy armor ignores DEX
    // entirely, negative modifiers included, so it cannot be expressed as a cap.
    const dexPart = mat === 'plate' ? 0 : Math.min(dexMod, ARMOR_DEX_CAP[mat] ?? Infinity);
    ac = chest.ac + dexPart;
  } else if (def.unarmoredDefense) {
    ac = 10 + dexMod + conMod;
  } else {
    ac = 10 + dexMod;
  }

  const shield = hero.equipment?.['off-hand'] ?? null;
  if (shield?.ac) ac += shield.ac;

  return ac;
}
