// js/hideOutEvent.js — Hide Out zone events (the Sildar ransom standoff)
//
// The goblin boss holds Sildar hostage in the camp and demands 20 gold. Reaching
// the trigger spot freezes the party and opens a two-way choice:
//
//   PAY    → 5 gp comes out of each hero's purse, the boss waves the party off,      ✅
//            Sildar runs to Leugren and joins as a follower NPC (the Solrac
//            pattern), trading a few lines on the way. Leaving the zone opens
//            the follow-up scene.
//   REFUSE → no gold changes hands. The boss's swing drops Sildar UNCONSCIOUS      ✅
//            (not dead) and the whole camp aggros at once. When the fight is
//            won, Rasec asks Leugren to stabilise him; he comes round at 1 hp,
//            stands, and joins exactly as he would have on the pay branch.
//
// Both branches converge on JOINED_KEY — he ends up travelling with the party
// either way, so nothing downstream (the arrival exchange, the departure scene)
// has to care which route got him there.
//
// The shouted price and the actual charge agree: 20 gold = RANSOM_PER_HERO (5) x
// 4 heroes. Keep them in step if either number moves. 5 gp is exactly a hero's
// starting purse, so a party that hasn't looted anything is cleaned out but can
// still pay.
//
// ⚠ Sildar is placed by zone_hide_out.js and only EXISTS in that zone. After the
// pay branch he follows the party around the Hide Out, but he does not yet
// travel between zones — a companion that persists across a zone load needs a
// roster system that doesn't exist yet (Solrac has the same limitation). The
// departure scene below therefore plays as dialogue only, with no Sildar model
// in the next zone.

import { units, playUnitClip, playUnitAttackAnim, setUnitAnimLocked, setUnitWalking } from './units.js';
import { showQuickDialogue, showChoiceUI, registerDialogueScene } from './dagnaEvent.js';
import { addFollower } from './follower.js';
import { setPrecombatFrozen, forceAggro } from './precombat.js';
import { spendCoinsCp, CP_PER_GP } from './equipment.js';
import { addLog } from './combat.js';

// ── Tuning ────────────────────────────────────────────────────────────────────
const TRIGGER_X = -52, TRIGGER_Z = -12;
const TRIGGER_R = 6;    // WU — how close a hero must get to spring the standoff
const RANSOM_PER_HERO = 5;    // gp taken from EACH hero on the pay branch (20 total)

// He's judged "arrived" a little outside the follower stop distance, so the
// thank-you line fires as he pulls up rather than after he's finished shuffling
// into his final slot.
const FOLLOW_STOP   = 2;
const FOLLOW_RESUME = 3;
const ARRIVE_R      = 3.2;

const DEATH_CLIP = 'Dead';

// ── Persistent flags ──────────────────────────────────────────────────────────
const PAID_KEY   = 'dnd-sildar-paid';     // ransom paid — he was never struck
const REFUSED_KEY= 'dnd-sildar-refused';  // ransom refused — he was beaten down
const JOINED_KEY = 'dnd-sildar-joined';   // he is UP and travelling with the party (either route)
const OUTRO_KEY  = 'dnd-sildar-outro';    // the leaving-the-Hide-Out scene has played

function _flag(k)    { try { return localStorage.getItem(k) === '1'; } catch { return false; } }
function _setFlag(k) { try { localStorage.setItem(k, '1'); } catch {} }

// Refused, went down, and hasn't been brought round yet.
const _isDowned = () => _flag(REFUSED_KEY) && !_flag(JOINED_KEY);

// ── State (per zone visit) ────────────────────────────────────────────────────
let _active    = false;   // currently in the Hide Out
let _combat    = false;
let _fired     = false;   // the standoff dialogue has opened this visit
let _following = false;
let _arrived   = false;   // Sildar's arrival lines have played
let _posedDown  = false;  // collapsed pose re-applied on re-entry while he's still down
let _reviveFired = false; // the post-fight revival scene has been queued this visit

function _reset() {
  _fired = false; _following = false; _arrived = false;
  _posedDown = false; _reviveFired = false; _dropped = false;
}

const _sildar  = () => units.find(u => u.type === 'sildar' && u.team === 'npc') ?? null;
const _boss    = () => units.find(u => u.type === 'goblinchieftain' && u.team === 'red' && u.hp > 0) ?? null;
const _leugren = () => units.find(u => u.type === 'dwarf' && u.team === 'blue' && u.hp > 0) ?? null;
const _heroes  = () => units.filter(u => u.team === 'blue' && u.hp > 0);

