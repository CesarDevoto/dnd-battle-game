// js/items.js — equippable item catalog (see js/equipment.js for the item schema)

export const ITEMS = {
  handaxe: {
    id:     'handaxe',
    name:   'Handaxe',
    slot:   'main-hand',
    rarity: 'grey',
    icon:   'assets/items/weapons/handaxe.png',
    dmg:    '1d6',
    dmgType: 'slashing',
  },
  battleaxe: {
    id:     'battleaxe',
    name:   'Battleaxe',
    slot:   'main-hand',
    rarity: 'grey',
    icon:   'assets/items/weapons/battleaxe.png',
    dmg:    '1d8',
    dmgType: 'slashing',
  },
  greataxe: {
    id:     'greataxe',
    name:   'Greataxe',
    slot:   'main-hand',
    rarity: 'grey',
    icon:   'assets/items/weapons/greataxe.png',
    dmg:    '1d12',
    dmgType: 'slashing',
  },

  leatherarmor1: {
    id:     'leatherarmor1',
    name:   'Leather Armor',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/leatherarmor1.png',
    ac:     11,
  },
  hidearmor1: {
    id:     'hidearmor1',
    name:   'Hide Armor',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/hidearmor1.png',
    ac:     12,
  },
  hidearmor2: {
    id:     'hidearmor2',
    name:   'Hide Armor II',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/hidearmor2.png',
    ac:     12,
  },
  bronzearmor: {
    id:     'bronzearmor',
    name:   'Breastplate',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/bronzearmor.png',
    ac:     14,
  },
  platearmor1: {
    id:     'platearmor1',
    name:   'Plate Armor',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/platearmor1.png',
    ac:     18,
  },
  platearmor2: {
    id:     'platearmor2',
    name:   'Plate Armor II',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/platearmor2.png',
    ac:     18,
  },
  platearmor3: {
    id:     'platearmor3',
    name:   'Plate Armor III',
    slot:   'chest',
    rarity: 'grey',
    icon:   'assets/items/armor/platearmor3.png',
    ac:     18,
  },
};

export function getItem(id) {
  const def = ITEMS[id];
  return def ? { ...def } : null;
}
