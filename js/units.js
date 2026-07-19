import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { scene } from './scene.js';
import { UNIT_TYPES, COMBAT } from './constants.js';
import { getTerrainHeight, getGroundHeight, initialCaveLayer } from './terrain.js';
import { addUnitDungeonLight } from './environments.js';
import { equipItem } from './equipment.js';
import { getItem } from './items.js';

export const units      = [];
export const corpses    = [];  // animated units that have died — kept for mixer updates
export const heroRoster = [];  // all 4 hero unit objects, never cleared on death

const hud = document.getElementById('hud');

// ── Model loading ─────────────────────────────────────────────────────────────

const loader     = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);   // decode meshopt-compressed GLBs
const modelCache = {};

const MODEL_PATHS = {
  kobold:     'assets/models/kobold.glb',
  goblin:     'assets/models/goblin.glb',
  orc:        'assets/models/orc.glb',
  ogre:       'assets/models/ogre.glb',
  elf:        'assets/models/elf.glb',
  // Leugren carrying a shield. Same rig and the same six clips as the old dwarf.glb —
  // only the mesh differs — so the `dwarf` clip mapping below still resolves unchanged.
  // The old dwarf.glb / dwarf1.glb were deleted once this was adopted (recoverable from
  // git history if ever needed).
  dwarf:      'assets/models/leugrenshield.glb',
  // Gobo. Rig-identical to the old barbarian.glb it replaced (same 24 joints, same seven
  // clips) — only the mesh differs — so the `human` mapping below still resolves. That
  // matters here: attack:'Skill_03' and rangedAttack:'mage_soell_cast_4' are user
  // overrides, not clip-name matches, so a renamed clip would break him silently.
  // The old barbarian/1/2 GLBs were deleted once this was adopted (recoverable from git).
  human:      'assets/models/barbarian3.glb',
  halfling:   'assets/models/halfling.glb',
  snake:                   'assets/models/snake.glb',
  constrictor_snake:       'assets/models/snake.glb',
  giant_constrictor_snake: 'assets/models/snake.glb',
  twig_blight: 'assets/models/twigblight.glb',
  hyena:        'assets/models/hyena.glb',
  wolf:         'assets/models/wolf.glb',
  dire_wolf:    'assets/models/wolf.glb',
  werewolf:     'assets/models/wolf.glb',
  warg:         'assets/models/warg.glb',
  ice_mephit:   'assets/models/icemephit.glb',
  stirge:       'assets/models/stirge.glb',
  giant_spider: 'assets/models/spider.glb',
  // Dedicated models
  gnoll:          'assets/models/gnoll2.glb',
  gnoll_pack_lord:'assets/models/gnoll2.glb',
  gnoll_fang:     'assets/models/gnoll2.glb',
  giant_rat:      'assets/models/giantrat.glb',
  hobgoblin:      'assets/models/hobgoblin.glb',
  hobgoblin_captain: 'assets/models/hobgoblinchief.glb',
  goblin2:        'assets/models/goblin2.glb',
  commoner:       'assets/models/npcs/peasant1.glb',   // reuse the peasant model (static pose)
  owlbear:        'assets/models/owlbear.glb',
  troglodyte:     'assets/models/troglodyte.glb',
  ghoul:          'assets/models/ghoul.glb',
  zombie:         'assets/models/zombie.glb',
  skeleton:       'assets/models/skeleton.glb',
  shadow:         'assets/models/shadow.glb',
  ettin:          'assets/models/ettin.glb',
  hill_giant:     'assets/models/hillgiant.glb',
  nothic:         'assets/models/noxic.glb',
  // Demon monsters
  mane:             'assets/models/mane.glb',
  abyssal_wretch:   'assets/models/abyssalwretch.glb',
  abyssal_chicken:  'assets/models/abyssalchicken.glb',
  // Friendly NPCs
  grassling: 'assets/models/grassling.glb',
  solrac:    'assets/models/npcs/solrac.glb',
  owl:       'assets/models/owl.glb',
  // Townsfolk NPCs — assets/models/npcs/ subfolder (lowercase — case-sensitive on deploy)
  npc_dwarf:          'assets/models/npcs/npc dwarf.glb',
  peasant:            'assets/models/npcs/peasant1.glb',
  bard1:              'assets/models/npcs/bard1.glb',
  barmaid1:           'assets/models/npcs/barmaid1.glb',
  barmaid2:           'assets/models/npcs/barmaid2.glb',
  darkelf1:           'assets/models/npcs/darkelf1.glb',
  dwarf2:             'assets/models/npcs/dwarf2.glb',
  dwarfwarrior:       'assets/models/npcs/dwarfwarrior.glb',
  elf2:               'assets/models/npcs/elf2.glb',
  elffemale1:         'assets/models/npcs/elffemale1.glb',
  elffemale2:         'assets/models/npcs/elffemalenaked.glb',
  elfmonk:            'assets/models/npcs/elfmonk.glb',
  gnome1:             'assets/models/npcs/gnome1.glb',
  gnomemonk:          'assets/models/npcs/gnomemonk.glb',
  gnomewarrior:       'assets/models/npcs/gnomewarrior.glb',
  gnomewizard:        'assets/models/npcs/gnomewizard.glb',
  halfling2:          'assets/models/npcs/halfling2.glb',
  halflingadventurer: 'assets/models/npcs/halflingadventurer.glb',
  halflingarcher:     'assets/models/npcs/halflingarcher.glb',
  halflingbarbarian:  'assets/models/npcs/halflingbarbarian.glb',
  halflingbard:       'assets/models/npcs/halflingbard.glb',
  halflingrogue:      'assets/models/npcs/halflingrogue.glb',
  humanpeasant1:      'assets/models/npcs/humanpeasant1.glb',
  humanpeasant2:      'assets/models/npcs/humanpeasant2.glb',
  humanwarrior1:      'assets/models/npcs/humanwarrior1.glb',
  orcbarmaid:         'assets/models/npcs/orcbarmaid.glb',
  tiefling_bard:      'assets/models/npcs/tiefling bard.glb',
  waitress1:          'assets/models/npcs/waitress1.glb',
  // Swamp monsters — proxied to closest existing GLB until dedicated models are added
  giant_frog:        'assets/models/goblin.glb',
  bullywug:          'assets/models/goblin.glb',
  bullywug_croaker:  'assets/models/orc.glb',
  mud_mephit:        'assets/models/kobold.glb',
  crocodile:         'assets/models/hyena.glb',
  giant_toad:        'assets/models/hyena.glb',
  swarm_of_insects:  'assets/models/swarm.glb',
  lizardfolk_shaman: 'assets/models/orc.glb',
  green_hag:         'assets/models/goblin.glb',
  // Named bosses
  morvath:           'assets/models/morvath.glb',
};

// All GLB-loaded types are eligible for animation — derived from MODEL_PATHS so it stays in sync automatically.
const ANIMATED_TYPES = new Set(Object.keys(MODEL_PATHS));

