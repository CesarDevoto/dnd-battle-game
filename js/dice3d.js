// js/dice3d.js — cinematic 3D dice rolling overlay
// Separate WebGL renderer + scene composited above the game via a fixed overlay div.
import * as THREE from 'three';

const FLOOR_Y = -1.05;

// ── Pentagonal trapezohedron (d10) geometry ───────────────────────────────────
// 12 vertices: top apex, bottom apex, 5 upper-equatorial, 5 lower-equatorial.
// 10 kite-shaped faces split into 2 triangles each (20 tris total).
function makeD10Geometry(r) {
  const N      = 5;
  const topY   =  1.15 * r;
  const upperY =  0.26 * r;
  const lowerY = -0.20 * r;
  const botY   = -1.15 * r;
  const top    = [0, topY, 0];
  const bot    = [0, botY, 0];
  const upper  = [];
  const lower  = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    upper.push([r * Math.cos(a), upperY, r * Math.sin(a)]);
  }
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;  // offset 36° from upper ring
    lower.push([r * Math.cos(a), lowerY, r * Math.sin(a)]);
  }
  const verts = [];
  const push3 = v => verts.push(v[0], v[1], v[2]);
  const tri   = (a, b, c) => { push3(a); push3(b); push3(c); };
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    tri(top, lower[i], upper[i]);   // upper kite — left half
    tri(top, upper[j], lower[i]);   // upper kite — right half
    tri(bot, lower[i], upper[j]);   // lower kite — left half
    tri(bot, upper[j], lower[j]);   // lower kite — right half
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Die definitions ───────────────────────────────────────────────────────────

const DEF = {
   4: { g: () => new THREE.TetrahedronGeometry(1.30, 0),   c: 0x118855, e: 0x003322 },
   6: { g: () => new THREE.BoxGeometry(1.45, 1.45, 1.45),  c: 0xcc2020, e: 0x3d0000 },
   8: { g: () => new THREE.OctahedronGeometry(1.30, 0),    c: 0xcc6e00, e: 0x3d1800 },
  10: { g: () => makeD10Geometry(1.20),                    c: 0xaa8800, e: 0x2e2000 },
  12: { g: () => new THREE.DodecahedronGeometry(1.28, 0),  c: 0x8822bb, e: 0x280038 },
  20: { g: () => new THREE.IcosahedronGeometry(1.38, 0),   c: 0x1144cc, e: 0x01061e },
};
const fallback = DEF[20];

// ── DOM overlay ───────────────────────────────────────────────────────────────

const OV = document.createElement('div');
OV.id = 'dice3d-ov';
OV.style.cssText =
  'position:fixed;inset:0;z-index:750;pointer-events:none;opacity:0;' +
  'transition:opacity .20s ease;background:rgba(6,2,0,.50)';
document.body.appendChild(OV);

const diceCvs = document.createElement('canvas');
diceCvs.style.cssText =
  'position:absolute;width:33%;height:33%;left:50%;top:55%;transform:translate(-50%,-50%)';
OV.appendChild(diceCvs);

function mkEl(css) {
  const el = document.createElement('div');
  el.style.cssText = css;
  OV.appendChild(el);
  return el;
}

const rollerEl = mkEl(
  'position:absolute;bottom:47%;left:0;right:0;text-align:center;' +
  'color:#f3d260;font:bold 1.5rem/1 "Trebuchet MS",sans-serif;' +
  'letter-spacing:4px;text-transform:uppercase;' +
  'text-shadow:0 0 14px rgba(240,160,20,.9),0 3px 7px rgba(0,0,0,1);' +
  'opacity:0;transition:opacity .22s'
);
const resultEl = mkEl(
  'position:absolute;bottom:32%;left:0;right:0;text-align:center;' +
  'font:bold 6.5rem/1 Georgia,serif;letter-spacing:5px;color:#fff;' +
  'text-shadow:0 0 30px rgba(255,120,0,1),0 0 80px rgba(255,60,0,.55),0 4px 12px #000;' +
  'opacity:0;transition:opacity .30s'
);
const infoEl = mkEl(
  'position:absolute;bottom:25%;left:0;right:0;text-align:center;' +
  'color:rgba(255,220,130,1);font:italic 1.35rem/1 Georgia,serif;letter-spacing:3px;' +
  'text-shadow:0 0 12px rgba(255,160,40,.8),0 2px 6px rgba(0,0,0,1);' +
  'opacity:0;transition:opacity .25s'
);
const skipEl = mkEl(
  'position:absolute;bottom:4%;left:0;right:0;text-align:center;' +
  'color:rgba(255,255,255,.26);font:.72rem "Trebuchet MS",sans-serif;letter-spacing:2px;' +
  'opacity:0;transition:opacity .4s'
);
skipEl.textContent = 'CLICK TO SKIP';

