import * as THREE from 'three';
import { scene, camera, renderer, ground, divider, focusCameraOnUnit, setFollowUnit, setGridVisible } from './scene.js';
import { units, setUnitWalking, playUnitAttackAnim, playUnitDeathAnim, setUnitStealth } from './units.js';
import { COLORS, INTERACTION, UNIT_TYPES, COMBAT, HERO_RING_COLORS,
         WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET, ENEMY_CR, GROUND_SIZE } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { roll, showRoll, clearRollFeed } from './dice.js';
import { clearDiceQueue, showHitBanner, showMissBanner } from './dice3d.js';
import { playMagicMissileEffect }  from './magicmissile.js';
import { propPositions, losBlockerMeshes, getSurfaceHeight, activeEnv } from './environments.js';
import { showSelectionHighlight, hideSelectionHighlight } from './selectionHighlight.js';
import { SPELLS, ELF_SPELLS, LEVEL_SPELLS, blessedUnits, applyBless, clearBless, tickBless, initSpellSlots } from './spells.js';
import { playFireboltEffect }      from './firebolt.js';
import { playHealingWordEffect }   from './healingWord.js';
import { fireRangedAttack }        from './arrow.js';
import { showTargetWindow, hideTargetWindow, updateTargetWindowHP } from './targetWindow.js';
import { bindHotkey, clearAllHotkeys, updateHotkeyRanges } from './hotbar.js';
import { aiPickTarget, aiGetAttack, aiPickDest, aiPickDestTowardMelee } from './combatAI.js';
import { buildHeroSpellPanel, refreshHeroSpellPanel } from './heroAbilities.js';
import { awardXP } from './progression.js';
import { rollLoot, spawnLootOrb } from './loot.js';
import { runPostCombat } from './postCombat.js';
import { playSound, playUnitAttackSound, playUnitMoveSound, getUnitAttackDuration, playCombatMusic, stopCombatMusic } from './audio.js';
import { onHeroDied, onCombatEnd, onEnemyKilled, onHeroTurnStart } from './dagnaEvent.js';

// ── Sleep state ──────────────────────────────────────────────────────────────
// Maps sleeping unit → { roundsLeft, zzzEl }
export const sleepingUnits = new Map();

const _sv = new THREE.Vector3();

function applySleep(u, rounds) {
  if (sleepingUnits.has(u)) return;
  const zzzEl = document.createElement('div');
  zzzEl.className = 'zzz-label';
  zzzEl.textContent = 'Zzz';
  document.getElementById('app').appendChild(zzzEl);
  sleepingUnits.set(u, { roundsLeft: rounds, zzzEl });
}

function wakeUnit(u, reason) {
  const state = sleepingUnits.get(u);
  if (!state) return;
  state.zzzEl?.remove();
  sleepingUnits.delete(u);
  const msg = reason === 'damage' ? '😤 AWAKE!' : '👁 AWAKE';
  showFloatingDamage(u, msg, '#ffdd88');
  addLog(`  ${unitLabel(u)} wakes up!`, 'spell');
}

function tickSleep() {
  const toWake = [];
  for (const [u, state] of sleepingUnits) {
    state.roundsLeft--;
    if (state.roundsLeft <= 0) toWake.push(u);
  }
  toWake.forEach(u => {
    addLog(`${unitLabel(u)}'s sleep expires`, 'spell');
    wakeUnit(u);
  });
}

export function trackSleepUI() {
  for (const [u, state] of sleepingUnits) {
    if (!state.zzzEl) continue;
    _sv.set(u.anchor.x, u.anchor.y + 1.0, u.anchor.z).project(camera);
    if (_sv.z >= 1) { state.zzzEl.style.display = 'none'; continue; }
    const cw = renderer.domElement.clientWidth, ch = renderer.domElement.clientHeight;
    state.zzzEl.style.display = 'block';
    state.zzzEl.style.left    = ((_sv.x * 0.5 + 0.5) * cw) + 'px';
    state.zzzEl.style.top     = ((-_sv.y * 0.5 + 0.5) * ch) + 'px';
  }
}

function playSleepEffect(caster) {
  const COUNT = 80;
  const geo   = new THREE.BufferGeometry();
  const pos   = new Float32Array(COUNT * 3);
  const vels  = [];

  for (let i = 0; i < COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const phi   = Math.random() * Math.PI;
    const spd   = 1.0 + Math.random() * 2.5;
    vels.push({
      x: Math.sin(phi) * Math.cos(angle) * spd,
      y: Math.abs(Math.cos(phi)) * spd + 0.3,
      z: Math.sin(phi) * Math.sin(angle) * spd,
    });
    pos[i * 3]     = caster.grp.position.x;
    pos[i * 3 + 1] = caster.grp.position.y + 1.6;
    pos[i * 3 + 2] = caster.grp.position.z;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xcc55ff, size: 0.30, transparent: true, opacity: 0.92,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);

  const t0 = Date.now();
  const DURATION = 2200;

  (function step() {
    const elapsed = Date.now() - t0;
    if (elapsed >= DURATION) { scene.remove(pts); geo.dispose(); mat.dispose(); return; }
    const t = elapsed / DURATION;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3]     += vels[i].x * 0.016;
      arr[i * 3 + 1] += vels[i].y * 0.016;
      arr[i * 3 + 2] += vels[i].z * 0.016;
      vels[i].y      -= 0.025;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = (1 - t * t) * 0.92;
    requestAnimationFrame(step);
  })();
}

// ── Active ring ───────────────────────────────────────────────────────────────

export const activeRing = new THREE.Mesh(
  _makeConformingGeo(0, 0, INTERACTION.activeRingInner, INTERACTION.activeRingOuter, 32, 0.05),
  new THREE.MeshBasicMaterial({
    color: COLORS.activeRing, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
    depthTest: false,
  })
);
activeRing.frustumCulled = false;
activeRing.renderOrder   = 3;
activeRing.visible       = false;
scene.add(activeRing);

// ── Move-range tile set (click detection + AI — no visual tiles) ─────────────

const validTiles = new Set(); // "x,z" string keys

// ── Attack target rings ───────────────────────────────────────────────────────

const MAX_ATK_RINGS = 40;
const atkRings = [];
for (let i = 0; i < MAX_ATK_RINGS; i++) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.10, 32),
    new THREE.MeshBasicMaterial({
      color: 0xCC6644, side: THREE.DoubleSide, transparent: true, opacity: 0.80,
      depthWrite: false, depthTest: false,
    })
  );
  ring.rotation.x  = -Math.PI / 2;
  ring.position.y  = 0.07;
  ring.renderOrder = 3;
  ring.visible = false;
  scene.add(ring);
  atkRings.push(ring);
}

const atkTargets = new Map(); // enemy unit → attack definition to use

// ── Heal targeting rings (green) ──────────────────────────────────────────────

const MAX_HEAL_RINGS = 10;
const healRings = [];
for (let i = 0; i < MAX_HEAL_RINGS; i++) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.10, 32),
    new THREE.MeshBasicMaterial({
      color: 0x22dd88, side: THREE.DoubleSide, transparent: true, opacity: 0.80,
      depthWrite: false, depthTest: false,
    })
  );
  ring.rotation.x  = -Math.PI / 2;
  ring.position.y  = 0.07;
  ring.renderOrder = 3;
  ring.visible = false;
  scene.add(ring);
  healRings.push(ring);
}
const healTargets = new Map(); // ally unit → spellKey

// ── Shared terrain-conforming ring geometry helpers ───────────────────────────
// All visual rings use these so their vertices drape over terrain and water planes.
// _makeConformingGeo / updateConformingRingGeo are regular function declarations
// and therefore hoisted — activeRing (declared earlier) can call them safely.

function _makeConformingGeo(cx, cz, inner, outer, segs, lift) {
  const pos = new Float32Array((segs + 1) * 2 * 3);
  const idx = [];
  let vi = 0;
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    pos[vi++] = inner * cos;
    pos[vi++] = getSurfaceHeight(cx + inner * cos, cz + inner * sin) + lift;
    pos[vi++] = inner * sin;
    pos[vi++] = outer * cos;
    pos[vi++] = getSurfaceHeight(cx + outer * cos, cz + outer * sin) + lift;
    pos[vi++] = outer * sin;
  }
  for (let i = 0; i < segs; i++) {
    const b = i * 2;
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const geo     = new THREE.BufferGeometry();
  const posAttr = new THREE.Float32BufferAttribute(pos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setIndex(idx);
  geo.userData = { inner, outer, segs, lift };
  return geo;
}

function updateConformingRingGeo(ring, cx, cz) {
  const { inner, outer, segs, lift } = ring.geometry.userData;
  const arr = ring.geometry.attributes.position.array;
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const base = i * 6;
    arr[base + 1] = getSurfaceHeight(cx + inner * cos, cz + inner * sin) + lift;
    arr[base + 4] = getSurfaceHeight(cx + outer * cos, cz + outer * sin) + lift;
  }
  ring.geometry.attributes.position.needsUpdate = true;
}

// ── Attack-range rings (centered on active unit) ──────────────────────────────

const _ATK_RING_SEGS = 72;
const _ATK_RING_LIFT = 0.05;

function makeConformingRingGeo(cx, cz, radius) {
  const half = Math.min(0.10, Math.max(0.05, radius * 0.013));
  return _makeConformingGeo(cx, cz, radius - half, radius + half, _ATK_RING_SEGS, _ATK_RING_LIFT);
}

function makeMoveRingGeo(cx, cz, radius) {
  const half = Math.min(0.10, Math.max(0.05, radius * 0.013));
  return _makeConformingGeo(cx, cz, radius - half, radius + half, _ATK_RING_SEGS, _ATK_RING_LIFT);
}

export const meleeRangeRing = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: 0xCC6644, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
);
meleeRangeRing.frustumCulled = false;
meleeRangeRing.renderOrder   = 3;
meleeRangeRing.visible = false;
scene.add(meleeRangeRing);

export const rangedRangeRing = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: 0x5599CC, side: THREE.DoubleSide, transparent: true, opacity: 0.45,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
);
rangedRangeRing.frustumCulled = false;
rangedRangeRing.renderOrder   = 3;
rangedRangeRing.visible = false;
scene.add(rangedRangeRing);

export const moveRangeRing = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: 0x44FF44, side: THREE.DoubleSide, transparent: true, opacity: 1.0,
    depthWrite: false, depthTest: false,
  })
);
moveRangeRing.frustumCulled = false;
moveRangeRing.renderOrder = 3;   // draw after terrain, props, water
moveRangeRing.visible = false;
scene.add(moveRangeRing);

// Hover ring — rebuilt per-tile so its vertices drape over terrain contours
export const hoverRing = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: 0xff66ff, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    depthWrite: false, depthTest: false,
  })
);
hoverRing.frustumCulled = false;
hoverRing.renderOrder = 3;   // draw after terrain, props, water
hoverRing.visible = false;
scene.add(hoverRing);

// Spell-range ring — shown around the caster when a ranged spell is in targeting mode
export const spellRangeRing = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: 0xaa44ff, side: THREE.DoubleSide, transparent: true, opacity: 0.50,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
);
spellRangeRing.frustumCulled = false;
spellRangeRing.renderOrder   = 3;
spellRangeRing.visible = false;
scene.add(spellRangeRing);

const _HOVER_INNER = 0.85, _HOVER_OUTER = 1.10, _HOVER_SEGS = 32, _HOVER_LIFT = 0.04;
let _hoverRingTx = null, _hoverRingTz = null;
let _ringHoverActive = false;   // true only while cursor is actively over a unit/tile

// ── Unit hover emissive pulse ─────────────────────────────────────────────────
const _PULSE_COLOR = new THREE.Color(0xff44ff);
let _pulseHoveredUnit = null;

function _setMeshEmissive(unit, color) {
  unit.grp.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => { if (m.emissive instanceof THREE.Color) m.emissive.copy(color); });
  });
}

export function setHoverPulseUnit(unit) {
  if (unit === selectedTarget) { clearHoverPulseUnit(); return; }
  if (_pulseHoveredUnit === unit) return;
  if (_pulseHoveredUnit) _setMeshEmissive(_pulseHoveredUnit, new THREE.Color(0x000000));
  _pulseHoveredUnit = unit;
}

export function clearHoverPulseUnit() {
  if (!_pulseHoveredUnit) return;
  _setMeshEmissive(_pulseHoveredUnit, new THREE.Color(0x000000));
  _pulseHoveredUnit = null;
}

export function tickHoverPulse(t) {
  if (!_pulseHoveredUnit) return;
  const intensity = 3.0 + Math.abs(Math.sin(t * 4.5)) * 5.0;
  _pulseHoveredUnit.grp.traverse(obj => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => {
      if (m.emissive instanceof THREE.Color) m.emissive.copy(_PULSE_COLOR).multiplyScalar(intensity);
    });
  });
}

