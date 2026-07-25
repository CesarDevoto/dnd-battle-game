// js/surfaces.js — surface-aware multi-level movement (EverQuest-style).
//
// Phase 1: walkable platforms/ramps on top of the heightmap; each x,z has ONE walkable surface.
// Phase 2 (this file now): TRUE over/under — a NON-SOLID surface (a `bridge` deck) adds a level
// WITHOUT hiding the ground beneath it, so a unit can walk BOTH across the deck AND underneath it.
// That means an x,z can have several walkable levels, so the pathfinders key on (x,z,level) and each
// unit tracks which level it's on (u._level). Combat.js owns the level-aware BFS; this module owns
// the surface data + the level queries (surfacesAt / nearestLevel) they use.
//
// Every existing heightmap zone is untouched: with _active=false, surfacesAt is just [terrain],
// nearestLevel/surfaceHeightAt return terrain, and the whole thing is a no-op.
//
// Surface `solid` flag:
//   • solid:true  (default, platforms & ramps) — occludes the ground in its footprint; you walk ON
//                  it, never under it. Its footprint contributes exactly one level.
//   • solid:false (bridges) — a thin deck; the terrain floor below stays walkable, so the footprint
//                  contributes TWO levels (ground + deck). This is the whole over/under mechanic.

import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { getGroundHeight } from './terrain.js';
import { WORLD_UNITS_PER_SQUARE } from './constants.js';

// three-mesh-bvh: accelerate raycasts against collider geometry. Patched globally — a mesh WITHOUT a
// boundsTree (units, ground, props) falls back to the default raycast, so only colliders (which call
// computeBoundsTree in registerCollisionMesh) get the O(log n) BVH path. This is what makes a detailed
// (100k+ triangle) collision model usable for the per-move floor/wall/clearance rays (no cheap BVH → brute force).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Max surface-height a unit may CLIMB between adjacent tiles. Ramps/stairs must rise less than this
// per tile to stay walkable; a step UP bigger than this is a wall.
export const SURFACE_STEP = 1.4;
// Max height a unit may DROP in one step. Descents are allowed (you can walk OFF a ledge / down the
// back of stairs and slide to the level below) up to this; a bigger drop is treated as a cliff.
export const MAX_DROP = 8.0;
// Max NATURAL-TERRAIN rise per grid SQUARE a unit may walk UP under continuous (WASD/exploration)
// movement: if terrain climbs more than this over one square, it's a wall and WASD is blocked, so steep
// terrain acts as its OWN barrier (no hand-drawn barrier needed). Uses raw terrain only, so mesh
// stairs/ramps stay climbable via the level system. (A future "ladder" primitive would be the sanctioned
// way up such spots.) Measured per WORLD_UNITS_PER_SQUARE of horizontal travel.
export const MAX_CLIMB_PER_SQUARE = 4.0;
// How far ahead the climb gate looks (WU) so a WASD unit halts at the BASE of a cliff instead of
// climbing into it, and how many points it samples along that probe. Larger DIST = stops sooner
// (bigger gap from the face); smaller = stops closer but risks a little penetration.
const SLOPE_PROBE_DIST    = 2.5;
const SLOPE_PROBE_SAMPLES = 5;

let _active     = false;
let _surfaces   = [];   // [{ contains(x,z):bool, heightAt(x,z):number, solid:bool }]
let _losBlockers = [];  // the surface MESHES — line-of-sight raycasts against these (real occlusion)

// ── Mesh-collision layer (imported GLB models used as walkable/blocking geometry) ──
// A placed model flagged `collision:true` is registered here; at zone load we raycast its geometry
// into a baked nav-grid (floor levels per cell + blocked wall edges). Empty in non-collision zones.
let _collisionMeshes = [];   // registered collider roots (Object3D — buildings, ramps, walls)
let _colliderBoxes   = [];   // their world-space AABBs — a cheap XZ gate so far-away queries skip raycasts
let _floorCache      = new Map();   // memoised down-ray floor lookups, keyed by quantised x,z
let _standCache      = new Map();   // memoised body-clearance up-ray, keyed by quantised x,z,level

