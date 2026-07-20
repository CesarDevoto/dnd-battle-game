import { mkRock, mkSnowBoulder, mkBoulderCluster, mkBush, mkGlowMushroom, mkRubblePile, mkDryShrub, mkFern, mkGraveMound, mkCross, mkRoadSegment, mkWaterDisc, mkBloodPool, mkCampfire, mkRoadCurve30, mkArrow, mkExclamationMarker, mkFogPatch, mkPointLight, mkDarknessPlane, mkWaystoneDisc } from './environments.js';

// Available props for the zone prop editor.
// GLB entries use `path`; procedural entries use `builderFn` (called fresh per placement).

// Strip shadow-casting from small ground clutter — a bush/fern's shadow is invisible from
// the tactical camera but still costs a full pass through the shadow map. Placing dozens per
// zone (Warrens: 46 bushes) makes that add up. They keep receiveShadow so ground shade still
// falls on them.
function _noCast(obj) {
  obj.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return obj;
}

export const PROP_MODELS = {
  // ── GLB assets ────────────────────────────────────────────────────────────────
  deadhorse:    { label: 'Dead Horse',  path: 'assets/models/deadhorse.glb',           defaultScale: 1.0, blocksLOS: false, clashR: 0.8  },
  wagonhorses:  { label: 'Wagon Horses',path: 'assets/models/wagonhorses.glb',         defaultScale: 1.0, blocksLOS: true,  clashR: 1.5  },
  mausoleum:    { label: 'Mausoleum',   path: 'assets/environment/mausoleum.glb',     defaultScale: 4.0, blocksLOS: true,  clashR: 2.0  },
  tombstone:    { label: 'Tombstone',   path: 'assets/environment/tombstone1.glb',     defaultScale: 1.0, blocksLOS: true,  clashR: 0.6  },
  deadtree:     { label: 'Dead Tree',   path: 'assets/environment/deadtree.glb',        defaultScale: 12.0, defaultYOff: -2, blocksLOS: true,  clashR: 0.9  },
  brokentree:   { label: 'Broken Tree', path: 'assets/environment/brokentree.glb',      defaultScale: 8.0, blocksLOS: true,  clashR: 0.7  },
  log:          { label: 'Log',         path: 'assets/environment/log.glb',             defaultScale: 1.0, blocksLOS: false, clashR: 0.5  },
  // Native segment is ~2 WU wide × ~1.1 tall × ~0.3 deep; placed at 5x → ~10 WU (5 grid
  // squares) wide, ~5.4 tall. blocksLOS:true — provides cover / breaks sight lines; draw a
  // barrier segment along it if you want it to stop movement too (same as the walls).
  fencewooden:  { label: 'Wooden Fence',path: 'assets/environment/fence wooden.glb',     defaultScale: 5.0, blocksLOS: true,  clashR: 2.0  },
  // Building: ~1.9 WU cube at scale 1, so 4x → ~7.6 WU (~4 grid squares). Loader auto-grounds
  // the base, so no yOff. Solid, so blocksLOS.
  hut2:         { label: 'Hut',         path: 'assets/environment/hut2.glb',            defaultScale: 4.0, blocksLOS: true,  clashR: 1.5, brighten: 1.35  },
  // Flat ground decal. clashR:0 so bodies / other props can sit ON it; tiny yOff beats
  // z-fighting with the terrain. blocksLOS:false — it's paint on the floor.
  bloodstain:   { label: 'Blood Stain', path: 'assets/environment/blood stain.glb',      defaultScale: 2.0, defaultYOff: 0.03, blocksLOS: false, clashR: 0.0  },
  stalactite:   { label: 'Stalactite',  path: 'assets/environment/stalactite.glb',      defaultScale: 1.0, blocksLOS: false, clashR: 0.4  },
  shackles:     { label: 'Shackles',    path: 'assets/environment/shackles.glb',        defaultScale: 1.0, blocksLOS: false, clashR: 0.3  },
  // ~1.9 WU centered cube at scale 1; at 2x → ~3.8 WU (~2 grid squares) — a captive-sized cell.
  // Loader auto-grounds the base, so no yOff. blocksLOS:false — it's barred, you see through it.
  // clashR:0.8 keeps it a walk-around footprint; drop it lower if you want to stand an NPC inside.
  ironcage:     { label: 'Iron Cage',   path: 'assets/environment/iron cage.glb',       defaultScale: 2.0, blocksLOS: false, clashR: 0.8  },
  // ~1.5 WU wide × ~1.9 tall centered; at scale 1 that's ~5 ft — a throne-sized seat. Auto-grounded.
  ironchair:    { label: 'Iron Chair',  path: 'assets/environment/iron chair.glb',       defaultScale: 1.0, blocksLOS: false, clashR: 0.4  },
  skeleton1:    { label: 'Skeleton',    path: 'assets/environment/skeleton1.glb',       defaultScale: 1.0, defaultYOff: 0.18, blocksLOS: false, clashR: 0.4  },
  // Native mesh is ~2 WU wide × ~1.8 tall, centered on the origin (bbox min y ≈ -1.04), so it
  // hangs like a corner web. blocksLOS:false — you see through the strands; clashR small so it
  // can tuck into a corner without shoving bodies away. Heavily meshopt'd (512² webp, ~7.7k verts).
  spiderweb:    { label: 'Spider Web',  path: 'assets/environment/spiderweb.glb',        defaultScale: 4.0, blocksLOS: false, clashR: 0.3  },
  dungeonwall:      { label: 'Rock Wall',       path: 'assets/environment/dungeonrockwall.glb',      defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  stonesteps:       { label: 'Stone Steps',     path: 'assets/environment/stonesteps.glb',           defaultScale: 2.0, blocksLOS: false, clashR: 0.8  },
  widestonesteps:   { label: 'Wide Stone Steps',path: 'assets/environment/wide stone steps.glb',     defaultScale: 2.0, blocksLOS: false, clashR: 1.2  },
  woodensteps:      { label: 'Wooden Steps',    path: 'assets/environment/wooden steps.glb',         defaultScale: 2.0, blocksLOS: false, clashR: 0.8  },
  dungeonwallsmall: { label: 'Wall (Small)',    path: 'assets/environment/dungeon small wall.glb',   defaultScale: 8.0, blocksLOS: true,  clashR: 0.8  },
  dungeonwalllong:  { label: 'Wall (Long)',      path: 'assets/environment/dungeon long wall.glb',        defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  dungeonwallxlong: { label: 'Wall (X-Long)',   path: 'assets/environment/dungeon really long wall.glb', defaultScale: 8.0, blocksLOS: true,  clashR: 2.0  },
  dungeonwallcurve: { label: 'Wall (Curved)',   path: 'assets/environment/dungeon curved wall.glb',  defaultScale: 8.0, blocksLOS: true,  clashR: 1.0  },
  dungeoncolumn:    { label: 'Dungeon Column',  path: 'assets/environment/dungeon column.glb',       defaultScale: 8.0, blocksLOS: true,  clashR: 0.4  },
  dungeonwallsmalltall: { label: 'Wall (Small, Tall)',  path: 'assets/environment/dungeon small tall wall.glb',        defaultScale: 8.0, blocksLOS: true,  clashR: 0.8  },
  dungeonwalllongtall:  { label: 'Wall (Long, Tall)',   path: 'assets/environment/dungeon long tall wall.glb',         defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  dungeonwallxlongtall: { label: 'Wall (X-Long, Tall)', path: 'assets/environment/dungeon really long tall wall.glb', defaultScale: 8.0, blocksLOS: true,  clashR: 2.0  },
  dungeonwallcurvetall: { label: 'Wall (Curved, Tall)', path: 'assets/environment/dungeon curbed tall wall.glb',      defaultScale: 8.0, blocksLOS: true,  clashR: 1.0  },
  dungeoncolumntall:    { label: 'Dungeon Column (Tall)', path: 'assets/environment/dungeon tall column.glb',         defaultScale: 8.0, blocksLOS: true,  clashR: 0.4  },
  cavemouth1:   { label: 'Cave Mouth 1', path: 'assets/environment/cavemouth1.glb',       defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  cavemouth2:   { label: 'Cave Mouth 2', path: 'assets/environment/cavemouth2.glb',       defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  cavemouth3:   { label: 'Cave Mouth 3', path: 'assets/environment/cavemouth3.glb',       defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  cavemouth4:   { label: 'Cave Mouth 4', path: 'assets/environment/cavemouth4.glb',       defaultScale: 8.0, blocksLOS: true,  clashR: 1.5  },
  evergreen:    { label: 'Evergreen',    path: 'assets/environment/evergreentree.glb',   defaultScale: 10.0, blocksLOS: true,  clashR: 0.9  },
  foresttree:   { label: 'Forest Tree', path: 'assets/environment/foresttree.glb',      defaultScale: 10.0, blocksLOS: true,  clashR: 1.0  },
  mangrove:     { label: 'Mangrove',    path: 'assets/environment/mangrove.glb',        defaultScale: 10.0, blocksLOS: true,  clashR: 1.0  },
  savannahtree: { label: 'Savannah Tr', path: 'assets/environment/savannahtree.glb',    defaultScale: 10.0, blocksLOS: true,  clashR: 0.9  },
  saddlebag:    { label: 'Saddlebags',  path: 'assets/environment/saddlebag.glb',       defaultScale: 1.0, blocksLOS: false, clashR: 0.5  },
  rockpile:     { label: 'Rock Pile',   path: 'assets/environment/rockpile.glb',         defaultScale: 1.0, blocksLOS: false, clashR: 0.6  },
  alchemylab:   { label: 'Alchemy Lab', path: 'assets/environment/alchemy lab.glb',      defaultScale: 1.0, blocksLOS: true,  clashR: 0.8  },
  corpsespike:  { label: 'Corpse on Spike', path: 'assets/environment/corpse on spike.glb', defaultScale: 1.0, blocksLOS: false, clashR: 0.4  },
  corpse1:      { label: 'Corpse',      path: 'assets/environment/corpse1.glb',          defaultScale: 1.0, blocksLOS: false, clashR: 0  },
  fancychair:   { label: 'Fancy Chair', path: 'assets/environment/fancy chair.glb',      defaultScale: 1.0, blocksLOS: false, clashR: 0.4  },
  pileofbones:  { label: 'Pile of Bones', path: 'assets/environment/pile of bones.glb',  defaultScale: 1.0, blocksLOS: false, clashR: 0.7  },
  woodchair:    { label: 'Wood Chair',  path: 'assets/environment/wood chair.glb',       defaultScale: 1.0, blocksLOS: false, clashR: 0.4  },
  barstand:     { label: 'Bar Stand',   path: 'assets/environment/bar stand.glb',        defaultScale: 1.0, blocksLOS: false, clashR: 0.8  },
  flooring1:    { label: 'Flooring 1',  path: 'assets/environment/flooring1.glb',        defaultScale: 4.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.05 },
  flooring2:    { label: 'Flooring 2',  path: 'assets/environment/flooring2.glb',        defaultScale: 4.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.05 },
  rug1:         { label: 'Rug 1',       path: 'assets/environment/rug1.glb',             defaultScale: 2.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.05 },
  platform1:    { label: 'Platform 1',  path: 'assets/environment/platform1.glb',        defaultScale: 2.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.05 },
  inn:          { label: 'Inn',         path: 'assets/environment/inn.glb',              defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  inn2:         { label: 'Inn 2',       path: 'assets/environment/inn2.glb',             defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  bigbuilding1: { label: 'Big Building 1', path: 'assets/environment/big building 1.glb', defaultScale: 4.0, blocksLOS: true,  clashR: 3.5  },
  building2:    { label: 'Building 2',  path: 'assets/environment/building 2.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building3:    { label: 'Building 3',  path: 'assets/environment/building 3.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building4:    { label: 'Building 4',  path: 'assets/environment/building 4.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building5:    { label: 'Building 5',  path: 'assets/environment/building 5.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building6:    { label: 'Building 6',  path: 'assets/environment/building 6.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building7:    { label: 'Building 7',  path: 'assets/environment/building 7.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building8:    { label: 'Building 8',  path: 'assets/environment/building 8.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building9:    { label: 'Building 9',  path: 'assets/environment/building 9.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building10:   { label: 'Building 10', path: 'assets/environment/building10.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building11:   { label: 'Building 11', path: 'assets/environment/building11.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building12:   { label: 'Building 12', path: 'assets/environment/building12.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building13:   { label: 'Building 13', path: 'assets/environment/building13.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  hut1:         { label: 'Hut 1',       path: 'assets/environment/hut1.glb',             defaultScale: 4.0, blocksLOS: true,  clashR: 2.5  },
  buildingruinedlarge: { label: 'Ruined Building (Large)', path: 'assets/environment/building ruined large.glb', defaultScale: 4.0, blocksLOS: true,  clashR: 3.5  },
  building14:   { label: 'Building 14', path: 'assets/environment/building14.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building15:   { label: 'Building 15', path: 'assets/environment/building15.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  building16:   { label: 'Building 16', path: 'assets/environment/building16.glb',       defaultScale: 4.0, blocksLOS: true,  clashR: 3.0  },
  woodwall1:    { label: 'Wood Wall 1', path: 'assets/environment/woodwall1.glb',        defaultScale: 3.0, blocksLOS: true,  clashR: 1.5  },
  woodwall2:    { label: 'Wood Wall 2', path: 'assets/environment/woodwall2.glb',        defaultScale: 3.0, blocksLOS: true,  clashR: 1.5  },
  plant1:       { label: 'Plant 1',     path: 'assets/environment/plant1.glb',           defaultScale: 2.0, blocksLOS: false, clashR: 0.4  },
  plant2:       { label: 'Plant 2',     path: 'assets/environment/plant2.glb',           defaultScale: 2.0, blocksLOS: false, clashR: 0.4  },
  plant3:       { label: 'Plant 3',     path: 'assets/environment/plant3.glb',           defaultScale: 2.0, blocksLOS: false, clashR: 0.4  },
  plant4:       { label: 'Plant 4',     path: 'assets/environment/plant4.glb',           defaultScale: 2.0, blocksLOS: false, clashR: 0.4  },
  bench1:       { label: 'Bench 1',     path: 'assets/environment/bench1.glb',           defaultScale: 1.0, blocksLOS: false, clashR: 0.7  },
  barstand2:    { label: 'Bar Stand 2', path: 'assets/environment/barstand2.glb',        defaultScale: 1.0, blocksLOS: false, clashR: 0.8  },
  barloaded:    { label: 'Loaded Bar',  path: 'assets/environment/barloaded.glb',        defaultScale: 1.0, blocksLOS: true,  clashR: 2.0  },
  barrel1:      { label: 'Barrel 1',    path: 'assets/environment/barrel1.glb',          defaultScale: 1.0, blocksLOS: false, clashR: 0.6  },
  barrel2:      { label: 'Barrel 2',    path: 'assets/environment/barrel2.glb',          defaultScale: 1.0, blocksLOS: false, clashR: 0.6  },
  // ~1.4 WU wide × ~1.9 tall centered; at 3x → ~4.2 WU (~2 grid squares) wide, awning height. Auto-grounded.
  marketstall1: { label: 'Market Stall', path: 'assets/environment/market stall1.glb',   defaultScale: 3.0, blocksLOS: true,  clashR: 1.5  },
  // ~1.4 WU wide × ~1.9 tall centered; at 3x → ~4.2 WU (~2 grid squares). Textures 256² (extra-compressed). Auto-grounded.
  marketarmory1: { label: 'Market Armory', path: 'assets/environment/market armory1.glb', defaultScale: 3.0, blocksLOS: true,  clashR: 1.5  },

  // ── Procedural props ──────────────────────────────────────────────────────────
  rock:         { label: 'Rock',         builderFn: () => mkRock(0x565552, 1, 0),            defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  snowrock:     { label: 'Snow Rock',    builderFn: () => mkSnowBoulder(1, 0),                defaultScale: 1.0, blocksLOS: false, clashR: 0.6 },
  boulder:      { label: 'Boulders',     builderFn: () => mkBoulderCluster(0x7a6040, 1, 0),   defaultScale: 1.0, blocksLOS: true,  clashR: 1.0 },
  bush:         { label: 'Bush',         builderFn: () => _noCast(mkBush(0x1a4012, 1, 0)),     defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  glowmushroom: { label: 'Glow Mushroom',builderFn: () => _noCast(mkGlowMushroom(0x8833cc, 1, 0)), defaultScale: 1.0, blocksLOS: false, clashR: 0 },
  rubble:       { label: 'Rubble',       builderFn: () => _noCast(mkRubblePile(1, 0)),         defaultScale: 1.0, blocksLOS: false, clashR: 0.5 },
  dryshrub:     { label: 'Dry Shrub',    builderFn: () => _noCast(mkDryShrub(1, 0)),           defaultScale: 1.0, blocksLOS: false, clashR: 0 },
  fern:         { label: 'Fern',         builderFn: () => _noCast(mkFern(1, 0)),               defaultScale: 1.0, blocksLOS: false, clashR: 0 },
  coffin:       { label: 'Coffin',       path: 'assets/environment/coffin.glb',               defaultScale: 2.0, blocksLOS: false, clashR: 0.5 },
  gravemound:   { label: 'Grave Mound',  builderFn: () => mkGraveMound(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0 },
  cross:        { label: 'Cross',        builderFn: () => mkCross(1, 0),                      defaultScale: 1.0, blocksLOS: false, clashR: 0.3 },
  arrow:        { label: 'Arrow',        builderFn: () => mkArrow(1, 0),                      defaultScale: 1.0, blocksLOS: false, clashR: 0, defaultRotX: Math.PI / 2, defaultYOff: 0.29 },

  fogpatch:         { label: 'Fog Patch',          builderFn: () => mkFogPatch(),         defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.25 },
  campfire:         { label: 'Campfire',           builderFn: () => mkCampfire(1, 0),     defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.0 },
  darknessplane:    { label: 'Darkness',           builderFn: () => mkDarknessPlane(),   defaultScale: 12.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.8  },

  // ── Special interactive markers ───────────────────────────────────────────────
  waystone:         { label: 'Waystone',          builderFn: (p) => mkWaystoneDisc(p?.waystoneId, p?.mapTab),    defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.20 },
  exclamation_marker: { label: 'Exclamation Marker', builderFn: () => mkExclamationMarker(), defaultScale: 1.0, blocksLOS: false, clashR: 0.0 },
  point_light:      { label: 'Point Light',        builderFn: () => mkPointLight(),       defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 2.0 },
  point_light_bright: { label: 'Bright Point Light', builderFn: () => mkPointLight(22, 50), defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 2.0 },

  // ── Terrain surface assets ────────────────────────────────────────────────────
  road:         { label: 'Road Segment', builderFn: () => mkRoadSegment(1, 0),               defaultScale: 3.0, blocksLOS: false, clashR: 0.0, conformTerrain: true },
  roadcurve30:  { label: 'Road Turn 30', builderFn: () => mkRoadCurve30(1, 0),               defaultScale: 3.0, blocksLOS: false, clashR: 0.0, conformTerrain: true },
  water:        { label: 'Water Disc',   builderFn: () => mkWaterDisc(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.25 },
  bloodpool:    { label: 'Blood Pool',   builderFn: () => mkBloodPool(1, 0),                 defaultScale: 1.0, blocksLOS: false, clashR: 0.0, defaultYOff: 0.25 },
};