function buildHoverRingGeo(cx, cz) {
  const pos = new Float32Array((_HOVER_SEGS + 1) * 2 * 3);
  const idx = [];
  let vi = 0;
  for (let i = 0; i <= _HOVER_SEGS; i++) {
    const theta = (i / _HOVER_SEGS) * Math.PI * 2;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    pos[vi++] = _HOVER_INNER * cos;
    pos[vi++] = getSurfaceHeight(cx + _HOVER_INNER * cos, cz + _HOVER_INNER * sin) + _HOVER_LIFT;
    pos[vi++] = _HOVER_INNER * sin;
    pos[vi++] = _HOVER_OUTER * cos;
    pos[vi++] = getSurfaceHeight(cx + _HOVER_OUTER * cos, cz + _HOVER_OUTER * sin) + _HOVER_LIFT;
    pos[vi++] = _HOVER_OUTER * sin;
  }
  for (let i = 0; i < _HOVER_SEGS; i++) {
    const b = i * 2;
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

function showRangeRings(u) {
  const def    = UNIT_TYPES[u.type] ?? {};
  const atks   = def.attacks ?? [];
  const meleeA = atks.find(a => a.type === 'melee');
  const rangdA = atks.find(a => a.type === 'ranged');
  const ux = u.grp.position.x, uz = u.grp.position.z;

  if (meleeA) {
    meleeRangeRing.geometry.dispose();
    meleeRangeRing.geometry = makeConformingRingGeo(ux, uz, atkTriggerWU(meleeA));
    meleeRangeRing.position.set(ux, 0, uz);
    meleeRangeRing.visible = true;
  } else {
    meleeRangeRing.visible = false;
  }

  if (rangdA) {
    rangedRangeRing.geometry.dispose();
    rangedRangeRing.geometry = makeConformingRingGeo(ux, uz, atkRangeWU(rangdA.range));
    rangedRangeRing.position.set(ux, 0, uz);
    rangedRangeRing.visible = true;
  } else {
    rangedRangeRing.visible = false;
  }
}

function hideRangeRings() {
  meleeRangeRing.visible  = false;
  rangedRangeRing.visible = false;
  spellRangeRing.visible  = false;
}

function moveRangeRings(x, z) {
  if (meleeRangeRing.visible)  {
    updateConformingRingGeo(meleeRangeRing, x, z);
    meleeRangeRing.position.set(x, 0, z);
  }
  if (rangedRangeRing.visible) {
    updateConformingRingGeo(rangedRangeRing, x, z);
    rangedRangeRing.position.set(x, 0, z);
  }
  if (spellRangeRing.visible) {
    updateConformingRingGeo(spellRangeRing, x, z);
    spellRangeRing.position.set(x, 0, z);
  }
}

function showSpellRangeRing(caster, rangeFt) {
  const radius = atkRangeWU(rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  spellRangeRing.geometry.dispose();
  spellRangeRing.geometry = makeConformingRingGeo(ux, uz, radius);
  spellRangeRing.position.set(ux, 0, uz);
  spellRangeRing.visible = true;
}

function hideSpellRangeRing() {
  spellRangeRing.visible = false;
}

// ── Ranged targeting line ──────────────────────────────────────────────────────
// A dashed yellow line drawn from attacker to target before a ranged shot fires.
// Shown for TARGETING_LINE_MS, then hidden as the attack roll executes.

const TARGETING_LINE_MS = 950;

const _tlPts = [new THREE.Vector3(), new THREE.Vector3()];
const _tlGeo = new THREE.BufferGeometry().setFromPoints(_tlPts);
const targetingLine = new THREE.Line(
  _tlGeo,
  new THREE.LineDashedMaterial({
    color:       0xffee00,
    dashSize:    0.7,
    gapSize:     0.35,
    transparent: true,
    opacity:     0.82,
  })
);
targetingLine.visible = false;
scene.add(targetingLine);

function showTargetingLine(attacker, target) {
  const ay = attacker.grp.position.y + 1.2;
  const ty = target.grp.position.y   + 1.2;
  _tlPts[0].set(attacker.grp.position.x, ay, attacker.grp.position.z);
  _tlPts[1].set(target.grp.position.x,   ty, target.grp.position.z);
  _tlGeo.setFromPoints(_tlPts);
  targetingLine.computeLineDistances();  // required for LineDashedMaterial
  targetingLine.visible = true;
}

function hideTargetingLine() {
  targetingLine.visible = false;
}

// ── Turn state ────────────────────────────────────────────────────────────────

export let turnOrder   = [];
export let turnIndex   = 0;
export let round       = 1;
export let combatPhase = false;

// Callback registered by zoneLoader to block premature victory while spawns are pending.
let _pendingSpawnCheckFn = () => false;
export function registerPendingSpawnCheck(fn) { _pendingSpawnCheckFn = fn; }

let _halfGroundSize = GROUND_SIZE / 2;
export function setGroundBounds(half) { _halfGroundSize = half; }
let turnMovedFt  = 0;   // feet used this turn (can interleave with attack)
let turnAttacked = false;

// Dungeon stealth: enemies must gain LOS to a hero before they act.
// Populated on first sighting; cleared each new battle.
const _dungeonAwareEnemies = new Set();
let heroMode     = null; // null | 'move' | 'elfatk_*' | 'spell_*'
export let isAnimating = false;
let turnBonusActioned = false;  // bonus action used this turn (e.g. Healing Word)
let sneakAttackUsed  = false;   // halfling sneak attack — once per turn
let prevMoveState = null; // { x, z, movedFt } saved just before a move for undo

const _delayed = new Map();  // hero → trigger string ('enemy_in_los' | 'enemy_in_melee_range' | 'ally_loses_hp')

const blueUndo   = document.getElementById('blue-undo-btn');
const endTurnBtn = document.getElementById('end-turn-btn');
const moveDistEl = document.getElementById('move-dist');

function showUndoBtn() {
  const u = turnOrder[turnIndex];
  if (u && u.team === 'blue') blueUndo.style.display = 'block';
}
function hideUndoBtn() {
  blueUndo.style.display = 'none';
  prevMoveState = null;
}

function handleUndo() {
  if (isAnimating || !prevMoveState) return;
  const u = turnOrder[turnIndex];
  if (!u) return;
  const { x, z, movedFt } = prevMoveState;
  hideUndoBtn();
  hideMoveRange();
  hideAttackTargets();
  const path = findPath(u.grp.position.x, u.grp.position.z, x, z);
  animatePath(u, path, () => {
    turnMovedFt = movedFt;
    addLog(`${unitLabel(u)} undoes move`, 'move');
    heroMode = 'move';
    const remaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
    if (remaining > 0) showMoveRange(u);
    updateCombatStatus();
  
  });
}
blueUndo.addEventListener('click', handleUndo);

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROP_CLASH_SQ     = 4.0;
const PROP_MIN_BLOCK_SQ = 1.5 * 1.5; // floor: always block the nearest grid tile

function isOccupied(x, z, exclude) {
  return units.some(u => {
    if (u === exclude) return false;
    const dx = u.grp.position.x - x, dz = u.grp.position.z - z;
    return dx * dx + dz * dz < INTERACTION.clashRadiusSq;
  });
}

function hasPropClash(x, z) {
  return propPositions.some(p => {
    const dx = p.x - x, dz = p.z - z;
    // Use whichever is larger: the prop's own clash radius, or the global
    // minimum that guarantees the nearest grid tile is always blocked.
    const threshold = Math.max(p.clashRSq ?? PROP_CLASH_SQ, PROP_MIN_BLOCK_SQ);
    return dx * dx + dz * dz < threshold;
  });
}

// 3-D line-of-sight: cast a ray from the attacker's eye to the target's eye.
// Hits on prop meshes that are above eye level (tree canopy, elevated foliage)
// are ignored — only trunk/boulder-height obstructions block.
const _losRay      = new THREE.Raycaster();
const LOS_EYE_H    = 1.10;  // WU above unit Y for the ray origin/terminus
const LOS_CANOPY_Y = 0.75;  // hits more than this WU above the highest eye are ignored
const LOS_STEPS    = 12;    // terrain height samples along the ray

// Returns true if terrain rises above the eye-level line between the two points.
// Catches cliff walls and raised ridges that the prop raycaster never sees.
function _terrainBlocksLOS(ax, az, tx, tz, fromY, toY) {
  for (let i = 1; i < LOS_STEPS; i++) {
    const t  = i / LOS_STEPS;
    const th = getTerrainHeight(ax + (tx - ax) * t, az + (tz - az) * t);
    if (th > fromY + (toY - fromY) * t) return true;
  }
  return false;
}

function hasLineOfSight(ax, az, tx, tz) {
  const dx = tx - ax, dz = tz - az;
  if (dx * dx + dz * dz === 0) return true;

  const fromY = getTerrainHeight(ax, az) + LOS_EYE_H;
  const toY   = getTerrainHeight(tx, tz) + LOS_EYE_H;

  // Terrain check: cheap height sampling along the ray
  if (_terrainBlocksLOS(ax, az, tx, tz, fromY, toY)) return false;

  // Prop check: raycaster against placed scene objects
  if (!losBlockerMeshes.length) return true;
  const from = new THREE.Vector3(ax, fromY, az);
  const to   = new THREE.Vector3(tx, toY,   tz);
  const dist = from.distanceTo(to);
  _losRay.set(from, new THREE.Vector3().subVectors(to, from).normalize());
  _losRay.far = dist;

  // Any hit at or below the canopy threshold blocks LOS; hits above it are foliage overhead
  const ceilY = Math.max(fromY, toY) + LOS_CANOPY_Y;
  return !_losRay.intersectObjects(losBlockerMeshes, true).some(h => h.point.y <= ceilY);
}

// Sneak Attack fires when attacker has advantage on the roll, OR a conscious ally
// (not dead, asleep, or stunned) is adjacent to the ATTACKER (≤ 3 WU ≈ 1 grid square)
function hasSneakAttackCondition(attacker, atkResult) {
  if (atkResult.mode === 'advantage') return true;
  return units.some(ally => {
    if (ally === attacker || ally.team !== attacker.team) return false;
    if (ally.hp <= 0 || sleepingUnits.has(ally) || ally.stunned) return false;
    const dx = ally.grp.position.x - attacker.grp.position.x;
    const dz = ally.grp.position.z - attacker.grp.position.z;
    return dx * dx + dz * dz <= 9;
  });
}

// Returns true when an attack has no qty limit OR still has shots remaining.
function atkHasQty(unit, atk) {
  if (atk.qty === undefined) return true;
  return (unit.atkQty?.[atk.name] ?? atk.qty) > 0;
}

// Decrement qty counter only — no log (call when the projectile is launched).
function _consumeAtkQty(unit, atk) {
  if (atk.qty === undefined || !(atk.name in (unit.atkQty ?? {}))) return;
  unit.atkQty[atk.name] = Math.max(0, unit.atkQty[atk.name] - 1);
}

// Log remaining-ammo message — call after hit/miss outcome is already shown.
function _logAtkQtyMsg(unit, atk) {
  if (unit.team !== 'blue') return;
  if (atk.qty === undefined || !(atk.name in (unit.atkQty ?? {}))) return;
  const left  = unit.atkQty[atk.name];
  const label = unitLabel(unit);
  const noun  = atk.name.toLowerCase();
  if      (left === 1) addLog(`${label} has one ${noun} left!`, 'qty');
  else if (left === 0) addLog(`${label} has no more ${noun}s — melee only!`, 'qty');
}

// Convert attack range in feet to world-unit distance (+1 tolerance covers diagonals)
function atkRangeWU(rangeFt) {
  return (rangeFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE + 1.0;
}
// Melee gets one extra grid square so units blocked at adjacency still trigger melee
function atkTriggerWU(atk) {
  return atkRangeWU(atk.range) + (atk.type === 'melee' ? WORLD_UNITS_PER_SQUARE : 0);
}

// ── Pathfinding (BFS on the grid, blocking props only) ────────────────────────

function findPath(sx, sz, tx, tz) {
  const S = WORLD_UNITS_PER_SQUARE;
  const key = (x, z) => `${x},${z}`;
  const dirs = [
    [0, S], [0, -S], [S, 0], [-S, 0],
    [S, S], [S, -S], [-S, S], [-S, -S],
  ];
  const parent = new Map([[key(sx, sz), null]]);
  const queue  = [{ x: sx, z: sz }];

  while (queue.length) {
    const { x, z } = queue.shift();
    if (x === tx && z === tz) break;
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      const k  = key(nx, nz);
      if (parent.has(k)) continue;
      if (Math.abs(nx) > _halfGroundSize || Math.abs(nz) > _halfGroundSize) continue;
      if (hasPropClash(nx, nz)) continue;   // prop tiles are always impassable
      parent.set(k, { x, z });
      queue.push({ x: nx, z: nz });
    }
  }

  // If the target was never reached, the destination is unreachable — return
  // empty so animatePath skips movement instead of teleporting.
  if (!parent.has(key(tx, tz))) return [];

  // Reconstruct: walk back from target to start, then reverse
  const path = [];
  let cur = { x: tx, z: tz };
  while (cur) {
    path.unshift({ x: cur.x, z: cur.z });
    cur = parent.get(key(cur.x, cur.z));
  }
  path.shift(); // drop the start position itself
  return path;
}

// ── Path animation ────────────────────────────────────────────────────────────

const MOVE_SPEED = 5.4; // world units per second

function animatePath(unit, path, onComplete) {
  if (!path.length) { onComplete(); return; }
  isAnimating = true;
  setUnitWalking(unit, true, true);
  playUnitMoveSound(unit.type);

  let stepIdx = 0;
  let startX  = unit.grp.position.x;
  let startZ  = unit.grp.position.z;
  let startY  = getTerrainHeight(startX, startZ);
  let startTs = null;

  // Face the first direction immediately
  const { x: fx, z: fz } = path[0];
  unit.grp.rotation.y = Math.atan2(fx - startX, fz - startZ);

  function frame(ts) {
    if (startTs === null) startTs = ts;

    const target  = path[stepIdx];
    const dx = target.x - startX, dz = target.z - startZ;
    const dist    = Math.sqrt(dx * dx + dz * dz);
    const elapsed = (ts - startTs) / 1000;
    const t       = dist > 0 ? Math.min(1, (elapsed * MOVE_SPEED) / dist) : 1;
    const endY    = getTerrainHeight(target.x, target.z);

    unit.grp.position.x = startX + dx * t;
    unit.grp.position.z = startZ + dz * t;
    unit.grp.position.y = startY + (endY - startY) * t;
    unit.anchor.x = unit.grp.position.x;
    unit.anchor.z = unit.grp.position.z;
    unit.anchor.y = unit.grp.position.y + unit.anchorY;
    updateConformingRingGeo(activeRing, unit.grp.position.x, unit.grp.position.z);
    activeRing.position.set(unit.grp.position.x, 0, unit.grp.position.z);
    moveRangeRings(unit.grp.position.x, unit.grp.position.z);

    if (t >= 1) {
      // Snap to exact grid position
      unit.grp.position.set(target.x, endY, target.z);
      unit.anchor.x = target.x;
      unit.anchor.y = endY + unit.anchorY;
      unit.anchor.z = target.z;
      stepIdx++;

      if (stepIdx >= path.length) {
        isAnimating = false;
        setUnitWalking(unit, false);
        onComplete();
        return;
      }

      startX  = target.x;
      startZ  = target.z;
      startY  = endY;
      startTs = ts;

      // Face next segment
      const next = path[stepIdx];
      unit.grp.rotation.y = Math.atan2(next.x - startX, next.z - startZ);
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// ── Move range ────────────────────────────────────────────────────────────────

function showMoveRange(u, overrideFt) {
  const def      = UNIT_TYPES[u.type] ?? {};
  const remainFt = overrideFt !== undefined ? overrideFt : (def.speed ?? 30) - turnMovedFt;
  if (remainFt <= 0) { hideMoveRange(); return; }

  const speedSq = remainFt / GRID_SQUARE_FEET;
  const maxDist = speedSq * WORLD_UNITS_PER_SQUARE;
  const range   = Math.ceil(speedSq);
  const ux = u.grp.position.x, uz = u.grp.position.z;

  validTiles.clear();
  for (let dx = -range; dx <= range; dx++) {
    for (let dz = -range; dz <= range; dz++) {
      if (dx === 0 && dz === 0) continue;
      const tx = ux + dx * WORLD_UNITS_PER_SQUARE;
      const tz = uz + dz * WORLD_UNITS_PER_SQUARE;
      const wx = tx - ux, wz = tz - uz;
      if (wx * wx + wz * wz > maxDist * maxDist) continue;
      if (Math.abs(tx) > _halfGroundSize || Math.abs(tz) > _halfGroundSize) continue;
      if (isOccupied(tx, tz, u)) continue;
      if (hasPropClash(tx, tz)) continue;
      validTiles.add(`${tx},${tz}`);
    }
  }

  if (validTiles.size > 0) {
    moveRangeRing.geometry.dispose();
    moveRangeRing.geometry = makeMoveRingGeo(ux, uz, maxDist);
    moveRangeRing.position.set(ux, 0, uz);
    moveRangeRing.visible = true;
  }
}

function hideMoveRange() {
  moveRangeRing.visible = false;
  validTiles.clear();
  hoverRing.visible = false;
  moveDistEl.style.display = 'none';
  _hoverRingTx = _hoverRingTz = null;
}

// ── Attack targets ────────────────────────────────────────────────────────────

function showAttackTargets(u) {
  hideAttackTargets();
  if (turnAttacked) return;

  const def  = UNIT_TYPES[u.type] ?? {};
  const atks = def.attacks ?? [];
  const meleeA = atks.find(a => a.type === 'melee');
  const rangdA = atks.find(a => a.type === 'ranged');
  if (!meleeA && !rangdA) return;

  const enemies = units.filter(e => e.team !== u.team);
  let ri = 0;

  for (const enemy of enemies) {
    const dx   = enemy.grp.position.x - u.grp.position.x;
    const dz   = enemy.grp.position.z - u.grp.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let chosenAtk = null, color = 0xCC6644;
    if (meleeA && dist <= atkTriggerWU(meleeA)) {
      chosenAtk = meleeA; color = 0xCC6644;  // orange — melee
    } else if (rangdA && atkHasQty(u, rangdA) && dist <= atkRangeWU(rangdA.range) &&
               hasLineOfSight(u.grp.position.x, u.grp.position.z,
                              enemy.grp.position.x, enemy.grp.position.z)) {
      chosenAtk = rangdA; color = 0x22ccaa;  // teal — ranged
    }
    if (!chosenAtk || ri >= MAX_ATK_RINGS) continue;

    const ring = atkRings[ri++];
    ring.material.color.set(color);
    ring.position.set(enemy.grp.position.x, enemy.grp.position.y + 0.07, enemy.grp.position.z);
    ring.visible    = true;
    atkTargets.set(enemy, chosenAtk);
  }
}

function hideAttackTargets() {
  atkRings.forEach(r => r.visible = false);
  atkTargets.clear();
}

// ── Heal target rings ─────────────────────────────────────────────────────────

function showHealTargets(caster, spellKey) {
  hideHealTargets();
  const spell   = SPELLS[spellKey];
  if (!spell) return;
  const rangeWU = atkRangeWU(spell.rangeFt) + 1.0;
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  let ri = 0;
  units.filter(a => a.team === 'blue' && a.hp > 0).forEach(ally => {
    if (ri >= MAX_HEAL_RINGS) return;
    const dx = ally.grp.position.x - ux, dz = ally.grp.position.z - uz;
    if (Math.sqrt(dx * dx + dz * dz) > rangeWU) return;
    const ring = healRings[ri++];
    ring.material.color.set(ally.hp < ally.maxHp ? 0x22dd88 : 0x228855);
    ring.position.set(ally.grp.position.x, ally.grp.position.y + 0.07, ally.grp.position.z);
    ring.visible = true;
    healTargets.set(ally, spellKey);
  });
}

function hideHealTargets() {
  healRings.forEach(r => r.visible = false);
  healTargets.clear();
}

// ── Spell casting ─────────────────────────────────────────────────────────────

function castHeal(caster, target, spellKey) {
  const spell = SPELLS[spellKey];
  if (!spell) return;
  const isCantrip = (spell.level ?? 1) === 0;
  if (!isCantrip && (caster.spellSlots ?? 0) <= 0) return;

  faceTarget(caster, target);
  playUnitAttackAnim(caster, 'spell');
  hideHealTargets();
  hideSpellRangeRing();
  heroMode = null;
  if (!isCantrip) caster.spellSlots--;

  if (spell.actionType === 'action') turnAttacked      = true;
  else                               turnBonusActioned = true;

  const wisMod   = Math.floor(((UNIT_TYPES[caster.type]?.abilities?.wis ?? 10) - 10) / 2);
  const healMod  = spell.healMod ?? wisMod;
  const healRoll = roll({ sides: spell.healSides, count: spell.healDice, modifier: healMod });
  const healed   = Math.min(healRoll.total, target.maxHp - target.hp);
  target.hp      = Math.min(target.maxHp, target.hp + healRoll.total);
  target.barShowUntil = Date.now() + 4000;

  showRoll(`${unitLabel(caster)}  →  ${unitLabel(target)}  ·  ${spell.name}`, healRoll, { autoDismiss: false });

  const _onHealLand = () => {
    showFloatingDamage(target, `+${healed}`, '#44ff88');
    addLog(`${unitLabel(caster)} heals ${unitLabel(target)} for ${healed} hp (${spell.name})`, 'heal');
  };

  if (spellKey === 'healing_word') {
    playHealingWordEffect(caster, target, _onHealLand);
  } else {
    setTimeout(_onHealLand, 800);
  }

  const _remFt = (UNIT_TYPES[caster.type]?.speed ?? 30) - turnMovedFt;
  if (_remFt > 0) { heroMode = 'move'; showMoveRange(caster); } else { heroMode = null; }
  updateCombatStatus();

}

function castBless(caster) {
  if ((caster.spellSlots ?? 0) <= 0) return;
  playUnitAttackAnim(caster, 'spell');
  const rangeWU = atkRangeWU(SPELLS.bless.rangeFt) + 1.0;
  const targets = units.filter(u => u.team === 'blue' && u.hp > 0);

  if (!targets.length) {
    addLog(`${unitLabel(caster)}: no allies in Bless range`, 'spell');
    heroMode = null;
    updateCombatStatus();
    return;
  }

  applyBless(caster, targets);
  caster.spellSlots--;
  turnAttacked = true;
  heroMode = null;

  const names = targets.map(u => UNIT_TYPES[u.type]?.name ?? u.type).join(', ');
  addLog(`${unitLabel(caster)} casts Bless on ${names}`, 'spell');
  targets.forEach((u, i) => showBlessFloat(u, 350 + i * 110));

  updateCombatStatus();

}

function handleSneakAttackBtnClick() {
  if (isAnimating || turnAttacked) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'halfling') return;
  if (!selectedTarget || selectedTarget.team === 'blue' || selectedTarget.hp <= 0) return;

  const ux = u.grp.position.x, uz = u.grp.position.z;
  const tx = selectedTarget.grp.position.x, tz = selectedTarget.grp.position.z;
  const dx = tx - ux, dz = tz - uz;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const atks  = UNIT_TYPES[u.type]?.attacks ?? [];
  const meleeA  = atks.find(a => a.type === 'melee');
  const rangedA = atks.find(a => a.type === 'ranged');

  let atk = null;
  if (meleeA && dist <= atkTriggerWU(meleeA)) {
    atk = meleeA;
  } else if (rangedA && dist <= atkRangeWU(rangedA.range) &&
             hasLineOfSight(ux, uz, tx, tz)) {
    atk = rangedA;
  }
  if (!atk) return;

  const tgt = selectedTarget;
  turnAttacked = true;
  hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
  performAttack(u, tgt, atk);
  const rem = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
  if (rem > 0) { heroMode = 'move'; showMoveRange(u); } else { heroMode = null; }
  updateCombatStatus();
}

function handleSpellBtnClick(spellKey) {
  if (isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;
  const _spellDef  = SPELLS[spellKey];
  const _isCantrip = (_spellDef?.level ?? 1) === 0;
  if (!_isCantrip && (u.spellSlots ?? 0) <= 0) return;

  // Toggle off if already in this mode
  if (heroMode === 'spell_' + spellKey) {
    heroMode = null;
    hideHealTargets();
    hideSpellRangeRing();
    updateCombatStatus();
    return;
  }

  if (spellKey === 'bless') {
    castBless(u);
    return;
  }

  const spell = SPELLS[spellKey];
  if (spell.actionType === 'action' && turnAttacked)      return;
  if (spell.actionType === 'bonus'  && turnBonusActioned) return;

  heroMode = 'spell_' + spellKey;
  hideMoveRange();
  hideAttackTargets();
  showHealTargets(u, spellKey);

  // If a valid heal target is already selected, cast immediately
  if (selectedTarget && healTargets.has(selectedTarget)) {
    castHeal(u, selectedTarget, spellKey);
    return;
  }

  showSpellRangeRing(u, spell.rangeFt);
  updateCombatStatus();

}

// ── Dash action ───────────────────────────────────────────────────────────────

function doSprint() {
  if (isAnimating || turnAttacked) return;
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;
  turnAttacked = true;
  turnMovedFt  = 0;
  heroMode     = 'move';
  showMoveRange(u);
  addLog(`${unitLabel(u)} Dashes! Movement reset to ${UNIT_TYPES[u.type]?.speed ?? 30} ft`, 'move');
  updateCombatStatus();
}

// ── Defensive Stance (Barbarian lvl 2) ───────────────────────────────────────

function activateDefensiveStance() {
  if (isAnimating || turnBonusActioned) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'human') return;
  if (u.defStanceActive || (u.defStanceCooldown ?? 0) > 0) return;

  u.defStanceActive   = true;
  u.defStanceRounds   = 3;
  u.defStanceCooldown = 4;
  turnBonusActioned   = true;

  addLog(`${unitLabel(u)} takes a Defensive Stance! +4 AC for 3 rounds`, 'move');
  showFloatingDamage(u, '🛡 +4 AC', '#aaddff');
  updateCombatStatus();
}

// ── Mage Armor (Wizard lvl 2) ─────────────────────────────────────────────────

function showMageArmorFloat(u) {
  _fv.set(u.anchor.x, u.anchor.y + 1.6, u.anchor.z).project(camera);
  if (_fv.z >= 1) return;
  const wrap = document.createElement('div');
  wrap.className = 'mage-armor-float';
  wrap.style.left = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth) + 'px';
  wrap.style.top  = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  const icon  = document.createElement('div'); icon.className  = 'maf-icon';  icon.textContent  = '◆';
  const label = document.createElement('div'); label.className = 'maf-label'; label.textContent = `MAGE ARMOR · AC ${(u.ac ?? 12) + 3}`;
  wrap.appendChild(icon);
  wrap.appendChild(label);
  document.getElementById('app').appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('cast'));
  setTimeout(() => wrap.remove(), 2700);
}

function pulseMageArmorAura(u) {
  _fv.set(u.anchor.x, u.anchor.y + 0.7, u.anchor.z).project(camera);
  if (_fv.z >= 1) return;
  const el = document.createElement('div');
  el.className = 'mage-armor-aura';
  el.style.left = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth) + 'px';
  el.style.top  = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  document.getElementById('app').appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function activateMageArmor() {
  if (isAnimating || turnAttacked) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'elf') return;
  if ((u.spellSlots ?? 0) <= 0) return;

  u.mageArmored = true;
  u.spellSlots--;
  turnAttacked  = true;

  addLog(`${unitLabel(u)} casts Mage Armor! +3 AC (now ${(u.ac ?? 12) + 3}) until long rest`, 'spell');
  showMageArmorFloat(u);
  pulseMageArmorAura(u);
  updateCombatStatus();
}

// ── Hide (Rogue lvl 2) ────────────────────────────────────────────────────────

function activateHide() {
  if (isAnimating || turnBonusActioned) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'halfling') return;
  if ((u.hideCooldown ?? 0) > 0) return;

  const ux = u.grp.position.x, uz = u.grp.position.z;
  const hasEnemyLOS = units.some(e =>
    e.team === 'red' && e.hp > 0 && e.aggro &&
    hasLineOfSight(e.grp.position.x, e.grp.position.z, ux, uz)
  );
  if (hasEnemyLOS) {
    addLog(`${unitLabel(u)}: Can't hide — enemies have line of sight!`, 'dmg');
    return;
  }

  const def    = UNIT_TYPES[u.type] ?? {};
  const dexMod = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
  const stealth = Math.floor(Math.random() * 20) + 1 + dexMod;

  turnBonusActioned = true;
  u.hideCooldown    = 2;

  if (stealth >= 10) {
    u.hideRoll = stealth;
    setUnitStealth(u, true);
    addLog(`${unitLabel(u)} hides! Stealth ${stealth} — enemies need ${stealth}+ to spot you`, 'move');
    showFloatingDamage(u, `HIDDEN (${stealth})`, '#44ff88');
  } else {
    addLog(`${unitLabel(u)}: Hide failed! (Stealth ${stealth} vs DC 10)`, 'dmg');
    showFloatingDamage(u, `HIDE FAIL (${stealth})`, '#ff6644');
  }
  updateCombatStatus();
}

function _checkHidePerception(hero) {
  if (!hero.stealthed || hero.team !== 'blue') return;
  const hx = hero.grp.position.x, hz = hero.grp.position.z;
  for (const e of units) {
    if (e.team !== 'red' || e.hp <= 0 || !e.aggro) continue;
    if (!hasLineOfSight(e.grp.position.x, e.grp.position.z, hx, hz)) continue;
    const def        = UNIT_TYPES[e.type] ?? {};
    const wisMod     = Math.floor(((def.abilities?.wis ?? 10) - 10) / 2);
    const dx = hx - e.grp.position.x, dz = hz - e.grp.position.z;
    const distFt     = Math.sqrt(dx * dx + dz * dz) * (GRID_SQUARE_FEET / WORLD_UNITS_PER_SQUARE);
    const distPenalty = Math.floor(distFt / 5);
    const percRoll   = Math.floor(Math.random() * 20) + 1 + wisMod - distPenalty;
    if (percRoll >= (hero.hideRoll ?? 10)) {
      setUnitStealth(hero, false);
      addLog(`${unitLabel(e)} spots ${unitLabel(hero)}! Stealth broken (Perception ${percRoll} vs Stealth ${hero.hideRoll})`, 'dmg');
      showFloatingDamage(hero, 'SPOTTED!', '#ff4444');
      return;
    }
  }
}

// ── Rage ─────────────────────────────────────────────────────────────────────

function activateRage(u) {
  u.raging     = true;
  u.rageRounds = UNIT_TYPES[u.type].rage.duration;
  u.rageUses--;
  turnBonusActioned = true;
  playSound('berserker_rage');
  showFloatingDamage(u, '⚔ RAGE!', '#ff6622');
  addLog(`${unitLabel(u)} enters RAGE! (+2 melee dmg · resist phys dmg)`, 'spell');
  const rem = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
  if (rem > 0) { heroMode = 'move'; showMoveRange(u); } else { heroMode = null; }
  updateCombatStatus();
}

function handleRageBtnClick() {
  if (isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || !UNIT_TYPES[u.type]?.rage) return;
  if ((u.rageUses ?? 0) <= 0 || u.raging || turnBonusActioned) return;
  activateRage(u);
}

// ── Elf (Rasec) spell casting ─────────────────────────────────────────────────

function showMagicMissileTargets(caster) {
  hideAttackTargets();
  if (turnAttacked) return;
  const rangeWU = atkRangeWU(ELF_SPELLS.magic_missile.rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  let ri = 0;
  units.filter(e => e.team !== caster.team && e.hp > 0).forEach(enemy => {
    if (ri >= MAX_ATK_RINGS) return;
    const dx = enemy.grp.position.x - ux, dz = enemy.grp.position.z - uz;
    if (Math.sqrt(dx * dx + dz * dz) > rangeWU) return;
    if (!hasLineOfSight(ux, uz, enemy.grp.position.x, enemy.grp.position.z)) return;
    const ring = atkRings[ri++];
    ring.material.color.set(0x9944ff);
    ring.position.set(enemy.grp.position.x, enemy.grp.position.y + 0.07, enemy.grp.position.z);
    ring.visible = true;
    atkTargets.set(enemy, 'magic_missile');
  });
}

function castMagicMissile(caster, target) {
  const spell = ELF_SPELLS.magic_missile;
  if ((caster.spellSlots ?? 0) <= 0) return;
  faceTarget(caster, target);
  playUnitAttackAnim(caster, 'ranged');
  hideAttackTargets();
  hideSpellRangeRing();
  heroMode = null;
  caster.spellSlots--;
  turnAttacked = true;

  const postSpellRemaining = (UNIT_TYPES[caster.type]?.speed ?? 30) - turnMovedFt;
  if (postSpellRemaining > 0) { heroMode = 'move'; showMoveRange(caster); }

  const darts = Array.from({ length: spell.darts }, () =>
    roll({ sides: spell.sides, modifier: spell.flatBonus })
  );
  const totalDmg = darts.reduce((s, r) => s + r.total, 0);

  // Show dart rolls staggered to match missile launch cadence
  darts.forEach((r, i) => {
    setTimeout(() => showRoll(`${unitLabel(caster)}  →  ${unitLabel(target)}  ·  Missile ${i + 1}`, r, { autoDismiss: false, skip3D: true }), i * 380);
  });

  // Visual — 4 neon purple arrows; damage applies when last bolt lands
  playMagicMissileEffect(caster, target, () => {
    target.aggro = true;
    buildTurnList();
    target.hp = Math.max(0, target.hp - totalDmg);
    target.barShowUntil = Date.now() + 5000;
    const dartStr = darts.map(r => r.total).join('+');
    showFloatingDamage(target, `-${totalDmg}`, '#aa66ff');
    addLog(`${unitLabel(caster)} casts Magic Missile → ${unitLabel(target)}: ${dartStr} = ${totalDmg} force dmg`, 'spell');
    if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target), 400);
  });

  updateCombatStatus();
}

