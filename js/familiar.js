// js/familiar.js — Rasec's Find Familiar owl (Phase 1: presence + shoulder-follow)
//
// Phase 1 only handles the owl's *presence*: once Rasec casts Find Familiar (the
// find_familiar ability handler in combat.js, castable in or out of combat), an
// owl spirit drops straight down from the sky and perches on his right shoulder,
// riding along wherever he goes. It is
// built as a `team:'npc'` unit so it stays out of initiative/combat entirely for
// now — combat integration (its own turn, Help action, combat flight) is Phase 2.
//
// The owl is positioned every frame at the world-space location of Rasec's
// RightShoulder bone (left shoulder carries his staff). Because the perch is a
// live bone, the owl bobs naturally with his idle/walk animation.

import * as THREE from 'three';
import { buildUnit, setUnitWalking } from './units.js';
import { playSound } from './audio.js';
import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';

// ── Tunables (nudge if the owl sits wrong on the shoulder) ────────────────────
// The RightShoulder bone sits at the base of the neck (near the centerline), so
// the owl must be pushed OUTWARD onto the shoulder edge — otherwise its body
// (origin at the talons, rising ~0.5u) towers up over the elf's head. Outward is
// along the elf's local right and rotates with his facing.
const PERCH_BONE  = 'RightShoulder'; // stable torso-top bone (barely moves during anim)
const PERCH_OUT   = 0.22;            // world units outward (elf's right) onto the shoulder edge
const PERCH_UP    = -0.05;           // world units up/down relative to the bone
const PERCH_FWD   = 0.07;            // world units toward spine/back(+) / chest/front(-)
const PERCH_YAW   = 0;               // extra yaw (radians) if the owl faces the wrong way
const PERCH_PITCH = 20;              // degrees pitch about the owl's side axis: head up(+)/tail down

// Summon entrance — the owl drops straight down out of the sky and flares onto
// the shoulder, flapping the whole way. FLIGHT_HEIGHT = start height above the
// shoulder (high enough to enter from off the top of the screen); FLIGHT_DUR =
// descent time in seconds; FLIGHT_FLARE = extra head-up braking angle that eases
// back into PERCH_PITCH as it lands.
const FLIGHT_DUR    = 5.6;
const FLIGHT_HEIGHT = 20;
const FLIGHT_FLARE  = 36;

// Re-summoned mid-combat, the owl drops into its combat tile instead of onto the
// shoulder — and it gets a COMPRESSED version of the same dive. The 5.6s cinematic is
// a moment worth having once, out of combat; replayed on a 1 HP creature that dies
// often it would be six seconds of everyone watching a bird fall, every time. This
// keeps the arrival-from-above identity (which bookends its death fly-up) at combat
// tempo. Same easeOutCubic and braking flare, just tightened.
const DIVE_DUR    = 1.0;
const DIVE_HEIGHT = 6;

// The owl is white but its PBR material reflects the biome's ambient light (green
// in grassy zones). A soft white emissive makes its own colour read through
// regardless of surroundings, without casting light onto anything else. Raise
// OWL_EMISSIVE_INT toward ~0.5 for a brighter/whiter owl, lower it toward 0 to
// let more scene lighting back in.
const OWL_EMISSIVE     = 0xf2efe6;   // soft warm white
const OWL_EMISSIVE_INT = 0.30;

// Combat gestures (Phase 2).
const HELP_DUR   = 0.85;  // seconds for the Help up-swoop (rise then settle)
const HELP_RISE  = 2.2;   // world units the owl lifts while distracting
const DEATH_DUR  = 1.6;   // seconds to fly out of sight on death
const DEATH_RISE = 22;    // world units it climbs before vanishing (≈ its entrance height)

