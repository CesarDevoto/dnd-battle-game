import * as THREE from 'three';
import { units, heroRoster } from './units.js';
import { camera, renderer, _vec, ground } from './scene.js';
import { UNIT_TYPES, HERO_RING_COLORS, rageUsesForLevel, rageMitigationForLevel, precisionHitBonusForLevel,
         rageDamageForLevel, weaponMasteryForLevel, sneakAttackDiceForLevel,
         dndLevelFor, proficiencyBonusFor, DND_MAX_LEVEL } from './constants.js';
import { turnOrder, turnIndex, combatPhase, assignHotbarSlot, executeAbility, selectedTarget, getAbilityActionType, isAbilityAvailableNow,
         canUseHealingPotion, useHealingPotion, addLog } from './combat.js';
import { getPCSelected } from './precombat.js';
import { SPELLS, ELF_SPELLS, STARTING_SPELLS, isAbilityUnlocked,
         totalSpellSlots, totalSpellSlotsMax, maxSlotsForLevel, slotsForDndLevel } from './spells.js';
import { getAvailableAbilities, sbIconHTML, ABILITY_META } from './abilityRegistry.js';
import { computeAC, equipItem, unequipItem, placeInFirstEmptyBagSlot, equipBlockReason } from './equipment.js';
import { getXpProgress, MAX_HERO_LEVEL } from './progression.js';
import { itemTooltipHTML } from './itemTooltip.js';

// ── Occlusion raycaster — allocated once, reused every frame ─────────────────
// _rayDir is normalised in-place so there are zero heap allocations per unit.
//
// NOTE: this used to set `_occluder.firstHitOnly = true` with a comment claiming it
// early-exits at the nearest hit. It does NOT. `firstHitOnly` is a three-mesh-bvh
// property, and three-mesh-bvh is not a dependency of this project — the flag was an
// inert field on a plain Raycaster, so every call brute-forced all 32,768 triangles of
// the terrain PlaneGeometry(128x128). Per unit. Per frame. That is millions of
// ray/triangle tests a second on the main thread.
//
// Rather than take on a new dependency, the test is now STRIDED: each unit re-tests its
// occlusion every OCCLUSION_STRIDE frames and reuses the previous answer in between. An
// HP bar appearing from behind a hill 4 frames late is imperceptible.
const _occluder = new THREE.Raycaster();
const _rayDir   = new THREE.Vector3();
const OCCLUSION_STRIDE = 4;
let _occFrame = 0;

// ── HUD: project each unit's 3D anchor to screen coords ──────────────────────
// Health bar visibility defaults:
//   • Heroes (blue)  → always shown.
//   • Enemies        → shown only while aggroed and part of the active
//     encounter (turnOrder), so a distant/non-aggroed enemy stays hidden.
//   • barForced = true    → unit is selected or currently taking its combat turn (extra force-show)
//   • now < barShowUntil  → unit was damaged recently (3-second flash)
// Occlusion (terrain ray) is only tested for bars that would otherwise be shown.

export function updateHUD() {
  const W   = renderer.domElement.clientWidth;
  const H   = renderer.domElement.clientHeight;
  const now = Date.now();

  // controls.update() (called just before this in the main loop) moves the
  // camera but doesn't refresh its world matrix — that only happens inside
  // renderer.render() at the end of the frame. Project against a stale matrix
  // and the floating HP bars lag the camera by a frame (visible as them drifting
  // during a swivel, then snapping when it stops). Refresh it here first.
  camera.updateMatrixWorld();

  units.forEach((u, i) => {
    if (!u.barEl) return;  // NPCs have no hp bar

    // Decide visibility FIRST. In a populated zone most enemies aren't showing a bar (not
    // engaged, or dormant/faded), so projecting them and writing display/left/top/fill every
    // frame is pure wasted DOM work (each style write can force a reflow). Hide with
    // display:none — removed from layout, no paint — and skip the rest for them.
    const engagedEnemy = combatPhase && turnOrder.includes(u) && u.aggro;
    const shouldShow    = u.team === 'blue' || u.familiar || engagedEnemy || u.barForced || now < u.barShowUntil;
    if (!shouldShow) {
      if (u.barEl.style.display !== 'none') u.barEl.style.display = 'none';
      return;
    }

    _vec.copy(u.anchor).project(camera);

    // Behind the near plane — hide instantly, no CSS transition needed.
    if (_vec.z > 1) {
      u.barEl.style.display = 'none';
      return;
    }

    const sx = ( _vec.x * 0.5 + 0.5) * W;
    const sy = (-_vec.y * 0.5 + 0.5) * H;

    u.barEl.style.display = 'block';
    u.barEl.style.left    = sx + 'px';
    u.barEl.style.top     = (sy - 4) + 'px';
    u.fill.style.width    = Math.max(0, (u.hp / u.maxHp) * 100) + '%';
    // Milo hiding (in-combat stealth or out-of-combat scouting) → black→grey bar
    u.fill.classList.toggle('hp-hidden', u.team === 'blue' && (!!u.stealthed || !!u.stealthedOOC || !!u.sneaking));

    // Terrain occlusion test — only run when bar is eligible to show, and only every
    // OCCLUSION_STRIDE frames (see the raycaster comment above: this is an unaccelerated
    // sweep of the whole terrain mesh, so it is by far the most expensive thing per unit).
    // Units are staggered by index so they don't all re-test on the same frame.
    if ((_occFrame + i) % OCCLUSION_STRIDE === 0) {
      // Stop the ray 1.5 WU short of the anchor so the terrain directly under
      // the unit's feet never self-occludes it.
      _rayDir.copy(u.anchor).sub(camera.position);
      const dist = _rayDir.length();
      _rayDir.divideScalar(dist);

      _occluder.set(camera.position, _rayDir);
      _occluder.far = Math.max(0.5, dist - 1.5);

      u._occluded = _occluder.intersectObject(ground, false).length > 0;
    }
    u.barEl.style.opacity = u._occluded ? '0' : '1';
  });
  _occFrame++;
  updateSpellBar();
}

// ── Stat sheet ────────────────────────────────────────────────────────────────

const sheetWrap         = document.getElementById('stat-sheet-wrap');
const sheetEl           = document.getElementById('stat-sheet');
const sheetBody         = document.getElementById('ss-body');
const sidePanelEl       = document.getElementById('ss-side-panel');
const sideContentEl     = document.getElementById('ss-side-content');
const spellListPanelEl  = document.getElementById('ss-spell-list-panel');
const spellListContentEl = document.getElementById('ss-spell-list-content');
const eqPanelEl         = document.getElementById('eq-panel');
const eqContentEl       = document.getElementById('eq-content');
const eqBagPanelEl      = document.getElementById('eq-bag-panel');
const eqBagContentEl    = document.getElementById('eq-bag-content');

let _activeSideBtn      = null;
let _spellPanelHTML     = '';
let _actionsPanelHTML   = '';
let _traitsPanelHTML    = '';
let _equipmentPanelHTML = '';
let _xpPanelHTML        = '';

// btnId doubles as the panel's identity in _activeSideBtn. 'ss-btn-equipment' is a
// VIRTUAL id — the equipment panel's opener lives on the hero avatar cards now (see
// showInventory), not in .ss-side-btns, so no element by that id exists. The key is
// kept because equipment still has to take part in side-panel mutual exclusion and
// in the hero:levelup refresh below.
function _toggleSidePanel(btnId) {
  const isEq   = btnId === 'ss-btn-equipment';
  const isSame = _activeSideBtn === btnId &&
    (isEq ? eqPanelEl?.classList.contains('show') : sidePanelEl.classList.contains('show'));
  sidePanelEl.classList.remove('show');
  sidePanelEl.classList.remove('ss-side-wide');   // only the XP table re-adds it
  spellListPanelEl.classList.remove('show');
  eqPanelEl?.classList.remove('show');
  eqBagPanelEl?.classList.remove('show');
  document.getElementById('ss-btn-abilities')?.classList.remove('active');
  document.getElementById('ss-btn-spellbook')?.classList.remove('active');
  document.getElementById('ss-btn-traits')?.classList.remove('active');
  document.getElementById('ss-btn-xp')?.classList.remove('active');
  _activeSideBtn = null;
  if (!isSame) {
    if (isEq) {
      eqContentEl.innerHTML = _equipmentPanelHTML;
      _initEquipmentPanel();
      eqPanelEl?.classList.add('show');
    } else if (btnId === 'ss-btn-spellbook') {
      sideContentEl.innerHTML = _spellPanelHTML;
      _initSpellAccordions();
      sidePanelEl.classList.add('show');
    } else if (btnId === 'ss-btn-traits') {
      sideContentEl.innerHTML = _traitsPanelHTML;
      sidePanelEl.classList.add('show');
    } else if (btnId === 'ss-btn-xp') {
      sideContentEl.innerHTML = _xpPanelHTML;
      sidePanelEl.classList.add('ss-side-wide');
      sidePanelEl.classList.add('show');
    } else {
      sideContentEl.innerHTML = _actionsPanelHTML;
      _initActionAccordions();
      sidePanelEl.classList.add('show');
    }
    document.getElementById(btnId)?.classList.add('active');
    _activeSideBtn = btnId;
  }
}

document.getElementById('ss-btn-abilities')?.addEventListener('click',  () => _toggleSidePanel('ss-btn-abilities'));
document.getElementById('ss-btn-spellbook')?.addEventListener('click',  () => _toggleSidePanel('ss-btn-spellbook'));
document.getElementById('ss-btn-traits')?.addEventListener('click',     () => _toggleSidePanel('ss-btn-traits'));
document.getElementById('ss-btn-xp')?.addEventListener('click',        () => _toggleSidePanel('ss-btn-xp'));

