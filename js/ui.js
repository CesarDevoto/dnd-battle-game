import * as THREE from 'three';
import { units, allBarsVisible } from './units.js';
import { camera, renderer, _vec, ground } from './scene.js';
import { UNIT_TYPES, HERO_RING_COLORS } from './constants.js';
import { turnOrder, turnIndex, combatPhase, triggerSpellBarAction } from './combat.js';
import { getPCSelected } from './precombat.js';
import { SPELLS, ELF_SPELLS, STARTING_SPELLS } from './spells.js';

// ── Occlusion raycaster — allocated once, reused every frame ─────────────────
// firstHitOnly stops traversal at the nearest terrain hit (early-exit).
// _rayDir is normalised in-place so there are zero heap allocations per unit.

const _occluder = new THREE.Raycaster();
const _rayDir   = new THREE.Vector3();
_occluder.firstHitOnly = true;

// ── HUD: project each unit's 3D anchor to screen coords ──────────────────────
// Health bars are hidden by default and only shown when:
//   • barForced = true  → unit is selected or currently taking its combat turn
//   • now < barShowUntil → unit was damaged recently (3-second flash)
// Occlusion (terrain ray) is only tested for bars that would otherwise be shown.

export function updateHUD() {
  const W   = renderer.domElement.clientWidth;
  const H   = renderer.domElement.clientHeight;
  const now = Date.now();

  units.forEach(u => {
    if (!u.barEl) return;  // NPCs have no hp bar
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

    // Is this bar supposed to be visible at all?
    // Red units only show bars once aggroed — non-aggroed far enemies stay hidden.
    const inCombat   = !combatPhase || (turnOrder.includes(u) && (u.team !== 'red' || u.aggro));
    const barsOk     = allBarsVisible && (combatPhase || u.team === 'blue');
    const shouldShow = inCombat && (u.barForced || now < u.barShowUntil || barsOk);
    if (!shouldShow) {
      u.barEl.style.opacity = '0';
      return;
    }

    // Terrain occlusion test — only run when bar is eligible to show.
    // Stop the ray 1.5 WU short of the anchor so the terrain directly under
    // the unit's feet never self-occludes it.
    _rayDir.copy(u.anchor).sub(camera.position);
    const dist = _rayDir.length();
    _rayDir.divideScalar(dist);

    _occluder.set(camera.position, _rayDir);
    _occluder.far = Math.max(0.5, dist - 1.5);

    const hit = _occluder.intersectObject(ground, false);
    u.barEl.style.opacity = hit.length > 0 ? '0' : '1';
  });
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

let _activeSideBtn      = null;
let _spellPanelHTML     = '';
let _actionsPanelHTML   = '';
let _traitsPanelHTML    = '';
let _equipmentPanelHTML = '';

function _toggleSidePanel(btnId) {
  const isEq   = btnId === 'ss-btn-equipment';
  const isSame = _activeSideBtn === btnId &&
    (isEq ? eqPanelEl?.classList.contains('show') : sidePanelEl.classList.contains('show'));
  sidePanelEl.classList.remove('show');
  spellListPanelEl.classList.remove('show');
  eqPanelEl?.classList.remove('show');
  document.getElementById('ss-btn-abilities')?.classList.remove('active');
  document.getElementById('ss-btn-spellbook')?.classList.remove('active');
  document.getElementById('ss-btn-traits')?.classList.remove('active');
  document.getElementById('ss-btn-equipment')?.classList.remove('active');
  _activeSideBtn = null;
  if (!isSame) {
    if (isEq) {
      eqContentEl.innerHTML = _equipmentPanelHTML;
      eqPanelEl?.classList.add('show');
    } else if (btnId === 'ss-btn-spellbook') {
      sideContentEl.innerHTML = _spellPanelHTML;
      _initSpellAccordions();
      sidePanelEl.classList.add('show');
    } else if (btnId === 'ss-btn-traits') {
      sideContentEl.innerHTML = _traitsPanelHTML;
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
document.getElementById('ss-btn-equipment')?.addEventListener('click',  () => _toggleSidePanel('ss-btn-equipment'));

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

  const spellSlots    = u.spellSlots    ?? 2;
  const spellSlotsMax = u.spellSlotsMax ?? 2;
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

  const cantrips     = spellPool.filter(sp => (sp.level ?? 1) === 0);
  const prepCantrips = cantrips.filter(sp => prepared.has(sp.key));

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

  return `
    ${(()=>{
        const cantripTitle = 'CANTRIPS';
        return row('cantrips', `<span class="ss-acc-left"><span class="ss-spell-title">CANTRIPS</span></span>`, cantripTitle,
          cantrips.length ? makeList(cantrips, true) : `<div class="ss-spell-empty">— none —</div>`);
      })()}
    <div class="ss-sep"></div>
    <div class="ss-spells-hdr">
      <span class="ss-spell-title">SPELLS</span>
    </div>
    <div class="ss-prep-max">
      <span class="ss-prep-label">PREPARED MAX</span>
      <span class="ss-prep-val">${totalPrepared}</span>
    </div>
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

  const bag = n =>
    `<div class="eq-bag">` +
    `<div class="eq-bag-box"></div>` +
    `<span class="eq-bag-label">Bag ${n}</span>` +
    `</div>`;

  const cur = (label, val) =>
    `<div class="eq-currency-row">` +
    `<span class="eq-currency-label">${label}</span>` +
    `<span class="eq-currency-value">${val}</span>` +
    `</div>`;

  if (!u.currency) u.currency = { copper: 0, silver: 0, gold: 5, platinum: 0 };
  const { copper, silver, gold, platinum } = u.currency;

  return (
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
    `</div>`
  );
}

function buildTraitsPanelHTML(u) {
  const def = UNIT_TYPES[u.type];
  const sneakDef = def.sneakAttack;
  if (!sneakDef) return '';
  return `
    <div class="ss-spells-hdr">
      <span class="ss-spell-title">SPECIAL</span>
    </div>
    <div class="ss-sneak">
      <div class="ss-sneak-top">
        <span class="ss-sneak-name">Sneak Attack</span>
        <span class="ss-sneak-dice">+${sneakDef.dice}d${sneakDef.sides}</span>
      </div>
      <div class="ss-sneak-desc">Once per turn · conscious ally adjacent to attacker, or attacker has advantage</div>
      <div class="ss-sneak-crit">Critical hit → +${sneakDef.dice * 2}d${sneakDef.sides}</div>
    </div>`;
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
  const actionsContent = attacksHTML
    ? `<div class="ss-attacks">${attacksHTML}</div>${hasLongRange ? '<div class="ss-range-note">† Long range = disadvantage</div>' : ''}`
    : `<div class="ss-spell-empty">— none —</div>`;

  // ── Bonus Actions ──────────────────────────────────────────────────────────
  const rageDef = def.rage;
  const bonusParts = [];
  if (rageDef) {
    bonusParts.push(`
    <div class="ss-rage">
      <div class="ss-rage-top">
        <span class="ss-rage-name">⚔ Rage</span>
        <span class="ss-rage-uses">×${rageDef.uses} / rest</span>
      </div>
      <div class="ss-rage-bonuses">
        <span class="ss-rage-dmg">+${rageDef.dmgBonus} melee damage</span>
        <span class="ss-rage-resist">½ physical damage</span>
      </div>
      <div class="ss-rage-desc">Lasts full combat · ends if no attack this turn · ${rageDef.uses} uses per long rest</div>
    </div>`);
  }
  if (u.type === 'human' && (u.level ?? 1) >= 2) {
    bonusParts.push(`
    <div class="ss-rage">
      <div class="ss-rage-top">
        <span class="ss-rage-name">🛡 Defensive Stance</span>
        <span class="ss-rage-uses">4-round cooldown</span>
      </div>
      <div class="ss-rage-desc">+3 AC for 3 rounds · activate as a bonus action</div>
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
        <span class="ss-val">${def.ac}</span>
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
    ${def.xpNext ? `<div class="ss-xp">XP: <strong>${u.xp ?? 0}</strong> / ${def.xpNext} &nbsp;(Lvl 2)</div>` : ''}
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

let _lastSpellBarUnit = null;

function updateSpellBar() {
  const u = combatPhase ? turnOrder[turnIndex] : getPCSelected();
  if (u === _lastSpellBarUnit) return;
  _lastSpellBarUnit = u;

  // Clear all buttons when no caster is active
  const clearBtns = () => {
    for (let i = 0; i < 5; i++) {
      const b = document.getElementById(`sb-btn-${i}`);
      if (b)  { b.textContent = ''; b.title = ''; delete b.dataset.spell; }
    }
    for (let i = 0; i < 5; i++) {
      const c = document.getElementById(`sb-cant-${i}`);
      if (c)  { c.innerHTML = ''; c.title = ''; delete c.dataset.spell; }
    }
    document.querySelectorAll('.sb-slot-pip').forEach((pip, i) => {
      pip.classList.remove('filled', 'unavailable');
    });
  };

  if (!u || (u.type !== 'dwarf' && u.type !== 'elf')) { clearBtns(); return; }

  const pool     = u.type === 'dwarf' ? Object.values(SPELLS) : Object.values(ELF_SPELLS);
  const prepared = u.preparedSpells ?? STARTING_SPELLS[u.type] ?? new Set();

  // Slot circles
  const slots    = u.spellSlots    ?? 0;
  const slotsMax = u.spellSlotsMax ?? 2;
  document.querySelectorAll('.sb-slot-pip').forEach((pip, i) => {
    pip.classList.toggle('filled',      i < slots);
    pip.classList.toggle('unavailable', i >= slotsMax);
  });

  // Level-1 spell buttons
  const lvl1 = pool.filter(sp => (sp.level ?? 1) === 1 && prepared.has(sp.key));
  for (let i = 0; i < 5; i++) {
    const btn = document.getElementById(`sb-btn-${i}`);
    if (!btn) continue;
    const sp = lvl1[i];
    btn.title         = sp ? sp.name : '';
    btn.dataset.spell = sp ? sp.key  : '';
    if (!sp) {
      btn.innerHTML = '';
    } else if (sp.imgSrc) {
      btn.innerHTML = `<img src="${sp.imgSrc}" class="sb-spell-img" alt="${sp.name}">`;
    } else {
      btn.textContent = sp.name;
    }
  }

  // Cantrip buttons
  const cantrips = pool.filter(sp => (sp.level ?? 1) === 0 && prepared.has(sp.key));
  for (let i = 0; i < 5; i++) {
    const btn = document.getElementById(`sb-cant-${i}`);
    if (!btn) continue;
    const sp = cantrips[i];
    btn.dataset.spell = sp?.key ?? '';
    btn.title         = sp?.name ?? '';
    if (!sp) {
      btn.innerHTML = '';
    } else if (sp.imgSrc) {
      btn.innerHTML = `<img src="${sp.imgSrc}" class="sb-spell-img" alt="${sp.name}">`;
    } else {
      btn.textContent = sp.name;
    }
  }
}

export function showSheet(u) {
  sheetUnit = u;
  sidePanelEl.classList.remove('show');
  spellListPanelEl.classList.remove('show');
  document.getElementById('ss-btn-abilities')?.classList.remove('active');
  document.getElementById('ss-btn-spellbook')?.classList.remove('active');
  document.getElementById('ss-btn-traits')?.classList.remove('active');
  document.getElementById('ss-btn-equipment')?.classList.remove('active');
  _activeSideBtn = null;
  sheetBody.innerHTML   = buildSheetHTML(u);
  _spellPanelHTML       = buildSpellPanelHTML(u);
  _actionsPanelHTML     = buildActionsPanelHTML(u);
  _traitsPanelHTML      = buildTraitsPanelHTML(u);
  _equipmentPanelHTML   = buildEquipmentPanelHTML(u);
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
  spellListPanelEl.classList.remove('show');
  eqPanelEl?.classList.remove('show');
  document.getElementById('ss-btn-abilities')?.classList.remove('active');
  document.getElementById('ss-btn-spellbook')?.classList.remove('active');
  document.getElementById('ss-btn-traits')?.classList.remove('active');
  document.getElementById('ss-btn-equipment')?.classList.remove('active');
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
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const collapsed = body.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▲' : '▼';
  });
  body.addEventListener('click', e => {
    const btn = e.target.closest('.sb-btn');
    if (!btn || !btn.dataset.spell) return;
    triggerSpellBarAction(btn.dataset.spell);
  });
})();
