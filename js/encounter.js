// ════════════════════════════════════════════════════════════════════════════
//  ENCOUNTER GENERATOR
//  Biome × party level → monster pool; difficulty → adjusted XP budget.
// ════════════════════════════════════════════════════════════════════════════

// Monster pools: BIOME_MONSTERS[biome][partyLevel] = [{type, xp}, ...]
// Types must match UNIT_TYPES keys in constants.js.
// XP values match xpReward fields in UNIT_TYPES.
const BIOME_MONSTERS = {

  // ── Tundra ────────────────────────────────────────────────────────────────
  tundra: {
    1: [
      { type: 'kobold',     xp: 25  },
      { type: 'wolf',       xp: 50  },
      { type: 'ice_mephit', xp: 100 },
    ],
    2: [
      { type: 'orc',        xp: 100 },
      { type: 'ogre',       xp: 450 },
      { type: 'ice_mephit', xp: 100 },
      { type: 'wolf',       xp: 50  },
      { type: 'dire_wolf',  xp: 200 },
    ],
    3: [
      { type: 'ogre',      xp: 450  },
      { type: 'ettin',     xp: 1100 },
      { type: 'troll',     xp: 1800 },
      { type: 'yeti',      xp: 700  },
      { type: 'dire_wolf', xp: 200  },
    ],
  },

  // ── Savanna ───────────────────────────────────────────────────────────────
  savanna: {
    1: [
      { type: 'kobold',            xp: 25  },
      { type: 'gnoll',             xp: 100 },
      { type: 'hyena',             xp: 25  },
      { type: 'constrictor_snake', xp: 50  },
    ],
    2: [
      { type: 'gnoll',             xp: 100 },
      { type: 'bugbear',           xp: 200 },
      { type: 'gnoll_pack_lord',   xp: 450 },
      { type: 'hyena',             xp: 25  },
      { type: 'crocodile',         xp: 100 },
      { type: 'swarm_of_insects',  xp: 100 },
    ],
    3: [
      { type: 'bugbear',                  xp: 200  },
      { type: 'gnoll_pack_lord',          xp: 450  },
      { type: 'gnoll_fang',               xp: 1100 },
      { type: 'giant_constrictor_snake',  xp: 200  },
    ],
  },

  // ── Forest ────────────────────────────────────────────────────────────────
  forest: {
    1: [
      { type: 'goblin',      xp: 50  },
      { type: 'twig_blight', xp: 25  },
      { type: 'wolf',        xp: 50  },
      { type: 'stirge',      xp: 25  },
      { type: 'giant_spider', xp: 200 },
    ],
    2: [
      { type: 'goblin',            xp: 50  },
      { type: 'bugbear',           xp: 200 },
      { type: 'dire_wolf',         xp: 200 },
      { type: 'hobgoblin',         xp: 100 },
      { type: 'giant_spider',      xp: 200 },
      { type: 'constrictor_snake', xp: 50  },
    ],
    3: [
      { type: 'bugbear',                 xp: 200  },
      { type: 'dire_wolf',               xp: 200  },
      { type: 'owlbear',                 xp: 700  },
      { type: 'ettin',                   xp: 1100 },
      { type: 'hobgoblin',               xp: 100  },
      { type: 'werewolf',                xp: 700  },
      { type: 'giant_constrictor_snake', xp: 200  },
    ],
  },

  // ── Desert ────────────────────────────────────────────────────────────────
  desert: {
    1: [
      { type: 'kobold',  xp: 25  },
      { type: 'gnoll',   xp: 100 },
      { type: 'hyena',   xp: 25  },
    ],
    2: [
      { type: 'gnoll',              xp: 100 },
      { type: 'gnoll_pack_lord',    xp: 450 },
      { type: 'yuan_ti_pureblood',  xp: 200 },
      { type: 'mud_mephit',         xp: 50  },
      { type: 'swarm_of_insects',   xp: 100 },
    ],
    3: [
      { type: 'gnoll_pack_lord',   xp: 450  },
      { type: 'gnoll_fang',        xp: 1100 },
      { type: 'yuan_ti_pureblood', xp: 200  },
      { type: 'yuan_ti_malison',   xp: 1100 },
    ],
  },

  // ── Graveyard ─────────────────────────────────────────────────────────────
  graveyard: {
    1: [
      { type: 'skeleton',   xp: 50  },
      { type: 'zombie',     xp: 50  },
      { type: 'giant_rat',  xp: 25  },
      { type: 'twig_blight', xp: 25 },
    ],
    2: [
      { type: 'skeleton', xp: 50  },
      { type: 'zombie',   xp: 50  },
      { type: 'shadow',   xp: 100 },
      { type: 'ghoul',    xp: 200 },
      { type: 'specter',  xp: 200 },
      { type: 'ghast',    xp: 450 },
    ],
    3: [
      { type: 'ghast',    xp: 450  },
      { type: 'wight',    xp: 700  },
      { type: 'werewolf', xp: 700  },
      { type: 'banshee',  xp: 1100 },
      { type: 'revenant', xp: 1800 },
    ],
  },

  // ── Swamp ─────────────────────────────────────────────────────────────────
  swamp: {
    1: [
      { type: 'kobold',      xp: 25  },
      { type: 'giant_frog',  xp: 50  },
      { type: 'stirge',      xp: 25  },
      { type: 'bullywug',    xp: 50  },
      { type: 'mud_mephit',  xp: 50  },
      { type: 'crocodile',   xp: 100 },
      { type: 'giant_rat',   xp: 25  },
      { type: 'skeleton',    xp: 50  },
      { type: 'zombie',      xp: 50  },
    ],
    2: [
      { type: 'lizardfolk',        xp: 100 },
      { type: 'giant_toad',        xp: 200 },
      { type: 'bullywug_croaker',  xp: 200 },
      { type: 'swarm_of_insects',  xp: 100 },
      { type: 'constrictor_snake', xp: 50  },
    ],
    3: [
      { type: 'shambling_mound',         xp: 1800 },
      { type: 'lizardfolk_shaman',       xp: 450  },
      { type: 'green_hag',               xp: 700  },
      { type: 'troll',                   xp: 1800 },
      { type: 'giant_constrictor_snake', xp: 200  },
    ],
  },

  // ── Dungeon ───────────────────────────────────────────────────────────────
  dungeon: {
    1: [
      { type: 'kobold',     xp: 25  },
      { type: 'goblin',     xp: 50  },
      { type: 'giant_rat',  xp: 25  },
      { type: 'stirge',     xp: 25  },
      { type: 'troglodyte', xp: 50  },
    ],
    2: [
      { type: 'orc',         xp: 100 },
      { type: 'hobgoblin',   xp: 100 },
      { type: 'bugbear',     xp: 200 },
      { type: 'giant_spider', xp: 200 },
      { type: 'skeleton',    xp: 50  },
      { type: 'zombie',      xp: 50  },
      { type: 'troglodyte',  xp: 50  },
      { type: 'ghoul',       xp: 200 },
    ],
    3: [
      { type: 'bugbear',   xp: 200  },
      { type: 'hobgoblin', xp: 100  },
      { type: 'minotaur',  xp: 700  },
      { type: 'ogre',      xp: 450  },
      { type: 'ettin',     xp: 1100 },
      { type: 'ghast',     xp: 450  },
      { type: 'wight',     xp: 700  },
      { type: 'shadow',    xp: 100  },
    ],
  },
};

