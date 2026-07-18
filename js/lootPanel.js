// js/lootPanel.js — post-combat loot distribution panel

import { units, heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { AVATAR_SRC } from './heroPortraits.js';
import { clearLootLabels } from './loot.js';
import { noteAssigned } from './lootCoverage.js';
import { registerPostCombatHandler } from './postCombat.js';
import { placeInFirstEmptyBagSlot, itemValueCp, formatCoins, equipBlockReason } from './equipment.js';
import { showItemTooltip, moveItemTooltip, hideItemTooltip, itemBaseStats, itemProps } from './itemTooltip.js';

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
// Bound ONCE. #lp-items is static in index.html; only its children are rebuilt, so delegating
// here survives every re-render and can't stack duplicates the way per-render binding did.
function _bindItemsContainer() {
  const container = _panelEl?.querySelector('#lp-items');
  if (!container) return;

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

  // Hover the item's IMAGE to read it before deciding — name in its rarity colour, base
  // stats, and the affixes THIS one rolled. The card itself only has room for a name, and
  // the roll is the whole reason one Cloth Hood is worth keeping over another.
  const _itemAt = e => {
    const icon = e.target.closest('.lp-item-icon');
    const card = icon?.closest('[data-idx]');
    return card ? _allItems[+card.dataset.idx] : null;
  };
  container.addEventListener('mouseover', e => {
    const it = _itemAt(e);
    if (it) showItemTooltip(it, e.clientX, e.clientY);
  });
  container.addEventListener('mousemove', e => {
    if (_itemAt(e)) moveItemTooltip(e.clientX, e.clientY);
    else hideItemTooltip();   // slid off the icon without leaving the container
  });
  container.addEventListener('mouseleave', hideItemTooltip);
}

export function initLootPanel() {
  _panelEl = document.getElementById('loot-panel');
  document.getElementById('lp-collect-btn')?.addEventListener('click', _collectLoot);
  document.getElementById('lp-skip-btn')?.addEventListener('click', _skipLoot);
  _bindItemsContainer();
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
    hideItemTooltip();
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
      // Armor proficiency gates who this drop can even go to. Disabled rather than hidden:
      // four boxes that stay in the same place every time are scannable, and the title says
      // WHY. The click handler ignores disabled buttons, so this is also the enforcement.
      const blocked  = equipBlockReason(h, item);
      const title    = blocked ? `${name} — ${blocked}` : name;
      return `<button class="lp-assign-box${assigned}${blocked ? ' lp-assign-blocked' : ''}" ` +
        `data-item="${idx}" data-hero="${type}" title="${title}"${blocked ? ' disabled' : ''}>` +
        `<img class="lp-assign-avatar" src="${AVATAR_SRC[type] ?? ''}" alt="${name}"></button>`;
    }).join('');
    const destroyed = item.assignedTo === 'destroy' ? ' lp-assigned' : '';
    const destroyBox = `<button class="lp-assign-box lp-assign-destroy${destroyed}" data-item="${idx}" data-hero="destroy" title="Destroy">✕</button>`;

    // ROLLED affixes, inline on the card — the roll is the entire basis for the decision this
    // panel is asking for ("which hero gets this?"), so it must be readable without hovering
    // every icon in turn. Same `a.display` strings the tooltip uses, so the two can never
    // disagree about what an item does.
    //
    // Absent for grey items, which roll no affixes at all — the block collapses rather than
    // leaving an empty gap above the assign row.
    const affixHtml = item.affixes?.length
      ? `<div class="lp-item-affixes">${item.affixes.map(a => `<div class="lp-affix">${a.display}</div>`).join('')}</div>`
      : '';

    // BASE stats — damage dice, AC, properties. Shown for every rarity INCLUDING grey (user,
    // 2026-07-18): grey rolls no affixes by design, so without this a "Simple Greataxe" card
    // was a bare name and gave no basis at all for the assign decision the panel demands.
    // Shared with the tooltip via itemBaseStats/itemProps so the two can't disagree.
    const stats = itemBaseStats(item);
    const props = itemProps(item);
    const statsHtml = (stats.length || props.length)
      ? `<div class="lp-item-stats">` +
        stats.map(s => `<div class="lp-stat">${s}</div>`).join('') +
        (props.length ? `<div class="lp-props">${props.join(' · ')}</div>` : '') +
        `</div>`
      : '';

    card.innerHTML = `
      <div class="lp-item-header">
        ${item.icon ? `<img class="lp-item-icon" src="${item.icon}" alt="${item.name}">` : ''}
        <span class="lp-item-rarity">${_rarityLabel(item.rarity)}</span>
        <span class="lp-item-name">${item.name}</span>
        ${_valueTag(item)}
      </div>
      ${statsHtml}
      ${affixHtml}
      <div class="lp-item-desc">${item.description ?? ''}</div>
      <div class="lp-item-assign">${heroBoxes}${destroyBox}</div>`;

    container.appendChild(card);
  });

  // NB: no listeners are attached here — see _bindItemsContainer(), bound once at init.
  // They used to live in this function, which re-runs on every enemy:looted while the panel
  // is open, so each rebuild stacked another click handler on the same container.
}

function _updateCollectBtnState() {
  const btn = _panelEl?.querySelector('#lp-collect-btn');
  if (!btn) return;
  const allAssigned = _allItems.every(it => it.assignedTo != null);
  btn.disabled = !allAssigned;
  btn.title = allAssigned ? '' : 'Assign every item to a hero or destroy it before collecting';
}

// Sell value on the card. Every item has one now (it derives from rarity), where before only
// gems and quest pieces carried an explicit `value` — so this went from a rare tag to a
// normal one, and it's in copper so a grey reads "4 cp" rather than "0.04 gp".
function _valueTag(item) {
  const coins = formatCoins(itemValueCp(item));
  return coins ? `<span class="lp-item-value">${coins}</span>` : '';
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
  // A false return means every bag was full: the item is lost, same as destroying it.
  _allItems.forEach(item => {
    if (item.assignedTo === 'destroy' || item.assignedTo == null) return;
    // Loot coverage: THIS is the moment the game learns who a drop was actually for, which
    // is why the counter lives here and not at drop time. Future drops in this slot+tier
    // will favour whichever hero is furthest behind. Destroyed items deliberately don't
    // count — nobody got covered.
    noteAssigned(item.slot, item.rarity, item.assignedTo.type);
    placeInFirstEmptyBagSlot(item.assignedTo, item);
  });

  _finish();
}

function _skipLoot() {
  _finish();
}

// ── Shared teardown — advances the post-combat sequence ──────────────────────
function _finish() {
  hideItemTooltip();   // the panel can vanish out from under a hovered icon
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
