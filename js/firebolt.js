// js/firebolt.js — cinematic visual effect for Rasec's Fire Bolt cantrip
import * as THREE from 'three';
import { scene, renderer, camera } from './scene.js';
import { playSound } from './audio.js';

const TRAVEL_MS  = 1050;  // ms for bolt to reach target
const MAX_SPARKS = 200;   // ring-buffer capacity

// Keep permanent sub-pixel objects in the scene so firebolt shader variants are
// compiled on the very first game frame and never evicted. All prewarm attempts
// (render-target, scissor, deferred post-zone-load) failed because Three.js keyed
// the compiled program on scene/renderer state that differed at prewarm time vs
// cast time. Keeping live objects avoids that entirely — shaders stay warm every frame.
export function prewarmEffectShaders() {
  const sphGeo   = new THREE.SphereGeometry(0.001, 3, 2);
  const ringGeo  = new THREE.RingGeometry(0.0001, 0.001, 6);
  const planeGeo = new THREE.PlaneGeometry(0.001, 0.001);
  const ptGeo    = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  ptGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(3), 3));

  const warmObjects = [
    new THREE.Mesh(sphGeo,
      new THREE.MeshBasicMaterial({ color: 0xffee66 })),
    new THREE.Mesh(sphGeo,
      new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    new THREE.Mesh(ringGeo,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    new THREE.Mesh(planeGeo,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })),
    new THREE.Points(ptGeo,
      new THREE.PointsMaterial({ size: 0.001, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true })),
  ];

  warmObjects.forEach(o => {
    o.position.set(0, -9999, 0);  // far below terrain, invisible
    o.frustumCulled = false;       // always submitted so shader stays compiled
    scene.add(o);
  });
  // Intentionally not disposed — these stay in the scene permanently.
}

