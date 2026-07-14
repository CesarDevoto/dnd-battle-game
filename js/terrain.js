import * as THREE from 'three';
import { GROUND_SIZE } from './constants.js';

let _gs = GROUND_SIZE;  // active ground size — can differ per zone
export function setActiveGroundSize(s) { _gs = s; }

const R = (a, b) => a + Math.random() * (b - a);

// ── Tunnel terrain mode ───────────────────────────────────────────────────────
// When active, replaces sine-wave noise with a path-distance cave system.

let _tunnelMode  = false;
let _tunnelPaths = [];   // [{points:[{x,z},...], hw:number}, ...]

const T_FLOOR_Y  = -0.8;   // floor is just below the grid (grid sits at y=0.01)
const T_WALL_H   = 14.0;   // cave wall top height WU (≈7 grid squares above base)
const T_RISE_WU  = 1.5;    // width of wall rise in WU — near-vertical at mesh resolution

// Perpendicular distance from point (px,pz) to segment (a→b)
function _distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function _tunnelHeight(wx, wz) {
  let minExcess = Infinity;
  for (const path of _tunnelPaths) {
    const pts = path.points, hw = path.hw;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = _distSeg(wx, wz, pts[i].x, pts[i].z, pts[i+1].x, pts[i+1].z);
      const excess = d - hw;
      if (excess <= 0) return T_FLOOR_Y;     // inside path floor — stop immediately
      if (excess < minExcess) minExcess = excess;
    }
  }
  // Linear rise over T_RISE_WU → near-vertical cave wall
  return T_FLOOR_Y + Math.min(1, minExcess / T_RISE_WU) * (T_WALL_H - T_FLOOR_Y);
}

// Random-walk path generator — any direction, bounded within the arena
function _growPath(sx, sz, numSteps, initAngle) {
  const STEP  = 5.5;   // WU between waypoints
  const BOUND = 27;    // half-arena bound (inside playfield ±32)
  const pts   = [{ x: sx, z: sz }];
  let ang     = initAngle;
  for (let i = 0; i < numSteps; i++) {
    const last = pts[pts.length - 1];
    ang += (Math.random() - 0.5) * 1.6;   // up to ±92° turn — truly any direction
    let nx = last.x + Math.sin(ang) * STEP;
    let nz = last.z + Math.cos(ang) * STEP;
    if (Math.abs(nx) > BOUND || Math.abs(nz) > BOUND) {
      // Bounce toward centre and retry
      ang = Math.atan2(-last.x, -last.z) + (Math.random() - 0.5) * 0.8;
      nx  = last.x + Math.sin(ang) * STEP;
      nz  = last.z + Math.cos(ang) * STEP;
    }
    if (Math.abs(nx) <= BOUND && Math.abs(nz) <= BOUND)
      pts.push({ x: nx, z: nz });
  }
  return pts;
}

export function buildTunnelPaths() {
  _tunnelPaths = [];
  // Random half-width: 3–6 WU (= 3–6 grid squares from centre to edge, so 6–12 total)
  const hw = () => 3 + Math.random() * 3;

  // Main path: starts in the hero zone (south, z ≈ 18–26), wanders freely
  const mainAngle = (Math.random() - 0.5) * Math.PI * 0.5 - Math.PI / 2;
  const mainPts   = _growPath(R(-12, 12), R(18, 26), 22, mainAngle);
  _tunnelPaths.push({ points: mainPts, hw: hw() });

  // 2–4 branch paths, each sprouting from a random point on the main path
  const nBranch = 2 + Math.floor(Math.random() * 3);
  for (let b = 0; b < nBranch; b++) {
    const si   = 2 + Math.floor(Math.random() * Math.max(1, mainPts.length - 4));
    const from = mainPts[Math.min(si, mainPts.length - 1)];
    _tunnelPaths.push({
      points: _growPath(from.x, from.z, 14, Math.random() * Math.PI * 2),
      hw: hw(),
    });
  }
}

export function setTunnelMode(active) { _tunnelMode = active; }