// Types that have no skeleton — animated purely via grp.scale manipulation each frame.
const SCALE_ANIMATE_TYPES = new Set(['swarm_of_insects']);
const _SCALE_ATTACK_DUR   = 0.30; // seconds for the attack swell
const _SCALE_DEATH_DUR    = 0.70; // seconds to shrink to zero

// Manual overrides for animation clip → role mapping.
// Auto-detection handles new models; add an entry here only when auto-detection
// gets a slot wrong for a specific GLB.
const ANIM_CLIP_NAMES = {
  // new GLB has clean names; pin explicitly so Skill_03/Sword_Parry_Backward_5 don't displace slots
  ogre: {
    idle: 'Idle_02', walk: 'Walking', run: 'Running', attack: 'Attack', death: 'Dead',
  },
  // New rigged Meshy goblin (goblin2.glb). Clips: Dead, Idle_02,
  // Right_Hand_Sword_Slash, Running, Walking — melee-only (no archery clip),
  // so rangedAttack is pinned null. Same slash clip as the dwarf hero export.
  goblin2: {
    idle: 'Idle_02', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash',
    rangedAttack: null, death: 'Dead',
  },
  // New barbarian GLB (Jul 2026, 3rd export) — clip set changed again. This export has
  // a clip literally named "Attack" but user directed Skill_03 for the real melee swing
  // instead (per lesson from prior exports: don't trust clip names at face value). No
  // dedicated throw/archery clip this time — user directed the spell-cast pose
  // (mage_soell_cast_4) be reused for Gobo's thrown-handaxe ranged attack.
  human: {
    idle: 'Idle_5', walk: 'Walking', run: 'Running', attack: 'Skill_03',
    rangedAttack: 'mage_soell_cast_4', death: 'Dead',
  },
  // mage_soell_cast_7 has larger rangeY than Archery_Shot_1 so auto-detection grabs it first
  halfling: {
    rangedAttack: 'Archery_Shot_1',
  },
  // New dwarf GLB (Jul 2026) — clip names mostly match content, verified via Hips.position
  // Y-range/duration (Dead drops to 13.81 vs standing ~90 = death; Idle_5 has smallest
  // rangeY = idle; Right_Hand_Sword_Slash has the biggest swing = melee attack).
  // No dedicated archery clip in this export (old Archery_Shot_1 is gone) — rangedAttack
  // pinned null so auto-detect doesn't wrongly grab mage_soell_cast_7 (the spell cast).
  dwarf: {
    idle: 'Idle_5', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash',
    rangedAttack: null, spellCast: 'mage_soell_cast_7', death: 'Dead',
  },
  // Non-humanoid flying rig — three clips (verified in GLB): "Flap", "Idle",
  // "Rest Pose" (exact casing matters — clip lookup is c.name === name). Idle is
  // the perched/shoulder-rest animation used when standing still; Flap drives all
  // movement/attack; Rest Pose is the neutral bind pose, reused for death since
  // there's no dedicated death clip.
  owl: {
    idle: 'Idle', walk: 'Flap', run: 'Flap', attack: 'Flap', death: 'Rest Pose',
  },
  // Non-humanoid rig — no Hips/Pelvis bone; pin clips by name directly
  giant_spider: {
    idle: 'Idle', walk: 'Walk', run: 'Walk', attack: 'Attack', death: 'Death',
  },
  snake: {
    idle: 'Idle', walk: 'Side winding', attack: 'Bite', death: 'Death',
  },
  constrictor_snake: {
    idle: 'Idle', walk: 'Side winding', attack: 'Bite', death: 'Death',
  },
  giant_constrictor_snake: {
    idle: 'Idle', walk: 'Side winding', attack: 'Bite', death: 'Death',
  },
  // New owlbear.glb (Jul 2026, 2nd export). Clips, verified by reading the GLB rather than
  // trusting the names: Dead, Idle_10, jump_push_up, Right_Hand_Sword_Slash, Running,
  // Walking, Zombie_Scream — all seven are real 24-joint skeletal animations.
  //
  // Classic scrambled-Meshy naming: the names do NOT describe the content.
  //   • walk AND run = jump_push_up. It is not a jump — it's the head-up run cycle, and it's
  //     the locomotion we want (user-directed; the pin is the whole point of this mapping).
  //   • attack = Right_Hand_Sword_Slash → the CLAW swipe. No sword involved.
  //   • Bite   = Zombie_Scream, bound per-attack via animClip in UNIT_TYPES.owlbear.
  //   • The plainly-named 'Running' and 'Walking' are left UNUSED on purpose. Don't "fix"
  //     this by pointing the loco slots at them.
  //
  // rangedAttack pinned null: no archery clip here, and without the pin autoMapAnimClips
  // grabs a loco clip for it (the recurring bug on the dwarf/skeleton rigs).
  owlbear: {
    idle: 'Idle_10', walk: 'jump_push_up', run: 'jump_push_up',
    attack: 'Right_Hand_Sword_Slash', rangedAttack: null, death: 'Dead',
  },
  // Idle_03 has large hip rangeY (18.4) so auto-detection misclassifies it as attack;
  // null in attack slot explicitly clears the mis-detected slot.
  grassling: {
    idle: 'Idle_03', walk: 'Walking', run: 'Running', attack: null,
  },
  // Clean clip names; per design the rat lunges on attack, so map attack → Jump
  // (the Bite clip is left unused). Pin all roles explicitly for stability.
  giant_rat: {
    idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Jump', death: 'Death',
  },
  // hyena.glb (re-exported with animations Jul 2026). Clips: Bite, Death, Idle Alert, Run,
  // Walk — cleanly named by the artist, so pin them all by name rather than trust the
  // Hips-Y heuristic. rangedAttack:null: no ranged clip, and without the pin autoMapAnimClips
  // would hand the slot a walk cycle. crocodile + giant_toad borrow this same GLB as a
  // placeholder, so they get the same mapping below.
  hyena: {
    idle: 'Idle Alert', walk: 'Walk', run: 'Run', attack: 'Bite', rangedAttack: null, death: 'Death',
  },
  crocodile: {
    idle: 'Idle Alert', walk: 'Walk', run: 'Run', attack: 'Bite', rangedAttack: null, death: 'Death',
  },
  giant_toad: {
    idle: 'Idle Alert', walk: 'Walk', run: 'Run', attack: 'Bite', rangedAttack: null, death: 'Death',
  },
  // solrac.glb has a real standing idle (Idle_11) plus loco + sit/cheer poses.
  // Pin the standing idle and loco explicitly; no attack clip (peaceful NPC).
  solrac: {
    idle: 'Idle_11', walk: 'Walking.001', run: 'Running.001', attack: null,
  },
  // Archery_Shot_1 (rangeY 8.6) beats Walking (7.0) on the loco tiebreak since both are 1.0s;
  // pin the two swapped slots to fix it.
  kobold: {
    walk: 'Walking', rangedAttack: 'Archery_Shot_1',
  },
  twig_blight: {
    idle: 'Idle_7', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash', death: 'Dead',
  },
  // ettin.glb (re-exported 2026-07-12). Clips: Archery_Shot_1, Attack, Dead, Idle_4,
  // Left_Hook_from_Guard, Right_Hand_Sword_Slash, Running, Walking. Pinned rather than
  // auto-mapped for the usual two reasons: Archery_Shot_1 ties Walking on the loco
  // tiebreak and can steal `walk`, and the ettin has no ranged attack at all (two melee
  // weapons), so rangedAttack must be null or autoMapAnimClips hands it a walk cycle.
  // 'Attack' is the two-weapon swing; the hook/slash clips are left unused.
  ettin: {
    idle: 'Idle_4', walk: 'Walking', run: 'Running', attack: 'Attack', rangedAttack: null, death: 'Dead',
  },
  // No dedicated archery clip in this export (verified: Dead, Idle_8,
  // Right_Hand_Sword_Slash, Running, Unsteady_Walk, Walking — same gap as
  // the dwarf rig) — without rangedAttack:null, autoMapAnimClips grabs Walking
  // for it, so a Shortbow shot plays a walk cycle while standing still.
  skeleton: {
    idle: 'Idle_8', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash', rangedAttack: null, death: 'Dead',
  },
  // gnoll2.glb (adopted 2026-07-13, replacing gnoll.glb). Same rig and same clip library as
  // gnoll.glb — 1 skin / 24 joints / 28 nodes, and every shared clip is authored identically —
  // with ONE swap: Charged_Slash is GONE, and a real Archery_Shot_1 takes its place.
  // Clips: Archery_Shot_1, Charged_Upward_Slash, Dead, ForwardLeft_Run_Fight, Idle_5,
  // Running, Walking.
  //
  // Ranged is now the real archery clip instead of a slash standing in for one — that swap is
  // the whole point of this model. Losing Charged_Slash moves melee onto Charged_Upward_Slash,
  // which had read wrong as a melee swing back on gnoll.glb; it reads fine here and is signed
  // off, so this mapping is settled, not a stopgap.
  //
  // Run is the FIGHT run (ForwardLeft_Run_Fight); the plain 'Running' clip is left unused.
  // Pinned rather than auto-mapped for the usual reason: Archery_Shot_1 is 1.0s and ties
  // Walking on the loco tiebreak, so auto-detection can hand it the `walk` slot.
  // ONE GLB SERVES THREE UNIT TYPES (gnoll, gnoll_pack_lord, gnoll_fang), and
  // ANIM_CLIP_NAMES is keyed by type — so all three need the entry or the two without it
  // fall back to auto-detection.
  gnoll: {
    idle: 'Idle_5', walk: 'Walking', run: 'ForwardLeft_Run_Fight',
    attack: 'Charged_Upward_Slash', rangedAttack: 'Archery_Shot_1', death: 'Dead',
  },
  gnoll_pack_lord: {
    idle: 'Idle_5', walk: 'Walking', run: 'ForwardLeft_Run_Fight',
    attack: 'Charged_Upward_Slash', rangedAttack: 'Archery_Shot_1', death: 'Dead',
  },
  // Bite + Claw, both melee — no ranged attack, so the rangedAttack slot never plays.
  // Mapped anyway for consistency; harmless, and it stops autoMapAnimClips grabbing a
  // walk cycle for it if a ranged attack is ever added.
  gnoll_fang: {
    idle: 'Idle_5', walk: 'Walking', run: 'ForwardLeft_Run_Fight',
    attack: 'Charged_Upward_Slash', rangedAttack: 'Archery_Shot_1', death: 'Dead',
  },
  // hobgoblin.glb (re-exported 2026-07-13). Clips: Archery_Shot_1, Dead, Idle_8,
  // Right_Hand_Sword_Slash, Running, Walking. Same clip family as the skeleton above —
  // but this export DOES have the archery clip, and the hobgoblin actually carries a
  // Longbow, so rangedAttack is mapped rather than pinned null. Pinned explicitly
  // because Archery_Shot_1 ties Walking on the loco tiebreak and can steal `walk`.
  hobgoblin: {
    idle: 'Idle_8', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash',
    rangedAttack: 'Archery_Shot_1', death: 'Dead',
  },
  // hobgoblinchief.glb (dedicated boss model, adopted 2026-07-15). Clip family matches the
  // base hobgoblin PLUS a Left_Hook_from_Guard — which we deliberately IGNORE. His two
  // attacks are Right_Hand_Sword_Slash (Greatsword) and Archery_Shot_1 (Longbow); he
  // multiattacks with those two in any combination (see constants.js multiattack).
  hobgoblin_captain: {
    idle: 'Idle_8', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash',
    rangedAttack: 'Archery_Shot_1', death: 'Dead',
  },
  // Slow_Orc_Walk used for patrol/normal movement; Running for combat charge; Walking unused
  ghoul: {
    idle: 'Idle_8', walk: 'Slow_Orc_Walk', run: 'Running', attack: 'Right_Hand_Sword_Slash', death: 'Dead',
  },
  zombie: {
    idle: 'Idle_4', walk: 'Limping_Walk_3_inplace', run: 'Limping_Walk_3_inplace', attack: 'Attack', death: 'Dead',
  },
  // No legs — idle animation used for all locomotion
  shadow: {
    idle: 'Idle_8', walk: 'Idle_8', run: 'Idle_8', attack: 'Right_Hand_Sword_Slash', death: 'Dead',
  },
  // Non-humanoid rig; clip names provided directly by artist
  abyssal_chicken: {
    idle: 'idle', walk: 'walk', run: 'walk', attack: 'flap', death: 'rest pose',
  },
  // Non-humanoid flying rig; glide for idle, flap for all movement/attack, idle for death
  stirge: {
    idle: 'glide', walk: 'flap', run: 'flap', attack: 'flap', death: 'idle',
  },
};

