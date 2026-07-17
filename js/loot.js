// js/loot.js — D&D 2024 individual treasure tables + 3D loot orbs

import * as THREE from 'three';
import { scene } from './scene.js';
import { getPotion } from './potions.js';
import { getItem, ITEMS, isDroppable } from './items.js';
import { rollAffixes } from './affixes.js';
import { coveragePool } from './lootCoverage.js';
// Safe: units.js does NOT import loot.js, so this is a one-way edge, not a cycle.
// heroRoster is the LIVE array and is never cleared on death — a fallen hero still needs
// gear, so coverage deliberately keeps counting them.
import { heroRoster } from './units.js';

// ── Dice helpers ──────────────────────────────────────────────────────────────
function _d(n)        { return Math.ceil(Math.random() * n); }
function _roll(c, n)  { let t = 0; for (let i = 0; i < c; i++) t += _d(n); return t; }
function _pct()       { return Math.random() * 100; }

// ── CR bracket ────────────────────────────────────────────────────────────────
//   0: CR 0–½   1: CR 1–2   2: CR 3–8   3: CR 9–16   4: CR 17+
function _bracket(cr) {
  if (cr <= 0.5) return 0;
  if (cr <= 2)   return 1;
  if (cr <= 8)   return 2;
  if (cr <= 16)  return 3;
  return 4;
}

// ── D&D 2024 Individual Treasure — coin tables ────────────────────────────────
function _rollCoins(b) {
  const r = _pct();
  switch (b) {
    case 0: // Pocket Change (CR 0–½)
      if (r < 30) return { cp: _roll(3,6),                       sp: 0,            gp: 0,                     pp: 0 };
      if (r < 60) return { cp: 0,                                sp: _roll(1,6),   gp: 0,                     pp: 0 };
      if (r < 85) return { cp: _roll(1,6),                       sp: _roll(2,6),   gp: 0,                     pp: 0 };
      if (r < 95) return { cp: 0,                                sp: _roll(1,4),   gp: _roll(1,4),            pp: 0 };
      return             { cp: 0,                                sp: 0,            gp: _roll(1,6),            pp: 0 };

    case 1: // Low (CR 1–2)
      if (r < 30) return { cp: _roll(2,6),                       sp: _roll(2,6),   gp: 0,                     pp: 0 };
      if (r < 60) return { cp: 0,                                sp: _roll(1,6),   gp: _roll(2,4),            pp: 0 };
      if (r < 85) return { cp: 0,                                sp: 0,            gp: _roll(3,6),            pp: 0 };
      if (r < 95) return { cp: 0,                                sp: 0,            gp: _roll(1,4)*10 + _roll(1,6), pp: 0 };
      return             { cp: 0,                                sp: 0,            gp: _roll(2,4)*10,         pp: 0 };

    case 2: // Medium-Low (CR 3–8)
      if (r < 20) return { cp: 0, sp: 0,            gp: _roll(3,6)*10,                         pp: 0 };
      if (r < 50) return { cp: 0, sp: _roll(1,6)*10, gp: _roll(2,4)*10,                        pp: 0 };
      if (r < 80) return { cp: 0, sp: 0,            gp: _roll(1,4)*100,                        pp: 0 };
      if (r < 95) return { cp: 0, sp: 0,            gp: _roll(1,6)*100 + _roll(1,4)*10,        pp: 0 };
      return             { cp: 0, sp: 0,            gp: _roll(2,4)*100,                        pp: _roll(1,4) };

    case 3: // Medium (CR 9–16)
      if (r < 20) return { cp: 0, sp: 0, gp: _roll(2,6)*100,                                   pp: 0 };
      if (r < 50) return { cp: 0, sp: 0, gp: _roll(2,4)*100,                                   pp: _roll(1,6) };
      if (r < 80) return { cp: 0, sp: 0, gp: _roll(1,4)*1000,                                  pp: _roll(1,6)*10 };
      if (r < 95) return { cp: 0, sp: 0, gp: _roll(2,6)*1000,                                  pp: _roll(2,6)*10 };
      return             { cp: 0, sp: 0, gp: _roll(2,4)*1000,                                  pp: _roll(1,4)*100 };

    default: // High (CR 17+)
      if (r < 15) return { cp: 0, sp: 0, gp: _roll(4,6)*100,                                   pp: _roll(1,4) };
      if (r < 40) return { cp: 0, sp: 0, gp: _roll(2,6)*1000,                                  pp: _roll(1,6)*10 };
      if (r < 70) return { cp: 0, sp: 0, gp: _roll(4,6)*1000,                                  pp: _roll(2,6)*10 };
      if (r < 90) return { cp: 0, sp: 0, gp: _roll(2,4)*10000,                                 pp: _roll(1,6)*100 };
      return             { cp: 0, sp: 0, gp: _roll(4,6)*10000,                                 pp: _roll(2,4)*100 };
  }
}

