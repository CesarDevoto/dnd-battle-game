import { UNIT_TYPES } from './constants.js';
import { totalSpellSlots } from './spells.js';

// Pure AI query helpers — no combat module state, dependencies injected via params.
// runAITurn() remains in combat.js as the orchestrator that wires state in.
//
// `losBetween(a, b)` is a UNIT-PAIR line-of-sight test (combat.js's unitsHaveLOS), not the
// raw coordinate form. It has to be: in a cave zone the same x/z exists on two layers, so
// coordinates alone cannot say whether an enemy up on the blanket can see a hero in the
// tunnel underneath it — only the units' caveLayer can. aiPickHeroDest is the exception and
// still takes a coordinate hasLOS, because it tests candidate TILES rather than units; its
// caller binds the layers into the closure it passes.

export function aiPickTarget(u, units, losBetween) {
  // Familiars (Rasec's owl) are valid targets but VASTLY de-prioritized, so
  // enemies only rarely bother with the fragile 1-HP owl. A real hero is almost
  // always preferred; the owl only gets picked on unlucky rolls or when it's the
  // sole option. FAMILIAR_AGGRO is the score multiplier (lower = rarer).
  const FAMILIAR_AGGRO = 0.03;
  const heroes = units.filter(h => (h.team === 'blue' || h.familiar) && h.hp > 0);
  if (!heroes.length) return null;
  if (heroes.length === 1) return heroes[0];

  const ux = u.grp.position.x, uz = u.grp.position.z;

  const scored = heroes.map(h => {
    const dx = h.grp.position.x - ux, dz = h.grp.position.z - uz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const distScore = 1 / ((dist + 1) * (dist + 1));
    const losBonus = losBetween(u, h) ? 1.5 : 1.0;
    const jitter = 0.90 + Math.random() * 0.20;
    const familiarPen = h.familiar ? FAMILIAR_AGGRO : 1;
    return { h, score: distScore * losBonus * jitter * familiarPen };
  });

  const total = scored.reduce((s, e) => s + e.score, 0);
  let r = Math.random() * total;
  for (const e of scored) {
    r -= e.score;
    if (r <= 0) return e.h;
  }
  return scored[scored.length - 1].h;
}

export function aiGetAttack(u, target, turnAttacked, atkHasQty, atkTriggerWU, atkRangeWU, losBetween) {
  if (turnAttacked) return null;
  const def    = UNIT_TYPES[u.type] ?? {};
  const atks   = def.attacks ?? [];
  const meleeA = atks.find(a => a.type === 'melee');
  const rangdA = atks.find(a => a.type === 'ranged');
  const dx = target.grp.position.x - u.grp.position.x;
  const dz = target.grp.position.z - u.grp.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Web (giant spider): the ranged branch below already fires it from range; here we
  // let the spider ALSO spit web ~50% of the time when in melee (if the target isn't
  // already ensnared and there's line of sight), instead of biting.
  const webA = atks.find(a => a.web);
  const canWeb = webA && !target.actionSave &&
    dist <= atkRangeWU(webA.range) &&
    losBetween(u, target);

  if (meleeA && dist <= atkTriggerWU(meleeA)) {
    if (canWeb && Math.random() < 0.5) return webA;
    return meleeA;
  }
  const hasJ = rangdA && atkHasQty(u, rangdA);
  const los  = hasJ && losBetween(u, target);
  if (rangdA && los && dist <= atkRangeWU(rangdA.range))                        return rangdA;
  if (rangdA && los && rangdA.longRange && dist <= atkRangeWU(rangdA.longRange)) return rangdA;
  return null;
}