export function setSurfaceMovement(on) { _active = !!on; }
export function isSurfaceMovement()     { return _active; }
export function clearSurfaces() {
  _surfaces = []; _losBlockers = [];
  _collisionMeshes = []; _colliderBoxes = []; _floorCache.clear(); _standCache.clear();
}
// The platform/ramp/bridge meshes, for LOS raycasting. A ray through a platform box, a ramp wedge,
// or a bridge deck slab is occluded — so elevation hides units correctly (behind a platform, under
// a bridge) the way a height-field check can't. Empty in normal zones (no surface LOS cost).
export function surfaceLosBlockers() { return _losBlockers; }

// All walkable levels at world (x,z), sorted ascending. The terrain floor is included UNLESS a solid
// surface covers the point; every surface at the point contributes its height. Non-solid (bridge)
// surfaces therefore yield [ground, deck] — the two levels that make over/under possible.
export function surfacesAt(x, z) {
  const base = getGroundHeight(x, z);
  if (!_active) return [base];
  let levels = null, solidCover = false;
  for (const s of _surfaces) {
    if (!s.contains(x, z)) continue;
    (levels ??= []).push(s.heightAt(x, z));
    if (s.solid) solidCover = true;
  }
  // Walkable tops from imported COLLISION GLBs (tread tops, a building's floors, a wall's top). These
  // are the surfaces a unit can STAND ON. The terrain base stays in the list (grounding needs it); a
  // unit being unable to stand at terrain because a wall's body is above it is enforced by the step
  // test's body-clearance check (bodyBlocksStand), NOT by dropping the level here — that keeps this
  // function safe for grounding and robust to gaps in a wall's top.
  const mesh = _meshFloorsAt(x, z);
  if (mesh) for (const L of mesh) (levels ??= []).push(L);
  if (!levels) return [base];
  if (!solidCover) levels.push(base);
  levels.sort((a, b) => a - b);
  const out = [levels[0]];                                   // dedup near-equal levels
  for (let i = 1; i < levels.length; i++) if (levels[i] - out[out.length - 1] > 0.05) out.push(levels[i]);
  return out;
}

// The walkable level at (x,z) closest to refY — grounding/movement use this so a unit stays on the
// deck it's on (or the ground it's under) instead of snapping to whatever surface is topmost. Prefers
// a STANDABLE level (body not blocked): under a staircase tread the terrain level is body-blocked, so
// a unit walking into the steps settles ONTO the tread and climbs instead of sliding through at ground
// level. Falls back to the geometric-nearest if every level is blocked (shouldn't happen via movement).
export function nearestLevel(x, z, refY) {
  const levels = surfacesAt(x, z);
  let best = null, bd = Infinity;                       // nearest STANDABLE level
  let any  = levels[0], ad = Math.abs(levels[0] - refY);   // fallback: nearest of any level
  for (const L of levels) {
    const d = Math.abs(L - refY);
    if (d < ad) { ad = d; any = L; }
    if (d < bd && !bodyBlocksStand(x, z, L)) { bd = d; best = L; }
  }
  return best ?? any;
}

// Topmost walkable surface (no reference level). Kept for callers that don't track a level; in an
// over/under zone prefer nearestLevel with the unit's own level so it doesn't jump onto the deck.
export function surfaceHeightAt(x, z) {
  const levels = surfacesAt(x, z);
  return levels[levels.length - 1];
}

// Phase-1 topmost step rule — retained for any caller that hasn't moved to the level-aware BFS.
export function stepPassable(x0, z0, x1, z1) {
  if (!_active) return true;
  return Math.abs(surfaceHeightAt(x1, z1) - surfaceHeightAt(x0, z0)) <= SURFACE_STEP;
}

