import * as THREE from 'three';
import { scene, camera, renderer, controls, ground, _vec, setFollowUnit, getFollowUnit, snapCameraToUnit } from './scene.js';
import { units, buildUnit } from './units.js';
import { rollInitiative, combatPhase, turnOrder, turnIndex, isAnimating, isOOCHealPicking, pointerOverNonHeroUnit } from './combat.js';
import { isPrecombat, enterPrecombat, exitPrecombat, getPCSelected, selectPCHero, deselectPCHero, movePCHeroTo } from './precombat.js';
import { isGroupMove, setGroupMove, groupLeader } from './groupMove.js';
import { COLORS, INTERACTION, GRID_SQUARE_FEET, WORLD_UNITS_PER_SQUARE, SCENE } from './constants.js';
import { hideSheet } from './ui.js';
import { showSelectionHighlight, hideSelectionHighlight } from './selectionHighlight.js';
import { renderHeroPortrait } from './heroPortraits.js';
import { openWorldMapAuto } from './worldMap.js';
import { activeProps } from './environments.js';
import { surfaceLosBlockers } from './surfaces.js';
import { isExploreActive } from './exploreMove.js';

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
  if (!selectedUnit) { selectRing.visible = false; _setSelectedHeroBorder(null); }
}
export function clearMove() {
  if (selectedUnit) selectedUnit.barForced = false;
  selectedUnit = null;
  selectRing.visible = false;
  _setSelectedHeroBorder(null);
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
  if (u.team === 'blue') {
    // Selected hero → light-blue border on their health bar, no ring underneath.
    _setSelectedHeroBorder(u);
    selectRing.visible = false;
  } else {
    _setSelectedHeroBorder(null);
    selectRing.material.color.set(0xdd2222);
    selectRing.position.set(u.grp.position.x, u.grp.position.y + 0.06, u.grp.position.z);
    selectRing.visible = true;
  }
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
    // depthTest off: a flat ring on curved/sloped terrain had its downhill half buried in the
    // terrain and clipped away. Drawing it on top (like the other ground overlays) shows the
    // full circle at the cost of the body no longer occluding its back arc.
    depthTest: false, depthWrite: false,
  })
);
selectRing.rotation.x  = -Math.PI / 2;
selectRing.position.y  = 0.06;
selectRing.renderOrder = 12;
selectRing.visible = false;
scene.add(selectRing);

// Out of combat, a SELECTED HERO no longer gets the selectRing under them — their health bar gets
// the same steady light-blue border as the active-turn indicator (hp-bar-selected shares that CSS).
// Enemies still use the ring. This tracks which hero owns the border so it clears cleanly on
// re-select / deselect. Mirror every selectRing.visible change below with a call to this.
let _selBorderHero = null;
function _setSelectedHeroBorder(hero) {
  if (_selBorderHero === hero) return;
  _selBorderHero?.barEl?.classList.remove('hp-bar-selected');
  _selBorderHero = hero ?? null;
  _selBorderHero?.barEl?.classList.add('hp-bar-selected');
}

const distLabel = document.getElementById('move-dist');
const raycaster = new THREE.Raycaster();

// ── Hero selection helper (precombat + camera follow) ─────────────────────────
const _HERO_TAB_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

function _selectHero(hero) {
  if (!hero) return;
  selectPCHero(hero);
  selectedUnit = hero;
  _setSelectedHeroBorder(hero);   // light-blue bar border instead of the ring under the hero
  selectRing.visible = false;
  setFollowUnit(hero);
  window.dispatchEvent(new CustomEvent('pc-hero:selected', { detail: { hero } }));
}
const mouse2D   = new THREE.Vector2();

function groundHit(clientX, clientY) {
  mouse2D.x =  (clientX / window.innerWidth)  * 2 - 1;
  mouse2D.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse2D, camera);
  const gHits = raycaster.intersectObject(ground);
  let best = gHits.length ? gHits[0] : null;
  // In surface-movement zones, also stop the pick at solid collision geometry (bridge deck, building
  // floors, walls) and take whichever hit is NEARER the camera — so clicking ON a raised deck targets
  // the deck surface, not the ground plane below it. Empty in normal zones → identical to before.
  const blockers = surfaceLosBlockers();
  if (blockers.length) {
    const cHits = raycaster.intersectObjects(blockers, true);
    if (cHits.length && (!best || cHits[0].distance < best.distance)) best = cHits[0];
  }
  return best ? best.point : null;
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

// ── Dev coordinate marker ─────────────────────────────────────────────────────
// Alt+click the ground to drop a labelled pin and read its world (x, z); the
// running list shows in a top-left panel. Alt+Shift+click clears all marks.
// Handy for telling Claude "move the opening from mark 1 to mark 2".
const _COORD_COLORS = [0xffd400, 0x33ccff, 0xff5588, 0x66ff66, 0xffffff, 0xff9900];
let _coordMarks = [];
let _coordPanel = null;

