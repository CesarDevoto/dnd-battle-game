import { UNIT_TYPES } from './constants.js';

const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

const HERO_COLORS = {
  dwarf:    '#c8860a',
  human:    '#5577ee',
  elf:      '#cc55ee',
  halfling: '#44dd66',
};

// What each hero unlocks at each level.
// imgSrc → show image card. icon → show text icon. Neither → text-only row.
const LEVEL_UNLOCKS = {
  dwarf: {
    2: [
      { name: 'Bless',
        imgSrc: 'assets/spells and skills/bless.jpg',
        desc: 'Target all allies · +1d2 to attack rolls & saving throws · Concentration · costs 1 spell slot' },
      { name: 'Spell Slots ×2',
        icon: '◈',
        desc: '2 level-1 spell slots per combat · replenish on long rest' },
    ],
    3: [
      { name: 'Sacred Flame',
        imgSrc: 'assets/spells and skills/sacred flame.jpg',
        desc: '60 ft · 1d8 radiant · DEX save DC 12 negates · cantrip, no spell slot cost' },
    ],
    4: [
      { name: 'Cure Wounds',
        imgSrc: 'assets/spells and skills/cure wounds.jpg',
        desc: 'Touch · 1d8+2 HP restored · costs 1 spell slot' },
    ],
  },
  human: {
    2: [
      { name: 'Rage: Damage Resistance',
        imgSrc: 'assets/spells and skills/rage.jpg',
        desc: 'Rage now negates 10% of incoming damage (up from none)' },
    ],
    3: [
      { name: 'Rage ×2 Uses',
        imgSrc: 'assets/spells and skills/rage.jpg',
        desc: 'Rage now usable twice per combat (up from once)' },
    ],
    4: [
      { name: 'Precision',
        icon: '◎',
        desc: 'Passive · +1% chance to hit on all attacks · always active' },
    ],
    5: [
      { name: 'Defensive Stance',
        imgSrc: 'assets/spells and skills/defensive stance.jpg',
        desc: 'Bonus action · +3 AC for 3 rounds · 4-round cooldown' },
    ],
  },
  halfling: {
    2: [
      { name: 'Cunning Action: Hide',
        imgSrc: 'assets/spells and skills/hide.jpg',
        desc: 'Bonus action in combat · Stealth check · 2-turn cooldown. Out of combat: hide freely to scout — cuts the detection radius of enemies he can see by 50% so Milo can move solo without aggroing' },
    ],
    3: [
      { name: 'Smoke & Mirrors',
        imgSrc: 'assets/spells and skills/smoke and mirrors.jpg',
        desc: 'Action · once per combat · 10 ft smoke cloud, heavily obscured for 2 rounds · can hide as though in cover · advantage on sneak attacks while inside' },
    ],
    4: [
      { name: 'Precision',
        icon: '◎',
        desc: 'Passive · +1% chance to hit on all attacks · always active' },
    ],
  },
  elf: {
    2: [
      { name: 'Mage Armor',
        imgSrc: 'assets/spells and skills/magearmor.jpg',
        desc: 'Self · +3 AC until long rest · stacks with base AC · costs 1 spell slot' },
      { name: 'Spell Slots ×2',
        icon: '◈',
        desc: '2 level-1 spell slots per combat · replenish on long rest' },
    ],
    3: [
      { name: 'Magic Missile',
        imgSrc: 'assets/spells and skills/magicmissile.jpg',
        desc: '90 ft · 4 darts · 1d4+1 each · auto-hit · free once per combat, then costs 1 spell slot' },
    ],
    4: [
      { name: 'Find Familiar',
        imgSrc: 'assets/spells and skills/find familiar.jpg',
        desc: 'Summon a loyal owl familiar with 1 HP that rides your shoulder · does not attack but acts on its own initiative in combat · can scout, deliver touch spells or do Help action giving you advantage attacking his target' },
    ],
  },
};

let _open = false;
export function isLevelUpModalOpen() { return _open; }

