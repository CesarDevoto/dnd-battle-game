import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera, renderer, ground } from './scene.js';
import { activeProps, propPositions, losBlockerMeshes, activeEnv } from './environments.js';
import { getTerrainHeight } from './terrain.js';
import { PROP_MODELS } from './propRegistry.js';
import { trackExclamation, untrackExclamation, clearAllExclamations } from './exclamationMarkers.js';


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
      // Adopt into _placedProps so it can be moved/deleted like any placed prop
      const entry = {
        mesh,
        model: null,
        x:      mesh.position.x,
        z:      mesh.position.z,
        yOff:   0,
        rotY:   mesh.rotation.y,
        scaleF: mesh.scale.x || 1,
      };
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

  _snapshot();
  const s = def.defaultScale;
  const entry = { mesh, model: modelKey, x: pt.x, z: pt.z, yOff: def.defaultYOff ?? 0, rotY: 0, rotX: def.defaultRotX ?? 0, scaleF: s };
  _applyTransform(entry);  // sets position/rotation/scale
  if (_propsHidden) mesh.visible = false;
  scene.add(mesh);

  // Register for collision/LOS tracking without overriding the position set above
  activeProps.push(mesh);
  if (def.clashR > 0) propPositions.push({ x: pt.x, z: pt.z, blocksLOS: def.blocksLOS, clashRSq: def.clashR * def.clashR });
  if (def.blocksLOS) losBlockerMeshes.push(mesh);
  if (modelKey === 'point_light') entry.params = { intensity: 6, range: 18 };
  _placedProps.push(entry);
  if (modelKey === 'exclamation_marker') trackExclamation(entry.mesh, entry.x, entry.z);
  _selectIdx(_placedProps.length - 1);
}

// ── Apply full transform to a prop mesh ───────────────────────────────────────
// savedY: if non-null, use it directly as the world Y (for zone-loaded props that
// already have a confirmed visual position saved in the zone file).

function _applyTransform(entry, savedY = null) {
  const terrainH = getTerrainHeight(entry.x, entry.z);
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
    return;
  }
  _showSelRing(_placedProps[i].mesh);
  _updateStatus();
  _updateLightControls();
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
    if (entry.model === 'exclamation_marker') trackExclamation(entry.mesh, entry.x, entry.z);
  }

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
      if (p.waystoneId != null) obj.waystoneId = p.waystoneId;
      if (p.mapTab     != null) obj.mapTab     = p.mapTab;
      return obj;
    });
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
      if (p.waystoneId != null) obj.waystoneId = p.waystoneId;
      if (p.mapTab     != null) obj.mapTab     = p.mapTab;
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

  _placedProps.forEach(p => scene.remove(p.mesh));
  _placedProps = [];
  _selectedIdx = -1;
  _selRing.visible = false;
}

// ── Load props from zone data ─────────────────────────────────────────────────

export async function loadZoneProps(propsArray) {
  clearEditorProps();

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

    let mesh;
    if (def.builderFn) {
      mesh = def.builderFn(p);
    } else {
      const original = _glbCache[p.model];
      if (!original) continue;
      mesh = original.clone();
    }

    const entry = {
      mesh,
      model:  p.model,
      x:      p.x,
      z:      p.z,
      yOff:   p.yOff  ?? 0,
      rotY:   p.rotY  ?? 0,
      rotX:   p.rotX  ?? def.defaultRotX ?? 0,
      scaleF: p.scale ?? def.defaultScale,
    };
    if (p.params)       { entry.params    = { ...p.params }; _applyLightParams(entry); }
    if (p.waystoneId != null) entry.waystoneId = p.waystoneId;
    if (p.mapTab     != null) entry.mapTab     = p.mapTab;
    _applyTransform(entry, def.path ? (p.y ?? null) : null);
    if (_propsHidden) mesh.visible = false;
    scene.add(mesh);
    activeProps.push(mesh);
    if (def.clashR > 0) propPositions.push({ x: p.x, z: p.z, blocksLOS: def.blocksLOS, clashRSq: def.clashR * def.clashR });
    if (def.blocksLOS) losBlockerMeshes.push(mesh);
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

function _buildPanel() {
  const listEl = document.getElementById('pe-model-list');
  if (!listEl) return;
  const all = Object.entries(PROP_MODELS);
  const collision   = all.filter(([, d]) => d.clashR > 0);
  const passable    = all.filter(([, d]) => !(d.clashR > 0));
  const mkBtn = ([key, def]) =>
    `<button class="pe-model-btn${key === _selectedModel ? ' active' : ''}" data-model="${key}">${def.label}</button>`;
  listEl.innerHTML =
    `<div class="pe-section-header">Collision</div>` +
    collision.map(mkBtn).join('') +
    `<div class="pe-section-header pe-section-header--passable">No Collision</div>` +
    passable.map(mkBtn).join('');
  listEl.addEventListener('click', e => {
    const btn = e.target.closest('.pe-model-btn');
    if (!btn) return;
    // Clicking the active model deselects it — gives an empty cursor for picking existing props
    _selectedModel = btn.dataset.model === _selectedModel ? null : btn.dataset.model;
    _selectedIdx   = -1;
    _selRing.visible = false;
    _updateModelButtons();
    _updateStatus();
  });
}

function _applySearch(q) {
  const lq = q.toLowerCase();
  document.querySelectorAll('.pe-model-btn').forEach(btn => {
    btn.style.display = btn.textContent.toLowerCase().includes(lq) ? '' : 'none';
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
