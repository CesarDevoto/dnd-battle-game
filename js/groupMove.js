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

function _rallyToBox() {
  if (!isPrecombat()) return;
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  if (!heroes.length) return;
  // Reform into the same tight 2×2 box used at zone start (one hero per adjacent
  // grid square, 2 WU apart), centred on Leugren (or the first hero if he's down).
  const leader = heroes.find(u => u.type === 'dwarf') ?? heroes[0];
  const cx = leader.grp.position.x, cz = leader.grp.position.z;
  const BOX = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  heroes.forEach((hero, i) => {
    const [ox, oz] = BOX[i % BOX.length];
    movePCHeroTo(hero, cx + ox, cz + oz, hero === leader ? null : leader);
  });
}

export function initGroupMove() {
  document.getElementById('gm-group-btn').addEventListener('click', () => setGroupMove(true));
  document.getElementById('gm-solo-btn').addEventListener('click',  () => setGroupMove(false));
  document.getElementById('gm-rally-btn').addEventListener('click', _rallyToBox);
  _updateUI();
}
