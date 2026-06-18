import { scene } from './scene.js';
import { units } from './units.js';
import { isPrecombat } from './precombat.js';
import { addLog } from './combat.js';
import { isDevMode } from './devMode.js';

// ── State ─────────────────────────────────────────────────────────────────────
// Each entry: { mesh (group containing light + helper), x, z, t }

const _stars = [];
const TRIGGER_RADIUS = 2.0;  // wu — hero proximity that consumes the marker
const PEAK_INTENSITY = 9.0;  // max light intensity at pulse peak

// ── Public API ────────────────────────────────────────────────────────────────

export function trackStar(mesh, x, z) {
  _stars.push({ mesh, x, z, t: Math.random() * Math.PI * 2 });
}

export function untrackStar(mesh) {
  const i = _stars.findIndex(s => s.mesh === mesh);
  if (i >= 0) _stars.splice(i, 1);
}

export function clearAllStars() {
  _stars.length = 0;
}

// ── Per-frame tick ────────────────────────────────────────────────────────────

export function tickStars(dt) {
  const heroes = isPrecombat()
    ? units.filter(u => u.team === 'blue' && u.hp > 0)
    : [];

  const dev = isDevMode();

  for (let i = _stars.length - 1; i >= 0; i--) {
    const s = _stars[i];
    if (!s.mesh.parent) continue;
    s.t += dt;

    const light      = s.mesh.userData.light;
    const helperMesh = s.mesh.userData.helperMesh;

    // Slow breathe: ~3 s cycle, nonlinear so it lingers dim then swells bright
    const raw   = 0.5 + 0.5 * Math.sin(s.t * 2.1);
    const pulse = raw * raw;  // squared → eases in, snappier peaks
    if (light) light.intensity = pulse * PEAK_INTENSITY;

    // Helper sphere only visible in dev mode
    if (helperMesh) helperMesh.visible = dev;

    // Proximity trigger (only during precombat)
    for (const hero of heroes) {
      const dx = hero.grp.position.x - s.x;
      const dz = hero.grp.position.z - s.z;
      if (dx * dx + dz * dz < TRIGGER_RADIUS * TRIGGER_RADIUS) {
        _triggerStar(s, i);
        break;
      }
    }
  }
}

// ── Trigger ───────────────────────────────────────────────────────────────────

function _triggerStar(s, idx) {
  scene.remove(s.mesh);
  _stars.splice(idx, 1);
  addLog('✦ The heroes discover something of interest…', 'round');
  window.dispatchEvent(new CustomEvent('investigate:triggered', {
    detail: { x: s.x, z: s.z },
  }));
}
