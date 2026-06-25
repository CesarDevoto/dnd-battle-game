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

// Fragment is visible if any hero has an unobstructed ray to it.
// A ray is blocked if it crosses any vision-blocker segment.
// We render pure black for fragments no hero can see.
const _frag = /* glsl */`
varying vec2 vXZ;
uniform vec2 uHero[4];
uniform int  uHeroN;
uniform vec4 uSeg[MAX_B_LITERAL];
uniform int  uSegN;

bool crosses(vec2 a, vec2 b, vec2 c, vec2 d) {
  vec2 r = b - a, s = d - c;
  float den = r.x * s.y - r.y * s.x;
  if (abs(den) < 0.0001) return false;
  vec2 ac = c - a;
  float t = (ac.x * s.y - ac.y * s.x) / den;
  float u = (ac.x * r.y  - ac.y * r.x) / den;
  return t > 0.0001 && t < 0.9999 && u >= 0.0 && u <= 1.0;
}

void main() {
  if (uHeroN <= 0) { discard; return; }
  vec2 p = vXZ;
  for (int i = 0; i < 4; i++) {
    if (i >= uHeroN) break;
    bool blocked = false;
    for (int j = 0; j < MAX_B_LITERAL; j++) {
      if (j >= uSegN) break;
      if (crosses(uHero[i], p, uSeg[j].xy, uSeg[j].zw)) { blocked = true; break; }
    }
    if (!blocked) { discard; return; }
  }
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
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
