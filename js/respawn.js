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
  try { localStorage.setItem(CLOCK_KEY, JSON.stringify({ t: _clock, saved: Date.now() })); } catch {}
}
function _loadKills() {
  try { _kills = JSON.parse(localStorage.getItem(KILLS_KEY) ?? '{}') || {}; }
  catch { _kills = {}; }
}
function _saveKills() {
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
    const onCooldown = killClock != null && (_clock - killClock) < timerForType(def.type);
    if (onCooldown) continue;                                   // still dead — skip
    if (killClock != null) { delete zoneKills[id]; dirty = true; } // timer elapsed — clear & spawn
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
    if ((_clock - zoneKills[id]) < timerForType(def.type)) continue;
    // Timer up — respawn this individual at its spawn point.
    const u = _spawner(def);
    if (u) tagSpawnedEnemy(u, def);
    delete zoneKills[id];
    dirty = true;
  }
  if (dirty) _saveKills();
}

// Debug / future UI helper.
export function worldClockSeconds() { return _clock; }