// Open a hero's inventory in ONE click, from anywhere: the sheet plus the equipment
// panel together. showSheet() nulls _activeSideBtn, so the _toggleSidePanel that
// follows can never resolve to "same panel — close it"; this always opens, never
// toggles shut. Shared by the avatar cards' bag button and the I key.
export function showInventory(u) {
  showSheet(u);
  _toggleSidePanel('ss-btn-equipment');
}

// If a hero levels up (commonly mid-combat) while their own character sheet is
// open, the sheet's panels are cached strings built at open time and would show
// stale spells/slots/HP until closed+reopened. Rebuild them in place, and
// re-inject whichever side panel is currently showing.
window.addEventListener('hero:levelup', ({ detail: { hero } }) => {
  if (!sheetUnit || sheetUnit !== hero) return;
  sheetBody.innerHTML = buildSheetHTML(hero);
  _spellPanelHTML     = buildSpellPanelHTML(hero);
  _actionsPanelHTML   = buildActionsPanelHTML(hero);
  _traitsPanelHTML    = buildTraitsPanelHTML(hero);
  _equipmentPanelHTML = buildEquipmentPanelHTML(hero);
  _xpPanelHTML        = buildXpPanelHTML(hero);   // the "you are here" row moved
  if      (_activeSideBtn === 'ss-btn-spellbook') { sideContentEl.innerHTML = _spellPanelHTML;   _initSpellAccordions(); }
  else if (_activeSideBtn === 'ss-btn-abilities') { sideContentEl.innerHTML = _actionsPanelHTML; _initActionAccordions(); }
  else if (_activeSideBtn === 'ss-btn-traits')    { sideContentEl.innerHTML = _traitsPanelHTML; }
  else if (_activeSideBtn === 'ss-btn-xp')        { sideContentEl.innerHTML = _xpPanelHTML; }
  else if (_activeSideBtn === 'ss-btn-equipment') { eqContentEl.innerHTML   = _equipmentPanelHTML; _initEquipmentPanel(); }
});

// I — open the equipment/inventory panel for the active hero during combat,
// or the targeted/selected hero out of combat. Same hero-resolution rule
// updateSpellBar() below already uses for the Skills & Spells window.
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code !== 'KeyI') return;
  const pcHero = (selectedTarget?.team === 'blue' && selectedTarget.hp > 0) ? selectedTarget : getPCSelected();
  const u = combatPhase ? turnOrder[turnIndex] : pcHero;
  if (!u || u.team !== 'blue' || u.hp <= 0) return;
  showInventory(u);
});

export let sheetUnit = null;

function abMod(score) {
  const m = Math.floor((score - 10) / 2);
  return (m >= 0 ? '+' : '') + m;
}

function atkDmgStr(atk, abilities) {
  const statMod = Math.floor((abilities[atk.statMod] - 10) / 2);
  const mod = atk.dmgBonus !== undefined ? atk.dmgBonus : statMod;
  if (mod > 0) return `${atk.dice}d${atk.sides}+${mod}`;
  if (mod < 0) return `${atk.dice}d${atk.sides}${mod}`;
  return `${atk.dice}d${atk.sides}`;
}

function atkToHitStr(atk, abilities, profBonus) {
  const statMod = Math.floor((abilities[atk.statMod] - 10) / 2);
  const total   = statMod + (profBonus ?? 0);
  return total >= 0 ? `+${total}` : `${total}`;
}

function atkRangeStr(atk) {
  if (atk.type === 'melee' && !atk.longRange) return '5 ft';
  if (atk.longRange) return `${atk.range}/${atk.longRange} ft`;
  return `${atk.range} ft`;
}

let _spellSections   = {};
let _actionsSections = {};

function buildSpellPanelHTML(u) {
  if (u.type !== 'dwarf' && u.type !== 'elf') return '';
  _spellSections = {};

  // Pre-combat the per-level arrays don't exist yet (initSpellSlots runs at battle start),
  // so the MAX falls back to the table for this hero's level — otherwise the sheet would
  // render zero pips instead of the empty ones it used to show. Remaining stays 0 → all
  // circles empty, matching the Skills & Spells window.
  const spellSlots    = totalSpellSlots(u);
  const spellSlotsMax = (u.spellSlotsMaxByLevel ?? maxSlotsForLevel(u.type, u.level ?? 1))
    .reduce((a, b) => a + (b ?? 0), 0);
  const slotPips = Array.from({ length: spellSlotsMax }, (_, i) =>
    `<span class="ss-slot-pip${i < spellSlots ? ' filled' : ''}"></span>`
  ).join('');

  const prepared  = u.preparedSpells ?? STARTING_SPELLS[u.type] ?? new Set();
  const fullPool  = u.type === 'dwarf' ? Object.values(SPELLS) : Object.values(ELF_SPELLS);
  const spellPool = fullPool.filter(sp => prepared.has(sp.key));

  const renderSpell = sp => {
    const isCantrip  = (sp.level ?? 1) === 0;
    const isPrepared = prepared.has(sp.key);
    const toggleHTML = isCantrip ? '' :
      `<button class="ss-prep-toggle${isPrepared ? ' prepared' : ''}" data-spell="${sp.key}"></button>`;
    return `
      <div class="ss-spell-row">
        <div class="ss-spell">
          <div class="ss-spell-inner">
            <div class="ss-spell-text">
              <div class="ss-spell-top">
                <span class="ss-spell-name">${sp.name}</span>
                <span class="ss-spell-type ${sp.actionType}">${sp.actionType === 'bonus' ? 'BONUS ACT' : 'ACTION'}</span>
              </div>
              <div class="ss-spell-desc">${sp.desc}</div>
            </div>
            ${sp.imgSrc ? `<img src="${sp.imgSrc}" class="ss-spell-inline-img" alt="${sp.name}">` : ''}
          </div>
        </div>
        ${toggleHTML}
      </div>`;
  };

  const makeList = (spells, isCantrips = false) => `
    <div class="ss-spells">
      ${isCantrips ? '' : '<div class="ss-spell-col-labels"><span class="ss-prep-col-hdr">PREPARED</span></div>'}
      ${spells.map(renderSpell).join('')}
    </div>`;

  const row = (key, headerHTML, listTitle, listHTML, rightExtra = '') => {
    _spellSections[key] = `<div class="ss-slist-title">${listTitle}</div>${listHTML}`;
    return `
      <div class="ss-accordion">
        <div class="ss-acc-hdr" data-key="${key}">
          ${headerHTML}
          <span class="ss-acc-right">${rightExtra}<span class="ss-acc-arrow">▶</span></span>
        </div>
      </div>`;
  };

  // Cantrips are always known once unlocked — they never need preparing, so
  // list them straight from the full pool by unlock level (not preparedSpells).
  const cantrips = fullPool.filter(sp => (sp.level ?? 1) === 0 && isAbilityUnlocked(u.type, u.level, sp.key));

  const levelRows = [1, 2, 3, 4, 5].map(lvl => {
    const spells    = spellPool.filter(sp => (sp.level ?? 1) === lvl);
    const prepCount = spells.filter(sp => prepared.has(sp.key)).length;
    const content   = spells.length
      ? makeList(spells)
      : `<div class="ss-spell-empty">— none available —</div>`;
    const hdr  = `<span class="ss-acc-left"><span class="ss-acc-level">Level ${lvl}</span><span class="ss-acc-count">${prepCount}</span></span>`;
    const pips = lvl === 1 ? `<span class="ss-slot-pips">${slotPips}</span>` : '';
    return row(`level${lvl}`, hdr, `LEVEL ${lvl}`, content, pips);
  }).join('');

  const totalPrepared = spellPool.filter(sp => prepared.has(sp.key) && (sp.level ?? 1) > 0).length;

  // Cantrips are spells too, so they live under the SPELLS title as the first
  // accordion row — styled like the level rows — followed by Level 1, 2, …
  const cantripsHdr = `<span class="ss-acc-left"><span class="ss-acc-level">Cantrips</span><span class="ss-acc-count">${cantrips.length}</span></span>`;
  const cantripsRow = row('cantrips', cantripsHdr, 'CANTRIPS',
    cantrips.length ? makeList(cantrips, true) : `<div class="ss-spell-empty">— none —</div>`);

  return `
    <div class="ss-spells-hdr">
      <span class="ss-spell-title">SPELLS</span>
    </div>
    <div class="ss-prep-max">
      <span class="ss-prep-label">PREPARED MAX</span>
      <span class="ss-prep-val">${totalPrepared}</span>
    </div>
    ${cantripsRow}
    ${levelRows}`;
}

function _initSpellAccordions() {
  let _activeKey = null;

  spellListContentEl.addEventListener('click', e => {
    const btn = e.target.closest('.ss-prep-toggle');
    if (!btn || !sheetUnit?.preparedSpells) return;
    const spellKey = btn.dataset.spell;
    if (sheetUnit.preparedSpells.has(spellKey)) {
      sheetUnit.preparedSpells.delete(spellKey);
      btn.classList.remove('prepared');
    } else {
      sheetUnit.preparedSpells.add(spellKey);
      btn.classList.add('prepared');
    }
    if (_activeKey) {
      const hdrEl   = sideContentEl.querySelector(`[data-key="${_activeKey}"]`);
      const countEl = hdrEl?.querySelector('.ss-acc-count');
      if (countEl) {
        const pool   = sheetUnit.type === 'dwarf' ? Object.values(SPELLS) : Object.values(ELF_SPELLS);
        const lvlNum = _activeKey.startsWith('level') ? parseInt(_activeKey.replace('level', '')) : 0;
        countEl.textContent = pool.filter(sp => sheetUnit.preparedSpells.has(sp.key) && (sp.level ?? 1) === lvlNum).length;
      }
    }
  });

  sideContentEl.querySelectorAll('.ss-acc-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const key      = hdr.dataset.key;
      const arrow    = hdr.querySelector('.ss-acc-arrow');
      const isOpen   = spellListPanelEl.classList.contains('show');

      // Deactivate the previously active row's arrow
      if (_activeKey && _activeKey !== key) {
        const prev = sideContentEl.querySelector(`[data-key="${_activeKey}"] .ss-acc-arrow`);
        if (prev) prev.textContent = '▶';
      }

      if (_activeKey === key && isOpen) {
        // Same row clicked again → close
        spellListPanelEl.classList.remove('show');
        arrow.textContent = '▶';
        _activeKey = null;
      } else {
        // Open (or switch to) this section
        spellListContentEl.innerHTML = _spellSections[key] ?? '';
        spellListPanelEl.classList.add('show');
        arrow.textContent = '▼';
        _activeKey = key;
      }
    });
  });
}

