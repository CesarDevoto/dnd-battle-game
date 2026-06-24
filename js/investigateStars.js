import { scene } from './scene.js';
import { units } from './units.js';
import { isPrecombat } from './precombat.js';
import { addLog } from './combat.js';
import { isDevMode } from './devMode.js';
import { registerPostCombatHandler } from './postCombat.js';

// ── State ─────────────────────────────────────────────────────────────────────

const _stars   = [];
const _pending = [];   // stars triggered during combat; fire post-combat
const TRIGGER_RADIUS = 2.0;

// ── Public API ────────────────────────────────────────────────────────────────

export function trackStar(mesh, x, z) {
  _stars.push({ mesh, x, z, t: Math.random() * Math.PI * 2 });
}

export function untrackStar(mesh) {
  const i = _stars.findIndex(s => s.mesh === mesh);
  if (i >= 0) _stars.splice(i, 1);
}

export function clearAllStars() {
  _stars.length   = 0;
  _pending.length = 0;
}

// ── Post-combat deferred trigger ──────────────────────────────────────────────
// If a hero was already inside a star's radius when combat started, the trigger
// fires here — same visual/narrative moment, just delayed until after combat.

registerPostCombatHandler(3, (ctx, done) => {
  if (!_pending.length) { done(); return; }
  const p = _pending.shift();
  scene.remove(p.mesh);
  addLog('✦ The heroes discover something of interest…', 'round');
  window.dispatchEvent(new CustomEvent('investigate:triggered', {
    detail: { x: p.x, z: p.z },
  }));
  done();
});

// ── Per-frame tick ────────────────────────────────────────────────────────────

export function tickStars(dt) {
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  const dev    = isDevMode();

  for (let i = _stars.length - 1; i >= 0; i--) {
    const s = _stars[i];
    if (!s.mesh.parent) continue;
    s.t += dt;

    const spr        = s.mesh.userData.sprite;
    const helperMesh = s.mesh.userData.helperMesh;

    if (spr) {
      const pulse = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(s.t * 2.1));
      spr.scale.set(
        s.mesh.userData.baseScaleX * pulse,
        s.mesh.userData.baseScaleY * pulse,
        1,
      );
      spr.position.y = Math.sin(s.t * 1.8) * 0.15;
    }

    if (helperMesh) helperMesh.visible = dev;

    for (const hero of heroes) {
      const dx = hero.grp.position.x - s.x;
      const dz = hero.grp.position.z - s.z;
      if (dx * dx + dz * dz < TRIGGER_RADIUS * TRIGGER_RADIUS) {
        if (isPrecombat()) {
          _triggerStar(s, i);    // immediate: remove ! and dispatch event now
        } else {
          // In combat: keep ! visible, defer trigger to post-combat handler
          _pending.push({ mesh: s.mesh, x: s.x, z: s.z });
          _stars.splice(i, 1);
        }
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