// Auto-detect animation roles by analysing Hips/Root bone Y-axis movement in each clip.
// Returns { idle, walk, attack, rangedAttack, death } with clip names, or null if no
// position track is found (caller falls back to manual ANIM_CLIP_NAMES).
// Returns { idle, walk, attack, rangedAttack, death } as AnimationClip objects (not names).
// Using clip objects directly avoids the meshy.ai duplicate-name problem where
// clips.find(c => c.name === x) returns the wrong clip when multiple clips share a name.
function autoMapAnimClips(clips) {
  const analyzed = clips.map(clip => {
    const posTrack = clip.tracks.find(t =>
      t.name.endsWith('.position') && /(hip|pelvis|root)/i.test(t.name)
    );
    if (!posTrack) return { clip, hasData: false };
    const vals = posTrack.values;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < vals.length; i += 3) {
      if (vals[i] < minY) minY = vals[i];
      if (vals[i] > maxY) maxY = vals[i];
    }
    return { clip, hasData: true, minY, maxY, rangeY: maxY - minY, duration: clip.duration };
  });

  const withData = analyzed.filter(a => a.hasData);
  if (withData.length === 0) return null;

  const standingY = Math.max(...withData.map(a => a.maxY));
  const result    = { idle: null, walk: null, run: null, attack: null, rangedAttack: null, spellCast: null, death: null };
  let pool        = [...withData];

  // 1. Death — Hips drops below 40% of standing height; most distinctive signature
  const deathBest = pool.reduce((b, a) => (!b || a.minY < b.minY) ? a : b, null);
  if (deathBest && deathBest.minY < standingY * 0.40) {
    result.death = deathBest.clip;
    pool = pool.filter(a => a !== deathBest);
  }

  // 2. Idle — smallest Y range (body barely moves)
  pool.sort((a, b) => a.rangeY - b.rangeY);
  if (pool.length > 0) result.idle = pool.shift().clip;

  // 3. Walk + Run — locomotion loops: small rangeY (< 15% standingY) + short duration (< 2 s)
  //    Walk = longest/largest-rangeY loco candidate; Run = shortest (fast cycle)
  const LOCO_RANGE = standingY * 0.15;
  const loco = pool.filter(a => a.rangeY < LOCO_RANGE && a.duration < 2.0);
  if (loco.length > 0) {
    loco.sort((a, b) => b.duration - a.duration || b.rangeY - a.rangeY);
    result.walk = loco[0].clip;
    pool = pool.filter(a => a !== loco[0]);
    // Run = shortest remaining loco candidate (run cycles are faster than walk cycles)
    const remainingLoco = loco.slice(1);
    if (remainingLoco.length > 0) {
      remainingLoco.sort((a, b) => a.duration - b.duration);
      result.run = remainingLoco[0].clip;
      pool = pool.filter(a => a !== remainingLoco[0]);
    }
  }

  // 4. Melee attack — largest remaining Y range (biggest body movement / weapon swing)
  pool.sort((a, b) => b.rangeY - a.rangeY);
  if (pool.length > 0) result.attack = pool.shift().clip;

  // 5. Ranged / spell attack — next largest remaining
  if (pool.length > 0) result.rangedAttack = pool[0].clip;

  return result;
}

