import { combatPhase } from './combat.js';
import { units } from './units.js';
import { isPrecombat, getPCSelected } from './precombat.js';
import { addFollower, removeFollower, snapBehindLeader } from './follower.js';

let _active = true;

// Single-file order, FRONT → BACK: Leugren (dwarf), Gobo (human), Rasec (elf), Milo (halfling).
// In group move the party walks single file: the leader is player-driven and each hero behind
// trails the one ahead along its RECORDED path (breadcrumb follower — the Solrac mechanism), so
// they retrace the leader's exact route instead of holding a formation box.
const ORDER = ['dwarf', 'human', 'elf', 'halfling'];

export function isGroupMove() { return _active && !combatPhase; }

// The single-file line, FRONT → BACK. The currently SELECTED hero takes the front; everyone else
// keeps the fixed ORDER behind them (so selecting Rasec gives Rasec, Leugren, Gobo, Milo). Falls
// back to plain ORDER when nothing valid is selected. All dead heroes are dropped.
function _orderedAlive() {
  const base = ORDER
    .map(t => units.find(u => u.team === 'blue' && u.type === t && u.hp > 0))
    .filter(Boolean);
  const sel = getPCSelected();
  if (sel && sel.team === 'blue' && sel.hp > 0 && base.includes(sel)) {
    return [sel, ...base.filter(h => h !== sel)];
  }
  return base;
}

// The front-of-line hero the party follows — the selected hero (or first ALIVE in ORDER as a
// fallback, so a downed leader hands the lead on). army.js moves THIS unit on a group-move
// order; the chain trails it.
export function groupLeader() {
  return _orderedAlive()[0] ?? units.find(u => u.team === 'blue' && u.hp > 0) ?? null;
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
  const alive = _orderedAlive();   // selected hero at the front, rest in ORDER behind
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
  const alive = _orderedAlive();   // selected hero leads the snapped line
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
  // Re-order the line whenever a different hero is selected: the selected hero moves to the front.
  window.addEventListener('pc-hero:selected', () => _rebuildChain());
}
