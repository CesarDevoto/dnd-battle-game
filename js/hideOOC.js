// js/hideOOC.js — Milo's out-of-combat Hide (scouting).
//
// Hide is a normal Skills & Spells ability (see abilityRegistry + the `hide`
// entry in combat.js's _ABILITY_HANDLERS). This module only supplies the
// out-of-combat behaviour the handler calls into: toggling Milo's stealth,
// and — while hidden — cutting every nearby enemy's detection radius vs him by
// 50% (MILO_HIDE_DETECT_MULT, applied in precombat's _checkAggro) so he can
// detach from the group (solo move) and scout without aggroing. No per-move
// perception rolls. While hidden, rings are drawn around foes he can see (line
// of sight) showing their reduced detection radius. Hiding breaks automatically
// when an enemy still
// manages to spot him (precombat dispatches 'milo:spotted'), unless he's
// standing in his own smoke cloud.

import * as THREE from 'three';
import { units, setUnitStealth } from './units.js';
import { UNIT_TYPES, MILO_HIDE_DETECT_MULT } from './constants.js';
import { combatPhase, addLog, hasLineOfSight } from './combat.js';
import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { playSound } from './audio.js';

const RING_COLOR = 0xffb020; // amber "danger" ring, distinct from dev-mode red
const _rings = new Map();     // enemy unit → ring mesh

function _findMilo() { return units.find(u => u.type === 'halfling' && u.hp > 0) ?? null; }

export function initHideOOC() {
  window.addEventListener('combat:start', () => _onCombatStart());
  // Enemy spotted the hidden Milo (dispatched from precombat _checkAggro) → break hide.
  window.addEventListener('milo:spotted', e => {
    const m = e.detail?.hero;
    if (m && m.stealthedOOC) _setHidden(m, false, true);
  });
}

// ── Public API used by the `hide` ability handler (combat.js) ────────────────
export function canMiloHideOOC()  { return !combatPhase && !!_findMilo(); }
export function isMiloHiddenOOC() { const m = _findMilo(); return !!(m && m.stealthedOOC); }
export function toggleMiloHideOOC() {
  if (combatPhase) return;
  const m = _findMilo();
  if (m) _setHidden(m, !m.stealthedOOC);
}

function _setHidden(milo, on, spotted = false) {
  milo.stealthedOOC = on;
  setUnitStealth(milo, on);
  if (on) {
    playSound('hide');
    addLog(`${UNIT_TYPES.halfling.name} slips into hiding — nearby enemies' detection greatly reduced.`, 'move');
  } else if (spotted) {
    addLog(`${UNIT_TYPES.halfling.name} is spotted — hiding broken!`, 'alert');
  } else {
    addLog(`${UNIT_TYPES.halfling.name} steps out of hiding.`, 'move');
  }
}

function _onCombatStart() {
  // Rings self-hide in combat (tick gates on !combatPhase). Milo keeps his
  // stealth into combat if he wasn't the one spotted — the in-combat stealth
  // system reads u.stealthed. Only clear the OOC scouting flag here.
  const m = _findMilo();
  if (m && m.stealthedOOC) {
    m.stealthedOOC = false;
    // Carried hide into combat (wasn't the one spotted). Pin the stealth origin
    // so the in-combat "stationary hidden attacker" sneak bonus is valid and is
    // correctly forfeited the moment he moves (otherwise it defaults to his live
    // position and would never clear).
    if (m.stealthed) { m.stealthOriginX = m.grp.position.x; m.stealthOriginZ = m.grp.position.z; }
  }
}

// ── Scout rings — reduced enemy detection radius, shown while Milo is hidden ──
function _disposeRing(enemy, mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  _rings.delete(enemy);
}
function _clearRings() { for (const [e, m] of _rings) _disposeRing(e, m); }

// Called every frame from the main loop.
export function tickHideScout() {
  const milo   = _findMilo();
  const active = !combatPhase && milo && milo.stealthedOOC;
  if (!active) { if (_rings.size) _clearRings(); return; }

  // Drop rings for enemies that died/left
  for (const [enemy, mesh] of _rings) {
    if (!units.includes(enemy) || enemy.hp <= 0 || enemy.team !== 'red') _disposeRing(enemy, mesh);
  }

  for (const enemy of units) {
    if (enemy.team !== 'red' || enemy.hp <= 0) continue;
    const base   = enemy.detectRange ?? UNIT_TYPES[enemy.type]?.detect ?? 20;
    const radius = base * MILO_HIDE_DETECT_MULT;
    const cx = enemy.grp.position.x, cz = enemy.grp.position.z;

    // Only draw for enemies near enough to matter AND that Milo can actually
    // see (line of sight) — he can't map the detection range of a foe hidden
    // behind a wall.
    const dx = cx - milo.grp.position.x, dz = cz - milo.grp.position.z;
    const showR = base * 3;
    let mesh = _rings.get(enemy);
    const visible = dx * dx + dz * dz <= showR * showR &&
                    hasLineOfSight(milo.grp.position.x, milo.grp.position.z, cx, cz);
    if (!visible) { if (mesh) _disposeRing(enemy, mesh); continue; }

    if (!mesh) {
      const geo = new THREE.RingGeometry(radius - 0.15, radius + 0.15, 64);
      const mat = new THREE.MeshBasicMaterial({
        color: RING_COLOR, side: THREE.DoubleSide,
        transparent: true, opacity: 0.5, depthWrite: false, fog: false,
      });
      mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x    = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.userData.r    = radius;
      scene.add(mesh);
      _rings.set(enemy, mesh);
    } else if (mesh.userData.r !== radius) {
      mesh.geometry.dispose();
      mesh.geometry   = new THREE.RingGeometry(radius - 0.15, radius + 0.15, 64);
      mesh.userData.r = radius;
    }
    mesh.position.set(cx, getTerrainHeight(cx, cz) + 0.06, cz);
  }
}
