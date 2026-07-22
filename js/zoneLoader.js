import * as THREE from 'three';
import { scene, camera, renderer, setSceneGroundSize, snapCameraToUnit, rebuildGrid, setGridOpacity, DEFAULT_GRID_OPACITY } from './scene.js';
import { units, buildUnit, corpses, modelsReady, ensureModels, setUnitStealth } from './units.js';
import { setTerrainControlPoints, setTerrainSeed, setActiveGroundSize, setGateNotches, setTerrainTrenches, setTunnelMode, buildTunnelPaths, setTunnelPaths } from './terrain.js';
import { UNIT_TYPES, GROUND_SIZE, WORLD_UNITS_PER_SQUARE } from './constants.js';
import { IS_DEV } from './devConfig.js';
import { removeUnits, resetToSetup } from './army.js';
import { setEnv, setEnvSkipProps, clearProps, addUnitDungeonLight, setZoneFogDensity } from './environments.js';
import { loadZoneProps, clearEditorProps, prewarmGLBs, isPropEditorOpen } from './propEditor.js';
import { loadBarrierVisuals } from './barrierEditor.js';
import { loadPaint } from './terrainPaint.js';
import { loadTrenchVisuals } from './trenchEditor.js';
import { getTerrainHeight } from './terrain.js';
import { renderHeroPortrait } from './heroPortraits.js';
import { isDevMode } from './devMode.js';
import { turnOrder, addLog, registerPendingSpawnCheck, setGroundBounds, combatPhase } from './combat.js';
import { applyHeroSkin } from './heroSkins.js';
import { applyHeal } from './affixes.js';
import { filterZoneSpawns, tagSpawnedEnemy, setEnemySpawner } from './respawn.js';
import { ZONE as ZONE_DUNGEON_ENTRANCE } from './zones/zone_road_to_phandelver.js';
import { ZONE as ZONE_BLEAKMIRE_WOODS } from './zones/zone_bleakmire_woods.js';
import { ZONE as ZONE_HAUNTED_WOOD } from './zones/zone_haunted_wood.js';
import { ZONE as ZONE_MAUSOLEUM } from './zones/zone_mausoleum.js';
import { ZONE as ZONE_RIVER_STYX } from './zones/zone_river_styx.js';
import { ZONE as ZONE_WARRENS } from './zones/zone_warrens.js';
import { ZONE as ZONE_PHANDALIN } from './zones/zone_phandalin.js';
import { ZONE as ZONE_HIDE_OUT } from './zones/zone_hide_out.js';

// ── Registry ──────────────────────────────────────────────────────────────────

const _registry = {};
const ZONE_ORDER = [ZONE_DUNGEON_ENTRANCE, ZONE_BLEAKMIRE_WOODS, ZONE_HAUNTED_WOOD, ZONE_MAUSOLEUM, ZONE_RIVER_STYX, ZONE_WARRENS, ZONE_PHANDALIN, ZONE_HIDE_OUT];
ZONE_ORDER.forEach(z => { _registry[z.id] = z; });

// Warm the prop GLBs for ONE zone. This used to prewarm every prop in every zone at module
// load time, which meant a player standing in the first zone was holding the decompressed
// geometry and textures for every prop in the game. loadZone() now warms only the zone it
// is loading (props it misses still load on demand inside loadZoneProps).
function _prewarmZoneProps(zone) {
  prewarmGLBs([...new Set((zone?.props ?? []).map(p => p.model))]);
}

// ── State ─────────────────────────────────────────────────────────────────────

let _active      = null;
let _exitsLive   = false;
let _postCombat  = false;
let _transitioning = false;
let _exitMeshes  = [];
let _breachMeshes = [];
let _exitT       = 0;
const _exitRay   = new THREE.Raycaster();
const _exitPt    = new THREE.Vector2();

export function getActiveZone()  { return _active; }

export function getAllZones()     { return Object.values(_registry); }

// Fog / high-darkness zones — enemies can't see far, so their aggro/detection
// radius is capped (8 grid squares) there. Classified by biome, or an explicit
// `lowVisibility: true` flag any zone can set to opt in.
const LOW_VIS_BIOMES = new Set(['dungeon', 'graveyard', 'styx']);
const LOW_VIS_AGGRO  = 8 * WORLD_UNITS_PER_SQUARE;   // 16 world units
export function isLowVisZone() {
  return _active?.lowVisibility ?? LOW_VIS_BIOMES.has(_active?.biome);
}
// Cap a detection radius for the active zone (low-visibility → 8 squares max).
export function capDetectRange(range) {
  return isLowVisZone() ? Math.min(range, LOW_VIS_AGGRO) : range;
}

// ── Wave spawner ──────────────────────────────────────────────────────────────
// Each entry: { type, x, z, round, every?, yOff?, scale?, roams?, ... }
// `round`  — first round to fire (1-based)
// `every`  — if set, repeats every N rounds after the first fire; omit for one-shot

let _pendingSpawns    = [];
const _firedOneshotIdx = new Set();

// Tell combat.js not to declare victory while unfired one-shot spawns remain.
registerPendingSpawnCheck(() =>
  _pendingSpawns.some((s, i) => !s.every && !_firedOneshotIdx.has(i))
);

