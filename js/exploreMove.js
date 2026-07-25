// js/exploreMove.js — EQ-style WASD strafe movement for OUT-OF-COMBAT exploration.
//
// The player drives the group leader (getPCSelected, which groupMove keeps at the front of the follow
// chain). W/S move along the camera-forward, A/D strafe left/right, and holding the RIGHT mouse button
// to orbit the camera (OrbitControls' existing right-drag = mouse-look) turns the leader's facing with
// it. The other heroes chase via the existing follower.js breadcrumb system — no formation code here.
//
// Combat, the setup phase, scripted dialogue freezes, and the dev free-camera all exclude WASD driving,
// and pressing a key cancels any active click-to-move so the two schemes don't fight. Combat keeps its
// own tile/click movement untouched.

import * as THREE from 'three';
import { camera } from './scene.js';
import { isPrecombat, isPrecombatFrozen, getPCSelected, stepUnitDir } from './precombat.js';
import { groupLeader } from './groupMove.js';
import { setupPhase } from './army.js';
import { combatPhase } from './combat.js';
import { setUnitWalking } from './units.js';
import { isEditModeActive } from './devConfig.js';

const WALK_SPEED = 6.6;   // WASD drive speed — a touch faster than the click-move WALK_SPEED (5.4)

const _keys = { w: false, a: false, s: false, d: false };
let _anyDown = false;     // any WASD key currently held
let _rmb     = false;     // right mouse button held (mouse-look active)
let _walking = false;     // whether WE last put the leader into the walk animation

const _KEYMAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };
function _refresh() { _anyDown = _keys.w || _keys.a || _keys.s || _keys.d; }
function _isTyping(e) { const t = e.target?.tagName; return t === 'INPUT' || t === 'TEXTAREA'; }

// The hero the player is driving: the follow-chain leader (getPCSelected sits at its front), or the
// bare selected hero if group-move is off. Resolved fresh each use so a re-select hands off cleanly.
function _leader() { return groupLeader() ?? getPCSelected(); }

function _canDrive() {
  return isPrecombat() && !isPrecombatFrozen() && !setupPhase && !combatPhase && !isEditModeActive();
}

// Is WASD the active driver right now? army.js hold-move stands down while this is true.
export function isExploreActive() { return _anyDown && _canDrive(); }

window.addEventListener('keydown', (e) => {
  if (_isTyping(e)) return;
  const k = _KEYMAP[e.code];
  if (!k || _keys[k]) return;
  _keys[k] = true;
  _refresh();
  // Cancel any active click-to-move on the leader so it doesn't fight WASD.
  const leader = _leader();
  if (leader) leader._pcTarget = null;
});
window.addEventListener('keyup', (e) => {
  const k = _KEYMAP[e.code];
  if (!k) return;
  _keys[k] = false;
  _refresh();
});
window.addEventListener('mousedown', (e) => { if (e.button === 2) _rmb = true; });
window.addEventListener('mouseup',   (e) => { if (e.button === 2) _rmb = false; });
// Alt-tab / focus loss can strand held keys — clear everything on blur.
window.addEventListener('blur', () => { _keys.w = _keys.a = _keys.s = _keys.d = false; _rmb = false; _refresh(); });

const _fwd = new THREE.Vector3();

// Per-frame driver. Called from main.js AFTER tickPrecombat and BEFORE tickFollowers, so the leader's
// new position is set before the followers chase it this same frame. Y/level grounding is owned by the
// main-loop surface grounding (nearestLevel), same as click-move — we only touch XZ + facing.
export function tickExploreMove(dt) {
  const leader = _leader();
  const canMove = _canDrive() && !!leader && leader.hp > 0;

  // Idle (not driving, or driving but no keys AND not looking): release the walk anim we started.
  if (!canMove || (!_anyDown && !_rmb)) {
    if (_walking && leader) { setUnitWalking(leader, false); _walking = false; }
    return;
  }

  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-6) return;
  _fwd.normalize();
  const fx = _fwd.x, fz = _fwd.z;

  // Mouse-look / movement both orient the leader to the camera-forward (engine forward = (sin a, cos a)).
  leader.grp.rotation.y = Math.atan2(fx, fz);

  if (!_anyDown) {                                   // just looking around (right-drag), not moving
    if (_walking) { setUnitWalking(leader, false); _walking = false; }
    return;
  }

  // Right of camera-forward = cross(forward, up) = (-fz, 0, fx).
  const rx = -fz, rz = fx;
  let dx = 0, dz = 0;
  if (_keys.w) { dx += fx; dz += fz; }
  if (_keys.s) { dx -= fx; dz -= fz; }
  if (_keys.d) { dx += rx; dz += rz; }
  if (_keys.a) { dx -= rx; dz -= rz; }

  const moved = stepUnitDir(leader, dx, dz, WALK_SPEED, dt);
  setUnitWalking(leader, moved);
  _walking = moved;
}