// ── Three.js dice scene ───────────────────────────────────────────────────────

const dr = new THREE.WebGLRenderer({ canvas: diceCvs, antialias: true, alpha: true });
dr.setPixelRatio(Math.min(window.devicePixelRatio, 2));
dr.shadowMap.enabled = true;
dr.shadowMap.type    = THREE.PCFShadowMap;
dr.toneMapping       = THREE.ACESFilmicToneMapping;
dr.toneMappingExposure = 1.40;

const ds = new THREE.Scene();
const dc = new THREE.PerspectiveCamera(42, 1, 0.1, 80);

function onResize() {
  const w = Math.round(window.innerWidth  / 3);
  const h = Math.round(window.innerHeight / 3);
  dr.setSize(w, h, false);
  dc.aspect = w / h;
  dc.updateProjectionMatrix();
}
onResize();
window.addEventListener('resize', onResize);

// Lights
ds.add(new THREE.HemisphereLight(0xfff4e0, 0x330a00, 0.55));

const keyL = new THREE.DirectionalLight(0xfff0cc, 2.30);
keyL.position.set(5, 9, 6);
keyL.castShadow = true;
keyL.shadow.mapSize.set(512, 512);
keyL.shadow.camera.near   = 1;  keyL.shadow.camera.far    = 28;
keyL.shadow.camera.left   = -6; keyL.shadow.camera.right  =  6;
keyL.shadow.camera.bottom = -6; keyL.shadow.camera.top    =  6;
ds.add(keyL);

const fillL = new THREE.PointLight(0x8899ff, 0.90, 30);
fillL.position.set(-6, 3, -3);
ds.add(fillL);

const rimL = new THREE.DirectionalLight(0x4466ff, 0.40);
rimL.position.set(-2, 5, -7);
ds.add(rimL);

const sFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.ShadowMaterial({ opacity: 0.28 })
);
sFloor.rotation.x = -Math.PI / 2;
sFloor.position.y = FLOOR_Y - 0.05;
sFloor.receiveShadow = true;
ds.add(sFloor);

// ── Die mesh factory ──────────────────────────────────────────────────────────

