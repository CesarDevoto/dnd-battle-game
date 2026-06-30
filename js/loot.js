// js/loot.js — D&D 2024 individual treasure tables + 3D loot orbs

import * as THREE from 'three';
import { scene } from './scene.js';

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

// ── D&D 2024 Magic Item tables ────────────────────────────────────────────────
const _ITEMS = {
  common: [
    { name: 'Potion of Healing',        description: 'Drink to regain 2d4+2 hit points.',                                      value: 50  },
    { name: 'Potion of Climbing',       description: 'Climb speed equals walk speed for 1 hour.',                              value: 50  },
    { name: 'Spell Scroll: Guidance',   description: 'Cantrip. Target adds 1d4 to one ability check.',                        value: 30  },
    { name: 'Spell Scroll: Cure Wounds',description: '1st-level. Creature regains 1d8 + modifier HP.',                        value: 75  },
    { name: 'Spell Scroll: Detect Magic',description:'1st-level. Sense magic within 30 ft. for 10 minutes.',                  value: 75  },
    { name: 'Spell Scroll: Identify',   description: '1st-level. Learn the properties of a magic item.',                      value: 75  },
    { name: 'Silvered Weapon',          description: 'Bypasses resistance to non-magical weapons.',                            value: 100 },
    { name: 'Mystery Key',              description: 'Fits one lock perfectly, then vanishes.',                                value: 0   },
    { name: 'Candle of the Deep',       description: 'Burns for 8 hours even underwater.',                                    value: 30  },
    { name: 'Elemental Gem (Fire)',     description: 'Crush to summon a fire elemental that obeys you for 1 hour.',           value: 500 },
  ],
  uncommon: [
    { name: 'Potion of Greater Healing',description: 'Drink to regain 4d4+4 hit points.',                                     value: 150  },
    { name: 'Potion of Fire Breath',    description: 'Exhale a cone of fire (4d6 dmg) for up to 1 minute.',                  value: 150  },
    { name: 'Potion of Resistance',     description: 'Resistance to one damage type for 1 hour.',                             value: 300  },
    { name: 'Spell Scroll: Misty Step', description: '2nd-level. Teleport up to 30 ft. to an unoccupied space.',             value: 150  },
    { name: 'Spell Scroll: Invisibility',description:'2nd-level. Creature becomes invisible for 1 hour.',                    value: 150  },
    { name: 'Spell Scroll: Fireball',   description: '3rd-level. 8d6 fire damage in a 20-ft. radius.',                       value: 300  },
    { name: 'Spell Scroll: Fly',        description: '3rd-level. Fly speed of 60 ft. for 10 minutes.',                       value: 300  },
    { name: 'Bag of Tricks (Gray)',     description: 'Pull a random small beast from the bag up to 3×/day.',                 value: 50   },
    { name: 'Eyes of the Eagle',        description: 'Advantage on Perception checks; see clearly up to 1 mile.',            value: 2500 },
    { name: 'Cloak of Protection',      description: '+1 bonus to AC and all saving throws. Requires attunement.',           value: 3500 },
    { name: 'Hat of Disguise',          description: 'Cast Disguise Self at will. Requires attunement.',                     value: 2000 },
    { name: 'Wand of Magic Missiles',   description: '7 charges. Expend 1–3 to fire 1–3 darts (1d4+1 force each).',         value: 6000 },
    { name: 'Immovable Rod',            description: 'Press the button to freeze the rod in place in the air.',              value: 5000 },
    { name: 'Ring of Swimming',         description: 'Gain a swimming speed of 40 ft.',                                      value: 3000 },
  ],
  rare: [
    { name: 'Potion of Superior Healing',description:'Drink to regain 8d4+8 hit points.',                                    value: 450  },
    { name: 'Potion of Heroism',        description: 'Gain 10 temporary HP and the Bless effect for 1 hour.',                value: 180  },
    { name: 'Potion of Invulnerability',description: 'Resistance to all damage for 1 minute.',                               value: 3840 },
    { name: 'Spell Scroll: Banishment', description: '4th-level. Banish a creature to another plane (Concentration).',      value: 500  },
    { name: 'Spell Scroll: Cone of Cold',description:'5th-level. 8d8 cold damage in a 60-ft. cone.',                        value: 1000 },
    { name: '+1 Weapon',                description: '+1 bonus to attack rolls and damage rolls.',                            value: 1000 },
    { name: 'Ring of Protection',       description: '+1 bonus to AC and saving throws. Requires attunement.',               value: 3500 },
    { name: 'Amulet of Health',         description: 'Constitution score becomes 19. Requires attunement.',                  value: 8000 },
    { name: 'Boots of Speed',           description: 'Double walk speed; opportunity attacks against you have disadvantage.', value: 4000 },
    { name: 'Necklace of Adaptation',   description: 'Breathe normally in any environment.',                                 value: 1400 },
    { name: 'Staff of the Python',      description: 'Throw to transform into a giant constrictor snake. 6 charges.',       value: 2000 },
  ],
  veryRare: [
    { name: 'Potion of Supreme Healing',description: 'Drink to regain 10d4+20 hit points.',                                  value: 20000  },
    { name: '+2 Weapon',                description: '+2 bonus to attack rolls and damage rolls.',                            value: 4000   },
    { name: 'Belt of Giant Strength',   description: 'Strength score becomes 21. Requires attunement.',                     value: 1000   },
    { name: 'Cloak of Displacement',    description: 'Attackers have disadvantage on all attack rolls against you.',        value: 60000  },
    { name: 'Ring of Regeneration',     description: 'Regain 1d6 HP every 10 minutes. Requires attunement.',               value: 25000  },
    { name: 'Amulet of the Planes',     description: 'Cast Plane Shift at will. Requires attunement.',                      value: 160000 },
    { name: '+2 Shield',                description: '+2 bonus to AC (in addition to normal shield bonus).',                 value: 2000   },
  ],
};

function _pickItem(rarity) {
  const list = _ITEMS[rarity];
  return { ...(list[Math.floor(Math.random() * list.length)]), rarity };
}

// ── Drop chances per bracket ──────────────────────────────────────────────────
const _CHANCES = [
  { gem: 0.00, gemTier: 0, item: 0.05, itemRarity: 'common'   },  // CR 0–½
  { gem: 0.10, gemTier: 0, item: 0.10, itemRarity: 'common'   },  // CR 1–2
  { gem: 0.15, gemTier: 1, item: 0.15, itemRarity: 'uncommon' },  // CR 3–8
  { gem: 0.25, gemTier: 2, item: 0.20, itemRarity: 'rare'     },  // CR 9–16
  { gem: 0.40, gemTier: 3, item: 0.30, itemRarity: 'veryRare' },  // CR 17+
];

// ── Public: roll loot for one enemy ──────────────────────────────────────────
export function rollLoot(cr) {
  const b  = _bracket(cr);
  const ch = _CHANCES[b];
  const coins = _rollCoins(b);
  const items = [];

  if (Math.random() < ch.gem)  items.push(_pickGem(ch.gemTier));
  if (Math.random() < ch.item) items.push(_pickItem(ch.itemRarity));

  // CR 3+ enemies have a small extra-item bonus roll
  if (cr >= 3 && Math.random() < 0.08) items.push(_pickItem('common'));

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
