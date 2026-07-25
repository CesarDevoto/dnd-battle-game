import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { scene, camera, renderer, ground } from './scene.js';
import { activeProps, propPositions, losBlockerMeshes, activeEnv } from './environments.js';
import { getTerrainHeight, getGroundHeight } from './terrain.js';
import { PROP_MODELS } from './propRegistry.js';
import { trackExclamation, untrackExclamation, clearAllExclamations } from './exclamationMarkers.js';
import { markEnvVisibilityDirty } from './environmentVisibility.js';
import { registerCollisionMesh, clearCollisionMeshes, isSurfaceMovement } from './surfaces.js';


// ── State ─────────────────────────────────────────────────────────────────────

let _open          = false;
let _propsHidden   = false;
let _selectedModel = null;  // currently chosen model to stamp (null = none selected)
let _placedProps   = [];   // { mesh, model, x, z, rotY, scaleF }
let _selectedIdx   = -1;  // index into _placedProps of the selected prop (-1 = none)
let _activeZoneId  = null; // updated via zone:loaded event

// Global flag read by army.js to yield click events to this editor
export const isPropEditorOpen = () => _open;

// ── GLB cache ─────────────────────────────────────────────────────────────────

const _loader      = new GLTFLoader();
_loader.setMeshoptDecoder(MeshoptDecoder);   // decode meshopt-compressed GLBs
const _glbCache    = {};

function _loadGLB(modelKey) {
  if (_glbCache[modelKey]) return Promise.resolve(_glbCache[modelKey]);
  return new Promise((resolve, reject) => {
    _loader.load(
      PROP_MODELS[modelKey].path,
      gltf => {
        const root = gltf.scene;
        // Normalize so the model's visual bottom sits at y=0 in root-local space.
        // After this, finalY = terrainH + yOff correctly plants the bottom on terrain
        // regardless of where the GLB author set the model's pivot.
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root, true);
        if (!box.isEmpty() && Math.abs(box.min.y) > 0.001) {
          root.children.forEach(c => { c.position.y -= box.min.y; });
          root.updateMatrixWorld(true);
        }
        // Optional per-model albedo lift (PROP_MODELS[key].brighten): multiply the base
        // colour so a model that reads too dark comes up lighter, keeping its texture and
        // still responding to scene light. Applied once on the cached root; clones share
        // these materials by reference, so every placed copy inherits the lift.
        const brighten = PROP_MODELS[modelKey].brighten;
        if (brighten) {
          root.traverse(o => {
            if (!o.isMesh || !o.material) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => { if (m.color) m.color.multiplyScalar(brighten); });
          });
        }
        _glbCache[modelKey] = root;
        resolve(root);
      },
      undefined,
      reject,
    );
  });
}

// ── Light param helpers ───────────────────────────────────────────────────────

function _applyLightParams(entry) {
  const light = entry.mesh?.userData?.light;
  if (!light || !entry.params) return;
  light.intensity = entry.params.intensity ?? 6;
  light.distance  = entry.params.range     ?? 18;
}

function _updateLightControls() {
  const wrap = document.getElementById('pe-light-controls');
  if (!wrap) return;
  const entry = _selectedIdx >= 0 ? _placedProps[_selectedIdx] : null;
  const isLight = entry?.model === 'point_light';
  wrap.style.display = isLight ? 'block' : 'none';
  if (!isLight || !entry.params) return;
  const iInput = document.getElementById('pe-light-intensity');
  const rInput = document.getElementById('pe-light-range');
  const iVal   = document.getElementById('pe-light-intensity-val');
  const rVal   = document.getElementById('pe-light-range-val');
  if (iInput) { iInput.value = entry.params.intensity; iVal.textContent = entry.params.intensity; }
  if (rInput) { rInput.value = entry.params.range;     rVal.textContent = entry.params.range; }
}

// Show the "never fade" checkbox for any real (model-backed) prop and sync it to the
// selected entry. Biome-adopted props (model === null) can't be re-serialized, so the
// toggle would not persist — hide it for them.
function _updateFadeControl() {
  const wrap = document.getElementById('pe-fade-controls');
  if (!wrap) return;
  const entry = _selectedIdx >= 0 ? _placedProps[_selectedIdx] : null;
  const show  = !!entry && entry.model !== null;
  wrap.style.display = show ? 'block' : 'none';
  if (!show) return;
  const box = document.getElementById('pe-nofade');
  if (box) box.checked = !!entry.noFade;
  const cbox = document.getElementById('pe-collision');
  if (cbox) cbox.checked = !!entry.collision;
  const fbox = document.getElementById('pe-flatten');
  if (fbox) fbox.checked = !!entry.flatten;
}

// Flip the selected prop's collision flag. Unlike noFade this isn't live — the collision nav-grid is
// baked at zone load — so it persists on SAVE and applies after a reload.
function _setSelectedCollision(on) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  if (!entry || entry.model === null) return;
  _snapshot();
  if (on) entry.collision = true; else delete entry.collision;
  _setSaveStatus(`Collision ${on ? 'ON' : 'OFF'} — Save, then reload the zone to apply`, '');
}

// Flip the selected prop's flatten flag — flattens the terrain under its footprint. Applied at zone
// load (terrain rebuild), so it persists on SAVE and takes effect after a reload.
function _setSelectedFlatten(on) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  if (!entry || entry.model === null) return;
  _snapshot();
  if (on) entry.flatten = true; else delete entry.flatten;
  _setSaveStatus(`Flatten terrain ${on ? 'ON' : 'OFF'} — Save, then reload the zone to apply`, '');
}

