import { scene, camera, renderer, controls, updateCameraFocus, toggleTopView, isTopViewActive } from './scene.js';
import { units, modelsReady, updateMixers } from './units.js';
import { updateParticles, updateWind, evergreenReady } from './environments.js';
import { updateEnvironmentVisibility } from './environmentVisibility.js';
import { initEngagementLines, updateEngagementLines } from './engagementLines.js';
import { updateHUD, trackSheet } from './ui.js';
import { activeRing, meleeRangeRing, rangedRangeRing, moveRangeRing, hoverRing, spellRangeRing, trackTargetUI, trackSleepUI, turnOrder, turnIndex, combatPhase, tickHoverPulse, forceCombatExitWithLoot } from './combat.js';
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
import { initPropEditor, getPlacedProps } from './propEditor.js';
import { tickActivationRadius } from './activationRadius.js';
import { initNpcEditor } from './npcEditor.js';
import { initNpcAIEditor } from './npcAIEditor.js';
import { initSpawnEditor } from './spawnEditor.js';
import { initTerrainEditor } from './terrainEditor.js';
import { initBarrierEditor } from './barrierEditor.js';
import { initDevMode, tickDevCamera } from './devMode.js';
import { initCutsceneUI } from './cutsceneManager.js';
import { tickExclamations } from './exclamationMarkers.js';
import { initWorldMap } from './worldMap.js';

import { prewarmEffectShaders, initFireboltLight } from './firebolt.js';
import { initHealingWordLight } from './healingWord.js';
import { initMagicMissileLights } from './magicmissile.js';
import { prewarmArrowShaders } from './arrow.js';
import { initAudio, initMixerPanel } from './audio.js';
import { initDagna, tickDagna } from './dagnaEvent.js';
import { initAmbush, tickAmbush } from './ambushEvent.js';
import { tickLoot } from './loot.js';
import { initLootPanel } from './lootPanel.js';
import { initShortRest } from './shortRest.js';
import { tickBleakmireWoods } from './bleakmireWoodsEvent.js';
import './mausoleumEvent.js';
import { initXPTable } from './xpTable.js';
import { IS_DEV } from './devConfig.js';
import { initSpellSlots } from './spells.js';
import { updateXPBar, showLevelUpFloat } from './progression.js';
import { showLevelUpModal } from './levelUpModal.js';
import { playSound } from './audio.js';
import { initGroupMove } from './groupMove.js';
import { initQuests } from './quests.js';

if (IS_DEV) document.body.classList.add('dev-mode');

buildHeroPortraits();
prewarmEffectShaders();
initFireboltLight();
initHealingWordLight();
initMagicMissileLights();
prewarmArrowShaders();
initAudio();
initMixerPanel();
initEngagementLines();
initBestiary();
initXPTable();
initSpellbook();

