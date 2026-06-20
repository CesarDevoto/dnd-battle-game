import { units, setUnitWalking } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { rollInitiative, showCenterAlert, addLog, unitLabel } from './combat.js';
import { playUnitAggroSound } from './audio.js';
import { getActiveZone } from './zoneLoader.js';
import { showQuickDialogue } from './dagnaEvent.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const WALK_SPEED          = 5.4;  // hero free-roam speed (world units/sec)
const PATROL_SPEED        = 0.9;  // enemy patrol speed
const DETECT_DEFAULT      = 20;   // fallback detection radius (world units)
const SOCIAL_AGGRO_DEFAULT = 10;  // fallback social aggro radius (world units)

// ── State ─────────────────────────────────────────────────────────────────────

let _active   = false;
let _aggroed  = false;
let _selected = null;   // hero selected for movement
let _frozen   = false;  // set by dagnaEvent during scripted dialogue sequences

// ── Public API ────────────────────────────────────────────────────────────────

export const isPrecombat   = () => _active;
export const getPCSelected = () => _selected;

export function setPrecombatFrozen(frozen) {
  _frozen = frozen;
  if (frozen) {
    units.filter(u => u.team === 'red').forEach(u => setUnitWalking(u, false));
  } else {
    // Force precombat active — needed when zone loaded after an all-hero defeat
    // (that path fires zone:defeat, not combat:ended, so enterPrecombat never runs)
    _active  = true;
    _aggroed = false;
  }
}

export function enterPrecombat(silent = false) {
  _active   = true;
  _aggroed  = false;
  _selected = null;
  if (!silent) addLog('Heroes approach… enemies are unaware.', 'move');
}

// When combat ends (all threats cleared), return everyone to free-roam.
window.addEventListener('combat:ended', () => enterPrecombat(true));

export function exitPrecombat() {
  _active   = false;
  _selected = null;
  // Stop all walking and clear movement targets
  units.forEach(u => {
    u._pcTarget   = null;
    u._patrolWait = 0;
    setUnitWalking(u, false);
  });
}

export function selectPCHero(hero)  { _selected = hero; }
export function deselectPCHero()    { _selected = null; }

export function movePCHeroTo(hero, x, z) {
  if (!hero || !_active) return;
  hero._pcTarget = { x, z };
  setUnitWalking(hero, true);
}

// ── Per-frame tick ────────────────────────────────────────────────────────────

export function tickPrecombat(dt) {
  if (!_active || _aggroed || _frozen) return;
  _tickHeroes(dt);
  _tickPatrol(dt);
  _checkAggro();
}

// ── Hero free movement ────────────────────────────────────────────────────────

function _tickHeroes(dt) {
  for (const hero of units) {
    if (hero.team !== 'blue' || !hero._pcTarget || hero.hp <= 0) continue;
    const { x, z } = hero._pcTarget;
    if (_stepToward(hero, x, z, WALK_SPEED, dt)) {
      // Snap to destination
      hero.grp.position.x = x;
      hero.grp.position.z = z;
      hero.anchor.x       = x;
      hero.anchor.z       = z;
      hero._pcTarget      = null;
      setUnitWalking(hero, false);
    }
  }
}

// ── Enemy patrol ──────────────────────────────────────────────────────────────

function _tickPatrol(dt) {
  for (const enemy of units) {
    if (enemy.team !== 'red' || enemy.hp <= 0) continue;
    const path = enemy.patrolPath;
    if (!path || path.length < 2) continue;

    // Brief pause at each waypoint
    if ((enemy._patrolWait ?? 0) > 0) {
      enemy._patrolWait -= dt;
      setUnitWalking(enemy, false);
      continue;
    }

    if (enemy._patrolIdx == null) enemy._patrolIdx = 0;
    const wp = path[enemy._patrolIdx];

    if (_stepToward(enemy, wp.x, wp.z, PATROL_SPEED, dt)) {
      enemy.grp.position.x = wp.x;
      enemy.grp.position.z = wp.z;
      enemy.anchor.x       = wp.x;
      enemy.anchor.z       = wp.z;
      enemy._patrolIdx     = (enemy._patrolIdx + 1) % path.length;
      enemy._patrolWait    = 12;    // pause at each waypoint
      setUnitWalking(enemy, false);
    } else {
      setUnitWalking(enemy, true);
    }
  }
}

// Move `unit` one frame toward (tx, tz). Returns true when arrived.
function _stepToward(unit, tx, tz, speed, dt) {
  const dx = tx - unit.grp.position.x;
  const dz = tz - unit.grp.position.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < 0.022) return true;   // 0.15 wu threshold
  const dist = Math.sqrt(distSq);
  const step = Math.min(speed * dt, dist);
  unit.grp.position.x += (dx / dist) * step;
  unit.grp.position.z += (dz / dist) * step;
  unit.anchor.x        = unit.grp.position.x;
  unit.anchor.z        = unit.grp.position.z;
  unit.grp.rotation.y  = Math.atan2(dx, dz);
  return false;
}

// ── Proximity aggro ───────────────────────────────────────────────────────────

function _checkAggro() {
  const heroes  = units.filter(u => u.team === 'blue' && u.hp > 0);
  const enemies = units.filter(u => u.team === 'red'  && u.hp > 0);
  for (const enemy of enemies) {
    const range = enemy.detectRange ?? UNIT_TYPES[enemy.type]?.detect ?? DETECT_DEFAULT;
    for (const hero of heroes) {
      const dx = hero.grp.position.x - enemy.grp.position.x;
      const dz = hero.grp.position.z - enemy.grp.position.z;
      if (dx * dx + dz * dz <= range * range) {
        _triggerAggro(enemy);
        return;
      }
    }
  }
}

function _triggerAggro(spotter) {
  _aggroed = true;
  spotter.aggro = true;
  playUnitAggroSound(spotter.type);
  showCenterAlert('Combat!');
  addLog(`⚠ ${unitLabel(spotter)} attacks the heroes!`, 'round');

  // BFS social aggro cascade: enemies within an alerted enemy's social range also join
  const enemies = units.filter(u => u.team === 'red' && u.hp > 0 && u !== spotter);
  const alerted = new Set([spotter]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of alerted) {
      const sr = a.socialAggroRange ?? SOCIAL_AGGRO_DEFAULT;
      for (const b of enemies) {
        if (alerted.has(b)) continue;
        const dx = b.grp.position.x - a.grp.position.x;
        const dz = b.grp.position.z - a.grp.position.z;
        if (dx * dx + dz * dz <= sr * sr) {
          b.aggro = true;
          alerted.add(b);
          changed = true;
          addLog(`⚠ ${unitLabel(b)} attacks the heroes!`, 'round');
        }
      }
    }
  }
  // Explicitly mark non-alerted enemies so rollInitiative skips them
  for (const e of enemies) {
    if (!alerted.has(e)) e.aggro = false;
  }

  const _doStart = () => { exitPrecombat(); rollInitiative(); };
  if (getActiveZone()?.id === 'dungeon_entrance') {
    setTimeout(() => showQuickDialogue(
      [{ s: 'Milo', t: 'An ambush! Ready yourselves!' }],
      _doStart
    ), 700);
  } else {
    setTimeout(_doStart, 900);
  }
}