// Attack picker for spellcaster AI (e.g. Morvath).
// Priority: aoe_save spell (if slots + range + LOS) → melee spell (if slots + melee) → physical melee fallback.
export function aiGetSpellcasterAttack(u, target, turnAttacked, atkTriggerWU, atkRangeWU, losBetween) {
  if (turnAttacked) return null;
  const def   = UNIT_TYPES[u.type] ?? {};
  const atks  = def.attacks ?? [];
  const slots = totalSpellSlots(u);   // enemy casters keep the flat pool; helper reads both shapes
  const dx = target.grp.position.x - u.grp.position.x;
  const dz = target.grp.position.z - u.grp.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const los  = losBetween(u, target);
  if (slots > 0) {
    const aoeSave = atks.find(a => a.type === 'aoe_save');
    if (aoeSave && los && dist <= atkRangeWU(aoeSave.range)) return aoeSave;
    const meleeSpell = atks.find(a => a.type === 'melee' && a.spellSlotCost);
    if (meleeSpell && dist <= atkTriggerWU(meleeSpell)) return meleeSpell;
  }
  const physMelee = atks.find(a => a.type === 'melee' && !a.spellSlotCost);
  if (physMelee && dist <= atkTriggerWU(physMelee)) return physMelee;
  return null;
}

// Destination picker for spellcaster AI — inverts the melee-approach bias.
// Ideal zone: within aoe_save spell range but outside melee trigger.
// Scores: ideal zone maximizes distance from target (-dist*10); melee zone penalized (+10000); outside spell range closes in (raw dist).
export function aiPickSpellcasterDest(u, target, validTiles, atkTriggerWU, atkRangeWU) {
  if (!validTiles.size) return null;
  const tx = target.grp.position.x, tz = target.grp.position.z;
  const def      = UNIT_TYPES[u.type] ?? {};
  const atks     = def.attacks ?? [];
  const meleeA   = atks.find(a => a.type === 'melee');
  const aoeSaveA = atks.find(a => a.type === 'aoe_save');
  const meleeTrigger = meleeA   ? atkTriggerWU(meleeA)       : 0;
  const spellRange   = aoeSaveA ? atkRangeWU(aoeSaveA.range)  : 0;
  let best = null, bestScore = Infinity;
  for (const key of validTiles) {
    const [kx, kz] = key.split(',').map(Number);
    const dx = tx - kx, dz = tz - kz, dist = Math.sqrt(dx * dx + dz * dz);
    const inMelee = meleeTrigger > 0 && dist <= meleeTrigger;
    const inSpell = spellRange   > 0 && dist <= spellRange;
    let score;
    if      (inSpell && !inMelee) score = -dist * 10;    // ideal: maximize distance within spell range
    else if (inMelee)             score = 10000 + dist;  // avoid: strongly penalize melee zone
    else                          score = dist;           // outside range: close in
    if (score < bestScore) { bestScore = score; best = { x: kx, z: kz }; }
  }
  return best;
}

// After throwing a javelin: close toward melee, ignoring ranged-range stops.
export function aiPickDestTowardMelee(u, target, validTiles, atkTriggerWU) {
  if (!validTiles.size) return null;
  const tx = target.grp.position.x, tz = target.grp.position.z;
  const def = UNIT_TYPES[u.type] ?? {};
  const meleeA = (def.attacks ?? []).find(a => a.type === 'melee');
  const meleeTrigger = meleeA ? atkTriggerWU(meleeA) : 0;
  let best = null, bestScore = Infinity;
  for (const key of validTiles) {
    const [kx, kz] = key.split(',').map(Number);
    const dx = tx - kx, dz = tz - kz, dist = Math.sqrt(dx * dx + dz * dz);
    const score = dist - (meleeTrigger > 0 && dist <= meleeTrigger ? 1000 : 0);
    if (score < bestScore) { bestScore = score; best = { x: kx, z: kz }; }
  }
  return best;
}