// Blob shadow — a soft dark oval on the ground beneath the owl. The scene's only
// real shadow-caster is the moon, which several biomes switch off (and even where
// it's on, a creature 1.5u up barely casts under itself), so this fake shadow is
// what actually sells "airborne" in every biome. It grows + fades with height.
const BLOB_RADIUS   = 0.5;   // world-unit radius of the oval when the owl is on the ground
const BLOB_MAX_OP   = 0.42;  // darkness directly under the owl at ground level
const BLOB_GROW     = 0.06;  // extra scale per world-unit of height
const BLOB_FADE_H   = 22;    // height (wu) at which the shadow has faded to near-nothing
const BLOB_LIFT     = 0.05;  // sit just above the ground to avoid z-fighting

const _perchPos = new THREE.Vector3();  // scratch: raw bone world position
const _tgt      = new THREE.Vector3();  // scratch: final perch (shoulder) target

let blob = null;  // the blob-shadow mesh (shared with the owl's lifecycle)

// Build the radial-gradient shadow texture once (dark centre → transparent edge).
function makeBlobShadow() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0,    'rgba(0,0,0,0.9)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  g.addColorStop(1,    'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: BLOB_MAX_OP,
    fog: false, toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(BLOB_RADIUS * 2, BLOB_RADIUS * 2);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;  // lie flat on the ground
  m.renderOrder = -1;           // draw under other transparents
  return m;
}

// Track the blob under the owl each frame: hidden while perched, otherwise laid
// on the terrain beneath it, growing + fading with height so it reads as flight.
function updateBlobShadow() {
  if (!blob) return;
  // Always show the blob beneath the owl (any biome) — the real moon shadow is
  // too small/faint for a creature this size to read as airborne. Hidden only
  // while perched on Rasec's shoulder.
  const perched = owl.bound && !owl._arriving;
  if (perched) { blob.visible = false; return; }
  blob.visible = true;
  const gx = owl.grp.position.x, gz = owl.grp.position.z;
  const gy = getTerrainHeight(gx, gz);
  const h  = Math.max(0, owl.grp.position.y - gy);
  blob.position.set(gx, gy + BLOB_LIFT, gz);
  const s = 1 + h * BLOB_GROW;
  blob.scale.set(s, s, s);
  blob.material.opacity = BLOB_MAX_OP * Math.max(0, 1 - h / BLOB_FADE_H);
}

// Fill `_tgt` with the owl's live perch position (bone world pos pushed outward
// onto the shoulder edge, in the owner's facing frame) and return the owner yaw.
function computePerch() {
  if (owl._perchBone) {
    owl._perchBone.getWorldPosition(_perchPos);
  } else {
    _perchPos.copy(owner.grp.position);
    _perchPos.y += 1.45;
  }
  // Outward onto the shoulder edge, in the owner's local frame so it rotates
  // with his facing. At yaw θ: local right (-X) → world (-cosθ, sinθ).
  const yaw = owner.grp.rotation.y;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const ox = PERCH_OUT * -cos + PERCH_FWD * -sin;
  const oz = PERCH_OUT *  sin + PERCH_FWD * -cos;
  _tgt.set(_perchPos.x + ox, _perchPos.y + PERCH_UP, _perchPos.z + oz);
  return yaw;
}

// Wash out the biome colour cast by giving the owl's own materials a gentle
// white self-illumination. Materials are per-instance clones (SkeletonUtils +
// buildUnit's tint), so this only affects this owl.
function brightenOwl(u) {
  u.grp.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m || !(m.emissive instanceof THREE.Color)) return;
      m.emissive.setHex(OWL_EMISSIVE);
      m.emissiveIntensity = OWL_EMISSIVE_INT;
      m.needsUpdate = true;
    });
  });
}

let owl   = null;  // the owl unit object (buildUnit result), or null when unsummoned
let owner = null;  // the hero the owl belongs to (Rasec)

export function isFamiliarSummoned() { return !!owl; }
export function getFamiliar()        { return owl; }

