// js/itemTooltip.js — one item description, used everywhere an item is described.
//
// Shared by the loot window's hover tooltip and the equipment panel's detail pane, so a
// dropped item and an equipped item read identically. Before this, the equipment panel had
// its own renderer that knew nothing about rarity OR rolled affixes — a +5% mitigation hat
// showed no sign of the roll that made it worth keeping.
//
// Imports equipment.js only (for RARITY_LABEL), which is itself near-leaf. No cycles: nothing
// in equipment.js reaches back here.

import { RARITY_LABEL, itemValueCp, formatCoins, ARMOR_DEX_CAP } from './equipment.js';

// A material spelled out for the player. It's the first thing that matters about a piece of
// armor: it decides who can wear it at all (proficiency), and on chest how much DEX it grants.
// `cloth` is deliberately absent — "Cloth" on a robe is noise, and cloth needs no proficiency,
// so there's nothing to warn about.
const MATERIAL_LABEL = { leather: 'Light Armor', hide: 'Medium Armor', plate: 'Heavy Armor' };

// Equipment keys are terse ('main-hand', 'wrist'); this is the human name for a tooltip.
const SLOT_LABEL = {
  head: 'Head', neck: 'Neck', chest: 'Chest', cloak: 'Cloak', wrist: 'Wrist',
  legs: 'Legs', hands: 'Hands', feet: 'Feet', belt: 'Belt', ring: 'Ring',
  'main-hand': 'Main Hand', 'off-hand': 'Off Hand', ammo: 'Ammo', bag: 'Bag',
};

// Base stats — what ANY copy of this base does, before affixes. Exported because the loot
// card renders them too: a grey weapon rolls no affixes at all, so without this its card was
// just a name, and "Simple Greataxe" tells you nothing about whether it's worth taking.
// Shared rather than duplicated so the card and the tooltip can never disagree.
export function itemBaseStats(item) {
  const base = [];
  if (!item) return base;
  if (item.dmg)   base.push(`${item.dmg} ${item.dmgType ?? ''} damage`.trim());
  // ⚠ Armor SETS your AC; a shield ADDS to it. Rendering plate as "+18 AC" was actively
  // misleading — it reads as 10+18=28 when the true answer is exactly 18. material is what
  // tells the two apart, so a shield (no armor material) still correctly shows "+2 AC".
  //
  // The DEX suffix is read from the same ARMOR_DEX_CAP the AC math uses, so this cannot
  // claim a cap that computeAC doesn't apply.
  // ⚠ Gated on slot === 'chest', not just on having a material. AC comes from BODY ARMOUR and
  // SHIELDS only — computeAC reads chest and off-hand and nothing else. Legs and feet carry a
  // material for proficiency, and keying off material alone made 30 pairs of leggings and boots
  // advertise "AC 1 + Dex modifier": the set-your-AC wording, on a slot that grants no AC at
  // all. Those dead `ac` values are gone from items.js now; this is the guard that stops the
  // wording coming back if one is ever re-added.
  if (item.ac && item.slot === 'chest' && ARMOR_DEX_CAP[item.material] !== undefined) {
    const cap = ARMOR_DEX_CAP[item.material];
    const dex = cap === 0 ? '' : cap === Infinity ? ' + Dex modifier' : ` + Dex modifier (max ${cap})`;
    base.push(`AC ${item.ac}${dex}`);
  } else if (item.ac) {
    base.push(`+${item.ac} AC`);
  }
  if (item.heal)  base.push(`Heals ${item.heal} HP`);
  if (item.slots) base.push(`Container · ${item.slots} slots`);
  return base;
}

