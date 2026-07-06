export const ZONE = {
  id:        'warrens',
  name:      'The Warrens',
  biome:     'forest',
  heroEntry: [
    { x: -1, z: 4, type: 'dwarf'    },
    { x:  1, z: 4, type: 'human'    },
    { x: -1, z: 6, type: 'elf'      },
    { x:  1, z: 6, type: 'halfling' },
  ],
  enemies: [],
  exits: [],
  terrain: [],
  terrainSeed: null,
  props: [],
  barriers: [],
  visionBlockers: [],
  trenches: [
    { points: [{x:-30,z:-24.9,h:30}, {x:40.44,z:-25.77,h:30}], r: 8, pr: 8 },
    { points: [{x:-0.17,z:-12.29,h:1}, {x:-0.54,z:-37.72,h:1}], r: 4, tunnel: true },
  ],
};
