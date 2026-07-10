export const ZONE = {
  id:        'warrens',
  name:      'The Warrens',
  biome: 'forest',
  // Cave test: an outdoor hillside with a cave mouth leading into a straight
  // tunnel that ends in a room. The hill is a terrain control point; the tunnel
  // and room are carved with trenches; `cave` turns on the underside-of-rock roof.
  cave: true,
  // Raised hill the cave burrows into (centred north of the spawn).
  terrain: [
    { x: 0, z: 20, h: 12, r: 30, pr: 3 },
  ],
  trenches: [
    // Straight tunnel: from the hill base (mouth) north into the hill.
    { points: [ { x: 0, z: 2, h: 0 }, { x: 0, z: 24, h: 0 } ], r: 5,  pr: 2.5 },
    // Room at the end.
    { points: [ { x: 0, z: 24, h: 0 }, { x: 0, z: 33, h: 0 } ], r: 12, pr: 9 },
  ],
  heroEntry: [
    { x: -2, z: -9,  type: 'dwarf'    },
    { x:  2, z: -9,  type: 'human'    },
    { x: -2, z: -12, type: 'elf'      },
    { x:  2, z: -12, type: 'halfling' },
  ],
  enemies: [
    { type: 'solrac', x: 0, z: 29 },   // lurking in the back room
  ],
  caveEntrances: [
    { x: -1.5, z: -2.18, r: 4.5, seed: 3.794 },
  ],
  exits: [],
  terrainSeed: null,
  props: [],
  barriers: [
    { x1: 2.48, z1: 0.12, x2: 2.68, z2: 14.9 },
    { x1: 2.68, z1: 14.9, x2: 6.86, z2: 18.21 },
    { x1: 6.86, z1: 18.21, x2: 8.93, z2: 23.12 },
    { x1: 8.93, z1: 23.12, x2: 8.49, z2: 35.83 },
    { x1: 8.49, z1: 35.83, x2: 4.28, z2: 41.1 },
    { x1: 4.28, z1: 41.1, x2: -0.46, z2: 41.83 },
    { x1: -0.46, z1: 41.83, x2: -6.05, z2: 39.07 },
    { x1: -6.05, z1: 39.07, x2: -8.33, z2: 35.51 },
    { x1: -8.33, z1: 35.51, x2: -9.01, z2: 26.01 },
    { x1: -9.01, z1: 26.01, x2: -8.14, z2: 20.18 },
    { x1: -8.14, z1: 20.18, x2: -5.5, z2: 17.04 },
    { x1: -5.5, z1: 17.04, x2: -2.55, z2: 14.96 },
    { x1: -2.55, z1: 14.96, x2: -2.07, z2: 12.19 },
    { x1: -2.07, z1: 12.19, x2: -2.18, z2: 0.97 },
    { x1: -2.18, z1: 0.97, x2: -2.48, z2: -0.23 },
    { x1: -2.48, z1: -0.23, x2: -3.22, z2: -0.39 },
    { x1: 2.45, z1: 0.13, x2: 3.55, z2: -0.44 },
  ],
  visionBlockers: [],
};
