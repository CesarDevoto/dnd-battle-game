import * as THREE from 'three';
import { renderer, camera, ground, controls } from './scene.js';
import { makeRoadTexture } from './propBuilders.js';
import { IS_DEV } from './devConfig.js';

// ── Terrain paint (splatmap) ──────────────────────────────────────────────────
// Spray-paint biome surfaces onto the ground. A 1024² RGBA mask lives in UV
// space (so it survives every terrain geometry rebuild); each channel is a paint
// material blended over the base biome texture in the ground material's fragment
// shader (patched via onBeforeCompile):
//   R = road  (tiled stone-road texture, matches the road props)
//   G = dirt  (tiled worn-earth texture)
//   B = tint  (multiplies the base surface toward uTintColor — grass/sand/snow)
// "Erase" scales all three channels back toward 0.
//
// Paint is stored as vector STROKES ({x,z,r,ch}) on the zone, rasterized into the
// mask at load — git-friendly, editable, resolution-independent (like barriers).

const MASK_SIZE  = 1024;     // mask canvas resolution
const TILE_WU    = 6;        // road/dirt texture tiles once per this many world units
const CHANNELS   = ['road', 'dirt', 'tint'];   // → mask R,G,B; 'erase' is special

// ── Mask canvas ────────────────────────────────────────────────────────────────
const _maskCv  = document.createElement('canvas');
_maskCv.width  = _maskCv.height = MASK_SIZE;
const _maskCtx = _maskCv.getContext('2d', { willReadFrequently: true });
let   _maskTex = null;

function _clearMask() {
  // Opaque black = no paint anywhere (alpha kept at 255 so CanvasTexture sampling
  // stays clean — the shader reads .rgb only).
  _maskCtx.globalCompositeOperation = 'source-over';
  _maskCtx.fillStyle = '#000000';
  _maskCtx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  if (_maskTex) _maskTex.needsUpdate = true;
}