// Authored tunnel paths (deterministic) — used by zones that define their own
// carved layout instead of the random buildTunnelPaths() generator.
// Each path: { points:[{x,z},...], hw:number }.
export function setTunnelPaths(paths) { _tunnelPaths = paths ?? []; }

// Returns true if (wx, wz) lies within any path's floor zone
export function isOnTunnelFloor(wx, wz) {
  if (!_tunnelMode) return true;
  for (const path of _tunnelPaths) {
    const pts = path.points, hw = path.hw;
    for (let i = 0; i < pts.length - 1; i++) {
      if (_distSeg(wx, wz, pts[i].x, pts[i].z, pts[i+1].x, pts[i+1].z) <= hw)
        return true;
    }
  }
  return false;
}

// ── Randomizable state ────────────────────────────────────────────────────────

// 6 octaves × 2 (x-phase, z-phase) = 12 phase values
let ph = [0.71,0.43, 1.33,1.08, 0.55,0.91, 2.01,1.73, 0.38,1.62, 1.05,0.28];

// Independent x/z frequencies per octave — randomized so terrain can be
// directional (ridge-like) or isotropic depending on the roll
let fx = [1.6,  3.2,  5.5,  9.0, 15.5, 26.0];
let fz = [1.3,  2.6,  4.8,  7.8, 13.5, 23.0];

// Amplitudes — low-freq octaves dominate for broad rolling hills; high-freq
// octaves trimmed so fine bumpiness is reduced without losing large features
const AMP  = [1.40, 0.80, 0.48, 0.26, 0.14, 0.06];
const ATOT = AMP.reduce((a, b) => a + b, 0);

// Power-curve sharpening: < 1 pushes values toward ±1 (sharper cliffs/valleys)
// 1.0 = unchanged, 0.4 = very aggressive
let sharpExp = 0.7;

// Overall height scale (units range ±scale before edge fade)
let scale = 4.5;

// Per-biome amplitude multiplier — set by environments.js before rebuildTerrain()
let biomeAmplitudeScale = 1.0;
export function setTerrainAmplitudeScale(v) { biomeAmplitudeScale = v; }

// Per-biome profile — controls scale height range and slope smoothness.
// sharpExp > 1.0 compresses noise toward 0 → rounded, gradual slopes.
// sharpExp < 1.0 pushes noise toward ±1 → sharper cliffs and valleys.
let _scaleMin = 3.0, _scaleMax = 6.5;
let _sharpMin = 0.65, _sharpMax = 1.05;

export function setTerrainProfile({ scaleMin, scaleMax, sharpMin, sharpMax }) {
  _scaleMin = scaleMin;
  _scaleMax = scaleMax;
  _sharpMin = sharpMin;
  _sharpMax = sharpMax;
}

let _pendingSeed = null;

export function getTerrainSeed() {
  return { ph: Array.from(ph), fx: Array.from(fx), fz: Array.from(fz), sharpExp, scale };
}

export function setTerrainSeed(seed) {
  _pendingSeed = seed;
}

export function randomizeTerrain() {
  if (_pendingSeed) {
    ph       = Array.from(_pendingSeed.ph);
    fx       = Array.from(_pendingSeed.fx);
    fz       = Array.from(_pendingSeed.fz);
    sharpExp = _pendingSeed.sharpExp;
    scale    = _pendingSeed.scale;
    _pendingSeed = null;
    return;
  }
  ph = Array.from({ length: 12 }, () => Math.random() * Math.PI * 2);

  const baseX = 0.8 + Math.random() * 0.9;
  const baseZ = 0.7 + Math.random() * 0.9;
  fx = AMP.map((_, i) => baseX * Math.pow(2.1 + Math.random() * 0.6, i));
  fz = AMP.map((_, i) => baseZ * Math.pow(2.1 + Math.random() * 0.6, i));

  sharpExp = _sharpMin + Math.random() * (_sharpMax - _sharpMin);
  scale    = _scaleMin + Math.random() * (_scaleMax - _scaleMin);
}