// Level-aware step: standing at (x0,z0) on the level nearest refLevel, can a unit move to (x1,z1)?
// True if (x1,z1) has ANY walkable level within SURFACE_STEP of the from-level. This is what the
// continuous exploration mover uses so a hero walking UNDER a bridge (level 0) can cross to open
// ground (level 0) instead of being blocked by the deck overhead, and can't hop up onto the deck.
export function stepPassableAt(x0, z0, x1, z1, refLevel) {
  if (!_active) return true;
  const from = nearestLevel(x0, z0, refLevel);
  // Terrain-steepness gate with LOOKAHEAD (the WASD cliff barrier), applied ONLY when the unit is
  // actually on the natural GROUND. If it's up on a mesh floor (a bridge DECK, a platform), the steep
  // ravine/cliff terrain far below is irrelevant and must NOT block deck travel — that movement is
  // governed by the level system + wall/body checks below. Probe a short distance AHEAD in the move
  // direction so the unit stops at the cliff BASE, not inside it. Descents fine (walk off ledges).
  const hHere = getGroundHeight(x0, z0);
  if (from - hHere < SURFACE_STEP) {                            // on/near the ground, not up on a deck
    const run = Math.hypot(x1 - x0, z1 - z0);
    if (run > 1e-6) {
      const ux = (x1 - x0) / run, uz = (z1 - z0) / run;
      for (let i = 1; i <= SLOPE_PROBE_SAMPLES; i++) {
        const d = (i / SLOPE_PROBE_SAMPLES) * SLOPE_PROBE_DIST;
        if ((getGroundHeight(x0 + ux * d, z0 + uz * d) - hHere) / d * WORLD_UNITS_PER_SQUARE > MAX_CLIMB_PER_SQUARE) {
          return false;
        }
      }
    }
  }
  for (const L of surfacesAt(x1, z1)) {
    if (L - from > SURFACE_STEP) continue;                    // too tall to climb
    if (from - L > MAX_DROP)     continue;                    // too far to drop
    if (bodyBlocksStand(x1, z1, L)) continue;                 // a wall's body occupies this spot
    if (wallBlocksStep(x0, z0, x1, z1, from)) continue;       // a wall stands between the two tiles
    return true;
  }
  return false;
}

// ── Build walkable surfaces + their visual meshes from zone data ───────────────
// Each entry in zone.surfaces makes a walkable surface AND a visual mesh (returned for the zone
// loader to add + clear on teardown). Kinds:
//   { type:'platform', x, z, w, d, h }                    solid flat top at h (walk ON only)
//   { type:'ramp', x, z, w, len, axis:'x'|'z', h0, h1 }   solid slope h0→h1 along `axis`
//   { type:'bridge', x, z, w, d, h }                      NON-solid deck at h (walk ON and UNDER)
export function buildSurfacesFromZone(list) {
  clearSurfaces();
  const meshes = [];
  for (const def of (list ?? [])) {
    if (def.type === 'ramp')        { _surfaces.push(_rampSurface(def));     meshes.push(_rampMesh(def)); }
    else if (def.type === 'bridge') { _surfaces.push(_bridgeSurface(def));   meshes.push(_bridgeMesh(def)); }
    else                            { _surfaces.push(_platformSurface(def)); meshes.push(_platformMesh(def)); }
  }
  _losBlockers = meshes;   // same mesh objects the LOS raycast tests against
  return meshes;
}

function _platformSurface({ x, z, w, d, h }) {
  const hw = w / 2, hd = d / 2;
  return { contains: (px, pz) => Math.abs(px - x) <= hw && Math.abs(pz - z) <= hd, heightAt: () => h, solid: true };
}
function _bridgeSurface({ x, z, w, d, h }) {
  const hw = w / 2, hd = d / 2;
  return { contains: (px, pz) => Math.abs(px - x) <= hw && Math.abs(pz - z) <= hd, heightAt: () => h, solid: false };
}
function _rampSurface({ x, z, w, len, axis, h0, h1 }) {
  const alongX  = axis === 'x';
  const halfLen = len / 2, halfW = w / 2;
  return {
    contains: (px, pz) => {
      const a = alongX ? (px - x) : (pz - z);   // along the ramp
      const b = alongX ? (pz - z) : (px - x);   // across the ramp
      return Math.abs(a) <= halfLen && Math.abs(b) <= halfW;
    },
    heightAt: (px, pz) => {
      const a = alongX ? (px - x) : (pz - z);
      const t = Math.max(0, Math.min(1, (a + halfLen) / len));
      return h0 + (h1 - h0) * t;
    },
    solid: true,
  };
}