// Weapon/armour properties that are flags rather than numbers.
export function itemProps(item) {
  const p = [];
  if (item.light)      p.push('Light');
  if (item.finesse)    p.push('Finesse');
  // Thrown carries its own range band in 5e notation ("Thrown (range 20/60)") — for a dart
  // that IS the stat, and without it the card would claim a throwing weapon with no reach.
  if (item.thrown)     p.push(item.range
    ? `Thrown (range ${item.range}${item.longRange ? `/${item.longRange}` : ''})`
    : 'Thrown');
  if (item.heavy)      p.push('Heavy');
  if (item.reach)      p.push('Reach');
  if (item.versatile)  p.push(`Versatile (${item.versatile})`);
  if (item.ammunition) p.push('Ammunition');
  if (item.loading)    p.push('Loading');
  if (item.twoHanded)  p.push('Two-Handed');
  return p;
}

// The full item description. Ordered the way a player reads it: what it IS, what it does
// by virtue of its base, then what THIS one rolled, then flavour.
export function itemTooltipHTML(item) {
  if (!item) return '';
  const r     = item.rarity ?? 'grey';
  const lines = [];

  // Name carries the rarity colour — the fastest read in the whole tooltip.
  lines.push(`<div class="it-name rarity-text-${r}">${item.name}</div>`);
  const sub = [RARITY_LABEL[r] ?? (r === 'gem' ? 'Gem' : r)];
  if (item.slot) sub.push(SLOT_LABEL[item.slot] ?? item.slot);
  if (MATERIAL_LABEL[item.material]) sub.push(MATERIAL_LABEL[item.material]);
  lines.push(`<div class="it-sub rarity-text-${r}">${sub.join(' · ')}</div>`);

  // Base stats — what any copy of this base does. Shared with the loot card (see itemBaseStats).
  const base = itemBaseStats(item);
  if (base.length) {
    lines.push('<div class="it-sep"></div>');
    base.forEach(b => lines.push(`<div class="it-stat">${b}</div>`));
  }
  const props = itemProps(item);
  if (props.length) lines.push(`<div class="it-props">${props.join(' · ')}</div>`);

  // ROLLED affixes — what makes THIS one different from every other copy of the base.
  // Visually separated for exactly that reason: base stats are the item, affixes are the roll.
  if (item.affixes?.length) {
    lines.push('<div class="it-sep"></div>');
    item.affixes.forEach(a => lines.push(`<div class="it-affix">${a.display}</div>`));
  }

  if (item.description) lines.push(`<div class="it-desc">${item.description}</div>`);

  // Sell value, last line — it's the tiebreaker you look at after everything else, and it's
  // what a merchant will pay once towns have them (Phandalin first). Derived from rarity, so
  // it tracks the roll: the same base is worth 4cp grey and 10,000gp red.
  const coins = formatCoins(itemValueCp(item));
  if (coins) lines.push(`<div class="it-value">Sells for ${coins}</div>`);
  return lines.join('');
}

// ── Floating hover tooltip ────────────────────────────────────────────────────
// One element on <body>, reused. On body rather than inside the panel so it can overhang
// the panel's edges instead of being clipped by its overflow.
let _tipEl = null;

export function showItemTooltip(item, x, y) {
  hideItemTooltip();
  const html = itemTooltipHTML(item);
  if (!html) return;
  _tipEl = document.createElement('div');
  _tipEl.className = 'item-tooltip';
  _tipEl.innerHTML = html;
  document.body.appendChild(_tipEl);
  moveItemTooltip(x, y);
}

// Offset from the cursor so the pointer never covers the name, and pulled back inside the
// viewport if it would spill. Measured after append — height depends on the affix count.
export function moveItemTooltip(x, y) {
  if (!_tipEl) return;
  const r = _tipEl.getBoundingClientRect();
  _tipEl.style.left = Math.max(4, Math.min(x + 16, window.innerWidth  - r.width  - 6)) + 'px';
  _tipEl.style.top  = Math.max(4, Math.min(y + 16, window.innerHeight - r.height - 6)) + 'px';
}

export function hideItemTooltip() {
  _tipEl?.remove();
  _tipEl = null;
}