// ── D&D 2024 Gem tables ───────────────────────────────────────────────────────
const _GEMS = {
  10:   ['Azurite','Blue Quartz','Hematite','Lapis Lazuli','Malachite','Obsidian','Quartz'],
  50:   ['Bloodstone','Carnelian','Chalcedony','Chrysoprase','Citrine','Jasper','Moonstone','Onyx','Zircon'],
  100:  ['Amber','Amethyst','Chrysoberyl','Coral','Garnet','Jade','Jet','Pearl','Spinel','Tourmaline'],
  500:  ['Alexandrite','Aquamarine','Black Pearl','Blue Spinel','Peridot','Topaz'],
  1000: ['Black Opal','Blue Sapphire','Emerald','Fire Opal','Opal','Star Ruby','Star Sapphire'],
  5000: ['Black Sapphire','Diamond','Jacinth','Ruby'],
};
const _GEM_TIERS = [10, 10, 100, 500, 1000, 5000];

function _pickGem(bracket) {
  const tier = _GEM_TIERS[Math.min(bracket, _GEM_TIERS.length - 1)];
  const list  = _GEMS[tier];
  const name  = list[Math.floor(Math.random() * list.length)];
  return { name, rarity: 'gem', description: `A ${name.toLowerCase()} worth ${tier} gp.`, value: tier };
}

// ══════════════════════════════════════════════════════════════════════════════
//  ITEM DROP MODEL — see docs/loot-affix-design.md → "Drop model"
// ══════════════════════════════════════════════════════════════════════════════
// (Replaces the magic-item tables pulled on 2026-07-02. Until now the ONLY item drops were
// the Lesser Healing Potion and two scripted quest pieces, so the 356-item catalog in
// items.js was orphaned — nothing referenced it as a drop source.)
//
// TWO rolls per kill: how MANY items, then WHAT QUALITY each is.
//
// 1. QUALITY:  Q = 1d100 + 90 × √(CR/10)  → a rarity band, or nothing.
//    One roll settles both "did anything drop" and "how good". Rarity gating falls out of
//    the arithmetic for free — a goblin (CR ¼) tops out at Q≈114 and so CANNOT reach green's
//    116 floor. No separate min-CR rule to keep in sync.
//    The shift is CURVED on purpose: a straight CR×W steep enough to clear `nothing` by
//    CR 10 would also hand a CR 10 enemy a red drop, since red sits only ~140 above
//    nothing's edge. Steep early and shallow late is not a line.
const _QUALITY_BANDS = [
  { rarity: null,     upTo: 80  },   // nothing
  { rarity: 'grey',   upTo: 115 },
  { rarity: 'green',  upTo: 139 },
  { rarity: 'blue',   upTo: 164 },
  { rarity: 'purple', upTo: 200 },
  { rarity: 'orange', upTo: 219 },
  { rarity: 'red',    upTo: Infinity },
];
function _rollRarity(cr) {
  const q = _d(100) + 90 * Math.sqrt(Math.max(0, cr ?? 0) / 10);
  return (_QUALITY_BANDS.find(b => q <= b.upTo) ?? _QUALITY_BANDS[_QUALITY_BANDS.length - 1]).rarity;
}

