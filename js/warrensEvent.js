// js/warrensEvent.js — Warrens zone events (dialogue, NPC quests, triggers)
//
// Solrac quest:
//   0. On first entry to the Warrens, an intro dialogue plays (distant cries →       ✅
//      Milo/Leugren) and the "Free the Prisoner" quest opens.
//   1. Solrac spawns shackled, hanging from wall shackles → plays Bar_Hang_Idle.      ✅
//   2. A Warrens goblin drops the Goblin Key (loot.js guaranteed one-time drop);      ✅
//      the party loots it into a hero's bag.
//   3. Carry the key to Solrac → the unshackle dialogue (Leugren → Gobo) → he         ✅
//      crossfades from the hang pose to a standing idle, is freed, "Free the
//      Prisoner" completes, and the "Find Mirael Thorne" quest springs.
//   4. Out of combat, Solrac auto-follows Leugren at 5 ft and hangs back in a       ✅
//      fight. He's a breadcrumb follower (js/follower.js), so he retraces
//      Leugren's own footsteps and can't wedge himself against a cave wall.
//
// Alignment of Solrac vs the shackle props is done by hand in-editor.

import { units, playUnitClip, setUnitAnimLocked } from './units.js';
import { showQuickDialogue } from './dagnaEvent.js';
import { addQuest, completeQuest } from './quests.js';
import { addFollower, snapBehindLeader } from './follower.js';

const HANG_CLIP = 'Bar_Hang_Idle';
const IDLE_CLIP = 'Idle_11';

const FREED_KEY = 'dnd-solrac-freed';   // Solrac has been released (persists)
const SEEN_KEY  = 'dnd-solrac-seen';    // player has approached the shackled prisoner
const INTRO_KEY = 'dnd-warrens-intro';  // first-entry intro dialogue has played
const QUEST_ID  = 'free_solrac';
const MIRAEL_ID = 'find_mirael';
const KEY_ITEM  = 'goblin_key';         // items.js id looted from the goblin

const DISCOVER_R = 11;  // WU (~27ft) — close enough to notice the shackled prisoner
const RELEASE_R  = 6;   // WU (~15ft) — close enough to work the shackles

// 1 WU = 2.5 ft, so 5 ft = 2 WU. He starts closing again at 3 WU (7.5 ft) — the
// gap between the two is a deadband, without which he twitches between his walk
// and idle clips every time Leugren shifts her weight.
const FOLLOW_STOP   = 2;
const FOLLOW_RESUME = 3;

let _solrac  = null;
let _hung    = false;
let _active  = false;    // currently in the Warrens
let _combat  = false;
let _pleaded = false;    // approach plea shown this session
let _releaseFired = false;
let _following    = false;

function _flag(k)    { try { return localStorage.getItem(k) === '1'; } catch { return false; } }
function _setFlag(k) { try { localStorage.setItem(k, '1'); } catch {} }
const _isFreed = () => _flag(FREED_KEY);

function _reset() {
  _solrac = null; _hung = false; _pleaded = false; _releaseFired = false; _following = false;
}

const _leugren = () => units.find(u => u.type === 'dwarf' && u.team === 'blue' && u.hp > 0) ?? null;

// He walks at Leugren's heel out of combat. `arriveWithParty` is for re-entering
// the zone after he's already been freed: he travels with the heroes now, so he
// should turn up beside them rather than back at the shackles he was cut from.
function _beginFollow(arriveWithParty) {
  const leader = _leugren();
  if (!leader) return;                 // heroes not built yet — retry next tick
  addFollower(_solrac, _leugren, { stop: FOLLOW_STOP, resume: FOLLOW_RESUME });
  if (arriveWithParty) snapBehindLeader(_solrac, leader, FOLLOW_STOP);
  _following = true;
}

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

// ── First-entry intro ─────────────────────────────────────────────────────────
const _INTRO_LINES = [
  { narration: true, t: "Distant cries for succour echo through a wooded canyon, spoken in the Common tongue." },
  { s: 'Milo',    t: "They draw nigh! Onward, ahead — we must make haste!" },
  { s: 'Leugren', t: "Bless the grassling's guidance as true! Hold fast thy faith, cousin — we come for thee!" },
  { s: 'Milo',    t: "The cries come from along the path up ahead, to the right. This way!" },
];