// ── XP / level table panel ────────────────────────────────────────────────────
// One row per D&D level (1–20) with the GAME-level band that maps to it, plus the
// columns that hero's class actually gets. The hero's current row is highlighted.
//
// Rows are D&D levels rather than our 1–100 because the tables ARE D&D's — 100 rows
// where every group of five is identical would be noise. The band column is what ties
// them back: "our 10–14 = D&D 3".
function buildXpPanelHTML(u) {
  const curDnd = dndLevelFor(u.level ?? 1);

  // Band for D&D level d, given dndLevelFor(g) = floor(g/5)+1:
  //   floor(g/5) = d-1  →  g in 5(d-1) … 5d-1. D&D 1 starts at 1 (no level 0), and
  //   D&D 20 absorbs everything from 95 up because dndLevelFor clamps there.
  const band = d => {
    const lo = d === 1 ? 1 : 5 * (d - 1);
    const hi = d === DND_MAX_LEVEL ? 100 : 5 * d - 1;
    return `${lo}–${hi}`;
  };

  // Per-class columns. Each entry: [header, cellFn(dndLevel)].
  // Only columns the ENGINE actually implements are listed — showing Channel Divinity
  // or "prepared spells" would be inventing a readout for a system that doesn't exist.
  let cols;
  let note = '';
  if (u.type === 'human') {
    cols = [
      ['Rages',   d => BARB_AT(d, 'rages')],
      ['Rage Dmg', d => `+${BARB_AT(d, 'dmg')}`],
      ['Weapon Mastery', d => BARB_AT(d, 'mastery')],
    ];
    note = 'Weapon Mastery is listed but not yet active — nothing in the code gates weapons by proficiency yet.';
  } else if (u.type === 'halfling') {
    cols = [['Sneak Attack', d => `${SNEAK_AT(d)}d6`]];
  } else if (u.type === 'elf' || u.type === 'dwarf') {
    // Both are full casters and share one slot table — see spells.js.
    // No note about the refill cadence: slots are per-combat in code today, but that's an
    // open design decision (see initSpellSlots), and stating it here would promise the
    // player a rule that may not survive.
    const maxLen = slotsForDndLevel(DND_MAX_LEVEL).length;
    cols = Array.from({ length: maxLen }, (_, i) => [
      `${i + 1}${['st','nd','rd','th','th','th','th','th','th'][i]}`,
      d => slotsForDndLevel(d)[i] ?? '—',
    ]);
  } else {
    cols = [];
  }

  const head = `<tr><th>Our Lv</th><th>D&amp;D</th><th>Prof</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>`;
  const rows = Array.from({ length: DND_MAX_LEVEL }, (_, i) => {
    const d = i + 1;
    const cls = [
      d === curDnd ? 'xp-row-cur' : '',
      // Rows past the XP cap are unreachable today — dim rather than hide, so the ladder
      // still reads as a whole. 5*(d-1) is the first game level in band d.
      5 * (d - 1) > MAX_HERO_LEVEL ? 'xp-row-locked' : '',
    ].filter(Boolean).join(' ');
    return `<tr${cls ? ` class="${cls}"` : ''}>` +
      `<td>${band(d)}</td><td>${d}</td><td>+${PROF_AT(d)}</td>` +
      cols.map(c => `<td>${c[1](d)}</td>`).join('') +
      `</tr>`;
  }).join('');

  // No explainer line about our levels mapping to D&D levels — the "Our Lv" and "D&D"
  // columns say it, and the current band is highlighted.
  return `<div class="xp-panel-title">${UNIT_TYPES[u.type]?.name ?? u.type} — Level Table</div>` +
    `<div class="xp-table-scroll"><table class="xp-table">${head}${rows}</table></div>` +
    (note ? `<div class="xp-panel-note">${note}</div>` : '') +
    `<div class="xp-panel-note">Rows past level ${MAX_HERO_LEVEL} are greyed — the XP table stops there for now.</div>`;
}

// The class accessors take a GAME level, but this table is addressed by D&D level.
// 5*(d-1) always lands inside band d (and clamps to 1 for D&D 1), so it's a safe probe.
const _gameLvlIn = d => Math.max(1, 5 * (d - 1));
const PROF_AT  = d => proficiencyBonusFor(_gameLvlIn(d));
const SNEAK_AT = d => sneakAttackDiceForLevel(_gameLvlIn(d));
const BARB_AT  = (d, what) => {
  const g = _gameLvlIn(d);
  return what === 'rages' ? rageUsesForLevel(g)
       : what === 'dmg'   ? rageDamageForLevel(g)
       :                    weaponMasteryForLevel(g);
};

// Delegates to the shared renderer so an item reads IDENTICALLY here and in the loot
// window's hover tooltip. This used to be its own copy that knew nothing about rarity or
// rolled affixes — so an equipped +5% mitigation hat showed no sign of the roll that made
// it worth keeping, while the loot tooltip that sold it to you did.
function formatItemDetailHTML(item) {
  if (!item) return 'Select an item to view its stats';
  return itemTooltipHTML(item);
}

function buildBagContentsHTML(item, slotKey) {
  if (!item.contents) item.contents = new Array(item.slots).fill(null);
  const boxes = item.contents.map((contentItem, i) => {
    const icon = contentItem?.icon
      ? `<img class="eq-bagslot-icon" src="${contentItem.icon}" alt="${contentItem.name}">`
      : '';
    const qty = contentItem?.qty > 1
      ? `<span class="eq-bagslot-qty">${contentItem.qty}</span>`
      : '';
    // Slot 0 of whatever's equipped in the bag-1 slot is reserved for healing potions.
    const reserved = i === 0 && slotKey === 'bag-1' ? ' eq-bagslot-reserved' : '';
    // Bag contents carry their rarity border too — loot lands in bags, so this is where
    // rarity is most worth seeing. The rarity rules are declared after .eq-bagslot-reserved,
    // so a FILLED potion slot shows the potion's rarity while an EMPTY one keeps the green
    // "reserved" tint — which is exactly when that hint is worth anything.
    const rarityClass = contentItem?.rarity ? ` rarity-${contentItem.rarity}` : '';
    const title = contentItem ? contentItem.name : (reserved ? 'Reserved for healing potions' : `Slot ${i + 1}`);
    return `<div class="eq-bagslot-box${reserved}${rarityClass}" data-bagslot="${i}" title="${title}">${icon}${qty}</div>`;
  }).join('');
  return (
    `<div class="eq-bagslot-title">${item.name} (${item.slots})</div>` +
    `<div class="eq-bagslot-grid">${boxes}</div>`
  );
}

function _initEquipmentPanel() {
  const detailEl = document.getElementById('eq-detail');
  if (!detailEl) return;
  eqContentEl.querySelectorAll('[data-slot]').forEach(el => {
    el.addEventListener('click', () => {
      const item = sheetUnit?.equipment?.[el.dataset.slot] ?? null;
      detailEl.innerHTML = formatItemDetailHTML(item);
      eqContentEl.querySelectorAll('[data-slot].selected').forEach(s => s.classList.remove('selected'));
      el.classList.add('selected');

      if (item?.slots) {
        eqBagContentEl.dataset.bagSlotKey = el.dataset.slot;
        eqBagContentEl.innerHTML = buildBagContentsHTML(item, el.dataset.slot);
        eqBagContentEl.querySelectorAll('[data-bagslot]').forEach(box => {
          box.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const contentItem = item.contents[Number(box.dataset.bagslot)];
            detailEl.innerHTML = formatItemDetailHTML(contentItem);
            eqBagContentEl.querySelectorAll('[data-bagslot].selected').forEach(s => s.classList.remove('selected'));
            box.classList.add('selected');
          });
        });
        eqBagPanelEl?.classList.add('show');
      } else {
        eqBagPanelEl?.classList.remove('show');
      }
    });
  });
}

// Rebuilds the equipment grid after a drag-drop equip/swap and re-opens
// whatever bag slot the dragged item came from, so its (now-updated)
// contents are visible without an extra click.
function _refreshEquipmentPanel(reopenBagKey) {
  if (!sheetUnit) return;
  _equipmentPanelHTML = buildEquipmentPanelHTML(sheetUnit);
  eqContentEl.innerHTML = _equipmentPanelHTML;
  _initEquipmentPanel();
  if (reopenBagKey) eqContentEl.querySelector(`[data-slot="${reopenBagKey}"]`)?.click();
}