// tileLOS(kx, kz) → bool: is there a clear shot from that TILE to the target? Optional; when
// omitted every tile is treated as having a clear shot, which is the old behaviour exactly.
//
// ⚠ A ranged-range tile only earns its bonus if the shot actually CONNECTS. Without this the
// picker was blind to line of sight (aiPickHeroDest has scored LOS since the kiting fix; this,
// the ENEMY twin, never did), so it judged a ranged tile purely on distance. In a zone full of
// LOS blockers — addProp defaults blocksLOS to TRUE, so every tree in the Haunted Wood is one —
// the giant spider kept picking the nearest tile, which left it behind the same trunk it was
// already behind. Its ONLY ranged attack is the Web, which aiGetAttack gates on LOS, so it then
// found nothing to do and doAttack silently ended the turn. Two wasted rounds of walking, then a
// bite on the third, once it was close enough that melee (which needs no LOS) applied.
//
// Melee keeps its flat -1000: a bite doesn't care about line of sight, and closing to melee must
// still outrank standing off at range.
export function aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU, tileLOS = null) {
  if (!validTiles.size) return null;
  const tx = target.grp.position.x, tz = target.grp.position.z;
  const def          = UNIT_TYPES[u.type] ?? {};
  const atks         = def.attacks ?? [];
  const meleeA       = atks.find(a => a.type === 'melee');
  const rangdA       = atks.find(a => a.type === 'ranged');
  const meleeTrigger = meleeA ? atkTriggerWU(meleeA) : 0;
  const rangedRange  = rangdA ? atkRangeWU(rangdA.range) : 0;
  const longRange    = rangdA?.longRange ? atkRangeWU(rangdA.longRange) : 0;

  // The old form scored every tile inline and paid a tileLOS() call — a per-tile LINE-OF-SIGHT
  // RAYCAST (plus cave terrain samples) — on every tile in bow range. In a barrier-heavy cave a
  // ranged enemy's reachable set is ~100 tiles, so that's ~100 raycasts PER dest pick, and the
  // ranged AI runs two picks a turn (walk, then sprint) — the ~550ms 'setTimeout took Nms'
  // stalls between enemy moves. The scoring only ever needs ONE winner though, and the tiers are
  // fixed: melee (−1000, no LOS) ALWAYS outranks a clear ranged shot (−600), which always
  // outranks a clear long shot (−400), which outranks any bare tile — because the tier gaps
  // (400+) dwarf any in-tier distance spread on a bounded grid. So resolve the tiers in order and
  // only raycast the few tiles that could actually win: melee needs no LOS at all, and for the
  // ranged/long tiers the closest tile WITH a clear shot wins, so we test in ascending distance
  // and stop at the first hit. Same pick as before; ~100 raycasts becomes 0–2.
  let bestMelee = null, bestMeleeD = Infinity;
  let overall   = null, overallD   = Infinity;
  const rangedTiles = [], longTiles = [];
  for (const key of validTiles) {
    const [kx, kz] = key.split(',').map(Number);
    const dx = tx - kx, dz = tz - kz, dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < overallD) { overallD = dist; overall = { x: kx, z: kz }; }
    if (meleeTrigger > 0 && dist <= meleeTrigger) {
      if (dist < bestMeleeD) { bestMeleeD = dist; bestMelee = { x: kx, z: kz }; }
    } else if (rangedRange > 0 && dist <= rangedRange) {
      rangedTiles.push({ x: kx, z: kz, d: dist });
    } else if (longRange > 0 && dist <= longRange) {
      longTiles.push({ x: kx, z: kz, d: dist });
    }
  }
  // Melee is the top tier and needs no line of sight.
  if (bestMelee) return bestMelee;
  // No LOS fn → every in-range tile counts as a clear shot (matches the old los=true default).
  const clear = tileLOS ? (t => tileLOS(t.x, t.z)) : (() => true);
  rangedTiles.sort((a, b) => a.d - b.d);
  for (const t of rangedTiles) if (clear(t)) return { x: t.x, z: t.z };
  longTiles.sort((a, b) => a.d - b.d);
  for (const t of longTiles) if (clear(t)) return { x: t.x, z: t.z };
  // No tile offers a shot — just close the distance as much as possible.
  return overall;
}

// Destination picker for ally-proximity tendency (Leugren healer modes).
// Moves toward the most wounded ally. near_ally_melee → minimize distance;
// near_ally_ranged → same but allows stopping at crossbow range rather than adjacent.
export function aiPickAllyDest(u, allies, validTiles) {
  if (!validTiles.size || !allies.length) return null;
  const wounded = allies.reduce((best, a) => {
    const maxHp = UNIT_TYPES[a.type]?.hp ?? a.hp;
    const ratio  = a.hp / maxHp;
    if (!best || ratio < best.ratio) return { unit: a, ratio };
    return best;
  }, null)?.unit ?? allies[0];

  const tx = wounded.grp.position.x, tz = wounded.grp.position.z;
  let best = null, bestDist = Infinity;
  for (const key of validTiles) {
    const [kx, kz] = key.split(',').map(Number);
    const dx = tx - kx, dz = tz - kz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) { bestDist = dist; best = { x: kx, z: kz }; }
  }
  return best;
}

