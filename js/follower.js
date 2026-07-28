// js/follower.js — breadcrumb follower for companion NPCs (Solrac, and whoever
// joins the party next).
//
// The follower walks the leader's RECORDED path, not a straight line to wherever
// the leader is standing right now. That's the whole trick: this game has no
// navmesh, and out of combat the only thing that blocks movement is a hand-placed
// barrier segment — which in a cave zone IS the rock wall. A companion that steers
// straight at its leader wedges itself against those walls. One that retraces the
// leader's own footsteps can't, because the leader is barrier-checked, so every
// breadcrumb is by definition somewhere a unit may legally stand.
//
// Three modes, cheapest first:
//   1. DIRECT — clear line to the leader (open ground, the common case): walk
//      straight at them and throw the trail away.
//   2. TRAIL  — a barrier sits between them: walk the breadcrumbs instead.
//   3. GHOST  — escape hatch. If the follower stops making progress for
//      GHOST_AFTER seconds (boxed into a barrier corner) or the trail was lost to
//      a teleport, it stops colliding and walks straight through to the leader,
//      re-solidifying once it has a clear line again. A moment of clipping beats
//      an NPC stuck behind a rock forever.
//
// Y is not touched here — main.js re-conforms every unit to the ground each frame.

import { units, setUnitWalking } from './units.js';
import { isPrecombat, crossesAnyBarrier } from './precombat.js';
import { stepPassableAt, isSurfaceMovement } from './surfaces.js';

const TRAIL_STEP  = 0.35;  // WU between breadcrumbs
const TRAIL_MAX   = 160;   // ~56 WU of history, then the oldest drop off
const REACH_WP    = 0.30;  // WU — breadcrumb counts as reached

const SPEED       = 5.4;   // WU/s — same as the heroes' free-roam WALK_SPEED
const SPRINT_FROM = 6;     // WU behind → speed up to close the gap
const SPRINT_MULT = 1.45;  // ...so the player can't outrun him by holding a run

const GHOST_AFTER = 2.0;   // s without progress → phase through
const GHOST_EPS   = 0.15;  // WU — closing less than this doesn't count as progress

// Slide headings tried when the straight step is blocked, nearest-to-straight
// first, so he hugs around a corner instead of grinding into it. Same idea as
// DEFLECT_ANGLES in precombat.js.
const DEFLECT = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05];

const _followers = [];

// leaderFn is resolved every frame rather than captured, so the follower survives
// the leader dying, being revived, or the unit list being rebuilt on zone load.
// `run: true` makes this follower cover ground at a run — the run CLIP plus the
// sprint speed, so the feet match the pace instead of skating. Opt-in: without it
// a follower keeps the original walk-clip gait at all distances (Solrac's).
export function addFollower(unit, leaderFn, { stop = 2, resume = 3, run = false } = {}) {
  if (!unit || !leaderFn) return;
  removeFollower(unit);
  _followers.push({
    unit, leaderFn, stop, resume, run,
    trail: [], ti: 0,
    moving: false, ghost: false,
    stallT: 0, lastD: Infinity,
  });
}

export function removeFollower(unit) {
  const i = _followers.findIndex(f => f.unit === unit);
  if (i >= 0) _followers.splice(i, 1);
}

export function isFollowing(unit) { return _followers.some(f => f.unit === unit); }

export function clearFollowers() { _followers.length = 0; }

// Units are rebuilt per zone, so stale follower entries must not outlive them.
window.addEventListener('zone:loading', clearFollowers);

// Drop `unit` a step behind `leader` — used on zone entry, where a companion who
// already travels with the party should arrive with them rather than walk the
// whole map. Y is left to main.js.
export function snapBehindLeader(unit, leader, dist = 2) {
  if (!unit || !leader) return;
  const back = leader.grp.rotation.y + Math.PI;
  const x = leader.grp.position.x + Math.sin(back) * dist;
  const z = leader.grp.position.z + Math.cos(back) * dist;
  unit.grp.position.x = x;
  unit.grp.position.z = z;
  unit.grp.rotation.y = leader.grp.rotation.y;
  if (unit.anchor) { unit.anchor.x = x; unit.anchor.z = z; }
  const f = _followers.find(f => f.unit === unit);
  if (f) { f.trail.length = 0; f.ti = 0; f.stallT = 0; f.lastD = Infinity; f.ghost = false; }
}

export function tickFollowers(dt) {
  if (!_followers.length) return;

  // Hang back during a fight and hold position, like Floosh. Combat movement is
  // the turn system's business, not ours.
  if (!isPrecombat()) {
    for (const f of _followers) if (f.moving) _halt(f);
    return;
  }

  for (const f of _followers) _tickOne(f, dt);
}

