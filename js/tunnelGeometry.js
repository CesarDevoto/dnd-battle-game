import * as THREE from 'three';
import { scene } from './scene.js';
import { getTerrainHeight, getTerrainTrenches, getSurroundingHeightExcluding, TUNNEL_CLEARANCE, MIN_TUNNEL_PR } from './terrain.js';
import { barrierSegments, losBlockerMeshes } from './environments.js';

const _wallMat = new THREE.MeshStandardMaterial({ color: 0x1e1e2a, roughness: 0.96, metalness: 0.05, side: THREE.DoubleSide });
const _ceilMat = new THREE.MeshStandardMaterial({ color: 0x1c1c26, roughness: 0.97, metalness: 0.05, side: THREE.DoubleSide });

let _meshes         = [];  // every mesh added to scene, for disposal
let _barrierEntries = [];  // entries pushed into barrierSegments, for precise removal
let _losEntries     = [];  // entries pushed into losBlockerMeshes, for precise removal

// ── Path geometry helpers ──────────────────────────────────────────────────────

function _segNormal(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  return { nx: -dz / len, nz: dx / len };
}

// Per-vertex perpendicular normal — bisector of the two adjacent segment
// normals at interior points (avoids gaps at bends), the adjacent segment's
// own normal at the path's endpoints.
function _vertexNormals(pts) {
  const n = pts.length;
  const segN = [];
  for (let i = 0; i < n - 1; i++) segN.push(_segNormal(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z));
  const out = [];
  for (let i = 0; i < n; i++) {
    let nx, nz;
    if (i === 0) {
      nx = segN[0].nx; nz = segN[0].nz;
    } else if (i === n - 1) {
      nx = segN[n - 2].nx; nz = segN[n - 2].nz;
    } else {
      nx = segN[i - 1].nx + segN[i].nx;
      nz = segN[i - 1].nz + segN[i].nz;
      const len = Math.hypot(nx, nz) || 1;
      nx /= len; nz /= len;
    }
    out.push({ nx, nz });
  }
  return out;
}

// Ribbon strip between two equal-length rails of THREE.Vector3 — railA[i]
// connects to railB[i], and consecutive i's connect across the strip.
function _buildRibbonGeometry(railA, railB) {
  const n = railA.length;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 6 + 0] = railA[i].x; positions[i * 6 + 1] = railA[i].y; positions[i * 6 + 2] = railA[i].z;
    positions[i * 6 + 3] = railB[i].x; positions[i * 6 + 4] = railB[i].y; positions[i * 6 + 5] = railB[i].z;
  }
  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a0 = i * 2, b0 = i * 2 + 1, a1 = (i + 1) * 2, b1 = (i + 1) * 2 + 1;
    indices.push(a0, b0, a1,  b0, b1, a1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// How far apart to sample ceiling/wall height along a tunnel's own length.
// Sampling only at the user's clicked points would miss an obstacle crossed
// partway through a long straight segment — both endpoints are typically
// placed OUTSIDE whatever the tunnel cuts through (so the tunnel fully
// spans it), meaning the wall/rim never gets sampled at all otherwise.
const TUNNEL_SAMPLE_STEP = 2.0;

// Resolves each point's h (falling back to the legacy path-level h) and
// inserts evenly-spaced points along every segment for the reason above.
function _densifyPath(path) {
  const pts = path.points.map(p => ({ x: p.x, z: p.z, h: p.h ?? path.h ?? 0 }));
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(segLen / TUNNEL_SAMPLE_STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: a.h + (b.h - a.h) * t });
    }
  }
  return out;
}

function _pushBarrierRail(rail) {
  for (let i = 0; i < rail.length - 1; i++) {
    const seg = { x1: rail[i].x, z1: rail[i].z, x2: rail[i + 1].x, z2: rail[i + 1].z };
    barrierSegments.push(seg);
    _barrierEntries.push(seg);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function clearTunnelGeometry() {
  for (const m of _meshes) { scene.remove(m); m.geometry.dispose(); }
  _meshes = [];
  for (const seg of _barrierEntries) {
    const idx = barrierSegments.indexOf(seg);
    if (idx >= 0) barrierSegments.splice(idx, 1);
  }
  _barrierEntries = [];
  for (const mesh of _losEntries) {
    const idx = losBlockerMeshes.indexOf(mesh);
    if (idx >= 0) losBlockerMeshes.splice(idx, 1);
  }
  _losEntries = [];
}

export function buildTunnelGeometry(paths) {
  for (const path of paths ?? []) {
    if (!path.tunnel) continue;
    const pr = Math.max(path.pr ?? 0, MIN_TUNNEL_PR);
    if (!path.points || path.points.length < 2) continue;
    const pts = _densifyPath(path);

    const vN = _vertexNormals(pts);
    const floorLeft = [], floorRight = [], ceilLeft = [], ceilRight = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const floorH = getTerrainHeight(p.x, p.z);
      // Ceiling rises to at least cover whatever was actually here before
      // this path carved it (a wall, the rim, a hill) — a flat clearance
      // would leave open sky above anything taller than that.
      const removedH = getSurroundingHeightExcluding(p.x, p.z, path);
      const ceilH  = Math.max(floorH + TUNNEL_CLEARANCE, removedH);
      const { nx, nz } = vN[i];
      floorLeft.push(new THREE.Vector3(p.x + nx * pr, floorH, p.z + nz * pr));
      ceilLeft.push(new THREE.Vector3(p.x + nx * pr, ceilH, p.z + nz * pr));
      floorRight.push(new THREE.Vector3(p.x - nx * pr, floorH, p.z - nz * pr));
      ceilRight.push(new THREE.Vector3(p.x - nx * pr, ceilH, p.z - nz * pr));
    }

    const leftWall  = new THREE.Mesh(_buildRibbonGeometry(floorLeft, ceilLeft),   _wallMat);
    const rightWall = new THREE.Mesh(_buildRibbonGeometry(floorRight, ceilRight), _wallMat);
    const ceiling   = new THREE.Mesh(_buildRibbonGeometry(ceilLeft, ceilRight),   _ceilMat);

    for (const m of [leftWall, rightWall, ceiling]) {
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      _meshes.push(m);
      losBlockerMeshes.push(m);
      _losEntries.push(m);
    }

    _pushBarrierRail(floorLeft);
    _pushBarrierRail(floorRight);
  }
}

export function refreshTunnelGeometry() {
  clearTunnelGeometry();
  buildTunnelGeometry(getTerrainTrenches());
}
