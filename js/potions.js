// js/potions.js — consumable item catalog (flasks/potions; no equipment slot)
//
// Potion schema:
// {
//   id:     String  — unique key e.g. 'potion1'
//   name:   String  — display name e.g. 'Potion'
//   rarity: String  — 'grey'|'green'|'blue'|'purple'|'orange'|'red'
//   icon:   String  — path to icon PNG, e.g. 'assets/items/potions/potion1.png'
//   // effect properties (heal, buff, value, etc.) added per-item as needed
// }

export const POTIONS = {
  flask1: { id: 'flask1', name: 'Flask',    rarity: 'grey', icon: 'assets/items/potions/flask1.png' },
  flask2: { id: 'flask2', name: 'Flask II', rarity: 'grey', icon: 'assets/items/potions/flask2.png' },
  flask3: { id: 'flask3', name: 'Flask III', rarity: 'grey', icon: 'assets/items/potions/flask3.png' },
  flask4: { id: 'flask4', name: 'Flask IV', rarity: 'grey', icon: 'assets/items/potions/flask4.png' },

  potion1:  { id: 'potion1',  name: 'Potion',      rarity: 'grey', icon: 'assets/items/potions/potion1.png' },
  potion2:  { id: 'potion2',  name: 'Potion II',   rarity: 'grey', icon: 'assets/items/potions/potion2.png' },
  potion3:  { id: 'potion3',  name: 'Potion III',  rarity: 'grey', icon: 'assets/items/potions/potion3.png' },
  potion4:  { id: 'potion4',  name: 'Potion IV',   rarity: 'grey', icon: 'assets/items/potions/potion4.png' },
  potion5:  { id: 'potion5',  name: 'Potion V',    rarity: 'grey', icon: 'assets/items/potions/potion5.png' },
  potion6:  { id: 'potion6',  name: 'Potion VI',   rarity: 'grey', icon: 'assets/items/potions/potion6.png' },
  potion7:  { id: 'potion7',  name: 'Potion VII',  rarity: 'grey', icon: 'assets/items/potions/potion7.png' },
  potion8:  { id: 'potion8',  name: 'Potion VIII', rarity: 'grey', icon: 'assets/items/potions/potion8.png' },
  potion9:  { id: 'potion9',  name: 'Potion IX',   rarity: 'grey', icon: 'assets/items/potions/potion9.png' },
  potion10: { id: 'potion10', name: 'Potion X',    rarity: 'grey', icon: 'assets/items/potions/potion10.png' },
  potion11: { id: 'potion11', name: 'Potion XI',   rarity: 'grey', icon: 'assets/items/potions/potion11.png' },
  potion12: { id: 'potion12', name: 'Potion XII',  rarity: 'grey', icon: 'assets/items/potions/potion12.png' },
  potion13: { id: 'potion13', name: 'Potion XIII', rarity: 'grey', icon: 'assets/items/potions/potion13.png' },
  potion14: { id: 'potion14', name: 'Potion XIV',  rarity: 'grey', icon: 'assets/items/potions/potion14.png' },
};

export function getPotion(id) {
  const def = POTIONS[id];
  return def ? { ...def } : null;
}
