import * as THREE from 'three';
import { scene, camera, renderer, ground, divider, focusCameraOnUnit, setFollowUnit } from './scene.js';
import { units, heroRoster, setUnitWalking, playUnitAttackAnim, playUnitDeathAnim, setUnitStealth, setUnitSneaking, roamPathOf, roamGroupKey } from './units.js';
import { summonFamiliar, isFamiliarSummoned, getFamiliar, startFamiliarDeath, familiarHelpGesture, enterCombatFamiliar, startFamiliarDive } from './familiar.js';
import { playWebEffect } from './webEffect.js';
import { playPoisonEffect } from './poisonEffect.js';
import { playFireEffect } from './fireEffect.js';
import { playIceEffect } from './iceEffect.js';
import { triggerHealingWordOOC, canHealingWordOOC } from './healingWordOOC.js';
import { COLORS, INTERACTION, UNIT_TYPES, COMBAT, HERO_RING_COLORS,
         WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET, ADJACENT_WU, ENEMY_CR, GROUND_SIZE,
         rageUsesForLevel, rageMitigationForLevel, precisionHitBonusForLevel,
         rageDamageForLevel, sneakAttackDiceForLevel } from './constants.js';
import { getTerrainHeight, getGroundHeight } from './terrain.js';
import { roll, showRoll, clearRollFeed, parseDiceFormula } from './dice.js';
import { playMagicMissileEffect }  from './magicmissile.js';
import { playSacredFlameEffect }   from './sacredflame.js';
import { spawnSmokeCloud }         from './smokemirrors.js';
import { propPositions, losBlockerMeshes, getSurfaceHeight, activeEnv, barrierSegments } from './environments.js';
import { showSelectionHighlight, hideSelectionHighlight } from './selectionHighlight.js';
import { affixTotal, abilityModOf, applyHeal, speedOf } from './affixes.js';
import { SPELLS, ELF_SPELLS, LEVEL_SPELLS, STARTING_SPELLS, isAbilityUnlocked, blessedUnits, applyBless, clearBless, tickBless, initSpellSlots, concentrating, concentratingSpell,
         hasSpellSlot, spendSpellSlot, totalSpellSlots, spellLevelOf, syncSlotsToLevel } from './spells.js';
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
import { combatSpeed, spd, AUTO_COMBAT_SPEED } from './combatSpeed.js';

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

// ── Frightened state (Turn Undead) ───────────────────────────────────────────
// Maps frightened unit → { roundsLeft, turnedBy, fearEl }.
//
// Deliberately the SAME shape as sleepingUnits above: same round-rollover tick, same
// wake-on-damage rule, same teardown sweep. Two condition idioms in one file would drift.
// Difference from sleep: a frightened unit still TAKES its turn — it is Incapacitated (no
// action) but it moves, fleeing from whoever turned it (see the enemy-turn branch).
export const frightenedUnits = new Map();

function applyFear(u, rounds, source) {
  if (frightenedUnits.has(u)) return;
  const fearEl = document.createElement('div');
  fearEl.className = 'zzz-label fear-label';
  fearEl.textContent = '😱';
  document.getElementById('app').appendChild(fearEl);
  frightenedUnits.set(u, { roundsLeft: rounds, turnedBy: source, fearEl });
}

export function clearFear(u, reason) {
  const state = frightenedUnits.get(u);
  if (!state) return;
  state.fearEl?.remove();
  frightenedUnits.delete(u);
  if (reason === 'damage') {
    showFloatingDamage(u, '💢 RALLIES', '#ffdd88');
    addLog(`  ${unitLabel(u)} is struck and shakes off its fear!`, 'spell');
  }
}

function tickFear() {
  const done = [];
  for (const [u, state] of frightenedUnits) {
    state.roundsLeft--;
    // Ends early if the turner is dead or gone — nothing left to flee from.
    if (state.roundsLeft <= 0 || !state.turnedBy || state.turnedBy.hp <= 0) done.push(u);
  }
  done.forEach(u => {
    addLog(`${unitLabel(u)} is no longer turned`, 'spell');
    clearFear(u);
  });
}

export function trackFearUI() {
  for (const [u, state] of frightenedUnits) {
    if (!state.fearEl) continue;
    _sv.set(u.anchor.x, u.anchor.y + 1.0, u.anchor.z).project(camera);
    if (_sv.z >= 1) { state.fearEl.style.display = 'none'; continue; }
    const cw = renderer.domElement.clientWidth, ch = renderer.domElement.clientHeight;
    state.fearEl.style.display = 'block';
    state.fearEl.style.left    = ((_sv.x * 0.5 + 0.5) * cw) + 'px';
    state.fearEl.style.top     = ((-_sv.y * 0.5 + 0.5) * ch) + 'px';
  }
}

// "Any damage ends it" — the rule Sleep and Turn Undead BOTH advertise. Call this from every
// path that reduces a unit's HP. It used to be two open-coded lines repeated at the three
// _executeAttack-family sites only, which left the direct-damage spells (Magic Missile, Sacred
// Flame, Burning Hands) writing `hp -=` straight past it: a slept or turned enemy hit by a
// spell simply kept sleeping. One helper so a future damage path has one thing to remember.
export function wakeOnDamage(target) {
  if (!target) return;
  if (sleepingUnits.has(target))   wakeUnit(target, 'damage');
  if (frightenedUnits.has(target)) clearFear(target, 'damage');
}

// ── Sanctuary state ──────────────────────────────────────────────────────────
// Maps warded unit → { roundsLeft }. Enforced in enemy target selection via
// _sanctuaryBlocks(attacker, target), NOT on the damage roll.
export const sanctuaryUnits = new Map();

function applySanctuary(u, rounds) { sanctuaryUnits.set(u, { roundsLeft: rounds }); }

export function clearSanctuary(u, reason) {
  if (!sanctuaryUnits.has(u)) return;
  sanctuaryUnits.delete(u);
  if (reason === 'attacked') {
    showFloatingDamage(u, 'SANCTUARY ENDS', '#88aacc');
    addLog(`  ${unitLabel(u)} attacks — their Sanctuary ends.`, 'spell');
  }
}

function tickSanctuary() {
  const done = [];
  for (const [u, state] of sanctuaryUnits) {
    state.roundsLeft--;
    if (state.roundsLeft <= 0) done.push(u);
  }
  done.forEach(u => {
    addLog(`${unitLabel(u)}'s Sanctuary fades`, 'spell');
    clearSanctuary(u);
  });
}

// True when `attacker` may NOT attack `target` this turn because Sanctuary held. The save is
// rolled once per attacker per attempt; a passed save lets that attacker through for the
// attempt it was rolled for, exactly like the 5e wording.
function _sanctuaryBlocks(attacker, target) {
  if (!sanctuaryUnits.has(target)) return false;
  const spell  = SPELLS.sanctuary;
  const wisMod = abilityModOf(attacker, 'wis');
  const saved  = rollSave(wisMod, spell.saveDC, 'normal',
                          affixTotal(attacker, 'saving_throw_pct')).isSave;
  if (saved) {
    addLog(`  ${unitLabel(attacker)} pushes through ${unitLabel(target)}'s Sanctuary (WIS save)`, 'combat');
    return false;
  }
  addLog(`  ${unitLabel(attacker)} cannot bring itself to attack ${unitLabel(target)} — Sanctuary holds.`, 'spell');
  return true;
}

// aiPickTarget wrapper that honours Sanctuary. Kept HERE rather than inside combatAI.js
// because that module is deliberately pure (no combat-module state) and the ward map plus
// rollSave both live in this file.
//
// Order matters: pick normally FIRST, so an enemy that would have gone for someone else is
// never told about the ward at all. Only when the roll lands on a warded ally do we make it
// save; a failure re-picks from the unwarded pool, and if every living hero is warded the
// enemy has no legal target and forfeits the attack — which is the spell working, not a bug.
function _aiPickTargetSanctuaryAware(u) {
  const first = aiPickTarget(u, units, unitsHaveLOS);
  if (!first || !sanctuaryUnits.has(first)) return first;
  if (!_sanctuaryBlocks(u, first)) return first;
  const unwarded = units.filter(h => !sanctuaryUnits.has(h));
  return aiPickTarget(u, unwarded, unitsHaveLOS);
}

// ── Surprise indicator ────────────────────────────────────────────────────────
// A closed eye marks a unit that hasn't noticed the fight yet: it appears the moment
// _determineSurprise sets `surprised` and vanishes when that unit's turn comes up and it loses it.
//
// Inline SVG rather than an emoji because there IS no closed-eye emoji — the near misses (🙈 a
// monkey, 😑 a face) all read as something else. `currentColor` lets the ONE definition serve both
// places it's needed: the overhead label and the initiative row, each colouring it from its own CSS.
export const SURPRISE_EYE_SVG =
  '<svg class="surprise-eye" viewBox="0 0 24 15" aria-hidden="true">' +
  '<path d="M2 4.5 Q12 13.5 22 4.5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>' +
  '<path d="M5.2 9.2 L3.6 12.2 M12 11.4 L12 14.2 M18.8 9.2 L20.4 12.2" ' +
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
  '</svg>';

// unit → overhead icon element. Built lazily and torn down the frame a unit stops being surprised,
// so nothing has to remember to clean up at the places `surprised` is cleared.
//
// Deliberately modelled on updateReadyIcons (the ⚡ armed-action icon), NOT on the sleep Zzz: it
// projects the unit's BARE anchor and nudges in SCREEN space, so the eye stays pinned just above
// the floating health bar at any camera distance. A world-space Y offset (what Zzz uses) drifts
// away from the bar as you zoom, because the bar itself only nudges by a few CSS px.
const _surpriseIconEls = new Map();

export function trackSurpriseUI() {
  // Sweep units that left units[] entirely — a surprised enemy can be killed during the surprise
  // round before it ever gets a turn, so it never reaches the `!active` branch below.
  for (const [u, el] of _surpriseIconEls) {
    if (!units.includes(u)) { el.remove(); _surpriseIconEls.delete(u); }
  }

  const cw = renderer.domElement.clientWidth, ch = renderer.domElement.clientHeight;
  for (const u of units) {
    const active = !!u.surprised && u.hp > 0;
    let el = _surpriseIconEls.get(u);

    if (!active) {
      if (el) { el.remove(); _surpriseIconEls.delete(u); }
      continue;
    }

    if (!el) {
      el = document.createElement('div');
      el.className = 'unit-surprise-icon';
      el.innerHTML = SURPRISE_EYE_SVG;
      document.getElementById('app').appendChild(el);
      _surpriseIconEls.set(u, el);
    }

    // Same anchor + screen-space nudge as the ⚡ ready icon, so both sit on the same line above
    // the bar. They can't collide in practice: a ready action is armed on a hero's own turn,
    // and surprise is spent the moment that turn begins.
    _sv.set(u.anchor.x, u.anchor.y, u.anchor.z).project(camera);
    if (_sv.z > 1) { el.style.display = 'none'; continue; }   // behind the camera
    el.style.display = 'block';
    el.style.left = ((_sv.x * 0.5 + 0.5) * cw) + 'px';
    el.style.top  = ((-_sv.y * 0.5 + 0.5) * ch - 22) + 'px';
  }
}

// Caster-centred particle burst. Written for Sleep (purple) but for a long while ONLY
// Burning Hands called it, so a fire spell threw violet motes and Sleep had no VFX at all.
// Colour is a parameter now and each caster passes its own; the default keeps Sleep's.
function playSleepEffect(caster, color = 0xcc55ff) {
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
    color, size: 0.30, transparent: true, opacity: 0.92,
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
// The active/range/hover rings drape their vertices over the ground via getSurfaceHeight,
// which also floats them on a water plane where a zone has one.
function _ringSurfaceH(x, z) {
  return getSurfaceHeight(x, z);
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

// The band between normal range and longRange, where the shot still connects but is made at
// DISADVANTAGE (_executeAttack derives that from distance on its own). Red so it reads as a
// warning against the blue normal-range ring, and dimmer so the blue one stays the primary read.
export const longRangeRing = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    color: 0xCC3344, side: THREE.DoubleSide, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending,
  })
);
longRangeRing.frustumCulled = false;
longRangeRing.renderOrder   = 3;
longRangeRing.visible = false;
scene.add(longRangeRing);

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

// How far a CASTER can actually threaten right now, in feet: the longest-ranged offensive
// spell they have unlocked AND can currently pay for (user's rule, 2026-07-18 — Rasec and
// Leugren both).
//
// ⚠ "If no prepared spell, use their furthest cantrip" needs NO separate branch: hasSpellSlot
// returns true for level 0, so cantrips are always in the pool. Once the leveled spells are
// spent they're the only candidates left, and the max naturally falls back to them.
//
// Heals are excluded — they define reach to an ALLY, not a threat range, and a 60 ft Cure
// Wounds would inflate the ring around an enemy the cleric can't actually hurt from there.
function _casterReachFt(hero) {
  const pool = hero?.type === 'dwarf' ? SPELLS : hero?.type === 'elf' ? ELF_SPELLS : null;
  if (!pool) return 0;
  let maxFt = 0;
  for (const sp of Object.values(pool)) {
    if (sp.rangeFt == null || sp.healDice !== undefined) continue;
    if (!isAbilityUnlocked(hero.type, hero.level, sp.key)) continue;
    if (!hasSpellSlot(hero, spellLevelOf(sp.key))) continue;   // level 0 always passes
    if (sp.rangeFt > maxFt) maxFt = sp.rangeFt;
  }
  return maxFt;
}

function showRangeRings(u) {
  const def    = UNIT_TYPES[u.type] ?? {};
  const atks   = attacksOf(u);
  const meleeA = atks.find(a => a.type === 'melee');
  // The ranged ring shows how far this unit can THREATEN, whichever way reaches further:
  // a ranged weapon (including a thrown dart from the ammo slot) or, for Rasec/Leugren, their
  // furthest available spell. Taking the max is the point — a 20 ft dart must not shrink
  // Rasec's 90 ft Fire Bolt ring just because he happens to have darts equipped.
  const rangdA   = atks.find(a => a.type === 'ranged');
  const reachFt  = Math.max(rangdA ? rangdA.range : 0, _casterReachFt(u));
  const ux = u.grp.position.x, uz = u.grp.position.z;

  if (meleeA) {
    meleeRangeRing.geometry.dispose();
    meleeRangeRing.geometry = makeConformingRingGeo(ux, uz, atkTriggerWU(meleeA));
    meleeRangeRing.position.set(ux, 0, uz);
    meleeRangeRing.visible = true;
  } else {
    meleeRangeRing.visible = false;
  }

  if (reachFt > 0) {
    rangedRangeRing.geometry.dispose();
    rangedRangeRing.geometry = makeConformingRingGeo(ux, uz, projRangeWU(reachFt, u));
    rangedRangeRing.position.set(ux, 0, uz);
    rangedRangeRing.visible = true;
  } else {
    rangedRangeRing.visible = false;
  }

  // Long-range band. Only drawn when it actually sits OUTSIDE the blue ring: `reachFt` takes the
  // max of the weapon and the caster's furthest spell, so Rasec's 90 ft Fire Bolt already swallows
  // a 20/30 ft thrown dart — drawing a 30 ft "long range" ring inside a 90 ft one would claim a
  // penalty band where there is none. Milo (40/80) and Gobo (20/30, no spells) are the real cases.
  const longFt = rangdA?.longRange ?? 0;
  if (longFt > reachFt) {
    longRangeRing.geometry.dispose();
    longRangeRing.geometry = makeConformingRingGeo(ux, uz, projRangeWU(longFt, u));
    longRangeRing.position.set(ux, 0, uz);
    longRangeRing.visible = true;
  } else {
    longRangeRing.visible = false;
  }
}