function castSleep(caster) {
  const spell = ELF_SPELLS.sleep;
  if ((caster.spellSlots ?? 0) <= 0) return;
  playUnitAttackAnim(caster, 'ranged');
  caster.spellSlots--;
  turnAttacked = true;
  heroMode = null;


  const rangeWU = atkRangeWU(spell.rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  const inRange = units
    .filter(e => e.team !== caster.team && e.hp > 0 && !sleepingUnits.has(e))
    .filter(e => {
      const dx = e.grp.position.x - ux, dz = e.grp.position.z - uz;
      return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
    })
    .sort((a, b) => a.hp - b.hp);

  const poolResult = roll({ sides: spell.poolSides, count: spell.poolDice });
  showRoll(`${unitLabel(caster)}  ·  Sleep`, poolResult, { autoDismiss: false });
  addLog(`${unitLabel(caster)} casts Sleep (${poolResult.total} HP pool)`, 'spell');

  let remaining = poolResult.total;
  const slept   = [];
  for (const enemy of inRange) {
    if (enemy.hp <= remaining) {
      remaining -= enemy.hp;
      slept.push(enemy);
    }
  }

  if (slept.length === 0) {
    addLog('  Sleep: no enemies affected (pool too low)', 'spell');
  } else {
    slept.forEach((e, i) => {
      setTimeout(() => {
        if (!units.includes(e) || e.hp <= 0) return;
        applySleep(e, spell.duration ?? 10);
        showFloatingDamage(e, '💤 SLEEP', '#cc88ff');
        addLog(`  💤 ${unitLabel(e)} falls asleep! (${e.hp} HP consumed from pool)`, 'spell');
      }, i * 350 + 700);
    });
  }

  updateCombatStatus();

}

function castBurningHands(caster) {
  const spell = ELF_SPELLS.burning_hands;
  if ((caster.spellSlots ?? 0) <= 0) return;
  playUnitAttackAnim(caster, 'ranged');
  caster.spellSlots--;
  turnAttacked = true;
  heroMode = null;

  playSleepEffect(caster);

  const rangeWU = atkRangeWU(spell.rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  const targets = units.filter(e => {
    if (e.team === caster.team || e.hp <= 0) return false;
    const dx = e.grp.position.x - ux, dz = e.grp.position.z - uz;
    return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
  });

  const dmgResult = roll({ sides: spell.sides, count: spell.dice });
  showRoll(`${unitLabel(caster)}  ·  Burning Hands`, dmgResult, { autoDismiss: false });
  addLog(`${unitLabel(caster)} casts Burning Hands (DEX DC ${spell.saveDC})`, 'spell');

  if (targets.length === 0) {
    addLog('  Burning Hands: no enemies in range', 'spell');
  } else {
    targets.forEach((target, i) => {
      setTimeout(() => {
        const dexMod = Math.floor(((UNIT_TYPES[target.type]?.abilities?.dex ?? 10) - 10) / 2);
        const saveResult = roll({ sides: 20, modifier: dexMod });
        const saved = saveResult.total >= spell.saveDC;
        const dmg = saved ? Math.max(1, Math.floor(dmgResult.total / 2)) : dmgResult.total;
        target.aggro = true;
        buildTurnList();
        target.hp = Math.max(0, target.hp - dmg);
        target.barShowUntil = Date.now() + 5000;
        showFloatingDamage(target, `-${dmg}${saved ? ' ½' : ''}`, '#ff6622');
        addLog(`  ${unitLabel(target)}: ${saved ? 'saves' : 'fails'} DEX → ${dmg} fire dmg`, 'spell');
        if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target), 400);
      }, i * 700 + 1000);
    });
  }

  updateCombatStatus();

}

