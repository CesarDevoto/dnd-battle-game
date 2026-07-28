// js/burningHands.js — the fan of fire for Rasec's Burning Hands cone
//
// Seven Fire Bolt-style projectiles sprayed across the cone at once. Built on firebolt.js's
// structure deliberately (same core + additive shell + ring-buffer trail sparks) so the two
// spells read as the same wizard's fire, but with three changes that matter at seven-at-once:
//
//   • NO screen shake, NO full-screen flash, NO point light. Fire Bolt earns all three as a
//     single dramatic hit; seven of them would be a strobe, and seven PointLights would
//     recompile every lit material in the scene (the shader-cache trap firebolt.js documents
//     at the top of the file). Everything here is additive geometry, which stays cheap.
//   • Slower travel. Fire Bolt crosses the whole board in 1050 ms; these cross 15 ft in 1500,
//     so you can actually watch them leave his hands and spread.
//   • Bolts land on the cone's flat FAR EDGE, not on a arc — each one's travel distance is
//     divided by cos(its angle), so the outer bolts go proportionally further and the seven
//     endpoints form the straight line that closes the triangle. That is what makes the fan
//     match the lit squares instead of falling short at the corners.
//
// Every geometry/material combination here is one prewarmEffectShaders() already keeps compiled,
// so the first cast doesn't stall on shader compilation.

import * as THREE from 'three';
import { scene } from './scene.js';
import { playSound } from './audio.js';
import { combatSpeed } from './combatSpeed.js';

const BOLTS        = 7;
const TRAVEL_MS    = 1500;   // deliberately slow — the spread IS the effect

// When the FIRST bolt lands, and therefore when damage should start appearing. Exported so
// combat.js schedules its saves off the same number the animation uses — hard-coding 1000 here
// and 1500 there is exactly how a retimed effect ends up dealing damage before the fire arrives.
// ⚠ Caveat: the flight is combatSpeed()-scaled and combat.js's setTimeouts are not (the
// project-wide convention for damage staggers), so at >1x speed the bolts land slightly early.
export const BURNING_HANDS_IMPACT_MS = TRAVEL_MS;
const STAGGER_MS   = 55;     // launch gap, so they leave his hands as a sweep not a wall
const MAX_SPARKS   = 420;    // ring-buffer capacity across ALL bolts
const HALF_WIDTH   = 0.5;    // 5e cone: width at distance d == d, so half-width == d/2

