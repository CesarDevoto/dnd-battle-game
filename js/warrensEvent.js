// js/warrensEvent.js — Warrens zone events (dialogue, NPC quests, triggers)
//
// Solrac quest:
//   1. Solrac spawns shackled, hanging from wall shackles → plays Bar_Hang_Idle.   ✅
//   2. A Warrens goblin drops the Goblin Key (loot.js guaranteed one-time drop);    ✅
//      the party loots it into a hero's bag.
//   3. Carry the key to Solrac → Leugren tells Gobo to unshackle him (dialogue) →   ✅
//      he crossfades from the hang pose to a standing idle and is freed for good.
//   4. Out of combat, Solrac auto-follows Leugren ~10ft; hangs back in a fight.     ← TODO (next step)
//
// Alignment of Solrac vs the shackle props is done by hand in-editor.

import { units, playUnitClip, setUnitAnimLocked } from './units.js';
import { showQuickDialogue } from './dagnaEvent.js';
import { addQuest, completeQuest } from './quests.js';

const HANG_CLIP = 'Bar_Hang_Idle';
const IDLE_CLIP = 'Idle_11';

const FREED_KEY = 'dnd-solrac-freed';   // Solrac has been released (persists)
const SEEN_KEY  = 'dnd-solrac-seen';    // player has met the shackled prisoner
const QUEST_ID  = 'free_solrac';
const KEY_ITEM  = 'goblin_key';         // items.js id looted from the goblin

const GOBLIN_TYPES = new Set(['goblin', 'goblin2', 'hobgoblin']);

const DISCOVER_R = 10;   // WU (~25ft) — close enough to notice the prisoner
const RELEASE_R  = 6;    // WU (~15ft) — close enough to work the shackles

let _solrac  = null;
let _hung    = false;
let _active  = false;    // currently in the Warrens
let _combat  = false;
let _releaseFired = false;

function _flag(k)    { try { return localStorage.getItem(k) === '1'; } catch { return false; } }
function _setFlag(k) { try { localStorage.setItem(k, '1'); } catch {} }
const _isFreed = () => _flag(FREED_KEY);

function _reset() { _solrac = null; _hung = false; _releaseFired = false; }

window.addEventListener('zone:loading', () => { _active = false; _reset(); });
window.addEventListener('zone:loaded', e => { _active = e.detail?.id === 'warrens'; _reset(); });
window.addEventListener('combat:start',  () => { _combat = true; });
window.addEventListener('combat:ended',  () => { _combat = false; });

function _findSolrac() {
  return units.find(u => u.type === 'solrac' && u.team === 'npc') ?? null;
}

// Nearest living hero to (x,z) and its distance in WU.
function _nearestHero(x, z) {
  let best = null, bestSq = Infinity;
  for (const u of units) {
    if (u.team !== 'blue' || u.hp <= 0) continue;
    const dx = u.grp.position.x - x, dz = u.grp.position.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestSq) { bestSq = d; best = u; }
  }
  return best ? { unit: best, dist: Math.sqrt(bestSq) } : null;
}

// True once the Goblin Key has actually been looted into some hero's bag — so the
// release requires collecting it, not merely killing the goblin.
function _anyHeroHasKey() {
  for (const u of units) {
    if (u.team !== 'blue') continue;
    const eq = u.equipment;
    if (!eq) continue;
    for (let n = 1; n <= 4; n++) {
      const contents = eq[`bag-${n}`]?.contents;
      if (Array.isArray(contents) && contents.some(s => s && s.id === KEY_ITEM)) return true;
    }
  }
  return false;
}

const _RELEASE_LINES = [
  { s: 'Leugren', t: "Hold. There's a man chained to the rock here — still breathing, if only just." },
  { s: 'Solrac',  t: "You're... you're no goblin. The key — one of those brutes carried it. Please, the lock is a simple thing." },
  { s: 'Leugren', t: "Gobo. Your fingers are quicker than mine. Get those shackles off him." },
  { s: 'Gobo',    t: "Aye, hold still, friend — this'll only pinch a little." },
  { s: 'Solrac',  t: "Nnngh— ...there. Free. I owe you my life. The name's Solrac. Let me walk with you a while — I know these tunnels." },
];

function _freeSolrac(u) {
  // Crossfade the shackled hang pose into a standing idle, then drop the anim lock
  // so normal walk/idle (and the future follow step) can take over.
  const hangClip = u.clips?.find(c => c.name === HANG_CLIP);
  if (u.mixer && u.idleAction) {
    u.idleAction.reset().setEffectiveWeight(1).play();
    if (hangClip) u.idleAction.crossFadeFrom(u.mixer.clipAction(hangClip), 0.6, false);
  } else {
    playUnitClip(u, IDLE_CLIP, { loop: true, lock: false });
  }
  setUnitAnimLocked(u, false);
  _setFlag(FREED_KEY);
  // Ensure the quest exists (discovery may have been skipped) then mark it done.
  // No XP reward for now — avoids tripping the known level-up modal bugs unattended.
  addQuest(QUEST_ID, 'Free the Prisoner', 'Free Solrac from the goblins\' shackles in the Warrens.');
  completeQuest(QUEST_ID);
}

export function tickWarrens(dt) {
  if (!_active || _isFreed()) return;

  if (!_solrac) _solrac = _findSolrac();
  if (!_solrac) return;

  // Keep him locked in the hanging pose until freed (retries until the GLB is ready).
  if (!_hung && playUnitClip(_solrac, HANG_CLIP, { loop: true, lock: true })) _hung = true;

  const near = _nearestHero(_solrac.grp.position.x, _solrac.grp.position.z);
  if (!near || _combat) return;

  const hasKey = _anyHeroHasKey();

  // Discovery: first time the party finds the shackled prisoner (no key yet) — he
  // pleads for help and the quest opens.
  if (!hasKey && !_flag(SEEN_KEY) && near.dist <= DISCOVER_R) {
    _setFlag(SEEN_KEY);
    addQuest(QUEST_ID, 'Free the Prisoner', 'A man hangs shackled in the Warrens. One of the goblins carries the key to his chains — find it and set him free.');
    showQuickDialogue([
      { s: 'Solrac', t: "You there — you're no goblin! Please, free me. One of those brutes carries the key to these shackles." },
    ]);
    return;
  }

  // Release: carry the looted key close to Solrac → the unshackle scene, then he's free.
  if (!_releaseFired && hasKey && near.dist <= RELEASE_R) {
    _releaseFired = true;
    showQuickDialogue(_RELEASE_LINES, () => _freeSolrac(_solrac));
  }
}