function loadOne(type) {
  const path  = MODEL_PATHS[type];
  const def   = UNIT_TYPES[type];
  const label = def ? `${def.name} (${type})` : type;
  console.log(`[units] Loading ${label} → ${path}`);
  return new Promise(resolve => {
    loader.load(
      path,
      gltf => {
        console.log(`[units] ✓ ${label} loaded successfully`);
        modelCache[type] = gltf;
        resolve();
      },
      null,
      err => {
        console.warn(`[units] ✗ ${label} FAILED to load — placeholder box will be used`, err);
        modelCache[type] = null;
        resolve();
      }
    );
  });
}

// ── Model loading: per-zone, not everything up front ─────────────────────────
// This used to be Promise.all over EVERY entry in MODEL_PATHS — all ~80 unit GLBs, plus
// environments.js eagerly loading its props, on every single page load regardless of which
// zone you were in. Decompressed geometry + animation tracks + the CPU-side copies of all
// those textures is most of what was left of the tab's memory footprint after the texture
// resize, and you paid for every enemy in the game while standing in one zone.
//
// Now a type is fetched the first time something actually needs it. _pending memoizes the
// in-flight promise so N callers asking for the same type share one network fetch.
const _pending = {};

export function ensureModels(types) {
  return Promise.all(
    [...new Set(types)]
      .filter(t => MODEL_PATHS[t])
      .map(t => (_pending[t] ??= loadOne(t)))
  );
}

// The only models resident from boot: the four heroes (on screen in every zone) and the
// owl familiar (Rasec can summon it anywhere). buildUnit falls back to a placeholder box
// for a type whose GLB hasn't arrived, so anything built off these must be loaded first —
// zoneLoader awaits modelsReady before the first loadZone().
const ALWAYS_LOADED = ['dwarf', 'human', 'elf', 'halfling', 'owl'];
export const modelsReady = ensureModels(ALWAYS_LOADED);

// ── Team colour tint ──────────────────────────────────────────────────────────

const TEAM_TINT = {
  red:      new THREE.Color(0x220808),
  blue:     new THREE.Color(0x080822),
  npc:      new THREE.Color(0x000000),
  familiar: new THREE.Color(0x000000),
};

// ── Unit builder ──────────────────────────────────────────────────────────────

