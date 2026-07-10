import * as THREE from 'three';
import { scene, camera, renderer, ground, ceiling } from './scene.js';
import {
  getTerrainHeight, getCaveEntrances, setCaveEntrances,
  caveEntranceRadiusAt, rebuildCeiling,
} from './terrain.js';
import { IS_DEV } from './devConfig.js';

// Click on the blanket to drop a cave mouth; adjust its size; save to the zone.
// Mouths are punched out of the ceiling blanket in terrain.js (organic shape).

let _mode        = false;
let _selIdx      = -1;
let _activeZoneId = null;
let _lastR       = 3.0;      // remembered radius for the next placed mouth
let _rings       = [];       // outline visuals, parallel to getCaveEntrances()

const _rc  = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

function _groundPt(cx, cy) {
  _ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  _rc.setFromCamera(_ndc, camera);
  const hits = _rc.intersectObject(ground);
  return hits.length ? hits[0].point : null;
}

// ── Visuals ─────────────────────────────────────────────────────────────────
function _clearRings() {
  for (const o of _rings) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
  _rings = [];
}

function _updateVisuals() {
  _clearRings();
  if (!_mode) return;
  const list = getCaveEntrances();
  list.forEach((ent, i) => {
    const pts = [];
    const STEPS = 72;
    for (let k = 0; k <= STEPS; k++) {
      const a  = (k / STEPS) * Math.PI * 2;
      const rr = caveEntranceRadiusAt(ent, a);
      const x  = ent.x + Math.cos(a) * rr, z = ent.z + Math.sin(a) * rr;
      pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.35, z));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({
        color: i === _selIdx ? 0xffdd44 : 0x55ccff,
        depthTest: false, depthWrite: false, transparent: true,
      }),
    );
    line.renderOrder = 25;
    scene.add(line);
    _rings.push(line);
  });
}

// ── Edits ───────────────────────────────────────────────────────────────────
function _rebuild() {
  rebuildCeiling(ceiling);   // uses the last biome; reads current entrances
  _updateVisuals();
}

function _onClick(e) {
  if (!_mode) return;
  const pt = _groundPt(e.clientX, e.clientY);
  if (!pt) return;
  e.stopImmediatePropagation();

  const list = getCaveEntrances();
  // Click inside an existing mouth selects it; otherwise drop a new one.
  let hit = -1;
  for (let i = 0; i < list.length; i++) {
    if (Math.hypot(pt.x - list[i].x, pt.z - list[i].z) < list[i].r * 1.3) { hit = i; break; }
  }
  if (hit >= 0) {
    _selIdx = hit;
    _updateVisuals();
  } else {
    list.push({ x: +pt.x.toFixed(2), z: +pt.z.toFixed(2), r: _lastR, seed: +(Math.random() * 6.283).toFixed(3) });
    setCaveEntrances(list);
    _selIdx = list.length - 1;
    _rebuild();
  }
  _updateStatus();
}

function _adjustR(delta) {
  const list = getCaveEntrances();
  if (_selIdx < 0 || !list[_selIdx]) return;
  list[_selIdx].r = Math.max(0.5, +(list[_selIdx].r + delta).toFixed(2));
  _lastR = list[_selIdx].r;
  _rebuild();
  _updateStatus();
}

function _deleteSel() {
  const list = getCaveEntrances();
  if (_selIdx < 0 || !list[_selIdx]) return;
  list.splice(_selIdx, 1);
  setCaveEntrances(list);
  _selIdx = -1;
  _rebuild();
  _updateStatus();
}

function _reshapeSel() {
  const list = getCaveEntrances();
  if (_selIdx < 0 || !list[_selIdx]) return;
  list[_selIdx].seed = +(Math.random() * 6.283).toFixed(3);
  _rebuild();
}

// ── Panel ───────────────────────────────────────────────────────────────────
function _setMode(on) {
  _mode = on;
  const btn = document.getElementById('cme-toggle');
  if (btn) { btn.textContent = on ? 'PLACING… (click terrain)' : 'PLACE CAVE MOUTH'; btn.classList.toggle('cme-on', on); }
  if (!on) _selIdx = -1;
  _updateVisuals();
  _updateStatus();
}