// Summon the owl and bind it to `ownerUnit`'s shoulder. No-op if already out.
// inCombat: skip the shoulder-perch cinematic. The caller (combat.js) places the owl on
// a free grid tile beside its owner and then calls startFamiliarDive() — we can't dive
// to a tile we haven't been given yet.
export function summonFamiliar(ownerUnit, { inCombat = false } = {}) {
  if (owl || !ownerUnit) return owl;
  owner = ownerUnit;

  // Locate the perch bone inside the owner's cloned rig.
  let bone = null;
  owner.grp.traverse(o => { if (o.isBone && o.name === PERCH_BONE) bone = o; });

  const px = owner.grp.position.x;
  const pz = owner.grp.position.z;
  owl = buildUnit(px, pz, 'familiar', 'owl');
  owl.familiar   = true;
  owl.owner      = ownerUnit;
  owl._perchBone = bone;   // may be null → fallback offset in updateFamiliar

  brightenOwl(owl);        // counter the biome colour cast so the white reads true

  blob = makeBlobShadow(); // fake ground shadow (real shadows are off in some biomes)
  blob.visible = false;    // shown once it's off the shoulder / mid-descent
  scene.add(blob);

  if (inCombat) {
    // Free combatant from the outset — no perch. combat.js positions it, then dives it.
    owl.bound     = false;
    owl._arriving = false;
  } else {
    // Cinematic entrance: start high above the shoulder and drop straight down.
    owl.bound     = false;
    owl._arriving = true;
    owl._arriveT  = 0;
    computePerch();
    owl.grp.position.set(_tgt.x, _tgt.y + FLIGHT_HEIGHT, _tgt.z);
  }
  setUnitWalking(owl, true);  // flap during the descent
  playSound('find_familiar'); // conjuration sound at the moment of the cast

  return owl;
}

// Drop the owl into the combat tile it has just been placed on. Called by combat.js
// AFTER _placeFamiliarForCombat has set its x/z — the dive is purely vertical, layered
// on top of the base y that main.js writes each frame (terrain + hoverY).
export function startFamiliarDive() {
  if (!owl) return;
  owl._diving = true;
  owl._diveT  = 0;
  setUnitWalking(owl, true);   // flap on the way down
}

// Removes the owl from the world (state only — scene removal happens where the
// caller decides). Used by the death fly-up and could support a manual dismiss.
export function dismissFamiliar() {
  if (blob) {
    scene.remove(blob);
    blob.geometry.dispose();
    blob.material.map?.dispose();
    blob.material.dispose();
    blob = null;
  }
  owl = null;
  owner = null;
}

// ── Combat (Phase 2) ──────────────────────────────────────────────────────────

// The owl "flies up" to distract a target. cb fires at the top of the swoop —
// that's when the caller applies the advantage + shows the red mark.
export function familiarHelpGesture(cb) {
  if (!owl) { cb?.(); return; }
  owl._helpRising = true;
  owl._helpT      = 0;
  owl._helpFired  = false;
  owl._helpCb     = cb ?? null;
  setUnitWalking(owl, true);  // flap while swooping
  playSound('owl');
}

// Death: the owl climbs straight back up the way it came and disappears, then
// frees itself so Rasec can re-summon. Called from combat's removeDefeatedUnit.
export function startFamiliarDeath() {
  if (!owl) return;
  owl._dying     = true;
  owl._dieT      = 0;
  owl._dieStartY = owl.grp.position.y;
  owl.bound      = false;
  owl._arriving  = false;
  owl._helpRising = false;
  setUnitWalking(owl, true);  // flap as it flees skyward
  playSound('owl');
}

// When a fight begins the owl leaves the shoulder to become a free combatant.
// Called explicitly from combat.js BEFORE the first turn activates (an event
// listener would fire too late if the owl wins initiative). combat.js then
// places it on a valid grid tile beside Rasec (needs the grid/occupancy helpers).
export function enterCombatFamiliar() {
  if (!owl) return;
  owl.bound     = false;
  owl._arriving = false;
  setUnitWalking(owl, true);  // airborne combatant — flap continuously (kept alive each frame in updateFamiliar)
}

// When the fight ends (and the owl survived) it re-perches on the shoulder and
// settles back into Idle (it flaps the whole time it's a free combatant).
window.addEventListener('combat:ended', () => {
  if (owl && !owl._dying) { owl.bound = true; setUnitWalking(owl, false); }
});

