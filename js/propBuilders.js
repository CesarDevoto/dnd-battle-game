import * as THREE from 'three';
import { units } from './units.js';
import { startWaystoneAudio } from './audio.js';

// ── Prop builder helpers ──────────────────────────────────────────────────────
// sh() enables shadow casting on a mesh and returns it
function sh(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

function mkMat(color, roughness = 0.92, metalness = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

// ── Procedural PBR textures ───────────────────────────────────────────────────

const _texCache = {};
export const _cachedMats = new Set();
export const _cachedGeos = new Set();
function _cacheGet(k, fn) {
  if (!_texCache[k]) {
    _texCache[k] = fn();
    if (_texCache[k] && _texCache[k].isMaterial) _cachedMats.add(_texCache[k]);
  }
  return _texCache[k];
}

function _mkStoneTex() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c8c8c8';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 24; i++) {
    const v = 108 + (Math.random() * 60 | 0);
    ctx.globalAlpha = 0.20 + Math.random() * 0.28;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.ellipse(Math.random()*S, Math.random()*S, S*(0.04+Math.random()*0.17),
      S*(0.03+Math.random()*0.13), Math.random()*Math.PI, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3200; i++) {
    const v = 95 + (Math.random()*105 | 0);
    ctx.fillStyle = Math.random() > 0.55
      ? `rgba(${v-55},${v-55},${v-55},0.60)` : `rgba(${v+28},${v+28},${v+28},0.42)`;
    ctx.fillRect(Math.random()*S|0, Math.random()*S|0,
      1 + (Math.random()*1.8|0), 1);
  }
  for (let c = 0; c < 8; c++) {
    ctx.strokeStyle = `rgba(48,44,38,${0.48+Math.random()*0.42})`;
    ctx.lineWidth   = 0.5 + Math.random() * 1.2;
    ctx.globalAlpha = 0.68;
    ctx.beginPath();
    let px = Math.random()*S, py = Math.random()*S;
    ctx.moveTo(px, py);
    for (let j = 0; j < 4+(Math.random()*5|0); j++) {
      px += (Math.random()-0.5)*38; py += (Math.random()-0.5)*38;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  return t;
}

function _mkBushTex() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#707070';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 110; i++) {
    const v = 80 + (Math.random() * 130 | 0);
    ctx.globalAlpha = 0.38 + Math.random() * 0.52;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.ellipse(
      Math.random() * S, Math.random() * S,
      3 + Math.random() * 9, 2 + Math.random() * 5,
      Math.random() * Math.PI, 0, Math.PI * 2
    );
    ctx.fill();
  }
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 900; i++) {
    const v = Math.random() > 0.55 ? 210 : 45;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.random() * S | 0, Math.random() * S | 0, 1, 1);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

function _mkStoneBumpTex() {
  const S = 256, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#909090';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 200; i++) {
    const r = 2 + Math.random() * 20;
    const cx2 = Math.random()*S, cy = Math.random()*S;
    const bright = 155 + (Math.random()*88|0);
    const g2 = ctx.createRadialGradient(cx2-r*0.22, cy-r*0.22, 0, cx2, cy, r);
    g2.addColorStop(0, `rgb(${bright},${bright},${bright})`);
    g2.addColorStop(1, 'rgba(72,72,72,0)');
    ctx.globalAlpha = 0.28 + Math.random() * 0.42;
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(cx2, cy, r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let c = 0; c < 10; c++) {
    ctx.strokeStyle = `rgba(28,26,22,${0.58+Math.random()*0.32})`;
    ctx.lineWidth   = 1.5 + Math.random()*2.5; ctx.globalAlpha = 0.78;
    ctx.beginPath();
    let px = Math.random()*S, py = Math.random()*S; ctx.moveTo(px, py);
    for (let j = 0; j < 5+(Math.random()*4|0); j++) {
      px += (Math.random()-0.5)*30; py += (Math.random()-0.5)*30; ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  return t;
}

function _mkBarkTex() {
  const W = 128, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x++) {
    const v = ( Math.sin(x*0.30+0.8)*0.42 + Math.sin(x*0.94+2.3)*0.24
              + Math.sin(x*2.55+1.2)*0.13 + 0.79 ) / 1.58;
    const grey = 72 + (v * 118 | 0);
    ctx.fillStyle   = `rgb(${grey},${grey},${grey})`;
    ctx.globalAlpha = 0.74;
    ctx.fillRect(x, 0, 1, H);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 58; i++) {
    const y   = Math.random()*H, x0 = Math.random()*W*0.6;
    const len = 4 + Math.random()*30;
    const grey = 38 + (Math.random()*42|0);
    ctx.strokeStyle = `rgb(${grey},${grey},${grey})`;
    ctx.lineWidth   = 0.5 + Math.random()*1.2;
    ctx.globalAlpha = 0.38 + Math.random()*0.48;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0+len, y+(Math.random()-0.5)*4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let k = 0; k < 3; k++) {
    const kx = 12+Math.random()*(W-24), ky = 20+Math.random()*(H-40);
    const kr = 4+Math.random()*8;
    ctx.globalAlpha = 0.52; ctx.strokeStyle = '#2e2e2e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(kx, ky, kr, kr*0.55, 0, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#3c3c3c'; ctx.globalAlpha = 0.48; ctx.fill();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 4);
  return t;
}

function _mkBarkBumpTex() {
  const W = 128, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x++) {
    const v = Math.sin(x*0.30+0.8)*0.46 + Math.sin(x*0.96+2.1)*0.28 + 0.5;
    const grey = 52 + (v * 168 | 0);
    ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
    ctx.globalAlpha = 0.70; ctx.fillRect(x, 0, 1, H);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 4);
  return t;
}

function _getStoneTex()     { return _cacheGet('stone',    _mkStoneTex); }
function _getStoneBumpTex() { return _cacheGet('stoneBump',_mkStoneBumpTex); }
function _getBarkTex()      { return _cacheGet('bark',     _mkBarkTex); }
function _getBarkBumpTex()  { return _cacheGet('barkBump', _mkBarkBumpTex); }

function _mkRockMat(color) {
  return new THREE.MeshStandardMaterial({
    color,
    map:       _getStoneTex(),
    bumpMap:   _getStoneBumpTex(),
    bumpScale: 0.45,
    roughness: 0.93,
    metalness: 0.03,
  });
}

function _mkBarkMat(color) {
  return new THREE.MeshStandardMaterial({
    color,
    map:       _getBarkTex(),
    bumpMap:   _getBarkBumpTex(),
    bumpScale: 0.70,
    roughness: 0.97,
    metalness: 0,
  });
}

function _mkFoliageMat(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness:         0.84,
    metalness:         0,
    side:              THREE.DoubleSide,
    emissive:          0x0a1802,
    emissiveIntensity: 0.28,
  });
}

// ── Wind animation ────────────────────────────────────────────────────────────
export const _windBlobs = [];

function _wBlobMesh(geo, mat) {
  const m = sh(new THREE.Mesh(geo, mat));
  _windBlobs.push({ mesh: m, phase: Math.random() * Math.PI * 2 });
  return m;
}

export function updateWind(t) {
  for (const { mesh, phase, ampZ = 0.010, ampX = 0.007 } of _windBlobs) {
    mesh.rotation.z = ampZ * Math.sin(t * 0.82 + phase);
    mesh.rotation.x = ampX * Math.sin(t * 1.18 + phase * 1.64);
  }
}

// ── Leaf billboard system ─────────────────────────────────────────────────────

function _mkLeafClusterTex() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const cx = S/2, cy = S/2;
  const gr = ctx.createRadialGradient(cx*0.9, cy*0.88, 0, cx, cy, S*0.46);
  gr.addColorStop(0,    'rgba(255,255,255,0.95)');
  gr.addColorStop(0.50, 'rgba(255,255,255,0.88)');
  gr.addColorStop(0.78, 'rgba(255,255,255,0.46)');
  gr.addColorStop(1.0,  'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.beginPath(); ctx.arc(cx, cy, S*0.48, 0, Math.PI*2); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a  = (i/14)*Math.PI*2 + Math.random()*0.52;
    const d  = S*(0.27 + Math.random()*0.17);
    const br = S*(0.055 + Math.random()*0.10);
    ctx.fillStyle = `rgba(255,255,255,${0.44+Math.random()*0.46})`;
    ctx.beginPath();
    ctx.arc(cx+Math.cos(a)*d, cy+Math.sin(a)*d, br, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 11; i++) {
    const hx = S*(0.12+Math.random()*0.76), hy = S*(0.12+Math.random()*0.76);
    const hr = S*(0.028+Math.random()*0.062);
    ctx.fillStyle = `rgba(0,0,0,${0.38+Math.random()*0.54})`;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 18; i++) {
    const lx = S*(0.1+Math.random()*0.8), ly = S*(0.1+Math.random()*0.8);
    ctx.save(); ctx.translate(lx, ly); ctx.rotate(Math.random()*Math.PI);
    ctx.globalAlpha = 0.10+Math.random()*0.16;
    ctx.fillStyle = Math.random()>0.5 ? '#ffffff' : '#000000';
    ctx.beginPath();
    ctx.ellipse(0, 0, 3+Math.random()*7, 2+Math.random()*4, 0, 0, Math.PI*2);
    ctx.fill(); ctx.restore();
  }
  const t = new THREE.CanvasTexture(cv);
  return t;
}

function _getLeafClusterTex()  { return _cacheGet('leafCluster',  _mkLeafClusterTex); }

function _mkLeafBillboardMat() {
  return new THREE.MeshStandardMaterial({
    color:             0xffffff,
    map:               _getLeafClusterTex(),
    alphaTest:         0.12,
    side:              THREE.DoubleSide,
    roughness:         0.88,
    metalness:         0,
    emissive:          0x0a1802,
    emissiveIntensity: 0.22,
  });
}
function _getLeafBillboardMat() { return _cacheGet('leafBillboard', _mkLeafBillboardMat); }

function _crownPts(n, yMin, yMax, rBase, rTop) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const y = yMin + Math.random()*(yMax - yMin);
    const t = (y - yMin) / Math.max(1e-4, yMax - yMin);
    const r = (rBase + (rTop - rBase)*t) * Math.sqrt(Math.random());
    const a = Math.random()*Math.PI*2;
    pts.push({ x: Math.cos(a)*r, y, z: Math.sin(a)*r });
  }
  return pts;
}

