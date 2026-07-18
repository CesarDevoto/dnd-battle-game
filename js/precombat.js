import { units, setUnitWalking } from './units.js';
import { UNIT_TYPES, GROUND_SIZE } from './constants.js';
import { rollInitiative, showCenterAlert, addLog, unitLabel, unitsHaveLOS, heroStealthPct } from './combat.js';
import { playUnitAggroSound } from './audio.js';
import { getActiveZone, capDetectRange } from './zoneLoader.js';
import { showQuickDialogue } from './dagnaEvent.js';
import { barrierSegments } from './environments.js';
import { barrierBlocksLayer } from './terrain.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const WALK_SPEED          = 5.4;  // hero free-roam speed (world units/sec)
const SNEAK_SPEED_MULT    = 0.66; // a sneaking hero (hero.sneaking) creeps at 66% walk speed
const PATROL_SPEED        = 0.9;  // enemy patrol speed
const DETECT_DEFAULT      = 20;   // fallback detection radius (world units)
const SOCIAL_AGGRO_DEFAULT = 10;  // fallback social aggro radius (world units)

// Group-move recovery: when a follower's direct line to its formation slot is
// blocked, it steers toward the leader's live position (funnels through the same
// gap) instead of dead-stopping, then re-spreads once its slot is reachable.
const FUNNEL_LAG_SQ = 36;   // >6 WU behind leader → funnel toward the leader
// Slide fallbacks: if the straight step into an obstacle is blocked, retry the
// step rotated by these offsets (radians, nearest-to-straight first) so a hero
// hugs around a corner/prop. Each candidate is still barrier/bounds-validated.
const DEFLECT_ANGLES = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];

// Leash. A group-move follower that slips to the WRONG SIDE of a barrier (hairline
// gap at a segment junction, or a cave-layer flip that makes a wall stop blocking
// it) can never path back — every route home crosses the wall it just went through,
// so it grinds along the far face and wanders off. Rather than trust the barrier
// data to be perfect, watch for the symptom and yank them back: a follower that is
// either flat-out lost (beyond LEASH_DIST) or walled off from its leader, AND has
// stopped closing the gap for LEASH_TIME, is teleported to a free slot beside the
// leader. Requiring the stall as well as the distance means a follower legitimately
// walking a long way around a corridor is left alone.
const LEASH_DIST = 14;    // WU (~35 ft) — beyond this a follower is lost, wall or no wall
const LEASH_TIME = 1.5;   // s of making no progress before we yank
const LEASH_EPS  = 0.15;  // WU — closing less than this doesn't count as progress
const SNAP_SLOTS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.5], [0, 1.5], [-1.5, 0], [1.5, 0]];

// ── State ─────────────────────────────────────────────────────────────────────

let _active   = false;
let _aggroed  = false;
let _selected = null;   // hero selected for movement
let _frozen   = false;  // set by dagnaEvent during scripted dialogue sequences
let _miloAmbushFired    = false;
let _morvathDialogFired = false;

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
    u._pcLeader   = null;
    u._pcBlocked  = false;
    u._pcLostT    = 0;
    u._pcLastD    = Infinity;
    u._patrolWait = 0;
    setUnitWalking(u, false);
  });
}

export function selectPCHero(hero)  { _selected = hero; }
export function deselectPCHero()    { _selected = null; }

export function crossesAnyBarrier(ax, az, bx, bz, layer) {
  for (const s of barrierSegments) {
    const rx = bx - ax, rz = bz - az;
    const sx = s.x2 - s.x1, sz = s.z2 - s.z1;
    const denom = rx * sz - rz * sx;
    if (Math.abs(denom) < 1e-9) continue;
    const qpx = s.x1 - ax, qpz = s.z1 - az;
    const t = (qpx * sz - qpz * sx) / denom;
    const u = (qpx * rz - qpz * rx) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    // Layer-test the actual CROSSING point rather than the segment's midpoint — see
    // the matching note in combat.js crossesBarrier().
    if (barrierBlocksLayer(ax + rx * t, az + rz * t, layer)) return true;
  }
  return false;
}

