// js/lootPanel.js — post-combat loot distribution panel

import { units } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { clearLootLabels } from './loot.js';
import { registerPostCombatHandler } from './postCombat.js';

// ── Module state ──────────────────────────────────────────────────────────────
let _panelEl  = null;
let _drops    = [];   // { enemyName, coins, items[] } per enemy
let _allItems = [];   // flat list with assignedTo index (hero idx or null)
let _heroes   = [];
let _total    = { cp: 0, sp: 0, gp: 0, pp: 0 };
let _perHero  = 0;
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
    _done     = null;
  });
}

function _onDefeat() {
  _drops    = [];
  _allItems = [];
  clearLootLabels();
}

// ── Build panel DOM ───────────────────────────────────────────────────────────
function _buildPanel() {
  _heroes   = units.filter(u => u.team === 'blue' && u.hp > 0);
  _allItems = _drops.flatMap(d => d.items.map(it => ({ ...it, assignedTo: null })));

  _total = { cp: 0, sp: 0, gp: 0, pp: 0 };
  _drops.forEach(d => {
    _total.cp += d.coins.cp ?? 0;
    _total.sp += d.coins.sp ?? 0;
    _total.gp += d.coins.gp ?? 0;
    _total.pp += d.coins.pp ?? 0;
  });

  const gpEquiv = _total.gp
    + _total.pp * 10
    + Math.floor(_total.sp / 10)
    + Math.floor(_total.cp / 100);
  _perHero = _heroes.length ? Math.floor(gpEquiv / _heroes.length) : 0;

  _renderCoins();
  _renderItems();
}

function _renderCoins() {
  const parts = [];
  if (_total.pp) parts.push(`${_total.pp} pp`);
  if (_total.gp) parts.push(`${_total.gp} gp`);
  if (_total.sp) parts.push(`${_total.sp} sp`);
  if (_total.cp) parts.push(`${_total.cp} cp`);

  _panelEl.querySelector('#lp-coins').textContent =
    parts.length ? parts.join(' · ') : '—';

  _panelEl.querySelector('#lp-split').textContent = _heroes.length
    ? `Split: +${_perHero} gp each (${_heroes.length} heroes)`
    : 'No living heroes';
}

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

    const heroButtons = _heroes.map((h, hi) => {
      const hname = UNIT_TYPES[h.type]?.name?.split(' ')[0] ?? h.type;
      return `<button class="lp-hero-btn" data-item="${idx}" data-hero="${hi}">${hname}</button>`;
    }).join('');

    card.innerHTML = `
      <div class="lp-item-header">
        <span class="lp-item-rarity">${_rarityLabel(item.rarity)}</span>
        <span class="lp-item-name">${item.name}</span>
        ${item.value ? `<span class="lp-item-value">${item.value.toLocaleString()} gp</span>` : ''}
      </div>
      <div class="lp-item-desc">${item.description}</div>
      ${heroButtons ? `<div class="lp-item-assign">${heroButtons}</div>` : ''}`;

    container.appendChild(card);
  });

  container.addEventListener('click', e => {
    const btn = e.target.closest('.lp-hero-btn');
    if (!btn) return;
    const itemIdx = +btn.dataset.item;
    const heroIdx = +btn.dataset.hero;
    _allItems[itemIdx].assignedTo = heroIdx;
    const card = container.querySelector(`[data-idx="${itemIdx}"]`);
    card.querySelectorAll('.lp-hero-btn').forEach(b => {
      b.classList.toggle('lp-assigned', +b.dataset.hero === heroIdx);
    });
  });
}

function _rarityLabel(rarity) {
  const map = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', veryRare: 'Very Rare', gem: 'Gem' };
  return map[rarity] ?? rarity;
}

// ── Collect loot ──────────────────────────────────────────────────────────────
function _collectLoot() {
  // Gold split among living heroes
  _heroes.forEach(h => { h.gold = (h.gold ?? 0) + _perHero; });

  // Remainder and non-gp coins go on party leader
  if (_heroes.length) {
    const leader = _heroes[0];
    leader.partyCp = (leader.partyCp ?? 0) + _total.cp;
    leader.partySp = (leader.partySp ?? 0) + _total.sp;
    leader.partyPp = (leader.partyPp ?? 0) + _total.pp;
    const remainder = _total.gp - _perHero * _heroes.length;
    if (remainder > 0) leader.gold = (leader.gold ?? 0) + remainder;
  }

  // Assign items to chosen heroes
  _allItems.forEach(item => {
    if (item.assignedTo == null) return;
    const hero = _heroes[item.assignedTo];
    if (!hero) return;
    if (!hero.inventory) hero.inventory = [];
    hero.inventory.push({
      name:        item.name,
      rarity:      item.rarity,
      description: item.description,
      value:       item.value,
    });
  });

  _finish();
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
  clearLootLabels();
  const advance = _done;
  _done = null;
  advance?.(); // hand off to the next post-combat handler (Dagna, zone event, etc.)
}