function handleElfSpellBtnClick(spellKey) {
  if (isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'elf') return;
  if ((u.spellSlots ?? 0) <= 0 || turnAttacked) return;

  if (spellKey === 'magic_missile') {
    if (heroMode === 'elfatk_magic_missile') {
      heroMode = null;
      hideCastConfirm();
      hideAttackTargets();
      hideSpellRangeRing();
      const cancelRemaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
      if (cancelRemaining > 0) { heroMode = 'move'; showMoveRange(u); }
      updateCombatStatus();
      return;
    }
    heroMode = 'elfatk_magic_missile';
    hideMoveRange();
    hideHealTargets();
    showMagicMissileTargets(u);
    showSpellRangeRing(u, ELF_SPELLS.magic_missile.rangeFt);
    updateCombatStatus();
  
  } else if (spellKey === 'sleep') {
    castSleep(u);
  } else if (spellKey === 'burning_hands') {
    castBurningHands(u);
  }
}

// ── Combat status bar ─────────────────────────────────────────────────────────

function updateCombatStatus() {
  const u = turnOrder[turnIndex];
  if (!combatPhase || !u) return;
  const speedFt  = UNIT_TYPES[u.type]?.speed ?? 30;
  const remainFt = Math.max(0, speedFt - turnMovedFt);
  const p = u.team;
  const hudMoveEl = document.getElementById(`${p}-hud-move`);
  if (hudMoveEl) hudMoveEl.textContent = remainFt > 0 ? `${remainFt} ft` : 'done';

  refreshHeroSpellPanel(u, document.getElementById('blue-spell-panel'),
    { turnAttacked, turnBonusActioned, heroMode });
  // ── Action tracker bar ────────────────────────────────────────────────
  const tracker = document.getElementById('action-tracker');
  if (tracker) {
    if (p === 'blue') {
      tracker.style.display = 'grid';
      const moveBox = document.getElementById('act-move-box');
      const moveVal = document.getElementById('act-move-val');
      if (moveVal) moveVal.textContent = String(remainFt);
      if (moveBox) {
        moveBox.classList.toggle('act-done', remainFt === 0);
        moveBox.classList.toggle('act-low',  remainFt > 0 && remainFt < speedFt / 2);
      }
      const actBox = document.getElementById('act-action-box');
      if (actBox) actBox.classList.toggle('act-used', !!turnAttacked);
      const bonBox = document.getElementById('act-bonus-box');
      if (bonBox) bonBox.classList.toggle('act-used', !!turnBonusActioned);
    } else {
      tracker.style.display = 'none';
    }
  }

  updateHotkeyRanges();
}


// ── Floating damage label ─────────────────────────────────────────────────────

const _fv = new THREE.Vector3();

export function showCenterAlert(text, color = '#ff4400') {
  const el = document.createElement('div');
  el.className   = 'center-alert';
  el.textContent = text;
  el.style.color = color;
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 2200);
}

export function showFloatingDamage(u, text, color) {
  _fv.set(u.anchor.x, u.anchor.y + 0.5, u.anchor.z).project(camera);
  if (_fv.z >= 1) return;
  const el = document.createElement('div');
  el.className = 'dmg-float';
  el.textContent = text;
  el.style.color = color;
  el.style.left  = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  el.style.top   = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 4500);
}

function showBlessFloat(u, delay = 0) {
  setTimeout(() => {
    _fv.set(u.anchor.x, u.anchor.y + 1.8, u.anchor.z).project(camera);
    if (_fv.z >= 1) return;
    const el = document.createElement('div');
    el.className = 'bless-float';
    el.textContent = '✚';
    el.style.left = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth) + 'px';
    el.style.top  = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
    document.getElementById('app').appendChild(el);
    requestAnimationFrame(() => el.classList.add('pulse'));
    setTimeout(() => el.remove(), 2200);
  }, delay);
}

// ── XP system — see js/progression.js ───────────────────────────────────────

// ── Shared combat teardown ─────────────────────────────────────────────────────

function _teardownCombat() {
  combatPhase = false;
  heroMode    = null;
  isAnimating = false;
  setFollowUnit(null);
  clearBless();
  for (const [, state] of sleepingUnits) state.zzzEl?.remove();
  sleepingUnits.clear();
  units.forEach(u => { u.barForced = false; u.barShowUntil = 0; });
  endTurnBtn.disabled    = true;
  activeRing.visible     = false;
  meleeRangeRing.visible = false;
  rangedRangeRing.visible = false;
  hideTargetingLine();
  hideMoveRange();
  hideAttackTargets();
  hideTargetMarker();
  hideUndoBtn();
  hideSelectionHighlight();
  clearRollFeed();
  clearAllHotkeys();
  const trackerEl = document.getElementById('action-tracker');
  if (trackerEl) trackerEl.style.display = 'none';
  document.getElementById('turn-panel').style.display = 'none';
}

// All aggro'd threats defeated — return to free-roam without a terminal banner.
function exitCombat() {
  _teardownCombat();
  stopCombatMusic();
  addLog('All threats cleared.', 'round');
  // combat:ended fires immediately so game-state listeners (precombat, army, etc.) respond at once.
  window.dispatchEvent(new CustomEvent('combat:ended'));
  // Narrative post-combat sequence (loot → Dagna if hero died → zone events).
  // Handlers run in priority order; each calls done() to advance, or omits it to terminate.
  runPostCombat({ isVictory: true });
}

// ── Defeat ────────────────────────────────────────────────────────────────────

function endBattle(outcome) {
  _teardownCombat();
  stopCombatMusic();
  addLog('THE HEROES HAVE FALLEN', 'round');
  onCombatEnd();
  window.dispatchEvent(new CustomEvent('zone:defeat'));
}

function removeDefeatedUnit(u) {
  if (u === selectedTarget) hideTargetMarker();
  // Clean up sleep state if the unit dies while sleeping
  if (sleepingUnits.has(u)) {
    sleepingUnits.get(u)?.zzzEl?.remove();
    sleepingUnits.delete(u);
  }
  addLog(`✦ ${unitLabel(u)} is defeated!`, 'defeat');
  playSound('death');
  if (u.team === 'red') {
    const reward = UNIT_TYPES[u.type]?.xpReward ?? 0;
    if (reward > 0) awardXP(reward, addLog);
    onEnemyKilled(u);
    const cr   = ENEMY_CR[u.type] ?? 0;
    const loot = rollLoot(cr);
    spawnLootOrb(u.grp.position, loot);
    window.dispatchEvent(new CustomEvent('enemy:looted', {
      detail: { enemyName: UNIT_TYPES[u.type]?.name ?? u.type, coins: loot.coins, items: loot.items },
    }));
  }
  if (u.team === 'blue') onHeroDied(u);
  if (u.mixer) {
    playUnitDeathAnim(u);  // animated units leave a corpse; death anim plays and holds last frame
  } else {
    scene.remove(u.grp);   // non-animated units vanish as before
  }
  u.barEl.remove();

  const ui = units.indexOf(u);
  if (ui >= 0) units.splice(ui, 1);

  const ti = turnOrder.indexOf(u);
  if (ti >= 0) {
    turnOrder.splice(ti, 1);
    if (ti < turnIndex) turnIndex--;
  }

  buildTurnList();
  document.querySelectorAll('.turn-entry').forEach(el =>
    el.classList.toggle('active', +el.dataset.ti === turnIndex)
  );

  if (!units.some(x => x.team === 'red' && x.aggro) && !_pendingSpawnCheckFn()) {
    exitCombat();
    return;
  }
  if (!units.some(x => x.team === 'blue')) { endBattle('defeat'); return; }

}

// ── Combat log ────────────────────────────────────────────────────────────────

export function unitLabel(u) {
  const peers = units.filter(x => x.team === u.team && x.type === u.type);
  const num   = peers.indexOf(u) + 1;
  const name  = UNIT_TYPES[u.type]?.name ?? u.type;
  return peers.length > 1 ? `${name} ${num}` : name;
}

const _HERO_COLORS = { Rasec: '#cc55ee', Leugren: '#c8860a', Gobo: '#5577ee', Milo: '#44dd66' };
const _HERO_RE     = /\b(Rasec|Leugren|Gobo|Milo)\b/g;

function _formatLog(text) {
  const esc = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc.replace(_HERO_RE, n => `<b style="color:${_HERO_COLORS[n]}">${n}</b>`);
}

