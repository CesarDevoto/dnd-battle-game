import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, ground, grid, ambient, moon, fire, camera, rebuildGrid } from './scene.js';
import { playAmbient } from './audio.js';
import { ENVS, ANIM, COLORS, HERO_ZONE } from './constants.js';
import { getTerrainHeight, rebuildTerrain, isOnTunnelFloor, setTerrainAmplitudeScale, setTerrainProfile } from './terrain.js';
import {
  _windBlobs, _cachedMats, _cachedGeos, updateWind,
  mkRock, mkSnowBoulder, mkBoulderCluster, mkBush, mkGlowMushroom, mkRubblePile,
  mkDryShrub, mkFern, mkGraveMound, mkCross, mkRoadSegment, mkWaterDisc, mkRoadCurve30, mkArrow,
  mkForestTree, mkPineTree, mkAcaciaTree, mkSwampTree,
  mkSwampVine, mkBroadLeafPlant, mkMossRock, mkWaterPool,
  mkTorch, mkTombstone, mkDeadTree,
  mkIce, mkLog, mkTunnelPillar, mkTunnelWall, mkBrokenStatue,
  _makeMapleLeafGeo,
  clearPointLightOrbs,
} from './propBuilders.js';

let t = 0;
const R = (a, b) => a + Math.random() * (b - a);

// evergreenReady resolves immediately — GLB trees load async after scene init
export const evergreenReady = Promise.resolve();

// ── Particle systems ──────────────────────────────────────────────────────────

function makePS(N, color, size, opacity, initFn, updateFn) {
  const pos  = new Float32Array(N * 3);
  const vel  = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) initFn(pos, vel, i * 3);
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.usage = THREE.DynamicDrawUsage;
  const geo  = new THREE.BufferGeometry();
  geo.setAttribute('position', attr);
  const pts  = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false,
  }));
  pts.visible = false;
  scene.add(pts);
  return { points: pts, update() { updateFn(pos, vel); attr.needsUpdate = true; } };
}

