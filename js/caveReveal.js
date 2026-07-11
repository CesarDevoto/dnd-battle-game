import * as THREE from 'three';
import { getGroundHeight } from './terrain.js';
import { applyPaintShader, roofPaintUniforms } from './terrainPaintShader.js';

// ── Cave roof reveal ────────────────────────────────────────────────────────────
// The blanket (and the blanket grid) get their own materials with a shader patch
// that fades alpha in a soft radius around any hero who is UNDER the roof. Being
// under the roof is exactly the occlusion condition, so this reveals the party in
// the tunnel without moving the camera. The reveal centre tracks where the camera→
// hero sightline crosses the roof (the true occluder). A per-vertex aRoof factor
// gates it so it only fades over real tunnel, never the flat ground near a mouth.

const MAX_REVEAL   = 8;      // max simultaneously-revealing heroes
const REVEAL_INNER = 5.0;    // WU: fully open (transparent) within this
const REVEAL_OUTER = 11.0;   // WU: fully solid roof beyond this (~10-square hole)

// Shared uniform objects — every reveal material references these, so tickCaveReveal
// updates them once and both the roof and the grid pick it up.
const _u = {
  uReveal:      { value: Array.from({ length: MAX_REVEAL }, () => new THREE.Vector2(1e9, 1e9)) },
  uRevealCount: { value: 0 },
  uRevealInner: { value: REVEAL_INNER },
  uRevealOuter: { value: REVEAL_OUTER },
};

// Patch any material (mesh or line) so it fades with the reveal. Sets transparent.
// withPaint=true also injects the terrain-paint splatmap (road/dirt/tint) so the
// cave-roof blanket receives the same painted surfaces as the ground. Only the
// blanket MESH wants paint — the blanket grid (lines) passes withPaint=false so
// its lines aren't tinted by road/dirt textures.
export function applyRevealShader(material, withPaint = false) {
  material.transparent = true;
  material.customProgramCacheKey = () => 'cave-reveal-v3-' + (withPaint ? 'paint-' : '') + material.type;
  material.onBeforeCompile = shader => {
    if (withPaint) applyPaintShader(shader, roofPaintUniforms);   // blanket's own paint layer; rgb first, reveal touches alpha below
    shader.uniforms.uReveal      = _u.uReveal;
    shader.uniforms.uRevealCount = _u.uRevealCount;
    shader.uniforms.uRevealInner = _u.uRevealInner;
    shader.uniforms.uRevealOuter = _u.uRevealOuter;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRevWorld;\nvarying float vRoof;\nattribute float aRoof;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRevWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRoof = aRoof;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
varying vec3 vRevWorld;
varying float vRoof;
uniform vec2 uReveal[${MAX_REVEAL}];
uniform int uRevealCount;
uniform float uRevealInner;
uniform float uRevealOuter;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
float _revA = 1.0;
for (int i = 0; i < ${MAX_REVEAL}; i++) {
  if (i >= uRevealCount) break;
  float dist = length(vRevWorld.xz - uReveal[i]);
  _revA = min(_revA, smoothstep(uRevealInner, uRevealOuter, dist));
}
_revA = mix(1.0, _revA, vRoof);   // only fade where there's real roof over a tunnel
diffuseColor.a *= _revA;
if (diffuseColor.a < 0.02) discard;`);
  };
}

export const ceilingMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff, roughness: 0.92, metalness: 0,
  vertexColors: true, side: THREE.DoubleSide,
  // Writes depth so it occludes the zone's transparent boundary wall behind it;
  // the shader discards fully-revealed fragments so the tunnel still shows through.
  depthWrite: true,
});
applyRevealShader(ceilingMaterial, true);   // blanket mesh: reveal + terrain paint

// Copy the ground's current look so the roof matches the terrain exactly.
export function syncCaveRevealMaterial(groundMat) {
  ceilingMaterial.map = groundMat.map;
  ceilingMaterial.color.copy(groundMat.color);
  ceilingMaterial.roughness = groundMat.roughness;
  ceilingMaterial.needsUpdate = true;
}

// Per-frame: reveal the roof at the point where each under-hero's sightline from
// the camera crosses it — the actual occluder — rather than the hero's own XZ.
export function tickCaveReveal(units, camera) {
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  let n = 0;
  for (const u of units) {
    if (u.team !== 'blue' || u.hp <= 0 || u.familiar) continue;
    if (u.caveLayer !== 'under') continue;
    if (n >= MAX_REVEAL) break;
    const hx = u.grp.position.x, hy = u.grp.position.y, hz = u.grp.position.z;
    const roofY = getGroundHeight(hx, hz, 'surface');   // blanket height above the hero
    let px = hx, pz = hz;
    const denom = hy - cy;
    if (Math.abs(denom) > 1e-3) {
      const t = Math.max(0, Math.min(1, (roofY - cy) / denom));   // ray param at roof height
      px = cx + (hx - cx) * t;
      pz = cz + (hz - cz) * t;
    }
    _u.uReveal.value[n].set(px, pz);
    n++;
  }
  _u.uRevealCount.value = n;
}
