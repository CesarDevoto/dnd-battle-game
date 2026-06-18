// Hides the portion of any environment prop above CUT_HEIGHT WU when it
// occludes a living hero.  The bottom stays fully visible so the player can
// see trunks, wall bases, etc.  Sharp GLSL discard cutoff — no opacity blend.

import * as THREE           from 'three';
import { units }            from './units.js';
import { activeProps }      from './environments.js';
import { camera }           from './scene.js';
import { getTerrainHeight } from './terrain.js';

const CUT_HEIGHT     = 0.8;   // WU above terrain surface (5 ft / WU)
const RAYCAST_STRIDE = 5;

const _raycaster = new THREE.Raycaster();
const _rayDir    = new THREE.Vector3();
const _unitTorso = new THREE.Vector3();

let _entries = [];
let _lastLen = -1;
let _tick    = 0;

// Patch a material with a world-space Y discard.
// Returns the uCutY uniform ref.  Guards against double-patching across HMR.
function _patchMat(mat) {
  // Already patched (e.g. HMR reloaded this module but scene materials persist)
  if (mat.userData._cutY) return mat.userData._cutY;

  const uCutY = { value: 1e6 };
  mat.userData._cutY = uCutY;

  mat.onBeforeCompile = shader => {
    shader.uniforms.uCutY = uCutY;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      'varying vec3 vWPos;\n#include <common>',
    );
    // Inject after all skinning/morph so `transformed` is final local pos
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      'uniform float uCutY;\nvarying vec3 vWPos;\n#include <common>',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      'void main() {\nif (vWPos.y > uCutY) discard;',
    );
  };

  mat.customProgramCacheKey = () => mat.uuid;
  mat.transparent = true;
  mat.needsUpdate = true;
  return uCutY;
}

function _collectMaterials(obj) {
  const orig2clone = new Map();
  const uniforms   = [];
  const meshes     = [];

  obj.traverse(child => {
    if (!child.isMesh) return;

    const raw = Array.isArray(child.material) ? child.material : [child.material];

    const replaced = raw.map(m => {
      // If this material is already patched (HMR re-init), just reuse it
      if (m.userData._cutY) {
        if (!uniforms.includes(m.userData._cutY)) uniforms.push(m.userData._cutY);
        return m;
      }
      if (!orig2clone.has(m)) {
        const c = m.clone();
        const uCutY = _patchMat(c);
        orig2clone.set(m, { mat: c, uCutY });
        uniforms.push(uCutY);
      }
      return orig2clone.get(m).mat;
    });

    child.material = Array.isArray(child.material) ? replaced : replaced[0];
    meshes.push(child);
  });

  return { uniforms, meshes };
}

function _rebuild() {
  _entries = [];

  for (const obj of activeProps) {
    const { uniforms, meshes } = _collectMaterials(obj);
    if (!uniforms.length) continue;

    obj.updateMatrixWorld(true);  // force full hierarchy update before bounds
    const box    = new THREE.Box3().setFromObject(obj);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    sphere.radius *= 1.2;  // small padding so edge-grazing props aren't missed

    const groundY = getTerrainHeight(obj.position.x, obj.position.z);
    _entries.push({ obj, uniforms, meshes, faded: false, sphere, groundY });
  }
  _lastLen = activeProps.length;
}

export function updateEnvironmentVisibility() {
  if (activeProps.length !== _lastLen) _rebuild();
  if (!_entries.length) return;

  const living = units.filter(u => u.hp > 0 && u.team === 'blue');
  if (!living.length) {
    for (const e of _entries) {
      if (e.faded) { e.faded = false; for (const u of e.uniforms) u.value = 1e6; }
    }
    return;
  }

  _tick = (_tick + 1) % RAYCAST_STRIDE;
  if (_tick !== 0) return;

  for (const e of _entries) e.faded = false;

  for (const u of living) {
    _unitTorso.set(u.grp.position.x, u.grp.position.y + 1.0, u.grp.position.z);
    _rayDir.subVectors(_unitTorso, camera.position).normalize();
    const dist = camera.position.distanceTo(_unitTorso);
    _raycaster.near = 0.1;
    _raycaster.far  = dist;
    _raycaster.set(camera.position, _rayDir);

    for (const e of _entries) {
      if (e.faded) continue;
      if (!_raycaster.ray.intersectsSphere(e.sphere)) continue;
      if (_raycaster.intersectObjects(e.meshes, false).length) e.faded = true;
    }
  }

  for (const e of _entries) {
    const cutY = e.faded ? e.groundY + CUT_HEIGHT : 1e6;
    for (const u of e.uniforms) u.value = cutY;
  }
}
