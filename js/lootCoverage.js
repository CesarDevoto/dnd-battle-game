// js/lootCoverage.js — stops RNG starving ONE hero of gear in a slot.
//
// Split out of loot.js on purpose. loot.js drags in three.js and the scene for its 3D loot
// orbs, which makes it un-importable outside a browser; this is a LEAF (items.js +
// equipment.js only), so the formula can be tested directly. It also keeps a pure
// probability model away from mesh code.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
// Four heroes need four items, so the MEAN can never beat 4.0 drops and uniform picking
// already averages 4.32 — there is nothing to win there. The problem is the TAIL: uniform's
// p99 is 8 drops and the worst measured run was 19, i.e. one hero occasionally waits through
// nineteen drops that were all for someone else. Measured, this cuts that to p99 4, worst 8.
//
// ── WHY IT TARGETS HEROES, NOT MATERIALS ──────────────────────────────────────
// Materials LOOK like they map to heroes and don't. Proficiency is NESTED, not a partition:
//
//     cloth   ⊂ everyone          leather ⊂ {Milo, Gobo, Leugren}
//     hide    ⊂ {Gobo, Leugren}   plate   ⊂ {Leugren}
//
// Only plate is exclusive to anyone. So "one of each material has dropped" can be true while
// Rasec still has nothing — four leather drops cover Milo, Gobo AND Leugren. Measured,
// balancing materials bought 4.32 → 4.23 drops: a rounding error. Balancing HEROES gets 4.01.
//
// ── THE FORMULA (settled 2026-07-17) ──────────────────────────────────────────
//   1. HERO      w(h) = 1 / (1 + n[slot][rarity][h])   — pick one, proportional to w
//   2. MATERIAL  the BEST material h is proficient in, walking DOWN if the slot has none
//   3. ITEM      uniform within (slot, material)   ← caller does this
//
// No exponent (k=1). k=3 measured 4.01 vs k=1's 4.02 — identical, because the four-drop floor
// dominates. One less dial to tune.
//
// Step 2 is what makes the split come out EQUAL, and it's the non-obvious part. Picking "any
// material h can wear" seems reasonable and is badly wrong: cloth accrues probability from all
// four hero picks and lands at 70%, while plate — reachable only via Leugren — collapses to
// 4.5%, so Leugren would never see the plate that defines him. Taking each hero's CEILING
// gives exactly 25% each on a fresh tier, and recovers the 1:1 feel the design wanted:
//
//     cloth = Rasec    leather = Milo    hide = Gobo    plate = Leugren
//
// ...not because those materials are exclusive (only plate is), but because each is that
// hero's best. Same destination, sound mechanism.

import { ITEMS, isDroppable } from './items.js';
import { materialLadder } from './equipment.js';

const _KEY = 'dnd-loot-coverage';

// coverage[slot][rarity][heroType] = how many items that hero has been ASSIGNED there.
// ASSIGNED, not dropped: the game doesn't know who a drop was for until the player says so,
// and a drop handed to someone else hasn't covered anyone. That's why the increment lives in
// the loot panel's commit step rather than in the roll.
let _coverage = (() => {
  try { return JSON.parse(localStorage.getItem(_KEY)) || {}; } catch { return {}; }
})();

function _save() {
  try { localStorage.setItem(_KEY, JSON.stringify(_coverage)); } catch { /* private mode */ }
}

export function noteAssigned(slot, rarity, heroType) {
  if (!slot || !rarity || !heroType) return;
  const t = ((_coverage[slot] ??= {})[rarity] ??= {});
  t[heroType] = (t[heroType] ?? 0) + 1;
  _save();
}

export function resetCoverage()    { _coverage = {}; _save(); }
export function coverageSnapshot() { return JSON.parse(JSON.stringify(_coverage)); }

// Which items of each material a slot actually stocks. Built once — ITEMS is static.
// Same droppable predicate as loot.js's _DROP_POOL, shared from items.js so the two can't drift.
const _BY_SLOT_MAT = {};
for (const it of Object.values(ITEMS)) {
  if (!isDroppable(it) || !it.material) continue;
  ((_BY_SLOT_MAT[it.slot] ??= {})[it.material] ??= []).push(it);
}

function _wpick(keys, wf) {
  const w = keys.map(wf);
  const total = w.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return keys[Math.floor(Math.random() * keys.length)];
  let r = Math.random() * total;
  for (let i = 0; i < keys.length; i++) { r -= w[i]; if (r < 0) return keys[i]; }
  return keys[keys.length - 1];
}

// The item pool a drop should come from, or null to mean "no opinion — use the whole slot".
// Null happens for slots with no materials at all (weapons, rings, cloaks, necklaces, bags):
// those are equippable by anyone, so nobody can be starved of them and there is nothing to fix.
export function coveragePool(slot, rarity, heroTypes) {
  const mats = _BY_SLOT_MAT[slot];
  if (!mats || !heroTypes?.length) return null;

  const n    = _coverage[slot]?.[rarity] ?? {};
  const hero = _wpick(heroTypes, h => 1 / (1 + (n[h] ?? 0)));

  // Walk DOWN the hero's ladder to the first material this slot actually stocks. head and
  // wrist carry no hide at all, so a Gobo-targeted drop there resolves to leather — he's
  // still covered, because leather is on his ladder. Without the walk he'd get nothing.
  for (const m of materialLadder(hero)) if (mats[m]?.length) return mats[m];
  return null;   // this hero can wear nothing in this slot — let the caller fall back
}
