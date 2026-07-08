// js/lootPanel.js — post-combat loot distribution panel

import { units, heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { AVATAR_SRC } from './heroPortraits.js';
import { clearLootLabels } from './loot.js';
import { registerPostCombatHandler } from './postCombat.js';

const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

// ── Module state ──────────────────────────────────────────────────────────────
let _panelEl  = null;
let _drops    = [];   // { enemyName, coins, items[] } per enemy
let _allItems = [];   // flat list; assignedTo is a hero object, 'destroy', or null
let _heroes   = [];
let _total    = { cp: 0, sp: 0, gp: 0, pp: 0 };
let _split    = { per: { cp: 0, sp: 0, gp: 0, pp: 0 }, rem: { cp: 0, sp: 0, gp: 0, pp: 0 } };
let _done     = null; // post-combat sequencer callback

// ── Register as first post-combat handler (priority 10) ──────────────────────
// Runs only on victory. If there are drops, shows the panel and waits for
// player input before calling done() to advance the sequence.
// On defeat the panel never shows — zone:defeat listener clears orbs instead.
registerPostCombatHandler(10, (ctx, done) => {
  if (!_drops.length) { done(); return; }
  _done = done;
  _buildPanel();
  _panelEl.style.display = 'flex';
});

// ── Init ──────────────────────────────────────────────────────────────────────
export function initLootPanel() {
  _panelEl = document.getElementById('loot-panel');
  document.getElementById('lp-collect-btn')?.addEventListener('click', _collectLoot);
  document.getElementById('lp-skip-btn')?.addEventListener('click', _skipLoot);
  // Accumulate drops as enemies die. If the panel is already showing (second
  // combat wave while loot is unresolved), rebuild it so new drops are visible.
  window.addEventListener('enemy:looted', e => {
    _drops.push(e.detail);
    if (_done !== null && _panelEl?.style.display !== 'none') _buildPanel();
  });
  // On party wipe: clear orbs and drops silently — no panel
  window.addEventListener('zone:defeat', _onDefeat);
  // Zone transition while panel is open (edge case): abort cleanly without
  // calling advance() — the new zone reinitialises all combat state anyway.
  window.addEventListener('zone:loaded', () => {
    if (_panelEl) _panelEl.style.display = 'none';
    _drops    = [];
    _allItems = [];
    _heroes   = [];
    _total    = { cp: 0, sp: 0, gp: 0, pp: 0 };
    _split    = { per: { cp: 0, sp: 0, gp: 0, pp: 0 }, rem: { cp: 0, sp: 0, gp: 0, pp: 0 } };
    _done     = null;
  });
}

function _onDefeat() {
  _drops    = [];
  _allItems = [];
  clearLootLabels();
}

// ── Reusable reward window (non-combat gifts, e.g. Floosh's dung) ─────────────
// Shows the same assign-to-hero panel for a handed-out reward instead of combat
// drops: no coins, can't be declined, and onDone fires when the player collects.
function _setChrome({ title, sub, coins, skip, collect }) {
  const q = sel => _panelEl?.querySelector(sel);
  if (q('#lp-title'))          q('#lp-title').textContent   = title;
  if (q('#lp-sub'))            q('#lp-sub').textContent     = sub;
  if (q('#lp-coins-section'))  q('#lp-coins-section').style.display = coins ? '' : 'none';
  if (q('#lp-skip-btn'))       q('#lp-skip-btn').style.display      = skip ? '' : 'none';
  if (q('#lp-collect-btn'))    q('#lp-collect-btn').textContent     = collect;
}
function _restoreCombatChrome() {
  _setChrome({ title: 'LOOT', sub: 'The battle is won. Claim your spoils.', coins: true, skip: true, collect: 'Collect Loot' });
}

export function showLootReward(items, onDone, { title = 'REWARD', sub = '' } = {}) {
  if (!_panelEl) { onDone?.(); return; }
  _drops    = [];
  _heroes   = units.filter(u => u.team === 'blue' && u.hp > 0);
  _allItems = items.map(it => ({ ...it, assignedTo: null }));
  _total    = { cp: 0, sp: 0, gp: 0, pp: 0 };
  _split    = { per: { cp: 0, sp: 0, gp: 0, pp: 0 }, rem: { cp: 0, sp: 0, gp: 0, pp: 0 } };
  _done     = onDone ?? null;
  _setChrome({ title, sub, coins: false, skip: false, collect: 'Take It' });
  _renderItems();
  _updateCollectBtnState();
  _panelEl.style.display = 'flex';
}

// ── Build panel DOM ───────────────────────────────────────────────────────────
function _buildPanel() {
  _restoreCombatChrome();
  _heroes   = units.filter(u => u.team === 'blue' && u.hp > 0);
  _allItems = _drops.flatMap(d => d.items.map(it => ({ ...it, assignedTo: null })));

  _total = { cp: 0, sp: 0, gp: 0, pp: 0 };
  _drops.forEach(d => {
    _total.cp += d.coins.cp ?? 0;
    _total.sp += d.coins.sp ?? 0;
    _total.gp += d.coins.gp ?? 0;
    _total.pp += d.coins.pp ?? 0;
  });

  // Split each denomination evenly across living heroes; whatever doesn't
  // divide evenly goes to the party leader so no coins vanish.
  const n = _heroes.length;
  _split = { per: {}, rem: {} };
  for (const type of ['cp', 'sp', 'gp', 'pp']) {
    const per = n ? Math.floor(_total[type] / n) : 0;
    _split.per[type] = per;
    _split.rem[type] = _total[type] - per * n;
  }

  _renderCoins();
  _renderItems();
  _updateCollectBtnState();
}

function _renderCoins() {
  const parts = [];
  if (_total.pp) parts.push(`${_total.pp} pp`);
  if (_total.gp) parts.push(`${_total.gp} gp`);
  if (_total.sp) parts.push(`${_total.sp} sp`);
  if (_total.cp) parts.push(`${_total.cp} cp`);

  _panelEl.querySelector('#lp-coins').textContent =
    parts.length ? parts.join(' · ') : '—';

  if (_heroes.length) {
    const splitParts = [];
    if (_split.per.pp) splitParts.push(`${_split.per.pp} pp`);
    if (_split.per.gp) splitParts.push(`${_split.per.gp} gp`);
    if (_split.per.sp) splitParts.push(`${_split.per.sp} sp`);
    if (_split.per.cp) splitParts.push(`${_split.per.cp} cp`);
    _panelEl.querySelector('#lp-split').textContent = splitParts.length
      ? `Split: +${splitParts.join(' ')} each (${_heroes.length} heroes)`
      : `Split: nothing to divide (${_heroes.length} heroes)`;
  } else {
    _panelEl.querySelector('#lp-split').textContent = 'No living heroes';
  }
}

// Every item must be assigned to a hero or marked for destruction before the
// player can collect the currency — forces a decision on each drop instead of
// silently discarding whatever's left unassigned.
function _renderItems() {
  const container = _panelEl.querySelector('#lp-items');
  container.innerHTML = '';

  if (!_allItems.length) {
    container.innerHTML = '<div class="lp-no-items">No items found.</div>';
    return;
  }

  _allItems.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = `lp-item-card lp-rarity-${item.rarity}`;
    card.dataset.idx = idx;

    const heroBoxes = HERO_ORDER.map(type => {
      const h = heroRoster.find(u => u.type === type);
      if (!h) return '';
      const name     = UNIT_TYPES[type]?.name ?? type;
      const assigned = item.assignedTo === h ? ' lp-assigned' : '';
      return `<button class="lp-assign-box${assigned}" data-item="${idx}" data-hero="${type}" title="${name}">` +
        `<img class="lp-assign-avatar" src="${AVATAR_SRC[type] ?? ''}" alt="${name}"></button>`;
    }).join('');
    const destroyed = item.assignedTo === 'destroy' ? ' lp-assigned' : '';
    const destroyBox = `<button class="lp-assign-box lp-assign-destroy${destroyed}" data-item="${idx}" data-hero="destroy" title="Destroy">✕</button>`;

    card.innerHTML = `
      <div class="lp-item-header">
        ${item.icon ? `<img class="lp-item-icon" src="${item.icon}" alt="${item.name}">` : ''}
        <span class="lp-item-rarity">${_rarityLabel(item.rarity)}</span>
        <span class="lp-item-name">${item.name}</span>
        ${item.value ? `<span class="lp-item-value">${item.value.toLocaleString()} gp</span>` : ''}
      </div>
      <div class="lp-item-desc">${item.description ?? ''}</div>
      <div class="lp-item-assign">${heroBoxes}${destroyBox}</div>`;

    container.appendChild(card);
  });

  container.addEventListener('click', e => {
    const btn = e.target.closest('.lp-assign-box');
    if (!btn) return;
    const itemIdx  = +btn.dataset.item;
    const heroType = btn.dataset.hero;
    _allItems[itemIdx].assignedTo = heroType === 'destroy'
      ? 'destroy'
      : (heroRoster.find(u => u.type === heroType) ?? null);
    const card = container.querySelector(`[data-idx="${itemIdx}"]`);
    card.querySelectorAll('.lp-assign-box').forEach(b => {
      b.classList.toggle('lp-assigned', b.dataset.hero === heroType);
    });
    _updateCollectBtnState();
  });
}