function _updateStatus() {
  const el = document.getElementById('cme-status');
  if (!el) return;
  const list = getCaveEntrances();
  if (!_mode) { el.textContent = `${list.length} mouth(es). Click PLACE to edit.`; return; }
  if (_selIdx >= 0 && list[_selIdx]) {
    el.textContent = `Selected #${_selIdx + 1} · size ${list[_selIdx].r.toFixed(1)}  ( [ / ] resize · R reshape · Del remove )`;
  } else {
    el.textContent = `Click terrain to drop a mouth, or click one to select. (${list.length} total)`;
  }
}

async function _save() {
  const el = document.getElementById('cme-status');
  if (!_activeZoneId) { if (el) el.textContent = 'No zone loaded'; return; }
  const list = getCaveEntrances().map(e => ({ x: e.x, z: e.z, r: e.r, seed: e.seed ?? 0 }));
  if (el) el.textContent = 'Saving…';
  try {
    const res = await fetch('/__save_zone_cave_entrances', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneId: _activeZoneId, caveEntrances: list }),
    });
    const j = await res.json();
    if (el) el.textContent = j.ok ? `Saved ${list.length} mouth(es) ✓` : `Error: ${j.error}`;
  } catch (err) {
    if (el) el.textContent = `Failed: ${err.message}`;
  }
}

function _buildPanel() {
  const p = document.createElement('div');
  p.id = 'cme-panel';
  p.innerHTML = `
    <div class="cme-title">CAVE MOUTH</div>
    <button id="cme-toggle" class="cme-btn">PLACE CAVE MOUTH</button>
    <div class="cme-row">
      <button id="cme-minus" class="cme-btn cme-sm">– size</button>
      <button id="cme-plus"  class="cme-btn cme-sm">+ size</button>
    </div>
    <div class="cme-row">
      <button id="cme-reshape" class="cme-btn cme-sm">reshape</button>
      <button id="cme-del"     class="cme-btn cme-sm">delete</button>
    </div>
    <button id="cme-save" class="cme-btn">SAVE TO ZONE</button>
    <div id="cme-status" class="cme-status"></div>`;
  const s = document.createElement('style');
  s.textContent = `
    #cme-panel { position:fixed; top:92px; right:10px; z-index:60; width:190px;
      background:rgba(10,8,4,0.92); border:1px solid #4a3412; border-radius:5px;
      padding:8px; font-family:sans-serif; color:#cdbf9a; box-shadow:0 3px 12px rgba(0,0,0,0.5); }
    #cme-panel .cme-title { font-size:0.62rem; letter-spacing:2px; color:#d4af37; margin-bottom:6px; text-align:center; }
    #cme-panel .cme-btn { width:100%; background:#1a130a; border:1px solid #3a2a08; color:#c9b98a;
      font-size:0.66rem; padding:6px; border-radius:3px; cursor:pointer; margin-bottom:5px; }
    #cme-panel .cme-btn:hover { border-color:#d4af37; color:#f0e0a0; }
    #cme-panel .cme-btn.cme-on { background:#3a2a08; color:#ffd84d; border-color:#d4af37; }
    #cme-panel .cme-row { display:flex; gap:5px; }
    #cme-panel .cme-sm { font-size:0.6rem; padding:5px; }
    #cme-panel .cme-status { font-size:0.58rem; color:#9a8f70; margin-top:4px; line-height:1.3; min-height:2.4em; }`;
  document.head.appendChild(s);
  document.body.appendChild(p);

  document.getElementById('cme-toggle').addEventListener('click', () => _setMode(!_mode));
  document.getElementById('cme-minus').addEventListener('click', () => _adjustR(-0.5));
  document.getElementById('cme-plus').addEventListener('click', () => _adjustR(0.5));
  document.getElementById('cme-reshape').addEventListener('click', _reshapeSel);
  document.getElementById('cme-del').addEventListener('click', _deleteSel);
  document.getElementById('cme-save').addEventListener('click', _save);
}

export function initCaveEntranceEditor() {
  if (!IS_DEV) return;
  _buildPanel();

  renderer.domElement.addEventListener('click', _onClick, true); // capture, before hero-click

  window.addEventListener('keydown', e => {
    if (!_mode) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    switch (e.key) {
      case 'Escape': _setMode(false); break;
      case '[':      e.preventDefault(); _adjustR(-0.5); break;
      case ']':      e.preventDefault(); _adjustR(0.5);  break;
      case 'r': case 'R': _reshapeSel(); break;
      case 'Delete': case 'Backspace': _deleteSel(); break;
    }
  });

  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _selIdx = -1;
    _updateVisuals();
    _updateStatus();
  });

  _updateStatus();
}