function _buildLeafCloud(g, pts, colors, planeSize, windPhase, mat = _getLeafBillboardMat()) {
  const geo   = new THREE.PlaneGeometry(planeSize, planeSize);
  const iMesh = new THREE.InstancedMesh(geo, mat, pts.length * 2);
  iMesh.castShadow    = false;
  iMesh.receiveShadow = false;
  iMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const col   = new THREE.Color();

  pts.forEach((p, i) => {
    col.setHex(colors[Math.floor(Math.random() * colors.length)]);
    const sc = 0.78 + Math.random() * 0.46;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(
      (Math.random()-0.5)*0.55,
      Math.random()*Math.PI,
      (Math.random()-0.5)*0.30
    );
    dummy.scale.set(sc, sc, 1);
    dummy.updateMatrix();
    iMesh.setMatrixAt(i*2, dummy.matrix);
    iMesh.setColorAt(i*2, col);
    dummy.rotation.y += Math.PI*0.5 + (Math.random()-0.5)*0.28;
    dummy.rotation.x += (Math.random()-0.5)*0.25;
    dummy.updateMatrix();
    iMesh.setMatrixAt(i*2+1, dummy.matrix);
    iMesh.setColorAt(i*2+1, col);
  });

  iMesh.instanceMatrix.needsUpdate = true;
  iMesh.instanceColor.needsUpdate  = true;
  g.add(iMesh);

  _windBlobs.push({ mesh: iMesh, phase: windPhase, ampZ: 0.018, ampX: 0.011 });
}

// ── Pine / evergreen needle texture ──────────────────────────────────────────

function _mkPineNeedleTex() {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const cx = S/2, cy = S/2;

  const gr = ctx.createRadialGradient(cx, cy, S*0.04, cx, cy, S*0.36);
  gr.addColorStop(0,    'rgba(255,255,255,1.00)');
  gr.addColorStop(0.50, 'rgba(255,255,255,0.94)');
  gr.addColorStop(0.78, 'rgba(255,255,255,0.52)');
  gr.addColorStop(1.0,  'rgba(255,255,255,0.00)');
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.ellipse(cx, cy, S*0.36, S*0.36, 0, 0, Math.PI*2);
  ctx.fill();

  for (let i = 0; i < 44; i++) {
    const a  = (i/44)*Math.PI*2 + (Math.random()-0.5)*0.11;
    const d0 = S*(0.22 + Math.random()*0.06);
    const d1 = S*(0.40 + Math.random()*0.14);
    const w  = S*(0.005 + Math.random()*0.008);
    ctx.save();
    ctx.translate(cx + Math.cos(a)*d0, cy + Math.sin(a)*d0);
    ctx.rotate(a);
    ctx.globalAlpha = 0.68 + Math.random()*0.30;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -w); ctx.lineTo(d1-d0, 0); ctx.lineTo(0, w);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  for (let i = 0; i < 28; i++) {
    const a   = Math.random() * Math.PI * 2;
    const r0  = Math.random() * S * 0.22;
    const len = S * (0.07 + Math.random() * 0.20);
    const sx  = cx + Math.cos(a)*r0, sy = cy + Math.sin(a)*r0;
    ctx.strokeStyle = 'rgba(255,255,255,0.72)';
    ctx.lineWidth   = 0.3 + Math.random() * 0.6;
    ctx.globalAlpha = 0.32 + Math.random() * 0.46;
    ctx.beginPath(); ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a)*len, sy + Math.sin(a)*len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  return t;
}

function _getPineNeedleTex()  { return _cacheGet('pineNeedle', _mkPineNeedleTex); }

function _mkPineNeedleMat() {
  return new THREE.MeshStandardMaterial({
    color:             0xffffff,
    map:               _getPineNeedleTex(),
    alphaTest:         0.08,
    side:              THREE.DoubleSide,
    roughness:         0.92,
    metalness:         0,
    emissive:          0x030a01,
    emissiveIntensity: 0.15,
  });
}
function _getPineNeedleMat()  { return _cacheGet('pineNeedleMat', _mkPineNeedleMat); }

function _pineTierPts(tiers) {
  const pts = [];
  tiers.forEach(({ y, r, n }) => {
    for (let i = 0; i < n; i++) {
      const ang = (i/n)*Math.PI*2 + (Math.random()-0.5)*0.42;
      const jR  = r*(0.86 + Math.random()*0.28);
      pts.push({
        x: Math.cos(ang)*jR,
        y: y + (Math.random()-0.5)*0.34,
        z: Math.sin(ang)*jR,
      });
    }
    if (r > 0.14) {
      pts.push({
        x: (Math.random()-0.5)*r*0.38,
        y: y + 0.18,
        z: (Math.random()-0.5)*r*0.38,
      });
    }
  });
  return pts;
}

// ── Tree geometry helpers ─────────────────────────────────────────────────────

function _rNoise(nx, ny, nz, octaves, phase) {
  let n = 0, a = 1.0, f = 1.0;
  for (let i = 0; i < octaves; i++) {
    const ph = i * 2.399 + phase;
    n += a * Math.sin(nx*f*4.8+ph) * Math.cos(ny*f*5.3+ph+1.1) * Math.sin(nz*f*4.1+ph+2.3);
    a *= 0.50; f *= 2.15;
  }
  return n;
}

