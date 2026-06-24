import * as THREE from 'three';
import { scene, camera, renderer, controls, ground, _vec, setFollowUnit, getFollowUnit, snapCameraToUnit } from './scene.js';
import { units, buildUnit } from './units.js';
import { rollInitiative, combatPhase, turnOrder, turnIndex, isAnimating } from './combat.js';
import { isPrecombat, enterPrecombat, exitPrecombat, getPCSelected, selectPCHero, deselectPCHero, movePCHeroTo } from './precombat.js';
import { isGroupMove, setGroupMove } from './groupMove.js';
import { COLORS, HERO_RING_COLORS, INTERACTION, GRID_SQUARE_FEET, WORLD_UNITS_PER_SQUARE, SCENE } from './constants.js';
import { hideSheet } from './ui.js';
import { showSelectionHighlight, hideSelectionHighlight } from './selectionHighlight.js';
import { renderHeroPortrait } from './heroPortraits.js';

// ── State ─────────────────────────────────────────────────────────────────────

export let setupPhase   = true;
export let selectedUnit = null;
export let menuUnit     = null;

// ── Unit menu ─────────────────────────────────────────────────────────────────

const unitMenu = document.getElementById('unit-menu');

export function hideMenu() {
  if (menuUnit) menuUnit.barForced = false;
  menuUnit = null;
  unitMenu.classList.remove('show');
  if (!selectedUnit) selectRing.visible = false;
}
export function clearMove() {
  if (selectedUnit) selectedUnit.barForced = false;
  selectedUnit = null;
  selectRing.visible = false;
  distLabel.style.display = 'none';
  hideSheet();
  hideSelectionHighlight();
}
export function showMenu(u) {
  hideSheet();
  if (menuUnit && menuUnit !== u) menuUnit.barForced = false;
  menuUnit = u;
  selectedUnit = u;
  u.barForced = true;
  unitMenu.classList.add('show');
  selectRing.material.color.set(u.team === 'red' ? 0xdd2222 : (HERO_RING_COLORS[u.type] ?? 0x2255ee));
  selectRing.position.set(u.grp.position.x, u.grp.position.y + 0.06, u.grp.position.z);
  selectRing.visible = true;
  showSelectionHighlight(u);
}
export function trackMenu() {
  if (!menuUnit) return;
  _vec.set(menuUnit.anchor.x, menuUnit.anchor.y + 1.4, menuUnit.anchor.z).project(camera);
  if (_vec.z < 1) {
    unitMenu.style.left = ((_vec.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
    unitMenu.style.top  = ((-_vec.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  }
}

document.getElementById('stat-sheet-close').addEventListener('click', e => {
  e.stopPropagation();
  hideSheet();
  if (selectedUnit) showMenu(selectedUnit);
});

// ── Unit management ───────────────────────────────────────────────────────────

export function resetToSetup() {
  setupPhase = true;
  if (isPrecombat()) exitPrecombat();
  // env-selector is toggled by the BIOMES button; don't force-show it here
}

export function removeUnits(pred) {
  for (let i = units.length - 1; i >= 0; i--) {
    if (!pred(units[i])) continue;
    scene.remove(units[i].grp);
    units[i].barEl?.remove();
    units.splice(i, 1);
  }
}


// ── 3D interaction objects ────────────────────────────────────────────────────

export const selectRing = new THREE.Mesh(
  new THREE.RingGeometry(INTERACTION.selectRingInner, INTERACTION.selectRingOuter, 32),
  new THREE.MeshBasicMaterial({
    color: COLORS.selectRing, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
    depthTest: false,
  })
);
selectRing.rotation.x  = -Math.PI / 2;
selectRing.position.y  = 0.06;
selectRing.renderOrder = 3;
selectRing.visible = false;
scene.add(selectRing);

const distLabel = document.getElementById('move-dist');
const raycaster = new THREE.Raycaster();

// ── Hero selection helper (precombat + camera follow) ─────────────────────────
const _HERO_TAB_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

function _selectHero(hero) {
  if (!hero) return;
  selectPCHero(hero);
  selectedUnit = hero;
  selectRing.material.color.set(HERO_RING_COLORS[hero.type] ?? 0x2255ee);
  selectRing.position.set(hero.grp.position.x, hero.grp.position.y + 0.06, hero.grp.position.z);
  selectRing.visible = true;
  setFollowUnit(hero);
}
const mouse2D   = new THREE.Vector2();

function groundHit(clientX, clientY) {
  mouse2D.x =  (clientX / window.innerWidth)  * 2 - 1;
  mouse2D.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse2D, camera);
  const h = raycaster.intersectObject(ground);
  return h.length ? h[0].point : null;
}

// ── Mouse move: move line ─────────────────────────────────────────────────────

renderer.domElement.addEventListener('mousemove', e => {
  if (!setupPhase) {
    if (combatPhase && !isAnimating) {
      const u  = turnOrder[turnIndex];
      const pt = (u && u.team === 'blue') ? groundHit(e.clientX, e.clientY) : null;
      if (pt) {
        const ux = u.grp.position.x, uz = u.grp.position.z;
        const dx = pt.x - ux, dz = pt.z - uz;
        const sq = Math.round(Math.sqrt(dx * dx + dz * dz) / WORLD_UNITS_PER_SQUARE);
        distLabel.textContent   = `${sq} sq · ${sq * GRID_SQUARE_FEET} ft`;
        distLabel.style.left    = (e.clientX + 16) + 'px';
        distLabel.style.top     = (e.clientY - 14) + 'px';
        distLabel.style.display = 'block';
      } else {
        distLabel.style.display = 'none';
      }
    } else if (isPrecombat()) {
      // Show distance to mouse when a hero is selected for movement
      const sel = getPCSelected();
      const pt  = sel ? groundHit(e.clientX, e.clientY) : null;
      if (pt && sel) {
        const dx = pt.x - sel.grp.position.x, dz = pt.z - sel.grp.position.z;
        const sq = Math.round(Math.sqrt(dx * dx + dz * dz) / WORLD_UNITS_PER_SQUARE);
        distLabel.textContent   = `${sq} sq · ${sq * GRID_SQUARE_FEET} ft`;
        distLabel.style.left    = (e.clientX + 16) + 'px';
        distLabel.style.top     = (e.clientY - 14) + 'px';
        distLabel.style.display = 'block';
      } else {
        distLabel.style.display = 'none';
      }
    } else {
      distLabel.style.display = 'none';
    }
    return;
  }

  distLabel.style.display = 'none';
});

// ── Click: select / reposition ────────────────────────────────────────────────

renderer.domElement.addEventListener('click', e => {
  // ── Precombat: hero selection + free movement ─────────────────────────────
  if (isPrecombat()) {
    const pt = groundHit(e.clientX, e.clientY);
    if (!pt) return; // clicked void / off-mesh — ignore, keep current selection
    // Click on a hero → select
    const hero = units.find(u => {
      if (u.team !== 'blue' || u.hp <= 0) return false;
      const dx = u.grp.position.x - pt.x, dz = u.grp.position.z - pt.z;
      return dx * dx + dz * dz < INTERACTION.pickRadiusSq;
    });
    if (hero) {
      clearMove(); hideMenu();
      _selectHero(hero);
      return;
    }
    // Click on ground → move selected hero (and group if enabled)
    const sel = getPCSelected();
    if (sel) {
      const dx = pt.x - sel.grp.position.x;
      const dz = pt.z - sel.grp.position.z;
      movePCHeroTo(sel, pt.x, pt.z);
      if (isGroupMove()) {
        units.filter(o => o.team === 'blue' && o !== sel && o.hp > 0).forEach(o => {
          movePCHeroTo(o, o.grp.position.x + dx, o.grp.position.z + dz);
        });
      }
      return;
    }
    // Click on valid terrain but no hero selected → deselect
    clearMove();
    deselectPCHero();
    return;
  }
});


// ── Start Battle ──────────────────────────────────────────────────────────────

document.getElementById('start-battle-btn').addEventListener('click', () => {
  setupPhase = false;
  clearMove(); hideMenu();
  controls.enabled = true;
  document.getElementById('setup-panel-zones').style.display      = 'none';
  document.getElementById('setup-panel-cutscenes').style.display  = 'none';
  document.getElementById('start-battle-btn-wrap').style.display  = 'none';
  document.getElementById('env-selector').style.display = 'none';
  document.getElementById('biomes-btn')?.classList.remove('active');
  document.getElementById('combat-log').style.display = 'flex';
  enterPrecombat();

  camera.position.set(...SCENE.cameraPos);
  controls.target.set(0, 0, SCENE.cameraPlayTarget);
  controls.update();

  // Auto-select and follow the dwarf (or first available hero)
  const firstHero = _HERO_TAB_ORDER
    .map(type => units.find(u => u.type === type && u.team === 'blue' && u.hp > 0))
    .find(Boolean);
  if (firstHero) _selectHero(firstHero);
});

// Clear precombat selection ring when combat kicks off
window.addEventListener('combat:start', () => clearMove());

// After combat ends, snap camera to Leugren (dwarf) or first alive hero and
// restore group move so one click gets the whole party walking.
window.addEventListener('combat:ended', () => {
  const firstHero = _HERO_TAB_ORDER
    .map(type => units.find(u => u.type === type && u.team === 'blue' && u.hp > 0))
    .find(Boolean);
  if (!firstHero) return;
  _selectHero(firstHero);
  setGroupMove(true);
  // Instant camera snap — shift target to hero, move camera by same delta so
  // orbit offset is preserved, then update controls so it takes effect now.
  const p = firstHero.grp.position;
  const newTarget = new THREE.Vector3(p.x, p.y + 1, p.z - 3);
  camera.position.add(newTarget).sub(controls.target);
  controls.target.copy(newTarget);
  controls.update();
});

// Re-select and re-snap after the full post-combat sequence (loot panel etc.)
// so the player is immediately ready to move right after the loot window closes.
// Dagna's handler never calls done() so postcombat:done won't fire when she triggers.
window.addEventListener('postcombat:done', () => {
  const firstHero = _HERO_TAB_ORDER
    .map(type => units.find(u => u.type === type && u.team === 'blue' && u.hp > 0))
    .find(Boolean);
  if (!firstHero) return;
  _selectHero(firstHero);
  setGroupMove(true);
  snapCameraToUnit(firstHero);
});

// ── Keyboard shortcuts (play mode) ────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Escape: deselect
  if (e.key === 'Escape') {
    if (isPrecombat()) { clearMove(); deselectPCHero(); }
  }

});

export function cycleHero() {
  if (!isPrecombat() && !combatPhase) return;
  const heroes = _HERO_TAB_ORDER
    .map(type => units.find(u => u.type === type && u.team === 'blue' && u.hp > 0))
    .filter(Boolean);
  if (!heroes.length) return;
  const current  = getFollowUnit() ?? getPCSelected();
  const curIdx   = heroes.findIndex(h => h === current);
  const nextHero = heroes[(curIdx + 1) % heroes.length];
  if (isPrecombat()) { clearMove(); _selectHero(nextHero); }
  else setFollowUnit(nextHero);
}
