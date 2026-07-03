// js/sacredflame.js — golden radiant flame descending from above for Leugren's Sacred Flame cantrip
import * as THREE from 'three';
import { scene } from './scene.js';

// Pre-add permanently at intensity 0 — adding a light mid-scene recompiles
// every lit material (same shader-cache issue solved in firebolt.js/magicmissile.js).
let _light = null;
export function initSacredFlameLight() {
  _light = new THREE.PointLight(0xffdd88, 0, 12);
  _light.position.set(0, -9999, 0);
  scene.add(_light);
}

const DESCEND_MS = 550;   // ms for the beam to descend onto the target
const HOLD_MS    = 260;   // ms the beam lingers at full length before fading
const FADE_MS    = 500;
const BEAM_H     = 6.2;   // world units the beam spans above the target
const MAX_PARTS  = 200;

export function playSacredFlameEffect(caster, target, onImpact) {
  const end = new THREE.Vector3(
    target.grp.position.x,
    target.grp.position.y + 0.05,
    target.grp.position.z,
  );
  const topY = end.y + BEAM_H;

  // ── Beam group — pivoted at its top so scaling grows it downward ──────────────
  const beamGrp = new THREE.Group();
  beamGrp.position.set(end.x, topY, end.z);
  scene.add(beamGrp);

  const coreGeo = new THREE.CylinderGeometry(0.34, 0.16, BEAM_H, 10, 1, true);
  coreGeo.translate(0, -BEAM_H / 2, 0);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff2b0, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  beamGrp.add(coreMesh);

  const haloGeo = new THREE.CylinderGeometry(0.62, 0.30, BEAM_H, 10, 1, true);
  haloGeo.translate(0, -BEAM_H / 2, 0);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xffaa33, transparent: true, opacity: 0.28,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  beamGrp.add(haloMesh);

  beamGrp.scale.y = 0.001;

  const light = _light;
  light.position.set(end.x, end.y + 1.2, end.z);
  light.intensity = 0;

  // ── Particle buffer — rising embers along the beam + impact burst ─────────────
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
    size: 0.16, vertexColors: true, transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const partPts = new THREE.Points(partGeo, partMat);
  scene.add(partPts);

  function emitEmber(px, py, pz, burst) {
    const i  = pHead++ % MAX_PARTS;
    const θ  = Math.random() * Math.PI * 2;
    const sp = burst ? 0.05 + Math.random() * 0.07 : 0.012 + Math.random() * 0.012;
    vX[i] = Math.cos(θ) * sp;
    vY[i] = burst ? 0.02 + Math.random() * 0.05 : 0.02 + Math.random() * 0.02;
    vZ[i] = Math.sin(θ) * sp;
    life[i] = maxLife[i] = burst ? 0.45 + Math.random() * 0.45 : 0.30 + Math.random() * 0.25;
    posArr[i * 3]     = px + (Math.random() - 0.5) * 0.22;
    posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.10;
    posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.22;
  }

  // ── Ground shockwave ring on impact ────────────────────────────────────────────
  let swMesh = null, swMat = null, swGeo = null, swT = 0;
  function spawnShockwave() {
    swGeo  = new THREE.RingGeometry(0.05, 0.28, 40);
    swMat  = new THREE.MeshBasicMaterial({
      color: 0xffcc55, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    swMesh = new THREE.Mesh(swGeo, swMat);
    swMesh.rotation.x = -Math.PI / 2;
    swMesh.position.set(end.x, end.y + 0.06, end.z);
    scene.add(swMesh);
  }

  let t0 = null, prevNow = null, landed = false, doneAt = Infinity;

  function tick(now) {
    if (t0 === null) { t0 = now; prevNow = now; }
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    if (!landed) {
      const t = Math.min(1, (now - t0) / DESCEND_MS);
      const flicker = 1 + 0.10 * Math.sin(now * 0.045) + (Math.random() - 0.5) * 0.05;
      beamGrp.scale.y = Math.max(0.001, t * flicker);
      coreMat.opacity = 0.55 * (0.7 + 0.3 * Math.sin(now * 0.05));
      haloMat.opacity = 0.28 * (0.7 + 0.3 * Math.cos(now * 0.045));
      light.intensity = 2.2 * t;

      // Embers licking upward along the visible portion of the beam
      if (Math.random() < 0.6) {
        const ey = end.y + Math.random() * BEAM_H * t;
        emitEmber(end.x, ey, end.z, false);
      }

      if (t >= 1) {
        landed = true;
        light.intensity = 4.5;
        for (let k = 0; k < 26; k++) emitEmber(end.x, end.y + 0.2, end.z, true);
        spawnShockwave();
        doneAt = now + HOLD_MS + FADE_MS + 400;
        if (onImpact) onImpact();
      }
    } else {
      const heldT = now - (t0 + DESCEND_MS);
      if (heldT > HOLD_MS) {
        const fadeT = Math.min(1, (heldT - HOLD_MS) / FADE_MS);
        coreMat.opacity = 0.55 * (1 - fadeT);
        haloMat.opacity = 0.28 * (1 - fadeT);
        light.intensity = Math.max(0, 4.5 * (1 - fadeT));
      }
    }

    if (swMesh) {
      swT += dt;
      const sf = Math.min(1, swT / 0.5);
      swMesh.scale.setScalar(1 + sf * 9);
      swMat.opacity = 0.85 * (1 - sf * sf);
      if (sf >= 1) { scene.remove(swMesh); swGeo.dispose(); swMat.dispose(); swMesh = null; }
    }

    const cnt = Math.min(pHead, MAX_PARTS);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) { colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0; continue; }
      life[i] -= dt;
      posArr[i * 3]     += vX[i];
      posArr[i * 3 + 1] += vY[i];
      posArr[i * 3 + 2] += vZ[i];
      vY[i] -= 0.0008;
      const f = Math.max(0, life[i] / maxLife[i]);
      colArr[i * 3]     = 1.0;
      colArr[i * 3 + 1] = 0.65 + f * 0.35;
      colArr[i * 3 + 2] = 0.20 * f;
    }
    partGeo.attributes.position.needsUpdate = true;
    partGeo.attributes.color.needsUpdate    = true;
    partGeo.setDrawRange(0, cnt);

    if (now >= doneAt) {
      scene.remove(beamGrp);
      coreGeo.dispose(); coreMat.dispose();
      haloGeo.dispose(); haloMat.dispose();
      scene.remove(partPts);
      partGeo.dispose(); partMat.dispose();
      light.intensity = 0;
      light.position.set(0, -9999, 0);
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
