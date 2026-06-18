// js/engagementLines.js — floating lock icon between melee-engaged unit pairs
import * as THREE from 'three';
import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET } from './constants.js';

// Matches atkTriggerWU for a standard 5-foot melee: (5/5)*2 + 2 + 1 = 5 WU
const ENGAGE_WU = (5 / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE + WORLD_UNITS_PER_SQUARE + 1.0;

// ── Lock icon canvas texture ──────────────────────────────────────────────────
let _lockSpriteMat = null;

function _buildLockMat() {
  const cv  = document.createElement('canvas');
  cv.width  = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);

  const col = '#cccccc';
  ctx.strokeStyle = col;
  ctx.fillStyle   = col;
  ctx.lineWidth   = 5;
  ctx.lineCap     = 'round';

  // Shackle arc
  ctx.beginPath();
  ctx.arc(32, 26, 13, Math.PI, 0);
  ctx.stroke();

  // Lock body — filled rounded rectangle
  const bx = 13, by = 33, bw = 38, bh = 25, br = 5;
  ctx.beginPath();
  ctx.moveTo(bx + br, by);
  ctx.lineTo(bx + bw - br, by);
  ctx.arcTo(bx + bw, by,      bx + bw, by + br,      br);
  ctx.lineTo(bx + bw, by + bh - br);
  ctx.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
  ctx.lineTo(bx + br, by + bh);
  ctx.arcTo(bx, by + bh,      bx, by + bh - br,       br);
  ctx.lineTo(bx, by + br);
  ctx.arcTo(bx, by,           bx + br, by,             br);
  ctx.closePath();
  ctx.fill();

  // Keyhole — dark circle + slot
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(32, 43, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(29, 43, 6, 8);

  _lockSpriteMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
}

// ── Object pool ───────────────────────────────────────────────────────────────
const _pool   = [];
const _active = [];

function _acquire() {
  if (_pool.length > 0) {
    const p = _pool.pop();
    p.visible = true;
    return p;
  }
  const icon = new THREE.Sprite(_lockSpriteMat);
  icon.scale.set(0.18, 0.18, 1);
  icon.frustumCulled = false;
  scene.add(icon);
  return icon;
}

// ── Pair checking helper ──────────────────────────────────────────────────────
function _checkPairs(aList, bList, startJ) {
  for (let i = 0; i < aList.length; i++) {
    const a = aList[i];
    const ax = a.grp.position.x, az = a.grp.position.z;
    for (let j = startJ(i); j < bList.length; j++) {
      const b = bList[j];
      const bx = b.grp.position.x, bz = b.grp.position.z;
      const dx = bx - ax, dz = bz - az;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > ENGAGE_WU || dist < 0.01) continue;

      const icon = _acquire();
      _active.push(icon);

      const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
      const my = Math.max(
        getTerrainHeight(ax, az),
        getTerrainHeight(bx, bz),
        getTerrainHeight(mx, mz),
      ) + 0.55;

      icon.position.set(mx, my, mz);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function initEngagementLines() {
  _buildLockMat();
}

export function updateEngagementLines(units) {
  // Return all active icons to the pool
  for (const icon of _active) {
    icon.visible = false;
    _pool.push(icon);
  }
  _active.length = 0;

  const blues = units.filter(u => u.team === 'blue' && u.hp > 0);
  const reds  = units.filter(u => u.team === 'red'  && u.hp > 0);

  // Hero vs enemy pairs
  _checkPairs(blues, reds, () => 0);

  // Hero vs hero pairs (each unordered pair once: j starts at i+1)
  _checkPairs(blues, blues, i => i + 1);
}