// 2. COUNT: how many quality rolls this kill gets. 0% extra below CR 5; a 3rd opens at CR 10.
//    The two are CUMULATIVE (P(≥3) ⊆ P(≥2)), so they're tested high-to-low.
//    `start + slope` rather than one (CR−n)×k: that form can't set a value AND a slope
//    independently — (CR−4)×10 gives the wanted 10% at CR 5 but saturates at 100% by CR 14.
function _rollDropCount(cr) {
  const c  = Math.max(0, cr ?? 0);
  const p2 = c < 5  ? 0 : Math.min(100, 10 + (c - 5) * 3);
  const p3 = c < 10 ? 0 : Math.min(100, 5  + (c - 10) * 2);
  const r  = _pct();
  if (r < p3) return 3;
  if (r < p2) return 2;
  return 1;
}

// Everything the random table can hand out. `isDroppable` is shared with lootCoverage.js so
// the drop pool and the coverage index can't disagree about what exists. Built once — ITEMS
// is static.
const _DROP_POOL = Object.values(ITEMS).filter(isDroppable);

// ── Slot balance ──────────────────────────────────────────────────────────────
// ⚠ Picking uniformly from _DROP_POOL makes drop frequency an ACCIDENT OF ART COUNT. We had
// 58 main-hand items and 11 neck items, so a main-hand was 5x likelier than a neck purely
// because more weapons got drawn — nobody decided that. Adding a picture silently rebalanced
// the game. So: pick the SLOT first from this table, then an item uniformly WITHIN it. Art
// count now only decides WHICH sword you get, never how often you get a sword at all.
//
// Weights are the tuning surface and are RELATIVE — they don't need to sum to anything.
//   • Pairs (wrist, ring) get 2: you fill two of them, so double the drops is the same
//     fill rate per physical slot, not twice the generosity.
//   • Bags get 0.5: you need four, but they're a one-time fill rather than an upgrade
//     treadmill, so a steady stream of them is dead loot.
// A slot missing from this table can never drop (ammo has no items yet, so it's absent).
const _SLOT_WEIGHTS = {
  head: 1, neck: 1, chest: 1, cloak: 1, legs: 1, hands: 1, feet: 1, belt: 1,
  'main-hand': 1, 'off-hand': 1,
  wrist: 2, ring: 2,
  bag: 0.5,
};

// Bucket the pool once — ITEMS is static, so this is built at module load like _DROP_POOL.
const _POOL_BY_SLOT = {};
for (const it of _DROP_POOL) (_POOL_BY_SLOT[it.slot] ??= []).push(it);

// Only slots that BOTH have a weight and actually have items. Guards against a weight for a
// slot with no art (silently impossible) and art for a slot with no weight (silently unreachable).
const _WEIGHTED_SLOTS = Object.keys(_POOL_BY_SLOT).filter(s => _SLOT_WEIGHTS[s] > 0);
const _TOTAL_WEIGHT   = _WEIGHTED_SLOTS.reduce((sum, s) => sum + _SLOT_WEIGHTS[s], 0);

function _pickSlot() {
  let r = Math.random() * _TOTAL_WEIGHT;
  for (const s of _WEIGHTED_SLOTS) {
    r -= _SLOT_WEIGHTS[s];
    if (r < 0) return s;
  }
  return _WEIGHTED_SLOTS[_WEIGHTED_SLOTS.length - 1];   // float dust only
}

// Coverage — the "don't let RNG starve one hero" model — lives in lootCoverage.js. It's a
// leaf (items.js + equipment.js), deliberately: this module imports three.js and the scene
// for its 3D orbs, which would make the probability model impossible to test outside a
// browser. See that file for the formula and the measurements behind it.