function _displaceRock(geo, str, phase) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const L = Math.sqrt(x*x + y*y + z*z);
    if (L < 1e-6) continue;
    const d = 1 + _rNoise(x/L, y/L, z/L, 5, phase) * str;
    p.setXYZ(i, x*d, y*d, z*d);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function _displaceTrunk(geo, str, phase) {
  const pos = geo.attributes.position;
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const ySpan = Math.max(0.001, yMax - yMin);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = Math.sqrt(x*x + z*z);
    if (r < 1e-6) continue;
    const yt = (y - yMin) / ySpan;

    const nBark = _rNoise(x/r, z/r, yt * 1.6, 5, phase);
    const d     = 1 + nBark * str;

    const sweep = str * 0.32 * yt * yt;
    const sx    = Math.sin(phase * 1.7 + yt * 2.2) * sweep;
    const sz    = Math.cos(phase * 1.3 + yt * 1.8) * sweep;

    pos.setXYZ(i, x * d + sx, y, z * d + sz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function _mkTrunkGeo(rTop, rBot, h, segs = 12, str = 0.12, hSegs = 6) {
  return _displaceTrunk(
    new THREE.CylinderGeometry(rTop, rBot, h, segs, hSegs),
    str, Math.random() * Math.PI * 2
  );
}

function _mkFoliageBlob(r, detail = 2, str = 0.32) {
  return _displaceRock(new THREE.IcosahedronGeometry(r, detail), str, Math.random() * Math.PI * 2);
}

// ── Tree builders ─────────────────────────────────────────────────────────────

export function mkForestTree(s, ry) {
  const g       = new THREE.Group();
  const barkMat = _mkBarkMat(0x3a1e06);
  const lean    = (Math.random() - 0.5) * 0.10;
  const windPh  = Math.random() * Math.PI * 2;

  const trunk = sh(new THREE.Mesh(_mkTrunkGeo(0.15, 0.36, 4.4, 12, 0.16, 8), barkMat));
  trunk.position.y = 2.2;
  trunk.rotation.z = lean;
  g.add(trunk);

  [0, 1.05, 2.09, 3.14, 4.19, 5.24].forEach((angle, i) => {
    const h = 1.2 + (i % 2) * 0.3;
    const flare = sh(new THREE.Mesh(_mkTrunkGeo(0.05, 0.24, h, 6, 0.24, 3), barkMat));
    flare.position.set(Math.cos(angle)*0.28, h*0.42, Math.sin(angle)*0.28);
    flare.rotation.y = angle;
    flare.rotation.z = Math.cos(angle)*0.56 + lean*0.4;
    flare.rotation.x = Math.sin(angle)*0.18;
    g.add(flare);
  });

  [
    [4.0,  0.9,  0.3,  0.60,  0.16],
    [3.7, -0.8, -0.2, -0.52, -0.20],
    [4.5,  0.2, -0.9,  0.40,  0.06],
    [4.2, -0.6,  0.7, -0.48,  0.22],
    [4.9,  0.7, -0.4,  0.54, -0.12],
  ].forEach(([ay, dx, dz, lZ, lX]) => {
    const br = sh(new THREE.Mesh(_mkTrunkGeo(0.030, 0.082, 1.9, 7, 0.26, 3), barkMat));
    br.position.set(dx*0.14, ay, dz*0.14);
    br.rotation.set(lX, Math.random()*Math.PI*2, lZ);
    g.add(br);
    for (let i = 0; i < 2; i++) {
      const sub = sh(new THREE.Mesh(_mkTrunkGeo(0.012, 0.022, 1.0, 5, 0.32, 2), barkMat));
      sub.position.set(dx*0.14 + Math.sin(lZ)*1.5 + (Math.random()-0.5)*0.5,
                       ay + 1.15 + i*0.30,
                       dz*0.14 + Math.sin(lX)*1.5 + (Math.random()-0.5)*0.5);
      sub.rotation.set(lX*1.25 + (Math.random()-0.5)*0.38,
                       Math.random()*Math.PI*2,
                       lZ*1.30 + (Math.random()-0.5)*0.38);
      g.add(sub);
    }
  });

  const pts = _crownPts(54, 3.3, 8.5, 2.1, 0.50);
  _buildLeafCloud(g, pts, [0x0e2808, 0x122e0a, 0x0a2206, 0x163010], 0.95, windPh);

  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

function _mkPineTierGeo(outerR) {
  const innerR = 0.10;
  const N = 14;
  const verts = [], inds = [];

  verts.push(0, 0, 0);

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = innerR * (0.82 + Math.random() * 0.36);
    verts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI / N);
    const r = outerR * (0.70 + Math.random() * 0.62);
    const y = -outerR * 0.24 * Math.pow(r / outerR, 1.4) + (Math.random() - 0.5) * 0.07;
    verts.push(Math.cos(a) * r, y, Math.sin(a) * r);
  }

  for (let i = 0; i < N; i++) {
    const ni = (i + 1) % N;
    inds.push(0,      1+ni,   1+i);
    inds.push(1+i,    1+ni,   N+1+i);
    inds.push(1+ni,   N+1+ni, N+1+i);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(inds);
  geo.computeVertexNormals();
  return geo;
}

function _getPineFoliageMat(color) {
  return _cacheGet('pineFol_' + color, () => new THREE.MeshStandardMaterial({
    color,
    roughness:         0.88,
    metalness:         0,
    side:              THREE.DoubleSide,
    emissive:          0x030a01,
    emissiveIntensity: 0.16,
  }));
}

export function mkPineTree(s, ry) {
  const g       = new THREE.Group();
  const hv      = 0.85 + Math.random() * 0.35;
  const lean    = (Math.random() - 0.5) * 0.06;
  const barkMat = _mkBarkMat(0x1e0c04);

  const trunkH = 7.6 * hv;
  const trunk  = sh(new THREE.Mesh(_mkTrunkGeo(0.050, 0.17, trunkH, 10, 0.13, 8), barkMat));
  trunk.position.y = trunkH / 2;
  trunk.rotation.z = lean;
  g.add(trunk);

  for (let d = 0; d < 3; d++) {
    const dAng = Math.random() * Math.PI * 2;
    const dLen = 0.48 + Math.random() * 0.38;
    const dY   = 0.48 + d * 0.33 + Math.random() * 0.14;
    const dead = sh(new THREE.Mesh(_mkTrunkGeo(0.004, 0.014, dLen, 4, 0.18, 1), barkMat));
    dead.position.set(Math.cos(dAng) * dLen/2, dY, Math.sin(dAng) * dLen/2);
    dead.rotation.set(Math.PI/2 + 0.07 + Math.random()*0.10, dAng, 0);
    g.add(dead);
  }

  const TIERS = [
    { y: 1.80*hv, r: 2.40, n: 8, color: 0x091408 },
    { y: 2.55*hv, r: 1.92, n: 7, color: 0x071206 },
    { y: 3.22*hv, r: 1.52, n: 7, color: 0x0a1a08 },
    { y: 3.85*hv, r: 1.15, n: 6, color: 0x091408 },
    { y: 4.45*hv, r: 0.82, n: 6, color: 0x0c1a0a },
    { y: 5.00*hv, r: 0.52, n: 5, color: 0x0a1808 },
    { y: 5.52*hv, r: 0.27, n: 4, color: 0x0d1c0a },
    { y: 6.00*hv, r: 0.10, n: 3, color: 0x0f200c },
  ];

  TIERS.forEach(({ y, r, n, color }) => {
    const disc = sh(new THREE.Mesh(_mkPineTierGeo(r), _getPineFoliageMat(color)));
    disc.position.y = y;
    g.add(disc);

    for (let b = 0; b < n; b++) {
      const ang   = (b / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.28;
      const brLen = r * (0.82 + Math.random() * 0.30);
      const drp   = 0.16 + (Math.random() - 0.5) * 0.06;
      const br    = sh(new THREE.Mesh(
        _mkTrunkGeo(0.005, 0.016 + r * 0.009, brLen, 5, 0.20, 2), barkMat
      ));
      const bMid = brLen / 2;
      br.position.set(Math.cos(ang)*bMid, y - 0.06 - Math.sin(drp)*bMid, Math.sin(ang)*bMid);
      br.rotation.set(Math.PI/2 + drp, ang, 0);
      g.add(br);
    }
  });

  const topY = TIERS[TIERS.length - 1].y;
  const apex = sh(new THREE.Mesh(
    new THREE.ConeGeometry(0.20, 0.82, 10),
    _getPineFoliageMat(0x081006)
  ));
  apex.position.y = topY + 0.50;
  g.add(apex);

  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkAcaciaTree(s, ry) {
  const g       = new THREE.Group();
  const barkMat = _mkBarkMat(0x6a3c0e);
  const lean    = (Math.random() - 0.5) * 0.12;
  const windPh  = Math.random() * Math.PI * 2;

  const trunk = sh(new THREE.Mesh(_mkTrunkGeo(0.10, 0.28, 5.8, 12, 0.20, 8), barkMat));
  trunk.position.y = 2.9;
  trunk.rotation.z = lean;
  g.add(trunk);

  const branchMat = _mkBarkMat(0x5a3008);
  [
    [ 0.9,  5.3,  0.4,  0.64,  0.18],
    [-0.7,  5.1, -0.3, -0.52, -0.20],
    [ 0.2,  5.5, -0.8,  0.38,  0.06],
    [-0.5,  5.2,  0.7, -0.46,  0.24],
    [ 0.7,  5.6, -0.5,  0.55, -0.14],
    [-0.8,  5.4,  0.2, -0.60,  0.10],
  ].forEach(([x, y, z, lZ, lX]) => {
    const br = sh(new THREE.Mesh(_mkTrunkGeo(0.044, 0.12, 2.2, 7, 0.22, 4), branchMat));
    br.position.set(x, y, z);
    br.rotation.set(lX, Math.random()*Math.PI*2, lZ);
    g.add(br);
    const fork = sh(new THREE.Mesh(_mkTrunkGeo(0.022, 0.040, 1.3, 5, 0.28, 3), branchMat));
    fork.position.set(x*1.62, y+0.90, z*1.62);
    fork.rotation.set(lX*1.30, Math.random()*Math.PI*2, lZ*1.40+(Math.random()-0.5)*0.30);
    g.add(fork);
  });

  const pts = _crownPts(44, 5.6, 6.5, 2.5, 2.2);
  _buildLeafCloud(g, pts, [0x365e14, 0x284a0e, 0x3e6818, 0x2e540e], 1.05, windPh);

  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

// ── Swamp cached materials ────────────────────────────────────────────────────

function _getSwampMossMat() {
  return _cacheGet('swampMoss', () => new THREE.MeshStandardMaterial({
    color: 0x4e5e2a, roughness: 0.94, metalness: 0,
    side: THREE.DoubleSide,
    emissive: 0x060a02, emissiveIntensity: 0.12,
  }));
}
function _getSwampMushroomMat() {
  return _cacheGet('swampMushroom', () => new THREE.MeshStandardMaterial({
    color: 0x3a1848, roughness: 0.72, metalness: 0.06,
    emissive: 0x180424, emissiveIntensity: 0.46,
  }));
}
function _getSwampStemMat() {
  return _cacheGet('swampStem', () => new THREE.MeshStandardMaterial({
    color: 0x3e3228, roughness: 0.92, metalness: 0,
  }));
}

function _mkLilyPadGeo(r) {
  const N = 14;
  const notch = 0.28;
  const verts = [0, 0, 0];
  for (let i = 0; i <= N; i++) {
    const a  = notch * 0.5 + (i / N) * (Math.PI * 2 - notch);
    const rv = r * (0.88 + Math.random() * 0.24);
    verts.push(Math.cos(a) * rv, 0, Math.sin(a) * rv);
  }
  const inds = [];
  for (let i = 0; i < N; i++) inds.push(0, i + 1, i + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(inds);
  geo.computeVertexNormals();
  return geo;
}

export function mkSwampTree(s, ry) {
  const g       = new THREE.Group();
  const lean    = (Math.random() - 0.5) * 0.06;
  const windPh  = Math.random() * Math.PI * 2;
  const barkMat = _mkBarkMat(0x060300);
  const mossMat = _getSwampMossMat();

  const trunkH = 11.5;
  const trunk  = sh(new THREE.Mesh(_mkTrunkGeo(0.22, 0.55, trunkH, 10, 0.20, 8), barkMat));
  trunk.position.y = trunkH * 0.5;
  trunk.rotation.z = lean;
  g.add(trunk);

  const ROOT_CFG = [
    { ang: 0.20, dist: 2.8, r: 0.16 }, { ang: 1.10, dist: 3.3, r: 0.13 },
    { ang: 1.95, dist: 2.5, r: 0.17 }, { ang: 2.85, dist: 3.1, r: 0.12 },
    { ang: 3.75, dist: 2.7, r: 0.15 }, { ang: 4.60, dist: 3.5, r: 0.11 },
    { ang: 5.30, dist: 2.6, r: 0.18 }, { ang: 5.95, dist: 2.2, r: 0.14 },
  ];
  ROOT_CFG.forEach(({ ang, dist, r }) => {
    const d       = dist * (0.88 + Math.random() * 0.26);
    const rv      = r    * (0.82 + Math.random() * 0.36);
    const cx      = Math.cos(ang + (Math.random() - 0.5) * 0.20);
    const cz      = Math.sin(ang + (Math.random() - 0.5) * 0.20);
    const attachY = 1.8 + Math.random() * 1.2;

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx * 0.42,         attachY,                             cz * 0.42),
      new THREE.Vector3(cx * d * 0.42,     attachY + 1.2 + Math.random() * 0.8, cz * d * 0.42),
      new THREE.Vector3(cx * d * 0.82,     0.8 + Math.random() * 0.5,           cz * d * 0.82),
      new THREE.Vector3(cx * d,            0.22,                                 cz * d),
    ]);
    g.add(sh(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, rv, 8, false), barkMat)));

    if (Math.random() < 0.50) {
      const sa = ang + (Math.random() - 0.5) * 0.90;
      const sd = d * (0.50 + Math.random() * 0.38);
      const sx = Math.cos(sa), sz = Math.sin(sa);
      const sCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(cx * d * 0.50,   attachY * 0.62,  cz * d * 0.50),
        new THREE.Vector3(sx * sd * 0.70,  0.85,             sz * sd * 0.70),
        new THREE.Vector3(sx * sd,         0.20,             sz * sd),
      ]);
      g.add(sh(new THREE.Mesh(new THREE.TubeGeometry(sCurve, 8, rv * 0.52, 6, false), barkMat)));
    }
  });

  const FORKS = [
    { ang: 0.30, y: 8.0, len: 5.6, drp: -0.22, tR: 0.14, bR: 0.30 },
    { ang: 2.10, y: 8.8, len: 5.0, drp: -0.16, tR: 0.12, bR: 0.26 },
    { ang: 3.90, y: 9.6, len: 4.4, drp: -0.20, tR: 0.10, bR: 0.22 },
  ];
  const leafPts = [];

  FORKS.forEach(({ ang, y, len, drp, tR, bR }) => {
    const lv   = len * (0.88 + Math.random() * 0.24);
    const drpA = drp + (Math.random() - 0.5) * 0.06;
    const bx   = Math.cos(ang + (Math.random() - 0.5) * 0.25);
    const bz   = Math.sin(ang + (Math.random() - 0.5) * 0.25);

    const fork = sh(new THREE.Mesh(_mkTrunkGeo(tR, bR, lv, 7, 0.22, 5), barkMat));
    fork.position.set(bx * lv * 0.25, y - Math.sin(drpA) * lv * 0.25, bz * lv * 0.25);
    fork.rotation.set(Math.PI / 2 + drpA, ang, 0);
    g.add(fork);

    for (let sb = 0; sb < 3; sb++) {
      const sbA   = ang + (sb - 1) * 0.55 + (Math.random() - 0.5) * 0.38;
      const sbLen = lv * (0.38 + Math.random() * 0.28);
      const sbDrp = drpA - 0.06 + Math.random() * 0.16;
      const tPt   = 0.65 + sb * 0.12 + Math.random() * 0.08;
      const jx    = bx * lv * tPt;
      const jy    = y - Math.sin(drpA) * lv * tPt;
      const jz    = bz * lv * tPt;
      const sBx   = Math.cos(sbA), sBz = Math.sin(sbA);

      const sub = sh(new THREE.Mesh(_mkTrunkGeo(0.016, 0.050, sbLen, 5, 0.28, 3), barkMat));
      sub.position.set(jx + sBx * sbLen / 2, jy - Math.sin(sbDrp) * sbLen / 2, jz + sBz * sbLen / 2);
      sub.rotation.set(Math.PI / 2 + sbDrp, sbA, 0);
      g.add(sub);

      leafPts.push({
        x: jx + sBx * sbLen + (Math.random() - 0.5) * 0.5,
        y: jy - Math.sin(sbDrp) * sbLen + (Math.random() - 0.5) * 0.4,
        z: jz + sBz * sbLen + (Math.random() - 0.5) * 0.5,
      });
    }

    [0.72, 0.86, 1.0].forEach(t => {
      leafPts.push({
        x: bx * lv * t + (Math.random() - 0.5) * 0.60,
        y: y - Math.sin(drpA) * lv * t + (Math.random() - 0.5) * 0.45,
        z: bz * lv * t + (Math.random() - 0.5) * 0.60,
      });
    });
  });

  leafPts.push(..._crownPts(6, 11.5, 15.0, 1.4, 0.55));

  _buildLeafCloud(
    g, leafPts,
    [0x061204, 0x040e03, 0x090e06, 0x050a03, 0x0e0c04],
    0.55, windPh
  );

  [
    [ 0.55, 10.8,  0.18], [-0.80, 11.4,  0.60], [ 1.65, 10.2,  0.88],
    [-1.15,  9.8, -0.68], [ 0.30, 11.8, -0.48], [ 1.95, 11.0,  0.28],
    [-0.28, 10.5, -1.06], [ 1.05, 12.0,  0.55], [-1.42, 10.8,  0.75],
    [ 0.72,  9.6, -0.82], [-0.55, 12.2,  0.35], [ 1.30, 10.0, -0.50],
  ].forEach(([mx, my, mz]) => {
    for (let st = 0; st < 3; st++) {
      const len = 2.8 + Math.random() * 3.8;
      const ox  = (Math.random() - 0.5) * 0.44;
      const oz  = (Math.random() - 0.5) * 0.44;
      const str = sh(new THREE.Mesh(
        _mkTrunkGeo(0.007, 0.018, len, 4, 0.46, 6), mossMat
      ));
      str.position.set(mx + ox, my - len * 0.5, mz + oz);
      str.rotation.z = (mx + ox) * 0.05 + (Math.random() - 0.5) * 0.12;
      str.rotation.x = (mz + oz) * 0.04;
      g.add(str);
    }
  });

  const mushMat = _getSwampMushroomMat();
  const stemMat = _getSwampStemMat();
  for (let m = 0; m < 4; m++) {
    const mAng = Math.random() * Math.PI * 2;
    const mD   = 0.55 + Math.random() * 0.90;
    const mY   = 0.6 + Math.random() * 2.8;
    const sc   = 0.14 + Math.random() * 0.22;
    const stem = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, sc * 1.6, 5), stemMat));
    stem.position.set(Math.cos(mAng) * mD, mY, Math.sin(mAng) * mD);
    g.add(stem);
    const cap  = sh(new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), mushMat));
    cap.scale.set(sc, sc * 0.55, sc);
    cap.position.set(Math.cos(mAng) * mD, mY + sc * 0.75, Math.sin(mAng) * mD);
    g.add(cap);
  }

  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

