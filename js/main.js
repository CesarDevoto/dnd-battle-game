import { scene, camera, renderer, controls, updateCameraFocus, toggleTopView, flipCamera, ceiling,
         precompileScene, tickAdaptiveResolution } from './scene.js';
import { units, modelsReady, updateMixers } from './units.js';
import { updateParticles, updateWind, evergreenReady } from './environments.js';
import { updateEnvironmentVisibility } from './environmentVisibility.js';
import { initEngagementLines, updateEngagementLines } from './engagementLines.js';
import { updateHUD, trackSheet, sheetUnit, showSheet } from './ui.js';
import { equipItem, MATERIAL_PROF } from './equipment.js';
import { getItem } from './items.js';
import { rollAffixes } from './affixes.js';
import { activeRing, meleeRangeRing, rangedRangeRing, longRangeRing, moveRangeRing, hoverRing, spellRangeRing, trackTargetUI, trackSleepUI, trackFearUI, turnOrder, turnIndex, combatPhase, tickHoverPulse, forceCombatExitWithLoot, updateReadyIcons, updateFamiliarHelpMarker, trackSurpriseUI } from './combat.js';
import { selectedUnit, menuUnit, selectRing, trackMenu } from './army.js';
import { updateSelectionHighlight } from './selectionHighlight.js';
import { ANIM, UNIT_TYPES } from './constants.js';
import { getTerrainHeight, getGroundHeight, resolveCaveLayer } from './terrain.js';
import { tickCaveReveal } from './caveReveal.js';
import { buildHeroPortraits, updateHeroUI } from './heroPortraits.js';
import { initBestiary } from './bestiary.js';
import { initSpellbook } from './spellbook.js';
import { initHotbar, bindPermanentHotkey } from './hotbar.js';
import { cycleHero, removeUnits, tickHoldMove } from './army.js';
import { initZoneUI, tickZone, loadZone, getActiveZone, applyCaveRoof } from './zoneLoader.js';
import { setPrecombatFrozen } from './precombat.js';
import { tickPrecombat } from './precombat.js';
import { initPropEditor, getPlacedProps } from './propEditor.js';
import { tickActivationRadius } from './activationRadius.js';
import { initNpcEditor } from './npcEditor.js';
import { initNpcAIEditor } from './npcAIEditor.js';
import { initSpawnEditor } from './spawnEditor.js';
import { initTerrainEditor } from './terrainEditor.js';
import { initBarrierEditor } from './barrierEditor.js';
import { initTerrainPaint } from './terrainPaint.js';
import { initReferenceOverlay } from './referenceOverlay.js';
import { initTrenchEditor } from './trenchEditor.js';
import { initCaveEntranceEditor } from './caveEntranceEditor.js';
import { initDevMode, tickDevCamera } from './devMode.js';
import { initCutsceneUI } from './cutsceneManager.js';
import { tickExclamations } from './exclamationMarkers.js';
import { initWorldMap } from './worldMap.js';

import { prewarmEffectShaders, initFireboltLight } from './firebolt.js';
import { initHealingWordLight } from './healingWord.js';
import { initMagicMissileLights } from './magicmissile.js';
import { initSacredFlameLight } from './sacredflame.js';
import { initGraveCurseLight } from './morvathEffects.js';
import { prewarmArrowShaders } from './arrow.js';
import { initAudio, initMixerPanel } from './audio.js';
import { initUiScale } from './uiScale.js';
import { initResetGame } from './resetGame.js';
import { initRespawn, tickRespawn } from './respawn.js';
import { initDagna, tickDagna } from './dagnaEvent.js';
import { initAmbush, tickAmbush } from './ambushEvent.js';
import { tickLoot } from './loot.js';
import { initLootPanel } from './lootPanel.js';
import { initShortRest } from './shortRest.js';
import { initHealingWordOOC } from './healingWordOOC.js';
import { initSecondWindOOC } from './secondWindOOC.js';
import { initPickLocksOOC } from './pickLocksOOC.js';
import { initOwlScoutOOC } from './owlScoutOOC.js';
import { tickHideScout } from './hideOOC.js';
import { updateFamiliar } from './familiar.js';
import { tickBleakmireWoods } from './bleakmireWoodsEvent.js';
import './mausoleumEvent.js';
import { tickWarrens } from './warrensEvent.js';
import { tickFollowers } from './follower.js';
import { tickPhandalin } from './phandalinEvent.js';
import { initXPTable } from './xpTable.js';
import { IS_DEV } from './devConfig.js';
import { initSpellSlots } from './spells.js';
import { updateXPBar, showLevelUpFloat } from './progression.js';
import { showLevelUpModal } from './levelUpModal.js';
import { playSound } from './audio.js';
import { initGroupMove } from './groupMove.js';
import { initStealthToggle } from './stealthToggle.js';
import { initFogEditor } from './fogEditor.js';
import { initQuests } from './quests.js';
import { initDevLevelTool } from './devLevelTool.js';