// ── The unshackle scene (fires once the key reaches Solrac) ────────────────────
const _RELEASE_LINES = [
  { s: 'Leugren', t: "Hold. There's a man chained to the rock here — still breathing, if only just." },
  { s: 'Solrac',  t: "You're... you're no goblin. The key — one of those brutes carried it. Please, the lock is a simple thing." },
  { s: 'Leugren', t: "Gobo, take the key! Unbind those irons from his wrists and set him free!" },
  { s: 'Gobo',    t: "Aye, hold still, friend — this'll only pinch a little." },
  { s: 'Solrac',  t: "Nnngh— ...there. Free. I owe thee my life. I am called Solrac Thorne. Hast thou seen a woman… Mirael? My sister Mirael Thorne? She was with me when these foul fiends set upon our trade caravan on the Triboar Trail!" },
  { s: 'Leugren', t: "Alas, we have not seen her. Yet tell me — on thy part, didst thou see any dwarves the goblins carried off as captives? We seek my cousin." },
  { s: 'Solrac',  t: "I heard the bitter protests of dwarven voices passing outside earlier in the day, yet in my shackled state I saw them not." },
  { s: 'Solrac',  t: "It seems we share a common cause, dear saviors. May I join thee in the search for thy kin and mine own? Other goblin caves lie near, of this I am certain." },
  { s: 'Rasec',   t: "Canst thou handle thyself in battle, Solrac?" },
  { s: 'Solrac',  t: "I have mine own ways. Onward! Time is of the essence!" },
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
}

// Called when the unshackle dialogue closes: free him, close the rescue quest, and
// open the search for his sister. No XP reward for now (avoids the level-up bugs).
function _onReleaseDone(u) {
  _freeSolrac(u);
  _beginFollow(false);   // he's standing right next to them — just start walking
  addQuest(QUEST_ID, 'Free the Prisoner', 'Free the shackled prisoner in the Warrens.');
  completeQuest(QUEST_ID);
  addQuest(MIRAEL_ID, 'Find Mirael Thorne',
    "Solrac Thorne's sister Mirael was taken when goblins ambushed their caravan on the Triboar Trail. Search the goblin caves for her — and for the dwarven captives Leugren seeks.");
}

export function tickWarrens(dt) {
  if (!_active) return;

  // First-entry intro — plays once ever, opens the rescue quest.
  if (!_flag(INTRO_KEY)) {
    _setFlag(INTRO_KEY);
    addQuest(QUEST_ID, 'Free the Prisoner',
      'Cries for help echo through the Warrens. Fight past the goblins, take the key one of them carries, and free the shackled prisoner.');
    showQuickDialogue(_INTRO_LINES);
  }

  if (!_solrac) _solrac = _findSolrac();
  if (!_solrac) return;

  // Already freed — either just now, or on a later visit to the zone. He travels
  // with the party from here on; follower.js does the walking (and holds him in
  // place during a fight).
  if (_isFreed()) {
    if (!_following) _beginFollow(true);
    return;
  }

  // Keep him locked in the hanging pose until freed (retries until the GLB is ready).
  if (!_hung && playUnitClip(_solrac, HANG_CLIP, { loop: true, lock: true })) _hung = true;

  if (_combat || _releaseFired) return;

  const near = _nearestHero(_solrac.grp.position.x, _solrac.grp.position.z);
  if (!near) return;
  const hasKey = _anyHeroHasKey();

  // Approach plea: a hero comes near the shackled prisoner before finding the key —
  // he calls out for help (one-shot). Skipped if you already hold the key (go straight
  // to the release scene instead).
  if (!hasKey && !_pleaded && !_flag(SEEN_KEY) && near.dist <= DISCOVER_R) {
    _pleaded = true;
    _setFlag(SEEN_KEY);
    showQuickDialogue([
      { s: 'Solrac', t: "You there — you're no goblin! Please, free me. One of those brutes carries the key to these shackles." },
    ]);
    return;
  }

  // Release: carry the looted key close to Solrac → the unshackle scene, then free.
  if (hasKey && near.dist <= RELEASE_R) {
    _releaseFired = true;
    showQuickDialogue(_RELEASE_LINES, () => _onReleaseDone(_solrac));
  }
}
