// js/surfaces.js — Phase-1 surface-aware movement (EverQuest-style, non-overlapping multi-level).
//
// A zone with `surfaceMovement: true` and a `surfaces: [...]` list gets WALKABLE platforms/ramps
// sitting on top of the base heightmap terrain. Movement, per-frame grounding and both pathfinders
// sample the TOPMOST walkable surface at a point (surfaceHeightAt) instead of the raw terrain, and
// a step-height rule (stepPassable) makes ramps/stairs passable while cliff & platform edges act as
// walls.
//
// Phase 1 is "stacked but NON-OVERLAPPING": each x,z has at most ONE walkable surface above the
// terrain — you walk ON a platform, never UNDER it — so the existing 2-D grid pathfinder stays
// valid. True over/under (a bridge crossed both ways, a tunnel beneath a floor) is Phase 2 and
// needs (tile, level) path nodes.
//
// Every existing heightmap zone is untouched: with _active=false, surfaceHeightAt is just
// getGroundHeight and stepPassable is always true, so the whole system compiles to a no-op there.

import * as THREE from 'three';
import { getGroundHeight } from './terrain.js';

// Max surface-height delta a unit may traverse between adjacent tiles / consecutive steps. A ramp or
// stair must rise LESS than this per tile to stay walkable; a platform edge (a big rise or drop)
// exceeds it and is treated as a wall. This single number is the whole "ramps yes, cliffs no" rule.
export const SURFACE_STEP = 1.4;

let _active   = false;
let _surfaces = [];   // [{ contains(x,z):bool, heightAt(x,z):number }]

export function setSurfaceMovement(on) { _active = !!on; }
export function isSurfaceMovement()     { return _active; }
export function clearSurfaces()         { _surfaces = []; }

// Topmost walkable surface height at world (x,z): a registered platform/ramp if the point is on one,
// otherwise the base terrain. Inactive zones short-circuit to plain terrain.
export function surfaceHeightAt(x, z) {
  let best = getGroundHeight(x, z);
  if (_active) {
    for (const s of _surfaces) {
      if (s.contains(x, z)) { const h = s.heightAt(x, z); if (h > best) best = h; }
    }
  }
  return best;
}

// Can a unit move between two nearby points? True unless the surface-height delta exceeds
// SURFACE_STEP. Used by both the combat grid BFS and the exploration continuous stepper, so ramps
// are climbable and cliff / platform edges block from every mover.
export function stepPassable(x0, z0, x1, z1) {
  if (!_active) return true;
  return Math.abs(surfaceHeightAt(x1, z1) - surfaceHeightAt(x0, z0)) <= SURFACE_STEP;
}

// ── Build walkable surfaces + their visual meshes from zone data ───────────────
// Each entry in zone.surfaces makes a walkable surface AND a visual mesh (returned for the zone
// loader to add to the scene and clear on teardown). Two kinds:
//   { type:'platform', x, z, w, d, h }                    flat top at height h, w×d footprint
//   { type:'ramp', x, z, w, len, axis:'x'|'z', h0, h1 }   rises h0→h1 along `axis` over `len`
export function buildSurfacesFromZone(list) {
  clearSurfaces();
  const meshes = [];
  for (const def of (list ?? [])) {
    if (def.type === 'ramp') { _surfaces.push(_rampSurface(def));     meshes.push(_rampMesh(def)); }
    else                     { _surfaces.push(_platformSurface(def)); meshes.push(_platformMesh(def)); }
  }
  return meshes;
}

function _platformSurface({ x, z, w, d, h }) {
  const hw = w / 2, hd = d / 2;
  return {
    contains: (px, pz) => Math.abs(px - x) <= hw && Math.abs(pz - z) <= hd,
    heightAt: () => h,
  };
}
function _rampSurface({ x, z, w, len, axis, h0, h1 }) {
  const alongX  = axis === 'x';
  const halfLen = len / 2, halfW = w / 2;
  return {
    contains: (px, pz) => {
      const a = alongX ? (px - x) : (pz - z);   // distance ALONG the ramp
      const b = alongX ? (pz - z) : (px - x);   // distance ACROSS the ramp
      return Math.abs(a) <= halfLen && Math.abs(b) <= halfW;
    },
    heightAt: (px, pz) => {
      const a = alongX ? (px - x) : (pz - z);
      const t = Math.max(0, Math.min(1, (a + halfLen) / len));
      return h0 + (h1 - h0) * t;
    },
  };
}

// Plain proof-of-concept geometry (grey stone). The WALKABLE surface is the analytic one above;
// these meshes are only what you see. Kept simple on purpose — Phase 1 is about the movement math.
const _mat = () => new THREE.MeshStandardMaterial({ color: 0x6b6256, roughness: 0.95, metalness: 0.0 });

function _platformMesh({ x, z, w, d, h }) {
  const H = h + 3;                                   // extend below ground so there's no gap at the lip
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), _mat());
  m.position.set(x, h - H / 2, z);                   // top face sits exactly at y = h
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function _rampMesh({ x, z, w, len, axis, h0, h1 }) {
  const alongX = axis === 'x';
  const thick  = 0.5;
  const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : w, thick, alongX ? w : len), _mat());
  const slope = Math.atan2(h1 - h0, len);
  m.position.set(x, (h0 + h1) / 2, z);
  // Tilt so the visual top face matches the analytic surface: heightAt is h0 at the −axis end and
  // h1 at the +axis end. Rotating about x vs z flips the required sign, hence the mirrored signs.
  if (alongX) m.rotation.z = slope; else m.rotation.x = -slope;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