// ── Tundra snow (InstancedMesh + canvas snowflake texture) ────────────────────
function makeTundraSnow() {
  const COUNT = 350;

  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const cx = S * 0.5, cy = S * 0.5, r = S * 0.43;

  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 6; arm++) {
    const a = (arm / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
    const bx = cx + Math.cos(a) * r * 0.55;
    const by = cy + Math.sin(a) * r * 0.55;
    const bl = r * 0.38;
    [a + Math.PI / 3, a - Math.PI / 3].forEach(ba => {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl);
      ctx.stroke();
    });
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(cv);
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, alphaTest: 0.04,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  const px = new Float32Array(COUNT), py = new Float32Array(COUNT), pz = new Float32Array(COUNT);
  const vx = new Float32Array(COUNT), vy = new Float32Array(COUNT), vz = new Float32Array(COUNT);
  const rX = new Float32Array(COUNT), rY = new Float32Array(COUNT), rZ = new Float32Array(COUNT);
  const sz = new Float32Array(COUNT);

  function resetFlake(i, top) {
    px[i] = R(-28, 28);  py[i] = top ? R(14, 22) : R(-4, 22);  pz[i] = R(-22, 22);
    vx[i] = R(-0.018, 0.018);  vy[i] = R(-0.065, -0.022);  vz[i] = R(-0.014, 0.014);
    rX[i] = Math.random() * Math.PI * 2;
    rY[i] = Math.random() * Math.PI * 2;
    rZ[i] = Math.random() * Math.PI * 2;
    sz[i] = R(0.30, 0.66);
  }
  for (let i = 0; i < COUNT; i++) resetFlake(i, false);

  const dummy = new THREE.Object3D();

  return {
    points: mesh,
    update() {
      for (let i = 0; i < COUNT; i++) {
        px[i] += vx[i] + Math.sin(t * 0.5 + i * 0.73) * 0.007;
        py[i] += vy[i];
        pz[i] += vz[i];
        rX[i] += 0.009 + Math.sin(i * 0.50) * 0.003;
        rY[i] += 0.017 + Math.cos(i * 0.70) * 0.006;
        rZ[i] += 0.007;
        if (py[i] < getTerrainHeight(px[i], pz[i]) + 0.12) resetFlake(i, true);
        dummy.position.set(px[i], py[i], pz[i]);
        dummy.rotation.set(rX[i], rY[i], rZ[i]);
        dummy.scale.setScalar(sz[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

const envPS = {
  forest: [makePS(60, 0x55aa33, 0.18, 0.8,
    (pos, vel, j) => {
      pos[j]=R(-22,22); pos[j+1]=R(1,10);  pos[j+2]=R(-18,18);
      vel[j]=R(-0.012,0.012); vel[j+1]=R(-0.035,-0.02); vel[j+2]=R(-0.008,0.008);
    },
    (pos, vel) => {
      for (let i=0,j=0; i<60; i++,j+=3) {
        pos[j]  += vel[j]   + Math.sin(t*0.8+i)*0.004;
        pos[j+1]+= vel[j+1];
        pos[j+2]+= vel[j+2];
        if (pos[j+1]<0.05) { pos[j]=R(-22,22); pos[j+1]=R(8,12); pos[j+2]=R(-18,18); }
      }
    })],

  desert: [makePS(350, 0xd4a855, 0.22, 0.88,
    (pos, vel, j) => {
      pos[j]=R(-25,25); pos[j+1]=R(0.2,4); pos[j+2]=R(-18,18);
      vel[j]=R(0.06,0.14); vel[j+1]=R(-0.004,0.004); vel[j+2]=R(-0.01,0.01);
    },
    (pos, vel) => {
      for (let i=0,j=0; i<350; i++,j+=3) {
        pos[j]  += vel[j];
        pos[j+1]+= vel[j+1] + Math.sin(t*2+i)*0.002;
        pos[j+2]+= vel[j+2];
        if (pos[j]>25) { pos[j]=R(-25,-20); pos[j+1]=R(0.2,4); }
      }
    })],

  swamp: [
    makePS(80, 0xaaddbb, 0.24, 0.3,
      (pos, vel, j) => {
        pos[j]=R(-20,20); pos[j+1]=R(0,5); pos[j+2]=R(-15,15);
        vel[j]=R(-0.006,0.006); vel[j+1]=R(0.006,0.014); vel[j+2]=R(-0.006,0.006);
      },
      (pos, vel) => {
        for (let i=0,j=0; i<80; i++,j+=3) {
          pos[j]  += vel[j]   + Math.sin(t*0.3+i*0.7)*0.003;
          pos[j+1]+= vel[j+1];
          pos[j+2]+= vel[j+2] + Math.cos(t*0.25+i*0.5)*0.003;
          if (pos[j+1]>7) { pos[j]=R(-20,20); pos[j+1]=0; pos[j+2]=R(-15,15); }
        }
      }),
    makePS(20, 0xffee88, 0.09, 0.9,
      (pos, vel, j) => {
        pos[j]=R(-18,18); pos[j+1]=R(1,5); pos[j+2]=R(-14,14);
        vel[j]=R(-0.04,0.04); vel[j+1]=R(-0.02,0.02); vel[j+2]=R(-0.04,0.04);
      },
      (pos, vel) => {
        for (let i=0,j=0; i<20; i++,j+=3) {
          vel[j]  += R(-0.006,0.006); vel[j]  = Math.max(-0.06, Math.min(0.06, vel[j]));
          vel[j+1]+= R(-0.004,0.004); vel[j+1]= Math.max(-0.03, Math.min(0.03, vel[j+1]));
          vel[j+2]+= R(-0.006,0.006); vel[j+2]= Math.max(-0.06, Math.min(0.06, vel[j+2]));
          pos[j]  += vel[j];   pos[j+1]+= vel[j+1];   pos[j+2]+= vel[j+2];
          if (pos[j]<-18||pos[j]>18)    vel[j]  *= -1;
          if (pos[j+1]<0.5||pos[j+1]>6) vel[j+1]*= -1;
          if (pos[j+2]<-14||pos[j+2]>14)vel[j+2]*= -1;
        }
      }),
  ],

  tundra: [makeTundraSnow()],

  graveyard: [
    makePS(90, 0x7890b8, 0.28, 0.26,
      (pos, vel, j) => {
        pos[j]=R(-24,24); pos[j+1]=R(0,3); pos[j+2]=R(-20,20);
        vel[j]=R(-0.005,0.005); vel[j+1]=R(0.003,0.010); vel[j+2]=R(-0.005,0.005);
      },
      (pos, vel) => {
        for (let i=0,j=0; i<90; i++,j+=3) {
          pos[j]  += vel[j]   + Math.sin(t*0.25+i*0.6)*0.003;
          pos[j+1]+= vel[j+1];
          pos[j+2]+= vel[j+2] + Math.cos(t*0.20+i*0.5)*0.003;
          if (pos[j+1]>6) { pos[j]=R(-24,24); pos[j+1]=0; pos[j+2]=R(-20,20); }
        }
      }),
    makePS(18, 0xaabbd8, 0.10, 0.80,
      (pos, vel, j) => {
        pos[j]=R(-20,20); pos[j+1]=R(1,4); pos[j+2]=R(-16,16);
        vel[j]=R(-0.035,0.035); vel[j+1]=R(-0.015,0.015); vel[j+2]=R(-0.035,0.035);
      },
      (pos, vel) => {
        for (let i=0,j=0; i<18; i++,j+=3) {
          vel[j]  += R(-0.005,0.005); vel[j]  = Math.max(-0.05, Math.min(0.05, vel[j]));
          vel[j+1]+= R(-0.003,0.003); vel[j+1]= Math.max(-0.02, Math.min(0.02, vel[j+1]));
          vel[j+2]+= R(-0.005,0.005); vel[j+2]= Math.max(-0.05, Math.min(0.05, vel[j+2]));
          pos[j]  += vel[j];   pos[j+1]+= vel[j+1];   pos[j+2]+= vel[j+2];
          if (pos[j]<-20||pos[j]>20)    vel[j]  *= -1;
          if (pos[j+1]<0.5||pos[j+1]>5) vel[j+1]*= -1;
          if (pos[j+2]<-16||pos[j+2]>16)vel[j+2]*= -1;
        }
      }),
  ],

  dungeon: [],

  savanna: [makePS(100, 0xccaa55, 0.08, 0.55,
    (pos, vel, j) => {
      pos[j]=R(-22,22); pos[j+1]=R(0.3,5); pos[j+2]=R(-18,18);
      vel[j]=R(0.02,0.055); vel[j+1]=R(-0.003,0.006); vel[j+2]=R(-0.012,0.012);
    },
    (pos, vel) => {
      for (let i=0,j=0; i<100; i++,j+=3) {
        pos[j]  += vel[j];
        pos[j+1]+= vel[j+1] + Math.sin(t*1.4+i*0.9)*0.003;
        pos[j+2]+= vel[j+2];
        if (pos[j]>25) { pos[j]=R(-25,-20); pos[j+1]=R(0.3,5); pos[j+2]=R(-18,18); }
      }
    })],
};

// ── PBR ground roughness per biome ────────────────────────────────────────────
const biomeRoughness = {
  forest: 0.95, desert: 0.85, swamp: 0.98, tundra: 0.72, savanna: 0.90, graveyard: 0.97, dungeon: 0.98,
};

// ── Wind animation ────────────────────────────────────────────────────────────
// Re-exported from propBuilders; updateWind is also re-exported below.
export { updateWind };

// ── Module-level state ────────────────────────────────────────────────────────
let _fogUpdate   = null;   // set by buildGraveyardFog(), cleared by clearProps()
let _torchUpdate = null;   // set by buildDungeonProps(), cleared by clearProps()
let _surfaceY    = null;   // set by water biomes; null = use terrain height

// Returns the walkable surface height at (x, z) — water plane when submerged
export function getSurfaceHeight(x, z) {
  const base = getTerrainHeight(x, z);
  return _surfaceY !== null ? Math.max(base, _surfaceY) : base;
}

// ── Prop scene management ─────────────────────────────────────────────────────

export const activeProps = [];
export const propPositions    = [];
export const losBlockerMeshes = [];
export const barrierSegments  = []; // [{x1,z1,x2,z2}] — impassable lines for movement BFS

export function loadBarriersData(arr) {
  barrierSegments.length = 0;
  if (arr?.length) for (const b of arr) barrierSegments.push({ x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2 });
}
export function clearBarriersData() { barrierSegments.length = 0; }

function _disposeObject(obj) {
  obj.traverse(child => {
    if (child.geometry && !_cachedGeos.has(child.geometry)) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => { if (!_cachedMats.has(m)) m.dispose(); });
    }
  });
}

function clearProps() {
  activeProps.forEach(obj => { obj.userData.destroy?.(); scene.remove(obj); _disposeObject(obj); });
  activeProps.length = 0;
  propPositions.length = 0;
  losBlockerMeshes.length = 0;
  _windBlobs.length = 0;
  _fogUpdate   = null;
  _torchUpdate = null;
  _surfaceY    = null;
  clearPointLightOrbs();
}

// ── Hero dungeon point lights ─────────────────────────────────────────────────
const _heroDungeonLights = [];

export function addUnitDungeonLight(grp) {
  if (activeEnv !== 'dungeon' && activeEnv !== 'graveyard') return;
  const isDungeon = activeEnv === 'dungeon';
  const light = new THREE.PointLight(isDungeon ? 0xffcc88 : 0xd0e8ff, isDungeon ? 12 : 8, isDungeon ? 320 : 260, 2);
  light.position.set(0, 1.5, 0);
  grp.add(light);
  _heroDungeonLights.push({ light, grp });
}

function _clearDungeonHeroLights() {
  for (const { light, grp } of _heroDungeonLights) grp.remove(light);
  _heroDungeonLights.length = 0;
}

function _inHeroZone(x, z) {
  return x >= HERO_ZONE.xMin && x <= HERO_ZONE.xMax &&
         z >= HERO_ZONE.zMin && z <= HERO_ZONE.zMax;
}

function addProp(obj, x, z, blocksLOS = true, clashR = 2.0) {
  obj.position.set(x, getTerrainHeight(x, z) - 0.20, z);
  scene.add(obj);
  activeProps.push(obj);
  if (clashR > 0) propPositions.push({ x, z, blocksLOS, clashRSq: clashR * clashR });
  if (blocksLOS) losBlockerMeshes.push(obj);
}

function scatterProps(recipes) {
  recipes.forEach(([fn, count, blocksLOS = true, clashR = 2.0]) => {
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-28, 28); z = R(-28, 28); } while (_inHeroZone(x, z));
      addProp(fn(), x, z, blocksLOS, clashR);
    }
  });
}

// ── Forest fallen-leaf layer ──────────────────────────────────────────────────

function buildForestLeaves() {
  const COUNT = 300;

  const geo = _makeMapleLeafGeo();

  const mat = new THREE.MeshLambertMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.90,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.receiveShadow  = true;
  mesh.frustumCulled  = false;

  const LEAF_COLORS = [
    0xcc4400, 0xb84200, 0xd4960c, 0xa85c08,
    0x6e3e14, 0xc07820, 0x5a2e0c, 0xe8b020,
  ];

  const clusters = Array.from({ length: 6 }, () => ({
    x: R(-24, 24), z: R(-24, 24),
  }));

  const dummy = new THREE.Object3D();
  const col   = new THREE.Color();

  for (let i = 0; i < COUNT; i++) {
    let x, z;
    if (Math.random() < 0.68) {
      const c   = clusters[Math.floor(Math.random() * clusters.length)];
      const r   = Math.random() * 8.5;
      const ang = Math.random() * Math.PI * 2;
      x = c.x + Math.cos(ang) * r;
      z = c.z + Math.sin(ang) * r;
    } else {
      x = R(-28, 28);
      z = R(-28, 28);
    }
    x = Math.max(-30, Math.min(30, x));
    z = Math.max(-30, Math.min(30, z));
    if (_inHeroZone(x, z)) {
      do { x = R(-28, 28); z = R(-28, 28); } while (_inHeroZone(x, z));
    }

    const ty = getTerrainHeight(x, z);
    const sz = 0.10 + Math.random() * 0.16;

    dummy.position.set(x, ty + 0.03 + Math.random() * 0.04, z);
    dummy.rotation.set(
      (Math.random() - 0.5) * 0.30,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.22
    );
    dummy.scale.set(sz, 1, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    col.setHex(LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)]);
    col.multiplyScalar(0.78 + Math.random() * 0.44);
    mesh.setColorAt(i, col);
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate  = true;

  scene.add(mesh);
  activeProps.push(mesh);
}

function buildForestProps() {
  scatterProps([
    [() => mkRock(0x565552, R(0.65, 1.30), R(0, Math.PI * 2), R(0.85, 1.15), R(0.50, 0.72), R(0.82, 1.10), true), 16, false, 0.40],
    [() => mkBush(0x1a4012, R(0.65, 1.05), R(0, Math.PI * 2)), 14, false, 0.40],
  ]);
  buildForestLeaves();

  const spawnEnv = 'forest';

  _loadLog().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 10 + Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-26, 26); z = R(-26, 26); } while (_inHeroZone(x, z));
      const model = gltf.scene.clone(true);
      const s = R(1.5, 3.5);
      model.position.set(x, getTerrainHeight(x, z) - 0.10, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.22;
      model.rotation.x = (Math.random() - 0.5) * 0.10;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.07;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.07);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: false, clashRSq: 0.55 * 0.55 });
    }
  });

  _loadBrokenTree().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(4.5, 8.0);
      model.position.set(x, getTerrainHeight(x, z) - 1.20, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.08;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.10 * 1.10 });
      losBlockerMeshes.push(model);
    }
  });

  _loadForestTree().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 20 + Math.floor(Math.random() * 15);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(6.0, 12.0);
      model.position.set(x, getTerrainHeight(x, z) - 0.40, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.06;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.20 * 1.20 });
      losBlockerMeshes.push(model);
    }
  });
}

