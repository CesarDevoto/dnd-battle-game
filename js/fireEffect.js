// js/fireEffect.js — Emberheart Pendant's fire rider: a fast orange flare on the struck target
// with embers licking upward off it.
//
// Same rules as poisonEffect.js and the fog patches: AdditiveBlending + fog:false throughout, and
// ONE CanvasTexture shared across every sprite (built once, never disposed). A CanvasTexture drawn
// with NormalBlending renders as a black square (premultiplied canvas alpha), and minting a texture
// per cast is how a leak once ate a whole session's memory.
import * as THREE from 'three';
import { scene } from './scene.js';

const FIRE_CORE = 'rgba(255, 240, 170, ';   // near-white yellow centre
const FIRE_EDGE = 'rgba(255,  80,  20, ';   // deep ember orange at the rim

let _emberTex = null;
function _getEmberTex() {
  if (_emberTex) return _emberTex;
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, FIRE_CORE + '1.00)');
  g.addColorStop(0.45, FIRE_EDGE + '0.70)');
  g.addColorStop(1.00, FIRE_EDGE + '0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _emberTex = new THREE.CanvasTexture(c);
  return _emberTex;
}

const _pos = u => (u.anchor ? u.anchor : u.grp.position);

const EMBERS    = 16;
const LIFE      = 1.0;    // seconds — fire is quicker than venom vapour
const RISE      = 1.9;    // WU the embers climb over their life
const BURST_MAX = 1.7;    // WU — how wide the initial flare swells

// Call on a fire rider that lands. Fire-and-forget: cleans up its own scene objects.
export function playFireEffect(unit) {
  if (!unit?.grp) return;
  const origin = _pos(unit).clone();
  const tex    = _getEmberTex();
  const group  = new THREE.Group();

  // A single bright flare that swells and dies fast over the target.
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xffaa33, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  burst.scale.setScalar(0.6);
  burst.position.copy(origin);
  burst.renderOrder = 10;   // above the fog patches / vision blockers
  group.add(burst);

  // Embers licking up off the burn.
  const embers = [];
  for (let i = 0; i < EMBERS; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: i % 3 === 0 ? 0xffdd66 : 0xff6622, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    const a = Math.random() * Math.PI * 2;
    const r = 0.12 + Math.random() * 0.5;
    s.scale.setScalar(0.12 + Math.random() * 0.18);
    s.position.set(origin.x + Math.cos(a) * r, origin.y - 0.4 + Math.random() * 0.7, origin.z + Math.sin(a) * r);
    s.renderOrder = 10;
    group.add(s);
    embers.push({
      spr:   s,
      baseY: s.position.y,
      delay: Math.random() * 0.25,
      speed: 0.7 + Math.random() * 0.9,     // embers rise faster than poison motes
      wob:   Math.random() * Math.PI * 2,
      flick: 6 + Math.random() * 8,          // per-ember flicker frequency
    });
  }

  scene.add(group);

  let t = 0;
  (function step() {
    t += 0.016;
    const k = Math.min(1, t / LIFE);

    // Flare: swell fast, gone by the first third.
    const bk = Math.min(1, t / (LIFE * 0.30));
    burst.scale.setScalar(0.6 + BURST_MAX * (1 - (1 - bk) ** 2));
    burst.material.opacity = 0.95 * (1 - bk);

    for (const e of embers) {
      const et = t - e.delay;
      if (et <= 0) continue;
      const ek = Math.min(1, et / (LIFE - e.delay));
      e.spr.position.y = e.baseY + RISE * ek * e.speed;
      e.spr.position.x += Math.sin(e.wob + t * 3) * 0.003;
      // Fade in fast, out over the rest, with a flame flicker riding on top.
      const flicker = 0.75 + 0.25 * Math.sin(e.flick * t + e.wob);
      e.spr.material.opacity = (ek < 0.15 ? ek / 0.15 : 1 - (ek - 0.15) / 0.85) * flicker;
    }

    if (k >= 1) {
      scene.remove(group);
      burst.material.dispose();
      embers.forEach(e => e.spr.material.dispose());   // the shared map is NOT disposed
      return;
    }
    requestAnimationFrame(step);
  })();
}