// No living hostile left standing near where he fell. Used as the "the fight is
// over" test on the recovery path, where the combat:ended event isn't available.
const CAMP_R = 25;   // WU around Sildar that counts as the goblin camp
function _campCleared() {
  const u = _sildar();
  if (!u) return false;
  return !units.some(e => {
    if (e.team !== 'red' || e.hp <= 0) return false;
    const dx = e.grp.position.x - u.grp.position.x;
    const dz = e.grp.position.z - u.grp.position.z;
    return dx * dx + dz * dz <= CAMP_R * CAMP_R;
  });
}

window.addEventListener('zone:loading', () => { _active = false; _reset(); });
window.addEventListener('zone:loaded', e => {
  const id = e.detail?.id ?? null;
  _active = id === 'hide_out';
  _reset();
  // Left the Hide Out with him in tow (paid OR revived) → the departure scene, once ever.
  if (!_active && id && _flag(JOINED_KEY) && !_flag(OUTRO_KEY)) {
    _setFlag(OUTRO_KEY);
    setTimeout(() => showQuickDialogue(_DEPART_LINES), 900);
  }
});
window.addEventListener('combat:start', () => { _combat = true; });
window.addEventListener('combat:ended', () => {
  _combat = false;
  // Won the fight he was beaten down in → Rasec's plea, then he comes round.
  // Delayed so the victory log and any loot panel settle before the scene opens.
  if (_active && _isDowned() && !_reviveFired) {
    _reviveFired = true;
    setTimeout(() => showQuickDialogue(_REVIVE_LINES, _reviveSildar), 1200);
  }
});

// ── Lines ─────────────────────────────────────────────────────────────────────
const _RANSOM_LINES = [
  { narration: true, t: 'A knot of goblins parts around a scarred brute of a chieftain. He holds a blade to the throat of a battered man in torn finery.' },
  { s: 'Goblin Boss', t: '20 gold or I cave this human\'s skull right now!' },
];

const _PAID_LINES = [
  { s: 'Goblin Boss', t: 'Smart. Now get lost before I change my mind.' },
];

const _ARRIVE_LINES = [
  { s: 'Sildar',  t: "Thank you heroes! Let's leave this place!" },
  { s: 'Leugren', t: 'Where is my cousin who paid you for his protection!' },
  { s: 'Sildar',  t: 'I believe I know where he is! But this is not the time or place!' },
];

// ⚠ PLACEHOLDER — the spec called for "a new dialogue" on leaving the Hide Out but
// didn't specify the lines. These carry the cousin thread forward so the hook is
// live and testable; replace the text with the real scene.
const _DEPART_LINES = [
  { narration: true, t: 'The stink of the goblin camp falls away behind you. Sildar leans against a rock, catching his breath for the first time in days.' },
  { s: 'Sildar',  t: 'Forgive me. I could not speak freely with a knife at my neck.' },
  { s: 'Sildar',  t: 'Your kinsman lives — or he did when they took him. They did not march him back to the Hide Out. They took the eastern road.' },
  { s: 'Leugren', t: 'Then we ride east. Speak plainly now, sir — all of it.' },
  { s: 'Sildar',  t: 'Aye. All of it. But we should be far from here before we talk of where they took him.' },
];

// ── Pay branch ────────────────────────────────────────────────────────────────
// Charges every LIVING hero. Their purse is a {copper, silver, gold, platinum}
// wallet, so this can't just decrement .gold — a hero who has spent down to
// 3 gp and 40 sp can still cover the 5. spendCoinsCp drains across
// denominations and reports what it actually got.
function _chargeParty() {
  const cost = RANSOM_PER_HERO * CP_PER_GP;
  let short = 0;
  for (const h of _heroes()) {
    const paid = spendCoinsCp(h, cost);
    if (paid < cost) short += cost - paid;
  }
  addLog(`The party hands over ${RANSOM_PER_HERO} gp each to the goblin chieftain.`, 'alert');
  // Nobody is stopped from paying — an empty purse just means the goblins got
  // less than they asked for, which the boss is in no position to count.
  if (short > 0) addLog('Some purses came up light.', 'move');
}

function _onPaid() {
  _setFlag(PAID_KEY);
  _chargeParty();
  showQuickDialogue(_PAID_LINES, () => {
    setPrecombatFrozen(false);
    _beginFollow();
  });
}