// ── Rock helpers ──────────────────────────────────────────────────────────────

function _mkRockGeo(r, detail, str) {
  return _displaceRock(new THREE.IcosahedronGeometry(r, detail), str, Math.random() * Math.PI * 2);
}

function _mkDebris(g, color, count, spread) {
  const dc  = new THREE.Color(color).multiplyScalar(0.72).getHex();
  const mat = _mkRockMat(dc);
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const d   = spread * (0.38 + Math.random() * 0.62);
    const r   = 0.055 + Math.random() * 0.11;
    const c   = sh(new THREE.Mesh(_mkRockGeo(r, 0, 0.32), mat));
    c.scale.set(0.85 + Math.random()*0.65, 0.38 + Math.random()*0.38, 0.80 + Math.random()*0.55);
    c.position.set(Math.cos(ang)*d, r*0.22, Math.sin(ang)*d);
    c.rotation.y = Math.random() * Math.PI * 2;
    g.add(c);
  }
}

export function mkRock(color, s, ry, sx = 1.0, sy = 0.65, sz = 0.9, mossy = false) {
  const g   = new THREE.Group();
  const mat = _mkRockMat(color);

  const rock = sh(new THREE.Mesh(_mkRockGeo(1.1, 3, 0.22), mat));
  rock.scale.set(sx, sy, sz);
  rock.position.y = 1.1 * sy * 0.84;
  rock.rotation.set((Math.random()-0.5)*0.42, Math.random()*Math.PI*2, (Math.random()-0.5)*0.32);
  g.add(rock);

  const lobe = sh(new THREE.Mesh(_mkRockGeo(0.60, 2, 0.28), mat));
  lobe.scale.set(sx*0.78, sy*0.82, sz*0.70);
  lobe.position.set(sx*0.52, 1.1*sy*0.62, sz*0.20);
  lobe.rotation.set((Math.random()-0.5)*0.5, Math.random()*Math.PI*2, (Math.random()-0.5)*0.4);
  g.add(lobe);

  if (mossy) {
    const mossMat = new THREE.MeshStandardMaterial({ color: 0x0c1e08, roughness: 0.99, metalness: 0 });
    const moss = sh(new THREE.Mesh(
      _displaceRock(new THREE.IcosahedronGeometry(0.88, 2), 0.10, Math.random()*Math.PI*2), mossMat
    ));
    moss.scale.set(sx * 1.04, sy * 0.28, sz * 1.02);
    moss.position.y = 1.1 * sy * 0.88;
    g.add(moss);
  }

  _mkDebris(g, color, 3 + Math.floor(Math.random()*3), 1.5 * Math.max(sx, sz));
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkBoulderCluster(color, s, ry) {
  const g    = new THREE.Group();
  const mat1 = _mkRockMat(color);
  const dc   = new THREE.Color(color).multiplyScalar(0.80).getHex();
  const mat2 = _mkRockMat(dc);

  const main = sh(new THREE.Mesh(_mkRockGeo(1.4, 3, 0.24), mat1));
  main.scale.set(1.0, 0.72, 0.88);
  main.position.y = 1.4 * 0.72 * 0.86;
  main.rotation.set((Math.random()-0.5)*0.32, Math.random()*Math.PI*2, (Math.random()-0.5)*0.22);
  g.add(main);

  [
    { r: 0.92, x:  1.72, z:  0.40, sy: 0.60 },
    { r: 0.74, x: -1.28, z:  0.72, sy: 0.56 },
    { r: 0.54, x:  0.52, z: -1.22, sy: 0.58 },
  ].forEach(({ r, x, z, sy }) => {
    const b = sh(new THREE.Mesh(_mkRockGeo(r, 2, 0.26), mat2));
    b.scale.set(0.84 + Math.random()*0.28, sy, 0.88 + Math.random()*0.26);
    b.position.set(x, r * sy * 0.84, z);
    b.rotation.set((Math.random()-0.5)*0.38, Math.random()*Math.PI*2, (Math.random()-0.5)*0.28);
    g.add(b);
  });

  _mkDebris(g, color, 7 + Math.floor(Math.random()*4), 2.8);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkSnowBoulder(s, ry) {
  const g = new THREE.Group();
  const rock = sh(new THREE.Mesh(
    _mkRockGeo(1.2, 3, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x50596a, roughness: 0.97, metalness: 0.05 })
  ));
  rock.scale.set(1.0, 0.68, 0.92);
  rock.position.y = 1.2 * 0.68 * 0.88;
  rock.rotation.set((Math.random()-0.5)*0.32, Math.random()*Math.PI*2, (Math.random()-0.5)*0.22);
  g.add(rock);

  const snow = sh(new THREE.Mesh(
    _displaceRock(new THREE.IcosahedronGeometry(0.98, 2), 0.09, Math.random()*Math.PI*2),
    new THREE.MeshStandardMaterial({ color: 0xe4f0fc, roughness: 0.70, metalness: 0.01 })
  ));
  snow.scale.set(1.18, 0.44, 1.18);
  snow.position.y = 1.38;
  g.add(snow);

  _mkDebris(g, 0x50596a, 3 + Math.floor(Math.random()*2), 1.5);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkIce(s, ry) {
  const g = new THREE.Group();
  const mat = mkMat(0x9ac8e8, 0.22, 0.18, { transparent: true, opacity: 0.82 });
  [[0.0, 0.0, 2.8, 0.48], [0.9, 0.35, 2.0, 0.34], [-0.7, -0.2, 2.2, 0.30], [0.25, 0.9, 1.5, 0.40]]
    .forEach(([x, z, h, r]) => {
      const spike = sh(new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), mat));
      spike.position.set(x, h / 2, z);
      g.add(spike);
    });
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkBush(color, s, ry) {
  const g    = new THREE.Group();
  const base = new THREE.Color(color);
  const tex  = _cacheGet('bushTex', _mkBushTex);
  const lobes = [
    [0,     0.45, 0,     1.00, 0.62,  0.00],
    [0.82,  0.34, 0.30,  0.78, 0.58,  0.04],
    [-0.65, 0.32, -0.36, 0.72, 0.55, -0.03],
    [0.18,  0.22, -0.72, 0.65, 0.52,  0.06],
  ];
  lobes.forEach(([x, y, z, r, sy, dh]) => {
    const c   = base.clone().offsetHSL(dh, 0, (Math.random() - 0.5) * 0.08);
    const sp  = sh(new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5),
                   mkMat(c.getHex(), 0.92, 0, { map: tex })));
    sp.scale.y = sy;
    sp.position.set(x, y, z);
    g.add(sp);
  });
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkLog(s, ry) {
  const g = new THREE.Group();
  const log = sh(new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.30, 5.5, 8),
    mkMat(0x2c1506, 0.99)
  ));
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.28;
  g.add(log);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkDryShrub(s, ry) {
  const g = new THREE.Group();
  const mat  = mkMat(0x7a6228, 0.97);
  const base = sh(new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 4), mkMat(0x5a4418, 0.99)));
  base.scale.y = 0.48;
  base.position.y = 0.22;
  g.add(base);
  const angs = [0, 1.05, 2.09, 3.14, 4.19, 5.24];
  const hts  = [1.2, 1.55, 1.0, 1.45, 1.1, 1.6];
  angs.forEach((a, i) => {
    const stick = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.065, hts[i], 4), mat));
    stick.position.set(Math.cos(a) * 0.38, hts[i] / 2, Math.sin(a) * 0.38);
    stick.rotation.set(Math.cos(a) * 0.32, 0, Math.sin(a) * -0.32);
    g.add(stick);
  });
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkTunnelPillar(s, ry) {
  const g = new THREE.Group();
  const stoneMat  = mkMat(0x252530, 0.96, 0.07);
  const accentMat = mkMat(0x1c1c26, 0.98, 0.05);
  const column = sh(new THREE.Mesh(new THREE.BoxGeometry(0.88, 7.0, 0.88), stoneMat));
  column.position.y = 3.5;
  g.add(column);
  [0.22, 7.16].forEach(y => {
    const plate = sh(new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.36, 1.30), accentMat));
    plate.position.y = y;
    g.add(plate);
  });
  [-1.5, 0, 1.5].forEach(y => {
    const seam = sh(new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.92), accentMat));
    seam.position.y = 3.5 + y;
    g.add(seam);
  });
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkTunnelWall(s, ry) {
  const g = new THREE.Group();
  const mat   = mkMat(0x1e1e2a, 0.97, 0.06);
  const seam  = mkMat(0x14141e, 0.99, 0.04);
  const wall  = sh(new THREE.Mesh(new THREE.BoxGeometry(5.0, 5.5, 0.75), mat));
  wall.position.y = 2.75;
  g.add(wall);
  [0.9, 1.8, 2.7, 3.6].forEach(y => {
    const course = sh(new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.09, 0.80), seam));
    course.position.y = y;
    g.add(course);
  });
  [0, 2].forEach(row => {
    [-1.25, 1.25].forEach(x => {
      const joint = sh(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.80), seam));
      joint.position.set(x, row * 1.8 + 0.45, 0);
      g.add(joint);
    });
  });
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkBrokenStatue(s, ry) {
  const g = new THREE.Group();
  const mat = mkMat(0x2e2e3a, 0.95, 0.06);
  const fallen = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 3.8, 9), mat));
  fallen.rotation.z = Math.PI / 2;
  fallen.position.set(0.6, 0.44, 0);
  g.add(fallen);
  const stub = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 2.2, 9), mat));
  stub.position.set(-1.4, 1.1, 0.25);
  g.add(stub);
  const rubMat = mkMat(0x262630, 0.97, 0.04);
  [[0.4,0.18,0.9],[-0.2,0.14,-0.6],[1.5,0.12,0.3],[-0.5,0.10,0.7]].forEach(([x,y,z]) => {
    const c = sh(new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), rubMat));
    c.position.set(x, y, z);
    g.add(c);
  });
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkGlowMushroom(color, s, ry) {
  const g = new THREE.Group();
  const glowMat = mkMat(color, 0.3, 0.0, {
    emissive: new THREE.Color(color), emissiveIntensity: 1.2,
  });
  const stemMat = mkMat(0xaa99bb, 0.88);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, 0.85, 6), stemMat);
  stem.position.y = 0.42;
  g.add(stem);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.40, 9, 7, 0, Math.PI * 2, 0, Math.PI * 0.58),
    glowMat
  );
  cap.position.y = 0.92;
  g.add(cap);
  const rimMat = mkMat(color, 0.2, 0, { emissive: new THREE.Color(color), emissiveIntensity: 0.6 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 5, 10), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.80;
  g.add(rim);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkTorch(s, ry) {
  const g = new THREE.Group();
  const pole = sh(new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.075, 2.4, 5),
    mkMat(0x3a2410, 0.98)
  ));
  pole.position.y = 1.2;
  g.add(pole);
  const bowl = sh(new THREE.Mesh(
    new THREE.CylinderGeometry(0.19, 0.11, 0.32, 7),
    mkMat(0x664422, 0.88, 0.25)
  ));
  bowl.position.y = 2.46;
  g.add(bowl);
  const flameMat = mkMat(0xff9933, 0.15, 0, {
    emissive: new THREE.Color(0xff6600), emissiveIntensity: 2.0,
  });
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), flameMat);
  flame.position.y = 2.66;
  g.add(flame);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkRubblePile(s, ry) {
  const g   = new THREE.Group();
  const mat = _mkRockMat(0x2a2836);
  [
    [0,     0.18,  0,     0.58, 1.12, 0.68, 0.92],
    [0.55,  0.13,  0.32,  0.40, 0.82, 0.58, 1.08],
    [-0.48, 0.15, -0.28,  0.44, 1.00, 0.56, 0.88],
    [0.22,  0.10, -0.58,  0.34, 1.15, 0.52, 0.96],
    [-0.62, 0.08,  0.42,  0.30, 0.95, 0.55, 1.10],
  ].forEach(([x, y, z, r, scx, scy, scz]) => {
    const c = sh(new THREE.Mesh(_mkRockGeo(r, 2, 0.30), mat));
    c.scale.set(scx, scy, scz);
    c.position.set(x, y, z);
    c.rotation.set((Math.random()-0.5)*0.5, Math.random()*Math.PI*2, (Math.random()-0.5)*0.4);
    g.add(c);
  });
  _mkDebris(g, 0x2a2836, 4 + Math.floor(Math.random()*3), 1.0);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

// ── Graveyard prop builders ───────────────────────────────────────────────────

const _STONE_COLS = [0x2e3130, 0x343530, 0x2a2c28, 0x383634, 0x3a3630, 0x2c302c, 0x404038];

export function mkTombstone(s, ry) {
  const g = new THREE.Group();

  const stoneMat = mkMat(_STONE_COLS[Math.floor(Math.random() * _STONE_COLS.length)], 0.96, 0.03);
  const crackMat = mkMat(0x0c0e0c, 0.99, 0.01);
  const mossMat  = mkMat(0x182210, 0.99, 0.00);

  const variety = Math.random();
  let w, h;
  if (variety < 0.22) {
    w = 1.30 + Math.random() * 0.22;
    h = 1.25 + Math.random() * 0.32;
  } else if (variety < 0.40) {
    w = 0.70 + Math.random() * 0.14;
    h = 2.50 + Math.random() * 0.50;
  } else {
    w = 0.92 + Math.random() * 0.32;
    h = 1.85 + Math.random() * 0.58;
  }
  const d = 0.22 + Math.random() * 0.08;

  const slab = sh(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat));
  slab.position.y = h * 0.5;
  g.add(slab);

  const topStyle = Math.random();
  if (topStyle < 0.45) {
    const dome = sh(new THREE.Mesh(
      new THREE.SphereGeometry(w * 0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
      stoneMat,
    ));
    dome.scale.z = d / w;
    dome.position.set(0, h, 0);
    g.add(dome);
  } else if (topStyle < 0.75) {
    const chipMat = mkMat(0x141614, 0.98, 0.01);
    const side    = Math.random() > 0.5 ? 1 : -1;
    const chip    = sh(new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, h * 0.38, d + 0.04), chipMat));
    chip.position.set(side * w * 0.30, h * 0.85, 0);
    chip.rotation.z = side * (0.48 + Math.random() * 0.34);
    g.add(chip);
  }

  const engMat = mkMat(0x181a18, 0.99, 0.01);
  const engW   = w * (0.40 + Math.random() * 0.18);
  const engH   = h * (0.13 + Math.random() * 0.10);
  const eng    = sh(new THREE.Mesh(new THREE.BoxGeometry(engW, engH, 0.05), engMat));
  eng.position.set((Math.random() - 0.5) * 0.10, h * 0.49 + Math.random() * h * 0.13, d * 0.5 + 0.01);
  g.add(eng);

  const crackCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < crackCount; i++) {
    const cw    = 0.016 + Math.random() * 0.024;
    const ch    = 0.24  + Math.random() * 0.68;
    const crack = sh(new THREE.Mesh(new THREE.BoxGeometry(cw, ch, 0.04), crackMat));
    crack.position.set(
      (Math.random() - 0.5) * w * 0.74,
      h * 0.14 + Math.random() * h * 0.68,
      d * 0.5 + 0.01,
    );
    crack.rotation.z = (Math.random() - 0.5) * 1.10;
    g.add(crack);
  }

  const mossCount = Math.floor(Math.random() * 3);
  for (let i = 0; i < mossCount; i++) {
    const pw    = 0.10 + Math.random() * 0.34;
    const ph    = 0.06 + Math.random() * 0.24;
    const patch = sh(new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.035), mossMat));
    patch.position.set(
      (Math.random() - 0.5) * w * 0.68,
      h * 0.06 + Math.random() * h * 0.50,
      d * 0.5 + 0.01,
    );
    g.add(patch);
  }

  const heavy   = Math.random() < 0.18;
  const leanMag = heavy ? 0.26 + Math.random() * 0.22 : Math.random() * 0.16;
  const leanDir = Math.random() * Math.PI * 2;
  g.rotation.set(Math.sin(leanDir) * leanMag * 0.5, ry, Math.cos(leanDir) * leanMag);
  g.scale.setScalar(s);
  return g;
}

