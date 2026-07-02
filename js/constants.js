// ════════════════════════════════════════════════════════════════════════════
//  WORLD / GRID
// ════════════════════════════════════════════════════════════════════════════

export const GRID_SQUARE_FEET       = 5;   // 1 grid square = 5 ft (D&D standard)
export const WORLD_UNITS_PER_SQUARE = 2;   // 2 Three.js world units = 1 grid square
export const GROUND_SIZE            = 108; // ground plane side length (world units)
export const GRID_DIVISIONS         = 54;  // GridHelper line count

// Fixed 5 × 5 grid square (10 × 10 WU) hero start zone at the south edge.
// Props must not spawn here; heroes always auto-place inside these bounds.
export const HERO_ZONE = { xMin: -5, xMax: 5, zMin: 22, zMax: 32 };

// ════════════════════════════════════════════════════════════════════════════
//  VISUAL COLOURS
// ════════════════════════════════════════════════════════════════════════════

export const COLORS = {
  // Scene
  sceneBackground: 0x08080f,
  fogBase:         0x08080f,
  groundBase:      0x111120,
  gridMain:        0x5c4c22,
  gridSub:         0x2e2610,
  divider:         0x554400,
  stars:           0xffffff,
  // Lights (default / before any biome is applied)
  ambient:         0x1a1a33,
  moonlight:       0xb0c4ff,
  rimFire:         0xff7722,
  // UI accents
  gold:            0xd4af37,
  selectRing:      0xffee00,  // yellow ring on selected unit
  activeRing:      0xd4af37,  // gold ring on current-turn unit
  moveLine:        0xd4af37,  // dashed move-range line
  ghostDefault:    0xff4422,  // ghost mesh base tint
};

// Per-hero ring/highlight colour (selection & active rings)
export const HERO_RING_COLORS = {
  dwarf:    0xc8860a,  // amber/gold-brown
  human:    0x2255ee,  // blue
  elf:      0xaa22ee,  // purple
  halfling: 0x22cc44,  // green
};

// Ghost mesh preview colour per unit type
export const GHOST_COLORS = {
  kobold:   0x7a4a18,
  goblin:   0x33880a,
  orc:      0x993300,
  ogre:     0x5a5a5a,
  elf:      0x22aaaa,
  dwarf:    0x8b5a2b,
  human:    0x7878a0,
  halfling: 0xaa8844,
  snake:    0x4a7a22,
};

// ════════════════════════════════════════════════════════════════════════════
//  SCENE SETUP
// ════════════════════════════════════════════════════════════════════════════

export const SCENE = {
  fogDensity:        0.015,
  cameraFov:         55,
  cameraNear:        0.1,
  cameraFar:         500,
  cameraPos:         [0, 14.2, 50.1],
  cameraPlayTarget:  29,
  orbitMinDist:      10,
  orbitMaxDist:      20,
  orbitDamping:      0.06,
  ambientIntensity:  4.2,
  moonIntensity:     2.88,
  moonPos:           [4, 10, -39],
  shadowMapSize:     2048,
  shadowExtent:      38,
  fireIntensity:     0.6,
  firePos:           [16, 5, -12],
  starCount:         1400,
  starSize:          0.22,
  dividerWidth:      0.16,
};

// ════════════════════════════════════════════════════════════════════════════
//  INTERACTION / PHYSICS
// ════════════════════════════════════════════════════════════════════════════

export const INTERACTION = {
  pickRadiusSq:    1.0,   // squared click radius for unit selection (world units)
  clashRadius:     1.8,   // minimum spacing between units (world units)
  clashRadiusSq:   3.24,  // clashRadius² — avoids sqrt in hot loops
  ghostW:          0.75,  // ghost mesh width / depth
  ghostH:          1.55,  // ghost mesh height
  ghostOpacity:    0.35,
  selectRingInner: 0.7,
  selectRingOuter: 1.0,
  activeRingInner: 0.6,
  activeRingOuter: 0.88,
  moveLineDash:    0.35,
  moveLineGap:     0.18,
  clusterMinDist:  3.6,   // min distance between auto-placed allies (world units)
  clusterMaxDist:  12.0,  // max distance (= minDist + random spread)
  clusterMaxTries: 60,
};

// ════════════════════════════════════════════════════════════════════════════
//  ANIMATION
// ════════════════════════════════════════════════════════════════════════════

export const ANIM = {
  timeStep:          0.016,  // seconds per frame (≈ 60 fps)
  bobFreq:           1.4,    // idle breathing frequency
  bobPhaseOffset:    0.85,   // per-unit phase spread
  bobAmplitude:      0.032,  // vertical travel (world units)
  swayFreq:          0.9,    // weapon sway frequency
  swayPhaseOffset:   1.1,    // per-unit weapon phase spread
  swayAmplitude:     0.09,   // weapon rotation range (radians)
  activeRingFreq:    3.0,    // active ring pulse frequency
  activeRingBase:    0.75,   // base opacity
  activeRingAmp:     0.20,   // opacity oscillation range
  selectRingFreq:    4.5,    // selection ring pulse frequency
  selectRingBase:    0.55,
  selectRingAmp:     0.4,
  rangeRingFreq:     1.6,   // attack-range ring pulse frequency (slow breathing glow)
  rangeRingBase:     0.50,
  rangeRingAmp:      0.18,
};