// Smart XP overlay (dev-only)
{
  const sxpBtn     = document.getElementById('smart-xp-btn');
  const sxpOverlay = document.getElementById('smart-xp-overlay');
  const sxpClose   = document.getElementById('smart-xp-close');
  if (sxpBtn && sxpOverlay) {
    sxpBtn.addEventListener('click', () => sxpOverlay.classList.toggle('show'));
    sxpClose.addEventListener('click', () => sxpOverlay.classList.remove('show'));
    sxpOverlay.addEventListener('click', e => { if (e.target === sxpOverlay) sxpOverlay.classList.remove('show'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') sxpOverlay.classList.remove('show'); });
  }
}

// Smart Aggro overlay (dev-only)
{
  const sagBtn     = document.getElementById('smart-aggro-btn');
  const sagOverlay = document.getElementById('smart-aggro-overlay');
  const sagClose   = document.getElementById('smart-aggro-close');
  if (sagBtn && sagOverlay) {
    sagBtn.addEventListener('click', () => sagOverlay.classList.toggle('show'));
    sagClose.addEventListener('click', () => sagOverlay.classList.remove('show'));
    sagOverlay.addEventListener('click', e => { if (e.target === sagOverlay) sagOverlay.classList.remove('show'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') sagOverlay.classList.remove('show'); });
  }
}

// Smart Hit % overlay
{
  const shpBtn     = document.getElementById('smart-hit-btn');
  const shpOverlay = document.getElementById('smart-hit-overlay');
  const shpClose   = document.getElementById('smart-hit-close');
  if (shpBtn && shpOverlay) {
    shpBtn.addEventListener('click', () => shpOverlay.classList.toggle('show'));
    shpClose.addEventListener('click', () => shpOverlay.classList.remove('show'));
    shpOverlay.addEventListener('click', e => { if (e.target === shpOverlay) shpOverlay.classList.remove('show'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') shpOverlay.classList.remove('show'); });
  }
}

// Smart Save % overlay
{
  const sspBtn     = document.getElementById('smart-save-btn');
  const sspOverlay = document.getElementById('smart-save-overlay');
  const sspClose   = document.getElementById('smart-save-close');
  if (sspBtn && sspOverlay) {
    sspBtn.addEventListener('click', () => sspOverlay.classList.toggle('show'));
    sspClose.addEventListener('click', () => sspOverlay.classList.remove('show'));
    sspOverlay.addEventListener('click', e => { if (e.target === sspOverlay) sspOverlay.classList.remove('show'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') sspOverlay.classList.remove('show'); });
  }
}
initHotbar();
initZoneUI();
initDagna({ removeUnits, loadZone, setPrecombatFrozen, endCombat: forceCombatExitWithLoot, getActiveZone });
initAmbush({ getActiveZoneId: () => getActiveZone()?.id });
initLootPanel();
initShortRest();
initGroupMove();
initQuests();
initWorldMap();

initDevMode();
initCutsceneUI();

if (IS_DEV) {
  initPropEditor();
  initNpcEditor();
  initNpcAIEditor();
  initSpawnEditor();
  initTerrainEditor();
  initBarrierEditor();

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

  // Custom 100-level XP thresholds — must match XP_THRESHOLDS in progression.js
  const _DEV_XP = [0,200,450,750,1100,1500,1950,2450,3000,3600,4300,5100,6000,7000,8200,9500,11000,12700,14600,16700];
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
bindPermanentHotkey('Digit1',   'TOGGLE<br>HEROES', cycleHero,      null);
bindPermanentHotkey('Tab',      'NEXT<br>TARGET',   () => {},       null);
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
    const terrainY   = getTerrainHeight(u.grp.position.x, u.grp.position.z);
    const baseHoverY = u.hoverY ?? 0;

    // Hovering units descend diagonally as they close to melee range.
    // Lerp effective hover from full height (12+ WU away) down to 0 (≤5 WU away).
    let effectiveHoverY = baseHoverY;
    if (baseHoverY > 0) {
      const foeTeam = u.team === 'red' ? 'blue' : 'red';
      let minDist = Infinity;
      for (const other of units) {
        if (other.team !== foeTeam || other.hp <= 0) continue;
        const dx = other.grp.position.x - u.grp.position.x;
        const dz = other.grp.position.z - u.grp.position.z;
        const d  = dx * dx + dz * dz;
        if (d < minDist) minDist = d;
      }
      minDist = Math.sqrt(minDist);
      const DESCENT_START = 12; // WU — begin descent (~30 ft)
      const LANDED        = 5;  // WU — fully at ground level (melee trigger)
      const frac = Math.max(0, Math.min(1, (minDist - LANDED) / (DESCENT_START - LANDED)));
      effectiveHoverY = baseHoverY * frac;
    }

    if (u.mixer) {
      u.grp.position.y = terrainY + effectiveHoverY;
      u.anchor.y = terrainY + u.anchorY + effectiveHoverY;
    } else {
      const bob = Math.sin(t * ANIM.bobFreq + i * ANIM.bobPhaseOffset) * ANIM.bobAmplitude;
      u.grp.position.y = terrainY + effectiveHoverY + bob;
      u.anchor.y = terrainY + u.anchorY + effectiveHoverY + bob;
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
  tickExclamations(dt);
  tickDagna(dt);
  tickAmbush(dt);
  tickLoot(dt);
  tickBleakmireWoods(dt);
  tickActivationRadius(getPlacedProps());
  renderer.render(scene, camera);
})();

function dismissOverlay() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay || overlay.classList.contains('done')) return;
  overlay.classList.add('done');
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 700);

  if (IS_DEV) {
    window.dispatchEvent(new CustomEvent('ui:ready'));
  } else {
    // Show splash at full opacity BEFORE loading overlay fades — no gap where hotbars bleed through
    const splash = document.getElementById('splash-screen');
    splash.style.display = 'flex';
    splash.classList.add('splash-visible');
    document.getElementById('splash-btn').addEventListener('click', () => {
      splash.classList.remove('splash-visible');
      splash.addEventListener('transitionend', () => splash.remove(), { once: true });
      setTimeout(() => { if (splash.parentNode) splash.remove(); }, 1000);
      window.dispatchEvent(new CustomEvent('ui:ready'));
    }, { once: true });
  }
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