function hideRangeRings() {
  meleeRangeRing.visible  = false;
  rangedRangeRing.visible = false;
  longRangeRing.visible   = false;
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
  if (longRangeRing.visible) {
    updateConformingRingGeo(longRangeRing, x, z);
    longRangeRing.position.set(x, 0, z);
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
// Gloves action economy: extra WEAPON attacks (attack_speed affix) / SPELL casts (cast_speed affix)
// the active hero may take BEYOND their normal action this turn. Reset each turn in activateTurn from
// the acting unit's gear. Instead of an action immediately setting turnAttacked (locking the hero out),
// _spendHeroAction consumes an extra of the matching type first — so with cast_speed 1 a hero can cast
// Fire Bolt AND then Magic Missile (two DIFFERENT spells, freely chosen), and only the final action
// (no extras left) actually sets turnAttacked. Non-gloved heroes have 0 extras → first action locks,
// exactly as before. The availability gates already read turnAttacked, so nothing else needs changing.
let _extraAttacksLeft = 0;
let _extraCastsLeft   = 0;
function _spendHeroAction(type) {
  if (type === 'weapon' && _extraAttacksLeft > 0) { _extraAttacksLeft--; return; }
  if (type === 'spell'  && _extraCastsLeft  > 0) { _extraCastsLeft--;  return; }
  turnAttacked = true;
}
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
  const path = findPath(u.grp.position.x, u.grp.position.z, x, z);
  animatePath(u, path, () => {
    turnMovedFt = movedFt;
    addLog(`${unitLabel(u)} undoes move`, 'walk');
    heroMode = 'move';
    const remaining = (speedOf(u)) - turnMovedFt;
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
function crossesBarrier(ax, az, bx, bz) {
  // AABB of the movement step — used to cheaply reject barriers that can't possibly cross it.
  const sMinX = ax < bx ? ax : bx, sMaxX = ax < bx ? bx : ax;
  const sMinZ = az < bz ? az : bz, sMaxZ = az < bz ? bz : az;
  for (const s of barrierSegments) {
    // Bounding-box reject before the division-heavy intersection solve. A step spans one grid
    // square while barriers are scattered across the whole map, so on a zone with hundreds of
    // segments (Warrens: 500+) this rejects almost all of them per pathfinding cell — the
    // difference between a snappy path search and the multi-second freezes findPath warns about.
    if ((s.x1 < s.x2 ? s.x2 : s.x1) < sMinX || (s.x1 < s.x2 ? s.x1 : s.x2) > sMaxX ||
        (s.z1 < s.z2 ? s.z2 : s.z1) < sMinZ || (s.z1 < s.z2 ? s.z1 : s.z2) > sMaxZ) continue;
    const rx = bx - ax, rz = bz - az;
    const sx = s.x2 - s.x1, sz = s.z2 - s.z1;
    const denom = rx * sz - rz * sx;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    const qpx = s.x1 - ax, qpz = s.z1 - az;
    const t = (qpx * sz - qpz * sx) / denom;
    const u = (qpx * rz - qpz * rx) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    return true;   // the step's segment intersects this barrier — blocked
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
function _terrainBlocksLOS(ax, az, tx, tz, fromY, toY) {
  for (let i = 1; i < LOS_STEPS; i++) {
    const t  = i / LOS_STEPS;
    const th = getGroundHeight(ax + (tx - ax) * t, az + (tz - az) * t);
    if (th > fromY + (toY - fromY) * t) return true;
  }
  return false;
}

// A pure terrain + prop line-of-sight test between two world points.
export function hasLineOfSight(ax, az, tx, tz) {
  if (window.__pathProfile) window.__losCount = (window.__losCount || 0) + 1;   // TEMP LOS counter
  const dx = tx - ax, dz = tz - az;
  if (dx * dx + dz * dz === 0) return true;

  const fromY = getGroundHeight(ax, az) + LOS_EYE_H;
  const toY   = getGroundHeight(tx, tz) + LOS_EYE_H;

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

// LOS between two UNITS — the form to use anywhere both ends are units (attack validity,
// AI targeting, readied triggers, hide checks).
export function unitsHaveLOS(a, b) {
  if (!a?.grp || !b?.grp) return false;
  return hasLineOfSight(
    a.grp.position.x, a.grp.position.z,
    b.grp.position.x, b.grp.position.z,
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

// ── Damage mitigation ─────────────────────────────────────────────────────────
// The fraction of incoming damage `target` shrugs off, summed across every source.
//
// RAGE MITIGATES ALL DAMAGE — not just weapon hits (user's rule, 2026-07-16). Anything
// that reduces a hero's HP must come through here. Until 2026-07-16 the calc was inlined
// in performAttack alone, so Morvath's AoE and poison riders bypassed Rage entirely and
// hit a raging Gobo for full.
//
// Stacking is ADDITIVE: rage 10% + a 4% mitigation hat = 14%, applied as ONE multiply.
// Not chained multipliers (×0.90 then ×0.96 = 13.6%) — that's a different, worse number.
// The Head "Damage mitigation %" loot affix sums in here when it lands; see
// docs/loot-affix-design.md → Mitigation stacking.
function damageMitigationOf(target) {
  let mit = 0;
  if (target?.raging && UNIT_TYPES[target.type]?.rage) mit += rageMitigationForLevel(target.level);
  // Gear. affixTotal sums the stat across every EQUIPPED item, so this one line covers any
  // slot that ever rolls mitigation — and because every damage path already comes through
  // here, gear mitigation applies to weapon hits, AoE and poison alike, for free.
  mit += affixTotal(target, 'mitigation_pct') / 100;
  return mit;
}

// Apply mitigation to a raw damage number. Floors at 1: a blow that lands always hurts,
// however deep mitigation stacks — which is also the backstop against additive runaway.
function applyMitigation(target, raw) {
  const mit = damageMitigationOf(target);
  return mit > 0 ? Math.max(1, Math.round(raw * (1 - mit))) : raw;
}

// Scale a SPELL's damage by the caster's gear. Rounds UP (user's rule, 2026-07-16) — which
// matters more than it looks: spell damage is a percentage of a SMALL number (Fire Bolt is
// 1d10, avg 5.5), so +6% of 7 is 7.42 and would round back to 7 and do literally nothing.
// Ceil means a rolled bonus always moves the number.
//
// A percentage, not a flat bonus, precisely because of Magic Missile: it fires 4 darts rolled
// separately, so a flat +2 would force a per-dart-vs-per-cast decision worth 4x. A % scales
// whatever came out and leaves the dart breakdown in the log honest.
function applySpellDamage(caster, raw) {
  const pct = affixTotal(caster, 'spell_damage_pct');
  return pct > 0 ? Math.ceil(raw * (1 + pct / 100)) : raw;
}

// Scale a WEAPON attack's damage by the attacker's gear (main-hand weapon_damage_pct). The exact
// mirror of applySpellDamage — same ceil rule, same reason — on the other side of the atk.spellKey
// split, so a hit is scaled by one of the two and never both.
//
// "Melee or ranged attacks" (user, 2026-07-18): both weapon types, no spells. Sneak Attack sits
// OUTSIDE this on purpose — the rogue's dice are a class feature with its own level curve, not
// weapon output, exactly as they sit outside applySpellDamage.
function applyWeaponDamage(attacker, raw) {
  const pct = affixTotal(attacker, 'weapon_damage_pct');
  return pct > 0 ? Math.ceil(raw * (1 + pct / 100)) : raw;
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
    const atks = attacksOf(u);
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
// Range at which a HERO's RANGED weapon / attack SPELL reaches, INCLUDING the ammo `projectile_range`
// bonus (stored in squares → feet). Use this instead of atkRangeWU at hero ranged/spell range checks;
// melee stays on atkRangeWU / atkTriggerWU so the bonus never extends melee reach. `unit` null → no
// bonus (safe for enemy paths that call it defensively).
function projRangeWU(rangeFt, unit) {
  const bonus = unit ? affixTotal(unit, 'projectile_range') * GRID_SQUARE_FEET : 0;
  return atkRangeWU(rangeFt + bonus);
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

function findPath(sx, sz, tx, tz) {
  const _pp0 = window.__pathProfile ? performance.now() : 0;   // TEMP path profiler
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
      if (crossesBarrier(x, z, nx, nz)) continue;
      parent.set(k, { x, z });
      queue.push({ x: nx, z: nz });
    }
  }

  if (window.__pathProfile) {
    const ms = performance.now() - _pp0;
    if (ms > 15) console.log(`[path] findPath ${ms.toFixed(0)}ms explored=${queue.length} reached=${parent.has(key(tx,tz))} props=${propPositions.length} barriers=${barrierSegments.length}`);
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
  let startY  = getGroundHeight(startX, startZ);
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
    const t       = dist > 0 ? Math.min(1, (elapsed * MOVE_SPEED * combatSpeed()) / dist) : 1;
    const endY    = getGroundHeight(target.x, target.z);

    unit.grp.position.x = startX + dx * t;
    unit.grp.position.z = startZ + dz * t;
    unit.grp.position.y = startY + (endY - startY) * t + flyY;
    unit.anchor.x = unit.grp.position.x;
    unit.anchor.z = unit.grp.position.z;
    unit.anchor.y = unit.grp.position.y + unit.anchorY;
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
function _bfsReachable(ux, uz, maxDist, excludeUnit) {
  const _pp0 = window.__pathProfile ? performance.now() : 0;   // TEMP path profiler
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
      if (crossesBarrier(x, z, nx, nz)) continue;
      dist.set(k, nd);
      // Units can pass THROUGH occupied squares but cannot stop on one.
      if (!isOccupied(nx, nz, excludeUnit)) result.add(k);
      queue.push({ x: nx, z: nz, d: nd });
    }
  }
  if (window.__pathProfile) {
    const ms = performance.now() - _pp0;
    if (ms > 15) console.log(`[path] _bfsReachable ${ms.toFixed(0)}ms explored=${queue.length} maxDist=${maxDist.toFixed(1)} props=${propPositions.length}`);
  }
  return result;
}

function showMoveRange(u, overrideFt) {
  if (_saveImmobilizes(u)) { hideMoveRange(); return; }   // held by an unbroken action-save — speed 0
  const remainFt = overrideFt !== undefined ? overrideFt : speedOf(u) - turnMovedFt;
  if (remainFt <= 0) { hideMoveRange(); return; }

  const maxDist = (remainFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const ux = u.grp.position.x, uz = u.grp.position.z;

  validTiles.clear();
  for (const k of _bfsReachable(ux, uz, maxDist, u)) validTiles.add(k);

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
  const atks = attacksOf(u);
  const meleeA = atks.find(a => a.type === 'melee');
  const rangdA = atks.find(a => a.type === 'ranged');
  if (!meleeA && !rangdA) return;

  const enemies = units.filter(e => e.team !== u.team);
  let ri = 0;

  for (const enemy of enemies) {
    const dx   = enemy.grp.position.x - u.grp.position.x;
    const dz   = enemy.grp.position.z - u.grp.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Three bands, nearest first: melee (orange) → normal ranged (teal) → LONG range (red).
    //
    // The long band was missing entirely, so a foe past normal range got no ring — and since
    // atkTargets is what the click handler reads, it could not be attacked AT ALL. Everything
    // else in the game already believed in long range: _executeAttack applies disadvantage
    // beyond normal range, enemy AI (aiGetAttack) shoots out to longRange, the automated hero
    // path uses it, and the tooltip advertises "40/80 ft". Only the manual click path stopped
    // at 40, so a goblin could shoot Milo from 60 ft with no way for him to answer.
    //
    // Nothing here applies the penalty: _executeAttack derives disadvantage from the distance
    // itself, so the red ring is purely the WARNING that the shot will be made at disadvantage.
    // Generic on purpose — every unit with a `longRange` on its ranged attack gets the band,
    // heroes and enemies alike, so the rings match what the AI was always allowed to do.
    let chosenAtk = null, color = 0xCC6644;
    const _canShoot   = rangdA && atkHasQty(u, rangdA) && unitsHaveLOS(u, enemy);
    const _normalWU   = rangdA ? projRangeWU(rangdA.range, u) : 0;
    const _longWU     = rangdA?.longRange ? projRangeWU(rangdA.longRange, u) : 0;
    if (meleeA && dist <= atkTriggerWU(meleeA)) {
      chosenAtk = meleeA; color = 0xCC6644;  // orange — melee
    } else if (_canShoot && dist <= _normalWU) {
      chosenAtk = rangdA; color = 0x22ccaa;  // teal — ranged, normal
    } else if (_canShoot && _longWU > 0 && dist <= _longWU) {
      chosenAtk = rangdA; color = 0xcc3344;  // red — long range, at DISADVANTAGE
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
  const spellLvl  = spell.level ?? 1;
  const isCantrip = spellLvl === 0;
  if (!hasSpellSlot(caster, spellLvl)) return;

  faceTarget(caster, target);
  playUnitAttackAnim(caster, 'spell');
  hideHealTargets();
  hideSpellRangeRing();
  heroMode = null;
  spendSpellSlot(caster, spellLvl);

  if (spell.actionType === 'action') _spendHeroAction('spell');
  else                               turnBonusActioned = true;

  const wisMod   = Math.floor(((UNIT_TYPES[caster.type]?.abilities?.wis ?? 10) - 10) / 2);
  const healMod  = spell.healMod ?? wisMod;
  const healRoll = roll({ sides: spell.healSides, count: spell.healDice, modifier: healMod });
  const healed   = applyHeal(target, healRoll.total, { caster });
  target.barShowUntil = Date.now() + 4000;

  showRoll(`${unitLabel(caster)}  →  ${unitLabel(target)}  ·  ${spell.name}`, healRoll, { autoDismiss: false });

  const _onHealLand = () => {
    showFloatingDamage(target, `+${healed}`, '#44ff88');
    addLog(`${unitLabel(caster)} heals ${unitLabel(target)} for ${healed} hp (${spell.name} · ${dmgBreakdown(healRoll)})`, 'heal');
  };

  if (spellKey === 'healing_word') {
    // ⚠ Leugren's cast voice goes HERE, at the healing_word call site — NOT inside
    // playHealingWordEffect. Cure Wounds reuses that same effect for its visual, so a playSound
    // in there would put a "Healing Word" line on top of a different spell.
    playSound('healing_word_leugren');
    playHealingWordEffect(caster, target, _onHealLand, { chimeAt: 'cast' });
  } else {
    setTimeout(_onHealLand, 800);
  }

  const _remFt = (speedOf(caster)) - turnMovedFt;
  if (_remFt > 0) { heroMode = 'move'; showMoveRange(caster); } else { heroMode = null; }
  updateCombatStatus();

}

// ── Sacred Flame (Cleric lvl 3 cantrip — no spell slot, targets an enemy) ────
function showSacredFlameTargets(caster) {
  hideAttackTargets();
  if (turnAttacked) return;
  const rangeWU = projRangeWU(SPELLS.sacred_flame.rangeFt, caster);
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
  _spendHeroAction('spell');   // cantrip — no spell slot cost

  const postSpellRemaining = (speedOf(caster)) - turnMovedFt;
  if (postSpellRemaining > 0) { heroMode = 'move'; showMoveRange(caster); }

  const dexMod     = abilityModOf(target, 'dex');
  const saveResult = rollSave(dexMod, spell.saveDC, target.dodging ? 'advantage' : 'normal');
  const dmgRoll    = roll({ sides: spell.sides, count: spell.dice });
  const dmg        = saveResult.isSave ? 0 : applySpellDamage(caster, dmgRoll.total);

  playSacredFlameEffect(caster, target, () => {
    target.aggro = true;
    buildTurnList();
    showRoll(`${unitLabel(target)} · DEX Save (Sacred Flame)`, saveResult, { autoDismiss: false });
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
      wakeOnDamage(target);   // Sacred Flame
      target.barShowUntil = Date.now() + 5000;
      showFloatingDamage(target, `-${dmg}`, '#ffcc44');
      addLog(`${unitLabel(caster)} casts Sacred Flame → ${unitLabel(target)}: FAILS (${saveBreakdown(saveResult, 'dex')}) — ${dmg} radiant dmg`, 'spell');
      if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target, caster), 400);
    } else {
      showFloatingDamage(target, 'SAVE', '#88ccff');
      addLog(`${unitLabel(caster)} casts Sacred Flame → ${unitLabel(target)}: SAVES (${saveBreakdown(saveResult, 'dex')}) — no damage`, 'spell');
    }

    // Spell splash (off-hand): Sacred Flame is single-target, so it qualifies. The splash mirrors
    // the PARENT spell's resolution — a DEX save per foe, save-NEGATES exactly as above — rather
    // than an attack roll, which is why _resolveSplash takes toHit as a callback. Only splashes off
    // a landed hit: a target who saved took no damage, so there's nothing to share out.
    const _sfSplash = _splashAffixOf(caster, 'spell');
    if (_sfSplash && dmg > 0) {
      const _sfOrigin = { x: target.grp.position.x, z: target.grp.position.z };
      _resolveSplash(caster, target, _sfOrigin, _sfSplash, dmg, (foe) => {
        const r = rollSave(abilityModOf(foe, 'dex'), spell.saveDC,
                           foe.dodging ? 'advantage' : 'normal', affixTotal(foe, 'saving_throw_pct'));
        return { isHit: !r.isSave, label: `SAVES ${saveBreakdown(r, 'dex')}` };
      }, () => onDone?.());
      return;
    }
    onDone?.();
  });

  updateCombatStatus();
}

function castBless(caster) {
  if (!hasSpellSlot(caster, spellLevelOf('bless'))) return;
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
  spendSpellSlot(caster, spellLevelOf('bless'));
  _spendHeroAction('spell');
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
  const atks  = attacksOf(u);
  const meleeA  = atks.find(a => a.type === 'melee');
  const rangedA = atks.find(a => a.type === 'ranged');

  let atk = null;
  if (meleeA && dist <= atkTriggerWU(meleeA)) {
    atk = meleeA;
  } else if (rangedA && dist <= projRangeWU(rangedA.range, u) &&
             unitsHaveLOS(u, selectedTarget)) {
    atk = rangedA;
  }
  if (!atk) return;

  const tgt = selectedTarget;
  _spendHeroAction('weapon');
  hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
  performAttack(u, tgt, atk);
  const rem = (speedOf(u)) - turnMovedFt;
  if (rem > 0) { heroMode = 'move'; showMoveRange(u); } else { heroMode = null; }
  updateCombatStatus();
}

function handleSpellBtnClick(spellKey) {
  if (isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.team !== 'blue') return;
  // Same defence-in-depth as handleElfSpellBtnClick: executeAbility() invokes a handler without
  // re-checking isAvailable, so a stale button could otherwise cast a not-yet-unlocked spell.
  if (!isAbilityUnlocked(u.type, u.level, spellKey)) return;
  if (!hasSpellSlot(u, spellLevelOf(spellKey))) return;

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
      const cancelRemaining = (speedOf(u)) - turnMovedFt;
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

  // If a valid ally is already selected, cast immediately. Same castHeal/castSanctuary split
  // as the click resolver — this shortcut is a second entry point into the very same cast.
  if (selectedTarget && healTargets.has(selectedTarget)) {
    if (spellKey === 'sanctuary') castSanctuary(u, selectedTarget);
    else                          castHeal(u, selectedTarget, spellKey);
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
  addLog(`${unitLabel(u)} Dashes! Movement reset to ${speedOf(u)} ft`, 'move');
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

// ── Reckless Attack (Gobo, lvl 6) ────────────────────────────────────────────
// 5e-shaped: costs no action at all, declared before swinging, and lasts until the start
// of Gobo's NEXT turn — so the enemies who act between his turns are the ones who punish
// him for it. `reckless` is read by the two to-hit sites (hero attacking, enemy attacking
// a hero) beside the existing dodging check, and cleared at his turn start.
function activateRecklessAttack() {
  if (isAnimating) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'human') return;
  if (u.reckless || turnAttacked) return;
  if (!isAbilityUnlocked(u.type, u.level, 'reckless_attack')) return;

  u.reckless = true;
  addLog(`${unitLabel(u)} attacks RECKLESSLY — advantage on his melee attacks, but every attack against him has advantage until his next turn.`, 'move');
  showFloatingDamage(u, '⚔ RECKLESS', '#ff5544');
  updateCombatStatus();
  _rebuildHotbar(u);
}

// ── Turn Undead (Leugren, lvl 5) ─────────────────────────────────────────────
// Channel Divinity, not a spell: no slot, one charge per combat (u.turnUndeadUses).
// Undead in range that fail a WIS save are Frightened + Incapacitated — modelled by the
// `frightenedUnits` Map below, which is deliberately shaped like `sleepingUnits` (same
// round-rollover tick, same wake-on-damage rule, same teardown) so there is one condition
// idiom in this file rather than two.
const _isUndead = u => !!UNIT_TYPES[u?.type]?.undead;

function _undeadInTurnRange(caster) {
  if (!caster?.grp) return [];
  const rangeWU = atkRangeWU(SPELLS.turn_undead.rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  return units.filter(e => {
    if (e.team === caster.team || e.hp <= 0 || !_isUndead(e)) return false;
    if (frightenedUnits.has(e)) return false;
    const dx = e.grp.position.x - ux, dz = e.grp.position.z - uz;
    return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
  });
}

function activateTurnUndead() {
  if (isAnimating || turnAttacked) return;
  const u = turnOrder[turnIndex];
  if (!u || u.type !== 'dwarf') return;
  if (!isAbilityUnlocked(u.type, u.level, 'turn_undead')) return;
  if ((u.turnUndeadUses ?? 0) <= 0) return;

  const spell   = SPELLS.turn_undead;
  const targets = _undeadInTurnRange(u);
  if (targets.length === 0) return;

  u.turnUndeadUses--;
  _spendHeroAction('spell');
  heroMode = null;
  playUnitAttackAnim(u, 'ranged');
  playSleepEffect(u, 0xffe9a8);   // holy gold

  addLog(`${unitLabel(u)} presents his holy symbol — Turn Undead (${spell.rangeFt} ft · WIS DC ${spell.saveDC})`, 'spell');

  targets.forEach((target, i) => {
    setTimeout(() => {
      if (!units.includes(target) || target.hp <= 0) return;
      const wisMod = abilityModOf(target, 'wis');
      const saved  = rollSave(wisMod, spell.saveDC,
                              target.dodging ? 'advantage' : 'normal',
                              affixTotal(target, 'saving_throw_pct')).isSave;
      target.aggro = true;
      if (saved) {
        showFloatingDamage(target, 'RESISTS', '#bbbbbb');
        addLog(`  ${unitLabel(target)}: saves WIS — stands its ground`, 'spell');
      } else {
        applyFear(target, spell.duration ?? 10, u);
        showFloatingDamage(target, '😱 TURNED', '#ffe9a8');
        addLog(`  ${unitLabel(target)}: fails WIS — Frightened & Incapacitated, fleeing for 1 min`, 'spell');
      }
      buildTurnList();
    }, i * 300 + 600);
  });

  updateCombatStatus();
}

// ── Sanctuary (Leugren, lvl 6) ───────────────────────────────────────────────
// Bonus action, 1 slot, warded ally recorded in `sanctuaryUnits`. The ward is enforced at
// enemy TARGET SELECTION (see _sanctuaryBlocks), not on the damage roll: an enemy that
// fails its WIS save must choose someone else, which is what makes this protect a squishy
// rather than just soften a hit. Ends early if the warded ally attacks (5e rule).
function _sanctuaryTargetsFor(caster) {
  if (!caster?.grp) return [];
  const rangeWU = atkRangeWU(SPELLS.sanctuary.rangeFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  return units.filter(a => {
    if (a.team !== caster.team || a.hp <= 0) return false;
    if (sanctuaryUnits.has(a)) return false;
    const dx = a.grp.position.x - ux, dz = a.grp.position.z - uz;
    return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
  });
}

// Cast on an EXPLICIT ward. This is the real implementation; both the manual click-to-pick
// path and the automated auto-pick funnel through it.
//
// ⚠ Deliberately NOT routed through castHeal like the other ally-targeted spells. castHeal
// refuses a target already at full HP ("not spent, pick another") — correct for a heal, exactly
// wrong for a ward, whose whole job is protecting an UNHURT squishy before they get hit.
function castSanctuary(caster, ward) {
  if (!caster || !ward) return;
  if (isAnimating || turnBonusActioned) return;
  if (caster.type !== 'dwarf') return;
  if (!isAbilityUnlocked(caster.type, caster.level, 'sanctuary')) return;
  if (!hasSpellSlot(caster, spellLevelOf('sanctuary'))) return;

  const spell = SPELLS.sanctuary;
  // Re-warding someone who already has it would burn a slot for nothing — say so and keep
  // the picker open so the player can choose someone else, mirroring castHeal's full-HP case.
  if (sanctuaryUnits.has(ward)) {
    showFloatingDamage(ward, 'Already warded', '#8fd0ff');
    addLog(`${unitLabel(ward)} is already under Sanctuary — not spent.`, 'spell');
    showHealTargets(caster, 'sanctuary');
    return;
  }

  faceTarget(caster, ward);
  playUnitAttackAnim(caster, 'spell');
  hideHealTargets();
  hideSpellRangeRing();
  heroMode = null;

  spendSpellSlot(caster, spellLevelOf('sanctuary'));
  turnBonusActioned = true;
  applySanctuary(ward, spell.duration ?? 10);

  addLog(`${unitLabel(caster)} casts Sanctuary on ${unitLabel(ward)} — attackers must pass WIS DC ${spell.saveDC} to target them.`, 'spell');
  showFloatingDamage(ward, '✦ SANCTUARY', '#9fd8ff');
  updateCombatStatus();
}

// AUTOMATED pick only: ward whoever needs it most (lowest HP fraction in range, Leugren
// included). Manual play never reaches this — the player picks their own ward by clicking,
// because "who is the squishy worth protecting" is a judgement the AI shouldn't make for them.
function activateSanctuary() {
  const u = turnOrder[turnIndex];
  if (!u) return;
  const candidates = _sanctuaryTargetsFor(u);
  if (candidates.length === 0) return;
  const ward = candidates.reduce((lo, a) =>
    (a.hp / (a.maxHp || 1)) < (lo.hp / (lo.maxHp || 1)) ? a : lo, candidates[0]);
  castSanctuary(u, ward);
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
  if (!hasSpellSlot(u, spellLevelOf('mage_armor'))) return;

  u.mageArmored = true;
  spendSpellSlot(u, spellLevelOf('mage_armor'));
  _spendHeroAction('spell');

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

  // Hide is a DEX-based Stealth check, so gear counts (a +4 DEX wrist has to move it too). Run it on
  // the d100 engine like everything else: a DC-10 check → success% = ((DEX + 20 − 10)/20)×100 plus
  // the cloak stealth%. Auto-success inside his own smoke (heavy obscurement fully conceals him).
  const dexMod     = abilityModOf(u, 'dex');
  const stealthPct = affixTotal(u, 'stealth_pct');
  const autoHide   = _inOwnSmoke(u);
  const chance     = Math.round(Math.max(5, Math.min(95, ((dexMod + 20 - 10) / 20) * 100 + stealthPct)));
  const succeeded  = autoHide || (Math.floor(Math.random() * 100) + 1) >= (100 - chance);

  turnBonusActioned = true;
  u.hideCooldown    = 2;
  playSound('hide');

  if (succeeded) {
    // Store his stealth STRENGTH; each enemy spot check (_checkHidePerception) rolls d100 against it.
    u.hideDexMod     = dexMod;
    u.hideStealthPct = stealthPct;
    setUnitStealth(u, true);
    addLog(autoHide
      ? `${unitLabel(u)} melts into his smoke — Hide auto-succeeds!`
      : `${unitLabel(u)} hides! (${chance}% Stealth check — enemies now roll to spot him)`, 'move');
    showFloatingDamage(u, 'HIDDEN', '#44ff88');
  } else {
    addLog(`${unitLabel(u)}: Hide failed! (${chance}% Stealth check)`, 'dmg');
    showFloatingDamage(u, 'HIDE FAIL', '#ff6644');
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
  // ⚠ Anchor the cloud to the HERO'S OWN Y, not world zero. spawnSmokeCloud puts its puffs
  // 0.15–2.05 above whatever base it's handed, so passing 0 pinned the smoke to world height 0
  // no matter where Milo stood. Flat zones hid it (their ground is near 0), but heightmap zones
  // rendered it buried in the terrain. grp.position.y is the unit's ground contact point (the
  // attack rings anchor to it the same way), so it's already the correct base.
  u._smokeVFX = spawnSmokeCloud(u.grp.position.x, u.grp.position.y, u.grp.position.z, radiusWU);

  addLog(`${unitLabel(u)} throws a smoke bomb! The area is heavily obscured for ${SMOKE_ROUNDS_LOG} rounds ` +
         `(+${SMOKE_AC_BONUS} AC and free Hide while inside). ${u.smokeUses} use${u.smokeUses === 1 ? '' : 's'} left.`, 'spell');
  showFloatingDamage(u, 'SMOKE & MIRRORS', '#9a9ab0');
  updateCombatStatus();
}

function _checkHidePerception(hero) {
  if (!hero.stealthed || hero.team !== 'blue') return;
  const hx = hero.grp.position.x, hz = hero.grp.position.z;
  // The hero's stealth strength — from the Hide/sneak that set it, else his live values.
  const stealthMod = hero.hideDexMod     ?? abilityModOf(hero, 'dex');
  const stealthPct = hero.hideStealthPct ?? affixTotal(hero, 'stealth_pct');
  for (const e of units) {
    if (e.team !== 'red' || e.hp <= 0 || !e.aggro) continue;
    if (!unitsHaveLOS(e, hero)) continue;
    const wisMod  = Math.floor(((UNIT_TYPES[e.type]?.abilities?.wis ?? 10) - 10) / 2);
    const dx = hx - e.grp.position.x, dz = hz - e.grp.position.z;
    const distFt  = Math.sqrt(dx * dx + dz * dz) * (GRID_SQUARE_FEET / WORLD_UNITS_PER_SQUARE);
    const distPct = -Math.floor(distFt / 5) * 5;   // −5% spot chance per 5 ft (was −1 per 5 ft on d20)
    const chance  = spotChance(wisMod, stealthMod, 0, stealthPct, distPct);
    const roll    = Math.floor(Math.random() * 100) + 1;
    if (roll >= (100 - chance)) {
      setUnitStealth(hero, false);
      addLog(`${unitLabel(e)} spots ${unitLabel(hero)}! (rolled ${roll} vs ${chance}% spot chance)`, 'dmg');
      showFloatingDamage(hero, 'SPOTTED!', '#ff4444');
      return;
    }
  }
}

// ── Healing potion (bonus action, Digit8) ───────────────────────────────────
// Bag-1 slot 0 is reserved for healing potions (see lootPanel.js) — any item
// with a `heal` dice-formula string sitting there is usable here.

function _heroPotion(u) {
  const item = u.equipment?.['bag-1']?.contents?.[0];
  return item?.heal ? item : null;
}

// Whether this hero could drink right now. IN combat a potion is a bonus action on
// their own turn; OUT of combat there's no turn economy to spend, so drinking is
// free and bounded only by how many potions they're carrying. Exported so the
// inventory right-click menu can grey its Use option for the same reasons the
// Digit8 hotbar slot greys out.
export function canUseHealingPotion(u) {
  if (!u || u.hp <= 0 || isAnimating) return false;
  if (!_heroPotion(u)) return false;
  if (!combatPhase) return true;
  return turnOrder[turnIndex] === u && !turnBonusActioned;
}

// Drink, from either entry point: the Digit8 hotbar slot (always in combat) or the
// inventory right-click menu (either side of a fight). The in-combat-only bits are
// gated on `inCombat` below — there's no bonus action to spend out of combat, and
// _rebuildHotbar out there wrongly lights up End Turn/attacks before a fight starts.
export function useHealingPotion(u) { _useHealingPotion(u); }

function _useHealingPotion(u) {
  if (!canUseHealingPotion(u)) return;
  const inCombat = combatPhase && turnOrder[turnIndex] === u;
  const item = _heroPotion(u);
  if (!item) return;
  // Don't drink (or spend the bonus action / charge) at full HP.
  if (u.hp >= u.maxHp) {
    showFloatingDamage(u, 'Full HP', '#8fd0ff');
    addLog(`${unitLabel(u)} is already at full health — potion not used.`, 'heal');
    return;
  }

  if (inCombat) turnBonusActioned = true;

  const formula = parseDiceFormula(item.heal);
  const healed  = formula ? Math.max(1, roll(formula).total) : 1;
  const actual  = applyHeal(u, healed);   // potion: a heal RECEIVED, no caster/healing-done

  showFloatingDamage(u, `+${actual}`, '#55cc55');
  addLog(`${unitLabel(u)} drinks a ${item.name}, restoring ${actual} HP`, 'heal');

  item.qty = (item.qty ?? 1) - 1;
  if (item.qty <= 0) u.equipment['bag-1'].contents[0] = null;

  updateCombatStatus();
  if (inCombat) _rebuildHotbar(u);
}

// ── Rage ─────────────────────────────────────────────────────────────────────

// Everything raging IS — state, sound, floating text, log — with no UI assumptions, so the manual
// and automated paths cannot drift.
//
// ⚠ They HAD drifted: the automated action list re-implemented the three state lines inline and so
// raged silently, with no ⚔ RAGE! float and a thinner log line that omitted the damage/mitigation
// detail. It could not simply call activateRage() because that ends by handing the player the
// move-range UI, which is meaningless mid-automation — so the UI half stays there and this holds
// the rest. Anything added to rage belongs HERE unless it is genuinely about the manual turn.
function _applyRage(u) {
  u.raging  = true;
  u.rageUses--;
  turnBonusActioned = true;
  playSound('berserker_rage');
  showFloatingDamage(u, '⚔ RAGE!', '#ff6622');
  const _bits = [`+${rageDamageForLevel(u.level ?? 1)} melee dmg`];
  const _mit  = rageMitigationForLevel(u.level);
  if (_mit > 0) _bits.push(`resist ${Math.round(_mit * 100)}% dmg`);
  addLog(`${unitLabel(u)} enters RAGE! (${_bits.join(' · ')})`, 'spell');
  updateCombatStatus();
}

function activateRage(u) {
  _applyRage(u);
  // Manual only: rage is a BONUS action, so a player who has movement left should get the range
  // rings back to spend it. The automated turn does its own movement and must not be handed these.
  const rem = (speedOf(u)) - turnMovedFt;
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

// Fire Bolt is an ATTACK-ROLL spell (unlike Sacred Flame, which is a save spell), so it
// resolves through performAttack — that's where to-hit, crit, advantage/disadvantage,
// Bless, hit% and the projectile pipeline live, and duplicating them for spells would
// guarantee the two copies drift apart.
//
// But it is NOT a weapon. `type: 'spell_attack'` keeps it out of every
// `atks.find(a => a.type === 'ranged')` test — those mean "this hero's ranged WEAPON", and
// Rasec hasn't got one. `spellKey` gives it a real spell identity, which is what lets the
// coming damage affixes tell Spell damage from Weapon-attack damage (they must never touch
// each other; see docs/loot-affix-design.md).
//
// Built ONCE from the spell definition — ELF_SPELLS.fire_bolt stays the single source of
// truth for range/dice/stat, and this is frozen because it's now shared rather than rebuilt
// per call, so an accidental write would corrupt every later cast.
const FIRE_BOLT_ATK = Object.freeze({
  name:     ELF_SPELLS.fire_bolt.name,
  type:     'spell_attack',
  spellKey: 'fire_bolt',
  range:    ELF_SPELLS.fire_bolt.rangeFt,
  dice:     ELF_SPELLS.fire_bolt.dice,
  sides:    ELF_SPELLS.fire_bolt.sides,
  statMod:  ELF_SPELLS.fire_bolt.statMod,
});

// ── Gear-granted attacks ──────────────────────────────────────────────────────
// A unit's attack list INCLUDING anything its equipment grants. This is the first crack in
// "attacks come from the static statblock, equipment is ignored" (see the weapon-equipment
// binding note): a thrown weapon in the ammo slot now produces a real ranged attack.
//
// Everything must come through here, or gear silently won't apply — the raw
// `UNIT_TYPES[u.type].attacks` read appears at ~14 sites in this file alone, and each one is
// a place an equipped dart would be invisible (no ring, no hotbar slot, no AI awareness).
//
// Takes the UNIT, not a def: a def has no equipment, so it cannot know about gear. Enemies
// carry no `equipment`, so this returns their statblock untouched and costs them one guard.
function attacksOf(unit) {
  const base = UNIT_TYPES[unit?.type]?.attacks ?? [];
  const thrown = _thrownAmmoAtkOf(unit);
  return thrown ? [...base, thrown] : base;
}

// A ranged attack built from a THROWN weapon sitting in the ammo slot (darts today).
//
// Built from the item so its 5e stats stay the single source of truth — the same reason
// FIRE_BOLT_ATK reads ELF_SPELLS. No proficiency test is needed: canEquip() already gated
// the equip, so an equipped dart means the hero may use it.
//
// ⚠ type:'ranged' is deliberate — this IS a ranged weapon, so it SHOULD win the
// `find(a => a.type === 'ranged')` searches. For Rasec that means an equipped dart takes the
// ranged slot and demotes Fire Bolt to a spell-only button (user's call, 2026-07-18). Fire
// Bolt remains a SPELL throughout: it never enters attacks[], keeps type 'spell_attack', and
// still only ever appears via the explicit `?? FIRE_BOLT_ATK` fallbacks, which now fire only
// when no thrown weapon is equipped.
//
// No ammo consumption (user's call): infinite throws, exactly like arrows today.
function _thrownAmmoAtkOf(unit) {
  const ammo = unit?.equipment?.ammo;
  if (!ammo?.thrown || !ammo.dmg) return null;
  const f = parseDiceFormula(ammo.dmg);
  if (!f) return null;
  return {
    name:      ammo.weaponType ?? ammo.name,
    type:      'ranged',
    range:     ammo.range ?? 20,
    longRange: ammo.longRange ?? null,
    dice:      f.count,
    sides:     f.sides,
    // Finesse: use the better of STR/DEX, which for a dart-throwing caster is always DEX.
    statMod:   ammo.finesse
      ? (abilityModOf(unit, 'dex') >= abilityModOf(unit, 'str') ? 'dex' : 'str')
      : 'dex',
    dmgType:   ammo.dmgType ?? 'piercing',
  };
}

// Does this attack resolve like a ranged one — fly at the target, fire a projectile, check
// long range? True for weapons AND attack-roll spells. This is the test performAttack wants;
// `type === 'ranged'` on its own means "is a ranged WEAPON", which is a different question.
function _resolvesRanged(atk) {
  return atk?.type === 'ranged' || atk?.type === 'spell_attack';
}

function showMagicMissileTargets(caster) {
  hideAttackTargets();
  if (turnAttacked) return;
  const rangeWU = projRangeWU(ELF_SPELLS.magic_missile.rangeFt, caster);
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
  if (!freeUse && !hasSpellSlot(caster, spellLevelOf('magic_missile'))) return;
  faceTarget(caster, target);
  playUnitAttackAnim(caster, 'ranged');
  hideAttackTargets();
  hideSpellRangeRing();
  heroMode = null;
  if (freeUse) caster.mmFreeUsed = true; else spendSpellSlot(caster, spellLevelOf('magic_missile'));
  _spendHeroAction('spell');

  const postSpellRemaining = (speedOf(caster)) - turnMovedFt;
  if (postSpellRemaining > 0) { heroMode = 'move'; showMoveRange(caster); }

  const darts = Array.from({ length: spell.darts }, () =>
    roll({ sides: spell.sides, modifier: spell.flatBonus })
  );
  // Scale the SUM, not each dart — the per-dart breakdown in the log stays the honest roll.
  const totalDmg = applySpellDamage(caster, darts.reduce((s, r) => s + r.total, 0));

  // Visual — 4 neon purple arrows; damage applies when last bolt lands
  playMagicMissileEffect(caster, target, () => {
    target.aggro = true;
    buildTurnList();
    target.hp = Math.max(0, target.hp - totalDmg);
    wakeOnDamage(target);   // Magic Missile
    target.barShowUntil = Date.now() + 5000;
    const dartStr = darts.map(r => r.total).join('+');
    showFloatingDamage(target, `-${totalDmg}`, '#aa66ff');
    addLog(`${unitLabel(caster)} casts Magic Missile${freeUse ? ' (free cast)' : ''} → ${unitLabel(target)}: ${dartStr} = ${totalDmg} force dmg`, 'spell');
    if (target.hp <= 0) setTimeout(() => removeDefeatedUnit(target, caster), 400);

    // Spell splash (off-hand): single-target, so it qualifies. toHit is NULL here — Magic Missile
    // AUTO-HITS by definition, so its splash auto-hits too and the full ladder is always dealt out.
    // That makes it the strongest partner for this affix, which is the natural cost of a spell that
    // never misses; it's also exactly the case the resolver's null-toHit branch exists for.
    const _mmSplash = _splashAffixOf(caster, 'spell');
    if (_mmSplash && totalDmg > 0) {
      const _mmOrigin = { x: target.grp.position.x, z: target.grp.position.z };
      _resolveSplash(caster, target, _mmOrigin, _mmSplash, totalDmg, null, () => onDone?.());
      return;
    }
    onDone?.();
  });

  updateCombatStatus();
}

function castSleep(caster) {
  const spell = ELF_SPELLS.sleep;
  if (!hasSpellSlot(caster, spellLevelOf('sleep'))) return;
  playUnitAttackAnim(caster, 'ranged');
  spendSpellSlot(caster, spellLevelOf('sleep'));
  _spendHeroAction('spell');
  heroMode = null;

  playSleepEffect(caster);

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
  if (!hasSpellSlot(caster, spellLevelOf('burning_hands'))) return;
  playUnitAttackAnim(caster, 'ranged');
  spendSpellSlot(caster, spellLevelOf('burning_hands'));
  _spendHeroAction('spell');
  heroMode = null;

  playSleepEffect(caster, 0xff6622);   // fire orange, not Sleep's violet

  // Burning Hands is the game's ONLY hero AoE, so it's the only consumer of the off-hand aoe_radius
  // affix. Its area is a radius around the CASTER (spell.rangeFt), not a cone, despite the
  // description — so the affix widens exactly the circle the targeting below already uses.
  const areaFt  = aoeRadiusFtOf(caster, spell.rangeFt);
  const rangeWU = atkRangeWU(areaFt);
  const ux = caster.grp.position.x, uz = caster.grp.position.z;
  const targets = units.filter(e => {
    if (e.team === caster.team || e.hp <= 0) return false;
    const dx = e.grp.position.x - ux, dz = e.grp.position.z - uz;
    return Math.sqrt(dx * dx + dz * dz) <= rangeWU;
  });

  const dmgResult = roll({ sides: spell.sides, count: spell.dice });
  showRoll(`${unitLabel(caster)}  ·  Burning Hands`, dmgResult, { autoDismiss: false });
  addLog(`${unitLabel(caster)} casts Burning Hands (${areaFt} ft · DEX DC ${spell.saveDC})` +
         (areaFt > spell.rangeFt ? ` — widened from ${spell.rangeFt} ft` : ''), 'spell');

  if (targets.length === 0) {
    addLog('  Burning Hands: no enemies in range', 'spell');
  } else {
    targets.forEach((target, i) => {
      setTimeout(() => {
        const dexMod = abilityModOf(target, 'dex');
        // Was a raw d20 vs DC — the only save in the game off the shared d100 ladder, so it
        // silently ignored dodge advantage and the saving_throw_pct affix and used a scale
        // where the DC means something different. Routed through rollSave like every other.
        const saved = rollSave(dexMod, spell.saveDC,
                               target.dodging ? 'advantage' : 'normal',
                               affixTotal(target, 'saving_throw_pct')).isSave;
        // Gear scales the full roll first, THEN the save halves it — so a saving target
        // still feels the caster's Spell damage, just halved like everything else.
        const _scaled = applySpellDamage(caster, dmgResult.total);
        const dmg = saved ? Math.max(1, Math.floor(_scaled / 2)) : _scaled;
        target.aggro = true;
        buildTurnList();
        target.hp = Math.max(0, target.hp - dmg);
        wakeOnDamage(target);   // Burning Hands
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
  // Defence in depth: executeAbility() runs a handler WITHOUT re-checking isAvailable, so a
  // stale button left over from a pre-level-up render could otherwise cast a locked spell.
  if (!isAbilityUnlocked(u.type, u.level, spellKey)) return;
  const hasFreeMM = spellKey === 'magic_missile' && !u.mmFreeUsed;
  if (!hasFreeMM && !hasSpellSlot(u, spellLevelOf(spellKey))) return;

  if (spellKey === 'magic_missile') {
    if (heroMode === 'elfatk_magic_missile') {
      heroMode = null;
      hideCastConfirm();
      hideAttackTargets();
      hideSpellRangeRing();
      const cancelRemaining = (speedOf(u)) - turnMovedFt;
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
  const speedFt  = speedOf(u);
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
  for (const [, state] of frightenedUnits) state.fearEl?.remove();
  frightenedUnits.clear();
  sanctuaryUnits.clear();
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
  clearFear(u);
  clearSanctuary(u);
  // Death ends lingering conditions. Milo was dying WHILE webbed and coming back from a short
  // rest still restrained, because the corpse kept its actionSave. Clearing it here also fades
  // the web decal (playWebEffect drops it once actionSave.key !== 'web') the moment they fall,
  // and covers every action-save condition generically — grapple, paralysis, future ones —
  // not just the web. Buffs (rage, bless, mage armor) are intentionally left to their own
  // end-of-combat / duration teardown; this is debuffs only.
  clearActionSave(u);
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
  // Roll breakdowns tag advantage/disadvantage with the uppercase ADV / DIS tokens —
  // bold-green for ADV, bold-red for DIS. Case-sensitive + word-boundary so ordinary prose
  // ("advantage", "distracts") is never matched.
  return esc.replace(_HERO_RE, n => `<b style="color:${_HERO_COLORS[n]}">${n}</b>`)
    .replace(/\bADV\b/g, '<b style="color:#3fcf5a">ADV</b>')
    .replace(/\bDIS\b/g, '<b style="color:#ff5555">DIS</b>');
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
function rollToHit(atkBonus, defAC, atkLvl, defLvl, mode = 'normal', hitPctBonus = 0, critPct = 0) {
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

  // Base crit is a roll of 96+ (5%). Ring crit_chance_pct lowers that threshold 1:1 (each point =
  // +1% crit), floored at 51 so crit can never exceed 50% no matter how many rings stack.
  const critThresh = Math.max(51, 96 - Math.max(0, critPct));
  const isCrit = kept >= critThresh;
  return { dice: r2 !== null ? [r1, r2] : [r1], kept, mode, hitChance, threshold, isHit: kept >= threshold || isCrit, isCrit };
}

// Save throw — mirrors rollToHit for DC checks.
// saveChance = ((saveMod + 20 - dc) / 20) × 100, clamped [5–95].
// Roll d100 high to succeed: need ≥ (100 - saveChance).
// Advantage: keep higher die. Disadvantage: keep lower die.
// pctBonus: flat percentage POINTS added to the save chance — the cloak's saving_throw_pct affix,
// the defensive mirror of rollToHit's hitPctBonus. Callers pass affixTotal(hero,'saving_throw_pct')
// for hero saves and 0 for enemy saves (statblocks have no gear). The 5-95 clamp still applies.
function rollSave(saveMod, dc, mode = 'normal', pctBonus = 0) {
  const rawPct     = ((saveMod + 20 - dc) / 20) * 100 + pctBonus;
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
  // Morvath's melee voice. Deliberately NOT a UNIT_SOUNDS `attack` entry: that key fires from
  // playUnitAttackSound directly above for EVERY attack he makes, so it would layer on top of
  // grave_curse on his AoE turn. Gated on the melee TYPE instead, which covers both of his melee
  // attacks (Claws and Inflict Wounds) and leaves Grave Curse with its own sound alone.
  if (attacker.type === 'morvath' && atk.type === 'melee') playSound('morvath_melee');
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
    setTimeout(() => _executeAoeSave(attacker, target, atk, onSettled), spd(700));
    return;
  }
  if (_resolvesRanged(atk)) {
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
      }, spd(UNIT_TYPES[attacker.type].rangedReleaseMs));
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
  // Convert the d20-scale DC to THIS unit's d100 break-out number, the same way rollSave does
  // (saveChance = ((mod + 20 − dc)/20)×100, clamped 5–95; you roll d100 and need ≥ threshold).
  // The DC alone is a stable property of the effect, but the d100 threshold folds in the
  // roller's ability mod, so it differs per hero — Gobo (STR +3) needs ≥45, Milo (−2) needs
  // ≥70 against the same DC 12 web. Stored here so the button, badge and log all show the
  // correct per-hero number in d100 terms rather than a bare "DC 12".
  const mod = abilityModOf(u, save.stat);   // includes gear — a +2 DEX wrist moves this number
  // Fold in the cloak saving-throw % too, so the displayed break-free threshold matches the
  // actual rollSave (which passes the same bonus) instead of showing a stale, easier number.
  const savePct = affixTotal(u, 'saving_throw_pct');
  save.chance    = Math.round(Math.max(5, Math.min(95, ((mod + 20 - save.dc) / 20) * 100 + savePct)));
  save.threshold = 100 - save.chance;
  u.actionSave = save;
  if (u.team === 'blue') _maybeShowSaveTutorial();
}

// ── First-restraint tutorial arrow ───────────────────────────────────────────
// The first time any HERO is grabbed by something they must spend an Action to escape (web,
// ghoul paralysis, future hard-CC riders), an arrow bounces over button 1 to teach that the
// save is a button you press — not something rolled for you. Same shape as the first-death
// REST arrow and the Ready Action tip.
//
// Once globally, not per hero (user: "when a player is FIRST restrained") — the lesson is
// where the button lives, and that's the same button for everyone.
const LS_SAVE_TUT_KEY = 'dnd_save_tutorial_seen';

function _saveTutSeen() {
  try { return !!localStorage.getItem(LS_SAVE_TUT_KEY); } catch { return false; }
}
function _hideSaveTutorial() {
  document.getElementById('save-tutorial')?.remove();
}
function _maybeShowSaveTutorial() {
  if (_saveTutSeen() || document.getElementById('save-tutorial')) return;
  // The hotbar is rebuilt per turn, so the button only exists once it's the hero's go. Defer to
  // the next frame: setActionSave fires mid-resolution (the web lands on the ENEMY's turn),
  // long before the victim's own hotbar is built.
  requestAnimationFrame(() => {
    if (_saveTutSeen()) return;
    const btn = document.querySelector(`.hb-btn[data-hb-key="${SAVE_SLOT}"]`);
    if (!btn) return;   // not this hero's turn yet — retried on the next setActionSave
    const el = document.createElement('div');
    el.id = 'save-tutorial';
    el.innerHTML =
      `<div class="save-tut-label">Click to break free</div>` +
      `<div class="save-tut-arrow">▼</div>`;
    btn.appendChild(el);
  });
}
// Learned once they actually press it — dismissing any other way (the web breaking on its own,
// combat ending) would burn the flag without teaching anything, so the arrow simply returns.
function _markSaveTutorialSeen() {
  try { localStorage.setItem(LS_SAVE_TUT_KEY, '1'); } catch {}
  _hideSaveTutorial();
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
  const mod = abilityModOf(u, s.stat);
  const res = rollSave(mod, s.dc, u.dodging ? 'advantage' : 'normal', affixTotal(u, 'saving_throw_pct'));
  const label = unitLabel(u);

  showRoll(`${label} · ${s.name} (${s.stat.toUpperCase()} · need ≥ ${s.threshold})`, res, { autoDismiss: false });

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
  const conMod = abilityModOf(unit, 'con');   // no CON affix yet, but this is the right door
  const result = rollSave(conMod, dc, unit.dodging ? 'advantage' : 'normal', affixTotal(unit, 'saving_throw_pct'));
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
  const mod    = abilityModOf(target, stat);
  const res    = rollSave(mod, dc, target.dodging ? 'advantage' : 'normal', affixTotal(target, 'saving_throw_pct'));

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
  // Mitigated like everything else. Before 2026-07-16 poison went through a raging Gobo
  // at full damage.
  const poisonDmg = applyMitigation(target, Math.max(1, dmgResult.total));
  const willDie   = target.hp <= poisonDmg;

  setTimeout(() => {
    addLog(`${label} fails against the venom! (${saveBreakdown(res, stat)})`, 'save');
    addLog(`  ☠ ${poisonDmg} poison damage (${dmgBreakdown(dmgResult)})`, 'dmg');
    playPoisonEffect(target);
    showFloatingDamage(target, `☠ -${poisonDmg}`, '#66dd44');

    target.hp = Math.max(0, target.hp - poisonDmg);
    wakeOnDamage(target);   // venom tick
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

// On-hit ELEMENTAL RIDER from the ATTACKER's neck amulet (Emberheart Pendant, etc.). The swing's
// own damage has already landed; this adds the rider's element on top. Two things set it apart
// from the spider's venom above: the source is the ATTACKER's gear (not the attack), and it's
// save-for-HALF (user's rule) rather than save-negates — a made save halves the damage, it never
// erases it. Instantaneous, no lingering condition. Its dice are stored as a formula on the rolled
// affix (js/affixes.js) and rerolled HERE every hit, like weapon dice.
//
// done() fires exactly once, on every path, because the caller (onSettled) is waiting on it to
// advance the turn — the same contract _resolvePoison keeps, and the class of bug /timing-audit hunts.
const _RIDER_BEAT  = 0;
const _RIDER_STYLE = {
  fire:    { icon: '🔥', color: '#ff6622' },
  cold:    { icon: '❄',  color: '#88ccff' },
  poison:  { icon: '☠',  color: '#66dd44' },
  disease: { icon: '☣',  color: '#a6c34a' },
};
function _resolveRider(attacker, target, rider, alreadyDead, done) {
  if (!target) { done(); return; }

  const label   = unitLabel(target);
  const noun    = rider.damageType ?? 'elemental';
  const stat    = rider.saveStat ?? 'con';
  const dc      = rider.saveDC ?? 12;
  const style   = _RIDER_STYLE[noun] ?? { icon: '✦', color: '#ffffff' };
  const nounCap = noun.charAt(0).toUpperCase() + noun.slice(1);
  const mod     = abilityModOf(target, stat);
  const res     = rollSave(mod, dc, target.dodging ? 'advantage' : 'normal');

  showRoll(`${label} · ${nounCap} rider (${stat.toUpperCase()} DC ${dc})`, res, { autoDismiss: false });

  const f       = parseDiceFormula(rider.dice);
  const rawRoll = f ? roll(f) : { total: 1, dice: [1], modifier: 0, sides: 1, count: 1 };
  // save-for-half: a made save halves the roll (floored, min 1); a failed save takes it in full.
  const halved   = res.isSave;
  const preMit   = Math.max(1, halved ? Math.floor(rawRoll.total / 2) : rawRoll.total);
  const riderDmg = applyMitigation(target, preMit);
  // alreadyDead: the swing itself was lethal, so this rider is OVERKILL. A kill must still SHOW all
  // of its damage (the bug this fixes: Milo's ice vanished silently whenever the hit killed), so we
  // display the float/effect/log regardless — we just don't drive hp past 0 or re-roll concentration,
  // and WE own the removal (the lethal-swing path deferred it here so the mesh outlives the float).
  const willDie  = alreadyDead || target.hp <= riderDmg;

  setTimeout(() => {
    addLog(halved
      ? `${label} saves — half ${noun} (${saveBreakdown(res, stat)})`
      : `${label} fails against the ${noun}! (${saveBreakdown(res, stat)})`, 'save');
    addLog(`  ${style.icon} ${riderDmg} ${noun} damage (${dmgBreakdown(rawRoll)}${halved ? ' → half' : ''})`, 'dmg');
    // Per-element burst on the struck target: dedicated fire/ice effects, and the poison burst
    // stands in for the two organic riders (disease has no bespoke VFX yet).
    if      (noun === 'fire') playFireEffect(target);
    else if (noun === 'cold') playIceEffect(target);
    else                      playPoisonEffect(target);   // poison + disease
    showFloatingDamage(target, `${style.icon} -${riderDmg}`, style.color);

    if (!alreadyDead) {
      target.hp = Math.max(0, target.hp - riderDmg);
      wakeOnDamage(target);   // on-hit amulet rider
      target.barShowUntil = Date.now() + 5000;
      buildTurnList();
      _checkConcentration(target, riderDmg, willDie);
    }

    if (willDie) {
      setTimeout(() => { removeDefeatedUnit(target, attacker); done(); }, 400);
    } else {
      setTimeout(done, 150);
    }
  }, _RIDER_BEAT);
}

// The first on-hit rider on a unit's equipped gear (neck amulets today). ONE rider per hit — neck
// is the only source, so there's never a second; if riders later spread to other slots, the
// onSettled chain below would have to sequence them. Enemies carry no `equipment`, so this is
// hero-only for free.
function _onHitRiderOf(u) {
  const eq = u?.equipment;
  if (!eq) return null;
  for (const slot of Object.keys(eq)) {
    const r = eq[slot]?.affixes?.find(a => a.rider);
    if (r) return r;
  }
  return null;
}

// The splash affix on a unit's gear that fires for a given KIND of hit: 'melee' → main-hand Cleave,
// 'spell' → off-hand Spell splash. Both exist at once on a fully-geared caster-martial, and they
// must not cross-fire — an axe doesn't splash a Fire Bolt and a focus doesn't cleave a swing — so
// `kind` is matched against the affix's own `appliesTo` rather than taking the first splash found.
//
// ⚠ Deliberately NOT affixTotal: a splash affix carries a falloff LADDER, not a scalar, and summing
// across slots would read as one bigger splash — not what two splashing items should mean.
function _splashAffixOf(u, kind) {
  const eq = u?.equipment;
  if (!eq) return null;
  for (const slot of Object.keys(eq)) {
    const s = eq[slot]?.affixes?.find(a => a.splash && a.appliesTo === kind);
    if (s) return s;
  }
  return null;
}

// An AoE spell's radius in FEET including the caster's off-hand aoe_radius affix.
//
// ⚠ THE AFFIX IS A DIAMETER BONUS, SO HALF OF IT GOES ON THE RADIUS (user's word: "merely expands
// the diameter of AoE spells"). This is the single conversion point — every AoE consumer calls
// here, so the diameter/radius distinction can never be got wrong twice.
//
// Enemies carry no equipment, so affixTotal is 0 for them: Morvath's Grave Curse is unaffected for
// free without needing a hero-only test.
function aoeRadiusFtOf(caster, baseFt) {
  return baseFt + affixTotal(caster, 'aoe_radius') / 2;
}

// Shared splash resolver — the doc's "one routine, parameterized" for melee Cleave and (later)
// caster Spell splash. Bleeds a landed hit onto the foes nearest `originPos` within `radiusFt`,
// following the affix's FALLOFF LADDER: `pcts[i]` is the % of the primary hit that the i-th
// NEAREST foe takes, and the ladder's length is the target cap (red cleave is [100, 85, 40, 25],
// so four foes take 100/85/40/25% respectively).
//
// Sort order is therefore load-bearing, not cosmetic: it decides who gets the big number, not just
// who gets included.
//
// ⚠ originPos is a PLAIN {x, z} captured by the caller, not the primary unit — read on purpose,
// because a lethal swing schedules removeDefeatedUnit BEFORE this resolver's timer fires, and
// reading `primary.grp.position` here would touch a mesh that's already gone. Cleaving off a kill
// is the whole point of the affix, so the origin has to outlive the corpse.
//
// `raw` is the PRE-mitigation damage of the primary hit, not the post-mitigation number: each
// splashed foe then takes its own applyMitigation cut. Splashing the already-mitigated figure would
// apply the primary's armor to everyone standing near it.
//
// ⚠ EACH SPLASHED FOE ROLLS ITS OWN TO-HIT (user's call, 2026-07-18) — "otherwise hit or miss is
// massively OP or underpowered". One shared roll would make a landed red cleave auto-deal
// 100/85/40/25% to four foes with no further counterplay, while a missed swing erases all of it:
// the affix would be pure variance amplification on a single d100. Per-target rolls give each foe
// its own AC and dodge state a say, which is what makes the falloff ladder a curve instead of a
// coin flip.
//
// ⚠ THE LADDER IS ASSIGNED TO THE FOES THAT HIT, NOT TO DISTANCE (user's spec, 2026-07-18).
// One attack roll per foe in range, up to the ladder's length — then the percentages are dealt out
// to whichever foes CONNECTED, best share first, in nearest-first order among them. The user's
// worked example: purple is [66, 25] against two adjacent foes, so two rolls go out, and "if either
// hits, then the 66% affects the one hit" — a lone connecting foe takes the TOP of the ladder, not
// the entry matching where it stood.
//
// So a miss doesn't blank a slot, it SHORTENS the ladder. Orange [85, 40, 25] landing one of three
// rolls deals 85% once; landing two deals 85% and 40%. This is why the rolls must all be taken
// BEFORE any damage is assigned — pct depends on how many hit, which isn't known until they're in.
//
// `toHit` is a CALLBACK, not baked in, because the resolver is shared: melee cleave passes a
// weapon-attack roll, and off-hand's Spell splash will pass its own profile (or null to auto-hit,
// which is what a save-based splash would want). It returns a rollToHit result, or null for
// auto-hit — with null every foe "hits" and the ladder is dealt out in full.
//
// done() fires exactly once on every path — including "no neighbours", "everything missed" and
// "everything died" — because the attack chain is waiting on it to advance the turn. Same contract
// _resolvePoison and _resolveRider keep, and the class of freeze /timing-audit hunts.
function _resolveSplash(attacker, primary, originPos, splash, raw, toHit, done) {
  const pcts = splash?.pcts ?? [];
  if (!originPos || !pcts.length || raw <= 0) { done(); return; }

  const radiusWU = (splash.radiusFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const ox = originPos.x;
  const oz = originPos.z;

  // Foes of the ATTACKER, excluding the primary target (it already took the full hit). The
  // hp > 0 test also excludes team:'npc' units, which are built with hp = 0 on purpose.
  const foes = units
    .filter(u => u !== primary && u !== attacker && u.hp > 0 && u.team !== attacker.team && u.team !== 'npc')
    .map(u => {
      const dx = u.grp.position.x - ox;
      const dz = u.grp.position.z - oz;
      return { u, d: Math.sqrt(dx * dx + dz * dz) };
    })
    .filter(e => e.d <= radiusWU)
    .sort((a, b) => a.d - b.d)              // nearest first — this ASSIGNS the ladder, see below
    .slice(0, pcts.length)                  // the ladder's length IS the target cap
    .map(e => e.u);

  if (!foes.length) { done(); return; }

  // ALL the rolls first, then the assignment — pct depends on how MANY connected, so no foe's
  // share can be known until every roll is in. `hitIdx` walks the ladder across the hits only, in
  // nearest-first order, which is what shortens the ladder on a miss instead of blanking a slot.
  let hitIdx = 0;
  const plan = foes.map(foe => {
    const res   = toHit ? toHit(foe) : null;
    const isHit = !res || res.isHit;            // null toHit = auto-hit (save-based splash)
    return { foe, res, isHit, pct: isHit ? pcts[hitIdx++] : 0 };
  });
  const landed = plan.filter(p => p.isHit);

  addLog(`  ⚔ ${splash.label} sweeps ${foes.length === 1 ? 'the adjacent foe' : `the ${foes.length} nearest foes`}` +
         (toHit ? ` — ${foes.length} attack roll${foes.length > 1 ? 's' : ''}` : '') +
         (landed.length ? `, ${landed.map(p => `${p.pct}%`).join(' / ')}` : ', all missed'), 'dmg');

  // ⚠ NO STAGGER, NO SWING ANIMATION (user, 2026-07-18): "just do the damage and float the damage
  // text over the cleaved targets." An earlier version spaced the foes 220ms apart, which bought
  // nothing but latency — a red cleave added up to ~2.6s to a single swing, straight onto the
  // known automation turn-delay problem. Everything below lands on ONE beat; the only wait left is
  // the corpse pause, which exists so the float is readable before the mesh goes.
  const dead = [];
  plan.forEach(({ foe, res, isHit, pct }) => {
    foe.aggro = true;                          // swung at them — they notice hit or miss
    wakeOnDamage(foe);

    if (!isHit) {
      // `res.label` lets a caller describe its own failure — a save-based splash (Sacred Flame)
      // reports "SAVES (…)", where atkBreakdown would print attack-roll wording for a save.
      addLog(`  ⚔ ${splash.label} misses ${unitLabel(foe)} (${res.label ?? atkBreakdown(res)})`, 'miss');
      showFloatingDamage(foe, 'MISS', '#999999');
      return;
    }

    // ⚠ A CRIT on a splash roll is treated as a plain hit (user, 2026-07-18). `raw` is the primary
    // swing's damage, which ALREADY doubled if that swing crit — doubling again would compound one
    // crit into two. The splash is a share of the hit that happened, not an independent attack.
    const dmg     = applyMitigation(foe, Math.max(1, Math.ceil(raw * pct / 100)));
    const willDie = foe.hp <= dmg;

    // `noun` is the affix's own word — "cleave damage" off a weapon, "splash damage" off a spell —
    // so the log names what actually hit them rather than a generic resolver term.
    addLog(`  ⚔ ${unitLabel(foe)} suffers ${dmg} ${splash.noun} damage (${pct}%)`, 'dmg');
    showFloatingDamage(foe, `⚔ -${dmg}`, '#ffaa44');
    foe.hp = Math.max(0, foe.hp - dmg);
    foe.barShowUntil = Date.now() + 5000;
    _checkConcentration(foe, dmg, willDie);
    if (willDie) dead.push(foe);
  });

  buildTurnList();   // once, after every foe has taken its share — not per foe

  // done() exactly once, on both paths.
  if (dead.length) setTimeout(() => { dead.forEach(f => removeDefeatedUnit(f, attacker)); done(); }, 400);
  else             setTimeout(done, 150);
}

function _executeAttack(attacker, target, atk, onSettled = null) {
  const def     = UNIT_TYPES[attacker.type] ?? {};
  // abilityModOf, not the raw UNIT_TYPES read: it folds in the wrist str/dex affixes, which
  // the static statblock knows nothing about. This ONE line covers both attack AND damage —
  // atkMod and baseDmgMod below are both derived from statMod, which is exactly why an
  // ability affix is a multiplier rather than a linear boost.
  const statMod = abilityModOf(attacker, atk.statMod);
  // dmgBonus on attack overrides stat-derived damage mod (e.g. spell cantrips)
  const baseDmgMod   = atk.dmgBonus !== undefined ? atk.dmgBonus : statMod;
  // UNIT_TYPES.rage marks WHO rages; the damage comes from the barbarian table so it
  // scales +2 → +3 → +4 with level rather than sitting on the statblock's literal +2.
  const rageDmgBonus = (attacker.raging && atk.type === 'melee' && UNIT_TYPES[attacker.type]?.rage)
    ? rageDamageForLevel(attacker.level ?? 1) : 0;
  const dmgMod  = baseDmgMod + rageDmgBonus;
  // Flat percentage points added to hit chance, from two sources that share the one
  // hitPctBonus channel rollToHit already exposes:
  //   • Precision — the Gobo/Milo L4+ passive, always active, independent of Rage/Hide.
  //   • Gear — the Wrist hit_pct affix. ⚠ Wrist is a PAIR, so affixTotal naturally counts
  //     BOTH wrists; the ladder is priced for that (a red pair is ~+14-24%, not +7-12%).
  const precisionBonus = precisionHitBonusForLevel(attacker.type, attacker.level)
                       + affixTotal(attacker, 'hit_pct');
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
  if (_resolvesRanged(atk) && atk.longRange) {
    const rdx = target.grp.position.x - attacker.grp.position.x;
    const rdz = target.grp.position.z - attacker.grp.position.z;
    if (Math.sqrt(rdx * rdx + rdz * rdz) > projRangeWU(atk.range, attacker)) { hasDisadvantage = true; atkDisadvReason = 'long range'; }
  }
  if (target.dodging) { hasDisadvantage = true; atkDisadvReason = atkDisadvReason ? atkDisadvReason + ', dodge' : 'dodge'; }
  // Reckless Attack (Gobo, L6) — BOTH halves live here because this is the one to-hit path
  // every attack in the game runs through, in either direction. Melee only on the upside
  // (5e wording: "melee weapon attack rolls using Strength"), any attack on the downside.
  if (attacker.reckless && !_resolvesRanged(atk)) hasAdvantage = true;
  if (target.reckless) hasAdvantage = true;
  // Advantage and disadvantage from different sources cancel out to a normal roll (D&D RAW).
  const atkMode = hasAdvantage && hasDisadvantage ? 'normal' : hasAdvantage ? 'advantage' : hasDisadvantage ? 'disadvantage' : 'normal';

  // Smoke & Mirrors' heavy obscurement is the third term: a defender standing in his own
  // cloud is hard to see, so he's harder to hit. Positional — it lapses the moment he
  // steps out, and applies to whoever is being ATTACKED, not the attacker.
  const _acBonus   = (target.defStanceActive ? 3 : 0) + (target.mageArmored ? 3 : 0) +
                     (_inOwnSmoke(target) ? SMOKE_AC_BONUS : 0);
  const targetBase = target.equipment ? computeAC(target) : (UNIT_TYPES[target.type]?.ac ?? COMBAT.defaultAC);
  const targetAC   = targetBase + _acBonus;
  // The DEFENDER's gear subtracts from the very same hit-% channel the attacker adds to: the
  // Chest ac_pct affix is a percentage-point reduction of the attacker's hit chance, NOT flat
  // AC — flat AC is targetAC above, which chest armour already supplies through computeAC, and
  // ac_pct stacks on top of it.
  //
  // Netted here rather than given its own rollToHit parameter so hit% keeps exactly ONE
  // adjustment channel with both sides of it visible on one line. The 5-95 clamp then applies
  // to the result, so armour can never drive an attacker below a 5% chance.
  //
  // ⚠ This is the ONLY path ac_pct touches. Save-based AoE and poison never reach rollToHit,
  // so armour does nothing against them — deliberately unlike mitigation_pct, which lives in
  // damageMitigationOf and so covers every damage path there is.
  const hitPctNet = precisionBonus - affixTotal(target, 'ac_pct');
  const atkResult = rollToHit(atkMod + blessBonus, targetAC, unitCombatLevel(attacker), unitCombatLevel(target), atkMode, hitPctNet, affixTotal(attacker, 'crit_chance_pct'));
  const aLabel    = unitLabel(attacker), tLabel = unitLabel(target);

  // Stealth ends here — after the roll (so the hidden bonus/advantage still applied):
  // making an attack breaks the ATTACKER's hide (hit or miss), and being attacked
  // reveals a hidden DEFENDER. Either way, Milo drops out of hide.
  if (attacker.stealthed) { setUnitStealth(attacker, false); addLog(`${aLabel} breaks stealth with the attack!`, 'move'); }
  // Sanctuary is a ward on the PASSIVE: attacking gives it up (5e). Same "after the roll"
  // placement as the stealth break above, so the attack that ends it still resolves.
  if (sanctuaryUnits.has(attacker)) clearSanctuary(attacker, 'attacked');
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
    const _webSave = target.actionSave;
    setTimeout(() => {
      playSound('arrow_hit');
      addLog(`${aLabel} hits ${tLabel} with ${atk.name} (${atkBreakdown(atkResult)})`, 'hit');
      addLog(`${tLabel} is caught in ${aLabel}'s webbing! (Action + roll ≥ ${_webSave.threshold} on d100 to break free — ${_webSave.stat.toUpperCase()})`, 'alert');
      showFloatingDamage(target, 'WEBBED', '#e6e6ff');
      onSettled?.();
    }, D + FAST_ROLL_MS);
    return;
  }

  // UNIT_TYPES.sneakAttack only marks WHO has the ability (and the die size); the COUNT
  // comes from the rogue table, so Milo's sneak scales 1d6 → 10d6 with level instead of
  // sitting on the statblock's literal 1d6 forever.
  const _sneakBase = UNIT_TYPES[attacker.type]?.sneakAttack;
  const sneakDef  = _sneakBase
    ? { ..._sneakBase, dice: sneakAttackDiceForLevel(attacker.level ?? 1) }
    : null;
  const doSneak   = sneakDef && !sneakAttackUsed &&
                    hasSneakAttackCondition(attacker, target, atkResult, attackerWasHidden);

  const isCrit    = atkResult.isCrit;
  const dmgResult = rollDnDDamage(atk, dmgMod, isCrit);

  let sneakResult = null;
  if (doSneak) {
    sneakAttackUsed = true;
    sneakResult     = rollDnDDamage(sneakDef, 0, isCrit);
  }

  // performAttack resolves BOTH weapon swings and attack-roll spells (Fire Bolt), so this is
  // where "Spell damage" and "Weapon-attack damage" must not touch each other. atk.spellKey
  // is what tells them apart — the whole reason Fire Bolt stopped being a fake type:'ranged'
  // weapon. Sneak dice are deliberately outside it: they're the rogue's, not the caster's.
  const dmg      = atk.spellKey
    ? Math.max(1, applySpellDamage(attacker, dmgResult.total))
    : Math.max(1, applyWeaponDamage(attacker, dmgResult.total));
  const sneakDmg = sneakResult ? Math.max(0, sneakResult.total) : 0;
  // Crit damage (ring): flat bonus added on a crit, on top of the doubled dice. It's a value affix
  // (rolled once at drop, e.g. 1d4+1), so affixTotal sums both rings; added pre-mitigation like the
  // rest of the hit. Applies to weapon and attack-cantrip (Fire Bolt) crits alike.
  const critDmg  = isCrit ? affixTotal(attacker, 'crit_damage') : 0;
  const totalRaw = dmg + sneakDmg + critDmg;
  const resisted = damageMitigationOf(target) > 0;
  const finalDmg = applyMitigation(target, totalRaw);

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
    wakeOnDamage(target);
    _checkConcentration(target, finalDmg, willDie);

    // Life steal (gloves): the attacker heals for a % of the damage this hit dealt, via the shared
    // applyHeal choke (clamps to maxHp). Skipped if the attacker is already down.
    const lifeStealPct = affixTotal(attacker, 'life_steal_pct');
    if (lifeStealPct > 0 && finalDmg > 0 && attacker.hp > 0) {
      const stolen = applyHeal(attacker, Math.max(1, Math.round(finalDmg * lifeStealPct / 100)));
      if (stolen > 0) {
        showFloatingDamage(attacker, `+${stolen}`, '#66dd44');
        addLog(`  🩸 ${unitLabel(attacker)} drains ${stolen} HP (${lifeStealPct}% life steal)`, 'heal');
      }
    }
  }, hpUpdateDelay + RESULT_PAUSE);

  // Hit log + floating damage + damage log — after damage dice settle + reading pause
  setTimeout(() => {
    if (isCrit) {
      addLog(`${aLabel} CRITS ${tLabel} with ${atk.name}! (d100 rolled ${atkResult.kept} — auto-crit!)`, 'crit');
    } else {
      addLog(`${aLabel} hits ${tLabel} with ${atk.name} (${atkBreakdown(atkResult)})`, 'hit');
    }
    // _resolvesRanged, not `type === 'ranged'`: without it Fire Bolt would fall through to
    // sword_hit. It still plays arrow_hit, which is wrong for a bolt of flame but is the
    // sound it already had — swapping it is a separate call, not a silent side effect here.
    playSound(_resolvesRanged(atk) ? 'arrow_hit' : 'sword_hit');
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
    // The SUMMED fraction, so the float stays honest once gear mitigation stacks on top
    // of Rage — it reports what was actually taken off, not just Rage's share.
    const _mitPct = Math.round(damageMitigationOf(target) * 100);
    // ⚠ Label by SOURCE. `resisted` is damageMitigationOf > 0, which is true for GEAR alone,
    // so hardcoding "RAGE" here told Rasec/Milo/Leugren — none of whom can rage at all — that
    // their mitigation hat was Rage, and said it about Gobo when he wasn't raging either.
    const _isRage = !!(target.raging && UNIT_TYPES[target.type]?.rage);
    const _isGear = affixTotal(target, 'mitigation_pct') > 0;
    const _name   = _isRage && _isGear ? 'Rage + armor' : _isRage ? 'Rage resistance' : 'Armor';
    setTimeout(() => {
      showFloatingDamage(target, `${_isRage ? '⚔' : '🛡'} ${_name.toUpperCase()} -${_mitPct}%`,
                         _isRage ? '#ff8844' : '#88aaff');
      addLog(`  ${_isRage ? '⚔' : '🛡'} ${_name} (-${_mitPct}%): ${totalRaw} → ${finalDmg}`, 'dmg');
    }, hpUpdateDelay + RESULT_PAUSE + 500);
  }

  // An on-hit gear rider (elemental rider on the ATTACKER's neck) must STILL fire when the swing is
  // lethal — a killing blow has to show ALL its damage, rider included (the bug: Milo's ice vanished
  // silently on any kill). So when a rider will fire on a kill, DEFER the enemy's removal to the
  // rider (_resolveRider does it) so its float/effect/log land before the mesh goes. Otherwise
  // (no rider, or the spider's venom) remove on the normal beat.
  const _rider     = _onHitRiderOf(attacker);
  const _riderOnKill = !!_rider && !atk.poison;   // a gear rider shows even on a kill; venom keeps its old skip
  if (willDie && !_riderOnKill) {
    setTimeout(() => removeDefeatedUnit(target, attacker), hpUpdateDelay + RESULT_PAUSE + 400);
  }

  // Notify caller that HP is fully settled (after removeDefeatedUnit if applicable). A follow-up
  // save-and-damage — the spider's venom (enemy→hero) or a gear rider (hero→enemy) — chains AFTER
  // the swing lands, and onSettled must wait for it too: firing early would advance the turn out
  // from under the roll, the class of turn-freeze /timing-audit hunts. Venom keeps its already-dead
  // skip (see _resolvePoison); the gear rider now fires even on a kill, taking `willDie` as its
  // alreadyDead flag. The two are mutually exclusive in practice (venom is a statblock rider, the
  // gear rider reads equipment); if both ever coexist, venom wins and the gear rider is skipped.
  const _settleAt = hpUpdateDelay + RESULT_PAUSE + (willDie ? 450 : 50);

  // The tail of the chain, unchanged from before cleave existed — same branches, same +250 beat.
  // Pulled into a closure only so cleave can run AHEAD of it and hand off, keeping the "onSettled
  // fires exactly once" contract intact on every path through both stages.
  const _chainTail = () => {
    if (atk.poison && !willDie) {
      setTimeout(() => _resolvePoison(target, atk.poison, () => onSettled?.()), 250);
    } else if (_rider) {
      setTimeout(() => _resolveRider(attacker, target, _rider, willDie, () => onSettled?.()), 250);
    } else {
      onSettled?.();
    }
  };

  // Cleave (main-hand): splash a % of THIS hit onto foes near the one we struck.
  //
  // ⚠ MELEE ONLY, per the doc's wording ("melee hit splashes pct damage to foes near the target").
  // _resolvesRanged covers both halves of what must be excluded: ranged WEAPONS (an arrow doesn't
  // sweep through a crowd) and attack-roll SPELLS like Fire Bolt, whose splash is off-hand's own
  // affix with its own numbers. Note this differs from weapon_damage_pct one screen up, which the
  // user scoped to "melee or ranged" — the two main-hand stats deliberately have different reach.
  //
  // The cost: a bow hero who rolls cleave gets a dead affix, which is the same starvation problem
  // lootCoverage exists to fight. Flagged rather than silently widened — dropping !_resolvesRanged
  // is the one-word change if ranged should ricochet.
  //
  // Origin captured NOW, while the target is still on the board (see _resolveSplash); totalRaw,
  // not finalDmg, so each splashed foe takes its own mitigation cut.
  // 'melee' for a weapon swing, 'spell' for an attack-roll cantrip like Fire Bolt — the one call
  // site that can be either, since _executeAttack resolves both. atk.spellKey is the same test the
  // damage scalers split on, so a hit can never draw both splash affixes.
  const _splash = _splashAffixOf(attacker, atk.spellKey ? 'spell' : 'melee');
  // Melee cleave additionally excludes RANGED weapons (an arrow doesn't sweep a crowd); Fire Bolt
  // is a spell and is governed by the off-hand affix instead, so it is NOT excluded here.
  const _splashOk = atk.spellKey ? true : !_resolvesRanged(atk);
  if (_splash && _splashOk && dmg > 0) {
    const _origin = { x: target.grp.position.x, z: target.grp.position.z };
    // Per-foe to-hit for the sweep. The ATTACKER-side terms are the ones already computed for the
    // primary swing (same weapon, same arm, same instant) — atkMod and precisionBonus are reused
    // verbatim so a cleave can never be more or less accurate than the swing that caused it.
    // Everything DEFENDER-side is recomputed per foe: its own AC, its own ac_pct, its own dodge.
    //
    // Bless rerolls per foe because it's 1d2 PER ATTACK ROLL and each of these is its own roll.
    //
    // The primary swing's situational ADVANTAGES are deliberately not carried over: smoke, Owl's
    // Help and the hidden-attacker bonus are all relationships with the PRIMARY target, not with
    // whoever happens to be standing beside it. Dodge is, so it comes along.
    const _splashToHit = (foe) => {
      const foeACBonus = (foe.defStanceActive ? 3 : 0) + (foe.mageArmored ? 3 : 0) +
                         (_inOwnSmoke(foe) ? SMOKE_AC_BONUS : 0);
      const foeAC      = (foe.equipment ? computeAC(foe) : (UNIT_TYPES[foe.type]?.ac ?? COMBAT.defaultAC)) + foeACBonus;
      const foeBless   = blessedUnits.has(attacker) ? roll({ sides: 2 }).total : 0;
      return rollToHit(atkMod + foeBless, foeAC, unitCombatLevel(attacker), unitCombatLevel(foe),
                       foe.dodging ? 'disadvantage' : 'normal',
                       precisionBonus - affixTotal(foe, 'ac_pct'),
                       affixTotal(attacker, 'crit_chance_pct'));
    };
    // ⚠ SPLASH BASE EXCLUDES SNEAK ATTACK (user, 2026-07-18: "sneak attack does all damage on a
    // single target"). totalRaw is dmg + sneakDmg + critDmg; the sneak dice are the rogue's
    // precision strike on ONE foe, not weapon output, so they must not bleed onto the neighbours —
    // otherwise a red cleave would splash 100% of a 10d6 sneak sideways. Same principle that keeps
    // sneak out of weapon_damage_pct and spell_damage_pct. The ring's flat crit bonus stays in:
    // that IS part of the swing that landed.
    const _splashBase = dmg + critDmg;
    setTimeout(() => _resolveSplash(attacker, target, _origin, _splash, _splashBase, _splashToHit, _chainTail), _settleAt + 250);
  } else {
    setTimeout(_chainTail, _settleAt);
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
        const saveMod       = abilityModOf(hero, saveType);
        const blessSaveBonus = blessedUnits.has(hero) ? roll({ sides: 2 }).total : 0;   // Bless: +1d2 to saving throws
        const saveResult    = rollSave(saveMod + blessSaveBonus, dc, hero.dodging ? 'advantage' : 'normal', affixTotal(hero, 'saving_throw_pct'));
        // Save halves first, THEN mitigation takes its cut of what's left — so a raging
        // hero who also saves gets both. AoE was mitigated by nothing before 2026-07-16.
        const savedDmg      = saveResult.isSave ? Math.max(1, Math.floor(rawDmg / 2)) : rawDmg;
        const finalDmg      = applyMitigation(hero, savedDmg);
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
        wakeOnDamage(hero);
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
  const healed = applyHeal(hero, roll({ sides: 4, count: 1 }).total);   // soul shard: received-only
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
    const eligible = attacksOf(u)
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
  _spendHeroAction('weapon');
  hideUndoBtn();
  hideAttackTargets();
  hideTargetMarker();
  performAttack(u, tgt, atk);
  const postAtkRemaining = (speedOf(u)) - turnMovedFt;
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
  const shakeRemaining = (speedOf(u)) - turnMovedFt;
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
    const remaining = (speedOf(u)) - turnMovedFt;
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
        // Sanctuary shares the ally-ring picker but is a WARD, not a heal — castHeal would
        // reject a full-HP target, which is precisely who you most want to protect.
        const _doHeal = tgt => spellKey === 'sanctuary'
          ? castSanctuary(u, tgt)
          : castHeal(u, tgt, spellKey);
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
          const path = findPath(curU.grp.position.x, curU.grp.position.z, tx, tz);
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
            const remaining = (speedOf(curU)) - turnMovedFt;
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

const _rhVec = new THREE.Vector3();
function rayHitAnyUnit() {
  // Cheap ray-vs-unit test. The old form did _ray.intersectObject(target.grp, true) — a
  // RECURSIVE raycast against each unit's full SKINNED mesh (character rigs are thousands of
  // triangles and three.js re-skins every vertex per raycast). With a pack on screen that was
  // the ~160ms 'mousemove handler took Nms' stalls. Instead, measure the perpendicular distance
  // from the pick ray to each unit's mid-body point and take the nearest-to-camera within a
  // footprint radius — O(units) of plain math, no geometry touched.
  const ray = _ray.ray;
  let best = null, bestT = Infinity;
  for (const target of units) {
    // NPCs are built with hp = 0 ON PURPOSE (they have no stat block), so the usual
    // `hp <= 0` liveness test reads every one of them as a corpse and skipped them here —
    // which is why clicking a townsfolk or a quest-giver never selected anything.
    if (target.team !== 'npc' && target.hp <= 0) continue;
    const p = target.grp.position;
    // Mid-body point + footprint radius, both scaled by the unit's own scale so a short gnome and
    // a tall ogre are each reasonably targetable without touching geometry.
    const s = UNIT_TYPES[target.type]?.scale?.[0] ?? 1;
    _rhVec.set(p.x, p.y + 0.9 * s, p.z);
    const r = 0.9 * s + 0.4;
    if (ray.distanceSqToPoint(_rhVec) > r * r) continue;
    const tAlong = (_rhVec.x - ray.origin.x) * ray.direction.x
                 + (_rhVec.y - ray.origin.y) * ray.direction.y
                 + (_rhVec.z - ray.origin.z) * ray.direction.z;
    if (tAlong > 0 && tAlong < bestT) { bestT = tAlong; best = target; }
  }
  return best;
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

// ── Surprise / ambush ─────────────────────────────────────────────────────────
// A side that sneaks up undetected gets a SURPRISE ROUND: every unit on the OTHER side loses its
// first turn (5e surprise — see the skip in activateTurn). Either side can be the sneaker:
//   • Heroes sneak per-hero via `hero.sneaking` — set by the MOVE-widget stealth button
//     (stealthToggle.js): group move flags all four, solo move flags just the selected hero.
//   • Enemies sneak when EVERY aggro'd enemy is an ambusher (`ambush` on the statblock or unit).
// The contest is the sneaking side's Stealth (a d20 roll, the group only as quiet as its clumsiest)
// vs the other side's PASSIVE Perception (10 + best WIS + perception gear — no roll). This is where
// the cloak's stealth_pct and perception_pct affixes finally do work.

// d100 spot check — the SAME percentage engine as rollToHit/rollSave. A DETECTOR (perception) tries
// to notice a SNEAKER (stealth): perceptionMod/stealthMod are the WIS/DEX ability mods, the cloak
// affixes net as percentage POINTS (perception% raises the chance, stealth% lowers it — exactly like
// hit% vs ac%), and extraPct folds in flat modifiers like distance. Clamped 5–95.
function spotChance(perceptionMod, stealthMod, percPct = 0, stealthPct = 0, extraPct = 0) {
  const raw = ((perceptionMod + 20 - (10 + stealthMod)) / 20) * 100 + percPct - stealthPct + extraPct;
  return Math.round(Math.max(5, Math.min(95, raw)));
}
// Roll d100 against a spot chance. Mirrors rollToHit: a high roll spots (>= 100 − chance).
function _rollSpot(chance) {
  const roll = Math.floor(Math.random() * 100) + 1;
  return { chance, roll, spotted: roll >= (100 - chance) };
}
// A hero's stealth STRENGTH in percentage points — DEX mod ×5 (the d20→d100 scale) + stealth gear.
// Shrinks enemy detection radius on the approach (precombat sneakDetectMult).
export function heroStealthPct(u) {
  return abilityModOf(u, 'dex') * 5 + affixTotal(u, 'stealth_pct');
}
// A unit's total perception / stealth in % points (WIS/DEX mod ×5 + gear).
const _percTotal    = u => abilityModOf(u, 'wis') * 5 + affixTotal(u, 'perception_pct');
const _stealthTotal = u => abilityModOf(u, 'dex') * 5 + affixTotal(u, 'stealth_pct');
// spotChance straight from those totals: 50% at parity, shifting 1:1. (Algebraically identical to
// spotChance() — perceptionMod×5+percPct − (stealthMod×5+stealthPct) + 50.) Used per-enemy below.
function _spotChanceFromTotals(percTotal, stealthTotal) {
  return Math.round(Math.max(5, Math.min(95, 50 + percTotal - stealthTotal)));
}
// The party's stealth level for round-1 LATE-JOINER spot checks after a won surprise — a straggler
// that wanders into the fight still has to notice the party. null when no surprise is active; set by
// _determineSurprise and read (round 1 only) by _checkProximityAggro.
let _surpriseStealth = null;

// Decide surprise at combat start. A side that slips past the other's spot check surprises it —
// every unit on the caught-out side gets `surprised` (loses its first turn). Consumes the sneak.
function _determineSurprise() {
  const heroes  = units.filter(u => u.team === 'blue' && u.hp > 0);
  const enemies = units.filter(u => u.team === 'red'  && u.hp > 0 && u.aggro !== false);
  if (!heroes.length || !enemies.length) { heroes.forEach(h => setUnitSneaking(h, false)); return; }

  const sneakers        = heroes.filter(h => h.sneaking);   // solo move flags one; group flags all
  const heroesSneaking  = sneakers.length > 0;
  const ambushers       = enemies.filter(e => UNIT_TYPES[e.type]?.ambush || e.ambush);
  const enemiesSneaking = ambushers.length === enemies.length && enemies.length > 0;   // whole side ambushes
  const avg = arr => arr.reduce((s, x) => s + x, 0) / arr.length;
  _surpriseStealth = null;
  heroes.forEach(h => setUnitSneaking(h, false));   // the sneak attempt is spent (also clears the look)

  // PER-UNIT rolls (user's call): each member of the DETECTING side rolls its OWN Perception vs the
  // sneaking side's AVERAGE stealth. Only those who FAIL to notice are surprised — so a mixed result
  // is possible (some caught off guard, some spot you and act). Logged one line each.
  const resolve = (detectors, stealthVal, verb) => {
    let caught = 0;
    for (const d of detectors) {
      const r = _rollSpot(_spotChanceFromTotals(_percTotal(d), stealthVal));
      addLog(`${unitLabel(d)} Perception: ${r.chance}% to ${verb}, rolled ${r.roll} → ${r.spotted ? 'SPOTTED!' : 'surprised'}.`, 'move');
      if (!r.spotted) { d.surprised = true; caught++; }
    }
    return caught;
  };

  if (heroesSneaking) {
    const partyStealth = avg(sneakers.map(_stealthTotal));
    addLog(`The party sneaks up (avg Stealth +${Math.round(partyStealth)}%) — each enemy rolls Perception:`, 'move');
    const caught = resolve(enemies, partyStealth, 'notice the party');
    if (caught > 0) {
      _surpriseStealth = partyStealth;   // arm late-joiner spot checks for round 1
      // A clean sneak carries MILO into the fight still hidden (his removed OOC hide's job) — only
      // Milo, since Sneak Attack is his; stealth carries as hideDexMod/hideStealthPct for the
      // in-combat spot checks (_checkHidePerception).
      const milo = sneakers.find(h => h.type === 'halfling');
      if (milo) { milo.hideDexMod = abilityModOf(milo, 'dex'); milo.hideStealthPct = affixTotal(milo, 'stealth_pct'); setUnitStealth(milo, true); }
      showCenterAlert('SURPRISE ROUND!', '#88cc66');
      const s = enemies.filter(e => e.surprised);
      addLog(`SURPRISE ROUND! ${s.map(unitLabel).join(', ')} surprised — ${s.length === 1 ? 'it skips' : 'they skip'} the first round.`, 'alert');
    } else {
      addLog('The whole enemy group noticed you — no surprise.', 'move');
    }
  } else if (enemiesSneaking) {
    const enemyStealth = avg(ambushers.map(_stealthTotal));
    addLog(`The enemy ambushes (avg Stealth +${Math.round(enemyStealth)}%) — each hero rolls Perception:`, 'move');
    const caught = resolve(heroes, enemyStealth, 'spot the ambush');
    if (caught > 0) {
      showCenterAlert('AMBUSH!', '#ff4400');
      const s = heroes.filter(h => h.surprised);
      addLog(`AMBUSH! ${s.map(unitLabel).join(', ')} surprised — ${s.length === 1 ? 'it skips' : 'they skip'} the first round.`, 'alert');
    }
  }
}

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
    if (u.type === 'human')    {
      u.defStanceActive = false; u.defStanceRounds = 0; u.defStanceCooldown = 0;
      u.reckless = false;                        // Reckless Attack (L6) — declared per turn
    }
    // Turn Undead (L5) is Channel Divinity: ONE charge per combat, not a spell slot.
    if (u.type === 'dwarf')    { u.turnUndeadUses = 1; }
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
    u.surprised = false;   // cleared each combat; _determineSurprise re-sets the losing side below
    // mageArmored is intentionally NOT reset — persists until long rest
    const def    = UNIT_TYPES[u.type] ?? {};
    // Initiative is DEX-driven, so a +2 DEX wrist has to move it — leaving this on the static
    // score would mean the same gear helped your attacks and AC but not your initiative.
    const dexMod = abilityModOf(u, 'dex');
    const bonus  = (def.initiative ?? COMBAT.defaultInitiative) + dexMod + affixTotal(u, 'initiative_bonus');
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
  _determineSurprise();     // stealth vs perception → sets `surprised` on the ambushed side
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
  // Label via unitLabel (spawn-order "Goblin N") — the SAME scheme the combat log and HUD use, so a
  // given goblin has ONE number everywhere. Display is still sorted by initiative, so the panel can
  // read "Goblin 3, Goblin 1, Goblin 2" top-to-bottom — the numbers are stable IDs, not the order.
  const entries = turnOrder
    .map((u, i) => (u.team === 'red' && !u.aggro) ? null : { u, i, label: unitLabel(u) })
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
    // Closed eye = hasn't noticed the fight and will lose its first turn. Same SVG as the overhead
    // label, so the two markers are self-evidently the same state. Applies to heroes too — an
    // AMBUSH surprises the party, and the panel should say so on their rows as well.
    const surpriseTag = u.surprised
      ? `<span class="turn-surprise-tag" title="Surprised — loses its first turn">${SURPRISE_EYE_SVG}</span>` : '';
    el.innerHTML  =
      `<div class="turn-hpbar-wrap"><div class="turn-hpbar" style="width:${hpPct}%;background:${barColor}"></div></div>` +
      `<span class="turn-name"${color ? ` style="color:${color}"` : ''}>${label}${surpriseTag}${readyTag}${arrowTag}</span>` +
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

// Arm a readied action for `hero` on `trigger`. Extracted from the modal's click handler so a
// dragged hotbar shortcut arms it through EXACTLY the same path — the two must not drift about
// what "readied" means (turnAttacked, the bonus-action snapshot, the turn-list tag).
//
// `endTurn` is the one difference between the two callers, and it's the user's spec:
//   • modal      → false. Arming spends the ACTION, not the turn; the player still clicks End Turn.
//   • hotbar btn → true.  The shortcut's whole point is one click = "ready this and pass".
function _armReadyAction(hero, trigger, { endTurn = false } = {}) {
  if (!hero || !trigger) return false;
  _readied.set(hero, trigger);
  _readiedBonusActioned.set(hero, turnBonusActioned);
  turnAttacked = true;
  addLog(`${unitLabel(hero)} readies action: trigger "${_READY_LABELS[trigger]}"`, 'ready');
  buildTurnList();
  updateCombatStatus();
  _rebuildHotbar(hero);
  endTurnBtn.disabled = false;
  if (endTurn) doEndTurn();
  return true;
}

// ── First-open tutorial for the Ready Action window ──────────────────────────
// Modelled on the short-rest first-death arrow (js/shortRest.js): a bobbing label + arrow
// pointing at the thing you're being taught about.
//
// PER HERO, not once globally (user, 2026-07-18) — the shortcut is assigned per hero, so each
// one has their own first time. Leugren learning it doesn't teach you Milo's bar.
const LS_RA_TUT_KEY = 'dnd_ra_tutorial_seen';

function _raTutSeen() {
  try { return JSON.parse(localStorage.getItem(LS_RA_TUT_KEY) ?? '[]'); } catch { return []; }
}
function _markRaTutSeen(type) {
  try {
    const seen = _raTutSeen();
    if (!seen.includes(type)) localStorage.setItem(LS_RA_TUT_KEY, JSON.stringify([...seen, type]));
  } catch {}
}

// Torn down on every close so it can't outlive the modal it points at — the modal is a single
// shared element, so a leftover tip would reappear over the NEXT hero's window.
function _hideReadyTutorial() {
  document.getElementById('ra-tutorial')?.remove();
}

function _maybeShowReadyTutorial(hero, modal) {
  _hideReadyTutorial();
  if (!hero || _raTutSeen().includes(hero.type)) return;
  const el = document.createElement('div');
  el.id = 'ra-tutorial';
  el.innerHTML =
    `<div class="ra-tut-label">Shift + Left-Click drag a trigger<br>onto your hotbar for one-click ready</div>` +
    `<div class="ra-tut-arrow">▼</div>`;
  modal.appendChild(el);
  // Marked on OPEN rather than on use: the ask was "the first time the window is opened by
  // each hero", and unlike the rest tutorial there's no single action that proves it landed —
  // dragging is optional, and a hero who only ever uses the modal shouldn't be nagged forever.
  _markRaTutSeen(hero.type);
}

// Shared close. Every path uses it — picking a trigger, Cancel, and the hotbar drop over in
// ui.js — so none of them can hide the modal while leaving the tutorial nag floating over
// where it used to be.
export function closeReadyModal() {
  _hideReadyTutorial();
  const modal = document.getElementById('ready-action-modal');
  if (modal) modal.style.display = 'none';
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
      closeReadyModal();
      // Arming a ready action ends the hero's main action but not their turn — they still
      // click End Turn themselves. (The dragged hotbar shortcut passes endTurn:true instead.)
      _armReadyAction(hero, btn.dataset.trigger, { endTurn: false });
    };
  });
  document.getElementById('dam-cancel-btn').onclick = closeReadyModal;
  modal.style.display = 'flex';
  _maybeShowReadyTutorial(hero, modal);
}

// Longest range (world units) at which this hero threatens an enemy right
// now — the greater of their ranged weapon (if any) and any offensive
// cantrip/spell they've unlocked (Fire Bolt, Sacred Flame, Magic Missile,
// Burning Hands, etc.). Heal/support spells (healing_word, cure_wounds,
// bless, mage_armor — no rangeFt, or healDice present) don't count, since
// they don't threaten an enemy. Returns null if the hero has no ranged
// option at all (pure melee).
function _heroRangedRangeWU(hero) {
  const heroAtks  = attacksOf(hero);
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
  return maxFt > 0 ? projRangeWU(maxFt, hero) : null;
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
    const heroAtks = attacksOf(hero);

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
    _extraAttacksLeft = 0; _extraCastsLeft = 0;   // a readied action is a single reaction — no flurry
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
  _extraAttacksLeft = 0; _extraCastsLeft = 0;   // a readied action is a single reaction — no flurry
  // A readied action is a reaction — it grants NO movement (only an action/bonus/
  // reaction). Max out turnMovedFt so every "remaining movement" calc
  // (postAtkRemaining = speed - turnMovedFt, and the equivalent in spell handlers)
  // resolves to 0, keeping the hero out of move mode after they act.
  turnMovedFt       = speedOf(hero);
  turnBonusActioned = _readiedBonusActioned.get(hero) ?? false;
  _readiedBonusActioned.delete(hero);
  heroMode          = null;

  endTurnBtn.disabled = false;

  // Move active ring to this hero with their ring colour
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
  const remaining = (speedOf(u)) - turnMovedFt;
  if (remaining > 0) showMoveRange(u);
}

function _endDelayInterrupt() {
  clearTimeout(_readyAutoCloseTimer);
  _readyAutoCloseTimer = null;
  if (!_readyCtx) return;
  const saved = _readyCtx;
  const { savedIdx, savedHeroMode, savedAttacked, savedMovedFt, savedBonusActioned,
          savedRingX, savedRingZ, savedRingColor, savedRingVisible, cont } = _readyCtx;
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
// ── Party-wide buff availability ──────────────────────────────────────────────
// True when EVERY living hero already carries a group buff — i.e. casting it again would do
// nothing for anybody. Group buffs grey out on this (user's rule, 2026-07-18): they become
// available again only once the buff has actually dropped off someone.
//
// Takes a PREDICATE rather than hardcoding Bless, so the next party-wide buff reuses it
// instead of growing a second copy of the rule.
//
// ⚠ Per-HERO, deliberately — NOT "is the buff active at all". A hero revived by a short rest
// after Bless was cast is unblessed while everyone else still has it, and re-casting to cover
// them is legitimate. The automated path used to test `blessedUnits.size > 0`, which called
// that "already active" and left the revived hero permanently unblessed for the fight.
//
// Empty party returns false (nothing to buff, but nothing "fully buffed" either) — the caller's
// other guards handle that case.
function _allLivingHeroesHave(pred) {
  const living = units.filter(u => u.team === 'blue' && u.hp > 0);
  return living.length > 0 && living.every(pred);
}

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
      const _atks   = attacksOf(curU);
      const _meleeA  = _atks.find(a => a.type === 'melee');
      const _rangedA = _atks.find(a => a.type === 'ranged');
      const inRange = (_meleeA && dst <= atkTriggerWU(_meleeA)) ||
                      (_rangedA && dst <= projRangeWU(_rangedA.range, curU) &&
                       unitsHaveLOS(curU, selectedTarget));
      if (!inRange) return false;
      return _allyAdjacentToTarget(curU, selectedTarget) || _isHiddenForSneak(curU);
    },
  },
  hide: {
    actionType: 'bonus',
    // Combat only: Milo's Hide bonus action (sets up Sneak Attack). Out of combat he sneaks via the
    // MOVE-widget Stealth button (solo move) — that folded in his old scouting hide, and a WON sneak
    // carries him into the fight already hidden (see _determineSurprise), so his opener is preserved.
    execute: () => { if (combatPhase) activateHide(); },
    isAvailable: () => {
      if (!combatPhase) return false;
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
      if (!hasSpellSlot(curU, spellLevelOf('cure_wounds'))) return false;
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
      const rangeWU = projRangeWU(SPELLS.sacred_flame.rangeFt, curU);
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
      _spendHeroAction('spell');
      hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
      performAttack(curU, tgt, FIRE_BOLT_ATK);
      const postAtkRemaining = (speedOf(curU)) - turnMovedFt;
      if (postAtkRemaining > 0) { heroMode = 'move'; showMoveRange(curU); }
      else { heroMode = null; }
      updateCombatStatus();
    },
    isAvailable: () => {
      if (!selectedTarget || turnAttacked || selectedTarget.hp <= 0) return false;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf') return false;
      const atk = FIRE_BOLT_ATK;
      const dx = selectedTarget.grp.position.x - curU.grp.position.x;
      const dz = selectedTarget.grp.position.z - curU.grp.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      return dist <= projRangeWU(atk.range, curU) &&
             unitsHaveLOS(curU, selectedTarget);
    },
  },
  bless: {
    actionType: 'action',
    execute: () => handleSpellBtnClick('bless'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked) return false;
      if (!hasSpellSlot(curU, spellLevelOf('bless'))) return false;
      // Greyed while the WHOLE party already has it — see _allLivingHeroesHave.
      return !_allLivingHeroesHave(u => blessedUnits.has(u));
    },
  },
  mage_armor: {
    actionType: 'action',
    execute: () => activateMageArmor(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf' || turnAttacked) return false;
      if (!hasSpellSlot(curU, spellLevelOf('mage_armor'))) return false;
      return !curU.mageArmored;
    },
  },
  magic_missile: {
    actionType: 'action',
    execute: () => handleElfSpellBtnClick('magic_missile'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf' || turnAttacked) return false;
      if (curU.mmFreeUsed && !hasSpellSlot(curU, spellLevelOf('magic_missile'))) return false;
      if (!selectedTarget || selectedTarget.hp <= 0) return false;
      const rangeWU = projRangeWU(ELF_SPELLS.magic_missile.rangeFt, curU);
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

  // ── L5–L7 abilities (2026-07-20) ────────────────────────────────────────────
  // Rasec. Both are caster-centred AoEs, so unlike sacred_flame/magic_missile neither
  // needs a selectedTarget — they only need a slot and an unspent action.
  sleep: {
    actionType: 'action',
    execute: () => handleElfSpellBtnClick('sleep'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf' || turnAttacked || isAnimating) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'sleep')) return false;
      return hasSpellSlot(curU, spellLevelOf('sleep'));
    },
  },
  burning_hands: {
    actionType: 'action',
    execute: () => handleElfSpellBtnClick('burning_hands'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'elf' || turnAttacked || isAnimating) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'burning_hands')) return false;
      return hasSpellSlot(curU, spellLevelOf('burning_hands'));
    },
  },

  // Gobo. Reckless Attack costs NO action in 5e — it's a decision made as you swing — so
  // actionType is 'free': it deliberately matches no entry in _sbActionTagHTML's map and
  // renders no A/BA badge, and it never touches turnAttacked/turnBonusActioned. The cost is
  // the drawback, not the economy: every attack against Gobo has advantage until his next turn.
  reckless_attack: {
    actionType: 'free',
    execute: () => activateRecklessAttack(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'human' || isAnimating) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'reckless_attack')) return false;
      // Declared BEFORE swinging — once the action is spent the choice is moot.
      return !curU.reckless && !turnAttacked;
    },
    isActive: u => !!u.reckless,
  },

  // Leugren. Turn Undead spends no slot (level 0) — its cost is the per-combat charge.
  turn_undead: {
    actionType: 'action',
    execute: () => activateTurnUndead(),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnAttacked || isAnimating) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'turn_undead')) return false;
      if ((curU.turnUndeadUses ?? 0) <= 0) return false;
      // Grey it out when nothing undead is in reach rather than letting the player
      // burn the combat's only charge on an empty room.
      return _undeadInTurnRange(curU).length > 0;
    },
  },
  sanctuary: {
    actionType: 'bonus',
    // Manual play PICKS the ward: this enters 'spell_sanctuary' mode and lights the green ally
    // rings, and the click resolver casts on whoever is clicked. Only the automated path
    // auto-selects (activateSanctuary) — see castSanctuary.
    execute: () => handleSpellBtnClick('sanctuary'),
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.type !== 'dwarf' || turnBonusActioned || isAnimating) return false;
      if (!isAbilityUnlocked(curU.type, curU.level, 'sanctuary')) return false;
      if (!hasSpellSlot(curU, spellLevelOf('sanctuary'))) return false;
      return _sanctuaryTargetsFor(curU).length > 0;
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
// The spare slots added when the bar was widened. They carry no fixed role (unlike
// Digit2..Digit5) and no permanent binding (unlike Backquote/Tab, which are assignable
// but hold NEXT HERO / NEXT TARGET), so they start empty and are safe to unbind wholesale
// on a hero switch — see the pc-hero:selected handler.
//
// ⚠ The two digits SWAPPED here (user, 2026-07-18: potion moved 6 → 8).
//   • Digit8 was REMOVED — it now holds the healing potion. Leaving it would let a drag-drop
//     park an ability on top of the potion, and the hero-switch unbind would wipe the
//     potion's binding outright.
//   • Digit6 was ADDED — freed by the move, and an unassignable empty slot would just be dead
//     space. Safe because AUTO_FILL_SLOTS is QWERTY-only (Q→Y), so making a DIGIT assignable
//     cannot change where existing heroes' abilities auto-land; it only opens it to drag-drop,
//     exactly like Digit7 beside it.
const SPARE_SLOTS = ['Digit6', 'Digit7', 'KeyU'];
const _ASSIGNABLE_SLOTS = new Set(['Backquote', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'Tab', 'KeyY', 'KeyT',
                                   ...SPARE_SLOTS]);

// The QWERTY letter-row slots the auto-assigner fills, in order (Q→W→E→R→T→Y).
// KeyU is deliberately NOT here: it's drag-drop only, so widening the bar didn't
// silently change where level-up abilities land for existing heroes.
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
// ── Readied-trigger hotbar shortcuts ─────────────────────────────────────────
// A trigger dragged out of the Ready Action window becomes the ability key
// `ready:<trigger>` (e.g. `ready:ally_loses_hp`). One click on that slot arms THAT trigger and
// ends the turn, skipping the modal entirely.
//
// Handlers are SYNTHESISED per trigger rather than written into _ABILITY_HANDLERS, because the
// set is data — it's whatever _READY_LABELS holds, and adding a trigger there should not also
// require adding a handler here. The prefix is what keeps them out of the auto-assigner too:
// AUTO_FILL only ever names real ability keys, so these are drag-only by construction.
const READY_PREFIX = 'ready:';
export const isReadyAbilityKey = k => typeof k === 'string' && k.startsWith(READY_PREFIX);
const _readyTriggerOf = k => (isReadyAbilityKey(k) ? k.slice(READY_PREFIX.length) : null);

function _readyAbilityHandler(abilityKey) {
  const trigger = _readyTriggerOf(abilityKey);
  if (!trigger || !_READY_LABELS[trigger]) return null;
  return {
    actionType: 'action',
    execute: () => {
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue' || isAnimating || turnAttacked || _readyCtx) return;
      if (_saveLocksTurn(curU)) return;
      // A trigger that can never fire would strand the hero: they'd ready, wait, and never act.
      // _triggerViable is the same guard the automated picker uses (owl_helped with a dead owl).
      if (!_triggerViable(trigger)) {
        addLog(`${unitLabel(curU)} can't ready "${_READY_LABELS[trigger]}" right now.`, 'alert');
        return;
      }
      _armReadyAction(curU, trigger, { endTurn: true });
    },
    isAvailable: () => {
      const curU = turnOrder[turnIndex];
      return !!curU && curU.team === 'blue' && !isAnimating && !turnAttacked && !_readyCtx &&
             !_saveLocksTurn(curU) && _triggerViable(trigger);
    },
  };
}

// Every consumer of an ability key goes through here, so a `ready:` slot behaves like any
// other assigned ability — bind, rebuild, persist, grey-out.
function _abilityHandlerFor(abilityKey) {
  return _ABILITY_HANDLERS[abilityKey] ?? _readyAbilityHandler(abilityKey);
}

// Label for a ready shortcut's button. Deliberately GENERIC — "Ready Trigger", not the trigger's
// own name (user, 2026-07-18). Trigger labels are full sentences ("Ally enters enemy melee
// range") and a hotbar cell can't carry one legibly; the tooltip names the specific trigger, so
// nothing is lost. Slots holding different triggers therefore look alike — hover to tell them
// apart, which is the trade the user chose.
function _abilityIconHTML(abilityKey) {
  const trigger = _readyTriggerOf(abilityKey);
  if (!trigger) return hotbarIconHTML(abilityKey);
  return `<span class="hb-ready-trigger">⚡ READY<br>TRIGGER</span>`;
}
function _abilityTitle(abilityKey) {
  const trigger = _readyTriggerOf(abilityKey);
  return trigger
    ? `Ready Action — ${_READY_LABELS[trigger] ?? trigger} (arms it and ends your turn)`
    : ABILITY_META[abilityKey]?.name;
}

function _bindAbilitySlot(slotKey, abilityKey) {
  const handler = _abilityHandlerFor(abilityKey);
  if (!handler) return;
  const btn = bindHotkey(slotKey, false, _abilityIconHTML(abilityKey), handler.execute, handler.isAvailable, handler.actionType, _abilityTitle(abilityKey));
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
  _abilityHandlerFor(abilityKey)?.execute();
}

// Shared by the hotbar (bindHotkey's actionType param) and the Skills &
// Spells window, so both show the same A/BA/R tag for a given ability.
export function getAbilityActionType(abilityKey) {
  return _abilityHandlerFor(abilityKey)?.actionType ?? null;
}

// Whether an ability could be used right now (turn state, cooldowns, range,
// etc. — same guard each handler's own execute() re-checks). Used by the
// Skills & Spells window to grey out boxes for the currently active hero.
export function isAbilityAvailableNow(abilityKey) {
  // Still tangled in webbing — struggling was the whole turn. Everything greys out.
  const _cu = turnOrder[turnIndex];
  if (_saveLocksTurn(_cu) && abilityKey !== 'action_save') return false;
  return _abilityHandlerFor(abilityKey)?.isAvailable?.() ?? true;
}

// Called from the Skills & Spells window's shift-click-drag-drop — assigns
// (or overwrites) one ability onto one hotbar slot for a specific hero.
export function assignHotbarSlot(hero, slotKey, abilityKey) {
  if (!hero || !_ASSIGNABLE_SLOTS.has(slotKey) || !_abilityHandlerFor(abilityKey)) return false;
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
  const _attacks    = attacksOf(u);
  const firstMelee  = _attacks.find(a => a.type === 'melee');
  const firstRanged = _attacks.find(a => a.type === 'ranged');
  if (firstMelee) {
    bindHotkey('Digit2', false, firstMelee.name.toUpperCase(), () => {
      if (!selectedTarget || turnAttacked || isAnimating) return;
      const curU = turnOrder[turnIndex];
      if (!curU || curU.team !== 'blue') return;
      const tgt = selectedTarget;
      _spendHeroAction('weapon');
      hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
      performAttack(curU, tgt, firstMelee);
      const postAtkRemaining = (speedOf(curU)) - turnMovedFt;
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
      _spendHeroAction('weapon');
      hideUndoBtn(); hideAttackTargets(); hideTargetMarker();
      performAttack(curU, tgt, firstRanged);
      const postAtkRemaining = (speedOf(curU)) - turnMovedFt;
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
      return dist <= projRangeWU(firstRanged.range, curU) &&
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
    bindHotkey('Digit8', false,
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

  // The hotbar was just torn down and rebuilt, taking any tutorial arrow with it. Re-show it if
  // this hero is the one held — this is the path that actually lands the tip, since the grab
  // happens on the ENEMY's turn when no hero hotbar exists yet.
  if (u.team === 'blue' && u.actionSave) _maybeShowSaveTutorial();

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
          `<span class="hb-save-dc">${s.stat.toUpperCase()} · d100 ≥ ${s.threshold}</span></span>`
        : `<span class="hb-save-throw hb-save-idle">SAVING<br>THROW</span>`,
      () => {
        const curU = turnOrder[turnIndex];
        if (curU !== u || !u.actionSave) return;
        _markSaveTutorialSeen();   // pressing it IS the lesson
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
  // Grant additional spell slots when leveling up. syncSlotsToLevel adds only the
  // per-level DELTA to what's remaining — crossing a D&D roam group mid-fight hands over the
  // new slots without refilling the ones already spent, same as the old code did.
  syncSlotsToLevel(hero);
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
  // Clear the previous hero's bindings before laying down this one's. SPARE_SLOTS are
  // included: they're drag-drop targets like the QWERTY row, so without this an ability
  // dropped on 7/8/U for one hero would still be sitting there after switching to another.
  // Backquote/Tab are deliberately NOT cleared — they hold permanent NEXT HERO / NEXT
  // TARGET bindings that unbindHotkey would happily destroy.
  for (const slot of [...AUTO_FILL_SLOTS, ...SPARE_SLOTS]) unbindHotkey(slot, false);
  for (const [slotKey, abilityKey] of Object.entries(hero.hotbarSlots ?? {})) {
    _bindAbilitySlot(slotKey, abilityKey);
  }
  updateHotkeyRanges();
});

export function activateTurn(index) {
  if (window.__turnTiming) {
    const _n = turnOrder[index];
    _dbgLog('START', _n ? (UNIT_TYPES[_n.type]?.name ?? _n.type) : '?');
  }
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
    updateConformingRingGeo(activeRing, u.grp.position.x, u.grp.position.z);
    activeRing.position.set(u.grp.position.x, 0, u.grp.position.z);
    activeRing.material.color.set(u.team === 'red' ? COLORS.activeRing : u.familiar ? 0xc9a0e6 : (HERO_RING_COLORS[u.type] ?? COLORS.activeRing));
    activeRing.visible    = !unawareEnemy;
    showSelectionHighlight(u);
    turnMovedFt     = 0;
    turnAttacked    = false;
    // Gloves extras for THIS hero's turn (enemies use their own multiattack, so never granted here).
    _extraAttacksLeft = (u.team === 'blue') ? affixTotal(u, 'attack_speed') : 0;
    _extraCastsLeft   = (u.team === 'blue') ? affixTotal(u, 'cast_speed')   : 0;
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
    const _attacks = attacksOf(u);
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
    // Reckless Attack lasts "until the start of your next turn" — so it expires HERE, at the
    // top of Gobo's turn, after every enemy in the round has had its shot at the opening.
    if (u.type === 'human' && u.reckless) {
      u.reckless = false;
      addLog(`${unitLabel(u)} drops his reckless guard.`, 'move');
    }

    turnBonusActioned = false;
    _rebuildHotbar(u);
    // Apply each slot's greyed/enabled state immediately — without this, a
    // freshly-bound slot whose rangeFn depends on nothing else the player is
    // about to click (e.g. Digit8's potion check) stays visually "enabled"
    // until some unrelated action happens to call updateCombatStatus().
    updateHotkeyRanges();

    if (combatPhase) {
      heroMode = null;
      // A SURPRISED unit loses its whole first turn (5e surprise) — no move, no action. One-shot:
      // cleared here so it acts normally next round. Applies to heroes AND enemies, whoever the
      // pre-combat stealth/perception contest caught off guard (_determineSurprise).
      if (u.surprised) {
        u.surprised = false;
        clearAllHotkeys();          // blank the just-built hotbar so a surprised hero can't sneak an action in
        endTurnBtn.disabled = true; // and can't end early either — the auto-end below owns it
        addLog(`${unitLabel(u)} is surprised and loses its turn!`, 'alert');
        showFloatingDamage(u, 'SURPRISED', '#ffcc44');
        document.getElementById('turn-round').textContent = `Round ${round}`;
        buildTurnList();            // drop this unit's closed-eye tag now that it has spent its surprise
        updateCombatStatus();
        setTimeout(() => doEndTurn(), spd(1000));
        return;
      }
      if (u.team === 'red') {
        // An enemy held by a turn-locking action-save has no UI to click, so it spends its
        // Action on the save itself and then ends the turn. Handing it to runAITurn would
        // have it try to move/attack with an Action it cannot use, and could hang the round.
        if (u.dormant) {
          setTimeout(() => doEndTurn(), 60);
        } else if (_saveLocksTurn(u)) {
          setTimeout(() => { _attemptActionSave(u); setTimeout(() => doEndTurn(), spd(900)); }, spd(300));
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
          setTimeout(() => { _attemptActionSave(u); setTimeout(() => doEndTurn(), spd(1100)); }, spd(400));
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
// CR ≤1 all map to effective level 1; CR 2+ map 1:1 — which is what the old comment here
// always claimed, but NOT what the code did.
//
// ⚠ THIS WAS DEAD. It used to be `_XP_TO_EFF = {25:1, 50:1, 100:1, 200:1, 450:2, ...}` keyed
// on xpReward — but those are D&D's RAW xp values, and we store the compressed scale
// (5/10/20/40/90/...). The two sets intersected on exactly ONE enemy out of 58 (morvath at
// 100), so `?? 1` fired for everyone and EVERY enemy resolved to effective level 1. The
// dynamic aggro radius has never scaled. Reading CR directly is both the fix and the point:
// CR is the source of truth, XP derives from it, so nothing should key off XP.
function _effLevelOf(type) {
  const cr = ENEMY_CR[type] ?? 0;
  return cr <= 1 ? 1 : Math.ceil(cr);
}

function _partyHeroLevel() {
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  if (!heroes.length) return 1;
  return Math.round(heroes.reduce((s, h) => s + (h.level ?? 1), 0) / heroes.length);
}

function _dynamicAggroRangeWU(u, def) {
  const baseWU   = u.detectRange ?? def.detect ?? 20;
  const tierDiff = Math.ceil(_partyHeroLevel() / 5) - (_effLevelOf(u.type) + 4);
  if (tierDiff < 0) return baseWU;
  return baseWU * Math.max(0, 1 - (tierDiff + 1) / 5);
}

// ── Proximity aggro (triggered after each hero move step) ─────────────────────

// True if any OTHER live member of u's roam group has already joined the fight. A roam group
// travels as one and fights as one, so the rest come in with it — routed through the
// late-joiner path below rather than _alertRoamGroup so each gets a real initiative roll
// and turn-order slot instead of a bare aggro flag mid-combat.
function _roamGroupAlreadyFighting(u) {
  if (!roamGroupKey(u)) return false;
  return units.some(o => o !== u && o.team === 'red' && o.hp > 0 &&
                         o.aggro && roamGroupKey(o) === roamGroupKey(u));
}

function _checkProximityAggro(hero) {
  let anyNew  = false;
  let changed = true;
  while (changed) {          // re-pass so a roam group-mate pulled in can pull in the next
    changed = false;
    for (const u of units) {
      if (u.team !== 'red' || u.aggro || u.hp <= 0) continue;
      const def   = UNIT_TYPES[u.type] ?? {};
      const range = _dynamicAggroRangeWU(u, def);
      const dx    = hero.grp.position.x - u.grp.position.x;
      const dz    = hero.grp.position.z - u.grp.position.z;
      // In range AND actually able to see the hero — a creature can't aggro a party it has no
      // line of sight to (through a wall or a hill), matching the precombat aggro gate. LOS is
      // tested AFTER the cheap range test (it costs a terrain walk + prop raycast). The roam-group
      // clause is untouched: group-mates still pile in with their leader regardless of sight line.
      const inSight = dx * dx + dz * dz <= range * range && unitsHaveLOS(u, hero);
      if (!inSight && !_roamGroupAlreadyFighting(u)) continue;

      changed = true;
      u.aggro = true;
      _dungeonAwareEnemies.add(u);
      u.grp.visible = true;

      // Re-roll initiative and re-slot after the current hero's position
      const dexMod    = abilityModOf(u, 'dex');   // gear-aware, same as rollInitiative
      const initBonus = (def.initiative ?? COMBAT.defaultInitiative) + dexMod + affixTotal(u, 'initiative_bonus');
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

      // Late-joiner in a WON surprise round 1: it still has to notice the party. Roll ITS Perception
      // vs the party's stealth; a fail means it wandered in caught off guard → surprised too (skips its
      // upcoming turn, same as the initial group). Only in round 1, only while a surprise is armed.
      if (round === 1 && _surpriseStealth != null) {
        const r = _rollSpot(_spotChanceFromTotals(_percTotal(u), _surpriseStealth));
        if (!r.spotted) {
          u.surprised = true;
          addLog(`⚠ ${unitLabel(u)} wanders into the fight but is surprised (Perception ${r.chance}%, rolled ${r.roll})!`, 'alert');
        } else {
          addLog(`⚠ ${unitLabel(u)} is alerted by the heroes! (spots you — Perception ${r.chance}%, rolled ${r.roll})`, 'alert');
        }
      } else {
        addLog(`⚠ ${unitLabel(u)} is alerted by the heroes! (Initiative ${u.initiative})`, 'alert');
      }
      anyNew = true;
    }
  }
  if (anyNew) buildTurnList();
}

// TEMP turn-timing probe (window.__turnTiming = true to enable). Remove once the
// "long pause after Milo" delay is located. Logs the wall-clock gap between one turn
// ending and the next unit actually acting, so we can see WHERE the dead time is.
let _dbgEndTs = 0, _dbgEndWho = '';
function _dbgLog(tag, who) {
  if (!window.__turnTiming) return;
  const now = performance.now();
  const gap = _dbgEndTs ? Math.round(now - _dbgEndTs) : 0;
  console.log(`[turn-timing] ${tag} ${who}  (+${gap}ms since ${_dbgEndWho || '?'} ended)`);
}

function doEndTurn() {
  if (!combatPhase) return;
  if (window.__turnTiming) {
    const _c = turnOrder[turnIndex];
    _dbgEndTs = performance.now(); _dbgEndWho = _c ? (UNIT_TYPES[_c.type]?.name ?? _c.type) : '?';
    console.log(`[turn-timing] END ${_dbgEndWho}`);
  }
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
    tickFear();
    tickSanctuary();
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

// One member of a roam group being alerted mid-combat pulls in the rest of the roam group,
// mirroring the precombat cascade in _triggerAggro. Without this a roam group spotted during
// combat would trickle in one enemy at a time as each wandered into detect range.
function _alertRoamGroup(u) {
  if (!roamGroupKey(u)) return;
  for (const o of units) {
    if (o === u || o.team !== 'red' || o.hp <= 0) continue;
    if (roamGroupKey(o) !== roamGroupKey(u) || o.aggro) continue;
    o.aggro = true;
    o.grp.visible = true;
    if (o.stealthed) setUnitStealth(o, false);
    _dungeonAwareEnemies.add(o);
    addLog(`⚠ ${unitLabel(o)} charges in with its group!`, 'alert');
  }
}

function _roamAggroCheck(u) {
  if (u.aggro) return;
  const def    = UNIT_TYPES[u.type] ?? {};
  const range  = _dynamicAggroRangeWU(u, def);
  const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
  // A roamer only "spots" a hero it actually has line of sight to — not one behind a wall or
  // hill. LOS is tested after the range check for the same perf reason.
  const spotted = heroes.some(h => {
    const dx = h.grp.position.x - u.grp.position.x;
    const dz = h.grp.position.z - u.grp.position.z;
    return dx * dx + dz * dz <= range * range && unitsHaveLOS(u, h);
  });
  if (spotted) {
    _dungeonAwareEnemies.add(u);
    u.aggro = true;
    u.grp.visible = true;
    addLog(`⚠ ${unitLabel(u)} spots the heroes during patrol!`, 'alert');
    _alertRoamGroup(u);
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

// Roam group leader for a roam-group member: the first unit of its group carrying a patrol
// path — the SAME rule precombat's _roamGroups uses, so a roam group doesn't change leader
// when combat starts. Returns null for the leader itself and for ungrouped units.
// Without this, followers would either stand still through a combat they aren't part
// of, or (if they kept authored waypoints of their own) scatter down separate routes.
const GROUP_TRAIL_WU = 2.2;   // WU a follower keeps behind its leader

function _roamGroupLeader(u) {
  if (!roamGroupKey(u)) return null;
  // roamPathOf, not patrolPath: after the real leader dies, precombat promotes a survivor
  // onto the cached route via _roamGroupPath, and the rest of the roam group must trail THAT unit.
  const lead = units.find(o => o.team === 'red' && o.hp > 0 &&
                               roamGroupKey(o) === roamGroupKey(u) && roamPathOf(o)) ?? null;
  return lead === u ? null : lead;
}

function _animateRoamNudge(u) {
  let idx = null, tx, tz;
  // Roam group followers trail their leader even if they still carry authored waypoints of
  // their own — the group id wins, so the roam group stays together instead of splitting.
  const groupLead = _roamGroupLeader(u);
  const path     = roamPathOf(u);

  if (!groupLead && path) {
    idx = u._patrolIdx ?? 0;
    for (let guard = 0; guard < path.length; guard++) {
      const wp  = path[idx];
      const ddx = wp.x - u.grp.position.x;
      const ddz = wp.z - u.grp.position.z;
      if (ddx * ddx + ddz * ddz > 0.04) break;
      idx = (idx + 1) % path.length;
    }
    u._patrolIdx = idx;
    tx = path[idx].x;
    tz = path[idx].z;
  } else {
    const lead = groupLead;
    if (!lead) {
      _roamAggroCheck(u);
      return;
    }
    // Trail the leader rather than pile onto it: aim at a point GROUP_TRAIL_WU short of
    // it, so a follower that reaches its target isn't standing in the leader's square.
    const bdx = lead.grp.position.x - u.grp.position.x;
    const bdz = lead.grp.position.z - u.grp.position.z;
    const bd  = Math.sqrt(bdx * bdx + bdz * bdz);
    if (bd <= GROUP_TRAIL_WU) {
      _roamAggroCheck(u);
      return;
    }
    tx = lead.grp.position.x - (bdx / bd) * GROUP_TRAIL_WU;
    tz = lead.grp.position.z - (bdz / bd) * GROUP_TRAIL_WU;
  }

  const cx   = u.grp.position.x;
  const cz   = u.grp.position.z;
  const dx   = tx - cx;
  const dz   = tz - cz;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.01) {
    if (idx != null) u._patrolIdx = (idx + 1) % path.length;
    return;
  }

  // `reach` = this nudge lands on the target; `advance` = that target was a waypoint and
  // the patrol index should move on. They are NOT the same test — a follower trailing its
  // leader reaches its target every nudge and has no index to advance.
  const reach   = dist <= ROAM_NUDGE_WU;
  const advance = reach && idx != null;
  const ratio   = reach ? 1 : ROAM_NUDGE_WU / dist;
  const destX   = cx + dx * ratio;
  const destZ   = cz + dz * ratio;

  // Skip nudge if the path crosses a barrier or the destination is occupied.
  if (crossesBarrier(cx, cz, destX, destZ) || isOccupied(destX, destZ, u)) {
    if (advance) u._patrolIdx = (idx + 1) % path.length;
    _roamAggroCheck(u);
    return;
  }

  u.grp.rotation.y = Math.atan2(dx, dz);
  setUnitWalking(u, true, false);
  u._roamNudging = true;

  const startX = cx, startZ = cz;
  const startY = getGroundHeight(startX, startZ);
  let startTs  = null;

  function frame(ts) {
    if (startTs === null) startTs = ts;
    if (!combatPhase || !units.includes(u) || u.hp <= 0) {
      u._roamNudging = false;
      setUnitWalking(u, false);
      return;
    }
    const elapsed = (ts - startTs) / 1000;
    const t       = dist > 0 ? Math.min(1, (elapsed * MOVE_SPEED * 0.33 * combatSpeed()) / (dist * ratio)) : 1;
    const endY    = getGroundHeight(destX, destZ);

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
      if (advance) u._patrolIdx = (idx + 1) % path.length;
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
  const remFt = (speedOf(u)) - turnMovedFt;
  if (remFt <= 0) { onDone(); return; }
  const maxDist = (remFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
  const ux = u.grp.position.x, uz = u.grp.position.z;
  const reach = _bfsReachable(ux, uz, maxDist, u);
  if (!reach.size) { onDone(); return; }
  let best = null, bestD = Infinity;
  for (const k of reach) {
    const [kx, kz] = k.split(',').map(Number);
    const dx = destPos.x - kx, dz = destPos.z - kz, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = { x: kx, z: kz }; }
  }
  if (!best) { onDone(); return; }
  const path = findPath(ux, uz, best.x, best.z);
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
  // The owl always runs on automation (even in manual mode), and its turn falls right after
  // Rasec's — so its dead-time pauses are exactly the "slow stretch after Iffir" the player
  // feels. They were raw ms (unscaled), so automated mode never compressed them either. Route
  // them through spd() so both modes tighten, and trim the base.
  const STEP_MS = spd(120);
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
      }, spd(400));
    });
  }, STEP_MS);
}

// preferTarget: force the attack onto this enemy instead of re-picking from the hero's
// target priorities. Used by a readied 'ally_in_enemy_melee' so the shot lands on the
// foe the ally is actually engaging (the Sneak Attack condition).
// A Gloves EXTRA action (attack_speed/cast_speed) is an offensive/support bonus — never a "hold" or
// "turtle". These fallbacks are dropped from the extra-action pass so a hero can't spend an extra
// readying, dodging, or dashing (which is how Fire Bolt was auto-bouncing into a readied action).
const EXTRA_ACTION_EXCLUDE = new Set(['ready_action', 'dodge', 'dodge_hurt', 'dash']);

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
    // How far this hero could actually ENGAGE this turn, in world units: one full move PLUS the
    // longer of his melee trigger and ranged range. pickAutoTarget uses it to drop enemies it
    // could never reach (see the pool note there). Passed in rather than derived over there
    // because only combat.js knows speedOf (gear move_speed affixes), the ft→WU conversion, and
    // the elf's Fire Bolt exception.
    //
    // The attack term is NOT optional: bounding on movement alone would hide a foe a ranged hero
    // can already shoot without taking a step (Milo's bow outranges his speed), which would
    // quietly turn every ranged hero into a nearest-target picker.
    const _reachAtks  = attacksOf(u);
    const _reachMelee = _reachAtks.find(a => a.type === 'melee');
    const _reachRangd = _reachAtks.find(a => a.type === 'ranged') ?? (u.type === 'elf' ? FIRE_BOLT_ATK : null);
    const reachWU = (speedOf(u) / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE + Math.max(
      _reachMelee ? atkTriggerWU(_reachMelee)             : 0,
      _reachRangd ? projRangeWU(_reachRangd.range, u)     : 0,
    );
    const pickCtx = { helpTarget: _owlHelpTarget, sneakable, reachWU };

    // movTarget drives positioning (may be an ally for Leugren)
    const movTarget   = forced ?? pickAutoTarget(heroType, heroPos, enemies, allies, pickCtx);
    // enemyTarget is always an enemy — used for actual attacks
    const enemyTarget = forced ?? pickAutoTarget(heroType, heroPos, enemies, [], pickCtx);

    // Nothing to do
    if (!movTarget && !allyWounded) { onEnd ? onEnd() : setTimeout(doEndTurn, END_PAUSE); return; }

    function endHeroAITurn() { onEnd ? onEnd() : setTimeout(doEndTurn, END_PAUSE); }

    // Gloves action economy for AUTOMATED heroes. An attack/cast consumes an EXTRA of its type (via
    // _spendHeroAction inside _executeAttack / the shared cast fns) instead of immediately locking
    // turnAttacked — so a gloved hero should take another action before ending. After each action pass
    // we re-run the priority list while BOTH hold: (a) the turn isn't locked yet, AND (b) the last pass
    // actually SPENT an extra (the budget total fell). Guard (b) is the loop-breaker: when no further
    // attack/cast is available (target dead / out of range), the budget stops falling and we end — a
    // non-gloved hero has budget 0, spends nothing, and ends after exactly one action as before.
    let _aiActionBudget = _extraAttacksLeft + _extraCastsLeft;
    function afterAction() {
      const left = _extraAttacksLeft + _extraCastsLeft;
      if (!turnAttacked && left < _aiActionBudget) {
        _aiActionBudget = left;
        setTimeout(() => doActionPriority(afterAction, true), PRE_ATK_MS);
        return;
      }
      endHeroAITurn();
    }

    // ── Execute a validated attack against enemyTarget ──────────────────
    function _executeAttack(atk, cb) {
      _spendHeroAction(atk?.spellKey ? 'spell' : 'weapon');
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
        _spendHeroAction('spell');
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
        // applyHeal clamps to allyWounded.maxHp (the real current max), which also fixes the old
        // bug where this read the stale base UNIT_TYPES hp and capped/reduced HP past the start max.
        const healed   = applyHeal(allyWounded, healRoll.total, { caster: u });
        allyWounded.barShowUntil = Date.now() + 4000;
        hideUndoBtn();
        updateCombatStatus();
        playSound('healing_word_leugren');   // cast voice — see the manual path for why it isn't in the effect
        playHealingWordEffect(u, allyWounded, () => {
          showFloatingDamage(allyWounded, `+${healed}`, '#44ff88');
          addLog(`${unitLabel(u)} uses Healing Word on ${unitLabel(allyWounded)}, restoring ${healed} HP (${dmgBreakdown(healRoll)})`, 'heal');
          buildTurnList();
          onDone();
        }, { chimeAt: 'cast' });
        return;
      }

      // ── Cure Wounds (dwarf, level 4, main action, uses spell slot, ally <33% HP) ─
      if (actionVal === 'cure_wounds') {
        if (u.type !== 'dwarf')          { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'cure_wounds')) { onSkip(); return; }
        if (!hasSpellSlot(u, spellLevelOf('cure_wounds'))) { onSkip(); return; }
        // Only fire for a critically wounded ally (<33% HP) — otherwise fall
        // through to Healing Word for lighter, slot-free healing.
        const critAlly = units
          .filter(a => a.team === 'blue' && a.hp > 0 && a.hp <= a.maxHp * 0.33)
          .reduce((best, a) => (!best || a.hp < best.hp) ? a : best, null);
        if (!critAlly) { onSkip(); return; }
        _spendHeroAction('spell');
        spendSpellSlot(u, spellLevelOf('cure_wounds'));
        const cw       = SPELLS.cure_wounds;
        const healRoll = roll({ sides: cw.healSides, count: cw.healDice, modifier: cw.healMod });
        const healed   = applyHeal(critAlly, healRoll.total, { caster: u });
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
        if (!hasSpellSlot(u, spellLevelOf('bless'))) { onSkip(); return; }
        // Same rule the manual button greys on. Was `blessedUnits.size > 0`, which treated a
        // PARTIALLY blessed party as done — so a hero revived mid-fight never got blessed.
        if (_allLivingHeroesHave(h => blessedUnits.has(h))) { onSkip(); return; }
        castBless(u);
        setTimeout(onDone, spd(900));
        return;
      }

      // ── Sacred Flame (dwarf, level 3 cantrip, no spell slot) ──────────
      if (actionVal === 'sacred_flame') {
        if (u.type !== 'dwarf')          { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'sacred_flame')) { onSkip(); return; }
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const rangeWU = projRangeWU(SPELLS.sacred_flame.rangeFt, u);
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
        if (!hasSpellSlot(u, spellLevelOf('mage_armor'))) { onSkip(); return; }
        activateMageArmor();
        setTimeout(onDone, spd(700));
        return;
      }

      // ── Magic Missile (elf, level 3, free once per combat then uses a spell slot) ─
      if (actionVal === 'magic_missile') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'magic_missile')) { onSkip(); return; }
        if (u.mmFreeUsed && !hasSpellSlot(u, spellLevelOf('magic_missile'))) { onSkip(); return; }
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const rangeWU = projRangeWU(ELF_SPELLS.magic_missile.rangeFt, u);
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
        setTimeout(onDone, spd(600));
        return;
      }

      // ── Rage (bonus action — hero can still attack after) ────────────
      if (actionVal === 'rage') {
        const rageDef = UNIT_TYPES[u.type]?.rage;
        if (!rageDef || u.raging || (u.rageUses ?? 0) <= 0) { onSkip(); return; }
        // Shared with the manual path — see _applyRage. This block used to duplicate the state
        // lines and so raged with no sound and no floating text.
        _applyRage(u);
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

      // ── Reckless Attack (Gobo L6 — FREE, hero still attacks after) ────
      // Returns onSkip() like the bonus actions do, but for a different reason: it costs no
      // action at all, so the list must continue to the greataxe that this is meant to buff.
      if (actionVal === 'reckless_attack') {
        if (u.type !== 'human' || u.reckless) { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'reckless_attack')) { onSkip(); return; }
        // Only worth the exposure when he can actually swing in melee this turn — declaring it
        // while stranded out of reach just hands every enemy advantage for free.
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const _rmelee = attacksOf(u).find(a => a.type === 'melee');
        if (!_rmelee) { onSkip(); return; }
        const rdx = enemyTarget.grp.position.x - u.grp.position.x;
        const rdz = enemyTarget.grp.position.z - u.grp.position.z;
        if (Math.sqrt(rdx * rdx + rdz * rdz) > atkTriggerWU(_rmelee)) { onSkip(); return; }
        activateRecklessAttack();
        onSkip(); // free action; continue to the attack it exists to buff
        return;
      }

      // ── Turn Undead (Leugren L5 — main action, no slot, once per combat) ──
      if (actionVal === 'turn_undead') {
        if (u.type !== 'dwarf')          { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'turn_undead')) { onSkip(); return; }
        if ((u.turnUndeadUses ?? 0) <= 0) { onSkip(); return; }
        // Don't spend the combat's only charge on a single skeleton — the whole value of
        // Channel Divinity here is catching a PACK. One target is better served by an attack.
        const _tuCount = _undeadInTurnRange(u).length;
        if (_tuCount < 2) { onSkip(); return; }
        activateTurnUndead();
        // ⚠ Budget derived from the ACTUAL stagger (i*300+600 in activateTurnUndead), NOT a flat
        // constant, and deliberately NOT wrapped in spd(): the per-target setTimeouts are
        // unscaled, so a spd()-shrunk budget would end the turn while saves were still landing
        // and resolve deaths during someone else's turn. Scales with target count.
        setTimeout(onDone, (_tuCount - 1) * 300 + 600 + 400);
        return;
      }

      // ── Sanctuary (Leugren L6 — bonus action, uses a spell slot) ──────
      if (actionVal === 'sanctuary') {
        if (u.type !== 'dwarf' || turnBonusActioned) { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'sanctuary')) { onSkip(); return; }
        if (!hasSpellSlot(u, spellLevelOf('sanctuary'))) { onSkip(); return; }
        // Ward only someone actually under pressure (<50% HP) and not already warded —
        // otherwise Leugren would burn a slot on a full-HP party every single turn.
        const _needy = _sanctuaryTargetsFor(u).filter(a => a.hp <= a.maxHp * 0.5);
        if (!_needy.length) { onSkip(); return; }
        activateSanctuary();
        onSkip(); // bonus action; continue to next action in list
        return;
      }

      // ── Sleep (Rasec L5 — main action, uses a spell slot) ─────────────
      if (actionVal === 'sleep') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'sleep')) { onSkip(); return; }
        if (!hasSpellSlot(u, spellLevelOf('sleep'))) { onSkip(); return; }
        // The 5d8 pool averages 22 HP, so it is worth a slot only against a CLUSTER of weak
        // enemies. Count what is both in range and still awake, and require at least two.
        const _sleepRangeWU = atkRangeWU(ELF_SPELLS.sleep.rangeFt);
        const _sleepable = units.filter(e => {
          if (e.team === u.team || e.hp <= 0 || sleepingUnits.has(e)) return false;
          const dx = e.grp.position.x - u.grp.position.x, dz = e.grp.position.z - u.grp.position.z;
          return Math.sqrt(dx * dx + dz * dz) <= _sleepRangeWU;
        });
        if (_sleepable.length < 2) { onSkip(); return; }
        castSleep(u);
        // Stagger is i*350+700 per SLEEPER (a subset of _sleepable, so this over-budgets
        // slightly rather than under). Unscaled for the same reason as Turn Undead above.
        setTimeout(onDone, (_sleepable.length - 1) * 350 + 700 + 400);
        return;
      }

      // ── Burning Hands (Rasec L6 — main action, uses a spell slot) ─────
      if (actionVal === 'burning_hands') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!isAbilityUnlocked(u.type, u.level, 'burning_hands')) { onSkip(); return; }
        if (!hasSpellSlot(u, spellLevelOf('burning_hands'))) { onSkip(); return; }
        // Radius is centred on RASEC, so this pulls him into danger — only worth it for 2+.
        // aoeRadiusFtOf so the off-hand affix widens the AI's check exactly as it widens the cast.
        const _bhRangeWU = atkRangeWU(aoeRadiusFtOf(u, ELF_SPELLS.burning_hands.rangeFt));
        const _caught = units.filter(e => {
          if (e.team === u.team || e.hp <= 0) return false;
          const dx = e.grp.position.x - u.grp.position.x, dz = e.grp.position.z - u.grp.position.z;
          return Math.sqrt(dx * dx + dz * dz) <= _bhRangeWU;
        });
        if (_caught.length < 2) { onSkip(); return; }
        castBurningHands(u);
        // Stagger is i*700+1000. The old flat spd(1600) was short on EVERY cast — the gate
        // guarantees 2+ targets, and target 2 alone resolves at 1700ms. Unscaled, count-derived.
        setTimeout(onDone, (_caught.length - 1) * 700 + 1000 + 400);
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
        // `u`, not the 'halfling' literal: the literal can't see gear, and this is the
        // automated twin of activateHide — the two must roll the same number.
        const dexMod     = abilityModOf(u, 'dex');
        const stealthPct = affixTotal(u, 'stealth_pct');
        // Auto-success anywhere inside his own smoke cloud (no stand-still requirement).
        const autoHide   = _inOwnSmoke(u);
        const chance     = Math.round(Math.max(5, Math.min(95, ((dexMod + 20 - 10) / 20) * 100 + stealthPct)));
        const succeeded  = autoHide || (Math.floor(Math.random() * 100) + 1) >= (100 - chance);
        u.hideCooldown    = 2;
        turnBonusActioned = true;
        playSound('hide');
        if (succeeded) {
          u.hideDexMod     = dexMod;
          u.hideStealthPct = stealthPct;
          setUnitStealth(u, true);
          addLog(autoHide
            ? `${unitLabel(u)} melts into his smoke — Hide auto-succeeds!`
            : `${unitLabel(u)} hides! (${chance}% Stealth check)`, 'move');
          showFloatingDamage(u, 'HIDDEN', '#44ff88');
        } else {
          addLog(`${unitLabel(u)} tries to hide but fails (${chance}% check)`, 'move');
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
        const atks  = attacksOf(u);
        const meleeAtk = atks.find(a => a.type === 'melee' && eDist <= atkTriggerWU(a));
        const rangdAtk = atks.find(a =>
          a.type === 'ranged' &&
          atkHasQty(u, a) &&
          unitsHaveLOS(u, enemyTarget) &&
          eDist <= projRangeWU(a.longRange ?? a.range, u)
        );
        const atk = meleeAtk ?? rangdAtk;
        if (!atk) { onSkip(); return; }
        _executeAttack(atk, onDone); return;
      }

      // ── Fire Bolt (elf cantrip — no spell slot, no attacks[] entry) ──
      if (actionVal === 'fire_bolt') {
        if (u.type !== 'elf')            { onSkip(); return; }
        if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
        const atk = FIRE_BOLT_ATK;
        const edx = enemyTarget.grp.position.x - u.grp.position.x;
        const edz = enemyTarget.grp.position.z - u.grp.position.z;
        const eDist = Math.sqrt(edx * edx + edz * edz);
        if (!unitsHaveLOS(u, enemyTarget)) { onSkip(); return; }
        if (eDist > projRangeWU(atk.range, u)) { onSkip(); return; }
        _executeAttack(atk, onDone); return;
      }

      // ── Named weapon attack ──────────────────────────────────────────
      if (!enemyTarget || !units.includes(enemyTarget)) { onSkip(); return; }
      const atks = attacksOf(u);
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
        if (eDist > projRangeWU(atk.longRange ?? atk.range, u)) { onSkip(); return; }
      }
      _executeAttack(atk, onDone);
    }

    // ── Iterate action_priority_in_range; fall through to no-range list ─
    // extraOnly = this is a Gloves EXTRA-action pass: drop the hold/turtle fallbacks and, if no real
    // attack/cast is viable, just END (cb) rather than dropping into the no-range fallback list — the
    // extra goes unused instead of being spent readying/dodging.
    function doActionPriority(cb, extraOnly = false) {
      let list = getTendency(heroType, 'action_priority_in_range');
      if (!Array.isArray(list)) list = [list];
      if (extraOnly) list = list.filter(a => !EXTRA_ACTION_EXCLUDE.has(a));
      function tryIdx(i) {
        if (i >= list.length) { extraOnly ? cb() : doNoRangeAction(cb); return; }
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
        if (_NO_RANGE_DELEGATES.has(action)) {
          _tryHeroAction(action, cb, () => tryIdx(i + 1));
          return;
        }
        if (action === 'dodge') {
          u.dodging = true;
          addLog(`${unitLabel(u)} takes the Dodge action`, 'spell');
          updateCombatStatus();
          cb(); return;
        }
        // Dash is deliberately ABSENT here: it was removed from the tendency lists entirely
        // (user, 2026-07-18). The automated turn already moves toward its target before picking
        // an action, so spending the Action on a second move is strictly worse than readying or
        // dodging — nobody would ever choose it. Manual Dash (doSprint) is unaffected.
        cb(); // end_turn or unknown
      }
      tryIdx(0);
    }

    // ── Movement ─────────────────────────────────────────────────────────
    const isAllyMode   = preferRange === 'near_ally_ranged' || preferRange === 'near_ally_melee';
    const isAllyMovTgt = movTarget?.team === 'blue';
    let dest = null;
    if (!noMove && preferRange !== 'stay' && movTarget) {
      const _remFt = (speedOf(u)) - turnMovedFt;
      // Only halve movement once already within striking range — caps how far
      // a kiting hero retreats each turn without also crippling their ability
      // to close the gap on a retreating enemy (e.g. Morvath) from far away,
      // which previously left them stuck repeatedly readying an action
      // instead of ever getting close enough to attack.
      let _movFt;
      if (preferRange === 'ranged' || preferRange === 'kite') {
        const _atks    = attacksOf(u);
        const _rangedA = _atks.find(a => a.type === 'ranged') ?? (u.type === 'elf' ? FIRE_BOLT_ATK : null);
        const _rangeWU = _rangedA ? projRangeWU(_rangedA.range, u) : 0;
        const _tdx = movTarget.grp.position.x - u.grp.position.x;
        const _tdz = movTarget.grp.position.z - u.grp.position.z;
        const _tDist = Math.sqrt(_tdx * _tdx + _tdz * _tdz);
        _movFt = (_rangeWU > 0 && _tDist <= _rangeWU) ? _remFt / 2 : undefined;
      }
      showMoveRange(u, _movFt);
      if (isAllyMode || isAllyMovTgt) {
        dest = aiPickAllyDest(u, allies, validTiles);
      } else {
        // Candidate TILES, not units — so this one keeps the coordinate LOS form.
        const _tileLOS = (kx, kz, tx2, tz2) => hasLineOfSight(kx, kz, tx2, tz2);
        dest = aiPickHeroDest(u, movTarget, validTiles, preferRange, atkTriggerWU, atkRangeWU, _tileLOS,
                               u.type === 'elf' ? FIRE_BOLT_ATK : null);
      }
      hideMoveRange();
    }

    if (dest) {
      const ox = u.grp.position.x, oz = u.grp.position.z;
      const path = findPath(ox, oz, dest.x, dest.z);
      if (!path.length) { doActionPriority(afterAction); return; }
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
        setTimeout(() => doActionPriority(afterAction), PRE_ATK_MS);
      });
    } else {
      doActionPriority(afterAction);
    }
  }, THINK_MS);
}