export function addLog(text, cls = '') {
  const el = document.getElementById('log-entries');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'log-entry' + (cls ? ' log-' + cls : '');
  div.innerHTML = _formatLog(text);
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ── Attack execution ──────────────────────────────────────────────────────────

// Returns the "level" value fed into rollToHit.
// Heroes: actual character level (1–100) so the formula's tier scaling is meaningful.
// Enemies: profBonus tier (2–6) which maps to CR — treated as their power tier directly.
function unitCombatLevel(u) {
  if (u.team === 'blue') return u.level ?? 1;
  // CR → tier: all fractions < 1 ceil to 1; CR 2 → 2; CR 3 → 3; etc.
  const cr = ENEMY_CR[u.type] ?? 1;
  return Math.max(1, Math.ceil(cr));
}

// Percentage-based hit resolution.
//   Hit% = ((AtkBonus + 20 − DefAC) / 20) × 100 + (((AtkLvl/5)+1) − DefLvl) × 3  [clamped 15–85]
//   Base term mirrors d20 math: each ±1 attack/AC point = ±5%. Baseline atkBonus=5 vs AC=15 → 55%.
//   Level term: hero power tier (1 tier per 5 levels) vs enemy tier (profBonus); ±3% per tier gap.
//   Roll 1d100 high to hit: need ≥ (100 − Hit%); 96-100 → automatic crit.
//   Advantage: keep higher die. Disadvantage: keep lower die.
function rollToHit(atkBonus, defAC, atkLvl, defLvl, mode = 'normal') {
  const rawPct    = ((atkBonus + 20 - defAC) / 20) * 100 + (((atkLvl / 5) + 1) - defLvl) * 3;
  const hitChance = Math.round(Math.max(15, Math.min(85, rawPct)));
  const threshold = 100 - hitChance;

  const r1 = Math.floor(Math.random() * 100) + 1;
  let r2 = null, kept;
  if (mode === 'advantage') {
    r2   = Math.floor(Math.random() * 100) + 1;
    kept = Math.max(r1, r2);
  } else if (mode === 'disadvantage') {
    r2   = Math.floor(Math.random() * 100) + 1;
    kept = Math.min(r1, r2);
  } else {
    kept = r1;
  }

  const isCrit = kept >= 96;
  return { dice: r2 !== null ? [r1, r2] : [r1], kept, mode, hitChance, threshold, isHit: kept >= threshold || isCrit, isCrit };
}

function faceTarget(unit, target) {
  const dx = target.grp.position.x - unit.grp.position.x;
  const dz = target.grp.position.z - unit.grp.position.z;
  unit.grp.rotation.y = Math.atan2(dx, dz);
}

// Ranged attacks show a targeting line first; melee fires immediately.
// Fire Bolt (elf) gets the full cinematic particle effect instead.
function performAttack(attacker, target, atk) {
  // If this attacker is the delay-interrupt hero, end the interrupt after the attack resolves.
  // Capture the context reference so a later hero's interrupt isn't accidentally closed.
  if (_delayCtx && attacker === turnOrder[turnIndex]) {
    const _myCtx = _delayCtx;
    _delayAutoCloseTimer = setTimeout(() => { if (_delayCtx === _myCtx) _endDelayInterrupt(); }, 2600);
  }
  faceTarget(attacker, target);
  playUnitAttackSound(attacker.type);
  if (atk.type === 'ranged') {
    _consumeAtkQty(attacker, atk);
    if (attacker.type === 'elf' && atk.name === 'Fire Bolt') {
      playUnitAttackAnim(attacker, 'ranged');
      playFireboltEffect(attacker, target, () => _executeAttack(attacker, target, atk));
    } else {
      // Arrow launches after the ranged animation finishes; all subsequent
      // events (dice rolls, damage display) cascade from the arrow's onImpact callback.
      playUnitAttackAnim(attacker, 'ranged', () => {
        const delay = getUnitAttackDuration(attacker.type) * 1000;
        setTimeout(() => playSound('range_attack_bow'), delay);
        fireRangedAttack(attacker, target, () => _executeAttack(attacker, target, atk));
      });
    }
  } else {
    const delay = getUnitAttackDuration(attacker.type) * 1000;
    setTimeout(() => playSound('sword_swing'), delay);
    playUnitAttackAnim(attacker, 'melee', () => _executeAttack(attacker, target, atk));
  }
}

// Enemy damage: orig avg × mult (1.2 for CR 1/8,1/4,1; 1.4 otherwise), ±20% low-variance range. Crits roll the range twice.
// Enemy damage multiplier by XP reward (maps to CR tier)
// Standard D&D damage roll. Crits double the dice count (modifier rolled once).
function rollDnDDamage(atk, dmgMod, isCrit) {
  const count = isCrit ? (atk.dice ?? 1) * 2 : (atk.dice ?? 1);
  return roll({ sides: atk.sides, count, modifier: dmgMod });
}

function dmgBreakdown(r) {
  if (r.isScaled) {
    const rangeStr = `${r.min}–${r.max}`;
    return r.isCrit ? `CRIT 2×[${rangeStr}] = ${r.total}` : `[${rangeStr}] → ${r.total}`;
  }
  const mod      = r.modifier;
  const diceStr  = r.count > 1 ? `[${r.dice.join('+')}]` : String(r.dice[0]);
  const modPart  = mod > 0 ? ` +${mod}` : mod < 0 ? ` ${mod}` : '';
  const needsSum = r.count > 1 || mod !== 0;
  const sumPart  = needsSum ? ` = ${r.total}` : '';
  return `${r.count}d${r.sides}: ${diceStr}${modPart}${sumPart}`;
}

function atkBreakdown(r) {
  const adv    = r.mode === 'advantage' ? 'ADV ' : r.mode === 'disadvantage' ? 'DIS ' : '';
  const dieStr = r.mode !== 'normal' ? `[${r.dice.join('/')} → ${r.kept}]` : String(r.kept);
  return `${adv}d100 rolled ${dieStr}, needed ≥ ${r.threshold}`;
}

function _executeAttack(attacker, target, atk) {
  const def     = UNIT_TYPES[attacker.type] ?? {};
  const ab      = def.abilities ?? {};
  const statMod = Math.floor(((ab[atk.statMod] ?? 10) - 10) / 2);
  // dmgBonus on attack overrides stat-derived damage mod (e.g. spell cantrips)
  const baseDmgMod   = atk.dmgBonus !== undefined ? atk.dmgBonus : statMod;
  const rageDmgBonus = (attacker.raging && atk.type === 'melee' && UNIT_TYPES[attacker.type]?.rage)
    ? (UNIT_TYPES[attacker.type].rage.dmgBonus ?? 0) : 0;
  const dmgMod  = baseDmgMod + rageDmgBonus;
  const atkMod  = statMod + (def.profBonus ?? 0);

  const blessBonus = blessedUnits.has(attacker) ? roll({ sides: 4 }).total : 0;

  // Long-range shot: beyond normal range but within longRange → disadvantage
  let atkMode = 'normal';
  if (atk.type === 'ranged' && atk.longRange) {
    const rdx = target.grp.position.x - attacker.grp.position.x;
    const rdz = target.grp.position.z - attacker.grp.position.z;
    if (Math.sqrt(rdx * rdx + rdz * rdz) > atkRangeWU(atk.range)) atkMode = 'disadvantage';
  }

  const _acBonus  = (target.defStanceActive ? 4 : 0) + (target.mageArmored ? 3 : 0);
  const targetAC  = (UNIT_TYPES[target.type]?.ac ?? COMBAT.defaultAC) + _acBonus;
  const atkResult = rollToHit(atkMod + blessBonus, targetAC, unitCombatLevel(attacker), unitCombatLevel(target), atkMode);
  const aLabel    = unitLabel(attacker), tLabel = unitLabel(target);

  let rollLabel = `${aLabel}  →  ${tLabel}  ·  ${atk.name}`;
  if (atkMode === 'disadvantage') rollLabel += '  (long range)';
  if (blessBonus > 0)             rollLabel += `  ✦+${blessBonus}`;

  const D            = 0;
  const FAST_ROLL_MS = 0;
  const FAST_SETTLE  = 0;
  const SLOW_SETTLE  = 0;
  const BANNER_MS    = 0;
  const RESULT_PAUSE = 0;

  setTimeout(() => showRoll(rollLabel, atkResult, { autoDismiss: false }), D);

  const hit = atkResult.isHit;
  const modStr = dmgMod >= 0 ? `+${dmgMod}` : `${dmgMod}`;

  if (!hit) {
    setTimeout(() => {
      playSound('miss');
      addLog(`${aLabel} misses ${tLabel} with ${atk.name} (${atkBreakdown(atkResult)})`, 'miss');
      showFloatingDamage(target, 'MISS', '#999999');
      _logAtkQtyMsg(attacker, atk);
    }, D + FAST_ROLL_MS);
    return;
  }


  if (attacker.stealthed) {
    setUnitStealth(attacker, false);
    addLog(`${unitLabel(attacker)} breaks stealth with the attack!`, 'move');
  }

  const sneakDef  = UNIT_TYPES[attacker.type]?.sneakAttack;
  const doSneak   = sneakDef && !sneakAttackUsed && hasSneakAttackCondition(attacker, atkResult);

  const isCrit    = atkResult.isCrit;
  const dmgResult = rollDnDDamage(atk, dmgMod, isCrit);
  setTimeout(() => showRoll('Damage', dmgResult, { autoDismiss: false }), D + 800);

  let sneakResult = null;
  if (doSneak) {
    sneakAttackUsed = true;
    sneakResult     = rollDnDDamage(sneakDef, 0, isCrit);
    setTimeout(() => showRoll('Sneak Attack!', sneakResult, { autoDismiss: false }), D + 1400);
  }

  const dmg      = Math.max(1, dmgResult.total);
  const sneakDmg = sneakResult ? Math.max(0, sneakResult.total) : 0;
  const totalRaw = dmg + sneakDmg;
  const resisted = !!(target.raging && UNIT_TYPES[target.type]?.rage);
  const finalDmg = resisted ? Math.max(1, Math.floor(totalRaw / 2)) : totalRaw;

  // When the damage-roll dice settle and display their number on screen.
  // If a sneak roll follows, the dmg roll plays fast; otherwise it is last (slow).
  const dmgSettleDelay = D + FAST_ROLL_MS + BANNER_MS + (doSneak ? FAST_SETTLE : SLOW_SETTLE);

  // When the sneak-roll dice settle (always slow — it is always last in the queue).
  const sneakSettleDelay = doSneak
    ? D + FAST_ROLL_MS + BANNER_MS + FAST_ROLL_MS + SLOW_SETTLE
    : 0;

  // HP update fires after ALL relevant dice have settled:
  // no-sneak → after damage roll; sneak → after sneak roll.
  const hpUpdateDelay = doSneak ? sneakSettleDelay : dmgSettleDelay;

  // Capture whether the target will die so we can schedule removal after the
  // async HP update (target.hp still holds the old value until that fires).
  const willDie = target.hp <= finalDmg;

  // Apply damage, show bar, wake sleepers — after dice result + reading pause
  setTimeout(() => {
    target.aggro = true;
    target.hp = Math.max(0, target.hp - finalDmg);
    target.barShowUntil = Date.now() + 5000;
    buildTurnList();
    if (sleepingUnits.has(target)) wakeUnit(target, 'damage');
  }, hpUpdateDelay + RESULT_PAUSE);

  // Hit log + floating damage + damage log — after damage dice settle + reading pause
  setTimeout(() => {
    if (isCrit) {
      addLog(`${aLabel} CRITS ${tLabel} with ${atk.name}! (d100 rolled ${atkResult.kept} — auto-crit!)`, 'crit');
    } else {
      addLog(`${aLabel} hits ${tLabel} with ${atk.name} (${atkBreakdown(atkResult)})`, 'hit');
    }
    playSound(atk.type === 'ranged' ? 'arrow_hit' : 'sword_hit');
    showFloatingDamage(target, `-${dmg}`, '#ff4422');
    addLog(`  ${dmg} damage (${dmgBreakdown(dmgResult)})`, 'dmg');
  }, dmgSettleDelay + RESULT_PAUSE);

  if (doSneak) {
    setTimeout(() => {
      showFloatingDamage(target, `⚡+${sneakDmg} SNEAK`, '#ffdd44');
      addLog(`  ⚡ Sneak Attack! +${sneakDmg} (${dmgBreakdown(sneakResult)})`, 'dmg');
    }, sneakSettleDelay + RESULT_PAUSE);
  }

  if (resisted) {
    setTimeout(() => {
      showFloatingDamage(target, `⚔ RAGE ½`, '#ff8844');
      addLog(`  ⚔ Rage resistance: ${totalRaw} → ${finalDmg}`, 'dmg');
    }, hpUpdateDelay + RESULT_PAUSE + 500);
  }

  if (willDie) {
    setTimeout(() => removeDefeatedUnit(target), hpUpdateDelay + RESULT_PAUSE + 400);
  }

  // Ammo-remaining message fires after all damage/effect lines settle
  const _qtyDelay = resisted
    ? hpUpdateDelay + RESULT_PAUSE + 550
    : hpUpdateDelay + RESULT_PAUSE + 50;
  setTimeout(() => _logAtkQtyMsg(attacker, atk), _qtyDelay);
}

// ── Target selection overlay ──────────────────────────────────────────────────

let selectedTarget    = null;
let selectedTargetAtk = null;
const _tv               = new THREE.Vector3();
const targetMarkerEl    = document.getElementById('target-marker');
const targetNameEl      = document.getElementById('target-name');
const attackConfirmWrap = document.getElementById('attack-confirm-wrap');
const attackConfirmBtn  = document.getElementById('attack-confirm-btn');
const shakeAwakeBtn     = document.getElementById('shake-awake-btn');
const castConfirmWrap   = document.getElementById('cast-confirm-wrap');
const castConfirmBtn    = document.getElementById('cast-confirm-btn');

let _pendingSpellCast = null;  // { castFn, spellName } | null


function showTargetMarker(enemy) {
  if (selectedTarget && selectedTarget !== enemy) selectedTarget.barForced = false;
  selectedTarget = enemy;
  enemy.barForced = true;
  targetNameEl.textContent = unitLabel(enemy);

  const u = combatPhase ? turnOrder[turnIndex] : null;
  if (u?.team === 'blue') {
    const def  = UNIT_TYPES[u.type] ?? {};
    const ab   = def.abilities ?? {};
    const dx   = enemy.grp.position.x - u.grp.position.x;
    const dz   = enemy.grp.position.z - u.grp.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const los  = hasLineOfSight(u.grp.position.x, u.grp.position.z,
                                enemy.grp.position.x, enemy.grp.position.z);
    const eligible = (def.attacks ?? [])
      .filter(a => dist <= atkTriggerWU(a) && (a.type === 'melee' || (los && atkHasQty(u, a))))
      .sort((a, b) => a.range - b.range);

    selectedTargetAtk = eligible[0] ?? null;
  } else {
    selectedTargetAtk = null;
  }
  attackConfirmWrap.style.display = 'none';

  targetMarkerEl.style.display = 'block';
  showTargetWindow(enemy);
  if (combatPhase) updateCombatStatus();
}

function hideTargetMarker() {
  if (selectedTarget) selectedTarget.barForced = false;
  selectedTarget    = null;
  selectedTargetAtk = null;
  targetMarkerEl.style.display    = 'none';
  attackConfirmWrap.style.display = 'none';
  attackConfirmBtn.style.display  = '';
  shakeAwakeBtn.style.display     = 'none';
  hideTargetWindow();
  if (combatPhase) updateCombatStatus();
}

// ── Spell-target confirm (enemy targeted while a spell is selected) ─────────
function showCastConfirm(target, spellName, castFn) {
  _pendingSpellCast = { castFn, spellName };

  // Highlight the target with the existing ! marker
  if (selectedTarget && selectedTarget !== target) selectedTarget.barForced = false;
  selectedTarget = target;
  target.barForced = true;
  targetNameEl.textContent        = unitLabel(target);
  attackConfirmWrap.style.display = 'none';
  targetMarkerEl.style.display    = 'block';

  // Show Cast button at the bottom of the screen
  castConfirmBtn.textContent      = `Cast ${spellName}`;
  castConfirmWrap.style.display   = 'block';
  showTargetWindow(target);
}

function hideCastConfirm() {
  _pendingSpellCast             = null;
  castConfirmWrap.style.display = 'none';
}

castConfirmBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!_pendingSpellCast || isAnimating) return;
  const { castFn } = _pendingSpellCast;
  hideCastConfirm();
  castFn();
});

export function trackTargetUI() {
  // Keep pink ring locked on selectedTarget when cursor isn't hovering anything
  if (!_ringHoverActive) {
    const canRing = combatPhase && !isAnimating && turnOrder[turnIndex]?.team === 'blue';
    if (canRing && selectedTarget && selectedTarget.hp > 0) {
      const tx = selectedTarget.grp.position.x, tz = selectedTarget.grp.position.z;
      if (tx !== _hoverRingTx || tz !== _hoverRingTz) {
        _hoverRingTx = tx; _hoverRingTz = tz;
        const old = hoverRing.geometry;
        hoverRing.geometry = buildHoverRingGeo(tx, tz);
        old.dispose();
      }
      hoverRing.material.color.setHex(0xff44ff);
      hoverRing.position.set(tx, 0, tz);
      hoverRing.visible = true;
    } else {
      hoverRing.visible = false;
    }
  }

  if (!selectedTarget) return;
  updateTargetWindowHP(selectedTarget);
  _tv.set(selectedTarget.anchor.x, selectedTarget.anchor.y + 0.3, selectedTarget.anchor.z)
     .project(camera);
  if (_tv.z >= 1) {
    targetMarkerEl.style.display    = 'none';
    attackConfirmWrap.style.display = 'none';
    return;
  }
  const cw = renderer.domElement.clientWidth, ch = renderer.domElement.clientHeight;
  const sx = ((_tv.x * 0.5 + 0.5) * cw) + 'px';
  const sy = ((-_tv.y * 0.5 + 0.5) * ch) + 'px';
  targetMarkerEl.style.left    = sx;
  targetMarkerEl.style.top     = sy;
  targetMarkerEl.style.display = 'block';
}

attackConfirmBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!selectedTarget || !selectedTargetAtk || isAnimating || turnAttacked) return;
  const u = turnOrder[turnIndex];
  if (!u) return;
  const tgt = selectedTarget;
  const atk = selectedTargetAtk;
  turnAttacked = true;
  hideUndoBtn();
  hideAttackTargets();
  hideTargetMarker();
  performAttack(u, tgt, atk);
  const postAtkRemaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
  if (postAtkRemaining > 0) {
    heroMode = 'move';
    showMoveRange(u);
  } else {
    heroMode = null;
  }
  updateCombatStatus();
});

shakeAwakeBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (!selectedTarget || isAnimating || turnAttacked) return;
  if (!sleepingUnits.has(selectedTarget)) return;
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;
  const tgt = selectedTarget;
  turnAttacked = true;
  faceTarget(u, tgt);
  hideUndoBtn();
  hideAttackTargets();
  hideTargetMarker();
  addLog(`${unitLabel(u)} shakes ${unitLabel(tgt)} awake! (action spent)`, 'spell');
  wakeUnit(tgt);
  const shakeRemaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
  if (shakeRemaining > 0) {
    heroMode = 'move';
    showMoveRange(u);
  } else {
    heroMode = null;
  }
  updateCombatStatus();
});

document.addEventListener('keydown', e => {
  if (!combatPhase || isAnimating) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'Escape') {
    if (selectedTarget) hideTargetMarker();
    return;
  }

  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;

  if (e.key === 'w' || e.key === 'W') {
    // Halfling and human have W bound via hotbar for Sneak Attack / Rage
    if (u.type === 'halfling' || u.type === 'human') return;
    const remaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
    if (remaining <= 0) return;
    heroMode = 'move';
    hideAttackTargets();
    hideHealTargets();
    hideTargetMarker();
    showMoveRange(u);

  }

});

// ── Raycaster ─────────────────────────────────────────────────────────────────

const _ray   = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

