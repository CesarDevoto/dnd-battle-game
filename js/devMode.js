import * as THREE from 'three';
import { camera, controls, scene, getFollowUnit, setFollowUnit } from './scene.js';
import { SCENE, UNIT_TYPES } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { units, setUnitStealth } from './units.js';
import { getMarkersVisible, setMarkersVisible } from './terrainEditor.js';
import { setPointLightOrbsVisible } from './environments.js';
import { isAIPanelOpen } from './npcAIEditor.js';
import { IS_DEV } from './devConfig.js';

let _dev = IS_DEV;
const _wasOpen = { prop: false, npc: false, terrain: false };
let _markersWereVisible = true;

// ── Dev sky light — dungeon only ──────────────────────────────────────────────
// Gives enough overhead fill to build/review dungeon zones; killed in play view.
const _devSkyLight = new THREE.HemisphereLight(0xe0e8ff, 0x806050, 0);
_devSkyLight.position.set(0, 20, 0);
scene.add(_devSkyLight);
let _currentEnv = 'forest';

function _syncDevLight() {
  const darkEnv = _currentEnv === 'dungeon' || _currentEnv === 'graveyard';
  _devSkyLight.intensity = (_dev && darkEnv) ? 3.0 : 0;
}

export const isDevMode = () => _dev;

// ── Detect-range rings (red, shown in dev mode only) ─────────────────────────
const _DETECT_DEFAULT = 20;
const _detectRings    = new Map();   // unit → THREE.Mesh

// ── Social-aggro rings (purple, shown in dev mode only) ───────────────────────
const _SOCIAL_DEFAULT = 10;
const _socialRings    = new Map();   // unit → THREE.Mesh

// ── WASD state ────────────────────────────────────────────────────────────────
const _keys = { w: false, a: false, s: false, d: false, q: false, e: false };

// ── Dev camera tick (called from main.js render loop) ─────────────────────────
export function tickDevCamera(dt) {
  _tickDetectRings();
  _tickSocialRings();

  if (!_dev) return;
  const any = Object.values(_keys).some(Boolean);
  if (!any) return;

  // Pan speed scales with camera height so it feels the same zoomed in or out
  const speed = Math.max(camera.position.y, 4) * 1.8;

  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();

  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

  const delta = new THREE.Vector3();
  if (_keys.w) delta.addScaledVector(fwd,    speed * dt);
  if (_keys.s) delta.addScaledVector(fwd,   -speed * dt);
  if (_keys.a) delta.addScaledVector(right,  -speed * dt);
  if (_keys.d) delta.addScaledVector(right,   speed * dt);

  controls.target.add(delta);
  camera.position.add(delta);
}

// ── Detect ring management ────────────────────────────────────────────────────

