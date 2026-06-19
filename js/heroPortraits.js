import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { units } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, turnOrder, turnIndex } from './combat.js';
import { showSheet } from './ui.js';
import { blessedUnits, concentrating, concentratingSpell, getBlessRoundsLeft } from './spells.js';

const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

const PORTRAIT_W = 52;
const PORTRAIT_H = 52;

// ── Shared portrait scene & camera (re-used across all four renders) ──────────
// Each hero's canvas gets its own WebGLRenderer (same pattern as targetWindow.js).
// The scene is cleared between renders; renders happen sequentially so sharing is safe.

const _pScene  = new THREE.Scene();
const _pCamera = new THREE.PerspectiveCamera(38, 1, 0.01, 300);

_pScene.add(new THREE.AmbientLight(0xffe8c8, 1.3));
const _pKey = new THREE.DirectionalLight(0xffd080, 2.4);
_pKey.position.set(2, 5, -4);
_pScene.add(_pKey);
const _pFill = new THREE.DirectionalLight(0x88aaff, 0.7);
_pFill.position.set(-3, 1, 2);
_pScene.add(_pFill);

let _pModelNode = null;

function _clearPortraitScene() {
  if (_pModelNode) { _pScene.remove(_pModelNode); _pModelNode = null; }
}

// Per-hero WebGLRenderer instances, keyed by type
const _renderers = {};

function _makeRenderer(canvasEl) {
  const pr = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true, antialias: true });
  pr.setSize(PORTRAIT_W, PORTRAIT_H);
  pr.setClearColor(0x000000, 0);
  return pr;
}

function _renderHero(unit, pr) {
  _clearPortraitScene();
  if (!unit?.grp) return;

  const clone = SkeletonUtils.clone(unit.grp);
  clone.position.set(0, 0, 0);
  _pScene.add(clone);
  _pModelNode = clone;

  _pScene.updateMatrixWorld(true);

  const box    = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  if (size.y < 0.01) return;

  // Tight crop on head/face: look at ~83% up the model, small half-height
  const lookY  = box.min.y + size.y * 0.83;
  const halfH  = size.y * 0.10;
  const fovRad = _pCamera.fov * (Math.PI / 180);
  const dist   = halfH / Math.tan(fovRad / 2);
  const maxXZ  = Math.max(size.x, size.z) || 1;

  _pCamera.position.set(
    center.x - maxXZ * 0.18,
    lookY    + size.y * 0.02,
    center.z - dist
  );
  _pCamera.lookAt(center.x, lookY, center.z);

  pr.render(_pScene, _pCamera);
  _clearPortraitScene();
}

// ── Card registry ─────────────────────────────────────────────────────────────
const _cards = {};

export function renderHeroPortrait(unit) {
  const refs = _cards[unit.type];
  const pr   = _renderers[unit.type];
  if (!refs || !pr) return;
  _renderHero(unit, pr);
}

const blueHudEl = document.getElementById('blue-turn-hud');