export function playFireboltEffect(attacker, target, onImpact) {
  playSound('fire_bolt');

  const start = new THREE.Vector3(
    attacker.grp.position.x,
    attacker.grp.position.y + 1.15,
    attacker.grp.position.z,
  );
  const end = new THREE.Vector3(
    target.grp.position.x,
    target.grp.position.y + 0.75,
    target.grp.position.z,
  );

  // ── Projectile core ──────────────────────────────────────────────────────────
  const coreGeo  = new THREE.SphereGeometry(0.12, 10, 10);
  const coreMat  = new THREE.MeshBasicMaterial({ color: 0xffee66 });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.frustumCulled = false;

  const outerGeo  = new THREE.SphereGeometry(0.30, 10, 10);
  const outerMat  = new THREE.MeshBasicMaterial({
    color: 0xff5500, transparent: true, opacity: 0.50,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  coreMesh.add(new THREE.Mesh(outerGeo, outerMat));

  const projLight = new THREE.PointLight(0xff8800, 3.0, 14);
  scene.add(projLight);
  scene.add(coreMesh);
  coreMesh.position.copy(start);
  projLight.position.copy(start);

  // ── Spark particle system ────────────────────────────────────────────────────
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
    size: 0.22, vertexColors: true,
    transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparkPts = new THREE.Points(sparkGeo, sparkMat);
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);

  function emit(px, py, pz, speed, lt, burst) {
    const i  = pHead++ % MAX_SPARKS;
    const θ  = Math.random() * Math.PI * 2;
    const sp = speed * (0.5 + Math.random());
    vX[i] = Math.cos(θ) * sp * (burst ? 1.0 : 0.35);
    vY[i] = burst
      ? Math.abs(Math.sin(θ)) * sp + 0.025
      : 0.016 + Math.random() * 0.022;
    vZ[i] = Math.sin(θ) * sp * (burst ? 1.0 : 0.35);
    life[i]    = lt;
    maxLife[i] = lt;
    posArr[i * 3]     = px + (Math.random() - 0.5) * 0.12;
    posArr[i * 3 + 1] = py + (Math.random() - 0.5) * 0.12;
    posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.12;
  }

  // ── Impact shockwave ring ────────────────────────────────────────────────────
  let swMesh = null, swMat = null, swGeo = null, swT = 0;

  function spawnShockwave() {
    swGeo  = new THREE.RingGeometry(0.05, 0.30, 48);
    swMat  = new THREE.MeshBasicMaterial({
      color: 0xff7722, side: THREE.DoubleSide,
      transparent: true, opacity: 0.88,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    swMesh = new THREE.Mesh(swGeo, swMat);
    swMesh.position.copy(end);
    const dir = new THREE.Vector3().subVectors(end, start).normalize();
    swMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    scene.add(swMesh);
  }

  // ── Flash overlay ────────────────────────────────────────────────────────────
  const flash = document.createElement('div');
  flash.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9999;opacity:0;' +
    'background:radial-gradient(ellipse at 50% 50%,' +
      'rgba(255,230,100,0.92) 0%,rgba(255,90,0,0.60) 38%,' +
      'rgba(200,40,0,0.22) 62%,transparent 78%)';
  document.body.appendChild(flash);

  // ── Screen shake (CSS canvas translate — no Three.js camera conflict) ────────
  function screenShake() {
    const cvs = renderer.domElement;
    let n = 0;
    const id = setInterval(() => {
      const f = 1 - n / 11;
      cvs.style.transform =
        `translate(${(Math.random() - 0.5) * 9 * f}px,${(Math.random() - 0.5) * 9 * f}px)`;
      if (++n >= 11) { clearInterval(id); cvs.style.transform = ''; }
    }, 30);
  }

  // ── Main animation loop ──────────────────────────────────────────────────────
  // t0 is initialized on the first tick rather than at call time so GPU shader
  // compilation stalls (first use only) don't cause t to jump past TRAVEL_MS.
  let    t0       = null;
  let    prevNow  = null;
  let    impacted = false;
  let    doneAt   = Infinity;
  let    travelT  = 0;   // 0‥1, delta-driven so GPU stalls can't skip the bolt

  function tick(now) {
    if (t0 === null) { t0 = now; prevNow = now; }
    const dt = Math.min((now - prevNow) / 1000, 0.05);  // cap at 50 ms
    prevNow = now;

    // ─ Flying phase ─
    if (!impacted) {
      travelT = Math.min(1, travelT + dt / (TRAVEL_MS / 1000));
      const t = travelT;
      coreMesh.position.lerpVectors(start, end, t);
      coreMesh.position.y += Math.sin(t * Math.PI) * 0.38;
      projLight.position.copy(coreMesh.position);

      coreMesh.rotation.z += 0.18;
      coreMesh.rotation.x += 0.12;

      // Trail sparks — rate ramps as bolt speeds up
      if (Math.random() < 0.78 + t * 0.44) {
        emit(coreMesh.position.x, coreMesh.position.y, coreMesh.position.z,
             0.022, 0.24 + Math.random() * 0.20, false);
      }

      const pulse    = 1 + 0.20 * Math.sin(now * 0.055);
      outerMat.opacity    = 0.48 * pulse;
      projLight.intensity = 3.0 * pulse;

      if (t >= 1) {
        // ─ Impact ─
        impacted = true;
        scene.remove(coreMesh);
        coreMesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });

        // Radial burst sparks
        for (let k = 0; k < 40; k++) {
          emit(end.x, end.y, end.z, 0.075 + Math.random() * 0.070, 0.60 + Math.random() * 0.60, true);
        }
        // Slow-float embers
        for (let k = 0; k < 20; k++) {
          emit(end.x, end.y, end.z, 0.022, 1.20 + Math.random() * 1.00, true);
        }

        flash.style.transition = 'none';
        flash.style.opacity    = '1';
        requestAnimationFrame(() => {
          flash.style.transition = 'opacity 0.65s ease-out';
          flash.style.opacity    = '0';
        });

        projLight.intensity = 9.0;
        projLight.distance  = 26;
        screenShake();
        spawnShockwave();
        doneAt = now + 2600;

        if (onImpact) onImpact();
      }
    } else {
      projLight.intensity = Math.max(0, projLight.intensity - dt * 14);
    }

    // ─ Shockwave expansion ─
    if (swMesh) {
      swT += dt;
      const sf = Math.min(1, swT / 0.55);
      swMesh.scale.setScalar(1 + sf * 18);
      swMat.opacity = 0.88 * (1 - sf * sf);
      if (sf >= 1) {
        scene.remove(swMesh);
        swGeo.dispose(); swMat.dispose();
        swMesh = null;
      }
    }

    // ─ Particle update ─
    const cnt = Math.min(pHead, MAX_SPARKS);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) { colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0; continue; }
      life[i] -= dt;
      posArr[i * 3]     += vX[i];
      posArr[i * 3 + 1] += vY[i];
      posArr[i * 3 + 2] += vZ[i];
      vY[i] -= 0.0015;
      const f           = Math.max(0, life[i] / maxLife[i]);
      colArr[i * 3]     = Math.min(1, f * 2);
      colArr[i * 3 + 1] = Math.max(0, f * 0.7 - 0.2);
      colArr[i * 3 + 2] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate    = true;
    sparkGeo.setDrawRange(0, cnt);

    // ─ Final cleanup ─
    if (now >= doneAt) {
      scene.remove(sparkPts);
      scene.remove(projLight);
      sparkGeo.dispose();
      sparkMat.dispose();
      flash.remove();
      return;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
