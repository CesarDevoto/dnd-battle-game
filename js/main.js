import { scene, camera, renderer, controls, updateCameraFocus, toggleTopView, isTopViewActive } from './scene.js';
import { units, modelsReady, updateMixers } from './units.js';
import { updateParticles, updateWind, evergreenReady } from './environments.js';
import { updateEnvironmentVisibility } from './environmentVisibility.js';
import { initEngagementLines, updateEngagementLines } from './engagementLines.js';
import { updateHUD, trackSheet } from './ui.js';
import { activeRing, meleeRangeRing, rangedRangeRing, moveRangeRing, hoverRing, spellRangeRing, trackTargetUI, trackSleepUI, turnOrder, turnIndex, combatPhase, tickHoverPulse } from './combat.js';
import { selectedUnit, menuUnit, selectRing, trackMenu } from './army.js';
import { updateSelectionHighlight } from './selectionHighlight.js';
import { ANIM, UNIT_TYPES } from './constants.js';
import { getTerrainHeight } from './terrain.js';
import { buildHeroPortraits, updateHeroUI } from './heroPortraits.js';
import { initBestiary } from './bestiary.js';
import { initSpellbook } from './spellbook.js';
import { initHotbar, bindPermanentHotkey } from './hotbar.js';
import { cycleHero, removeUnits } from './army.js';
import { toggleAllBars, getAllBarsVisible } from './units.js';
import { initZoneUI, tickZone, loadZone, getActiveZone } from './zoneLoader.js';
import { setPrecombatFrozen } from './precombat.js';
import { tickPrecombat } from './precombat.js';
import { initPropEditor } from './propEditor.js';
import { initNpcEditor } from './npcEditor.js';
import { initNpcAIEditor } from './npcAIEditor.js';
import { initSpawnEditor } from './spawnEditor.js';
import { initTerrainEditor } from './terrainEditor.js';
import { initDevMode, tickDevCamera } from './devMode.js';
import { initCutsceneUI } from './cutsceneManager.js';
import { tickStars } from './investigateStars.js';
import { prewarmEffectShaders } from './firebolt.js';
import { initAudio, initMixerPanel } from './audio.js';
import { initDagna, tickDagna } from './dagnaEvent.js';
import { initAmbush, tickAmbush } from './ambushEvent.js';
import { initXPTable } from './xpTable.js';
import { IS_DEV } from './devConfig.js';
import { initSpellSlots } from './spells.js';
import { updateXPBar, showLevelUpFloat } from './progression.js';
import { showLevelUpModal } from './levelUpModal.js';
import { playSound } from './audio.js';
import { initGroupMove } from './groupMove.js';

if (IS_DEV) document.body.classList.add('dev-mode');

buildHeroPortraits();
prewarmEffectShaders();
initAudio();
initMixerPanel();
initEngagementLines();
initBestiary();
initXPTable();
initSpellbook();
initHotbar();
initZoneUI();
initDagna({ removeUnits, loadZone, setPrecombatFrozen });
initAmbush({ getActiveZoneId: () => getActiveZone()?.id });
initGroupMove();