// He walks to Leugren under his own power — addFollower does the pathing, so he
// closes the gap from wherever he was being held.
function _beginFollow() {
  const u = _sildar();
  if (!u || _following) return;
  setUnitAnimLocked(u, false);   // in case anything had him pinned in a pose
  addFollower(u, _leugren, { stop: FOLLOW_STOP, resume: FOLLOW_RESUME });
  _following = true;
}

// ── Refuse branch ─────────────────────────────────────────────────────────────
// No gold changes hands. The blow is a scripted beat rather than a real combat
// action: the boss turns, swings, Sildar goes down, and only THEN does the camp
// roll initiative. Hanging it off the boss's actual first combat turn would mean
// reaching into the turn loop to retarget an attack at a team:'npc' unit that
// has no hp and isn't on the initiative order — for a beat the player
// experiences as the opening of the fight either way.
//
// He is UNCONSCIOUS, not dead: the death clip is doing double duty as a
// collapsed pose (there's no dedicated downed clip on this rig), and nothing
// records him as killed. _reviveSildar brings him back after the fight.
function _onRefused() {
  _setFlag(REFUSED_KEY);
  const boss = _boss(), victim = _sildar();

  if (boss && victim) {
    const dx = victim.grp.position.x - boss.grp.position.x;
    const dz = victim.grp.position.z - boss.grp.position.z;
    boss.grp.rotation.y = Math.atan2(dx, dz);
    playUnitAttackAnim(boss, 'melee', () => _dropSildar(victim));
    // Safety net: if the boss has no attack clip the callback never lands, and
    // Sildar would stand there untouched while the fight starts around him.
    setTimeout(() => _dropSildar(victim), 1500);
  } else if (victim) {
    _dropSildar(victim);
  }

  setTimeout(() => {
    setPrecombatFrozen(false);
    _aggroWholeCamp();
  }, 1800);
}

let _dropped = false;
function _dropSildar(u) {
  if (_dropped || !u) return;
  _dropped = true;
  addLog('The chieftain clubs Sildar to the ground — he is down, but still breathing.', 'alert');
  // loop:false clamps on the last frame; lock:true stops idle standing him back up.
  playUnitClip(u, DEATH_CLIP, { loop: false, lock: true });
}

// ── Revival (refuse branch, after the fight) ──────────────────────────────────
// Fires on combat:ended, which only runs when the threats are cleared — so
// losing the fight doesn't hand the party a free rescue.
//
// ⚠ This dialogue goes through the SAME fallen-hero gate as everything else: if
// a hero died in the fight, these lines bank until the short rest, and the
// stand-up rides along in onDone so the two can't desync. That reads correctly
// anyway — the party patches itself up, then sees to him.
const _REVIVE_LINES = [
  { narration: true, t: 'The last of the camp goes still. Across the clearing the man in torn finery lies where the chieftain left him, chest barely moving.' },
  { s: 'Rasec',   t: 'Leugren — he yet draws breath. Stabilise him, and swiftly, ere that breath prove his last.' },
  { s: 'Leugren', t: 'Moradin steady my hands. Hold fast, friend — thou art not for the grave this day.' },
  { narration: true, t: 'Warm light closes the worst of the wounds. His eyes open.' },
];

function _reviveSildar() {
  const u = _sildar();
  if (!u) return;
  setUnitAnimLocked(u, false);
  // ⚠ He stays at hp = 0, the standard team:'npc' value — do NOT "wake him at 1 hp".
  // Several hero spells select targets as `e.team !== caster.team && e.hp > 0` with
  // no npc guard (Sacred Flame and Magic Missile targeting, and Sleep's sweep). For
  // a blue caster 'npc' !== 'blue', so the ONLY thing keeping friendly NPCs out of
  // those selections is hp = 0. Giving him 1 hp would make the man the party just
  // carried off the floor a legal target for Leugren's own Sacred Flame — and at
  // 1 hp the first hit would drop him again. hp = 0 is what protects him.
  // He's narratively at death's door either way; the dialogue carries that, not a
  // number. (This is why Solrac is hp = 0 too.)
  // Clear the clamped down-pose before idle resumes: setUnitWalking's same-state
  // branch only restarts the idle action, it does NOT stop whatever else is
  // playing, so the collapsed clip would keep blending against it at full weight.
  u.mixer?.stopAllAction();
  setUnitWalking(u, false);
  _setFlag(JOINED_KEY);
  _beginFollow();   // he gets up and walks to Leugren; _checkArrival does the rest
}

