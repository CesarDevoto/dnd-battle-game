// js/javelin.js — heavy thrown javelin, used by the ogre's ranged attack.
//
// Unlike the axe (thrownAxe.js) a javelin does NOT tumble — it flies point-first,
// nose tracking the arc tangent the way arrow.js does. It's a much bigger, heavier
// shaft than an arrow though: an ogre is hurling a spear, so it travels flatter and
// faster, lands harder, and throws real dirt on impact.
import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { playSound } from './audio.js';

const TRAVEL_MS  = 620;   // faster than an arrow (760) — thrown by brute strength, flatter line
const ARC_HEIGHT = 0.62;  // heavy shaft, so a shallower lob than an arrow's 0.80
const MAX_PARTS  = 110;

export function fireJavelin(attacker, target, onImpact) {
  playSound('arrow_shoot');

  const start = new THREE.Vector3(
    attacker.grp.position.x,
    // Released from an ogre's raised hand — well above the 1.10 an arrow leaves a bow at.
    attacker.grp.position.y + 2.20,
    attacker.grp.position.z,
  );
  const end = new THREE.Vector3(
    target.grp.position.x,
    target.grp.position.y + 0.78,
    target.grp.position.z,
  );

  // ── Javelin geometry (all sub-meshes point down the +Z local axis) ───────────
  const javGrp = new THREE.Group();

  // Ash shaft — long and thick; tapers slightly toward the butt.
  const shaftGeo = new THREE.CylinderGeometry(0.030, 0.042, 1.90, 7);
  shaftGeo.rotateX(Math.PI / 2);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0x8a6a3a, roughness: 0.92, metalness: 0.02,
  });
  javGrp.add(new THREE.Mesh(shaftGeo, shaftMat));

  // Leaf-shaped iron head — 4-sided cone reads as a blade rather than a needle.
  const headGeo = new THREE.ConeGeometry(0.085, 0.42, 4);
  headGeo.rotateX(Math.PI / 2);
  headGeo.translate(0, 0, 1.14);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x5c5f68, roughness: 0.34, metalness: 0.82,
  });
  javGrp.add(new THREE.Mesh(headGeo, headMat));

  // Socket collar where the head is bound to the shaft.
  const collarGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.14, 7);
  collarGeo.rotateX(Math.PI / 2);
  collarGeo.translate(0, 0, 0.90);
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x3f4148, roughness: 0.45, metalness: 0.70,
  });
  javGrp.add(new THREE.Mesh(collarGeo, collarMat));

  // Leather grip wrap at the balance point — the visual cue that it's thrown, not shot.
  const gripGeo = new THREE.CylinderGeometry(0.050, 0.050, 0.30, 7);
  gripGeo.rotateX(Math.PI / 2);
  gripGeo.translate(0, 0, -0.10);
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x4a3524, roughness: 0.98, metalness: 0.0,
  });
  javGrp.add(new THREE.Mesh(gripGeo, gripMat));

  // Iron butt-cap at the tail.
  const buttGeo = new THREE.ConeGeometry(0.045, 0.12, 6);
  buttGeo.rotateX(-Math.PI / 2);
  buttGeo.translate(0, 0, -1.00);
  javGrp.add(new THREE.Mesh(buttGeo, collarMat));

  javGrp.frustumCulled = false;
  scene.add(javGrp);
  javGrp.position.copy(start);

  // ── Particles: trail + heavy impact debris ───────────────────────────────────
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
    size: 0.12, vertexColors: true,
    transparent: true, opacity: 0.75,
    depthWrite: false, sizeAttenuation: true,
  });
  const partPts = new THREE.Points(partGeo, partMat);
  partPts.frustumCulled = false;
  scene.add(partPts);

  function emitTrail(px, py, pz) {
    const i = pHead++ % MAX_PARTS;
    vX[i] = (Math.random() - 0.5) * 0.008;
    vY[i] = (Math.random() - 0.5) * 0.008;
    vZ[i] = (Math.random() - 0.5) * 0.008;
    life[i] = maxLife[i] = 0.15 + Math.random() * 0.10;
    posArr[i * 3]     = px + (Math.random() - 0.5) * 0.07;
    posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.07;
    posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.07;
  }

  // Heavier than an arrow's: a spear from an ogre kicks up clods, not splinters.
  function emitImpact(px, py, pz) {
    for (let k = 0; k < 26; k++) {
      const i  = pHead++ % MAX_PARTS;
      const θ  = Math.random() * Math.PI * 2;
      const sp = 0.05 + Math.random() * 0.07;
      vX[i] = Math.cos(θ) * sp;
      vY[i] = 0.020 + Math.random() * 0.060;
      vZ[i] = Math.sin(θ) * sp;
      life[i] = maxLife[i] = 0.32 + Math.random() * 0.50;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.18;
      posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.10;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.18;
    }
    for (let k = 0; k < 10; k++) {
      const i = pHead++ % MAX_PARTS;
      vX[i] = (Math.random() - 0.5) * 0.018;
      vY[i] = 0.005 + Math.random() * 0.012;
      vZ[i] = (Math.random() - 0.5) * 0.018;
      life[i] = maxLife[i] = 0.60 + Math.random() * 0.60;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.28;
      posArr[i * 3 + 1] = py;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.28;
    }
  }

  function screenShake() {
    const cvs = renderer.domElement;
    let n = 0;
    const id = setInterval(() => {
      const f = 1 - n / 9;
      cvs.style.transform =
        `translate(${(Math.random() - 0.5) * 7 * f}px,${(Math.random() - 0.5) * 7 * f}px)`;
      if (++n >= 9) { clearInterval(id); cvs.style.transform = ''; }
    }, 28);
  }

  // ── Animation loop ───────────────────────────────────────────────────────────
  const  t0       = performance.now();
  let    prevNow  = t0;
  let    impacted = false;
  let    doneAt   = Infinity;
  const  _fwd     = new THREE.Vector3(0, 0, 1);   // javelin's local forward axis
  const  _tangent = new THREE.Vector3();           // reused — avoids per-frame allocation

  function tick(now) {
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    if (!impacted) {
      const t = Math.min(1, (now - t0) / TRAVEL_MS);

      javGrp.position.lerpVectors(start, end, t);
      javGrp.position.y += Math.sin(t * Math.PI) * ARC_HEIGHT;

      // Nose follows the arc tangent, so it noses over and comes down point-first.
      _tangent.set(
        end.x - start.x,
        (end.y - start.y) + Math.PI * ARC_HEIGHT * Math.cos(t * Math.PI),
        end.z - start.z,
      ).normalize();
      javGrp.quaternion.setFromUnitVectors(_fwd, _tangent);

      if (Math.random() < 0.45) emitTrail(
        javGrp.position.x, javGrp.position.y, javGrp.position.z,
      );

      if (t >= 1) {
        impacted = true;
        scene.remove(javGrp);
        javGrp.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });

        emitImpact(end.x, end.y, end.z);
        playSound('arrow_hit');
        screenShake();
        doneAt = now + 1700;
        if (onImpact) onImpact();
      }
    }

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
      vY[i] -= 0.0016;   // gravity — heavier than the arrow's 0.0012
      const f = Math.max(0, life[i] / maxLife[i]);
      // Earthy clod/dust tone
      colArr[i * 3]     = 0.48 * f + 0.06;
      colArr[i * 3 + 1] = 0.38 * f + 0.05;
      colArr[i * 3 + 2] = 0.24 * f + 0.03;
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
