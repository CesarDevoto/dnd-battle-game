export const ZONE = {
  id: 'cragmaw_entrance',
  name: 'Cragmaw Entrance',
  biome: 'forest',
  heroEntry: [
    { x: -1, z: 35, type: 'dwarf' },
    { x:  1, z: 35, type: 'human' },
    { x: -1, z: 37, type: 'elf' },
    { x:  1, z: 37, type: 'halfling' },
  ],
  enemies: [
    { type: 'goblin', x: 3.72, z: 24.94 },
    { type: 'goblin', x: -0.66, z: 25.44, animOverrides: {idle:4,walk:7,run:6,attack:1,rangedAttack:0,death:3} },
  ],
  exits: [],
  terrain: [
    { x: 8.57, z: 9.76, h: 3, r: 8 },
  ],
  terrainSeed: { ph: [3.013113,1.97615,3.331062,0.093255,2.362429,4.549572,3.526527,4.697033,3.308581,3.895562,5.733134,4.194688], fx: [1.49538,3.859223,9.819884,14.193138,65.296052,82.322198], fz: [1.133195,3.005258,6.629883,17.300653,28.299326,52.10154], sharpExp: 1.238931, scale: 6.806064 },
};