export function mkCross(s, ry) {
  const g = new THREE.Group();

  const mat      = mkMat(_STONE_COLS[Math.floor(Math.random() * _STONE_COLS.length)], 0.96, 0.03);
  const crackMat = mkMat(0x0c0e0c, 0.99, 0.01);
  const mossMat  = mkMat(0x182210, 0.99, 0.00);

  const armW   = 0.20 + Math.random() * 0.08;
  const vH     = 2.80 + Math.random() * 0.60;
  const depth  = 0.17 + Math.random() * 0.06;
  const crossY = vH * 0.63 + Math.random() * 0.20;

  const vert = sh(new THREE.Mesh(new THREE.BoxGeometry(armW, vH, depth), mat));
  vert.position.y = vH * 0.5;
  g.add(vert);

  const broken = Math.random() < 0.25;
  if (broken) {
    const leftLen  = 0.62 + Math.random() * 0.22;
    const rightLen = leftLen * (0.35 + Math.random() * 0.40);
    const left  = sh(new THREE.Mesh(new THREE.BoxGeometry(leftLen, armW, depth), mat));
    left.position.set(-(leftLen * 0.5 + armW * 0.5), crossY, 0);
    g.add(left);
    const right = sh(new THREE.Mesh(new THREE.BoxGeometry(rightLen, armW, depth), mat));
    right.position.set(rightLen * 0.5 + armW * 0.5, crossY, 0);
    g.add(right);
    const chipMat = mkMat(0x141614, 0.98, 0.01);
    const chip    = sh(new THREE.Mesh(new THREE.BoxGeometry(armW * 0.9, armW * 1.1, depth + 0.04), chipMat));
    chip.position.set(rightLen + armW * 0.6, crossY, 0);
    chip.rotation.z = 0.28 + Math.random() * 0.38;
    g.add(chip);
  } else {
    const halfLen = 0.70 + Math.random() * 0.30;
    const horiz   = sh(new THREE.Mesh(new THREE.BoxGeometry(halfLen * 2 + armW, armW, depth), mat));
    horiz.position.y = crossY;
    g.add(horiz);
  }

  const crackCount = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < crackCount; i++) {
    const cw    = 0.013 + Math.random() * 0.018;
    const ch    = 0.18  + Math.random() * 0.40;
    const crack = sh(new THREE.Mesh(new THREE.BoxGeometry(cw, ch, 0.035), crackMat));
    crack.position.set(
      (Math.random() - 0.5) * armW * 0.45,
      Math.random() * vH * 0.80 + 0.10,
      depth * 0.5 + 0.01,
    );
    crack.rotation.z = (Math.random() - 0.5) * 0.80;
    g.add(crack);
  }

  if (Math.random() > 0.40) {
    const pw    = armW * (0.5 + Math.random() * 0.6);
    const ph    = 0.12 + Math.random() * 0.22;
    const patch = sh(new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.030), mossMat));
    patch.position.set((Math.random() - 0.5) * 0.06, ph * 0.5 + 0.04, depth * 0.5 + 0.01);
    g.add(patch);
  }

  const heavy   = Math.random() < 0.22;
  const leanMag = heavy ? 0.22 + Math.random() * 0.24 : Math.random() * 0.20;
  const leanDir = Math.random() * Math.PI * 2;
  g.rotation.set(Math.sin(leanDir) * leanMag * 0.35, ry, Math.cos(leanDir) * leanMag);
  g.scale.setScalar(s);
  return g;
}