function _renderCoordPanel() {
  if (!_coordPanel) {
    _coordPanel = document.createElement('div');
    _coordPanel.id = 'coord-mark-panel';
    _coordPanel.style.cssText =
      'position:fixed;top:70px;left:12px;z-index:9999;font:12px/1.55 monospace;' +
      'background:rgba(8,6,2,.9);border:1px solid rgba(212,175,55,.45);border-radius:6px;' +
      'padding:8px 11px;color:#f0e0b0;pointer-events:none;max-width:260px;';
    document.body.appendChild(_coordPanel);
  }
  const rows = _coordMarks.map((m, i) => {
    const c = '#' + _COORD_COLORS[i % _COORD_COLORS.length].toString(16).padStart(6, '0');
    return `<div style="color:${c}">${i + 1}: x ${m.x.toFixed(2)}, z ${m.z.toFixed(2)}</div>`;
  }).join('');
  _coordPanel.innerHTML =
    '<b>Coord marks</b> · Alt+click ground<br>' +
    '<span style="opacity:.55">Alt+Shift+click to clear</span>' + rows;
}

function _clearCoordMarks() {
  _coordMarks.forEach(m => {
    scene.remove(m.grp);
    m.grp.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  });
  _coordMarks = [];
  _renderCoordPanel();
}

function _dropCoordMark(x, y, z) {
  const idx   = _coordMarks.length;
  const color = _COORD_COLORS[idx % _COORD_COLORS.length];
  const mat   = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const grp   = new THREE.Group();
  const pole  = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), mat);
  pole.position.y = 3;
  const ball  = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), mat);
  ball.position.y = 6;
  grp.add(pole, ball);
  grp.position.set(x, y, z);
  grp.renderOrder = 999;   // draw on top so the pin is always visible
  grp.traverse(o => { o.renderOrder = 999; });
  scene.add(grp);
  _coordMarks.push({ x, z, grp });
  _renderCoordPanel();
  console.log(`[coord-mark ${idx + 1}] x: ${x.toFixed(2)}, z: ${z.toFixed(2)}`);
}

// ── Click: select / reposition ────────────────────────────────────────────────

renderer.domElement.addEventListener('click', e => {
  // Leugren's out-of-combat Healing Word is picking a target this click —
  // combat.js's own listener owns it entirely, don't also reselect a hero.
  if (isOOCHealPicking()) return;

  // ── Dev: Alt+click drops a coordinate marker (Alt+Shift+click clears them) ──
  if (e.altKey) {
    if (e.shiftKey) { _clearCoordMarks(); return; }
    const pt = groundHit(e.clientX, e.clientY);
    if (pt) _dropCoordMark(pt.x, pt.y, pt.z);
    return;
  }

  // ── Waystone click: open associated map (works in precombat and combat) ──
  {
    mouse2D.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse2D.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse2D, camera);
    const waystones = activeProps.filter(m => m.userData?.isWaystone);
    const wsHit = raycaster.intersectObjects(waystones, true);
    if (wsHit.length) {
      let grp = wsHit[0].object;
      while (grp.parent && !grp.userData?.isWaystone) grp = grp.parent;
      if (grp.userData?.isWaystone) {
        // Activate if any hero is within 20ft (8 WU)
        const CLICK_ACTIVATE_R = 8.0;
        const wx = grp.position.x, wz = grp.position.z;
        const nearby = units.some(u => {
          if (u.team !== 'blue' || u.hp <= 0) return false;
          const dx = u.grp.position.x - wx, dz = u.grp.position.z - wz;
          return dx * dx + dz * dz <= CLICK_ACTIVATE_R * CLICK_ACTIVATE_R;
        });
        if (nearby) grp.userData.tryActivate?.();
        openWorldMapAuto(grp.userData.waystoneId ?? null);
        return;
      }
    }
  }

  // ── Zone Gate click: travel to the linked zone ────────────────────────────
  // ONLY the small white centre ball is a click target (isGateBall) — the soft fog around it is
  // never raycast, so players can't fat-finger a zone change. A hero must be within 10 ft (4 WU).
  {
    mouse2D.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse2D.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse2D, camera);
    const gateBalls = [];
    for (const m of activeProps) {
      if (!m.userData?.isZoneGate) continue;
      m.traverse(o => { if (o.userData?.isGateBall) gateBalls.push(o); });
    }
    const gHit = gateBalls.length ? raycaster.intersectObjects(gateBalls, false) : [];
    if (gHit.length) {
      let grp = gHit[0].object;
      while (grp.parent && !grp.userData?.isZoneGate) grp = grp.parent;
      const targetZone = grp.userData?.targetZone;
      if (targetZone) {
        const GATE_R = 4.0;   // 10 ft (5 ft = 2 WU)
        // 3-D distance: vertical gap counts too, so a hero 50 ft below the gate (even in an
        // adjacent XZ square) is out of range and can't click it.
        const gx = grp.position.x, gy = grp.position.y, gz = grp.position.z;
        const near = units.some(u => {
          if (u.team !== 'blue' || u.hp <= 0) return false;
          const dx = u.grp.position.x - gx, dy = u.grp.position.y - gy, dz = u.grp.position.z - gz;
          return dx * dx + dy * dy + dz * dz <= GATE_R * GATE_R;
        });
        // combatPhase / postcombat gating is handled by the zoneLoader listener.
        if (near) window.dispatchEvent(new CustomEvent('zonegate:travel', { detail: { targetZone, x: gx, z: gz } }));
      }
      return;   // clicking the gate ball never falls through to a ground-move
    }
  }

  // ── Precombat: hero selection + free movement ─────────────────────────────
  if (isPrecombat()) {
    // Clicked an enemy / NPC / the familiar → that's a TARGETING click, and combat.js's own
    // listener has already selected it. Bail out before the ground-move below, which would
    // otherwise read the same click as "walk to the patch of dirt that creature is standing
    // on" and send the party charging at it.
    if (pointerOverNonHeroUnit(e.clientX, e.clientY)) return;

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
    // Click on ground → move. In GROUP move the party travels single file: order the leader
    // (Leugren, or the next living hero) to the point and the rest trail its path via follower.js.
    if (isGroupMove()) {
      const leader = groupLeader();
      if (leader) movePCHeroTo(leader, pt.x, pt.z);
      return;
    }
    // Solo move → just the selected hero.
    const sel = getPCSelected();
    if (sel) {
      movePCHeroTo(sel, pt.x, pt.z);
      return;
    }
    // Click on valid terrain but no hero selected → deselect
    clearMove();
    deselectPCHero();
    window.dispatchEvent(new CustomEvent('pc-hero:deselected'));
    return;
  }
});

