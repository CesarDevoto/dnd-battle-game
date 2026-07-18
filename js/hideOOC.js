// js/hideOOC.js — scout rings shown while a hero SNEAKS out of combat.
//
// When a hero is sneaking (the MOVE-widget Stealth button), amber rings are drawn around the
// enemies they can see, marking each foe's SHRUNKEN detection radius (scaled by the sneaker's
// Stealth roll) — so the player can judge how close they can creep before being spotted.
//
// Milo's old dedicated out-of-combat Hide was folded into the party-sneak system (he sneaks via
// the same Stealth button, and a won sneak carries his Sneak Attack into combat — see
// combat.js _determineSurprise). All that remains here is that hide's scouting UI.
import * as THREE from 'three';
import { units } from './units.js';
import { UNIT_TYPES, WORLD_UNITS_PER_SQUARE } from './constants.js';
// Even with clear line of sight, scouting can't reveal an enemy's aggro ring beyond 10 squares —
// so fog / darkness zones don't grant indefinite-range LOS.
const MAX_SCOUT_RANGE = 10 * WORLD_UNITS_PER_SQUARE;
import { combatPhase, unitsHaveLOS, heroStealthPct } from './combat.js';
import { capDetectRange } from './zoneLoader.js';
import { sneakDetectMult } from './precombat.js';
import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';

const RING_COLOR = 0xffb020; // amber "danger" ring, distinct from dev-mode red
const _rings = new Map();     // enemy unit → ring mesh

// The hero whose scout rings we draw — MILO, SNEAKING ALONE, and nobody else (user,
// 2026-07-18). Returns null in every other case, which tickHideScout already treats as
// "clear the rings".
//
// Why alone: scouting is Milo's edge, not a party-travel HUD. It used to draw for any sneaker
// and merely PREFER Milo, so a whole party creeping together lit up every enemy's radius —
// and the numbers were a lie there anyway, since each hero rolls their own stealth and the
// rings could only ever show one of them (the old comment admitted they were "approximate for
// the rest of a group"). One sneaker means one honest number.
function _scout() {
  const sneakers = units.filter(u => u.team === 'blue' && u.hp > 0 && u.sneaking);
  if (sneakers.length !== 1) return null;                     // group sneak → no rings
  return sneakers[0].type === 'halfling' ? sneakers[0] : null; // solo, but not Milo → no rings
}

function _disposeRing(enemy, mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  _rings.delete(enemy);
}
function _clearRings() { for (const [e, m] of _rings) _disposeRing(e, m); }

// Called every frame from the main loop.
export function tickHideScout() {
  const scout  = _scout();
  const active = !combatPhase && scout;
  if (!active) { if (_rings.size) _clearRings(); return; }

  // Milo's own detection-shrink. Exact, not approximate — _scout() now guarantees he's the
  // only sneaker, so there are no other heroes' rolls for this radius to misrepresent.
  const mult = sneakDetectMult(heroStealthPct(scout));

  // Drop rings for enemies that died/left
  for (const [enemy, mesh] of _rings) {
    if (!units.includes(enemy) || enemy.hp <= 0 || enemy.team !== 'red') _disposeRing(enemy, mesh);
  }

  for (const enemy of units) {
    if (enemy.team !== 'red' || enemy.hp <= 0) continue;
    const base   = capDetectRange(enemy.detectRange ?? UNIT_TYPES[enemy.type]?.detect ?? 20);
    const radius = base * mult;
    const cx = enemy.grp.position.x, cz = enemy.grp.position.z;

    // Only draw for enemies near enough to matter AND that the scout can actually see (LOS) —
    // he can't map the detection range of a foe hidden behind a wall. Hard-capped at MAX_SCOUT_RANGE.
    const dx = cx - scout.grp.position.x, dz = cz - scout.grp.position.z;
    const showR = Math.min(base * 3, MAX_SCOUT_RANGE);
    let mesh = _rings.get(enemy);
    const visible = dx * dx + dz * dz <= showR * showR && unitsHaveLOS(scout, enemy);
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
    } else if (Math.abs(mesh.userData.r - radius) > 0.01) {
      mesh.geometry.dispose();
      mesh.geometry   = new THREE.RingGeometry(radius - 0.15, radius + 0.15, 64);
      mesh.userData.r = radius;
    }
    mesh.position.set(cx, getTerrainHeight(cx, cz) + 0.06, cz);
  }
}