// Destination picker for automated hero turns — respects preferred_range tendency.
// 'melee'        → strongly prefer tiles in melee range, ranged as fallback.
// 'ranged'/'kite'→ prefer ranged range, avoid melee; maximise distance within range.
// 'stay'         → caller should skip this function entirely.
// extraRangedAtk: for heroes whose ranged option is a spell/cantrip that
// deliberately isn't in UNIT_TYPES.attacks (e.g. Rasec's Fire Bolt — kept out
// of attacks[] so it doesn't masquerade as a ranged weapon), the caller can
// pass an attacks[]-shaped object here so positioning still accounts for it.
// Cap how far a ranged/kiting hero tries to retreat, independent of their
// true weapon/spell range. Without this, a long-range caster (e.g. Rasec's
// Fire Bolt at 90ft vs. Milo's Shortbow at 40ft) treats "maximize distance
// within range" as license to retreat 3x farther every turn — technically
// correct positioning, but reads as "running away too much." Their real
// attack range is unaffected; this only bounds the positioning heuristic.
const MAX_KITE_RANGE_FT = 50;

export function aiPickHeroDest(u, target, validTiles, preferredRange, atkTriggerWU, atkRangeWU, hasLOS, extraRangedAtk = null) {
  if (!validTiles.size) return null;
  const tx = target.grp.position.x, tz = target.grp.position.z;
  const def  = UNIT_TYPES[u.type] ?? {};
  const atks = def.attacks ?? [];
  const meleeA       = atks.find(a => a.type === 'melee');
  const rangdA       = atks.find(a => a.type === 'ranged') ?? extraRangedAtk;
  const meleeTrigger = meleeA ? atkTriggerWU(meleeA)     : 0;
  const rawRangedRange = rangdA ? atkRangeWU(rangdA.range) : 0;
  const rangedRange  = rawRangedRange > 0 ? Math.min(rawRangedRange, atkRangeWU(MAX_KITE_RANGE_FT)) : 0;

  // Ranged heroes hold position if already at a comfortable standoff: between
  // 40% and 100% of ranged range, not in melee range, and with clear LOS.
  // Prevents Rasec/Milo from retreating to the edge of the map every turn.
  if (preferredRange !== 'melee' && rangedRange > 0) {
    const ux = u.grp.position.x, uz = u.grp.position.z;
    const cdx = tx - ux, cdz = tz - uz;
    const curDist    = Math.sqrt(cdx * cdx + cdz * cdz);
    const minStandoff = rangedRange * 0.40;
    const notInMelee  = meleeTrigger <= 0 || curDist > meleeTrigger;
    const inRange     = curDist <= rangedRange;
    const farEnough   = curDist >= minStandoff;
    const currentLOS  = hasLOS ? hasLOS(ux, uz, tx, tz) : true;
    if (inRange && farEnough && notInMelee && currentLOS) return null;
  }

  let best = null, bestScore = Infinity;
  for (const key of validTiles) {
    const [kx, kz] = key.split(',').map(Number);
    const dx = tx - kx, dz = tz - kz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    let score;
    if (preferredRange === 'melee') {
      score = dist;
      if (meleeTrigger > 0 && dist <= meleeTrigger)   score -= 1000;
      else if (rangedRange > 0 && dist <= rangedRange) score -=  300;
    } else {
      // 'ranged' or 'kite': avoid melee, maximise distance within ranged range
      // Prefer tiles with clear LOS to avoid heroes hiding behind walls
      const inMelee  = meleeTrigger > 0 && dist <= meleeTrigger;
      const inRanged = rangedRange  > 0 && dist <= rangedRange;
      const los      = hasLOS ? hasLOS(kx, kz, tx, tz) : true;
      if (inMelee) {
        score = 10000 + dist;        // avoid melee range
      } else if (inRanged && los) {
        score = -dist;               // ideal: max distance in range with clear LOS
      } else if (inRanged) {
        score = 5000 - dist;         // in range but wall-blocked — last resort
      } else {
        score = dist;                // out of range — move closer
      }
    }
    if (score < bestScore) { bestScore = score; best = { x: kx, z: kz }; }
  }
  return best;
}
