// js/magicmissile.js — 4 neon purple magic-missile bolts for Rasec
import * as THREE from 'three';
import { scene } from './scene.js';

const MISSILE_COUNT = 4;
const TRAVEL_MS     = 1400;  // ms per bolt to reach target
const STAGGER_MS    = 420;   // launch delay between successive bolts
const MAX_PARTS     = 320;   // shared ring-buffer for all trails + impact bursts

export function playMagicMissileEffect(attacker, target, onImpact) {
  const origin = new THREE.Vector3(
    attacker.grp.position.x,
    attacker.grp.position.y + 1.18,
    attacker.grp.position.z,
  );
  const dest = new THREE.Vector3(
    target.grp.position.x,
    target.grp.position.y + 0.75,
    target.grp.position.z,
  );

  // ── Shared particle buffer (trails + impact bursts for all bolts) ─────────────
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
    size: 0.18, vertexColors: true,
    transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const partPts = new THREE.Points(partGeo, partMat);
  scene.add(partPts);

  function emitTrail(px, py, pz) {
    const i = pHead++ % MAX_PARTS;
    vX[i] = (Math.random() - 0.5) * 0.016;
    vY[i] = 0.009 + Math.random() * 0.014;
    vZ[i] = (Math.random() - 0.5) * 0.016;
    life[i] = maxLife[i] = 0.15 + Math.random() * 0.13;
    posArr[i * 3]     = px + (Math.random() - 0.5) * 0.09;
    posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.09;
    posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.09;
  }

  function emitImpact(px, py, pz) {
    // Radial burst — neon pink/purple sparks
    for (let k = 0; k < 18; k++) {
      const i = pHead++ % MAX_PARTS;
      const θ = Math.random() * Math.PI * 2;
      const sp = 0.042 + Math.random() * 0.058;
      vX[i] = Math.cos(θ) * sp;
      vY[i] = 0.016 + Math.random() * 0.050;
      vZ[i] = Math.sin(θ) * sp;
      life[i] = maxLife[i] = 0.30 + Math.random() * 0.45;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.10;
      posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.08;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.10;
    }
    // Slow drifting wisps
    for (let k = 0; k < 7; k++) {
      const i = pHead++ % MAX_PARTS;
      vX[i] = (Math.random() - 0.5) * 0.014;
      vY[i] = 0.008 + Math.random() * 0.014;
      vZ[i] = (Math.random() - 0.5) * 0.014;
      life[i] = maxLife[i] = 0.55 + Math.random() * 0.65;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.22;
      posArr[i * 3 + 1] = py;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.22;
    }
  }

  // ── Build 4 arrow groups (all sub-meshes oriented along local +Z) ─────────────
  const missiles = [];

  for (let m = 0; m < MISSILE_COUNT; m++) {
    const grp = new THREE.Group();

    // Inner shaft — solid neon violet
    const shaftGeo = new THREE.CylinderGeometry(0.016, 0.020, 0.68, 5);
    shaftGeo.rotateX(Math.PI / 2);
    grp.add(new THREE.Mesh(shaftGeo,
      new THREE.MeshBasicMaterial({ color: 0xdd44ff })));

    // Outer halo around shaft — wider, additive glow
    const haloGeo = new THREE.CylinderGeometry(0.046, 0.046, 0.68, 5);
    haloGeo.rotateX(Math.PI / 2);
    grp.add(new THREE.Mesh(haloGeo,
      new THREE.MeshBasicMaterial({
        color: 0x9900cc, transparent: true, opacity: 0.28,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })));

    // Bright cone tip — hottest neon pink
    const headGeo = new THREE.ConeGeometry(0.036, 0.16, 5);
    headGeo.rotateX(Math.PI / 2);
    headGeo.translate(0, 0, 0.43);
    grp.add(new THREE.Mesh(headGeo,
      new THREE.MeshBasicMaterial({ color: 0xff88ff })));

    // Tip glow halo
    const tipHaloGeo = new THREE.ConeGeometry(0.068, 0.16, 5);
    tipHaloGeo.rotateX(Math.PI / 2);
    tipHaloGeo.translate(0, 0, 0.43);
    grp.add(new THREE.Mesh(tipHaloGeo,
      new THREE.MeshBasicMaterial({
        color: 0xee33ff, transparent: true, opacity: 0.22,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })));

    // Per-bolt point light
    const light = new THREE.PointLight(0xcc22ff, 2.4, 11);
    grp.add(light);

    grp.position.copy(origin);
    grp.visible = false;
    scene.add(grp);

    missiles.push({
      grp,
      light,
      t0:           performance.now() + m * STAGGER_MS,
      impacted:     false,
      arcH:         0.28 + Math.random() * 0.52,
      wobblePhase:  (m / MISSILE_COUNT) * Math.PI * 2,
    });
  }

  // ── Travel direction for corkscrew side-axis ──────────────────────────────────
  const travelDir = new THREE.Vector3().subVectors(dest, origin).normalize();
  const sideAxis  = new THREE.Vector3()
    .crossVectors(travelDir, new THREE.Vector3(0, 1, 0))
    .normalize();

  let hitCount = 0;
  let prevNow  = performance.now();
  let doneAt   = Infinity;
  const _fwd   = new THREE.Vector3(0, 0, 1);
  const _tan   = new THREE.Vector3();

  function tick(now) {
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    for (const ms of missiles) {
      if (ms.impacted) continue;
      if (now < ms.t0) continue;

      ms.grp.visible = true;
      const t = Math.min(1, (now - ms.t0) / TRAVEL_MS);

      // Parabolic arc
      ms.grp.position.lerpVectors(origin, dest, t);
      ms.grp.position.y += Math.sin(t * Math.PI) * ms.arcH;

      // Subtle magical corkscrew — fades out near target
      const wobble = Math.sin(t * Math.PI * 3.5 + ms.wobblePhase) * 0.10 * (1 - t * t);
      ms.grp.position.addScaledVector(sideAxis, wobble);

      // Orient tip along arc tangent
      _tan.set(
        dest.x - origin.x,
        (dest.y - origin.y) + Math.PI * ms.arcH * Math.cos(t * Math.PI),
        dest.z - origin.z,
      ).normalize();
      ms.grp.quaternion.setFromUnitVectors(_fwd, _tan);

      // Trail particles
      if (Math.random() < 0.70) emitTrail(ms.grp.position.x, ms.grp.position.y, ms.grp.position.z);

      // Pulse light intensity
      ms.light.intensity = 2.4 + 0.8 * Math.sin(now * 0.020 + ms.wobblePhase);

      if (t >= 1) {
        ms.impacted = true;
        scene.remove(ms.grp);
        ms.grp.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        emitImpact(dest.x, dest.y, dest.z);
        hitCount++;
        if (hitCount === MISSILE_COUNT) {
          doneAt = now + 2000;
          if (onImpact) onImpact();
        }
      }
    }

    // ── Particle update ───────────────────────────────────────────────────────
    const cnt = Math.min(pHead, MAX_PARTS);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) { colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0; continue; }
      life[i] -= dt;
      posArr[i * 3]     += vX[i];
      posArr[i * 3 + 1] += vY[i];
      posArr[i * 3 + 2] += vZ[i];
      vY[i] -= 0.0010;
      const f = Math.max(0, life[i] / maxLife[i]);
      // Neon pink → deep violet fade as particles age
      colArr[i * 3]     = 0.28 + f * 0.62;   // R: pink at full life, purple at end
      colArr[i * 3 + 1] = f * 0.10;           // G: barely any green
      colArr[i * 3 + 2] = 0.52 + f * 0.48;   // B: always blue-heavy
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