if (IS_DEV) {
  initPropEditor();
  initNpcEditor();
  initNpcAIEditor();
  initSpawnEditor();
  initTerrainEditor();
  initDevMode();
  initCutsceneUI();

  // ── Cutscenes panel toggle ────────────────────────────────────────────────
  const _cutscenesPanel = document.getElementById('setup-panel-cutscenes');
  const _cutscenesBtn   = document.getElementById('cutscenes-btn');
  _cutscenesBtn.addEventListener('click', () => {
    const shown = _cutscenesPanel.style.display !== 'none' && _cutscenesPanel.style.display !== '';
    _cutscenesPanel.style.display = shown ? 'none' : 'flex';
    _cutscenesBtn.classList.toggle('active', !shown);
  });

  // ── Zones panel toggle ──────────────────────────────────────────────────────
  const _zonesPanel = document.getElementById('setup-panel-zones');
  const _zonesBtn   = document.getElementById('zones-btn');
  _zonesBtn.addEventListener('click', () => {
    const shown = _zonesPanel.style.display !== 'none' && _zonesPanel.style.display !== '';
    _zonesPanel.style.display = shown ? 'none' : 'flex';
    _zonesBtn.classList.toggle('active', !shown);
  });

  // ── Dialogue log toggle ─────────────────────────────────────────────────────
  document.getElementById('dlg-log-btn').addEventListener('click', () => {
    document.getElementById('dlg-log-panel').style.display = 'flex';
  });
  document.getElementById('dlg-log-close').addEventListener('click', () => {
    document.getElementById('dlg-log-panel').style.display = 'none';
  });

  // D&D 5e XP thresholds (index = level being reached, 1-indexed)
  const _DEV_XP = [0,300,900,2700,6500,14000,23000,34000,48000,64000,85000,100000,120000,140000,165000,195000,225000,265000,305000,355000];
  window.devSetLevel = (n) => {
    const target = Math.max(1, Math.min(20, n));
    const blues  = units.filter(u => u.team === 'blue');
    const dinging = [];
    blues.forEach(hero => {
      const oldLevel = hero.level ?? 1;
      hero.level     = target;
      hero.xp        = _DEV_XP[target - 1] ?? 0;
      const levelsUp = Math.max(0, target - oldLevel);
      const _hpRate  = { elf: 1, dwarf: 2, halfling: 2, human: 2.5 }[hero.type] ?? 2;
      const _frac    = (hero.hpFrac ?? 0) + levelsUp * _hpRate;
      const hpGain   = Math.floor(_frac);
      hero.hpFrac    = _frac - hpGain;
      if (hpGain > 0) { hero.maxHp += hpGain; hero.hp += hpGain; }
      if (levelsUp > 0) dinging.push({ hero, oldLevel, hpGain });
    });
    initSpellSlots(blues);
    updateXPBar();
    if (dinging.length) {
      setTimeout(() => {
        playSound('level_up');
        const modalEntries = dinging.map(({ hero, oldLevel, hpGain }) => {
          showLevelUpFloat(hero);
          window.dispatchEvent(new CustomEvent('hero:levelup', { detail: { hero, newLevel: hero.level } }));
          return { hero, newLevel: hero.level, hpGain, oldLevel };
        });
        setTimeout(() => showLevelUpModal(modalEntries), 700);
      }, 300);
    }
    console.log(`[DEV] Heroes set to level ${target}`);
  };
}

bindPermanentHotkey('KeyT',     'TOP<br>VIEW',      toggleTopView,  isTopViewActive);
bindPermanentHotkey('Tab',      'TOGGLE<br>HEROES', cycleHero,      null);
bindPermanentHotkey('Backquote','HEALTH<br>BARS',   toggleAllBars,  getAllBarsVisible);

// ── A / D — rotate active hero's facing direction ─────────────────────────────
const _rotKeys = { left: false, right: false };
const _ROT_SPEED = 2.2;  // radians per second

document.addEventListener('keydown', e => {
  if (e.key === 'a' || e.key === 'A') _rotKeys.left  = true;
  if (e.key === 'd' || e.key === 'D') _rotKeys.right = true;
});
document.addEventListener('keyup', e => {
  if (e.key === 'a' || e.key === 'A') _rotKeys.left  = false;
  if (e.key === 'd' || e.key === 'D') _rotKeys.right = false;
});


// army.js and environments.js register their event listeners on import

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let t = 0;
let _rafId   = null;
let _prevNow = 0;