// Per-frame follow — call from the main tick after unit positioning.
export function updateFamiliar(dt) {
  if (!owl) return;

  updateBlobShadow();  // keep the fake ground shadow tracking beneath the owl

  // Death: climb straight up (accelerating) and vanish. The owl is already out
  // of units[] by now, so tick its mixer here to keep the wings flapping.
  if (owl._dying) {
    owl._dieT += dt;
    const p = Math.min(owl._dieT / DEATH_DUR, 1);
    owl.grp.position.y = owl._dieStartY + DEATH_RISE * (p * p);
    owl.mixer?.update(dt);
    owl.anchor.set(owl.grp.position.x, owl.grp.position.y + owl.anchorY, owl.grp.position.z);
    if (p >= 1) { scene.remove(owl.grp); dismissFamiliar(); }
    return;
  }

  // Perched / arriving — driven off the owner's shoulder bone.
  if ((owl._arriving || owl.bound) && owner) {
    const yaw = computePerch();  // live shoulder target (_tgt) + owner facing
    if (owl._arriving) {
      owl._arriveT += dt;
      const p = Math.min(owl._arriveT / FLIGHT_DUR, 1);
      const e = 1 - Math.pow(1 - p, 3);   // easeOutCubic — decelerate into the landing
      owl.grp.position.set(_tgt.x, _tgt.y + FLIGHT_HEIGHT * (1 - e), _tgt.z);
      const flareRad = -FLIGHT_FLARE * Math.PI / 180;
      const perchRad = -PERCH_PITCH  * Math.PI / 180;
      owl.grp.rotation.set(flareRad + (perchRad - flareRad) * e, yaw + PERCH_YAW, 0, 'YXZ');
      if (p >= 1) { owl._arriving = false; owl.bound = true; setUnitWalking(owl, false); }
    } else {
      owl.grp.position.copy(_tgt);
      owl.grp.rotation.set(-PERCH_PITCH * Math.PI / 180, yaw + PERCH_YAW, 0, 'YXZ');
    }
    owl.anchor.set(owl.grp.position.x, owl.grp.position.y + owl.anchorY, owl.grp.position.z);
    return;
  }

  // Compressed dive into its combat tile (re-summoned mid-fight). main.js has already
  // written the base y for this frame (terrain + hoverY), so the dive is just a
  // decaying offset on top of it — no need to know the ground height here.
  if (owl._diving) {
    owl._diveT += dt;
    const p = Math.min(owl._diveT / DIVE_DUR, 1);
    const e = 1 - Math.pow(1 - p, 3);          // easeOutCubic — decelerate into the landing
    owl.grp.position.y += DIVE_HEIGHT * (1 - e);
    const flareRad = -FLIGHT_FLARE * Math.PI / 180;
    owl.grp.rotation.x = flareRad * (1 - e);   // head-up braking flare, easing back to level
    setUnitWalking(owl, true);
    if (p >= 1) { owl._diving = false; owl.grp.rotation.x = 0; }
    owl.anchor.set(owl.grp.position.x, owl.grp.position.y + owl.anchorY, owl.grp.position.z);
    return;
  }

  // Free combatant (unbound, in combat): it's airborne, so it flaps the whole
  // time. animatePath drops it back to Idle when a move finishes, so re-assert
  // the flap every frame (setUnitWalking is idempotent — no-op if already flapping).
  setUnitWalking(owl, true);

  // main.js already set y = terrain+hover this frame; layer the Help swoop on
  // top of that base if one is playing.
  if (owl._helpRising) {
    owl._helpT += dt;
    const p = Math.min(owl._helpT / HELP_DUR, 1);
    owl.grp.position.y += Math.sin(p * Math.PI) * HELP_RISE;   // up then back down
    if (!owl._helpFired && p >= 0.5) {
      owl._helpFired = true;
      const cb = owl._helpCb; owl._helpCb = null;
      cb?.();
    }
    if (p >= 1) { owl._helpRising = false; setUnitWalking(owl, false); }
  }
  owl.anchor.set(owl.grp.position.x, owl.grp.position.y + owl.anchorY, owl.grp.position.z);
}