// layerOverride: 'surface' | 'under' — pins which walkable surface the unit stands on
// in a cave zone. Without it, initialCaveLayer() auto-derives from headroom, which
// always returns 'under' wherever there is rock above — so a unit placed on the HILL
// ABOVE a tunnel would silently drop to the tunnel floor on zone load. Zone data may
// now carry `caveLayer` per enemy/NPC to pin it to the surface instead.
export function buildUnit(worldX, worldZ, team, type = 'goblin', animOverrides = null, layerOverride = null) {
  const def   = UNIT_TYPES[type] ?? UNIT_TYPES.goblin;
  const gltf  = modelCache[type];
  const label = def.name ?? type;
  const src   = gltf?.scene ? MODEL_PATHS[type] : 'PLACEHOLDER BOX (model failed to load)';
  console.log(`[units] Building ${label} (${type}) for team ${team} → ${src}`);

  const caveLayer = layerOverride ?? initialCaveLayer(worldX, worldZ);

  // Where this unit was PLACED, as opposed to where it currently stands. The NPC
  // editor's save must serialize this, never the live grp.position: a unit that moves
  // at runtime (Solrac following Leugren, Floosh guiding, a patrolling or roaming
  // enemy) would otherwise rewrite its own spawn point in the zone file to wherever it
  // happened to be standing the moment you hit save. That is how Solrac ended up
  // spawning at the hero entrance instead of in his shackles, and very likely how
  // Floosh's spawn line was mangled back in July.
  const spawn = { x: worldX, z: worldZ, layer: caveLayer };
  const terrainY  = getGroundHeight(worldX, worldZ, caveLayer);
  if (type === 'orc') {
    console.log('Orc spawned at position:', { x: worldX, y: terrainY, z: worldZ });
  }

  const grp = new THREE.Group();
  grp.position.set(worldX, terrainY, worldZ);
  grp.rotation.y = team === 'blue' ? Math.PI : 0;  // heroes face north (-Z); enemies and NPCs face south (+Z)

  // Animation state — only populated for ANIMATED_TYPES
  let mixer = null, idleAction = null, walkAction = null, runAction = null, attackAction = null, rangedAttackAction = null, spellCastAction = null, deathAction = null;
  // The cloned GLB root under grp. Kept on the unit so per-clip body pose (see the loco
  // pitch in setUnitWalking) can tilt the MODEL without touching grp, which owns the unit's
  // facing, its world position and the HP-bar anchor.
  let modelRoot = null;
  let unitClips = null;   // raw gltf.animations, exposed so events can play unmapped clips (e.g. Solrac's Bar_Hang_Idle)

  if (gltf?.scene) {
    const model = SkeletonUtils.clone(gltf.scene);

    // Fix negative / non-uniform scales baked into structural (non-bone) nodes.
    // Uniform tiny scales (e.g. 0.01 from CC cm→m conversion) are left intact.
    model.rotation.set(0, 0, 0);
    model.traverse(node => {
      if (node.isBone) return;
      const s = node.scale;
      if (s.x < 0) s.x = -s.x;
      if (s.y < 0) s.y = -s.y;
      if (s.z < 0) s.z = -s.z;
      const lo = Math.min(s.x, s.y, s.z), hi = Math.max(s.x, s.y, s.z);
      if (hi > 0 && (hi - lo) / hi > 0.05) s.set(hi, hi, hi);
    });

    // Shadows + team tint
    model.traverse(node => {
      if (!node.isMesh && !node.isSkinnedMesh) return;
      node.castShadow = node.receiveShadow = true;
      if (!node.material) return;
      const tint = mat => {
        const m = mat.clone();
        if (m.emissiveMap) {
          // meshy.ai / emissive-primary model: emissive texture IS the color source.
          // Don't touch emissiveIntensity or the texture goes dark.
          // Fix: force opaque (GLB exports as BLEND by default) and reduce shininess.
          m.transparent = false;
          m.depthWrite  = true;
          m.roughness   = Math.max(m.roughness ?? 0, 0.85);
          m.metalness   = 0;
        } else if (m.emissive instanceof THREE.Color) {
          m.emissive.copy(TEAM_TINT[team]);
          m.emissiveIntensity = 0.18;
        }
        return m;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(tint) : tint(node.material);
    });

    if (type === 'shadow') {
      model.traverse(node => {
        if (!node.isMesh && !node.isSkinnedMesh) return;
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(mat => {
          mat.transparent = true;
          mat.opacity     = 0.5;
          mat.needsUpdate = true;
        });
      });
      grp.userData.baseOpacity = 0.5;
    }

    model.scale.set(...def.scale);
    model.position.y = def.yOffset ?? 0;
    if (def.modelRotY != null) model.rotation.y = def.modelRotY;
    grp.add(model);
    modelRoot = model;

    // ── Skeletal animation setup ─────────────────────────────────────────────
    if (ANIMATED_TYPES.has(type) && !SCALE_ANIMATE_TYPES.has(type) && gltf.animations?.length) {
      const clips = gltf.animations;
      unitClips = clips;
      mixer = new THREE.AnimationMixer(model);

      // Auto-detect roles — returns clip objects directly so duplicate meshy.ai names can't collide
      const autoClips = autoMapAnimClips(clips) ?? {};
      // Fallback: if bone names didn't match (no position tracks found), treat first clip as idle
      if (!autoClips.idle && clips.length > 0) autoClips.idle = clips[0];

      // Type-level overrides: clip names we control, safe to look up by name.
      // null explicitly clears a slot that auto-detection filled incorrectly.
      for (const [role, clipName] of Object.entries(ANIM_CLIP_NAMES[type] ?? {})) {
        if (clipName === null) { delete autoClips[role]; continue; }
        const found = clips.find(c => c.name === clipName);
        if (found) autoClips[role] = found;
      }
      // Per-instance overrides: stored as clip indices to avoid meshy.ai name collisions
      for (const [role, clipIdx] of Object.entries(animOverrides ?? {})) {
        const clip = clips[clipIdx];
        if (clip) autoClips[role] = clip;
      }

      const idleClip = autoClips.idle ?? null;
      const walkClip = autoClips.walk ?? null;
      const runClip  = autoClips.run  ?? null;

      if (idleClip) {
        idleAction = mixer.clipAction(idleClip);
        idleAction.reset().setEffectiveWeight(1).play();
      }
      if (walkClip) { walkAction = mixer.clipAction(walkClip); walkAction.setLoop(THREE.LoopRepeat, Infinity); }
      if (runClip)  { runAction  = mixer.clipAction(runClip);  runAction.setLoop(THREE.LoopRepeat, Infinity);  }

      // NPCs never enter combat — skip attack/death actions entirely.
      if (team !== 'npc') {
        const attackClip       = autoClips.attack       ?? null;
        const rangedAttackClip = autoClips.rangedAttack ?? null;
        const spellCastClip    = autoClips.spellCast    ?? null;
        const deathClip        = autoClips.death        ?? null;
        if (attackClip) {
          attackAction = mixer.clipAction(attackClip);
          attackAction.setLoop(THREE.LoopOnce, 1);
          attackAction.clampWhenFinished = false;
        }
        if (rangedAttackClip) {
          rangedAttackAction = mixer.clipAction(rangedAttackClip);
          rangedAttackAction.setLoop(THREE.LoopOnce, 1);
          rangedAttackAction.clampWhenFinished = false;
        }
        if (spellCastClip) {
          spellCastAction = mixer.clipAction(spellCastClip);
          spellCastAction.setLoop(THREE.LoopOnce, 1);
          spellCastAction.clampWhenFinished = false;
        }
        if (deathClip) {
          deathAction = mixer.clipAction(deathClip);
          deathAction.setLoop(THREE.LoopOnce, 1);
          deathAction.clampWhenFinished = true;
        }
      }
    }

  } else {
    // Fallback placeholder when GLB failed to load
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.4, 0.4),
      new THREE.MeshLambertMaterial({ color: team === 'red' ? 0x882222 : 0x224488 })
    );
    mesh.castShadow = true;
    mesh.position.y = 0.7;
    grp.add(mesh);
    grp.scale.set(...def.scale);
  }

  scene.add(grp);
  if (team === 'blue') addUnitDungeonLight(grp);

  const anchorY = def.anchorY;
  const hoverY  = def.hoverY ?? 0;
  const anchor  = new THREE.Vector3(worldX, terrainY + anchorY, worldZ);

  // NPCs have no hp bar and no combat stats — they are animated props.
  let barEl = null, fill = null, hp = 0, maxHp = 1, atkQty = {};
  if (team !== 'npc') {
    // ── Health bar DOM ──────────────────────────────────────────────────────
    const _barEl = document.createElement('div');
    _barEl.className = 'hp-bar';
    const track = document.createElement('div'); track.className = 'hp-track';
    const _fill = document.createElement('div'); _fill.className = `hp-fill ${team} ${type}`;
    track.appendChild(_fill);
    _barEl.appendChild(track);
    hud.appendChild(_barEl);
    barEl = _barEl;
    fill  = _fill;

    const baseHp = def.hp ?? COMBAT.defaultHP;
    const _xp    = def.xpReward ?? 0;
    const _mult  = team !== 'red' ? 1 : _xp >= 1000 ? 1.0 : _xp >= 220 ? 1.2 : 1.5;
    hp    = Math.round(baseHp * _mult);
    maxHp = hp;
    for (const atk of (def.attacks ?? [])) {
      if (atk.qty !== undefined) atkQty[atk.name] = atk.qty;
    }
  }

  // Ranged/spell anim rotation: elf spell faces forward with CCW (+π/2); all others CW (-π/2)
  const rangedRotY = UNIT_TYPES[type]?.rangedRotY ?? (type === 'elf' ? 0 : -Math.PI / 2);

  const _phaseOff = team === 'blue'
    ? units.filter(u => u.team === 'blue').length * 0.3
    : Math.random();

  const u = { grp, anchor, anchorY, hoverY, barEl, fill, hp, maxHp, team, type,
              caveLayer, spawn,
              familiar: def.familiar ?? false,
              barForced: false, barShowUntil: 0, xp: 0, level: 1, atkQty,
              spellSlots: def.spellSlots,
              _animPhaseOffset: _phaseOff,
              mixer, idleAction, walkAction, runAction, attackAction, rangedAttackAction, spellCastAction, deathAction, isWalking: false,
              model: modelRoot,
              clips: unitClips,
              rangedRotY, animOverrides: animOverrides ? { ...animOverrides } : {},
              // scale-animate state (only used when SCALE_ANIMATE_TYPES.has(type))
              _scaleMode: SCALE_ANIMATE_TYPES.has(type) ? 'idle' : null,
              _scaleElapsed: 0,
              _scaleOnComplete: null };
  units.push(u);
  if (team === 'blue') {
    if (!u.equipment) {
      u.equipment = {};
      const starting = UNIT_TYPES[type]?.startingEquipment;
      if (starting) {
        for (const [slot, itemId] of Object.entries(starting)) {
          const item = getItem(itemId);
          if (!item) continue;
          // equipment{} was just created empty, so nothing CAN be displaced here — unless
          // startingEquipment contradicts itself (a twoHanded main-hand alongside an
          // off-hand item), in which case one of them would silently never be worn. That's
          // a data bug, so say so rather than drop the loser on the floor.
          const bumped = equipItem(u, item, slot);
          // null = armor proficiency refused it. startingEquipment is authored data, so this
          // is a DATA bug (a hero issued armor their class can't wear), not a player action —
          // it would leave them with an empty slot forever. Say so loudly.
          if (bumped === null) {
            console.error(`[startingEquipment] ${type}: ${item.name} (${item.material}) requires ` +
              `proficiency ${type} doesn't have — slot "${slot}" left EMPTY.`);
            continue;
          }
          if (bumped.length) {
            console.warn(`[startingEquipment] ${type}: equipping ${item.name} displaced ` +
              `${bumped.map(b => b.name).join(', ')} — a two-handed weapon and an off-hand item can't coexist.`);
          }
        }
      }
    }
    if (!u.currency)  u.currency  = { copper: 0, silver: 0, gold: 5, platinum: 0 };
    // One roster entry per hero type, always the LIVE object. buildUnit hands back a brand
    // new object every call, and two paths rebuild the heroes from scratch (_fullReset, and
    // Dagna's River Styx transition) without pruning the roster. Appending blindly left the
    // dead pre-Styx objects in here forever, which broke every find-by-type consumer (they
    // take the FIRST match — the stale one) and made short rest reviveUnit() the ghosts
    // straight back into units[] as phantom duplicate heroes.
    const ri = heroRoster.findIndex(h => h.type === type);
    if (ri >= 0) heroRoster[ri] = u;
    else         heroRoster.push(u);
  }
  return u;
}