function _updateCollectBtnState() {
  const btn = _panelEl?.querySelector('#lp-collect-btn');
  if (!btn) return;
  const allAssigned = _allItems.every(it => it.assignedTo != null);
  btn.disabled = !allAssigned;
  btn.title = allAssigned ? '' : 'Assign every item to a hero or destroy it before collecting';
}

function _rarityLabel(rarity) {
  const map = {
    common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very Rare', gem: 'Gem',
    grey: 'Common', green: 'Uncommon', blue: 'Rare', purple: 'Epic', orange: 'Legendary', red: 'Unique',
  };
  return map[rarity] ?? rarity;
}

// ── Collect loot ──────────────────────────────────────────────────────────────
const _CURRENCY_KEY = { cp: 'copper', sp: 'silver', gp: 'gold', pp: 'platinum' };

function _collectLoot() {
  // Every denomination (copper/silver/gold/platinum) is split evenly across
  // all living heroes and written to the same hero.currency fields the
  // character sheet reads — not a gp-equivalent lump sum on one hero.
  _heroes.forEach(h => {
    if (!h.currency) h.currency = { copper: 0, silver: 0, gold: 0, platinum: 0 };
    for (const type of ['cp', 'sp', 'gp', 'pp']) {
      h.currency[_CURRENCY_KEY[type]] += _split.per[type];
    }
  });

  // Remainder (whatever didn't divide evenly) goes to the party leader.
  if (_heroes.length) {
    const leader = _heroes[0];
    for (const type of ['cp', 'sp', 'gp', 'pp']) {
      leader.currency[_CURRENCY_KEY[type]] += _split.rem[type];
    }
  }

  // Hand off items to their assigned hero's bags (or drop them if destroyed).
  // _updateCollectBtnState() keeps this button disabled until every item has
  // an assignedTo, so there's nothing left unresolved here.
  _allItems.forEach(item => {
    if (item.assignedTo === 'destroy' || item.assignedTo == null) return;
    _placeInFirstEmptyBagSlot(item.assignedTo, item);
  });

  _finish();
}

