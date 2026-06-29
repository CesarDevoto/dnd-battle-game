import { combatPhase } from './combat.js';
import { units } from './units.js';
import { movePCHeroTo, isPrecombat } from './precombat.js';

let _active = true;

export function isGroupMove() { return _active && !combatPhase; }

export function setGroupMove(v) {
  _active = v;
  _updateUI();
}

function _updateUI() {
  document.getElementById('gm-group-btn')?.classList.toggle('active', _active);
  document.getElementById('gm-solo-btn')?.classList.toggle('active', !_active);
}

function _rallyToLeugren() {
  if (!isPrecombat()) return;
  const leugren = units.find(u => u.team === 'blue' && u.type === 'dwarf' && u.hp > 0);
  if (!leugren) return;
  const { x, z } = leugren.grp.position;
  const WU = 2; // 1 grid square = 2 world units
  const offsets = [[-WU, 0], [WU, 0], [0, WU]]; // W, E, S
  units
    .filter(u => u.team === 'blue' && u.type !== 'dwarf' && u.hp > 0)
    .forEach((hero, i) => {
      const [dx, dz] = offsets[i];
      movePCHeroTo(hero, x + dx, z + dz);
    });
}

export function initGroupMove() {
  document.getElementById('gm-group-btn').addEventListener('click', () => setGroupMove(true));
  document.getElementById('gm-solo-btn').addEventListener('click',  () => setGroupMove(false));
  document.getElementById('gm-rally-btn').addEventListener('click', _rallyToLeugren);
  _updateUI();
}