// Plain proof-of-concept geometry (grey stone). The WALKABLE surface is the analytic one above.
const _mat = () => new THREE.MeshStandardMaterial({ color: 0x6b6256, roughness: 0.95, metalness: 0.0 });

function _platformMesh({ x, z, w, d, h }) {
  const H = h + 3;                                   // extend below ground so there's no gap at the lip
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), _mat());
  m.position.set(x, h - H / 2, z);                   // top face sits exactly at y = h
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function _bridgeMesh({ x, z, w, d, h }) {
  const thick = 0.5;                                 // THIN slab — you can see + walk under the span
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), _mat());
  m.position.set(x, h - thick / 2, z);               // top face at y = h
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// A solid WEDGE built in world coords whose top face IS the analytic ramp plane (h0 at the −axis
// end, h1 at the +axis end) and whose base reaches y=0. Using a wedge instead of a tilted thin box
// removes the thickness/pivot offset that left a visible "crack" where the ramp met the deck.
function _rampMesh({ x, z, w, len, axis, h0, h1 }) {
  const alongX = axis === 'x';
  const a0 = -len / 2, a1 = len / 2, b0 = -w / 2, b1 = w / 2;
  const world = (a, b) => alongX ? [x + a, z + b] : [x + b, z + a];   // (along, across) → world x,z
  const p = [];
  const push = (a, b, y) => { const [wx, wz] = world(a, b); p.push(wx, y, wz); };
  push(a0, b0, h0); push(a0, b1, h0); push(a1, b1, h1); push(a1, b0, h1);   // 0..3 sloped top
  push(a0, b0, 0);  push(a0, b1, 0);  push(a1, b1, 0);  push(a1, b0, 0);    // 4..7 flat base
  const idx = [
    0,1,2, 0,2,3,     // top
    4,6,5, 4,7,6,     // base
    0,4,5, 0,5,1,     // −along end
    3,2,6, 3,6,7,     // +along end
    1,5,6, 1,6,2,     // +across side
    0,3,7, 0,7,4,     // −across side
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = _mat(); mat.side = THREE.DoubleSide;   // DoubleSide so winding never hides a face
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ══ Mesh-collision: import GLB models as the "primitives" (EQ-style) ════════════════════════════
// The whole model is either collision or decoration (a per-placement flag, no per-part tagging). At
// zone load we RAYCAST the collision geometry into a baked (x,z,level) nav-grid — the same shape the
// analytic primitives feed — so floors, walls and LOS all come from one geometry source:
//   • FLOORS  — a downward ray at each grid cell; every UP-FACING hit is a walkable level (a 2-storey
//               building yields [ground, floor1, floor2]). Fed into surfacesAt → pathfinding + grounding.
//   • WALLS   — a horizontal ray between adjacent cells at a floor level; a STEEP (near-vertical) hit
//               is a wall and blocks that edge. Level-keyed, so a 2nd-floor wall never blocks floor 1.
//   • LOS     — collider meshes are pushed into _losBlockers, which hasLineOfSight already raycasts.
// Baked ONCE at load (after the async prop load resolves); runtime cost is a Map lookup, same as before.

const BAKE_TOP        = 300;   // ray starts this high; scans straight down through every storey
const BAKE_SPAN       = 400;   // how far the down-ray travels (TOP → well below ground)
const FLOOR_NORMAL_MIN = 0.5;  // world normal.y ≥ this → an up-facing (walkable) surface; else wall/ceiling
// Wall ray sits ABOVE the max climbable step, so a stair riser / low ledge (≤ SURFACE_STEP) passes
// UNDER the ray and stays climbable, while a true wall (taller than a step) is hit and blocks. This
// height is the sole discriminator between "step up" and "wall" — both are near-vertical faces.
const WALL_EYE        = SURFACE_STEP + 0.2;
const WALL_NORMAL_MAX = 0.5;   // |world normal.y| ≤ this → a near-vertical face → a wall

const _bakeRay   = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir    = new THREE.Vector3();
const _normMat   = new THREE.Matrix3();
const _DOWN      = new THREE.Vector3(0, -1, 0);

// Register a placed collision model. Forces DoubleSide on its materials so the down/horizontal
// raycasts (and the LOS pass) hit every triangle regardless of the model's winding — otherwise a
// wall's near face (a backface) is culled and a unit walks through it. Also feeds _losBlockers, so an
// imported wall/building occludes vision the same way an analytic platform does.
export function registerCollisionMesh(obj) {
  if (!obj) return;
  obj.traverse((n) => {
    if (!n.isMesh) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) if (m) m.side = THREE.DoubleSide;
    // Build a BVH so the per-move floor/wall/clearance raycasts are O(log n), not O(triangles).
    // One-time cost at load; makes detailed (100k+ tri) colliders like the lantern bridge usable.
    if (n.geometry && !n.geometry.boundsTree) {
      try { n.geometry.computeBoundsTree(); } catch (e) { console.warn('[surfaces] BVH build failed:', e); }
    }
  });
  _collisionMeshes.push(obj);
  _losBlockers.push(obj);
}
export function hasCollisionMeshes() { return _collisionMeshes.length > 0; }

// Drop just the collision registrations (NOT the analytic _surfaces), so a re-run of the async prop
// load (HMR live-reload, editor re-sync) starts clean instead of double-registering.
export function clearCollisionMeshes() {
  // Pull the collider meshes back out of _losBlockers, leaving analytic surface meshes in place.
  if (_collisionMeshes.length) _losBlockers = _losBlockers.filter(m => !_collisionMeshes.includes(m));
  for (const o of _collisionMeshes) o.traverse((n) => { if (n.isMesh && n.geometry?.boundsTree) n.geometry.disposeBoundsTree(); });
  _collisionMeshes = [];
  _colliderBoxes = [];
  _floorCache.clear();
  _standCache.clear();
}

// World-space Y of a raycast hit's face normal (hit.face.normal is object-local).
function _worldNormalY(hit) {
  if (!hit.face) return 1;   // geometry without faces — treat as floor, never as wall
  _normMat.getNormalMatrix(hit.object.matrixWorld);
  return _rayDir.copy(hit.face.normal).applyMatrix3(_normMat).normalize().y;
}

// All UP-FACING collision surfaces directly below (x, BAKE_TOP), low→high, deduped. null if none.
function _rayFloorsAt(x, z) {
  _rayOrigin.set(x, BAKE_TOP, z);
  _bakeRay.set(_rayOrigin, _DOWN);
  _bakeRay.far = BAKE_SPAN;
  const hits = _bakeRay.intersectObjects(_collisionMeshes, true);
  if (!hits.length) return null;
  const ys = [];
  for (const h of hits) if (_worldNormalY(h) >= FLOOR_NORMAL_MIN) ys.push(h.point.y);
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  const out = [ys[0]];
  for (let i = 1; i < ys.length; i++) if (ys[i] - out[out.length - 1] > 0.1) out.push(ys[i]);
  return out;
}

// "Bake" is now just: warm the colliders' world matrices and cache their world AABBs. There is NO
// grid — floors and walls are sampled LIVE against the real geometry (below), so a thin/off-grid wall
// blocks at its ACTUAL face (not a 2-WU cell boundary) and stairs climb smoothly. The AABBs are only a
// cheap XZ gate so a query far from every collider skips the raycast. `half` is unused (kept for the
// caller's signature). Keep collision models LOW-POLY — the live raycasts are brute-force (no BVH).
export function bakeCollisionGrid(_opts) {
  _colliderBoxes = [];
  _floorCache.clear();
  _standCache.clear();
  if (!_collisionMeshes.length) return;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  for (const o of _collisionMeshes) {
    o.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(o);
    _colliderBoxes.push(b);
  }
  if (t0) console.log(`[surfaces] collision ready: ${_collisionMeshes.length} model(s), ${Math.round(performance.now() - t0)}ms`);
}

// Cheap XZ gate: is (x,z) within any collider's footprint (+ a small margin)?
function _inColliderXZ(x, z) {
  for (const b of _colliderBoxes) {
    if (x >= b.min.x - WALL_EYE && x <= b.max.x + WALL_EYE &&
        z >= b.min.z - WALL_EYE && z <= b.max.z + WALL_EYE) return true;
  }
  return false;
}

// Live floor levels at world (x,z), or null. Gated by the collider footprint (open ground is a cheap
// reject) and memoised at 0.25-WU resolution so repeated pathfinding/grounding lookups don't re-raycast.
function _meshFloorsAt(x, z) {
  if (!_colliderBoxes.length || !_inColliderXZ(x, z)) return null;
  const key = Math.round(x * 4) + ',' + Math.round(z * 4);
  if (_floorCache.has(key)) return _floorCache.get(key);
  const ys = _rayFloorsAt(x, z);
  _floorCache.set(key, ys);
  return ys;
}

// Can a unit STAND at (x,z) on floor `level`, or is a collider's body in the way? Casts a short ray
// straight UP through the unit's body column (just above the floor to head height); ANY collider hit
// means the spot is inside/against solid geometry — a wall, the underside of a floor or staircase — so
// it's not standable. This is the PRIMARY, gap-proof blocker: it catches the solid wall BODY even
// where the wall's TOP has a crenellation/seam the down-ray slips through, and because a unit can
// never step ONTO such a spot, it can't get wedged inside a wall. A normal-height archway (clearance
// above BODY_H) is NOT blocked, so you can walk under it. Gated on the collider footprint (cheap else).
const BODY_CLEAR_LOW = 0.3;   // start just above the floor (skip the floor face / a tiny lip)
const BODY_CLEAR_TOP = 1.8;   // up to head height
const _UP = new THREE.Vector3(0, 1, 0);

export function bodyBlocksStand(x, z, level) {
  if (!_colliderBoxes.length || !_inColliderXZ(x, z)) return false;
  const key = Math.round(x * 4) + ',' + Math.round(z * 4) + ',' + Math.round(level * 4);
  const cached = _standCache.get(key);
  if (cached !== undefined) return cached;
  _rayOrigin.set(x, level + BODY_CLEAR_LOW, z);
  _bakeRay.set(_rayOrigin, _UP);
  _bakeRay.far = BODY_CLEAR_TOP - BODY_CLEAR_LOW;
  const blocked = _bakeRay.intersectObjects(_collisionMeshes, true).length > 0;
  _standCache.set(key, blocked);
  return blocked;
}

// Does collision geometry stand BETWEEN (x0,z0) and (x1,z1) at body height? A horizontal ray against
// the real faces — WALL_EYE > SURFACE_STEP so a climbable riser passes under it. This is the ANTI-
// TUNNEL check for the 2-WU grid pathfinder, where a single step could otherwise hop clean over a thin
// wall with both endpoints clear; continuous movement is stopped a frame earlier by bodyBlocksStand.
export function wallBlocksStep(x0, z0, x1, z1, level) {
  if (!_colliderBoxes.length) return false;
  if (!_inColliderXZ(x0, z0) && !_inColliderXZ(x1, z1)) return false;
  _rayDir.set(x1 - x0, 0, z1 - z0);
  const len = _rayDir.length();
  if (len < 1e-6) return false;
  _rayDir.normalize();
  _rayOrigin.set(x0, level + WALL_EYE, z0);
  _bakeRay.set(_rayOrigin, _rayDir);
  _bakeRay.far = len;
  for (const h of _bakeRay.intersectObjects(_collisionMeshes, true)) {
    if (Math.abs(_worldNormalY(h)) <= WALL_NORMAL_MAX) return true;
  }
  return false;
}