// Flip the selected prop's noFade and push it straight to the live mesh so the change
// is visible immediately (no reload). Persists on the next SAVE via the serializers.
function _setSelectedNoFade(on) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  if (!entry || entry.model === null) return;
  _snapshot();
  entry.noFade = on;
  if (on) {
    entry.mesh.userData.noFade = true;
    // Undo any cut currently applied so a prop faded mid-toggle snaps back to fully opaque.
    entry.mesh.traverse(o => {
      const mats = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) if (m?.userData?._cutY) m.userData._cutY.value = 1e6;
    });
  } else {
    delete entry.mesh.userData.noFade;
  }
  markEnvVisibilityDirty();  // noFade is read at rebuild time — force one so the toggle takes effect now
}

// ── Selection ring ────────────────────────────────────────────────────────────

const _selRingGeo = new THREE.RingGeometry(0.9, 1.15, 32);
const _selRingMat = new THREE.MeshBasicMaterial({
  color: 0xffee44, transparent: true, opacity: 0.75,
  side: THREE.DoubleSide, depthWrite: false,
});
const _selRing = new THREE.Mesh(_selRingGeo, _selRingMat);
_selRing.rotation.x = -Math.PI / 2;
_selRing.visible = false;
scene.add(_selRing);

function _showSelRing(mesh) {
  _selRing.position.set(mesh.position.x, mesh.position.y + 0.12, mesh.position.z);
  _selRing.visible = true;
}

// ── Raycasting ────────────────────────────────────────────────────────────────

const _rc   = new THREE.Raycaster();
const _ndc  = new THREE.Vector2();

