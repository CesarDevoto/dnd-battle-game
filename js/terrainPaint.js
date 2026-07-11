import * as THREE from 'three';
import { renderer, camera, ground, ceiling, controls } from './scene.js';
import { makeRoadTexture } from './propBuilders.js';
import { IS_DEV } from './devConfig.js';
import { sharedPaintUniforms, floorPaintUniforms, roofPaintUniforms, applyPaintShader } from './terrainPaintShader.js';

// ── Terrain paint (splatmap) ──────────────────────────────────────────────────
// Spray-paint biome surfaces onto the terrain. Each channel is a paint material
// blended over the base biome texture in a material's fragment shader (patched
// via onBeforeCompile — see terrainPaintShader.js):
//   R = road  (tiled stone-road texture, matches the road props)
//   G = dirt  (tiled worn-earth texture)
//   B = tint  (multiplies the base surface toward uTintColor — grass/sand/snow)
// "Erase" scales all three channels back toward 0.
//
// TWO INDEPENDENT LAYERS, each a 1024² RGBA mask in UV space (survives geometry
// rebuilds): the ground FLOOR (visible on open ground / tunnel floors) and the
// cave-roof BLANKET (the intact hilltop over a cave). They paint separately so a
// road on the hilltop needn't appear on the tunnel floor below it, and vice-versa.
// Non-cave zones only ever show the floor.
//
// Paint is stored as vector STROKES ({x,z,r,ch}) on the zone — git-friendly,
// editable, resolution-independent (like barriers): `paint`/`paintTint` for the
// floor, `paintRoof`/`paintRoofTint` for the blanket.

const MASK_SIZE  = 1024;     // mask canvas resolution
const TILE_WU    = 6;        // road/dirt texture tiles once per this many world units

// ── Paint layers ───────────────────────────────────────────────────────────────
// Each layer owns its own mask canvas/texture, recorded strokes, and the shared
// uniform object its material reads (floor → ground, roof → cave blanket).
function _makeLayer(uniforms) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = MASK_SIZE;
  return {
    cv,
    ctx: cv.getContext('2d', { willReadFrequently: true }),
    tex: null,
    uniforms,
    strokes: [],
    lastRec: null,
  };
}
const _floor = _makeLayer(floorPaintUniforms);
const _roof  = _makeLayer(roofPaintUniforms);
let _targetKey = 'floor';                 // which layer the brush paints into
function _tgt() { return _targetKey === 'roof' ? _roof : _floor; }

function _initLayerTex(layer) {
  layer.tex = new THREE.CanvasTexture(layer.cv);
  layer.tex.colorSpace = THREE.NoColorSpace;      // mask is data, not color
  layer.uniforms.uPaintMask.value = layer.tex;    // real mask replaces the fallback
  _clearMask(layer);
}

function _clearMask(layer) {
  // Opaque black = no paint anywhere (alpha kept at 255 so CanvasTexture sampling
  // stays clean — the shader reads .rgb only).
  layer.ctx.globalCompositeOperation = 'source-over';
  layer.ctx.fillStyle = '#000000';
  layer.ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  if (layer.tex) layer.tex.needsUpdate = true;
}

// ── Shader patch ─────────────────────────────────────────────────────────────
// The paint shader + uniforms live in terrainPaintShader.js so the ground AND the
// cave-roof blanket (patched in caveReveal.js) can each read their own layer.
let _shader = null;    // captured ground shader ref (debug/introspection only)

function _patchMaterials() {
  // Install the real tiled road texture (from propBuilders). Done here — not in
  // terrainPaintShader — because that module can't import propBuilders without
  // pulling scene.js into its own init and crashing (see note there). This runs
  // at initTerrainPaint (main.js), well after scene is fully constructed.
  sharedPaintUniforms.uRoadTex.value = makeRoadTexture(1, 1);

  _initLayerTex(_floor);
  _initLayerTex(_roof);   // the ceiling material (caveReveal.js) reads _roof's mask

  const mat = ground.material;
  mat.onBeforeCompile = (shader) => {
    applyPaintShader(shader, floorPaintUniforms);
    _shader = shader;
  };
  mat.needsUpdate = true;   // force recompile now that onBeforeCompile is set
}

