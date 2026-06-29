import { units, setUnitWalking } from './units.js';
import { UNIT_TYPES, GROUND_SIZE } from './constants.js';
import { rollInitiative, showCenterAlert, addLog, unitLabel } from './combat.js';
import { playUnitAggroSound } from './audio.js';
import { getActiveZone } from './zoneLoader.js';
import { showQuickDialogue } from './dagnaEvent.js';
import { barrierSegments } from './environments.js';

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
let _miloAmbushFired = false;

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
  _frozen   = false;
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

function _crossesAnyBarrier(ax, az, bx, bz) {
  for (const s of barrierSegments) {
    const rx = bx - ax, rz = bz - az;
    const sx = s.x2 - s.x1, sz = s.z2 - s.z1;
    const denom = rx * sz - rz * sx;
    if (Math.abs(denom) < 1e-9) continue;
    const qpx = s.x1 - ax, qpz = s.z1 - az;
    const t = (qpx * sz - qpz * sx) / denom;
    const u = (qpx * rz - qpz * rx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

export function movePCHeroTo(hero, x, z) {
  if (!hero || !_active) return;
  const zone  = getActiveZone();
  const halfGS = ((zone?.groundSize ?? GROUND_SIZE) / 2) - 2;
  const cx = Math.max(-halfGS, Math.min(halfGS, x));
  const cz = Math.max(-halfGS, Math.min(halfGS, z));
  if (_crossesAnyBarrier(hero.grp.position.x, hero.grp.position.z, cx, cz)) return;
  hero._pcTarget = { x: cx, z: cz };
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
    const heroResult = _stepToward(hero, x, z, WALK_SPEED, dt);
    if (heroResult === 'arrived') {
      hero.grp.position.x = x;
      hero.grp.position.z = z;
      hero.anchor.x       = x;
      hero.anchor.z       = z;
      hero._pcTarget      = null;
      setUnitWalking(hero, false);
    } else if (heroResult === 'blocked') {
      hero._pcTarget = null;
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

    const result = _stepToward(enemy, wp.x, wp.z, PATROL_SPEED, dt);
    if (result === 'arrived') {
      enemy.grp.position.x = wp.x;
      enemy.grp.position.z = wp.z;
      enemy.anchor.x       = wp.x;
      enemy.anchor.z       = wp.z;
      enemy._patrolIdx     = (enemy._patrolIdx + 1) % path.length;
      enemy._patrolWait    = 12;    // pause at each waypoint
      setUnitWalking(enemy, false);
    } else if (result === 'blocked') {
      // Barrier between current position and waypoint — skip to next waypoint
      // without snapping position (which would teleport the unit through the wall).
      enemy._patrolIdx = (enemy._patrolIdx + 1) % path.length;
      setUnitWalking(enemy, false);
    } else {
      setUnitWalking(enemy, true);
    }
  }
}

// Move `unit` one frame toward (tx, tz).
// Returns 'arrived' when close enough, 'blocked' when a barrier/boundary blocks the step, false otherwise.
function _stepToward(unit, tx, tz, speed, dt) {
  const dx = tx - unit.grp.position.x;
  const dz = tz - unit.grp.position.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < 0.022) return 'arrived';   // 0.15 wu threshold
  const dist = Math.sqrt(distSq);
  const step = Math.min(speed * dt, dist);
  const nx = unit.grp.position.x + (dx / dist) * step;
  const nz = unit.grp.position.z + (dz / dist) * step;
  if (_crossesAnyBarrier(unit.grp.position.x, unit.grp.position.z, nx, nz)) return 'blocked';
  const zone2   = getActiveZone();
  const halfGS2 = ((zone2?.groundSize ?? GROUND_SIZE) / 2) - 2;
  if (Math.abs(nx) > halfGS2 || Math.abs(nz) > halfGS2) return 'blocked';
  unit.grp.position.x = nx;
  unit.grp.position.z = nz;
  unit.anchor.x        = nx;
  unit.anchor.z        = nz;
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
  units.filter(u => u.team === 'blue').forEach(u => {
    u._pcTarget = null;
    setUnitWalking(u, false);
  });
  playUnitAggroSound(spotter.type);
  showCenterAlert('Combat!');
  addLog(`⚠ ${unitLabel(spotter)} attacks the heroes!`, 'alert');

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
          addLog(`⚠ ${unitLabel(b)} attacks the heroes!`, 'alert');
        }
      }
    }
  }
  // Explicitly mark non-alerted enemies so rollInitiative skips them
  for (const e of enemies) {
    if (!alerted.has(e)) e.aggro = false;
  }

  const _doStart = () => { exitPrecombat(); rollInitiative(); };
  if (getActiveZone()?.id === 'road_to_phandelver' && !_miloAmbushFired) {
    _miloAmbushFired = true;
    setTimeout(() => showQuickDialogue(
      [{ s: 'Milo', t: 'An ambush! Ready yourselves!' }],
      _doStart
    ), 700);
  } else {
    setTimeout(_doStart, 900);
  }
}
