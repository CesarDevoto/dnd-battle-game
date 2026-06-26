// js/morvathEffects.js — VFX for Morvath's Inflict Wounds and Grave Curse
import * as THREE from 'three';
import { scene, camera } from './scene.js';

// ── Shared skull canvas texture ───────────────────────────────────────────────
let _skullTex = null;
function _getSkullTex() {
  if (_skullTex) return _skullTex;
  const S   = 128;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d');

  // Cranium
  ctx.fillStyle = '#cc44ff';
  ctx.beginPath(); ctx.arc(64, 48, 40, 0, Math.PI * 2); ctx.fill();
  // Jaw block
  ctx.fillRect(28, 72, 72, 28);

  // Cut eye sockets, nose, and teeth gaps with destination-out
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.ellipse(46, 44, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(82, 44, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(64, 60, 8,  0, Math.PI * 2); ctx.fill();
  ctx.fillRect(36, 80, 12, 20);
  ctx.fillRect(56, 80, 12, 20);
  ctx.fillRect(76, 80, 12, 20);
  ctx.globalCompositeOperation = 'source-over';

  _skullTex = new THREE.CanvasTexture(cvs);
  return _skullTex;
}

// ── Inflict Wounds ────────────────────────────────────────────────────────────
// Phase 1: red sphere pulse expands from target chest and fades (~350 ms)
// Phase 2: red blood drop falls from above and splatters on landing
export function playInflictWoundsEffect(target) {
  const cx = target.grp.position.x;
  const cy = target.grp.position.y;
  const cz = target.grp.position.z;

  // ── Sphere pulse ─────────────────────────────────────────────────────────────
  const pulseGeo  = new THREE.SphereGeometry(0.15, 14, 10);
  const pulseMat  = new THREE.MeshBasicMaterial({
    color: 0xcc0000, transparent: true, opacity: 0.80,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
  pulseMesh.frustumCulled = false;
  pulseMesh.position.set(cx, cy + 0.9, cz);
  scene.add(pulseMesh);

  // ── Blood drop ───────────────────────────────────────────────────────────────
  const dropGeo  = new THREE.SphereGeometry(0.11, 8, 8);
  const dropMat  = new THREE.MeshBasicMaterial({ color: 0xff1111 });
  const dropMesh = new THREE.Mesh(dropGeo, dropMat);
  dropMesh.frustumCulled = false;

  // ── Splatter particles ────────────────────────────────────────────────────────
  const MAX_P  = 28;
  const posArr = new Float32Array(MAX_P * 3);
  const colArr = new Float32Array(MAX_P * 3);
  const vX     = new Float32Array(MAX_P);
  const vY     = new Float32Array(MAX_P);
  const vZ     = new Float32Array(MAX_P);
  const life   = new Float32Array(MAX_P);
  const maxL   = new Float32Array(MAX_P);
  let   pHead  = 0;

  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
  ptGeo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));
  ptGeo.setDrawRange(0, 0);
  const ptMat = new THREE.PointsMaterial({
    size: 0.13, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(ptGeo, ptMat);
  pts.frustumCulled = false;
  scene.add(pts);

  function splat(px, py, pz) {
    for (let k = 0; k < 18; k++) {
      const i   = pHead++ % MAX_P;
      const θ   = Math.random() * Math.PI * 2;
      const spd = 0.025 + Math.random() * 0.045;
      vX[i] = Math.cos(θ) * spd;
      vY[i] = 0.008 + Math.random() * 0.018;
      vZ[i] = Math.sin(θ) * spd;
      life[i] = maxL[i] = 0.35 + Math.random() * 0.30;
      posArr[i * 3]     = px + (Math.random() - 0.5) * 0.06;
      posArr[i * 3 + 1] = py;
      posArr[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.06;
    }
  }

  const PULSE_MS  = 360;
  let   t0        = null;
  let   prevNow   = null;
  let   dropPhase = false;
  let   dropY     = cy + 2.9;
  let   dropVY    = 0;
  let   dropDone  = false;
  let   doneAt    = Infinity;

  function tick(now) {
    if (t0 === null) { t0 = now; prevNow = now; }
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;

    // ─ Pulse expand ─
    if (!dropPhase) {
      const pf = Math.min(1, (now - t0) / PULSE_MS);
      pulseMesh.scale.setScalar(1 + pf * 16);
      pulseMat.opacity = 0.80 * (1 - pf * pf);
      if (pf >= 1) {
        dropPhase = true;
        scene.remove(pulseMesh);
        pulseGeo.dispose(); pulseMat.dispose();
        dropMesh.position.set(cx, dropY, cz);
        scene.add(dropMesh);
        doneAt = now + 1600;
      }
    }

    // ─ Drop fall ─
    if (dropPhase && !dropDone) {
      dropVY -= 0.009;
      dropY  += dropVY;
      const FLOOR = cy + 0.55;
      if (dropY <= FLOOR) {
        dropY   = FLOOR;
        dropDone = true;
        scene.remove(dropMesh);
        dropGeo.dispose(); dropMat.dispose();
        splat(cx, FLOOR, cz);
      }
      dropMesh.position.y = dropY;
    }

    // ─ Splatter particles ─
    const cnt = Math.min(pHead, MAX_P);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) { colArr[i*3] = colArr[i*3+1] = colArr[i*3+2] = 0; continue; }
      life[i] -= dt;
      posArr[i*3]   += vX[i];
      posArr[i*3+1] += vY[i];
      posArr[i*3+2] += vZ[i];
      vY[i] -= 0.0012;
      const f = Math.max(0, life[i] / maxL[i]);
      colArr[i*3]   = Math.min(1, f * 1.3);  // R
      colArr[i*3+1] = 0;                      // G
      colArr[i*3+2] = 0;                      // B
    }
    ptGeo.attributes.position.needsUpdate = true;
    ptGeo.attributes.color.needsUpdate    = true;
    ptGeo.setDrawRange(0, cnt);

    if (now >= doneAt) {
      scene.remove(pts);
      ptGeo.dispose(); ptMat.dispose();
      return;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ── Grave Curse ───────────────────────────────────────────────────────────────
// Per affected hero: purple ground ring pulse + skull billboards rising with sway
export function playGraveCurseEffect(target) {
  const cx = target.grp.position.x;
  const cy = target.grp.position.y;
  const cz = target.grp.position.z;
  const tex = _getSkullTex();

  // ── Ground ring ───────────────────────────────────────────────────────────────
  const ringGeo  = new THREE.RingGeometry(0.1, 0.5, 32);
  const ringMat  = new THREE.MeshBasicMaterial({
    color: 0x9911dd, side: THREE.DoubleSide,
    transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(cx, cy + 0.05, cz);
  ringMesh.frustumCulled = false;
  scene.add(ringMesh);
  let ringDone = false;

  // ── Skull billboards ──────────────────────────────────────────────────────────
  const N      = 4;
  const RISE_S = 1.4;
  const skulls = [];
  for (let k = 0; k < N; k++) {
    const angle  = (k / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const radius = 0.15 + Math.random() * 0.30;
    const offX   = Math.cos(angle) * radius;
    const offZ   = Math.sin(angle) * radius;
    const size   = 0.38 + Math.random() * 0.22;
    const riseSp = 0.75 + Math.random() * 0.50;
    const delay  = Math.random() * 0.25;
    const geo    = new THREE.PlaneGeometry(size, size);
    const mat    = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.position.set(cx + offX, cy + 0.1, cz + offZ);
    scene.add(mesh);
    skulls.push({ mesh, mat, geo, offX, offZ, riseSp, delay });
  }

  let prevNow  = null;
  let startNow = null;
  let ringT    = 0;
  const DONE_S = RISE_S + 0.4;
  let   doneAt = Infinity;

  function tick(now) {
    if (prevNow === null) { prevNow = now; startNow = now; doneAt = now + DONE_S * 1000; }
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;
    const elapsed = (now - startNow) / 1000;

    // ─ Ground ring expand & fade ─
    if (!ringDone) {
      ringT += dt;
      const rf = Math.min(1, ringT / 0.45);
      ringMesh.scale.setScalar(1 + rf * 9);
      ringMat.opacity = 0.9 * (1 - rf);
      if (rf >= 1) {
        ringDone = true;
        scene.remove(ringMesh);
        ringGeo.dispose(); ringMat.dispose();
      }
    }

    // ─ Skulls rise, billboard, sway ─
    for (const s of skulls) {
      const age = elapsed - s.delay;
      if (age < 0) continue;
      const frac  = Math.min(1, age / (RISE_S * s.riseSp));
      const riseY = cy + 0.1 + frac * 2.4;
      const swayX = Math.sin(age * 3.0) * 0.10;
      s.mesh.position.set(cx + s.offX + swayX, riseY, cz + s.offZ);
      s.mesh.quaternion.copy(camera.quaternion);
      // Fade in first 25%, hold, fade out last 40%
      const alpha = frac < 0.25 ? frac / 0.25
                  : frac < 0.60 ? 1.0
                  : 1 - (frac - 0.60) / 0.40;
      s.mat.opacity = Math.max(0, alpha * 0.92);
    }

    if (now >= doneAt) {
      for (const s of skulls) {
        scene.remove(s.mesh);
        s.geo.dispose(); s.mat.dispose();
      }
      return;
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