function buildDesertProps() {
  scatterProps([
    [() => mkBoulderCluster(0x8a6838, R(0.85, 1.55), R(0, Math.PI * 2)), 16, true,  0.90],
    [() => mkRock(0x7a6030, R(0.55, 1.25), R(0, Math.PI * 2), R(0.90, 1.15), R(0.52, 0.70), R(0.85, 1.10)), 14, false, 0.40],
    [() => mkDryShrub(R(0.65, 1.05), R(0, Math.PI * 2)), 16, false, 0.35],
  ]);
}

const SWAMP_WATER_Y = 0.75;

function buildSwampWater() {
  _surfaceY = SWAMP_WATER_Y;
  const waterMat = new THREE.MeshStandardMaterial({
    color:       0x020b18,
    roughness:   0.18,
    metalness:   0.62,
    transparent: true,
    opacity:     0.95,
    depthWrite:  false,
  });
  const waterPlane = new THREE.Mesh(new THREE.PlaneGeometry(74, 74), waterMat);
  waterPlane.rotation.x = -Math.PI / 2;
  waterPlane.position.y  = SWAMP_WATER_Y;
  waterPlane.renderOrder = 1;
  scene.add(waterPlane);
  activeProps.push(waterPlane);

  const lilyMat = new THREE.MeshStandardMaterial({
    color:             0x1a4c10,
    roughness:         0.88,
    metalness:         0,
    side:              THREE.DoubleSide,
    emissive:          0x050c02,
    emissiveIntensity: 0.10,
  });

  // Lily pad disc — flat in XZ plane with a narrow wedge notch like a real pad.
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

  for (let i = 0; i < 45; i++) {
    const r    = R(0.28, 0.72);
    const lily = new THREE.Mesh(_mkLilyPadGeo(r), lilyMat);
    lily.rotation.y = Math.random() * Math.PI * 2;
    lily.rotation.x = (Math.random() - 0.5) * 0.06;
    let lx, lz;
    do { lx = R(-27, 27); lz = R(-27, 27); } while (_inHeroZone(lx, lz));
    lily.position.set(lx, SWAMP_WATER_Y + 0.02, lz);
    lily.receiveShadow = true;
    scene.add(lily);
    activeProps.push(lily);
  }

  // Half-submerged rocks — reuse rock mat from propBuilders via _mkRockMat alias
  // We create them inline using THREE directly since _mkRockMat is internal.
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x131820, roughness: 0.93, metalness: 0.03,
  });
  for (let i = 0; i < 7; i++) {
    // Simple displaced icosahedron for the half-submerged rocks
    const r = R(0.35, 0.80);
    const geo = new THREE.IcosahedronGeometry(r, 2);
    const rock = new THREE.Mesh(geo, rockMat);
    rock.receiveShadow = true;
    rock.scale.set(R(0.7, 1.2), R(0.45, 0.65), R(0.7, 1.1));
    rock.rotation.y = Math.random() * Math.PI * 2;
    let rkX, rkZ;
    do { rkX = R(-25, 25); rkZ = R(-25, 25); } while (_inHeroZone(rkX, rkZ));
    rock.position.set(rkX, SWAMP_WATER_Y - 0.22 + Math.random() * 0.18, rkZ);
    scene.add(rock);
    activeProps.push(rock);
  }
}

