import { combatPhase } from './combat.js';

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

export function initGroupMove() {
  document.getElementById('gm-group-btn').addEventListener('click', () => setGroupMove(true));
  document.getElementById('gm-solo-btn').addEventListener('click',  () => setGroupMove(false));
  _updateUI();
}
