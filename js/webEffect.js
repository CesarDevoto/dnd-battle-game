// js/webEffect.js — giant spider's Web attack visual: a white ball spat at the target, then
// a web splayed FLAT ON THE GROUND beneath it — a disk, not a billboard — that stays while
// the target is restrained (target.actionSave.key === 'web') and fades once it breaks free.
import * as THREE from 'three';
import { scene } from './scene.js';
import { getGroundHeight, caveLayersActive } from './terrain.js';
import { getSurfaceHeight } from './environments.js';

let _webTex = null;
function _getWebTex() {
  if (_webTex) return _webTex;
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 1.6;
  const spokes = 11, R = S / 2 - 5;
  for (let i = 0; i < spokes; i++) {          // radial threads
    const a = (i / spokes) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); ctx.stroke();
  }
  for (let r = R * 0.22; r < R; r += R * 0.19) { // concentric rings
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  }
  _webTex = new THREE.CanvasTexture(c);
  return _webTex;
}

// The spat projectile. A SpriteMaterial with NO map renders as a flat white SQUARE — which is
// what the spider was actually firing. This gives it a soft radial falloff so it reads as a
// round ball of webbing.
//
// AdditiveBlending + fog:false is deliberate and load-bearing: a CanvasTexture drawn with
// NormalBlending shows up as a black square, because the canvas alpha is premultiplied. Same
// trap the fog patches hit.
let _ballTex = null;
function _getBallTex() {
  if (_ballTex) return _ballTex;
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1.00)');   // hot core
  g.addColorStop(0.45, 'rgba(255,255,255,0.90)');
  g.addColorStop(0.75, 'rgba(235,240,255,0.35)');   // faint bluish-white halo
  g.addColorStop(1.00, 'rgba(220,230,255,0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _ballTex = new THREE.CanvasTexture(c);
  return _ballTex;
}

const _pos = (u) => (u.anchor ? u.anchor : u.grp.position);

const WEB_RADIUS = 1.9;    // WU — a bit wider than the unit it snares
const WEB_LIFT   = 0.06;   // above the ground, to beat z-fighting with the terrain
const WEB_SEGS   = 48;     // angular subdivisions
const WEB_RINGS  = 6;      // radial subdivisions — what lets the disk bend over terrain

// Surface height for the web, sampled exactly the way the combat rings do (combat.js
// _ringSurfaceH). In a CAVE zone the walkable surface is layer-dependent: getSurfaceHeight
// returns the carved floor UNDER the blanket, so using it there buries the web beneath the
// cave roof and the blanket clips it away. getGroundHeight with the target's own layer puts
// it on the blanket for a surface unit and on the tunnel floor for one that's underground.
// Non-cave zones keep getSurfaceHeight so the web still floats on a water plane.
function _webSurfaceH(x, z, layer) {
  return caveLayersActive() ? getGroundHeight(x, z, layer) : getSurfaceHeight(x, z);
}

// A radial disk whose every vertex is dropped onto the terrain, so the web drapes over
// slopes and bumps instead of intersecting them as a flat plate. Local X/Z are relative to
// the centre while Y is an ABSOLUTE world height — the same trick the combat rings use, so
// the mesh sits at (cx, 0, cz) and the baked Y lands correctly.
function _buildWebGeo(cx, cz, layer) {
  const verts = [], uvs = [], idx = [];
  verts.push(0, _webSurfaceH(cx, cz, layer) + WEB_LIFT, 0);
  uvs.push(0.5, 0.5);
  for (let r = 1; r <= WEB_RINGS; r++) {
    const rad = WEB_RADIUS * (r / WEB_RINGS);
    for (let i = 0; i < WEB_SEGS; i++) {
      const th = (i / WEB_SEGS) * Math.PI * 2;
      const dx = Math.cos(th) * rad, dz = Math.sin(th) * rad;
      verts.push(dx, _webSurfaceH(cx + dx, cz + dz, layer) + WEB_LIFT, dz);
      uvs.push(0.5 + 0.5 * (dx / WEB_RADIUS), 0.5 + 0.5 * (dz / WEB_RADIUS));
    }
  }
  const ringStart = r => 1 + (r - 1) * WEB_SEGS;   // first vertex index of radial ring r
  for (let i = 0; i < WEB_SEGS; i++) {             // centre fan
    idx.push(0, ringStart(1) + i, ringStart(1) + ((i + 1) % WEB_SEGS));
  }
  for (let r = 1; r < WEB_RINGS; r++) {            // quads between successive rings
    for (let i = 0; i < WEB_SEGS; i++) {
      const j = (i + 1) % WEB_SEGS;
      const a = ringStart(r) + i,     b = ringStart(r) + j;
      const c = ringStart(r + 1) + i, d = ringStart(r + 1) + j;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

// Re-drape the disk under `u`. Rebuilds rather than nudging a transform: the terrain under
// the target differs from wherever the geometry was last baked.
function _groundWeb(web, u) {
  const p = u.grp.position;
  web.geometry.dispose();
  web.geometry = _buildWebGeo(p.x, p.z, u.caveLayer ?? 'surface');
  web.position.set(p.x, 0, p.z);
}

export function playWebEffect(from, to) {
  const start = _pos(from).clone();

  const ball = new THREE.Sprite(new THREE.SpriteMaterial({
    map: _getBallTex(), color: 0xffffff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  ball.scale.setScalar(0.7);   // the radial falloff eats the outer edge, so it needs to be
                               // bigger than the old hard-edged square to read the same size
  ball.position.copy(start);
  ball.renderOrder = 10;       // don't let the cave-roof blanket paint over it in the Warrens
  scene.add(ball);

  // A ground DECAL, not a billboard: a terrain-conforming disk splayed across the dirt under
  // the target, rather than a poster hanging in the air facing the camera (what the Sprite
  // gave). The geometry is already built flat in world XZ, so no mesh rotation is needed.
  const web = new THREE.Mesh(
    _buildWebGeo(to.grp.position.x, to.grp.position.z, to.caveLayer ?? 'surface'),
    new THREE.MeshBasicMaterial({
      map: _getWebTex(), color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    }),
  );
  // Draw after the cave-roof blanket (a TRANSPARENT material at renderOrder 1) so the web is
  // never painted over by it — the same trap the loot labels fell into. Above the fog patches
  // (8) and vision blockers (9) too. depthTest stays on, so anything genuinely in front of
  // the web still occludes it.
  web.renderOrder = 10;
  web.position.set(to.grp.position.x, 0, to.grp.position.z);
  scene.add(web);

  const FLY = 0.28;
  let t = 0;
  (function step() {
    t += 0.016;
    if (t < FLY) {
      ball.position.lerpVectors(start, _pos(to), t / FLY);
    } else {
      ball.visible = false;
      // Web clings to the ground under the target while restrained, then fades once free.
      _groundWeb(web, to);
      if (to.actionSave?.key === 'web') web.material.opacity = Math.min(0.85, web.material.opacity + 0.07);
      else                  web.material.opacity -= 0.035;
    }
    if (t >= FLY && !to.actionSave?.key === 'web' && web.material.opacity <= 0) {
      scene.remove(ball); scene.remove(web);
      ball.material.dispose(); web.material.dispose();
      web.geometry.dispose();
      return;
    }
    requestAnimationFrame(step);
  })();
}