// ── Animation mixer updates ───────────────────────────────────────────────────

const _ANIM_FADE = 0.25; // crossfade duration in seconds

export function updateMixers(dt) {
  // Skip skinned-mesh animation for dormant enemies — they're beyond the activation radius
  // and faded to invisible (see activationRadius.js), so advancing their mixer is pure wasted
  // CPU. In a heavily-populated zone (Warrens: 90+ enemies) this is the bulk of the per-frame
  // animation cost. They resume the moment the party comes near and clears the dormant flag.
  for (const u of units)   { if (u.dormant) continue; u.mixer?.update(dt); }
  for (const u of corpses) u.mixer?.update(dt);

  // Scale-animate units (no skeleton)
  for (const u of units) {
    if (!u._scaleMode) continue;
    u._scaleElapsed += dt;
    const t   = u._scaleElapsed;
    const phi = u._animPhaseOffset ?? 0;
    let s = 1;
    if (u._scaleMode === 'idle') {
      s = 1 + 0.06 * Math.sin(t * 1.5 + phi);
    } else if (u._scaleMode === 'walk') {
      s = 1 + 0.10 * Math.sin(t * 3.0 + phi);
    } else if (u._scaleMode === 'attack') {
      const p = Math.min(u._scaleAttackT / _SCALE_ATTACK_DUR, 1);
      u._scaleAttackT += dt;
      s = 1 + 0.45 * Math.sin(p * Math.PI);
      if (p >= 1) {
        u._scaleMode = 'idle';
        u._scaleElapsed = 0;
        const cb = u._scaleOnComplete;
        u._scaleOnComplete = null;
        cb?.();
      }
    } else if (u._scaleMode === 'death') {
      const p = Math.min(t / _SCALE_DEATH_DUR, 1);
      s = 1 - p;
      if (p >= 1) { u._scaleMode = 'dead'; s = 0; }
    }
    u.grp.scale.setScalar(s);
  }
}

// Playback rate for the locomotion clips, per unit type (UNIT_TYPES.runTimeScale /
// .walkTimeScale — 1 = as authored, 3 = 300% speed). Some rigs' loco clips are authored far
// slower than the speed the unit actually crosses the ground at, so the feet skate.
//
// MUST be re-applied on EVERY transition, not set once when the actions are built: when a
// type points walk and run at the SAME clip (the owlbear — both are jump_push_up), three.js
// hands back the same cached AnimationAction for that clip, so unit.walkAction ===
// unit.runAction. A one-time assignment would therefore leak the run's speed into the walk.
// Note also that AnimationAction.reset() does NOT clear timeScale, so set it after reset().
function _locoTimeScale(unit, walking, run) {
  if (!walking) return 1;
  const def = UNIT_TYPES[unit.type] ?? {};
  return (run ? def.runTimeScale : def.walkTimeScale) ?? 1;
}