export function playBurningHandsEffect(caster, dx, dz, lenWU, onDone = null) {
  // One sound for the whole fan, not seven. fire_bolt is a stand-in until Burning Hands has its
  // own — seven layered copies of it would clip the mixer.
  playSound('fire_bolt');

  const ox = caster.grp.position.x;
  const oy = caster.grp.position.y + 1.15;   // hand height
  const oz = caster.grp.position.z;
  const start = new THREE.Vector3(ox, oy, oz);

  // Perpendicular to the cone axis, in the ground plane.
  const px = -dz, pz = dx;

  // ── Bolts ───────────────────────────────────────────────────────────────────
  // f walks -1 → +1 across the cone's full width. The endpoint is on the far edge:
  // axis * len + perp * (f * len/2). Distance therefore grows with |f|, which is the
  // 1/cos(angle) the header describes, without needing the trig.
  const bolts = [];
  for (let i = 0; i < BOLTS; i++) {
    const f = BOLTS === 1 ? 0 : (i / (BOLTS - 1)) * 2 - 1;
    const lateral = f * lenWU * HALF_WIDTH;
    const end = new THREE.Vector3(
      ox + dx * lenWU + px * lateral,
      oy - 0.45,                                  // drift down to roughly chest height on arrival
      oz + dz * lenWU + pz * lateral,
    );

    const coreMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffee66 }),
    );
    coreMesh.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff5500, transparent: true, opacity: 0.50,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    ));
    coreMesh.frustumCulled = false;
    coreMesh.position.copy(start);
    scene.add(coreMesh);

    bolts.push({
      mesh: coreMesh,
      end,
      t: 0,
      delay: (i * STAGGER_MS) / 1000,   // seconds; counted down before it launches
      done: false,
    });
  }

  // ── Shared trail/burst sparks ───────────────────────────────────────────────
  // One ring buffer for all seven, so the particle cost is fixed no matter the bolt count.
  const posArr  = new Float32Array(MAX_SPARKS * 3);
  const colArr  = new Float32Array(MAX_SPARKS * 3);
  const vX = new Float32Array(MAX_SPARKS);
  const vY = new Float32Array(MAX_SPARKS);
  const vZ = new Float32Array(MAX_SPARKS);
  const life    = new Float32Array(MAX_SPARKS);
  const maxLife = new Float32Array(MAX_SPARKS);
  let   pHead   = 0;

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setDrawRange(0, 0);

  const sparkMat = new THREE.PointsMaterial({
    size: 0.20, vertexColors: true,
    transparent: true, opacity: 1.0,
    depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparkPts = new THREE.Points(sparkGeo, sparkMat);
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);

  function emit(x, y, z, speed, lt, burst) {
    const i  = pHead++ % MAX_SPARKS;
    const th = Math.random() * Math.PI * 2;
    const sp = speed * (0.5 + Math.random());
    vX[i] = Math.cos(th) * sp * (burst ? 1.0 : 0.30);
    vY[i] = burst ? Math.abs(Math.sin(th)) * sp + 0.020 : 0.012 + Math.random() * 0.018;
    vZ[i] = Math.sin(th) * sp * (burst ? 1.0 : 0.30);
    life[i]    = lt;
    maxLife[i] = lt;
    posArr[i * 3]     = x + (Math.random() - 0.5) * 0.10;
    posArr[i * 3 + 1] = y + (Math.random() - 0.5) * 0.10;
    posArr[i * 3 + 2] = z + (Math.random() - 0.5) * 0.10;
  }

  // ── Loop ────────────────────────────────────────────────────────────────────
  // t0/prevNow initialised on the first tick, not at call time, so a one-off GPU stall can't
  // make the first frame's dt swallow the whole flight (the reason firebolt.js does the same).
  let prevNow  = null;
  let doneAt   = Infinity;
  let impacts  = 0;
  let notified = false;

  function tick(now) {
    if (prevNow === null) prevNow = now;
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;
    const sdt = dt * combatSpeed();

    for (const b of bolts) {
      if (b.done) continue;
      if (b.delay > 0) { b.delay -= sdt; continue; }

      b.t = Math.min(1, b.t + sdt / (TRAVEL_MS / 1000));
      b.mesh.position.lerpVectors(start, b.end, b.t);
      b.mesh.position.y += Math.sin(b.t * Math.PI) * 0.22;   // gentle arc
      b.mesh.rotation.z += 0.16;
      b.mesh.rotation.x += 0.10;

      if (Math.random() < 0.85) {
        emit(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z,
             0.018, 0.22 + Math.random() * 0.18, false);
      }

      if (b.t >= 1) {
        b.done = true;
        scene.remove(b.mesh);
        b.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
        for (let k = 0; k < 12; k++) {
          emit(b.end.x, b.end.y, b.end.z, 0.055 + Math.random() * 0.050, 0.45 + Math.random() * 0.45, true);
        }
        for (let k = 0; k < 6; k++) {
          emit(b.end.x, b.end.y, b.end.z, 0.018, 0.90 + Math.random() * 0.70, true);
        }
        // Last bolt down ends the effect — plus the ember tail, so nothing pops out mid-fade.
        if (++impacts === bolts.length) doneAt = now + 1600;
      }
    }

    // onDone fires when the FIRST bolt lands, not the last: it's the damage cue, and damage
    // should read as the fan connecting rather than waiting on the slowest ember.
    if (!notified && impacts > 0) { notified = true; onDone?.(); }

    const cnt = Math.min(pHead, MAX_SPARKS);
    for (let i = 0; i < cnt; i++) {
      if (life[i] <= 0) { colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0; continue; }
      life[i] -= dt;
      posArr[i * 3]     += vX[i];
      posArr[i * 3 + 1] += vY[i];
      posArr[i * 3 + 2] += vZ[i];
      vY[i] -= 0.0016;
      const f = Math.max(0, life[i] / maxLife[i]);
      colArr[i * 3]     = Math.min(1, f * 2);
      colArr[i * 3 + 1] = Math.max(0, f * 0.7 - 0.2);
      colArr[i * 3 + 2] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate    = true;
    sparkGeo.setDrawRange(0, cnt);

    if (now >= doneAt) {
      scene.remove(sparkPts);
      sparkGeo.dispose();
      sparkMat.dispose();
      // Safety net: if the effect is torn down early (zone change mid-cast), any bolt still in
      // flight would otherwise be orphaned in the scene.
      for (const b of bolts) {
        if (b.done) continue;
        scene.remove(b.mesh);
        b.mesh.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); });
      }
      if (!notified) onDone?.();
      return;
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
