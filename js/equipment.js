// js/equipment.js — item schema, equip/unequip helpers

// Item schema:
// {
//   id:     String  — unique key e.g. 'leather_boots'
//   name:   String  — display name e.g. 'Leather Boots'
//   slot:   String  — 'head'|'neck'|'chest'|'cloak'|'wrist-l'|'wrist-r'|
//                     'legs'|'hands'|'feet'|'belt'|'ring-l'|'ring-r'|
//                     'main-hand'|'off-hand'|'ammo'
//   rarity: String  — 'grey'|'green'|'blue'|'purple'|'orange'|'red'
//   icon:   String  — path to icon PNG, e.g. 'assets/items/weapons/handaxe.png'
//   // stat properties (ac, dmg, bonus, etc.) added per-item as needed
// }

export const RARITIES = ['grey', 'green', 'blue', 'purple', 'orange', 'red'];

export const RARITY_LABEL = {
  grey:   'Common',
  green:  'Uncommon',
  blue:   'Rare',
  purple: 'Epic',
  orange: 'Legendary',
  red:    'Unique',
};

export function equipItem(hero, item) {
  if (!hero.equipment) hero.equipment = {};
  hero.equipment[item.slot] = item;
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
