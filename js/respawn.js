// js/respawn.js — per-unit enemy respawn timers (WoW / EverQuest style).
//
// Every enemy placed by a zone has a spawn point identified by `type@x,z`. When
// that enemy is defeated in combat we stamp a persistent "world clock". After its
// respawn delay elapses — 15 min for regular foes, 2 h for bosses — the enemy
// comes back at its spawn point. The clock advances three ways:
//   • real time while exploring (out of combat),
//   • +6 s per combat round (real time is PAUSED during a fight — one D&D round
//     is 6 seconds of game-world time), and
//   • real wall-clock time while the game is CLOSED (offline progress, WoW-style).
//
// Respawns happen both on zone re-entry (a dead spawn stays empty until its timer
// is up) and live while you linger in the zone — but never mid-combat.
//
// Design note: respawn is PER INDIVIDUAL, not per group. Each mob you kill runs
// its own independent clock, exactly like WoW/EQ — so a half-cleared camp trickles
// back one body at a time. No group bookkeeping.

const CLOCK_KEY = 'dnd-world-clock';   // { t: seconds, saved: <ms epoch> }
const KILLS_KEY = 'dnd-respawn-kills'; // { [zoneId]: { [spawnId]: killClock } }

const REGULAR_RESPAWN = 15 * 60;       // 900 s
const BOSS_RESPAWN    = 2 * 60 * 60;   // 7200 s
const ROUND_SECONDS   = 6;             // one combat round of game-world time
const SAVE_EVERY      = 15;            // persist the clock at most this often (s)

// Bosses get the long timer. Morvath is currently the only boss.
const BOSS_TYPES = new Set(['morvath']);

let _clock     = 0;      // game-world seconds (monotonic)
let _sinceSave = 0;
let _kills     = {};     // { zoneId: { spawnId: killClock } }
let _inCombat  = false;
let _resetting = false;  // New Game in progress — stop persisting, we're about to be wiped

// Active-zone live state
let _zoneId   = null;
let _spawner  = null;         // fn(enemyDef) -> unit, provided by zoneLoader
let _defsById = new Map();    // spawnId -> enemy def (for live respawn)
let _ready    = false;        // false during a zone transition (blocks live respawn)

// ── Identity & timers ─────────────────────────────────────────────────────────
export function respawnIdOf(def) {
  return def.respawnId ?? `${def.type}@${def.x},${def.z}`;
}
function timerForType(type) {
  return BOSS_TYPES.has(type) ? BOSS_RESPAWN : REGULAR_RESPAWN;
}
export function isBossType(type) { return BOSS_TYPES.has(type); }

// Is an enemy killed at `killClock` eligible to respawn now?
// Self-heal guard: a kill can NEVER be in the FUTURE relative to the world clock. If killClock >
// _clock, the clock was lost/reset (corrupt CLOCK_KEY, partial localStorage clear, quota) while the
// kill record survived — so `_clock - killClock` goes negative and the enemy would otherwise stay
// stranded dead until the clock climbed back past killClock + timer. Treat that as elapsed and let
// it respawn immediately, so a lost clock heals itself instead of freezing spawns.
function _respawnDue(killClock, type) {
  if (killClock == null) return true;
  const elapsed = _clock - killClock;
  return elapsed < 0 || elapsed >= timerForType(type);
}

// ── Persistence ───────────────────────────────────────────────────────────────
function _loadClock() {
  try {
    const c = JSON.parse(localStorage.getItem(CLOCK_KEY) ?? 'null');
    if (c && typeof c.t === 'number') {
      _clock = c.t;
      // Offline progress: real wall-clock time passed while the game was closed.
      const offline = (Date.now() - (c.saved ?? Date.now())) / 1000;
      if (offline > 0) _clock += offline;
    }
  } catch { /* corrupt / disabled storage — start the clock at 0 */ }
}
function _saveClock() {
  if (_resetting) return;
  try { localStorage.setItem(CLOCK_KEY, JSON.stringify({ t: _clock, saved: Date.now() })); } catch {}
}
function _loadKills() {
  try { _kills = JSON.parse(localStorage.getItem(KILLS_KEY) ?? '{}') || {}; }
  catch { _kills = {}; }
}
function _saveKills() {
  if (_resetting) return;
  try { localStorage.setItem(KILLS_KEY, JSON.stringify(_kills)); } catch {}
}

// ── Init (called once from main.js, before the first zone loads) ──────────────
export function initRespawn() {
  _loadClock();
  _loadKills();
  _saveClock();   // re-stamp `saved` so the next offline delta measures from now

  window.addEventListener('combat:start',  () => { _inCombat = true;  });
  window.addEventListener('combat:ended',  () => { _inCombat = false; });
  window.addEventListener('round:start',   () => { _clock += ROUND_SECONDS; });
  window.addEventListener('unit:defeated', e  => _noteKill(e.detail));
  // A zone transition invalidates the live spawn set until the new zone filters.
  window.addEventListener('zone:loading',  () => { _ready = false; _zoneId = null; _defsById.clear(); });
  // Best-effort final save so a clean close loses no more than a few seconds.
  window.addEventListener('beforeunload',  () => _saveClock());

  // New Game: resetGame.js wipes our keys and reloads, and that reload fires 'beforeunload'
  // — which would re-save the world clock we just deleted. Latch here so both savers go
  // quiet for the rest of this page's life, and drop the live state so nothing in flight
  // (the tickRespawn autosave) can resurrect it either.
  window.addEventListener('game:reset', () => {
    _resetting = true;
    _clock = 0;
    _kills = {};
  });

  // Console testing helpers — 15-min timers are painful to wait out live.
  //   __respawn.advance(900)  → fast-forward the world clock 15 min (mobs pop back)
  //   __respawn.advance(7200) → 2 h (boss)
  //   __respawn.kills()       → inspect pending respawn timers
  //   __respawn.clear()       → wipe all timers (everything eligible again)
  window.__respawn = {
    clock:   () => _clock,
    advance: (sec = 0) => { _clock += sec; return _clock; },
    kills:   () => JSON.parse(JSON.stringify(_kills)),
    clear:   () => { _kills = {}; _saveKills(); },
  };
}