// Body pitch for the locomotion clips, per unit type (UNIT_TYPES.locoPitchDeg, degrees).
// Tilts the whole model nose-up so a clip authored flat/prone reads as a charging animal:
// the owlbear's jump_push_up leaves it belly-down and level, and it wants its head end
// carried ~45° above its feet end while it runs.
//
// Applied to unit.model (the GLB root), NEVER to unit.grp: grp carries world position, the
// facing yaw, and the HP-bar anchor, so tilting it would swing the health bar and the ring
// through the air with the body. As a child of grp the pitch is in the unit's own local
// space, so "nose up" stays nose-up whichever way it happens to be facing.
//
// Sign: NEGATIVE is nose-up for a model whose forward axis is +Z (which is how enemies are
// built — grp.rotation.y = 0 faces +Z). If a rig turns out to face the other way it will
// tilt nose-DOWN; flip the sign of locoPitchDeg for that type, nothing else.
//
// Zeroed whenever the unit is not in its loco clip, so the tilt can't bleed into idle,
// attack or death poses — see the resets in playUnitAttackAnim / playUnitDeathAnim.
function _applyLocoPitch(unit, walking) {
  if (!unit.model) return;
  const deg = walking ? (UNIT_TYPES[unit.type]?.locoPitchDeg ?? 0) : 0;
  unit.model.rotation.x = deg * (Math.PI / 180);
}

// Effective roam route for a unit: its own authored waypoints, else a route inherited by
// roam-group promotion when the band's leader died (see _roamGroups in precombat.js).
// Lives here because both combat.js and precombat.js need it and units.js is below both —
// putting it in either would make them import each other.
//
// ⚠ `_bandPath` is runtime-only ON PURPOSE. The NPC editors serialize `patrolPath` straight
// into the zone file, so a promoted unit must never have the route written there.
export function roamPathOf(u) {
  if (u.patrolPath?.length >= 2) return u.patrolPath;
  if (u._bandPath?.length  >= 2) return u._bandPath;
  return null;
}

export function setUnitWalking(unit, walking, run = false) {
  if (unit._scaleMode !== null) {
    if (unit._scaleMode === 'attack' || unit._scaleMode === 'death' || unit._scaleMode === 'dead') return;
    unit._scaleMode = walking ? 'walk' : 'idle';
    return;
  }
  if (!unit.mixer) return;
  // While an event holds a forced clip (e.g. Solrac hanging), ignore walk/idle
  // swaps so nothing knocks him out of the pose. Cleared via setUnitAnimLocked.
  if (unit._animLocked) return;

  // Resolve action first — if null, bail without touching isWalking so the
  // guard doesn't lock out future calls once the clip becomes available.
  const action = walking
    ? (run && unit.runAction ? unit.runAction : unit.walkAction)
    : unit.idleAction;
  if (!action) return;

  if (unit.isWalking === walking && (unit._runMode ?? false) === run) {
    // Same logical state — but restart the action if Three.js stopped it
    // (e.g. LoopOnce clip that slipped through, or external stopAllAction).
    if (!action.isRunning()) {
      action.reset().setEffectiveWeight(1);
      action.timeScale = _locoTimeScale(unit, walking, run);
      _applyLocoPitch(unit, walking);
      if (walking) action.time = _phaseTime(unit, action);
      action.play();
    }
    return;
  }

  unit.isWalking = walking;
  unit._runMode  = run;
  unit.mixer.stopAllAction();
  action.reset().setEffectiveWeight(1);
  action.timeScale = _locoTimeScale(unit, walking, run);
  _applyLocoPitch(unit, walking);
  if (walking) action.time = _phaseTime(unit, action);
  action.play();
}

// Play an arbitrary animation clip by name — for clips that aren't one of the mapped
// idle/walk/run roles (e.g. Solrac's Bar_Hang_Idle shackled pose). Loops by default and
// locks out setUnitWalking so nothing swaps him back; call setUnitAnimLocked(unit, false)
// when the pose ends (e.g. on release). Returns false if the clip/mixer isn't available.
export function playUnitClip(unit, clipName, { loop = true, lock = true } = {}) {
  if (!unit.mixer || !unit.clips) return false;
  const clip = unit.clips.find(c => c.name === clipName);
  if (!clip) return false;
  const action = unit.mixer.clipAction(clip);
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  unit.mixer.stopAllAction();
  action.reset().setEffectiveWeight(1).play();
  unit._animLocked = lock;
  return true;
}

export function setUnitAnimLocked(unit, locked) { unit._animLocked = locked; }

// Desync identical loops between units by starting each at its own phase offset.
// Must wrap the offset by the clip duration: a phase offset past the clip's end
// (common on short clips — e.g. the owl's 0.625s Flap) starts the action beyond
// its length, so it finishes instantly and freezes on the last frame instead of
// looping. Modulo keeps it a valid in-clip start time.
function _phaseTime(unit, action) {
  const dur = action.getClip()?.duration ?? 0;
  const off = unit._animPhaseOffset ?? 0;
  return dur > 0 ? off % dur : 0;
}

// clipName: play a SPECIFIC clip for this swing instead of the unit's default attack
// action — set per-attack via `animClip` in UNIT_TYPES[...].attacks[]. Lets one creature
// give each weapon its own animation (the ettin swings its battleaxe with the right arm
// and its morningstar with the left). Falls back to the default attack clip if the named
// one isn't in this GLB, so a bad name degrades to the old look rather than to no
// animation at all. Actions are cached by three.js per (mixer, clip), so re-requesting
// the same clip every swing is cheap.
export function playUnitAttackAnim(unit, type = 'melee', onComplete = null, clipName = null) {
  if (unit._scaleMode !== null) {
    unit._scaleMode    = 'attack';
    unit._scaleAttackT = 0;
    unit._scaleOnComplete = onComplete;
    return;
  }
  let action = type === 'ranged' ? unit.rangedAttackAction
             : type === 'spell'  ? (unit.spellCastAction ?? unit.rangedAttackAction)
             :                     unit.attackAction;

  if (clipName && unit.mixer) {
    const clip = unit.clips?.find(c => c.name === clipName);
    if (clip) {
      const custom = unit.mixer.clipAction(clip);
      custom.setLoop(THREE.LoopOnce, 1);
      custom.clampWhenFinished = false;
      action = custom;
    } else {
      console.warn(`[units] ${unit.type}: attack clip '${clipName}' not in GLB — using default attack anim`);
    }
  }

  if (!unit.mixer || !action) {
    onComplete?.();
    return;
  }
  unit.isWalking = false;
  unit.mixer.stopAllAction();
  _applyLocoPitch(unit, false);   // drop any loco body tilt — this pose stands upright

  const rot = type === 'ranged' ? (unit.rangedRotY ?? -Math.PI / 2) : 0;
  if (rot) unit.grp.rotation.y += rot;

  action.reset().setEffectiveWeight(1).play();

  unit.mixer.addEventListener('finished', function onFinish(e) {
    if (e.action !== action) return;
    unit.mixer.removeEventListener('finished', onFinish);
    if (rot) unit.grp.rotation.y -= rot;
    unit.idleAction?.reset().setEffectiveWeight(1).play();
    onComplete?.();
  });
}

