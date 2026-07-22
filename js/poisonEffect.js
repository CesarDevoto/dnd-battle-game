// js/poisonEffect.js — giant spider venom: a sickly green burst that clings to the bitten
// hero, plus motes of vapour drifting up off them.
//
// AdditiveBlending + fog:false throughout, and every sprite shares ONE CanvasTexture built
// once. Both of those are load-bearing: a CanvasTexture drawn with NormalBlending renders as
// a black square (canvas alpha is premultiplied — the same trap the fog patches hit), and
// minting a texture per cast is how the fog gates leaked for a whole session.
import * as THREE from 'three';
import { scene } from './scene.js';

const GREEN_CORE = 'rgba(190, 255, 150, ';   // pale, almost-white green centre
const GREEN_EDGE = 'rgba( 60, 190,  60, ';   // deep venom green at the rim

let _moteTex = null;
function _getMoteTex() {
  if (_moteTex) return _moteTex;
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, GREEN_CORE + '1.00)');
  g.addColorStop(0.40, GREEN_EDGE + '0.75)');
  g.addColorStop(1.00, GREEN_EDGE + '0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _moteTex = new THREE.CanvasTexture(c);
  return _moteTex;
}

const _pos = u => (u.anchor ? u.anchor : u.grp.position);

const MOTES     = 14;
const LIFE      = 1.5;    // seconds
const RISE      = 1.6;    // WU the motes drift upward over their life
const BURST_MAX = 1.5;    // WU — how wide the initial flash swells

// Call on a FAILED poison save. Fires and forgets: cleans up its own scene objects.
export function playPoisonEffect(unit) {
  if (!unit?.grp) return;
  const origin = _pos(unit).clone();
  const tex    = _getMoteTex();
  const group  = new THREE.Group();

  // One bright flash that swells and fades over the hero.
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0x88ff66, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  burst.scale.setScalar(0.6);
  burst.position.copy(origin);
  burst.renderOrder = 10;   // above the fog patches / vision blockers
  group.add(burst);

  // Motes of vapour boiling off the wound.
  const motes = [];
  for (let i = 0; i < MOTES; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0x66dd44, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    const a = Math.random() * Math.PI * 2;
    const r = 0.15 + Math.random() * 0.55;
    s.scale.setScalar(0.14 + Math.random() * 0.20);
    s.position.set(origin.x + Math.cos(a) * r, origin.y - 0.35 + Math.random() * 0.7, origin.z + Math.sin(a) * r);
    s.renderOrder = 10;
    group.add(s);
    motes.push({
      spr:   s,
      baseY: s.position.y,
      // Staggered starts so they don't pulse in lockstep, and varied speeds.
      delay: Math.random() * 0.35,
      speed: 0.6 + Math.random() * 0.8,
      wob:   Math.random() * Math.PI * 2,
    });
  }

  scene.add(group);

  let t = 0;
  (function step() {
    t += 0.016;
    const k = Math.min(1, t / LIFE);

    // Burst: swell fast, fade out over the first third.
    const bk = Math.min(1, t / (LIFE * 0.35));
    burst.scale.setScalar(0.6 + BURST_MAX * (1 - (1 - bk) ** 2));
    burst.material.opacity = 0.9 * (1 - bk);

    for (const m of motes) {
      const mt = t - m.delay;
      if (mt <= 0) continue;
      const mk = Math.min(1, mt / (LIFE - m.delay));
      m.spr.position.y = m.baseY + RISE * mk * m.speed;
      m.spr.position.x += Math.sin(m.wob + t * 3) * 0.002;
      // Fade in over the first 20% of the mote's life, then out.
      m.spr.material.opacity = mk < 0.2 ? (mk / 0.2) * 0.85 : 0.85 * (1 - (mk - 0.2) / 0.8);
    }

    if (k >= 1) {
      scene.remove(group);
      burst.material.dispose();
      motes.forEach(m => m.spr.material.dispose());   // the shared map is NOT disposed
      return;
    }
    requestAnimationFrame(step);
  })();
}
