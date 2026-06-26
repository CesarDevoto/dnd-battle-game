// js/heroSkins.js — per-zone visual skin overrides for hero models
import * as THREE from 'three';
import { units } from './units.js';

const SKINS = {
  ghost: {
    color:             0xddeeff,
    emissive:          new THREE.Color(0x6688bb),
    emissiveIntensity: 0.70,
    transparent:       true,
    opacity:           0.50,
    depthWrite:        false,
    side:              THREE.DoubleSide,
    roughness:         0.9,
    metalness:         0.0,
  },
};

export function applyHeroSkin(skinName) {
  const skinDef = skinName ? SKINS[skinName] : null;

  units.filter(u => u.team === 'blue').forEach(u => {
    u.grp.traverse(node => {
      if (!node.isMesh && !node.isSkinnedMesh) return;
      if (!node.material) return;

      if (!node.userData._origMats) {
        node.userData._origMats = Array.isArray(node.material)
          ? node.material.slice()
          : node.material;
      }

      if (!skinDef) {
        node.material = node.userData._origMats;
        node.renderOrder = 0;
        return;
      }

      const makeMat = () => new THREE.MeshStandardMaterial(skinDef);
      node.material = Array.isArray(node.userData._origMats)
        ? node.userData._origMats.map(makeMat)
        : makeMat();
      node.renderOrder = 2;
    });
  });
}
