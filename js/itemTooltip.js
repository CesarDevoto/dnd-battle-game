// js/itemTooltip.js — one item description, used everywhere an item is described.
//
// Shared by the loot window's hover tooltip and the equipment panel's detail pane, so a
// dropped item and an equipped item read identically. Before this, the equipment panel had
// its own renderer that knew nothing about rarity OR rolled affixes — a +5% mitigation hat
// showed no sign of the roll that made it worth keeping.
//
// Imports equipment.js only (for RARITY_LABEL), which is itself near-leaf. No cycles: nothing
// in equipment.js reaches back here.

import { RARITY_LABEL } from './equipment.js';

// Equipment keys are terse ('main-hand', 'wrist'); this is the human name for a tooltip.
const SLOT_LABEL = {
  head: 'Head', neck: 'Neck', chest: 'Chest', cloak: 'Cloak', wrist: 'Wrist',
  legs: 'Legs', hands: 'Hands', feet: 'Feet', belt: 'Belt', ring: 'Ring',
  'main-hand': 'Main Hand', 'off-hand': 'Off Hand', ammo: 'Ammo', bag: 'Bag',
};

// Weapon/armour properties that are flags rather than numbers.
function _props(item) {
  const p = [];
  if (item.light)      p.push('Light');
  if (item.finesse)    p.push('Finesse');
  if (item.thrown)     p.push('Thrown');
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
  lines.push(`<div class="it-sub rarity-text-${r}">${sub.join(' · ')}</div>`);

  // Base stats — what any copy of this base does.
  const base = [];
  if (item.dmg)   base.push(`${item.dmg} ${item.dmgType ?? ''} damage`.trim());
  if (item.ac)    base.push(`+${item.ac} AC`);
  if (item.heal)  base.push(`Heals ${item.heal} HP`);
  if (item.slots) base.push(`Container · ${item.slots} slots`);
  if (base.length) {
    lines.push('<div class="it-sep"></div>');
    base.forEach(b => lines.push(`<div class="it-stat">${b}</div>`));
  }
  const props = _props(item);
  if (props.length) lines.push(`<div class="it-props">${props.join(' · ')}</div>`);

  // ROLLED affixes — what makes THIS one different from every other copy of the base.
  // Visually separated for exactly that reason: base stats are the item, affixes are the roll.
  if (item.affixes?.length) {
    lines.push('<div class="it-sep"></div>');
    item.affixes.forEach(a => lines.push(`<div class="it-affix">${a.display}</div>`));
  }

  if (item.description) lines.push(`<div class="it-desc">${item.description}</div>`);
  if (item.value)       lines.push(`<div class="it-value">${item.value.toLocaleString()} gp</div>`);
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
