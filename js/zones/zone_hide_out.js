export const ZONE = {
  id:         'hide_out',
  name:       'Hide Out',
  groundSize: 132,
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
  // Old coordinate exit removed (user, 2026-07-21): it drew the fog ball AND cut the "crack" notch
  // in the east wall. Use a placed Zone Gate prop for the return trip to the Warrens instead.
  exits: [],
  terrain: [],        // { x, z, h, r, pr? } — sculpt in the terrain editor
  terrainSeed: { ph: [3.598911,1.113261,2.76139,3.449963,4.324231,1.178658,6.223698,5.877862,0.806169,3.008176,5.777996,5.367516], fx: [1.621519,3.616473,7.957246,21.962657,60.993432,100.877436], fz: [0.808555,2.150368,3.582959,14.614564,40.412863,53.768117], sharpExp: 1.303352, scale: 8.370412 },
  props: [],          // placed + saved via the prop editor — don't hand-write
  barriers: [],       // drawn + saved via the barrier editor — don't hand-write
};