function _screenToWorld(clientX, clientY) {
  _ndc.x =  (clientX / window.innerWidth)  * 2 - 1;
  _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

function _hitProp(clientX, clientY) {
  _ndc.x =  (clientX / window.innerWidth)  * 2 - 1;
  _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  _rc.setFromCamera(_ndc, camera);

  // 1. Check editor-placed props first
  const editorMeshes = _placedProps.map(p => p.mesh);
  const editorHits = _rc.intersectObjects(editorMeshes, true);
  if (editorHits.length) {
    const hitObj = editorHits[0].object;
    return _placedProps.findIndex(p => {
      let o = hitObj; while (o) { if (o === p.mesh) return true; o = o.parent; } return false;
    });
  }

  // 2. Check biome props not yet adopted into the editor
  const alreadyAdopted = new Set(_placedProps.map(p => p.mesh));
  const biomeMeshes = activeProps.filter(m => !alreadyAdopted.has(m));
  const biomeHits = _rc.intersectObjects(biomeMeshes, true);
  if (biomeHits.length) {
    const hitObj = biomeHits[0].object;
    const mesh = biomeMeshes.find(m => {
      let o = hitObj; while (o) { if (o === m) return true; o = o.parent; } return false;
    });
    if (mesh) {
      // Adopt into _placedProps so it can be moved/deleted like any placed prop.
      // Recover identity + metadata from userData so re-saving doesn't silently strip
      // it: a plain adopt sets model:null (dropped on export), and waystones carry their
      // id/mapTab only in userData — flattening would lose the map link. `propModel` /
      // `propParams` are recovered too for any builder that stamps them at instantiation.
      const ud = mesh.userData ?? {};
      const entry = {
        mesh,
        model: ud.isWaystone ? 'waystone' : (ud.propModel ?? null),
        x:      mesh.position.x,
        z:      mesh.position.z,
        yOff:   0,
        rotY:   mesh.rotation.y,
        scaleF: mesh.scale.x || 1,
      };
      if (ud.waystoneId != null) entry.waystoneId = ud.waystoneId;
      if (ud.mapTab     != null) entry.mapTab     = ud.mapTab;
      if (ud.propParams)         entry.params     = { ...ud.propParams };
      _placedProps.push(entry);
      return _placedProps.length - 1;
    }
  }

  return -1;
}

// ── Place a prop ──────────────────────────────────────────────────────────────

async function _placeAtPoint(pt) {
  const modelKey = _selectedModel;
  const def = PROP_MODELS[modelKey];
  if (!def) return;

  let mesh;
  if (def.builderFn) {
    mesh = def.builderFn();
  } else {
    let original;
    try { original = await _loadGLB(modelKey); }
    catch (e) { console.error('[propEditor] GLB load failed:', e); return; }
    mesh = original.clone();
  }
  if (def.attach) def.attach(mesh);   // per-model effect (e.g. campfire sparks)

  _snapshot();
  const s = def.defaultScale;
  const entry = { mesh, model: modelKey, x: pt.x, z: pt.z, yOff: def.defaultYOff ?? 0, rotY: 0, rotX: def.defaultRotX ?? 0, scaleF: s };
  _applyTransform(entry);  // sets position/rotation/scale
  if (_propsHidden) mesh.visible = false;
  scene.add(mesh);

  // Register for collision/LOS tracking without overriding the position set above.
  activeProps.push(mesh);
  entry.collision = true;   // collision ON by default for newly placed props (uncheck in the panel to opt out)
  const isCollider = entry.collision && isSurfaceMovement();
  if (isCollider) {
    registerCollisionMesh(mesh);   // walkable/blocking geometry; skips the 2D clash radius + prop LOS list
  } else {
    if (def.clashR > 0) propPositions.push({ x: pt.x, z: pt.z, blocksLOS: def.blocksLOS, clashRSq: def.clashR * def.clashR });
    if (def.blocksLOS) losBlockerMeshes.push(mesh);
  }
  if (modelKey === 'point_light') entry.params = { intensity: 6, range: 18 };
  if (modelKey === 'zonegate') {
    // Ask which zone this gate travels to. Stored in params.targetZone (persisted by the writer)
    // and mirrored onto the group's userData so the in-game click handler can read it.
    const tz = (typeof prompt === 'function' ? prompt('Zone Gate → target zone id (e.g. bleakmire_woods):', '') : '') || '';
    entry.params = { targetZone: tz.trim() };
    mesh.userData.targetZone = entry.params.targetZone || null;
  }
  _placedProps.push(entry);
  if (modelKey === 'exclamation_marker') trackExclamation(entry.mesh, entry.x, entry.z);
  _selectIdx(_placedProps.length - 1);
}

// ── Apply full transform to a prop mesh ───────────────────────────────────────
// savedY: if non-null, use it directly as the world Y (for zone-loaded props that
// already have a confirmed visual position saved in the zone file).

function _applyTransform(entry, savedY = null) {
  const terrainH = getGroundHeight(entry.x, entry.z);
  const isGLB = !!(entry.model && PROP_MODELS[entry.model]?.path);

  entry.mesh.rotation.x = entry.rotX ?? 0;
  entry.mesh.rotation.y = entry.rotY;
  entry.mesh.scale.setScalar(entry.scaleF);

  let finalY;
  if (savedY !== null) {
    // Use the saved world Y directly — bypasses all computation.
    finalY = savedY;
  } else if (isGLB) {
    // GLBs are normalized on load so their visual bottom sits at y=0 in root-local space.
    // Scale doesn't affect y=0 (0 × any_scale = 0), so just place the root at terrainH + yOff.
    finalY = terrainH + entry.yOff;
  } else {
    // Procedural (builderFn) models have their base at y=0; -0.20 gives a planted look.
    finalY = terrainH - 0.20 + entry.yOff;
  }

  entry.mesh.position.set(entry.x, finalY, entry.z);
  _selRing.position.set(entry.mesh.position.x, entry.mesh.position.y + 0.12, entry.mesh.position.z);
  if (PROP_MODELS[entry.model]?.conformTerrain) _conformRoadToTerrain(entry);
}

// ── Drape a conformTerrain prop's geometry over the terrain surface ────────────
// Two geometry layouts are supported:
//   XY-plane + Rx(-PI/2)  — straight PlaneGeometry: reads gx/gy, writes Z
//   XZ-plane, no rotation — curved road BufferGeometry: reads gx/gz, writes Y
// In both cases the stable pair (gx/gy or gx/gz) never changes between calls.

function _conformRoadToTerrain(entry) {
  let planeMesh = null;
  entry.mesh.traverse(o => { if (o.isMesh && !planeMesh) planeMesh = o; });
  if (!planeMesh) return;

  const geo    = planeMesh.geometry;
  const pos    = geo.attributes.position;
  const n      = pos.count;
  const s      = entry.scaleF;
  const cosY   = Math.cos(entry.rotY);
  const sinY   = Math.sin(entry.rotY);
  const px     = entry.x;
  const pz     = entry.z;
  const thCtr  = getTerrainHeight(px, pz);
  const offY   = planeMesh.position.y;   // 0.025

  // XZ-plane geometry (curved road): mesh.rotation.x ≈ 0
  // XY-plane geometry (straight road): mesh.rotation.x ≈ -PI/2
  const xzPlane = Math.abs(planeMesh.rotation.x) < 0.01;

  for (let i = 0; i < n; i++) {
    const gx = pos.getX(i);
    let wx, wz;
    if (xzPlane) {
      // Group-local: (gx, offY, gz)  →  world via Ry(rotY)
      const gz = pos.getZ(i);
      wx = px + s * (gx * cosY + gz * sinY);
      wz = pz + s * (-gx * sinY + gz * cosY);
      pos.setY(i, (getTerrainHeight(wx, wz) - thCtr + 0.20 + 0.04) / s - offY);
    } else {
      // Group-local: (gx, offY, -gy)  →  world via Ry(rotY)
      const gy = pos.getY(i);
      wx = px + s * (gx * cosY - gy * sinY);
      wz = pz - s * (gx * sinY + gy * cosY);
      pos.setZ(i, (getTerrainHeight(wx, wz) - thCtr + 0.20 + 0.04) / s - offY);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// ── Select ────────────────────────────────────────────────────────────────────

function _selectIdx(i) {
  _selectedIdx = i;
  if (i < 0 || i >= _placedProps.length) {
    _selRing.visible = false;
    _updateLightControls();
    _updateFadeControl();
    return;
  }
  _showSelRing(_placedProps[i].mesh);
  _updateStatus();
  _updateLightControls();
  _updateFadeControl();
}

// ── Remove selected ───────────────────────────────────────────────────────────

function _removeSelected() {
  if (_selectedIdx < 0) return;
  _snapshot();
  const entry = _placedProps[_selectedIdx];
  if (entry.model === 'exclamation_marker') untrackExclamation(entry.mesh);
  scene.remove(entry.mesh);

  // Remove from environment tracking arrays
  const ai = activeProps.indexOf(entry.mesh);
  if (ai >= 0) { activeProps.splice(ai, 1); propPositions.splice(ai, 1); }
  const li = losBlockerMeshes.indexOf(entry.mesh);
  if (li >= 0) losBlockerMeshes.splice(li, 1);

  _placedProps.splice(_selectedIdx, 1);
  _selectIdx(Math.min(_selectedIdx, _placedProps.length - 1));
  _updateStatus();
}


// ── Undo history ─────────────────────────────────────────────────────────────

const _history  = [];
const MAX_HISTORY = 50;

function _snapshot() {
  _history.push(_placedProps.map(p => ({ ...p })));
  if (_history.length > MAX_HISTORY) _history.shift();
}

function _undo() {
  if (!_history.length) return;
  const snap = _history.pop();
  const snapSet = new Set(snap.map(p => p.mesh));
  const currSet = new Set(_placedProps.map(p => p.mesh));

  // Remove meshes that were added after the snapshot
  for (const p of _placedProps) {
    if (!snapSet.has(p.mesh)) {
      scene.remove(p.mesh);
      const ai = activeProps.indexOf(p.mesh);
      if (ai >= 0) { activeProps.splice(ai, 1); propPositions.splice(ai, 1); }
      const li = losBlockerMeshes.indexOf(p.mesh);
      if (li >= 0) losBlockerMeshes.splice(li, 1);
    }
  }

  // Re-add meshes that were deleted after the snapshot
  for (const p of snap) {
    if (!currSet.has(p.mesh)) {
      scene.add(p.mesh);
      const def = p.model ? PROP_MODELS[p.model] : null;
      if (def) addProp(p.mesh, p.x, p.z, def.blocksLOS, def.clashR);
    }
  }

  // Restore all transforms to snapshot state
  _placedProps = snap;
  clearAllExclamations();
  for (const entry of _placedProps) {
    _applyTransform(entry);
    // Re-sync noFade onto the live mesh — a toggle is undoable, and environmentVisibility
    // reads userData at rebuild time, so the data and the mesh must not drift apart.
    if (entry.noFade) entry.mesh.userData.noFade = true;
    else              delete entry.mesh.userData.noFade;
    if (entry.model === 'exclamation_marker') trackExclamation(entry.mesh, entry.x, entry.z);
  }
  markEnvVisibilityDirty();

  _selectIdx(-1);
  _updateStatus();
}

// ── Nudge / rotate selected ───────────────────────────────────────────────────

const NUDGE      = 0.25;
const MICRO_NUDGE = 0.025;
const Y_STEP     = 0.125;
const ROT        = Math.PI / 24;   // 7.5°
const SCALE_STEP = 0.10;           // 10% per key press
const SCALE_MIN  = 0.05;
const SCALE_MAX  = 200.0;

function _nudge(dx, dz) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  entry.x += dx;
  entry.z += dz;
  _applyTransform(entry);
  const ai = activeProps.indexOf(entry.mesh);
  if (ai >= 0 && propPositions[ai]) { propPositions[ai].x = entry.x; propPositions[ai].z = entry.z; }
  _updateStatus();
}

function _moveY(dy) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  entry.yOff += dy;
  _applyTransform(entry);
  _updateStatus();
}

async function _duplicateSelected(dx, dz) {
  if (_selectedIdx < 0) return;
  const src = _placedProps[_selectedIdx];
  const def = PROP_MODELS[src.model];
  if (!def) return;

  let mesh;
  if (def.builderFn) {
    mesh = def.builderFn(src);
  } else {
    let original;
    try { original = await _loadGLB(src.model); }
    catch (e) { console.error('[propEditor] GLB load failed:', e); return; }
    mesh = original.clone();
  }
  if (def.attach) def.attach(mesh, src);   // per-model effect (e.g. campfire sparks)

  _snapshot();
  const entry = {
    mesh,
    model: src.model,
    x: src.x + dx * src.scaleF,
    z: src.z + dz * src.scaleF,
    yOff: src.yOff,
    rotY: src.rotY,
    rotX: src.rotX ?? 0,
    scaleF: src.scaleF,
  };
  if (src.params)            entry.params     = { ...src.params };
  if (src.waystoneId != null) entry.waystoneId = src.waystoneId;
  if (src.mapTab     != null) entry.mapTab     = src.mapTab;
  _applyTransform(entry);
  if (_propsHidden) mesh.visible = false;
  scene.add(mesh);

  activeProps.push(mesh);
  if (def.clashR > 0) propPositions.push({ x: entry.x, z: entry.z, blocksLOS: def.blocksLOS, clashRSq: def.clashR * def.clashR });
  if (def.blocksLOS) losBlockerMeshes.push(mesh);
  _placedProps.push(entry);
  _selectIdx(_placedProps.length - 1);
}

function _rotate(delta) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  entry.rotY += delta;
  _applyTransform(entry);
  _updateStatus();
}

function _rotateX(delta) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  entry.rotX = (entry.rotX ?? 0) + delta;
  _applyTransform(entry);
  _updateStatus();
}