function _tickDetectRings() {
  // Remove rings whose unit is no longer in the scene
  for (const [unit, mesh] of _detectRings) {
    if (!units.includes(unit)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      _detectRings.delete(unit);
    }
  }

  // Create or update a ring for every living enemy
  for (const unit of units) {
    if (unit.team !== 'red') continue;

    const cx     = unit.grp.position.x;
    const cz     = unit.grp.position.z;
    const radius = unit.detectRange ?? UNIT_TYPES[unit.type]?.detect ?? _DETECT_DEFAULT;

    if (!_detectRings.has(unit)) {
      const geo  = new THREE.RingGeometry(radius - 0.18, radius + 0.18, 72);
      const mat  = new THREE.MeshBasicMaterial({
        color: 0xff2222, side: THREE.DoubleSide,
        transparent: true, opacity: 0.55, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x    = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.visible       = _dev;
      mesh.position.set(cx, getTerrainHeight(cx, cz) + 0.08, cz);
      mesh.userData.lastCx     = cx;
      mesh.userData.lastCz     = cz;
      mesh.userData.lastRadius = radius;
      scene.add(mesh);
      _detectRings.set(unit, mesh);
    } else {
      const mesh = _detectRings.get(unit);
      if (mesh.userData.lastRadius !== radius) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.RingGeometry(radius - 0.18, radius + 0.18, 72);
        mesh.userData.lastRadius = radius;
      }
      if (cx !== mesh.userData.lastCx || cz !== mesh.userData.lastCz) {
        mesh.position.set(cx, getTerrainHeight(cx, cz) + 0.08, cz);
        mesh.userData.lastCx = cx;
        mesh.userData.lastCz = cz;
      }
      mesh.visible = _dev && isAIPanelOpen();
    }
  }
}

// ── Social-aggro ring management ──────────────────────────────────────────────

function _tickSocialRings() {
  for (const [unit, mesh] of _socialRings) {
    if (!units.includes(unit)) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      _socialRings.delete(unit);
    }
  }

  for (const unit of units) {
    if (unit.team !== 'red') continue;

    const cx     = unit.grp.position.x;
    const cz     = unit.grp.position.z;
    const radius = unit.socialAggroRange ?? _SOCIAL_DEFAULT;

    if (!_socialRings.has(unit)) {
      const geo  = new THREE.RingGeometry(radius - 0.18, radius + 0.18, 72);
      const mat  = new THREE.MeshBasicMaterial({
        color: 0xaa22ff, side: THREE.DoubleSide,
        transparent: true, opacity: 0.55, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x    = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.visible       = _dev;
      mesh.position.set(cx, getTerrainHeight(cx, cz) + 0.06, cz);
      mesh.userData.lastCx     = cx;
      mesh.userData.lastCz     = cz;
      mesh.userData.lastRadius = radius;
      scene.add(mesh);
      _socialRings.set(unit, mesh);
    } else {
      const mesh = _socialRings.get(unit);
      if (mesh.userData.lastRadius !== radius) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.RingGeometry(radius - 0.18, radius + 0.18, 72);
        mesh.userData.lastRadius = radius;
      }
      if (cx !== mesh.userData.lastCx || cz !== mesh.userData.lastCz) {
        mesh.position.set(cx, getTerrainHeight(cx, cz) + 0.06, cz);
        mesh.userData.lastCx = cx;
        mesh.userData.lastCz = cz;
      }
      mesh.visible = _dev && isAIPanelOpen();
    }
  }
}

// ── Public init ───────────────────────────────────────────────────────────────
export function initDevMode() {
  const _btn = document.getElementById('dev-mode-btn');
  if (!IS_DEV) {
    if (_btn) _btn.style.display = 'none';
  } else {
    _btn?.addEventListener('click', _toggle);
  }

  window.addEventListener('env:set', e => {
    _currentEnv = e.detail;
    _syncDevLight();
  });

  // Zone loads call snapCameraToUnit which re-sets _followUnit — release it in dev mode
  // so the camera stays free instead of continuously chasing the hero.
  window.addEventListener('zone:loaded', () => {
    if (_dev) setFollowUnit(null);
  });

  window.addEventListener('keydown', e => {
    // Don't intercept when typing in search boxes etc.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!_dev) return;
    if (e.code === 'KeyW') _keys.w = true;
    if (e.code === 'KeyA') _keys.a = true;
    if (e.code === 'KeyS') _keys.s = true;
    if (e.code === 'KeyD') _keys.d = true;
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'KeyW') _keys.w = false;
    if (e.code === 'KeyA') _keys.a = false;
    if (e.code === 'KeyS') _keys.s = false;
    if (e.code === 'KeyD') _keys.d = false;
  });

  _applyCamera();
  _applyUI();
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function _toggle() {
  _dev = !_dev;

  if (!_dev) {
    // Entering play mode — remember which editors were open, then close them
    ['prop', 'npc', 'npc-ai', 'terrain'].forEach(key => {
      const btn = document.getElementById(`${key}-editor-btn`);
      _wasOpen[key] = btn?.classList.contains('active') ?? false;
      if (_wasOpen[key]) btn.click();
    });
    Object.keys(_keys).forEach(k => { _keys[k] = false; });
    // Hide terrain control point markers
    _markersWereVisible = getMarkersVisible();
    setMarkersVisible(false);
    // Stealthed enemies become semi-transparent in play mode
    for (const u of units) {
      if (u.stealthed) setUnitStealth(u, true);
    }
    setPointLightOrbsVisible(false);
  } else {
    // Returning to dev mode — reopen whichever editors were open before
    ['prop', 'npc', 'npc-ai', 'terrain'].forEach(key => {
      if (_wasOpen[key]) document.getElementById(`${key}-editor-btn`)?.click();
      _wasOpen[key] = false;
    });
    // Restore terrain markers to their pre-play-mode state
    setMarkersVisible(_markersWereVisible);
    // Show all stealthed enemies fully opaque so the designer can see and edit them
    for (const u of units) {
      if (u.stealthed) setUnitStealth(u, false);
    }
    setPointLightOrbsVisible(true);
    // Release camera from hero-follow so WASD is fully free in dev view
    setFollowUnit(null);
  }

  _applyCamera();
  _applyUI();
  _syncDevLight();
}

// ── Camera lock / unlock ──────────────────────────────────────────────────────
function _applyCamera() {
  if (_dev) {
    controls.enableRotate  = true;
    controls.enableZoom    = true;
    controls.enablePan     = true;
    controls.minDistance   = 0.3;
    controls.maxDistance   = 400;
    controls.zoomSpeed     = 4.0;
    controls.panSpeed      = 1.2;
    controls.rotateSpeed   = 0.7;
    controls.mouseButtons  = {
      LEFT:   THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.ROTATE,
    };
  } else {
    controls.enableRotate  = false;
    controls.enableZoom    = false;
    controls.enablePan     = false;
    controls.minDistance   = SCENE.orbitMaxDist;
    controls.maxDistance   = SCENE.orbitMaxDist;
    controls.mouseButtons  = {
      LEFT:   THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT:  THREE.MOUSE.PAN,
    };
    // Only snap to the default play-mode position when not mid-combat following a unit
    if (!getFollowUnit()) {
      camera.position.set(...SCENE.cameraPos);
      controls.target.set(0, 0, SCENE.cameraPlayTarget);
      controls.update();
    }
  }
}

// ── UI class + button label ───────────────────────────────────────────────────
function _applyUI() {
  document.getElementById('app').classList.toggle('play-mode', !_dev);
  const btn = document.getElementById('dev-mode-btn');
  if (!btn) return;
  btn.textContent = _dev ? '▶  PLAY VIEW' : '⚙  DEV VIEW';
  btn.title       = _dev ? 'Switch to player view' : 'Switch to dev view';
  btn.classList.toggle('play-mode-active', !_dev);
  // Immediately sync ring visibility with the new dev state
  for (const mesh of _detectRings.values()) mesh.visible = _dev;
  for (const mesh of _socialRings.values()) mesh.visible = _dev;
}