// One drop: a random BASE wearing the ROLLED rarity, plus affixes rolled from that slot's
// table. This is the rolled model — the base supplies name/icon/slot/material, the roll
// supplies the tier and the numbers. `rarity` deliberately overwrites the base's own literal
// (every catalog item says 'grey'), which is why bases don't need per-rarity duplicates.
//
// affixes is [] for any slot without a table yet (14 of 15 today) — those drop as plain
// bases, exactly as they did before, so nothing regresses while the tables land one at a time.
function _rollItem(cr) {
  const rarity = _rollRarity(cr);
  if (!rarity || !_WEIGHTED_SLOTS.length) return null;   // this roll came up empty

  // Slot FIRST (weighted) — see _SLOT_WEIGHTS. Then coverage narrows it to the material a
  // starved hero could actually use; see lootCoverage.js.
  const slot = _pickSlot();
  const pool = coveragePool(slot, rarity, heroRoster.map(h => h.type))
            ?? _POOL_BY_SLOT[slot];   // slots with no materials (weapons, rings, cloaks, bags)
  if (!pool?.length) return null;

  const base = pool[Math.floor(Math.random() * pool.length)];
  return { ...base, rarity, affixes: rollAffixes(base, rarity) };
}

// ── Drop chances per bracket (gems only — item drops handled separately) ─────
const _CHANCES = [
  { gem: 0.00, gemTier: 0 },  // CR 0–½
  { gem: 0.10, gemTier: 0 },  // CR 1–2
  { gem: 0.15, gemTier: 1 },  // CR 3–8
  { gem: 0.25, gemTier: 2 },  // CR 9–16
  { gem: 0.40, gemTier: 3 },  // CR 17+
];

// ── Lesser Healing Potion ──────────────────────────────────────────────────────
// Flat 4% drop chance for any kill. Goblins in the Road to Phandalin zone are
// guaranteed to drop one the very first time (a scripted introduction to the
// item), tracked via localStorage so it never repeats.
const LESSER_HEALING_POTION = getPotion('potion5');
const LESSER_HEALING_CHANCE = 0.04;
const _ROAD_GOBLIN_POTION_KEY = 'dnd_road_goblin_potion_dropped';

function _roadGoblinPotionAlreadyDropped() {
  try { return localStorage.getItem(_ROAD_GOBLIN_POTION_KEY) === '1'; } catch { return false; }
}
function _markRoadGoblinPotionDropped() {
  try { localStorage.setItem(_ROAD_GOBLIN_POTION_KEY, '1'); } catch {}
}

// ── Soul Shard Amulet — guaranteed one-time drop from Morvath ────────────────
const SOUL_SHARD_AMULET = getItem('soul_shard_amulet');
const _MORVATH_AMULET_KEY = 'dnd_morvath_amulet_dropped';

function _morvathAmuletAlreadyDropped() {
  try { return localStorage.getItem(_MORVATH_AMULET_KEY) === '1'; } catch { return false; }
}
function _markMorvathAmuletDropped() {
  try { localStorage.setItem(_MORVATH_AMULET_KEY, '1'); } catch {}
}

// ── Goblin Key — guaranteed one-time drop from a Warrens goblin (Solrac quest) ──
const GOBLIN_KEY = getItem('goblin_key');
const _WARRENS_KEY_KEY = 'dnd_warrens_goblin_key_dropped';

function _warrensKeyAlreadyDropped() {
  try { return localStorage.getItem(_WARRENS_KEY_KEY) === '1'; } catch { return false; }
}
function _markWarrensKeyDropped() {
  try { localStorage.setItem(_WARRENS_KEY_KEY, '1'); } catch {}
}

// ── Public: roll loot for one enemy ──────────────────────────────────────────
// type/zoneId are optional — pass them to enable the one-time guaranteed drop.
export function rollLoot(cr, type = null, zoneId = null) {
  const b  = _bracket(cr);
  const ch = _CHANCES[b];
  const coins = _rollCoins(b);
  const items = [];

  // Random gear. Each roll is independent and can come up empty, so N rolls is N CHANCES,
  // not N items — only visible below CR 8, where `nothing` still has weight.
  for (let i = 0, n = _rollDropCount(cr); i < n; i++) {
    const it = _rollItem(cr);
    if (it) items.push(it);
  }

  if (Math.random() < ch.gem) items.push(_pickGem(ch.gemTier));

  if (type === 'goblin' && zoneId === 'road_to_phandelver' && !_roadGoblinPotionAlreadyDropped()) {
    items.push({ ...LESSER_HEALING_POTION });
    _markRoadGoblinPotionDropped();
  } else if (Math.random() < LESSER_HEALING_CHANCE) {
    items.push({ ...LESSER_HEALING_POTION });
  }

  if (type === 'morvath' && !_morvathAmuletAlreadyDropped()) {
    items.push({ ...SOUL_SHARD_AMULET });
    _markMorvathAmuletDropped();
  }

  if (type === 'goblin' && zoneId === 'warrens' && GOBLIN_KEY && !_warrensKeyAlreadyDropped()) {
    items.push({ ...GOBLIN_KEY });
    _markWarrensKeyDropped();
  }

  return { coins, items };
}