// zoneLoader registers the function that builds + places one enemy def.
export function setEnemySpawner(fn) { _spawner = fn; }

// ── Kill tracking ─────────────────────────────────────────────────────────────
function _noteKill(detail) {
  const id = detail?.respawnId;
  if (!id || !_zoneId) return;   // event-spawned / summoned foes carry no id — never respawn
  (_kills[_zoneId] ??= {})[id] = _clock;
  _saveKills();
}

// ── Zone entry — decide which spawns are still on cooldown ────────────────────
// Returns the subset of enemyDefs that should spawn right now. Call from the
// zone loader in place of iterating zone.enemies directly.
export function filterZoneSpawns(zoneId, enemyDefs, { fresh = false } = {}) {
  _zoneId   = zoneId;
  _defsById = new Map();
  const list = enemyDefs ?? [];

  // Map spawnId -> def, and note which ids still exist (to prune stale records).
  const validIds = new Set();
  for (const def of list) {
    const id = respawnIdOf(def);
    _defsById.set(id, def);
    validIds.add(id);
  }

  // Arena zones (zone.freshEnemies, e.g. River Styx) present the FULL encounter every
  // visit — wipe any respawn cooldowns so a same-day return isn't an empty room.
  if (fresh && _kills[zoneId]) { delete _kills[zoneId]; _saveKills(); }

  const zoneKills = _kills[zoneId] ?? {};
  let dirty = false;
  for (const id of Object.keys(zoneKills)) {
    if (!validIds.has(id)) { delete zoneKills[id]; dirty = true; }  // spawn was removed/moved
  }

  const toSpawn = [];
  for (const def of list) {
    const id = respawnIdOf(def);
    const killClock = zoneKills[id];
    if (killClock != null && !_respawnDue(killClock, def.type)) continue;  // still dead — skip
    if (killClock != null) { delete zoneKills[id]; dirty = true; }         // timer elapsed — clear & spawn
    toSpawn.push(def);
  }

  _kills[zoneId] = zoneKills;
  if (dirty) _saveKills();

  _ready = true;
  return toSpawn;
}

// Tag a freshly spawned enemy with its spawn identity so the defeat event can
// report it back to _noteKill. Called by the zone loader for each spawned foe.
export function tagSpawnedEnemy(unit, def) {
  if (unit) unit._respawnId = respawnIdOf(def);
}

// The active zone's spawns that are DEAD AND STILL ON COOLDOWN — i.e. deliberately
// absent from `units` right now.
//
// ⚠ This exists for one reason: the zone editors replace a zone's WHOLE enemies array
// from the live units on save (serializeZoneEnemies), so any foe merely waiting out its
// timer was written out of the zone file PERMANENTLY. That is exactly how Morvath
// vanished from the Mausoleum in bf5739b (2026-07-20) — he was on his 2-hour boss
// cooldown when an enemy save ran, and no amount of waiting could bring back a spawn
// that no longer existed in the file. serializeZoneEnemies merges these back in.
export function suppressedSpawnDefs() {
  if (!_zoneId) return [];
  const zoneKills = _kills[_zoneId] ?? {};
  const out = [];
  for (const id of Object.keys(zoneKills)) {
    const def = _defsById.get(id);
    if (def) out.push(def);
  }
  return out;
}

// ── Live tick (out-of-combat respawn while lingering in a zone) ────────────────
export function tickRespawn(dt) {
  // Real time advances the clock only when NOT fighting (rounds add 6 s each).
  if (!_inCombat) _clock += dt;
  _sinceSave += dt;
  if (_sinceSave >= SAVE_EVERY) { _sinceSave = 0; _saveClock(); }

  if (_inCombat || !_ready || !_zoneId || !_spawner) return;

  const zoneKills = _kills[_zoneId];
  if (!zoneKills) return;
  let dirty = false;
  for (const id of Object.keys(zoneKills)) {
    const def = _defsById.get(id);
    if (!def) { delete zoneKills[id]; dirty = true; continue; }   // stale — spawn no longer exists
    if (!_respawnDue(zoneKills[id], def.type)) continue;
    // Timer up (or a lost clock left it "in the future") — respawn this individual at its spawn point.
    const u = _spawner(def);
    if (u) tagSpawnedEnemy(u, def);
    delete zoneKills[id];
    dirty = true;
  }
  if (dirty) _saveKills();
}

// Debug / future UI helper.
export function worldClockSeconds() { return _clock; }
