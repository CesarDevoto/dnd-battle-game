import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { scene } from './scene.js';
import { UNIT_TYPES, COMBAT } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { addUnitDungeonLight } from './environments.js';
import { equipItem } from './equipment.js';
import { getItem } from './items.js';

export const units      = [];
export const corpses    = [];  // animated units that have died — kept for mixer updates
export const heroRoster = [];  // all 4 hero unit objects, never cleared on death

export let allBarsVisible = false;
export function toggleAllBars()    { allBarsVisible = !allBarsVisible; }
export function getAllBarsVisible() { return allBarsVisible; }
const hud = document.getElementById('hud');

// ── Model loading ─────────────────────────────────────────────────────────────

const loader     = new GLTFLoader();
const modelCache = {};

const MODEL_PATHS = {
  kobold:     'assets/models/kobold.glb',
  goblin:     'assets/models/goblin.glb',
  orc:        'assets/models/orc.glb',
  ogre:       'assets/models/ogre.glb',
  elf:        'assets/models/elf.glb',
  dwarf:      'assets/models/dwarf.glb',
  human:      'assets/models/barbarian.glb',
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
  gnoll:          'assets/models/gnoll.glb',
  gnoll_pack_lord:'assets/models/gnoll.glb',
  gnoll_fang:     'assets/models/gnoll.glb',
  giant_rat:      'assets/models/giantrat.glb',
  hobgoblin:      'assets/models/hobgoblin.glb',
  owlbear:        'assets/models/owlbear.glb',
  troglodyte:     'assets/models/troglodyte.glb',
  ghoul:          'assets/models/ghoul.glb',
  zombie:         'assets/models/zombie.glb',
  skeleton:       'assets/models/skeleton.glb',
  shadow:         'assets/models/shadow.glb',
  ettin:          'assets/models/ettin.glb',
  hill_giant:     'assets/models/hillgiant.glb',
  // Demon monsters
  mane:             'assets/models/mane.glb',
  abyssal_wretch:   'assets/models/abyssalwretch.glb',
  abyssal_chicken:  'assets/models/abyssalchicken.glb',
  // Friendly NPCs
  grassling: 'assets/models/grassling.glb',
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
  // New barbarian GLB (Jul 2026) — different attack clip. Verified via Hips.position
  // Y-range/duration: Charged_Upward_Slash (rangeY 8.34) is the new melee swing, but
  // auto-detect would wrongly grab mage_soell_cast_7 (rangeY 9.86, spell-cast pose —
  // Gobo doesn't cast spells) since it edges out on the tiebreak. Pin explicitly.
  human: {
    idle: 'Idle_8', walk: 'Walking', run: 'Running', attack: 'Charged_Upward_Slash',
    rangedAttack: 'Archery_Shot_1', death: 'Dead',
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
  // Angry_Ground_Stomp has a larger hip Y-range than Attack; pin Attack explicitly
  owlbear: {
    idle: 'Idle_7', walk: 'Walking', run: 'Running', attack: 'Attack', death: 'Dead',
  },
  // Idle_03 has large hip rangeY (18.4) so auto-detection misclassifies it as attack;
  // null in attack slot explicitly clears the mis-detected slot.
  grassling: {
    idle: 'Idle_03', walk: 'Walking', run: 'Running', attack: null,
  },
  // Archery_Shot_1 (rangeY 8.6) beats Walking (7.0) on the loco tiebreak since both are 1.0s;
  // pin the two swapped slots to fix it.
  kobold: {
    walk: 'Walking', rangedAttack: 'Archery_Shot_1',
  },
  twig_blight: {
    idle: 'Idle_7', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash', death: 'Dead',
  },
  skeleton: {
    idle: 'Idle_8', walk: 'Walking', run: 'Running', attack: 'Right_Hand_Sword_Slash', death: 'Dead',
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

export const modelsReady = Promise.all(Object.keys(MODEL_PATHS).map(loadOne));

// ── Team colour tint ──────────────────────────────────────────────────────────

const TEAM_TINT = {
  red:  new THREE.Color(0x220808),
  blue: new THREE.Color(0x080822),
  npc:  new THREE.Color(0x000000),
};

// ── Unit builder ──────────────────────────────────────────────────────────────

export function buildUnit(worldX, worldZ, team, type = 'goblin', animOverrides = null) {
  const def   = UNIT_TYPES[type] ?? UNIT_TYPES.goblin;
  const gltf  = modelCache[type];
  const label = def.name ?? type;
  const src   = gltf?.scene ? MODEL_PATHS[type] : 'PLACEHOLDER BOX (model failed to load)';
  console.log(`[units] Building ${label} (${type}) for team ${team} → ${src}`);

  const terrainY = getTerrainHeight(worldX, worldZ);
  if (type === 'orc') {
    console.log('Orc spawned at position:', { x: worldX, y: terrainY, z: worldZ });
  }

  const grp = new THREE.Group();
  grp.position.set(worldX, terrainY, worldZ);
  grp.rotation.y = team === 'blue' ? Math.PI : 0;  // heroes face north (-Z); enemies and NPCs face south (+Z)

  // Animation state — only populated for ANIMATED_TYPES
  let mixer = null, idleAction = null, walkAction = null, runAction = null, attackAction = null, rangedAttackAction = null, spellCastAction = null, deathAction = null;

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

    // ── Skeletal animation setup ─────────────────────────────────────────────
    if (ANIMATED_TYPES.has(type) && !SCALE_ANIMATE_TYPES.has(type) && gltf.animations?.length) {
      const clips = gltf.animations;
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
  const rangedRotY = type === 'elf' ? 0 : -Math.PI / 2;

  const _phaseOff = team === 'blue'
    ? units.filter(u => u.team === 'blue').length * 0.3
    : Math.random();

  const u = { grp, anchor, anchorY, hoverY, barEl, fill, hp, maxHp, team, type,
              barForced: false, barShowUntil: 0, xp: 0, level: 1, atkQty,
              spellSlots: def.spellSlots,
              _animPhaseOffset: _phaseOff,
              mixer, idleAction, walkAction, runAction, attackAction, rangedAttackAction, spellCastAction, deathAction, isWalking: false,
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
          if (item) equipItem(u, item, slot);
        }
      }
    }
    if (!u.currency)  u.currency  = { copper: 0, silver: 0, gold: 5, platinum: 0 };
    if (!heroRoster.includes(u)) heroRoster.push(u);
  }
  return u;
}

// ── Animation mixer updates ───────────────────────────────────────────────────

const _ANIM_FADE = 0.25; // crossfade duration in seconds

export function updateMixers(dt) {
  for (const u of units)   u.mixer?.update(dt);
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

export function setUnitWalking(unit, walking, run = false) {
  if (unit._scaleMode !== null) {
    if (unit._scaleMode === 'attack' || unit._scaleMode === 'death' || unit._scaleMode === 'dead') return;
    unit._scaleMode = walking ? 'walk' : 'idle';
    return;
  }
  if (!unit.mixer) return;

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
      if (walking) action.time = unit._animPhaseOffset ?? 0;
      action.play();
    }
    return;
  }

  unit.isWalking = walking;
  unit._runMode  = run;
  unit.mixer.stopAllAction();
  action.reset().setEffectiveWeight(1);
  if (walking) action.time = unit._animPhaseOffset ?? 0;
  action.play();
}

export function playUnitAttackAnim(unit, type = 'melee', onComplete = null) {
  if (unit._scaleMode !== null) {
    unit._scaleMode    = 'attack';
    unit._scaleAttackT = 0;
    unit._scaleOnComplete = onComplete;
    return;
  }
  const action = type === 'ranged' ? unit.rangedAttackAction
               : type === 'spell'  ? (unit.spellCastAction ?? unit.rangedAttackAction)
               :                     unit.attackAction;
  if (!unit.mixer || !action) {
    onComplete?.();
    return;
  }
  unit.isWalking = false;
  unit.mixer.stopAllAction();

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
  if (unit.deathAction) {
    unit.deathAction.reset().setEffectiveWeight(1).play();
  }
  // Keep the mixer ticking so the death animation actually plays out.
  corpses.push(unit);
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
// Stealthed units remain visible but are rendered at half opacity so the player
// can see ghostly presences without the unit being clearly readable.
export function setUnitStealth(unit, stealthed) {
  unit.stealthed = stealthed;
  unit.grp.traverse(o => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m) return;
      m.transparent = stealthed;
      m.opacity     = stealthed ? 0.45 : 1.0;
      m.needsUpdate = true;
    });
  });
}