function buildSwampProps() {
  buildSwampWater();

  const noCS = fn => () => {
    const o = fn();
    o.traverse(c => { if (c.isMesh) c.castShadow = false; });
    return o;
  };

  scatterProps([
    [noCS(() => mkSwampVine(R(0.70, 1.10),      R(0, Math.PI * 2))), 10, false, 0.35],
    [noCS(() => mkFern(R(0.70, 1.10),           R(0, Math.PI * 2))), 14, false, 0.35],
    [noCS(() => mkBroadLeafPlant(R(0.80, 1.20), R(0, Math.PI * 2))),  8, false, 0.35],
    [noCS(() => mkMossRock(R(0.65, 1.00),       R(0, Math.PI * 2))),  6, false, 0.40],
    [noCS(() => mkGlowMushroom(
        [0x8833cc, 0x2299cc, 0x33aaaa, 0xaa33dd, 0x22bbaa][Math.floor(Math.random() * 5)],
        R(0.55, 1.00), R(0, Math.PI * 2))), 10, false, 0.35],
  ]);

  const spawnEnv = 'swamp';

  _loadLog().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-25, 25); z = R(-25, 25); } while (_inHeroZone(x, z));
      const model = gltf.scene.clone(true);
      const s = R(1.2, 2.8);
      model.position.set(x, SWAMP_WATER_Y - 0.30 + (Math.random() - 0.5) * 0.22, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.28;
      model.rotation.x = (Math.random() - 0.5) * 0.12;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = false;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x030802);
            m.emissiveIntensity = 0.06;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.06);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: false, clashRSq: 0.55 * 0.55 });
    }
  });

  _loadMangrove().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 10 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(6.0, 12.0);
      model.position.set(x, getTerrainHeight(x, z) + 3.5, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.06;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = false;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.20 * 1.20 });
      losBlockerMeshes.push(model);
    }
  });
}

