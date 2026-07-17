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
import { materialLadder, MATERIAL_RANK, canEquip } from './equipment.js';

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

// A drop's coverage CATEGORY — the thing a hero is or isn't proficient with. Armor uses its
// material; weapons/ammo use their weaponType; shields and foci are their own kind. Anything
// returning null (rings, cloaks, necklaces, bags) has no proficiency and can't starve anyone.
const _categoryOf = it =>
  it.material ?? it.weaponType ?? (it.ac ? '_shield' : it.focus ? '_focus' : null);

// Which items of each category a slot actually stocks. Built once — ITEMS is static. Same
// droppable predicate as loot.js's _DROP_POOL, shared from items.js so the two can't drift.
const _BY_SLOT_CAT = {};
for (const it of Object.values(ITEMS)) {
  const c = isDroppable(it) ? _categoryOf(it) : null;
  if (!c) continue;
  ((_BY_SLOT_CAT[it.slot] ??= {})[c] ??= []).push(it);
}

// Which of these heroes can use a (slot, category). Cached: canEquip needs a hero instance and
// the roster is stable for a session, so this is a handful of entries computed once.
const _usersCache = {};
function _usersOf(slot, cat, heroTypes) {
  const key = slot + '|' + cat + '|' + heroTypes.join(',');
  if (_usersCache[key]) return _usersCache[key];
  const probe = _BY_SLOT_CAT[slot][cat][0];
  return (_usersCache[key] = heroTypes.filter(h => canEquip({ type: h }, probe)));
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
  const cats = _BY_SLOT_CAT[slot];
  if (!cats || !heroTypes?.length) return null;

  // STEP 1 — the hero this drop is for. Identical for armor and weapons.
  const n    = _coverage[slot]?.[rarity] ?? {};
  const hero = _wpick(heroTypes, h => 1 / (1 + (n[h] ?? 0)));

  // STEP 2 — the category. Two rules, because armor and weapons have different SHAPES.
  //
  // ARMOR is a perfect CHAIN: cloth ⊂ leather ⊂ hide ⊂ plate by proficiency, so each hero's
  // ceiling is unique and every material has exactly one owner (cloth=Rasec, leather=Milo,
  // hide=Gobo, plate=Leugren). Taking the ceiling gives an even 25/25/25/25.
  //
  // Walk DOWN the ladder to the first material the slot stocks: head and wrist carry no hide
  // at all, so a Gobo-targeted drop there resolves to leather — still covered, since leather
  // is on his ladder. Without the walk he'd get nothing.
  if (Object.keys(cats).some(c => MATERIAL_RANK[c] !== undefined)) {
    for (const m of materialLadder(hero)) if (cats[m]?.length) return cats[m];
    return null;
  }

  // WEAPONS / SHIELDS / FOCI / AMMO are NOT a chain — Milo's named martials (Longsword,
  // Shortsword) and Leugren's (Battleaxe, Warhammer) are DISJOINT, and nobody tops out at the
  // 3-hero band. A ceiling rule here would leave Handaxe, Light Hammer and Javelin with no
  // owner at all: 12 of 58 main-hand items permanently undroppable. Measured, not guessed.
  //
  // So weight by EXCLUSIVITY — 1 / (heroes who can use it). Every category stays reachable,
  // and each hero is still pushed hard toward what's most distinctively theirs: Gobo to
  // Greataxe/Greatsword (his alone, weight 1), Leugren to Warhammer/Battleaxe (1/2), Milo to
  // Longsword/Shortsword (1/2), while shared simple weapons (1/3, 1/4) stay possible but rare.
  const mine = Object.keys(cats).filter(c => _usersOf(slot, c, heroTypes).includes(hero));
  if (!mine.length) return null;   // this hero can use nothing here — caller falls back
  return cats[_wpick(mine, c => 1 / _usersOf(slot, c, heroTypes).length)];
}
