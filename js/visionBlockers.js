import * as THREE from 'three';
import { scene } from './scene.js';
import { units } from './units.js';

const MAX_B = 64;

let _mesh = null;
let _mat  = null;

const _vert = /* glsl */`
varying vec2 vXZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vXZ = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// Half-plane shadow model: each blocker line divides the world in two.
// Heroes are on one side; everything on the opposite side is black.
// No ray-casting — no triangular artifacts at segment endpoints.
const _frag = /* glsl */`
varying vec2 vXZ;
uniform vec2 uHero[4];
uniform int  uHeroN;
uniform vec4 uSeg[MAX_B_LITERAL];
uniform int  uSegN;

// Signed cross product — which side of line AB is point P on.
float side(vec2 p, vec2 a, vec2 b) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

void main() {
  if (uHeroN <= 0 || uSegN <= 0) { discard; return; }
  vec2 p = vXZ;

  bool inShadow = false;
  float minDist = 1.0e6;

  for (int j = 0; j < MAX_B_LITERAL; j++) {
    if (j >= uSegN) break;
    vec2 a = uSeg[j].xy;
    vec2 b = uSeg[j].zw;
    vec2 ab = b - a;
    float len2 = dot(ab, ab);
    if (len2 < 0.0001) continue;

    // Lateral check: only cast shadow within the segment's perpendicular band.
    // t=0 at endpoint A, t=1 at endpoint B; outside means beyond the segment ends.
    float t = dot(p - a, ab) / len2;
    if (t < 0.0 || t > 1.0) continue;

    float fs = side(p, a, b);
    if (abs(fs) < 0.001) continue;

    // Shadow from this segment only if ALL heroes are on the opposite side.
    bool allHeroesOtherSide = true;
    for (int i = 0; i < 4; i++) {
      if (i >= uHeroN) break;
      float hs = side(uHero[i], a, b);
      if (abs(hs) < 0.01 || sign(hs) == sign(fs)) { allHeroesOtherSide = false; break; }
    }

    if (allHeroesOtherSide) {
      inShadow = true;
      float dist = abs(fs) / sqrt(len2); // perpendicular distance to the line
      minDist = min(minDist, dist);
    }
  }

  if (!inShadow) { discard; return; }

  float alpha = smoothstep(0.0, 0.4, minDist); // 0.4 WU ≈ 1 ft edge fuzz
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`;

export function initVisionBlockers(blockers, groundSize = 108) {
  clearVisionBlockers();
  if (!blockers?.length) return;

  const segs = [];
  for (let i = 0; i < MAX_B; i++) {
    const b = blockers[i];
    segs.push(b ? new THREE.Vector4(b.x1, b.z1, b.x2, b.z2) : new THREE.Vector4());
  }

  _mat = new THREE.ShaderMaterial({
    vertexShader:   _vert,
    fragmentShader: _frag.replaceAll('MAX_B_LITERAL', String(MAX_B)),
    transparent: true,
    depthTest:   false,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    uniforms: {
      uHero:  { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uHeroN: { value: 0 },
      uSeg:   { value: segs },
      uSegN:  { value: Math.min(blockers.length, MAX_B) },
    },
  });

  const geo = new THREE.PlaneGeometry(groundSize, groundSize);
  geo.rotateX(-Math.PI / 2);
  _mesh = new THREE.Mesh(geo, _mat);
  _mesh.position.y = 1;
  _mesh.renderOrder = 9;
  _mesh.frustumCulled = false;
  scene.add(_mesh);
}

export function setVisionBlockerOverlayVisible(v) {
  if (_mesh) _mesh.visible = v;
}

export function clearVisionBlockers() {
  if (_mesh) {
    scene.remove(_mesh);
    _mesh.geometry.dispose();
    _mesh.material.dispose();
    _mesh = null;
    _mat  = null;
  }
}

export function tickVisionBlockers() {
  if (!_mat) return;
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);
  const n = Math.min(heroes.length, 4);
  _mat.uniforms.uHeroN.value = n;
  for (let i = 0; i < n; i++) {
    _mat.uniforms.uHero.value[i].set(
      heroes[i].grp.position.x,
      heroes[i].grp.position.z,
    );
  }
}