// ── World ↔ mask-canvas mapping ──────────────────────────────────────────────
// Ground is PlaneGeometry(gs,gs) rotated -90°, so geometry uv maps to world as
//   u = wx/gs + 0.5 ,  v = 0.5 - wz/gs
// CanvasTexture flipY=true → canvas pixel (px,py): px = u*S, py = (1-v)*S
//   → px = (wx/gs + 0.5)*S ,  py = (wz/gs + 0.5)*S
function _gs() { return ground.geometry.parameters?.width ?? 216; }

function _worldToPx(wx, wz) {
  const gs = _gs();
  return { px: (wx / gs + 0.5) * MASK_SIZE, py: (wz / gs + 0.5) * MASK_SIZE, gs };
}

// ── Rasterize one stroke into a layer's mask ─────────────────────────────────
function _stamp(layer, wx, wz, rWU, ch) {
  const { px, py, gs } = _worldToPx(wx, wz);
  const rPx = Math.max(1, (rWU / gs) * MASK_SIZE);

  const x0 = Math.max(0, Math.floor(px - rPx));
  const y0 = Math.max(0, Math.floor(py - rPx));
  const x1 = Math.min(MASK_SIZE, Math.ceil(px + rPx));
  const y1 = Math.min(MASK_SIZE, Math.ceil(py + rPx));
  const w  = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const img  = layer.ctx.getImageData(x0, y0, w, h);
  const data = img.data;
  const erase = ch === 'erase';
  const chOff = ch === 'road' ? 0 : ch === 'dirt' ? 1 : 2;   // tint→2
  const STRENGTH = 0.5;   // per-stamp intensity; drags build up

  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const dx = (x0 + xx) - px;
      const dy = (y0 + yy) - py;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d > rPx) continue;
      const t = 1 - d / rPx;
      const fall = t * t * (3 - 2 * t) * STRENGTH;   // smooth soft edge
      const i = (yy * w + xx) * 4;
      if (erase) {
        const f = 1 - fall;
        data[i]     *= f;
        data[i + 1] *= f;
        data[i + 2] *= f;
      } else {
        // build the painted channel toward 255…
        data[i + chOff] = Math.min(255, data[i + chOff] + fall * 255);
        // …and fade the other two so materials don't muddy (indexed feel)
        const other1 = chOff === 0 ? 1 : 0;
        const other2 = chOff === 2 ? 1 : 2;
        data[i + other1] *= (1 - fall * 0.7);
        data[i + other2] *= (1 - fall * 0.7);
      }
      data[i + 3] = 255;   // keep opaque
    }
  }
  layer.ctx.putImageData(img, x0, y0);
  if (layer.tex) layer.tex.needsUpdate = true;
}

// ── Public: load paint for a zone ────────────────────────────────────────────
// floorStrokes/floorTint → ground; roofStrokes/roofTint → cave blanket.
export function loadPaint(floorStrokes, floorTint, roofStrokes, roofTint) {
  sharedPaintUniforms.uSize.value        = _gs();
  sharedPaintUniforms.uPaintRepeat.value = sharedPaintUniforms.uSize.value / TILE_WU;
  _loadLayer(_floor, floorStrokes, floorTint);
  _loadLayer(_roof,  roofStrokes,  roofTint);
  _syncTintInput();
  _updateCounter();
}

function _loadLayer(layer, strokes, tintHex) {
  if (tintHex) layer.uniforms.uTintColor.value.set(tintHex);
  _clearMask(layer);
  layer.strokes = [];
  layer.lastRec = null;
  (strokes ?? []).forEach(s => {
    layer.strokes.push({ x: s.x, z: s.z, r: s.r, ch: s.ch });
    _stamp(layer, s.x, s.z, s.r, s.ch);
  });
}

// ── Brush / editor state ─────────────────────────────────────────────────────
let _paintMode  = false;
let _painting   = false;
let _channel    = 'road';
let _brush      = 4.0;         // radius in world units
let _activeZone = null;