// Bag-1 slot 0 is reserved exclusively for healing potions (any item with a
// `heal` field — today just Potion of Lesser Healing, but greater tiers can
// slot into the same reserved spot later). Non-potions can never land there.
function _isHealingPotion(item) { return !!item.heal; }

// Walks a hero's bag-1..bag-4 slots in order and drops the item into the
// first empty (or same-item, for stacking) slot. Bag `.contents` arrays are
// created lazily (same as the equipment panel's bag view) so this works even
// if the bag's never been opened.
function _placeInFirstEmptyBagSlot(hero, item) {
  const { assignedTo, ...cleanItem } = item;
  const isPotion = _isHealingPotion(cleanItem);

  if (isPotion) {
    const bag1 = hero.equipment?.['bag-1'];
    if (bag1?.slots) {
      if (!bag1.contents) bag1.contents = new Array(bag1.slots).fill(null);
      const slot0 = bag1.contents[0];
      if (slot0 == null) {
        bag1.contents[0] = { ...cleanItem, qty: 1 };
        return true;
      }
      if (slot0.id === cleanItem.id) {
        slot0.qty = (slot0.qty ?? 1) + 1;
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
  return false; // every bag is full — item is lost, same as destroying it
}

function _skipLoot() {
  _finish();
}

// ── Shared teardown — advances the post-combat sequence ──────────────────────
function _finish() {
  _panelEl.style.display = 'none';
  _drops    = [];
  _allItems = [];
  _heroes   = [];
  _total    = { cp: 0, sp: 0, gp: 0, pp: 0 };
  _split    = { per: { cp: 0, sp: 0, gp: 0, pp: 0 }, rem: { cp: 0, sp: 0, gp: 0, pp: 0 } };
  clearLootLabels();
  const advance = _done;
  _done = null;
  advance?.(); // hand off to the next post-combat handler (Dagna, zone event, etc.)
}
