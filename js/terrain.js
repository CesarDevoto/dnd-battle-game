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

function _rimHeight(wx, wz) {
  const rimInner = _gs * 0.5 * 0.833;
  const rimRange = _gs * 0.5 - rimInner;
  const dx   = Math.max(0, Math.abs(wx) - rimInner);
  const dz   = Math.max(0, Math.abs(wz) - rimInner);
  const dist = Math.sqrt(dx * dx + dz * dz);   // Euclidean → round corners
  const t    = Math.min(1, dist / rimRange);
  const ease = t * t;                           // quadratic: very gradual at base
  return ease * rimRange * _RIM_SLOPE;
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

// ── Public API ────────────────────────────────────────────────────────────────

// Returns positive (hill) or negative (valley) height relative to base level.
export function getTerrainHeight(wx, wz) {
  if (_tunnelMode) return _tunnelHeight(wx, wz);
  const raw    = rawNoise(wx, wz);
  const sharp  = Math.sign(raw) * Math.pow(Math.abs(raw), sharpExp);
  const noiseH = sharp * edgeFade(wx, wz) * scale * biomeAmplitudeScale;
  return Math.max(noiseH, _rimHeight(wx, wz)) + _controlPointHeight(wx, wz);
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