function faceCanvas(num, col) {
  const cv  = document.createElement('canvas');
  cv.width  = cv.height = 256;
  const ctx = cv.getContext('2d');
  const r   = (col >> 16) & 0xff, g = (col >> 8) & 0xff, b = col & 0xff;

  // Dark face background
  ctx.fillStyle = `rgb(${r * .55 | 0},${g * .55 | 0},${b * .55 | 0})`;
  ctx.beginPath(); ctx.roundRect(8, 8, 240, 240, 28); ctx.fill();

  // Inner radial glow
  const grd = ctx.createRadialGradient(128, 65, 8, 128, 128, 134);
  grd.addColorStop(0, 'rgba(255,255,255,.23)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.roundRect(8, 8, 240, 240, 28); ctx.fill();

  // Number
  ctx.fillStyle       = '#fff';
  ctx.shadowColor     = `rgb(${r},${g},${b})`;
  ctx.shadowBlur      = 16;
  ctx.font            = `bold ${num >= 10 ? 126 : 148}px Georgia`;
  ctx.textAlign       = 'center';
  ctx.textBaseline    = 'middle';
  ctx.fillText(String(num), 128, 142);

  // Underline 6 / 9 to distinguish
  if (num === 6 || num === 9) {
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font      = 'bold 22px Georgia';
    ctx.shadowBlur = 0;
    ctx.fillText('—', 128, 218);
  }
  return new THREE.CanvasTexture(cv);
}

function makeD6(result) {
  // BoxGeometry face slots: +X -X +Y(top) -Y +Z -Z
  // Put result at slot 2 (+Y).  Identity rotation → result faces up.
  const others = [1,2,3,4,5,6].filter(n => n !== result && n !== (7 - result));
  for (let i = others.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [others[i], others[j]] = [others[j], others[i]];
  }
  const col  = DEF[6].c;
  const nums = [others[0], others[1], result, 7 - result, others[2], others[3]];
  const mats = nums.map(n => new THREE.MeshStandardMaterial({
    map: faceCanvas(n, col), roughness: 0.36, metalness: 0.14,
  }));
  const m = new THREE.Mesh(DEF[6].g(), mats);
  m.castShadow = true;
  return m;
}

function makeDie(sides, result) {
  if (sides === 6) return makeD6(result);
  const def  = DEF[sides] ?? fallback;
  const mat  = new THREE.MeshStandardMaterial({
    color: def.c, emissive: def.e, emissiveIntensity: 0.55,
    roughness: 0.17, metalness: 0.58,
  });
  const mesh = new THREE.Mesh(def.g(), mat);
  mesh.castShadow = true;
  // Subtle wireframe to show facets
  mesh.add(new THREE.Mesh(def.g(),
    new THREE.MeshBasicMaterial({ wireframe: true, color: 0xffffff, transparent: true, opacity: 0.10 })
  ));
  return mesh;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

const queue = [];
let   busy  = false;
let   skipFn = null;

OV.addEventListener('click', () => skipFn?.());

function drain() {
  if (!queue.length) { busy = false; return; }
  busy = true;
  const entry = queue.shift();
  if (entry.banner) showBannerEntry(entry, drain);
  else              animateOne(entry, queue.length >= 1, drain);
}

function showBannerEntry({ text, color, shadow }, onDone) {
  OV.style.background    = 'rgba(6,2,0,.35)';
  OV.style.transition    = 'opacity .12s ease';
  OV.style.opacity       = '1';
  OV.style.pointerEvents = 'none';
  rollerEl.style.opacity = '0';
  infoEl.style.opacity   = '0';
  skipEl.style.opacity   = '0';

  resultEl.textContent      = text;
  resultEl.style.color      = color;
  resultEl.style.textShadow = shadow;
  resultEl.style.transition = 'opacity .12s';
  resultEl.style.opacity    = '1';

  setTimeout(() => {
    resultEl.style.opacity = '0';
    OV.style.opacity       = '0';
    setTimeout(() => {
      // Restore default result styles for the next dice roll
      resultEl.style.color      = '#fff';
      resultEl.style.textShadow = '0 0 30px rgba(255,120,0,1),0 0 80px rgba(255,60,0,.55),0 4px 12px #000';
      onDone();
    }, 200);
  }, 700);
}

export function showHitBanner() {
  queue.push({ banner: true, text: 'HIT',
    color:  '#f3d260',
    shadow: '0 0 30px rgba(240,160,20,1),0 0 80px rgba(255,200,0,.6),0 4px 12px #000' });
  if (!busy) drain();
}

export function showMissBanner() {
  queue.push({ banner: true, text: 'MISS',
    color:  '#ff3333',
    shadow: '0 0 30px rgba(255,40,40,1),0 0 80px rgba(200,0,0,.6),0 4px 12px #000' });
  if (!busy) drain();
}

/** Immediately finish any active animation and drain the queue. Call when a new turn starts. */
export function clearDiceQueue() {
  queue.length = 0;
  skipFn?.();
}

/** Queue a 3D dice roll display.
 *  @param {string}  label   roller / action label
 *  @param {object}  result  return value of roll()
 *  @param {boolean} skip3D  pass true to bypass the 3D display entirely
 */
export function show3DRoll(label, result, skip3D = false) {
  if (skip3D) return;
  queue.push({ label, result });
  if (!busy) drain();
}

// ── Animation ─────────────────────────────────────────────────────────────────

const ID_Q = new THREE.Quaternion();  // identity — +Y is up

function animateOne({ label, result }, fast, onDone) {
  const { total: val, sides, count, modifier = 0, isCrit, isFumble, dice, mode } = result;

  // Prep overlay
  OV.style.background    = 'rgba(6,2,0,.50)';
  OV.style.transition    = 'opacity .20s ease';
  OV.style.opacity       = '1';
  OV.style.pointerEvents = 'auto';

  let displayLabel = label;
  if (mode === 'advantage')    displayLabel += '  (ADV)';
  if (mode === 'disadvantage') displayLabel += '  (DIS)';
  rollerEl.textContent   = displayLabel;
  rollerEl.style.opacity = '0';
  resultEl.style.opacity = '0';
  infoEl.style.opacity   = '0';
  skipEl.style.opacity   = '0';

  // Info line: full roll breakdown (raw die + modifier = total)
  const modSign = modifier > 0 ? `+${modifier}` : `${modifier}`;
  let infoText;
  if (mode === 'advantage' || mode === 'disadvantage') {
    const [a, b] = dice;
    infoText = 'roll ' + (mode === 'advantage'
      ? `[${a >= b ? `<b>${a}</b>, ${b}` : `${a}, <b>${b}</b>`}]`
      : `[${a <= b ? `<b>${a}</b>, ${b}` : `${a}, <b>${b}</b>`}]`);
    infoText += modifier !== 0 ? `  mod ${modSign} = ${val}` : ` = ${val}`;
  } else if (count > 1) {
    const modStr = modifier > 0 ? ` +${modifier}` : modifier < 0 ? ` ${modifier}` : '';
    infoText = `[${dice.join(' + ')}]${modStr} = ${val}`;
  } else {
    // Single die: show raw die value + modifier breakdown
    const raw = dice[0];
    infoText = modifier !== 0 ? `roll ${raw}  mod ${modSign} = ${val}` : `roll ${raw}`;
  }
  infoEl.innerHTML = infoText;

  // Build die
  const die = makeDie(sides, val);
  ds.add(die);
  const dl = new THREE.PointLight(DEF[sides]?.c ?? 0x4488ff, 2.0, 13);
  ds.add(dl);

  // Starting position & rotation velocity
  const sx   = (Math.random() > 0.5 ? 1 : -1) * (1.8 + Math.random() * 0.5);
  die.position.set(sx, 3.8, 0);
  die.scale.setScalar(0.01);

  const AV = new THREE.Vector3(
    (Math.random() - 0.5) * 26,
    (Math.random() - 0.5) * 26,
    (Math.random() - 0.5) * 26,
  );

  // Camera start
  const CAM_START_Z = fast ? 8.5 : 10.0;
  const CAM_END_Z   = fast ? 6.8 : 7.2;
  dc.position.set(0, 2.5, CAM_START_Z);
  dc.lookAt(0, 0, 0);

  // Phase durations
  const T_FALL    = fast ? 0.62 : 0.95;
  const T_SETTLE  = fast ? 0.22 : 0.38;
  const T_DISPLAY = fast ? 3.48 : 3.88;

  let phase     = 0;  // 0=fall  1=settle  2=display  3=exit
  let phaseT    = 0;
  let fromQuat  = null;
  let impacted  = false;
  let running   = true;
  let prevNow   = performance.now();

  function finish() {
    running = false;
    skipFn  = null;
    OV.style.pointerEvents = 'none';
    OV.style.opacity       = '0';
    rollerEl.style.opacity = '0';
    resultEl.style.opacity = '0';
    infoEl.style.opacity   = '0';
    skipEl.style.opacity   = '0';
    setTimeout(() => {
      ds.remove(die);
      ds.remove(dl);
      die.traverse(c => {
        c.geometry?.dispose();
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material?.dispose();
      });
      onDone();
    }, 300);
  }

  skipFn = finish;

  function tick(now) {
    if (!running) return;
    const dt  = Math.min((now - prevNow) / 1000, 0.05);
    prevNow   = now;
    phaseT   += dt;

    // Camera smooth zoom
    const czProgress = Math.min(1, phaseT / 1.4);
    const czEased    = czProgress * czProgress * (3 - 2 * czProgress);
    dc.position.z    = CAM_START_Z + (CAM_END_Z - CAM_START_Z) * czEased;
    dc.position.y    = Math.max(0.8, 2.5 - phaseT * 0.55);
    dc.lookAt(0, 0, 0);

    // ─── FALL ───
    if (phase === 0) {
      const t   = Math.min(1, phaseT / T_FALL);
      const eas = t * t * (3 - 2 * t);  // smoothstep

      // Scale in quickly
      die.scale.setScalar(Math.min(1, t * 3.0));

      // Y: drop then one bounce
      let yPos;
      if (t < 0.70) {
        const ft = t / 0.70;
        yPos = 3.8 + (FLOOR_Y - 3.8) * ft * ft;
      } else {
        const bt = (t - 0.70) / 0.30;
        yPos = FLOOR_Y + Math.sin(bt * Math.PI) * 0.55;
      }
      die.position.set(sx * (1 - eas), yPos, 0);

      // Angular velocity; dampen after impact
      if (t >= 0.70 && !impacted) {
        impacted = true;
        AV.multiplyScalar(0.40);
        setTimeout(() => { if (running) skipEl.style.opacity = '1'; }, 300);
      }
      die.rotation.x += AV.x * dt;
      die.rotation.y += AV.y * dt;
      die.rotation.z += AV.z * dt;
      AV.multiplyScalar(1 - dt * 1.4);
      dl.position.copy(die.position);

      if (t >= 1) { phase = 1; phaseT = 0; fromQuat = die.quaternion.clone(); }

    // ─── SETTLE ───
    } else if (phase === 1) {
      const t  = Math.min(1, phaseT / T_SETTLE);
      const st = t * t * (3 - 2 * t);

      if (sides === 6) {
        // Slerp d6 so result face ends on top
        die.quaternion.slerpQuaternions(fromQuat, ID_Q, st);
      } else {
        AV.multiplyScalar(1 - dt * 9);
        die.rotation.x += AV.x * dt;
        die.rotation.y += AV.y * dt;
        die.rotation.z += AV.z * dt;
      }
      die.position.y = FLOOR_Y + Math.sin(t * Math.PI * 2.2) * 0.032 * (1 - t);
      die.position.x += (0 - die.position.x) * dt * 8;
      dl.position.copy(die.position);

      if (t >= 1) {
        phase = 2; phaseT = 0;

        // Set result number style
        if (isCrit) {
          resultEl.style.color      = '#ffe040';
          resultEl.style.textShadow = '0 0 34px rgba(255,200,0,1),0 0 90px rgba(255,100,0,.85),0 4px 10px #000';
          resultEl.textContent      = '⚡ ' + val;
          OV.style.background       = 'rgba(40,24,0,.54)';
        } else if (isFumble) {
          resultEl.style.color      = '#ff4444';
          resultEl.style.textShadow = '0 0 30px rgba(255,0,0,1),0 0 75px rgba(180,0,0,.7),0 4px 8px #000';
          resultEl.textContent      = '💀 ' + val;
          OV.style.background       = 'rgba(30,0,0,.56)';
        } else {
          resultEl.style.color      = '#ffffff';
          resultEl.style.textShadow = '0 0 28px rgba(255,120,0,1),0 0 70px rgba(255,60,0,.55),0 4px 10px #000';
          resultEl.textContent      = String(val);
        }
      }

    // ─── DISPLAY ───
    } else if (phase === 2) {
      die.position.y = FLOOR_Y + Math.sin(phaseT * 2.6) * 0.035;
      dl.intensity   = 2.0 + Math.sin(phaseT * 5.0) * 0.42;
      dl.position.copy(die.position);

      if (phaseT >= T_DISPLAY) {
        phase = 3; phaseT = 0;
        resultEl.style.opacity = '0';
        infoEl.style.opacity   = '0';
        rollerEl.style.opacity = '0';
        skipEl.style.opacity   = '0';
        OV.style.background    = 'rgba(6,2,0,.50)';
        OV.style.opacity       = '0';
      }

    // ─── EXIT ───
    } else if (phase === 3) {
      die.scale.setScalar(Math.max(0, 1 - phaseT / 0.28));
      if (phaseT >= 0.32) { finish(); return; }
    }

    dr.render(ds, dc);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