function buildGraveyardFog() {
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

  const mat = new THREE.MeshBasicMaterial({
    color:       0x6878a0,
    map:         tex,
    transparent: true,
    opacity:     0.18,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });

  const COUNT = 320;
  const geo   = new THREE.PlaneGeometry(1, 1);
  const mesh  = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;
  mesh.renderOrder   = 1;

  const px  = new Float32Array(COUNT), py  = new Float32Array(COUNT), pz  = new Float32Array(COUNT);
  const vx  = new Float32Array(COUNT), vz  = new Float32Array(COUNT);
  const ry  = new Float32Array(COUNT), vry = new Float32Array(COUNT);
  const tX  = new Float32Array(COUNT), tZ  = new Float32Array(COUNT);
  const sz  = new Float32Array(COUNT);

  const dummy = new THREE.Object3D();
  for (let i = 0; i < COUNT; i++) {
    px[i] = R(-42, 42);
    py[i] = R(0.02, 0.28);
    pz[i] = R(-42, 42);
    const ang = Math.random() * Math.PI * 2;
    const spd = R(0.002, 0.006);
    vx[i]  = Math.cos(ang) * spd;
    vz[i]  = Math.sin(ang) * spd;
    ry[i]  = Math.random() * Math.PI * 2;
    vry[i] = R(-0.0002, 0.0002);
    tX[i]  = (Math.random() - 0.5) * 0.08;
    tZ[i]  = (Math.random() - 0.5) * 0.06;
    sz[i]  = R(5, 13);

    dummy.position.set(px[i], py[i], pz[i]);
    dummy.rotation.set(-Math.PI / 2 + tX[i], ry[i], tZ[i]);
    dummy.scale.setScalar(sz[i]);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  _fogUpdate = function() {
    for (let i = 0; i < COUNT; i++) {
      px[i] += vx[i];
      pz[i] += vz[i];
      ry[i] += vry[i];
      if (px[i] >  44) px[i] -= 88;
      if (px[i] < -44) px[i] += 88;
      if (pz[i] >  44) pz[i] -= 88;
      if (pz[i] < -44) pz[i] += 88;
      dummy.position.set(px[i], py[i], pz[i]);
      dummy.rotation.set(-Math.PI / 2 + tX[i], ry[i], tZ[i]);
      dummy.scale.setScalar(sz[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  scene.add(mesh);
  activeProps.push(mesh);
}

function buildGraveyardProps() {
  buildGraveyardFog();
  scatterProps([
    [() => mkCross(R(0.75, 1.15),     R(0, Math.PI * 2)),  8, true,  0.45],
    [() => mkGraveMound(R(0.80, 1.20),R(0, Math.PI * 2)),  8, false, 0.45],
    [() => mkRock(0x404040, R(0.55, 1.10), R(0, Math.PI * 2), R(0.85, 1.10), R(0.50, 0.68), R(0.82, 1.05)), 6, false, 0.40],
    [() => mkRubblePile(R(0.70, 1.10),R(0, Math.PI * 2)),  5, false, 0.40],
  ]);

  const spawnEnv = 'graveyard';

  _loadLog().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-24, 24); z = R(-24, 24); } while (_inHeroZone(x, z));
      const model = gltf.scene.clone(true);
      const s = R(1.2, 2.8);
      model.position.set(x, getTerrainHeight(x, z) - 0.10, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.20;
      model.rotation.x = (Math.random() - 0.5) * 0.08;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x020304);
            m.emissiveIntensity = 0.06;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.06);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: false, clashRSq: 0.55 * 0.55 });
    }
  });

  _loadBrokenTree().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(4.5, 8.5);
      model.position.set(x, getTerrainHeight(x, z) - 1.20, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.10;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.10 * 1.10 });
      losBlockerMeshes.push(model);
    }
  });

  _loadTombstone1().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-24, 24); z = R(-24, 24); } while (_inHeroZone(x, z));
      const model = gltf.scene.clone(true);
      const s = R(0.8, 1.4);
      model.position.set(x, getTerrainHeight(x, z) - 0.10, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.16;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 0.45 * 0.45 });
      losBlockerMeshes.push(model);
    }
  });

  _loadDeadTree().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 10 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(6.0, 12.0);
      model.position.set(x, getTerrainHeight(x, z) - 0.40, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.06;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.20 * 1.20 });
      losBlockerMeshes.push(model);
    }
  });
}

function buildTundraProps() {
  scatterProps([
    [() => mkSnowBoulder(R(0.80, 1.50),  R(0, Math.PI * 2)), 16, true,  0.90],
  ]);

  const spawnEnv = 'tundra';

  _loadStalactite().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 12 + Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-26, 26); z = R(-26, 26); } while (_inHeroZone(x, z));
      const model = gltf.scene.clone(true);
      const s = R(0.6, 3.8);
      model.position.set(x, getTerrainHeight(x, z) - 1.40, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.12;
      model.rotation.x = (Math.random() - 0.5) * 0.08;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m) return;
          if (m.color) m.color.set(0xffffff);
          if (m.roughness !== undefined) m.roughness = 0.12;
          if (m.metalness !== undefined) m.metalness = 0.0;
          if (m.emissive !== undefined) {
            m.emissive.setHex(0xe8f4ff);
            m.emissiveIntensity = 0.65;
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 0.55 * 0.55 });
      losBlockerMeshes.push(model);
    }
  });

  _loadLog().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      let x, z;
      do { x = R(-26, 26); z = R(-26, 26); } while (_inHeroZone(x, z));
      const model = gltf.scene.clone(true);
      const s = R(1.4, 3.0);
      model.position.set(x, getTerrainHeight(x, z) - 0.10, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.18;
      model.rotation.x = (Math.random() - 0.5) * 0.08;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m) return;
          if (m.color) m.color.lerp(new THREE.Color(0x8899aa), 0.18);
          if (m.emissive !== undefined) {
            m.emissive.setHex(0x061c22);
            m.emissiveIntensity = 0.12;
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: false, clashRSq: 0.55 * 0.55 });
    }
  });

  _loadEvergreenTree().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(5.0, 10.0);
      model.position.set(x, getTerrainHeight(x, z) - 0.30, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.04;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m) return;
          if (m.color) m.color.multiplyScalar(0.40);
          if (m.emissive !== undefined) {
            m.emissive.setHex(0x061c10);
            m.emissiveIntensity = 0.22;
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.10 * 1.10 });
      losBlockerMeshes.push(model);
    }
  });
}

function buildSavannaProps() {
  scatterProps([
    [() => mkBoulderCluster(0x7a6040, R(0.80, 1.40), R(0, Math.PI * 2)), 14, true,  0.90],
    [() => mkDryShrub(R(0.70, 1.10), R(0, Math.PI * 2)), 14, false, 0.35],
  ]);

  const spawnEnv = 'savanna';
  _loadSavannaTree().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;
    const count = 10 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      let pos;
      do { pos = _mangroveEdgePos(); } while (_inHeroZone(pos.x, pos.z));
      const { x, z } = pos;
      const model = gltf.scene.clone(true);
      const s = R(4.0, 8.0);
      model.position.set(x, getTerrainHeight(x, z) - 0.40, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.rotation.z = (Math.random() - 0.5) * 0.06;
      model.scale.setScalar(s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m || m.emissive === undefined) return;
          if (m.emissive.getHex() === 0x000000) {
            m.emissive.setHex(0x050a02);
            m.emissiveIntensity = 0.08;
          } else {
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.08);
          }
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.20 * 1.20 });
      losBlockerMeshes.push(model);
    }
  });
}

const MUSHROOM_COLORS = [0x8833cc, 0x2299cc, 0x33aaaa, 0xaa33dd, 0x22bbaa];

function buildTunnelsProps() {
  function tunnelProp(fn, blocksLOS = true, clashR = 2.0) {
    let x, z, ok = false;
    for (let tries = 0; tries < 50; tries++) {
      x = R(-26, 26); z = R(-26, 26);
      if (isOnTunnelFloor(x, z)) { ok = true; break; }
    }
    if (ok) addProp(fn(), x, z, blocksLOS, clashR);
  }

  for (let i = 0; i < 5;  i++) tunnelProp(() => mkTunnelPillar(R(0.80,1.20), R(0,Math.PI*2)), true,  0.65);
  for (let i = 0; i < 3;  i++) tunnelProp(() => mkTunnelWall(R(0.85,1.15), R(0,Math.PI*2)),   true,  0.65);
  for (let i = 0; i < 5;  i++) tunnelProp(() => mkBrokenStatue(R(0.80,1.15), R(0,Math.PI*2)), true,  0.55);
  for (let i = 0; i < 14; i++) tunnelProp(
    () => mkGlowMushroom(MUSHROOM_COLORS[Math.floor(Math.random()*MUSHROOM_COLORS.length)], R(0.65,1.20), R(0,Math.PI*2)),
    false, 0.35
  );
  for (let i = 0; i < 8;  i++) tunnelProp(() => mkRubblePile(R(0.75,1.20), R(0,Math.PI*2)), false, 0.40);
}

