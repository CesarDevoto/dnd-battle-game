import * as THREE from 'three';
import { scene, camera, renderer, ground, ceiling, divider, focusCameraOnUnit, setFollowUnit } from './scene.js';
import { units, heroRoster, setUnitWalking, playUnitAttackAnim, playUnitDeathAnim, setUnitStealth } from './units.js';
import { summonFamiliar, isFamiliarSummoned, getFamiliar, startFamiliarDeath, familiarHelpGesture, enterCombatFamiliar, startFamiliarDive } from './familiar.js';
import { playWebEffect } from './webEffect.js';
import { playPoisonEffect } from './poisonEffect.js';
import { toggleMiloHideOOC, canMiloHideOOC } from './hideOOC.js';
import { triggerHealingWordOOC, canHealingWordOOC } from './healingWordOOC.js';
import { COLORS, INTERACTION, UNIT_TYPES, COMBAT, HERO_RING_COLORS,
         WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET, ADJACENT_WU, ENEMY_CR, GROUND_SIZE,
         rageUsesForLevel, rageMitigationForLevel, precisionHitBonusForLevel } from './constants.js';
import { getTerrainHeight, getGroundHeight, raySurfacePoint, barrierBlocksLayer, caveLayersActive, layersCanSee } from './terrain.js';
import { roll, showRoll, clearRollFeed, parseDiceFormula } from './dice.js';
import { playMagicMissileEffect }  from './magicmissile.js';
import { playSacredFlameEffect }   from './sacredflame.js';
import { spawnSmokeCloud }         from './smokemirrors.js';
import { propPositions, losBlockerMeshes, getSurfaceHeight, activeEnv, barrierSegments } from './environments.js';
import { showSelectionHighlight, hideSelectionHighlight } from './selectionHighlight.js';
import { SPELLS, ELF_SPELLS, LEVEL_SPELLS, STARTING_SPELLS, isAbilityUnlocked, blessedUnits, applyBless, clearBless, tickBless, initSpellSlots, concentrating, concentratingSpell } from './spells.js';
import { playFireboltEffect }      from './firebolt.js';
import { playHealingWordEffect }   from './healingWord.js';
import { playInflictWoundsEffect, playGraveCurseEffect, playGraveCurseBolt } from './morvathEffects.js';
import { fireRangedAttack }        from './arrow.js';
import { fireThrownAxe }           from './thrownAxe.js';
import { fireJavelin }             from './javelin.js';
import { showTargetWindow, hideTargetWindow, updateTargetWindowHP } from './targetWindow.js';
import { bindHotkey, unbindHotkey, clearAllHotkeys, updateHotkeyRanges, markHotkeyUnavailable, setSlotIcon } from './hotbar.js';
import { hotbarIconHTML, ABILITY_META } from './abilityRegistry.js';
import { aiPickTarget, aiGetAttack, aiPickDest, aiPickDestTowardMelee,
         aiGetSpellcasterAttack, aiPickSpellcasterDest,
         aiPickHeroDest, aiPickAllyDest } from './combatAI.js';
import { initCombatAutomation, isAutomated, hasPendingSwitch,
         handleRoundStartSwitch, pickAutoTarget, getTendency } from './combatAutomation.js';
import { buildHeroSpellPanel, refreshHeroSpellPanel } from './heroAbilities.js';
import { awardXP } from './progression.js';
import { isLevelUpModalOpen } from './levelUpModal.js';
import { rollLoot, spawnLootLabels } from './loot.js';
import { runPostCombat } from './postCombat.js';
import { playSound, playUnitAttackSound, playUnitMoveSound, playCombatMusic, stopCombatMusic } from './audio.js';
import { onHeroDied, onCombatEnd, onEnemyKilled } from './dagnaEvent.js';
import { computeAC } from './equipment.js';

// Tracks the active zone id purely off the global zone:loaded event, so loot
// rolls can key one-time drops to a zone without importing zoneLoader.js
// (which itself imports from this module — would be circular).
let _activeZoneId = null;
window.addEventListener('zone:loaded', e => { _activeZoneId = e.detail?.id ?? null; });

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

// ── Conforming-ring surface sampling ──────────────────────────────────────────
// The active/range/hover rings drape their vertices over the ground. In a cave
// zone a hero on the blanket stands on the UNCARVED roof (getGroundHeight('surface')
// = uncarved + CEIL_LIFT), while getSurfaceHeight returns the CARVED floor below —
// so sampling getSurfaceHeight buries the ring under the blanket and it gets clipped.
// _conformLayer tracks the layer of the unit the rings currently belong to; set it
// whenever the ring owner changes (turn start, selection, move). Non-cave zones fall
// back to getSurfaceHeight so the water-plane float behaviour is preserved.
let _conformLayer = 'surface';
function _ringSurfaceH(x, z) {
  return caveLayersActive() ? getGroundHeight(x, z, _conformLayer) : getSurfaceHeight(x, z);
}

// ── Active ring ───────────────────────────────────────────────────────────────