// `leader` (optional) marks this as a group follower: it will funnel toward the
// leader when blocked rather than dead-stopping. Solo/leader moves pass null and
// keep the up-front "can't path there" rejection.
export function movePCHeroTo(hero, x, z, leader = null) {
  if (!hero || !_active) return;
  const zone  = getActiveZone();
  const halfGS = ((zone?.groundSize ?? GROUND_SIZE) / 2) - 2;
  const cx = Math.max(-halfGS, Math.min(halfGS, x));
  const cz = Math.max(-halfGS, Math.min(halfGS, z));
  if (!leader && crossesAnyBarrier(hero.grp.position.x, hero.grp.position.z, cx, cz, hero.caveLayer)) return;
  hero._pcTarget  = { x: cx, z: cz };
  hero._pcLeader  = leader;
  hero._pcBlocked = false;
  hero._pcLostT   = 0;
  hero._pcLastD   = Infinity;
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
    const dest   = hero._pcTarget;
    const leader = hero._pcLeader;
    const hasLeader = !!(leader && leader.hp > 0);

    if (hasLeader && _leash(hero, leader, dt)) continue;

    // Beacon: aim at the formation slot normally; a follower that was blocked last
    // frame or has fallen too far behind steers toward the leader's live position
    // to thread the same gap. It always re-spreads toward `dest` once unobstructed.
    let bx = dest.x, bz = dest.z;
    if (hasLeader) {
      const lx = leader.grp.position.x - hero.grp.position.x;
      const lz = leader.grp.position.z - hero.grp.position.z;
      if (hero._pcBlocked || (lx * lx + lz * lz) > FUNNEL_LAG_SQ) {
        bx = leader.grp.position.x;
        bz = leader.grp.position.z;
      }
    }

    const heroSpeed  = WALK_SPEED * (hero.sneaking ? SNEAK_SPEED_MULT : 1);
    const heroResult = _stepToward(hero, bx, bz, heroSpeed, dt, true);

    if (heroResult === 'arrived') {
      // Only finish when we've reached our own slot — reaching the leader beacon
      // just means keep going (next frame re-aims at the slot to re-spread).
      const ddx = dest.x - hero.grp.position.x, ddz = dest.z - hero.grp.position.z;
      if (ddx * ddx + ddz * ddz < 0.25) {
        hero.grp.position.x = dest.x;
        hero.grp.position.z = dest.z;
        hero.anchor.x       = dest.x;
        hero.anchor.z       = dest.z;
        hero._pcTarget = null;
        hero._pcLeader = null;
        setUnitWalking(hero, false);
      }
      hero._pcBlocked = false;
    } else if (heroResult === 'blocked') {
      hero._pcBlocked = true;
      // A follower keeps trying (funnels next frame) unless it's already hugging
      // the leader and still boxed in — then give up, as before. Leaderless moves
      // stop immediately on a true block, matching the old behavior.
      if (hasLeader) {
        const lx = leader.grp.position.x - hero.grp.position.x;
        const lz = leader.grp.position.z - hero.grp.position.z;
        if ((lx * lx + lz * lz) < 4) {
          hero._pcTarget = null;
          hero._pcLeader = null;
          setUnitWalking(hero, false);
        }
      } else {
        hero._pcTarget = null;
        setUnitWalking(hero, false);
      }
    } else {
      hero._pcBlocked = false;
    }
  }
}

