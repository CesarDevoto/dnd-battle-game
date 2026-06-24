import { mkRock, mkSnowBoulder, mkBoulderCluster, mkBush, mkGlowMushroom, mkRubblePile, mkDryShrub, mkFern, mkGraveMound, mkCross, mkRoadSegment, mkWaterDisc, mkBloodPool, mkRoadCurve30, mkArrow, mkInvestigateStar, mkFogPatch, mkPointLight } from './environments.js';

// Available props for the zone prop editor.
// GLB entries use `path`; procedural entries use `builderFn` (called fresh per placement).

export const PROP_MODELS = {
  // ── GLB assets ────────────────────────────────────────────────────────────────
  deadhorse:    { label: 'Dead Horse',  path: 'assets/models/deadhorse.glb',           defaultScale: 1.0, blocksLOS: false, clashR: 0.8  },
  wagonhorses:  { label: 'Wagon Horses',path: 'assets/models/wagonhorses.glb',         defaultScale: 1.0, blocksLOS: true,  clashR: 1.5  },
  mausoleum:    { label: 'Mausoleum',   path: 'assets/environment/mausoleum.glb',     defaultScale: 4.0, blocksLOS: true,  clashR: 2.0  },
  tombstone:    { label: 'Tombstone',   path: 'assets/environment/tombstone1.glb',     defaultScale: 1.0, blocksLOS: true,  clashR: 0.6  },
  deadtree:     { label: 'Dead Tree',   path: 'assets/environment/deadtree.glb',        defaultScale: 12.0, defaultYOff: -2, blocksLOS: true,  clashR: 0.9  },
  brokentree:   { label: 'Broken Tree', path: 'assets/environment/brokentree.glb',      defaultScale: 8.0, blocksLOS: true,  clashR: 0.7  },
  log:          { label: 'Log',         path: 'assets/environment/log.glb',             defaultScale: 1.0, blocksLOS: false, clashR: 0.5  },
  stalactite:   { label: 'Stalactite',  path: 'assets/environment/stalactite.glb',      defaultScale: 1.0, blocksLOS: false, clashR: 0.4  },
  dungeonwall:  { label: 'Rock Wall',   path: 'assets/environment/dungeonrockwall.glb', defaultScale: 1.0, blocksLOS: true,  clashR: 1.5  },
  foresttree:   { label: 'Forest Tree', path: 'assets/environment/foresttree.glb',      defaultScale: 10.0, blocksLOS: true,  clashR: 1.0  },
  evergreen:    { label: 'Evergreen',   path: 'assets/environment/evergreentree.glb',   defaultScale: 1.0, blocksLOS: true,  clashR: 0.8  },
  mangrove:     { label: 'Mangrove',    path: 'assets/environment/mangrove.glb',        defaultScale: 10.0, blocksLOS: true,  clashR: 1.0  },
  savannahtree: { label: 'Savannah Tr', path: 'assets/environment/savannahtree.glb',    defaultScale: 1.0, blocksLOS: true,  clashR: 0.9  },
  saddlebag:    { label: 'Saddlebags',  path: 'assets/environment/saddlebag.glb',       defaultScale: 1.0, blocksLOS: false, clashR: 0.5  },

  // ── Procedural props ──────────────────────────────────────────────────────────
  rock:         { label: 'Rock',         builderFn: () => mkRock(0x565552, 1, 0),            defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  snowrock:     { label: 'Snow Rock',    builderFn: () => mkSnowBoulder(1, 0),                defaultScale: 1.0, blocksLOS: false, clashR: 0.6 },
  boulder:      { label: 'Boulders',     builderFn: () => mkBoulderCluster(0x7a6040, 1, 0),   defaultScale: 1.0, blocksLOS: true,  clashR: 1.0 },
  bush:         { label: 'Bush',         builderFn: () => mkBush(0x1a4012, 1, 0),             defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  glowmushroom: { label: 'Glow Mushroom',builderFn: () => mkGlowMushroom(0x8833cc, 1, 0),    defaultScale: 1.0, blocksLOS: false, clashR: 0.4 },
  rubble:       { label: 'Rubble',       builderFn: () => mkRubblePile(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  dryshrub:     { label: 'Dry Shrub',    builderFn: () => mkDryShrub(1, 0),                   defaultScale: 1.0, blocksLOS: false, clashR: 0.4 },
  fern:         { label: 'Fern',         builderFn: () => mkFern(1, 0),                       defaultScale: 1.0, blocksLOS: false, clashR: 0.4 },
  gravemound:   { label: 'Grave Mound',  builderFn: () => mkGraveMound(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  cross:        { label: 'Cross',        builderFn: () => mkCross(1, 0),                      defaultScale: 1.0, blocksLOS: false, clashR: 0.3 },
  arrow:        { label: 'Arrow',        builderFn: () => mkArrow(1, 0),                      defaultScale: 1.0, blocksLOS: false, clashR: 0.1, defaultRotX: Math.PI / 2, defaultYOff: 0.29 },

  fogpatch:         { label: 'Fog Patch',          builderFn: () => mkFogPatch(),         defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.25 },

  // ── Special interactive markers ───────────────────────────────────────────────
  investigate_star: { label: 'Investigate Light', builderFn: () => mkInvestigateStar(), defaultScale: 1.0, blocksLOS: false, clashR: 0.0 },
  point_light:      { label: 'Point Light',        builderFn: () => mkPointLight(),      defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 2.0 },

  // ── Terrain surface assets ────────────────────────────────────────────────────
  road:         { label: 'Road Segment', builderFn: () => mkRoadSegment(1, 0),               defaultScale: 3.0, blocksLOS: false, clashR: 0.0, conformTerrain: true },
  roadcurve30:  { label: 'Road Turn 30', builderFn: () => mkRoadCurve30(1, 0),               defaultScale: 3.0, blocksLOS: false, clashR: 0.0, conformTerrain: true },
  water:        { label: 'Water Disc',   builderFn: () => mkWaterDisc(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.25 },
  bloodpool:    { label: 'Blood Pool',   builderFn: () => mkBloodPool(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.25 },
};
