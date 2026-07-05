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

const _exclamations = [];
const _pending      = [];   // markers triggered during combat; fire post-combat
const TRIGGER_RADIUS = 2.0;

// ── Public API ────────────────────────────────────────────────────────────────

// cfg: { id?, onTrigger?, skipAutoConsume? }
// id — if provided and already seen, mesh is not added to scene and marker is not tracked
// onTrigger — callback fired when hero walks into range
// skipAutoConsume — opt out of the generic mid-combat "hero got close → defer
// to _pending → mark seen post-combat" behavior below. Use this when a caller
// manages its own dismissExclamation()/isMarkerSeen() timing via a dedicated
// post-combat handler (e.g. ambushEvent.js) — without it, a marker sitting
// right where combat happens can get silently marked "seen" by this generic
// system (with no onTrigger to show for it) before the caller's own handler
// ever runs, since this module's post-combat handler defaults to priority 3.
export function trackExclamation(mesh, x, z, cfg = {}) {
  if (cfg.id && isMarkerSeen(cfg.id)) {
    mesh.parent?.removeChild(mesh);
    return;
  }
  _exclamations.push({ mesh, x, z, t: Math.random() * Math.PI * 2, id: cfg.id, onTrigger: cfg.onTrigger, skipAutoConsume: !!cfg.skipAutoConsume });
}

export function untrackExclamation(mesh) {
  const i = _exclamations.findIndex(e => e.mesh === mesh);
  if (i >= 0) _exclamations.splice(i, 1);
}

export function clearAllExclamations() {
  for (const e of _exclamations) scene.remove(e.mesh);
  for (const p of _pending)      scene.remove(p.mesh);
  _exclamations.length = 0;
  _pending.length      = 0;
}

// Permanently dismiss one tracked marker by id: removes its mesh and persists
// "seen" so it does not reappear on a later zone rebuild (e.g. after River Styx).
// Use this instead of clearAllExclamations() whenever a scripted event is
// consuming a specific marker rather than tearing down the whole zone.
export function dismissExclamation(id) {
  if (!id) return;
  setMarkerSeen(id);
  for (let i = _exclamations.length - 1; i >= 0; i--) {
    if (_exclamations[i].id === id) {
      scene.remove(_exclamations[i].mesh);
      _exclamations.splice(i, 1);
    }
  }
  for (let i = _pending.length - 1; i >= 0; i--) {
    if (_pending[i].id === id) {
      scene.remove(_pending[i].mesh);
      _pending.splice(i, 1);
    }
  }
}

// ── Post-combat deferred trigger ──────────────────────────────────────────────

registerPostCombatHandler(3, (ctx, done) => {
  if (!_pending.length) { done(); return; }
  const p = _pending.shift();
  scene.remove(p.mesh);
  if (p.id) setMarkerSeen(p.id);
  addLog('✦ The heroes discover something of interest…', 'alert');
  p.onTrigger?.();
  done();
});

// ── Per-frame tick ────────────────────────────────────────────────────────────

export function tickExclamations(dt) {
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  const dev    = isDevMode();

  for (let i = _exclamations.length - 1; i >= 0; i--) {
    const e = _exclamations[i];
    if (!e.mesh.parent) continue;
    e.t += dt;

    const spr        = e.mesh.userData.sprite;
    const helperMesh = e.mesh.userData.helperMesh;

    if (spr) {
      const pulse = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(e.t * 2.1));
      spr.scale.set(
        e.mesh.userData.baseScaleX * pulse,
        e.mesh.userData.baseScaleY * pulse,
        1,
      );
      spr.position.y = Math.sin(e.t * 1.8) * 0.15;
    }

    if (helperMesh) helperMesh.visible = dev;

    if (e.skipAutoConsume) continue;

    for (const hero of heroes) {
      const dx = hero.grp.position.x - e.x;
      const dz = hero.grp.position.z - e.z;
      if (dx * dx + dz * dz < TRIGGER_RADIUS * TRIGGER_RADIUS) {
        if (isPrecombat()) {
          _triggerExclamation(e, i);
        } else {
          _pending.push(e);
          _exclamations.splice(i, 1);
        }
        break;
      }
    }
  }
}

// ── Trigger ───────────────────────────────────────────────────────────────────

function _triggerExclamation(e, idx) {
  scene.remove(e.mesh);
  _exclamations.splice(idx, 1);
  if (e.id) setMarkerSeen(e.id);
  addLog('✦ The heroes discover something of interest…', 'alert');
  e.onTrigger?.();
}