// Plain click-drag: pick up an equippable item from an open bag and drop it
// onto an equipment slot to equip it. If that slot already holds an item,
// the two trade places (old item goes back into the bag slot just vacated).
// A movement threshold (not a modifier key) distinguishes a drag from the
// existing plain click that selects the box and shows its details — the
// drag only "arms" once the cursor has actually moved past a few pixels,
// so a real click never accidentally starts one.
(function() {
  let dragEl = null, dragItem = null, dragBagKey = null, dragIdx = null;
  let pending = null; // { box, item, bagKey, idx, startX, startY } — armed on mousedown, promoted to a drag past the threshold
  let justDragged = false;
  const DRAG_THRESHOLD = 6; // px

  // ring-l/ring-r and wrist-l/wrist-r are generic catalog slots — any item
  // whose own .slot is 'ring'/'wrist' fits either box (see equipment.js).
  const GENERIC_SLOT = { 'ring-l': 'ring', 'ring-r': 'ring', 'wrist-l': 'wrist', 'wrist-r': 'wrist' };

  function _moveGhost(x, y) {
    if (dragEl) { dragEl.style.left = x + 'px'; dragEl.style.top = y + 'px'; }
  }

  function _startDrag(x, y) {
    dragItem   = pending.item;
    dragBagKey = pending.bagKey;
    dragIdx    = pending.idx;

    dragEl = document.createElement('div');
    dragEl.className = 'sb-drag-ghost';
    dragEl.innerHTML = pending.box.innerHTML;
    document.body.appendChild(dragEl);
    _moveGhost(x, y);
    justDragged = true;
  }

  function _onDragMove(e) {
    if (!dragEl) {
      const dx = e.clientX - pending.startX, dy = e.clientY - pending.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      _startDrag(e.clientX, e.clientY);
    }
    _moveGhost(e.clientX, e.clientY);
  }

  function _onDragEnd(e) {
    document.removeEventListener('mousemove', _onDragMove);
    if (dragEl) {
      dragEl.style.display = 'none'; // exclude the ghost from the hit-test below
      const slotEl        = document.elementFromPoint(e.clientX, e.clientY)?.closest('.eq-slot');
      const targetSlotKey = slotEl?.dataset.slot;
      const accepts = targetSlotKey &&
        (dragItem.slot === targetSlotKey || GENERIC_SLOT[targetSlotKey] === dragItem.slot);
      if (accepts && sheetUnit) {
        const hero      = sheetUnit;
        const displaced = equipItem(hero, dragItem, targetSlotKey);
        // null = armor proficiency refused it. Bail BEFORE touching the bag: the dragged item
        // is only removed from its slot by the shift() below, so returning early leaves it
        // exactly where it was. Dropping through here would crash on displaced.shift().
        if (displaced === null) {
          addLog(`${UNIT_TYPES[hero.type]?.name ?? hero.type} can't wear the ${dragItem.name} — ` +
                 `${equipBlockReason(hero, dragItem)}.`, 'system');
          dragEl.remove(); dragEl = null; dragItem = null;
          return;
        }
        // displaced[0] is the target slot's old occupant — it goes into the bag slot the
        // dragged item just vacated, which is the straight swap the player is expecting.
        const bag = hero.equipment?.[dragBagKey];
        if (bag?.contents) bag.contents[dragIdx] = displaced.shift() ?? null;
        // Anything still here is a two-handed casualty (drag a greataxe onto the main hand
        // while holding a shield). This used to be DESTROYED — equipItem deleted it and
        // returned nothing, and this path only ever rescued the slot's own occupant.
        for (const d of displaced) {
          if (!placeInFirstEmptyBagSlot(hero, d)) addLog(`No room for the ${d.name} — it was lost.`, 'system');
        }
        _refreshEquipmentPanel(dragBagKey);
      }
      dragEl.remove();
      dragEl = null;
    }
    dragItem   = null;
    dragBagKey = null;
    dragIdx    = null;
    pending    = null;
  }

  eqBagContentEl.addEventListener('mousedown', e => {
    const box = e.target.closest('.eq-bagslot-box');
    const idx = box ? Number(box.dataset.bagslot) : NaN;
    if (!box || Number.isNaN(idx)) return;
    const bagKey = eqBagContentEl.dataset.bagSlotKey;
    const item   = sheetUnit?.equipment?.[bagKey]?.contents?.[idx];
    if (!item || !item.slot) return; // only equippable items (have a target slot) can be dragged
    e.preventDefault(); // stop the browser's native text/element selection drag

    pending = { box, item, bagKey, idx, startX: e.clientX, startY: e.clientY };
    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup', _onDragEnd, { once: true });
  });

  // Swallow the click that follows a completed drag so it doesn't also
  // trigger the box's normal "select item / show details" click handler.
  eqBagContentEl.addEventListener('click', e => {
    if (justDragged) { justDragged = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
})();

// ── Item context menu — right-click an equipped or bagged item ────────────────
// Use / Equip / Trade to <hero> / Delete. Listeners are delegated onto the two panel
// containers (which are static in index.html) rather than the item boxes, because
// both panels are rebuilt via innerHTML on every refresh — per-box handlers would
// die on the first trade.
(function() {
  const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

  let menuEl  = null;
  let _hero   = null;   // whose inventory is open (sheetUnit at open time)
  let _loc    = null;   // { kind:'equipped', slotKey } | { kind:'bag', bagKey, idx }

  // Where an item can be worn, in fill order. An item's own `.slot` is a CATALOG slot, not
  // always an equipment key: 'ring'/'wrist' are interchangeable pairs and 'bag' is one of
  // four, so those expand (see the equipment.js schema note). Everything else is 1:1.
  // NOTE this covers bags, unlike the drag-drop's GENERIC_SLOT map — which has no bag
  // entries, and is why a bag can't be dragged onto a bag slot today.
  const _EQUIP_TARGETS = {
    ring:  ['ring-l', 'ring-r'],
    wrist: ['wrist-l', 'wrist-r'],
    bag:   ['bag-1', 'bag-2', 'bag-3', 'bag-4'],
  };
  const _equipTargets = item => _EQUIP_TARGETS[item?.slot] ?? (item?.slot ? [item.slot] : []);

  // An item's home, resolved live rather than captured — the panel rebuilds under us.
  function _itemAt() {
    if (!_hero || !_loc) return null;
    return _loc.kind === 'equipped'
      ? (_hero.equipment?.[_loc.slotKey] ?? null)
      : (_hero.equipment?.[_loc.bagKey]?.contents?.[_loc.idx] ?? null);
  }
  function _takeFromSource() {
    if (_loc.kind === 'equipped') { unequipItem(_hero, _loc.slotKey); return; }
    const bag = _hero.equipment?.[_loc.bagKey];
    if (bag?.contents) bag.contents[_loc.idx] = null;
  }
  // Re-open the bag we were looking at, so a trade/delete out of an open bag leaves
  // that bag on screen instead of collapsing the view.
  function _refreshAfterChange() {
    _refreshEquipmentPanel(_loc?.kind === 'bag' ? _loc.bagKey : null);
    // If the bag view is showing a container that just stopped existing — deleting or
    // trading away the equipped bag ITSELF, not something inside it — close it, or it
    // keeps rendering the contents of a bag the hero no longer has.
    const shownKey = eqBagContentEl.dataset.bagSlotKey;
    if (shownKey && !_hero?.equipment?.[shownKey]?.slots) eqBagPanelEl?.classList.remove('show');
  }

  function _close() { menuEl?.remove(); menuEl = null; _hero = null; _loc = null; }

  function _row(label, { disabled = false, danger = false, onClick } = {}) {
    const el = document.createElement('button');
    el.className = 'eq-ctx-row' + (danger ? ' eq-ctx-danger' : '');
    el.disabled  = disabled;
    el.innerHTML = label;
    if (!disabled && onClick) el.addEventListener('click', onClick);
    return el;
  }

  // Swaps the menu's contents for an inline "are you sure" instead of a native
  // confirm() — keeps the game's own chrome, and a browser dialog can be suppressed
  // outright by the user's Chrome settings.
  function _renderConfirmDelete(item) {
    const inside = item.contents?.filter(Boolean).length ?? 0;
    menuEl.innerHTML = '';
    menuEl.appendChild(_row(
      `Delete <b>${item.name}</b>?` +
      (inside ? `<br><span class="eq-ctx-warn">${inside} item${inside === 1 ? '' : 's'} inside will go with it.</span>` : ''),
      { disabled: true }
    ));
    menuEl.appendChild(_row('Yes, delete it', { danger: true, onClick: () => {
      const name = item.name;
      _takeFromSource();
      addLog(`${name} was destroyed.`, 'system');
      _refreshAfterChange();
      _close();
    }}));
    menuEl.appendChild(_row('Cancel', { onClick: _close }));
  }

  function _renderMenu(item) {
    menuEl.innerHTML = '';
    menuEl.appendChild(_row(`<span class="eq-ctx-title">${item.name}</span>`, { disabled: true }));

    // Use — only items that actually DO something, which today means anything with a
    // `heal` field (just the Potion of Lesser Healing). Keyed off the data, not an id
    // list, so any future consumable lights up for free. Flasks and the other potions
    // are art-only placeholders and correctly never offer it.
    if (item.heal) {
      const usable = canUseHealingPotion(_hero);
      menuEl.appendChild(_row('Use', {
        disabled: !usable,
        onClick: () => { useHealingPotion(_hero); _refreshAfterChange(); _close(); },
      }));
    }

    // Equip — bag items only (an equipped item is already worn), and only things with a
    // slot to go in. Prefers an EMPTY slot; with none free it swaps into the first one and
    // the displaced item goes back to the bags, so Equip always does something.
    if (_loc.kind === 'bag' && _equipTargets(item).length) {
      const targets = _equipTargets(item);
      const free    = targets.find(k => !_hero.equipment?.[k]);
      const dest    = free ?? targets[0];
      // Armor proficiency: show the row greyed WITH the reason rather than hiding it. Hiding
      // it would read as a bug ("why can't I equip this?"); the reason teaches the rule.
      const blocked = equipBlockReason(_hero, item);
      const label   = blocked ? `Equip <span class="eq-ctx-warn">(${blocked})</span>`
                    : free    ? 'Equip'
                              : `Equip <span class="eq-ctx-warn">(swaps)</span>`;
      menuEl.appendChild(_row(label, {
        disabled: !!blocked,
        onClick: () => {
          // equipItem returns everything it displaced (slot occupant + any two-handed
          // casualty). This used to hand-collect them before the call, because equipItem
          // deleted the casualty outright; it now hands them back, so both this and the
          // drag path get it right from one place.
          const name   = item.name;
          const bumped = equipItem(_hero, item, dest);
          _takeFromSource();   // clear the bag slot it came from — frees a slot for the bumped
          for (const b of bumped) {
            if (!placeInFirstEmptyBagSlot(_hero, b)) addLog(`No room for the ${b.name} — it was lost.`, 'system');
          }
          addLog(`${name} equipped${bumped.length ? ` (${bumped.map(b => b.name).join(', ')} returned to bag)` : ''}.`, 'system');
          _refreshAfterChange();
          _close();
        },
      }));
    }

    // Unequip — equipped items only (a bag item is already off), moving the worn piece into the
    // first open bag slot. Containers are excluded: a bag into a bag slot would nest inside another
    // bag, which the panel can't render — the same reason they're not tradeable, handled just below.
    // Place BEFORE clearing the slot (like Trade) so a full bag cancels the move instead of
    // destroying the item. Equip (above) is bag-only and Unequip is equipped-only, so a given item
    // ever shows one or the other, never both.
    if (_loc.kind === 'equipped' && !(item.slot === 'bag' || item.slots)) {
      menuEl.appendChild(_row('Unequip', {
        onClick: () => {
          if (!placeInFirstEmptyBagSlot(_hero, item)) {
            addLog(`No room in the bag for the ${item.name}.`, 'system');
            _close();
            return;
          }
          const name = item.name;
          _takeFromSource();   // clear the equipment slot it came from
          addLog(`${name} unequipped.`, 'system');
          _refreshAfterChange();
          _close();
        },
      }));
    }

    // Containers are deliberately NOT tradeable: a traded bag lands in a slot INSIDE one
    // of the target's bags, and the panel only ever renders ONE level of contents — so the
    // bag and everything in it drop out of the UI. Equip (above) can now pull a nested bag
    // back out to a free bag-N slot, but only if the target HAS one free; with all four
    // full it's stranded, and dragging can't help either (GENERIC_SLOT has no bag entries).
    // Not worth the trap. Move the contents across instead.
    // (Checks .slot too: bag2..bag6 in items.js have no `slots` count yet.)
    if (item.slot === 'bag' || item.slots) {
      menuEl.appendChild(_row(
        `<span class="eq-ctx-warn">Containers can't be traded —<br>move the contents instead.</span>`,
        { disabled: true }
      ));
      menuEl.appendChild(_row('Delete', { danger: true, onClick: () => _renderConfirmDelete(item) }));
      return;
    }

    // Trade — every other hero on the roster, fallen included: a downed hero still
    // owns their gear, and their bag stays reachable for exactly this reason.
    for (const type of HERO_ORDER) {
      const target = heroRoster.find(h => h.type === type);
      // Compare by type, not identity: showSheet can be handed a bare {type, hp}
      // stub (see the avatar cards' fallback), which would never === its roster
      // entry and would put a "Trade to yourself" row in the hero's own menu.
      if (!target || target.type === _hero?.type) continue;
      menuEl.appendChild(_row(`Trade to ${UNIT_TYPES[type]?.name ?? type}`, {
        onClick: () => {
          // Place BEFORE removing: if the target has no room, the item must stay put
          // rather than evaporate between the two steps.
          if (!placeInFirstEmptyBagSlot(target, item)) {
            addLog(`${UNIT_TYPES[type]?.name ?? type} has no room for the ${item.name}.`, 'system');
            _close();
            return;
          }
          const name = item.name;
          _takeFromSource();
          addLog(`${name} handed to ${UNIT_TYPES[type]?.name ?? type}.`, 'system');
          _refreshAfterChange();
          _close();
        },
      }));
    }

    menuEl.appendChild(_row('Delete', { danger: true, onClick: () => _renderConfirmDelete(item) }));
  }

  function _open(e, loc) {
    _close();
    _hero = sheetUnit;
    _loc  = loc;
    const item = _itemAt();
    if (!item) { _hero = null; _loc = null; return; }   // empty slot — no menu

    menuEl = document.createElement('div');
    menuEl.className = 'eq-ctx-menu';
    document.body.appendChild(menuEl);
    _renderMenu(item);

    // Position at the cursor, then pull back inside the viewport if it would spill.
    // Measured after appending, since the height depends on how many rows there are.
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(e.clientX, window.innerWidth  - r.width  - 4) + 'px';
    menuEl.style.top  = Math.min(e.clientY, window.innerHeight - r.height - 4) + 'px';
  }

  // [data-slot], NOT .eq-slot: bags render as .eq-bag (see buildEquipmentPanelHTML), so
  // matching the class caught only the gear slots and let the browser's own context menu
  // through on every bag. data-slot is what both kinds carry — same hook _initEquipmentPanel
  // binds its clicks to.
  eqContentEl.addEventListener('contextmenu', e => {
    const slotEl = e.target.closest('[data-slot]');
    if (!slotEl) return;
    e.preventDefault();
    _open(e, { kind: 'equipped', slotKey: slotEl.dataset.slot });
  });

  eqBagContentEl.addEventListener('contextmenu', e => {
    const box = e.target.closest('[data-bagslot]');
    if (!box) return;
    e.preventDefault();
    const idx = Number(box.dataset.bagslot);
    if (Number.isNaN(idx)) return;
    _open(e, { kind: 'bag', bagKey: eqBagContentEl.dataset.bagSlotKey, idx });
  });

  // Dismiss on anything that means "I'm done here". Capture phase on mousedown so
  // the menu closes before the click lands on whatever is underneath it.
  document.addEventListener('mousedown', e => {
    if (menuEl && !e.target.closest('.eq-ctx-menu')) _close();
  }, true);
  // Escape peels ONE layer: the menu, not the sheet behind it. army.js has a
  // bubble-phase Escape handler that calls hideSheet(), so without stopping the
  // event here, dismissing this menu would tear down the whole inventory with it.
  // Capture on document runs before the event ever reaches that listener.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !menuEl) return;
    e.stopPropagation();
    _close();
  }, true);
  window.addEventListener('blur', _close);
})();

function buildEquipmentPanelHTML(u) {
  const slot = (id, label) => {
    const item = u.equipment?.[id];
    const rarityClass = item ? ` rarity-${item.rarity}` : '';
    const title = item ? item.name : label;
    const icon = item?.icon
      ? `<img class="eq-slot-icon" src="${item.icon}" alt="${item.name}">`
      : '';
    return `<div class="eq-slot" data-slot="${id}" title="${title}">` +
      `<div class="eq-slot-box${rarityClass}">${icon}</div>` +
      `<span class="eq-slot-label">${label}</span>` +
      `</div>`;
  };

  const bag = n => {
    const bagSlot = `bag-${n}`;
    const item = u.equipment?.[bagSlot];
    const rarityClass = item ? ` rarity-${item.rarity}` : '';
    const title = item ? item.name : `Bag ${n}`;
    const icon = item?.icon
      ? `<img class="eq-slot-icon" src="${item.icon}" alt="${item.name}">`
      : '';
    return `<div class="eq-bag" data-slot="${bagSlot}" title="${title}">` +
      `<div class="eq-bag-box${rarityClass}">${icon}</div>` +
      `<span class="eq-bag-label">Bag ${n}</span>` +
      `</div>`;
  };

  const cur = (label, val) =>
    `<div class="eq-currency-row">` +
    `<span class="eq-currency-label">${label}</span>` +
    `<span class="eq-currency-value">${val}</span>` +
    `</div>`;

  if (!u.currency) u.currency = { copper: 0, silver: 0, gold: 5, platinum: 0 };
  const { copper, silver, gold, platinum } = u.currency;

  // The detail box sits BELOW the two columns at full panel width (not inside the narrow 116px
  // right column) so a long item name like "Plaguewrought Charm" fits on one line instead of
  // spilling past the border. .eq-cols is the old left|right flex-row; #eq-content now stacks it
  // above .eq-detail.
  return (
    `<div class="eq-cols">` +
      `<div class="eq-left">` +
        `<div class="eq-title">EQUIPMENT</div>` +
        `<div class="eq-grid">` +
          slot('head',      'Head')      +
          slot('neck',      'Neck')      +
          slot('chest',     'Chest')     +
          slot('cloak',     'Cloak')     +
          slot('wrist-l',   'Wrist')     +
          slot('legs',      'Legs')      +
          slot('hands',     'Hands')     +
          slot('wrist-r',   'Wrist')     +
          slot('ring-l',    'Ring')      +
          slot('feet',      'Feet')      +
          slot('belt',      'Belt')      +
          slot('ring-r',    'Ring')      +
          slot('main-hand', 'Main Hand') +
          slot('off-hand',  'Off Hand')  +
          slot('ammo',      'Ammo')      +
        `</div>` +
      `</div>` +
      `<div class="eq-right">` +
        `<div class="eq-bags">${bag(1)}${bag(2)}${bag(3)}${bag(4)}</div>` +
        `<div class="eq-currency">` +
          cur('Copper',   copper)   +
          cur('Silver',   silver)   +
          cur('Gold',     gold)     +
          cur('Platinum', platinum) +
        `</div>` +
      `</div>` +
    `</div>` +
    `<div class="eq-detail" id="eq-detail">Select an item to view its stats</div>`
  );
}

function buildTraitsPanelHTML(u) {
  const def = UNIT_TYPES[u.type];
  const sections = [];

  const sneakDef = def.sneakAttack;
  if (sneakDef) {
    sections.push(`
    <div class="ss-sneak">
      <div class="ss-sneak-top">
        <span class="ss-sneak-name">Sneak Attack</span>
        <span class="ss-sneak-dice">+${sneakDef.dice}d${sneakDef.sides}</span>
      </div>
      <div class="ss-sneak-desc">Once per turn · conscious ally adjacent to attacker, or attacker has advantage</div>
      <div class="ss-sneak-crit">Critical hit → +${sneakDef.dice * 2}d${sneakDef.sides}</div>
    </div>`);
  }

  const armorProf = def.armorProficiency;
  if (armorProf) {
    const armorDesc = armorProf.armor.length
      ? `Proficient in ${armorProf.armor.join(', ')} armor`
      : 'Proficient in no armor — cannot wear light, medium, or heavy armor';
    const shieldDesc = armorProf.shields === undefined ? ''
      : `<div class="ss-sneak-desc">${armorProf.shields ? 'Proficient with shields' : 'Not proficient with shields'}</div>`;
    sections.push(`
    <div class="ss-sneak">
      <div class="ss-sneak-top">
        <span class="ss-sneak-name">Armor Proficiency</span>
      </div>
      <div class="ss-sneak-desc">${armorDesc}</div>${shieldDesc}
    </div>`);
  }

  const weaponProf = def.weaponProficiency;
  if (weaponProf) {
    const categories = [];
    if (weaponProf.simple)  categories.push('Simple');
    if (weaponProf.martial) categories.push('Martial');
    const catDesc = categories.length
      ? `Proficient with ${categories.join(' and ')} weapons`
      : 'Not proficient with Simple or Martial weapons';
    const exceptDesc = weaponProf.weapons?.length
      ? `<div class="ss-sneak-desc">Also: ${weaponProf.weapons.join(', ')}</div>`
      : '';
    sections.push(`
    <div class="ss-sneak">
      <div class="ss-sneak-top">
        <span class="ss-sneak-name">Weapon Proficiency</span>
      </div>
      <div class="ss-sneak-desc">${catDesc}</div>${exceptDesc}
    </div>`);
  }

  if (!sections.length) return '';
  return `
    <div class="ss-spells-hdr">
      <span class="ss-spell-title">SPECIAL</span>
    </div>
    ${sections.join('')}`;
}

function buildActionsPanelHTML(u) {
  const def = UNIT_TYPES[u.type];
  _actionsSections = {};

  const row = (key, headerHTML, listTitle, listHTML) => {
    _actionsSections[key] = `<div class="ss-slist-title">${listTitle}</div>${listHTML}`;
    return `
      <div class="ss-accordion">
        <div class="ss-acc-hdr" data-key="${key}">
          ${headerHTML}
          <span class="ss-acc-arrow">▶</span>
        </div>
      </div>`;
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const hasLongRange = (def.attacks ?? []).some(a => a.longRange);
  const attacksHTML = (def.attacks ?? []).map(atk => `
    <div class="ss-atk">
      <span class="ss-atk-type ${atk.type}">${atk.type === 'melee' ? 'MEL' : 'RNG'}</span>
      <div class="ss-atk-info">
        <div class="ss-atk-top">
          <span class="ss-atk-name">${atk.name}</span>
          <span class="ss-atk-hit">${atkToHitStr(atk, def.abilities, def.profBonus)}</span>
          ${atk.qty !== undefined ? `<span class="ss-atk-qty">×${atk.qty}</span>` : ''}
        </div>
        <div class="ss-atk-bot">
          <span class="ss-atk-dmg">${atkDmgStr(atk, def.abilities)}</span>
          <span class="ss-atk-range">${atkRangeStr(atk)}</span>
        </div>
        ${atk.note ? `<div class="ss-atk-note">${atk.note}</div>` : ''}
      </div>
    </div>`).join('');
  const sneakDef = def.sneakAttack;
  const sneakHTML = sneakDef ? `
    <div class="ss-spell-row">
      <div class="ss-spell">
        <div class="ss-spell-inner">
          <div class="ss-spell-text">
            <div class="ss-spell-top">
              <span class="ss-spell-name">Sneak Attack</span>
            </div>
            <div class="ss-spell-desc">+${sneakDef.dice}d${sneakDef.sides} damage on a hit when an ally is adjacent to the target, when attacking while Hidden, or with advantage · once per turn</div>
          </div>
          <img src="${ABILITY_META.sneak_attack.imgSrc}" class="ss-spell-inline-img" alt="Sneak Attack">
        </div>
      </div>
    </div>` : '';
  const smokeMirrorsHTML = (u.type === 'halfling' && (u.level ?? 1) >= 3) ? `
    <div class="ss-spell-row">
      <div class="ss-spell">
        <div class="ss-spell-inner">
          <div class="ss-spell-text">
            <div class="ss-spell-top">
              <span class="ss-spell-name">Smoke &amp; Mirrors</span>
            </div>
            <div class="ss-spell-desc">Twice per combat · lasts for 2 rounds · 10 ft smoke cloud · while within 10 ft of its centre: heavily obscured (+3 AC), advantage on Sneak Attacks, and Hide auto-succeeds</div>
          </div>
          <img src="${ABILITY_META.smoke_mirrors.imgSrc}" class="ss-spell-inline-img" alt="Smoke & Mirrors">
        </div>
      </div>
    </div>` : '';
  const actionsContent = (attacksHTML || sneakHTML || smokeMirrorsHTML)
    ? `<div class="ss-attacks">${attacksHTML}</div>${sneakHTML}${smokeMirrorsHTML}${hasLongRange ? '<div class="ss-range-note">† Long range = disadvantage</div>' : ''}`
    : `<div class="ss-spell-empty">— none —</div>`;

  // ── Bonus Actions ──────────────────────────────────────────────────────────
  const rageDef = def.rage;
  const bonusParts = [];
  if (rageDef) {
    const rageUsesNow = rageUsesForLevel(u.level);
    const rageMit     = rageMitigationForLevel(u.level);
    const mitTxt      = rageMit > 0
      ? `${Math.round(rageMit * 100)}% physical damage resistance`
      : 'no damage resistance (unlocks at L2)';
    bonusParts.push(`
    <div class="ss-spell-row">
      <div class="ss-spell">
        <div class="ss-spell-inner">
          <div class="ss-spell-text">
            <div class="ss-spell-top">
              <span class="ss-spell-name">Rage</span>
            </div>
            <div class="ss-spell-desc">+${rageDef.dmgBonus} melee damage · ${mitTxt} · lasts full combat, ends if no attack this turn · ×${rageUsesNow} per combat</div>
          </div>
          <img src="${ABILITY_META.rage.imgSrc}" class="ss-spell-inline-img" alt="Rage">
        </div>
      </div>
    </div>`);
  }
  if (precisionHitBonusForLevel(u.type, u.level) > 0) {
    bonusParts.push(`
    <div class="ss-spell-row">
      <div class="ss-spell">
        <div class="ss-spell-inner">
          <div class="ss-spell-text">
            <div class="ss-spell-top">
              <span class="ss-spell-name">Precision <span style="opacity:.55;font-weight:400">(Passive)</span></span>
            </div>
            <div class="ss-spell-desc">+${precisionHitBonusForLevel(u.type, u.level)}% chance to hit on all attacks · always active</div>
          </div>
        </div>
      </div>
    </div>`);
  }
  if (u.type === 'human' && (u.level ?? 1) >= 5) {
    bonusParts.push(`
    <div class="ss-rage">
      <div class="ss-spell-inner">
        <div class="ss-spell-text">
          <div class="ss-rage-top">
            <span class="ss-rage-name">Defensive Stance</span>
          </div>
          <div class="ss-rage-desc">+3 AC for 3 rounds</div>
          <div class="ss-rage-desc">4-round cooldown</div>
        </div>
        <img src="${ABILITY_META.defensive_stance.imgSrc}" class="ss-spell-inline-img" alt="Defensive Stance">
      </div>
    </div>`);
  }
  if (u.type === 'halfling' && (u.level ?? 1) >= 2) {
    bonusParts.push(`
    <div class="ss-spell-row">
      <div class="ss-spell">
        <div class="ss-spell-inner">
          <div class="ss-spell-text">
            <div class="ss-spell-top">
              <span class="ss-spell-name">Hide</span>
            </div>
            <div class="ss-spell-desc">In combat: requires no enemy has line of sight (unless inside your own Smoke & Mirrors) · DC 10 Stealth check · becomes semi-transparent on success · 2-turn cooldown · while hidden, sneak attack works on any target in range; attacking breaks stealth (moving keeps stealth unless an enemy's Perception spots you). Out of combat: hide freely to scout — cuts the detection radius of enemies he can see by 50% (shown as rings) so he can move solo without aggroing; toggle off with the same button, breaks if an enemy still spots him.</div>
          </div>
          <img src="${ABILITY_META.hide.imgSrc}" class="ss-spell-inline-img" alt="Hide">
        </div>
      </div>
    </div>`);
  }
  const bonusContent = bonusParts.length ? bonusParts.join('') : `<div class="ss-spell-empty">— none —</div>`;

  // ── Reactions ──────────────────────────────────────────────────────────────
  const reactionsContent = `<div class="ss-spell-empty">— none —</div>`;

  return `
    ${row('actions',   `<span class="ss-spell-title">ACTIONS</span>`,       'ACTIONS',       actionsContent)}
    ${row('bonus',     `<span class="ss-spell-title">BONUS ACTIONS</span>`, 'BONUS ACTIONS', bonusContent)}
    ${row('reactions', `<span class="ss-spell-title">REACTIONS</span>`,     'REACTIONS',     reactionsContent)}`;
}

function _initActionAccordions() {
  let _activeKey = null;
  sideContentEl.querySelectorAll('.ss-acc-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const key    = hdr.dataset.key;
      const arrow  = hdr.querySelector('.ss-acc-arrow');
      const isOpen = spellListPanelEl.classList.contains('show');

      if (_activeKey && _activeKey !== key) {
        const prev = sideContentEl.querySelector(`[data-key="${_activeKey}"] .ss-acc-arrow`);
        if (prev) prev.textContent = '▶';
      }

      if (_activeKey === key && isOpen) {
        spellListPanelEl.classList.remove('show');
        arrow.textContent = '▶';
        _activeKey = null;
      } else {
        spellListContentEl.innerHTML = _actionsSections[key] ?? '';
        spellListPanelEl.classList.add('show');
        arrow.textContent = '▼';
        _activeKey = key;
      }
    });
  });
}