export function isPaintModeActive() { return _paintMode; }

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

// The point to paint at. When painting the blanket, raycast the ceiling mesh so
// the stroke lands where the cursor meets the visible hilltop; otherwise (and as
// a fallback when there's no cave roof) raycast the ground.
function _paintPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  if (_targetKey === 'roof' && ceiling.visible) {
    const rh = _rc.intersectObject(ceiling);
    if (rh.length) return rh[0].point;
  }
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

function _paintAt(pt) {
  // Record + rasterize, but space out recorded strokes so a drag doesn't store
  // thousands of near-duplicate points.
  const layer = _tgt();
  const spacing = Math.max(0.4, _brush * 0.4);
  if (layer.lastRec) {
    const dx = pt.x - layer.lastRec.x, dz = pt.z - layer.lastRec.z;
    if (dx * dx + dz * dz < spacing * spacing) { _stamp(layer, pt.x, pt.z, _brush, _channel); return; }
  }
  const s = { x: +pt.x.toFixed(1), z: +pt.z.toFixed(1), r: +_brush.toFixed(1), ch: _channel };
  layer.strokes.push(s);
  layer.lastRec = pt;
  _stamp(layer, s.x, s.z, s.r, s.ch);
  _updateCounter();
}

// ── UI ───────────────────────────────────────────────────────────────────────
function _setChannel(ch) {
  _channel = ch;
  document.querySelectorAll('.tp-ch-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.ch === ch));
  _updateStatus();
}

function _setTarget(key) {
  _targetKey = key === 'roof' ? 'roof' : 'floor';
  document.querySelectorAll('.tp-layer-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.layer === _targetKey));
  _syncTintInput();
  _updateCounter();
  _updateStatus();
}

function _setPaintMode(on) {
  _paintMode = on;
  if (!on && _painting) { _painting = false; controls.enabled = true; }
  const btn = document.getElementById('tp-paint-btn');
  if (btn) { btn.textContent = on ? 'STOP PAINTING' : 'PAINT MODE'; btn.classList.toggle('active', on); }
  _updateStatus();
}

function _syncTintInput() {
  const el = document.getElementById('tp-tint');
  if (el) el.value = '#' + _tgt().uniforms.uTintColor.value.getHexString();
}

function _updateStatus() {
  const el = document.getElementById('tp-status');
  if (!el) return;
  const layerName = _targetKey === 'roof' ? 'blanket' : 'floor';
  el.textContent = _paintMode
    ? `Painting ${layerName} "${_channel}" · brush ${_brush.toFixed(1)} · drag on terrain`
    : `Target: ${layerName} · click PAINT MODE, then drag`;
}
function _updateCounter() {
  const el = document.getElementById('tp-counter');
  if (!el) return;
  const layerName = _targetKey === 'roof' ? 'Blanket' : 'Floor';
  el.textContent = `${layerName} strokes: ${_tgt().strokes.length}`;
}
function _setSave(msg, cls) {
  const el = document.getElementById('tp-save-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = cls ? `te-save-status-${cls}` : '';
}

async function _save() {
  if (!_activeZone) { _setSave('No zone loaded', 'error'); return; }
  _setSave('Saving…', '');
  try {
    const res = await fetch('/__save_zone_paint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneId:        _activeZone,
        paint:         _floor.strokes,
        paintTint:     '#' + _floor.uniforms.uTintColor.value.getHexString(),
        paintRoof:     _roof.strokes,
        paintRoofTint: '#' + _roof.uniforms.uTintColor.value.getHexString(),
      }),
    });
    const json = await res.json();
    if (json.ok) {
      const total = _floor.strokes.length + _roof.strokes.length;
      _setSave(`Saved ${total} stroke${total !== 1 ? 's' : ''} ✓`, 'ok');
      setTimeout(() => _setSave('', ''), 3000);
    } else {
      _setSave(`Error: ${json.error}`, 'error');
    }
  } catch (e) {
    _setSave(`Failed: ${e.message}`, 'error');
  }
}

