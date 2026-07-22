// js/iceEffect.js — Rimefrost Locket's ice rider: a pale blue frost flash on the struck target
// with crystalline shards spraying outward and settling.
//
// Same rules as poisonEffect.js and the fog patches: AdditiveBlending + fog:false throughout, and
// ONE CanvasTexture shared across every sprite (built once, never disposed). A CanvasTexture drawn
// with NormalBlending renders as a black square (premultiplied canvas alpha), and minting a texture
// per cast leaks memory.
import * as THREE from 'three';
import { scene } from './scene.js';

const ICE_CORE = 'rgba(235, 250, 255, ';   // white-blue centre
const ICE_EDGE = 'rgba( 90, 170, 255, ';   // cold blue at the rim

let _shardTex = null;
function _getShardTex() {
  if (_shardTex) return _shardTex;
  const S = 64;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, ICE_CORE + '1.00)');
  g.addColorStop(0.45, ICE_EDGE + '0.70)');
  g.addColorStop(1.00, ICE_EDGE + '0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  _shardTex = new THREE.CanvasTexture(c);
  return _shardTex;
}

const _pos = u => (u.anchor ? u.anchor : u.grp.position);

const SHARDS    = 15;
const LIFE      = 1.1;    // seconds
const SPRAY     = 1.1;    // WU the shards fan outward over their life
const FALL      = 0.5;    // WU they settle downward as they spray (frost, not embers)
const BURST_MAX = 1.5;    // WU — how wide the frost flash swells

// Call on an ice rider that lands. Fire-and-forget: cleans up its own scene objects.
export function playIceEffect(unit) {
  if (!unit?.grp) return;
  const origin = _pos(unit).clone();
  const tex    = _getShardTex();
  const group  = new THREE.Group();

  // A cold flash that swells and fades over the target.
  const burst = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xaaddff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  burst.scale.setScalar(0.6);
  burst.position.copy(origin);
  burst.renderOrder = 10;   // above the fog patches / vision blockers
  group.add(burst);

  // Crystalline shards flung outward from the impact, each easing to a stop as it fades.
  const shards = [];
  for (let i = 0; i < SHARDS; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: i % 3 === 0 ? 0xffffff : 0x88ccff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    s.scale.setScalar(0.10 + Math.random() * 0.16);
    s.position.copy(origin);
    s.position.y += -0.1 + Math.random() * 0.5;
    s.renderOrder = 10;
    group.add(s);
    const a = Math.random() * Math.PI * 2;
    shards.push({
      spr:   s,
      ox:    origin.x, oy: s.position.y, oz: origin.z,
      dx:    Math.cos(a), dz: Math.sin(a),
      reach: 0.5 + Math.random() * 0.9,     // how far this shard flies
      delay: Math.random() * 0.12,
    });
  }

  scene.add(group);

  let t = 0;
  (function step() {
    t += 0.016;
    const k = Math.min(1, t / LIFE);

    // Flash: swell fast, gone by the first third.
    const bk = Math.min(1, t / (LIFE * 0.30));
    burst.scale.setScalar(0.6 + BURST_MAX * (1 - (1 - bk) ** 2));
    burst.material.opacity = 0.9 * (1 - bk);

    for (const sh of shards) {
      const st = t - sh.delay;
      if (st <= 0) continue;
      const sk = Math.min(1, st / (LIFE - sh.delay));
      // Ease-out spray: fast off the impact, coasting to a stop — crystals, not embers.
      const ease = 1 - (1 - sk) ** 2;
      const d    = SPRAY * ease * sh.reach;
      sh.spr.position.x = sh.ox + sh.dx * d;
      sh.spr.position.z = sh.oz + sh.dz * d;
      sh.spr.position.y = sh.oy - FALL * ease * sh.reach;
      // Fade in fast, out over the rest.
      sh.spr.material.opacity = sk < 0.15 ? (sk / 0.15) * 0.9 : 0.9 * (1 - (sk - 0.15) / 0.85);
    }

    if (k >= 1) {
      scene.remove(group);
      burst.material.dispose();
      shards.forEach(sh => sh.spr.material.dispose());   // the shared map is NOT disposed
      return;
    }
    requestAnimationFrame(step);
  })();
}