export function playUnitDeathAnim(unit) {
  if (unit._scaleMode !== null) {
    unit._scaleMode    = 'death';
    unit._scaleElapsed = 0;
    corpses.push(unit);
    return;
  }
  if (!unit.mixer) return;
  unit.isWalking = false;
  unit.mixer.stopAllAction();
  _applyLocoPitch(unit, false);   // a corpse must lie flat, not tilted from the run pose
  if (unit.deathAction) {
    unit.deathAction.reset().setEffectiveWeight(1).play();
  }
  // Keep the mixer ticking so the death animation actually plays out.
  corpses.push(unit);
}

// Reverses playUnitDeathAnim's corpse state — pulls the unit out of corpses[],
// resets its pose to idle, reattaches its (detached, not destroyed) HP bar,
// and puts it back in units[] so updateHeroUI()/targeting/aggro see it again.
// Used by short rest to bring a fallen hero back up outside of combat.
export function reviveUnit(unit) {
  const ci = corpses.indexOf(unit);
  if (ci >= 0) corpses.splice(ci, 1);

  if (unit._scaleMode !== null) {
    unit._scaleMode    = 'idle';
    unit._scaleElapsed = 0;
  } else if (unit.mixer) {
    unit.mixer.stopAllAction();
    unit.idleAction?.reset().setEffectiveWeight(1).play();
  }
  unit.isWalking = false;
  unit._runMode  = false;

  if (unit.barEl && !unit.barEl.isConnected) hud.appendChild(unit.barEl);

  if (!units.includes(unit)) units.push(unit);
}

// ── Animation override helpers (used by npcEditor) ────────────────────────────

export function getClipNamesForType(type) {
  return modelCache[type]?.animations?.map(c => c.name) ?? [];
}

const _ROLE_TO_ACTION = {
  idle: 'idleAction', walk: 'walkAction', run: 'runAction',
  attack: 'attackAction', rangedAttack: 'rangedAttackAction',
  spellCast: 'spellCastAction', death: 'deathAction',
};

// clipIdx: 0-based integer index into the type's clip array, or null to revert to auto
export function applyUnitAnimOverride(unit, role, clipIdx) {
  if (!unit.mixer) return;
  if (!unit.animOverrides) unit.animOverrides = {};

  if (clipIdx != null) unit.animOverrides[role] = clipIdx;
  else                 delete unit.animOverrides[role];

  const clips = modelCache[unit.type]?.animations;
  if (!clips?.length) return;

  // Re-resolve: auto baseline → type-level name overrides → instance index overrides
  const autoClips = autoMapAnimClips(clips) ?? {};
  for (const [r, name] of Object.entries(ANIM_CLIP_NAMES[unit.type] ?? {})) {
    if (name === null) { delete autoClips[r]; continue; }
    const found = clips.find(c => c.name === name);
    if (found) autoClips[r] = found;
  }
  for (const [r, idx] of Object.entries(unit.animOverrides ?? {})) {
    const clip = clips[idx];
    if (clip) autoClips[r] = clip;
  }

  const clip       = autoClips[role] ?? null;
  const actionProp = _ROLE_TO_ACTION[role];
  if (!actionProp) return;

  unit[actionProp]?.stop();

  let newAction = null;
  if (clip) {
    newAction = unit.mixer.clipAction(clip);
    if (['idle', 'walk', 'run'].includes(role)) {
      newAction.setLoop(THREE.LoopRepeat, Infinity);
    } else if (['attack', 'rangedAttack', 'spellCast', 'death'].includes(role)) {
      newAction.setLoop(THREE.LoopOnce, 1);
      newAction.clampWhenFinished = role === 'death';
    }
  }
  unit[actionProp] = newAction;

  // Live preview: immediately apply if this role is currently visible
  if (role === 'idle' && !unit.isWalking) {
    unit.mixer.stopAllAction();
    newAction?.reset().setEffectiveWeight(1).play();
  } else if (role === 'walk' && unit.isWalking) {
    unit.mixer.stopAllAction();
    newAction?.reset().setEffectiveWeight(1).play();
  } else if (['attack', 'rangedAttack', 'spellCast'].includes(role) && newAction) {
    // Preview: play once then return to idle
    unit.mixer.stopAllAction();
    newAction.reset().setEffectiveWeight(1).play();
    newAction.getMixer().addEventListener('finished', function _ret(e) {
      if (e.action !== newAction) return;
      newAction.getMixer().removeEventListener('finished', _ret);
      unit.mixer.stopAllAction();
      if (!unit.isWalking) unit.idleAction?.reset().setEffectiveWeight(1).play();
    });
  }
}

// ── Stealth appearance ────────────────────────────────────────────────────────
// Stealthed units remain visible but are rendered low-opacity and darkened so
// the player can clearly read "ghostly presence in shadow" at a glance rather
// than needing to look closely for a subtle opacity dip.
const STEALTH_OPACITY = 0.28;
const STEALTH_TINT     = 0.32; // fraction of original color kept when stealthed

// The ghostly LOOK — low opacity + darkened color/emissive — applied when a unit is in ANY stealth
// state (combat stealth, Milo's OOC hide, or the party sneak). Split from the flag-setting so the
// several states can share it and OR together (a unit stays ghostly while any one of them holds).
function _applyStealthMaterial(unit, on) {
  unit.grp.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m) return;
      m.transparent = on;
      m.opacity     = on ? STEALTH_OPACITY : 1.0;
      m.needsUpdate = true;

      if (m.color) {
        if (!m.userData._stealthOrigColor) m.userData._stealthOrigColor = m.color.clone();
        if (on) m.color.copy(m.userData._stealthOrigColor).multiplyScalar(STEALTH_TINT);
        else    m.color.copy(m.userData._stealthOrigColor);
      }
      if (m.emissive) {
        if (!m.userData._stealthOrigEmissive) m.userData._stealthOrigEmissive = m.emissive.clone();
        if (on) m.emissive.copy(m.userData._stealthOrigEmissive).multiplyScalar(STEALTH_TINT);
        else    m.emissive.copy(m.userData._stealthOrigEmissive);
      }
    });
  });
}
const _wantsStealthLook = u => !!(u.stealthed || u.stealthedOOC || u.sneaking);

export function setUnitStealth(unit, stealthed) {
  unit.stealthed = stealthed;
  _applyStealthMaterial(unit, _wantsStealthLook(unit));
}

// OOC party sneak (the MOVE-widget Stealth button): the same ghostly look + black healthbar as a
// stealthed unit, but WITHOUT the combat `stealthed` flag — so flagging all four heroes doesn't
// hand them in-combat hide / Sneak Attack (that stays Milo's). Purely a "who's creeping" indicator.
export function setUnitSneaking(unit, on) {
  unit.sneaking = on;
  _applyStealthMaterial(unit, _wantsStealthLook(unit));
}
