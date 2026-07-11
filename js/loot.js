// js/loot.js — D&D 2024 individual treasure tables + 3D loot orbs

import * as THREE from 'three';
import { scene } from './scene.js';
import { getPotion } from './potions.js';
import { getItem } from './items.js';

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

// ── Magic item tables — removed for now (2026-07-02), will be baked back in later ──
// In the meantime, the only item drop is the Lesser Healing Potion (see below).

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
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);

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
