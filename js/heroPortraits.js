import { units, heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { combatPhase, turnOrder, turnIndex } from './combat.js';
import { showInventory } from './ui.js';
import { blessedUnits, concentrating, concentratingSpell, getBlessRoundsLeft } from './spells.js';

const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

export const AVATAR_SRC = {
  elf:      'assets/Pictures Cutscenes Icons/rasecavatar.jpg',
  dwarf:    'assets/Pictures Cutscenes Icons/leugrenavatar.jpg',
  human:    'assets/Pictures Cutscenes Icons/goboavatar.jpg',
  halfling: 'assets/Pictures Cutscenes Icons/mioavatar.jpg',
};

// ── Card registry ─────────────────────────────────────────────────────────────
const _cards = {};

// No-op: static images don't need a render call
export function renderHeroPortrait(_unit) {}

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
    card.dataset.heroType = type;

    // ── Top row: [portrait img] [stats col | sheet+bag btns] ──────────
    const topRow = document.createElement('div');
    topRow.className = 'hpc-top-row';

    const avatarImg = document.createElement('img');
    avatarImg.src       = AVATAR_SRC[type] ?? '';
    avatarImg.className = 'hpc-avatar';
    avatarImg.draggable = false;
    avatarImg.alt       = def.name;

    const meta = document.createElement('div');
    meta.className = 'hpc-meta';

    const statsCol = document.createElement('div');
    statsCol.className = 'hpc-stats';

    // ONE button opens the hero's sheet (user, 2026-07-18: the separate scroll/sheet icon was
    // removed and this one relabelled "Character Sheet"). It was never a second destination —
    // showInventory() calls showSheet() and then opens the equipment side panel, so this always
    // opened the sheet; the two icons were one screen reached two ways. Once it's open, the
    // sheet's own side buttons (spellbook / traits / XP / equipment) do the rest.
    //
    // Drawn as an SVG rather than an emoji — the card's icons are all line art.
    const invBtn = document.createElement('button');
    invBtn.className = 'hpc-inv-btn';
    invBtn.title     = 'Character Sheet';
    invBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 18" width="15" height="19" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6.5 Q5 3 7 3 Q9 3 9 6.5" stroke-width="0.9"/><path d="M2.5 8 Q2.5 6.5 4 6.5 L10 6.5 Q11.5 6.5 11.5 8 L11.5 14.5 Q11.5 16 10 16 L4 16 Q2.5 16 2.5 14.5 Z" fill="currentColor" fill-opacity="0.15" stroke-width="0.9"/><path d="M2.5 10.5 L11.5 10.5" stroke-width="0.9"/><path d="M6.1 11 L6.1 12.8 L7.9 12.8 L7.9 11" fill="currentColor" fill-opacity="0.4" stroke-width="0.85"/></svg>`;
    invBtn.addEventListener('click', e => {
      e.stopPropagation();
      // heroRoster, NOT units — a dead/removed-from-combat hero is still a real, persistent
      // hero whose equipment and bag must stay editable (e.g. assigning loot right after they
      // fall). units.find returns undefined for them, which would fall back to a disconnected
      // stub with an empty bag and make just-assigned items appear to vanish.
      const u = heroRoster.find(u => u.type === type);
      showInventory(u ?? { type, hp: UNIT_TYPES[type].hp });
    });

    // Column kept even though it now holds a single button — the CSS positions the COLUMN
    // (see .hpc-btn-col), so collapsing it would move the button.
    const btnCol = document.createElement('div');
    btnCol.className = 'hpc-btn-col';
    btnCol.appendChild(invBtn);

    meta.appendChild(statsCol);
    meta.appendChild(btnCol);
    topRow.appendChild(avatarImg);
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

    _cards[type] = { card, fill: fillEl, hpText: hpCurEl, invBtn, maxHp: def.hp, condEl };
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

  window.addEventListener('hero:levelup', e => {
    const refs = _cards[e.detail.hero.type];
    if (refs) refs.maxHp = e.detail.hero.maxHp;
  });
}

export function updateHeroUI() {
  const activeUnit = turnOrder[turnIndex] ?? null;
  let activeHasConds = false;

  for (const type of HERO_ORDER) {
    const refs = _cards[type];
    if (!refs) continue;

    const u = units.find(u => u.team === 'blue' && u.type === type);

    // HP / dead state. The sheet button is disabled ONLY for a hero who is dead DURING combat;
    // out of combat it stays live even for a fallen hero, which is what makes assigning loot to
    // them possible (see the heroRoster note on the click handler).
    if (u) {
      refs.card.classList.remove('hpc-dead');
      refs.fill.style.width   = Math.max(0, (u.hp / u.maxHp) * 100) + '%';
      refs.hpText.textContent = `${Math.max(0, u.hp)}/${u.maxHp}`;
      refs.invBtn.disabled    = false;
    } else if (combatPhase) {
      refs.card.classList.add('hpc-dead');
      refs.fill.style.width   = '0%';
      refs.hpText.textContent = `0/${refs.maxHp}`;
      refs.invBtn.disabled    = true;
    } else {
      refs.invBtn.disabled   = false;
    }

    // Conditions — shown to the right of this hero's card
    if (refs.condEl) {
      let badges = '';
      if (u && u.raging)
        badges += `<span class="cond-badge cond-rage">⚔ Raging</span>`;
      if (u && u.defStanceActive)
        badges += `<span class="cond-badge cond-stance">🛡 Def Stance<span class="cond-turns">${u.defStanceRounds}t</span></span>`;
      if (u && u.mageArmored)
        badges += `<span class="cond-badge cond-mage-armor">✦ Mage Armor · AC ${(u.ac ?? 12) + 3}<span class="cond-turns">∞</span></span>`;
      if (u && blessedUnits.has(u))
        badges += `<span class="cond-badge">✦ Blessed: 1d2 Atk &amp; ST<span class="cond-turns">${getBlessRoundsLeft()}t</span></span>`;
      if (u && concentrating === u)
        badges += `<span class="cond-badge cond-conc">◈ Concentrating: ${concentratingSpell}<span class="cond-turns">${getBlessRoundsLeft()}t</span></span>`;
      if (u && u.stealthed && u.team === 'blue')
        badges += `<span class="cond-badge cond-stealth">👁 Hidden</span>`;

      // ── Debuffs. Everything above is a buff; these are the bad ones, and they all carry
      // cond-debuff, which is what paints them red. Any future debuff goes here with that
      // class so the colour stays a rule rather than a per-badge decision.
      // Action-save conditions (web/grapple/…) — generic, driven off u.actionSave, so any
      // future one shows up here for free.
      if (u && u.actionSave)
        badges += `<span class="cond-badge cond-debuff cond-restrained">🕸 ${u.actionSave.name}` +
                  `<span class="cond-turns">d100 ≥ ${u.actionSave.threshold}</span></span>`;

      // Guarded: this runs for all 4 hero cards every frame, and `badges` is almost always
      // the identical string (usually ''). An unconditional innerHTML write re-parses the
      // markup and invalidates style 240x a second for no change at all.
      if (badges !== refs._lastBadges) {
        refs._lastBadges = badges;
        refs.condEl.innerHTML = badges;
        refs.condEl.classList.toggle('has-content', badges.length > 0);
      }

      if (u === activeUnit && badges.length > 0) activeHasConds = true;
    }
  }

  // Shift blue HUD right only when the active hero has conditions
  if (blueHudEl) {
    blueHudEl.classList.toggle('conds-offset', activeHasConds);
  }
}
