export const ZONE = {
  id:         'hide_out',
  name:       'Hide Out',
  groundSize: 132,
  biome: 'dungeon',    // forest | dungeon | graveyard | styx
  ambient:    'hide_out',   // its own track (audio.js) — file: assets/audio/ambient/goblin hideout stream.mp3
  // Fallback spawn only. Arriving through the Warrens gate places the heroes at that
  // exit's arrivalX/arrivalZ instead (see exits below), so these are used when the zone is
  // loaded directly — e.g. from the dev zone picker.
  // Party spawns centred on (-9, 5) — a 2×2 formation around it.
  heroEntry: [
    { x: -10, z: 4, type: 'dwarf'    },
    { x:  -8, z: 4, type: 'human'    },
    { x: -10, z: 6, type: 'elf'      },
    { x:  -8, z: 6, type: 'halfling' },
  ],
  enemies: [],
  // Old coordinate exit removed (user, 2026-07-21): it drew the fog ball AND cut the "crack" notch
  // in the east wall. Use a placed Zone Gate prop for the return trip to the Warrens instead.
  exits: [],
  terrain: [],        // { x, z, h, r, pr? } — sculpt in the terrain editor
  terrainSeed: { ph: [3.598911,1.113261,2.76139,3.449963,4.324231,1.178658,6.223698,5.877862,0.806169,3.008176,5.777996,5.367516], fx: [1.621519,3.616473,7.957246,21.962657,60.993432,100.877436], fz: [0.808555,2.150368,3.582959,14.614564,40.412863,53.768117], sharpExp: 1.303352, scale: 8.370412 },
  props: [
    { model: 'zonegate', x: -10.15, z: 10.22, y: -0.2, rotY: 0, scale: 1, params: { targetZone: '' } },
  ],          // placed + saved via the prop editor — don't hand-write
  barriers: [],       // drawn + saved via the barrier editor — don't hand-write
};