// ── Textures ───────────────────────────────────────────────────────────────────
function _makeDirtTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#6b4a26';
  ctx.fillRect(0, 0, S, S);
  [
    { colors: ['#5a3d1e','#4e3418','#634426'], count: 120, rMin: 8,  rMax: 44, aMin: 0.20, aMax: 0.40 },
    { colors: ['#7c5730','#8a6338','#6e4c28'], count: 140, rMin: 5,  rMax: 24, aMin: 0.15, aMax: 0.30 },
    { colors: ['#43301a','#3a2814'],           count: 70,  rMin: 2,  rMax: 10, aMin: 0.18, aMax: 0.34 },
  ].forEach(layer => {
    for (let i = 0; i < layer.count; i++) {
      const x = Math.random() * S, y = Math.random() * S;
      const r = layer.rMin + Math.random() * (layer.rMax - layer.rMin);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.globalAlpha = layer.aMin + Math.random() * (layer.aMax - layer.aMin);
      ctx.fillStyle   = layer.colors[Math.floor(Math.random() * layer.colors.length)];
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * (0.5 + Math.random()), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ── Shader patch ─────────────────────────────────────────────────────────────
let _shader   = null;    // captured shader ref (for live uniform updates)
const _tint   = new THREE.Color('#6aa84f');   // default grass tint
let   _repeat = 36;      // gs / TILE_WU, set per zone
let   _size   = 216;     // active ground size (gs), set per zone

function _patchGroundMaterial() {
  _maskTex = new THREE.CanvasTexture(_maskCv);
  _maskTex.colorSpace = THREE.NoColorSpace;   // mask is data, not color
  const roadTex = makeRoadTexture(1, 1);
  const dirtTex = _makeDirtTexture();
  _clearMask();

  const mat = ground.material;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintMask   = { value: _maskTex };
    shader.uniforms.uRoadTex     = { value: roadTex };
    shader.uniforms.uDirtTex     = { value: dirtTex };
    shader.uniforms.uTintColor   = { value: _tint };
    shader.uniforms.uPaintRepeat = { value: _repeat };
    shader.uniforms.uSize        = { value: _size };

    // Derive the paint UV from local position (not the `uv` attribute), which is
    // always present — the ground material may have no `map` (hence no `uv`) at
    // first compile, before any zone/biome is loaded. Plane local x,y map to
    // world as: worldX = x, worldZ = -y → matches _worldToPx's canvas mapping.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPaintUv;\nuniform float uSize;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  vPaintUv = vec2(position.x / uSize + 0.5, position.y / uSize + 0.5);');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
        varying vec2 vPaintUv;
        uniform sampler2D uPaintMask;
        uniform sampler2D uRoadTex;
        uniform sampler2D uDirtTex;
        uniform vec3  uTintColor;
        uniform float uPaintRepeat;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3  _pm   = texture2D(uPaintMask, vPaintUv).rgb;
          vec2  _tuv  = vPaintUv * uPaintRepeat;
          // tint first (multiplies existing surface — keeps texture detail)
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTintColor, _pm.b);
          // dirt, then road on top (road wins, keeps its own texture)
          diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uDirtTex, _tuv).rgb, _pm.g);
          diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uRoadTex, _tuv).rgb, _pm.r);
        }`);

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

// ── Rasterize one stroke into the mask ───────────────────────────────────────
function _stamp(wx, wz, rWU, ch) {
  const { px, py, gs } = _worldToPx(wx, wz);
  const rPx = Math.max(1, (rWU / gs) * MASK_SIZE);

  const x0 = Math.max(0, Math.floor(px - rPx));
  const y0 = Math.max(0, Math.floor(py - rPx));
  const x1 = Math.min(MASK_SIZE, Math.ceil(px + rPx));
  const y1 = Math.min(MASK_SIZE, Math.ceil(py + rPx));
  const w  = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const img  = _maskCtx.getImageData(x0, y0, w, h);
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
  _maskCtx.putImageData(img, x0, y0);
  if (_maskTex) _maskTex.needsUpdate = true;
}

// ── Public: load paint for a zone ────────────────────────────────────────────
export function loadPaint(strokes, tintHex) {
  _size   = _gs();
  _repeat = _size / TILE_WU;
  if (tintHex) _tint.set(tintHex);
  if (_shader) {
    _shader.uniforms.uSize.value        = _size;
    _shader.uniforms.uPaintRepeat.value = _repeat;
    _shader.uniforms.uTintColor.value   = _tint;
  }
  const tintInput = document.getElementById('tp-tint');
  if (tintInput && tintHex) tintInput.value = '#' + _tint.getHexString();
  _clearMask();
  _strokes = [];
  (strokes ?? []).forEach(s => {
    _strokes.push({ x: s.x, z: s.z, r: s.r, ch: s.ch });
    _stamp(s.x, s.z, s.r, s.ch);
  });
  _updateCounter();
}

// ── Brush / editor state ─────────────────────────────────────────────────────
let _strokes    = [];          // recorded strokes for the active zone
let _paintMode  = false;
let _painting   = false;
let _channel    = 'road';
let _brush      = 4.0;         // radius in world units
let _lastRec    = null;        // last recorded stroke pos (for spacing)
let _activeZone = null;

export function isPaintModeActive() { return _paintMode; }

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

function _paintAt(pt) {
  // Record + rasterize, but space out recorded strokes so a drag doesn't store
  // thousands of near-duplicate points.
  const spacing = Math.max(0.4, _brush * 0.4);
  if (_lastRec) {
    const dx = pt.x - _lastRec.x, dz = pt.z - _lastRec.z;
    if (dx * dx + dz * dz < spacing * spacing) { _stamp(pt.x, pt.z, _brush, _channel); return; }
  }
  const s = { x: +pt.x.toFixed(1), z: +pt.z.toFixed(1), r: +_brush.toFixed(1), ch: _channel };
  _strokes.push(s);
  _lastRec = pt;
  _stamp(s.x, s.z, s.r, s.ch);
  _updateCounter();
}

// ── UI ───────────────────────────────────────────────────────────────────────
function _setChannel(ch) {
  _channel = ch;
  document.querySelectorAll('.tp-ch-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.ch === ch));
  _updateStatus();
}

function _setPaintMode(on) {
  _paintMode = on;
  if (!on && _painting) { _painting = false; controls.enabled = true; }
  const btn = document.getElementById('tp-paint-btn');
  if (btn) { btn.textContent = on ? 'STOP PAINTING' : 'PAINT MODE'; btn.classList.toggle('active', on); }
  _updateStatus();
}

function _updateStatus() {
  const el = document.getElementById('tp-status');
  if (!el) return;
  el.textContent = _paintMode
    ? `Painting "${_channel}" · brush ${_brush.toFixed(1)} · drag on terrain`
    : 'Click PAINT MODE, then drag on the terrain';
}
function _updateCounter() {
  const el = document.getElementById('tp-counter');
  if (el) el.textContent = `Strokes: ${_strokes.length}`;
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
        zoneId: _activeZone,
        paint: _strokes,
        paintTint: '#' + _tint.getHexString(),
      }),
    });
    const json = await res.json();
    if (json.ok) {
      _setSave(`Saved ${_strokes.length} stroke${_strokes.length !== 1 ? 's' : ''} ✓`, 'ok');
      setTimeout(() => _setSave('', ''), 3000);
    } else {
      _setSave(`Error: ${json.error}`, 'error');
    }
  } catch (e) {
    _setSave(`Failed: ${e.message}`, 'error');
  }
}

function _clearPaint() {
  _strokes = [];
  _lastRec = null;
  _clearMask();
  _updateCounter();
  _updateStatus();
}

// ── Init ─────────────────────────────────────────────────────────────────────
export function initTerrainPaint() {
  _patchGroundMaterial();

  window.addEventListener('zone:loaded', e => { _activeZone = e.detail?.id ?? null; _updateCounter(); });

  // Turning the terrain editor off should also drop paint mode.
  document.getElementById('terrain-editor-btn')?.addEventListener('click', () => {
    if (_paintMode) _setPaintMode(false);
  });

  if (!IS_DEV) return;   // painting tool is dev-only; loadPaint still runs in prod

  document.getElementById('tp-paint-btn')?.addEventListener('click', () => _setPaintMode(!_paintMode));
  document.getElementById('tp-clear-btn')?.addEventListener('click', () => {
    if (_strokes.length && !confirm(`Clear all ${_strokes.length} paint stroke(s)?`)) return;
    _clearPaint();
  });
  document.getElementById('tp-save-btn')?.addEventListener('click', _save);

  document.querySelectorAll('.tp-ch-btn').forEach(b =>
    b.addEventListener('click', () => _setChannel(b.dataset.ch)));

  const brushInput = document.getElementById('tp-brush');
  brushInput?.addEventListener('input', e => {
    _brush = Math.max(0.5, parseFloat(e.target.value) || 4);
    _updateStatus();
  });

  const tintInput = document.getElementById('tp-tint');
  tintInput?.addEventListener('input', e => {
    _tint.set(e.target.value);
    if (_shader) _shader.uniforms.uTintColor.value = _tint;
  });
  document.querySelectorAll('.tp-tint-swatch').forEach(b =>
    b.addEventListener('click', () => {
      _tint.set(b.dataset.color);
      if (tintInput) tintInput.value = b.dataset.color;
      if (_shader) _shader.uniforms.uTintColor.value = _tint;
    }));

  // ── Brush pointer handlers (capture phase — beat OrbitControls & hero clicks) ──
  renderer.domElement.addEventListener('pointerdown', e => {
    if (!_paintMode || e.button !== 0) return;
    const pt = _groundPt(e.clientX, e.clientY);
    if (!pt) return;
    e.stopImmediatePropagation();
    controls.enabled = false;   // drag paints instead of orbiting the camera
    _painting = true;
    _lastRec  = null;
    _paintAt(pt);
  }, true);

  renderer.domElement.addEventListener('pointermove', e => {
    if (!_painting) return;
    e.stopImmediatePropagation();
    const pt = _groundPt(e.clientX, e.clientY);
    if (pt) _paintAt(pt);
  }, true);

  const _endStroke = () => {
    if (!_painting) return;
    _painting = false;
    controls.enabled = true;
    _lastRec = null;
  };
  window.addEventListener('pointerup', _endStroke, true);

  _updateStatus();
  _updateCounter();
}
