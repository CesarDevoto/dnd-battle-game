// js/healingWord.js — visual effect for Leugren's Healing Word
import * as THREE from 'three';
import { scene, camera } from './scene.js';
import { playSound } from './audio.js';

const TRAVEL_MS  = 950;
const MAX_SPARKS = 140;

let _healLight = null;
export function initHealingWordLight() {
  _healLight = new THREE.PointLight(0x44ccff, 0, 12);
  _healLight.position.set(0, -9999, 0);
  scene.add(_healLight);
}

export function playHealingWordEffect(attacker, target, onImpact) {
  const start = new THREE.Vector3(
    attacker.grp.position.x,
    attacker.grp.position.y + 1.15,
    attacker.grp.position.z,
  );
  const end = new THREE.Vector3(
    target.grp.position.x,
    target.grp.position.y + 0.9,
    target.grp.position.z,
  );

  // ── Pulse projectile ──────────────────────────────────────────────────────────
  const coreGeo  = new THREE.SphereGeometry(0.13, 12, 12);
  const coreMat  = new THREE.MeshBasicMaterial({ color: 0xbbf0ff });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.frustumCulled = false;

  const outerGeo = new THREE.SphereGeometry(0.32, 12, 12);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x55ccff, transparent: true, opacity: 0.38,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  coreMesh.add(new THREE.Mesh(outerGeo, outerMat));

  const projLight = _healLight;
  projLight.intensity = 2.2;
  projLight.distance  = 12;
  projLight.position.copy(start);
  scene.add(coreMesh);
  coreMesh.position.copy(start);

  // ── Particle trail ────────────────────────────────────────────────────────────
  const posArr  = new Float32Array(MAX_SPARKS * 3);
  const colArr  = new Float32Array(MAX_SPARKS * 3);
  const vX      = new Float32Array(MAX_SPARKS);
  const vY      = new Float32Array(MAX_SPARKS);
  const vZ      = new Float32Array(MAX_SPARKS);
  const life    = new Float32Array(MAX_SPARKS);
  const maxLife = new Float32Array(MAX_SPARKS);
  let   pHead   = 0;

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setDrawRange(0, 0);

  const sparkMat = new THREE.PointsMaterial({
    size: 0.17, vertexColors: true,
    transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparkPts = new THREE.Points(sparkGeo, sparkMat);
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);

  function emit(px, py, pz, speed, lt, burst) {
    const i = pHead++ % MAX_SPARKS;
    const θ = Math.random() * Math.PI * 2;
    const sp = speed * (0.5 + Math.random());
    vX[i] = Math.cos(θ) * sp * (burst ? 0.8 : 0.25);
    vY[i] = burst
      ? 0.015 + Math.random() * 0.025
      : 0.008 + Math.random() * 0.012;
    vZ[i] = Math.sin(θ) * sp * (burst ? 0.8 : 0.25);
    life[i]    = lt;
    maxLife[i] = lt;
    posArr[i * 3]     = px + (Math.random() - 0.5) * 0.1;
    posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.1;
    posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.1;
  }

  // ── Plus sign ─────────────────────────────────────────────────────────────────
  // Two overlapping planes (vertical + horizontal bars) billboarded toward camera.
  let plusGrp = null;
  const plusMats = [];

  function spawnPlus() {
    plusGrp = new THREE.Group();
    plusGrp.position.copy(end);
    plusGrp.position.y += 0.2;

    const barLong = 0.88, barThick = 0.26;
    const matDef = {
      color: 0x55eeff,
      transparent: true, opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    };

    const vMat = new THREE.MeshBasicMaterial({ ...matDef });
    const hMat = new THREE.MeshBasicMaterial({ ...matDef });
    plusMats.push(vMat, hMat);

    const vBar = new THREE.Mesh(new THREE.PlaneGeometry(barThick, barLong), vMat);
    const hBar = new THREE.Mesh(new THREE.PlaneGeometry(barLong, barThick), hMat);
    vBar.frustumCulled = false;
    hBar.frustumCulled = false;

    plusGrp.add(vBar, hBar);
    scene.add(plusGrp);
  }

  // ── Main animation loop ───────────────────────────────────────────────────────
  let t0       = null;
  let prevNow  = null;
  let impacted = false;
  let doneAt   = Infinity;
  let plusAge  = 0;
  const PLUS_LIFE = 2.4;

  function tick(now) {
    if (t0 === null) { t0 = now; prevNow = now; }
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    // ─ Flying phase ─
    if (!impacted) {
      const t = Math.min(1, (now - t0) / TRAVEL_MS);
      coreMesh.position.lerpVectors(start, end, t);
      coreMesh.position.y += Math.sin(t * Math.PI) * 0.55;
      projLight.position.copy(coreMesh.position);

      const pulse = 1 + 0.18 * Math.sin(now * 0.048);
      outerMat.opacity    = 0.38 * pulse;
      projLight.intensity = 2.2 * pulse;

      if (Math.random() < 0.72) {
        emit(coreMesh.position.x, coreMesh.position.y, coreMesh.position.z,
             0.016, 0.20 + Math.random() * 0.14, false);
      }

      if (t >= 1) {
        impacted = true;
        scene.remove(coreMesh);
        coreMesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });

        for (let k = 0; k < 28; k++) {
          emit(end.x, end.y, end.z, 0.05 + Math.random() * 0.04, 0.55 + Math.random() * 0.45, true);
        }

        projLight.intensity = 5.5;
        projLight.distance  = 18;
        spawnPlus();
        playSound('healing');
        doneAt = now + (PLUS_LIFE + 0.6) * 1000;
        if (onImpact) onImpact();
      }
    } else {
      projLight.intensity = Math.max(0, projLight.intensity - dt * 9);
    }

    // ─ Plus rise ─
    if (plusGrp) {
      plusAge += dt;
      const frac = Math.min(1, plusAge / PLUS_LIFE);

      // Billboard toward camera
      plusGrp.quaternion.copy(camera.quaternion);
      // Follow target unit vertically so it rises relative to where it spawned
      plusGrp.position.x = target.grp.position.x;
      plusGrp.position.z = target.grp.position.z;
      plusGrp.position.y = end.y + 0.2 + frac * 2.2;

      // Ease-in rise, ease-out fade
      const alpha = 1 - frac * frac;
      plusMats.forEach(m => { m.opacity = alpha * 0.95; });

      if (frac >= 1) {
        scene.remove(plusGrp);
        plusGrp.traverse(c => { c.geometry?.dispose(); });
        plusMats.forEach(m => m.dispose());
        plusGrp = null;
      }
    }

    // ─ Particles ─
    const cnt = Math.min(pHead, MAX_SPARKS);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) { colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0; continue; }
      life[i] -= dt;
      posArr[i * 3]     += vX[i];
      posArr[i * 3 + 1] += vY[i];
      posArr[i * 3 + 2] += vZ[i];
      const f = Math.max(0, life[i] / maxLife[i]);
      colArr[i * 3]     = f * 0.30;  // R — low
      colArr[i * 3 + 1] = f * 0.85;  // G — medium
      colArr[i * 3 + 2] = f * 1.00;  // B — bright
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate    = true;
    sparkGeo.setDrawRange(0, cnt);

    if (now >= doneAt) {
      scene.remove(sparkPts);
      projLight.intensity = 0;
      projLight.position.set(0, -9999, 0);
      sparkGeo.dispose();
      sparkMat.dispose();
      return;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