function buildDungeonProps() {
  const spawnEnv = 'dungeon';
  _loadDungeonRockWall().then(gltf => {
    if (!gltf || activeEnv !== spawnEnv) return;

    const CORRIDOR_HW = 3.0;
    const STEP        = 5.0;
    const BOUND       = 26;
    const corridors   = [];

    const numPaths = 4 + Math.floor(Math.random() * 3);
    for (let p = 0; p < numPaths; p++) {
      const startZ = p === 0 ? R(18, 24) : R(-BOUND, BOUND);
      const pts    = [{ x: R(-20, 20), z: startZ }];
      let ang      = Math.random() * Math.PI * 2;
      const steps  = 10 + Math.floor(Math.random() * 8);
      for (let s = 0; s < steps; s++) {
        const last = pts[pts.length - 1];
        ang += (Math.random() - 0.5) * 1.4;
        let nx = last.x + Math.sin(ang) * STEP;
        let nz = last.z + Math.cos(ang) * STEP;
        if (Math.abs(nx) > BOUND || Math.abs(nz) > BOUND) {
          ang = Math.atan2(-last.x, -last.z) + (Math.random() - 0.5) * 0.8;
          nx  = last.x + Math.sin(ang) * STEP;
          nz  = last.z + Math.cos(ang) * STEP;
        }
        pts.push({
          x: Math.max(-BOUND, Math.min(BOUND, nx)),
          z: Math.max(-BOUND, Math.min(BOUND, nz)),
        });
      }
      corridors.push(pts);
    }

    function _distSeg(px, pz, ax, az, bx, bz) {
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz;
      if (len2 === 0) return Math.hypot(px - ax, pz - az);
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
      return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
    }

    function _inCorridor(x, z) {
      for (const pts of corridors) {
        for (let i = 0; i < pts.length - 1; i++) {
          if (_distSeg(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z) <= CORRIDOR_HW)
            return true;
        }
      }
      return false;
    }

    const target = 180 + Math.floor(Math.random() * 21);
    let placed = 0, tries = 0;
    while (placed < target && tries < target * 40) {
      tries++;
      const x = R(-24, 24);
      const z = R(-24, 24);
      if (_inHeroZone(x, z) || _inCorridor(x, z)) continue;

      const model = gltf.scene.clone(true);
      const s = R(1.8, 4.0);
      model.position.set(x, getTerrainHeight(x, z) + 3.0, z);
      model.rotation.y = R(0, Math.PI * 2);
      model.scale.set(s, s * R(1.8, 2.8), s);
      model.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow    = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          if (!m) return;
          if (m.color)    m.color.set(0x2a2a2a);
          if (m.emissive) { m.emissive.setHex(0x080808); m.emissiveIntensity = 0.08; }
          if (m.roughness !== undefined) m.roughness = 0.95;
          if (m.metalness !== undefined) m.metalness = 0.04;
          m.needsUpdate = true;
        });
      });
      scene.add(model);
      activeProps.push(model);
      propPositions.push({ x, z, blocksLOS: true, clashRSq: 1.0 * 1.0 });
      losBlockerMeshes.push(model);
      placed++;
    }
  });
}

// ── Mangrove edge-placement helper ────────────────────────────────────────────
function _mangroveEdgePos() {
  if (Math.random() < 0.70) {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) return { x: R(-24, 24), z: R(-27, -15) };
    if (edge === 1) return { x: R(-24, 24), z: R( 15,  27) };
    if (edge === 2) return { x: R(-27, -15), z: R(-24, 24) };
                   return { x: R( 15,  27), z: R(-24, 24) };
  }
  let x, z;
  do { x = R(-24, 24); z = R(-24, 24); }
  while (Math.abs(x) < 10 && Math.abs(z) < 10);
  return { x, z };
}

// ── GLB loaders ───────────────────────────────────────────────────────────────

let _mangroveGltf   = null;
let _mangrovePromise = null;

function _loadMangrove() {
  if (_mangrovePromise) return _mangrovePromise;
  _mangrovePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/mangrove.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _mangroveGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] mangrove.glb failed to load:', err); resolve(null); },
    );
  });
  return _mangrovePromise;
}

_loadMangrove();

let _dungeonRockWallGltf    = null;
let _dungeonRockWallPromise = null;

function _loadDungeonRockWall() {
  if (_dungeonRockWallPromise) return _dungeonRockWallPromise;
  _dungeonRockWallPromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/dungeonrockwall.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _dungeonRockWallGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] dungeonrockwall.glb failed to load:', err); resolve(null); },
    );
  });
  return _dungeonRockWallPromise;
}

_loadDungeonRockWall();

let _forestTreeGltf    = null;
let _forestTreePromise = null;

function _loadForestTree() {
  if (_forestTreePromise) return _forestTreePromise;
  _forestTreePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/foresttree.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _forestTreeGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] foresttree.glb failed to load:', err); resolve(null); },
    );
  });
  return _forestTreePromise;
}

_loadForestTree();

let _deadTreeGltf    = null;
let _deadTreePromise = null;

function _loadDeadTree() {
  if (_deadTreePromise) return _deadTreePromise;
  _deadTreePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/deadtree.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _deadTreeGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] deadtree.glb failed to load:', err); resolve(null); },
    );
  });
  return _deadTreePromise;
}

_loadDeadTree();

let _evergreenTreeGltf    = null;
let _evergreenTreePromise = null;

function _loadEvergreenTree() {
  if (_evergreenTreePromise) return _evergreenTreePromise;
  _evergreenTreePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/evergreentree.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _evergreenTreeGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] evergreentree.glb failed to load:', err); resolve(null); },
    );
  });
  return _evergreenTreePromise;
}