function _clearPaint() {
  const layer = _tgt();
  layer.strokes = [];
  layer.lastRec = null;
  _clearMask(layer);
  _updateCounter();
  _updateStatus();
}

// ── Init ─────────────────────────────────────────────────────────────────────
export function initTerrainPaint() {
  _patchMaterials();

  window.addEventListener('zone:loaded', e => { _activeZone = e.detail?.id ?? null; _updateCounter(); });

  // Diagnostic (prod-safe): run window.__roadDebug() in the console on a painted
  // zone to report where the paint pipeline is (or isn't) working.
  window.__roadDebug = () => {
    const out = {
      shaderPatched:      !!_shader,
      onBeforeCompileSet: !!ground.material?.onBeforeCompile,
      uSize:              sharedPaintUniforms.uSize.value,
      uPaintRepeat:       sharedPaintUniforms.uPaintRepeat.value,
      floorStrokes:       _floor.strokes.length,
      roofStrokes:        _roof.strokes.length,
      activeZone:         _activeZone,
      groundType:         ground.geometry?.type,
      groundWidth:        ground.geometry?.parameters?.width ?? null,
      hasBaseMap:         !!ground.material?.map,
      floorRedPixels:     0,
    };
    try {
      const d = _floor.ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 20) n++;
      out.floorRedPixels = n;
    } catch (err) { out.maskErr = err.message; }
    console.log('[roadDebug]', out);
    return out;
  };

  // Turning the terrain editor off should also drop paint mode.
  document.getElementById('terrain-editor-btn')?.addEventListener('click', () => {
    if (_paintMode) _setPaintMode(false);
  });

  if (!IS_DEV) return;   // painting tool is dev-only; loadPaint still runs in prod

  document.getElementById('tp-paint-btn')?.addEventListener('click', () => _setPaintMode(!_paintMode));
  document.getElementById('tp-clear-btn')?.addEventListener('click', () => {
    const n = _tgt().strokes.length;
    const layerName = _targetKey === 'roof' ? 'blanket' : 'floor';
    if (n && !confirm(`Clear all ${n} ${layerName} paint stroke(s)?`)) return;
    _clearPaint();
  });
  document.getElementById('tp-save-btn')?.addEventListener('click', _save);

  document.querySelectorAll('.tp-layer-btn').forEach(b =>
    b.addEventListener('click', () => _setTarget(b.dataset.layer)));

  document.querySelectorAll('.tp-ch-btn').forEach(b =>
    b.addEventListener('click', () => _setChannel(b.dataset.ch)));

  const brushInput = document.getElementById('tp-brush');
  brushInput?.addEventListener('input', e => {
    _brush = Math.max(0.5, parseFloat(e.target.value) || 4);
    _updateStatus();
  });

  const tintInput = document.getElementById('tp-tint');
  tintInput?.addEventListener('input', e => {
    _tgt().uniforms.uTintColor.value.set(e.target.value);   // active layer's tint
  });
  document.querySelectorAll('.tp-tint-swatch').forEach(b =>
    b.addEventListener('click', () => {
      _tgt().uniforms.uTintColor.value.set(b.dataset.color);
      if (tintInput) tintInput.value = b.dataset.color;
    }));

  // ── Brush pointer handlers (capture phase — beat OrbitControls & hero clicks) ──
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!_paintMode || e.button !== 0) return;
    const pt = _paintPt(e.clientX, e.clientY);
    if (!pt) return;
    e.stopImmediatePropagation();
    controls.enabled = false;   // drag paints instead of orbiting the camera
    _painting = true;
    _tgt().lastRec = null;
    _paintAt(pt);
  }, true);

  renderer.domElement.addEventListener('pointermove', e => {
    if (!_painting) return;
    e.stopImmediatePropagation();
    const pt = _paintPt(e.clientX, e.clientY);
    if (pt) _paintAt(pt);
  }, true);

  const _endStroke = () => {
    if (!_painting) return;
    _painting = false;
    controls.enabled = true;
    _tgt().lastRec = null;
  };
  window.addEventListener('pointerup', _endStroke, true);

  _setTarget('floor');
  _updateStatus();
  _updateCounter();
}
