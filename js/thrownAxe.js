// js/thrownAxe.js — spinning hand-axe projectile for Gobo's ranged attack
import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { playSound } from './audio.js';

const TRAVEL_MS  = 680;   // slightly faster than an arrow
const ARC_HEIGHT = 0.55;
const SPIN_SPEED = 16;    // rad/s — rapid end-over-end tumble
const MAX_PARTS  = 80;

export function fireThrownAxe(attacker, target, onImpact) {
  playSound('arrow_shoot');

  const start = new THREE.Vector3(
    attacker.grp.position.x,
    attacker.grp.position.y + 1.10,
    attacker.grp.position.z,
  );
  const end = new THREE.Vector3(
    target.grp.position.x,
    target.grp.position.y + 0.78,
    target.grp.position.z,
  );

  // ── Axe geometry ──────────────────────────────────────────────────────────────
  // Outer group positions along the arc; inner tumbleGrp spins freely.
  const axeGrp    = new THREE.Group();
  const tumbleGrp = new THREE.Group();
  axeGrp.add(tumbleGrp);

  // Handle — dark wood, along local Y axis
  const handleGeo = new THREE.CylinderGeometry(0.022, 0.028, 0.44, 6);
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.90, metalness: 0.0 });
  tumbleGrp.add(new THREE.Mesh(handleGeo, handleMat));

  // Blade — flat iron box at the head end (local Y+)
  const bladeGeo = new THREE.BoxGeometry(0.23, 0.14, 0.036);
  bladeGeo.translate(0.02, 0.27, 0);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x6e7078, roughness: 0.38, metalness: 0.84 });
  tumbleGrp.add(new THREE.Mesh(bladeGeo, bladeMat));

  // Cutting-edge highlight — brighter strip along the wide side of the blade
  const edgeGeo = new THREE.BoxGeometry(0.04, 0.13, 0.038);
  edgeGeo.translate(0.14, 0.27, 0);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xc8cfd6, roughness: 0.18, metalness: 0.96 });
  tumbleGrp.add(new THREE.Mesh(edgeGeo, edgeMat));

  axeGrp.frustumCulled  = false;
  tumbleGrp.frustumCulled = false;
  scene.add(axeGrp);
  axeGrp.position.copy(start);

  // Face the outer group toward the target so the spin axis lines up with travel
  axeGrp.lookAt(end);

  // ── Particle system (metallic sparks on impact) ────────────────────────────
  const posArr  = new Float32Array(MAX_PARTS * 3);
  const colArr  = new Float32Array(MAX_PARTS * 3);
  const vX      = new Float32Array(MAX_PARTS);
  const vY      = new Float32Array(MAX_PARTS);
  const vZ      = new Float32Array(MAX_PARTS);
  const life    = new Float32Array(MAX_PARTS);
  const maxLife = new Float32Array(MAX_PARTS);
  let   pHead   = 0;

  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
  partGeo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));
  partGeo.setDrawRange(0, 0);

  const partMat = new THREE.PointsMaterial({
    size: 0.10, vertexColors: true,
    transparent: true, opacity: 0.88,
    depthWrite: false, sizeAttenuation: true,
  });
  const partPts = new THREE.Points(partGeo, partMat);
  partPts.frustumCulled = false;
  scene.add(partPts);

  function emitSparks(px, py, pz) {
    for (let k = 0; k < 22; k++) {
      const i  = pHead++ % MAX_PARTS;
      const θ  = Math.random() * Math.PI * 2;
      const sp = 0.04 + Math.random() * 0.10;
      vX[i] = Math.cos(θ) * sp;
      vY[i] = 0.03 + Math.random() * 0.09;
      vZ[i] = Math.sin(θ) * sp;
      life[i] = maxLife[i] = 0.18 + Math.random() * 0.32;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.12;
      posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.07;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.12;
    }
  }

  function screenShake() {
    const cvs = renderer.domElement;
    let n = 0;
    const id = setInterval(() => {
      const f = 1 - n / 8;
      cvs.style.transform =
        `translate(${(Math.random() - 0.5) * 5 * f}px,${(Math.random() - 0.5) * 5 * f}px)`;
      if (++n >= 8) { clearInterval(id); cvs.style.transform = ''; }
    }, 28);
  }

  // ── Animation loop ────────────────────────────────────────────────────────────
  const t0       = performance.now();
  let   prevNow  = t0;
  let   impacted = false;
  let   doneAt   = Infinity;
  let   spin     = 0;

  function tick(now) {
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    if (!impacted) {
      const t = Math.min(1, (now - t0) / TRAVEL_MS);

      // Parabolic arc
      axeGrp.position.lerpVectors(start, end, t);
      axeGrp.position.y += Math.sin(t * Math.PI) * ARC_HEIGHT;

      // Tumble the inner group end-over-end around its local X axis
      spin += SPIN_SPEED * dt;
      tumbleGrp.rotation.x = spin;

      if (t >= 1) {
        impacted = true;
        scene.remove(axeGrp);
        axeGrp.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });

        emitSparks(end.x, end.y, end.z);
        playSound('arrow_hit');
        screenShake();
        doneAt = now + 1100;
        if (onImpact) onImpact();
      }
    }

    // Particle update
    const cnt = Math.min(pHead, MAX_PARTS);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) {
        colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0;
        continue;
      }
      life[i] -= dt;
      posArr[i * 3]     += vX[i];
      posArr[i * 3 + 1] += vY[i];
      posArr[i * 3 + 2] += vZ[i];
      vY[i] -= 0.0018;
      const f = Math.max(0, life[i] / maxLife[i]);
      // Hot spark: orange-white fading to dark red
      colArr[i * 3]     = 0.95 * f + 0.05;
      colArr[i * 3 + 1] = 0.55 * f;
      colArr[i * 3 + 2] = 0.08 * f;
    }
    partGeo.attributes.position.needsUpdate = true;
    partGeo.attributes.color.needsUpdate    = true;
    partGeo.setDrawRange(0, cnt);

    if (now >= doneAt) {
      scene.remove(partPts);
      partGeo.dispose();
      partMat.dispose();
      return;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
