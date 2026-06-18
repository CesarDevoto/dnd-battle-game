// js/arrow.js — realistic arrow/bolt projectile for all ranged attacks
import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { playSound } from './audio.js';

const TRAVEL_MS  = 760;   // ms to reach target
const ARC_HEIGHT = 0.80;  // peak of parabolic arc (world units)
const MAX_PARTS  = 110;   // ring-buffer for trail + impact particles

export function fireRangedAttack(attacker, target, onImpact) {
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

  // ── Arrow geometry (all sub-meshes face +Z local axis) ───────────────────────

  const arrowGrp = new THREE.Group();

  // Wooden shaft
  const shaftGeo = new THREE.CylinderGeometry(0.021, 0.026, 0.92, 6);
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x9b7a2e, roughness: 0.88, metalness: 0.02,
  });
  arrowGrp.add(new THREE.Mesh(shaftGeo, shaftMat));

  // Dark iron arrowhead (cone pointing +Z)
  const headGeo = new THREE.ConeGeometry(0.044, 0.20, 6);
  headGeo.rotateX(Math.PI / 2);
  headGeo.translate(0, 0, 0.56);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x464450, roughness: 0.38, metalness: 0.78,
  });
  arrowGrp.add(new THREE.Mesh(headGeo, headMat));

  // Three fletching feathers at the nock end
  const fletchMat = new THREE.MeshStandardMaterial({
    color: 0xbfaa88, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide,
  });
  for (let f = 0; f < 3; f++) {
    const fGeo = new THREE.PlaneGeometry(0.052, 0.17);
    fGeo.translate(0, 0.038, -0.355);
    const fMesh = new THREE.Mesh(fGeo, fletchMat);
    fMesh.rotation.z = (f / 3) * Math.PI * 2;
    arrowGrp.add(fMesh);
  }

  arrowGrp.frustumCulled = false;
  scene.add(arrowGrp);
  arrowGrp.position.copy(start);

  // ── Unified particle buffer (subtle trail + impact debris) ───────────────────

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
    size: 0.09, vertexColors: true,
    transparent: true, opacity: 0.72,
    depthWrite: false, sizeAttenuation: true,
  });
  const partPts = new THREE.Points(partGeo, partMat);
  partPts.frustumCulled = false;
  scene.add(partPts);

  // Faint air-disturbance trail behind arrowhead
  function emitTrail(px, py, pz) {
    const i = pHead++ % MAX_PARTS;
    vX[i] = (Math.random() - 0.5) * 0.007;
    vY[i] = (Math.random() - 0.5) * 0.007;
    vZ[i] = (Math.random() - 0.5) * 0.007;
    life[i] = maxLife[i] = 0.13 + Math.random() * 0.09;
    posArr[i * 3]     = px + (Math.random() - 0.5) * 0.05;
    posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.05;
    posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.05;
  }

  // Physical impact: wood splinters + dust cloud
  function emitImpact(px, py, pz) {
    // Debris burst
    for (let k = 0; k < 20; k++) {
      const i = pHead++ % MAX_PARTS;
      const θ  = Math.random() * Math.PI * 2;
      const sp = 0.038 + Math.random() * 0.055;
      vX[i] = Math.cos(θ) * sp;
      vY[i] = 0.012 + Math.random() * 0.048;
      vZ[i] = Math.sin(θ) * sp;
      life[i] = maxLife[i] = 0.30 + Math.random() * 0.45;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.14;
      posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.08;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.14;
    }
    // Slow-drifting dust
    for (let k = 0; k < 8; k++) {
      const i = pHead++ % MAX_PARTS;
      vX[i] = (Math.random() - 0.5) * 0.015;
      vY[i] = 0.004 + Math.random() * 0.010;
      vZ[i] = (Math.random() - 0.5) * 0.015;
      life[i] = maxLife[i] = 0.55 + Math.random() * 0.55;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.22;
      posArr[i * 3 + 1] = py;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.22;
    }
  }

  // ── Screen shake (canvas CSS transform, same as firebolt but lighter) ────────

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

  // ── Main animation loop ──────────────────────────────────────────────────────

  const  t0       = performance.now();
  let    prevNow  = t0;
  let    impacted = false;
  let    doneAt   = Infinity;
  const  _fwd     = new THREE.Vector3(0, 0, 1);  // arrow's local forward axis
  const  _tangent = new THREE.Vector3();          // reused each frame — avoids per-frame allocation

  function tick(now) {
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    // ── Flying phase ─────────────────────────────────────────────────────────
    if (!impacted) {
      const t = Math.min(1, (now - t0) / TRAVEL_MS);

      // Parabolic arc position
      arrowGrp.position.lerpVectors(start, end, t);
      arrowGrp.position.y += Math.sin(t * Math.PI) * ARC_HEIGHT;

      // Orient arrow tip along the arc tangent at time t
      _tangent.set(
        end.x - start.x,
        (end.y - start.y) + Math.PI * ARC_HEIGHT * Math.cos(t * Math.PI),
        end.z - start.z,
      ).normalize();
      arrowGrp.quaternion.setFromUnitVectors(_fwd, _tangent);

      // Sparse air-trail behind nock
      if (Math.random() < 0.40) emitTrail(
        arrowGrp.position.x, arrowGrp.position.y, arrowGrp.position.z,
      );

      if (t >= 1) {
        // ── Impact ───────────────────────────────────────────────────────────
        impacted = true;
        scene.remove(arrowGrp);
        arrowGrp.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });

        emitImpact(end.x, end.y, end.z);
        playSound('arrow_hit');
        screenShake();
        doneAt = now + 1700;
        if (onImpact) onImpact();
      }
    }

    // ── Particle update ───────────────────────────────────────────────────────
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
      vY[i] -= 0.0012;  // gravity
      const f = Math.max(0, life[i] / maxLife[i]);
      // Warm wood/dust tone, fading to zero
      colArr[i * 3]     = 0.54 * f + 0.06;
      colArr[i * 3 + 1] = 0.42 * f + 0.05;
      colArr[i * 3 + 2] = 0.26 * f + 0.03;
    }
    partGeo.attributes.position.needsUpdate = true;
    partGeo.attributes.color.needsUpdate    = true;
    partGeo.setDrawRange(0, cnt);

    // ── Final cleanup ─────────────────────────────────────────────────────────
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