function _rescale(factor) {
  if (_selectedIdx < 0) return;
  const entry = _placedProps[_selectedIdx];
  entry.scaleF = Math.min(SCALE_MAX, Math.max(SCALE_MIN, entry.scaleF * factor));
  _applyTransform(entry);
  _updateStatus();
}

// ── Export ────────────────────────────────────────────────────────────────────

// Copy a prop's non-transform metadata (waystoneId / mapTab) onto the object about
// to be serialized, preferring the entry but FALLING BACK TO THE MESH's userData.
//
// This is the fix for a bug that has now round-tripped into the repo three times:
// the waystone kept getting written out with its `waystoneId` and `mapTab` missing,
// silently killing its activation, teleport and map pin. Every previous fix patched
// one path that builds an entry (load, adopt, duplicate) and the bug came straight
// back through another, because the SAVE trusted the entry object — and the entry is
// the one thing in the chain that can lose the data (a stale entry from before an
// earlier strip, an HMR desync, a re-adopt). The mesh's userData cannot: the waystone
// builder stamps both fields at construction from the zone data, so it is the
// authoritative copy for as long as the mesh exists. Read from there and no entry
// path can drop them again.
function _carryMetadata(entry, obj) {
  const ud  = entry.mesh?.userData ?? {};
  const wid = entry.waystoneId ?? ud.waystoneId;
  const tab = entry.mapTab     ?? ud.mapTab;
  if (wid != null) obj.waystoneId = wid;
  if (tab != null) obj.mapTab     = tab;
  if (entry.collision) obj.collision = true;   // whole-model collision flag (surface bake)
  if (entry.flatten)   obj.flatten   = true;   // flatten terrain under this footprint
}