// Watch a follower for the "stranded on the far side of a wall" symptom and snap it
// back to the leader if it shows. Returns true if the hero was snapped (its move is
// finished for this frame).
function _leash(hero, leader, dt) {
  const hx = hero.grp.position.x,   hz = hero.grp.position.z;
  const lx = leader.grp.position.x, lz = leader.grp.position.z;
  const d  = Math.hypot(lx - hx, lz - hz);

  if (d < (hero._pcLastD ?? Infinity) - LEASH_EPS) {
    hero._pcLastD = d;                       // still closing — all is well
    hero._pcLostT = 0;
    return false;
  }
  hero._pcLostT = (hero._pcLostT ?? 0) + dt;
  if (hero._pcLostT < LEASH_TIME) return false;

  const stranded = d > LEASH_DIST || crossesAnyBarrier(hx, hz, lx, lz, hero.caveLayer);
  if (!stranded) return false;               // stalled but reachable — let it keep trying

  // Land on the leader's own cave layer, not whatever layer the wall it slipped
  // through put it on; main.js re-resolves from there.
  let sx = lx, sz = lz;
  for (const [ox, oz] of SNAP_SLOTS) {
    const x = lx + ox, z = lz + oz;
    if (crossesAnyBarrier(lx, lz, x, z, leader.caveLayer)) continue;
    if (units.some(o => o !== hero && o.hp > 0 &&
        Math.hypot(o.grp.position.x - x, o.grp.position.z - z) < 0.9)) continue;
    sx = x; sz = z;
    break;
  }
  hero.grp.position.x = sx;
  hero.grp.position.z = sz;
  hero.anchor.x       = sx;
  hero.anchor.z       = sz;
  hero.caveLayer      = leader.caveLayer;
  hero._pcTarget = null;
  hero._pcLeader = null;
  hero._pcBlocked = false;
  hero._pcLostT   = 0;
  hero._pcLastD   = Infinity;
  setUnitWalking(hero, false);
  addLog(`${unitLabel(hero)} was left behind and rejoins the party.`, 'move');
  return true;
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

// True if stepping from (px,pz) to (nx,nz) hits a barrier or leaves the ground.
function _blockedStep(px, pz, nx, nz, unit) {
  if (crossesAnyBarrier(px, pz, nx, nz, unit.caveLayer)) return true;
  const zone   = getActiveZone();
  const halfGS = ((zone?.groundSize ?? GROUND_SIZE) / 2) - 2;
  return Math.abs(nx) > halfGS || Math.abs(nz) > halfGS;
}

// Move `unit` one frame toward (tx, tz). With `deflect`, a blocked straight step
// retries at rotated headings (slides around corners/props) before giving up.
// Returns 'arrived' when close enough, 'blocked' when nothing clears, false otherwise.
function _stepToward(unit, tx, tz, speed, dt, deflect = false) {
  const px = unit.grp.position.x, pz = unit.grp.position.z;
  const dx = tx - px, dz = tz - pz;
  const distSq = dx * dx + dz * dz;
  if (distSq < 0.022) return 'arrived';   // 0.15 wu threshold
  const dist = Math.sqrt(distSq);
  const step = Math.min(speed * dt, dist);
  const baseAng = Math.atan2(dx, dz);
  const angles = deflect ? DEFLECT_ANGLES : [0];
  for (const off of angles) {
    const a  = baseAng + off;
    const nx = px + Math.sin(a) * step;
    const nz = pz + Math.cos(a) * step;
    if (_blockedStep(px, pz, nx, nz, unit)) continue;
    unit.grp.position.x = nx;
    unit.grp.position.z = nz;
    unit.anchor.x       = nx;
    unit.anchor.z       = nz;
    unit.grp.rotation.y = a;
    return false;
  }
  return 'blocked';
}

// ── Proximity aggro ───────────────────────────────────────────────────────────

// A sneaking hero shrinks an enemy's detection radius against them, scaled by their stealth STRENGTH
// (heroStealthPct: DEX mod ×5 + stealth% gear, in percentage points). Higher = smaller radius.
// Clamped so they never fully vanish. ~15 (Milo, no gear) → 0.78×; ~35 (geared) → 0.48×; 47+ → 0.30×.
export function sneakDetectMult(stealthPct) {
  return Math.max(0.3, Math.min(1.0, 1 - (stealthPct ?? 0) * 0.015));
}

function _checkAggro() {
  const heroes  = units.filter(u => u.team === 'blue' && u.hp > 0);
  const enemies = units.filter(u => u.team === 'red'  && u.hp > 0);
  for (const enemy of enemies) {
    // capDetectRange shrinks this to 8 squares in fog / high-darkness zones.
    const baseRange = capDetectRange(enemy.detectRange ?? UNIT_TYPES[enemy.type]?.detect ?? DETECT_DEFAULT);
    for (const hero of heroes) {
      // A sneaking hero shrinks this enemy's detection radius against them, scaled by their stealth
      // strength (heroStealthPct: DEX + stealth% gear). Milo's old dedicated OOC hide folded into
      // this — he now sneaks via the MOVE-widget Stealth button, his high DEX giving a strong shrink.
      const range = hero.sneaking ? baseRange * sneakDetectMult(heroStealthPct(hero)) : baseRange;
      const dx = hero.grp.position.x - enemy.grp.position.x;
      const dz = hero.grp.position.z - enemy.grp.position.z;
      if (dx * dx + dz * dz <= range * range) {
        // Enemies must actually SEE the hero, not merely be near them. Aggro used to be a
        // pure 2D distance test, so a creature up on the cave-roof blanket would pile onto a
        // party walking the tunnel underneath it — through solid rock — and enemies aggroed
        // straight through walls and boulders besides. unitsHaveLOS is layer-aware (it reads
        // both units' caveLayer), which is the part that makes this work at all: the raw
        // coordinate LOS samples the CARVED floor for both eyes and would have put the
        // surface enemy's eye down inside the tunnel and reported a clear view.
        //
        // Deliberately AFTER the range test: LOS costs a terrain walk plus a prop raycast, so
        // it only runs for the handful of pairs already close enough to matter.
        if (!unitsHaveLOS(enemy, hero)) continue;
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
          addLog(`⚠ ${unitLabel(b)} is alerted by nearby allies!`, 'alert');
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
  } else if (getActiveZone()?.id === 'mausoleum' && !_morvathDialogFired && [...alerted].some(u => u.type === 'morvath')) {
    _morvathDialogFired = true;
    setTimeout(() => showQuickDialogue(
      [{ s: 'Morvath', t: "Behold, my pets… worms wriggling in our sanctum! How futile… You will not simply die this day adventurers. You will become something greater — wailing instruments in the choir of my legion. Feast upon their flesh, my children. Then… we shall raise them." }],
      _doStart
    ), 700);
  } else {
    setTimeout(_doStart, 450);
  }
}