// ── Enemy AI (helpers in js/combatAI.js) ────────────────────────────────────

// Keep the screen on the ACTION during an enemy's turn: pan to the hero that enemy has chosen
// to attack (user, 2026-07-18), so a fight on the far side of the map never happens off-camera.
//
// ⚠ Follows the TARGETED HERO — never the enemy. The standing rule in this project is that the
// camera only ever follows blue units, and the `team === 'blue'` guard here is what keeps that
// true even if aiPickTarget ever returns something else (an NPC, a summon).
//
// setFollowUnit rather than focusCameraOnUnit, and that's load-bearing: updateCameraFocus
// re-derives its look from _followUnit EVERY frame, so a one-shot focus would be overwritten on
// the very next frame while the previously-acting hero is still the follow unit. Handing over
// the follow is the only thing that actually moves the camera here. activateTurn reassigns it on
// each hero's turn, so this never strands the camera on a victim.
function _followAttackTarget(target) {
  if (target?.team === 'blue' && target.hp > 0) setFollowUnit(target);
}

// ⚠ Actions in the NO-ENEMY-IN-RANGE tendency list that must be delegated to _tryHeroAction.
// An action in that list but MISSING here does not fall through to the next entry — it hits
// the `cb()` at the bottom of tryIdx and ENDS THE TURN, silently killing every lower-priority
// entry too. That is how cure_wounds sat dead in Leugren's no-range list. Any ability added to
// action_priority_no_range in combatAutomation.js MUST be added here in the same commit.
// (dodge/end_turn are handled inline below and are deliberately absent.)
const _NO_RANGE_DELEGATES = new Set([
  'healing_word', 'ready_action', 'use_potion', 'bless', 'mage_armor',
  'magic_missile', 'sacred_flame', 'smoke_mirrors',
  'cure_wounds',   // was missing — dead in the list since it was added
  'sanctuary',     // 2026-07-20
]);