(function tick(now = 0) {
  _rafId = requestAnimationFrame(tick);
  const dt = _prevNow > 0 ? Math.min((now - _prevNow) / 1000, 0.1) : 0.016;
  _prevNow = now;
  t += ANIM.timeStep;

  units.forEach((u, i) => {
    const terrainY = getTerrainHeight(u.grp.position.x, u.grp.position.z);
    if (u.mixer) {
      u.grp.position.y = terrainY + (u.hoverY ?? 0);
      u.anchor.y = terrainY + u.anchorY + (u.hoverY ?? 0);
    } else {
      const bob = Math.sin(t * ANIM.bobFreq + i * ANIM.bobPhaseOffset) * ANIM.bobAmplitude;
      u.grp.position.y = terrainY + u.hoverY + bob;
      u.anchor.y = terrainY + u.anchorY + u.hoverY + bob;
    }
  });

  // A / D — rotate active hero while it is a blue team's turn
  if (combatPhase && (_rotKeys.left || _rotKeys.right)) {
    const u = turnOrder[turnIndex];
    if (u?.team === 'blue') {
      const delta = _ROT_SPEED * ANIM.timeStep;
      if (_rotKeys.left)  u.grp.rotation.y += delta;
      if (_rotKeys.right) u.grp.rotation.y -= delta;
    }
  }

  if (activeRing.visible) {
    activeRing.material.opacity = ANIM.activeRingBase + Math.sin(t * ANIM.activeRingFreq) * ANIM.activeRingAmp;
  }

  if (meleeRangeRing.visible || rangedRangeRing.visible || spellRangeRing.visible) {
    const rp = ANIM.rangeRingBase + Math.sin(t * ANIM.rangeRingFreq) * ANIM.rangeRingAmp;
    if (meleeRangeRing.visible)  meleeRangeRing.material.opacity  = rp;
    if (rangedRangeRing.visible) rangedRangeRing.material.opacity = rp;
    if (spellRangeRing.visible)  spellRangeRing.material.opacity  = rp;
  }
  if (moveRangeRing.visible) {
    moveRangeRing.material.opacity = 0.88 + Math.sin(t * ANIM.rangeRingFreq) * 0.08;
  }
  if (hoverRing.visible) {
    hoverRing.material.opacity = 0.30 + Math.abs(Math.sin(t * 2.5)) * 0.70;
  }

  const ringTarget = selectedUnit ?? menuUnit;
  if (selectRing.visible && ringTarget) {
    selectRing.position.x = ringTarget.grp.position.x;
    selectRing.position.y = ringTarget.grp.position.y + 0.06;
    selectRing.position.z = ringTarget.grp.position.z;
    selectRing.material.opacity = ANIM.selectRingBase + Math.sin(t * ANIM.selectRingFreq) * ANIM.selectRingAmp;
  }

  trackMenu();
  trackSheet();

  tickHoverPulse(t);
  trackTargetUI();
  trackSleepUI();
  updateHeroUI();
  updateSelectionHighlight(t);
  updateCameraFocus();
  if (IS_DEV) tickDevCamera(dt);
  controls.update();
  updateEngagementLines(units);
  updateEnvironmentVisibility();
  updateParticles();
  updateWind(t);
  updateHUD();
  updateMixers(dt);
  tickZone(dt);
  tickPrecombat(dt);
  tickStars(dt);
  tickDagna(dt);
  tickAmbush(dt);
  renderer.render(scene, camera);
})();

function dismissOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay || overlay.classList.contains('done')) return;
  overlay.classList.add('done');
  // Primary removal: after the CSS opacity transition finishes
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  // Fallback: remove after 700 ms in case transitionend never fires
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 700);
  window.dispatchEvent(new CustomEvent('ui:ready'));
}

Promise.all([modelsReady, evergreenReady]).then(dismissOverlay);
setTimeout(dismissOverlay, 8000);  // hard cap — dismiss no matter what after 8 s

// Vite HMR: cancel the running rAF loop before the module is reloaded.
// Without this, each file-save spawns an extra animation loop that never stops.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_rafId !== null) cancelAnimationFrame(_rafId);
  });
}