// levelUps: [{ hero, newLevel, hpGain, oldLevel }]
export function showLevelUpModal(levelUps) {
  const byType = Object.fromEntries(levelUps.map(e => [e.hero.type, e]));
  const sections = HERO_ORDER.map(t => byType[t]).filter(Boolean);
  if (!sections.length) return;

  document.getElementById('lum-overlay')?.remove();
  _open = true;
  window.dispatchEvent(new CustomEvent('levelup:modal', { detail: { open: true } }));

  const overlay = document.createElement('div');
  overlay.id = 'lum-overlay';
  overlay.className = 'lum-overlay';

  const panel = document.createElement('div');
  panel.className = 'lum-panel';
  overlay.appendChild(panel);
  document.getElementById('app').appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  let idx = 0;

  function render() {
    const { hero, newLevel, hpGain, oldLevel } = sections[idx];
    const def    = UNIT_TYPES[hero.type] ?? {};
    const color  = HERO_COLORS[hero.type] ?? '#d4af37';
    const isLast = idx === sections.length - 1;

    // Gather unlocks for every level gained (oldLevel+1 … newLevel)
    const unlocks = [];
    const lvlMap  = LEVEL_UNLOCKS[hero.type] ?? {};
    for (let lvl = (oldLevel ?? newLevel - 1) + 1; lvl <= newLevel; lvl++) {
      unlocks.push(...(lvlMap[lvl] ?? []));
    }

    panel.style.setProperty('--hc', color);

    const pipHTML = sections.map((_, i) =>
      `<span class="lum-pip${i === idx ? ' on' : ''}"></span>`
    ).join('');

    const abilityHTML = unlocks.map(u => {
      if (u.imgSrc) {
        return `
          <div class="lum-ability">
            <img src="${u.imgSrc}" class="lum-ability-img" alt="${u.name}">
            <div class="lum-ability-body">
              <div class="lum-ability-name">${u.name}</div>
              <div class="lum-ability-desc">${u.desc}</div>
            </div>
          </div>`;
      } else if (u.icon) {
        return `
          <div class="lum-ability">
            <div class="lum-ability-icon">${u.icon}</div>
            <div class="lum-ability-body">
              <div class="lum-ability-name">${u.name}</div>
              <div class="lum-ability-desc">${u.desc}</div>
            </div>
          </div>`;
      } else {
        return `
          <div class="lum-ability lum-ability-text">
            <div class="lum-ability-body">
              <div class="lum-ability-name">${u.name}</div>
              <div class="lum-ability-desc">${u.desc}</div>
            </div>
          </div>`;
      }
    }).join('');

    panel.innerHTML = `
      <div class="lum-stripe"></div>
      <div class="lum-eyebrow">⬆ LEVEL UP</div>
      <div class="lum-hero-name">${(def.name ?? hero.type).toUpperCase()}</div>
      <div class="lum-hero-class">${def.class ?? ''}</div>
      <div class="lum-reached">Reached <span class="lum-lvl-num">Level ${newLevel}</span></div>
      <div class="lum-gains">
        <div class="lum-gain-row">
          <span class="lum-gain-lbl">HP</span>
          <span class="lum-gain-val">+${hpGain}</span>
        </div>
      </div>
      ${unlocks.length ? `
        <div class="lum-new-hdr">NEW ABILITIES UNLOCKED</div>
        <div class="lum-abilities">${abilityHTML}</div>
      ` : ''}
      <div class="lum-footer">
        <div class="lum-pips">${pipHTML}</div>
        <div class="lum-footer-btns">
          ${idx > 0 ? `<button class="lum-btn lum-btn-back">← BACK</button>` : ''}
          <button class="lum-btn">${isLast ? 'CLOSE' : 'CONTINUE'}</button>
        </div>
      </div>
    `;

    if (idx > 0) {
      panel.querySelector('.lum-btn-back').addEventListener('click', () => { idx--; render(); });
    }
    panel.querySelector('.lum-btn:not(.lum-btn-back)').addEventListener('click', () => {
      if (isLast) {
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 300);
        _open = false;
        window.dispatchEvent(new CustomEvent('levelup:modal', { detail: { open: false } }));
      }
      else { idx++; render(); }
    });
  }

  render();
}
