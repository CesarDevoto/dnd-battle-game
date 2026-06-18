import { UNIT_TYPES } from './constants.js';

const HERO_GLOW_COLOR  = 0xd4af37;
const ENEMY_GLOW_COLOR = 0xcc2222;

let _unit          = null;
let _highlightMats = [];

export function showSelectionHighlight(unit) {
  _highlightMats.forEach(m => {
    m.emissiveIntensity = m._baseEmissiveIntensity ?? 0.18;
    if (m._baseEmissiveHex !== undefined) m.emissive.setHex(m._baseEmissiveHex);
  });
  _highlightMats = [];

  _unit = unit;

  const glowHex = unit.team === 'blue' ? HERO_GLOW_COLOR : ENEMY_GLOW_COLOR;
  unit.grp.traverse(node => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    mats.forEach(m => {
      if (!m || typeof m.emissiveIntensity !== 'number') return;
      m._baseEmissiveIntensity = m.emissiveIntensity;
      m._baseEmissiveHex       = m.emissive.getHex();
      m.emissive.setHex(glowHex);
      _highlightMats.push(m);
    });
  });
}

export function hideSelectionHighlight() {
  _highlightMats.forEach(m => {
    m.emissiveIntensity = m._baseEmissiveIntensity ?? 0.18;
    if (m._baseEmissiveHex !== undefined) m.emissive.setHex(m._baseEmissiveHex);
  });
  _highlightMats = [];
  _unit = null;
}

export function updateSelectionHighlight(t) {
  if (!_unit) return;
  const pulse = Math.abs(Math.sin(t * 2.2)) * 0.40;
  _highlightMats.forEach(m => m.emissiveIntensity = pulse);
}
