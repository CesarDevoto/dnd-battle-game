import { UNIT_TYPES } from './constants.js';

// Pure AI query helpers — no combat module state, dependencies injected via params.
// runAITurn() remains in combat.js as the orchestrator that wires state in.

export function aiPickTarget(u, units, hasLineOfSight) {
  const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
  if (!heroes.length) return null;
  if (heroes.length === 1) return heroes[0];

  const ux = u.grp.position.x, uz = u.grp.position.z;

  const scored = heroes.map(h => {
    const dx = h.grp.position.x - ux, dz = h.grp.position.z - uz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const distScore = 1 / (dist + 1);
    const losBonus = hasLineOfSight(ux, uz, h.grp.position.x, h.grp.position.z) ? 1.5 : 1.0;
    const jitter = 0.80 + Math.random() * 0.40;
    return { h, score: distScore * losBonus * jitter };
  });

  const total = scored.reduce((s, e) => s + e.score, 0);
  let r = Math.random() * total;
  for (const e of scored) {
    r -= e.score;
    if (r <= 0) return e.h;
  }
  return scored[scored.length - 1].h;
}

export function aiGetAttack(u, target, turnAttacked, atkHasQty, atkTriggerWU, atkRangeWU, hasLineOfSight) {
  if (turnAttacked) return null;
  const def    = UNIT_TYPES[u.type] ?? {};
  const atks   = def.attacks ?? [];
  const meleeA = atks.find(a => a.type === 'melee');
  const rangdA = atks.find(a => a.type === 'ranged');
  const dx = target.grp.position.x - u.grp.position.x;
  const dz = target.grp.position.z - u.grp.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (meleeA && dist <= atkTriggerWU(meleeA)) return meleeA;
  const hasJ = rangdA && atkHasQty(u, rangdA);
  const los  = hasJ && hasLineOfSight(u.grp.position.x, u.grp.position.z,
                                      target.grp.position.x, target.grp.position.z);
  if (rangdA && los && dist <= atkRangeWU(rangdA.range))                        return rangdA;
  if (rangdA && los && rangdA.longRange && dist <= atkRangeWU(rangdA.longRange)) return rangdA;
  return null;
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

export function aiPickDest(u, target, validTiles, atkTriggerWU, atkRangeWU) {
  if (!validTiles.size) return null;
  const tx = target.grp.position.x, tz = target.grp.position.z;
  const def          = UNIT_TYPES[u.type] ?? {};
  const atks         = def.attacks ?? [];
  const meleeA       = atks.find(a => a.type === 'melee');
  const rangdA       = atks.find(a => a.type === 'ranged');
  const meleeTrigger = meleeA ? atkTriggerWU(meleeA) : 0;
  const rangedRange  = rangdA ? atkRangeWU(rangdA.range) : 0;
  const longRange    = rangdA?.longRange ? atkRangeWU(rangdA.longRange) : 0;
  let best = null, bestScore = Infinity;
  for (const key of validTiles) {
    const [kx, kz] = key.split(',').map(Number);
    const dx = tx - kx, dz = tz - kz, dist = Math.sqrt(dx * dx + dz * dz);
    let score = dist;
    if (meleeTrigger > 0 && dist <= meleeTrigger)   score -= 1000;
    else if (rangedRange > 0 && dist <= rangedRange) score -= 600;
    else if (longRange > 0 && dist <= longRange)     score -= 400;
    if (score < bestScore) { bestScore = score; best = { x: kx, z: kz }; }
  }
  return best;
}
