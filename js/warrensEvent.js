// js/warrensEvent.js — Warrens zone events (dialogue, NPC quests, triggers)
//
// Solrac quest (in progress):
//   1. Solrac spawns shackled, hanging from wall shackles → plays Bar_Hang_Idle.  ← built
//   2. A goblin drops a key; Leugren tells Gobo to unshackle Solrac (dialogue).   ← TODO
//   3. On release he stands (Idle_11) and, out of combat, auto-follows Leugren.   ← TODO
//   4. He hangs back (stays put) whenever a fight breaks out, like Floosh.        ← TODO
//
// This file currently implements step 1 only: find Solrac after the zone loads and
// lock him into the hanging pose. Alignment of Solrac vs the shackle props is done by
// hand in-editor (per design), so we only drive the animation here.

import { units, playUnitClip } from './units.js';

const HANG_CLIP = 'Bar_Hang_Idle';
const FREED_KEY = 'dnd-solrac-freed';   // set once the release quest frees him (step 3)

let _solrac = null;
let _hung   = false;

function _isFreed() {
  try { return localStorage.getItem(FREED_KEY) === '1'; } catch { return false; }
}

function _reset() { _solrac = null; _hung = false; }

window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'warrens') return;
  _reset();
});

window.addEventListener('zone:loading', _reset);

export function tickWarrens(dt) {
  // Once freed (future step 3), he's a normal follower — nothing to force here.
  if (_hung || _isFreed()) return;

  // Solrac's GLB may finish loading a frame or two after the zone event fires, so
  // retry each tick until his mixer/clips are ready and the hang pose actually starts.
  if (!_solrac) _solrac = units.find(u => u.type === 'solrac' && u.team === 'npc') ?? null;
  if (!_solrac) return;

  if (playUnitClip(_solrac, HANG_CLIP, { loop: true, lock: true })) _hung = true;
}
