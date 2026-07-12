// js/webEffect.js — giant spider's Web attack visual: a white ball spat at the
// target, then a web that clings to it while it stays restrained (target.webRestrained),
// fading out once it breaks free. Additive/fog:false like the other effects.
import * as THREE from 'three';
import { scene } from './scene.js';

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

const _pos = (u) => (u.anchor ? u.anchor : u.grp.position);

export function playWebEffect(from, to) {
  const start = _pos(from).clone();

  const ball = new THREE.Sprite(new THREE.SpriteMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  ball.scale.setScalar(0.45);
  ball.position.copy(start);
  scene.add(ball);

  const web = new THREE.Sprite(new THREE.SpriteMaterial({
    map: _getWebTex(), color: 0xffffff, transparent: true, opacity: 0,
    depthWrite: false, fog: false,
  }));
  web.scale.setScalar(2.2);
  web.position.copy(_pos(to));
  scene.add(web);

  const FLY = 0.28;
  let t = 0;
  (function step() {
    t += 0.016;
    if (t < FLY) {
      ball.position.lerpVectors(start, _pos(to), t / FLY);
    } else {
      ball.visible = false;
      // Web clings to the target while restrained, then fades once it's free.
      web.position.copy(_pos(to));
      if (to.webRestrained) web.material.opacity = Math.min(0.85, web.material.opacity + 0.07);
      else                  web.material.opacity -= 0.035;
    }
    if (t >= FLY && !to.webRestrained && web.material.opacity <= 0) {
      scene.remove(ball); scene.remove(web);
      ball.material.dispose(); web.material.dispose();
      return;
    }
    requestAnimationFrame(step);
  })();
}