export function mkDeadTree(s, ry) {
  const g    = new THREE.Group();
  const mat  = _mkBarkMat(0x1c1208);
  const lean = (Math.random() - 0.5) * 0.26;

  const trunk = sh(new THREE.Mesh(_mkTrunkGeo(0.11, 0.32, 8.0, 10, 0.22, 8), mat));
  trunk.position.y = 4.0;
  trunk.rotation.z = lean;
  g.add(trunk);

  [
    [ 1.0, 4.2, 0.80,  0.72,  0.18],
    [-0.9, 3.8, 0.70, -0.66, -0.20],
    [ 0.3, 5.3, 0.58,  0.50,  0.06],
    [-0.7, 5.0, 0.64, -0.56,  0.24],
    [ 0.9, 6.2, 0.48,  0.44, -0.14],
    [-0.4, 6.8, 0.40, -0.38,  0.18],
    [ 0.5, 7.5, 0.30,  0.60, -0.08],
  ].forEach(([x, y, len, lZ, lX]) => {
    const br = sh(new THREE.Mesh(_mkTrunkGeo(0.028, 0.092, len, 6, 0.26, 4), mat));
    br.position.set(x * 0.48, y, x * 0.18);
    br.rotation.set(lX, Math.random() * Math.PI * 2, lZ);
    g.add(br);
    const sub = sh(new THREE.Mesh(_mkTrunkGeo(0.016, 0.030, len * 0.56, 5, 0.30, 3), mat));
    sub.position.set(x * 0.90, y + len * 0.38, x * 0.30);
    sub.rotation.set(lX * 1.22, Math.random() * Math.PI * 2, lZ * 1.38);
    g.add(sub);
    const twig = sh(new THREE.Mesh(_mkTrunkGeo(0.007, 0.014, len * 0.30, 4, 0.32), mat));
    twig.position.set(x * 1.32, y + len * 0.66, x * 0.44);
    twig.rotation.set(lX * 0.78, Math.random() * Math.PI * 2, lZ * 0.68 + (Math.random()-0.5) * 0.58);
    g.add(twig);
  });

  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}


export function mkGraveMound(s, ry) {
  const g = new THREE.Group();
  const mat = mkMat(0x1a1408, 0.99);
  const mound = sh(new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), mat
  ));
  mound.scale.set(1.0, 0.48, 1.65);
  mound.position.y = 0.02;
  g.add(mound);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

// ── Swamp micro-builders ──────────────────────────────────────────────────────

export function mkSwampVine(s, ry) {
  const g = new THREE.Group();
  const strandMat = mkMat(0x0b1504, 0.96);
  const leafMat   = mkMat(0x071004, 0.88);
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const len  = 4.5 + Math.random() * 4.0;
    const ox   = (Math.random() - 0.5) * 1.4;
    const oz   = (Math.random() - 0.5) * 1.4;
    const topY = len + 1.2;
    const botY = 1.2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ox,  topY, oz),
      new THREE.Vector3(ox + (Math.random() - 0.5) * 2.2,
                        topY * 0.65 + botY * 0.35,
                        oz  + (Math.random() - 0.5) * 2.2),
      new THREE.Vector3(ox + (Math.random() - 0.5) * 1.6,
                        topY * 0.28 + botY * 0.72,
                        oz  + (Math.random() - 0.5) * 1.6),
      new THREE.Vector3(ox,  botY, oz),
    ]);
    const strand = sh(new THREE.Mesh(
      new THREE.TubeGeometry(curve, 14, 0.08, 6, false), strandMat
    ));
    g.add(strand);
    const tuft = sh(new THREE.Mesh(
      new THREE.SphereGeometry(0.18 + Math.random() * 0.12, 5, 4), leafMat
    ));
    tuft.scale.set(1.5, 0.55, 1.3);
    tuft.position.set(ox, botY, oz);
    g.add(tuft);
  }
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkFern(s, ry) {
  const g = new THREE.Group();
  const mat   = mkMat(0x0a1e06, 0.87);
  const count = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const reach = 0.7 + Math.random() * 0.5;
    const frond = sh(new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.07, reach * 1.6, 4), mat
    ));
    frond.position.set(
      Math.cos(angle) * reach * 0.42,
      reach * 0.36,
      Math.sin(angle) * reach * 0.42
    );
    frond.rotation.z =  Math.cos(angle) * 0.75;
    frond.rotation.x = -Math.sin(angle) * 0.75;
    g.add(frond);
    const tip = sh(new THREE.Mesh(
      new THREE.SphereGeometry(0.10 + Math.random() * 0.06, 5, 4), mat
    ));
    tip.scale.set(1.4, 0.45, 1.1);
    tip.position.set(
      Math.cos(angle) * reach * 0.88,
      reach * 0.72,
      Math.sin(angle) * reach * 0.88
    );
    g.add(tip);
  }
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkBroadLeafPlant(s, ry) {
  const g = new THREE.Group();
  const bladeMat = mkMat(0x071506, 0.86);
  const stemMat  = mkMat(0x0a0e04, 0.97);
  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const reach = 0.9 + Math.random() * 0.7;
    const stem = sh(new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.045, reach, 4), stemMat
    ));
    stem.position.set(
      Math.cos(angle) * reach * 0.30,
      reach * 0.48,
      Math.sin(angle) * reach * 0.30
    );
    stem.rotation.z =  Math.cos(angle) * 0.65;
    stem.rotation.x = -Math.sin(angle) * 0.65;
    g.add(stem);
    const lw = 0.35 + Math.random() * 0.25;
    const ll = 0.55 + Math.random() * 0.35;
    const leaf = sh(new THREE.Mesh(
      new THREE.CylinderGeometry(lw * 0.55, lw, 0.07, 7), bladeMat
    ));
    leaf.scale.set(1.0, 1.0, ll / lw);
    leaf.position.set(
      Math.cos(angle) * reach * 0.72,
      reach * 0.90,
      Math.sin(angle) * reach * 0.72
    );
    leaf.rotation.y = angle;
    leaf.rotation.x = -(0.35 + Math.random() * 0.35);
    g.add(leaf);
  }
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkMossRock(s, ry) {
  const g    = new THREE.Group();
  const rock = sh(new THREE.Mesh(_mkRockGeo(1.1, 3, 0.22), _mkRockMat(0x141a10)));
  rock.scale.set(1.0, 0.62, 0.90);
  rock.position.y = 1.1 * 0.62 * 0.88;
  rock.rotation.set((Math.random()-0.5)*0.36, Math.random()*Math.PI*2, (Math.random()-0.5)*0.26);
  g.add(rock);

  const moss = sh(new THREE.Mesh(
    _displaceRock(new THREE.IcosahedronGeometry(0.86, 2), 0.09, Math.random()*Math.PI*2),
    new THREE.MeshStandardMaterial({ color: 0x0c1e08, roughness: 0.99, metalness: 0 })
  ));
  moss.scale.set(1.16, 0.34, 1.12);
  moss.position.y = 0.82;
  g.add(moss);

  _mkDebris(g, 0x141a10, 2 + Math.floor(Math.random()*2), 1.3);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

export function mkWaterPool(s, ry) {
  const g = new THREE.Group();
  const rimMat = mkMat(0x060c05, 0.98);
  const rim = sh(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.4, 0.12, 10), rimMat));
  rim.position.y = 0.02;
  g.add(rim);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x071510, roughness: 0.04, metalness: 0.55,
  });
  const water = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.0, 0.06, 10), waterMat);
  water.position.y = 0.06;
  g.add(water);
  g.scale.setScalar(s);
  g.rotation.y = ry;
  return g;
}

// ── Maple leaf geometry ───────────────────────────────────────────────────────