function groundHit(clientX, clientY) {
  _mouse.x =  (clientX / window.innerWidth)  * 2 - 1;
  _mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  _ray.setFromCamera(_mouse, camera);
  const hits = _ray.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// Reuses _ray from the most recent groundHit call.
// Returns the first unit in candidateMap whose 3D model the ray intersects.
function rayHitUnit(candidateMap) {
  for (const [target] of candidateMap) {
    if (_ray.intersectObject(target.grp, true).length) return target;
  }
  return null;
}

// ── Left-click: spell casts (blue turn only) → general unit targeting ────────

renderer.domElement.addEventListener('click', e => {
  if (isAnimating) return;

  const pt  = groundHit(e.clientX, e.clientY);  // also primes _ray

  // Spell-cast modes — only active during the blue hero's combat turn
  if (combatPhase) {
    const u = turnOrder[turnIndex];
    if (u?.team === 'blue') {
      if (heroMode === 'elfatk_magic_missile' && !turnAttacked) {
        const meshHit = rayHitUnit(atkTargets);
        if (meshHit) {
          castMagicMissile(u, meshHit);
          return;
        }
        if (pt) for (const [target] of atkTargets) {
          const dx = target.grp.position.x - pt.x;
          const dz = target.grp.position.z - pt.z;
          if (dx * dx + dz * dz < INTERACTION.pickRadiusSq * 2.5) {
            castMagicMissile(u, target);
            return;
          }
        }
        hideCastConfirm();
        heroMode = null;
        hideAttackTargets();
        updateCombatStatus();
        return;
      }

      if (heroMode?.startsWith('spell_')) {
        const spellKey  = heroMode.slice(6);
        const spellName = SPELLS[spellKey]?.name ?? spellKey;
        const meshHit   = rayHitUnit(healTargets);
        const _doHeal = tgt => castHeal(u, tgt, spellKey);
        if (meshHit) { _doHeal(meshHit); return; }
        if (pt) for (const [target] of healTargets) {
          const dx = target.grp.position.x - pt.x, dz = target.grp.position.z - pt.z;
          if (dx * dx + dz * dz < INTERACTION.pickRadiusSq * 2.5) {
            _doHeal(target);
            return;
          }
        }
        heroMode = null;
        hideHealTargets();
        updateCombatStatus();
        return;
      }
    }
  }

  // General targeting: any unit at any time, no combat-state requirement
  const hit = rayHitAnyUnit();
  if (!hit) {
    // No unit hit — left-click on ground moves the active hero when in move mode
    if (combatPhase && heroMode === 'move' && pt) {
      const curU = turnOrder[turnIndex];
      if (curU && curU.team === 'blue') {
        const large = UNIT_TYPES[curU.type]?.large ?? false;
        const tx = large ? Math.round(pt.x / 2) * 2 : Math.round((pt.x - 1) / 2) * 2 + 1;
        const tz = large ? Math.round(pt.z / 2) * 2 : Math.round((pt.z - 1) / 2) * 2 + 1;
        if (validTiles.has(`${tx},${tz}`)) {
          const mdx = tx - curU.grp.position.x, mdz = tz - curU.grp.position.z;
          const movedFt = Math.round(Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE) * GRID_SQUARE_FEET;
          prevMoveState = { x: curU.grp.position.x, z: curU.grp.position.z, movedFt: turnMovedFt };
          hideMoveRange();
          hideAttackTargets();
          const path = findPath(curU.grp.position.x, curU.grp.position.z, tx, tz);
          animatePath(curU, path, () => {
            turnMovedFt += movedFt;
            addLog(`${unitLabel(curU)} moves ${movedFt} ft`, 'move');
            _checkProximityAggro(curU);
            _checkHidePerception(curU);
            const remaining = (UNIT_TYPES[curU.type]?.speed ?? 30) - turnMovedFt;
            if (remaining > 0) { heroMode = 'move'; showMoveRange(curU); }
            else { heroMode = null; }
            showUndoBtn();
            updateCombatStatus();
          });
          return;
        }
      }
    }
    hideTargetMarker();
    return;
  }

  clearHoverPulseUnit();
  if (hit.team === 'red') {
    showTargetMarker(hit);
  } else {
    // Ally clicked — show marker; show shake-awake if sleeping
    if (selectedTarget && selectedTarget !== hit) selectedTarget.barForced = false;
    selectedTarget    = hit;
    selectedTargetAtk = null;
    hit.barForced     = true;
    targetNameEl.textContent        = unitLabel(hit);
    attackConfirmWrap.style.display = 'none';
    targetMarkerEl.style.display    = 'block';
    showTargetWindow(hit);
  }
});

// ── Move hover ring & distance label ─────────────────────────────────────────

renderer.domElement.addEventListener('mousemove', e => {
  if (!combatPhase || isAnimating) {
    _ringHoverActive = false;
    moveDistEl.style.display = 'none';
    return;
  }
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') {
    _ringHoverActive = false;
    moveDistEl.style.display = 'none';
    return;
  }

  const pt = groundHit(e.clientX, e.clientY);  // primes _ray

  // Unit hover takes priority: pulse ring + emissive on any hovered unit
  const hoveredUnit = rayHitAnyUnit();
  if (hoveredUnit) {
    setHoverPulseUnit(hoveredUnit);
    const ux = hoveredUnit.grp.position.x;
    const uz = hoveredUnit.grp.position.z;
    if (ux !== _hoverRingTx || uz !== _hoverRingTz) {
      _hoverRingTx = ux; _hoverRingTz = uz;
      const oldGeo = hoverRing.geometry;
      hoverRing.geometry = buildHoverRingGeo(ux, uz);
      oldGeo.dispose();
    }
    hoverRing.material.color.setHex(0xff44ff);
    hoverRing.position.set(ux, 0, uz);
    hoverRing.visible = true;
    _ringHoverActive = true;
    moveDistEl.style.display = 'none';
    return;
  }

  // No unit under cursor — clear emissive pulse, show move tile preview if applicable
  clearHoverPulseUnit();
  if (heroMode !== 'move' || !pt) {
    _ringHoverActive = false;
    moveDistEl.style.display = 'none';
    return;
  }

  const large = UNIT_TYPES[u.type]?.large ?? false;
  const tx = large ? Math.round(pt.x / 2) * 2 : Math.round((pt.x - 1) / 2) * 2 + 1;
  const tz = large ? Math.round(pt.z / 2) * 2 : Math.round((pt.z - 1) / 2) * 2 + 1;

  if (validTiles.has(`${tx},${tz}`)) {
    if (tx !== _hoverRingTx || tz !== _hoverRingTz) {
      _hoverRingTx = tx; _hoverRingTz = tz;
      const oldGeo = hoverRing.geometry;
      hoverRing.geometry = buildHoverRingGeo(tx, tz);
      oldGeo.dispose();
    }
    hoverRing.material.color.setHex(0x44FF44);
    hoverRing.position.set(tx, 0, tz);
    hoverRing.visible = true;
    _ringHoverActive = true;

    const mdx = tx - u.grp.position.x, mdz = tz - u.grp.position.z;
    const distFt = Math.round(Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE) * GRID_SQUARE_FEET;
    moveDistEl.textContent    = `${distFt} ft`;
    moveDistEl.style.display  = 'block';
    moveDistEl.style.left     = (e.clientX + 14) + 'px';
    moveDistEl.style.top      = (e.clientY - 10) + 'px';
  } else {
    _ringHoverActive = false;
    moveDistEl.style.display = 'none';
  }
});

renderer.domElement.addEventListener('mouseleave', () => {
  _ringHoverActive = false;
  moveDistEl.style.display = 'none';
});

// ── Right-click movement ───────────────────────────────────────────────────────
// rayHitAnyUnit is used by the left-click targeting handler above.

function rayHitAnyUnit() {
  for (const target of units) {
    if (target.hp <= 0) continue;
    if (_ray.intersectObject(target.grp, true).length) return target;
  }
  return null;
}

// Suppress browser context menu; movement is handled by mouseup below.
renderer.domElement.addEventListener('contextmenu', e => { e.preventDefault(); });

// Right-click does nothing for game actions.
renderer.domElement.addEventListener('mouseup', e => {
  if (e.button !== 2) return;
});

// ── Initiative ────────────────────────────────────────────────────────────────

export function rollInitiative() {
  combatPhase = true;
  divider.visible = false;
  setGridVisible(true);
  _dungeonAwareEnemies.clear();
  _delayed.clear();
  initSpellSlots(units);

  // Non-dungeon: all red units are immediately aggro, unless precombat BFS explicitly
  // marked them aggro=false (out-of-range enemies that shouldn't join yet).
  // Dungeon: enemies start unaware; aggro is set when they gain LOS.
  if (activeEnv !== 'dungeon') {
    units.forEach(u => { if (u.team === 'red' && u.aggro !== false) u.aggro = true; });
  }

  // Snap heroes to grid — precombat movement stops mid-step on aggro trigger,
  // leaving fractional positions that won't match showMoveRange's tile keys.
  units.forEach(u => {
    if (u.team !== 'blue') return;
    const large = UNIT_TYPES[u.type]?.large ?? false;
    const snapV = v => large ? Math.round(v / 2) * 2 : Math.round((v - 1) / 2) * 2 + 1;
    u.grp.position.x = snapV(u.grp.position.x);
    u.grp.position.z = snapV(u.grp.position.z);
    u.anchor.x = u.grp.position.x;
    u.anchor.z = u.grp.position.z;
  });

  units.forEach(u => {
    const rageDef = UNIT_TYPES[u.type]?.rage;
    if (rageDef) {
      u.raging      = false;
      u.rageUses    = rageDef.uses;
      u.rageUsesMax = rageDef.uses;
      u.rageRounds  = 0;
    }
    // Level 2 ability state reset each battle
    if (u.type === 'human')    { u.defStanceActive = false; u.defStanceRounds = 0; u.defStanceCooldown = 0; }
    if (u.type === 'halfling') { u.hideCooldown = 0; }
    // mageArmored is intentionally NOT reset — persists until long rest
    const def    = UNIT_TYPES[u.type] ?? {};
    const dexMod = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
    const bonus  = (def.initiative ?? COMBAT.defaultInitiative) + dexMod;
    u.initiative = roll({ sides: 20, modifier: bonus }).total;
    if (u.stealthed) setUnitStealth(u, true);
  });
  turnOrder = [...units].filter(u => u.team !== 'npc').sort((a, b) =>
    b.initiative - a.initiative || (a.team === 'red' ? -1 : 1)
  );
  turnIndex = 0;
  round     = 1;
  buildTurnList();
  activateTurn(0);
  playSound('combat_start');
  playCombatMusic('combat_music');
  window.dispatchEvent(new CustomEvent('combat:start'));
  document.getElementById('turn-panel').style.display    = 'flex';
  document.getElementById('combat-log').style.display    = 'flex';

  document.getElementById('combat-banner').style.display = 'none';
  addLog('━━━ ROUND 1 ━━━', 'round');
}

export function buildTurnList() {
  const list = document.getElementById('turn-list');
  list.innerHTML = '';
  const counter = {};

  // Assign stable labels in turnOrder sequence, then sort display by initiative
  const entries = turnOrder
    .map((u, i) => {
      if (u.team === 'red' && !u.aggro) return null;
      const key    = u.team + u.type;
      counter[key] = (counter[key] || 0) + 1;
      const baseName = UNIT_TYPES[u.type]?.name ?? u.type;
      const label    = u.team === 'blue' ? baseName : baseName + ' ' + counter[key];
      return { u, i, label };
    })
    .filter(Boolean)
    .sort((a, b) => b.u.initiative - a.u.initiative);

  entries.forEach(({ u, i, label }) => {
    const color = u.team === 'blue'
      ? '#' + (HERO_RING_COLORS[u.type] ?? 0x4488ff).toString(16).padStart(6, '0')
      : '';
    const hpPct    = Math.round(Math.max(0, u.hp) / Math.max(1, u.maxHp) * 100);
    const barColor = u.team === 'blue' ? (color || '#4488ff') : '#cc3333';

    const el      = document.createElement('div');
    el.className  = 'turn-entry';
    el.dataset.ti = i;
    const isActiveDelay = u === _activeDelayHero;
    const readyTag  = (u.team === 'blue' && (_delayed.has(u) || isActiveDelay))
      ? '<span class="turn-ready-tag">⚡</span>' : '';
    const arrowTag  = isActiveDelay
      ? '<span class="turn-delay-arrow">◀</span>' : '';
    el.innerHTML  =
      `<div class="turn-hpbar-wrap"><div class="turn-hpbar" style="width:${hpPct}%;background:${barColor}"></div></div>` +
      `<span class="turn-name"${color ? ` style="color:${color}"` : ''}>${label}${readyTag}${arrowTag}</span>` +
      `<span class="turn-init">${u.initiative}</span>`;
    el.addEventListener('click', () => {
      if (u.team === 'red' && u.hp > 0) showTargetMarker(u);
      else if (u.team === 'blue')        setFollowUnit(u);
    });
    list.appendChild(el);
  });
}

const HERO_HUD_NAME_COLORS = {
  dwarf:    { color: '#c8860a', shadow: '0 0 7px rgba(200,134,10,0.55)' },
  human:    { color: '#5577ee', shadow: '0 0 7px rgba(34,85,238,0.55)' },
  elf:      { color: '#cc55ee', shadow: '0 0 7px rgba(170,34,238,0.55)' },
  halfling: { color: '#44dd66', shadow: '0 0 7px rgba(34,204,68,0.55)' },
};

// ── Delay Action ──────────────────────────────────────────────────────────────

const _DELAY_LABELS = {
  enemy_in_los:      'Enemy enters line of sight',
  enemy_in_melee_range: 'Enemy enters melee range',
  ally_loses_hp:        'Ally loses hit points',
};

// _delayCtx: null when idle; {savedIdx, savedHeroMode, cont} during active interrupt
let _delayCtx = null;
// timer ID for the auto-close after a delay-interrupt attack; cancelled on manual end
let _delayAutoCloseTimer = null;
// tracks each hero's turnBonusActioned state at the moment they committed to delay
const _delayedBonusActioned = new Map();
// hero whose delay interrupt is currently active (for turn-list arrow)
let _activeDelayHero = null;

function _showDelayTriggerFloat(hero) {
  const heroName = UNIT_TYPES[hero.type]?.name ?? hero.type;
  const color    = '#' + (HERO_RING_COLORS[hero.type] ?? 0xffdd44).toString(16).padStart(6, '0');
  _fv.set(hero.anchor.x, hero.anchor.y + 0.5, hero.anchor.z).project(camera);
  if (_fv.z >= 1) return;
  const el = document.createElement('div');
  el.className  = 'delay-trigger-float';
  el.style.color = color;
  el.innerHTML  = `⚡ Delayed Action<br>Triggered!`;
  el.style.left = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  el.style.top  = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 4000);
}

function _openDelayModal(hero) {
  const modal = document.getElementById('delay-action-modal');
  if (!modal) return;
  modal.querySelectorAll('.dam-trigger-btn').forEach(btn => {
    btn.onclick = () => {
      const trigger = btn.dataset.trigger;
      _delayed.set(hero, trigger);
      _delayedBonusActioned.set(hero, turnBonusActioned);
      turnAttacked = true;
      modal.style.display = 'none';
      addLog(`${unitLabel(hero)} delays: trigger "${_DELAY_LABELS[trigger]}"`, 'move');
      buildTurnList();
      updateCombatStatus();
      _rebuildHotbar(hero);
    };
  });
  document.getElementById('dam-cancel-btn').onclick = () => { modal.style.display = 'none'; };
  modal.style.display = 'flex';
}

// Helper: returns true if enemy is within ranged range AND has LOS to hero
function _enemyInHeroLOS(enemy, hero) {
  const heroAtks = UNIT_TYPES[hero.type]?.attacks ?? [];
  const rangedAtk = heroAtks.find(a => a.type === 'ranged');
  if (!rangedAtk) return false;
  const dx = enemy.grp.position.x - hero.grp.position.x;
  const dz = enemy.grp.position.z - hero.grp.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > atkRangeWU(rangedAtk.longRange ?? rangedAtk.range)) return false;
  return hasLineOfSight(
    enemy.grp.position.x, enemy.grp.position.z,
    hero.grp.position.x,  hero.grp.position.z
  );
}

function _checkDelayedTriggers(eventType, eventCtx, hpLost, continuation) {
  const matches = [];
  for (const [hero, trigger] of _delayed) {
    if (!units.includes(hero) || hero.hp <= 0) { _delayed.delete(hero); continue; }
    const heroAtks = UNIT_TYPES[hero.type]?.attacks ?? [];

    if (eventType === 'enemy_moved' || eventType === 'enemy_turn_start') {
      const enemy = eventCtx;
      const dx = enemy.grp.position.x - hero.grp.position.x;
      const dz = enemy.grp.position.z - hero.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (trigger === 'enemy_in_los' && _enemyInHeroLOS(enemy, hero)) {
        matches.push({ hero, trigger });
      } else if (trigger === 'enemy_in_melee_range') {
        const atk = heroAtks.find(a => a.type === 'melee');
        if (atk && dist <= atkTriggerWU(atk)) matches.push({ hero, trigger });
      }
    }

    if (eventType === 'ally_damaged' && trigger === 'ally_loses_hp') {
      const victim = eventCtx;
      // Only fire if a blue unit actually lost HP (includes the delayed hero themselves)
      if (hpLost && victim.team === 'blue') {
        matches.push({ hero, trigger });
      }
    }
  }

  if (!matches.length) { continuation(); return; }

  // Chain all matches so every delayed hero gets to act before the original continuation resumes
  function _fireNext(idx) {
    if (idx >= matches.length) { continuation(); return; }
    _delayCtx = {
      savedIdx:            turnIndex,
      savedHeroMode:       heroMode,
      savedAttacked:       turnAttacked,  // must restore so enemy turn resumes with correct attack state
      savedMovedFt:        turnMovedFt,
      savedBonusActioned:  turnBonusActioned,
      savedRingX:          activeRing.position.x,
      savedRingZ:          activeRing.position.z,
      savedRingColor:      activeRing.material.color.getHex(),
      savedRingVisible:    activeRing.visible,
      cont: () => _fireNext(idx + 1),
    };
    _showDelayInterrupt(matches[idx]);
  }
  _fireNext(0);
}

function _showDelayInterrupt({ hero, trigger }) {
  if (!_delayCtx) return;
  const heroIdx = turnOrder.indexOf(hero);
  if (heroIdx < 0) {
    _delayed.delete(hero);
    // Hero left combat — skip their interrupt and call the chain continuation
    const cont = _delayCtx.cont;
    _delayCtx = null;
    cont?.();
    return;
  }

  _delayed.delete(hero);
  _activeDelayHero = hero;

  // Temporarily make this hero the active unit so all hotbar callbacks work naturally
  turnIndex         = heroIdx;
  turnAttacked      = false;
  turnMovedFt       = 0;   // delay action has no movement
  turnBonusActioned = _delayedBonusActioned.get(hero) ?? false;
  _delayedBonusActioned.delete(hero);
  heroMode          = null;

  endTurnBtn.disabled = false;

  // Move active ring to this hero with their ring colour
  updateConformingRingGeo(activeRing, hero.grp.position.x, hero.grp.position.z);
  activeRing.position.set(hero.grp.position.x, 0, hero.grp.position.z);
  activeRing.material.color.set(HERO_RING_COLORS[hero.type] ?? COLORS.activeRing);
  activeRing.visible = true;
  showSelectionHighlight(hero);

  // Floating "Triggered!" text and pulsing arrow in turn list
  _showDelayTriggerFloat(hero);
  buildTurnList();

  setFollowUnit(hero);
  showRangeRings(hero);
  showAttackTargets(hero);
  _rebuildHotbar(hero);

  // Remove DASH (no movement) and replace End Turn with Skip
  unbindHotkey('Digit4', false);
  bindHotkey('Digit5', false, '<span class="hb-end-turn">SKIP<br>DELAY</span>', () => _endDelayInterrupt());

  // Show the delay banner
  const banner = document.getElementById('delay-banner');
  if (banner) {
    banner.querySelector('.db-hero').textContent    = unitLabel(hero);
    banner.querySelector('.db-trigger').textContent = _DELAY_LABELS[trigger];
    document.getElementById('db-skip-btn').onclick  = () => _endDelayInterrupt();
    banner.style.display = 'flex';
  }

  addLog(`⚡ ${unitLabel(hero)}'s Delay Action fires (${_DELAY_LABELS[trigger]})! Choose an action.`, 'move');
}