if (IS_DEV) document.body.classList.add('dev-mode');

buildHeroPortraits();
prewarmEffectShaders();
initFireboltLight();
initHealingWordLight();
initMagicMissileLights();
initSacredFlameLight();
initGraveCurseLight();
prewarmArrowShaders();
initAudio();
initMixerPanel();
initUiScale();
initResetGame();
initRespawn();   // load world clock + kill timers before the first zone spawns enemies
initEngagementLines();
initBestiary();
initXPTable();
initSpellbook();
initDevLevelTool();

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

// Cave ceiling toggle (K) — hide the roof so the top-down follow-cam isn't
// occluded while playing a tunnel zone; press again to inspect the ceiling.
document.addEventListener('keydown', e => {
  if ((e.key === 'k' || e.key === 'K') && !e.repeat) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    ceiling.visible = !ceiling.visible;
  }
});

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

// Keybinds overlay
{
  const kbBtn     = document.getElementById('keybinds-btn');
  const kbOverlay = document.getElementById('keybinds-overlay');
  const kbClose   = document.getElementById('keybinds-close');
  if (kbBtn && kbOverlay) {
    kbBtn.addEventListener('click', () => kbOverlay.classList.toggle('show'));
    kbClose.addEventListener('click', () => kbOverlay.classList.remove('show'));
    kbOverlay.addEventListener('click', e => { if (e.target === kbOverlay) kbOverlay.classList.remove('show'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') kbOverlay.classList.remove('show'); });
  }
}
initHotbar();
initZoneUI();
initDagna({ removeUnits, loadZone, setPrecombatFrozen, endCombat: forceCombatExitWithLoot, getActiveZone });
initAmbush({ getActiveZoneId: () => getActiveZone()?.id });
initLootPanel();
initShortRest();
initHealingWordOOC();
initSecondWindOOC();
initPickLocksOOC();
initOwlScoutOOC();
initGroupMove();
initStealthToggle();
initQuests();
initWorldMap();

initDevMode();
initCutsceneUI();

// Must run for ALL players, not just dev: initTerrainPaint() patches the ground
// material's shader so painted roads/dirt/tint render in production. The painting
// TOOL is dev-gated internally (terrainPaint.js `if (!IS_DEV) return`). Leaving
// this inside the IS_DEV block below made painted roads invisible in the prod build.
initTerrainPaint();

if (IS_DEV) {
  initPropEditor();
  initNpcEditor();
  initNpcAIEditor();
  initSpawnEditor();
  initTerrainEditor();
  initBarrierEditor();
  initReferenceOverlay();
  initTrenchEditor();
  initCaveEntranceEditor();
  initFogEditor();

  // Cave-roof checkbox (terrain editor) — toggles zone.cave live + persists it.
  {
    const caveCheck  = document.getElementById('te-cave-check');
    const caveStatus = document.getElementById('te-cave-status');
    if (caveCheck) {
      window.addEventListener('zone:loaded', () => {
        caveCheck.checked = !!getActiveZone()?.cave;
        if (caveStatus) caveStatus.textContent = '';
      });
      caveCheck.addEventListener('change', async () => {
        const on = caveCheck.checked;
        applyCaveRoof(on);
        const zone = getActiveZone();
        if (!zone) return;
        if (caveStatus) caveStatus.textContent = 'Saving…';
        try {
          const res = await fetch('/__save_zone_cave', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zoneId: zone.id, cave: on }),
          });
          const j = await res.json();
          if (caveStatus) caveStatus.textContent = j.ok
            ? (on ? 'Cave roof ON ✓' : 'Cave roof OFF ✓')
            : `Error: ${j.error}`;
        } catch (e) {
          if (caveStatus) caveStatus.textContent = 'Save failed: ' + e.message;
        }
      });
    }
  }

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
      // Same downed-hero rule as progression.js: maxHp always rises, but current hp must NOT
      // be raised on a corpse — that desyncs hp from corpse state and makes the short rest's
      // revive skip them. This is the dev level tool, so it's the likelier of the two to be
      // pointed at a dead party.
      if (hpGain > 0) { hero.maxHp += hpGain; if (hero.hp > 0) hero.hp += hpGain; }
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

  // Force-equip an item onto a hero by type ('elf'/'dwarf'/'human'/'halfling')
  // and item id (see items.js). Refreshes the character sheet immediately if
  // that hero's sheet is already open, since it otherwise only rebuilds on open.
  window.devEquipItem = (heroType, itemId, rarity) => {
    const hero = units.find(u => u.team === 'blue' && u.type === heroType);
    if (!hero) { console.warn(`[DEV] No hero of type "${heroType}" found`); return; }
    const item = getItem(itemId);
    if (!item) { console.warn(`[DEV] No item "${itemId}" found`); return; }
    // Roll the base to a chosen rarity so its AFFIXES actually land — getItem alone returns the
    // plain affix-less base, so an on-hit rider (or any affix) would be absent and test nothing.
    if (rarity) { item.rarity = rarity; item.affixes = rollAffixes(item, rarity); }
    // Dev tool: whatever this displaces is DISCARDED rather than re-homed to a bag. Fine
    // here (you asked for the item, and you can dev-equip the old one back), but say what
    // went so it isn't a silent loss while you're testing.
    const displaced = equipItem(hero, item);
    if (displaced === null) {
      console.warn(`[DEV] ${UNIT_TYPES[heroType]?.name ?? heroType} can't equip ${item.name} — ` +
        `${item.material} needs ${MATERIAL_PROF[item.material]} armor proficiency.`);
      return;
    }
    if (sheetUnit === hero) showSheet(hero);
    console.log(`[DEV] Equipped ${item.name} on ${UNIT_TYPES[heroType]?.name ?? heroType}` +
      (displaced.length ? ` — discarded ${displaced.map(d => d.name).join(', ')}` : ''), hero.equipment);
  };

  // Kit all four heroes with one elemental on-hit rider amulet each, to test the neck riders.
  // Fire→Gobo (human), Ice→Milo (halfling), Poison→Rasec (elf), Disease→Leugren (dwarf).
  window.devEquipRiders = (rarity = 'green') => {
    [['human',    'emberheart_pendant'],
     ['halfling', 'rimefrost_locket'],
     ['elf',      'viperfang_amulet'],
     ['dwarf',    'plaguewrought_charm']].forEach(([type, id]) => window.devEquipItem(type, id, rarity));
    console.log(`[DEV] Equipped all four rider amulets (${rarity}). Land a hit to see them fire.`);
  };

  // Flag every enemy as an ambusher so the NEXT fight tests the enemy-surprise path (no statblock
  // has `ambush` yet). Party sneak (hero surprise) is the K key, out of combat.
  window.devAmbush = () => {
    units.forEach(u => { if (u.team === 'red') u.ambush = true; });
    console.log('[DEV] All enemies set to ambush — start a fight to get surprised.');
  };

  // Give a hero test boots with a GUARANTEED +ft movement affix at a chosen rarity/colour. Bypasses
  // proficiency (direct-equip) since it's a test. Select the hero and start a turn to see the
  // extended move range; check the sheet's SPD too.
  window.devMoveBoots = (heroType, ft = 5, rarity = 'green') => {
    const hero = units.find(u => u.team === 'blue' && u.type === heroType);
    if (!hero) { console.warn(`[DEV] no hero "${heroType}"`); return; }
    if (!hero.equipment) hero.equipment = {};
    // Clone a REAL feet base (complete icon/material fields) so no renderer trips on a missing field.
    const feetBase = getItem('sandals1') ?? { slot: 'feet' };
    const sq = Math.max(1, Math.round(ft / 5));   // move_speed is in SQUARES now; convert the ft arg
    hero.equipment.feet = {
      ...feetBase, name: `Test Boots (+${sq * 5}ft)`, rarity,
      affixes: [{ key: 'move_speed', value: sq, label: 'Movement', display: `+${sq * 5} ft movement` }],
    };
    ft = sq * 5;
    const base = UNIT_TYPES[heroType]?.speed ?? 30;
    console.log(`[DEV] ${UNIT_TYPES[heroType]?.name ?? heroType}: ${rarity} boots +${ft}ft → speed ${base} → ${base + ft}`);
  };

  // Give a hero test gloves with GUARANTEED attack_speed / cast_speed / life_steal affixes to test the
  // Gloves action economy. Examples (start the hero's turn, then take TWO actions):
  //   devGloves('elf',      { cast: 1 })     → Rasec: Fire Bolt THEN Magic Missile (two spells)
  //   devGloves('dwarf',    { cast: 1 })     → Leugren: Bless THEN Heal
  //   devGloves('human',    { attack: 1 })   → Gobo: attack twice (same or different target)
  //   devGloves('halfling', { steal: 25 })   → Milo: heals 25% of each hit's damage
  window.devGloves = (heroType, { attack = 0, cast = 0, steal = 0, rarity = 'purple' } = {}) => {
    const hero = units.find(u => u.team === 'blue' && u.type === heroType);
    if (!hero) { console.warn(`[DEV] no hero "${heroType}"`); return; }
    if (!hero.equipment) hero.equipment = {};
    const base = getItem('clothgloves1') ?? { slot: 'hands' };
    const affixes = [];
    if (attack) affixes.push({ key: 'attack_speed',   value: attack, label: 'Attack speed', display: `+${attack} extra attack${attack > 1 ? 's' : ''}/turn` });
    if (cast)   affixes.push({ key: 'cast_speed',     value: cast,   label: 'Cast speed',   display: `+${cast} extra spell${cast > 1 ? 's' : ''}/turn` });
    if (steal)  affixes.push({ key: 'life_steal_pct', value: steal,  label: 'Life steal',   display: `+${steal}% life steal` });
    hero.equipment.hands = { ...base, name: 'Test Gloves', rarity, affixes };
    if (sheetUnit === hero) showSheet(hero);
    console.log(`[DEV] ${UNIT_TYPES[heroType]?.name ?? heroType}: gloves atk+${attack} cast+${cast} steal+${steal}% — start their turn and act twice.`);
  };
}

