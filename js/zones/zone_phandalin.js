export const ZONE = {
  id:         'phandalin',
  name:       'Phandalin',
  groundSize: 216,          // town hub — large open area (multiple of 4)
  biome: 'forest',     // forest | dungeon | graveyard | styx
  ambient:    null,         // TODO: point at a town ambient key in audio.js once one exists
  heroEntry: [
    { x: -1, z: 0, type: 'dwarf'    },
    { x:  1, z: 0, type: 'human'    },
    { x: -1, z: 2, type: 'elf'      },
    { x:  1, z: 2, type: 'halfling' },
  ],
  // Peaceful town hub — no hostiles. Townsfolk are team:'npc' (from UNIT_TYPES),
  // so buildUnit() sides them with the party and applies their baked scale/yOffset.
  // Placeholder positions — retune in the prop/NPC editor once buildings are placed.
  enemies: [
    { type: 'solrac', x: -6, z: -4 },
    { type: 'npc_dwarf', x: 0, z: -4, scale: 1.464 },
  ],
  exits: [
    // { x: 0, z: 0, targetZone: 'road_to_phandelver', arrivalX: 0, arrivalZ: 0, label: 'Road to Phandelver' }
  ],
  terrain: [],        // { x, z, h, r, pr? } — add your own elevation features here
  // Flat town — scale:0 zeroes the procedural noise so there are NO undulations.
  // (A null seed would let loadZone roll RANDOM hills instead.) Add relief via
  // the terrain[] control points above when you want it.
  terrainSeed: { ph: [0,0,0,0,0,0,0,0,0,0,0,0], fx: [1,1,1,1,1,1], fz: [1,1,1,1,1,1], sharpExp: 1, scale: 0 },
  props: [
    { model: 'bigbuilding1', x: 12.04, z: -40.05, y: 0, rotY: 0, scale: 13.809 },
    { model: 'building2', x: -15.58, z: -38.25, y: 0, rotY: 0, scale: 20.218 },
    { model: 'building3', x: -46.76, z: -15.67, y: -0.125, yOff: -0.125, rotY: 9.032, scale: 20.218 },
    { model: 'building4', x: -48.48, z: -32.18, y: 0, rotY: 0, scale: 24.464 },
    { model: 'inn', x: -33.34, z: 23.89, y: 0.214, rotY: 2.225, scale: 11.412 },
    { model: 'road', x: -8.69, z: 8.14, y: -0.2, rotY: 0, scale: 3 },
    { model: 'building8', x: 18.37, z: -38.3, y: 0, rotY: 0, scale: 6.442 },
    { model: 'building9', x: 35.67, z: -34.81, y: 0, rotY: 0, scale: 8.574 },
  ],          // place buildings/props in the prop editor, then save
  barriers: [],       // drawn in the terrain editor
  paint: [],          // spray-painted terrain strokes {x,z,r,ch} — TERRAIN editor ▸ PAINT
};
