// js/equipment.js — item schema, equip/unequip helpers

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

export function equipItem(hero, item, slotOverride) {
  if (!hero.equipment) hero.equipment = {};
  hero.equipment[slotOverride ?? item.slot] = item;
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