export const activeRing = new THREE.Mesh(
  _makeConformingGeo(0, 0, INTERACTION.activeRingInner, INTERACTION.activeRingOuter, 32, 0.05),
  new THREE.MeshBasicMaterial({
    color: COLORS.activeRing, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
    depthTest: true,   // let the unit's body occlude the ring behind it
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
      depthWrite: false, depthTest: true,   // let the unit's body occlude the ring behind it
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
      depthWrite: false, depthTest: true,   // let the unit's body occlude the ring behind it
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
    pos[vi++] = _ringSurfaceH(cx + inner * cos, cz + inner * sin) + lift;
    pos[vi++] = inner * sin;
    pos[vi++] = outer * cos;
    pos[vi++] = _ringSurfaceH(cx + outer * cos, cz + outer * sin) + lift;
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
    arr[base + 1] = _ringSurfaceH(cx + inner * cos, cz + inner * sin) + lift;
    arr[base + 4] = _ringSurfaceH(cx + outer * cos, cz + outer * sin) + lift;
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
    pos[vi++] = _ringSurfaceH(cx + _HOVER_INNER * cos, cz + _HOVER_INNER * sin) + _HOVER_LIFT;
    pos[vi++] = _HOVER_INNER * sin;
    pos[vi++] = _HOVER_OUTER * cos;
    pos[vi++] = _ringSurfaceH(cx + _HOVER_OUTER * cos, cz + _HOVER_OUTER * sin) + _HOVER_LIFT;
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
  _conformLayer = u.caveLayer ?? 'surface';
  const def    = UNIT_TYPES[u.type] ?? {};
  const atks   = def.attacks ?? [];
  const meleeA = atks.find(a => a.type === 'melee');
  // Rasec has no ranged weapon in attacks[] — Fire Bolt (90 ft) is his ranged
  // attack via the synthetic _fireBoltAtk, so fall back to it for the ring.
  const rangdA = atks.find(a => a.type === 'ranged') ?? (u.type === 'elf' ? _fireBoltAtk() : null);
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
  _conformLayer = caster.caveLayer ?? 'surface';
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

// ── Owl familiar Help ─────────────────────────────────────────────────────────
// The enemy the owl distracted (Rasec has advantage against it until the end of
// his next turn), and whether the owl's turn is currently picking that target.
let _owlHelpTarget  = null;
let _owlHelpPicking = false;
export let combatPhase = false;

// Callback registered by zoneLoader to block premature victory while spawns are pending.
// NOTE: `var` (not `let`) so the binding is hoisted — zoneLoader imports combat.js and
// calls registerPendingSpawnCheck() at module-load time, which in the import cycle runs
// before this line evaluates. A `let` here throws a TDZ error ("Cannot access
// '_pendingSpawnCheckFn' before initialization") and aborts the whole app boot. We also
// leave it uninitialized (defaulting at the call site) so a later initializer can't clobber
// the real callback that zoneLoader already registered.
var _pendingSpawnCheckFn;
export function registerPendingSpawnCheck(fn) { _pendingSpawnCheckFn = fn; }

let _halfGroundSize = GROUND_SIZE / 2;
export function setGroundBounds(half) { _halfGroundSize = half; }
let turnMovedFt  = 0;   // feet used this turn (can interleave with attack)
let turnAttacked = false;
// Find Familiar: one summon per fight. Cleared in rollInitiative().
let _familiarSummonedThisCombat = false;

// Dungeon stealth: enemies must gain LOS to a hero before they act.
// Populated on first sighting; cleared each new battle.
const _dungeonAwareEnemies = new Set();
let heroMode     = null; // null | 'move' | 'elfatk_*' | 'spell_*'
export let isAnimating = false;
let turnBonusActioned = false;  // bonus action used this turn (e.g. Healing Word)
let turnReactionUsed  = false;  // reaction used this turn (e.g. Soul Shard Amulet)
let sneakAttackUsed  = false;   // halfling sneak attack — once per turn
let prevMoveState = null; // { x, z, movedFt } saved just before a move for undo

const _readied = new Map();  // hero → trigger string ('enemy_in_los' | 'enemy_in_melee_range' | 'enemy_in_ranged_range' | 'ally_loses_hp')

const blueUndo   = document.getElementById('blue-undo-btn');
const endTurnBtn = document.getElementById('end-turn-btn');
const moveDistEl = document.getElementById('move-dist');
initCombatAutomation();

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
  const path = findPath(u.grp.position.x, u.grp.position.z, x, z, u.caveLayer);
  animatePath(u, path, () => {
    turnMovedFt = movedFt;
    addLog(`${unitLabel(u)} undoes move`, 'walk');
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

// Returns true if the step from (ax,az) to (bx,bz) crosses any barrier segment.
function crossesBarrier(ax, az, bx, bz, layer) {
  for (const s of barrierSegments) {
    const rx = bx - ax, rz = bz - az;
    const sx = s.x2 - s.x1, sz = s.z2 - s.z1;
    const denom = rx * sz - rz * sx;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const qpx = s.x1 - ax, qpz = s.z1 - az;
    const t = (qpx * sz - qpz * sx) / denom;
    const u = (qpx * rz - qpz * rx) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    // Layer-test the actual CROSSING point, not the segment's midpoint: a long wall
    // running from open ground into a tunnel would otherwise be classified by
    // whatever its middle happens to sit on, and leak along the rest of its length.
    if (barrierBlocksLayer(ax + rx * t, az + rz * t, layer)) return true;
  }
  return false;
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
//
// `layer` picks WHICH surface to sample in a cave zone. This used to be hard-wired to
// getTerrainHeight — the CARVED floor — which is right for two units down in a tunnel but
// wrong for two units up on the blanket: it sampled the tunnel floor far below them, so no
// ridge ever registered and surface units could see straight through hills that had a tunnel
// running under them. getGroundHeight samples whichever surface the pair is actually on.
function _terrainBlocksLOS(ax, az, tx, tz, fromY, toY, layer) {
  for (let i = 1; i < LOS_STEPS; i++) {
    const t  = i / LOS_STEPS;
    const th = getGroundHeight(ax + (tx - ax) * t, az + (tz - az) * t, layer);
    if (th > fromY + (toY - fromY) * t) return true;
  }
  return false;
}

// aLayer/tLayer are the cave layers of the two endpoints ('surface' | 'under'). They default
// to 'surface', which is a no-op outside cave zones (getGroundHeight falls through to
// getTerrainHeight when layers are inactive). Prefer unitsHaveLOS() below wherever both ends
// are units — it fills these in for you and is the only form that is correct in a cave.
export function hasLineOfSight(ax, az, tx, tz, aLayer = 'surface', tLayer = 'surface') {
  const dx = tx - ax, dz = tz - az;
  if (dx * dx + dz * dz === 0) return true;

  // Solid rock between them: someone on the blanket cannot see someone in the tunnel below,
  // unless the one underground is standing in a mouth and so open to the sky.
  if (!layersCanSee(aLayer, ax, az, tLayer, tx, tz)) return false;

  // Past that gate the two are on the same walkable surface (or at a merged mouth, where the
  // surfaces coincide and either sample gives the same answer), so one layer samples both.
  const fromY = getGroundHeight(ax, az, aLayer) + LOS_EYE_H;
  const toY   = getGroundHeight(tx, tz, tLayer) + LOS_EYE_H;

  // Terrain check: cheap height sampling along the ray
  if (_terrainBlocksLOS(ax, az, tx, tz, fromY, toY, aLayer)) return false;

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

// Layer-aware LOS between two UNITS — the form to use anywhere both ends are units, which is
// every LOS test in the game (attack validity, AI targeting, readied triggers, hide checks).
// The bare hasLineOfSight(x,z,x,z) call defaults both ends to 'surface' and so cannot tell a
// hero in a tunnel from one on the hill above it; this reads each unit's live caveLayer,
// which main.js keeps current every frame.
export function unitsHaveLOS(a, b) {
  if (!a?.grp || !b?.grp) return false;
  return hasLineOfSight(
    a.grp.position.x, a.grp.position.z,
    b.grp.position.x, b.grp.position.z,
    a.caveLayer ?? 'surface', b.caveLayer ?? 'surface',
  );
}

// True when a conscious blue ally (not the attacker) is within 3 WU of target (covers diagonal adjacency)
function _allyAdjacentToTarget(attacker, target) {
  for (const ally of units) {
    if (ally.grp === attacker.grp) continue;
    if (ally.team !== 'blue') continue;
    if (ally.hp <= 0 || sleepingUnits.has(ally) || ally.stunned) continue;
    const dx = ally.grp.position.x - target.grp.position.x;
    const dz = ally.grp.position.z - target.grp.position.z;
    if (dx * dx + dz * dz <= ADJACENT_WU * ADJACENT_WU) return true;
  }
  return false;
}

// A hidden (stealthed) halfling is an unseen attacker: he gets Sneak Attack on
// ANY target in range, not just ones an ally is adjacent to — mirrors 5e's
// "unseen attacker → advantage" rule. Movement doesn't forfeit it (he stays
// hidden while moving unless an enemy's Perception spots him, see
// _checkHidePerception); making the attack itself is what breaks stealth.
function _isHiddenForSneak(u) {
  return !!u.stealthed;
}

// wasHidden must be SNAPSHOT BEFORE the attack breaks the attacker's stealth — see the
// call in _executeAttack. Defaulting it to the live flag keeps the helper honest for any
// caller testing the condition ahead of an attack (the hotbar's sneak_attack availability,
// the 'sneak_possible' tendency), where nothing has been torn down yet.
function hasSneakAttackCondition(attacker, target, atkResult, wasHidden = _isHiddenForSneak(attacker)) {
  return atkResult.mode === 'advantage' || _allyAdjacentToTarget(attacker, target) || wasHidden;
}

// Returns true when an attack has no qty limit OR still has shots remaining.
function atkHasQty(unit, atk) {
  if (atk.qty === undefined) return true;
  return (unit.atkQty?.[atk.name] ?? atk.qty) > 0;
}

// Recover limited-qty attacks (thrown weapons like Gobo's Handaxes) to their base
// count. Called at the start of each combat so every fight begins fully stocked.
function _refreshAttackQty() {
  for (const u of units) {
    if (!u.atkQty) continue;
    const atks = UNIT_TYPES[u.type]?.attacks;
    if (!atks) continue;
    for (const atk of atks) {
      if (atk.qty !== undefined) u.atkQty[atk.name] = atk.qty;
    }
  }
}

// What a unit's ranged attack actually throws. Keyed off UNIT_TYPES[type].projectile so
// giving a new creature a javelin (or an axe) is a data edit, not another branch in the
// firing code — this used to be a chain of `attacker.type === ...` special cases.
// Fire Bolt is NOT here: it's a spell with its own effect, handled separately.
const _PROJECTILES = {
  arrow:   fireRangedAttack,   // default — bows, crossbows, slings
  axe:     fireThrownAxe,      // Gobo's tumbling handaxe
  javelin: fireJavelin,        // the ogre's spear
};

function _projectileFor(attacker) {
  const key = UNIT_TYPES[attacker.type]?.projectile ?? 'arrow';
  return _PROJECTILES[key] ?? fireRangedAttack;
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
// Distance at which an attack can trigger. Melee (≤ 1 square / 5 ft) uses the shared
// ADJACENT_WU adjacency radius, so melee reach (and its range ring) match the
// engagement lock and Sneak Attack adjacency EXACTLY — bumping ADJACENT_WU moves all
// three together. Reach weapons (> 5 ft) scale up naturally via atkRangeWU.
function atkTriggerWU(atk) {
  if ((atk.range ?? GRID_SQUARE_FEET) <= GRID_SQUARE_FEET) return ADJACENT_WU;
  return atkRangeWU(atk.range);
}

// ── Pathfinding (BFS on the grid, blocking props only) ────────────────────────

function findPath(sx, sz, tx, tz, layer) {
  const S = WORLD_UNITS_PER_SQUARE;
  const key = (x, z) => `${x},${z}`;
  const dirs = [
    [0, S], [0, -S], [S, 0], [-S, 0],
    [S, S], [S, -S], [-S, S], [-S, -S],
  ];
  const parent = new Map([[key(sx, sz), null]]);
  const queue  = [{ x: sx, z: sz }];
  let head = 0; // index-based dequeue — queue.shift() is O(n) per call, which
                // turns a long/failed search (e.g. no path yet to a target
                // still outside the room) into O(n²) and can freeze for
                // several seconds in a zone with many barrier segments.

  while (head < queue.length) {
    const { x, z } = queue[head++];
    if (x === tx && z === tz) break;
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      const k  = key(nx, nz);
      if (parent.has(k)) continue;
      if (Math.abs(nx) > _halfGroundSize || Math.abs(nz) > _halfGroundSize) continue;
      if (hasPropClash(nx, nz)) continue;
      if (crossesBarrier(x, z, nx, nz, layer)) continue;
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
  // Flying familiars keep their hover height while moving instead of skimming
  // the ground (their turn-to-turn height is terrain + hoverY).
  const flyY = unit.familiar ? (unit.hoverY ?? 0) : 0;

  let stepIdx = 0;
  let startX  = unit.grp.position.x;
  let startZ  = unit.grp.position.z;
  let startY  = getGroundHeight(startX, startZ, unit.caveLayer);
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
    const endY    = getGroundHeight(target.x, target.z, unit.caveLayer);

    unit.grp.position.x = startX + dx * t;
    unit.grp.position.z = startZ + dz * t;
    unit.grp.position.y = startY + (endY - startY) * t + flyY;
    unit.anchor.x = unit.grp.position.x;
    unit.anchor.z = unit.grp.position.z;
    unit.anchor.y = unit.grp.position.y + unit.anchorY;
    _conformLayer = unit.caveLayer ?? 'surface';
    updateConformingRingGeo(activeRing, unit.grp.position.x, unit.grp.position.z);
    activeRing.position.set(unit.grp.position.x, 0, unit.grp.position.z);
    moveRangeRings(unit.grp.position.x, unit.grp.position.z);

    if (t >= 1) {
      // Snap to exact grid position
      unit.grp.position.set(target.x, endY + flyY, target.z);
      unit.anchor.x = target.x;
      unit.anchor.y = endY + flyY + unit.anchorY;
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

// Smoke & Mirrors (Milo, lvl 3) — 10 ft radius smoke bomb, heavily obscured
// for 2 rounds after the casting round. Tick counter starts at 3: the cast
// round itself doesn't decrement, then 2 more full round-advances do, so the
// cloud covers the cast turn plus his next two turns before dissipating.
const SMOKE_RADIUS_FT  = 10;
const SMOKE_ROUNDS_LOG = 2;   // for player-facing text only
const SMOKE_TICKS      = 3;   // internal round-advance countdown (see comment above)
const SMOKE_USES       = 2;   // castable twice per combat
// Heavily obscured: attackers can't see him clearly inside the cloud. Modelled as a flat
// AC bonus rather than blanket disadvantage-to-hit, which would stack badly with Dodge.
const SMOKE_AC_BONUS   = 3;

// Every Smoke & Mirrors benefit is POSITIONAL: it applies only while the unit stands within
// SMOKE_RADIUS_FT of the centre of its own live cloud. These used to test the bare
// u.smokeActive flag, so once Milo walked out, the obscurement, the free hide and the
// advantage all followed him across the map for the cloud's remaining rounds.
function _inOwnSmoke(u) {
  if (!u?.smokeActive || !u.smokeCenter) return false;
  const rWU = (SMOKE_RADIUS_FT / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const dx  = u.grp.position.x - u.smokeCenter.x;
  const dz  = u.grp.position.z - u.smokeCenter.z;
  return dx * dx + dz * dz <= rWU * rWU;
}

// BFS flood-fill to find all tiles reachable within maxDist WU, respecting
// props and barriers step-by-step (not just a direct-line check from origin).
function _bfsReachable(ux, uz, maxDist, excludeUnit, layer) {
  const S    = WORLD_UNITS_PER_SQUARE;
  const key  = (x, z) => `${x},${z}`;
  const dirs = [
    [0, S], [0, -S], [S, 0], [-S, 0],
    [S, S], [S, -S], [-S, S], [-S, -S],
  ];
  const dist   = new Map([[key(ux, uz), 0]]);
  const queue  = [{ x: ux, z: uz, d: 0 }];
  const result = new Set();
  let head = 0; // index-based dequeue — see findPath() for why .shift() is avoided here
  while (head < queue.length) {
    const { x, z, d } = queue[head++];
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      const nd = d + Math.sqrt(dx * dx + dz * dz);
      if (nd > maxDist + 1e-6) continue;
      const k = key(nx, nz);
      if (dist.has(k)) continue;
      if (Math.abs(nx) > _halfGroundSize || Math.abs(nz) > _halfGroundSize) continue;
      if (hasPropClash(nx, nz)) continue;
      if (crossesBarrier(x, z, nx, nz, layer)) continue;
      dist.set(k, nd);
      // Units can pass THROUGH occupied squares but cannot stop on one.
      if (!isOccupied(nx, nz, excludeUnit)) result.add(k);
      queue.push({ x: nx, z: nz, d: nd });
    }
  }
  return result;
}

function showMoveRange(u, overrideFt) {
  if (_saveImmobilizes(u)) { hideMoveRange(); return; }   // held by an unbroken action-save — speed 0
  _conformLayer = u.caveLayer ?? 'surface';
  const def      = UNIT_TYPES[u.type] ?? {};
  const remainFt = overrideFt !== undefined ? overrideFt : (def.speed ?? 30) - turnMovedFt;
  if (remainFt <= 0) { hideMoveRange(); return; }

  const maxDist = (remainFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const ux = u.grp.position.x, uz = u.grp.position.z;

  validTiles.clear();
  for (const k of _bfsReachable(ux, uz, maxDist, u, u.caveLayer)) validTiles.add(k);

  // Milo used to be CONFINED to his own Smoke & Mirrors cloud — every tile outside its
  // radius was pruned from validTiles until it dissipated. He can now walk out of it
  // freely, and doing so costs him neither his hide nor his Sneak Attack: stealth is
  // broken only by an enemy's Perception check (_checkHidePerception, rolled after each
  // move) or by his own attack, never by leaving the smoke. u.smokeActive is a flag with
  // a round countdown rather than a position test, so the cloud's advantage rides along
  // with him for its remaining rounds.

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
               unitsHaveLOS(u, enemy)) {
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

// ── Out-of-combat Healing Word targeting (Leugren, one use between combats) ──
// Reuses the same green rings/raycasting as the in-combat version, but isn't
// driven by turnOrder/heroMode/turnAttacked since there's no turn outside
// combat. Driven by js/healingWordOOC.js.
let _oocHealCaster = null;
let _oocHealOnCast = null;

export function isOOCHealPicking() { return _oocHealCaster !== null; }

export function startOOCHealTargeting(caster, onCast) {
  if (combatPhase) return;
  _oocHealCaster = caster;
  _oocHealOnCast = onCast;
  showHealTargets(caster, 'healing_word');
}

// Cancels picking (e.g. clicked empty ground, or the player toggled it off).
// Still calls onCast(null) so the caller can reset its own UI state.
export function cancelOOCHealTargeting() {
  if (!_oocHealCaster) return;
  const cb = _oocHealOnCast;
  _oocHealCaster = null;
  _oocHealOnCast = null;
  hideHealTargets();
  cb?.(null);
}

function _resolveOOCHeal(target) {
  const cb = _oocHealOnCast;
  _oocHealCaster = null;
  _oocHealOnCast = null;
  hideHealTargets();
  cb?.(target);
}

// ── Spell casting ─────────────────────────────────────────────────────────────

function castHeal(caster, target, spellKey) {
  const spell = SPELLS[spellKey];
  if (!spell) return;
  // Never fire (or spend the slot/action) on an ally already at full HP — let
  // the healer redirect. Keep heal-targeting active so they can pick another.
  if (target.hp >= target.maxHp) {
    showFloatingDamage(target, 'Full HP', '#8fd0ff');
    addLog(`${unitLabel(target)} is already at full health — ${spell.name} not spent.`, 'heal');
    showHealTargets(caster, spellKey);
    return;
  }
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
    addLog(`${unitLabel(caster)} heals ${unitLabel(target)} for ${healed} hp (${spell.name} · ${dmgBreakdown(healRoll)})`, 'heal');
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

// ── Sacred Flame (Cleric lvl 3 cantrip — no spell slot, targets an enemy) ────
function showSacredFlameTargets(caster) {
  hideAttackTargets();
  if (turnAttacked) return;
  const rangeWU = atkRangeWU(SPELLS.sacred_flame.rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  let ri = 0;
  units.filter(e => e.team !== caster.team && e.hp > 0).forEach(enemy => {
    if (ri >= MAX_ATK_RINGS) return;
    const dx = enemy.grp.position.x - ux, dz = enemy.grp.position.z - uz;
    if (Math.sqrt(dx * dx + dz * dz) > rangeWU) return;
    if (!unitsHaveLOS(caster, enemy)) return;
    const ring = atkRings[ri++];
    ring.material.color.set(0xffcc33);
    ring.position.set(enemy.grp.position.x, enemy.grp.position.y + 0.07, enemy.grp.position.z);
    ring.visible = true;
    atkTargets.set(enemy, 'sacred_flame');
  });
}

function castSacredFlame(caster, target, onDone) {
  const spell = SPELLS.sacred_flame;
  faceTarget(caster, target);
  playUnitAttackAnim(caster, 'spell');
  hideAttackTargets();
  hideSpellRangeRing();
  heroMode = null;
  turnAttacked = true;   // cantrip — no spell slot cost

  const postSpellRemaining = (UNIT_TYPES[caster.type]?.speed ?? 30) - turnMovedFt;
  if (postSpellRemaining > 0) { heroMode = 'move'; showMoveRange(caster); }

  const dexMod     = Math.floor(((UNIT_TYPES[target.type]?.abilities?.dex ?? 10) - 10) / 2);
  const saveResult = rollSave(dexMod, spell.saveDC, target.dodging ? 'advantage' : 'normal');
  const dmgRoll    = roll({ sides: spell.sides, count: spell.dice });
  const dmg        = saveResult.isSave ? 0 : dmgRoll.total;

  playSacredFlameEffect(caster, target, () => {
    target.aggro = true;
    buildTurnList();
    showRoll(`${unitLabel(target)} · DEX Save (Sacred Flame)`, saveResult, { autoDismiss: false });
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
      target.barShowUntil = Date.now() + 5000;
      showFloatingDamage(target, `-${dmg}`, '#ffcc44');
      addLog(`${unitLabel(caster)} casts Sacred Flame → ${unitLabel(target)}: FAILS (${saveBreakdown(saveResult, 'dex')}) — ${dmg} radiant dmg`, 'spell');
      if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target, caster), 400);
    } else {
      showFloatingDamage(target, 'SAVE', '#88ccff');
      addLog(`${unitLabel(caster)} casts Sacred Flame → ${unitLabel(target)}: SAVES (${saveBreakdown(saveResult, 'dex')}) — no damage`, 'spell');
    }
    onDone?.();
  });

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
             unitsHaveLOS(u, selectedTarget)) {
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
    if (turnAttacked) return;
    castBless(u);
    return;
  }

  if (spellKey === 'sacred_flame') {
    if (turnAttacked) return;
    if (heroMode === 'dwarfatk_sacred_flame') {
      heroMode = null;
      hideCastConfirm();
      hideAttackTargets();
      hideSpellRangeRing();
      const cancelRemaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
      if (cancelRemaining > 0) { heroMode = 'move'; showMoveRange(u); }
      updateCombatStatus();
      return;
    }
    hideMoveRange();
    hideHealTargets();
    showSacredFlameTargets(u);

    // If a valid target is already selected, cast immediately.
    if (selectedTarget && atkTargets.has(selectedTarget)) {
      castSacredFlame(u, selectedTarget);
      return;
    }

    heroMode = 'dwarfatk_sacred_flame';
    showSpellRangeRing(u, SPELLS.sacred_flame.rangeFt);
    updateCombatStatus();
    return;
  }

  const spell = SPELLS[spellKey];
  // Restrained: nothing at all this turn, not even a bonus action. turnAttacked (set by the
  // break-free struggle) already blocks the Action path, so this is what closes the bonus one.
  if (_saveLocksTurn(u)) return;   // restrained/grappled: the save is the only legal action
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

  addLog(`${unitLabel(u)} takes a Defensive Stance! +3 AC for 3 rounds`, 'move');
  showFloatingDamage(u, '🛡 +3 AC', '#aaddff');
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
  const icon  = document.createElement('div'); icon.className  = 'maf-icon';
  icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 46" width="0.88em" height="1em" style="display:block;filter:drop-shadow(0 0 6px rgba(190,110,255,0.85))"><path d="M20,43 Q5,33 5,20 L5,8 Q5,4 9,4 L31,4 Q35,4 35,8 L35,20 Q35,33 20,43 Z" fill="currentColor" stroke="rgba(238,221,255,0.7)" stroke-width="1.5" stroke-linejoin="round"/></svg>';
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

  addLog(`${unitLabel(u)} casts Mage Armor! +3 AC (now ${(u.ac ?? 12) + 3}) for this combat`, 'spell');
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
  // Smoke & Mirrors: standing in his own cloud, Milo has cover — he can attempt to hide
  // even if an enemy would otherwise have line of sight.
  const hasEnemyLOS = !_inOwnSmoke(u) && units.some(e =>
    e.team === 'red' && e.hp > 0 && e.aggro &&
    unitsHaveLOS(e, u)
  );
  if (hasEnemyLOS) {
    addLog(`${unitLabel(u)}: Can't hide — enemies have line of sight!`, 'dmg');
    return;
  }

  const def    = UNIT_TYPES[u.type] ?? {};
  const dexMod = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
  // Auto-success: inside his own cloud the heavy obscurement fully conceals him — Hide
  // succeeds with no roll. Standing still is NOT required; being in the smoke is enough.
  const autoHide = _inOwnSmoke(u);
  const stealth  = autoHide ? 20 + dexMod : Math.floor(Math.random() * 20) + 1 + dexMod;

  turnBonusActioned = true;
  u.hideCooldown    = 2;
  playSound('hide');

  if (autoHide || stealth >= 10) {
    u.hideRoll = stealth;
    setUnitStealth(u, true);
    addLog(autoHide
      ? `${unitLabel(u)} melts into his smoke — Hide auto-succeeds! (Stealth ${stealth})`
      : `${unitLabel(u)} hides! Stealth ${stealth} — enemies need ${stealth}+ to spot you`, 'move');
    showFloatingDamage(u, `HIDDEN (${stealth})`, '#44ff88');
  } else {
    addLog(`${unitLabel(u)}: Hide failed! (Stealth ${stealth} vs DC 10)`, 'dmg');
    showFloatingDamage(u, `HIDE FAIL (${stealth})`, '#ff6644');
  }
  updateCombatStatus();
}

// ── Smoke & Mirrors (Rogue lvl 3) ─────────────────────────────────────────────
// Action, twice per combat. Throws a smoke bomb in a 10 ft radius around Milo; the area is
// heavily obscured for 2 rounds. Every benefit below requires him to be standing WITHIN
// that 10 ft of the cloud's centre (_inOwnSmoke) — he's free to walk out, he just takes
// nothing with him:
//   • +SMOKE_AC_BONUS AC — the heavy obscurement (see _executeAttack)
//   • Hide as though he has cover, ignoring enemy line of sight (see activateHide above)
//   • Hide auto-succeeds (ditto)
//   • advantage on any attack that already qualifies for Sneak Attack (see _executeAttack)
// Casting again re-centres the cloud on his current position, spending the second use.
function activateSmokeMirrors() {
  if (isAnimating || turnAttacked) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'halfling' || (u.smokeUses ?? 0) <= 0) return;

  u.smokeUses--;
  u.smokeActive     = true;
  u.smokeCenter     = { x: u.grp.position.x, z: u.grp.position.z };
  u.smokeRoundsLeft = SMOKE_TICKS;
  turnAttacked      = true;

  playSound('smoke_bomb');
  if (u._smokeVFX) u._smokeVFX.dispose();
  const radiusWU = (SMOKE_RADIUS_FT / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  u._smokeVFX = spawnSmokeCloud(u.grp.position.x, 0, u.grp.position.z, radiusWU);

  addLog(`${unitLabel(u)} throws a smoke bomb! The area is heavily obscured for ${SMOKE_ROUNDS_LOG} rounds ` +
         `(+${SMOKE_AC_BONUS} AC and free Hide while inside). ${u.smokeUses} use${u.smokeUses === 1 ? '' : 's'} left.`, 'spell');
  showFloatingDamage(u, 'SMOKE & MIRRORS', '#9a9ab0');
  updateCombatStatus();
}

function _checkHidePerception(hero) {
  if (!hero.stealthed || hero.team !== 'blue') return;
  const hx = hero.grp.position.x, hz = hero.grp.position.z;
  for (const e of units) {
    if (e.team !== 'red' || e.hp <= 0 || !e.aggro) continue;
    if (!unitsHaveLOS(e, hero)) continue;
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

// ── Healing potion (bonus action, Digit6) ───────────────────────────────────
// Bag-1 slot 0 is reserved for healing potions (see lootPanel.js) — any item
// with a `heal` dice-formula string sitting there is usable here.

function _heroPotion(u) {
  const item = u.equipment?.['bag-1']?.contents?.[0];
  return item?.heal ? item : null;
}

function _useHealingPotion(u) {
  if (isAnimating || turnBonusActioned) return;
  const item = _heroPotion(u);
  if (!item) return;
  // Don't drink (or spend the bonus action / charge) at full HP.
  if (u.hp >= u.maxHp) {
    showFloatingDamage(u, 'Full HP', '#8fd0ff');
    addLog(`${unitLabel(u)} is already at full health — potion not used.`, 'heal');
    return;
  }

  turnBonusActioned = true;

  const formula = parseDiceFormula(item.heal);
  const healed  = formula ? Math.max(1, roll(formula).total) : 1;
  const prev    = u.hp;
  u.hp = Math.min(u.maxHp, u.hp + healed);
  const actual = u.hp - prev;

  showFloatingDamage(u, `+${actual}`, '#55cc55');
  addLog(`${unitLabel(u)} drinks a ${item.name}, restoring ${actual} HP`, 'heal');

  item.qty = (item.qty ?? 1) - 1;
  if (item.qty <= 0) u.equipment['bag-1'].contents[0] = null;

  updateCombatStatus();
  _rebuildHotbar(u);
}

// ── Rage ─────────────────────────────────────────────────────────────────────

function activateRage(u) {
  u.raging  = true;
  u.rageUses--;
  turnBonusActioned = true;
  playSound('berserker_rage');
  showFloatingDamage(u, '⚔ RAGE!', '#ff6622');
  const _bits = [`+${UNIT_TYPES[u.type]?.rage?.dmgBonus ?? 2} melee dmg`];
  const _mit  = rageMitigationForLevel(u.level);
  if (_mit > 0) _bits.push(`resist ${Math.round(_mit * 100)}% dmg`);
  addLog(`${unitLabel(u)} enters RAGE! (${_bits.join(' · ')})`, 'spell');
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

// Fire Bolt as an attacks[]-shaped object — lets it reuse performAttack()'s
// to-hit/damage/crit/VFX pipeline without living in UNIT_TYPES.attacks (which
// would wrongly make it Rasec's "ranged weapon").
function _fireBoltAtk() {
  const sp = ELF_SPELLS.fire_bolt;
  return { name: sp.name, type: 'ranged', range: sp.rangeFt, dice: sp.dice, sides: sp.sides, statMod: sp.statMod };
}

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
    if (!unitsHaveLOS(caster, enemy)) return;
    const ring = atkRings[ri++];
    ring.material.color.set(0x9944ff);
    ring.position.set(enemy.grp.position.x, enemy.grp.position.y + 0.07, enemy.grp.position.z);
    ring.visible = true;
    atkTargets.set(enemy, 'magic_missile');
  });
}

function castMagicMissile(caster, target, onDone) {
  const spell   = ELF_SPELLS.magic_missile;
  const freeUse = !caster.mmFreeUsed;
  if (!freeUse && (caster.spellSlots ?? 0) <= 0) return;
  faceTarget(caster, target);
  playUnitAttackAnim(caster, 'ranged');
  hideAttackTargets();
  hideSpellRangeRing();
  heroMode = null;
  if (freeUse) caster.mmFreeUsed = true; else caster.spellSlots--;
  turnAttacked = true;

  const postSpellRemaining = (UNIT_TYPES[caster.type]?.speed ?? 30) - turnMovedFt;
  if (postSpellRemaining > 0) { heroMode = 'move'; showMoveRange(caster); }

  const darts = Array.from({ length: spell.darts }, () =>
    roll({ sides: spell.sides, modifier: spell.flatBonus })
  );
  const totalDmg = darts.reduce((s, r) => s + r.total, 0);

  // Visual — 4 neon purple arrows; damage applies when last bolt lands
  playMagicMissileEffect(caster, target, () => {
    target.aggro = true;
    buildTurnList();
    target.hp = Math.max(0, target.hp - totalDmg);
    target.barShowUntil = Date.now() + 5000;
    const dartStr = darts.map(r => r.total).join('+');
    showFloatingDamage(target, `-${totalDmg}`, '#aa66ff');
    addLog(`${unitLabel(caster)} casts Magic Missile${freeUse ? ' (free cast)' : ''} → ${unitLabel(target)}: ${dartStr} = ${totalDmg} force dmg`, 'spell');
    if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target, caster), 400);
    onDone?.();
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
        if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target, caster), 400);
      }, i * 700 + 1000);
    });
  }

  updateCombatStatus();

}

function handleElfSpellBtnClick(spellKey) {
  if (isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'elf') return;
  if (turnAttacked) return;
  const hasFreeMM = spellKey === 'magic_missile' && !u.mmFreeUsed;
  if (!hasFreeMM && (u.spellSlots ?? 0) <= 0) return;

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
    hideMoveRange();
    hideHealTargets();
    showMagicMissileTargets(u);

    // If a valid target is already selected, cast immediately.
    if (selectedTarget && atkTargets.has(selectedTarget)) {
      castMagicMissile(u, selectedTarget);
      return;
    }

    heroMode = 'elfatk_magic_missile';
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
  // Any action taken during a delay interrupt auto-closes the banner.
  // Attacks already schedule a 2600ms timer in performAttack; don't duplicate.
  if (_readyCtx && turnAttacked && !_readyAutoCloseTimer) {
    const _c = _readyCtx;
    _readyAutoCloseTimer = setTimeout(() => { if (_readyCtx === _c) _endDelayInterrupt(); }, 1500);
  }
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
      const reactBox = document.getElementById('act-react-box');
      if (reactBox) reactBox.classList.toggle('act-used', !!turnReactionUsed);
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
  // A readied action that never fired (its trigger never happened before the
  // fight ended) otherwise leaves the overhead "⚡" icon (updateReadyIcons)
  // stuck on that hero until their next combat turn activates and clears it.
  _readied.clear();
  _readiedAutomated.clear();
  _readiedBonusActioned.clear();
  _activeReadyHero = null;
  hideSoulShardPrompt();
  for (const [, state] of sleepingUnits) state.zzzEl?.remove();
  sleepingUnits.clear();
  units.forEach(u => { u.barForced = false; u.barShowUntil = 0; if (UNIT_TYPES[u.type]?.rage) u.raging = false; u.mageArmored = false; u.actionSave = null; });
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

// Called by dagnaEvent for the styx outro — ends combat immediately (even with
// enemies still aggro'd) but still runs the normal loot/post-combat chain, so
// 'postcombat:done' fires once the loot panel (if any) has been resolved.
export function forceCombatExitWithLoot() {
  if (!combatPhase) return;
  _teardownCombat();
  stopCombatMusic();
  window.dispatchEvent(new CustomEvent('combat:ended'));
  runPostCombat({ isVictory: true });
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

function removeDefeatedUnit(u, attacker = null) {
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
    // Event-based, not a direct import — bleakmireWoodsEvent.js listens for
    // this. combat.js already avoids importing zoneLoader.js for the same
    // reason (see _activeZoneId comment above): a direct import here would
    // create combat.js → bleakmireWoodsEvent.js → exclamationMarkers.js →
    // combat.js, a circular dependency that breaks module init order.
    window.dispatchEvent(new CustomEvent('unit:defeated', { detail: { type: u.type, respawnId: u._respawnId } }));
    const cr   = ENEMY_CR[u.type] ?? 0;
    const loot = rollLoot(cr, u.type, _activeZoneId);
    spawnLootLabels(u.grp.position, loot);
    window.dispatchEvent(new CustomEvent('enemy:looted', {
      detail: { enemyName: UNIT_TYPES[u.type]?.name ?? u.type, coins: loot.coins, items: loot.items },
    }));
    _checkSoulShardProc(attacker, u);
  }
  if (u.team === 'blue') {
    onHeroDied(u);
    // Event-based (not a direct import) for the same circular-dependency reason as
    // 'unit:defeated' above — shortRest.js listens for this to arm the one-time
    // "rest to raise your fallen hero" tutorial arrow.
    window.dispatchEvent(new CustomEvent('hero:died', { detail: { type: u.type } }));
  }
  if (u === _owlHelpTarget) _clearOwlHelp();  // distracted enemy died — advantage gone
  if (u.familiar) {
    startFamiliarDeath();  // owl flies straight up and vanishes; handles its own scene removal
    // Falling counts against the once-per-combat summon, not just casting does. Otherwise
    // an owl summoned BEFORE the fight could die in it and be re-summoned immediately —
    // the flag would still be clear — and his death would cost nothing, which is the very
    // thing the cap exists to prevent. Once he's down, he's down until the fight ends.
    _familiarSummonedThisCombat = true;
  } else if (u.mixer) {
    playUnitDeathAnim(u);  // animated units leave a corpse; death anim plays and holds last frame
  } else {
    scene.remove(u.grp);   // non-animated units vanish as before
  }
  u.barEl?.remove();

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

  if (!units.some(x => x.team === 'red' && x.aggro) && !(_pendingSpawnCheckFn?.() ?? false)) {
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

// ── Owl familiar Help action ──────────────────────────────────────────────────
// A lavender "distracted" mark (Iffir's colour) tracked over the target's head
// for as long as Rasec holds the advantage. Inline-styled so it needs no CSS.
const _owlHelpMarkerEl = document.createElement('div');
_owlHelpMarkerEl.textContent = '✖';
Object.assign(_owlHelpMarkerEl.style, {
  position: 'absolute', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
  color: '#c9a0e6', font: '700 22px sans-serif', textShadow: '0 0 6px #000, 0 0 3px #000',
  zIndex: 40, display: 'none',
});
document.getElementById('hud')?.appendChild(_owlHelpMarkerEl);
const _owlMarkVec = new THREE.Vector3();

// Called each frame from the main tick.
export function updateFamiliarHelpMarker() {
  if (!_owlHelpTarget || _owlHelpTarget.hp <= 0 || !units.includes(_owlHelpTarget)) {
    _owlHelpMarkerEl.style.display = 'none';
    return;
  }
  const a = _owlHelpTarget.anchor;
  _owlMarkVec.set(a.x, a.y + 0.6, a.z).project(camera);
  if (_owlMarkVec.z >= 1) { _owlHelpMarkerEl.style.display = 'none'; return; }
  _owlHelpMarkerEl.style.display = 'block';
  _owlHelpMarkerEl.style.left = ((_owlMarkVec.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  _owlHelpMarkerEl.style.top  = ((-_owlMarkVec.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
}

function _clearOwlHelp() {
  _owlHelpTarget  = null;
  _owlHelpPicking = false;
  _owlHelpMarkerEl.style.display = 'none';
}

// Owl hotbar "Help" button. Works both orders: if an enemy is already selected
// (target-first), Help it immediately; otherwise enter pick-mode and wait for the
// player to click an enemy (Help-first). selectedTarget is cleared at turn start,
// so this only ever fires on a target chosen during the owl's own turn.
function _beginOwlHelp() {
  const owlU = getFamiliar();
  if (!owlU || turnOrder[turnIndex] !== owlU || turnAttacked || isAnimating) return;
  if (selectedTarget && selectedTarget.team === 'red' && selectedTarget.hp > 0) {
    _applyOwlHelp(selectedTarget);
    return;
  }
  _owlHelpPicking = true;
  addLog('Choose an enemy for the owl to distract.', 'move');
  updateCombatStatus();
}

// Apply Help to the chosen enemy: the owl flies over to the target, swoops up,
// then the mark + advantage land. Leftover fly speed stays available afterward so
// the player can reposition it.
function _applyOwlHelp(target) {
  _owlHelpPicking = false;
  const owlU = getFamiliar();
  if (!owlU || turnOrder[turnIndex] !== owlU || turnAttacked) return;
  turnAttacked = true;
  hideTargetMarker();
  hideMoveRange();
  heroMode = null;
  // Fly over to the target first, then do the distract swoop + mark.
  _familiarMoveToward(owlU, target.grp.position, () => {
    familiarHelpGesture(() => {
      _owlHelpTarget = target;
      addLog(`${unitLabel(owlU)} distracts ${unitLabel(target)} — Rasec has advantage against it until the end of his next turn!`, 'move');
      // Rasec may be holding his action for exactly this (readied 'owl_helped').
      _checkDelayedTriggers('owl_helped', target, false, () => {});
    });
    const rem = (UNIT_TYPES.owl?.speed ?? 60) - turnMovedFt;
    if (rem > 0) { heroMode = 'move'; showMoveRange(owlU); } else { heroMode = null; }
    updateCombatStatus();
  });
}

// Owl hotbar "Return" button → spend whatever fly speed is left flying back
// toward Rasec (as far as it can reach), then re-open its move range for any
// remaining steps. Mirrors the retreat leg of the automated owl turn.
function _owlReturnToOwner() {
  const owlU = getFamiliar();
  if (!owlU || turnOrder[turnIndex] !== owlU || isAnimating) return;
  const ownerU = owlU.owner;
  if (!ownerU) return;
  if ((UNIT_TYPES.owl?.speed ?? 60) - turnMovedFt <= 0) return;
  hideMoveRange();
  heroMode = null;
  _familiarMoveToward(owlU, ownerU.grp.position, () => {
    const rem = (UNIT_TYPES.owl?.speed ?? 60) - turnMovedFt;
    if (rem > 0) { heroMode = 'move'; showMoveRange(owlU); } else { heroMode = null; }
    updateCombatStatus();
  });
}

// When Find Familiar is cast DURING combat, drop the owl in beside Rasec and
// splice it into the initiative order so it takes turns this fight (out of
// combat it just perches; the combat:start handler drops it in for the next one).
function _insertFamiliarIntoCombat(owlU) {
  owlU.bound     = false;
  owlU._arriving = false;
  _placeFamiliarForCombat(owlU);
  const def    = UNIT_TYPES.owl ?? {};
  const dexMod = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
  owlU.initiative = roll({ sides: 20, modifier: (def.initiative ?? 0) + dexMod }).total;
  if (!turnOrder.includes(owlU)) {
    let idx = turnOrder.length;
    for (let i = turnIndex + 1; i < turnOrder.length; i++) {
      if (owlU.initiative > turnOrder[i].initiative) { idx = i; break; }
    }
    turnOrder.splice(idx, 0, owlU);
    if (idx <= turnIndex) turnIndex++;
  }
  buildTurnList();
}

// Drop the owl onto a free GRID tile beside Rasec. Critical: the move system
// only accepts grid-aligned destinations, so an off-grid owl can never move.
function _placeFamiliarForCombat(owlU) {
  const ownerU = owlU.owner;
  const S    = WORLD_UNITS_PER_SQUARE;
  const snap = v => Math.round((v - 1) / 2) * 2 + 1;   // nearest grid-tile center
  const bx = snap((ownerU ?? owlU).grp.position.x);
  const bz = snap((ownerU ?? owlU).grp.position.z);
  const cand = [[S, 0], [-S, 0], [0, S], [0, -S], [S, S], [S, -S], [-S, S], [-S, -S], [0, 0]];
  let px = bx + S, pz = bz;
  for (const [dx, dz] of cand) {
    const nx = bx + dx, nz = bz + dz;
    if (Math.abs(nx) > _halfGroundSize || Math.abs(nz) > _halfGroundSize) continue;
    if (!isOccupied(nx, nz, owlU) && !hasPropClash(nx, nz)) { px = nx; pz = nz; break; }
  }
  const ty = getTerrainHeight(px, pz);
  owlU.grp.position.set(px, ty + (owlU.hoverY ?? 0), pz);
  owlU.anchor.set(px, ty + owlU.anchorY + (owlU.hoverY ?? 0), pz);
}

const _HERO_COLORS = { Rasec: '#cc55ee', Leugren: '#c8860a', Gobo: '#5577ee', Milo: '#44dd66' };
const _HERO_RE     = /\b(Rasec|Leugren|Gobo|Milo)\b/g;

function _formatLog(text) {
  const esc = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return esc.replace(_HERO_RE, n => `<b style="color:${_HERO_COLORS[n]}">${n}</b>`);
}

// Oldest entries are dropped past this. The log had no cap at all: every attack, roll, move
// and spell appended a permanent <div> for the life of the TAB, and each write forced a
// reflow of an ever-taller list.
//
// 300 was far too tight — a single long automated fight blows past it, and the player scrolls
// up to find the start of the battle already gone. The cap exists to stop unbounded growth
// across a whole session, not to truncate the fight you are currently reading. A few thousand
// small divs costs almost nothing; keep this generous.
const MAX_LOG_ENTRIES = 1500;

export function addLog(text, cls = '') {
  const el = document.getElementById('log-entries');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'log-entry' + (cls ? ' log-' + cls : '');
  div.innerHTML = _formatLog(text);
  el.appendChild(div);
  while (el.childElementCount > MAX_LOG_ENTRIES) el.removeChild(el.firstElementChild);
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
//   Hit% = ((AtkBonus + 20 − DefAC) / 20) × 100 + (((AtkLvl/5)+1) − DefLvl) × 3  [clamped 5–95]
//   Base term mirrors d20 math: each ±1 attack/AC point = ±5%. Baseline atkBonus=5 vs AC=15 → 55%.
//   Level term: hero power tier (1 tier per 5 levels) vs enemy tier (profBonus); ±3% per tier gap.
//   Roll 1d100 high to hit: need ≥ (100 − Hit%); 96-100 → automatic crit.
//   Advantage: keep higher die. Disadvantage: keep lower die.
function rollToHit(atkBonus, defAC, atkLvl, defLvl, mode = 'normal', hitPctBonus = 0) {
  const rawPct    = ((atkBonus + 20 - defAC) / 20) * 100 + (((atkLvl / 5) + 1) - defLvl) * 3 + hitPctBonus;
  const hitChance = Math.round(Math.max(5, Math.min(95, rawPct)));
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

// Save throw — mirrors rollToHit for DC checks.
// saveChance = ((saveMod + 20 - dc) / 20) × 100, clamped [5–95].
// Roll d100 high to succeed: need ≥ (100 - saveChance).
// Advantage: keep higher die. Disadvantage: keep lower die.
function rollSave(saveMod, dc, mode = 'normal') {
  const rawPct     = ((saveMod + 20 - dc) / 20) * 100;
  const saveChance = Math.round(Math.max(5, Math.min(95, rawPct)));
  const threshold  = 100 - saveChance;

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

  return { dice: r2 !== null ? [r1, r2] : [r1], kept, mode, saveChance, threshold, isSave: kept >= threshold };
}

function faceTarget(unit, target) {
  const dx = target.grp.position.x - unit.grp.position.x;
  const dz = target.grp.position.z - unit.grp.position.z;
  unit.grp.rotation.y = Math.atan2(dx, dz);
}

// Ranged attacks show a targeting line first; melee fires immediately.
// Fire Bolt (elf) gets the full cinematic particle effect instead.
function performAttack(attacker, target, atk, onSettled = null) {
  // If this attacker is the delay-interrupt hero, end the interrupt after the attack resolves.
  // Capture the context reference so a later hero's interrupt isn't accidentally closed.
  if (_readyCtx && attacker === turnOrder[turnIndex]) {
    const _myCtx = _readyCtx;
    _readyAutoCloseTimer = setTimeout(() => { if (_readyCtx === _myCtx) _endDelayInterrupt(); }, 2600);
  }
  faceTarget(attacker, target);
  playUnitAttackSound(attacker.type);
  if (atk.spellSlotCost && attacker.spellSlots !== undefined) {
    attacker.spellSlots = Math.max(0, attacker.spellSlots - atk.spellSlotCost);
  }
  if (atk.type === 'aoe_save') {
    if (atk.name === 'Grave Curse') playSound('grave_curse');
    // Don't gate on the animation's own "finished" event — Morvath's cast
    // clip (auto-detected, unpinned) runs ~3.3s, far longer than his other
    // clips, and waiting for it to fully play out reads as the game hanging.
    // Same approach as Sacred Flame: fire the animation and drive timing off
    // a short fixed delay instead, independent of the raw clip length.
    playUnitAttackAnim(attacker, 'spell');
    setTimeout(() => _executeAoeSave(attacker, target, atk, onSettled), 700);
    return;
  }
  if (atk.type === 'ranged') {
    _consumeAtkQty(attacker, atk);
    // Web is a ranged attack, but its projectile is the white ball spat by playWebEffect
    // (inside _executeAttack's web branch). The generic arrow from _projectileFor would fire
    // ON TOP of that — an arrow AND a ball. Skip the arrow entirely: play the ranged
    // animation, then go straight to _executeAttack, which launches the ball.
    if (atk.web) {
      playUnitAttackAnim(attacker, 'ranged', () => _executeAttack(attacker, target, atk, onSettled));
      return;
    }
    const _fire = _projectileFor(attacker);
    if (attacker.type === 'elf' && atk.name === 'Fire Bolt') {
      playUnitAttackAnim(attacker, 'ranged');
      playFireboltEffect(attacker, target, () => _executeAttack(attacker, target, atk, onSettled));
    } else if (UNIT_TYPES[attacker.type]?.rangedReleaseMs != null) {
      // Loose the projectile PARTWAY INTO the animation rather than after it finishes, so the
      // shot doesn't visibly lag the draw. Same trick the spell branch above uses: let the
      // clip play out on its own (it still restores rotation and returns to idle when it
      // ends) and drive the projectile off a fixed delay instead of the 'finished' event.
      playUnitAttackAnim(attacker, 'ranged');
      setTimeout(() => {
        if (!units.includes(attacker) || attacker.hp <= 0) { onSettled?.(); return; }
        _fire(attacker, target, () => _executeAttack(attacker, target, atk, onSettled));
      }, UNIT_TYPES[attacker.type].rangedReleaseMs);
    } else {
      // Projectile launches after the ranged animation finishes; all subsequent
      // events (dice rolls, damage display) cascade from its onImpact callback.
      playUnitAttackAnim(attacker, 'ranged', () => {
        _fire(attacker, target, () => _executeAttack(attacker, target, atk, onSettled));
      });
    }
  } else {
    // atk.animClip lets a single creature give each weapon its own swing (the ettin's
    // battleaxe is a right-arm slash, its morningstar a left hook). Undefined for every
    // other attack in the game, which then plays the unit's default attack clip.
    playUnitAttackAnim(attacker, 'melee', () => _executeAttack(attacker, target, atk, onSettled), atk.animClip ?? null);
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

// ═════════════════════════════════════════════════════════════════════════════
//  ACTION SAVES
// ═════════════════════════════════════════════════════════════════════════════
// A condition you spend your ACTION trying to shake off with a saving throw.
//
// This is deliberately split from the saves that already existed. There are two kinds:
//   • REACTIVE  — forced on you, no choice: spider venom, a fireball's DEX save, a
//     concentration check. These auto-roll at the moment they happen. Unchanged.
//   • ACTION    — you decide whether to spend your turn on it: tearing out of a web,
//     escaping a grapple. Auto-rolling these robs the player of the decision, so they
//     get a hotbar button instead.
//
// Generic on purpose. The spider's web is the first, but grapple / entangle / paralysis /
// being swallowed are all the same shape — set u.actionSave and a SAVING THROW button
// appears on the bar; a successful save clears it.
//
//   u.actionSave = {
//     key,        // identity ('web'), for effects that key off the condition
//     name,       // badge text ('Restrained')
//     label,      // hotbar button text — may contain <br>
//     stat,       // ability score for the save ('str')
//     dc,
//     immobilize, // true → speed 0 while it holds
//     locksTurn,  // true → this is the ONLY action available; everything else greys out
//     escapeMsg,  // log line on success ('tears free of the webbing!')
//     stuckMsg,   // log line on failure
//     onEscape,   // optional fn(u) on a successful save
//   }
export function setActionSave(u, save) {
  if (!u) return;
  u.actionSave = save;
}
export function clearActionSave(u) {
  if (u) u.actionSave = null;
}
// Is this unit barred from acting/moving by a condition it hasn't shaken yet?
function _saveLocksTurn(u)  { return !!u?.actionSave?.locksTurn; }
function _saveImmobilizes(u) { return !!u?.actionSave?.immobilize; }

// Spend the Action attempting the save. Shared by the hotbar button (player) and by the
// automated-hero / enemy-AI turn (which have no UI to click).
function _attemptActionSave(u) {
  const s = u?.actionSave;
  if (!s || turnAttacked || isAnimating) return;

  turnAttacked = true;   // the attempt costs your Action whether it lands or not
  const mod = Math.floor(((UNIT_TYPES[u.type]?.abilities?.[s.stat] ?? 10) - 10) / 2);
  const res = rollSave(mod, s.dc, u.dodging ? 'advantage' : 'normal');
  const label = unitLabel(u);

  showRoll(`${label} · ${s.name} (${s.stat.toUpperCase()} DC ${s.dc})`, res, { autoDismiss: false });

  if (res.isSave) {
    clearActionSave(u);
    s.onEscape?.(u);
    addLog(`${label} ${s.escapeMsg ?? 'breaks free!'} (${saveBreakdown(res, s.stat)}) — Action spent`, 'save');
    showFloatingDamage(u, 'FREE!', '#88ff88');
    // Speed is back. They spent the Action, but they can still walk with what's left.
    if (u.team === 'blue' && turnOrder[turnIndex] === u) {
      heroMode = 'move';
      showMoveRange(u);
    }
  } else {
    addLog(`${label} ${s.stuckMsg ?? 'fails to break free'} (${saveBreakdown(res, s.stat)}) — Action spent`, 'save');
    showFloatingDamage(u, 'STILL HELD', '#ff5555');
  }

  updateCombatStatus();
  if (u.team === 'blue') _rebuildHotbar(u);
}

function saveBreakdown(r, saveType) {
  const label  = (saveType ?? 'con').toUpperCase();
  const adv    = r.mode === 'advantage' ? 'ADV ' : r.mode === 'disadvantage' ? 'DIS ' : '';
  const dieStr = r.mode && r.mode !== 'normal' ? `[${r.dice.join('/')} → ${r.kept}]` : String(r.kept);
  return `${label} save · ${adv}d100: ${dieStr}, needed ≥ ${r.threshold} (${r.saveChance}% to save)`;
}

// Concentration check — call whenever a unit that might be concentrating
// (currently only Bless) takes damage. DC = 10 or half the damage taken,
// whichever is higher. Failure ends the spell for everyone it affects, not
// just the concentrating caster (mirrors D&D: losing concentration drops
// the whole effect).
function _checkConcentration(unit, dmgTaken, willDie) {
  if (concentrating !== unit) return;
  const label = unitLabel(unit);
  if (willDie) {
    addLog(`${label}'s concentration on ${concentratingSpell} ends.`, 'spell');
    clearBless();
    return;
  }
  if (dmgTaken <= 0) return;
  const dc     = Math.max(10, Math.floor(dmgTaken / 2));
  const conMod = Math.floor(((UNIT_TYPES[unit.type]?.abilities?.con ?? 10) - 10) / 2);
  const result = rollSave(conMod, dc, unit.dodging ? 'advantage' : 'normal');
  showRoll(`${label} · Concentration (CON DC ${dc})`, result, { autoDismiss: false });
  if (result.isSave) {
    addLog(`${label} maintains concentration on ${concentratingSpell} (${saveBreakdown(result, 'con')})`, 'spell');
  } else {
    addLog(`${label} loses concentration on ${concentratingSpell}! (${saveBreakdown(result, 'con')})`, 'spell');
    showFloatingDamage(unit, 'CONCENTRATION BROKEN', '#ff6644');
    clearBless();
  }
}

// Venom rider on a landed bite (giant spider). The bite's own damage has already been
// applied by the time this runs. Fail the save and the venom deals its own damage on top;
// make it and the target shrugs it off. This is instantaneous damage, not the D&D "poisoned"
// condition — nothing lingers past this roll.
//
// done() is ALWAYS called exactly once, on every path including a lethal poison — the caller
// is waiting on it to advance the turn.
// Beat between the venom save landing and its result showing. The timing constants inside
// _executeAttack (SLOW_SETTLE et al.) are locals of THAT function and are NOT in scope here —
// referencing SLOW_SETTLE was a ReferenceError thrown silently inside the setTimeout, which is
// exactly why the poison save produced no log, no damage, and no effect. They are all 0
// anyway; use an explicit local so this function stands on its own.
const _POISON_BEAT = 0;
function _resolvePoison(target, poison, done) {
  if (!target || target.hp <= 0) { done(); return; }   // the bite already killed them

  const label  = unitLabel(target);
  const stat   = poison.saveStat ?? 'con';
  const dc     = poison.saveDC ?? 11;
  const mod    = Math.floor(((UNIT_TYPES[target.type]?.abilities?.[stat] ?? 10) - 10) / 2);
  const res    = rollSave(mod, dc, target.dodging ? 'advantage' : 'normal');

  showRoll(`${label} · Venom (${stat.toUpperCase()} DC ${dc})`, res, { autoDismiss: false });

  if (res.isSave) {
    setTimeout(() => {
      addLog(`${label} resists the venom (${saveBreakdown(res, stat)})`, 'save');
      showFloatingDamage(target, 'RESIST', '#88cc88');
      done();
    }, _POISON_BEAT);
    return;
  }

  const dmgResult = rollDnDDamage(poison, 0, false);
  const poisonDmg = Math.max(1, dmgResult.total);
  const willDie   = target.hp <= poisonDmg;

  setTimeout(() => {
    addLog(`${label} fails against the venom! (${saveBreakdown(res, stat)})`, 'save');
    addLog(`  ☠ ${poisonDmg} poison damage (${dmgBreakdown(dmgResult)})`, 'dmg');
    playPoisonEffect(target);
    showFloatingDamage(target, `☠ -${poisonDmg}`, '#66dd44');

    target.hp = Math.max(0, target.hp - poisonDmg);
    target.barShowUntil = Date.now() + 5000;
    buildTurnList();
    _checkConcentration(target, poisonDmg, willDie);

    if (willDie) {
      setTimeout(() => { removeDefeatedUnit(target); done(); }, 400);
    } else {
      setTimeout(done, 150);
    }
  }, _POISON_BEAT);
}

function _executeAttack(attacker, target, atk, onSettled = null) {
  const def     = UNIT_TYPES[attacker.type] ?? {};
  const ab      = def.abilities ?? {};
  const statMod = Math.floor(((ab[atk.statMod] ?? 10) - 10) / 2);
  // dmgBonus on attack overrides stat-derived damage mod (e.g. spell cantrips)
  const baseDmgMod   = atk.dmgBonus !== undefined ? atk.dmgBonus : statMod;
  const rageDmgBonus = (attacker.raging && atk.type === 'melee' && UNIT_TYPES[attacker.type]?.rage)
    ? (UNIT_TYPES[attacker.type].rage.dmgBonus ?? 0) : 0;
  const dmgMod  = baseDmgMod + rageDmgBonus;
  // Precision passive (Gobo & Milo, L4+): flat % points added to hit chance on
  // every attack — always active, independent of Rage/Hide.
  const precisionBonus = precisionHitBonusForLevel(attacker.type, attacker.level);
  const atkMod  = statMod + (def.profBonus ?? 0);

  const blessBonus = blessedUnits.has(attacker) ? roll({ sides: 2 }).total : 0;   // Bless: +1d2 to attack rolls

  // Snapshot the unseen-attacker state NOW. Making the attack breaks the attacker's hide
  // (further down, right after the to-hit roll), but the Sneak Attack test runs after THAT
  // and reads attacker.stealthed — so by the time it looked, the flag was always already
  // false and a hidden Milo silently lost the sneak dice his hide existed to set up. He
  // only ever got them when an ally happened to be adjacent to the target, which masked it.
  const attackerWasHidden = _isHiddenForSneak(attacker);

  // Long-range shot: beyond normal range but within longRange → disadvantage
  let hasAdvantage    = false;
  let hasDisadvantage = false;
  let atkDisadvReason = '';
  // Smoke & Mirrors: while standing in his own cloud, any attack that ALREADY qualifies for
  // Sneak Attack is made with advantage. Derived from the sneak preconditions directly
  // (ally adjacent to the target, or attacking unseen) rather than from
  // hasSneakAttackCondition, which also ORs in advantage — that would be circular.
  const sneakQualifies = _allyAdjacentToTarget(attacker, target) || attackerWasHidden;
  if (attacker.type === 'halfling' && _inOwnSmoke(attacker) && sneakQualifies) {
    hasAdvantage = true;
  }
  // Owl's Help: Rasec has advantage against the enemy his familiar distracted.
  if (_owlHelpTarget && target === _owlHelpTarget && attacker.type === 'elf') {
    hasAdvantage = true;
  }
  if (atk.type === 'ranged' && atk.longRange) {
    const rdx = target.grp.position.x - attacker.grp.position.x;
    const rdz = target.grp.position.z - attacker.grp.position.z;
    if (Math.sqrt(rdx * rdx + rdz * rdz) > atkRangeWU(atk.range)) { hasDisadvantage = true; atkDisadvReason = 'long range'; }
  }
  if (target.dodging) { hasDisadvantage = true; atkDisadvReason = atkDisadvReason ? atkDisadvReason + ', dodge' : 'dodge'; }
  // Advantage and disadvantage from different sources cancel out to a normal roll (D&D RAW).
  const atkMode = hasAdvantage && hasDisadvantage ? 'normal' : hasAdvantage ? 'advantage' : hasDisadvantage ? 'disadvantage' : 'normal';

  // Smoke & Mirrors' heavy obscurement is the third term: a defender standing in his own
  // cloud is hard to see, so he's harder to hit. Positional — it lapses the moment he
  // steps out, and applies to whoever is being ATTACKED, not the attacker.
  const _acBonus   = (target.defStanceActive ? 3 : 0) + (target.mageArmored ? 3 : 0) +
                     (_inOwnSmoke(target) ? SMOKE_AC_BONUS : 0);
  const targetBase = target.equipment ? computeAC(target) : (UNIT_TYPES[target.type]?.ac ?? COMBAT.defaultAC);
  const targetAC   = targetBase + _acBonus;
  const atkResult = rollToHit(atkMod + blessBonus, targetAC, unitCombatLevel(attacker), unitCombatLevel(target), atkMode, precisionBonus);
  const aLabel    = unitLabel(attacker), tLabel = unitLabel(target);

  // Stealth ends here — after the roll (so the hidden bonus/advantage still applied):
  // making an attack breaks the ATTACKER's hide (hit or miss), and being attacked
  // reveals a hidden DEFENDER. Either way, Milo drops out of hide.
  if (attacker.stealthed) { setUnitStealth(attacker, false); addLog(`${aLabel} breaks stealth with the attack!`, 'move'); }
  if (target.stealthed)   { setUnitStealth(target, false);   addLog(`${tLabel} is spotted and breaks stealth!`, 'move'); }

  const D            = 0;
  const FAST_ROLL_MS = 0;
  const FAST_SETTLE  = 0;
  const SLOW_SETTLE  = 0;
  const BANNER_MS    = 0;
  const RESULT_PAUSE = 0;

  const hit = atkResult.isHit;
  const modStr = dmgMod >= 0 ? `+${dmgMod}` : `${dmgMod}`;

  if (!hit) {
    setTimeout(() => {
      playSound('miss');
      addLog(`${aLabel} misses ${tLabel} with ${atk.name} (${atkBreakdown(atkResult)})`, 'miss');
      showFloatingDamage(target, 'MISS', '#999999');
      _logAtkQtyMsg(attacker, atk);
      onSettled?.();
    }, D + FAST_ROLL_MS);
    return;
  }

  // Web (giant spider): a hit deals no damage — it ensnares the target, who must SPEND AN
  // ACTION on their turn attempting a STR save to tear loose (see setActionSave).
  if (atk.web) {
    setActionSave(target, {
      key:        'web',
      name:       'Restrained',
      label:      'BREAK<br>FREE',
      stat:       'str',
      dc:         atk.restrainDC ?? 12,
      immobilize: true,   // speed 0 while it holds
      locksTurn:  true,   // struggling is the ONLY thing they may do
      escapeMsg:  'tears free of the webbing!',
      stuckMsg:   'struggles, still caught in the web',
    });
    playWebEffect(attacker, target);
    // This branch returns before the normal hit log further down, so the web attack was
    // logging NEITHER the to-hit roll NOR the fact that it connected — the whole attack was
    // invisible. Log it here, on the same beat the miss branch uses, so the roll has settled.
    const _webDC = target.actionSave.dc;
    setTimeout(() => {
      playSound('arrow_hit');
      addLog(`${aLabel} hits ${tLabel} with ${atk.name} (${atkBreakdown(atkResult)})`, 'hit');
      addLog(`${tLabel} is caught in ${aLabel}'s webbing! (Action + DC ${_webDC} STR to break free)`, 'alert');
      showFloatingDamage(target, 'WEBBED', '#e6e6ff');
      onSettled?.();
    }, D + FAST_ROLL_MS);
    return;
  }

  const sneakDef  = UNIT_TYPES[attacker.type]?.sneakAttack;
  const doSneak   = sneakDef && !sneakAttackUsed &&
                    hasSneakAttackCondition(attacker, target, atkResult, attackerWasHidden);

  const isCrit    = atkResult.isCrit;
  const dmgResult = rollDnDDamage(atk, dmgMod, isCrit);

  let sneakResult = null;
  if (doSneak) {
    sneakAttackUsed = true;
    sneakResult     = rollDnDDamage(sneakDef, 0, isCrit);
  }

  const dmg      = Math.max(1, dmgResult.total);
  const sneakDmg = sneakResult ? Math.max(0, sneakResult.total) : 0;
  const totalRaw = dmg + sneakDmg;
  const rageMit  = (target.raging && UNIT_TYPES[target.type]?.rage) ? rageMitigationForLevel(target.level) : 0;
  const resisted = rageMit > 0;
  const finalDmg = resisted ? Math.max(1, Math.round(totalRaw * (1 - rageMit))) : totalRaw;

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
    _checkConcentration(target, finalDmg, willDie);
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
    if (atk.name === 'Inflict Wounds') playInflictWoundsEffect(target);
  }, dmgSettleDelay + RESULT_PAUSE);

  if (doSneak) {
    setTimeout(() => {
      showFloatingDamage(target, `⚡+${sneakDmg} SNEAK`, '#ffdd44');
      addLog(`  ⚡ Sneak Attack! +${sneakDmg} (${dmgBreakdown(sneakResult)})`, 'dmg');
    }, sneakSettleDelay + RESULT_PAUSE);
  }

  if (resisted) {
    const _mitPct = Math.round(rageMit * 100);
    setTimeout(() => {
      showFloatingDamage(target, `⚔ RAGE -${_mitPct}%`, '#ff8844');
      addLog(`  ⚔ Rage resistance (-${_mitPct}%): ${totalRaw} → ${finalDmg}`, 'dmg');
    }, hpUpdateDelay + RESULT_PAUSE + 500);
  }

  if (willDie) {
    setTimeout(() => removeDefeatedUnit(target, attacker), hpUpdateDelay + RESULT_PAUSE + 400);
  }

  // Notify caller that HP is fully settled (after removeDefeatedUnit if applicable).
  // A venomous attack (giant spider's bite) chains a save AFTER the bite damage lands, and
  // onSettled must wait for that too — firing it early would advance the turn out from under
  // the poison roll, which is exactly the class of turn-freeze bug /timing-audit hunts for.
  const _settleAt = hpUpdateDelay + RESULT_PAUSE + (willDie ? 450 : 50);
  if (atk.poison && !willDie) {
    setTimeout(() => _resolvePoison(target, atk.poison, () => onSettled?.()), _settleAt + 250);
  } else {
    setTimeout(() => onSettled?.(), _settleAt);
  }

  // Ammo-remaining message fires after all damage/effect lines settle
  const _qtyDelay = resisted
    ? hpUpdateDelay + RESULT_PAUSE + 550
    : hpUpdateDelay + RESULT_PAUSE + 50;
  setTimeout(() => _logAtkQtyMsg(attacker, atk), _qtyDelay);
}

// AOE save attack: no to-hit roll. Find all heroes within aoeRadius ft of primaryTarget,
// each rolls the specified save type vs saveDC. Fail = full damage, pass = half damage.
function _executeAoeSave(attacker, primaryTarget, atk, onSettled = null) {
  const dc        = atk.saveDC   ?? 12;
  const saveType  = atk.saveType ?? 'con';
  const dmgBonus  = atk.dmgBonus ?? 0;
  const radiusWU  = (atk.aoeRadius / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const aLabel    = unitLabel(attacker);

  const px = primaryTarget.grp.position.x;
  const pz = primaryTarget.grp.position.z;
  const targets = units.filter(u => {
    if (u.team !== 'blue' || u.hp <= 0) return false;
    const dx = u.grp.position.x - px;
    const dz = u.grp.position.z - pz;
    return Math.sqrt(dx * dx + dz * dz) <= radiusWU;
  });

  const dmgRoll = rollDnDDamage(atk, dmgBonus, false);
  const rawDmg  = Math.max(1, dmgRoll.total);
  addLog(`${aLabel} casts ${atk.name}! (${atk.aoeRadius} ft · CON DC ${dc}) — ${rawDmg} necrotic (${dmgBreakdown(dmgRoll)})`, 'spell');

  if (targets.length === 0) { onSettled?.(); return; }

  let resolved = 0;
  const checkDone = () => { if (++resolved >= targets.length) onSettled?.(); };

  targets.forEach((hero, idx) => {
    setTimeout(() => {
      playGraveCurseBolt(attacker, hero, () => {
        const heroAb        = UNIT_TYPES[hero.type]?.abilities ?? {};
        const saveMod       = Math.floor(((heroAb[saveType] ?? 10) - 10) / 2);
        const blessSaveBonus = blessedUnits.has(hero) ? roll({ sides: 2 }).total : 0;   // Bless: +1d2 to saving throws
        const saveResult    = rollSave(saveMod + blessSaveBonus, dc, hero.dodging ? 'advantage' : 'normal');
        const finalDmg      = saveResult.isSave ? Math.max(1, Math.floor(rawDmg / 2)) : rawDmg;
        const tLabel        = unitLabel(hero);
        const outcome       = saveResult.isSave ? '½ dmg' : 'full dmg';
        const saveWord      = saveResult.isSave ? 'SAVES' : 'FAILS';

        const saveLabel = `${tLabel} · ${saveType.toUpperCase()} Save` + (blessSaveBonus > 0 ? `  ✦+${blessSaveBonus}` : '');
        showRoll(saveLabel, saveResult, { autoDismiss: false });

        const willDie = hero.hp <= finalDmg;
        hero.aggro = true;
        hero.hp = Math.max(0, hero.hp - finalDmg);
        hero.barShowUntil = Date.now() + 5000;
        buildTurnList();
        if (sleepingUnits.has(hero)) wakeUnit(hero, 'damage');
        _checkConcentration(hero, finalDmg, willDie);

        const blessTag = blessSaveBonus > 0 ? ` ✦+${blessSaveBonus}` : '';
        addLog(`  ${tLabel} ${saveWord} (${saveBreakdown(saveResult, saveType)}${blessTag}) — ${finalDmg} dmg [${outcome}]`,
               saveResult.isSave ? 'hit' : 'dmg');
        showFloatingDamage(hero, `-${finalDmg}`, '#9922cc');
        playGraveCurseEffect(hero);

        if (willDie) setTimeout(() => removeDefeatedUnit(hero), 400);
        setTimeout(() => checkDone(), willDie ? 450 : 50);
      });
    }, idx * 250);
  });
}

// ── Target selection overlay ──────────────────────────────────────────────────

export let selectedTarget = null;
let selectedTargetAtk = null;
const _tv               = new THREE.Vector3();
const targetMarkerEl    = document.getElementById('target-marker');
const targetNameEl      = document.getElementById('target-name');
const attackConfirmWrap = document.getElementById('attack-confirm-wrap');
const attackConfirmBtn  = document.getElementById('attack-confirm-btn');
const shakeAwakeBtn     = document.getElementById('shake-awake-btn');
const castConfirmWrap   = document.getElementById('cast-confirm-wrap');
const castConfirmBtn    = document.getElementById('cast-confirm-btn');
const soulShardPromptWrap = document.getElementById('soul-shard-prompt-wrap');
const soulShardPromptBtn  = document.getElementById('soul-shard-prompt-btn');
const soulShardDismissBtn = document.getElementById('soul-shard-dismiss-btn');

let _pendingSpellCast = null;  // { castFn, spellName } | null

// ── Soul Shard Amulet — reaction prompt after killing an undead ─────────────
let _soulShardHero = null;

function showSoulShardPrompt(hero) {
  _soulShardHero = hero;
  soulShardPromptWrap?.classList.add('show');
}

function hideSoulShardPrompt() {
  _soulShardHero = null;
  soulShardPromptWrap?.classList.remove('show');
}

soulShardPromptBtn?.addEventListener('click', () => {
  const hero = _soulShardHero;
  if (!hero || !units.includes(hero) || hero.hp <= 0) { hideSoulShardPrompt(); return; }
  const healed = roll({ sides: 4, count: 1 }).total;
  hero.hp = Math.min(hero.maxHp, hero.hp + healed);
  hero.barShowUntil = Date.now() + 5000;
  turnReactionUsed = true;
  showFloatingDamage(hero, `+${healed}`, '#44ff88');
  addLog(`${unitLabel(hero)} absorbs a fragment of undead life force (Soul Shard Amulet) — regains ${healed} hp`, 'heal');
  hideSoulShardPrompt();
  updateCombatStatus();
});

// Decline the prompt — hides it without spending the reaction, so the hero
// can save it (e.g. for a Ready Action trigger) instead of being forced to use it.
soulShardDismissBtn?.addEventListener('click', () => {
  if (_soulShardHero) addLog(`${unitLabel(_soulShardHero)} lets the fragment fade, saving their reaction.`, 'move');
  hideSoulShardPrompt();
});

// Only offers the prompt if the killer is a living hero wearing the amulet,
// the fallen enemy is undead, the reaction hasn't been spent this turn, and
// the hero is actually missing HP (nothing to gain otherwise).
function _checkSoulShardProc(attacker, target) {
  if (!attacker || attacker.team !== 'blue' || attacker.hp <= 0) return;
  if (!UNIT_TYPES[target.type]?.undead) return;
  if (attacker.equipment?.neck?.id !== 'soul_shard_amulet') return;
  if (turnReactionUsed) return;
  if (attacker.hp >= attacker.maxHp) return;
  showSoulShardPrompt(attacker);
}


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
    const los  = unitsHaveLOS(u, enemy);
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

// Out-of-combat target cycling: enemies within scout range of a living hero AND in
// line of sight (fog/walls block) — the same limits as Milo's hide vision.
const OOC_TARGET_RANGE = 10 * WORLD_UNITS_PER_SQUARE;   // 10 squares, matches MAX_SCOUT_RANGE
function _cycleOOCTarget() {
  const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
  if (!heroes.length) return;
  const visible = units.filter(en => {
    if (en.team !== 'red' || en.hp <= 0 || en.aggro === false) return false;
    return heroes.some(h => {
      const dx = en.grp.position.x - h.grp.position.x, dz = en.grp.position.z - h.grp.position.z;
      if (dx * dx + dz * dz > OOC_TARGET_RANGE * OOC_TARGET_RANGE) return false;
      return unitsHaveLOS(h, en);
    });
  });
  if (!visible.length) { hideTargetMarker(); return; }
  const curIdx = selectedTarget ? visible.indexOf(selectedTarget) : -1;
  _ringHoverActive = false;
  showTargetMarker(visible[(curIdx + 1) % visible.length]);
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  // Out-of-combat Tab: cycle the target marker through enemies the party can actually
  // see — within scout range and with line of sight (fog/walls block), mirroring the
  // limits on Milo's hide vision. Lets the player scan threats before engaging.
  if (!combatPhase && e.key === 'Tab') { e.preventDefault(); _cycleOOCTarget(); return; }
  if (!combatPhase || isAnimating) return;

  if (e.key === 'Escape') {
    if (selectedTarget) hideTargetMarker();
    return;
  }

  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;

  if (e.key === 'Tab') {
    const enemies = turnOrder.filter(unit => unit.team === 'red' && unit.hp > 0 && unit.aggro !== false);
    if (!enemies.length) return;
    const curIdx = selectedTarget ? enemies.findIndex(en => en === selectedTarget) : -1;
    _ringHoverActive = false;
    showTargetMarker(enemies[(curIdx + 1) % enemies.length]);
    return;
  }

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
  // Cave zones: target the surface the active hero is on (blanket vs tunnel floor),
  // not the carved ground beneath the blanket.
  if (ceiling.visible) {
    const layer = turnOrder[turnIndex]?.caveLayer === 'under' ? 'under' : 'surface';
    const p = raySurfacePoint(_ray.ray, layer);
    if (p) return p;
  }
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

  // Out-of-combat Healing Word target pick (see startOOCHealTargeting above).
  // Takes priority over everything else while active; army.js's own click
  // handler backs off via isOOCHealPicking() so clicking a hero here doesn't
  // also re-select them for movement control.
  if (_oocHealCaster) {
    const meshHit = rayHitUnit(healTargets);
    if (meshHit) { _resolveOOCHeal(meshHit); return; }
    if (pt) for (const [target] of healTargets) {
      const dx = target.grp.position.x - pt.x, dz = target.grp.position.z - pt.z;
      if (dx * dx + dz * dz < INTERACTION.pickRadiusSq * 2.5) { _resolveOOCHeal(target); return; }
    }
    cancelOOCHealTargeting();
    return;
  }

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

      if (heroMode === 'dwarfatk_sacred_flame' && !turnAttacked) {
        const meshHit = rayHitUnit(atkTargets);
        if (meshHit) {
          castSacredFlame(u, meshHit);
          return;
        }
        if (pt) for (const [target] of atkTargets) {
          const dx = target.grp.position.x - pt.x;
          const dz = target.grp.position.z - pt.z;
          if (dx * dx + dz * dz < INTERACTION.pickRadiusSq * 2.5) {
            castSacredFlame(u, target);
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
      if (curU && (curU.team === 'blue' || curU.familiar)) {
        const large = UNIT_TYPES[curU.type]?.large ?? false;
        const tx = large ? Math.round(pt.x / 2) * 2 : Math.round((pt.x - 1) / 2) * 2 + 1;
        const tz = large ? Math.round(pt.z / 2) * 2 : Math.round((pt.z - 1) / 2) * 2 + 1;
        if (validTiles.has(`${tx},${tz}`)) {
          const mdx = tx - curU.grp.position.x, mdz = tz - curU.grp.position.z;
          const movedFt = Math.round(Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE) * GRID_SQUARE_FEET;
          prevMoveState = { x: curU.grp.position.x, z: curU.grp.position.z, movedFt: turnMovedFt };
          hideMoveRange();
          hideAttackTargets();
          const path = findPath(curU.grp.position.x, curU.grp.position.z, tx, tz, curU.caveLayer);
          if (!path.length) {
            // Destination blocked by barrier — restore state, do nothing
            prevMoveState = null;
            showMoveRange(curU);
            return;
          }
          animatePath(curU, path, () => {
            turnMovedFt += movedFt;
            addLog(`${unitLabel(curU)} moves ${movedFt} ft`, 'walk');
            _checkProximityAggro(curU);
            _checkHidePerception(curU);
            const remaining = (UNIT_TYPES[curU.type]?.speed ?? 30) - turnMovedFt;
            if (remaining > 0) { heroMode = 'move'; showMoveRange(curU); }
            else { heroMode = null; }
            showUndoBtn();
            updateCombatStatus();
            // A hero finishing a move can put an ally in an enemy's face — which is what
            // a readied 'ally_in_enemy_melee' (Milo's Sneak Attack setup) waits for. No
            // hero-movement event existed before this: every delayed trigger fired off
            // enemy movement or damage, so a hero charging in on his own turn notified
            // nobody. Nothing follows this in the callback, so the continuation is a no-op.
            _checkDelayedTriggers('hero_moved', curU, false, () => {});
          });
          return;
        }
      }
    }
    hideTargetMarker();
    return;
  }

  clearHoverPulseUnit();
  // Owl Help targeting — only honored while it's actually the owl's turn.
  if (_owlHelpPicking) {
    if (turnOrder[turnIndex]?.familiar && hit.team === 'red' && hit.hp > 0) { _applyOwlHelp(hit); return; }
    _owlHelpPicking = false;  // stale pick or non-enemy click cancels it
  }
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
  if (!u || (u.team !== 'blue' && !u.familiar)) {
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
    // NPCs are built with hp = 0 ON PURPOSE (they have no stat block), so the usual
    // `hp <= 0` liveness test reads every one of them as a corpse and skipped them here —
    // which is why clicking a townsfolk or a quest-giver never selected anything.
    if (target.team !== 'npc' && target.hp <= 0) continue;
    if (_ray.intersectObject(target.grp, true).length) return target;
  }
  return null;
}

// The unit under the pointer that is NOT one of the player's heroes — an enemy, an NPC, or
// the familiar. army.js asks this before it moves anyone: out of combat both this module and
// army.js listen on the canvas, and army.js used to treat a click on a creature as a click on
// the ground beneath it, so targeting an enemy ALSO marched the party into its lap.
export function pointerOverNonHeroUnit(clientX, clientY) {
  groundHit(clientX, clientY);        // primes _ray, which rayHitAnyUnit reuses
  const hit = rayHitAnyUnit();
  return hit && hit.team !== 'blue' ? hit : null;
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
  // Find Familiar is once per combat. Iffir has 1 HP and dies easily, and without a cap
  // Rasec could reinstate the Help engine every round for the price of an action — which
  // makes the owl's death cost nothing. Reset per fight, not per zone: an owl that
  // SURVIVES a battle persists, and only a re-summon inside the same fight is blocked.
  _familiarSummonedThisCombat = false;
  divider.visible = false;
  // Combat deliberately does NOT force the grid on any more. The grid button is the single
  // authority on grid visibility — if the player turned it off, it stays off through the
  // fight, and if they turned it on out of combat it stays on. (The matching forced-off on
  // the post-wipe zone reload in dagnaEvent.js was removed with it.)
  _dungeonAwareEnemies.clear();
  _readied.clear();
  initSpellSlots(units);

  // Non-dungeon: all red units are immediately aggro, unless precombat BFS explicitly
  // marked them aggro=false (out-of-range enemies that shouldn't join yet).
  // Dungeon: enemies start unaware; aggro is set when they gain LOS.
  if (activeEnv !== 'dungeon') {
    units.forEach(u => { if (u.team === 'red' && u.aggro !== false) u.aggro = true; });
  }

  // Snap all combatants to grid-tile centres. Heroes stop mid-step on the aggro
  // trigger; enemies spawn at arbitrary zone coords — either way an off-grid start
  // makes grid-based moves land off-grid, so a "diagonally adjacent" foe ends up just
  // out of melee reach. Snapping both keeps everyone on centres (odd coords; even for
  // large units) so adjacency is reliable. Familiars/NPCs keep their own positioning.
  units.forEach(u => {
    if ((u.team !== 'blue' && u.team !== 'red') || u.familiar) return;
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
      u.rageUsesMax = rageUsesForLevel(u.level);
      u.rageUses    = u.rageUsesMax;
    }
    // Level 2 ability state reset each battle
    if (u.type === 'human')    { u.defStanceActive = false; u.defStanceRounds = 0; u.defStanceCooldown = 0; }
    if (u.type === 'halfling') {
      u.hideCooldown = 0;
      // Smoke & Mirrors: charges refresh each combat; clear any cloud left from a previous fight
      u.smokeUses   = SMOKE_USES;
      u.smokeActive = false;
      u.smokeCenter = null;
      if (u._smokeVFX) { u._smokeVFX.dispose(); u._smokeVFX = null; }
    }
    // Magic Missile: first cast each combat is free, then costs a spell slot
    if (u.type === 'elf')      { u.mmFreeUsed = false; }
    u.dodging = false;
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
  _refreshAttackQty();      // recover thrown weapons (e.g. Gobo's Handaxes) each combat
  _clearOwlHelp();          // no stale distract-mark carried in from a prior fight
  enterCombatFamiliar();    // owl leaves the shoulder to become a combatant
  { const _owl = getFamiliar(); if (_owl) _placeFamiliarForCombat(_owl); }
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
      const label    = (u.team === 'blue' || u.familiar) ? baseName : baseName + ' ' + counter[key];
      return { u, i, label };
    })
    .filter(Boolean)
    .sort((a, b) => b.u.initiative - a.u.initiative);

  entries.forEach(({ u, i, label }) => {
    const OWL_TURN_COLOR = '#c9a0e6';  // friendly lavender — reads as Rasec's familiar, not an enemy
    const color = u.team === 'blue'
      ? '#' + (HERO_RING_COLORS[u.type] ?? 0x4488ff).toString(16).padStart(6, '0')
      : u.familiar ? OWL_TURN_COLOR : '';
    const hpPct    = Math.round(Math.max(0, u.hp) / Math.max(1, u.maxHp) * 100);
    const barColor = u.team === 'blue' ? (color || '#4488ff') : u.familiar ? OWL_TURN_COLOR : '#cc3333';

    const el      = document.createElement('div');
    el.className  = 'turn-entry';
    el.dataset.ti = i;
    const isActiveDelay = u === _activeReadyHero;
    const readyTag  = (u.team === 'blue' && (_readied.has(u) || isActiveDelay))
      ? '<span class="turn-ready-tag">⚡</span>' : '';
    const arrowTag  = isActiveDelay
      ? '<span class="turn-ready-arrow">◀</span>' : '';
    el.innerHTML  =
      `<div class="turn-hpbar-wrap"><div class="turn-hpbar" style="width:${hpPct}%;background:${barColor}"></div></div>` +
      `<span class="turn-name"${color ? ` style="color:${color}"` : ''}>${label}${readyTag}${arrowTag}</span>` +
      `<span class="turn-init">${u.initiative}</span>`;
    el.addEventListener('click', () => {
      if (u.team === 'red' && u.hp > 0) showTargetMarker(u);
      else if (u.team === 'blue' || u.familiar) setFollowUnit(u);
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

// ── Ready Action ──────────────────────────────────────────────────────────────

const _READY_LABELS = {
  enemy_in_los:          'Enemy enters line of sight',
  enemy_in_melee_range:  'Enemy enters melee range',
  enemy_in_ranged_range: 'Enemy enters spell or ranged attack range',
  ally_in_enemy_melee:   'Ally enters enemy melee range',
  owl_helped:            'Iffir uses the Help action',
  ally_loses_hp:         'Ally loses hit points',
};

// Can this trigger still possibly fire? The automated ready-action picker takes the FIRST
// trigger in the hero's priority list, so a trigger that cannot fire strands the hero:
// he readies, waits, and never acts. That's fatal for 'owl_helped' now that Iffir is
// once-per-combat — if he's dead, no Help is ever coming. Skip to the next trigger.
function _triggerViable(trigger) {
  if (trigger !== 'owl_helped') return true;
  const owlU = getFamiliar();
  return !!owlU && owlU.hp > 0 && units.includes(owlU);
}

// The enemy that some OTHER living hero is standing adjacent to — i.e. the enemy that
// `hero` could Sneak Attack right now (see _allyAdjacentToTarget, the same ADJACENT_WU
// test the Sneak Attack condition itself uses). Returns null if no hero is engaged.
// Prefers the enemy nearest to `hero`, so a readied shot goes to the closest flanked foe.
function _enemyEngagedByAlly(hero) {
  let best = null, bestSq = Infinity;
  for (const enemy of units) {
    if (enemy.team !== 'red' || enemy.hp <= 0) continue;
    if (!_allyAdjacentToTarget(hero, enemy)) continue;   // excludes `hero` itself
    const dx = enemy.grp.position.x - hero.grp.position.x;
    const dz = enemy.grp.position.z - hero.grp.position.z;
    const d  = dx * dx + dz * dz;
    if (d < bestSq) { bestSq = d; best = enemy; }
  }
  return best;
}

// _readyCtx: null when idle; {savedIdx, savedHeroMode, cont} during active interrupt
let _readyCtx = null;
// timer ID for the auto-close after a delay-interrupt attack; cancelled on manual end
let _readyAutoCloseTimer = null;
// tracks each hero's turnBonusActioned state at the moment they committed to delay
const _readiedBonusActioned = new Map();
// hero whose delay interrupt is currently active (for turn-list arrow)
let _activeReadyHero = null;

function _showReadyTriggerFloat(hero) {
  const heroName = UNIT_TYPES[hero.type]?.name ?? hero.type;
  const color    = '#' + (HERO_RING_COLORS[hero.type] ?? 0xffdd44).toString(16).padStart(6, '0');
  _fv.set(hero.anchor.x, hero.anchor.y + 0.5, hero.anchor.z).project(camera);
  if (_fv.z >= 1) return;
  const el = document.createElement('div');
  el.className  = 'ready-trigger-float';
  el.style.color = color;
  el.innerHTML  = `⚡ Ready Action<br>Triggered!`;
  el.style.left = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  el.style.top  = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 4000);
}

// ── Persistent overhead icon while a ready action is armed ───────────────────
// Same ⚡ glyph as the turn-order tag, but rendered above the hero's head in
// the 3D view for the whole time the readied action is armed (not just a
// momentary float).
const _readyIconEls = new Map(); // hero → DOM element

export function updateReadyIcons() {
  // Sweep entries for units that left the units[] array entirely (e.g. died)
  // without ever hitting the `!active` branch below.
  for (const [u, el] of _readyIconEls) {
    if (!units.includes(u)) { el.remove(); _readyIconEls.delete(u); }
  }

  for (const u of units) {
    const active = u.team === 'blue' && (_readied.has(u) || u === _activeReadyHero);
    let el = _readyIconEls.get(u);

    if (!active) {
      if (el) { el.remove(); _readyIconEls.delete(u); }
      continue;
    }

    if (!el) {
      el = document.createElement('div');
      el.className   = 'unit-ready-icon';
      el.textContent = '⚡';
      document.getElementById('app').appendChild(el);
      _readyIconEls.set(u, el);
    }

    // Same 3D anchor the health bar projects from (not a taller world-space
    // offset) — the bar itself only nudges by a few CSS px (see ui.js), so
    // matching that anchor and nudging further in screen space keeps the
    // icon pinned just above the bar regardless of camera distance.
    _fv.set(u.anchor.x, u.anchor.y, u.anchor.z).project(camera);
    if (_fv.z > 1) { el.style.display = 'none'; continue; }
    el.style.display = 'block';
    el.style.left = ((_fv.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
    el.style.top  = ((-_fv.y * 0.5 + 0.5) * renderer.domElement.clientHeight - 22) + 'px';
  }
}

function _openReadyModal(hero) {
  const modal = document.getElementById('ready-action-modal');
  if (!modal) return;
  // Hide triggers this hero can't use, rather than letting them arm an action that can
  // never fire: "Iffir uses the Help action" is Rasec's alone, and only means anything
  // while the owl is actually alive to Help (he's once-per-combat now).
  modal.querySelectorAll('.dam-trigger-btn').forEach(btn => {
    const t = btn.dataset.trigger;
    const usable = t !== 'owl_helped' || (hero.type === 'elf' && _triggerViable('owl_helped'));
    btn.style.display = usable ? '' : 'none';
  });
  modal.querySelectorAll('.dam-trigger-btn').forEach(btn => {
    btn.onclick = () => {
      const trigger = btn.dataset.trigger;
      _readied.set(hero, trigger);
      _readiedBonusActioned.set(hero, turnBonusActioned);
      turnAttacked = true;
      modal.style.display = 'none';
      addLog(`${unitLabel(hero)} readies action: trigger "${_READY_LABELS[trigger]}"`, 'ready');
      buildTurnList();
      updateCombatStatus();
      _rebuildHotbar(hero);
      // Arming a ready action ends the hero's main action but not their turn —
      // they still have to click End Turn themselves to pass to the next unit.
      endTurnBtn.disabled = false;
    };
  });
  document.getElementById('dam-cancel-btn').onclick = () => { modal.style.display = 'none'; };
  modal.style.display = 'flex';
}

// Longest range (world units) at which this hero threatens an enemy right
// now — the greater of their ranged weapon (if any) and any offensive
// cantrip/spell they've unlocked (Fire Bolt, Sacred Flame, Magic Missile,
// Burning Hands, etc.). Heal/support spells (healing_word, cure_wounds,
// bless, mage_armor — no rangeFt, or healDice present) don't count, since
// they don't threaten an enemy. Returns null if the hero has no ranged
// option at all (pure melee).
function _heroRangedRangeWU(hero) {
  const heroAtks  = UNIT_TYPES[hero.type]?.attacks ?? [];
  const rangedAtk = heroAtks.find(a => a.type === 'ranged');
  let maxFt = rangedAtk ? (rangedAtk.longRange ?? rangedAtk.range) : 0;

  const pool = hero.type === 'dwarf' ? SPELLS : hero.type === 'elf' ? ELF_SPELLS : null;
  if (pool) {
    for (const sp of Object.values(pool)) {
      if (sp.rangeFt == null || sp.healDice !== undefined) continue;
      if (!isAbilityUnlocked(hero.type, hero.level, sp.key)) continue;
      if (sp.rangeFt > maxFt) maxFt = sp.rangeFt;
    }
  }
  return maxFt > 0 ? atkRangeWU(maxFt) : null;
}

// Helper: returns true if enemy is within ranged/spell range AND has LOS to hero
function _enemyInHeroLOS(enemy, hero) {
  const rangeWU = _heroRangedRangeWU(hero);
  if (rangeWU == null) return false;
  const dx = enemy.grp.position.x - hero.grp.position.x;
  const dz = enemy.grp.position.z - hero.grp.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > rangeWU) return false;
  return unitsHaveLOS(enemy, hero);
}

function _checkDelayedTriggers(eventType, eventCtx, hpLost, continuation) {
  const matches = [];
  for (const [hero, trigger] of _readied) {
    if (!units.includes(hero) || hero.hp <= 0) { _readied.delete(hero); continue; }
    const heroAtks = UNIT_TYPES[hero.type]?.attacks ?? [];

    if (eventType === 'enemy_moved') {
      const enemy = eventCtx;
      const dx = enemy.grp.position.x - hero.grp.position.x;
      const dz = enemy.grp.position.z - hero.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (trigger === 'enemy_in_los' && _enemyInHeroLOS(enemy, hero)) {
        matches.push({ hero, trigger, enemy });
      } else if (trigger === 'enemy_in_melee_range') {
        const atk = heroAtks.find(a => a.type === 'melee');
        if (atk && dist <= atkTriggerWU(atk)) matches.push({ hero, trigger, enemy });
      } else if (trigger === 'enemy_in_ranged_range') {
        const rangeWU = _heroRangedRangeWU(hero);
        // Require the enemy to move 5 ft (1 square) INTO ranged range, not just
        // graze the outer edge, before the readied shot fires.
        if (rangeWU != null && dist <= rangeWU - WORLD_UNITS_PER_SQUARE) {
          matches.push({ hero, trigger, enemy });
        }
      }
    }

    // "Ally enters enemy melee range" — the Sneak Attack setup. Fires on EITHER approach:
    // a hero walking into an enemy's reach (hero_moved, the case Milo is really waiting
    // for) or an enemy walking into a hero's (enemy_moved). Both leave an ally adjacent
    // to a foe, which is exactly the Sneak Attack condition. The engaged enemy rides
    // along as `enemy` so the readied attack goes to THAT foe — shooting a different one
    // would fire the trigger and forfeit the sneak damage it exists to set up.
    if (trigger === 'ally_in_enemy_melee' &&
        (eventType === 'hero_moved' || eventType === 'enemy_moved')) {
      const engaged = _enemyEngagedByAlly(hero);
      if (engaged) matches.push({ hero, trigger, enemy: engaged });
    }

    // "Iffir uses Help action" — the owl distracts a foe, giving Rasec ADVANTAGE against
    // it. The helped enemy rides along so the readied cantrip fires at THAT foe; any
    // other target would spend the readied action and throw the advantage away.
    if (eventType === 'owl_helped' && trigger === 'owl_helped') {
      const helped = eventCtx;
      if (helped && units.includes(helped) && helped.hp > 0) {
        matches.push({ hero, trigger, enemy: helped });
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
    _readyCtx = {
      savedIdx:            turnIndex,
      savedHeroMode:       heroMode,
      savedAttacked:       turnAttacked,  // must restore so enemy turn resumes with correct attack state
      savedMovedFt:        turnMovedFt,
      savedBonusActioned:  turnBonusActioned,
      savedRingX:          activeRing.position.x,
      savedRingZ:          activeRing.position.z,
      savedRingColor:      activeRing.material.color.getHex(),
      savedRingVisible:    activeRing.visible,
      savedRingLayer:      _conformLayer,
      // Until the 'hero_moved' event existed, a readied action could only ever interrupt
      // an ENEMY's turn — so both restore paths just hard-locked End Turn on the way out
      // ("back to enemy's turn"). A readied action can now fire in the middle of a PLAYER
      // hero's turn (Milo's shot firing while Gobo walks into melee), and locking the
      // button there strands the player: they can't act and can't end their turn.
      // Remember what the button actually was, and who was interrupted, and put both back.
      savedEndTurnDisabled: endTurnBtn.disabled,
      savedUnit:            turnOrder[turnIndex] ?? null,
      cont: () => _fireNext(idx + 1),
    };
    _showDelayInterrupt(matches[idx]);
  }
  _fireNext(0);
}

function _showDelayInterrupt({ hero, trigger, enemy }) {
  if (!_readyCtx) return;
  const heroIdx = turnOrder.indexOf(hero);
  if (heroIdx < 0) {
    _readied.delete(hero);
    _readiedAutomated.delete(hero);
    const cont = _readyCtx.cont;
    _readyCtx = null;
    cont?.();
    return;
  }

  _readied.delete(hero);
  _activeReadyHero = hero;

  // ── Automated hero: bypass UI, run action priority directly ──────────
  if (_readiedAutomated.has(hero)) {
    _readiedAutomated.delete(hero);
    addLog(`⚡ ${unitLabel(hero)}'s ready action fires (${_READY_LABELS[trigger] ?? trigger})!`, 'ready');
    const saved = _readyCtx;
    const { savedIdx, savedHeroMode, savedAttacked, savedMovedFt, savedBonusActioned,
            savedRingX, savedRingZ, savedRingColor, savedRingVisible, cont } = _readyCtx;
    _readyCtx      = null;
    _activeReadyHero = null;
    // Set hero as active with a clean action slate
    turnIndex         = heroIdx;
    turnAttacked      = false;
    turnMovedFt       = 0;
    turnBonusActioned = _readiedBonusActioned.get(hero) ?? false;
    _readiedBonusActioned.delete(hero);
    endTurnBtn.disabled = true;
    setTimeout(() => _runAutomatedHeroTurn(hero, {
      noMove: true,
      // The enemy that fired the trigger. Milo MUST shoot the foe his ally is engaging or
      // the Sneak Attack he readied for never lands; Rasec MUST hit the foe Iffir Helped
      // or he throws away the advantage. Left to their own target priorities they could
      // re-pick a different enemy, spending the readied action and forfeiting the very
      // bonus it existed to set up.
      preferTarget: (trigger === 'ally_in_enemy_melee' || trigger === 'owl_helped') ? enemy : null,
      onEnd: () => {
        // Restore the interrupted turn's state before resuming
        turnIndex         = savedIdx;
        heroMode          = savedHeroMode;
        turnAttacked      = savedAttacked;
        turnMovedFt       = savedMovedFt;
        turnBonusActioned = savedBonusActioned;
        activeRing.position.set(savedRingX, 0, savedRingZ);
        activeRing.material.color.setHex(savedRingColor);
        activeRing.visible = savedRingVisible;
        _restoreInterruptedTurn(saved);   // NOT a blanket lock — the interrupted unit may be a player hero
        setTimeout(cont, 300);
      }
    }), 300);
    return;
  }

  // Temporarily make this hero the active unit so all hotbar callbacks work naturally
  turnIndex         = heroIdx;
  turnAttacked      = false;
  // A readied action is a reaction — it grants NO movement (only an action/bonus/
  // reaction). Max out turnMovedFt so every "remaining movement" calc
  // (postAtkRemaining = speed - turnMovedFt, and the equivalent in spell handlers)
  // resolves to 0, keeping the hero out of move mode after they act.
  turnMovedFt       = UNIT_TYPES[hero.type]?.speed ?? 30;
  turnBonusActioned = _readiedBonusActioned.get(hero) ?? false;
  _readiedBonusActioned.delete(hero);
  heroMode          = null;

  endTurnBtn.disabled = false;

  // Move active ring to this hero with their ring colour
  _conformLayer = hero.caveLayer ?? 'surface';
  updateConformingRingGeo(activeRing, hero.grp.position.x, hero.grp.position.z);
  activeRing.position.set(hero.grp.position.x, 0, hero.grp.position.z);
  activeRing.material.color.set(HERO_RING_COLORS[hero.type] ?? COLORS.activeRing);
  activeRing.visible = true;
  showSelectionHighlight(hero);

  // Floating "Triggered!" text and pulsing arrow in turn list
  _showReadyTriggerFloat(hero);
  buildTurnList();

  setFollowUnit(hero);
  showRangeRings(hero);
  showAttackTargets(hero);
  // Auto-select the enemy that tripped the trigger so the readied attack button
  // is immediately usable (it's in range by definition — that's why it fired).
  // Without this, selectedTarget is stale/null and the attack shows greyed even
  // though the enemy is right there in range.
  if (enemy && units.includes(enemy) && enemy.hp > 0) showTargetMarker(enemy);
  _rebuildHotbar(hero);

  // Remove Ready Action (can't ready during a readied-action interrupt) and
  // replace End Turn with Skip
  unbindHotkey('Digit4', false);
  bindHotkey('Digit5', false, '<span class="hb-end-turn">SKIP<br>ACTION</span>', () => _endDelayInterrupt());

  // Show the delay banner
  const banner = document.getElementById('ready-banner');
  if (banner) {
    banner.querySelector('.db-hero').textContent    = unitLabel(hero);
    banner.querySelector('.db-trigger').textContent = _READY_LABELS[trigger];
    banner.style.display = 'flex';
  }

  addLog(`⚡ ${unitLabel(hero)}'s Ready Action fires (${_READY_LABELS[trigger]})! Choose an action.`, 'ready');
}

// Put the interrupted turn back exactly as it was. MODULE SCOPE on purpose: both restore
// paths call it (the automated-hero one inside _showDelayInterrupt, and the manual
// _endDelayInterrupt below), so they can't drift apart.
//
// All of this only became reachable when readied actions started firing on 'hero_moved'.
// Before that a readied action could interrupt nothing but an ENEMY's turn, so the
// teardown could safely lock End Turn and leave the hotbar blank. Interrupting a PLAYER's
// hero mid-turn needs three things put back:
//   • endTurnBtn — restore what it ACTUALLY was, not a blanket lock.
//   • the hotbar — the interrupt rebinds Digit5 to "SKIP ACTION" then clearAllHotkeys()s
//     every slot. END TURN *is* Digit5, so without a rebuild the hero has no way to act
//     and no way to end his turn.
//   • the move ring — hideMoveRange() clears validTiles, so a hero interrupted mid-move
//     comes back with heroMode 'move' but nothing clickable.
//
// The interrupted unit can also be the OWL, whose team is 'familiar', not 'blue' (it's its
// own faction — see UNIT_TYPES.owl). Iffir's Help action is itself a readied-action trigger
// ('owl_helped'), so the owl interrupting its own turn is a routine case, not an edge one.
// A blue-only guard here left it with a cleared hotbar and no move ring for the rest of its
// turn. _rebuildHotbar already routes familiars to _rebuildFamiliarHotbar, so let them through.
function _restoreInterruptedTurn(saved) {
  endTurnBtn.disabled = saved.savedEndTurnDisabled ?? true;

  const u = saved.savedUnit;
  if (!u || !units.includes(u) || u.hp <= 0) return;
  if (u.team !== 'blue' && !u.familiar) return;

  _rebuildHotbar(u);

  if (saved.savedHeroMode !== 'move') return;
  const remaining = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
  if (remaining > 0) showMoveRange(u);
}

function _endDelayInterrupt() {
  clearTimeout(_readyAutoCloseTimer);
  _readyAutoCloseTimer = null;
  if (!_readyCtx) return;
  const saved = _readyCtx;
  const { savedIdx, savedHeroMode, savedAttacked, savedMovedFt, savedBonusActioned,
          savedRingX, savedRingZ, savedRingColor, savedRingVisible, savedRingLayer, cont } = _readyCtx;
  _readyCtx = null;

  const banner = document.getElementById('ready-banner');
  if (banner) banner.style.display = 'none';

  hideRangeRings();
  hideMoveRange();
  hideAttackTargets();
  hideTargetMarker();
  clearAllHotkeys();

  turnIndex         = savedIdx;
  heroMode          = savedHeroMode;
  turnAttacked      = savedAttacked;  // restore the interrupted unit's pre-interrupt attack state
  turnMovedFt       = savedMovedFt;
  turnBonusActioned = savedBonusActioned;

  // Restore the active ring to whoever was acting
  _conformLayer = savedRingLayer ?? 'surface';
  updateConformingRingGeo(activeRing, savedRingX, savedRingZ);
  activeRing.position.set(savedRingX, 0, savedRingZ);
  activeRing.material.color.set(savedRingColor);
  activeRing.visible = savedRingVisible;

  _activeReadyHero = null;
  buildTurnList();

  // Re-arm End Turn and the move ring for whoever was interrupted. Blanket-locking the
  // button here used to be safe, back when only an enemy could ever be the interrupted
  // unit; it now strands the player if the trigger fired mid-hero-turn.
  _restoreInterruptedTurn(saved);
  updateCombatStatus();

  if (cont) cont();
}

// ── Ability handler registry ──────────────────────────────────────────────────
// Single source of truth for every skill/cantrip/spell's execute+availability
// logic, keyed by the same ability keys used in abilityRegistry.js's
// HERO_ABILITY_LAYOUT. The fixed hotbar slots that still hardcode a key
// (Digit2/3/4/5/6 — attacks, ready action, end turn, potion) call in here too
// so there's exactly one copy of each ability's logic; player-assigned and
// auto-filled QWERTY slots (Q/W/E/R/T/Y, via drag-and-drop or
// autoAssignHotbarSlots) look these up generically.
const _ABILITY_HANDLERS = {
  dash: {
    actionType: 'action',
    execute: () => doSprint(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      return !!curU && curU.team === 'blue' && !turnAttacked && !isAnimating;
    },
  },
  dodge: {
    actionType: 'action',
    execute: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue' || isAnimating || turnAttacked) return;
      turnAttacked = true;
      curU.dodging = true;
      addLog(`${unitLabel(curU)} takes the Dodge action — enemies have disadvantage to hit.`, 'move');
      updateCombatStatus();
      _rebuildHotbar(curU);
    },
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      return !!curU && curU.team === 'blue' && !turnAttacked && !isAnimating;
    },
    isActive: u => !!u.dodging,
  },
  rage: {
    actionType: 'bonus',
    execute: () => handleRageBtnClick(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || !UNIT_TYPES[curU.type]?.rage) return false;
      return (curU.rageUses ?? 0) > 0 && !curU.raging && !turnBonusActioned;
    },
  },
  sneak_attack: {
    actionType: 'action',
    execute: () => handleSneakAttackBtnClick(),
    isAvailable: () => {
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
                       unitsHaveLOS(curU, selectedTarget));
      if (!inRange) return false;
      return _allyAdjacentToTarget(curU, selectedTarget) || _isHiddenForSneak(curU);
    },
  },
  hide: {
    actionType: 'bonus',
    // In combat: normal Hide bonus action. Out of combat: toggle Milo's scouting
    // Hide (semi-transparent, shrinks enemy detection radius by 50%).
    execute: () => { if (combatPhase) activateHide(); else toggleMiloHideOOC(); },
    isAvailable: () => {
      if (!combatPhase) return canMiloHideOOC();
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'halfling' || turnBonusActioned) return false;
      return (curU.hideCooldown ?? 0) === 0;
    },
  },
  smoke_mirrors: {
    actionType: 'action',
    execute: () => activateSmokeMirrors(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'halfling' || turnAttacked) return false;
      return (curU.smokeUses ?? 0) > 0;
    },
  },
  defensive_stance: {
    actionType: 'bonus',
    execute: () => activateDefensiveStance(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'human' || turnBonusActioned) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'defensive_stance')) return false;
      return !curU.defStanceActive && (curU.defStanceCooldown ?? 0) === 0;
    },
  },
  healing_word: {
    actionType: 'action',
    // In combat: normal Healing Word. Out of combat: Leugren's once-between-combats
    // heal, so the S&S window button works on click, not just the KeyQ hotkey.
    execute: () => { if (combatPhase) triggerSpellBarAction('healing_word'); else triggerHealingWordOOC(); },
    isAvailable: () => {
      if (!combatPhase) return canHealingWordOOC();
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked) return false;
      const rangeWU = atkRangeWU(SPELLS.healing_word.rangeFt);
      return units.some(ally => {
        if (ally.team !== 'blue' || ally.hp <= 0) return false;
        const dx = ally.grp.position.x - curU.grp.position.x;
        const dz = ally.grp.position.z - curU.grp.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
      });
    },
  },
  cure_wounds: {
    actionType: 'action',
    execute: () => triggerSpellBarAction('cure_wounds'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'cure_wounds')) return false;
      if ((curU.spellSlots ?? 0) <= 0) return false;
      const rangeWU = atkRangeWU(SPELLS.cure_wounds.rangeFt);
      return units.some(ally => {
        if (ally.team !== 'blue' || ally.hp <= 0) return false;
        const dx = ally.grp.position.x - curU.grp.position.x;
        const dz = ally.grp.position.z - curU.grp.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
      });
    },
  },
  sacred_flame: {
    actionType: 'action',
    execute: () => handleSpellBtnClick('sacred_flame'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked) return false;
      if (!selectedTarget || selectedTarget.hp <= 0) return false;
      const rangeWU = atkRangeWU(SPELLS.sacred_flame.rangeFt);
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      return Math.sqrt(dx * dx + dz * dz) <= rangeWU &&
             unitsHaveLOS(curU, selectedTarget);
    },
  },
  fire_bolt: {
    // Fire Bolt is a cantrip spell attack, not a weapon — it has no attacks[]
    // entry (that slot is reserved for Rasec's Quarterstaff/no-ranged-weapon
    // status). It reuses performAttack()'s to-hit/damage/VFX machinery via a
    // synthetic atk object built from ELF_SPELLS.fire_bolt, same shape a real
    // weapon attack would have, so it's unlimited-use and never costs a spell slot.
    actionType: 'action',
    execute: () => {
      if (!selectedTarget || turnAttacked || isAnimating) return;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return;
      const tgt = selectedTarget;
      turnAttacked = true;
      hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
      performAttack(curU, tgt, _fireBoltAtk());
      const postAtkRemaining = (UNIT_TYPES[curU.type]?.speed ?? 30) - turnMovedFt;
      if (postAtkRemaining > 0) { heroMode = 'move'; showMoveRange(curU); }
      else { heroMode = null; }
      updateCombatStatus();
    },
    isAvailable: () => {
      if (!selectedTarget || turnAttacked || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf') return false;
      const atk = _fireBoltAtk();
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist <= atkRangeWU(atk.range) &&
             unitsHaveLOS(curU, selectedTarget);
    },
  },
  bless: {
    actionType: 'action',
    execute: () => handleSpellBtnClick('bless'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked || (curU.spellSlots ?? 0) <= 0) return false;
      return units.some(u => u.team === 'blue' && u.hp > 0);
    },
  },
  mage_armor: {
    actionType: 'action',
    execute: () => activateMageArmor(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf' || turnAttacked || (curU.spellSlots ?? 0) <= 0) return false;
      return !curU.mageArmored;
    },
  },
  magic_missile: {
    actionType: 'action',
    execute: () => handleElfSpellBtnClick('magic_missile'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf' || turnAttacked) return false;
      if (curU.mmFreeUsed && (curU.spellSlots ?? 0) <= 0) return false;
      if (!selectedTarget || selectedTarget.hp <= 0) return false;
      const rangeWU = atkRangeWU(ELF_SPELLS.magic_missile.rangeFt);
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      return Math.sqrt(dx * dx + dz * dz) <= rangeWU &&
             unitsHaveLOS(curU, selectedTarget);
    },
  },
  // Find Familiar — ritual summon, castable BOTH out of combat (from the Skills &
  // Spells window / an assigned hotbar slot while exploring) and in combat (as
  // Rasec's action on his turn). Rasec is the only elf, so the caster is resolved
  // from the roster directly rather than from turn state, which lets the same
  // handler serve the exploration click and the in-combat turn. One-shot: greys
  // out once the owl is already summoned.
  find_familiar: {
    actionType: 'action',
    execute: () => {
      const caster = heroRoster.find(u => u.type === 'elf' && u.hp > 0);
      if (!caster || isFamiliarSummoned() || (caster.level ?? 1) < 4) return;
      if (combatPhase) {
        if (turnOrder[turnIndex] !== caster || turnAttacked || isAnimating) return;
        if (_familiarSummonedThisCombat) return;   // once per combat — see below
        turnAttacked = true;
        _familiarSummonedThisCombat = true;
      }
      summonFamiliar(caster, { inCombat: !!combatPhase });
      if (combatPhase) {
        const owlU = getFamiliar();
        if (owlU) {
          _insertFamiliarIntoCombat(owlU);   // places it on a free tile beside the caster…
          startFamiliarDive();               // …then it drops into that tile from above
        }
      }
      addLog(`${unitLabel(caster)} casts Find Familiar — an owl spirit descends to fight at his side.`, 'heal');
      if (combatPhase) { updateCombatStatus(); _rebuildHotbar(caster); }
    },
    isAvailable: () => {
      const caster = heroRoster.find(u => u.type === 'elf' && u.hp > 0);
      if (!caster || isFamiliarSummoned() || (caster.level ?? 1) < 4) return false;
      if (combatPhase) {
        if (_familiarSummonedThisCombat) return false;
        return turnOrder[turnIndex] === caster && !turnAttacked && !isAnimating;
      }
      return true;  // out of combat: always castable until summoned
    },
  },
};

// Slots the player may freely drag-and-drop abilities onto. Everything else
// (attacks, end turn, ready action, potion, top view) stays fixed. The QWERTY
// letter row (KeyQ..KeyY) is also where autoAssignHotbarSlots seeds each hero's
// signature abilities on level-up — Ready Action was moved off KeyR to Digit4
// so R can join the auto-fill order.
//
// Digit1 is RESERVED for the SAVING THROW slot and is deliberately NOT in here. It was
// assignable at first, with the save button temporarily taking the slot over — but a player
// who had dragged a spell there would watch it get displaced mid-fight, which is exactly the
// kind of thing you can't have happen on the one turn where the bar matters. The slot is now
// permanently the save's, and shows a greyed placeholder when the hero has no condition to
// shake. assignHotbarSlot() rejects anything aimed at it, so the drag-drop can't reach it.
const SAVE_SLOT = 'Digit1';
const _ASSIGNABLE_SLOTS = new Set(['Backquote', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'Tab', 'KeyY', 'KeyT']);

// The QWERTY letter-row slots the auto-assigner fills, in order (Q→W→E→R→T→Y).
const AUTO_FILL_SLOTS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY'];

// Level-1 signature ability for martial heroes that have no starting cantrip in
// STARTING_SPELLS (casters get theirs from there — dwarf/elf). Rage/Sneak Attack
// aren't level-gated spells, so they're named explicitly here.
const _SIGNATURE_L1 = { human: 'rage', halfling: 'sneak_attack' };

// A hero type's signature abilities in unlock order: the level-1 cantrip/skill
// first, then each level's newly learned spell/ability in ascending level order.
// Generic skills (Dash/Dodge) are intentionally excluded — only progression
// abilities auto-fill the bar.
function _autoAbilityOrder(type) {
  const order = [];
  // STARTING_SPELLS values are Sets — spread to index the first (only) cantrip.
  const start = [...(STARTING_SPELLS[type] ?? [])][0] ?? _SIGNATURE_L1[type];
  if (start) order.push(start);
  const byLevel = LEVEL_SPELLS[type] ?? {};
  Object.keys(byLevel).map(Number).sort((a, b) => a - b)
    .forEach(lv => byLevel[lv].forEach(k => order.push(k)));
  return order;
}

// Seeds a hero's unlocked signature abilities into empty QWERTY slots in order
// (Q→W→E→R→T→Y). Idempotent and non-destructive: only fills empty slots and
// never places an ability already sitting in another slot, so any manual
// arrangement the player has made is preserved. Once the six slots are full,
// further abilities stay in the Skills & Spells window for manual placement.
// Called at combat turn start (_rebuildHotbar), on level-up, and on OOC hero
// selection, so newly unlocked abilities appear the next time the hero's bar
// is shown.
export function autoAssignHotbarSlots(hero) {
  if (!hero) return;
  if (!hero.hotbarSlots) hero.hotbarSlots = {};
  const slots = hero.hotbarSlots;
  const taken = new Set(Object.values(slots));   // abilities already placed anywhere
  for (const key of _autoAbilityOrder(hero.type)) {
    if (taken.has(key)) continue;                             // already on the bar
    if (!_ABILITY_HANDLERS[key]) continue;                    // must be bindable
    if (!isAbilityUnlocked(hero.type, hero.level ?? 1, key)) continue; // not unlocked yet
    const free = AUTO_FILL_SLOTS.find(s => !slots[s]);        // next empty QWERTY slot
    if (!free) break;                                         // bar full — stop
    slots[free] = key;
    taken.add(key);
  }
}

// Binds one player-assigned ability onto one hotbar slot for the currently
// rebuilding hero — shared by the custom-slot loop in _rebuildHotbar.
function _bindAbilitySlot(slotKey, abilityKey) {
  const handler = _ABILITY_HANDLERS[abilityKey];
  if (!handler) return;
  const btn = bindHotkey(slotKey, false, hotbarIconHTML(abilityKey), handler.execute, handler.isAvailable, handler.actionType, ABILITY_META[abilityKey]?.name);
  const curU = turnOrder[turnIndex];
  if (btn && curU && handler.isActive?.(curU)) btn.classList.add('spell-active');
}

// Runs one ability's handler directly — used by a plain (non-shift) click on
// a Skills & Spells window box, so clicking there behaves identically to
// clicking the same ability wherever else it's bound (hotbar/T-key/dragged
// slot). Each handler's own execute() already re-derives the active hero and
// re-checks its own guards (isAnimating, turnAttacked, etc.), so this is safe
// to call unconditionally.
export function executeAbility(abilityKey) {
  _ABILITY_HANDLERS[abilityKey]?.execute();
}

// Shared by the hotbar (bindHotkey's actionType param) and the Skills &
// Spells window, so both show the same A/BA/R tag for a given ability.
export function getAbilityActionType(abilityKey) {
  return _ABILITY_HANDLERS[abilityKey]?.actionType ?? null;
}

// Whether an ability could be used right now (turn state, cooldowns, range,
// etc. — same guard each handler's own execute() re-checks). Used by the
// Skills & Spells window to grey out boxes for the currently active hero.
export function isAbilityAvailableNow(abilityKey) {
  // Still tangled in webbing — struggling was the whole turn. Everything greys out.
  const _cu = turnOrder[turnIndex];
  if (_saveLocksTurn(_cu) && abilityKey !== 'action_save') return false;
  return _ABILITY_HANDLERS[abilityKey]?.isAvailable?.() ?? true;
}

// Called from the Skills & Spells window's shift-click-drag-drop — assigns
// (or overwrites) one ability onto one hotbar slot for a specific hero.
export function assignHotbarSlot(hero, slotKey, abilityKey) {
  if (!hero || !_ASSIGNABLE_SLOTS.has(slotKey) || !_ABILITY_HANDLERS[abilityKey]) return false;
  if (!hero.hotbarSlots) hero.hotbarSlots = {};
  hero.hotbarSlots[slotKey] = abilityKey;
  if (combatPhase && turnOrder[turnIndex] === hero) {
    // Hero is actively taking their turn — rebuild the whole hotbar so every
    // slot (attacks, T-key ability, etc.) reflects them, not just this one.
    _rebuildHotbar(hero);
  } else {
    // Precombat (or any other time the hotbar isn't "owned" by this hero) —
    // only reflect this one slot rather than rebuilding the whole hotbar,
    // which would incorrectly light up End Turn/attacks/etc. before combat
    // even starts. Without this, a drop made outside combat wrote the
    // assignment to hero.hotbarSlots correctly but never showed up on the
    // hotbar until their next real turn, which looked like the drop failed.
    _bindAbilitySlot(slotKey, abilityKey);
  }
  updateHotkeyRanges(); // refresh greyed/enabled state immediately, same as activateTurn does
  return true;
}

// The owl's turn gets a small text hotbar: Help (wired), Scout & Touch Spell
// (present but disabled placeholders), and End Turn. Movement is click-to-move
// like any hero.
function _rebuildFamiliarHotbar(u) {
  clearAllHotkeys();
  // The owl's slots 2/3 are Help/Return, not melee/ranged — hide the baked-in
  // weapon glyphs so they don't read as attacks.
  setSlotIcon('Digit2', false);
  setSlotIcon('Digit3', false);
  bindHotkey('Digit2', false, '<span class="hb-ready">HELP</span>',
    () => _beginOwlHelp(),
    () => {
      const curU = turnOrder[turnIndex];
      return !!curU && curU.familiar && !turnAttacked && !isAnimating;
    },
    'action');
  // Return — fly back toward Rasec with leftover movement (needs move left + an owner).
  bindHotkey('Digit3', false, '<span class="hb-ready">RETURN</span>',
    () => _owlReturnToOwner(),
    () => {
      const curU = turnOrder[turnIndex];
      return !!curU && curU.familiar && !!curU.owner && !isAnimating &&
             (UNIT_TYPES.owl?.speed ?? 60) - turnMovedFt > 0;
    });
  // Scout — present but not implemented yet (no scouting system).
  bindHotkey('Digit4', false, '<span class="hb-ready">SCOUT</span>', () => {}, () => false, 'action');
  bindHotkey('Digit5', false, '<span class="hb-end-turn">END<br>TURN</span>', () => {
    if (isAnimating || endTurnBtn.disabled) return;
    doEndTurn();
  });
  // Touch Spell — disabled placeholder (Rasec has no touch spell yet). Parked on
  // the QWERTY row so it doesn't crowd the owl's active number-row actions.
  bindHotkey('KeyQ', false, '<span class="hb-ready">TOUCH<br>SPELL</span>', () => {}, () => false, 'action');
  updateHotkeyRanges();
}

function _rebuildHotbar(u) {
  if (!u) return;
  if (u.familiar) { _rebuildFamiliarHotbar(u); return; }
  if (u.team !== 'blue') return;
  clearAllHotkeys();
  // Restore the melee/ranged weapon glyphs on slots 2/3 (the owl hotbar hides them).
  setSlotIcon('Digit2', true);
  setSlotIcon('Digit3', true);
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
      if (!selectedTarget || turnAttacked || _saveLocksTurn(turnOrder[turnIndex]) || selectedTarget.hp <= 0) return false;
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
      if (!selectedTarget || turnAttacked || _saveLocksTurn(turnOrder[turnIndex]) || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return false;
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist <= atkRangeWU(firstRanged.range) &&
             unitsHaveLOS(curU, selectedTarget) &&
             atkHasQty(curU, firstRanged);
    }, 'action');
  } else {
    markHotkeyUnavailable('Digit3');
  }
  const spellPanel = document.getElementById('blue-spell-panel');
  if (spellPanel) {
    buildHeroSpellPanel(u, spellPanel, {
      turnAttacked: turnAttacked || _saveLocksTurn(u),
      turnBonusActioned: turnBonusActioned || _saveLocksTurn(u),
      onSpellBtn:    handleSpellBtnClick,
      onRageBtn:     handleRageBtnClick,
      onElfSpellBtn: handleElfSpellBtnClick,
      onSneakBtn:    handleSneakAttackBtnClick,
    });
  }
  // Ready Action lives on Digit4 (moved off KeyR so R can join the QWERTY
  // ability auto-fill row — see autoAssignHotbarSlots / the custom-slot loop below).
  {
    const armed = _readied.has(u);
    bindHotkey('Digit4', false,
      armed
        ? '<span class="hb-ready hb-ready-armed">READY ✓</span>'
        : '<span class="hb-ready">READY<br>ACTION</span>',
      () => {
        const curU = turnOrder[turnIndex];
        if (!curU || curU.team !== 'blue' || isAnimating) return;
        if (_readied.has(curU)) {
          addLog(`${unitLabel(curU)} has readied action: trigger "${_READY_LABELS[_readied.get(curU)]}"`, 'ready');
          return;
        }
        if (turnAttacked) return;
        _openReadyModal(curU);
      },
      () => {
        const curU = turnOrder[turnIndex];
        return !!curU && curU.team === 'blue' && !isAnimating && !turnAttacked && !_readyCtx && !_saveLocksTurn(curU);
      },
      'action'
    );
  }
  {
    const potion = _heroPotion(u);
    bindHotkey('Digit6', false,
      potion ? potion.name.toUpperCase() : 'HEAL POTION',
      () => _useHealingPotion(u),
      () => {
        const curU = turnOrder[turnIndex];
        return !!curU && curU.team === 'blue' && !isAnimating && !turnBonusActioned && !!_heroPotion(curU) && !_saveLocksTurn(curU);
      },
      'bonus'
    );
  }
  bindHotkey('Digit5', false, '<span class="hb-end-turn">END<br>TURN</span>', () => {
    if (isAnimating || endTurnBtn.disabled) return;
    doEndTurn();
  });
  // Auto-seed this hero's unlocked signature abilities into empty QWERTY slots
  // (fire_bolt→Q, then each level's new spell/ability), then bind every slot —
  // both the auto-seeded ones and any the player dragged in from the Skills &
  // Spells window. autoAssign is non-destructive, so manual arrangements stay put.
  // Digit1 is the reserved SAVING THROW slot now. Any ability a hero had bound there from
  // before that rule existed gets dropped, so it can't fight the save button for the slot;
  // autoAssignHotbarSlots re-seeds it into a free QWERTY slot on the next pass.
  if (u.hotbarSlots?.[SAVE_SLOT]) delete u.hotbarSlots[SAVE_SLOT];

  autoAssignHotbarSlots(u);
  for (const [slotKey, abilityKey] of Object.entries(u.hotbarSlots ?? {})) {
    _bindAbilitySlot(slotKey, abilityKey);
  }

  // ── SAVING THROW slot (permanently Digit1) ──────────────────────────────────
  // Always bound, so its position never moves and the player learns where it lives — greyed
  // out with no condition to shake, red and live the moment something grabs them. This is the
  // whole reason the save isn't auto-rolled: spending your Action to struggle is the player's
  // call, so they need a button that is reliably THERE.
  {
    const s = u.actionSave;
    bindHotkey(SAVE_SLOT, false,
      s
        ? `<span class="hb-save-throw">${s.label ?? 'SAVING<br>THROW'}` +
          `<span class="hb-save-dc">${s.stat.toUpperCase()} DC ${s.dc}</span></span>`
        : `<span class="hb-save-throw hb-save-idle">SAVING<br>THROW</span>`,
      () => {
        const curU = turnOrder[turnIndex];
        if (curU !== u || !u.actionSave) return;
        _attemptActionSave(u);
      },
      () => {
        const curU = turnOrder[turnIndex];
        return curU === u && !!u.actionSave && !turnAttacked && !isAnimating;
      },
      'action',
    );
  }
  // clearAllHotkeys() above marks every non-permanent slot hb-disabled; slots
  // just rebound above (like Digit5/End Turn, which has no rangeFn) never get
  // that class cleared unless updateHotkeyRanges() runs again here — without
  // this, they're stuck looking greyed out even though they still work.
  updateHotkeyRanges();
}

window.addEventListener('hero:levelup', ({ detail: { hero, newLevel } }) => {
  // Add any spells that unlock at this exact level
  const unlocks = LEVEL_SPELLS[hero.type] ?? {};
  if (unlocks[newLevel]) {
    // Seed with the hero's starting spells so leveling up doesn't wipe out
    // spells they already knew (e.g. Rasec's Fire Bolt cantrip) before the
    // next combat's initSpellSlots re-seeds the set.
    if (!hero.preparedSpells) hero.preparedSpells = new Set(STARTING_SPELLS[hero.type] ?? []);
    unlocks[newLevel].forEach(k => hero.preparedSpells.add(k));
  }
  // Seed any freshly-unlocked signature ability into the next empty QWERTY slot
  // so it's on the bar even for a hero who isn't the active unit right now.
  autoAssignHotbarSlots(hero);
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

// Out of combat, the hotbar is shared (there's no per-turn _rebuildHotbar), so
// reflect the newly-selected hero's ability slots here: seed their auto-assigned
// QWERTY abilities and rebind the letter row to this hero. Only the six auto-fill
// slots are cleared/rebound — the permanent Backquote/Tab and the number-row
// combat slots are left untouched. Combat drives its own rebuilds, so this is a
// no-op during combat.
window.addEventListener('pc-hero:selected', ({ detail }) => {
  const hero = detail?.hero;
  if (!hero || hero.team !== 'blue' || combatPhase) return;
  autoAssignHotbarSlots(hero);
  for (const slot of AUTO_FILL_SLOTS) unbindHotkey(slot, false);
  for (const [slotKey, abilityKey] of Object.entries(hero.hotbarSlots ?? {})) {
    _bindAbilitySlot(slotKey, abilityKey);
  }
  updateHotkeyRanges();
});

export function activateTurn(index) {
  clearRollFeed();
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
    if ((u.team === 'blue' || u.familiar) && !unawareEnemy) setFollowUnit(u);
    if (u.team === 'blue' || u.familiar) u.barForced = true;
    _conformLayer = u.caveLayer ?? 'surface';
    updateConformingRingGeo(activeRing, u.grp.position.x, u.grp.position.z);
    activeRing.position.set(u.grp.position.x, 0, u.grp.position.z);
    activeRing.material.color.set(u.team === 'red' ? COLORS.activeRing : u.familiar ? 0xc9a0e6 : (HERO_RING_COLORS[u.type] ?? COLORS.activeRing));
    activeRing.visible    = !unawareEnemy;
    showSelectionHighlight(u);
    turnMovedFt     = 0;
    turnAttacked    = false;
    turnReactionUsed = false;
    sneakAttackUsed = false;
    u.dodging       = false;
    // NOTE: action saves (the web, and anything shaped like it) are deliberately NOT rolled
    // here. They cost the unit its Action and the PLAYER decides whether to spend it — see
    // the SAVING THROW hotbar slot and _attemptActionSave(). Reactive saves (venom, a
    // fireball's DEX save, concentration) are forced on you and still auto-roll where they
    // happen; that distinction is the whole point of the split.
    hideSoulShardPrompt();
    // If this hero's delayed action never fired, it expires at turn start
    if (u.team === 'blue' && _readied.has(u)) {
      addLog(`${unitLabel(u)}'s ready action expires (trigger never fired).`, 'ready');
      _readied.delete(u);
      _readiedAutomated.delete(u);
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
    // Apply each slot's greyed/enabled state immediately — without this, a
    // freshly-bound slot whose rangeFn depends on nothing else the player is
    // about to click (e.g. Digit6's potion check) stays visually "enabled"
    // until some unrelated action happens to call updateCombatStatus().
    updateHotkeyRanges();

    if (combatPhase) {
      heroMode = null;
      if (u.team === 'red') {
        // An enemy held by a turn-locking action-save has no UI to click, so it spends its
        // Action on the save itself and then ends the turn. Handing it to runAITurn would
        // have it try to move/attack with an Action it cannot use, and could hang the round.
        if (u.dormant) {
          setTimeout(() => doEndTurn(), 60);
        } else if (_saveLocksTurn(u)) {
          setTimeout(() => { _attemptActionSave(u); setTimeout(() => doEndTurn(), 900); }, 300);
        } else {
          runAITurn(u);
        }
      } else if (u.familiar) {
        // The owl: automated → its own simple AI; manual → player flies it.
        if (isAutomated()) {
          _runAutomatedFamiliarTurn(u);
        } else {
          endTurnBtn.disabled = false;
          heroMode = 'move';
          showMoveRange(u);
        }
      } else if (_saveLocksTurn(u)) {
        // Hero held by a web/grapple/etc. MANUAL: the SAVING THROW button is the one legal
        // action — hand them the bar and let them choose to spend it (that choice is the
        // whole point; auto-rolling it takes the decision away). AUTOMATED: no one is there
        // to click, so roll it for them, then end the turn.
        endTurnBtn.disabled = false;
        if (isAutomated()) {
          setTimeout(() => { _attemptActionSave(u); setTimeout(() => doEndTurn(), 1100); }, 400);
        }
      } else if (isAutomated()) {
        _runAutomatedHeroTurn(u);
      } else {
        endTurnBtn.disabled = false;
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

    addLog(`⚠ ${unitLabel(u)} is alerted by the heroes! (Initiative ${u.initiative})`, 'alert');
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
    cur.raging = false;
    addLog(`${unitLabel(cur)}'s Rage ends (no attack)`, 'dmg');
  }
  // Owl's Help advantage lasts until the end of Rasec's next turn.
  if (cur && cur.type === 'elf' && _owlHelpTarget) _clearOwlHelp();
  if (_owlHelpPicking) _owlHelpPicking = false;  // never carry a half-made pick past a turn

  turnIndex++;
  if (turnIndex >= turnOrder.length) {
    turnIndex = 0;
    round++;
    addLog(`━━━ ROUND ${round} ━━━`, 'round');
    window.dispatchEvent(new CustomEvent('round:start', { detail: { round } }));
    tickBless();
    tickSleep();
    units.forEach(u => {
      if (u.defStanceActive) {
        u.defStanceRounds--;
        if (u.defStanceRounds <= 0) {
          u.defStanceActive = false;
          addLog(`${unitLabel(u)}'s Defensive Stance fades`, 'move');
        }
      }
      if (u.smokeActive) {
        u.smokeRoundsLeft--;
        if (u.smokeRoundsLeft <= 0) {
          u.smokeActive = false;
          u.smokeCenter = null;
          if (u._smokeVFX) { u._smokeVFX.dispose(); u._smokeVFX = null; }
          addLog(`${unitLabel(u)}'s smoke cloud dissipates`, 'move');
        }
      }
    });
    _nudgeRoamers();
    // At round boundary: intercept if player queued a mode switch
    if (hasPendingSwitch()) {
      handleRoundStartSwitch(() => setTimeout(_proceedToNextTurn, 100));
      return;
    }
  }
  setTimeout(_proceedToNextTurn, 30);
}

// Holds the turn advance while a level-up modal is on screen (e.g. XP from
// the kill that just ended a turn crossed a level threshold mid-battle).
// Resumes automatically the moment the player closes the modal.
function _proceedToNextTurn() {
  if (isLevelUpModalOpen()) {
    window.addEventListener('levelup:modal', function _onModalChange(e) {
      if (e.detail?.open) return;
      window.removeEventListener('levelup:modal', _onModalChange);
      activateTurn(turnIndex);
    });
    return;
  }
  activateTurn(turnIndex);
}

endTurnBtn.addEventListener('click', () => {
  if (isAnimating) return;
  if (_readyCtx) { _endDelayInterrupt(); return; }
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
    addLog(`⚠ ${unitLabel(u)} spots the heroes during patrol!`, 'alert');
    buildTurnList();
  }
}

// 10 ft non-blocking nudge for non-aggro roamers, fired after every combat turn
const ROAM_NUDGE_WU = (10 / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;

function _nudgeRoamers() {
  for (const u of units) {
    if (!combatPhase) break;
    if (u.team !== 'red') continue;
    if (u.hp <= 0) continue;
    if (u.aggro) continue;
    if (!u.roams) continue;
    if (u._roamNudging) continue;
    _animateRoamNudge(u);
  }
}

function _animateRoamNudge(u) {
  if (!u.patrolPath?.length) {
    _roamAggroCheck(u);
    return;
  }

  let idx = u._patrolIdx ?? 0;
  for (let guard = 0; guard < u.patrolPath.length; guard++) {
    const wp  = u.patrolPath[idx];
    const ddx = wp.x - u.grp.position.x;
    const ddz = wp.z - u.grp.position.z;
    if (ddx * ddx + ddz * ddz > 0.04) break;
    idx = (idx + 1) % u.patrolPath.length;
  }
  u._patrolIdx = idx;

  const wp   = u.patrolPath[idx];
  const cx   = u.grp.position.x;
  const cz   = u.grp.position.z;
  const dx   = wp.x - cx;
  const dz   = wp.z - cz;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.01) {
    u._patrolIdx = (idx + 1) % u.patrolPath.length;
    return;
  }

  const willReach = dist <= ROAM_NUDGE_WU;
  const ratio     = willReach ? 1 : ROAM_NUDGE_WU / dist;
  const destX     = cx + dx * ratio;
  const destZ     = cz + dz * ratio;

  // Skip nudge if the path crosses a barrier or the destination is occupied.
  if (crossesBarrier(cx, cz, destX, destZ, u.caveLayer) || isOccupied(destX, destZ, u)) {
    if (willReach) u._patrolIdx = (idx + 1) % u.patrolPath.length;
    _roamAggroCheck(u);
    return;
  }

  u.grp.rotation.y = Math.atan2(dx, dz);
  setUnitWalking(u, true, false);
  u._roamNudging = true;

  const startX = cx, startZ = cz;
  const startY = getGroundHeight(startX, startZ, u.caveLayer);
  let startTs  = null;

  function frame(ts) {
    if (startTs === null) startTs = ts;
    if (!combatPhase || !units.includes(u) || u.hp <= 0) {
      u._roamNudging = false;
      setUnitWalking(u, false);
      return;
    }
    const elapsed = (ts - startTs) / 1000;
    const t       = dist > 0 ? Math.min(1, (elapsed * MOVE_SPEED * 0.33) / (dist * ratio)) : 1;
    const endY    = getGroundHeight(destX, destZ, u.caveLayer);

    u.grp.position.x = startX + dx * ratio * t;
    u.grp.position.z = startZ + dz * ratio * t;
    u.grp.position.y = startY + (endY - startY) * t;
    u.anchor.x = u.grp.position.x;
    u.anchor.z = u.grp.position.z;
    u.anchor.y = u.grp.position.y + (u.anchorY ?? 0);

    if (t >= 1) {
      u.grp.position.set(destX, endY, destZ);
      u.anchor.x = destX; u.anchor.z = destZ;
      u.anchor.y = endY + (u.anchorY ?? 0);
      if (willReach) u._patrolIdx = (idx + 1) % u.patrolPath.length;
      u._roamNudging = false;
      setUnitWalking(u, false);
      if (!u.aggro) _roamAggroCheck(u);
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function _runRoamTurn(u) {
  // Roaming nudge happens non-blocking via doEndTurn for every unit's turn;
  // on the roamer's own turn just check aggro and pass quickly.
  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
    _roamAggroCheck(u);
    setTimeout(() => { doEndTurn(); }, 50);
  }, 50);
}

// ── Automated hero turn ───────────────────────────────────────────────────────
const _readiedAutomated = new Set(); // heroes whose delay was set in automated mode

// Fly `u` as far toward `destPos` as its remaining movement allows, then onDone.
function _familiarMoveToward(u, destPos, onDone) {
  const remFt = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
  if (remFt <= 0) { onDone(); return; }
  const maxDist = (remFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const ux = u.grp.position.x, uz = u.grp.position.z;
  const reach = _bfsReachable(ux, uz, maxDist, u, u.caveLayer);
  if (!reach.size) { onDone(); return; }
  let best = null, bestD = Infinity;
  for (const k of reach) {
    const [kx, kz] = k.split(',').map(Number);
    const dx = destPos.x - kx, dz = destPos.z - kz, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = { x: kx, z: kz }; }
  }
  if (!best) { onDone(); return; }
  const path = findPath(ux, uz, best.x, best.z, u.caveLayer);
  if (!path.length) { onDone(); return; }
  const mdx = best.x - ux, mdz = best.z - uz;
  const movedFt = Math.round(Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE) * GRID_SQUARE_FEET;
  // Same hero-movement notification as the manual move path: an automated hero closing
  // to melee is exactly what a readied 'ally_in_enemy_melee' is waiting on. onDone is the
  // continuation, so the interrupted turn resumes only after any readied hero has acted.
  animatePath(u, path, () => {
    turnMovedFt += movedFt;
    if (u.team === 'blue') _checkDelayedTriggers('hero_moved', u, false, onDone);
    else onDone();
  });
}

// Automated owl turn: fly to the enemy nearest Rasec and Help it, then fly back
// toward Rasec with whatever movement is left.
function _runAutomatedFamiliarTurn(u) {
  endTurnBtn.disabled = true;
  const STEP_MS = 140;
  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
    const ownerU  = getFamiliar()?.owner ?? null;
    const ref     = ownerU ?? u;
    const enemies = units.filter(e => e.team === 'red' && e.hp > 0);
    const target  = enemies.reduce((best, e) => {
      const dx = e.grp.position.x - ref.grp.position.x, dz = e.grp.position.z - ref.grp.position.z;
      const d = dx * dx + dz * dz;
      return (!best || d < best.d) ? { e, d } : best;
    }, null)?.e ?? null;

    if (!target) { setTimeout(doEndTurn, STEP_MS); return; }

    // 1) Approach the target, then Help it.
    _familiarMoveToward(u, target.grp.position, () => {
      if (!turnAttacked && units.includes(target) && target.hp > 0) {
        turnAttacked = true;
        familiarHelpGesture(() => {
          _owlHelpTarget = target;
          addLog(`${unitLabel(u)} distracts ${unitLabel(target)} — Rasec has advantage against it!`, 'move');
          _checkDelayedTriggers('owl_helped', target, false, () => {});
        });
      }
      // 2) Retreat back toward Rasec with any leftover movement, then end turn.
      setTimeout(() => {
        if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
        _familiarMoveToward(u, (ownerU ?? u).grp.position, () => setTimeout(doEndTurn, STEP_MS));
      }, 700);
    });
  }, STEP_MS);
}

// preferTarget: force the attack onto this enemy instead of re-picking from the hero's
// target priorities. Used by a readied 'ally_in_enemy_melee' so the shot lands on the
// foe the ally is actually engaging (the Sneak Attack condition).
function _runAutomatedHeroTurn(u, { noMove = false, onEnd = null, preferTarget = null } = {}) {
  endTurnBtn.disabled = true;

  const THINK_MS   = 100;
  const PRE_ATK_MS = 100;
  const END_PAUSE  = 80;

  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }

    const heroType   = u.type;
    const preferRange = getTendency(heroType, 'preferred_range');
    const heroPos    = { x: u.grp.position.x, z: u.grp.position.z };
    const enemies    = units.filter(e => e.team === 'red' && e.hp > 0);
    const allies     = units.filter(a => a.team === 'blue' && a !== u && a.hp > 0);

    // Most wounded blue unit (includes self — Leugren can heal himself).
    // Requires a meaningful wound (missing >=25% of max HP) — otherwise a
    // 1-HP graze would make Leugren spend his turn healing instead of
    // readying an action for a real threat.
    const allyWounded = units
      .filter(a => a.team === 'blue' && a.hp > 0 && a.hp <= a.maxHp * 0.75)
      .reduce((best, a) => (!best || a.hp < best.hp) ? a : best, null);

    // A live, still-valid preferTarget overrides target selection entirely.
    const forced = (preferTarget && units.includes(preferTarget) && preferTarget.hp > 0)
      ? preferTarget : null;

    // Enemies this hero could Sneak Attack right now. Built HERE, from the same helpers
    // the damage code consults (hasSneakAttackCondition = advantage || ally adjacent ||
    // hidden), so the 'sneak_possible' tendency can't promise a target the dice then
    // refuse. Advantage is omitted deliberately: Milo's only advantage source is Smoke &
    // Mirrors, which itself requires an adjacent ally, so it adds no targets — and the
    // owl's Help advantage is elf-only.
    const sneakable = UNIT_TYPES[heroType]?.sneakAttack
      ? new Set(enemies.filter(e => _allyAdjacentToTarget(u, e) || _isHiddenForSneak(u)))
      : null;
    const pickCtx = { helpTarget: _owlHelpTarget, sneakable };

    // movTarget drives positioning (may be an ally for Leugren)
    const movTarget   = forced ?? pickAutoTarget(heroType, heroPos, enemies, allies, pickCtx);
    // enemyTarget is always an enemy — used for actual attacks
    const enemyTarget = forced ?? pickAutoTarget(heroType, heroPos, enemies, [], pickCtx);

    // Nothing to do
    if (!movTarget && !allyWounded) { onEnd ? onEnd() : setTimeout(doEndTurn, END_PAUSE); return; }

    function endHeroAITurn() { onEnd ? onEnd() : setTimeout(doEndTurn, END_PAUSE); }

    // ── Execute a validated attack against enemyTarget ──────────────────
    function _executeAttack(atk, cb) {
      turnAttacked = true;
      showAttackTargets(u);
      setTimeout(() => {
        if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
        hideAttackTargets();
        hideUndoBtn();
        updateCombatStatus();
        const hpBefore = enemyTarget.hp;
        performAttack(u, enemyTarget, atk, () => {
          _checkDelayedTriggers('ally_damaged', enemyTarget, enemyTarget.hp < hpBefore, cb);
        });
      }, PRE_ATK_MS);
    }

    // ── Try one action from the priority list ────────────────────────────
    // onDone() = action fired and turn is over
    // onSkip() = action not available, try next in list
    function _tryHeroAction(actionVal, onDone, onSkip) {
      // Rage and Use Healing Potion are bonus actions — having already used
      // the main action this turn doesn't block them (each still checks
      // turnBonusActioned itself below).
      if (turnAttacked && actionVal !== 'rage' && actionVal !== 'use_potion') { onSkip(); return; }

      // SPELL ANIMATION RULE: every spell handler below must call its visual
      // effect function (e.g. playHealingWordEffect, playFireboltEffect) and
      // put onDone() inside the impact callback — never call onDone() before
      // the animation fires.  When adding a new spell to combatAutomation.js,
      // add a matching handler here that uses the spell's playXxxEffect import.

      // ── Use Healing Potion (bonus action, any hero, <33% HP) ──────────
      if (actionVal === 'use_potion') {
        if (turnBonusActioned) { onSkip(); return; }
        if ((u.hp / u.maxHp) >= 0.33) { onSkip(); return; }
        if (!_heroPotion(u)) { onSkip(); return; }
        _useHealingPotion(u);
        onDone();
        return;
      }

      // ── Dodge (<33% HP) — main action, any hero ───────────────────────
      // Self-gating, exactly like use_potion above: at or above 33% HP it SKIPS, so the
      // priority list falls straight through to the next entry (an attack) and the option
      // costs nothing to leave in the list. Below 33% it spends the action to turtle.
      // Separate from the ungated 'dodge' handled in doNoRangeAction — that one fires
      // whenever it's reached, and must keep doing so.
      if (actionVal === 'dodge_hurt') {
        if (turnAttacked) { onSkip(); return; }
        if ((u.hp / u.maxHp) >= 0.33) { onSkip(); return; }
        turnAttacked = true;
        u.dodging    = true;
        addLog(`${unitLabel(u)} takes the Dodge action — enemies have disadvantage to hit.`, 'move');
        updateCombatStatus();
        onDone();
        return;
      }

      // ── Healing Word ─────────────────────────────────────────────────
      if (actionVal === 'healing_word') {
        if (!allyWounded) { onSkip(); return; }
        turnAttacked = true;
        // Roll from SPELLS, exactly as the manual cast does (castHealSpell). This used to
        // hardcode 1d4+3 while the spell — and Leugren's own sheet — said 1d8+WIS, so he
        // healed differently depending on who was driving him.
        const hw       = SPELLS.healing_word;
        const hwWisMod = Math.floor(((UNIT_TYPES[u.type]?.abilities?.wis ?? 10) - 10) / 2);
        const healRoll = roll({
          sides:    hw.healSides,
          count:    hw.healDice,
          modifier: hw.healMod ?? hwWisMod,
        });
        // Bug fix: this used to read the hero's base UNIT_TYPES hp (stale
        // once they've leveled up) instead of their real current maxHp,
        // capping — or even reducing — HP for anyone past their starting max.
        const maxHp    = allyWounded.maxHp ?? UNIT_TYPES[allyWounded.type]?.hp ?? allyWounded.hp;
        const before   = allyWounded.hp;
        allyWounded.hp = Math.min(allyWounded.hp + healRoll.total, maxHp);
        const healed   = allyWounded.hp - before;
        allyWounded.barShowUntil = Date.now() + 4000;
        hideUndoBtn();
        updateCombatStatus();
        playHealingWordEffect(u, allyWounded, () => {
          showFloatingDamage(allyWounded, `+${healed}`, '#44ff88');
          addLog(`${unitLabel(u)} uses Healing Word on ${unitLabel(allyWounded)}, restoring ${healed} HP (${dmgBreakdown(healRoll)})`, 'heal');
          buildTurnList();
          onDone();
        });
        return;
      }

      // ── Cure Wounds (dwarf, level 4, main action, uses spell slot, ally <33% HP) ─
      if (actionVal === 'cure_wounds') {
        if (u.type !== 'dwarf')          { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'cure_wounds')) { onSkip(); return; }
        if ((u.spellSlots ?? 0) <= 0)    { onSkip(); return; }
        // Only fire for a critically wounded ally (<33% HP) — otherwise fall
        // through to Healing Word for lighter, slot-free healing.
        const critAlly = units
          .filter(a => a.team === 'blue' && a.hp > 0 && a.hp <= a.maxHp * 0.33)
          .reduce((best, a) => (!best || a.hp < best.hp) ? a : best, null);
        if (!critAlly) { onSkip(); return; }
        turnAttacked = true;
        u.spellSlots--;
        const cw       = SPELLS.cure_wounds;
        const healRoll = roll({ sides: cw.healSides, count: cw.healDice, modifier: cw.healMod });
        const before   = critAlly.hp;
        critAlly.hp    = Math.min(critAlly.hp + healRoll.total, critAlly.maxHp);
        const healed   = critAlly.hp - before;
        critAlly.barShowUntil = Date.now() + 4000;
        hideUndoBtn();
        updateCombatStatus();
        playHealingWordEffect(u, critAlly, () => {
          showFloatingDamage(critAlly, `+${healed}`, '#44ff88');
          addLog(`${unitLabel(u)} casts Cure Wounds on ${unitLabel(critAlly)}, restoring ${healed} HP (${dmgBreakdown(healRoll)})`, 'heal');
          buildTurnList();
          onDone();
        });
        return;
      }

      // ── Bless (dwarf, main action, uses spell slot) ──────────────────
      if (actionVal === 'bless') {
        if (u.type !== 'dwarf')          { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'bless')) { onSkip(); return; }
        if ((u.spellSlots ?? 0) <= 0)    { onSkip(); return; }
        if (blessedUnits.size > 0)       { onSkip(); return; } // already active
        castBless(u);
        setTimeout(onDone, 900);
        return;
      }

      // ── Sacred Flame (dwarf, level 3 cantrip, no spell slot) ──────────
      if (actionVal === 'sacred_flame') {
        if (u.type !== 'dwarf')          { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'sacred_flame')) { onSkip(); return; }
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const rangeWU = atkRangeWU(SPELLS.sacred_flame.rangeFt);
        const edx = enemyTarget.grp.position.x - u.grp.position.x;
        const edz = enemyTarget.grp.position.z - u.grp.position.z;
        if (Math.sqrt(edx * edx + edz * edz) > rangeWU) { onSkip(); return; }
        if (!unitsHaveLOS(u, enemyTarget)) { onSkip(); return; }
        castSacredFlame(u, enemyTarget, onDone);
        return;
      }

      // ── Mage Armor (elf, main action, uses spell slot, persists until long rest) ─
      if (actionVal === 'mage_armor') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'mage_armor')) { onSkip(); return; }
        if (u.mageArmored)               { onSkip(); return; }
        if ((u.spellSlots ?? 0) <= 0)    { onSkip(); return; }
        activateMageArmor();
        setTimeout(onDone, 700);
        return;
      }

      // ── Magic Missile (elf, level 3, free once per combat then uses a spell slot) ─
      if (actionVal === 'magic_missile') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'magic_missile')) { onSkip(); return; }
        if (u.mmFreeUsed && (u.spellSlots ?? 0) <= 0) { onSkip(); return; }
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const rangeWU = atkRangeWU(ELF_SPELLS.magic_missile.rangeFt);
        const edx = enemyTarget.grp.position.x - u.grp.position.x;
        const edz = enemyTarget.grp.position.z - u.grp.position.z;
        if (Math.sqrt(edx * edx + edz * edz) > rangeWU) { onSkip(); return; }
        if (!unitsHaveLOS(u, enemyTarget)) { onSkip(); return; }
        castMagicMissile(u, enemyTarget, onDone);
        return;
      }

      // ── Smoke & Mirrors (halfling, level 3, twice per combat) ─────────
      if (actionVal === 'smoke_mirrors') {
        if (u.type !== 'halfling')       { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'smoke_mirrors')) { onSkip(); return; }
        if ((u.smokeUses ?? 0) <= 0)     { onSkip(); return; }
        // Already standing in a live cloud — don't burn the second charge re-throwing it.
        if (_inOwnSmoke(u))              { onSkip(); return; }
        activateSmokeMirrors();
        setTimeout(onDone, 600);
        return;
      }

      // ── Rage (bonus action — hero can still attack after) ────────────
      if (actionVal === 'rage') {
        const rageDef = UNIT_TYPES[u.type]?.rage;
        if (!rageDef || u.raging || (u.rageUses ?? 0) <= 0) { onSkip(); return; }
        u.raging          = true;
        u.rageUses--;
        turnBonusActioned = true;
        addLog(`${unitLabel(u)} enters a RAGE! (${u.rageUses} uses left)`, 'spell');
        updateCombatStatus();
        onSkip(); // bonus action; continue to next action in list
        return;
      }

      // ── Defensive Stance (bonus action — hero can still attack after) ──
      if (actionVal === 'defensive_stance') {
        if (u.type !== 'human' || turnBonusActioned || u.defStanceActive || (u.defStanceCooldown ?? 0) > 0) { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'defensive_stance')) { onSkip(); return; }
        u.defStanceActive   = true;
        u.defStanceRounds   = 3;
        u.defStanceCooldown = 4;
        turnBonusActioned   = true;
        addLog(`${unitLabel(u)} takes a Defensive Stance! +3 AC for 3 rounds`, 'move');
        showFloatingDamage(u, '🛡 +3 AC', '#aaddff');
        updateCombatStatus();
        onSkip(); // bonus action; continue to next action in list
        return;
      }

      // ── Hide (bonus action — hero can still attack after) ────────────
      if (actionVal === 'hide') {
        if (u.type !== 'halfling' || turnBonusActioned || u.stealthed || (u.hideCooldown ?? 0) > 0) { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'hide')) { onSkip(); return; }
        const ux = u.grp.position.x, uz = u.grp.position.z;
        // Smoke & Mirrors: cover from his own cloud bypasses the LOS block
        const inEnemyLOS = !_inOwnSmoke(u) && units.some(e => {
          if (e.team !== 'red' || e.hp <= 0 || !e.aggro) return false;
          return unitsHaveLOS(e, u);
        });
        if (inEnemyLOS) { onSkip(); return; }
        const dexMod = Math.floor(((UNIT_TYPES['halfling']?.abilities?.dex ?? 10) - 10) / 2);
        // Auto-success anywhere inside his own smoke cloud (no stand-still requirement).
        const autoHide = _inOwnSmoke(u);
        const stealth  = autoHide ? 20 + dexMod : Math.floor(Math.random() * 20) + 1 + dexMod;
        u.hideCooldown    = 2;
        turnBonusActioned = true;
        playSound('hide');
        if (autoHide || stealth >= 10) {
          u.hideRoll = stealth;
          setUnitStealth(u, true);
          addLog(autoHide
            ? `${unitLabel(u)} melts into his smoke — Hide auto-succeeds! (Stealth ${stealth})`
            : `${unitLabel(u)} hides! Stealth ${stealth}`, 'move');
          showFloatingDamage(u, `HIDDEN (${stealth})`, '#44ff88');
        } else {
          addLog(`${unitLabel(u)} tries to hide but fails (${stealth})`, 'move');
          showFloatingDamage(u, 'HIDE FAILED', '#ff8844');
        }
        updateCombatStatus();
        onSkip(); // bonus action; continue to next action in list
        return;
      }

      // ── Delay Action ─────────────────────────────────────────────────
      if (actionVal === 'ready_action') {
        const triggerList = getTendency(heroType, 'ready_trigger_priority');
        const triggers    = Array.isArray(triggerList) ? triggerList : [triggerList];
        // First trigger that can actually fire — not just the first one listed.
        const trigger     = triggers.find(_triggerViable) ?? triggers[0];
        _readied.set(u, trigger);
        _readiedBonusActioned.set(u, turnBonusActioned);
        _readiedAutomated.add(u);
        turnAttacked = true;
        addLog(`${unitLabel(u)} readies action (waiting: ${_READY_LABELS[trigger] ?? trigger})`, 'ready');
        buildTurnList();
        updateCombatStatus();
        onDone(); return;
      }

      // ── Sneak Attack (condition: ally adjacent to target) ────────────
      if (actionVal === 'sneak_attack') {
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        if (!UNIT_TYPES[u.type]?.sneakAttack) { onSkip(); return; }
        const adjAlly = allies.find(a => {
          const dx = a.grp.position.x - enemyTarget.grp.position.x;
          const dz = a.grp.position.z - enemyTarget.grp.position.z;
          return Math.sqrt(dx * dx + dz * dz) <= atkTriggerWU({ range: 5 });
        });
        if (!adjAlly) { onSkip(); return; }
        const edx   = enemyTarget.grp.position.x - u.grp.position.x;
        const edz   = enemyTarget.grp.position.z - u.grp.position.z;
        const eDist = Math.sqrt(edx * edx + edz * edz);
        const atks  = UNIT_TYPES[u.type]?.attacks ?? [];
        const meleeAtk = atks.find(a => a.type === 'melee' && eDist <= atkTriggerWU(a));
        const rangdAtk = atks.find(a =>
          a.type === 'ranged' &&
          atkHasQty(u, a) &&
          unitsHaveLOS(u, enemyTarget) &&
          eDist <= atkRangeWU(a.longRange ?? a.range)
        );
        const atk = meleeAtk ?? rangdAtk;
        if (!atk) { onSkip(); return; }
        _executeAttack(atk, onDone); return;
      }

      // ── Fire Bolt (elf cantrip — no spell slot, no attacks[] entry) ──
      if (actionVal === 'fire_bolt') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const atk = _fireBoltAtk();
        const edx = enemyTarget.grp.position.x - u.grp.position.x;
        const edz = enemyTarget.grp.position.z - u.grp.position.z;
        const eDist = Math.sqrt(edx * edx + edz * edz);
        if (!unitsHaveLOS(u, enemyTarget)) { onSkip(); return; }
        if (eDist > atkRangeWU(atk.range)) { onSkip(); return; }
        _executeAttack(atk, onDone); return;
      }

      // ── Named weapon attack ──────────────────────────────────────────
      if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
      const atks = UNIT_TYPES[u.type]?.attacks ?? [];
      const atk  = atks.find(a => a.name.toLowerCase().replace(/\s+/g, '_') === actionVal);
      if (!atk) { onSkip(); return; }
      const edx   = enemyTarget.grp.position.x - u.grp.position.x;
      const edz   = enemyTarget.grp.position.z - u.grp.position.z;
      const eDist = Math.sqrt(edx * edx + edz * edz);
      if (atk.type === 'melee') {
        if (eDist > atkTriggerWU(atk)) { onSkip(); return; }
      } else {
        if (!atkHasQty(u, atk)) { onSkip(); return; }
        if (!unitsHaveLOS(u, enemyTarget)) { onSkip(); return; }
        if (eDist > atkRangeWU(atk.longRange ?? atk.range)) { onSkip(); return; }
      }
      _executeAttack(atk, onDone);
    }

    // ── Iterate action_priority_in_range; fall through to no-range list ─
    function doActionPriority(cb) {
      let list = getTendency(heroType, 'action_priority_in_range');
      if (!Array.isArray(list)) list = [list];
      function tryIdx(i) {
        if (i >= list.length) { doNoRangeAction(cb); return; }
        _tryHeroAction(list[i], cb, () => tryIdx(i + 1));
      }
      tryIdx(0);
    }

    // ── Iterate action_priority_no_range ─────────────────────────────────
    function doNoRangeAction(cb) {
      let list = getTendency(heroType, 'action_priority_no_range');
      if (!Array.isArray(list)) list = [list];
      function tryIdx(i) {
        if (i >= list.length) { cb(); return; }
        const action = list[i];
        if (action === 'healing_word' || action === 'ready_action' || action === 'use_potion' ||
            action === 'bless' || action === 'mage_armor' || action === 'magic_missile' ||
            action === 'sacred_flame' || action === 'smoke_mirrors') {
          _tryHeroAction(action, cb, () => tryIdx(i + 1));
          return;
        }
        if (action === 'dodge') {
          u.dodging = true;
          addLog(`${unitLabel(u)} takes the Dodge action`, 'spell');
          updateCombatStatus();
          cb(); return;
        }
        if (action === 'dash') {
          addLog(`${unitLabel(u)} dashes`, 'move');
          cb(); return;
        }
        cb(); // end_turn or unknown
      }
      tryIdx(0);
    }

    // ── Movement ─────────────────────────────────────────────────────────
    const isAllyMode   = preferRange === 'near_ally_ranged' || preferRange === 'near_ally_melee';
    const isAllyMovTgt = movTarget?.team === 'blue';
    let dest = null;
    if (!noMove && preferRange !== 'stay' && movTarget) {
      const _remFt = (UNIT_TYPES[u.type]?.speed ?? 30) - turnMovedFt;
      // Only halve movement once already within striking range — caps how far
      // a kiting hero retreats each turn without also crippling their ability
      // to close the gap on a retreating enemy (e.g. Morvath) from far away,
      // which previously left them stuck repeatedly readying an action
      // instead of ever getting close enough to attack.
      let _movFt;
      if (preferRange === 'ranged' || preferRange === 'kite') {
        const _atks    = UNIT_TYPES[u.type]?.attacks ?? [];
        const _rangedA = _atks.find(a => a.type === 'ranged') ?? (u.type === 'elf' ? _fireBoltAtk() : null);
        const _rangeWU = _rangedA ? atkRangeWU(_rangedA.range) : 0;
        const _tdx = movTarget.grp.position.x - u.grp.position.x;
        const _tdz = movTarget.grp.position.z - u.grp.position.z;
        const _tDist = Math.sqrt(_tdx * _tdx + _tdz * _tdz);
        _movFt = (_rangeWU > 0 && _tDist <= _rangeWU) ? _remFt / 2 : undefined;
      }
      showMoveRange(u, _movFt);
      if (isAllyMode || isAllyMovTgt) {
        dest = aiPickAllyDest(u, allies, validTiles);
      } else {
        // Candidate TILES, not units — so this one keeps the coordinate LOS form. Bind the
        // two layers into the closure: the tiles all belong to u's layer (validTiles is
        // built for it), and the target sits on its own, so a hero can't score a kiting
        // tile whose "clear shot" actually runs through the cave roof.
        const _tileLOS = (kx, kz, tx2, tz2) => hasLineOfSight(
          kx, kz, tx2, tz2, u.caveLayer ?? 'surface', movTarget.caveLayer ?? 'surface');
        dest = aiPickHeroDest(u, movTarget, validTiles, preferRange, atkTriggerWU, atkRangeWU, _tileLOS,
                               u.type === 'elf' ? _fireBoltAtk() : null);
      }
      hideMoveRange();
    }

    if (dest) {
      const ox = u.grp.position.x, oz = u.grp.position.z;
      const path = findPath(ox, oz, dest.x, dest.z, u.caveLayer);
      if (!path.length) { doActionPriority(endHeroAITurn); return; }
      animatePath(u, path, () => {
        if (!combatPhase || !units.includes(u)) return;
        const mdx = u.grp.position.x - ox, mdz = u.grp.position.z - oz;
        const movedFt = Math.round(
          Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE
        ) * GRID_SQUARE_FEET;
        if (movedFt > 0) {
          turnMovedFt += movedFt;
          addLog(`${unitLabel(u)} moves ${movedFt} ft`, 'walk');
        }
        if (movTarget && units.includes(movTarget)) {
          const tdx = movTarget.grp.position.x - u.grp.position.x;
          const tdz = movTarget.grp.position.z - u.grp.position.z;
          u.grp.rotation.y = Math.atan2(tdx, tdz);
        }
        updateCombatStatus();
        setTimeout(() => doActionPriority(endHeroAITurn), PRE_ATK_MS);
      });
    } else {
      doActionPriority(endHeroAITurn);
    }
  }, THINK_MS);
}