// ── Noise ─────────────────────────────────────────────────────────────────────

function rawNoise(x, z) {
  const nx = x / 80, nz = z / 80;
  let s = 0;
  for (let i = 0; i < 6; i++) {
    s += AMP[i] * Math.sin(nx * fx[i] + ph[i * 2]) * Math.cos(nz * fz[i] + ph[i * 2 + 1]);
  }
  return s / ATOT;  // [-1, 1]
}

// ── Edge fade ─────────────────────────────────────────────────────────────────

function edgeFade(x, z) {
  const half = _gs * 0.5;
  const ex = Math.max(0, (Math.abs(x) - half * 0.82) / (half * 0.18));
  const ez = Math.max(0, (Math.abs(z) - half * 0.82) / (half * 0.18));
  const b  = Math.min(1, Math.max(ex, ez));
  return 1 - b * b * (3 - 2 * b);   // smoothstep
}

// ── Bowl rim ──────────────────────────────────────────────────────────────────
// Linear 45° rise starting at 83.3% of half-size from centre toward each edge.
// Chebyshev (box) distance gives clean flat ramps on all 4 sides; corners
// blend naturally.
const _RIM_SLOPE = 3.0;   // peak height multiplier (fixed)

// Gate notches: each {x, z, halfWidth} suppresses the rim in a corridor along
// the ray from zone-centre through (x,z). halfWidth is in world units.
// 20 ft opening = 4 WU total = halfWidth 2 WU.
let _gateNotches = [];
export function setGateNotches(notches) { _gateNotches = notches ?? []; }

function _gateSuppress(wx, wz) {
  if (!_gateNotches.length) return 1.0;
  let minSuppress = 1.0;
  for (const gate of _gateNotches) {
    const gLen = Math.sqrt(gate.x * gate.x + gate.z * gate.z);
    if (gLen < 0.001) continue;
    const dirX = gate.x / gLen;
    const dirZ = gate.z / gLen;
    // HALF-line, not line: only suppress on the gate's own side of the zone centre.
    // The perpendicular test below is symmetric about the origin, so without this the
    // notch was MIRRORED THROUGH THE CENTRE and cut a second, identical opening in the
    // opposite wall. Warrens' Bleakmire gate at (183,183) was quietly flattening the
    // entire (-,-) corner — a 28 WU wall down to 0, all the way out to the map edge —
    // and the same phantom hole existed in every other zone that has a gate.
    if (wx * dirX + wz * dirZ <= 0) continue;
    // Unit perpendicular to the ray from centre → gate
    const perpX = -dirZ;
    const perpZ =  dirX;
    const perp  = Math.abs(wx * perpX + wz * perpZ);
    const t = Math.min(1, perp / gate.halfWidth);
    const s = t * t * (3 - 2 * t);   // smoothstep: 0 at centre, 1 at edge
    if (s < minSuppress) minSuppress = s;
  }
  return minSuppress;
}

function _rimHeight(wx, wz) {
  const rimInner = _gs * 0.5 * 0.833;
  const rimRange = _gs * 0.5 - rimInner;
  const dx   = Math.max(0, Math.abs(wx) - rimInner);
  const dz   = Math.max(0, Math.abs(wz) - rimInner);
  const dist = Math.sqrt(dx * dx + dz * dz);   // Euclidean → round corners
  const t    = Math.min(1, dist / rimRange);
  const ease = t * t;                           // quadratic: very gradual at base
  return ease * rimRange * _RIM_SLOPE * _gateSuppress(wx, wz);
}

// ── Terrain control points ────────────────────────────────────────────────────
// Each point: { x, z, h, r }  — smoothstep falloff over radius r, height h.

let _controlPoints = [];

export function setTerrainControlPoints(pts) { _controlPoints = pts ?? []; }
export function getTerrainControlPoints()    { return _controlPoints; }

