import * as THREE from 'three';
// NOTE: this module must NOT statically import propBuilders (or anything that
// pulls in scene.js), or it would drag propBuilders→units→environments→scene into
// scene's init and crash with "Cannot access 'scene' before initialization". The
// tiled ROAD texture (which lives in propBuilders) is therefore installed by
// terrainPaint.js at init time, well outside scene's init path.

// ── Terrain-paint shader patch (ground splatmap) ─────────────────────────────
// The splatmap paint (road/dirt/tint) is drawn by injecting a fragment-shader
// chunk into the ground material via onBeforeCompile. The material reads its paint
// LAYER (mask + tint). The tiled road/dirt textures + tiling scale live here as
// SHARED uniforms and terrainPaint updates them once per zone.

const TILE_WU = 6;   // road/dirt texture tiles once per this many world units (matches terrainPaint)

// 1×1 opaque-black fallback mask so a material can never compile against a null
// sampler (before terrainPaint installs the real mask).
function _fallbackMask() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 1, 1);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

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

// 1×1 fallback so uRoadTex is never null before terrainPaint installs the real
// tiled road texture (which needs propBuilders — see the import note up top).
function _fallbackRoad() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, 0, 1, 1);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Uniforms come in two groups:
//   • SHARED (road/dirt tiled textures + tiling scale + ground size) — identical
//     for every layer, so they live once here. The DIRT texture is pure canvas
//     (no propBuilders) so it's built here; the ROAD texture is installed by
//     terrainPaint.installRoadTexture() at init (see import note up top).
//   • PER-LAYER (the splatmap MASK + the tint colour) — the ground floor layer has
//     its own; a data-only roof layer keeps a second set for legacy paintRoof strokes.
export const sharedPaintUniforms = {
  uRoadTex:     { value: _fallbackRoad() },
  uDirtTex:     { value: _makeDirtTexture() },
  uPaintRepeat: { value: 36 },
  uSize:        { value: 216 },
};

// One layer's independent uniforms. Mask starts as a valid (non-null) fallback so
// a material can safely compile before terrainPaint installs the real mask.
export function makeLayerUniforms() {
  return {
    uPaintMask: { value: _fallbackMask() },
    uTintColor: { value: new THREE.Color('#6aa84f') },
  };
}

// The two layers. floorPaintUniforms is read by the ground material; roofPaintUniforms
// is retained as a data-only layer (round-trips legacy paintRoof strokes, renders nothing).
export const floorPaintUniforms = makeLayerUniforms();
export const roofPaintUniforms  = makeLayerUniforms();

export const PAINT_TILE_WU = TILE_WU;

// Inject the paint splatmap chunk into `shader` (an onBeforeCompile arg), reading
// `layer`'s mask + tint and the shared textures. Modifies diffuseColor.rgb only,
// so it composes cleanly with other material patches.
export function applyPaintShader(shader, layer) {
  shader.uniforms.uPaintMask   = layer.uPaintMask;
  shader.uniforms.uTintColor   = layer.uTintColor;
  shader.uniforms.uRoadTex     = sharedPaintUniforms.uRoadTex;
  shader.uniforms.uDirtTex     = sharedPaintUniforms.uDirtTex;
  shader.uniforms.uPaintRepeat = sharedPaintUniforms.uPaintRepeat;
  shader.uniforms.uSize        = sharedPaintUniforms.uSize;

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
}