function _endDelayInterrupt() {
  clearTimeout(_delayAutoCloseTimer);
  _delayAutoCloseTimer = null;
  if (!_delayCtx) return;
  const { savedIdx, savedHeroMode, savedAttacked, savedMovedFt, savedBonusActioned,
          savedRingX, savedRingZ, savedRingColor, savedRingVisible, cont } = _delayCtx;
  _delayCtx = null;

  const banner = document.getElementById('delay-banner');
  if (banner) banner.style.display = 'none';

  hideRangeRings();
  hideMoveRange();
  hideAttackTargets();
  hideTargetMarker();
  clearAllHotkeys();

  turnIndex         = savedIdx;
  heroMode          = savedHeroMode;
  turnAttacked      = savedAttacked;  // restore enemy's pre-interrupt attack state
  turnMovedFt       = savedMovedFt;
  turnBonusActioned = savedBonusActioned;
  endTurnBtn.disabled = true;  // back to enemy's turn — button stays locked

  // Restore the active ring to the enemy that was acting
  updateConformingRingGeo(activeRing, savedRingX, savedRingZ);
  activeRing.position.set(savedRingX, 0, savedRingZ);
  activeRing.material.color.set(savedRingColor);
  activeRing.visible = savedRingVisible;

  _activeDelayHero = null;
  buildTurnList();

  if (cont) cont();
}

function _rebuildHotbar(u) {
  if (!u || u.team !== 'blue') return;
  clearAllHotkeys();
  const _attacks    = UNIT_TYPES[u.type]?.attacks ?? [];
  const firstMelee  = _attacks.find(a => a.type === 'melee');
  const firstRanged = _attacks.find(a => a.type === 'ranged');
  if (firstMelee) {
    bindHotkey('Digit2', false, firstMelee.name.toUpperCase(), () => {
      if (!selectedTarget || turnAttacked || isAnimating) return;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return;
      const tgt = selectedTarget;
      turnAttacked = true;
      hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
      performAttack(curU, tgt, firstMelee);
      const postAtkRemaining = (UNIT_TYPES[curU.type]?.speed ?? 30) - turnMovedFt;
      if (postAtkRemaining > 0) { heroMode = 'move'; showMoveRange(curU); }
      else { heroMode = null; }
      updateCombatStatus();
    }, () => {
      if (!selectedTarget || turnAttacked || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return false;
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      return Math.sqrt(dx * dx + dz * dz) <= atkTriggerWU(firstMelee);
    }, 'action');
  }
  if (firstRanged) {
    bindHotkey('Digit3', false, firstRanged.name.toUpperCase(), () => {
      if (!selectedTarget || turnAttacked || isAnimating) return;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return;
      const tgt = selectedTarget;
      turnAttacked = true;
      hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
      performAttack(curU, tgt, firstRanged);
      const postAtkRemaining = (UNIT_TYPES[curU.type]?.speed ?? 30) - turnMovedFt;
      if (postAtkRemaining > 0) { heroMode = 'move'; showMoveRange(curU); }
      else { heroMode = null; }
      updateCombatStatus();
    }, () => {
      if (!selectedTarget || turnAttacked || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return false;
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist <= atkRangeWU(firstRanged.range) &&
             hasLineOfSight(curU.grp.position.x, curU.grp.position.z,
                            selectedTarget.grp.position.x, selectedTarget.grp.position.z) &&
             atkHasQty(curU, firstRanged);
    }, 'action');
  }
  const spellPanel = document.getElementById('blue-spell-panel');
  if (spellPanel) {
    buildHeroSpellPanel(u, spellPanel, {
      turnAttacked,
      turnBonusActioned,
      onSpellBtn:    handleSpellBtnClick,
      onRageBtn:     handleRageBtnClick,
      onElfSpellBtn: handleElfSpellBtnClick,
      onSneakBtn:    handleSneakAttackBtnClick,
    });
  }
  if (u.type === 'human' && u.rageUses !== undefined) {
    bindHotkey('KeyW', false, '<span class="hb-rage">RAGE</span>', () => {
      handleRageBtnClick();
    }, () => {
      const curU = turnOrder[turnIndex];
      if (!curU || !UNIT_TYPES[curU.type]?.rage) return false;
      return (curU.rageUses ?? 0) > 0 && !curU.raging && !turnBonusActioned;
    }, 'bonus');
    if (u.level >= 2) {
      bindHotkey('KeyE', false, '<span class="hb-stance">DEF<br>STANCE</span>', () => {
        activateDefensiveStance();
      }, () => {
        const curU = turnOrder[turnIndex];
        if (!curU || curU.type !== 'human' || turnBonusActioned) return false;
        return !curU.defStanceActive && (curU.defStanceCooldown ?? 0) === 0;
      }, 'bonus');
    }
  } else if (u.type === 'halfling') {
    bindHotkey('KeyW', false, '<span class="hb-sneak">SNEAK<br>ATTACK</span>', () => {
      handleSneakAttackBtnClick();
    }, () => {
      if (!selectedTarget || turnAttacked || sneakAttackUsed || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'halfling') return false;
      const ux = curU.grp.position.x, uz = curU.grp.position.z;
      const ttx = selectedTarget.grp.position.x, ttz = selectedTarget.grp.position.z;
      const ddx = ttx - ux, ddz = ttz - uz;
      const dst = Math.sqrt(ddx * ddx + ddz * ddz);
      const _atks   = UNIT_TYPES[curU.type]?.attacks ?? [];
      const _meleeA  = _atks.find(a => a.type === 'melee');
      const _rangedA = _atks.find(a => a.type === 'ranged');
      const inRange = (_meleeA && dst <= atkTriggerWU(_meleeA)) ||
                      (_rangedA && dst <= atkRangeWU(_rangedA.range) &&
                       hasLineOfSight(ux, uz, ttx, ttz));
      if (!inRange) return false;
      const hasAlly = units.some(ally => {
        if (ally === curU || ally.team !== curU.team || ally.hp <= 0) return false;
        if (sleepingUnits.has(ally) || ally.stunned) return false;
        const ax = ally.grp.position.x - ux, az = ally.grp.position.z - uz;
        return ax * ax + az * az <= 9;
      });
      return hasAlly;
    }, 'action');
    if (u.level >= 2) {
      bindHotkey('KeyE', false, '<span class="hb-hide">HIDE</span>', () => {
        activateHide();
      }, () => {
        const curU = turnOrder[turnIndex];
        if (!curU || curU.type !== 'halfling' || turnBonusActioned) return false;
        return (curU.hideCooldown ?? 0) === 0;
      }, 'bonus');
    }
  } else if (u.type === 'dwarf') {
    bindHotkey('KeyQ', false, '<img class="hb-spell-img-fill" src="assets/Spells/Healingword.jpg">', () => {
      triggerSpellBarAction('healing_word');
    }, () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked) return false;
      const rangeWU = atkRangeWU(SPELLS.healing_word.rangeFt);
      return units.some(ally => {
        if (ally.team !== 'blue' || ally.hp <= 0) return false;
        const dx = ally.grp.position.x - curU.grp.position.x;
        const dz = ally.grp.position.z - curU.grp.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
      });
    }, 'action');
    if (u.level >= 2) {
      bindHotkey('KeyE', false, '<img class="hb-spell-img-fill" src="assets/Spells/bless.jpg">', () => {
        handleSpellBtnClick('bless');
      }, () => {
        const curU = turnOrder[turnIndex];
        if (!curU || curU.type !== 'dwarf' || turnAttacked || (curU.spellSlots ?? 0) <= 0) return false;
        return units.some(u => u.team === 'blue' && u.hp > 0);
      }, 'action');
    }
  } else if (u.type === 'elf') {
    bindHotkey('KeyQ', false, '<img class="hb-spell-img-fill" src="assets/Spells/Firebolt.jpg">', () => {
      triggerSpellBarAction('fire_bolt');
    }, () => {
      if (!selectedTarget || turnAttacked || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf') return false;
      const rangedAtk = UNIT_TYPES[curU.type]?.attacks?.find(a => a.type === 'ranged');
      if (!rangedAtk) return false;
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist <= atkRangeWU(rangedAtk.range) &&
             hasLineOfSight(curU.grp.position.x, curU.grp.position.z,
                            selectedTarget.grp.position.x, selectedTarget.grp.position.z);
    }, 'action');
    if (u.level >= 2) {
      bindHotkey('KeyE', false, '<img class="hb-spell-img-fill" src="assets/Spells/magearmor.jpg">', () => {
        activateMageArmor();
      }, () => {
        const curU = turnOrder[turnIndex];
        if (!curU || curU.type !== 'elf' || turnAttacked || (curU.spellSlots ?? 0) <= 0) return false;
        return !curU.mageArmored;
      }, 'action');
    }
  }
  bindHotkey('Digit4', false, '<span class="hb-sprint">DASH</span>', () => {
    doSprint();
  }, () => {
    const curU = turnOrder[turnIndex];
    return !!curU && curU.team === 'blue' && !turnAttacked && !isAnimating;
  }, 'action');
  {
    const armed = _delayed.has(u);
    bindHotkey('Digit6', false,
      armed
        ? '<span class="hb-ready hb-ready-armed">DELAY ✓</span>'
        : '<span class="hb-ready">DELAY<br>ACTION</span>',
      () => {
        const curU = turnOrder[turnIndex];
        if (!curU || curU.team !== 'blue' || isAnimating) return;
        if (_delayed.has(curU)) {
          addLog(`${unitLabel(curU)} is delaying: trigger "${_DELAY_LABELS[_delayed.get(curU)]}"`, 'move');
          return;
        }
        if (turnAttacked) return;
        _openDelayModal(curU);
      },
      () => {
        const curU = turnOrder[turnIndex];
        return !!curU && curU.team === 'blue' && !isAnimating && !turnAttacked;
      },
      'action'
    );
  }
  bindHotkey('Digit5', false, '<span class="hb-end-turn">END<br>TURN</span>', () => {
    if (isAnimating || endTurnBtn.disabled) return;
    doEndTurn();
  });
}

window.addEventListener('hero:levelup', ({ detail: { hero, newLevel } }) => {
  // Add any spells that unlock at this exact level
  const unlocks = LEVEL_SPELLS[hero.type] ?? {};
  if (unlocks[newLevel]) {
    if (!hero.preparedSpells) hero.preparedSpells = new Set();
    unlocks[newLevel].forEach(k => hero.preparedSpells.add(k));
  }
  // Grant additional spell slots when leveling up
  if (hero.type === 'dwarf') {
    const clericSlots = newLevel >= 3 ? 3 : newLevel >= 2 ? 2 : 0;
    const gain = clericSlots - (hero.spellSlotsMax ?? 0);
    hero.spellSlotsMax = clericSlots;
    if (gain > 0) hero.spellSlots = (hero.spellSlots ?? 0) + gain;
  } else if (hero.type === 'elf') {
    const wizSlots = newLevel >= 2 ? 2 : 0;
    const gain = wizSlots - (hero.spellSlotsMax ?? 0);
    hero.spellSlotsMax = wizSlots;
    if (gain > 0) hero.spellSlots = (hero.spellSlots ?? 0) + gain;
  }
  if (!combatPhase) return;
  const curU = turnOrder[turnIndex];
  if (curU && curU === hero && curU.team === 'blue') _rebuildHotbar(curU);
});

export function activateTurn(index) {
  clearRollFeed();
  clearDiceQueue();
  buildTurnList();
  // Transfer barForced to the newly-active unit so its health bar stays visible
  units.forEach(u => u.barForced = false);
  document.querySelectorAll('.turn-entry').forEach(el =>
    el.classList.toggle('active', +el.dataset.ti === index)
  );
  const row = document.querySelector(`.turn-entry[data-ti="${index}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const u = turnOrder[index];
  if (u) {
    const unawareEnemy = u.team === 'red' && (
      (activeEnv === 'dungeon' && !_dungeonAwareEnemies.has(u)) ||
      u.aggro === false
    );
    if (u.team === 'blue' && !unawareEnemy) setFollowUnit(u);
    if (u.team === 'blue') { u.barForced = true; onHeroTurnStart(); }
    updateConformingRingGeo(activeRing, u.grp.position.x, u.grp.position.z);
    activeRing.position.set(u.grp.position.x, 0, u.grp.position.z);
    activeRing.material.color.set(u.team === 'red' ? COLORS.activeRing : (HERO_RING_COLORS[u.type] ?? COLORS.activeRing));
    activeRing.visible    = !unawareEnemy;
    showSelectionHighlight(u);
    turnMovedFt     = 0;
    turnAttacked    = false;
    sneakAttackUsed = false;
    // If this hero's delayed action never fired, it expires at turn start
    if (u.team === 'blue' && _delayed.has(u)) {
      addLog(`${unitLabel(u)}'s delayed action expires (trigger never fired).`, 'move');
      _delayed.delete(u);
      buildTurnList();
    }
    if (u.team === 'blue') playSound('turn_start');
    clearAllHotkeys();
    hideUndoBtn();
    hideTargetMarker();

    const isRed = u.team === 'red';
    const peers = units.filter(x => x.team === u.team && x.type === u.type);
    const num   = peers.indexOf(u) + 1;
    const label = (UNIT_TYPES[u.type]?.name ?? u.type).toUpperCase() +
                  (peers.length > 1 ? ' ' + num : '');
    const hudNameEl = document.getElementById(`${u.team}-hud-name`);
    if (hudNameEl) hudNameEl.textContent = label;

    // Build per-attack rows (red HUD only; blue uses hotkeys)
    const atksEl = document.getElementById(`${u.team}-hud-atks`);
    const _attacks = UNIT_TYPES[u.type]?.attacks ?? [];
    if (isRed && atksEl) {
      atksEl.innerHTML = '';
      _attacks.forEach(atk => {
        const row = document.createElement('div');
        row.className = 'thud-row';
        row.innerHTML =
          `<span class="thud-label">${atk.name.toUpperCase()} ATK</span>` +
          `<span class="thud-atk-val thud-val"></span>`;
        atksEl.appendChild(row);
      });
    }

    // Cooldown decrements happen at turn start only, not on mid-turn hotbar refresh
    if (u.type === 'human' && (u.defStanceCooldown ?? 0) > 0) u.defStanceCooldown--;
    if (u.type === 'halfling' && (u.hideCooldown ?? 0) > 0) u.hideCooldown--;

    turnBonusActioned = false;
    _rebuildHotbar(u);

    if (combatPhase) {
      heroMode = null;
      if (u.team === 'red') {
        if (u.dormant) {
          setTimeout(() => doEndTurn(), 150);
        } else {
          runAITurn(u);
        }
      } else {
        showRangeRings(u);
        heroMode = 'move';
        showMoveRange(u);
      }
    }
  }
  document.getElementById('turn-round').textContent = `Round ${round}`;
  updateCombatStatus();
}

// ── Dynamic aggro radius ──────────────────────────────────────────────────────
// CR ≤1 all map to effective level 1; CR 2+ map 1:1.
const _XP_TO_EFF = { 25:1, 50:1, 100:1, 200:1, 450:2, 700:3, 1100:4, 1800:5 };
function _effLevelOf(def) { return _XP_TO_EFF[def.xpReward ?? 0] ?? 1; }

function _partyHeroLevel() {
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  if (!heroes.length) return 1;
  return Math.round(heroes.reduce((s, h) => s + (h.level ?? 1), 0) / heroes.length);
}

function _dynamicAggroRangeWU(u, def) {
  const baseWU   = u.detectRange ?? def.detect ?? 20;
  const tierDiff = Math.ceil(_partyHeroLevel() / 5) - (_effLevelOf(def) + 4);
  if (tierDiff < 0) return baseWU;
  return baseWU * Math.max(0, 1 - (tierDiff + 1) / 5);
}

// ── Proximity aggro (triggered after each hero move step) ─────────────────────

