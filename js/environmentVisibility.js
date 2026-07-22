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
const _boxHit    = new THREE.Vector3();

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

  // A CONSTANT, not mat.uuid. This used to key the program cache on each material's uuid,
  // which forced three.js to compile and bind a SEPARATE GPU program for every prop material
  // instance — hundreds per zone, and a program switch on every draw call.
  //
  // That was unnecessary. The shader code injected above is byte-identical for every patched
  // material, so they can all share one compiled program. The per-prop uCutY value is safe:
  // three.js stores `materialProperties.uniforms` PER MATERIAL (WebGLRenderer.getProgram —
  // `properties.get(material)`, then `materialProperties.uniforms = parameters.uniforms`) and
  // uploads it per material per draw, while `acquireProgram` shares only the compiled GLSL.
  // Props still fade independently.
  //
  // The key is appended to three.js's own parameter list, not a replacement for it, so
  // materials that genuinely differ (different maps, lights, etc.) still get their own program.
  mat.customProgramCacheKey = () => 'envFade';
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
    // Gate fog / Zone Gate props are meant to be SEEN through — never fade them out when they sit
    // between the camera and a hero (the fog is soft and the gate's white ball is a click target).
    if (obj.userData?.isFogBall || obj.userData?.isZoneGate) continue;

    const { uniforms, meshes } = _collectMaterials(obj);
    if (!uniforms.length) continue;

    obj.updateMatrixWorld(true);  // force full hierarchy update before bounds
    const box    = new THREE.Box3().setFromObject(obj);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    sphere.radius *= 1.2;  // small padding so edge-grazing props aren't missed

    const groundY = getTerrainHeight(obj.position.x, obj.position.z);
    _entries.push({ obj, uniforms, meshes, faded: false, sphere, box, groundY });
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
    const dist   = camera.position.distanceTo(_unitTorso);
    const distSq = dist * dist;
    _raycaster.near = 0.1;
    _raycaster.far  = dist;
    _raycaster.set(camera.position, _rayDir);
    const ray = _raycaster.ray;

    for (const e of _entries) {
      if (e.faded) continue;
      // Broad-phase sphere reject, then a BOUNDING-BOX ray test — NOT a per-triangle raycast.
      // The old intersectObjects(e.meshes) re-walked every prop's full geometry every stride
      // frame; against the Warrens' wall/tree meshes that was the ~500ms rAF spikes. Box-level
      // occlusion is imperceptible for a "fade the top off a prop that's in front of a hero"
      // effect, and it's O(1) per prop instead of O(triangles).
      if (!ray.intersectsSphere(e.sphere)) continue;
      // intersectBox writes the entry point; only fade props that sit BETWEEN camera and hero
      // (nearer than the hero), matching the old raycaster.far = dist cutoff.
      if (ray.intersectBox(e.box, _boxHit) &&
          camera.position.distanceToSquared(_boxHit) <= distSq) e.faded = true;
    }
  }

  for (const e of _entries) {
    const cutY = e.faded ? e.groundY + CUT_HEIGHT : 1e6;
    for (const u of e.uniforms) u.value = cutY;
  }
}