// ── Enemy AI (helpers in js/combatAI.js) ────────────────────────────────────

function runAITurn(u) {
  endTurnBtn.disabled = true;

  // Sleeping units can't act
  if (sleepingUnits.has(u)) {
    const state = sleepingUnits.get(u);
    addLog(`${unitLabel(u)} is asleep (${state.roundsLeft} rounds left) — skips turn`, 'spell');
    setTimeout(() => { doEndTurn(); }, 350);
    return;
  }

  // Per-unit stealth: hidden until they have LOS to a hero, then reveal.
  if (u.stealthed && !_dungeonAwareEnemies.has(u)) {
    const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
    const spotted = heroes.some(h =>
      unitsHaveLOS(u, h)
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
        setTimeout(() => { doEndTurn(); }, 250);
        return;
      }
      const speedFt = UNIT_TYPES[u.type]?.speed ?? 30;
      const maxWU   = (speedFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
      const cx = u.grp.position.x, cz = u.grp.position.z;
      const tx = nearest.grp.position.x, tz = nearest.grp.position.z;
      const dx = tx - cx, dz = tz - cz;
      const dist  = Math.sqrt(dx * dx + dz * dz);
      const ratio = Math.min(maxWU / dist, 1);
      const destX = cx + dx * ratio, destZ = cz + dz * ratio;
      // If the direct path crosses a barrier or lands on an occupied square, skip movement.
      let stealthPath;
      if (crossesBarrier(cx, cz, destX, destZ)) {
        const S   = WORLD_UNITS_PER_SQUARE;
        const tnx = cx + Math.round((destX - cx) / S) * S;
        const tnz = cz + Math.round((destZ - cz) / S) * S;
        stealthPath = findPath(cx, cz, tnx, tnz);
      } else if (isOccupied(destX, destZ, u)) {
        stealthPath = [];
      } else {
        stealthPath = [{ x: destX, z: destZ }];
      }
      setTimeout(() => {
        if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
        animatePath(u, stealthPath, () => {
          setTimeout(() => { doEndTurn(); }, 250);
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
      addLog(`⚠ ${unitLabel(u)} is alerted by the heroes!`, 'alert');
      buildTurnList();
      // Fall through — enemy acts this turn
    } else {
      setTimeout(() => { doEndTurn(); }, 150);
      return;
    }
  }

  // Non-aggro roamer — follow patrol path this turn instead of attacking
  if (u.roams && !u.aggro) {
    _runRoamTurn(u);
    return;
  }

  // Dungeon environment: all enemies wait until they have LOS to a hero.
  // Exception: units already explicitly aggro (e.g. mid-combat spawns) advance immediately.
  if (activeEnv === 'dungeon' && !_dungeonAwareEnemies.has(u)) {
    if (u.aggro === true) {
      _dungeonAwareEnemies.add(u);
    } else {
      const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
      const spotted = heroes.some(h =>
        unitsHaveLOS(u, h)
      );
      if (spotted) {
        _dungeonAwareEnemies.add(u);
        u.aggro = true;
        addLog(`⚠ ${unitLabel(u)} spots the heroes!`, 'move');
        buildTurnList();
      } else {
        setTimeout(() => { doEndTurn(); }, 250);
        return;
      }
    }
  }

  // Automated mode: no one is reading each enemy's "think" beat, so run it much
  // tighter. Manual mode keeps the original pacing so enemy turns stay readable.
  const THINK_MS    = isAutomated() ? 150 : 600;    // pause before acting
  const PRE_ATK_MS  = isAutomated() ? 120 : 350;    // pause before swinging so player sees the target ring
  // Beat between the swings of a Multiattack, so two hits don't read as one.
  const MULTI_ATK_GAP_MS = isAutomated() ? 150 : 400;
  // Must outlast: anim_duration(~1030) + travel(~760) + death_window(400) ≈ 2190
  const ATK_RESOLVE = 2200;
  const END_PAUSE   = isAutomated() ? 100 : 300;    // breather before advancing to next turn

  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) {
      endTurnBtn.disabled = false;
      return;
    }

    const target = aiPickTarget(u, units, unitsHaveLOS);
    if (!target) {
      setTimeout(doEndTurn, END_PAUSE);
      return;
    }

    function endAITurn() {
      setTimeout(() => { doEndTurn(); }, END_PAUSE);
    }

    // Multiattack — UNIT_TYPES[type].multiattack is an ordered list of attack NAMES the
    // creature makes in ONE action, each its own to-hit roll.
    //
    // Per D&D, an action containing more than one weapon attack lets the creature BREAK
    // UP ITS MOVEMENT between those attacks. So the ettin can walk to hero A, swing its
    // battleaxe, walk on past A to hero B, and swing its morningstar. Between swings we
    // therefore re-run the ordinary target-selection algorithm (aiPickTarget) — it may
    // well pick the same hero again, in which case it simply swings twice — and if the
    // new pick is out of reach we spend whatever movement is LEFT closing on it.
    //
    // That works because showMoveRange() recomputes the reachable set from
    // `speed - turnMovedFt` at the unit's CURRENT position, and moveToAndThen() has
    // already banked the first leg into turnMovedFt. With no movement left it clears
    // validTiles outright, so aiPickDest returns null and no free steps can leak.
    //
    // Only fires when the AI chose a MELEE opener — a brute forced into a thrown/ranged
    // fallback doesn't get the full flurry. A creature with no `multiattack` list is
    // unaffected: one attack, no re-targeting, no mid-action movement.
    function doAttack(cb) {
      if (!units.includes(target)) { cb(); return; }
      const opener = aiGetAttack(u, target, turnAttacked, atkHasQty, atkTriggerWU, atkRangeWU, unitsHaveLOS);
      if (!opener) { cb(); return; }

      const def   = UNIT_TYPES[u.type] ?? {};
      const names = def.multiattack;
      let seq = [opener];
      if (Array.isArray(names) && names.length && opener.type === 'melee') {
        const resolved = names
          .map(n => (def.attacks ?? []).find(a => a.name === n))
          .filter(Boolean);
        if (resolved.length) seq = resolved;
      }

      // The whole flurry is ONE action, so the flag is set once, up front.
      turnAttacked = true;
      hideUndoBtn();
      updateCombatStatus();

      let i   = 0;          // index into seq
      let foe = target;     // first swing lands on the AI's standard pick

      // The attacker itself can die mid-flurry: _checkDelayedTriggers doesn't merely
      // test triggers, it lets readied heroes take their reaction attacks. Without this
      // the corpse would keep swinging. Single-attack creatures never had a second swing
      // in which to hit that window, which is why this could not happen before.
      const gone = () => !combatPhase || !units.includes(u) || u.hp <= 0;

      const swing = () => {
        if (gone() || !units.includes(foe) || foe.hp <= 0) { cb(); return; }
        const atk = seq[i++];
        showAttackTargets(u);        // briefly lights the orange ring on the target
        setTimeout(() => {
          hideAttackTargets();
          const hpBefore = foe.hp;
          const victim   = foe;
          performAttack(u, victim, atk, () => {
            _checkDelayedTriggers('ally_damaged', victim, victim.hp < hpBefore, () => {
              if (i < seq.length) setTimeout(nextAttack, MULTI_ATK_GAP_MS);
              else                cb();
            });
          });
        }, PRE_ATK_MS);
      };

      // Between swings: re-pick a target, and close on it with the movement that's left.
      const nextAttack = () => {
        if (gone() || i >= seq.length) { cb(); return; }

        const t = aiPickTarget(u, units, unitsHaveLOS);
        if (!t) { cb(); return; }           // nobody left to hit
        foe = t;

        const atk  = seq[i];
        const dx   = t.grp.position.x - u.grp.position.x;
        const dz   = t.grp.position.z - u.grp.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (atk.type !== 'melee' || dist <= atkTriggerWU(atk)) { swing(); return; }  // already in reach

        showMoveRange(u);                  // remaining budget, from where it now stands
        const dest = aiPickDest(u, t, validTiles, atkTriggerWU, atkRangeWU);
        hideMoveRange();
        if (!dest) { cb(); return; }       // no movement left, or can't get there

        moveToAndThen(dest, () => {
          if (gone() || !units.includes(t) || t.hp <= 0) { cb(); return; }
          const ndx = t.grp.position.x - u.grp.position.x;
          const ndz = t.grp.position.z - u.grp.position.z;
          // Closed the gap but still short — the movement is spent, so the flurry ends.
          if (Math.sqrt(ndx * ndx + ndz * ndz) > atkTriggerWU(atk)) { cb(); return; }
          setTimeout(swing, PRE_ATK_MS);
        }, t);
      };

      swing();   // runPaths has already walked it into reach of the first target
    }

    // Helper: move to dest then call cb. `faceUnit` is who to turn toward on arrival —
    // defaults to the turn's target, but a Multiattack leg mid-flurry may be chasing a
    // freshly re-picked hero instead.
    function moveToAndThen(dest, cb, faceUnit = target) {
      const ox = u.grp.position.x, oz = u.grp.position.z;
      const path = findPath(ox, oz, dest.x, dest.z, u.caveLayer);
      animatePath(u, path, () => {
        const mdx = dest.x - ox, mdz = dest.z - oz;
        const movedFt = Math.round(
          Math.sqrt(mdx * mdx + mdz * mdz) / WORLD_UNITS_PER_SQUARE
        ) * GRID_SQUARE_FEET;
        turnMovedFt += movedFt;
        addLog(`${unitLabel(u)} moves ${movedFt} ft`, 'walk');
        if (faceUnit && units.includes(faceUnit)) {
          const fdx = faceUnit.grp.position.x - u.grp.position.x;
          const fdz = faceUnit.grp.position.z - u.grp.position.z;
          u.grp.rotation.y = Math.atan2(fdx, fdz);
        }
        updateCombatStatus();
        _checkDelayedTriggers('enemy_moved', u, false, cb);
      });
    }

    // ── Spellcaster AI (e.g. Morvath) ────────────────────────────────────────
    // Spell-first, range-keeping, kiting behavior. Activated by aiStyle:'spellcaster'.
    function doSpellcastAttack(cb) {
      if (!units.includes(target)) { cb(); return; }
      const atk = aiGetSpellcasterAttack(u, target, turnAttacked, atkTriggerWU, atkRangeWU, unitsHaveLOS);
      if (!atk) { cb(); return; }
      showAttackTargets(u);
      setTimeout(() => {
        hideAttackTargets();
        turnAttacked = true;
        hideUndoBtn();
        updateCombatStatus();
        const hpBefore = target.hp;
        performAttack(u, target, atk, () => {
          _checkDelayedTriggers('ally_damaged', target, target.hp < hpBefore, cb);
        });
      }, PRE_ATK_MS);
    }

    function runSpellcasterPaths() {
      if (!combatPhase || !units.includes(u)) return;
      const slots = u.spellSlots ?? 0;
      const _def  = UNIT_TYPES[u.type] ?? {};
      const atks  = _def.attacks ?? [];
      const meleeA   = atks.find(a => a.type === 'melee');
      const aoeSaveA = atks.find(a => a.type === 'aoe_save');
      const meleeTrigger = meleeA   ? atkTriggerWU(meleeA)       : 0;
      const spellRangeWU = aoeSaveA ? atkRangeWU(aoeSaveA.range)  : 0;
      const _dx  = target.grp.position.x - u.grp.position.x;
      const _dz  = target.grp.position.z - u.grp.position.z;
      const dist = Math.sqrt(_dx * _dx + _dz * _dz);
      const inMelee      = meleeTrigger > 0 && dist <= meleeTrigger;
      const inSpellRange = spellRangeWU  > 0 && dist <= spellRangeWU;

      // No spell slots — fall back to close-and-claw
      if (slots === 0) {
        if (inMelee) { doSpellcastAttack(endAITurn); return; }
        showMoveRange(u);
        const dest = aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU);
        hideMoveRange();
        if (!dest) { endAITurn(); return; }
        moveToAndThen(dest, () => setTimeout(() => doSpellcastAttack(endAITurn), PRE_ATK_MS));
        return;
      }

      // Has slots — spell-first logic
      if (inMelee) {
        // Hero is too close. Try to back away to ideal spell range before casting.
        showMoveRange(u);
        const escapeDest = aiPickSpellcasterDest(u, target, validTiles, atkTriggerWU, atkRangeWU);
        hideMoveRange();
        if (escapeDest) {
          const eDx = target.grp.position.x - escapeDest.x;
          const eDz = target.grp.position.z - escapeDest.z;
          const eDist = Math.sqrt(eDx * eDx + eDz * eDz);
          if (eDist > meleeTrigger) {
            // Can escape melee — move away then cast
            moveToAndThen(escapeDest, () => setTimeout(() => doSpellcastAttack(endAITurn), PRE_ATK_MS));
            return;
          }
        }
        // Cornered — cast from current position
        doSpellcastAttack(endAITurn);
        return;
      }

      if (inSpellRange) {
        // Already at ideal range — cast immediately
        doSpellcastAttack(endAITurn);
        return;
      }

      // Out of spell range — move toward ideal position, then cast if now in range
      showMoveRange(u);
      const dest = aiPickSpellcasterDest(u, target, validTiles, atkTriggerWU, atkRangeWU);
      hideMoveRange();
      if (!dest) { endAITurn(); return; }
      moveToAndThen(dest, () => setTimeout(() => doSpellcastAttack(endAITurn), PRE_ATK_MS));
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
      const rangedAtk = aiGetAttack(u, target, turnAttacked, atkHasQty, atkTriggerWU, atkRangeWU, unitsHaveLOS);
      if (rangedAtk?.type === 'ranged') {
        showAttackTargets(u);
        setTimeout(() => {
          hideAttackTargets();
          turnAttacked = true;
          hideUndoBtn();
          updateCombatStatus();
          const hpBefore = target.hp;
          performAttack(u, target, rangedAtk, () => {
            const continueAfterRanged = () => {
              if (!units.includes(u) || !units.includes(target)) { endAITurn(); return; }
              showMoveRange(u);
              const dest = aiPickDestTowardMelee(u, target, validTiles, atkTriggerWU);
              hideMoveRange();
              if (!dest) { endAITurn(); return; }
              moveToAndThen(dest, endAITurn);
            };
            _checkDelayedTriggers('ally_damaged', target, target.hp < hpBefore, continueAfterRanged);
          });
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

    if (UNIT_TYPES[u.type]?.aiStyle === 'spellcaster') {
      runSpellcasterPaths();
    } else {
      runPaths();
    }
  }, THINK_MS);
}

// ── Spell-bar button handler (called from ui.js click delegation) ────────────
export function triggerSpellBarAction(spellKey) {
  if (!combatPhase || isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;

  const sp = ELF_SPELLS[spellKey] ?? SPELLS[spellKey];
  if (!sp) return;

  if (u.type === 'elf') {
    handleElfSpellBtnClick(spellKey);
  } else {
    handleSpellBtnClick(spellKey);
  }
}
