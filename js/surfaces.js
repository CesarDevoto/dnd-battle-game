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
import { getGroundHeight } from './terrain.js';

// Max surface-height delta a unit may traverse between adjacent tiles. Ramps/stairs must rise less
// than this per tile to stay walkable; a platform edge or a deck-to-ground drop exceeds it → wall.
export const SURFACE_STEP = 1.4;

let _active   = false;
let _surfaces = [];   // [{ contains(x,z):bool, heightAt(x,z):number, solid:bool }]

export function setSurfaceMovement(on) { _active = !!on; }
export function isSurfaceMovement()     { return _active; }
export function clearSurfaces()         { _surfaces = []; }

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
  if (!levels) return [base];
  if (!solidCover) levels.push(base);
  levels.sort((a, b) => a - b);
  const out = [levels[0]];                                   // dedup near-equal levels
  for (let i = 1; i < levels.length; i++) if (levels[i] - out[out.length - 1] > 0.05) out.push(levels[i]);
  return out;
}

// The walkable level at (x,z) closest to refY — grounding/movement use this so a unit stays on the
// deck it's on (or the ground it's under) instead of snapping to whatever surface is topmost.
export function nearestLevel(x, z, refY) {
  const levels = surfacesAt(x, z);
  let best = levels[0], bd = Math.abs(levels[0] - refY);
  for (let i = 1; i < levels.length; i++) {
    const d = Math.abs(levels[i] - refY);
    if (d < bd) { bd = d; best = levels[i]; }
  }
  return best;
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
  for (const L of surfacesAt(x1, z1)) if (Math.abs(L - from) <= SURFACE_STEP) return true;
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
function _rampMesh({ x, z, w, len, axis, h0, h1 }) {
  const alongX = axis === 'x';
  const thick  = 0.5;
  const m = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : w, thick, alongX ? w : len), _mat());
  const slope = Math.atan2(h1 - h0, len);
  m.position.set(x, (h0 + h1) / 2, z);
  // Tilt so the visual top face matches heightAt (h0 at the −axis end, h1 at the +axis end).
  // Rotating about x vs z flips the required sign, hence the mirrored signs.
  if (alongX) m.rotation.z = slope; else m.rotation.x = -slope;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