function _controlPointHeight(wx, wz) {
  let best = 0;
  for (const cp of _controlPoints) {
    const dist = Math.sqrt((wx - cp.x) ** 2 + (wz - cp.z) ** 2);
    if (dist >= cp.r) continue;
    const pr = cp.pr ?? 0;
    let contrib;
    if (dist <= pr) {
      contrib = cp.h;
    } else {
      const band = cp.r - pr;
      const t = band > 0 ? 1 - (dist - pr) / band : 0;
      contrib = cp.h * t * t * (3 - 2 * t);   // smoothstep over outer band only
    }
    if (Math.abs(contrib) > Math.abs(best)) best = contrib;
  }
  return best;
}

// ── Trench control paths — editor-drawn polylines that carve a continuous
// canyon into the heightfield ─────────────────────────────────────────────────
// Each path: { points: [{x,z,h},...], r, pr? } — same r/pr semantics as a
// single control point (shared for the whole path), but each point carries
// its own h, so a trench can rise or fall from one end to the other. Height
// at any world position is interpolated along whichever segment is nearest
// (via distSegT below) instead of using one constant depth for the whole
// polyline. Legacy paths saved with a path-level h (no per-point h) still
// work — see the `pt.h ?? path.h ?? 0` fallback below.

let _trenchPaths = [];

export function setTerrainTrenches(paths) { _trenchPaths = paths ?? []; }
export function getTerrainTrenches()      { return _trenchPaths; }

// Wall rise is a fixed WU band near-vertical at mesh resolution — same
// treatment as tunnel mode's T_RISE_WU above — rather than spreading the
// smoothstep across the whole r-pr band. This is what makes a trench read as
// a tunnel with a flat floor and steep sides instead of a wide shallow dish;
// r still bounds how far the falloff is even considered (early-out below).
const TRENCH_RISE_WU = 1.5;

// Like _distSeg but also returns the clamped projection parameter t (0 at a,
// 1 at b), so the caller can lerp a per-endpoint value (here: height) across
// the segment instead of just measuring distance.
function distSegT(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return { dist: Math.hypot(px - ax, pz - az), t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return { dist: Math.hypot(px - (ax + t * dx), pz - (az + t * dz)), t };
}

// `surroundingH` is the terrain height that would apply here with no trench
// at all (noise/rim base + control points) — a trench's `h` is an ABSOLUTE
// floor height that overrides that surrounding terrain within its plateau
// (pr) and blends back into it across the near-vertical rise, rather than
// being added on top of it. Additive would mean carving "through" a tall
// rim/wall never reaches a walkable floor — the wall's own height simply
// dominates the sum. Returns null when no path affects this point at all.
// Nearest-segment distance + interpolated floor height for one path, or
// null if the path doesn't reach this point at all.
function _nearestOnPath(wx, wz, path) {
  const pts = path.points;
  if (!pts || pts.length < 2) return null;
  let dist = Infinity, segH = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const { dist: d, t } = distSegT(wx, wz, a.x, a.z, b.x, b.z);
    if (d < dist) {
      dist = d;
      const ha = a.h ?? path.h ?? 0, hb = b.h ?? path.h ?? 0;
      segH = ha + (hb - ha) * t;
    }
  }
  if (dist >= path.r) return null;
  return { dist, segH, pr: path.pr ?? 0 };
}

function _trenchHeight(wx, wz, surroundingH, excluded) {
  // Pick the dominant path at this point: closest centerline wins; ties prefer
  // the narrower (smaller r) path, since that's the more locally-specific one.
  const EPS = 1e-6;
  let winner = null, bestDist = Infinity, bestR = Infinity;
  for (const path of _trenchPaths) {
    if (excluded && excluded.has(path)) continue;
    const hit = _nearestOnPath(wx, wz, path);
    if (!hit) continue;
    const better = !winner
      || hit.dist < bestDist - EPS
      || (Math.abs(hit.dist - bestDist) <= EPS && path.r < bestR);
    if (better) { winner = { path, ...hit }; bestDist = hit.dist; bestR = path.r; }
  }
  if (!winner) return null;

  if (winner.dist <= winner.pr) return winner.segH;

  // In the falloff band, blend toward whatever terrain is actually here
  // WITHOUT this path — which may be another trench/wall, not just the raw
  // noise/rim/control-point base — so a trench's rising wall meets the real
  // surrounding rock instead of fading toward unrelated ambient terrain.
  const band = Math.min(TRENCH_RISE_WU, winner.path.r - winner.pr);
  const t = band > 0 ? Math.max(0, 1 - (winner.dist - winner.pr) / band) : 0;
  const eased = t * t * (3 - 2 * t);
  // Exclude this path AND every already-excluded one so overlapping trench
  // falloff bands can't ping-pong forever — recursion is bounded by path count.
  const nextExcluded = new Set(excluded);
  nextExcluded.add(winner.path);
  const without = _trenchHeight(wx, wz, surroundingH, nextExcluded);
  const blendTarget = without !== null ? without : surroundingH;
  return winner.segH * eased + blendTarget * (1 - eased);
}