function _tickSpawns(roundNum) {
  _pendingSpawns.forEach((s, idx) => {
    if (roundNum < s.round) return;
    const delta = roundNum - s.round;
    if (s.every) {
      if (delta % s.every !== 0) return;
    } else {
      if (delta !== 0) return;
      _firedOneshotIdx.add(idx);
    }

    const u = buildUnit(s.x, s.z, 'red', s.type, s.animOverrides ?? null);
    if (s.yOff)                           u.hoverY = s.yOff;
    if (s.scale != null && s.scale !== 1) u.grp.scale.set(s.scale, s.scale, s.scale);
    if (s.patrol?.length >= 2)            { u.patrolPath = s.patrol; u._patrolIdx = 0; }
    if (s.detectRange != null)            u.detectRange = s.detectRange;
    if (s.roams)                          u.roams = true;
    if (s.roamMode)                       u.roamMode = s.roamMode;
    if (s.wanderRadius != null)           u.wanderRadius = s.wanderRadius;
    if (s.roamGroup)                      { u.roamGroup = s.roamGroup; u.roams = true; }
    if (s.stealthed)                      { if (!isDevMode()) setUnitStealth(u, true); else u.stealthed = true; }

    // Reinforcements are immediately hostile
    u.aggro = true;
    // Roll initiative and insert at correct sorted position
    const def     = UNIT_TYPES[s.type] ?? {};
    const dexMod  = Math.floor(((def.abilities?.dex ?? 10) - 10) / 2);
    const bonus   = (def.initiative ?? 0) + dexMod;
    u.initiative  = Math.floor(Math.random() * 20) + 1 + bonus;
    turnOrder.push(u);
  });
}

window.addEventListener('round:start', e => _tickSpawns(e.detail.round));

// ── Exit markers ──────────────────────────────────────────────────────────────

// scene.remove() only DETACHES — it frees nothing. Without these dispose() calls the fog
// balls' geometries and materials (and, before the textures below were shared, their GPU
// textures) leaked on every single zone transition and accumulated for the whole session.
function _disposeFogObj(m) {
  // Sprites are NOT disposed here: THREE.Sprite shares one module-level geometry across every
  // sprite in the app, so disposing it would tear the rug out from under all the others.
  if (m.isMesh && m.geometry) m.geometry.dispose();
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  // .map is deliberately left alone — it's one of the two shared singletons from _fogBallTex().
  mats.forEach(mat => mat?.dispose());
}

function _clearExits() {
  _exitMeshes.forEach(m => { scene.remove(m); _disposeFogObj(m); });
  _exitMeshes = [];
  _breachMeshes.forEach(m => { scene.remove(m); _disposeFogObj(m); });
  _breachMeshes = [];
  _exitsLive   = false;
  _postCombat  = false;
  _transitioning = false;
}