function _tickOne(f, dt) {
  const u = f.unit;
  if (!u || !units.includes(u)) return;
  // NPCs are built with hp 0 on purpose (units.js: "no hp bar, no combat stats"),
  // so hp is only a liveness test for units that actually have any.
  if (u.team !== 'npc' && u.hp <= 0) return;

  const leader = f.leaderFn();
  if (!leader || leader.hp <= 0) { _halt(f); return; }

  const lx = leader.grp.position.x, lz = leader.grp.position.z;
  const px = u.grp.position.x,      pz = u.grp.position.z;

  _recordBreadcrumb(f, lx, lz);

  const d     = Math.hypot(lx - px, lz - pz);
  // A clear line means the follower is in the same walkable pocket as the leader —
  // it's both the fast-path test and the only safe way out of GHOST (exiting while
  // the line is still blocked would strand him on the wrong side of the wall).
  const clear = !crossesAnyBarrier(px, pz, lx, lz);
  // BEELINE only when it's actually safe. In a surfaceMovement zone the straight line to the leader can
  // cross a cliff or a mesh wall (neither is a barrier SEGMENT), so a beeline would climb/clip. There we
  // always trace the trail instead — the leader's own collision-checked footsteps, safe to retrace.
  const beeline = clear && !isSurfaceMovement();

  // Deadband: close in once he's past `resume`, settle at `stop`. A single
  // threshold makes him flicker between walk and idle on the boundary frame.
  const inPlace = f.moving ? d <= f.stop : d <= f.resume;
  if (inPlace && (!f.ghost || clear)) {
    _halt(f);
    // Settled with a clear line: the squiggle he recorded getting here is dead
    // weight — drop it, or a leader who circles him would make him retrace the
    // whole loop the next time she walks off.
    if (clear) { f.trail.length = 0; f.ti = 0; }
    if (d > 1.2) _face(u, lx, lz);
    return;
  }
  f.moving = true;

  // Stall watchdog. Progress = actually closing on the leader; grinding into a
  // barrier corner at full walk speed is not progress.
  if (d < f.lastD - GHOST_EPS) { f.stallT = 0; f.lastD = d; }
  else                         { f.stallT += dt; }
  if (f.stallT >= GHOST_AFTER) f.ghost = true;

  // A `run` follower moves at sprint speed the whole way; everyone else keeps the
  // original rule (sprint only to close a gap bigger than SPRINT_FROM). The third
  // arg picks the run CLIP, and it's tied to the same flag — a run clip played at
  // walk speed reads as skating.
  const sprinting = f.run || d > SPRINT_FROM;
  const speed = SPEED * (sprinting ? SPRINT_MULT : 1);
  setUnitWalking(u, true, !!f.run);

  if (f.ghost)  { _step(u, lx, lz, speed, dt, false); return; }   // through the wall
  if (beeline)  {                                                  // straight at her (safe open ground)
    if (_step(u, lx, lz, speed, dt, true)) { f.trail.length = 0; f.ti = 0; }
    return;
  }

  // Blocked — walk the breadcrumbs. Consume the ones he's already standing on,
  // then head for the next.
  while (f.ti < f.trail.length) {
    const wp = f.trail[f.ti];
    if ((wp.x - px) ** 2 + (wp.z - pz) ** 2 > REACH_WP * REACH_WP) break;
    f.ti++;
  }
  const wp = f.trail[f.ti];
  // No breadcrumb left but still walled off (trail lost to a teleport, or he was
  // spawned on the wrong side): nothing legal to aim at, so phase out.
  if (!_step(u, wp?.x ?? lx, wp?.z ?? lz, speed, dt, true)) f.ghost = true;
}

function _recordBreadcrumb(f, lx, lz) {
  const last = f.trail[f.trail.length - 1];
  if (last && (lx - last.x) ** 2 + (lz - last.z) ** 2 < TRAIL_STEP * TRAIL_STEP) return;
  f.trail.push({ x: lx, z: lz });
  if (f.trail.length > TRAIL_MAX) {
    f.trail.shift();
    if (f.ti > 0) f.ti--;
  }
}

// Returns true if the unit moved, false if every heading was blocked.
function _step(u, tx, tz, speed, dt, respectBarriers) {
  const px = u.grp.position.x, pz = u.grp.position.z;
  const dx = tx - px, dz = tz - pz;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return true;

  const step = Math.min(speed * dt, dist);
  const base = Math.atan2(dx, dz);
  const refLvl = u._level ?? u.grp.position.y;
  for (const off of (respectBarriers ? DEFLECT : [0])) {
    const a  = base + off;
    const nx = px + Math.sin(a) * step;
    const nz = pz + Math.cos(a) * step;
    if (respectBarriers && crossesAnyBarrier(px, pz, nx, nz)) continue;
    // Same surface collision the leader obeys (cliffs, mesh walls, slope) — no-op in non-surface zones.
    if (respectBarriers && !stepPassableAt(px, pz, nx, nz, refLvl)) continue;
    u.grp.position.x = nx;
    u.grp.position.z = nz;
    u.grp.rotation.y = a;
    if (u.anchor) { u.anchor.x = nx; u.anchor.z = nz; }
    return true;
  }
  return false;
}

function _face(u, tx, tz) {
  u.grp.rotation.y = Math.atan2(tx - u.grp.position.x, tz - u.grp.position.z);
}

function _halt(f) {
  f.moving = false;
  f.ghost  = false;
  f.stallT = 0;
  f.lastD  = Infinity;
  setUnitWalking(f.unit, false);
}
