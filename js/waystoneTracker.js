import * as THREE from 'three';
import { scene, camera, renderer } from './scene.js';
import { units } from './units.js';
import { discoverWaystone, isWaystoneDiscovered, openWorldMap } from './worldMap.js';

const _waystones     = [];
const TRIGGER_RADIUS = 2.5;  // WU — walk this close to discover

export function trackWaystone(mesh, x, z, id) {
  _waystones.push({ mesh, x, z, id, t: 0 });
}

export function clearAllWaystones() {
  for (const ws of _waystones) scene.remove(ws.mesh);
  _waystones.length = 0;
}

// ── Per-frame tick ─────────────────────────────────────────────────────────────

export function tickWaystones(dt) {
  const heroes = units.filter(u => u.team === 'blue' && u.hp > 0);

  for (const ws of _waystones) {
    ws.t += dt;
    const discovered = isWaystoneDiscovered(ws.id);

    // Pulse the disc material
    const disc = ws.mesh.userData.disc;
    if (disc?.material) {
      const base  = discovered ? 0.60 : 0.28;
      const swing = discovered ? 0.28 : 0.12;
      disc.material.opacity           = base  + swing * Math.sin(ws.t * 2.4);
      disc.material.emissiveIntensity = (discovered ? 0.7 : 0.3) + 0.3 * Math.sin(ws.t * 2.4);
    }

    // Proximity discovery
    if (!discovered) {
      for (const hero of heroes) {
        const dx = hero.grp.position.x - ws.x;
        const dz = hero.grp.position.z - ws.z;
        if (dx * dx + dz * dz < TRIGGER_RADIUS * TRIGGER_RADIUS) {
          discoverWaystone(ws.id);
          break;
        }
      }
    }
  }
}

// ── Click-to-open-map ─────────────────────────────────────────────────────────

const _ray   = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

renderer.domElement.addEventListener('click', e => {
  if (!_waystones.some(ws => isWaystoneDiscovered(ws.id))) return;
  const rect = renderer.domElement.getBoundingClientRect();
  _mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  _mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  _ray.setFromCamera(_mouse, camera);
  for (const ws of _waystones) {
    if (!isWaystoneDiscovered(ws.id)) continue;
    if (_ray.intersectObject(ws.mesh, true).length) {
      openWorldMap();
      e.stopPropagation();
      return;
    }
  }
});
