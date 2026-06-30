import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { UNIT_TYPES } from './constants.js';

const PORTRAIT_SIZE = 280;

// ── Off-screen portrait renderer (separate context, renders on demand) ────────
const _portraitCanvas = document.getElementById('target-portrait-canvas');
const _pr = new THREE.WebGLRenderer({
  canvas: _portraitCanvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
_pr.setSize(PORTRAIT_SIZE, PORTRAIT_SIZE);
_pr.setClearColor(0x000000, 0);

const _pScene  = new THREE.Scene();
const _pCamera = new THREE.PerspectiveCamera(36, 1, 0.01, 300);

_pScene.add(new THREE.AmbientLight(0xffe8c8, 1.1));
const _key  = new THREE.DirectionalLight(0xffd070, 2.0);
_key.position.set(2, 5, 4);
_pScene.add(_key);
const _fill = new THREE.DirectionalLight(0x88aaff, 0.6);
_fill.position.set(-3, 1, -2);
_pScene.add(_fill);

let _modelNode = null;

function _clearPortraitScene() {
  if (_modelNode) {
    _pScene.remove(_modelNode);
    _modelNode = null;
  }
}

function _renderPortrait(unit) {
  _clearPortraitScene();
  if (!unit?.grp) return;

  const clone = SkeletonUtils.clone(unit.grp);
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  _pScene.add(clone);
  _modelNode = clone;

  // Force world matrix update so Box3 sees correct positions
  _pScene.updateMatrixWorld(true);

  const box    = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim    = Math.max(size.x, size.y, size.z) || 2;
  const fovRad    = _pCamera.fov * (Math.PI / 180);
  // Tight bust framing — head/upper chest fills the frame
  const bustY     = center.y + size.y * 0.28;
  const dist      = (maxDim * 0.22) / Math.tan(fovRad / 2);

  _pCamera.position.set(
    center.x - maxDim * 0.10,
    bustY + maxDim * 0.05,
    center.z + dist
  );
  _pCamera.lookAt(center.x, bustY, center.z);
  _pr.render(_pScene, _pCamera);
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const _twEl   = document.getElementById('target-window');
const _nameEl = document.getElementById('tw-name');

// ── Public API ────────────────────────────────────────────────────────────────
export function showTargetWindow(unit) {
  const def = UNIT_TYPES[unit.type] ?? {};
  _nameEl.textContent = def.name ?? unit.type;
  _renderPortrait(unit);
  _twEl.classList.add('show');
}

export function hideTargetWindow() {
  _twEl.classList.remove('show');
  _clearPortraitScene();
}

export function updateTargetWindowHP(_unit) {}