function buildSheetHTML(u) {
  const def = UNIT_TYPES[u.type];
  const { str, dex, con, int: int_, wis, cha } = def.abilities;
  const abilities = [
    ['STR', str], ['DEX', dex], ['CON', con],
    ['INT', int_], ['WIS', wis], ['CHA', cha],
  ];

  return `
    <div class="ss-name">${def.name}</div>
    ${def.class ? `<div class="ss-class">${def.class}</div>` : ''}
    <div class="ss-combat">
      <div class="ss-stat">
        <span class="ss-lbl">HP</span>
        <span class="ss-val">${u.hp}/${u.maxHp ?? def.hp}</span>
      </div>
      <div class="ss-stat">
        <span class="ss-lbl">AC</span>
        <span class="ss-val">${u.equipment ? computeAC(u) : def.ac}</span>
      </div>
      <div class="ss-stat">
        <span class="ss-lbl">SPD</span>
        <span class="ss-val">${def.speed}ft</span>
      </div>
      ${def.profBonus ? `<div class="ss-stat">
        <span class="ss-lbl">PROF</span>
        <span class="ss-val">+${def.profBonus}</span>
      </div>` : ''}
    </div>
    ${(() => {
      const { level, earned, span, maxed } = getXpProgress(u);
      return `<div class="ss-xp">XP: <strong>${earned}</strong> / ${maxed ? 'MAX' : span} &nbsp;(Lvl ${level})</div>`;
    })()}
    <div class="ss-sep"></div>
    <div class="ss-abilities">
      ${abilities.map(([lbl, score]) => `
        <div class="ss-ab">
          <div class="ss-ab-lbl">${lbl}</div>
          <div class="ss-ab-score">${score}</div>
          <div class="ss-ab-mod">${abMod(score)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// Same A/BA/R tag the hotbar shows (hb-action-tag/hb-at-*), reused here so
// the Skills & Spells window marks every ability's action economy too.
function _sbActionTagHTML(key) {
  const type = getAbilityActionType(key);
  const cls  = { action: 'hb-at-action', bonus: 'hb-at-bonus', reaction: 'hb-at-reaction' }[type];
  const txt  = { action: 'A',            bonus: 'BA',          reaction: 'R'              }[type];
  return cls ? `<span class="hb-action-tag ${cls}">${txt}</span>` : '';
}

// What the spell bar's DOM actually depends on. Everything else that changes frame to
// frame (cooldowns, range to a moving target, whether you've attacked yet) only affects
// the greyed-out state, which is a class toggle — not a reason to rebuild the markup.
function _spellBarSig(u) {
  if (!u || u.team !== 'blue') return 'none';
  const prepared = u.preparedSpells ?? STARTING_SPELLS[u.type] ?? new Set();
  return [u.type, u.level, totalSpellSlots(u), totalSpellSlotsMax(u),
          [...prepared].sort().join(',')].join('|');
}

// Per-frame pass: the ONLY thing that has to stay live. Reads data-ability off the
// buttons already in the DOM, so it never touches innerHTML.
function _refreshSpellBarAvailability() {
  const apply = btn => {
    const key = btn?.dataset.ability;
    btn?.classList.toggle('sb-unavailable', !!key && !isAbilityAvailableNow(key));
  };
  for (let i = 0; i < 5; i++) {
    apply(document.getElementById(`sb-skill-${i}`));
    apply(document.getElementById(`sb-cant-${i}`));
  }
  document.getElementById('spell-bar-btns')?.querySelectorAll('.sb-btn').forEach(apply);
}

let _sbSig        = null;
let _sbAvailTick  = 0;

// This used to rebuild the ENTIRE spell bar's innerHTML — ~15 buttons plus the whole
// spell grid — on every single frame, because per-ability availability has to stay live.
// But that markup contains <img> tags, so it was minting hundreds of fresh
// HTMLImageElements per second pointing at megapixel JPEGs, and re-running layout/paint
// for all of it at 60 Hz. Collapsing the panel didn't help either: the CSS uses
// max-height:0, not display:none, so the images stay in the render tree.
//
// Now the markup is rebuilt only when _spellBarSig() changes (hero, level, prepared set,
// slot count), and the live availability state — the only genuinely per-frame part — is a
// classList toggle handled by _refreshSpellBarAvailability().
function updateSpellBar() {
  // Precombat: prefer selectedTarget (set by the always-on, mesh-raycast
  // "click any unit" handler in combat.js — the same click that shows a
  // hero's HP bar and the target window) over getPCSelected() (set only by
  // the precombat move-selection click, which uses a much less forgiving
  // ground-plane-proximity check and can miss without the player noticing).
  // Without this, the Skills & Spells window could silently keep showing a
  // stale hero even though the player's click was clearly acknowledged
  // elsewhere in the UI.
  const pcHero = (selectedTarget?.team === 'blue' && selectedTarget.hp > 0) ? selectedTarget : getPCSelected();
  const u = combatPhase ? turnOrder[turnIndex] : pcHero;

  const sig = _spellBarSig(u);
  if (sig !== _sbSig) {
    _sbSig = sig;
    _rebuildSpellBar(u);
    _sbAvailTick = 0;          // force an availability pass on the fresh markup
  }

  // isAbilityAvailableNow() is not free — Milo's sneak attack runs a line-of-sight test,
  // which raycasts. Greying a button out 4 frames late is invisible; doing it 60x a second
  // is not. (Clicking a stale-looking button is still validated at execution time.)
  if (_sbAvailTick-- <= 0) {
    _sbAvailTick = 4;
    _refreshSpellBarAvailability();
  }
}

function _rebuildSpellBar(u) {
  const spellBarBtnsEl = document.getElementById('spell-bar-btns');

  // Clear all buttons when no caster is active
  const clearBtns = () => {
    if (spellBarBtnsEl) spellBarBtnsEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const c = document.getElementById(`sb-cant-${i}`);
      if (c)  { c.innerHTML = ''; c.title = ''; delete c.dataset.spell; delete c.dataset.ability; }
    }
    for (let i = 0; i < 5; i++) {
      const s = document.getElementById(`sb-skill-${i}`);
      if (s)  { s.innerHTML = ''; s.title = ''; delete s.dataset.ability; }
    }
  };

  if (!u || u.team !== 'blue') { clearBtns(); return; }

  // Skills — every hero type, always populated (dash/dodge plus whatever
  // hero-specific skills they've unlocked so far).
  const skills = getAvailableAbilities(u.type, u.level, 'skills');
  for (let i = 0; i < 5; i++) {
    const btn = document.getElementById(`sb-skill-${i}`);
    if (!btn) continue;
    const key = skills[i];
    btn.dataset.ability = key ?? '';
    btn.title            = key ? (ABILITY_META[key]?.name ?? key) : '';
    btn.innerHTML        = key ? sbIconHTML(key) + _sbActionTagHTML(key) : '';
    btn.classList.toggle('sb-unavailable', !!key && !isAbilityAvailableNow(key));
  }

  if (u.type !== 'dwarf' && u.type !== 'elf') {
    // No spellcasting for this hero type — clear only the spell/cantrip rows.
    if (spellBarBtnsEl) spellBarBtnsEl.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const c = document.getElementById(`sb-cant-${i}`);
      if (c)  { c.innerHTML = ''; c.title = ''; delete c.dataset.spell; delete c.dataset.ability; }
    }
    return;
  }

  const pool     = u.type === 'dwarf' ? Object.values(SPELLS) : Object.values(ELF_SPELLS);
  const prepared = u.preparedSpells ?? STARTING_SPELLS[u.type] ?? new Set();

  // Slot circles — TOTAL across every spell level, shown once on the lowest prepared
  // spell-level row. Slots are per-level under the hood now, but every spell in the game
  // is still level 0 or 1, so a single total row remains accurate. When 2nd-level spells
  // land this needs one row per spell level (see project_skills_spells_bar).
  const slots    = totalSpellSlots(u);
  const slotsMax = totalSpellSlotsMax(u);
  const pipsHTML = Array.from({ length: 4 }, (_, i) =>
    `<span class="sb-slot-pip ${i < slots ? 'filled' : ''} ${i >= slotsMax ? 'unavailable' : ''}"></span>`
  ).join('');

  // One row per distinct spell level (1+) present in this hero's spell pool,
  // stacked highest level on top — mirrors buildSpellPanelHTML's levelRows.
  const levels = [...new Set(pool.filter(sp => (sp.level ?? 1) >= 1).map(sp => sp.level))].sort((a, b) => b - a);
  const lowestLevel = levels.length ? Math.min(...levels) : null;

  if (spellBarBtnsEl) {
    spellBarBtnsEl.innerHTML = levels.map(lvl => {
      const spells = pool.filter(sp => sp.level === lvl && prepared.has(sp.key));
      const btnsHTML = Array.from({ length: 5 }, (_, i) => {
        const sp = spells[i];
        const inner = sp ? (sp.imgSrc ? `<img src="${sp.imgSrc}" class="sb-spell-img" alt="${sp.name}">` : sp.name) : '';
        const tag = sp ? _sbActionTagHTML(sp.key) : '';
        const unavailCls = sp && !isAbilityAvailableNow(sp.key) ? ' sb-unavailable' : '';
        return `<button class="sb-btn${unavailCls}" id="sb-btn-${lvl}-${i}" data-spell="${sp?.key ?? ''}" data-ability="${sp?.key ?? ''}" title="${sp?.name ?? ''}">${inner}${tag}</button>`;
      }).join('');
      const slotsCol = lvl === lowestLevel
        ? `<div class="sb-col sb-col-slots"><span class="sb-col-label">Slots</span><span class="sb-slot-pips">${pipsHTML}</span></div>`
        : '';
      return `
        <div class="sb-lvl-row">
          <span class="sb-lvl-label">${lvl}</span>
          ${slotsCol}
          <div class="sb-col sb-col-prepared">
            <span class="sb-col-label">Prepared</span>
            <div class="sb-prepared-row">${btnsHTML}</div>
          </div>
        </div>`;
    }).join('');
  }

  // Cantrip buttons
  const cantrips = pool.filter(sp => (sp.level ?? 1) === 0 && isAbilityUnlocked(u.type, u.level, sp.key));
  for (let i = 0; i < 5; i++) {
    const btn = document.getElementById(`sb-cant-${i}`);
    if (!btn) continue;
    const sp = cantrips[i];
    btn.dataset.spell   = sp?.key ?? '';
    btn.dataset.ability = sp?.key ?? '';
    btn.title           = sp?.name ?? '';
    if (!sp) {
      btn.innerHTML = '';
    } else if (sp.imgSrc) {
      btn.innerHTML = `<img src="${sp.imgSrc}" class="sb-spell-img" alt="${sp.name}">` + _sbActionTagHTML(sp.key);
    } else {
      btn.innerHTML = sp.name + _sbActionTagHTML(sp.key);
    }
    btn.classList.toggle('sb-unavailable', !!sp && !isAbilityAvailableNow(sp.key));
  }
}

