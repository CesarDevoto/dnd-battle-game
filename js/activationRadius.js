import { units } from './units.js';
import { WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET } from './constants.js';
import { isDevMode } from './devMode.js';

// 200ft = 80 WU (sleep), 180ft = 72 WU (wake) — hysteresis prevents edge thrashing
const FT_PER_WU = GRID_SQUARE_FEET / WORLD_UNITS_PER_SQUARE; // 2.5 ft per WU
const WAKE_WU   = Math.round(180 / FT_PER_WU); // 72
const SLEEP_WU  = Math.round(200 / FT_PER_WU); // 80
const FADE_STEP = 0.04; // ~25 frames (~0.4s at 60fps) to fully fade

function _applyOpacity(root, opacity) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(mat => {
      if (!mat) return;
      const wantTransparent = opacity < 1;
      if (mat.transparent !== wantTransparent) {
        mat.transparent = wantTransparent;
        mat.needsUpdate = true;
      }
      mat.opacity = opacity;
    });
  });
}

function _minDistToHeroes(wx, wz, heroes) {
  let min = Infinity;
  for (const h of heroes) {
    const dx = h.grp.position.x - wx;
    const dz = h.grp.position.z - wz;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d < min) min = d;
  }
  return min;
}

export function tickActivationRadius(props) {
  // Dev mode: bypass distance culling
  if (isDevMode()) {
    // Props: force all visible — prop editor controls visibility directly
    for (const p of props) {
      if (!p.mesh) continue;
      p._active = true;
      if (!p.mesh.visible) p.mesh.visible = true;
      if (p._opacity !== 1) { _applyOpacity(p.mesh, 1); p._opacity = 1; }
    }
    // Enemies: force all visible and awake
    for (const u of units) {
      if (u.team !== 'red' || u.hp <= 0) continue;
      if (!u.grp.visible) u.grp.visible = true;
      if (u._opacity !== 1) { _applyOpacity(u.grp, 1); u._opacity = 1; }
      u.dormant = false;
    }
    return;
  }

  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  if (!heroes.length) return;

  // ── Props ────────────────────────────────────────────────────────────────
  for (const p of props) {
    if (!p.mesh) continue;
    const dist = _minDistToHeroes(p.mesh.position.x, p.mesh.position.z, heroes);

    // Hysteresis: only change active state at the hard boundaries
    if (dist <= WAKE_WU)       p._active = true;
    else if (dist >= SLEEP_WU) p._active = false;
    // else: stay in current state

    const target = p._active !== false ? 1 : 0;

    // First frame: snap immediately, no fade
    if (p._opacity === undefined) {
      p._opacity = target;
      if (target < 1) p.mesh.visible = false;
      continue;
    }

    const cur = p._opacity;
    if (Math.abs(cur - target) < 0.001) continue; // already at target

    const next = target > cur
      ? Math.min(1, cur + FADE_STEP)
      : Math.max(0, cur - FADE_STEP);
    p._opacity = next;

    if (next < 0.01) {
      p.mesh.visible = false;
    } else {
      if (!p.mesh.visible) p.mesh.visible = true;
      _applyOpacity(p.mesh, next);
    }
    // Snap to fully opaque to clear transparent flag
    if (next >= 0.99 && target === 1) {
      p._opacity = 1;
      _applyOpacity(p.mesh, 1);
    }
  }

  // ── Enemies ──────────────────────────────────────────────────────────────
  for (const u of units) {
    if (u.team !== 'red' || u.hp <= 0) continue;
    const dist = _minDistToHeroes(u.grp.position.x, u.grp.position.z, heroes);

    // Hysteresis — aggro'd enemies never go dormant (they're already in combat)
    if (dist <= WAKE_WU) {
      u.dormant = false;
    } else if (dist >= SLEEP_WU && !u.aggro) {
      u.dormant = true;
    }

    const target = u.dormant ? 0 : 1;

    // First frame: snap immediately
    if (u._opacity === undefined) {
      u._opacity = target;
      if (target < 1) u.grp.visible = false;
      continue;
    }

    const cur = u._opacity;
    if (Math.abs(cur - target) < 0.001) continue;

    const next = target > cur
      ? Math.min(1, cur + FADE_STEP)
      : Math.max(0, cur - FADE_STEP);
    u._opacity = next;

    if (next < 0.01) {
      u.grp.visible = false;
    } else {
      if (!u.grp.visible) u.grp.visible = true;
      _applyOpacity(u.grp, next);
    }
    if (next >= 0.99 && target === 1) {
      u._opacity = 1;
      _applyOpacity(u.grp, 1);
    }
  }
}