// ── Public API ────────────────────────────────────────────────────────────────

// "Solid rock" height — noise + rim + control points, WITHOUT trench carving.
// This is the surface of the uncarved landform (e.g. the top of a hill); the
// cave ceiling uses it as the underside of the rock above a carved tunnel.
export function getUncarvedHeight(wx, wz) {
  if (_tunnelMode) return _tunnelHeight(wx, wz);
  const raw    = rawNoise(wx, wz);
  const sharp  = Math.sign(raw) * Math.pow(Math.abs(raw), sharpExp);
  const noiseH = sharp * edgeFade(wx, wz) * scale * biomeAmplitudeScale;
  const base   = Math.max(noiseH, _rimHeight(wx, wz));
  return base + _controlPointHeight(wx, wz);
}

// Returns positive (hill) or negative (valley) height relative to base level.
export function getTerrainHeight(wx, wz) {
  if (_tunnelMode) return _tunnelHeight(wx, wz);
  const surrounding = getUncarvedHeight(wx, wz);
  const trH = _trenchHeight(wx, wz, surrounding);
  return trH !== null ? trH : surrounding;
}

// ── Biome vertex colours ──────────────────────────────────────────────────────
// Each biome defines:
//   slope — RGB [0-1] multiplied onto steep faces (rock / cliff / mud)
//   low   — RGB [0-1] blended into low-lying areas (valley / shadow tint)
// Flat surfaces keep vertex colour = white so the canvas ground texture
// shows through unchanged.  Steep or low areas darken/tint the texture.

const BIOME_VERT = {
  forest:    { slope: [0.38, 0.26, 0.14], low: [0.62, 0.80, 0.52] },
  desert:    { slope: [0.55, 0.42, 0.22], low: [0.78, 0.70, 0.46] },
  swamp:     { slope: [0.28, 0.22, 0.16], low: [0.38, 0.52, 0.32] },
  tundra:    { slope: [0.50, 0.52, 0.60], low: [0.72, 0.84, 1.00] },
  savanna:   { slope: [0.46, 0.32, 0.14], low: [0.80, 0.74, 0.48] },
  graveyard: { slope: [0.28, 0.24, 0.18], low: [0.48, 0.56, 0.40] },
  dungeon:   { slope: [0.18, 0.18, 0.18], low: [0.28, 0.28, 0.28] },
};


function _smoothstep(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

export function colorTerrainVertices(geo, biome) {
  const cfg  = BIOME_VERT[biome] ?? BIOME_VERT.forest;
  const pos  = geo.attributes.position;
  const norm = geo.attributes.normal;
  const n    = pos.count;

  // Height range for normalising the valley blend
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const h = pos.getZ(i);
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  const hRange = Math.max(0.1, hMax - hMin);

  const buf = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const h   = pos.getZ(i);
    const nz  = Math.abs(norm.getZ(i));

    // ts: 1 on flat ground, 0 on steep slopes
    const ts = _smoothstep(0.52, 0.90, nz);

    // tl: 1 in the lowest valleys, 0 at mid/high elevation
    const normH = (h - hMin) / hRange;
    const tl    = 1 - _smoothstep(0, 0.22, normH);

    // Start from white (flat areas show material colour unmodified)
    let r = 1.0, g = 1.0, b = 1.0;

    // Blend toward slope rock/dirt colour on steep faces
    r = r * ts + cfg.slope[0] * (1 - ts);
    g = g * ts + cfg.slope[1] * (1 - ts);
    b = b * ts + cfg.slope[2] * (1 - ts);

    // Blend toward valley/low colour in depressions (capped at 50% influence)
    const ll = tl * 0.50;
    r = r * (1 - ll) + cfg.low[0] * ll;
    g = g * (1 - ll) + cfg.low[1] * ll;
    b = b * (1 - ll) + cfg.low[2] * ll;

    buf[i * 3]     = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf, 3));
}

