import { combatPhase } from './combat.js';
import { units } from './units.js';
import { isPrecombat } from './precombat.js';
import { addFollower, removeFollower, snapBehindLeader } from './follower.js';

let _active = true;

// Single-file order, FRONT → BACK: Leugren (dwarf), Gobo (human), Rasec (elf), Milo (halfling).
// In group move the party walks single file: the leader is player-driven and each hero behind
// trails the one ahead along its RECORDED path (breadcrumb follower — the Solrac mechanism), so
// they retrace the leader's exact route instead of holding a formation box.
const ORDER = ['dwarf', 'human', 'elf', 'halfling'];

export function isGroupMove() { return _active && !combatPhase; }

// The front-of-line hero the party follows — first ALIVE in ORDER (so a downed Leugren hands
// the lead to Gobo, etc.). army.js moves THIS unit on a group-move order; the chain trails it.
export function groupLeader() {
  for (const t of ORDER) {
    const h = units.find(u => u.team === 'blue' && u.type === t && u.hp > 0);
    if (h) return h;
  }
  return units.find(u => u.team === 'blue' && u.hp > 0) ?? null;
}

export function setGroupMove(v) {
  _active = v;
  _updateUI();
  _rebuildChain();
}

function _updateUI() {
  document.getElementById('gm-group-btn')?.classList.toggle('active', _active);
  document.getElementById('gm-solo-btn')?.classList.toggle('active', !_active);
}

function _clearHeroFollowers() {
  for (const t of ORDER) {
    const h = units.find(u => u.team === 'blue' && u.type === t);
    if (h) removeFollower(h);
  }
}

// Wire each non-leader hero as a breadcrumb follower of the hero directly ahead of it. The
// captured `ahead` is fine for a whole precombat session — heroes don't die outside combat, and
// we re-arm on zone load / combat end when the alive set can have changed.
function _rebuildChain() {
  _clearHeroFollowers();
  if (!_active) return;
  const alive = ORDER
    .map(t => units.find(u => u.team === 'blue' && u.type === t && u.hp > 0))
    .filter(Boolean);
  for (let i = 1; i < alive.length; i++) {
    const self = alive[i], ahead = alive[i - 1];
    self._pcTarget = null;   // driven by follower.js now, not the precombat mover
    addFollower(self, () => ahead, { stop: 2.2, resume: 2.8 });
  }
}

// Rally — snap the party into a tight single-file line right behind the leader, then re-arm the
// chain so they hold the line as it moves off.
function _rally() {
  if (!isPrecombat()) return;
  const alive = ORDER
    .map(t => units.find(u => u.team === 'blue' && u.type === t && u.hp > 0))
    .filter(Boolean);
  for (let i = 1; i < alive.length; i++) snapBehindLeader(alive[i], alive[i - 1], 2.2);
  _rebuildChain();
}

export function initGroupMove() {
  document.getElementById('gm-group-btn').addEventListener('click', () => setGroupMove(true));
  document.getElementById('gm-solo-btn').addEventListener('click',  () => setGroupMove(false));
  document.getElementById('gm-rally-btn').addEventListener('click', _rally);
  _updateUI();
  // follower.js clears its list on every zone load and the unit list is rebuilt, so re-form the
  // chain once the new zone's heroes exist. Same after a fight, where heroes have been revived.
  window.addEventListener('zone:loaded',  () => _rebuildChain());
  window.addEventListener('combat:ended', () => _rebuildChain());
}