function _checkProximityAggro(hero) {
  let anyNew = false;
  for (const u of units) {
    if (u.team !== 'red' || u.aggro || u.hp <= 0) continue;
    const def   = UNIT_TYPES[u.type] ?? {};
    const range = _dynamicAggroRangeWU(u, def);
    const dx    = hero.grp.position.x - u.grp.position.x;
    const dz    = hero.grp.position.z - u.grp.position.z;
    if (dx * dx + dz * dz > range * range) continue;

    u.aggro = true;
    _dungeonAwareEnemies.add(u);
    u.grp.visible = true;

    // Re-roll initiative and re-slot after the current hero's position
    const dexMod    = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
    const initBonus = (def.initiative ?? COMBAT.defaultInitiative) + dexMod;
    u.initiative    = roll({ sides: 20, modifier: initBonus }).total;

    const oldIdx = turnOrder.indexOf(u);
    if (oldIdx >= 0) {
      turnOrder.splice(oldIdx, 1);
      if (oldIdx < turnIndex) turnIndex--;
    }
    // Insert after current turn, sorted by initiative among remaining slots
    let insertAt = turnIndex + 1;
    for (let i = turnIndex + 1; i < turnOrder.length; i++) {
      if (u.initiative > turnOrder[i].initiative) { insertAt = i; break; }
      insertAt = i + 1;
    }
    turnOrder.splice(insertAt, 0, u);

    addLog(`⚠ ${unitLabel(u)} is alerted by the heroes! (Initiative ${u.initiative})`, 'round');
    anyNew = true;
  }
  if (anyNew) buildTurnList();
}

function doEndTurn() {
  if (!combatPhase) return;
  hideMoveRange();
  hideAttackTargets();
  hideCastConfirm();
  hideRangeRings();
  hideUndoBtn();

  // Rage ends if barbarian didn't attack this turn
  const cur = turnOrder[turnIndex];
  if (cur?.raging && !turnAttacked && UNIT_TYPES[cur.type]?.rage) {
    cur.raging     = false;
    cur.rageRounds = 0;
    addLog(`${unitLabel(cur)}'s Rage ends (no attack)`, 'dmg');
  }

  turnIndex++;
  if (turnIndex >= turnOrder.length) {
    turnIndex = 0;
    round++;
    addLog(`━━━ ROUND ${round} ━━━`, 'round');
    window.dispatchEvent(new CustomEvent('round:start', { detail: { round } }));
    tickBless();
    tickSleep();
    units.forEach(u => {
      if (u.raging) {
        u.rageRounds--;
        if (u.rageRounds <= 0) {
          u.raging = false;
          addLog(`${unitLabel(u)}'s Rage expires`, 'dmg');
        }
      }
      if (u.defStanceActive) {
        u.defStanceRounds--;
        if (u.defStanceRounds <= 0) {
          u.defStanceActive = false;
          addLog(`${unitLabel(u)}'s Defensive Stance fades`, 'move');
        }
      }
    });
  }
  setTimeout(() => activateTurn(turnIndex), 200);
}

endTurnBtn.addEventListener('click', () => {
  if (isAnimating) return;
  if (_delayCtx) { _endDelayInterrupt(); return; }
  doEndTurn();
});

// ── Non-aggro roam turn (used during combat for unaggro'd patrollers) ────────

function _roamAggroCheck(u) {
  if (u.aggro) return;
  const def    = UNIT_TYPES[u.type] ?? {};
  const range  = _dynamicAggroRangeWU(u, def);
  const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
  const spotted = heroes.some(h => {
    const dx = h.grp.position.x - u.grp.position.x;
    const dz = h.grp.position.z - u.grp.position.z;
    return dx * dx + dz * dz <= range * range;
  });
  if (spotted) {
    _dungeonAwareEnemies.add(u);
    u.aggro = true;
    u.grp.visible = true;
    addLog(`⚠ ${unitLabel(u)} spots the heroes during patrol!`, 'round');
    buildTurnList();
  }
}

function _runRoamTurn(u) {
  const THINK_MS = 300;
  const END_PAUSE = 250;
  const def    = UNIT_TYPES[u.type] ?? {};
  const speedFt = def.speed ?? 30;
  const maxWU   = (speedFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;

  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }

    if (!u.patrolPath?.length) {
      // No patrol path — stand idle, just check detection
      _roamAggroCheck(u);
      setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, END_PAUSE);
      return;
    }

    // Advance past any waypoint the unit is already standing on
    let idx = u._patrolIdx ?? 0;
    for (let guard = 0; guard < u.patrolPath.length; guard++) {
      const wp  = u.patrolPath[idx];
      const ddx = wp.x - u.grp.position.x;
      const ddz = wp.z - u.grp.position.z;
      if (ddx * ddx + ddz * ddz > 0.04) break;  // not on this waypoint yet
      idx = (idx + 1) % u.patrolPath.length;
    }
    u._patrolIdx = idx;

    const wp   = u.patrolPath[idx];
    const cx   = u.grp.position.x;
    const cz   = u.grp.position.z;
    const dx   = wp.x - cx;
    const dz   = wp.z - cz;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Clamp move to max speed; record whether we'll fully reach the waypoint
    const willReach = dist <= maxWU;
    const ratio     = willReach ? 1 : maxWU / dist;
    const destX     = cx + dx * ratio;
    const destZ     = cz + dz * ratio;

    animatePath(u, [{ x: destX, z: destZ }], () => {
      if (willReach) {
        u._patrolIdx = (idx + 1) % u.patrolPath.length;
      }
      _roamAggroCheck(u);
      setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, END_PAUSE);
    });
  }, THINK_MS);
}

// ── Enemy AI (helpers in js/combatAI.js) ────────────────────────────────────

function runAITurn(u) {
  endTurnBtn.disabled = true;

  // Sleeping units can't act
  if (sleepingUnits.has(u)) {
    const state = sleepingUnits.get(u);
    addLog(`${unitLabel(u)} is asleep (${state.roundsLeft} rounds left) — skips turn`, 'spell');
    setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, 350);
    return;
  }

  // Per-unit stealth: hidden until they have LOS to a hero, then reveal.
  if (u.stealthed && !_dungeonAwareEnemies.has(u)) {
    const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
    const spotted = heroes.some(h =>
      hasLineOfSight(u.grp.position.x, u.grp.position.z, h.grp.position.x, h.grp.position.z)
    );
    if (spotted) {
      _dungeonAwareEnemies.add(u);
      u.aggro = true;
      setUnitStealth(u, false);
      addLog(`⚠ ${unitLabel(u)} emerges from the shadows!`, 'move');
      buildTurnList();
    } else {
      // No LOS yet — silently creep toward the nearest hero while staying hidden
      const nearest = heroes.reduce((best, h) => {
        const dx = h.grp.position.x - u.grp.position.x;
        const dz = h.grp.position.z - u.grp.position.z;
        const d  = dx * dx + dz * dz;
        return d < best.d ? { h, d } : best;
      }, { h: null, d: Infinity }).h;

      if (!nearest) {
        setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, 250);
        return;
      }
      const speedFt = UNIT_TYPES[u.type]?.speed ?? 30;
      const maxWU   = (speedFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
      const cx = u.grp.position.x, cz = u.grp.position.z;
      const tx = nearest.grp.position.x, tz = nearest.grp.position.z;
      const dx = tx - cx, dz = tz - cz;
      const dist  = Math.sqrt(dx * dx + dz * dz);
      const ratio = Math.min(maxWU / dist, 1);
      setTimeout(() => {
        if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
        animatePath(u, [{ x: cx + dx * ratio, z: cz + dz * ratio }], () => {
          setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, 250);
        });
      }, 300);
      return;
    }
  }

  // Dormant enemy (precombat BFS didn't alert them): check detect range each turn.
  // If a hero has walked close enough, aggro and fight this turn; otherwise skip.
  if (u.aggro === false) {
    const def    = UNIT_TYPES[u.type] ?? {};
    const range  = _dynamicAggroRangeWU(u, def);
    const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
    const spotted = heroes.some(h => {
      const dx = h.grp.position.x - u.grp.position.x;
      const dz = h.grp.position.z - u.grp.position.z;
      return dx * dx + dz * dz <= range * range;
    });
    if (spotted) {
      u.aggro = true;
      u.grp.visible = true;
      if (u.stealthed) setUnitStealth(u, false);
      addLog(`⚠ ${unitLabel(u)} is alerted by the heroes!`, 'round');
      buildTurnList();
      // Fall through — enemy acts this turn
    } else {
      setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, 150);
      return;
    }
  }

  // Non-aggro roamer — follow patrol path this turn instead of attacking
  if (u.roams && !u.aggro) {
    _runRoamTurn(u);
    return;
  }

  // Dungeon environment: all enemies wait until they have LOS to a hero.
  if (activeEnv === 'dungeon' && !_dungeonAwareEnemies.has(u)) {
    const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
    const spotted = heroes.some(h =>
      hasLineOfSight(u.grp.position.x, u.grp.position.z, h.grp.position.x, h.grp.position.z)
    );
    if (spotted) {
      _dungeonAwareEnemies.add(u);
      u.aggro = true;
      addLog(`⚠ ${unitLabel(u)} spots the heroes!`, 'move');
      buildTurnList();
    } else {
      setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, 250);
      return;
    }
  }

  const THINK_MS    = 600;    // pause before acting
  const PRE_ATK_MS  = 350;    // pause before swinging so player sees the target ring
  // Must outlast: anim_duration(~1030) + travel(~760) + death_window(400) ≈ 2190
  const ATK_RESOLVE = 2200;
  const END_PAUSE   = 300;    // breather before advancing to next turn

  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) {
      endTurnBtn.disabled = false;
      return;
    }

    const target = aiPickTarget(u, units, hasLineOfSight);
    if (!target) {
      endTurnBtn.disabled = false;
      setTimeout(doEndTurn, END_PAUSE);
      return;
    }

    function endAITurn() {
      setTimeout(() => { endTurnBtn.disabled = false; doEndTurn(); }, END_PAUSE);
    }

    function doAttack(cb) {
      if (!units.includes(target)) { cb(); return; }
      const atk = aiGetAttack(u, target, turnAttacked, atkHasQty, atkTriggerWU, atkRangeWU, hasLineOfSight);
      if (!atk) { cb(); return; }
      showAttackTargets(u);          // briefly lights the orange ring on target
      setTimeout(() => {
        hideAttackTargets();
        turnAttacked = true;
        hideUndoBtn();
        updateCombatStatus();
        const hpBefore = target.hp;
        performAttack(u, target, atk);
        // After attack resolves, check ally_loses_hp delayed actions — only if HP actually dropped
        setTimeout(() => _checkDelayedTriggers('ally_damaged', target, target.hp < hpBefore, cb), ATK_RESOLVE);
      }, PRE_ATK_MS);
    }

    // Helper: move to dest then call cb
    function moveToAndThen(dest, cb) {
      const ox = u.grp.position.x, oz = u.grp.position.z;
      const path = findPath(ox, oz, dest.x, dest.z);
      animatePath(u, path, () => {
        const mdx = dest.x - ox, mdz = dest.z - oz;
        const movedFt = Math.round(
          Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE
        ) * GRID_SQUARE_FEET;
        turnMovedFt += movedFt;
        addLog(`${unitLabel(u)} moves ${movedFt} ft`, 'move');
        if (units.includes(target)) {
          const fdx = target.grp.position.x - u.grp.position.x;
          const fdz = target.grp.position.z - u.grp.position.z;
          u.grp.rotation.y = Math.atan2(fdx, fdz);
        }
        updateCombatStatus();
        _checkDelayedTriggers('enemy_moved', u, false, cb);
      });
    }

    // ── Check delayed triggers before enemy acts ──────────────────────────────
    // Catches enemies that never move (Path 1/2) — fire LOS/melee triggers now
    function runPaths() {
      if (!combatPhase || !units.includes(u)) return;

      // ── Determine current range ─────────────────────────────────────────────
      const _dx0  = target.grp.position.x - u.grp.position.x;
      const _dz0  = target.grp.position.z - u.grp.position.z;
      const _dist = Math.sqrt(_dx0 * _dx0 + _dz0 * _dz0);
      const _def0 = UNIT_TYPES[u.type] ?? {};
      const _meleeA0 = (_def0.attacks ?? []).find(a => a.type === 'melee');
      const inMeleeRange = _meleeA0 && _dist <= atkTriggerWU(_meleeA0);

      // Path 1: Already in melee → swing immediately, end turn
      if (inMeleeRange) {
        doAttack(endAITurn);
        return;
      }

      // Path 2: In ranged range (not melee) → throw javelin, then close to melee
      const rangedAtk = aiGetAttack(u, target, turnAttacked, atkHasQty, atkTriggerWU, atkRangeWU, hasLineOfSight);
      if (rangedAtk?.type === 'ranged') {
        showAttackTargets(u);
        setTimeout(() => {
          hideAttackTargets();
          turnAttacked = true;
          hideUndoBtn();
          updateCombatStatus();
          const hpBefore = target.hp;
          performAttack(u, target, rangedAtk);
          setTimeout(() => {
            const continueAfterRanged = () => {
              if (!units.includes(u) || !units.includes(target)) { endAITurn(); return; }
              showMoveRange(u);
              const dest = aiPickDestTowardMelee(u, target, validTiles, atkTriggerWU);
              hideMoveRange();
              if (!dest) { endAITurn(); return; }
              moveToAndThen(dest, endAITurn);
            };
            _checkDelayedTriggers('ally_damaged', target, target.hp < hpBefore, continueAfterRanged);
          }, ATK_RESOLVE);
        }, PRE_ATK_MS);
        return;
      }

      // Path 3: Out of all attack range → move toward melee, attack if now in range
      showMoveRange(u);
      const dest = aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU);
      hideMoveRange();
      if (!dest) { endAITurn(); return; }

      // Sprint: melee-only enemies that can't reach their target with normal movement
      // spend their action to dash (double movement), forfeiting their attack.
      const _isMeleeOnly = !(_def0.attacks ?? []).some(a => a.type === 'ranged');
      if (_isMeleeOnly && !turnAttacked) {
        const _ddx = target.grp.position.x - dest.x;
        const _ddz = target.grp.position.z - dest.z;
        const _destDist = Math.sqrt(_ddx * _ddx + _ddz * _ddz);
        const _meleeTrigger = _meleeA0 ? atkTriggerWU(_meleeA0) : 0;
        const _destInMelee  = _meleeTrigger > 0 && _destDist <= _meleeTrigger;
        if (!_destInMelee) {
          turnAttacked = true;
          const _sprintBudgetFt = (_def0.speed ?? 30) * 2 - turnMovedFt;
          showMoveRange(u, _sprintBudgetFt);
          const sprintDest = aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU);
          hideMoveRange();
          updateCombatStatus();
          if (!sprintDest) { endAITurn(); return; }
          addLog(`${unitLabel(u)} uses Dash (action) — double move: ${(_def0.speed ?? 30) * 2} ft`, 'move');
          moveToAndThen(sprintDest, endAITurn);
          return;
        }
      }

      moveToAndThen(dest, () => setTimeout(() => doAttack(endAITurn), PRE_ATK_MS));
    }

    _checkDelayedTriggers('enemy_turn_start', u, false, runPaths);
  }, THINK_MS);
}

// ── Spell-bar button handler (called from ui.js click delegation) ────────────
export function triggerSpellBarAction(spellKey) {
  if (!combatPhase || isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;

  const sp = ELF_SPELLS[spellKey] ?? SPELLS[spellKey];
  if (!sp) return;

  // Cantrip (level 0) — ranged-attack path (e.g. Fire Bolt) or fall through to handler
  if ((sp.level ?? 1) === 0) {
    const attacks   = UNIT_TYPES[u.type]?.attacks ?? [];
    const rangedAtk = attacks.find(a => a.type === 'ranged');
    if (!rangedAtk || !sp.displayOnly) {
      // Not a ranged-attack cantrip (e.g. Healing Word) — route to unit-type handler
      if (u.type === 'elf') handleElfSpellBtnClick(spellKey);
      else handleSpellBtnClick(spellKey);
      return;
    }
    if (!selectedTarget || turnAttacked) return;
    const tgt = selectedTarget;
    turnAttacked = true;
    hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
    performAttack(u, tgt, rangedAtk);
    const rem = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
    if (rem > 0) { heroMode = 'move'; showMoveRange(u); } else { heroMode = null; }
    updateCombatStatus();
    return;
  }

  // Level 1+ — route to the appropriate unit-type handler
  if (u.type === 'elf') {
    handleElfSpellBtnClick(spellKey);
  } else {
    handleSpellBtnClick(spellKey);
  }
}