export function showSheet(u) {
  sheetUnit = u;
  sidePanelEl.classList.remove('show');
  spellListPanelEl.classList.remove('show');
  // The equipment/bag panels close here too. They're built from cached HTML at open
  // time, so leaving them up across a showSheet would keep the PREVIOUS hero's gear
  // on screen beside the new hero's sheet. Easy to hit now that every avatar card has
  // its own one-click bag button. showInventory() re-opens equipment right after.
  eqPanelEl?.classList.remove('show');
  eqBagPanelEl?.classList.remove('show');
  document.getElementById('ss-btn-abilities')?.classList.remove('active');
  document.getElementById('ss-btn-spellbook')?.classList.remove('active');
  document.getElementById('ss-btn-traits')?.classList.remove('active');
  document.getElementById('ss-btn-xp')?.classList.remove('active');
  _activeSideBtn = null;
  sheetBody.innerHTML   = buildSheetHTML(u);
  _spellPanelHTML       = buildSpellPanelHTML(u);
  _actionsPanelHTML     = buildActionsPanelHTML(u);
  _traitsPanelHTML      = buildTraitsPanelHTML(u);
  _equipmentPanelHTML   = buildEquipmentPanelHTML(u);
  _xpPanelHTML          = buildXpPanelHTML(u);
  // Only dwarf keeps its amber override; all other heroes use the CSS-default gold.
  const hc = u.type === 'dwarf' ? HERO_RING_COLORS[u.type] : null;
  if (hc) {
    const r = (hc >> 16) & 0xff, g = (hc >> 8) & 0xff, b = hc & 0xff;
    sheetWrap.style.setProperty('--hc',      `rgb(${r},${g},${b})`);
    sheetWrap.style.setProperty('--hc-glow', `rgba(${r},${g},${b},0.35)`);
    sheetWrap.style.setProperty('--hc-dim',  `rgba(${r},${g},${b},0.55)`);
    sheetWrap.style.setProperty('--hc-bg',   `rgba(${r},${g},${b},0.09)`);
  } else {
    sheetWrap.style.removeProperty('--hc');
    sheetWrap.style.removeProperty('--hc-glow');
    sheetWrap.style.removeProperty('--hc-dim');
    sheetWrap.style.removeProperty('--hc-bg');
  }
  sheetWrap.classList.add('show');
}