_loadEvergreenTree();

let _savannaTreeGltf    = null;
let _savannaTreePromise = null;

function _loadSavannaTree() {
  if (_savannaTreePromise) return _savannaTreePromise;
  _savannaTreePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/savannahtree.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _savannaTreeGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] savannahtree.glb failed to load:', err); resolve(null); },
    );
  });
  return _savannaTreePromise;
}

_loadSavannaTree();

let _tombstoneGltf    = null;
let _tombstonePromise = null;

function _loadTombstone1() {
  if (_tombstonePromise) return _tombstonePromise;
  _tombstonePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/tombstone1.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _tombstoneGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] tombstone1.glb failed to load:', err); resolve(null); },
    );
  });
  return _tombstonePromise;
}

_loadTombstone1();

let _logGltf    = null;
let _logPromise = null;

function _loadLog() {
  if (_logPromise) return _logPromise;
  _logPromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/log.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _logGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] log.glb failed to load:', err); resolve(null); },
    );
  });
  return _logPromise;
}

_loadLog();

let _brokenTreeGltf    = null;
let _brokenTreePromise = null;

function _loadBrokenTree() {
  if (_brokenTreePromise) return _brokenTreePromise;
  _brokenTreePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/brokentree.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _brokenTreeGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] brokentree.glb failed to load:', err); resolve(null); },
    );
  });
  return _brokenTreePromise;
}

_loadBrokenTree();

let _stalactiteGltf    = null;
let _stalactitePromise = null;

function _loadStalactite() {
  if (_stalactitePromise) return _stalactitePromise;
  _stalactitePromise = new Promise(resolve => {
    new GLTFLoader().load(
      'assets/environment/stalactite.glb',
      gltf => {
        gltf.scene.traverse(child => {
          if (!child.isMesh) return;
          _cachedGeos.add(child.geometry);
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => _cachedMats.add(m));
        });
        _stalactiteGltf = gltf;
        resolve(gltf);
      },
      undefined,
      err => { console.warn('[environments] stalactite.glb failed to load:', err); resolve(null); },
    );
  });
  return _stalactitePromise;
}

_loadStalactite();

// ── biomePropBuilders map ─────────────────────────────────────────────────────
// Matches original: only atmospheric/water layers run automatically on biome switch.
// Full prop builders (buildForestProps, etc.) are available but not wired here.
const biomePropBuilders = {
  forest:    buildForestLeaves,  // atmospheric leaf particles only
  graveyard: buildGraveyardFog,  // atmospheric fog only
  swamp:     buildSwampWater,    // water plane only
};

// ── Procedural canvas ground textures ─────────────────────────────────────────
const texCache = {};

