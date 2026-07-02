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

// A shield and a two-handed weapon both need the off-hand — equipping one
// bumps the other. Physical constraint, not a class rule, so it applies to
// any hero (in practice only Gobo/Leugren carry shields today).
export function equipItem(hero, item, slotOverride) {
  if (!hero.equipment) hero.equipment = {};
  const slot = slotOverride ?? item.slot;

  if (slot === 'off-hand' && hero.equipment['main-hand']?.twoHanded) {
    delete hero.equipment['main-hand'];
  } else if (slot === 'main-hand' && item.twoHanded) {
    delete hero.equipment['off-hand'];
  }

  hero.equipment[slot] = item;
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