export function hideSheet() {
  sheetUnit = null;
  sheetWrap.classList.remove('show');
  sidePanelEl.classList.remove('show');
  sidePanelEl.classList.remove('ss-side-wide');   // only the XP table re-adds it
  spellListPanelEl.classList.remove('show');
  eqPanelEl?.classList.remove('show');
  eqBagPanelEl?.classList.remove('show');
  document.getElementById('ss-btn-abilities')?.classList.remove('active');
  document.getElementById('ss-btn-spellbook')?.classList.remove('active');
  document.getElementById('ss-btn-traits')?.classList.remove('active');
  document.getElementById('ss-btn-xp')?.classList.remove('active');
  _activeSideBtn = null;
}

const activeMarkerEl = document.getElementById('active-marker');

export function trackActiveMarker() {
  const u = combatPhase ? turnOrder[turnIndex] : null;
  if (!u) { activeMarkerEl.style.display = 'none'; return; }
  _vec.set(u.anchor.x, u.anchor.y + 0.3, u.anchor.z).project(camera);
  if (_vec.z >= 1) { activeMarkerEl.style.display = 'none'; return; }
  activeMarkerEl.style.display = 'block';
  activeMarkerEl.style.left = ((_vec.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  activeMarkerEl.style.top  = ((-_vec.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
}

export function trackSheet() {
  // Sheet is always centered via CSS fixed positioning — no tracking needed.
}


// ── Panel collapse toggles ────────────────────────────────────────────────────
// Clicking the header (title strip + arrow) toggles the panel body open/closed.
// When collapsed, clicking anywhere on the narrow header re-opens it.

function setupPanelToggle(headerId, bodyId, openArrow, closedArrow) {
  const header = document.getElementById(headerId);
  const body   = document.getElementById(bodyId);
  const btn    = header.querySelector('.panel-toggle');

  header.addEventListener('click', () => {
    const isNowCollapsed = body.classList.toggle('collapsed');
    btn.textContent = isNowCollapsed ? closedArrow : openArrow;
  });
}

setupPanelToggle('panel-header-zones',      'body-zones',      '▶', '◀');
setupPanelToggle('panel-header-cutscenes', 'body-cutscenes', '▶', '◀');

(function() {
  const body   = document.getElementById('spell-bar-body');
  const toggle = document.getElementById('spell-bar-toggle');
  if (!body || !toggle) return;
  body.classList.add('collapsed');
  toggle.textContent = '▲';

  function _toggleSpellBar() {
    const collapsed = body.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▲' : '▼';
  }

  toggle.addEventListener('click', e => {
    e.stopPropagation();
    _toggleSpellBar();
  });

  // S — toggle the Skills & Spells window open/closed, same as clicking its arrow.
  document.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyS') _toggleSpellBar();
  });

  body.addEventListener('click', e => {
    const btn = e.target.closest('.sb-btn');
    const key = btn?.dataset.ability;
    if (!btn || !key) return;
    executeAbility(key);
  });

  // Per-section accordion — Spells / Cantrips / Skills each expand independently.
  body.querySelectorAll('.sb-acc-hdr').forEach(hdr => {
    const section = hdr.closest('.sb-accordion');
    const acBody  = section?.querySelector('.sb-acc-body');
    const arrow   = hdr.querySelector('.sb-acc-arrow');
    if (!acBody || !arrow) return;
    hdr.addEventListener('click', e => {
      e.stopPropagation();
      const collapsed = acBody.classList.toggle('collapsed');
      arrow.textContent = collapsed ? '▶' : '▼';
    });
  });

  // Shift-click-drag: pick up any populated Skills/Cantrips/Spells box and
  // drop it onto an open hotbar slot to assign it there for this hero.
  let dragEl = null, dragAbility = null, dragHero = null;

  function _moveGhost(x, y) {
    if (dragEl) { dragEl.style.left = x + 'px'; dragEl.style.top = y + 'px'; }
  }
  function _onDragMove(e) { _moveGhost(e.clientX, e.clientY); }

  function _onDragEnd(e) {
    document.removeEventListener('mousemove', _onDragMove);
    if (dragEl) {
      dragEl.style.display = 'none'; // exclude the ghost from the hit-test below
      const hbBtn   = document.elementFromPoint(e.clientX, e.clientY)?.closest('.hb-btn');
      const slotKey = hbBtn?.dataset.hbKey;
      if (hbBtn && slotKey && dragHero && assignHotbarSlot(dragHero, slotKey, dragAbility)) {
        hbBtn.classList.add('hb-drop-flash');
        setTimeout(() => hbBtn.classList.remove('hb-drop-flash'), 400);
      }
      dragEl.remove();
      dragEl = null;
    }
    dragAbility = null;
    dragHero    = null;
  }

  body.addEventListener('mousedown', e => {
    if (!e.shiftKey) return;
    const btn     = e.target.closest('.sb-btn');
    const ability = btn?.dataset.ability;
    if (!btn || !ability) return;
    e.preventDefault();

    dragAbility = ability;
    dragHero    = combatPhase ? turnOrder[turnIndex] : getPCSelected();

    dragEl = document.createElement('div');
    dragEl.className = 'sb-drag-ghost';
    dragEl.innerHTML = btn.innerHTML;
    document.body.appendChild(dragEl);
    _moveGhost(e.clientX, e.clientY);

    document.addEventListener('mousemove', _onDragMove);
    document.addEventListener('mouseup', _onDragEnd, { once: true });
  });
})();

(function() {
  const body   = document.getElementById('log-entries');
  const panel  = document.getElementById('combat-log');
  const toggle = document.getElementById('combat-log-toggle');
  if (!body || !toggle) return;
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const collapsed = body.classList.toggle('collapsed');
    panel?.classList.toggle('log-collapsed', collapsed);
    toggle.textContent = collapsed ? '▲' : '▼';
  });
})();