async function _saveToZone() {
  if (!_activeZoneId) {
    _setSaveStatus('No active zone loaded', 'error');
    return;
  }
  const props = _placedProps
    .filter(p => p.model !== null)
    .map(p => {
      const obj = {
        model: p.model,
        x: +p.x.toFixed(2),
        z: +p.z.toFixed(2),
        y: +p.mesh.position.y.toFixed(4),
        rotY: +p.rotY.toFixed(3),
        scale: +p.scaleF.toFixed(3),
      };
      if (p.yOff !== 0)        obj.yOff       = +p.yOff.toFixed(3);
      if (p.rotX)              obj.rotX       = +p.rotX.toFixed(4);
      if (p.params)            obj.params     = { ...p.params };
      if (p.noFade)            obj.noFade     = true;
      _carryMetadata(p, obj);
      return obj;
    });

  // A waystone with no id is a dead waystone (no activation, no teleport, no map
  // pin). If one is about to be written out that way, refuse the save rather than
  // quietly corrupt the zone file — this bug has round-tripped into the repo twice.
  const orphan = props.find(o => o.model === 'waystone' && o.waystoneId == null);
  if (orphan) {
    console.error('[propEditor] Waystone at', orphan.x, orphan.z, 'has no waystoneId — save aborted.');
    _setSaveStatus('Waystone is missing its id — save aborted', 'error');
    return;
  }

  _setSaveStatus('Saving…', '');
  try {
    const r    = await fetch('/__save_zone_props', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ zoneId: _activeZoneId, props, biome: activeEnv }),
    });
    const data = await r.json();
    if (data.ok) {
      _setSaveStatus(`Saved to zone_${_activeZoneId}.js ✓`, 'ok');
      setTimeout(() => _setSaveStatus('', ''), 3000);
    } else {
      _setSaveStatus(`Error: ${data.error}`, 'error');
    }
  } catch (e) {
    _setSaveStatus(`Save failed: ${e.message}`, 'error');
  }
}

