// js/smokemirrors.js — lingering dark smoke cloud for Milo's Smoke & Mirrors skill
import * as THREE from 'three';
import { scene } from './scene.js';

const PUFF_COUNT    = 16;
const SMOKE_COLORS  = [0x1c1c22, 0x26262e, 0x302e38, 0x1a1a20];

// Spawns a persistent smoke cloud centered at (cx, cy, cz) with the given radius
// (world units). Runs its own animation loop until dispose() is called — the
// caller (combat.js) owns the lifetime, ticking it down round by round.
// Deliberately translucent (opacity ~0.3-0.45, no additive blending) so the
// hero inside remains partly visible rather than fully hidden from the camera.
export function spawnSmokeCloud(cx, cy, cz, radiusWU) {
  const grp = new THREE.Group();
  grp.position.set(cx, cy, cz);
  scene.add(grp);

  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffs   = [];

  for (let i = 0; i < PUFF_COUNT; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * radiusWU * 0.85;
    const mat = new THREE.MeshBasicMaterial({
      color: SMOKE_COLORS[i % SMOKE_COLORS.length],
      transparent: true, opacity: 0.28 + Math.random() * 0.16,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(puffGeo, mat);
    mesh.scale.setScalar(0.55 + Math.random() * 0.75);
    const baseY = 0.15 + Math.random() * 1.9;
    mesh.position.set(Math.cos(ang) * rad, baseY, Math.sin(ang) * rad);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    grp.add(mesh);
    puffs.push({
      mesh,
      baseY,
      bobPhase:   Math.random() * Math.PI * 2,
      bobSpeed:   0.0006 + Math.random() * 0.0006,
      spinSpeed:  (Math.random() - 0.5) * 0.0008,
      orbitAng:   ang,
      orbitRad:   rad,
      orbitSpeed: (Math.random() - 0.5) * 0.00025,
    });
  }

  let active = true;

  function tick(now) {
    if (!active) return;
    puffs.forEach(p => {
      p.orbitAng += p.orbitSpeed;
      p.mesh.position.x = Math.cos(p.orbitAng) * p.orbitRad;
      p.mesh.position.z = Math.sin(p.orbitAng) * p.orbitRad;
      p.mesh.position.y = p.baseY + Math.sin(now * p.bobSpeed + p.bobPhase) * 0.18;
      p.mesh.rotation.y += p.spinSpeed;
      p.mesh.rotation.x += p.spinSpeed * 0.6;
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    dispose() {
      if (!active) return;
      active = false;
      scene.remove(grp);
      puffGeo.dispose();
      puffs.forEach(p => p.mesh.material.dispose());
    },
  };
}
