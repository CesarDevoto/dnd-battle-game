// zone_test_platform.js — Phase-1 surface-aware movement PROOF zone.
//
// `surfaceMovement: true` + `surfaces: [...]` turns on the walkable-surface system (see surfaces.js):
// units sample the topmost walkable platform/ramp instead of the raw heightmap, and a step-height
// rule makes the ramp climbable while the platform's cliff edges act as walls.
//
// Layout: flat ground; a raised 16×16 platform (top at y=3) to the north (−z); a ramp up its near
// edge. Walk the party to the ramp base and up onto the deck; try to step off any other edge and the
// pathing refuses (too big a drop). Two goblins wait ON the platform to test combat up there.
export const ZONE = {
  id:         'test_platform',
  name:       'TEST — Platform',
  groundSize: 96,
  biome: 'forest',

  surfaceMovement: true,
  terrainAmplitude: 0,   // dead-flat base so cliffs always exceed the step limit
  surfaces: [
    // ── Phase 1: SOLID platform + ramp (walk ON only) ────────────────────────────
    { type: 'platform', x: 0, z: -10, w: 16, d: 16, h: 3 },
    { type: 'ramp', x: 0, z: 3, w: 6, len: 10, axis: 'z', h0: 3, h1: 0 },

    // ── Phase 2: a BRIDGE at x=25 you can walk BOTH across AND under ──────────────
    // NON-solid deck at y=5 spanning z=−10..10 — the ground below it stays walkable, so approach the
    // underside from the WEST/EAST side (x<22 or x>28) at ground level. Ramps climb each z-end onto
    // the deck (rise 5 over 8 WU = 1.25/tile < the 1.4 limit). Deck's long sides are cliffs (can't hop
    // between deck and the ground under it — only the ramps bridge the 5-WU gap).
    { type: 'bridge', x: 25, z:   0, w: 6, d: 20, h: 5 },
    { type: 'ramp',   x: 25, z:  14, w: 6, len: 8, axis: 'z', h0: 5, h1: 0 },   // south end ↓ to ground
    { type: 'ramp',   x: 25, z: -14, w: 6, len: 8, axis: 'z', h0: 0, h1: 5 },   // north end ↑ to deck
  ],

  heroEntry: [
    { x: -2, z: 22, type: 'dwarf'    },
    { x:  2, z: 22, type: 'human'    },
    { x: -2, z: 26, type: 'elf'      },
    { x:  2, z: 26, type: 'halfling' },
  ],

  // Two goblins standing ON the platform (top at y=3) — grounding + combat pathing must handle them
  // up there. Positions are inside the platform footprint (x:−8..8, z:−18..−2).
  enemies: [
    { type: 'goblin', x: -4, z: -10, rotY: 0 },
    { type: 'goblin', x: 4, z: -12, rotY: 0 },
    { type: 'goblin', x: 4, z: -22, rotY: 0 },
    { type: 'goblin', x: 25.5, z: 1, rotY: 0 },
  ],

  exits: [],
  terrain: [],        // flat base — the platform/ramp provide the verticality
  props: [],
  barriers: [],
  trenches: [],
};