export function _makeMapleLeafGeo() {
  const s = new THREE.Shape();

  s.moveTo( 0.00, -0.50);

  s.quadraticCurveTo( 0.30, -0.32,  0.30, -0.18);
  s.quadraticCurveTo( 0.32, -0.08,  0.50, -0.04);
  s.quadraticCurveTo( 0.96,  0.00,  0.88,  0.15);
  s.quadraticCurveTo( 0.70,  0.24,  0.58,  0.27);
  s.quadraticCurveTo( 0.50,  0.30,  0.52,  0.40);
  s.quadraticCurveTo( 0.72,  0.58,  0.60,  0.67);
  s.quadraticCurveTo( 0.46,  0.72,  0.34,  0.65);
  s.quadraticCurveTo( 0.26,  0.60,  0.20,  0.66);
  s.quadraticCurveTo( 0.07,  0.96,  0.00,  0.96);
  s.quadraticCurveTo(-0.07,  0.96, -0.20,  0.66);
  s.quadraticCurveTo(-0.26,  0.60, -0.34,  0.65);
  s.quadraticCurveTo(-0.46,  0.72, -0.60,  0.67);
  s.quadraticCurveTo(-0.72,  0.58, -0.52,  0.40);
  s.quadraticCurveTo(-0.50,  0.30, -0.58,  0.27);
  s.quadraticCurveTo(-0.70,  0.24, -0.88,  0.15);
  s.quadraticCurveTo(-0.96,  0.00, -0.50, -0.04);
  s.quadraticCurveTo(-0.32, -0.08, -0.30, -0.18);
  s.quadraticCurveTo(-0.30, -0.32,  0.00, -0.50);

  const geo = new THREE.ShapeGeometry(s, 4);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ── Road / water builders ─────────────────────────────────────────────────────

function makeRoadTexture(repU, repV) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#c09060';
  ctx.fillRect(0, 0, S, S);
  [
    { colors: ['#8a5f28','#9a6f30','#7e5520'],  count: 80,  rMin: 12, rMax: 50, aMin: 0.20, aMax: 0.38 },
    { colors: ['#b88840','#a87830','#c09048'],  count: 110, rMin: 5,  rMax: 22, aMin: 0.15, aMax: 0.30 },
    { colors: ['#d4aa60','#deb868','#cca050'],  count: 130, rMin: 4,  rMax: 18, aMin: 0.12, aMax: 0.25 },
    { colors: ['#6a4818','#7a5820','#5e4010'],  count: 50,  rMin: 2,  rMax: 8,  aMin: 0.18, aMax: 0.35 },
  ].forEach(layer => {
    for (let i = 0; i < layer.count; i++) {
      const x  = Math.random() * S;
      const y  = Math.random() * S;
      const r  = layer.rMin + Math.random() * (layer.rMax - layer.rMin);
      const ry = r * (0.4 + Math.random() * 1.2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI);
      ctx.globalAlpha = layer.aMin + Math.random() * (layer.aMax - layer.aMin);
      ctx.fillStyle   = layer.colors[Math.floor(Math.random() * layer.colors.length)];
      ctx.beginPath();
      ctx.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repU, repV);
  return tex;
}

export function mkRoadSegment(s, ry) {
  const W = 2, L = 6, WS = 12, LS = 28;
  const geo = new THREE.PlaneGeometry(W, L, WS, LS);

  const roadTex = makeRoadTexture(2, 6);

  const AT = 64;
  const alphaData = new Uint8Array(AT * 4);
  for (let i = 0; i < AT; i++) {
    const u = i / (AT - 1);
    const t = Math.min(u / 0.18, (1 - u) / 0.18, 1.0);
    const v = Math.round(t * t * (3 - 2 * t) * 255);
    alphaData[i * 4 + 0] = v;
    alphaData[i * 4 + 1] = v;
    alphaData[i * 4 + 2] = v;
    alphaData[i * 4 + 3] = 255;
  }
  const alphaTex = new THREE.DataTexture(alphaData, AT, 1, THREE.RGBAFormat);
  alphaTex.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.97, metalness: 0, map: roadTex,
    transparent: true, alphaMap: alphaTex, opacity: 1.0, depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x    = -Math.PI / 2;
  mesh.position.y    = 0.025;
  mesh.receiveShadow = true;

  const grp = new THREE.Group();
  grp.add(mesh);
  grp.scale.setScalar(s);
  grp.rotation.y = ry;
  return grp;
}

export function mkWaterDisc(s, ry) {
  const geo = new THREE.CircleGeometry(6, 64);

  const mat = new THREE.MeshStandardMaterial({
    color:       0x020b18,
    roughness:   0.18,
    metalness:   0.62,
    transparent: true,
    opacity:     0.72,
    depthWrite:  false,
  });

  const mesh          = new THREE.Mesh(geo, mat);
  mesh.rotation.x     = -Math.PI / 2;
  mesh.position.y     = 0.04;
  mesh.receiveShadow  = true;
  mesh.renderOrder    = 1;

  const grp = new THREE.Group();
  grp.add(mesh);
  grp.scale.setScalar(s);
  grp.rotation.y = ry;
  return grp;
}

export function mkBloodPool(s, ry) {
  const geo = new THREE.CircleGeometry(6, 64);

  const mat = new THREE.MeshStandardMaterial({
    color:            0x5a0000,
    emissive:         0x880000,
    emissiveIntensity: 0.45,
    roughness:        0.55,
    metalness:        0.28,
    transparent:      true,
    opacity:          0.92,
    depthWrite:       false,
  });

  const mesh         = new THREE.Mesh(geo, mat);
  mesh.rotation.x    = -Math.PI / 2;
  mesh.position.y    = 0.04;
  mesh.receiveShadow = true;
  mesh.renderOrder   = 1;

  const grp = new THREE.Group();
  grp.add(mesh);

  const glow = new THREE.PointLight(0xcc1100, 2.5, 14, 1.4);
  glow.position.set(0, 3.0, 0);
  grp.add(glow);

  // ── Popping bubble rings ───────────────────────────────────────────────────
  const BUBBLE_COUNT = 7;
  const bMeshes = [];
  const bLife   = new Float32Array(BUBBLE_COUNT);
  const bDur    = new Float32Array(BUBBLE_COUNT);
  const bMaxR   = new Float32Array(BUBBLE_COUNT);
  const bX      = new Float32Array(BUBBLE_COUNT);
  const bZ      = new Float32Array(BUBBLE_COUNT);

  function _spawnBubble(i, startLife) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * 4.8;
    bX[i]    = Math.cos(ang) * rad;
    bZ[i]    = Math.sin(ang) * rad;
    bMaxR[i] = 0.07 + Math.random() * 0.14;
    bDur[i]  = 0.7  + Math.random() * 0.8;
    bLife[i] = startLife;
  }

  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const bMat = new THREE.MeshBasicMaterial({
      color: 0xff5500, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const bMesh = new THREE.Mesh(new THREE.RingGeometry(0.81, 1.0, 20), bMat);
    bMesh.rotation.x = -Math.PI / 2;
    bMesh.renderOrder = 2;
    grp.add(bMesh);
    bMeshes.push(bMesh);
    _spawnBubble(i, Math.random());  // stagger so they don't all appear at once
  }

  let _lastNow = 0;
  grp.userData.update = function() {
    const now = performance.now() / 1000;
    const dt  = _lastNow > 0 ? Math.min(now - _lastNow, 0.1) : 0.016;
    _lastNow  = now;

    for (let i = 0; i < BUBBLE_COUNT; i++) {
      bLife[i] += dt / bDur[i];
      if (bLife[i] >= 1.0) _spawnBubble(i, 0);

      const t   = bLife[i];
      const r   = bMaxR[i] * t;
      const opa = t < 0.15
        ? (t / 0.15) * 0.82
        : 0.82 * (1 - (t - 0.15) / 0.85);

      const bm  = bMeshes[i];
      bm.position.set(bX[i], 0.06, bZ[i]);
      bm.scale.setScalar(Math.max(0.001, r));
      bm.material.opacity = Math.max(0, opa);
    }
  };

  grp.scale.setScalar(s);
  grp.rotation.y = ry;
  return grp;
}

export function mkRoadCurve30(s, ry) {
  const ARC    = Math.PI / 6;
  const R      = 8;
  const HALF_W = 1;
  const LS     = 20;
  const WS     = 12;
  const ALPHA0 = Math.PI;
  const CX = R, CZ = 0;

  let sumCX = 0, sumCZ = 0;
  for (let j = 0; j <= LS; j++) {
    const theta = ALPHA0 + (j / LS) * ARC;
    sumCX += CX + R * Math.cos(theta);
    sumCZ += CZ + R * Math.sin(theta);
  }
  const centX = sumCX / (LS + 1);
  const centZ = sumCZ / (LS + 1);

  const nV     = (LS + 1) * (WS + 1);
  const posBuf = new Float32Array(nV * 3);
  const uvBuf  = new Float32Array(nV * 2);

  for (let j = 0; j <= LS; j++) {
    const v     = j / LS;
    const theta = ALPHA0 + v * ARC;
    const cosT  = Math.cos(theta);
    const sinT  = Math.sin(theta);
    const arcX  = CX + R * cosT - centX;
    const arcZ  = CZ + R * sinT - centZ;
    const nx = cosT, nz = sinT;

    for (let i = 0; i <= WS; i++) {
      const u   = i / WS;
      const w   = (u - 0.5) * 2 * HALF_W;
      const idx = j * (WS + 1) + i;

      posBuf[idx * 3 + 0] = arcX + w * nx;
      posBuf[idx * 3 + 1] = 0;
      posBuf[idx * 3 + 2] = arcZ + w * nz;

      uvBuf[idx * 2 + 0] = u;
      uvBuf[idx * 2 + 1] = v;
    }
  }

  const indices = [];
  for (let j = 0; j < LS; j++) {
    for (let i = 0; i < WS; i++) {
      const a = j * (WS + 1) + i, bi = a + 1;
      const c = (j + 1) * (WS + 1) + i, di = c + 1;
      indices.push(a, c, bi);
      indices.push(bi, c, di);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posBuf, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvBuf,  2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const roadTex = makeRoadTexture(2, 4);

  const AT = 64;
  const alphaData = new Uint8Array(AT * 4);
  for (let i = 0; i < AT; i++) {
    const u = i / (AT - 1);
    const t = Math.min(u / 0.18, (1 - u) / 0.18, 1.0);
    const v = Math.round(t * t * (3 - 2 * t) * 255);
    alphaData[i * 4 + 0] = v;  alphaData[i * 4 + 1] = v;
    alphaData[i * 4 + 2] = v;  alphaData[i * 4 + 3] = 255;
  }
  const alphaTex = new THREE.DataTexture(alphaData, AT, 1, THREE.RGBAFormat);
  alphaTex.needsUpdate = true;

  const mat  = new THREE.MeshStandardMaterial({
    roughness: 0.97, metalness: 0, map: roadTex,
    transparent: true, alphaMap: alphaTex, opacity: 1.0, depthWrite: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y  = 0.025;
  mesh.receiveShadow = true;

  const grp = new THREE.Group();
  grp.add(mesh);
  grp.scale.setScalar(s);
  grp.rotation.y = ry;
  return grp;
}

export function mkArrow(s = 1, ry = 0) {
  const grp = new THREE.Group();

  const shaftGeo = new THREE.CylinderGeometry(0.021, 0.026, 0.92, 6);
  shaftGeo.rotateX(Math.PI / 2);
  grp.add(new THREE.Mesh(shaftGeo,
    new THREE.MeshStandardMaterial({ color: 0x9b7a2e, roughness: 0.88, metalness: 0.02 })));

  const headGeo = new THREE.ConeGeometry(0.044, 0.20, 6);
  headGeo.rotateX(Math.PI / 2);
  headGeo.translate(0, 0, 0.56);
  grp.add(new THREE.Mesh(headGeo,
    new THREE.MeshStandardMaterial({ color: 0x464450, roughness: 0.38, metalness: 0.78 })));

  const fletchMat = new THREE.MeshStandardMaterial({ color: 0xbfaa88, roughness: 0.95, side: THREE.DoubleSide });
  for (let f = 0; f < 3; f++) {
    const fGeo = new THREE.PlaneGeometry(0.052, 0.17);
    fGeo.translate(0, 0.038, -0.355);
    const fMesh = new THREE.Mesh(fGeo, fletchMat);
    fMesh.rotation.z = (f / 3) * Math.PI * 2;
    grp.add(fMesh);
  }

  grp.scale.setScalar(s);
  grp.rotation.y = ry;
  return grp;
}

// ── Fog patch ─────────────────────────────────────────────────────────────────
// Each placement gets its own texture + material so clearProps() disposal
// on zone reload never leaves stale dead references in the module cache.

function _mkFogCanvas(color) {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const gr = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  gr.addColorStop(0,    'rgba(255,255,255,0.88)');
  gr.addColorStop(0.40, 'rgba(255,255,255,0.68)');
  gr.addColorStop(0.72, 'rgba(255,255,255,0.28)');
  gr.addColorStop(1.0,  'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  return new THREE.MeshBasicMaterial({
    color, map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, fog: false,
  });
}

function _mkFogMesh(mat, count, opacity, renderOrder) {
  const rnd  = (a, b) => a + Math.random() * (b - a);
  const RADIUS = 5.5, WRAP = RADIUS + 2;
  mat.opacity = opacity;
  const geo  = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder   = renderOrder;

  const px = new Float32Array(count), py = new Float32Array(count), pz = new Float32Array(count);
  const vx = new Float32Array(count), vz = new Float32Array(count);
  const ry = new Float32Array(count), vry = new Float32Array(count);
  const tX = new Float32Array(count), tZ  = new Float32Array(count);
  const sz = new Float32Array(count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * RADIUS;
    px[i]  = Math.cos(ang) * rad;
    py[i]  = rnd(0.04, 0.78);
    pz[i]  = Math.sin(ang) * rad;
    const da = Math.random() * Math.PI * 2;
    const sp = rnd(0.0015, 0.0045);
    vx[i]  = Math.cos(da) * sp;
    vz[i]  = Math.sin(da) * sp;
    ry[i]  = Math.random() * Math.PI * 2;
    vry[i] = rnd(-0.0002, 0.0002);
    tX[i]  = (Math.random() - 0.5) * 0.28;
    tZ[i]  = (Math.random() - 0.5) * 0.20;
    sz[i]  = rnd(5, 11);

    dummy.position.set(px[i], py[i], pz[i]);
    dummy.rotation.set(-Math.PI / 2 + tX[i], ry[i], tZ[i]);
    dummy.scale.setScalar(sz[i]);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  mesh.userData.update = function() {
    for (let i = 0; i < count; i++) {
      px[i] += vx[i]; pz[i] += vz[i]; ry[i] += vry[i];
      if (px[i] >  WRAP) px[i] -= WRAP * 2;
      if (px[i] < -WRAP) px[i] += WRAP * 2;
      if (pz[i] >  WRAP) pz[i] -= WRAP * 2;
      if (pz[i] < -WRAP) pz[i] += WRAP * 2;
      dummy.position.set(px[i], py[i], pz[i]);
      dummy.rotation.set(-Math.PI / 2 + tX[i], ry[i], tZ[i]);
      dummy.scale.setScalar(sz[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  return mesh;
}

export function mkFogPatch() {
  return _mkFogMesh(_mkFogCanvas(0x4868a8), 22, 0.36, 1);
}


// ── Investigation light ───────────────────────────────────────────────────────
// Invisible pulsing point light — highlights nearby props/terrain as a POI marker.
// Placeable point light with adjustable intensity and range.
// The glowing orb is dev-only; hidden in play mode via setPointLightOrbsVisible().

const _pointLightOrbs = new Set();
let _pointLightOrbsVisible = true;

export function setPointLightOrbsVisible(visible) {
  _pointLightOrbsVisible = visible;
  for (const orb of _pointLightOrbs) orb.visible = visible;
}

export function mkPointLight(intensity = 6, range = 18) {
  const grp = new THREE.Group();

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffcc44, emissiveIntensity: 3.0 }),
  );
  orb.frustumCulled = false;
  orb.visible = _pointLightOrbsVisible;
  grp.add(orb);
  _pointLightOrbs.add(orb);

  const light = new THREE.PointLight(0xffcc88, intensity, range, 1.5);
  light.position.set(0, 0.2, 0);
  grp.add(light);

  grp.userData.light        = light;
  grp.userData.orbMesh      = orb;
  grp.userData.isPointLight = true;

  return grp;
}

export function mkExclamationMarker() {
  const grp = new THREE.Group();

  // Canvas "!" sprite
  const W = 64, H = 96;
  const cv  = document.createElement('canvas');
  cv.width  = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.font         = 'bold 86px Arial Black, Arial, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle  = '#6b3d00';
  ctx.lineWidth    = 8;
  ctx.strokeText('!', W / 2, H / 2);
  ctx.fillStyle    = '#FFE000';
  ctx.fillText('!', W / 2, H / 2);

  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  const worldH = 1.0;
  spr.scale.set((W / H) * worldH, worldH, 1);
  spr.frustumCulled = false;
  grp.add(spr);

  // Tiny invisible sphere so the designer can click the marker in dev mode
  const helperMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffcc44, visible: false }),
  );
  helperMesh.frustumCulled = false;
  grp.add(helperMesh);

  grp.userData.isStar     = true;
  grp.userData.sprite     = spr;
  grp.userData.helperMesh = helperMesh;
  grp.userData.baseScaleX = spr.scale.x;
  grp.userData.baseScaleY = spr.scale.y;

  return grp;
}

export function mkWaystoneDisc(waystoneId, mapTab) {
  const grp = new THREE.Group();
  const R = 1.0, H = 0.17;
  const DETECT_R = 2.0; // WU — ~5ft from coin edge
  grp.userData.isWaystone  = true;
  grp.userData.mapTab      = mapTab ?? 'I';
  grp.userData.waystoneId  = waystoneId ?? null;

  // Dormant: grey-blue. Active: light blue. Shared material — color swapped on activation.
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x6e8892, roughness: 0.55, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x333a3f, roughness: 0.6,  metalness: 0.25 });

  // Invisible tall cylinder — easy click target regardless of camera angle
  const clickHelper = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.2, R * 1.2, 1.2, 16),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  clickHelper.position.y = 0.6;
  clickHelper.userData.isWaystoneHelper = true;
  grp.add(clickHelper);

  // Coin body
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64), [darkMat, blueMat, blueMat]);
  coin.position.y = H / 2;
  coin.castShadow = coin.receiveShadow = true;
  grp.add(coin);

  const borderGeo = new THREE.RingGeometry(R * 0.84, R, 64);
  borderGeo.rotateX(-Math.PI / 2);
  const border = new THREE.Mesh(borderGeo, darkMat);
  border.position.y = H + 0.002;
  grp.add(border);

  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 32), darkMat);
  dot.position.y = H + 0.025;
  grp.add(dot);

  // Soft dormant pulse light — always present, dims when activated
  const dormantLight = new THREE.PointLight(0x66ccff, 1.0, 7, 1.4);
  dormantLight.position.y = H + 0.4;
  grp.add(dormantLight);

  // Bright activation glow — starts off
  const glow = new THREE.PointLight(0x88ddff, 0, 6, 1.6);
  glow.position.y = H + 0.6;
  grp.add(glow);

  // Halo ring — starts invisible
  const haloGeo = new THREE.RingGeometry(R * 0.95, R * 1.35, 64);
  haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x88ddff, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = H + 0.004;
  halo.renderOrder = 2;
  halo.frustumCulled = false;
  halo.visible = false;
  grp.add(halo);

  // Circular soft-blob texture for wisps
  const _wispCanvas = document.createElement('canvas');
  _wispCanvas.width = _wispCanvas.height = 64;
  const _wispCtx = _wispCanvas.getContext('2d');
  const _wispGrad = _wispCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  _wispGrad.addColorStop(0,   'rgba(255,255,255,1)');
  _wispGrad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  _wispGrad.addColorStop(1,   'rgba(255,255,255,0)');
  _wispCtx.fillStyle = _wispGrad;
  _wispCtx.fillRect(0, 0, 64, 64);
  const _wispTex = new THREE.CanvasTexture(_wispCanvas);

  // Vapor wisps — start hidden, confined directly above coin
  const WISP_COUNT = 60;
  const wisps = [];
  for (let i = 0; i < WISP_COUNT; i++) {
    const size = 0.10 + Math.random() * 0.14;
    const mat  = new THREE.MeshBasicMaterial({
      color: 0xaaeeff, map: _wispTex, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.renderOrder = 3;
    mesh.visible = false;
    grp.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * R * 0.7;
    wisps.push({ mesh, ox: Math.cos(a) * r, oz: Math.sin(a) * r,
                 life: Math.random(), dur: 1.4 + Math.random() * 1.2 });
  }

  const _visualActivate = () => {
    _activated = true;
    blueMat.color.set(0xa8d8ea);
    dormantLight.intensity = 0;
    halo.visible = true;
    wisps.forEach(w => { w.mesh.visible = true; w.life = Math.random(); });
  };

  // Check localStorage directly to avoid circular import through worldMap→zoneLoader→environments→here
  const _alreadyActivated = waystoneId
    ? (() => { try { const r = localStorage.getItem('dnd-activated-waystones'); return r ? JSON.parse(r).includes(waystoneId) : false; } catch { return false; } })()
    : false;

  let _activated    = _alreadyActivated;
  let _setAudioDist = null;
  let _audioHandle  = null; // { setDist, stop }

  const _startAudio = (playActivation) => {
    _audioHandle  = startWaystoneAudio(playActivation);
    _setAudioDist = _audioHandle.setDist;
  };

  if (_alreadyActivated) {
    _visualActivate();
    _startAudio(false);
  }

  // Allow external click-activation (e.g. from army.js within 20ft)
  grp.userData.tryActivate = () => {
    if (_activated) return;
    _visualActivate();
    _startAudio(true);
    window.dispatchEvent(new CustomEvent('waystone:activated', { detail: { waystoneId } }));
  };

  // Called by clearProps() on zone unload — stops looping audio
  grp.userData.destroy = () => _audioHandle?.stop();

  let _t = Math.random() * Math.PI * 2;
  const _dt = 1 / 60;

  grp.userData.update = () => {
    _t += _dt;

    // Proximity check — one-shot activation
    if (!_activated) {
      const px = grp.position.x, pz = grp.position.z;
      for (const u of units) {
        if (u.team !== 'blue' || u.hp <= 0) continue;
        const dx = u.grp.position.x - px, dz = u.grp.position.z - pz;
        if (dx * dx + dz * dz <= DETECT_R * DETECT_R) {
          _visualActivate();
          _startAudio(true);
          window.dispatchEvent(new CustomEvent('waystone:activated', { detail: { waystoneId } }));
          break;
        }
      }
      if (!_activated) {
        const dormantPulse = Math.sin(_t * 0.9) * 0.5 + 0.5;
        dormantLight.intensity = 0.2 + dormantPulse * 20;
        return;
      }
    }

    // Pulse glow + halo — floors keep ring always visible
    const pulse = Math.sin(_t * 1.8) * 0.5 + 0.5;
    glow.intensity  = 3.0 + pulse * 17.0;   // 3 → 20
    haloMat.opacity = 0.30 + pulse * 0.60;  // 0.30 → 0.90

    // Vapors: rise straight up, fixed x/z above coin surface
    for (const w of wisps) {
      w.life += _dt / w.dur;
      if (w.life >= 1.0) {
        w.life = 0;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * R * 0.7;
        w.ox = Math.cos(a) * r;
        w.oz = Math.sin(a) * r;
        w.dur = 1.4 + Math.random() * 1.2;
      }
      const t  = w.life;
      const op = t < 0.15 ? t / 0.15 : t > 0.72 ? (1 - t) / 0.28 : 1.0;
      w.mesh.material.opacity = op * 0.55;
      w.mesh.position.set(w.ox, H + 0.05 + t * 2.2, w.oz);
      w.mesh.lookAt(w.mesh.position.x, w.mesh.position.y + 10, w.mesh.position.z);
    }

    // Distance-based audio — find closest hero
    if (_setAudioDist) {
      const px = grp.position.x, pz = grp.position.z;
      let minDist = Infinity;
      for (const u of units) {
        if (u.team !== 'blue' || u.hp <= 0) continue;
        const dx = u.grp.position.x - px, dz = u.grp.position.z - pz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < minDist) minDist = d;
      }
      _setAudioDist(minDist);
    }
  };

  return grp;
}

export function mkDarknessPlane() {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 8;
  mesh.frustumCulled = false;
  return mesh;
}