// ── Hold-left-to-move: continuous cursor-follow movement (exploration) ─────────
// Diablo/PoE style — hold the left button and the selected hero walks toward the
// ground point under the cursor, re-evaluated every frame (the camera follows the
// hero, so a stationary cursor still maps to a moving ground point). With group
// move on, the rest of the party follows in the formation offsets captured when
// the hold began. The movement engine is already target-based (movePCHeroTo sets
// hero._pcTarget, walked by tickPrecombat), so this just keeps overwriting it.
let _holdMoving    = false;
let _holdPointer   = { x: 0, y: 0 };

function _stopHoldMove() { _holdMoving = false; }

// Who the hold-move drives: the group leader (single-file, chain trails it) or, in solo, the
// selected hero.
function _holdMover() { return isGroupMove() ? groupLeader() : getPCSelected(); }

function _issueHoldMove(x, z, mover) {
  movePCHeroTo(mover, x, z);   // group: leader only; the follower chain does the rest.
}

renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0 || !isPrecombat() || isOOCHealPicking()) return;
  // Pressing on an enemy / NPC / the familiar is a targeting click, not a move order. This
  // guard has to live HERE and not only in the 'click' listener: mousedown issues the move
  // immediately (_issueHoldMove below), so without it the party sets off the instant the
  // button goes down and the later click handler is too late to stop them.
  if (pointerOverNonHeroUnit(e.clientX, e.clientY)) return;
  const pt = groundHit(e.clientX, e.clientY);
  if (!pt) return;
  // Pressing on a hero selects it (handled by the 'click' listener) — not a move.
  const onHero = units.some(u => u.team === 'blue' && u.hp > 0 &&
    (u.grp.position.x - pt.x) ** 2 + (u.grp.position.z - pt.z) ** 2 < INTERACTION.pickRadiusSq);
  if (onHero) return;
  const mover = _holdMover();
  if (!mover) return;
  _holdMoving  = true;
  _holdPointer = { x: e.clientX, y: e.clientY };
  _issueHoldMove(pt.x, pt.z, mover);
});

// Track the cursor while held; the per-frame tick re-raycasts from this position.
renderer.domElement.addEventListener('mousemove', e => {
  if (_holdMoving) { _holdPointer.x = e.clientX; _holdPointer.y = e.clientY; }
});

// Releasing anywhere — or the cursor leaving the canvas — ends the hold.
window.addEventListener('mouseup', e => { if (e.button === 0) _stopHoldMove(); });
renderer.domElement.addEventListener('mouseleave', _stopHoldMove);

// Called every frame from the main render loop (after tickPrecombat).
export function tickHoldMove() {
  if (!_holdMoving) return;
  if (isExploreActive()) { _stopHoldMove(); return; }   // WASD is driving — yield the leader
  if (!isPrecombat()) { _stopHoldMove(); return; }
  const mover = _holdMover();
  if (!mover || mover.hp <= 0) { _stopHoldMove(); return; }
  const pt = groundHit(_holdPointer.x, _holdPointer.y);
  if (!pt) return;
  // Stop re-issuing once the leader is basically at the cursor, so the walk
  // animation doesn't flicker on/off at the destination.
  const dx = pt.x - mover.grp.position.x, dz = pt.z - mover.grp.position.z;
  if (dx * dx + dz * dz < 0.36) return;
  _issueHoldMove(pt.x, pt.z, mover);
}


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

  // Escape: deselect + close any open hero sheet (main sheet, side panels,
  // equipment, and bag all close together via hideSheet()).
  if (e.key === 'Escape') {
    if (isPrecombat()) {
      clearMove();
      deselectPCHero();
      window.dispatchEvent(new CustomEvent('pc-hero:deselected'));
    }
    hideSheet();
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
