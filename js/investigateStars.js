import { scene } from './scene.js';
import { units } from './units.js';
import { isPrecombat } from './precombat.js';
import { addLog } from './combat.js';
import { isDevMode } from './devMode.js';
import { registerPostCombatHandler } from './postCombat.js';

// ── Persistence ───────────────────────────────────────────────────────────────

const _SEEN_KEY = 'dnd-quest-markers-seen';

function _loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(_SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function _saveSeen(set) {
  try { localStorage.setItem(_SEEN_KEY, JSON.stringify([...set])); } catch {}
}

export function isMarkerSeen(id) {
  return _loadSeen().has(id);
}
export function setMarkerSeen(id) {
  const s = _loadSeen();
  s.add(id);
  _saveSeen(s);
}

// ── State ─────────────────────────────────────────────────────────────────────

const _stars   = [];
const _pending = [];   // stars triggered during combat; fire post-combat
const TRIGGER_RADIUS = 2.0;

// ── Public API ────────────────────────────────────────────────────────────────

// cfg: { id?, onTrigger? }
// id — if provided and already seen, mesh is not added to scene and star is not tracked
// onTrigger — callback fired when hero walks into range; replaces coordinate event dispatch
export function trackStar(mesh, x, z, cfg = {}) {
  if (cfg.id && isMarkerSeen(cfg.id)) {
    // Already triggered in a prior session — don't spawn at all
    mesh.parent?.removeChild(mesh);
    return;
  }
  _stars.push({ mesh, x, z, t: Math.random() * Math.PI * 2, id: cfg.id, onTrigger: cfg.onTrigger });
}

export function untrackStar(mesh) {
  const i = _stars.findIndex(s => s.mesh === mesh);
  if (i >= 0) _stars.splice(i, 1);
}

export function clearAllStars() {
  for (const s of _stars)   scene.remove(s.mesh);
  for (const p of _pending) scene.remove(p.mesh);
  _stars.length   = 0;
  _pending.length = 0;
}

// ── Post-combat deferred trigger ──────────────────────────────────────────────

registerPostCombatHandler(3, (ctx, done) => {
  if (!_pending.length) { done(); return; }
  const p = _pending.shift();
  scene.remove(p.mesh);
  if (p.id) setMarkerSeen(p.id);
  addLog('✦ The heroes discover something of interest…', 'round');
  p.onTrigger?.();
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
          _triggerStar(s, i);
        } else {
          _pending.push(s);
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
  if (s.id) setMarkerSeen(s.id);
  addLog('✦ The heroes discover something of interest…', 'round');
  s.onTrigger?.();
}