// D&D 5e encounter multiplier by total monster count
function getMult(n) {
  if (n <= 1) return 1;
  if (n === 2) return 1.5;
  if (n <= 6) return 2;
  return 2.5;
}

/**
 * Generates a random encounter for the given biome, difficulty, and party level.
 *
 * Target adjusted XP = partyLevel × diffMult × 4 (for 4 heroes).
 * The algorithm samples 500 random combinations, scoring each by how closely
 * its adjusted XP (raw XP × encounter multiplier) matches the target, then
 * returns the best-scoring combination.
 *
 * @param {string} biome      - activeEnv key: 'forest'|'tundra'|'savanna'|'desert'|'swamp'|'graveyard'|'dungeon'
 * @param {string} difficulty - 'easy' | 'medium' | 'hard'
 * @param {number} partyLevel - 1 | 2 | 3
 * @returns {Object} Map of type → count, e.g. { goblin: 2, twig_blight: 3 }
 */
export function generateEncounter(biome, difficulty, partyLevel) {
  const pool = BIOME_MONSTERS[biome]?.[partyLevel];
  if (!pool?.length) return {};

  const diffMult    = { easy: 40, medium: 60, hard: 80 }[difficulty] ?? 60;
  const targetAdjXP = partyLevel * diffMult * 4;  // 4-hero party

  let best = null, bestScore = Infinity;

  for (let trial = 0; trial < 500; trial++) {
    const combo = {};
    let xpTotal = 0, count = 0;

    // Pick 1–3 random types from the pool for variety
    const shuffled  = [...pool].sort(() => Math.random() - 0.5);
    const typeCount = Math.min(shuffled.length, 1 + Math.floor(Math.random() * 3));
    const types     = shuffled.slice(0, typeCount);

    // Aim for a random total of 1–6 monsters
    const targetCount = 1 + Math.floor(Math.random() * 6);

    for (let i = 0; i < targetCount; i++) {
      const m      = types[Math.floor(Math.random() * types.length)];
      const newXP  = xpTotal + m.xp;
      const newAdj = newXP * getMult(count + 1);
      // Stop if adding this monster would double the target budget and we have ≥1
      if (newAdj > targetAdjXP * 2.0 && count >= 1) break;
      combo[m.type] = (combo[m.type] ?? 0) + 1;
      xpTotal = newXP;
      count++;
    }

    if (!count) continue;

    const adjXP = xpTotal * getMult(count);
    const score = Math.abs(adjXP - targetAdjXP) / targetAdjXP;

    if (score < bestScore) {
      bestScore = score;
      best = { ...combo };
    }
    if (bestScore < 0.15) break;  // within 15% — good enough
  }

  return best ?? {};
}
