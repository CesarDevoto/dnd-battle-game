import * as THREE from 'three';

export const TEX_TYPES = ['auto', 'grass', 'rock', 'road', 'dirt', 'sand'];

// ── Vertex shader additions ───────────────────────────────────────────────────

const VERT_DECL = `
varying vec3 vWorldPos;
varying vec3 vWorldNorm;
`;

const VERT_MAIN = `
vWorldPos  = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
`;

// ── Fragment shader additions ─────────────────────────────────────────────────

const FRAG_DECL = `
varying vec3 vWorldPos;
varying vec3 vWorldNorm;
uniform float uTexScale;

float _th(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float _tn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(_th(i),           _th(i + vec2(1.0, 0.0)), f.x),
             mix(_th(i + vec2(0.0, 1.0)), _th(i + vec2(1.0, 1.0)), f.x), f.y);
}
float _tfbm(vec2 p) {
  return _tn(p) * 0.55 + _tn(p * 2.03) * 0.30 + _tn(p * 4.17) * 0.15;
}
float triNoise(vec3 pos, vec3 norm) {
  vec3 w = abs(norm);
  w = pow(w, vec3(6.0));
  w /= dot(w, vec3(1.0));
  float s = uTexScale;
  return _tfbm(pos.yz * s) * w.x + _tfbm(pos.xz * s) * w.y + _tfbm(pos.xy * s) * w.z;
}
`;

const FRAG_COLOR = `
#ifdef USE_COLOR
  float _d = triNoise(vWorldPos, vWorldNorm);
  diffuseColor.rgb *= vColor.rgb * (0.50 + 0.72 * _d);
#endif
`;

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0,
    vertexColors: true,
  });

  mat.userData.texScale = 0.30;

  mat.onBeforeCompile = shader => {
    mat.userData.shader = shader;
    shader.uniforms.uTexScale = { value: mat.userData.texScale };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_MAIN);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', FRAG_COLOR);
  };

  mat.customProgramCacheKey = () => 'terrain-triplanar-v1';

  return mat;
}