// ════════════════════════════════════════════════════════════════════════════
//  UNIT TYPE DEFINITIONS
//  visual   — colours, mesh proportions, 3D scale, health-bar anchor height
//  stats    — HP, AC, speed, initiative bonus, ability scores, damage dice
// ════════════════════════════════════════════════════════════════════════════

export const UNIT_TYPES = {

  // ── Red army ──────────────────────────────────────────────────────────────

  kobold: {
    name: 'Kobold',
    team: 'red',
    dark: 0x2a1800, mid: 0x4a2c0a, bright: 0x7a4a18, emissive: 0x080400,
    legH: 0.32, torsoW: 0.48, headS: 0.32, wpnH: 0.70, wpnColor: 0x887766,
    scale: [0.902, 0.902, 0.902],
    anchorY: 1.38,
    // CR 1/8 — Very Easy
    detect: 20,
    hp: 5, ac: 12, speed: 30, initiative: 0, xpReward: 5,
    profBonus: 2,
    abilities: { str: 7, dex: 15, con: 9, int: 8, wis: 7, cha: 8 },
    attacks: [
      { name: 'Dagger', type: 'melee',  range: 5,  dice: 1, sides: 4, statMod: 'dex' },
      { name: 'Sling',  type: 'ranged', range: 15, longRange: 30, rawLongRange: 60, dice: 1, sides: 4, statMod: 'dex' },
    ],
  },

  goblin: {
    name: 'Goblin',
    team: 'red',
    dark: 0x0f2800, mid: 0x1e5000, bright: 0x33880a, emissive: 0x001100,
    legH: 0.40, torsoW: 0.58, headS: 0.38, wpnH: 0.90, wpnColor: 0x556644,
    scale: [0.85, 0.85, 0.85],
    anchorY: 1.4,
    // CR 1/4 — Easy
    detect: 20,
    hp: 7, ac: 15, speed: 30, initiative: 0, xpReward: 10,
    profBonus: 2,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [
      { name: 'Scimitar', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'dex' },
      { name: 'Shortbow', type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  orc: {
    name: 'Orc',
    team: 'red',
    dark: 0x3d1200, mid: 0x6b2200, bright: 0x993300, emissive: 0x110400,
    legH: 0.58, torsoW: 0.80, headS: 0.46, wpnH: 1.20, wpnColor: 0x887755,
    scale: [1.14, 1.14, 1.14],
    anchorY: 2.8,
    // CR 1/2 — Medium
    detect: 20,
    hp: 15, ac: 13, speed: 30, initiative: 0, xpReward: 20,
    profBonus: 2,
    abilities: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
    attacks: [
      { name: 'Greataxe', type: 'melee',  range: 5,  dice: 1, sides: 12, statMod: 'str' },
      { name: 'Handaxe',  type: 'ranged', range: 20, longRange: 30, rawLongRange: 60, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  ogre: {
    name: 'Ogre',
    team: 'red',
    dark: 0x1e1e1e, mid: 0x383838, bright: 0x5a5a5a, emissive: 0x080808,
    legH: 0.72, torsoW: 1.00, headS: 0.56, wpnH: 1.50, wpnColor: 0x666655,
    large: true,
    scale: [2.304, 2.304, 2.304],
    yOffset: 0,
    modelRotY: Math.PI + Math.PI / 4 + Math.PI / 3 + Math.PI / 9 + Math.PI / 3,
    anchorY: 3.5,
    // CR 2 — Hard
    detect: 20,
    hp: 59, ac: 11, speed: 40, initiative: 0, xpReward: 90,
    profBonus: 2,
    abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
    attacks: [
      { name: 'Greatclub', type: 'melee',  range: 5,  dice: 2, sides: 8, statMod: 'str' },
      { name: 'Javelin',   type: 'ranged', range: 15, longRange: 30, rawLongRange: 60, dice: 2, sides: 6, statMod: 'str', qty: 2 },
    ],
  },

  wolf: {
    name: 'Wolf', team: 'red',
    scale: [1.242, 1.242, 1.242], anchorY: 1.3,
    hp: 11, ac: 13, speed: 40, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'dex',
        note: 'DC 11 STR save or knocked prone' },
    ],
  },

  ice_mephit: {
    name: 'Ice Mephit', team: 'red',
    scale: [0.75, 0.75, 0.75], anchorY: 1.2,
    hp: 21, ac: 11, speed: 30, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 7, dex: 13, con: 10, int: 9, wis: 11, cha: 12 },
    attacks: [
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'dex' },
    ],
  },

  gnoll: {
    name: 'Gnoll', team: 'red',
    scale: [1.1, 1.1, 1.1], anchorY: 2.0,
    hp: 22, ac: 15, speed: 30, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 14, dex: 10, con: 11, int: 6, wis: 10, cha: 7 },
    attacks: [
      { name: 'Spear',   type: 'melee',  range: 5,   dice: 1, sides: 6, statMod: 'str' },
      { name: 'Longbow', type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex' },
    ],
  },

  hyena: {
    name: 'Hyena', team: 'red',
    scale: [0.825, 0.825, 0.825], anchorY: 1.1,
    hp: 5, ac: 11, speed: 50, initiative: 0, xpReward: 5, profBonus: 2,
    abilities: { str: 11, dex: 13, con: 12, int: 2, wis: 12, cha: 5 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  giant_spider: {
    name: 'Giant Spider', team: 'red',
    scale: [1.2, 1.2, 1.2], anchorY: 1.6,
    hp: 26, ac: 14, speed: 30, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'dex',
        note: 'DC 11 CON or 2d8 poison dmg' },
    ],
  },

  twig_blight: {
    name: 'Twig Blight', team: 'red',
    scale: [0.65, 0.65, 0.65], anchorY: 0.9,
    hp: 4, ac: 13, speed: 20, initiative: 0, xpReward: 5, profBonus: 2,
    abilities: { str: 6, dex: 13, con: 12, int: 4, wis: 8, cha: 3 },
    attacks: [
      { name: 'Claws', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
    ],
  },

  stirge: {
    name: 'Stirge', team: 'red',
    scale: [0.5, 0.5, 0.5], anchorY: 0.8, hoverY: 2.5,
    hp: 2, ac: 14, speed: 40, initiative: 0, xpReward: 5, profBonus: 2,
    abilities: { str: 4, dex: 16, con: 11, int: 2, wis: 8, cha: 6 },
    attacks: [
      { name: 'Blood Drain', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex',
        note: 'Attaches on hit; drains 1d4+3 HP/turn' },
    ],
  },

  giant_rat: {
    name: 'Giant Rat', team: 'red',
    scale: [0.65, 0.65, 0.65], anchorY: 0.9,
    hp: 7, ac: 12, speed: 30, initiative: 0, xpReward: 5, profBonus: 2,
    abilities: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
    ],
  },

  troglodyte: {
    name: 'Troglodyte', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 1.6,
    hp: 13, ac: 11, speed: 30, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 14, dex: 10, con: 14, int: 6, wis: 10, cha: 6 },
    attacks: [
      { name: 'Claw', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'str' },
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'str' },
    ],
  },

  constrictor_snake: {
    name: 'Constrictor Snake', team: 'red',
    scale: [5.0, 5.0, 5.0], anchorY: 4.0,
    hp: 13, ac: 12, speed: 30, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 15, dex: 14, con: 11, int: 1, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite',      type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str' },
      { name: 'Constrict', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'DC 14 STR or grappled and restrained' },
    ],
  },

  lizardfolk: {
    name: 'Lizardfolk', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 22, ac: 15, speed: 30, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 15, dex: 10, con: 13, int: 7, wis: 12, cha: 7 },
    attacks: [
      { name: 'Heavy Club', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'str' },
      { name: 'Javelin',    type: 'ranged', range: 15, longRange: 30, rawLongRange: 60, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  bugbear: {
    name: 'Bugbear', team: 'red',
    scale: [1.25, 1.25, 1.25], anchorY: 2.4,
    hp: 27, ac: 16, speed: 30, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    attacks: [
      { name: 'Morningstar', type: 'melee',  range: 5,  dice: 2, sides: 8, statMod: 'str' },
      { name: 'Javelin',     type: 'ranged', range: 15, longRange: 30, rawLongRange: 60, dice: 2, sides: 6, statMod: 'str' },
    ],
  },

  warg: {
    name: 'Warg', team: 'red',
    scale: [1.45, 1.45, 1.45], anchorY: 1.6,
    hp: 26, ac: 13, speed: 50, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 17, dex: 12, con: 13, int: 7, wis: 11, cha: 8 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'DC 13 STR save or knocked prone' },
    ],
  },

  dire_wolf: {
    name: 'Dire Wolf', team: 'red',
    scale: [1.3, 1.3, 1.3], anchorY: 1.9,
    hp: 37, ac: 14, speed: 50, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'DC 13 STR save or knocked prone' },
    ],
  },

  hobgoblin: {
    name: 'Hobgoblin', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 11, ac: 18, speed: 30, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 },
    attacks: [
      { name: 'Longsword', type: 'melee',  range: 5,  dice: 1, sides: 8, statMod: 'str' },
      { name: 'Longbow',   type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex' },
    ],
  },

  gnoll_pack_lord: {
    name: 'Gnoll Pack Lord', team: 'red',
    scale: [1.25, 1.25, 1.25], anchorY: 2.3,
    hp: 49, ac: 15, speed: 30, initiative: 0, xpReward: 90, profBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 11, cha: 9 },
    attacks: [
      { name: 'Flail',   type: 'melee',  range: 5,   dice: 1, sides: 8, statMod: 'str' },
      { name: 'Longbow', type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex' },
    ],
  },

  yuan_ti_pureblood: {
    name: 'Yuan-ti Pureblood', team: 'red',
    scale: [1.1, 1.1, 1.1], anchorY: 2.1,
    hp: 40, ac: 11, speed: 30, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 11, dex: 16, con: 11, int: 13, wis: 12, cha: 14 },
    attacks: [
      { name: 'Scimitar', type: 'melee',  range: 5,  dice: 2, sides: 6, statMod: 'dex' },
      { name: 'Shortbow', type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  snake: {
    name: 'Giant Poisonous Snake', team: 'red',
    scale: [3.0, 3.0, 3.0], anchorY: 2.4,
    hp: 11, ac: 14, speed: 30, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 10, dex: 18, con: 11, int: 1, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex',
        note: 'DC 11 CON or 3d6 poison dmg' },
    ],
  },

  giant_constrictor_snake: {
    name: 'Giant Constrictor Snake', team: 'red',
    scale: [7.0, 7.0, 7.0], anchorY: 5.6,
    hp: 60, ac: 12, speed: 30, initiative: 0, xpReward: 90, profBonus: 2,
    abilities: { str: 19, dex: 14, con: 12, int: 1, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite',      type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str' },
      { name: 'Constrict', type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str',
        note: 'DC 16 STR or grappled and restrained' },
    ],
  },

  troll: {
    name: 'Troll', team: 'red',
    scale: [1.6, 1.6, 1.6], anchorY: 3.6,
    hp: 84, ac: 15, speed: 30, initiative: 0, xpReward: 360, profBonus: 3,
    abilities: { str: 18, dex: 13, con: 20, int: 7, wis: 9, cha: 7 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str' },
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'Regenerates 10 HP/turn (fire/acid prevents)' },
    ],
  },

  yeti: {
    name: 'Yeti', team: 'red',
    scale: [1.5, 1.5, 1.5], anchorY: 3.0,
    hp: 51, ac: 12, speed: 40, initiative: 0, xpReward: 140, profBonus: 3,
    abilities: { str: 18, dex: 13, con: 16, int: 8, wis: 12, cha: 7 },
    attacks: [
      { name: 'Claw', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'Chilling Gaze: DC 13 CON or paralyzed 1 min' },
    ],
  },

  gnoll_fang: {
    name: 'Gnoll Fang of Yeenoghu', team: 'red',
    scale: [1.3, 1.3, 1.3], anchorY: 2.5,
    hp: 65, ac: 14, speed: 30, initiative: 0, xpReward: 220, profBonus: 3,
    abilities: { str: 17, dex: 12, con: 14, int: 10, wis: 11, cha: 12 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str' },
      { name: 'Claw',  type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  owlbear: {
    name: 'Owlbear', team: 'red',
    scale: [1.5, 1.5, 1.5], anchorY: 3.0,
    hp: 59, ac: 13, speed: 40, initiative: 0, xpReward: 140, profBonus: 3,
    abilities: { str: 20, dex: 12, con: 17, int: 3, wis: 12, cha: 7 },
    attacks: [
      { name: 'Beak',  type: 'melee', range: 5, dice: 1, sides: 10, statMod: 'str' },
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 8,  statMod: 'str' },
    ],
  },

  werewolf: {
    name: 'Werewolf', team: 'red',
    scale: [1.2, 1.2, 1.2], anchorY: 2.4,
    hp: 58, ac: 12, speed: 30, initiative: 0, xpReward: 140, profBonus: 3,
    abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 11, cha: 10 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str',
        note: 'DC 12 CON or cursed with lycanthropy' },
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str' },
    ],
  },

  minotaur: {
    name: 'Minotaur', team: 'red',
    scale: [1.6, 1.6, 1.6], large: true, anchorY: 3.5,
    hp: 114, ac: 14, speed: 40, initiative: 0, xpReward: 140, profBonus: 3,
    abilities: { str: 18, dex: 11, con: 16, int: 6, wis: 16, cha: 9 },
    attacks: [
      { name: 'Greataxe', type: 'melee', range: 5, dice: 2, sides: 12, statMod: 'str' },
      { name: 'Gore',     type: 'melee', range: 5, dice: 2, sides: 8,  statMod: 'str',
        note: 'Goring Rush: charge and knock prone' },
    ],
  },

  yuan_ti_malison: {
    name: 'Yuan-ti Malison', team: 'red',
    scale: [1.25, 1.25, 1.25], anchorY: 2.3,
    hp: 66, ac: 15, speed: 30, initiative: 0, xpReward: 140, profBonus: 3,
    abilities: { str: 16, dex: 14, con: 13, int: 14, wis: 12, cha: 16 },
    attacks: [
      { name: 'Scimitar', type: 'melee',  range: 5,  dice: 2, sides: 6, statMod: 'str' },
      { name: 'Longbow',  type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex',
        note: 'DC 14 CON or 3d6 poison dmg' },
    ],
  },

  shambling_mound: {
    name: 'Shambling Mound', team: 'red',
    scale: [1.6, 1.6, 1.6], large: true, anchorY: 3.5,
    hp: 136, ac: 15, speed: 20, initiative: 0, xpReward: 360, profBonus: 3,
    abilities: { str: 18, dex: 8, con: 16, int: 5, wis: 10, cha: 5 },
    attacks: [
      { name: 'Slam', type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str',
        note: 'Lightning Absorption: heals on lightning hit' },
    ],
  },

  giant_frog: {
    name: 'Giant Frog', team: 'red',
    scale: [0.85, 0.85, 0.85], anchorY: 1.2,
    hp: 18, ac: 11, speed: 30, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 12, dex: 13, con: 11, int: 2, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str',
        note: 'DC 11 STR or grappled; can swallow Small creatures' },
    ],
  },

  bullywug: {
    name: 'Bullywug', team: 'red',
    scale: [0.90, 0.90, 0.90], anchorY: 1.5,
    hp: 11, ac: 15, speed: 20, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 14, dex: 12, con: 13, int: 7, wis: 10, cha: 7 },
    attacks: [
      { name: 'Bite',  type: 'melee',  range: 5,  dice: 1, sides: 4, statMod: 'str' },
      { name: 'Spear', type: 'ranged', range: 20, longRange: 30, rawLongRange: 60, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  mud_mephit: {
    name: 'Mud Mephit', team: 'red',
    scale: [0.75, 0.75, 0.75], anchorY: 1.1,
    hp: 27, ac: 11, speed: 20, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 8, dex: 12, con: 14, int: 9, wis: 11, cha: 7 },
    attacks: [
      { name: 'Claws',      type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
      { name: 'Mud Breath', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'dex',
        note: 'DC 11 CON or restrained until end of next turn' },
    ],
  },

  crocodile: {
    name: 'Crocodile', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 1.2,
    hp: 19, ac: 12, speed: 20, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 15, dex: 10, con: 13, int: 2, wis: 10, cha: 5 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 10, statMod: 'str',
        note: 'DC 12 STR or grappled and restrained' },
    ],
  },

  giant_toad: {
    name: 'Giant Toad', team: 'red',
    scale: [1.05, 1.05, 1.05], anchorY: 1.3,
    hp: 39, ac: 11, speed: 20, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 15, dex: 13, con: 11, int: 2, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 10, statMod: 'str',
        note: 'DC 13 STR or swallowed (3d6 acid damage per turn)' },
    ],
  },

  bullywug_croaker: {
    name: 'Bullywug Croaker', team: 'red',
    scale: [1.05, 1.05, 1.05], anchorY: 1.8,
    hp: 30, ac: 15, speed: 20, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 8 },
    attacks: [
      { name: 'Bite',  type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'str' },
      { name: 'Spear', type: 'ranged', range: 20, longRange: 30, rawLongRange: 60, dice: 1, sides: 8, statMod: 'str' },
    ],
  },

  swarm_of_insects: {
    name: 'Swarm of Insects', team: 'red',
    scale: [0.80, 0.80, 0.80], anchorY: 0.8, hoverY: 2,
    hp: 22, ac: 12, speed: 20, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 3, dex: 13, con: 10, int: 1, wis: 7, cha: 1 },
    attacks: [
      { name: 'Bites', type: 'melee', range: 0, dice: 4, sides: 4, statMod: 'dex',
        note: 'Swarm: shares space with target; 2d4 when below half HP' },
    ],
  },

  lizardfolk_shaman: {
    name: 'Lizardfolk Shaman', team: 'red',
    scale: [1.05, 1.05, 1.05], anchorY: 2.1,
    hp: 45, ac: 13, speed: 30, initiative: 0, xpReward: 90, profBonus: 2,
    abilities: { str: 15, dex: 10, con: 13, int: 11, wis: 14, cha: 11 },
    attacks: [
      { name: 'Claws',           type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'str' },
      { name: 'Conjure Animals', type: 'ranged', range: 30, dice: 3, sides: 8, statMod: 'wis',
        note: 'Summons 2 crocodiles or 4 swarms of insects (1/day)' },
    ],
  },

  green_hag: {
    name: 'Green Hag', team: 'red',
    scale: [1.10, 1.10, 1.10], anchorY: 2.2,
    hp: 82, ac: 17, speed: 30, initiative: 0, xpReward: 140, profBonus: 3,
    abilities: { str: 18, dex: 12, con: 16, int: 13, wis: 14, cha: 14 },
    attacks: [
      { name: 'Claws',          type: 'melee',  range: 5,  dice: 2, sides: 8, statMod: 'str' },
      { name: 'Ray of Sickness', type: 'ranged', range: 30, dice: 2, sides: 8, statMod: 'cha',
        note: 'DC 14 CON or poisoned until end of next turn' },
    ],
  },

  ghoul: {
    name: 'Ghoul', team: 'red',
    scale: [1.5, 1.5, 1.5], anchorY: 3.0,
    hp: 22, ac: 12, speed: 30, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 2, sides: 6, hitBonus: 2, dmgBonus: 2 },
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'dex',
        note: 'DC 10 CON or paralyzed until end of next turn' },
    ],
  },

  zombie: {
    name: 'Zombie', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 22, ac: 8, speed: 20, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    attacks: [
      { name: 'Slam', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str',
        note: 'Undead Fortitude: DC 5+dmg CON save to stay at 1 HP' },
    ],
  },

  skeleton: {
    name: 'Skeleton', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 13, ac: 13, speed: 30, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    attacks: [
      { name: 'Shortsword', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'dex' },
      { name: 'Shortbow',   type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex',
        note: 'Vulnerability: bludgeoning; Immunity: poison, exhaustion' },
    ],
  },

  shadow: {
    name: 'Shadow', team: 'red',
    scale: [1.26, 1.26, 1.26], anchorY: 2.52, hoverY: -1,
    hp: 16, ac: 12, speed: 40, initiative: 0, xpReward: 20, profBonus: 2,
    abilities: { str: 6, dex: 14, con: 13, int: 6, wis: 10, cha: 8 },
    attacks: [
      { name: 'Strength Drain', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'dex',
        note: 'Reduces target STR by 1d4; target dies if STR reaches 0' },
    ],
  },

  specter: {
    name: 'Specter', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.5,
    hp: 22, ac: 12, speed: 50, initiative: 0, xpReward: 40, profBonus: 2,
    abilities: { str: 1, dex: 14, con: 11, int: 10, wis: 10, cha: 11 },
    attacks: [
      { name: 'Life Drain', type: 'melee', range: 5, dice: 3, sides: 6, statMod: 'dex', dmgBonus: 0,
        note: 'DC 10 CON save or max HP reduced by damage dealt' },
    ],
  },

  ghast: {
    name: 'Ghast', team: 'red',
    scale: [1.1, 1.1, 1.1], anchorY: 2.2,
    hp: 36, ac: 13, speed: 30, initiative: 0, xpReward: 90, profBonus: 2,
    abilities: { str: 16, dex: 14, con: 14, int: 11, wis: 10, cha: 8 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 2, sides: 8, hitBonus: 3, statMod: 'str' },
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'DC 10 CON or paralyzed; Stench aura: DC 10 CON or poisoned' },
    ],
  },

  wight: {
    name: 'Wight', team: 'red',
    scale: [1.1, 1.1, 1.1], anchorY: 2.2,
    hp: 45, ac: 14, speed: 30, initiative: 0, xpReward: 140, profBonus: 2,
    abilities: { str: 15, dex: 14, con: 16, int: 10, wis: 13, cha: 15 },
    attacks: [
      { name: 'Longsword',  type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'str' },
      { name: 'Life Drain', type: 'melee', range: 5, dice: 1, sides: 6, hitBonus: 4, dmgBonus: 0,
        note: 'DC 13 CON or max HP reduced by damage dealt' },
    ],
  },

  banshee: {
    name: 'Banshee', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.8,
    hp: 58, ac: 12, speed: 40, initiative: 0, xpReward: 220, profBonus: 3,
    abilities: { str: 1, dex: 14, con: 12, int: 12, wis: 11, cha: 17 },
    attacks: [
      { name: 'Corrupting Touch', type: 'melee', range: 5, dice: 3, sides: 6, statMod: 'dex', dmgBonus: 0,
        note: 'Wail (1/day): DC 13 CON or 3d6 psychic + frightened' },
    ],
  },

  revenant: {
    name: 'Revenant', team: 'red',
    scale: [1.2, 1.2, 1.2], anchorY: 2.4,
    hp: 136, ac: 13, speed: 30, initiative: 0, xpReward: 360, profBonus: 3,
    abilities: { str: 18, dex: 14, con: 18, int: 12, wis: 14, cha: 16 },
    attacks: [
      { name: 'Greatsword', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'Regeneration: regains 10 HP at turn start; Vengeful Tracker' },
    ],
  },

  hill_giant: {
    name: 'Hill Giant', team: 'red',
    scale: [1.0, 1.0, 1.0], large: true, anchorY: 3.2,
    hp: 105, ac: 13, speed: 40, initiative: 0, xpReward: 360, profBonus: 3,
    abilities: { str: 21, dex: 8, con: 19, int: 5, wis: 9, cha: 6 },
    attacks: [
      { name: 'Greatclub', type: 'melee',  range: 5,  dice: 3, sides: 8,  statMod: 'str' },
      { name: 'Rock',      type: 'ranged', range: 30, longRange: 60, rawLongRange: 120, dice: 3, sides: 10, statMod: 'str' },
    ],
  },

  ettin: {
    name: 'Ettin', team: 'red',
    scale: [1.8, 1.8, 1.8], large: true, anchorY: 3.8,
    hp: 85, ac: 12, speed: 40, initiative: 0, xpReward: 220, profBonus: 2,
    abilities: { str: 21, dex: 8, con: 17, int: 6, wis: 10, cha: 8 },
    attacks: [
      { name: 'Battleaxe',   type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'str', dmgBonus: 5 },
      { name: 'Morningstar', type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'str', dmgBonus: 5 },
    ],
  },

  mane: {
    name: 'Mane', team: 'red',
    scale: [0.85, 0.85, 0.85], anchorY: 1.4,
    // CR 1/8 — Very Easy
    detect: 20,
    hp: 9, ac: 9, speed: 20, initiative: 0, xpReward: 5, profBonus: 2,
    abilities: { str: 10, dex: 9, con: 13, int: 3, wis: 8, cha: 4 },
    attacks: [
      { name: 'Claws', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'str' },
      { name: 'Bite',  type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  abyssal_wretch: {
    name: 'Abyssal Wretch', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    // CR 1/4 — Easy
    detect: 20,
    hp: 18, ac: 11, speed: 20, initiative: 0, xpReward: 10, profBonus: 2,
    abilities: { str: 9, dex: 12, con: 11, int: 5, wis: 8, cha: 5 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'dex', dmgBonus: 1,
        note: 'Abyssal corruption: DC 11 CON or poisoned until end of next turn' },
    ],
  },

  abyssal_chicken: {
    name: 'Abyssal Chicken', team: 'red',
    scale: [0.66, 0.66, 0.66], anchorY: 0.47,
    // CR 1/8 — Very Easy (Tiny fiend)
    detect: 20,
    hp: 10, ac: 13, speed: 30, initiative: 0, xpReward: 5, profBonus: 2,
    abilities: { str: 6, dex: 14, con: 13, int: 4, wis: 8, cha: 5 },
    attacks: [
      { name: 'Bite',   type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
      { name: 'Claws',  type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex',
        note: 'Shriek (recharge 6): creatures within 10 ft DC 11 WIS or frightened' },
    ],
  },

  // ── Named bosses ──────────────────────────────────────────────────────────

  morvath: {
    name: 'Morvath',
    team: 'red',
    aiStyle: 'spellcaster',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 52, ac: 14, speed: 30, initiative: 0, xpReward: 100, profBonus: 2,
    abilities: { str: 10, dex: 13, con: 11, int: 11, wis: 13, cha: 14 },
    spellSlots: 6,
    attacks: [
      { name: 'Claws',           type: 'melee',    range: 5,  dice: 1, sides: 4,  dmgBonus: 2, statMod: 'dex' },
      { name: 'Inflict Wounds',  type: 'melee',    range: 5,  dice: 1, sides: 10, hitBonus: 3, spellSlotCost: 1 },
      { name: 'Grave Curse',     type: 'aoe_save', range: 30, dice: 1, sides: 6,  dmgBonus: 2,
        saveType: 'con', saveDC: 12, aoeRadius: 15, spellSlotCost: 1 },
    ],
  },

  // ── Blue army ─────────────────────────────────────────────────────────────

  elf: {
    name: 'Rasec',
    class: 'Elf Mage',
    team: 'blue',
    dark: 0x002233, mid: 0x004455, bright: 0x22aaaa, emissive: 0x000a0f,
    legH: 0.52, torsoW: 0.60, headS: 0.40, wpnH: 1.40, wpnColor: 0x88ccbb,
    scale: [1.134, 1.134, 1.134],
    yOffset: -0.05,
    anchorY: 2.0,
    hp: 12, ac: 12, speed: 35, initiative: 0,
    hitDie: 6,
    profBonus: 2, xpNext: 200,
    armorProficiency: { armor: [], shields: false },
    weaponProficiency: { simple: false, martial: false, weapons: ['Dagger', 'Dart', 'Sling', 'Quarterstaff', 'Light Crossbow'] },
    startingEquipment: { chest: 'clothshirt1' },
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    attacks: [
      { name: 'Fire Bolt', type: 'ranged', range: 60, dice: 1, sides: 10, statMod: 'int' },
      { name: 'Dagger',    type: 'melee',  range: 5,   dice: 1, sides: 4,  statMod: 'dex' },
    ],
  },

  dwarf: {
    name: 'Leugren',
    class: 'Dwarf Cleric',
    team: 'blue',
    dark: 0x2e1400, mid: 0x5a3010, bright: 0x8b5a2b, emissive: 0x0a0500,
    legH: 0.40, torsoW: 0.82, headS: 0.44, wpnH: 0.95, wpnColor: 0x997755,
    scale: [0.99, 0.99, 0.99],
    anchorY: 1.45,
    hp: 15, ac: 16, speed: 25, initiative: 0,
    hitDie: 8,
    profBonus: 2, xpNext: 200,
    armorProficiency: { armor: ['Light', 'Medium', 'Heavy'], shields: true },
    weaponProficiency: { simple: true, martial: false, weapons: ['Battleaxe', 'Handaxe', 'Light Hammer', 'Warhammer'] },
    startingEquipment: { chest: 'chainarmor1', 'off-hand': 'shield1' },
    abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 15, cha: 12 },
    attacks: [
      { name: 'Warhammer', type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'str' },
    ],
  },

  human: {
    name: 'Gobo',
    class: 'Human Barbarian',
    team: 'blue',
    dark: 0x252535, mid: 0x40405a, bright: 0x7878a0, emissive: 0x050508,
    legH: 0.58, torsoW: 0.70, headS: 0.44, wpnH: 1.28, wpnColor: 0xccccdd,
    scale: [1.36, 1.36, 1.36],
    anchorY: 2.1,
    hp: 19, ac: 14, speed: 30, initiative: 0,
    hitDie: 12,
    profBonus: 2, xpNext: 200,
    rage: { uses: 3, dmgBonus: 2 },
    unarmoredDefense: true,
    armorProficiency: { armor: ['Light', 'Medium'], shields: true },
    weaponProficiency: { simple: true, martial: true, weapons: [] },
    abilities: { str: 16, dex: 14, con: 15, int: 8, wis: 10, cha: 12 },
    attacks: [
      { name: 'Greataxe', type: 'melee',  range: 5,  dice: 1, sides: 12, statMod: 'str' },
      { name: 'Handaxe',  type: 'ranged', range: 20, longRange: 30, rawLongRange: 60, dice: 1, sides: 6, statMod: 'str', qty: 2, note: 'Qty 2 · thrown' },
    ],
  },

  halfling: {
    name: 'Milo',
    class: 'Halfling Rogue',
    team: 'blue',
    dark: 0x1a0e00, mid: 0x3d2800, bright: 0x6b4a18, emissive: 0x050300,
    legH: 0.38, torsoW: 0.55, headS: 0.36, wpnH: 0.82, wpnColor: 0x887744,
    scale: [0.7225, 0.7225, 0.7225],
    anchorY: 1.19,
    hp: 14, ac: 14, speed: 25, initiative: 0,
    hitDie: 8,
    profBonus: 2, xpNext: 200,
    sneakAttack: { dice: 1, sides: 6 },
    armorProficiency: { armor: ['Light'], shields: false },
    weaponProficiency: { simple: true, martial: false, weapons: ['Hand Crossbow', 'Longsword', 'Rapier', 'Shortsword', 'Shortbow'] },
    startingEquipment: { chest: 'leatherarmor1' },
    abilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 14 },
    attacks: [
      { name: 'Shortsword', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'dex' },
      { name: 'Shortbow',   type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },
  // ── Friendly NPCs ──────────────────────────────────────────────────────────

  grassling: {
    name: 'Grassling',
    team: 'npc',
    scale:      [0.3, 0.3, 0.3],
    anchorY:    0.3,
    modelRotY:  -Math.PI / 4,
  },
};

// Convenience lists
export const ENEMY_TYPES = ['kobold', 'goblin', 'orc', 'ogre'];
export const HERO_TYPES  = ['dwarf', 'human', 'elf', 'halfling'];

// CR values used to derive defender/attacker tier for the hit-chance formula.
// Stored as decimals so Math.ceil() works correctly (0.25 → ceil → 1, 2 → 2, etc.).
// All CRs < 1 produce tier 1; CR 2 → tier 2; CR 3 → tier 3; etc.
export const ENEMY_CR = {
  // ── CR 1/8 ──────────────────────────────────────────────────────
  kobold:           0.125,
  twig_blight:      0.125,
  stirge:           0.125,
  giant_rat:        0.125,
  mane:             0.125,
  abyssal_chicken:  0.125,
  // ── CR 1/4 ──────────────────────────────────────────────────────
  goblin:           0.25,
  wolf:             0.25,
  troglodyte:       0.25,
  constrictor_snake: 0.25,
  giant_frog:       0.25,
  bullywug:         0.25,
  mud_mephit:       0.25,
  zombie:           0.25,
  skeleton:         0.25,
  abyssal_wretch:   0.25,
  hyena:            0.25,  // 5e CR 0 — bump to 0.25 so tier stays 1 without special casing
  // ── CR 1/2 ──────────────────────────────────────────────────────
  orc:              0.5,
  warg:             0.5,
  ice_mephit:       0.5,
  gnoll:            0.5,
  lizardfolk:       0.5,
  hobgoblin:        0.5,
  crocodile:        0.5,
  swarm_of_insects: 0.5,
  shadow:           0.5,
  // ── CR 1 ────────────────────────────────────────────────────────
  snake:            0.25,
  giant_spider:     1,
  bugbear:          1,
  dire_wolf:        1,
  yuan_ti_pureblood: 1,
  giant_toad:       1,
  bullywug_croaker: 1,
  ghoul:            1,
  specter:          1,
  // ── CR 2 ────────────────────────────────────────────────────────
  ogre:             2,
  gnoll_pack_lord:         2,
  giant_constrictor_snake: 2,
  lizardfolk_shaman:       2,
  ghast:            2,
  // ── CR 3 ────────────────────────────────────────────────────────
  yeti:             3,
  owlbear:          3,
  werewolf:         3,
  minotaur:         3,
  yuan_ti_malison:  3,
  green_hag:        3,
  wight:            3,
  // ── CR 4 ────────────────────────────────────────────────────────
  gnoll_fang:       4,
  banshee:          4,
  ettin:            4,
  // ── CR 5 ────────────────────────────────────────────────────────
  troll:            5,
  shambling_mound:  5,
  revenant:         5,
  hill_giant:       5,
  // ── Named bosses ────────────────────────────────────────────────
  morvath:          1,
};

// ════════════════════════════════════════════════════════════════════════════
//  COMBAT DEFAULTS  (fallback when a type entry is missing)
// ════════════════════════════════════════════════════════════════════════════

export const COMBAT = {
  defaultHP:         60,
  defaultAC:         13,
  defaultSpeed:      30,
  defaultInitiative:  2,
  defaultDamage:     { dice: 1, sides: 6, bonus: 0 },
};

// ════════════════════════════════════════════════════════════════════════════
//  UI / GAMEPLAY SETTINGS
// ════════════════════════════════════════════════════════════════════════════

export const UI = {
  unitSliderMin:     5,
  unitSliderMax:     30,
  unitSliderDefault: 10,
};

// ════════════════════════════════════════════════════════════════════════════
//  ENVIRONMENT CONFIGS
//  sky/fog/density control Three.js scene appearance.
//  ambColor/ambInt, moonColor/moonInt, rimColor/rimInt override the lights.
//  ground is a colour tint multiplied over the procedural canvas texture.
// ════════════════════════════════════════════════════════════════════════════

export const ENVS = {
  forest: {
    sky: 0x142d12, fog: 0x1a3818, density: 0.016, ground: 0xd8ecd4,
    gridColor: 0xc8a870,
    ambColor: 0x2a5228, ambInt: 5.4,
    moonColor: 0xaaddbb, moonInt: 3.84,
    rimColor:  0x336633, rimInt:  0.72,
  },
  desert: {
    sky: 0x180d03, fog: 0x281806, density: 0.008, ground: 0x7a4e28,
    ambColor: 0x332810, ambInt: 5.04,
    moonColor: 0xffcc66, moonInt: 4.2,
    rimColor:  0xff6622, rimInt:  0.96,
  },
  swamp: {
    sky: 0x0d1f0b, fog: 0x112210, density: 0.022, ground: 0xc4dcc0,
    ambColor: 0x223d1e, ambInt: 4.56,
    moonColor: 0xbbdd88, moonInt: 2.88,
    rimColor:  0x228822, rimInt:  0.6,
  },
  tundra: {
    sky: 0x080c14, fog: 0x10182a, density: 0.014, ground: 0xeef2ff,
    ambColor: 0x182038, ambInt: 3.84,
    moonColor: 0xaac4ff, moonInt: 3.12,
    rimColor:  0x8899cc, rimInt:  0.6,
  },
  savanna: {
    sky: 0x160b03, fog: 0x241408, density: 0.009, ground: 0xc8d868,
    ambColor: 0x332210, ambInt: 4.56,
    moonColor: 0xffaa44, moonInt: 3.6,
    rimColor:  0xff4400, rimInt:  1.08,
  },
  graveyard: {
    sky: 0x060810, fog: 0x0a0e1a, density: 0.052, ground: 0x1e2030,
    ambColor: 0x080c18, ambInt: 1.4,
    moonColor: 0xa8b4cc, moonInt: 0.0,
    rimColor:  0x4a5878, rimInt:  0.0,
  },
  dungeon: {
    sky: 0x050505, fog: 0x080808, density: 0.028, ground: 0x0c0c0c,
    gridColor: 0x000000,
    ambColor: 0x0e0e12, ambInt: 2.4,
    moonColor: 0x8890a0, moonInt: 0.9,
    rimColor:  0x334466, rimInt:  0.4,
  },
};