// ── Geometry builder ──────────────────────────────────────────────────────────

function buildGeo(biome) {
  const SEGS = 128;
  const geo  = new THREE.PlaneGeometry(_gs, _gs, SEGS, SEGS);

  // PlaneGeometry starts in the XY plane; after rotation.x = -π/2:
  //   geom X → world X,  geom Y → world -Z,  geom Z → world Y (up)
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, getTerrainHeight(pos.getX(i), -pos.getY(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  if (biome) colorTerrainVertices(geo, biome);
  return geo;
}

export function buildTerrainMesh(material) {
  const mesh = new THREE.Mesh(buildGeo(), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

// Randomize + rebuild in place — called on every biome selection.
// biome parameter drives vertex colour generation.
let _lastBiome = null;
export function rebuildTerrain(mesh, biome) {
  _lastBiome = biome;
  if (!_tunnelMode) randomizeTerrain();
  mesh.geometry.dispose();
  mesh.geometry = buildGeo(biome);
}

// Rebuild geometry WITHOUT re-randomizing noise — used by terrain editor so
// control-point adjustments don't also reseed the landscape.
export function rebuildTerrainGeometry(mesh) {
  mesh.geometry.dispose();
  mesh.geometry = buildGeo(_lastBiome);
}

// ── Cave ceiling (intact-mound "blanket") ───────────────────────────────────────
// The ceiling is a full copy of the ORIGINAL uncarved landform (getUncarvedHeight —
// the mound as if it were never dug into), draped over the entire zone. It is built
// exactly like the ground — same PlaneGeometry grid, UVs, normals, vertex colours —
// and SHARES the ground material, so it renders pixel-identical to the terrain.
// Because it's the whole original surface (not a strip clipped to the void), there
// is no cut edge anywhere and therefore no seam: the mound simply looks intact and
// the carved tunnel is hidden beneath it. A small lift keeps it cleanly above the
// carved ground (over untouched areas the two coincide). The entrance is punched
// later by removing triangles where the mouth should be.

const CEIL_LIFT = 0.25;   // WU: real gap between blanket and ground so they never z-fight
                          // (surface grounding adds the same lift — see getGroundHeight)

// ── Cave entrances (mouths punched into the blanket) ────────────────────────────
// Each entrance: { x, z, r, seed }. The mouth is an organic (non-circular) blob —
// its boundary radius wobbles with angle via a few sine octaves keyed off `seed`,
// so every mouth is a unique natural shape. Punching over the tunnel reveals the
// cave (floor at the mouth's base); punching over solid hill just exposes the
// ground ~CEIL_LIFT below (invisible), so placement is forgiving.
let _caveEntrances = [];
export function setCaveEntrances(list) { _caveEntrances = list ?? []; }
export function getCaveEntrances()      { return _caveEntrances; }

// Organic boundary radius of an entrance at angle `a` (radians). Continuous at
// a=0/2π since every term is periodic in a. Several octaves — including some
// high-frequency ones — give a finely jagged, natural edge rather than a smooth
// blob (the fine octaves only read once the blanket mesh is dense enough).
export function caveEntranceRadiusAt(ent, a) {
  const s = ent.seed ?? 0;
  const wobble = 1
    + 0.30 * Math.sin(3  * a + s)
    + 0.16 * Math.sin(7  * a + 2.3 * s)
    + 0.09 * Math.sin(11 * a + 4.1 * s)
    + 0.055 * Math.sin(17 * a + 5.7 * s)
    + 0.035 * Math.sin(23 * a + 7.9 * s)
    + 0.022 * Math.sin(31 * a + 9.3 * s);
  return ent.r * wobble;
}

function _insideEntrance(x, z) {
  for (const ent of _caveEntrances) {
    const dx = x - ent.x, dz = z - ent.z;
    const d  = Math.hypot(dx, dz);
    if (d > ent.r * 1.7) continue;                 // quick reject (max wobble ≈ 1.66×)
    if (d < caveEntranceRadiusAt(ent, Math.atan2(dz, dx))) return true;
  }
  return false;
}

// ── Cave layer grounding (over-the-hill vs in-the-tunnel) ───────────────────────
// A heightmap has one height per (x,z), but over a tunnel there are two walkable
// surfaces: the hill top (uncarved) and the tunnel floor (carved). Each unit
// carries a `caveLayer` ('surface' | 'under'); we ground it to the matching
// surface. Only active in cave zones (setCaveLayersActive), so every other zone
// grounds to getTerrainHeight exactly as before — including trench canyons that
// are meant to be walked *in*, not over.
let _layersActive = false;
export function setCaveLayersActive(on) { _layersActive = on; }
export function caveLayersActive() { return _layersActive; }

const LAYER_MERGE_EPS = 0.6;   // WU: below this the two surfaces are "the same" (mouth / open ground)

// Height a unit on `layer` should stand at. Surface units stand on the blanket,
// which is lifted CEIL_LIFT above the ground, so add the same lift here — that
// keeps a real gap between blanket and ground (kills z-fighting) without units
// looking sunk into the roof.
export function getGroundHeight(x, z, layer) {
  if (!_layersActive) return getTerrainHeight(x, z);
  return layer === 'under' ? getTerrainHeight(x, z) : getUncarvedHeight(x, z) + CEIL_LIFT;
}

// March a camera ray to the point where it first crosses the walkable surface for
// `layer` (the blanket for 'surface', the floor for 'under'). Used for click-to-move
// so the target XZ matches the surface the hero stands on — a plain ground raycast
// hits the carved terrain UNDER the blanket at a shifted XZ (angled ray) and makes
// heroes move erratically. Cheap: a coarse march + binary refine over getGroundHeight.
export function raySurfacePoint(ray, layer) {
  const O = ray.origin, D = ray.direction;
  if (D.y > -1e-4) return null;                     // not aimed downward
  const STEP = 1.2, MAX_T = 700;
  let prevT = 0;
  let prevAbove = (O.y - getGroundHeight(O.x, O.z, layer)) > 0;
  for (let t = STEP; t <= MAX_T; t += STEP) {
    const above = (O.y + D.y * t - getGroundHeight(O.x + D.x * t, O.z + D.z * t, layer)) > 0;
    if (!above && prevAbove) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) * 0.5;
        if ((O.y + D.y * m - getGroundHeight(O.x + D.x * m, O.z + D.z * m, layer)) > 0) lo = m; else hi = m;
      }
      const f = (lo + hi) * 0.5;
      return new THREE.Vector3(O.x + D.x * f, O.y + D.y * f, O.z + D.z * f);
    }
    prevAbove = above; prevT = t;
  }
  return null;
}

// Layer a freshly-spawned unit belongs on: on the tunnel floor if there's rock
// overhead here, otherwise on the surface.
export function initialCaveLayer(x, z) {
  if (!_layersActive) return 'surface';
  return (getUncarvedHeight(x, z) - getTerrainHeight(x, z)) > LAYER_MERGE_EPS ? 'under' : 'surface';
}

// Whether a barrier at (mx,mz) should block a unit on `layer`. Non-cave zones (or an
// unknown layer) block everyone. In a cave zone it hinges on whether there is rock
// OVERHEAD at that spot:
//
//   headroom > EPS  → two walkable surfaces exist here, and the barrier is a TUNNEL
//                     wall: it blocks units down in the tunnel, and must not stop a
//                     hero walking over the hill above it.
//   headroom ≤ EPS  → the two surfaces are merged; there is only ONE floor here, so
//                     the barrier blocks EVERYONE standing on it.
//
// That second case used to read `barrierLayer === 'surface'`, i.e. an open-ground
// barrier only blocked 'surface' units — which meant it silently stopped existing for
// a unit carrying layer 'under'. resolveCaveLayer() pins a unit to 'under' for as long
// as it is inside an entrance region, INCLUDING while it stands on open ground by the
// mouth, so heroes walked clean through open-ground barriers near every cave mouth and
// were then stranded on the far side once their layer flipped back. There is no second
// surface to walk on at a merged point, so there is nothing for a barrier to be
// "the wrong layer" for.
export function barrierBlocksLayer(mx, mz, layer) {
  if (!_layersActive || layer == null) return true;
  const headroom = getUncarvedHeight(mx, mz) - getTerrainHeight(mx, mz);
  if (headroom <= LAYER_MERGE_EPS) return true;   // merged — one floor, blocks all
  return layer === 'under';                       // tunnel wall — blocks who's inside
}

// Per-frame transition. A surface unit drops under only by stepping into a punched
// mouth; an under unit returns to the surface only once it's clear of the mouth AND
// back where the two surfaces meet (the open-air lip), so it can't pop up mid-hill.
export function resolveCaveLayer(current, x, z) {
  if (!_layersActive) return 'surface';
  if (current === 'under') {
    if (!_insideEntrance(x, z) && (getUncarvedHeight(x, z) - getTerrainHeight(x, z)) < LAYER_MERGE_EPS)
      return 'surface';
    return 'under';
  }
  return _insideEntrance(x, z) ? 'under' : 'surface';
}

// Denser than the ground (128) so punched cave-mouth edges are fine-grained, not
// boxy. UVs stay 0..1 across the plane regardless of resolution and the material
// textures triplanar from world position, so it still matches the terrain exactly.
const CEIL_SEGS = 512;

function buildCeilGeo(biome) {
  const SEGS = CEIL_SEGS;
  const geo  = new THREE.PlaneGeometry(_gs, _gs, SEGS, SEGS);
  const pos  = geo.attributes.position;
  const roof = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = -pos.getY(i);
    const unc = getUncarvedHeight(x, z);
    pos.setZ(i, unc + CEIL_LIFT);
    // How much real roof (rock overhead) is here: 0 on open ground, 1 under the
    // tunnel. The reveal fades only where this is > 0, so it never exposes the
    // CEIL_LIFT gap over flat ground near the mouth (that looked like a blurry step).
    roof[i] = _smoothstep(0.6, 2.5, unc - getTerrainHeight(x, z));
  }
  pos.needsUpdate = true;
  geo.setAttribute('aRoof', new THREE.Float32BufferAttribute(roof, 1));
  geo.computeVertexNormals();
  if (biome) colorTerrainVertices(geo, biome);

  // Punch the mouths: drop any triangle whose centroid falls inside an entrance.
  if (_caveEntrances.length) {
    const src  = geo.index.array;
    const keep = [];
    for (let t = 0; t < src.length; t += 3) {
      const a = src[t], b = src[t + 1], c = src[t + 2];
      const cx =  (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cz = -(pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      if (!_insideEntrance(cx, cz)) keep.push(a, b, c);
    }
    geo.setIndex(keep);
  }
  return geo;
}

// Build the cave roof. Share the ground material (set to DoubleSide) so texture,
// splatmap and biome tint match the terrain exactly. Rotated like the ground.
export function buildCeilingMesh(material) {
  const mesh = new THREE.Mesh(buildCeilGeo(_lastBiome), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  return mesh;
}

export function rebuildCeiling(mesh, biome) {
  mesh.geometry.dispose();
  mesh.geometry = buildCeilGeo(biome ?? _lastBiome);
}