// "combat auto starts with all goblins and goblin boss" — the aggro cascade is
// radius-based, so a camp strung across the cave would trickle in a few at a
// time. Widening the boss's social range for the one call pulls the entire camp
// in through the machinery that already exists, then puts it back.
function _aggroWholeCamp() {
  const boss = _boss();
  const spotter = boss ?? units.find(u => u.team === 'red' && u.hp > 0);
  if (!spotter) return;
  const prev = spotter.socialAggroRange;
  spotter.socialAggroRange = 9999;
  forceAggro(spotter);
  setTimeout(() => { spotter.socialAggroRange = prev; }, 100);
}

// ── The standoff ──────────────────────────────────────────────────────────────
function _openStandoff() {
  // Fire at most once per visit no matter which way this goes — a banked dialogue
  // must not be re-banked every frame.
  _fired = true;
  setPrecombatFrozen(true);
  const shown = showQuickDialogue(_RANSOM_LINES, () => {
    showChoiceUI([
      { label: 'Pay the ransom', onPick: _onPaid },
      { label: 'Refuse',         onPick: _onRefused },
    ]);
  });
  // ⚠ showQuickDialogue BANKS instead of showing while any hero is at hp<=0
  // (heroRoster-wide, so one corpse is enough) and replays after the short rest.
  // The freeze above would then hold the party in place with no dialogue on
  // screen and no buttons to dismiss — a soft-lock. Release it and let the
  // banked copy carry the scene whenever it does replay; the choice still works,
  // the party just isn't pinned while it waits.
  if (!shown) setPrecombatFrozen(false);
}

// ── Per-frame tick ────────────────────────────────────────────────────────────
export function tickHideOut(dt) {
  if (!_active) return;

  const sildar = _sildar();
  if (!sildar) return;

  // He's up and with the party (paid, or refused-then-revived) — on this visit or
  // an earlier one. Checked FIRST so a revived Sildar is never re-flattened by the
  // downed branch below.
  if (_flag(JOINED_KEY)) {
    if (!_following) _beginFollow();
    _checkArrival(sildar);
    return;
  }

  // Refused and not yet brought round. The zone always spawns him upright, so put
  // him back on the floor — this covers both the fight itself and re-entering the
  // zone before the rescue. Retries until the GLB is ready.
  if (_isDowned()) {
    if (!_posedDown && playUnitClip(sildar, DEATH_CLIP, { loop: false, lock: true })) {
      _posedDown = true;
    }
    // Recovery path for a rescue that never got queued — e.g. the party left the
    // zone mid-fight and came back to a camp they'd already cleared, so
    // combat:ended fired while this zone wasn't active.
    //
    // ⚠ Three guards, and all three are load-bearing. _dropped excludes the drop
    // that just happened THIS visit (combat hasn't started yet — there's a ~2s
    // gap between the swing and initiative, and without this he'd sit up again
    // before the first goblin moved). _combat excludes an active fight, and
    // _campCleared excludes walking back into a camp that's still standing.
    if (!_combat && !_dropped && !_reviveFired && _posedDown && _campCleared()) {
      _reviveFired = true;
      showQuickDialogue(_REVIVE_LINES, _reviveSildar);
    }
    return;
  }

  if (_combat || _fired) return;

  // Spring the standoff when any living hero reaches the camp mouth.
  for (const h of _heroes()) {
    const dx = h.grp.position.x - TRIGGER_X;
    const dz = h.grp.position.z - TRIGGER_Z;
    if (dx * dx + dz * dz <= TRIGGER_R * TRIGGER_R) { _openStandoff(); return; }
  }
}

// Once he's caught up with Leugren, the thank-you exchange plays (one-shot).
function _checkArrival(u) {
  if (_arrived || _combat) return;
  const leader = _leugren();
  if (!leader) return;
  const dx = u.grp.position.x - leader.grp.position.x;
  const dz = u.grp.position.z - leader.grp.position.z;
  if (dx * dx + dz * dz > ARRIVE_R * ARRIVE_R) return;
  _arrived = true;
  showQuickDialogue(_ARRIVE_LINES);
}

// Dev dialogue panel entries, so these can be replayed without walking the zone.
registerDialogueScene({ id: 'dlg_sildar_ransom',  name: 'Sildar — Ransom',    lines: _RANSOM_LINES });
registerDialogueScene({ id: 'dlg_sildar_arrive',  name: 'Sildar — Joins',     lines: _ARRIVE_LINES });
registerDialogueScene({ id: 'dlg_sildar_depart',  name: 'Sildar — Departure', lines: _DEPART_LINES });