function makeGroundTexture(name) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');

  const cfg = {
    forest: {
      base: '#182e10',
      layers: [
        { colors: ['#0f2008','#122009','#0d1c06'], count: 600, rMin: 3,  rMax: 18, aMin: 0.5, aMax: 0.8 },
        { colors: ['#253818','#1e3010','#2a4018'], count: 400, rMin: 2,  rMax: 12, aMin: 0.3, aMax: 0.6 },
        { colors: ['#3a2810','#2e2008'],           count: 150, rMin: 2,  rMax: 8,  aMin: 0.2, aMax: 0.4 },
      ],
    },
    desert: {
      base: '#c4a454',
      layers: [
        { colors: ['#a88a38','#b09040','#9a7e30'], count: 250, rMin: 12, rMax: 55, aMin: 0.2, aMax: 0.45 },
        { colors: ['#d4b464','#e0c070','#ccaa58'], count: 220, rMin: 8,  rMax: 38, aMin: 0.2, aMax: 0.5  },
        { colors: ['#886a20','#7a5c18'],           count: 100, rMin: 3,  rMax: 12, aMin: 0.15,aMax: 0.3  },
      ],
    },
    swamp: {
      base: '#091808',
      layers: [
        { colors: ['#060f04','#08140a','#050d04'], count: 700, rMin: 2,  rMax: 14, aMin: 0.5, aMax: 0.9 },
        { colors: ['#142010','#102008'],           count: 400, rMin: 2,  rMax: 10, aMin: 0.3, aMax: 0.6 },
        { colors: ['#281408','#201008'],           count: 200, rMin: 2,  rMax: 8,  aMin: 0.2, aMax: 0.4 },
      ],
    },
    tundra: {
      base: '#b8c8d8',
      layers: [
        { colors: ['#e8eef8','#f0f5ff','#dce8f8'], count: 180, rMin: 18, rMax: 75, aMin: 0.5, aMax: 0.9 },
        { colors: ['#7a8898','#6a7888','#8090a0'], count: 200, rMin: 5,  rMax: 28, aMin: 0.3, aMax: 0.6 },
        { colors: ['#c0d0e8','#a8bccc'],           count: 150, rMin: 8,  rMax: 32, aMin: 0.2, aMax: 0.5 },
      ],
    },
    savanna: {
      base: '#627828',
      layers: [
        { colors: ['#7a9030','#8a9c38','#6e8422','#96a03a'], count: 400, rMin: 4,  rMax: 22, aMin: 0.35,aMax: 0.65 },
        { colors: ['#506018','#445414','#5e6c1e','#a09030'], count: 250, rMin: 3,  rMax: 16, aMin: 0.2, aMax: 0.45 },
        { colors: ['#9ab030','#a8b838','#8a9c28'],           count: 200, rMin: 1,  rMax: 6,  aMin: 0.2, aMax: 0.4  },
      ],
    },
    graveyard: {
      base: '#10121e',
      layers: [
        { colors: ['#161a28','#181c2c','#1c2030','#12161e'], count: 600, rMin: 3,  rMax: 18, aMin: 0.5,  aMax: 0.9  },
        { colors: ['#222840','#1e2438','#262c44'],           count: 300, rMin: 4,  rMax: 22, aMin: 0.3,  aMax: 0.6  },
        { colors: ['#303650','#2a3048','#383e58'],           count: 150, rMin: 3,  rMax: 12, aMin: 0.2,  aMax: 0.5  },
      ],
    },
    dungeon: {
      base: '#1a1a1a',
      layers: [
        { colors: ['#0d0d0d','#111111','#080808','#141414'], count: 500, rMin: 6,  rMax: 28, aMin: 0.6, aMax: 0.95 },
        { colors: ['#2a2a2a','#333333','#222222','#3a3a3a'], count: 350, rMin: 4,  rMax: 18, aMin: 0.3, aMax: 0.65 },
        { colors: ['#484848','#3e3e3e','#424242','#505050'], count: 200, rMin: 2,  rMax: 10, aMin: 0.2, aMax: 0.45 },
        { colors: ['#606060','#585858','#6a6a6a'],           count: 100, rMin: 1,  rMax: 6,  aMin: 0.1, aMax: 0.28 },
      ],
    },
  };

  const conf = cfg[name];
  ctx.fillStyle = conf.base;
  ctx.fillRect(0, 0, S, S);

  conf.layers.forEach(layer => {
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
  tex.repeat.set(14, 14);
  return tex;
}

// ── Environment switcher ──────────────────────────────────────────────────────
export let activeEnv = null;

export function setEnv(name, ambientKey) {
  _clearDungeonHeroLights();
  const e = ENVS[name];
  if (!e) return;
  const _smoothBiomes = new Set(['forest', 'tundra', 'swamp', 'savanna']);
  if (name === 'dungeon') {
    setTerrainAmplitudeScale(0.0);
  } else if (name === 'swamp') {
    setTerrainProfile({ scaleMin: 4.5, scaleMax: 8.5, sharpMin: 1.0, sharpMax: 1.20 });
    setTerrainAmplitudeScale(0.02);
  } else if (_smoothBiomes.has(name)) {
    setTerrainProfile({ scaleMin: 4.5, scaleMax: 8.5, sharpMin: 1.0, sharpMax: 1.40 });
    setTerrainAmplitudeScale(1.0);
  } else {
    setTerrainProfile({ scaleMin: 3.0, scaleMax: 6.5, sharpMin: 0.65, sharpMax: 1.05 });
    setTerrainAmplitudeScale(1.0);
  }
  rebuildTerrain(ground, name);
  rebuildGrid();
  grid.material.color.setHex(e.gridColor ?? COLORS.gridMain);
  const darkBiome = name === 'forest' || name === 'swamp' || name === 'graveyard' || name === 'dungeon';
  grid.material.opacity = name === 'dungeon' ? 0.35 : darkBiome ? 0.12 : 0.10;
  document.getElementById('grid-toggle-btn').classList.toggle('dark-biome', darkBiome);
  const _bgEl = document.getElementById('scene-bg');
  const _bgBiomes = new Set(['forest', 'tundra', 'swamp', 'desert', 'savanna', 'graveyard', 'dungeon']);
  if (_bgBiomes.has(name)) {
    scene.background = null;
    _bgEl.classList.remove('forest', 'tundra', 'swamp', 'desert', 'savanna', 'graveyard', 'dungeon');
    _bgEl.classList.add(name, 'active');
  } else {
    scene.background = new THREE.Color(e.sky);
    _bgEl.classList.remove('forest', 'tundra', 'swamp', 'desert', 'savanna', 'graveyard', 'dungeon', 'active');
  }
  scene.fog.color.set(e.fog);
  scene.fog.density = e.density;
  ambient.color.set(e.ambColor);
  ambient.intensity = e.ambInt;
  moon.color.set(e.moonColor);
  moon.intensity = e.moonInt;
  fire.color.set(e.rimColor);
  fire.intensity = e.rimInt;

  if (name === 'dungeon' || name === 'graveyard') {
    moon.intensity = 0;
    fire.intensity = 0;
  } else {
    moon.position.set(-14, 24, 10);
    fire.position.set(16, 5, -12);
  }
  moon.shadow.camera.updateProjectionMatrix();

  if (!texCache[name]) texCache[name] = makeGroundTexture(name);
  ground.material.map       = texCache[name];
  ground.material.color.set(0xffffff);
  ground.material.roughness = biomeRoughness[name] ?? 0.92;
  ground.material.needsUpdate = true;

  document.querySelectorAll('.env-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.env === name)
  );
  Object.values(envPS).flat().forEach(p => { p.points.visible = false; });
  (envPS[name] || []).forEach(p => { p.points.visible = true; });

  clearProps();
  if (!_skipPropsFlag) biomePropBuilders[name]?.();
  _skipPropsFlag = false;

  activeEnv = name;
  playAmbient(ambientKey ?? name);
  window.dispatchEvent(new CustomEvent('env:set', { detail: name }));
}

let _skipPropsFlag = false;
export function setEnvSkipProps(name, ambientKey) { _skipPropsFlag = true; setEnv(name, ambientKey); }
export { clearProps, addProp };

export function updateParticles() {
  t += ANIM.timeStep;
  (envPS[activeEnv] || []).forEach(p => p.update());
  if (_fogUpdate)   _fogUpdate();
  if (_torchUpdate) _torchUpdate();
  for (const p of activeProps) p.userData.update?.();
  if (activeEnv === 'forest' || activeEnv === 'tundra' || activeEnv === 'swamp' ||
      activeEnv === 'desert' || activeEnv === 'savanna' || activeEnv === 'graveyard') {
    const azimuth = Math.atan2(camera.position.x, camera.position.z);
    const xPct = 50 + (azimuth / Math.PI) * 14;
    document.getElementById('scene-bg').style.backgroundPosition = `${xPct}% 55%`;
  }
}

document.getElementById('env-selector').addEventListener('click', ev => {
  const btn = ev.target.closest('.env-btn');
  if (btn) {
    setEnv(btn.dataset.env);
    document.getElementById('env-selector').style.display = 'none';
    document.getElementById('biomes-btn').classList.remove('active');
  }
});

document.getElementById('biomes-btn').addEventListener('click', () => {
  const sel = document.getElementById('env-selector');
  const open = sel.style.display !== 'none';
  sel.style.display = open ? 'none' : 'flex';
  document.getElementById('biomes-btn').classList.toggle('active', !open);
});

setEnv('forest');

// ── Re-exports for propRegistry.js and other consumers ───────────────────────
export { mkRock, mkSnowBoulder, mkBoulderCluster, mkBush, mkGlowMushroom, mkRubblePile, mkDryShrub, mkFern, mkGraveMound, mkCross, mkRoadSegment, mkWaterDisc, mkBloodPool, mkRoadCurve30, mkArrow, mkExclamationMarker, mkFogPatch, mkPointLight, setPointLightOrbsVisible, mkDarknessPlane, mkWaystoneDisc } from './propBuilders.js';