// ── PoE-style loot drop labels ────────────────────────────────────────────────
const _labels = [];

const _LABEL_COLOR = {
  coin:     '#ffd700',
  gem:      '#44eeff',
  common:   '#d0d0d0',
  uncommon: '#44ff88',
  rare:     '#4d9eff',
  veryRare: '#cc44ff',
};

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

function _makeSprite(text, color) {
  const S      = 2;             // supersampling
  const FONT   = 13 * S;
  const PAD_X  = 10 * S;
  const PAD_Y  =  5 * S;
  const RADIUS =  4 * S;

  const cv  = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font  = `bold ${FONT}px 'Segoe UI', Arial, sans-serif`;
  const tw  = ctx.measureText(text).width;

  cv.width  = Math.ceil(tw) + PAD_X * 2;
  cv.height = FONT + PAD_Y * 2;

  const c  = cv.getContext('2d');
  c.font   = `bold ${FONT}px 'Segoe UI', Arial, sans-serif`;

  // Dark pill
  c.fillStyle = 'rgba(0,0,0,0.78)';
  _roundRect(c, 0, 0, cv.width, cv.height, RADIUS);
  c.fill();

  // Thin colored border
  c.strokeStyle = color;
  c.lineWidth   = 1.5 * S;
  _roundRect(c, 0, 0, cv.width, cv.height, RADIUS);
  c.stroke();

  // Label text
  c.fillStyle    = color;
  c.textBaseline = 'middle';
  c.fillText(text, PAD_X, cv.height / 2);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const spr = new THREE.Sprite(mat);

  // depthTest:false alone isn't enough: the cave-roof blanket is a TRANSPARENT
  // material (renderOrder 1), so with the default order 0 the label draws first
  // and the blanket simply paints over it. A high renderOrder puts the label last
  // in the transparent pass, above the blanket, water, fog and every other layer.
  spr.renderOrder = 900;

  const worldH = 0.48;
  spr.scale.set((cv.width / cv.height) * worldH, worldH, 1);
  return spr;
}

export function spawnLootLabels(position, loot) {
  const { coins, items } = loot;
  const toLabel = [];

  // Coin line — consolidate all denominations
  const parts = [];
  if (coins.pp) parts.push(`${coins.pp} pp`);
  if (coins.gp) parts.push(`${coins.gp} gp`);
  if (coins.sp) parts.push(`${coins.sp} sp`);
  if (coins.cp) parts.push(`${coins.cp} cp`);
  if (parts.length) toLabel.push({ text: parts.join(' · '), type: 'coin' });

  items.forEach(it => toLabel.push({ text: it.name, type: it.rarity }));

  toLabel.forEach((entry, i) => {
    const spr   = _makeSprite(entry.text, _LABEL_COLOR[entry.type] ?? '#d0d0d0');
    const baseY = position.y + 1.1 + i * 0.56;
    spr.position.set(
      position.x + (Math.random() - 0.5) * 0.3,
      baseY,
      position.z + (Math.random() - 0.5) * 0.3,
    );
    spr.userData.baseY = baseY;
    scene.add(spr);
    _labels.push(spr);
  });
}

export function clearLootLabels() {
  for (const s of _labels) {
    s.material.map?.dispose();
    s.material.dispose();
    scene.remove(s);
  }
  _labels.length = 0;
}

export function tickLoot(_dt) {
  // Labels are static — cleared only by clearLootLabels() on loot collect or party wipe
}