function runAITurn(u) {
  endTurnBtn.disabled = true;
  _dbgLog('AI-ACTS', UNIT_TYPES[u.type]?.name ?? u.type);

  // Sleeping units can't act
  if (sleepingUnits.has(u)) {
    const state = sleepingUnits.get(u);
    addLog(`${unitLabel(u)} is asleep (${state.roundsLeft} rounds left) — skips turn`, 'spell');
    setTimeout(() => { doEndTurn(); }, 350);
    return;
  }

  // Turned by Turn Undead: Incapacitated, so no action — but unlike sleep it still MOVES,
  // spending its whole speed getting as far from the cleric as it can. Movement mirrors the
  // stealth-creep below with the direction negated, including the barrier/occupancy fallbacks
  // (a fleeing unit backed into a wall simply doesn't move, rather than clipping through it).
  if (frightenedUnits.has(u)) {
    const state  = frightenedUnits.get(u);
    const from   = state.turnedBy;
    addLog(`${unitLabel(u)} is Turned — frightened and incapacitated (${state.roundsLeft} rounds left), it flees`, 'spell');

    const cx = u.grp.position.x, cz = u.grp.position.z;
    let fleePath = [];
    if (from?.grp) {
      const speedFt = speedOf(u);
      const maxWU   = (speedFt / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;
      const ax = cx - from.grp.position.x, az = cz - from.grp.position.z;   // AWAY from the cleric
      const dist = Math.sqrt(ax * ax + az * az) || 1;
      const destX = cx + (ax / dist) * maxWU, destZ = cz + (az / dist) * maxWU;
      if (crossesBarrier(cx, cz, destX, destZ)) {
        const S   = WORLD_UNITS_PER_SQUARE;
        const tnx = cx + Math.round((destX - cx) / S) * S;
        const tnz = cz + Math.round((destZ - cz) / S) * S;
        fleePath = findPath(cx, cz, tnx, tnz);
      } else if (!isOccupied(destX, destZ, u)) {
        fleePath = [{ x: destX, z: destZ }];
      }
    }
    setTimeout(() => {
      if (!combatPhase || !units.includes(u)) { endTurnBtn.disabled = false; return; }
      // An empty fleePath (walled in, or the turner is gone) is fine to pass straight through:
      // animatePath early-returns onComplete() when path.length is 0, so the turn still ends.
      animatePath(u, fleePath, () => { setTimeout(() => { doEndTurn(); }, 250); });
    }, 300);
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
      const speedFt = speedOf(u);
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
    // LOS gate (same as the proximity/roam checks): a dormant enemy only wakes to a hero it can
    // actually see, not one behind a wall or hill.
    const spotted = heroes.some(h => {
      const dx = h.grp.position.x - u.grp.position.x;
      const dz = h.grp.position.z - u.grp.position.z;
      return dx * dx + dz * dz <= range * range && unitsHaveLOS(u, h);
    });
    if (spotted) {
      u.aggro = true;
      u.grp.visible = true;
      if (u.stealthed) setUnitStealth(u, false);
      addLog(`⚠ ${unitLabel(u)} is alerted by the heroes!`, 'alert');
      _alertRoamGroup(u);
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
  // tighter. Manual mode keeps a readable beat — but a whole roam-group pack aggro'd at once
  // turns that readability into a slog: you sit through a dozen slow enemy turns before you act
  // again. So the manual pauses SHRINK as the aggro'd pack grows — a lone enemy keeps the full
  // readable beat, and a big pack compresses toward the automated tempo. div: 1x at one enemy,
  // +0.2x per extra aggro'd enemy, capped at AUTO_COMBAT_SPEED (2.2x) so a large pack lands at
  // roughly the automated pacing it would run at anyway.
  const _aggroPack = isAutomated() ? 0 : units.filter(o => o.team === 'red' && o.hp > 0 && o.aggro).length;
  const _packDiv   = Math.min(AUTO_COMBAT_SPEED, 1 + 0.2 * Math.max(0, _aggroPack - 1));
  const _man       = (ms) => Math.round(ms / _packDiv);
  const THINK_MS    = isAutomated() ? 150 : _man(450);    // pause before acting
  const PRE_ATK_MS  = isAutomated() ? 120 : _man(260);    // pause before swinging so player sees the target ring
  // Beat between the swings of a Multiattack, so two hits don't read as one.
  const MULTI_ATK_GAP_MS = isAutomated() ? 150 : _man(300);
  // (A 2200ms ATK_RESOLVE constant used to sit here, unreferenced — every path in this function
  // is driven by animation/projectile callbacks rather than a fixed resolve budget. Removed.)
  const END_PAUSE   = isAutomated() ? 100 : _man(220);    // breather before advancing to next turn

  setTimeout(() => {
    if (!combatPhase || !units.includes(u)) {
      endTurnBtn.disabled = false;
      return;
    }

    const target = _aiPickTargetSanctuaryAware(u);
    if (!target) {
      setTimeout(doEndTurn, END_PAUSE);
      return;
    }
    _followAttackTarget(target);   // keep the screen on the hero about to be hit

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
      if (Array.isArray(names) && names.length) {
        const resolved = names
          .map(n => attacksOf(u).find(a => a.name === n))
          .filter(Boolean);
        // A MIXED multiattack (both a melee and a ranged attack, e.g. the hobgoblin captain's
        // "greatsword or longbow in any combination") flurries from ANY opener — otherwise a
        // ranged opener would fire a single shot and never multiattack. Lead with the opener
        // so the first swing matches the current range; later legs re-evaluate range per swing
        // (preferMelee below + nextAttack's own closing logic). An ALL-MELEE list (ettin:
        // battleaxe then morningstar) keeps its fixed order and its melee-opener-only rule.
        const mixed = resolved.some(a => a.type === 'melee') && resolved.some(a => a.type === 'ranged');
        if (resolved.length && mixed) {
          const others = resolved.filter(a => a !== opener);
          seq = [opener, ...others].slice(0, resolved.length);
        } else if (resolved.length && opener.type === 'melee') {
          seq = resolved;
        }
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

      // Enemies never loose a RANGED attack at a foe already in melee reach — they swing
      // instead. So a mixed multiattack (e.g. the hobgoblin captain's Greatsword + Longbow)
      // becomes two Greatsword swings against an adjacent target, and only uses the Longbow
      // leg when the re-picked foe is out of melee range. Resolved per-swing because the foe
      // (and the distance to it) can change between legs of the flurry.
      const meleeSub = attacksOf(u).find(a => a.type === 'melee');
      const preferMelee = (atk, foe) => {
        if (!meleeSub || !atk || atk.type === 'melee') return atk;
        const dx = foe.grp.position.x - u.grp.position.x;
        const dz = foe.grp.position.z - u.grp.position.z;
        return Math.sqrt(dx * dx + dz * dz) <= atkTriggerWU(meleeSub) ? meleeSub : atk;
      };

      const swing = () => {
        if (gone() || !units.includes(foe) || foe.hp <= 0) { cb(); return; }
        const atk = preferMelee(seq[i++], foe);
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

        // Sanctuary-aware like the opener: a multiattack re-picks per swing, so the ward has
        // to be honoured here too or an ettin's second blow walks straight through it.
        const t = _aiPickTargetSanctuaryAware(u);
        if (!t) { cb(); return; }           // nobody left to hit
        foe = t;
        // Re-picked per swing (a multiattack can switch victims mid-sequence), so the camera
        // follows along rather than sitting on whoever the first blow landed on.
        _followAttackTarget(t);

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
      const path = findPath(ox, oz, dest.x, dest.z);
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
      const slots = totalSpellSlots(u);   // enemy statblocks keep the flat pool; helper reads both
      const _def  = UNIT_TYPES[u.type] ?? {};
      const atks  = attacksOf(u);
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
      const _meleeA0 = attacksOf(u).find(a => a.type === 'melee');
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
      //
      // Candidate TILES, not units, so this keeps the coordinate LOS form — same shape the
      // hero mover uses.
      const _destLOS = (kx, kz) => hasLineOfSight(
        kx, kz, target.grp.position.x, target.grp.position.z);
      showMoveRange(u);
      const _apd0 = window.__pathProfile ? performance.now() : 0;
      const _losB = window.__pathProfile ? (window.__losCount || 0) : 0;
      const dest = aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU, _destLOS);
      if (window.__pathProfile) {
        const ms = performance.now() - _apd0;
        if (ms > 15) console.log(`[path] aiPickDest(rangedLOS) ${ms.toFixed(0)}ms tiles=${validTiles.size} losCalls=${(window.__losCount||0)-_losB} unit=${UNIT_TYPES[u.type]?.name ?? u.type}`);
      }
      hideMoveRange();
      if (!dest) { endAITurn(); return; }

      // Sprint: an enemy whose normal move still leaves it unable to attack spends its action
      // to dash (double movement) instead of walking and standing there.
      //
      // ⚠ The test is what the DESTINATION affords, not what the statblock lists. It used to be
      // `no ranged attack at all`, which asked the wrong question twice over:
      //   • The spider HAS a ranged attack (Web), so it never qualified — but the Web needs LOS,
      //     and behind a Haunted Wood tree there was none. It walked one move, found nothing
      //     playable, and ended its turn. Twice.
      //   • Flipping it to `no USABLE ranged attack` would over-correct the other way: Path 3 is
      //     reached precisely when nothing is playable FROM HERE, so that reads true for every
      //     creature — and an archer who only needed to step into bow range would Dash and
      //     forfeit the shot it was about to get.
      // Asking "after this move, will I have an attack?" is the question both cases actually
      // turn on: melee if the tile is in reach, ranged if it's in range WITH a clear shot.
      const _ddx = target.grp.position.x - dest.x;
      const _ddz = target.grp.position.z - dest.z;
      const _destDist     = Math.sqrt(_ddx * _ddx + _ddz * _ddz);
      const _meleeTrigger = _meleeA0 ? atkTriggerWU(_meleeA0) : 0;
      const _destInMelee  = _meleeTrigger > 0 && _destDist <= _meleeTrigger;
      const _rangedA0     = attacksOf(u).find(a => a.type === 'ranged');
      const _destCanShoot = !!_rangedA0 && atkHasQty(u, _rangedA0) &&
        (_destDist <= atkRangeWU(_rangedA0.range) ||
         (_rangedA0.longRange && _destDist <= atkRangeWU(_rangedA0.longRange))) &&
        _destLOS(dest.x, dest.z);
      if (!turnAttacked && !_destInMelee && !_destCanShoot) {
        turnAttacked = true;
        const _sprintBudgetFt = speedOf(u) * 2 - turnMovedFt;
        showMoveRange(u, _sprintBudgetFt);
        const sprintDest = aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU, _destLOS);
        hideMoveRange();
        updateCombatStatus();
        if (!sprintDest) { endAITurn(); return; }
        addLog(`${unitLabel(u)} uses Dash (action) — double move: ${speedOf(u) * 2} ft`, 'move');
        moveToAndThen(sprintDest, endAITurn);
        return;
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
