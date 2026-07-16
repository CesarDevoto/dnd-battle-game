// js/equipment.js — item schema, equip/unequip helpers, AC calculation

import { UNIT_TYPES } from './constants.js';

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
  return displaced;
}

export function unequipItem(hero, slotId) {
  if (!hero.equipment) return null;
  const item = hero.equipment[slotId] ?? null;
  delete hero.equipment[slotId];
  return item;
}

export function getEquipped(hero, slotId) {
  return hero.equipment?.[slotId] ?? null;
}

// ── Bag placement ─────────────────────────────────────────────────────────────
// Bag-1 slot 0 is reserved exclusively for healing potions (anything with a
// `heal` field — today just Potion of Lesser Healing, but greater tiers can slot
// into the same reserved spot later). Non-potions can never land there, and
// potions can never land anywhere else — which is what lets the Digit6 hotbar
// slot and the inventory's Use option both assume bag-1[0] is THE potion.
export function isHealingPotion(item) { return !!item?.heal; }

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

// Hero AC: chest armor sets the base (Light/Medium add full DEX mod, Heavy
// ignores DEX — chest items marked `heavy: true` are the Heavy tier). No
// chest item → Unarmored: 10 + DEX mod, or 10 + DEX mod + CON mod for units
// with `unarmoredDefense: true` in UNIT_TYPES (e.g. Gobo's Barbarian
// feature — lost the moment any chest armor, light/medium/heavy, is worn).
// Shield (off-hand) always adds its flat ac bonus on top.
export function computeAC(hero) {
  const def      = UNIT_TYPES[hero.type] ?? {};
  const ab       = def.abilities ?? {};
  const dexMod   = Math.floor(((ab.dex ?? 10) - 10) / 2);
  const conMod   = Math.floor(((ab.con ?? 10) - 10) / 2);

  // A chest item with no real ac (e.g. a cosmetic robe/linen at ac: 0) isn't
  // armor — treat it like an empty slot so unarmored/Unarmored Defense math
  // still applies instead of flooring AC at the item's literal ac value.
  const chest = hero.equipment?.chest ?? null;
  let ac;
  if (chest?.ac) {
    ac = chest.heavy ? chest.ac : chest.ac + dexMod;
  } else if (def.unarmoredDefense) {
    ac = 10 + dexMod + conMod;
  } else {
    ac = 10 + dexMod;
  }

  const shield = hero.equipment?.['off-hand'] ?? null;
  if (shield?.ac) ac += shield.ac;

  return ac;
}
