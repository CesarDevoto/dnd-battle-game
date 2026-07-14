export const ZONE = {
  id:         'hide_out',
  name:       'Hide Out',
  groundSize: 216,          // 2× base (108) — must be a multiple of 4
  biome: 'forest',     // forest | dungeon | graveyard | styx
  ambient:    null,         // TODO: point at an ambient key in audio.js once one is chosen
  // Fallback spawn only. Arriving through the Warrens gate places the heroes at that
  // exit's arrivalX/arrivalZ instead (see exits below), so these are used when the zone is
  // loaded directly — e.g. from the dev zone picker.
  heroEntry: [
    { x: -1, z: 0, type: 'dwarf'    },
    { x:  1, z: 0, type: 'human'    },
    { x: -1, z: 2, type: 'elf'      },
    { x:  1, z: 2, type: 'halfling' },
  ],
  enemies: [],
  exits: [
    // Reciprocal gate back to the Warrens. Straight-wall gate on the +X side (not a corner
    // like the Warrens end), so it takes the standard wall-gate tuning: default notch
    // (halfWidth 2) and default outward fogPush, with the 3× fog ball the other gates use.
    // Arrival lands just inside the Warrens' own Hide Out gate at (-197, 194).
    { x: 95, z: 0, targetZone: 'warrens', arrivalX: -185, arrivalZ: 182, label: 'The Warrens', clickScale: 2, fogScale: 3 },
  ],
  terrain: [],        // { x, z, h, r, pr? } — sculpt in the terrain editor
  terrainSeed: null,  // set by the terrain editor once the terrain is sculpted
  props: [],          // placed + saved via the prop editor — don't hand-write
  barriers: [],       // drawn + saved via the barrier editor — don't hand-write
};