function _makeFogBallTex(bright) {
  const S   = 256;
  const cv  = document.createElement('canvas');
  cv.width  = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  const a0  = bright ? 0.90 : 0.52;
  const a1  = bright ? 0.65 : 0.30;
  const a2  = bright ? 0.32 : 0.12;
  const grad = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  grad.addColorStop(0.00, `rgba(248, 250, 255, ${a0})`);
  grad.addColorStop(0.38, `rgba(218, 232, 255, ${a1})`);
  grad.addColorStop(0.72, `rgba(188, 212, 255, ${a2})`);
  grad.addColorStop(1.00, 'rgba(168, 196, 255, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

// There are only ever TWO distinct fog images — bright and soft. They used to be re-generated
// per exit and per breach (and once more per ground plane), so a zone with a few gates minted a
// dozen identical 256x256 canvases + GPU textures, none of which were ever disposed. Build each
// once, share it everywhere, and keep it for the life of the page. _disposeFogObj() knows not to
// dispose these.
const _fogTexCache = {};
function _fogBallTex(bright) {
  const k = bright ? 'bright' : 'soft';
  return (_fogTexCache[k] ??= _makeFogBallTex(bright));
}

function _buildExitMarker(exit) {
  // Push fog position deeper into the wall notch along the exit direction
  const eDist = Math.sqrt(exit.x * exit.x + exit.z * exit.z);
  const dirX  = exit.x / eDist;
  const dirZ  = exit.z / eDist;
  const PUSH  = exit.fogPush ?? 7.0;
  const wx    = exit.x + dirX * PUSH + (exit.fogOffsetX ?? 0);
  const wz    = exit.z + dirZ * PUSH + (exit.fogOffsetZ ?? 0);
  const gy    = getTerrainHeight(wx, wz);
  const FS    = exit.fogScale ?? 1;        // whole-ball size multiplier (sprite size + spread)
  const BALL_Y = exit.fogHeight ?? 1.8;    // float above ground — NOT scaled, so the ball
                                           // grows in place rather than riding up into the wall

  const texBright = _fogBallTex(true);
  const texSoft   = _fogBallTex(false);

  // Camera-facing sprites clustered into a sphere shape.
  // ox/oy/oz are offsets from ball centre; bp=bob phase; rs=material rotation speed.
  const sprDefs = [
    { ox:  0.00, oy:  0.00, oz:  0.00, s:  9.0, os: 1.00, bright: true,  bp: 0.0, rs:  0.11 },
    { ox:  0.00, oy:  2.40, oz:  0.00, s:  6.6, os: 0.72, bright: true,  bp: 1.1, rs: -0.09 },
    { ox:  0.00, oy: -1.50, oz:  0.00, s:  7.5, os: 0.60, bright: false, bp: 0.7, rs:  0.07 },
    { ox:  1.95, oy:  0.45, oz:  0.00, s:  5.7, os: 0.55, bright: false, bp: 2.0, rs: -0.10 },
    { ox: -1.95, oy:  0.45, oz:  0.00, s:  5.7, os: 0.55, bright: false, bp: 3.3, rs:  0.08 },
    { ox:  0.00, oy:  0.45, oz:  1.50, s:  5.4, os: 0.50, bright: false, bp: 4.2, rs: -0.06 },
    { ox:  0.00, oy:  0.45, oz: -1.50, s:  5.4, os: 0.50, bright: false, bp: 5.1, rs:  0.11 },
    { ox:  0.00, oy:  4.05, oz:  0.00, s:  4.5, os: 0.38, bright: false, bp: 1.8, rs: -0.07 },
  ];

  sprDefs.forEach(def => {
    const mat = new THREE.SpriteMaterial({
      map:         def.bright ? texBright : texSoft,
      transparent: true,
      opacity:     0,
      depthWrite:  false,
    });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(def.s * FS, def.s * FS, 1);
    spr.position.set(wx + def.ox * FS, gy + BALL_Y + def.oy * FS, wz + def.oz * FS);
    spr.userData.exit         = exit;
    spr.userData.isFogSprite  = true;
    spr.userData.opacityScale = def.os;
    spr.userData.bobPhase     = def.bp;
    spr.userData.baseY        = gy + BALL_Y + def.oy * FS;
    spr.userData.rotSpeed     = def.rs;
    spr.visible = false;
    scene.add(spr);
    _exitMeshes.push(spr);
  });

  // Optional invisible click-helper sphere — larger hit target without changing visuals
  if (exit.clickScale) {
    const r      = 4.5 * exit.clickScale;
    const helper = new THREE.Mesh(
      new THREE.SphereGeometry(r, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    helper.position.set(wx, gy + BALL_Y + 1.5, wz);
    helper.userData.exit         = exit;
    helper.userData.opacityScale = 0;   // keep invisible — tick loop must not overwrite opacity
    helper.visible = false;
    scene.add(helper);
    _exitMeshes.push(helper);
  }

  // Flat ground fog at the base — spills out onto the floor
  [{ size: 11.4, yOff: 0.04, rotSpeed:  0.08, os: 0.40 },
   { size: 16.2, yOff: 0.10, rotSpeed: -0.05, os: 0.20 }].forEach(def => {
    const mat = new THREE.MeshBasicMaterial({
      map:         _fogBallTex(false),
      transparent: true,
      opacity:     0,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.size * FS, def.size * FS), mat);
    mesh.rotation.x        = -Math.PI / 2;
    mesh.position.set(wx, gy + def.yOff, wz);
    mesh.userData.exit         = exit;
    mesh.userData.opacityScale = def.os;
    mesh.userData.rotSpeed     = def.rotSpeed;
    mesh.visible = false;
    scene.add(mesh);
    _exitMeshes.push(mesh);
  });
}

// ── Decorative fog breach (no exit trigger) ───────────────────────────────────

function _buildFogBreach(x, z, scale = 0.5) {
  const gy     = getTerrainHeight(x, z);
  const BALL_Y = 1.8 * scale;

  const texBright = _fogBallTex(true);
  const texSoft   = _fogBallTex(false);

  const sprDefs = [
    { ox:  0.00, oy:  0.00, oz:  0.00, s:  9.0, os: 1.00, bright: true,  bp: 0.0, rs:  0.11 },
    { ox:  0.00, oy:  2.40, oz:  0.00, s:  6.6, os: 0.72, bright: true,  bp: 1.1, rs: -0.09 },
    { ox:  0.00, oy: -1.50, oz:  0.00, s:  7.5, os: 0.60, bright: false, bp: 0.7, rs:  0.07 },
    { ox:  1.95, oy:  0.45, oz:  0.00, s:  5.7, os: 0.55, bright: false, bp: 2.0, rs: -0.10 },
    { ox: -1.95, oy:  0.45, oz:  0.00, s:  5.7, os: 0.55, bright: false, bp: 3.3, rs:  0.08 },
    { ox:  0.00, oy:  0.45, oz:  1.50, s:  5.4, os: 0.50, bright: false, bp: 4.2, rs: -0.06 },
    { ox:  0.00, oy:  0.45, oz: -1.50, s:  5.4, os: 0.50, bright: false, bp: 5.1, rs:  0.11 },
    { ox:  0.00, oy:  4.05, oz:  0.00, s:  4.5, os: 0.38, bright: false, bp: 1.8, rs: -0.07 },
  ];

  sprDefs.forEach(def => {
    const mat = new THREE.SpriteMaterial({
      map:         def.bright ? texBright : texSoft,
      transparent: true,
      opacity:     0.55 * def.os,
      depthWrite:  false,
      fog:         false,   // decorative mist must not be eaten by the zone's own scene fog
                            // (Warrens is a dense red exponential fog — it washed these out)
    });
    const spr = new THREE.Sprite(mat);
    const s   = def.s * scale;
    spr.scale.set(s, s, 1);
    spr.position.set(x + def.ox * scale, gy + BALL_Y + def.oy * scale, z + def.oz * scale);
    spr.userData.isFogSprite = true;
    spr.userData.opacityScale = def.os;
    spr.userData.bobPhase    = def.bp;
    spr.userData.baseY       = gy + BALL_Y + def.oy * scale;
    spr.userData.rotSpeed    = def.rs;
    scene.add(spr);
    _breachMeshes.push(spr);
  });

  [{ size: 11.4, yOff: 0.04, rotSpeed:  0.08, os: 0.40 },
   { size: 16.2, yOff: 0.10, rotSpeed: -0.05, os: 0.20 }].forEach(def => {
    const mat = new THREE.MeshBasicMaterial({
      map:         _fogBallTex(false),
      transparent: true,
      opacity:     0.55 * def.os,
      depthWrite:  false,
      side:        THREE.DoubleSide,
      fog:         false,   // as above — ignore scene fog so the ground disc stays visible
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.size * scale, def.size * scale), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, gy + def.yOff, z);
    mesh.userData.opacityScale = def.os;
    mesh.userData.rotSpeed     = def.rotSpeed;
    scene.add(mesh);
    _breachMeshes.push(mesh);
  });
}

// ── Enemy / NPC spawn ─────────────────────────────────────────────────────────
// Builds and places one zone enemy/NPC def. Shared by initial zone load and by
// the respawn system's live tick (setEnemySpawner below), so a mob returns with
// exactly the same setup it had originally. Returns the unit.
function _spawnZoneEnemy(e) {
  const team = e.team ?? UNIT_TYPES[e.type]?.team ?? 'red';
  const u = buildUnit(e.x, e.z, team, e.type, e.animOverrides ?? null);
  if (e.yOff)                           u.hoverY = e.yOff;
  if (e.rotY != null)                   u.grp.rotation.y = e.rotY;
  if (e.scale != null && e.scale !== 1) u.grp.scale.set(e.scale, e.scale, e.scale);
  if (e.patrol?.length >= 2)            { u.patrolPath = e.patrol; u._patrolIdx = 0; }
  // Idle spawn facing. With no explicit rotY every enemy would sit at the shared default
  // (rotation.y = 0), so a whole zone of idle mobs faces the same way — the "everyone faces
  // SW" look. Instead: a patroller looks toward its first waypoint; anyone else looks toward
  // the party's arrival area (a meaningful, position-varied pose — guards watching the road).
  // An explicit rotY in the zone data always wins (set one in the editor to aim a specific mob).
  if (e.rotY == null) {
    if (e.patrol?.length) {
      const wp = e.patrol.find(p => p.x !== e.x || p.z !== e.z) ?? e.patrol[0];
      u.grp.rotation.y = Math.atan2(wp.x - e.x, wp.z - e.z);
    } else if (_active?.heroEntry?.length) {
      const he = _active.heroEntry;
      const cx = he.reduce((s, h) => s + h.x, 0) / he.length;
      const cz = he.reduce((s, h) => s + h.z, 0) / he.length;
      u.grp.rotation.y = Math.atan2(cx - e.x, cz - e.z);
    }
  }
  // AI settings
  if (e.detectRange != null)      u.detectRange      = e.detectRange;
  if (e.socialAggroRange != null) u.socialAggroRange = e.socialAggroRange;
  if (e.roams)                    u.roams            = true;
  if (e.roamMode)             u.roamMode     = e.roamMode;
  if (e.wanderRadius != null) u.wanderRadius = e.wanderRadius;
  // A band member is a roamer by definition — the in-combat nudge is gated on `roams`,
  // so a follower given only a group id would freeze while its leader walked off.
  if (e.roamGroup)            { u.roamGroup = e.roamGroup; u.roams = true; }
  if (e.stealthed)            { if (!isDevMode()) setUnitStealth(u, true); else u.stealthed = true; }
  if (e.attackPref)           u.attackPref   = e.attackPref;
  tagSpawnedEnemy(u, e);   // stamp _respawnId so a later defeat records its timer
  return u;
}
// Let the respawn system spawn a single foe live when its timer elapses.
setEnemySpawner(_spawnZoneEnemy);

// ── Load a zone ───────────────────────────────────────────────────────────────

export function loadZone(id, repositionHeroes = false, arrivalPos = null) {
  const zone = _registry[id];
  if (!zone) { console.warn(`[zoneLoader] Unknown zone: ${id}`); return; }

  _active = zone;
  _transitioning = false;
  _prewarmZoneProps(zone);   // fetch THIS zone's prop GLBs, not every zone's
  window.dispatchEvent(new CustomEvent('zone:loading'));
  _clearExits();
  _pendingSpawns = (zone.spawns ?? []).slice();  // fresh copy for this zone
  _firedOneshotIdx.clear();

  // Hide short rest panel if open from previous zone
  const srPanel = document.getElementById('short-rest-panel');
  if (srPanel) srPanel.style.display = 'none';

  // Remove all enemies and friendly NPCs (living)
  removeUnits(u => u.team === 'red' || u.team === 'npc');

  // Remove enemy corpses left by death animations
  for (let i = corpses.length - 1; i >= 0; i--) {
    if (corpses[i].team === 'red') {
      scene.remove(corpses[i].grp);
      corpses.splice(i, 1);
    }
  }

  // Apply ground size before biome switch so terrain + grid are rebuilt at the right scale
  const zoneGS = zone.groundSize ?? GROUND_SIZE;
  setActiveGroundSize(zoneGS);
  setSceneGroundSize(zoneGS);
  setGroundBounds(zoneGS / 2);

  // Apply terrain control points, seed, and gate notches before biome switch
  // so they're all baked into the terrain rebuild.
  setTerrainControlPoints(zone.terrain ?? []);
  setTerrainTrenches(zone.trenches ?? []);
  if (zone.terrainSeed) setTerrainSeed(zone.terrainSeed);
  setGateNotches((zone.exits ?? []).map(e => ({ x: e.x, z: e.z, halfWidth: e.notchHalfWidth ?? 2 })));

  // Tunnel-mode zones: swap the heightfield for the carved-canyon layout before
  // the terrain rebuild, so the ground bakes against it.
  setTunnelMode(!!zone.tunnel);
  if (zone.tunnel) {
    if (zone.tunnelPaths) setTunnelPaths(zone.tunnelPaths);
    else buildTunnelPaths();
  }

  // Switch biome — skip random props if zone defines its own
  clearEditorProps();
  if (zone.props?.length) {
    setEnvSkipProps(zone.biome, zone.ambient);
    loadZoneProps(zone.props);  // async; props load in after biome switch
  } else {
    setEnv(zone.biome, zone.ambient);
  }

  // Per-zone atmospheric-fog override (after setEnv, which resets to biome default)
  if (zone.fogDensity != null) setZoneFogDensity(zone.fogDensity, zone.fogColor);

  // Load barrier segments (collision data + dev visuals)
  loadBarrierVisuals(zone.barriers ?? []);
  loadTrenchVisuals(zone.trenches ?? []);

  // Rasterize painted terrain strokes into the ground splatmap. paintRoof/paintRoofTint
  // are still passed through to the paint module's data-only roof layer (see terrainPaint.js).
  loadPaint(zone.paint ?? [], zone.paintTint ?? null, zone.paintRoof ?? [], zone.paintRoofTint ?? null);


  _postCombat = false;

  // Place heroes (initial load) or reposition existing ones (zone transition).
  // Formation: a tight 2×2 box — one hero per adjacent grid square (2 WU each),
  // centred on the arrival point or the centroid of the zone's heroEntry. This
  // overrides the authored per-hero spread so the party always starts clustered.
  const HERO_BOX = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const _entry   = zone.heroEntry ?? [];
  const _cx = arrivalPos ? arrivalPos.x : (_entry.length ? _entry.reduce((s, p) => s + p.x, 0) / _entry.length : 0);
  const _cz = arrivalPos ? arrivalPos.z : (_entry.length ? _entry.reduce((s, p) => s + p.z, 0) / _entry.length : 0);
  const _box = HERO_BOX.map(([ox, oz]) => ({ x: _cx + ox, z: _cz + oz }));

  if (repositionHeroes) {
    const heroes = units.filter(u => u.team === 'blue');
    _box.forEach((pos, i) => {
      const h = heroes[i];
      if (!h) return;
      h.grp.position.set(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
      if (h.anchor) { h.anchor.x = pos.x; h.anchor.z = pos.z; }
    });
    // Snap camera instantly to party leader — prevents lerping from the previous zone.
    snapCameraToUnit(heroes[0]);
  } else {
    // Fresh load — place heroes if none exist yet (keep each hero's type/order,
    // but at the tight box position).
    const existing = units.filter(u => u.team === 'blue');
    if (existing.length === 0) {
      _entry.forEach((pos, i) => {
        const bp = _box[i] ?? pos;
        const u  = buildUnit(bp.x, bp.z, 'blue', pos.type);
        renderHeroPortrait(u);
      });
    }
  }

  // Re-attach dungeon lights to existing heroes after any env switch
  // (setEnv always clears them; buildUnit only runs on first load)
  units.filter(u => u.team === 'blue').forEach(u => addUnitDungeonLight(u.grp));

  // Apply zone-specific hero skin — must run after heroes are built
  applyHeroSkin(zone.heroSkin ?? null);

  // Place enemies and friendly NPCs. Enemy spawns run through the respawn
  // filter: any foe whose 15-min / 2-h timer hasn't elapsed stays dead and is
  // skipped here (it comes back later via tickRespawn while you linger, or on a
  // future re-entry). Friendly NPCs (team:'npc') never respawn-gate — they're
  // always placed. filterZoneSpawns records the full enemy set so live respawn
  // knows every spawn point.
  const enemyDefs = zone.enemies.filter(e => (e.team ?? UNIT_TYPES[e.type]?.team ?? 'red') === 'red');
  const nonEnemyDefs = zone.enemies.filter(e => (e.team ?? UNIT_TYPES[e.type]?.team ?? 'red') !== 'red');
  const spawnNow = filterZoneSpawns(id, enemyDefs, { fresh: !!zone.freshEnemies });

  // Unit GLBs are no longer all preloaded at boot (see ensureModels in units.js), so this
  // zone's models may not be in hand yet. Fetch exactly what it needs — its enemies/NPCs
  // plus the types its round-based `spawns` will conjure mid-fight — and place them once
  // they land. buildUnit falls back to a PLACEHOLDER BOX for a type whose GLB is missing,
  // so spawning before the fetch resolves would litter the zone with grey cubes.
  //
  // Everything downstream of here (exits, fog, zone:loaded) still runs synchronously; only
  // the bodies wait. The guard catches the player leaving again before the models arrive.
  const zoneTypes = [
    ...zone.enemies.map(e => e.type),
    ...(zone.spawns ?? []).map(s => s.type),
  ];
  ensureModels(zoneTypes).then(() => {
    if (_active !== zone) return;   // zone changed while we were fetching — drop it
    spawnNow.forEach(_spawnZoneEnemy);
    nonEnemyDefs.forEach(_spawnZoneEnemy);
  });

  // Build exit markers — visible whenever outside combat (tickZone drives this)
  zone.exits.forEach(exit => _buildExitMarker(exit));
  if (zone.exits?.length) _exitsLive = true;

  // Build decorative fog breaches (atmospheric; no zone transition)
  zone.fogBreaches?.forEach(b => _buildFogBreach(b.x, b.z, b.scale ?? 0.5));

  // Update zone label in UI
  _updateZoneLabel();

  // Per-zone grid visibility (how strong the grid lines read in THIS zone).
  setGridOpacity(zone.gridOpacity ?? DEFAULT_GRID_OPACITY);

  // Remember last zone so HMR reloads restore it automatically
  try { localStorage.setItem('dnd-last-zone', id); } catch {}

  // Fire event so other systems can react
  window.dispatchEvent(new CustomEvent('zone:loaded', { detail: { id } }));
}

// ── Activate exits after victory ──────────────────────────────────────────────

export function activateExits() {
  if (!_active?.exits?.length) return;
  _postCombat = true;
  _updateZoneProgress();
}

function _showShortRestPanel(targetZoneId, arrivalPos = null) {
  const panel   = document.getElementById('short-rest-panel');
  const rowsEl  = document.getElementById('sr-hero-rows');
  const rollBtn = document.getElementById('sr-roll-btn');
  const skipBtn = document.getElementById('sr-skip-btn');
  if (!panel || !rowsEl) return;

  const heroes = units.filter(u => u.team === 'blue');

  // Build hero rows
  rowsEl.innerHTML = heroes.map((h, i) => {
    const pct = Math.max(0, h.hp / h.maxHp);
    const lowCls = pct <= 0.25 ? ' crit' : pct <= 0.50 ? ' low' : '';
    return `<div class="sr-row" data-idx="${i}">
      <span class="sr-row-name">${UNIT_TYPES[h.type]?.name ?? h.type}</span>
      <div class="sr-hp-wrap">
        <div class="sr-hp-bar-bg"><div class="sr-hp-bar-fill${lowCls}" style="width:${(pct*100).toFixed(1)}%"></div></div>
        <div class="sr-hp-text">
          <span class="sr-hp-cur">${h.hp}</span>
          <span>/ ${h.maxHp}</span>
        </div>
      </div>
      <span class="sr-heal-amt" data-idx="${i}"></span>
    </div>`;
  }).join('');

  if (rollBtn) {
    rollBtn.disabled = false;
    rollBtn.onclick = () => {
      rollBtn.disabled = true;
      heroes.forEach((h, i) => {
        if (h.hp >= h.maxHp) {
          document.querySelector(`.sr-heal-amt[data-idx="${i}"]`).textContent = '—';
          return;
        }
        const def = UNIT_TYPES[h.type];
        const die = def?.hitDie ?? 8;
        const con = def?.abilities?.con ?? 10;
        const conMod = Math.floor((con - 10) / 2);
        const rolled = Math.ceil(Math.random() * die);
        const healed = Math.max(1, rolled + conMod);
        const actual = applyHeal(h, healed);   // rest heal: received-only, no caster

        // Update row visuals
        const pct = h.hp / h.maxHp;
        const lowCls = pct <= 0.25 ? ' crit' : pct <= 0.50 ? ' low' : '';
        const fillEl = rowsEl.querySelectorAll('.sr-hp-bar-fill')[i];
        const curEl  = rowsEl.querySelectorAll('.sr-hp-cur')[i];
        const amtEl  = document.querySelector(`.sr-heal-amt[data-idx="${i}"]`);
        if (fillEl) { fillEl.className = `sr-hp-bar-fill${lowCls}`; fillEl.style.width = `${(pct*100).toFixed(1)}%`; }
        if (curEl)  curEl.textContent = h.hp;
        if (amtEl)  amtEl.textContent = actual > 0 ? `+${actual}` : '—';
      });
    };
  }

  if (skipBtn) {
    skipBtn.onclick = () => {
      panel.style.display = 'none';
      _triggerNextZone(targetZoneId, arrivalPos);
    };
  }

  panel.style.display = 'block';
}

function _triggerNextZone(targetId, arrivalPos = null) {
  const outcomeEl = document.getElementById('battle-outcome');
  if (outcomeEl) { outcomeEl.style.display = 'none'; outcomeEl.className = ''; }
  loadZone(targetId, true, arrivalPos);
  _showSetupAfterTransition();
}

// Shared by the click-trigger handler and the proximity auto-trigger below.
// Requires at least one living hero within 1 square of the fog ball center —
// the ball is pushed fogPush WU past the exit's raw x/z along the exit
// direction vector, so the check has to use that world position, not the
// raw exit coordinates. Returns true if the exit fired.
function _tryActivateExit(exit) {
  if (!_exitsLive || _transitioning || combatPhase) return false;
  const eDist = Math.sqrt(exit.x * exit.x + exit.z * exit.z);
  const push  = exit.fogPush ?? 7.0;
  const fogX  = exit.x + (exit.x / eDist) * push + (exit.fogOffsetX ?? 0);
  const fogZ  = exit.z + (exit.z / eDist) * push + (exit.fogOffsetZ ?? 0);
  const r     = WORLD_UNITS_PER_SQUARE;
  const nearEnough = units.some(u => {
    if (u.team !== 'blue' || u.hp <= 0) return false;
    const dx = u.grp.position.x - fogX;
    const dz = u.grp.position.z - fogZ;
    return dx * dx + dz * dz <= r * r;
  });
  if (!nearEnough) return false;
  _transitioning = true;
  const ap = exit.arrivalX != null ? { x: exit.arrivalX, z: exit.arrivalZ } : null;
  if (_postCombat) {
    _showShortRestPanel(exit.targetZone, ap);
    _transitioning = false; // panel handles its own flow
  } else {
    _triggerNextZone(exit.targetZone, ap);
  }
  return true;
}

// ── Placeable Zone-Gate props (fog + white click-ball) ─────────────────────────
// A gate prop's white ball, clicked with a hero within 10 ft (army.js), dispatches this. Routed
// through the SAME transition flow as a coordinate exit — short-rest panel if the zone was
// cleared, straight travel otherwise. Arrival is the destination zone's RECIPROCAL gate (the one
// pointing back here), so connections need NO arrival coordinates: place a gate in each zone and
// point them at each other. If the target has no reciprocal gate, arrival is null → zone default entry.
function _reciprocalArrival(targetZoneId, originZoneId) {
  const tz = _registry[targetZoneId];
  if (!tz || !originZoneId) return null;
  const gate = (tz.props ?? []).find(p => p.model === 'zonegate' && p.params?.targetZone === originZoneId);
  return gate ? { x: gate.x, z: gate.z } : null;
}

window.addEventListener('zonegate:travel', e => {
  const targetZone = e.detail?.targetZone;
  if (!targetZone || _transitioning || combatPhase) return;
  const arrival = _reciprocalArrival(targetZone, _active?.id);
  _transitioning = true;
  if (_postCombat) { _showShortRestPanel(targetZone, arrival); _transitioning = false; }
  else             { _triggerNextZone(targetZone, arrival); }
});

// ── Per-frame tick ────────────────────────────────────────────────────────────

export function tickZone(dt) {
  _exitT += dt;

  // ── Proximity-triggered exits — fire automatically, no click needed ────────
  if (_exitsLive && !_transitioning && !combatPhase) {
    for (const exit of _active?.exits ?? []) {
      if (exit.proximityTrigger && _tryActivateExit(exit)) break;
    }
  }

  // ── Exit fog ──────────────────────────────────────────────────────────────
  if (_exitsLive && _exitMeshes.length) {
    const show = !combatPhase;
    _exitMeshes.forEach(m => { if (m.visible !== show) m.visible = show; });
    if (show) {
      const baseOpacity = 0.50 + Math.sin(_exitT * 1.3) * 0.13;
      for (const m of _exitMeshes) {
        m.material.opacity = baseOpacity * (m.userData.opacityScale ?? 1.0);
        if (m.userData.isFogSprite) {
          m.material.rotation += dt * (m.userData.rotSpeed ?? 0.10);
          m.position.y = m.userData.baseY + Math.sin(_exitT * 1.1 + (m.userData.bobPhase ?? 0)) * 0.12;
        } else {
          m.rotation.z += dt * (m.userData.rotSpeed ?? 0.08);
        }
      }
    }
  }

  // ── Decorative breach fog (always on, outside combat) ─────────────────────
  if (_breachMeshes.length) {
    const show = !combatPhase;
    _breachMeshes.forEach(m => { if (m.visible !== show) m.visible = show; });
    if (show) {
      const baseOpacity = 0.50 + Math.sin(_exitT * 1.1) * 0.10;
      for (const m of _breachMeshes) {
        m.material.opacity = baseOpacity * (m.userData.opacityScale ?? 1.0);
        if (m.userData.isFogSprite) {
          m.material.rotation += dt * (m.userData.rotSpeed ?? 0.10);
          m.position.y = m.userData.baseY + Math.sin(_exitT * 0.9 + (m.userData.bobPhase ?? 0)) * 0.08;
        } else {
          m.rotation.z += dt * (m.userData.rotSpeed ?? 0.08);
        }
      }
    }
  }
}

// ── Zone UI init ──────────────────────────────────────────────────────────────

function _updateZoneLabel() {
  const el = document.getElementById('zone-current-name');
  if (el) el.textContent = _active ? `Active: ${_active.name}` : '';
  document.querySelectorAll('.zone-btn').forEach(btn => {
    btn.classList.toggle('active-zone', btn.dataset.zone === _active?.id);
  });
  _updateZoneProgress();
}

function _updateZoneProgress() {
  const el = document.getElementById('zone-progress-dots');
  if (!el) return;
  const activeIdx = ZONE_ORDER.findIndex(z => z.id === _active?.id);
  el.innerHTML = ZONE_ORDER.map((z, i) => {
    const cls = i < activeIdx ? 'zp-dot cleared' : i === activeIdx ? 'zp-dot active' : 'zp-dot';
    return `<span class="${cls}" title="${z.name}"></span>`;
  }).join('');
}

export function initZoneUI() {
  // ── Exit disc click trigger ──────────────────────────────────────────────
  renderer.domElement.addEventListener('click', e => {
    if (!_exitsLive || _transitioning || combatPhase) return;
    _exitPt.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    _exitRay.setFromCamera(_exitPt, camera);
    const hits = _exitRay.intersectObjects(_exitMeshes.filter(m => m.visible));
    if (!hits.length) return;
    const exit = hits.find(h => h.object.userData.exit)?.object.userData.exit;
    if (!exit || exit.proximityTrigger) return; // proximity gates fire on their own, not on click
    if (_tryActivateExit(exit)) e.stopImmediatePropagation();
  }, true); // capture phase — runs before hero-click handlers

  // ── Zone row helpers ────────────────────────────────────────────────────
  function _makeZoneRow(id, name) {
    const row = document.createElement('div');
    row.className = 'zone-row';
    row.innerHTML = `<button class="zone-btn s-btn" data-zone="${id}">⚔ ${name}</button><button class="zone-del-btn" data-zone="${id}" title="Delete zone">×</button>`;
    return row;
  }

  function _promptDelete(row, id, name) {
    row.classList.add('zone-confirm-row');
    row.innerHTML = '';

    const text = document.createElement('div');
    text.className   = 'zone-confirm-text';
    text.textContent = `Delete "${name}"?`;

    const btns = document.createElement('div');
    btns.className = 'zone-confirm-btns';

    const yesBtn = document.createElement('button');
    yesBtn.className   = 's-btn';
    yesBtn.textContent = 'YES';
    yesBtn.addEventListener('click', async () => {
      yesBtn.disabled = noBtn.disabled = true;
      try {
        const res  = await fetch('/__delete_zone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        delete _registry[id];
        row.remove();
      } catch (err) {
        console.error('[deleteZone]', err);
        _restoreRow(row, id, name);
      }
    });

    const noBtn = document.createElement('button');
    noBtn.className   = 's-btn';
    noBtn.textContent = 'NO';
    noBtn.addEventListener('click', () => _restoreRow(row, id, name));

    btns.appendChild(yesBtn);
    btns.appendChild(noBtn);
    row.appendChild(text);
    row.appendChild(btns);
  }

  function _restoreRow(row, id, name) {
    row.classList.remove('zone-confirm-row');
    row.innerHTML = `<button class="zone-btn s-btn" data-zone="${id}">⚔ ${name}</button><button class="zone-del-btn" data-zone="${id}" title="Delete zone">×</button>`;
  }

  // Zone list — rebuild from ZONE_ORDER every init (survives HMR reloads)
  const listEl = document.getElementById('zone-list');
  if (listEl) {
    listEl.innerHTML = '';
    ZONE_ORDER.forEach(zone => listEl.appendChild(_makeZoneRow(zone.id, zone.name)));

    listEl.addEventListener('click', e => {
      const loadBtn = e.target.closest('.zone-btn');
      if (loadBtn) { loadZone(loadBtn.dataset.zone, true); return; }

      const delBtn = e.target.closest('.zone-del-btn');
      if (delBtn) {
        const row     = delBtn.closest('.zone-row');
        const id      = delBtn.dataset.zone;
        const loadBtn = row?.querySelector('.zone-btn');
        const name    = _registry[id]?.name ?? loadBtn?.textContent.replace('⚔ ', '').trim() ?? id;
        if (row && id) _promptDelete(row, id, name);
      }
    });
  }

  // ── New zone creation ────────────────────────────────────────────────────
  const newZoneBtn = document.getElementById('zone-new-btn');
  const createForm = document.getElementById('zone-create-form');
  const nameInput  = document.getElementById('zone-name-input');
  const confirmBtn = document.getElementById('zone-create-confirm-btn');
  const cancelBtn  = document.getElementById('zone-create-cancel-btn');
  const statusEl   = document.getElementById('zone-current-name');

  function _showCreateForm() {
    if (createForm) createForm.style.display = 'block';
    if (newZoneBtn) newZoneBtn.style.display = 'none';
    nameInput?.focus();
  }
  function _hideCreateForm() {
    if (createForm) createForm.style.display = 'none';
    if (newZoneBtn) newZoneBtn.style.display = '';
    if (nameInput)  nameInput.value = '';
  }

  newZoneBtn?.addEventListener('click', _showCreateForm);
  cancelBtn?.addEventListener('click', _hideCreateForm);

  async function _createZone() {
    const name = nameInput?.value.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!id) return;

    if (confirmBtn) confirmBtn.disabled = true;
    try {
      const res  = await fetch('/__create_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const mod  = await import(`./zones/zone_${id}.js`);
      const zone = mod.ZONE;
      _registry[zone.id] = zone;

      listEl?.appendChild(_makeZoneRow(zone.id, zone.name));
      _hideCreateForm();
      loadZone(zone.id, true);  // switch to new zone + set localStorage for HMR auto-resume
    } catch (err) {
      console.error('[createZone]', err);
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      if (confirmBtn) confirmBtn.disabled = false;
    }
  }

  confirmBtn?.addEventListener('click', _createZone);
  nameInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter')  _createZone();
    if (e.key === 'Escape') _hideCreateForm();
  });

  // #next-zone-btn is now only used as a fallback; rest panel handles the flow.
  // Keep listener in case it's triggered directly (e.g., skip-rest path already calls _triggerNextZone).

  // React to zone:victory
  window.addEventListener('zone:victory', () => {
    if (_active) activateExits();
  });

  // Production: start game automatically once the intro cutscene ends (or is skipped)
  if (!IS_DEV) {
    window.addEventListener('game:ready', () => {
      document.getElementById('start-battle-btn')?.click();
    }, { once: true });
  }

  // Auto-resume last zone after HMR page reload; fall back to first zone for new players
  try {
    const lastZone = localStorage.getItem('dnd-last-zone');
    const startZone = (lastZone && _registry[lastZone]) ? lastZone : ZONE_ORDER[0].id;
    modelsReady.then(() => loadZone(startZone, false));
  } catch {}
}

function _fullReset() {
  const srPanel = document.getElementById('short-rest-panel');
  if (srPanel) srPanel.style.display = 'none';
  const nextBtn = document.getElementById('next-zone-btn');
  if (nextBtn) nextBtn.style.display = 'none';
  clearEditorProps();
  removeUnits(() => true);
  // Clear hero corpses too
  for (let i = corpses.length - 1; i >= 0; i--) {
    scene.remove(corpses[i].grp);
  }
  corpses.length = 0;
  _clearExits();
  _active = null;
  _updateZoneLabel();
  resetToSetup();
  const setupZones     = document.getElementById('setup-panel-zones');
  const setupCutscenes = document.getElementById('setup-panel-cutscenes');
  const startWrap      = document.getElementById('start-battle-btn-wrap');
  if (IS_DEV) {
    if (setupZones)     setupZones.style.display     = '';
    if (setupCutscenes) setupCutscenes.style.display = '';
    if (startWrap)      startWrap.style.display      = '';
  } else {
    document.getElementById('start-battle-btn')?.click();
  }
}

function _showSetupAfterTransition() {
  resetToSetup();
  // Always auto-proceed into precombat on zone transitions — dev setup panels
  // are for initial zone loads from the panel, not mid-gameplay transitions.
  document.getElementById('start-battle-btn')?.click();
  // start-battle-btn resets camera to default scene position; re-snap to heroes
  // immediately so raycasting and camera are correct from the first frame.
  const firstHero = units.find(u => u.team === 'blue' && u.hp > 0);
  if (firstHero) snapCameraToUnit(firstHero);
}

// ── Dev: live-reload zone data on file edit ───────────────────────────────────
// When a zone module is hand-edited (or pulled), Vite hot-swaps the module but the
// registry/active-zone bindings + the prop editor's in-memory prop list stay stale —
// so an in-editor save would clobber the file edit (the recurring waystoneId strip).
// Here we rebind the registry to the fresh ZONE and, for the active zone, re-run
// loadZoneProps so both the rendered props AND the editor's list match the file.
// NOTE: this reloads from disk, so any UNSAVED in-editor placements are discarded —
// save before hand-editing. Dev-only (import.meta.hot is undefined in prod builds).
if (import.meta.hot) {
  import.meta.hot.accept([
    './zones/zone_road_to_phandelver.js',
    './zones/zone_bleakmire_woods.js',
    './zones/zone_haunted_wood.js',
    './zones/zone_mausoleum.js',
    './zones/zone_river_styx.js',
    './zones/zone_warrens.js',
    './zones/zone_phandalin.js',
  ], (mods) => {
    for (const mod of mods) {              // aligned with the deps array; unchanged = undefined
      const zone = mod?.ZONE;
      if (!zone) continue;
      _registry[zone.id] = zone;
      if (_active && zone.id === _active.id) {
        _active = zone;
        loadZoneProps(zone.props);
        console.info(`[zoneLoader] '${zone.id}' reloaded from file — editor props re-synced${isPropEditorOpen() ? ' (editor open)' : ''}.`);
      }
    }
  });
}