function _setSaveStatus(msg, cls) {
  const el = document.getElementById('pe-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `pe-save-status-${cls}` : '';
}

function _exportJSON() {
  const arr = _placedProps
    .filter(p => p.model !== null)   // skip adopted biome props — no model key to reconstruct them
    .map(p => {
      const obj = {
        model: p.model,
        x:     +p.x.toFixed(2),
        z:     +p.z.toFixed(2),
        rotY:  +p.rotY.toFixed(3),
        scale: +p.scaleF.toFixed(3),
      };
      if (p.yOff !== 0)        obj.yOff       = +p.yOff.toFixed(3);
      if (p.rotX)              obj.rotX       = +p.rotX.toFixed(4);
      if (p.params)            obj.params     = { ...p.params };
      if (p.noFade)            obj.noFade     = true;
      _carryMetadata(p, obj);
      return obj;
    });
  return JSON.stringify(arr, null, 2);
}

// ── Clear all placed props ────────────────────────────────────────────────────

export function prewarmGLBs(modelKeys) {
  for (const k of modelKeys) {
    if (PROP_MODELS[k]?.path && !_glbCache[k]) _loadGLB(k);
  }
}

export function getPlacedProps() { return _placedProps; }

export function clearEditorProps() {
  clearAllExclamations();
  _flattenPads = [];   // zone-load boundary — drop any flatten footprints from the previous zone

  const removed = new Set(_placedProps.map(p => p.mesh));
  _placedProps.forEach(p => scene.remove(p.mesh));
  // Also drop these meshes from the shared prop arrays, so re-syncing (e.g. the dev
  // zone-file HMR reload, which skips the biome rebuild that would otherwise clear
  // them) doesn't leave stale scene-removed props behind as phantom LOS/collision.
  // Safe in every caller — each is a zone-load/reset boundary, not editor open/close.
  if (removed.size) {
    for (let i = activeProps.length - 1;      i >= 0; i--) if (removed.has(activeProps[i]))      activeProps.splice(i, 1);
    for (let i = losBlockerMeshes.length - 1; i >= 0; i--) if (removed.has(losBlockerMeshes[i])) losBlockerMeshes.splice(i, 1);
  }
  _placedProps = [];
  _selectedIdx = -1;
  _selRing.visible = false;
}

// ── Load props from zone data ─────────────────────────────────────────────────

// Terrain-flatten pads collected from `flatten:true` props during the most recent loadZoneProps.
// zoneLoader reads these after the async load resolves, then setTerrainFlatten + rebuilds the terrain.
let _flattenPads = [];
export function collectFlattenPads() { return _flattenPads; }

export async function loadZoneProps(propsArray) {
  clearEditorProps();
  clearCollisionMeshes();   // reset collider registrations so a re-run (HMR/editor) doesn't double-add
  _flattenPads = [];        // reset flatten footprints so a re-run doesn't accumulate

  // Load all unique GLBs in parallel so network fetches overlap
  const glbKeys = [...new Set(
    propsArray.map(p => p.model).filter(m => PROP_MODELS[m]?.path)
  )];
  await Promise.all(
    glbKeys.map(k => _loadGLB(k).catch(e => console.error('[propEditor] GLB load failed:', k, e)))
  );

  // Cache is now warm — instantiate all props synchronously in one JS tick.
  // This also means environmentVisibility._rebuild() fires once instead of once per prop.
  for (const p of propsArray) {
    const def = PROP_MODELS[p.model];
    if (!def) continue;
    if (p.model === 'waystone' && p.waystoneId == null) {
      console.warn(`[propEditor] Waystone at (${p.x}, ${p.z}) is missing waystoneId — it will not activate or show on the map.`);
    }

    let mesh;
    if (def.builderFn) {
      mesh = def.builderFn(p);
    } else {
      const original = _glbCache[p.model];
      if (!original) continue;
      mesh = original.clone();
    }

    // Optional per-model effect attach (e.g. campfire sparks): add children to the built mesh and
    // chain any cleanup into mesh.userData.destroy so clearProps tears it down on zone change.
    if (def.attach) def.attach(mesh, p);

    // environmentVisibility fades the top off any prop that occludes a hero. `noFade` opts a prop
    // out so it stays fully opaque. Per-placement (p.noFade, the editor checkbox) wins; a registry
    // def.noFade is only a fallback default. Default (both undefined) is to fade.
    const noFade = p.noFade ?? def.noFade ?? false;
    if (noFade) mesh.userData.noFade = true;

    // Collision model (per-placement, whole-model): the imported mesh becomes walkable/blocking
    // geometry that the surface bake raycasts for floors + walls + LOS. It must OPT OUT of the 2D
    // clash radius (which would wall off its own interior) and of the prop LOS list (the surface
    // system's raycast covers it instead).
    const isCollider = (p.collision ?? def.collision ?? false) && isSurfaceMovement();

    const entry = {
      mesh,
      model:  p.model,
      x:      p.x,
      z:      p.z,
      yOff:   p.yOff  ?? 0,
      rotY:   p.rotY  ?? 0,
      rotX:   p.rotX  ?? def.defaultRotX ?? 0,
      scaleF: p.scale ?? def.defaultScale,
      noFade,
    };
    if (p.collision)    entry.collision  = true;   // preserve for editor round-trip / re-save
    if (p.flatten)      entry.flatten    = true;
    if (p.params)       { entry.params    = { ...p.params }; _applyLightParams(entry); }
    if (p.waystoneId != null) entry.waystoneId = p.waystoneId;
    if (p.mapTab     != null) entry.mapTab     = p.mapTab;
    _applyTransform(entry, def.path ? (p.y ?? null) : null);
    if (_propsHidden) mesh.visible = false;
    scene.add(mesh);
    activeProps.push(mesh);
    if (isCollider) {
      registerCollisionMesh(mesh);
    } else {
      if (def.clashR > 0) propPositions.push({ x: p.x, z: p.z, blocksLOS: def.blocksLOS, clashRSq: def.clashR * def.clashR });
      if (def.blocksLOS) losBlockerMeshes.push(mesh);
    }
    // Terrain-flatten pad from this prop's world footprint (target height = the mesh's bottom, so the
    // terrain rises/falls to meet the building's base). zoneLoader applies these + rebuilds after load.
    if (p.flatten) {
      mesh.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(mesh);
      if (!b.isEmpty()) _flattenPads.push({
        x: (b.min.x + b.max.x) / 2, z: (b.min.z + b.max.z) / 2,
        w: b.max.x - b.min.x, d: b.max.z - b.min.z, h: b.min.y,
      });
    }
    _placedProps.push(entry);
    if (p.model === 'exclamation_marker') trackExclamation(entry.mesh, p.x, p.z);
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────

function _updateModelButtons() {
  document.querySelectorAll('.pe-model-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.model === _selectedModel);
  });
  const label = document.getElementById('pe-selected-label');
  if (label) label.textContent = _selectedModel ? (PROP_MODELS[_selectedModel]?.label ?? _selectedModel) : 'None';
}

function _updateStatus() {
  const el = document.getElementById('pe-status');
  if (!el) return;
  if (_selectedIdx >= 0) {
    const e = _placedProps[_selectedIdx];
    const label = e.model ? (PROP_MODELS[e.model]?.label ?? e.model) : 'Biome Prop';
    const tag   = e.model ? '' : ' <span style="opacity:0.6;font-size:0.85em">(biome · not exported)</span>';
    el.innerHTML =
      `<b>${label}</b>${tag}<br>` +
      `Scale: ${e.scaleF.toFixed(2)} &nbsp;Y: ${e.yOff >= 0 ? '+' : ''}${e.yOff.toFixed(2)}<br>` +
      `←→↑↓ move &nbsp; [/] Y &nbsp; -/+ scale &nbsp; R rotY &nbsp; ,/. tilt &nbsp; Del`;
  } else {
    el.textContent = 'Click terrain to place · Click prop to select';
  }
}

// Prop picker categories (accordion sections). Keys are matched against
// PROP_MODELS; any registered prop not listed here lands in a trailing "Other"
// section, so adding a new prop never makes it vanish from the picker.
const PROP_CATEGORIES = [
  { label: 'Buildings',       keys: ['inn','inn2','hut1','hut2','marketstall1','marketarmory1','bigbuilding1','building2','building3','building4','building5','building6','building7','building8','building9','building10','building11','building12','building13','building14','building15','building16','buildingruinedlarge'] },
  { label: 'Structures',      keys: ['dungeonwall','dungeonwallsmall','dungeonwalllong','dungeonwallxlong','dungeonwallcurve','dungeonwallsmalltall','dungeonwalllongtall','dungeonwallxlongtall','dungeonwallcurvetall','dungeoncolumn','dungeoncolumntall','bridge','bridgelantern','cavemouth1','cavemouth2','cavemouth3','cavemouth4','stonesteps','widestonesteps','woodwall1','woodwall2','platform1'] },
  { label: 'Trees & Plants',  keys: ['deadtree','brokentree','evergreen','foresttree','mangrove','savannahtree','log','bush','dryshrub','fern','glowmushroom','plant1','plant2','plant3','plant4','mushroom1','mushroom2','mushroom3','mushroom4','mushroomtree'] },
  { label: 'Rocks',           keys: ['rock','snowrock','boulder','rockpile','stalactite','rubble'] },
  { label: 'Graves & Corpses',keys: ['mausoleum','tombstone','coffin','gravemound','cross','pileofbones','corpse1','corpsespike','deadhorse','skeleton1'] },
  { label: 'Objects',         keys: ['wagonhorses','saddlebag','alchemylab','fancychair','woodchair','barstand','barstand2','bench1','barloaded','barrel1','barrel2','shackles','spiderweb','poop'] },
  { label: 'Terrain Surfaces',keys: ['flooring1','flooring2','rug1','road','roadcurve30','water','bloodpool'] },
  { label: 'Effects & Markers',keys:['fogpatch','fogball','zonegate','campfire','campfire2','darknessplane','waystone','exclamation_marker','point_light','point_light_bright','arrow'] },
];

function _buildPanel() {
  const listEl = document.getElementById('pe-model-list');
  if (!listEl) return;

  const used = new Set();
  const mkBtn = (key) => {
    const def = PROP_MODELS[key];
    if (!def) return '';
    used.add(key);
    const coll = def.clashR > 0 ? ' pe-collision' : '';
    const act  = key === _selectedModel ? ' active' : '';
    return `<button class="pe-model-btn${coll}${act}" data-model="${key}">${def.label}</button>`;
  };
  const mkSection = (label, keys) => {
    const present = keys.filter(k => PROP_MODELS[k]);
    if (!present.length) return '';
    const btns = present.map(mkBtn).join('');
    return `<div class="pe-cat">` +
      `<button class="pe-cat-header" type="button"><span class="pe-caret">▸</span>` +
      `<span class="pe-cat-label">${label}</span><span class="pe-cat-count">${present.length}</span></button>` +
      `<div class="pe-cat-body collapsed">${btns}</div></div>`;
  };

  let html = PROP_CATEGORIES.map(c => mkSection(c.label, c.keys)).join('');
  const others = Object.keys(PROP_MODELS).filter(k => !used.has(k));
  if (others.length) html += mkSection('Other', others);
  listEl.innerHTML = html;

  // Delegated click: accordion headers toggle their section; model buttons select.
  listEl.onclick = (e) => {
    const header = e.target.closest('.pe-cat-header');
    if (header) {
      const body = header.nextElementSibling;
      const collapsed = body.classList.toggle('collapsed');
      const caret = header.querySelector('.pe-caret');
      if (caret) caret.textContent = collapsed ? '▸' : '▾';
      return;
    }
    const btn = e.target.closest('.pe-model-btn');
    if (!btn) return;
    // Clicking the active model deselects it — gives an empty cursor for picking existing props
    _selectedModel = btn.dataset.model === _selectedModel ? null : btn.dataset.model;
    _selectedIdx   = -1;
    _selRing.visible = false;
    _updateModelButtons();
    _updateStatus();
  };
}

function _applySearch(q) {
  const lq = q.trim().toLowerCase();
  const searching = lq.length > 0;
  document.querySelectorAll('.pe-cat').forEach(cat => {
    const body   = cat.querySelector('.pe-cat-body');
    const caret  = cat.querySelector('.pe-caret');
    let anyVisible = false;
    cat.querySelectorAll('.pe-model-btn').forEach(btn => {
      const match = !searching || btn.textContent.toLowerCase().includes(lq);
      btn.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    if (searching) {
      // Auto-expand sections with a hit; hide sections with none.
      body.classList.remove('collapsed');
      if (caret) caret.textContent = '▾';
      cat.style.display = anyVisible ? '' : 'none';
    } else {
      // Reset to the collapsed default with everything shown.
      cat.style.display = '';
      body.classList.add('collapsed');
      if (caret) caret.textContent = '▸';
      cat.querySelectorAll('.pe-model-btn').forEach(btn => { btn.style.display = ''; });
    }
  });
}

function _openExportModal() {
  const overlay = document.getElementById('pe-export-overlay');
  const text    = document.getElementById('pe-export-text');
  if (!overlay || !text) return;
  text.value = _exportJSON();
  overlay.style.display = 'flex';
  text.select();
}

function _togglePropsHidden() {
  _propsHidden = !_propsHidden;
  let count = 0;
  activeProps.forEach(m => {
    m.userData.editorHidden = _propsHidden;
    m.visible = !_propsHidden;
    m.traverse(child => { child.visible = !_propsHidden; });
    count++;
  });
  const btn = document.getElementById('pe-hide-props-btn');
  if (btn) btn.classList.toggle('spell-active', _propsHidden);
  _selRing.visible = _propsHidden ? false : _selectedIdx >= 0;
}

export function initPropEditor() {
  _buildPanel();
  _updateStatus();

  // Track which zone is active (avoid importing zoneLoader to prevent circular dep)
  window.addEventListener('zone:loaded', e => { _activeZoneId = e.detail?.id ?? null; });

  // Search
  document.getElementById('pe-search')?.addEventListener('input', e => _applySearch(e.target.value));

  // Toggle panel visibility
  document.getElementById('prop-editor-btn')?.addEventListener('click', () => {
    _open = !_open;
    const panel = document.getElementById('prop-editor-panel');
    if (panel) panel.style.display = _open ? 'block' : 'none';
    document.getElementById('prop-editor-btn').classList.toggle('active', _open);
  });

  // Canvas click: check prop hit first, else place
  renderer.domElement.addEventListener('click', e => {
    // Never intercept in play mode
    if (document.getElementById('app')?.classList.contains('play-mode')) return;
    // When props are hidden, let all clicks pass through to unit/army handlers
    if (_propsHidden) return;

    // When a stamp model is selected, always place — don't let large flat props
    // (e.g. a scaled-up blood pool covering the whole map) intercept the click.
    if (_selectedModel) {
      if (!_open) return;
      e.stopImmediatePropagation();
      const pt = _screenToWorld(e.clientX, e.clientY);
      if (pt) _placeAtPoint(pt);
      return;
    }

    const propIdx = _hitProp(e.clientX, e.clientY);
    if (propIdx >= 0) {
      if (!_open) return;  // ignore prop clicks when panel is closed
      e.stopImmediatePropagation();
      _selectIdx(propIdx);
      return;
    }

    // Only place a new prop if the editor panel is deliberately open
    if (!_open) return;
    e.stopImmediatePropagation();
    const pt = _screenToWorld(e.clientX, e.clientY);
    if (pt) _placeAtPoint(pt);
  }, true);  // capture phase — runs before army.js bubble listener

  // Keyboard: nudge, rotate, delete, undo
  window.addEventListener('keydown', e => {
    if (!_open) return;
    // Bare single-key shortcuts on the window — Backspace deletes the selected prop, r
    // rotates, -/= rescale. Skip them while a field has focus, or typing into the
    // waystoneId / mapTab inputs edits the prop instead of the text. See the matching
    // guard in npcEditor.js, where this deleted a unit outright.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); _undo(); return; }
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); if (e.shiftKey) { _duplicateSelected(-1, 0); } else { if (!e.repeat) _snapshot(); _nudge(-(e.ctrlKey ? MICRO_NUDGE : NUDGE), 0); }  break;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) { _duplicateSelected( 1, 0); } else { if (!e.repeat) _snapshot(); _nudge( (e.ctrlKey ? MICRO_NUDGE : NUDGE), 0); }  break;
      case 'ArrowUp':    e.preventDefault(); if (e.shiftKey) { _duplicateSelected( 0,-1); } else { if (!e.repeat) _snapshot(); _nudge(0, -(e.ctrlKey ? MICRO_NUDGE : NUDGE)); }  break;
      case 'ArrowDown':  e.preventDefault(); if (e.shiftKey) { _duplicateSelected( 0, 1); } else { if (!e.repeat) _snapshot(); _nudge(0,  (e.ctrlKey ? MICRO_NUDGE : NUDGE)); }  break;
      case 'r': case 'R':              if (!e.repeat) _snapshot(); _rotate(ROT);                      break;
      case ',': case '<':             e.preventDefault(); if (!e.repeat) _snapshot(); _rotateX(-ROT); break;
      case '.': case '>':             e.preventDefault(); if (!e.repeat) _snapshot(); _rotateX( ROT); break;
      case '[':                        e.preventDefault(); if (!e.repeat) _snapshot(); _moveY(-Y_STEP); break;
      case ']':                        e.preventDefault(); if (!e.repeat) _snapshot(); _moveY( Y_STEP); break;
      case '-': case '_':              if (!e.repeat) _snapshot(); _rescale(1 / (1 + SCALE_STEP));    break;
      case '=': case '+':              if (!e.repeat) _snapshot(); _rescale(1 + SCALE_STEP);          break;
      case 'Delete': case 'Backspace': _removeSelected();                  break;
      case 'Escape':                   _selectIdx(-1);                     break;
    }
  });

  // Hide/show all props toggle
  document.getElementById('pe-hide-props-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    _togglePropsHidden();
  });

  // Collapse toggle
  document.getElementById('pe-collapse-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const body = document.getElementById('pe-body');
    if (!body) return;
    const collapsed = body.classList.toggle('collapsed');
    e.currentTarget.textContent = collapsed ? '▲' : '▼';
  });

  // Save / Export buttons
  document.getElementById('pe-save-btn')?.addEventListener('click', _saveToZone);
  document.getElementById('pe-export-btn')?.addEventListener('click', _openExportModal);

  // "Never fade" toggle — only visible when a model-backed prop is selected
  document.getElementById('pe-nofade')?.addEventListener('change', e => {
    _setSelectedNoFade(e.target.checked);
  });

  // "Collision" toggle — marks the whole model as walkable/blocking geometry (surface bake)
  document.getElementById('pe-collision')?.addEventListener('change', e => {
    _setSelectedCollision(e.target.checked);
  });

  // "Flatten terrain" toggle — flattens the ground under the model's footprint
  document.getElementById('pe-flatten')?.addEventListener('change', e => {
    _setSelectedFlatten(e.target.checked);
  });

  // Light controls — only visible when a point_light is selected
  document.getElementById('pe-light-intensity')?.addEventListener('input', e => {
    const entry = _selectedIdx >= 0 ? _placedProps[_selectedIdx] : null;
    if (!entry?.params) return;
    entry.params.intensity = parseFloat(e.target.value);
    document.getElementById('pe-light-intensity-val').textContent = entry.params.intensity;
    _applyLightParams(entry);
  });
  document.getElementById('pe-light-range')?.addEventListener('input', e => {
    const entry = _selectedIdx >= 0 ? _placedProps[_selectedIdx] : null;
    if (!entry?.params) return;
    entry.params.range = parseFloat(e.target.value);
    document.getElementById('pe-light-range-val').textContent = entry.params.range;
    _applyLightParams(entry);
  });

  // Export overlay close
  document.getElementById('pe-export-close')?.addEventListener('click', () => {
    const overlay = document.getElementById('pe-export-overlay');
    if (overlay) overlay.style.display = 'none';
  });

  // Copy button
  document.getElementById('pe-export-copy')?.addEventListener('click', () => {
    const text = document.getElementById('pe-export-text');
    if (!text) return;
    text.select();
    navigator.clipboard?.writeText(text.value).catch(() => document.execCommand('copy'));
  });

  // Click outside export overlay to close
  document.getElementById('pe-export-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
}
