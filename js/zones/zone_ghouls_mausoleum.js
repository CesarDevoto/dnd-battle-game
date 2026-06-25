export const ZONE = {
  id:        'ghouls_mausoleum',
  name:      "Ghoul's Mausoleum",
  biome: 'dungeon',
  ambient:   'dungeon',
  heroEntry: [
    { x: -1, z: 33, type: 'dwarf'    },
    { x:  1, z: 33, type: 'human'    },
    { x: -1, z: 35, type: 'elf'      },
    { x:  1, z: 35, type: 'halfling' },
  ],
  enemies: [],
  exits: [
    { x: 0, z: 39, targetZone: 'haunted_wood', arrivalX: -9, arrivalZ: -62, label: 'Back Outside' },
  ],
  terrain: [
    { x: 0, z: 0, h: -0.4, r: 35 },
  ],
  terrainSeed: { ph: [3.12,1.87,4.56,2.34,5.78,0.93,3.45,1.62,4.89,2.71,5.34,0.58], fx: [0.9,2.2,5.8,11.4,38.0,42.0], fz: [1.1,3.3,5.6,12.8,31.0,46.0], sharpExp: 1.08, scale: 6.5 },
  props: [
    { model: 'dungeonwall', x: 2.53, z: 35.55, y: 0, rotY: 0, scale: 1 },
  ],
  barriers: [
    { x1: -40, z1:  40, x2: -6,  z2:  40 },
    { x1:   6, z1:  40, x2:  40, z2:  40 },
    { x1: -40, z1: -40, x2:  40, z2: -40 },
    { x1: -40, z1:  40, x2: -40, z2: -40 },
    { x1:  40, z1:  40, x2:  40, z2: -40 },
  ],
  visionBlockers: [
    { x1: -5.41, z1: 41.38, x2: -3.69, z2: 30.63 },
    { x1: -3.69, z1: 30.63, x2: -2.19, z2: 19.35 },
    { x1: -2.19, z1: 19.35, x2: 4.53, z2: 20.69 },
    { x1: 4.53, z1: 20.69, x2: 13.12, z2: 22.99 },
    { x1: 13.12, z1: 22.99, x2: 10.95, z2: 33.85 },
    { x1: 10.95, z1: 33.85, x2: 5.41, z2: 35.63 },
    { x1: 5.41, z1: 35.63, x2: 1.3, z2: 37.61 },
    { x1: 1.3, z1: 37.61, x2: 1.14, z2: 41.41 },
  ],
};