export function buildHeroPortraits() {
  const bar = document.getElementById('hero-portrait-bar');
  bar.innerHTML = '';

  for (const type of HERO_ORDER) {
    const def = UNIT_TYPES[type];

    // ── Slot: card + conditions side by side ──────────────────────────
    const slot = document.createElement('div');
    slot.className = 'hpc-hero-slot';

    const card = document.createElement('div');
    card.className = `hero-portrait-card hpc-${type}`;

    // ── Top row: [portrait canvas] [stats col | sheet btn] ────────────
    const topRow = document.createElement('div');
    topRow.className = 'hpc-top-row';

    // Canvas rendered into directly by the per-hero WebGLRenderer
    const portraitCanvas = document.createElement('canvas');
    portraitCanvas.width     = PORTRAIT_W;
    portraitCanvas.height    = PORTRAIT_H;
    portraitCanvas.className = 'hpc-avatar';
    portraitCanvas.draggable = false;

    // Create the renderer for this hero's canvas now
    _renderers[type] = _makeRenderer(portraitCanvas);

    const meta = document.createElement('div');
    meta.className = 'hpc-meta';

    const statsCol = document.createElement('div');
    statsCol.className = 'hpc-stats';

    const sheetBtn = document.createElement('button');
    sheetBtn.className = 'hpc-sheet-btn';
    sheetBtn.title     = 'Character Sheet';
    sheetBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 18" width="15" height="19" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4L11 4L11 15L3 15Z" fill="currentColor" fill-opacity="0.15" stroke-width="0.9"/><path d="M1.5 4 Q7 1.8 12.5 4 Q7 6.2 1.5 4Z" fill="currentColor" fill-opacity="0.4" stroke-width="0.9"/><path d="M1.5 15 Q7 12.8 12.5 15 Q7 17.2 1.5 15Z" fill="currentColor" fill-opacity="0.4" stroke-width="0.9"/><line x1="4.5" y1="7.5" x2="9.5" y2="7.5" stroke-width="1.1"/><line x1="4.5" y1="10" x2="9.5" y2="10" stroke-width="1.1"/><line x1="4.5" y1="12.5" x2="7.5" y2="12.5" stroke-width="1.1"/></svg>`;
    sheetBtn.addEventListener('click', e => {
      e.stopPropagation();
      const u = units.find(u => u.team === 'blue' && u.type === type);
      showSheet(u ?? { type, hp: UNIT_TYPES[type].hp });
    });

    meta.appendChild(statsCol);
    meta.appendChild(sheetBtn);
    topRow.appendChild(portraitCanvas);
    topRow.appendChild(meta);

    // ── Name ──────────────────────────────────────────────────────────
    const nameEl = document.createElement('div');
    nameEl.className  = 'hpc-name';
    nameEl.textContent = def.name.toUpperCase();

    // ── HP bar ────────────────────────────────────────────────────────
    const hpWrap = document.createElement('div');
    hpWrap.className = 'hpc-hp-wrap';

    const hpRow = document.createElement('div');
    hpRow.className = 'hpc-hp-row';
    const hpCurEl = document.createElement('span');
    hpCurEl.className  = 'hpc-hp-cur';
    hpCurEl.textContent = `${def.hp}/${def.hp}`;
    hpRow.appendChild(hpCurEl);

    const trackEl = document.createElement('div');
    trackEl.className = 'hpc-hp-track';
    const fillEl = document.createElement('div');
    fillEl.className  = `hpc-hp-fill hpcf-${type}`;
    fillEl.style.width = '100%';
    trackEl.appendChild(fillEl);

    hpWrap.appendChild(hpRow);
    hpWrap.appendChild(trackEl);

    card.appendChild(nameEl);
    card.appendChild(topRow);
    card.appendChild(hpWrap);

    // ── Conditions panel (right of card, inside the slot) ─────────────
    const condEl = document.createElement('div');
    condEl.className = 'hpc-conditions';

    slot.appendChild(card);
    slot.appendChild(condEl);
    bar.appendChild(slot);

    _cards[type] = { card, fill: fillEl, hpText: hpCurEl, sheetBtn, maxHp: def.hp, condEl };
  }

  // Collapse toggle — appended after cards so it sits at the bottom of the bar
  const colBtn = document.createElement('button');
  colBtn.id        = 'portrait-bar-toggle';
  colBtn.textContent = '▶';
  colBtn.title     = 'Expand hero panel';
  colBtn.addEventListener('click', () => {
    const collapsed = bar.classList.toggle('collapsed');
    colBtn.textContent = collapsed ? '▶' : '◀';
    colBtn.title       = collapsed ? 'Expand hero panel' : 'Collapse hero panel';
  });
  bar.appendChild(colBtn);

  // Start collapsed — player opens it when needed
  bar.classList.add('collapsed');
}

export function updateHeroUI() {
  const activeUnit = turnOrder[turnIndex] ?? null;
  let activeHasConds = false;

  for (const type of HERO_ORDER) {
    const refs = _cards[type];
    if (!refs) continue;

    const u = units.find(u => u.team === 'blue' && u.type === type);

    // HP / dead state
    if (u) {
      refs.card.classList.remove('hpc-dead');
      refs.fill.style.width   = Math.max(0, (u.hp / u.maxHp) * 100) + '%';
      refs.hpText.textContent = `${Math.max(0, u.hp)}/${u.maxHp}`;
      refs.sheetBtn.disabled  = false;
    } else if (combatPhase) {
      refs.card.classList.add('hpc-dead');
      refs.fill.style.width   = '0%';
      refs.hpText.textContent = `0/${refs.maxHp}`;
      refs.sheetBtn.disabled  = true;
    } else {
      refs.sheetBtn.disabled = false;
    }

    // Conditions — shown to the right of this hero's card
    if (refs.condEl) {
      let badges = '';
      if (u && u.raging)
        badges += `<span class="cond-badge cond-rage">⚔ Raging<span class="cond-turns">${u.rageRounds}t</span></span>`;
      if (u && blessedUnits.has(u))
        badges += `<span class="cond-badge">✦ Blessed: 1d4 to Atk &amp; ST<span class="cond-turns">${getBlessRoundsLeft()}t</span></span>`;
      if (u && concentrating === u)
        badges += `<span class="cond-badge cond-conc">◈ Concentrating: ${concentratingSpell}<span class="cond-turns">${getBlessRoundsLeft()}t</span></span>`;

      refs.condEl.innerHTML = badges;
      refs.condEl.classList.toggle('has-content', badges.length > 0);

      if (u === activeUnit && badges.length > 0) activeHasConds = true;
    }
  }

  // Shift blue HUD right only when the active hero has conditions
  if (blueHudEl) {
    blueHudEl.classList.toggle('conds-offset', activeHasConds);
  }
}
