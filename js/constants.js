// ════════════════════════════════════════════════════════════════════════════
//  WORLD / GRID
// ════════════════════════════════════════════════════════════════════════════

export const GRID_SQUARE_FEET       = 5;   // 1 grid square = 5 ft (D&D standard)
export const WORLD_UNITS_PER_SQUARE = 2;   // 2 Three.js world units = 1 grid square
// Two units are "adjacent" (engaged) when their centres are within this distance.
// 1.75 squares (3.5 WU) reliably covers an orthogonal (2 WU) OR diagonal (~2.83 WU)
// neighbouring square with margin for off-grid placement, without reaching a
// 2-square gap (4 WU). Shared by melee reach, the engagement lock icon, and Sneak
// Attack so all three triggers stay identical.
export const ADJACENT_WU = 1.75 * WORLD_UNITS_PER_SQUARE;   // = 3.5 world units (1.75 squares)
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
  goblin3:  0x33880a,
  goblinchieftain: 0x33880a,
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
  cameraFar:         1500,
  cameraPos:         [0, 14.2, 50.1],
  cameraPlayTarget:  29,
  orbitMinDist:      10,
  orbitMaxDist:      20,
  orbitDamping:      0.06,
  ambientIntensity:  4.2,
  moonIntensity:     2.88,
  moonPos:           [4, 10, -39],
  shadowMapSize:     1024,   // was 2048 — halves shadow-map fill + VRAM; fine for the tactical view
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
    hp: 5, ac: 12, speed: 30, initiative: 0,
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
    hp: 7, ac: 15, speed: 30, initiative: 0,
    profBonus: 2,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [
      { name: 'Scimitar', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'dex' },
      { name: 'Shortbow', type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  // Rigged Meshy goblin (goblin2.glb) — "Young Goblin": Commoner stat block (CR 0,
  // no XP) but a Claw attack (1d4 slashing) instead of a club. Small goblin, so it's
  // scaled down from the base goblin; scale/anchorY are unverified in-game — nudge
  // with [ / ] if it floats/sinks or reads too big.
  goblin2: {
    name: 'Young Goblin',
    team: 'red',
    size: 'small',
    race: 'goblin',
    dark: 0x0f2800, mid: 0x1e5000, bright: 0x33880a, emissive: 0x001100,
    legH: 0.40, torsoW: 0.58, headS: 0.38, wpnH: 0.90, wpnColor: 0x556644,
    scale: [0.5, 0.5, 0.5],
    anchorY: 0.85,
    // CR 0 — Commoner-tier (no XP)
    detect: 20,
    hp: 4, ac: 10, speed: 30, initiative: 0,
    profBonus: 2,
    passivePerception: 10,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    attacks: [
      { name: 'Claw', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'str', damageType: 'slashing' },
    ],
  },

  // Rigged Meshy goblin (goblin3.glb) — full base-Goblin stat block (CR 1/4), just a
  // higher-detail model with the hobgoblin clip family (Archery_Shot_1 + Right_Hand_Sword_Slash),
  // so it carries both a Scimitar and a Shortbow like the base goblin. scale/anchorY are
  // BBOX-DERIVED and unverified in-game (native ~1.0 unit tall, feet at origin) — nudge with [ / ].
  goblin3: {
    name: 'Goblin Raider',
    team: 'red',
    race: 'goblin',
    dark: 0x0f2800, mid: 0x1e5000, bright: 0x33880a, emissive: 0x001100,
    scale: [1.15, 1.15, 1.15],
    anchorY: 1.35,
    // CR 1/4 — Easy
    detect: 20,
    hp: 7, ac: 15, speed: 30, initiative: 0,
    profBonus: 2,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    attacks: [
      { name: 'Scimitar', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'dex' },
      { name: 'Shortbow', type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  // Goblin Boss (D&D 5e, CR 1) — dedicated rigged model goblinchieftain.glb. Melee-only clip
  // set (Idle_5, Walking, Running, Right_Hand_Sword_Slash, Dead — no archery), so despite the
  // book's Javelin option this is a two-Scimitar bruiser. Multiattack uses the all-melee ettin
  // pattern (two Scimitar swings). scale/anchorY are BBOX-DERIVED (native ~1.35 WU tall, feet at
  // origin) and unverified in-game — nudge with [ / ]. See-through BLEND material was flipped to
  // OPAQUE during optimization.
  goblinchieftain: {
    name: 'Goblin Boss',
    team: 'red',
    race: 'goblin',
    dark: 0x0f2800, mid: 0x1e5000, bright: 0x33880a, emissive: 0x001100,
    scale: [1.15, 1.15, 1.15],
    anchorY: 1.7,
    // CR 1 — a cut above the rank-and-file goblins
    detect: 20,
    hp: 21, ac: 17, speed: 30, initiative: 0,
    profBonus: 2,
    abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 8, cha: 10 },
    // Two Scimitar swings (all-melee ettin pattern). The 2024 Goblin Boss can also Nimble
    // Escape; not modelled (no bonus-action disengage system for enemies yet).
    multiattack: ['Scimitar', 'Scimitar'],
    multiattackNote: 'Multiattack. The goblin boss makes two attacks with its scimitar.',
    attacks: [
      { name: 'Scimitar', type: 'melee', range: 5, dice: 1, sides: 6, dmgBonus: 2, statMod: 'dex' },
    ],
  },

  // Standard D&D Commoner (CR 0, no XP). team:'red' so it appears in the bestiary and
  // can be placed as a (harmless) combatant. Reuses the peasant model (static pose);
  // Club, 1d4 bludgeoning. Medium humanoid.
  commoner: {
    name: 'Commoner',
    team: 'red',
    size: 'medium',
    scale:   [0.9, 0.9, 0.9],
    yOffset: 0.9,
    anchorY: 1.9,
    detect: 20,
    hp: 4, ac: 10, speed: 30, initiative: 0,
    profBonus: 2,
    passivePerception: 10,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    attacks: [
      { name: 'Club', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'str', damageType: 'bludgeoning' },
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
    hp: 15, ac: 13, speed: 30, initiative: 0,
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
    // He throws a spear, not an arrow — see javelin.js.
    projectile: 'javelin',
    // 90° counter-clockwise from the non-elf default (-π/2 → 0), which had him throwing
    // off to one side instead of at the target. Same correction Gobo needed.
    rangedRotY: 0,
    // CR 2 — Hard
    detect: 20,
    hp: 59, ac: 11, speed: 40, initiative: 0,
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
    hp: 11, ac: 13, speed: 40, initiative: 0, profBonus: 2,
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'dex',
        note: 'DC 11 STR save or knocked prone' },
    ],
  },

  ice_mephit: {
    name: 'Ice Mephit', team: 'red',
    scale: [0.75, 0.75, 0.75], anchorY: 1.2,
    hp: 21, ac: 11, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 7, dex: 13, con: 10, int: 9, wis: 11, cha: 12 },
    attacks: [
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'dex' },
    ],
  },

  gnoll: {
    name: 'Gnoll', team: 'red',
    // 1.47× the base export. anchorY tracks the scale, or the HP bar sits at his chest.
    scale: [1.62, 1.62, 1.62], anchorY: 2.94,
    // NO rangedRotY here on purpose: the non-elf default (-π/2) is already correct for
    // gnoll2's Archery_Shot_1, same as the other units carrying that clip (hobgoblin, kobold).
    // The old gnoll.glb DID need rotY 0, but only because its ranged slot held a melee slash
    // standing in for a bow — that clip was authored facing forward. The correction belongs
    // to the clip, not to the rig, so it left with the clip. Verified in game: rotY 0 aims him
    // at 3 o'clock and +π/2 turns his back to the target.
    //
    // Loose the arrow mid-clip rather than after it ends (the default), so the shot doesn't
    // lag behind the animation. Archery_Shot_1 is 1.0s. Tuned by eye to 800ms — late in the
    // clip, but the shot reads as leaving the bow rather than trailing it. Do NOT use the
    // peak-draw frame (~250ms): the arrow visibly leaves before he has finished drawing.
    rangedReleaseMs: 800,
    hp: 22, ac: 15, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 14, dex: 10, con: 11, int: 6, wis: 10, cha: 7 },
    attacks: [
      { name: 'Spear',   type: 'melee',  range: 5,   dice: 1, sides: 6, statMod: 'str' },
      { name: 'Longbow', type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex' },
    ],
  },

  hyena: {
    name: 'Hyena', team: 'red',
    // ~3.3x the base export (0.825 → 2.72); anchorY tracks the scale so the HP bar stays overhead.
    scale: [2.7225, 2.7225, 2.7225], anchorY: 3.63,
    hp: 5, ac: 11, speed: 50, initiative: 0, profBonus: 2,
    abilities: { str: 11, dex: 13, con: 12, int: 2, wis: 12, cha: 5 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  giant_spider: {
    name: 'Giant Spider', team: 'red',
    scale: [1.2, 1.2, 1.2], anchorY: 1.6,
    // Web shot was landing 45° clockwise of the target. Rotate the ranged clip 45°
    // counter-clockwise from the non-elf default (-π/2 → -π/4).
    rangedRotY: -Math.PI / 4,
    hp: 26, ac: 14, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    attacks: [
      // A landed bite ALSO forces a CON save or the venom bites deeper — see `poison`
      // handling in _executeAttack. Failing the save is straight 2d8 poison damage on top
      // of the bite; it is not a lingering condition.
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'dex',
        poison: { saveStat: 'con', saveDC: 11, dice: 2, sides: 8 },
        note: 'DC 11 CON or 2d8 poison dmg' },
      // Ranged web: dex(+3)+prof(+2) = +5 to hit. No damage — restrains on hit. Restrained is
      // an ACTION SAVE (setActionSave in combat.js): the victim can do nothing but SPEND ITS
      // ACTION on a DC 12 STR save to tear loose, via the SAVING THROW hotbar button. It is
      // deliberately not auto-rolled — whether to burn the turn struggling is the player's call.
      { name: 'Web', type: 'ranged', range: 40, statMod: 'dex', web: true, restrainDC: 12,
        note: 'Restrain on hit; DC 12 STR to break free' },
    ],
  },

  twig_blight: {
    name: 'Twig Blight', team: 'red',
    scale: [0.65, 0.65, 0.65], anchorY: 0.9,
    hp: 4, ac: 13, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 6, dex: 13, con: 12, int: 4, wis: 8, cha: 3 },
    attacks: [
      { name: 'Claws', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
    ],
  },

  stirge: {
    name: 'Stirge', team: 'red',
    scale: [0.5, 0.5, 0.5], anchorY: 0.8, hoverY: 2.5,
    hp: 2, ac: 14, speed: 40, initiative: 0, profBonus: 2,
    abilities: { str: 4, dex: 16, con: 11, int: 2, wis: 8, cha: 6 },
    attacks: [
      { name: 'Blood Drain', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex',
        note: 'Attaches on hit; drains 1d4+3 HP/turn' },
    ],
  },

  giant_rat: {
    name: 'Giant Rat', team: 'red',
    // Model origin is centered (mesh min y ≈ -1.0), so feet sit below origin;
    // yOffset lifts them to ground. Grounding is bbox-derived — nudge with [ / ] if off.
    scale: [0.65, 0.65, 0.65], yOffset: 0.65, anchorY: 0.9,
    hp: 7, ac: 12, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 7, dex: 15, con: 11, int: 2, wis: 10, cha: 4 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
    ],
  },

  troglodyte: {
    name: 'Troglodyte', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 1.6,
    hp: 13, ac: 11, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 14, dex: 10, con: 14, int: 6, wis: 10, cha: 6 },
    attacks: [
      { name: 'Claw', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'str' },
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'str' },
    ],
  },

  constrictor_snake: {
    name: 'Constrictor Snake', team: 'red',
    scale: [2.5, 2.5, 2.5], anchorY: 2.0,
    hp: 13, ac: 12, speed: 30, initiative: 0, profBonus: 2,
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
    hp: 22, ac: 15, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 15, dex: 10, con: 13, int: 7, wis: 12, cha: 7 },
    attacks: [
      { name: 'Heavy Club', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'str' },
      { name: 'Javelin',    type: 'ranged', range: 15, longRange: 30, rawLongRange: 60, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  bugbear: {
    name: 'Bugbear', team: 'red',
    scale: [1.25, 1.25, 1.25], anchorY: 2.4,
    hp: 27, ac: 16, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    attacks: [
      { name: 'Morningstar', type: 'melee',  range: 5,  dice: 2, sides: 8, statMod: 'str' },
      { name: 'Javelin',     type: 'ranged', range: 15, longRange: 30, rawLongRange: 60, dice: 2, sides: 6, statMod: 'str' },
    ],
  },

  warg: {
    name: 'Warg', team: 'red',
    scale: [1.45, 1.45, 1.45], anchorY: 1.6,
    hp: 26, ac: 13, speed: 50, initiative: 0, profBonus: 2,
    abilities: { str: 17, dex: 12, con: 13, int: 7, wis: 11, cha: 8 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'DC 13 STR save or knocked prone' },
    ],
  },

  dire_wolf: {
    name: 'Dire Wolf', team: 'red',
    scale: [1.3, 1.3, 1.3], anchorY: 1.9,
    hp: 37, ac: 14, speed: 50, initiative: 0, profBonus: 2,
    abilities: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'DC 13 STR save or knocked prone' },
    ],
  },

  hobgoblin: {
    name: 'Hobgoblin', team: 'red',
    // 50% larger than the base export — anchorY scales with it, or the HP bar would
    // float at his chest instead of over his head.
    scale: [1.5, 1.5, 1.5], anchorY: 3.0,
    hp: 11, ac: 18, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 },
    attacks: [
      { name: 'Longsword', type: 'melee',  range: 5,  dice: 1, sides: 8, statMod: 'str' },
      { name: 'Longbow',   type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex' },
    ],
  },

  hobgoblin_captain: {
    name: 'Hobgoblin Captain', team: 'red',
    // Dedicated model hobgoblinchief.glb (native height ~1.08 WU vs the base hobgoblin's
    // ~1.37). scale 2.2 → ~2.39 WU in-world, ~15% taller than a rank-and-file hobgoblin
    // (1.5×1.37≈2.06). anchorY tracks the taller silhouette or the HP bar floats at his chest.
    scale: [2.2, 2.2, 2.2], anchorY: 3.5,
    hp: 58, ac: 17, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 15, dex: 14, con: 14, int: 12, wis: 10, cha: 13 },
    // Aura of Authority (10-ft emanation granting it + allies advantage on attacks and
    // saves) is NOT modelled — the combat engine has no team-buff aura system yet. Left as
    // a note so it can be wired if/when auras land.
    // Multiattack (ettin/owlbear pattern): one Greatsword swing + one Longbow shot, "in any
    // combination" per the 2024 block. Flurries only on a melee opener (Greatsword →
    // Right_Hand_Sword_Slash, then Longbow → Archery_Shot_1); at range the AI just takes the
    // single Longbow shot. The model's Left_Hook_from_Guard clip is intentionally unused.
    multiattack: ['Greatsword', 'Longbow'],
    multiattackNote: 'Multiattack. The hobgoblin makes two attacks with its greatsword or longbow in any combination.',
    attacks: [
      // str+2 & prof+2 → +4 to hit, 2d6+2 slashing — matches the book. The 2024 block adds
      // 1d6 poison on a hit; the engine only does SAVE-BASED poison, so it's a CON-save
      // rider here rather than the book's flat no-save damage.
      { name: 'Greatsword', type: 'melee',  range: 5,  dice: 2, sides: 6, statMod: 'str',
        poison: { saveStat: 'con', saveDC: 13, dice: 1, sides: 6 },
        note: '+1d6 poison (DC 13 CON negates)' },
      { name: 'Longbow',    type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex',
        poison: { saveStat: 'con', saveDC: 13, dice: 2, sides: 4 },
        note: '+2d4 poison (DC 13 CON negates)' },
    ],
  },

  gnoll_pack_lord: {
    name: 'Gnoll Pack Lord', team: 'red',
    scale: [1.25, 1.25, 1.25], anchorY: 2.3,
    // Same GLB and the same Longbow as the base gnoll, so it needs the same handling:
    // no rangedRotY override (the default is right for Archery_Shot_1), and the arrow
    // loosed before the clip ends. See the gnoll entry above for why.
    rangedReleaseMs: 800,
    hp: 49, ac: 15, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 11, cha: 9 },
    attacks: [
      { name: 'Flail',   type: 'melee',  range: 5,   dice: 1, sides: 8, statMod: 'str' },
      { name: 'Longbow', type: 'ranged', range: 75, longRange: 150, rawLongRange: 300, dice: 1, sides: 8, statMod: 'dex' },
    ],
  },

  yuan_ti_pureblood: {
    name: 'Yuan-ti Pureblood', team: 'red',
    scale: [1.1, 1.1, 1.1], anchorY: 2.1,
    hp: 40, ac: 11, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 11, dex: 16, con: 11, int: 13, wis: 12, cha: 14 },
    attacks: [
      { name: 'Scimitar', type: 'melee',  range: 5,  dice: 2, sides: 6, statMod: 'dex' },
      { name: 'Shortbow', type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex' },
    ],
  },

  snake: {
    name: 'Giant Poisonous Snake', team: 'red',
    scale: [3.0, 3.0, 3.0], anchorY: 2.4,
    hp: 11, ac: 14, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 10, dex: 18, con: 11, int: 1, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex',
        note: 'DC 11 CON or 3d6 poison dmg' },
    ],
  },

  giant_constrictor_snake: {
    name: 'Giant Constrictor Snake', team: 'red',
    scale: [7.0, 7.0, 7.0], anchorY: 5.6,
    hp: 60, ac: 12, speed: 30, initiative: 0, profBonus: 2,
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
    hp: 84, ac: 15, speed: 30, initiative: 0, profBonus: 3,
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
    hp: 51, ac: 12, speed: 40, initiative: 0, profBonus: 3,
    abilities: { str: 18, dex: 13, con: 16, int: 8, wis: 12, cha: 7 },
    attacks: [
      { name: 'Claw', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'Chilling Gaze: DC 13 CON or paralyzed 1 min' },
    ],
  },

  gnoll_fang: {
    name: 'Gnoll Fang of Yeenoghu', team: 'red',
    scale: [1.3, 1.3, 1.3], anchorY: 2.5,
    hp: 65, ac: 14, speed: 30, initiative: 0, profBonus: 3,
    abilities: { str: 17, dex: 12, con: 14, int: 10, wis: 11, cha: 12 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str' },
      { name: 'Claw',  type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  owlbear: {
    name: 'Owlbear', team: 'red',
    // Three 20% bumps up from the original 1.5 (→ 1.8 → 2.16 → 2.59). anchorY tracks it
    // (3.0 → 5.18) or the HP bar floats inside the model's head instead of above it.
    scale: [2.59, 2.59, 2.59], anchorY: 5.18, large: true,
    hp: 59, ac: 13, speed: 40, initiative: 0, profBonus: 3,
    abilities: { str: 20, dex: 12, con: 17, int: 3, wis: 12, cha: 7 },
    // Its loco clip (jump_push_up — see units.js) is authored far too slow for the ground
    // speed it actually covers, so it skated. Play it at 300% when charging. Run only:
    // walk uses the SAME clip and stays at authored speed.
    runTimeScale: 3,
    // jump_push_up leaves the body flat/belly-down. Carry the head end 45° above the feet
    // end while moving so it reads as a charging beast rather than a push-up. Negative is
    // nose-UP (see _applyLocoPitch); flip the sign if it ends up nose-down.
    locoPitchDeg: -45,
    // animClip: each attack drives its own clip out of the new owlbear.glb, the same way the
    // ettin gives its battleaxe and morningstar different swings. The clip names lie (see the
    // owlbear entry in units.js): Right_Hand_Sword_Slash is the claw swipe — there is no
    // sword — and Zombie_Scream is the beak/bite lunge.
    attacks: [
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 8,  statMod: 'str', animClip: 'Right_Hand_Sword_Slash' },
      { name: 'Bite',  type: 'melee', range: 5, dice: 1, sides: 10, statMod: 'str', animClip: 'Zombie_Scream' },
    ],
    // Multiattack — identical mechanics to the ettin: an ordered list of attack names made in
    // ONE action, each rolling to hit separately, with movement allowed between the swings.
    multiattack: ['Claws', 'Bite'],
    multiattackNote: 'Multiattack. The owlbear makes two attacks: one with its claws and one with its bite.',
  },

  werewolf: {
    name: 'Werewolf', team: 'red',
    scale: [1.2, 1.2, 1.2], anchorY: 2.4,
    hp: 58, ac: 12, speed: 30, initiative: 0, profBonus: 3,
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
    hp: 114, ac: 14, speed: 40, initiative: 0, profBonus: 3,
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
    hp: 66, ac: 15, speed: 30, initiative: 0, profBonus: 3,
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
    hp: 136, ac: 15, speed: 20, initiative: 0, profBonus: 3,
    abilities: { str: 18, dex: 8, con: 16, int: 5, wis: 10, cha: 5 },
    attacks: [
      { name: 'Slam', type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str',
        note: 'Lightning Absorption: heals on lightning hit' },
    ],
  },

  giant_frog: {
    name: 'Giant Frog', team: 'red',
    scale: [0.85, 0.85, 0.85], anchorY: 1.2,
    hp: 18, ac: 11, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 12, dex: 13, con: 11, int: 2, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str',
        note: 'DC 11 STR or grappled; can swallow Small creatures' },
    ],
  },

  bullywug: {
    name: 'Bullywug', team: 'red',
    scale: [0.90, 0.90, 0.90], anchorY: 1.5,
    hp: 11, ac: 15, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 14, dex: 12, con: 13, int: 7, wis: 10, cha: 7 },
    attacks: [
      { name: 'Bite',  type: 'melee',  range: 5,  dice: 1, sides: 4, statMod: 'str' },
      { name: 'Spear', type: 'ranged', range: 20, longRange: 30, rawLongRange: 60, dice: 1, sides: 6, statMod: 'str' },
    ],
  },

  mud_mephit: {
    name: 'Mud Mephit', team: 'red',
    scale: [0.75, 0.75, 0.75], anchorY: 1.1,
    hp: 27, ac: 11, speed: 20, initiative: 0, profBonus: 2,
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
    hp: 19, ac: 12, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 15, dex: 10, con: 13, int: 2, wis: 10, cha: 5 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 10, statMod: 'str',
        note: 'DC 12 STR or grappled and restrained' },
    ],
  },

  giant_toad: {
    name: 'Giant Toad', team: 'red',
    scale: [1.05, 1.05, 1.05], anchorY: 1.3,
    hp: 39, ac: 11, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 15, dex: 13, con: 11, int: 2, wis: 10, cha: 3 },
    attacks: [
      { name: 'Bite', type: 'melee', range: 5, dice: 1, sides: 10, statMod: 'str',
        note: 'DC 13 STR or swallowed (3d6 acid damage per turn)' },
    ],
  },

  bullywug_croaker: {
    name: 'Bullywug Croaker', team: 'red',
    scale: [1.05, 1.05, 1.05], anchorY: 1.8,
    hp: 30, ac: 15, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 8 },
    attacks: [
      { name: 'Bite',  type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'str' },
      { name: 'Spear', type: 'ranged', range: 20, longRange: 30, rawLongRange: 60, dice: 1, sides: 8, statMod: 'str' },
    ],
  },

  swarm_of_insects: {
    name: 'Swarm of Insects', team: 'red',
    scale: [0.80, 0.80, 0.80], anchorY: 0.8, hoverY: 2,
    hp: 22, ac: 12, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 3, dex: 13, con: 10, int: 1, wis: 7, cha: 1 },
    attacks: [
      { name: 'Bites', type: 'melee', range: 0, dice: 4, sides: 4, statMod: 'dex',
        note: 'Swarm: shares space with target; 2d4 when below half HP' },
    ],
  },

  lizardfolk_shaman: {
    name: 'Lizardfolk Shaman', team: 'red',
    scale: [1.05, 1.05, 1.05], anchorY: 2.1,
    hp: 45, ac: 13, speed: 30, initiative: 0, profBonus: 2,
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
    hp: 82, ac: 17, speed: 30, initiative: 0, profBonus: 3,
    abilities: { str: 18, dex: 12, con: 16, int: 13, wis: 14, cha: 14 },
    attacks: [
      { name: 'Claws',          type: 'melee',  range: 5,  dice: 2, sides: 8, statMod: 'str' },
      { name: 'Ray of Sickness', type: 'ranged', range: 30, dice: 2, sides: 8, statMod: 'cha',
        note: 'DC 14 CON or poisoned until end of next turn' },
    ],
  },

  ghoul: {
    name: 'Ghoul', team: 'red', undead: true,
    scale: [1.5, 1.5, 1.5], anchorY: 3.0,
    hp: 22, ac: 12, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
    attacks: [
      { name: 'Bite',  type: 'melee', range: 5, dice: 2, sides: 6, hitBonus: 2, dmgBonus: 2 },
      { name: 'Claws', type: 'melee', range: 5, dice: 2, sides: 4, statMod: 'dex',
        note: 'DC 10 CON or paralyzed until end of next turn' },
    ],
  },

  zombie: {
    name: 'Zombie', team: 'red', undead: true,
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 22, ac: 8, speed: 20, initiative: 0, profBonus: 2,
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    attacks: [
      { name: 'Slam', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str',
        note: 'Undead Fortitude: DC 5+dmg CON save to stay at 1 HP' },
    ],
  },

  skeleton: {
    name: 'Skeleton', team: 'red', undead: true,
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 13, ac: 13, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    attacks: [
      { name: 'Shortsword', type: 'melee',  range: 5,  dice: 1, sides: 6, statMod: 'dex' },
      { name: 'Shortbow',   type: 'ranged', range: 40, longRange: 80, rawLongRange: 160, dice: 1, sides: 6, statMod: 'dex',
        note: 'Vulnerability: bludgeoning; Immunity: poison, exhaustion' },
    ],
  },

  shadow: {
    name: 'Shadow', team: 'red', undead: true,
    scale: [1.771, 1.771, 1.771], anchorY: 3.54, hoverY: -1,
    hp: 16, ac: 12, speed: 40, initiative: 0, profBonus: 2,
    abilities: { str: 6, dex: 14, con: 13, int: 6, wis: 10, cha: 8 },
    attacks: [
      { name: 'Strength Drain', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'dex',
        note: 'Reduces target STR by 1d4; target dies if STR reaches 0' },
    ],
  },

  specter: {
    name: 'Specter', team: 'red',
    scale: [1.0, 1.0, 1.0], anchorY: 2.5,
    hp: 22, ac: 12, speed: 50, initiative: 0, profBonus: 2,
    abilities: { str: 1, dex: 14, con: 11, int: 10, wis: 10, cha: 11 },
    attacks: [
      { name: 'Life Drain', type: 'melee', range: 5, dice: 3, sides: 6, statMod: 'dex', dmgBonus: 0,
        note: 'DC 10 CON save or max HP reduced by damage dealt' },
    ],
  },

  ghast: {
    name: 'Ghast', team: 'red',
    scale: [1.1, 1.1, 1.1], anchorY: 2.2,
    hp: 36, ac: 13, speed: 30, initiative: 0, profBonus: 2,
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
    hp: 45, ac: 14, speed: 30, initiative: 0, profBonus: 2,
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
    hp: 58, ac: 12, speed: 40, initiative: 0, profBonus: 3,
    abilities: { str: 1, dex: 14, con: 12, int: 12, wis: 11, cha: 17 },
    attacks: [
      { name: 'Corrupting Touch', type: 'melee', range: 5, dice: 3, sides: 6, statMod: 'dex', dmgBonus: 0,
        note: 'Wail (1/day): DC 13 CON or 3d6 psychic + frightened' },
    ],
  },

  revenant: {
    name: 'Revenant', team: 'red',
    scale: [1.2, 1.2, 1.2], anchorY: 2.4,
    hp: 136, ac: 13, speed: 30, initiative: 0, profBonus: 3,
    abilities: { str: 18, dex: 14, con: 18, int: 12, wis: 14, cha: 16 },
    attacks: [
      { name: 'Greatsword', type: 'melee', range: 5, dice: 2, sides: 6, statMod: 'str',
        note: 'Regeneration: regains 10 HP at turn start; Vengeful Tracker' },
    ],
  },

  hill_giant: {
    name: 'Hill Giant', team: 'red',
    scale: [1.0, 1.0, 1.0], large: true, anchorY: 3.2,
    hp: 105, ac: 13, speed: 40, initiative: 0, profBonus: 3,
    abilities: { str: 21, dex: 8, con: 19, int: 5, wis: 9, cha: 6 },
    attacks: [
      { name: 'Greatclub', type: 'melee',  range: 5,  dice: 3, sides: 8,  statMod: 'str' },
      { name: 'Rock',      type: 'ranged', range: 30, longRange: 60, rawLongRange: 120, dice: 3, sides: 10, statMod: 'str' },
    ],
  },

  ettin: {
    name: 'Ettin', team: 'red',
    scale: [1.8, 1.8, 1.8], large: true, anchorY: 3.8,
    hp: 85, ac: 12, speed: 40, initiative: 0, profBonus: 2,
    abilities: { str: 21, dex: 8, con: 17, int: 6, wis: 10, cha: 8 },
    // animClip: each head/arm swings its own weapon — battleaxe in the right hand,
    // morningstar in the left. Both clips are in ettin.glb; without these the generic
    // 'Attack' clip plays for both and the two weapons look identical.
    attacks: [
      { name: 'Battleaxe',   type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str', dmgBonus: 5, animClip: 'Right_Hand_Sword_Slash' },
      { name: 'Morningstar', type: 'melee', range: 5, dice: 2, sides: 8, statMod: 'str', dmgBonus: 5, animClip: 'Left_Hook_from_Guard' },
    ],
    // Multiattack — an ordered list of attack names the creature makes in ONE turn,
    // each its own to-hit roll (the first such creature in the game). The two-headed
    // ettin swings both weapons: ~28 dmg a round on a full hit, so it hits hard.
    multiattack: ['Battleaxe', 'Morningstar'],
    multiattackNote: 'Multiattack. The ettin makes two attacks: one with its battleaxe and one with its morningstar.',
  },

  mane: {
    name: 'Mane', team: 'red',
    scale: [0.85, 0.85, 0.85], anchorY: 1.4,
    // CR 1/8 — Very Easy
    detect: 20,
    hp: 9, ac: 9, speed: 20, initiative: 0, profBonus: 2,
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
    hp: 18, ac: 11, speed: 20, initiative: 0, profBonus: 2,
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
    hp: 10, ac: 13, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 6, dex: 14, con: 13, int: 4, wis: 8, cha: 5 },
    attacks: [
      { name: 'Bite',   type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex' },
      { name: 'Claws',  type: 'melee', range: 5, dice: 1, sides: 4, statMod: 'dex',
        note: 'Shriek (recharge 6): creatures within 10 ft DC 11 WIS or frightened' },
    ],
  },

  nothic: {
    name: 'Nothic', team: 'red',
    // Static (unrigged) model — natural bounding box is ~1.8 units tall, already
    // close to Medium-creature scale, so scale stays 1:1. Origin is at the mesh's
    // volumetric center rather than its feet, so yOffset lifts it to sit on the
    // ground (raises it by the same amount its lowest point sits below origin).
    scale: [1.0, 1.0, 1.0], yOffset: 0.90, anchorY: 2.0,
    // CR 2
    hp: 45, ac: 15, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 14, dex: 16, con: 16, int: 13, wis: 8, cha: 12 },
    attacks: [
      { name: 'Bite',         type: 'melee',  range: 5,  dice: 1, sides: 10, statMod: 'str' },
      { name: 'Rotting Gaze', type: 'ranged', range: 30, dice: 3, sides: 6,  statMod: 'int',
        note: 'Necrotic gaze attack' },
    ],
  },

  // ── Named bosses ──────────────────────────────────────────────────────────

  morvath: {
    name: 'Morvath',
    team: 'red',
    undead: true,
    aiStyle: 'spellcaster',
    scale: [1.0, 1.0, 1.0], anchorY: 2.0,
    hp: 52, ac: 14, speed: 30, initiative: 0, profBonus: 2,
    abilities: { str: 10, dex: 13, con: 11, int: 11, wis: 13, cha: 14 },
    spellSlots: 999,   // effectively unlimited: Morvath never runs dry on any spell
    attacks: [
      { name: 'Claws',           type: 'melee',    range: 5,  dice: 1, sides: 4,  dmgBonus: 2, statMod: 'dex' },
      { name: 'Inflict Wounds',  type: 'melee',    range: 5,  dice: 1, sides: 10, hitBonus: 3, spellSlotCost: 1 },
      { name: 'Grave Curse',     type: 'aoe_save', range: 30, dice: 1, sides: 6,  dmgBonus: 2,
        saveType: 'con', saveDC: 12, aoeRadius: 15 },  // no spellSlotCost: Morvath casts it every round without limit
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
    profBonus: 2,
    armorProficiency: { armor: [], shields: false },
    weaponProficiency: { simple: false, martial: false, weapons: ['Dagger', 'Dart', 'Sling', 'Quarterstaff', 'Light Crossbow'] },
    startingEquipment: { chest: 'robe2', belt: 'belt13', cloak: 'cloak12', feet: 'sandals6', 'main-hand': 'stave8', 'bag-1': 'bag1' },
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    attacks: [
      { name: 'Quarterstaff', type: 'melee', range: 5, dice: 1, sides: 6, statMod: 'str' },
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
    profBonus: 2,
    armorProficiency: { armor: ['Light', 'Medium', 'Heavy'], shields: true },
    weaponProficiency: { simple: true, martial: false, weapons: ['Battleaxe', 'Handaxe', 'Light Hammer', 'Warhammer'] },
    // warhammer9's ART was renamed to lighthammer2, so that id no longer exists — repointed to
    // warhammer1, an identical Warhammer (1d8 versatile 1d10). Keeps his kit unchanged; taken
    // literally the rename would have handed him a 1d4 Light Hammer.
    startingEquipment: { chest: 'chainarmor1', legs: 'chainlegs1', feet: 'plateboots4', 'main-hand': 'warhammer1', 'off-hand': 'shield1', 'bag-1': 'bag1' },
    abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 15, cha: 12 },
    attacks: [
      { name: 'Warhammer', type: 'melee', range: 5, dice: 1, sides: 8, statMod: 'str' },
    ],
  },

  human: {
    name: 'Gobo',
    class: 'Human Barbarian',
    team: 'blue',
    projectile: 'axe',   // tumbling handaxe (thrownAxe.js), not an arrow
    rangedRotY: 0,   // face the target (12 o'clock) on thrown-axe attack; non-elf default (-π/2) pointed him at 3 o'clock
    dark: 0x252535, mid: 0x40405a, bright: 0x7878a0, emissive: 0x050508,
    legH: 0.58, torsoW: 0.70, headS: 0.44, wpnH: 1.28, wpnColor: 0xccccdd,
    scale: [1.496, 1.496, 1.496],
    anchorY: 2.31,
    hp: 19, ac: 14, speed: 30, initiative: 0,
    hitDie: 12,
    profBonus: 2,
    rage: { uses: 1, dmgBonus: 2 },
    unarmoredDefense: true,
    armorProficiency: { armor: ['Light', 'Medium'], shields: true },
    weaponProficiency: { simple: true, martial: true, weapons: [] },
    startingEquipment: { 'main-hand': 'greataxe', legs: 'loincloth1', feet: 'leatherboots2', 'bag-1': 'bag1' },
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
    profBonus: 2,
    sneakAttack: { dice: 1, sides: 6 },
    armorProficiency: { armor: ['Light'], shields: false },
    weaponProficiency: { simple: true, martial: false, weapons: ['Hand Crossbow', 'Longsword', 'Rapier', 'Shortsword', 'Shortbow'] },
    // sword4 -> longsword1 and longbow4 -> shortbow: both ids died when their art was renamed.
    // Longsword is a step up from his old Shortsword (1d8 vs 1d6) and is in his named martials,
    // so it's proficiency-legal. Note attacks still come from UNIT_TYPES.attacks, not the
    // equipped weapon, so this changes his kit's LOOK and inventory, not his damage — yet.
    startingEquipment: { chest: 'leatherarmor1', belt: 'belt8', feet: 'leatherboots2', 'main-hand': 'longsword1', 'off-hand': 'shortbow', 'bag-1': 'bag1' },
    // Bag CONTENTS, not worn gear (see units.js buildUnit). Milo is the only hero with
    // a tool kit; Pick Locks (L6) checks his bags for thieves_tools and refuses without it.
    startingBagItems: ['thieves_tools'],
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

  // Townsfolk dwarf NPC. Rigged GLB. Scale/grounding are a first guess based on
  // the hero dwarf (scale ~0.99) — the model's bind-pose height and origin are
  // unverified in-game, so nudge scale/yOffset with [ / ] and the dev tools if
  // it floats, sinks, or reads too big/small.
  npc_dwarf: {
    name: 'Dwarf',
    team: 'npc',
    scale:      [0.99, 0.99, 0.99],
    anchorY:    1.45,
  },

  // Townsfolk peasant NPC. Static-posed rigged GLB (peasant1.glb — no animation
  // clips, so it stands still). Bbox is center-origin, ~2 units tall raw; at scale
  // 0.9 it reads ~1.8 units (human height) and yOffset lifts the centered mesh so
  // its feet meet the ground. Grounding is bbox-derived and unverified in-game —
  // nudge scale/yOffset with [ / ] in the NPC editor if it floats or sinks.
  peasant: {
    name: 'Peasant',
    team: 'npc',
    scale:   [0.9, 0.9, 0.9],
    yOffset: 0.9,
    anchorY: 1.9,
  },

  // Solrac — animated peasant NPC (solrac.glb). Rigged, feet-at-origin (~1.62u tall in
  // bind pose); scale ~1.3 reads ~2.1u (adult height, matching the heroes). Has a
  // standing idle (Idle_11) plus loco + sit/cheer poses; idle is pinned in the units.js
  // clip map. The attached head's emissive was re-pointed to its base albedo so it
  // matches the body's brightness (see units.js emissive-primary material handling).
  // Grounding is bbox-derived — nudge scale/yOffset with [ / ] in the NPC editor.
  solrac: {
    name: 'Solrac',
    team: 'npc',
    scale:   [1.3, 1.3, 1.3],
    yOffset: 0.02,
    anchorY: 1.9,
  },

  // ── Townsfolk NPCs (assets/models/npcs/) ────────────────────────────────────
  // Static posed figures (no rig/anim), all team:'npc' — they stand in place.
  // scale/yOffset/anchorY are BBOX-DERIVED: every model is normalized to a ~2-unit
  // centre-origin box, so scale sets race height (human/elf ~1.9, dwarf ~1.5,
  // gnome ~1.15, halfling ~1.1 world units) and yOffset lifts the centred feet to
  // the ground. Still eyeball in-editor; nudge scale/Y with [ / ] if any look off.
  bard1:              { name: 'Bard',                team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  barmaid1:           { name: 'Barmaid',             team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  barmaid2:           { name: 'Barmaid 2',           team: 'npc', scale: [0.95, 0.95, 0.95], yOffset: 0.95, anchorY: 2.0 },
  darkelf1:           { name: 'Dark Elf',            team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  dwarf2:             { name: 'Dwarf (Townsfolk)',   team: 'npc', scale: [0.79, 0.79, 0.79], yOffset: 0.75, anchorY: 1.6 },
  dwarfwarrior:       { name: 'Dwarf Warrior',       team: 'npc', scale: [0.75, 0.75, 0.75], yOffset: 0.75, anchorY: 1.6 },
  elf2:               { name: 'Elf',                 team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  elffemale1:         { name: 'Elf Woman',           team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  elffemale2:         { name: 'Elf Woman 2',         team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  elfmonk:            { name: 'Elf Monk',            team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  gnome1:             { name: 'Gnome',               team: 'npc', scale: [0.61, 0.61, 0.61], yOffset: 0.58, anchorY: 1.25 },
  gnomemerchant:      { name: 'Gnome Merchant',      team: 'npc', scale: [0.61, 0.61, 0.61], yOffset: 0.58, anchorY: 1.25 },
  gnomemonk:          { name: 'Gnome Monk',          team: 'npc', scale: [0.6, 0.6, 0.6],   yOffset: 0.58, anchorY: 1.25 },
  gnomewarrior:       { name: 'Gnome Warrior',       team: 'npc', scale: [0.6, 0.6, 0.6],   yOffset: 0.58, anchorY: 1.25 },
  gnomewizard:        { name: 'Gnome Wizard',        team: 'npc', scale: [0.61, 0.61, 0.61], yOffset: 0.58, anchorY: 1.25 },
  halfling2:          { name: 'Halfling',            team: 'npc', scale: [0.55, 0.55, 0.55], yOffset: 0.55, anchorY: 1.2 },
  halflingadventurer: { name: 'Halfling Adventurer', team: 'npc', scale: [0.55, 0.55, 0.55], yOffset: 0.55, anchorY: 1.2 },
  halflingarcher:     { name: 'Halfling Archer',     team: 'npc', scale: [0.58, 0.58, 0.58], yOffset: 0.55, anchorY: 1.2 },
  halflingbarbarian:  { name: 'Halfling Barbarian',  team: 'npc', scale: [0.58, 0.58, 0.58], yOffset: 0.55, anchorY: 1.2 },
  halflingbard:       { name: 'Halfling Bard',       team: 'npc', scale: [0.58, 0.58, 0.58], yOffset: 0.55, anchorY: 1.2 },
  halflingrogue:      { name: 'Halfling Rogue',      team: 'npc', scale: [0.58, 0.58, 0.58], yOffset: 0.55, anchorY: 1.2 },
  humanpeasant1:      { name: 'Human Peasant',       team: 'npc', scale: [0.95, 0.95, 0.95], yOffset: 0.95, anchorY: 2.0 },
  humanpeasant2:      { name: 'Human Peasant 2',     team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  humanwarrior1:      { name: 'Human Warrior',       team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  orcbarmaid:         { name: 'Orc Barmaid',         team: 'npc', scale: [1.0, 1.0, 1.0],   yOffset: 0.95, anchorY: 2.0 },
  tiefling_bard:      { name: 'Tiefling Bard',       team: 'npc', scale: [0.95, 0.95, 0.95], yOffset: 0.95, anchorY: 2.0 },
  waitress1:          { name: 'Waitress',            team: 'npc', scale: [0.99, 0.99, 0.99], yOffset: 0.95, anchorY: 2.0 },

  // Flying familiar (Rasec's owl). Rigged GLB, bbox ~1.57 wide × 0.75 tall in
  // bind pose; at scale 0.66 it reads as a small bird (~0.5 units tall, ~1 unit
  // wingspan). Mesh origin sits mid-body (feet ≈ -0.22 local), so yOffset lifts
  // the talons to the group origin and hoverY floats it off the ground like a
  // bird in flight. NPC for now (no combat/familiar logic yet) — placeable via
  // the NPC editor. Grounding/hover are bbox-derived and unverified in-game;
  // nudge with [ / ] if it floats or sinks.
  owl: {
    name: 'Iffir',
    team: 'familiar',                  // its own faction: friendly, takes a turn, but never counted as a hero
    familiar: true,
    scale:   [0.44, 0.44, 0.44],
    yOffset: 0.15,
    hoverY:  1.5,   // combat flight height ≈ where it perched on Rasec's shoulder
    anchorY: 1.5,
    // ── D&D familiar stat block (inert while team:'npc' — wired up in Phase 2) ──
    // Tiny beast. Speed 5 ft / fly 60 ft — uses the fly speed for movement.
    hp: 1, ac: 11, speed: 60, profBonus: 2,
    // Initiative is DEX-driven like everyone else: bonus = initiative + DEX mod,
    // so with DEX 13 the owl rolls at +1.
    initiative: 0,
    abilities: { str: 3, dex: 13, con: 8, int: 2, wis: 12, cha: 7 },
    skills: { perception: 3, stealth: 3 },
    passivePerception: 13,
    // Traits: Flyby (no opportunity attacks when flying out of reach — already
    // free since combat has no OA system); Keen Hearing & Sight (advantage on
    // sight/hearing Perception — flavor until a perception-check system exists).
    flyby: true,
    keenSenses: true,
    // Familiar actions on its own turn (Phase 2): Help (grant Rasec advantage vs
    // the distracted target), Deliver Touch Spells (reaction — cast Rasec's touch
    // spell through the owl), and Scout/Spy (Hide, Search, Dash, Disengage).
    familiarActions: ['help', 'deliver_touch', 'hide', 'search', 'dash', 'disengage'],
    attacks: [],                       // familiars don't make attacks
  },
};

// Convenience lists
export const ENEMY_TYPES = ['kobold', 'goblin', 'orc', 'ogre'];
export const HERO_TYPES  = ['dwarf', 'human', 'elf', 'halfling'];

// CR values used to derive defender/attacker tier for the hit-chance formula.
// Stored as decimals so Math.ceil() works correctly (0.25 → ceil → 1, 2 → 2, etc.).
// All CRs < 1 produce tier 1; CR 2 → tier 2; CR 3 → tier 3; etc.
export const ENEMY_CR = {
  // ── CR 0 ────────────────────────────────────────────────────────
  // Math.max(1, Math.ceil(0)) → tier 1, same as CR 1/8, so combat math is safe.
  commoner:         0,
  goblin2:          0,
  // ── CR 1/8 ──────────────────────────────────────────────────────
  kobold:           0.125,
  twig_blight:      0.125,
  stirge:           0.125,
  giant_rat:        0.125,
  mane:             0.125,
  abyssal_chicken:  0.125,
  // ── CR 1/4 ──────────────────────────────────────────────────────
  goblin:           0.25,
  goblin3:          0.25,
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
  goblinchieftain:  1,
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
  nothic:           2,
  // ── CR 3 ────────────────────────────────────────────────────────
  yeti:             3,
  owlbear:          3,
  werewolf:         3,
  minotaur:         3,
  yuan_ti_malison:  3,
  green_hag:        3,
  wight:            3,
  hobgoblin_captain: 3,   // added 2026-07-16 — was the ONE red enemy with no CR row, so it
                          // derived 0 XP and would have dropped no loot. MM lists it at CR 3.
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
  morvath:          2,   // was 1 (2026-07-16). CR now pays out loot + XP, and CR 1 made the
                         // BOSS drop worse than an ordinary ogre. The bestiary already showed
                         // him as CR 2 — this is the two numbers agreeing at last.
};

// ── CR → XP ───────────────────────────────────────────────────────────────────
// CR IS THE SOURCE OF TRUTH. XP derives from it — never the reverse, and never typed
// per-enemy (user's rule, 2026-07-16).
//
// Why: xpReward used to be an independent hand-set field, and other systems back-derived
// from IT. That produced two live bugs:
//   • morvath: ENEMY_CR said 1, xpReward said 100 (= CR 2). CR now pays out loot, so the
//     BOSS would have dropped worse than an ordinary ogre. CR corrected to 2.
//   • combat.js's _XP_TO_EFF was keyed on D&D's RAW xp (25/50/100/200/…) while we store the
//     compressed scale (5/10/20/40/…). It matched ONE enemy out of 58, so every enemy
//     resolved to effective level 1 and the dynamic aggro radius never scaled at all.
// Both are the same mistake: deriving power from XP instead of from CR.
//
// These are OUR values, kept exactly as they were set — deliberately NOT D&D's raw XP.
// (They happen to be D&D's ÷ 5, which mirrors our 5-levels-per-D&D-level scale; CR 0 is the
// one exception, 0 rather than 2, so commoners are worth nothing.)
export const CR_TO_XP = {
  0:     0,
  0.125: 5,
  0.25:  10,
  0.5:   20,
  1:     40,
  2:     90,
  3:     140,
  4:     220,
  5:     360,
  // CR 6–30 have no values yet — no enemy above CR 5 exists. Add them here (and ONLY here)
  // when they do; xpRewardFor falls back to 0, so a new high-CR enemy is worth nothing until
  // its row lands, which is loud enough to notice.
};

export function xpRewardFor(type) {
  return CR_TO_XP[ENEMY_CR[type] ?? 0] ?? 0;
}

// Stamp the derived value onto each statblock at load. `xpReward` used to be typed by hand
// on all 59 enemies; those literals are GONE, and this is now the only thing that writes it.
// Done as a mutation rather than by threading xpRewardFor() through every reader because
// def.xpReward is read from five places that only hold the def, not the type key — this way
// they all keep working and all read the derived number.
//
// An enemy with no ENEMY_CR row (hobgoblin_captain today) gets 0 and is worth no XP. That's
// deliberate: silent-zero is a visible bug, whereas an invented default would be a quiet one.
for (const [type, def] of Object.entries(UNIT_TYPES)) {
  if (def?.team === 'red') def.xpReward = xpRewardFor(type);
}

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

// ── D&D level mapping ─────────────────────────────────────────────────────────
// OUR levels run 5 per D&D level, and the first band is short because we start at 1:
//   game 1–4 → D&D 1 · game 5–9 → D&D 2 · game 10–14 → D&D 3 · … · game 95+ → D&D 20
// i.e. floor(gameLevel/5) + 1. NOT ceil(gameLevel/5) — our level 5 IS D&D 2, not the
// top of D&D 1. rollToHit already scales on `(atkLvl/5)+1`, the same curve; keep them
// in agreement. XP_THRESHOLDS stops at game 20 (→ D&D 5) today, so table rows 6–20
// below are dormant until progression.js expands toward 100 as its comment promises.
export const DND_MAX_LEVEL = 20;
export function dndLevelFor(gameLevel) {
  return Math.max(1, Math.min(DND_MAX_LEVEL, Math.floor((gameLevel ?? 1) / 5) + 1));
}

// Proficiency bonus: D&D 1–4 → +2, 5–8 → +3, 9–12 → +4, 13–16 → +5, 17–20 → +6.
export function proficiencyBonusFor(gameLevel) {
  return 2 + Math.floor((dndLevelFor(gameLevel) - 1) / 4);
}

// ── Class progression tables (5e) ─────────────────────────────────────────────
// Rows are D&D levels 1–20, index 0 = D&D 1. Transcribed from the class tables and
// kept as LITERAL rows rather than formulas: the real steps are irregular (Rages go
// 2/3/4/5/6 at levels 1/3/6/12/17 — no clean arithmetic), and a row you can diff
// against the book beats a clever expression that's wrong in one band.
const BARB_RAGES          = [2,2,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,6];
const BARB_RAGE_DAMAGE    = [2,2,2,2,2,2,2,2,3,3,3,3,3,3,3,4,4,4,4,4];
const BARB_WEAPON_MASTERY = [2,2,2,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4];
// Rogue Sneak Attack is always d6 — only the COUNT scales (+1d6 every odd D&D level).
const ROGUE_SNEAK_DICE    = [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10];

// Gobo's Rage — uses and damage now come from the barbarian table.
// NOTE the mitigation below is a CUSTOM mechanic, not in any 5e table: real 5e Rage
// grants resistance (50%) to physical damage. Don't "correct" it against the book.
export function rageUsesForLevel(level)      { return BARB_RAGES[dndLevelFor(level) - 1]; }
export function rageDamageForLevel(level)    { return BARB_RAGE_DAMAGE[dndLevelFor(level) - 1]; }
// Weapon Mastery: how many weapon TYPES Gobo is proficient with. Exposed here, but not
// yet consumed — there is no weapon-proficiency gating in the code at all (equipItem puts
// anything in any slot), so a "pick a new weapon type" window has nothing to grant. Build
// the restriction system first; the loot doc's Grants-proficiency affix waits on the same.
export function weaponMasteryForLevel(level) { return BARB_WEAPON_MASTERY[dndLevelFor(level) - 1]; }

// Milo's Sneak Attack dice count (sides are always 6).
export function sneakAttackDiceForLevel(level) { return ROGUE_SNEAK_DICE[dndLevelFor(level) - 1]; }

// Fraction of incoming damage Rage negates (0 = none, 0.10 = 10% off).
//
// OUR RULE, not D&D's — Rage mitigates ALL damage here, every source, and it's a flat
// percentage rather than 5e's physical-only resistance. Don't reconcile it toward the book.
//
// ⚠ Flat 10% from level 2 is a PLACEHOLDER. This will grow at higher levels; the user is
// supplying the amounts and the levels. This function is the only place to change — every
// damage path reads it through damageMitigationOf() in combat.js.
// NOTE it takes a GAME level, not a D&D level. If the numbers arrive as a D&D-level table,
// wrap them with dndLevelFor() the way the class tables above do.
export function rageMitigationForLevel(level) {
  return (level ?? 1) >= 2 ? 0.10 : 0;
}

// Out-of-combat: while Milo is Hidden, every enemy's detection radius vs him
// shrinks to this fraction of normal (0.5 = 50% reduction). Lets him scout
// solo without triggering aggro, and no per-move perception rolls needed.
export const MILO_HIDE_DETECT_MULT = 0.5;

// Precision — flat percentage points added to hit chance, a permanent passive
// earned at L4+ by the martial heroes (Gobo the barbarian, Milo the rogue).
// Applies on every attack, independent of Rage/Hide.
export function precisionHitBonusForLevel(type, level) {
  if (type !== 'human' && type !== 'halfling') return 0;
  return (level ?? 1) >= 4 ? 1 : 0;
}

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