bindPermanentHotkey('Backquote','NEXT<br>HERO', cycleHero,      null);
bindPermanentHotkey('Tab',      'NEXT<br>TARGET',   () => {},       null);

// ── F / G — camera flip and top-view toggle (no hotbar buttons; keyboard-only) ──
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'KeyF') flipCamera();
  if (e.code === 'KeyG') toggleTopView();
});

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
let _shadowFrame = 0;   // drives the every-other-frame shadow-map refresh


(function tick(now = 0) {
  _rafId = requestAnimationFrame(tick);
  const dt = _prevNow > 0 ? Math.min((now - _prevNow) / 1000, 0.1) : 0.016;
  _prevNow = now;
  t += ANIM.timeStep;

  // TEMP frame profiler (window.__frameProfile = true to enable; optional
  // window.__frameProfileThreshold ms, default 40). Logs a per-section breakdown on any
  // frame slower than the threshold so we can see WHAT is eating the rAF budget. Remove
  // once the stutter source is found.
  const _fp = window.__frameProfile;   // TEMP diag: set window.__frameProfile=true to enable
  const _fp0 = _fp ? performance.now() : 0;
  const _losBefore = _fp ? (window.__losCount || 0) : 0;
  const _u0 = _fp ? performance.now() : 0;

  units.forEach((u, i) => {
    // Dormant enemies are stationary and invisible — don't burn per-frame terrain samples on
    // them. They get re-grounded the frame they wake (the dormant flag clears).
    if (u.dormant) return;

    const px = u.grp.position.x, pz = u.grp.position.z;
    // resolveCaveLayer + getGroundHeight depend ONLY on XZ, and both are heavy in a cave zone
    // (FBM noise + control-point/trench sampling). Recompute only when the unit has actually
    // moved — so an idle camp of awake enemies between turns costs a couple of adds each frame
    // instead of ~3 noise-sampled height lookups per unit.
    if (u._grndX !== px || u._grndZ !== pz) {
      if (!u.familiar) {
        u.caveLayer = resolveCaveLayer(u.caveLayer ?? 'surface', px, pz);
      } else if (u.owner) {
        // Familiars fly and are held out of resolveCaveLayer (its ground-based transition
        // hysteresis isn't meant for a flyer). But excluding it left the owl on a STALE layer:
        // following heroes into a tunnel it kept 'surface' and sampled the cave blanket, so it
        // climbed up over the party instead of flying down the tunnel with them. Mirror the
        // owner's layer so it samples whichever surface the party is actually on.
        u.caveLayer = u.owner.caveLayer ?? 'surface';
      }
      u._grndY = getGroundHeight(px, pz, u.caveLayer);
      u._grndX = px; u._grndZ = pz;
    }
    const terrainY   = u._grndY;
    const baseHoverY = u.hoverY ?? 0;

    // Hovering units descend diagonally as they close to melee range.
    // Lerp effective hover from full height (12+ WU away) down to 0 (≤5 WU away).
    // Familiars (the owl) are exempt — they hold a constant height above terrain,
    // adapting to slope but never diving toward enemies.
    let effectiveHoverY = baseHoverY;
    if (baseHoverY > 0 && !u.familiar) {
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

  const _tUnits = _fp ? performance.now() - _u0 : 0;

  // Fade the cave roof open around any hero who has gone under it.
  const _cr0 = _fp ? performance.now() : 0;
  tickCaveReveal(units, camera);
  const _tCaveReveal = _fp ? performance.now() - _cr0 : 0;

  // Familiar rides its owner's shoulder — override its position after the
  // generic per-unit placement above so it snaps to the live bone this frame.
  updateFamiliar(dt);

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

  if (meleeRangeRing.visible || rangedRangeRing.visible || longRangeRing.visible || spellRangeRing.visible) {
    const rp = ANIM.rangeRingBase + Math.sin(t * ANIM.rangeRingFreq) * ANIM.rangeRingAmp;
    if (meleeRangeRing.visible)  meleeRangeRing.material.opacity  = rp;
    if (rangedRangeRing.visible) rangedRangeRing.material.opacity = rp;
    // Held below the others on purpose: the long band is a warning, not the primary read.
    if (longRangeRing.visible)   longRangeRing.material.opacity   = rp * 0.7;
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
  trackFearUI();
  updateHeroUI();
  updateSelectionHighlight(t);
  updateCameraFocus();
  if (IS_DEV) tickDevCamera(dt);
  controls.update();
  const _el0 = _fp ? performance.now() : 0;
  updateEngagementLines(units);
  const _tEngage = _fp ? performance.now() - _el0 : 0;
  const _ev0 = _fp ? performance.now() : 0;
  updateEnvironmentVisibility();
  const _tEnvVis = _fp ? performance.now() - _ev0 : 0;
  updateParticles();
  updateWind(t);
  updateHUD();
  updateFamiliarHelpMarker();
  updateReadyIcons();
  trackSurpriseUI();   // closed-eye marker over surprised units, same anchoring as the ⚡ icon
  const _mx0 = _fp ? performance.now() : 0;
  updateMixers(dt);
  const _tMixers = _fp ? performance.now() - _mx0 : 0;
  tickZone(dt);
  tickRespawn(dt);
  tickPrecombat(dt);
  tickHoldMove();
  tickExclamations(dt);
  tickDagna(dt);
  tickAmbush(dt);
  tickLoot(dt);
  tickBleakmireWoods(dt);
  tickWarrens(dt);
  tickFollowers(dt);   // after the zone events, so a companion registered this frame walks this frame
  tickPhandalin(dt);
  tickActivationRadius(getPlacedProps());
  tickHideScout();
  tickAdaptiveResolution(dt);
  // Refresh the shadow map every other frame (autoUpdate is off — see scene.js). Halves the
  // shadow-pass cost; imperceptible for a slow, top-down tactical view.
  renderer.shadowMap.needsUpdate = (_shadowFrame++ & 1) === 0;
  const _r0 = _fp ? performance.now() : 0;
  renderer.render(scene, camera);
  if (_fp) {
    const _tRender = performance.now() - _r0;
    const total = performance.now() - _fp0;
    if (total > (window.__frameProfileThreshold ?? 120)) {
      const known = _tUnits + _tCaveReveal + _tEngage + _tEnvVis + _tMixers + _tRender;
      const r = n => n.toFixed(1);
      console.log(
        `[frame] ${r(total)}ms | render(+shadow)=${r(_tRender)} units=${r(_tUnits)} ` +
        `mixers=${r(_tMixers)} caveReveal=${r(_tCaveReveal)} engage=${r(_tEngage)} ` +
        `envVis=${r(_tEnvVis)} other=${r(total - known)} | units=${units.length} ` +
        `los=${(window.__losCount || 0) - _losBefore} shadow=${renderer.shadowMap.needsUpdate}`
      );
    }
  }
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

// Precompile the scene's shaders BEFORE dropping the loading overlay, so the compile
// stalls land behind it instead of hitching the first minutes of play. Any failure still
// dismisses — a precompile must never be the reason the game won't start.
Promise.all([modelsReady, evergreenReady])
  .then(precompileScene)
  .catch(() => {})
  .then(dismissOverlay);

// Each zone brings its own props, terrain materials and enemies — i.e. its own shader
// programs — so compile those too, as the zone loads rather than on first sight of them.
// Programs three.js has already built are cached, so re-running this is cheap.
window.addEventListener('zone:loaded', () => { precompileScene(); });

setTimeout(dismissOverlay, 8000);  // hard cap — dismiss no matter what after 8 s

// Vite HMR: cancel the running rAF loop before the module is reloaded.
// Without this, each file-save spawns an extra animation loop that never stops.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_rafId !== null) cancelAnimationFrame(_rafId);
  });
}
