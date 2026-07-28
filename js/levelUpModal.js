import { UNIT_TYPES, proficiencyBonusFor, rageUsesForLevel, rageDamageForLevel,
         weaponMasteryForLevel, sneakAttackDiceForLevel, dndLevelFor } from './constants.js';
import { maxSlotsForLevel } from './spells.js';

const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

// ── Table-driven gains ────────────────────────────────────────────────────────
// Everything that comes from a class table (proficiency, rages, rage damage, weapon
// mastery, sneak dice, spell slots) is DERIVED by diffing the table at oldLevel vs
// newLevel — never hand-listed in LEVEL_UNLOCKS below. Two reasons:
//   1. Our levels are 5 per D&D level, so a gain lands on whatever game level crosses
//      the band. Hand-listing it means guessing the band boundary, and the boundaries
//      move the moment XP_THRESHOLDS expands toward 100.
//   2. It was already wrong. LEVEL_UNLOCKS used to claim "Spell Slots ×2" at level 2
//      and "Rage ×2 Uses" at level 3; both casters now have 2 slots from level 1 and
//      Gobo 2 rages from level 1, so those rows were lying to the player.
// Diffing also handles multi-level jumps for free (progression.js aggregates them and
// keeps the ORIGINAL oldLevel), and prints nothing when a level-up crosses no band.
const _ORD = ['1st','2nd','3rd','4th','5th','6th','7th','8th','9th'];

function _tableGains(hero, oldLevel, newLevel) {
  const rows = [];
  const add = (lbl, from, to, fmt = v => `${v}`) => {
    if (from === to) return;
    rows.push({ lbl, val: fmt(to), was: `was ${fmt(from)}` });
  };

  add('Proficiency', proficiencyBonusFor(oldLevel), proficiencyBonusFor(newLevel), v => `+${v}`);

  if (hero.type === 'human') {
    add('Rages',          rageUsesForLevel(oldLevel),      rageUsesForLevel(newLevel));
    add('Rage Damage',    rageDamageForLevel(oldLevel),    rageDamageForLevel(newLevel), v => `+${v}`);
    // Shown because it's a real table value, but nothing consumes it yet — there is no
    // weapon-proficiency gating in the code, so this grants no actual choice today.
    add('Weapon Mastery', weaponMasteryForLevel(oldLevel), weaponMasteryForLevel(newLevel));
  } else if (hero.type === 'halfling') {
    add('Sneak Attack', sneakAttackDiceForLevel(oldLevel), sneakAttackDiceForLevel(newLevel), v => `${v}d6`);
  } else if (hero.type === 'elf' || hero.type === 'dwarf') {
    // Per spell level, so gaining your first 2nd-level slots reads as its own line
    // rather than being buried in a total.
    const before = maxSlotsForLevel(hero.type, oldLevel);
    const after  = maxSlotsForLevel(hero.type, newLevel);
    for (let i = 0; i < after.length; i++) {
      const b = before[i] ?? 0, a = after[i] ?? 0;
      if (a === b) continue;
      rows.push({ lbl: `${_ORD[i]}-level slots`, val: `${a}`, was: b ? `was ${b}` : 'new' });
    }
  }
  return rows;
}

const HERO_COLORS = {
  dwarf:    '#c8860a',
  human:    '#5577ee',
  elf:      '#cc55ee',
  halfling: '#44dd66',
};

// Bespoke unlocks — named abilities with their own art and rules text, keyed by GAME
// level. Anything that comes from a class table belongs in _tableGains above, NOT here:
// a hand-listed table value goes stale the moment a band boundary moves.
// imgSrc → show image card. icon → show text icon. Neither → text-only row.
const LEVEL_UNLOCKS = {
  dwarf: {
    2: [
      { name: 'Bless',
        imgSrc: 'assets/spells and skills/bless.jpg',
        desc: 'Target all allies · +1d2 to attack rolls & saving throws · Concentration · costs 1 spell slot' },
    ],
    3: [
      { name: 'Sacred Flame',
        imgSrc: 'assets/spells and skills/sacred flame.jpg',
        desc: '60 ft · 1d8 radiant · DEX save DC 12 negates · cantrip, no spell slot cost' },
    ],
    4: [
      { name: 'Cure Wounds',
        imgSrc: 'assets/spells and skills/cure wounds.jpg',
        desc: 'Touch · 2d6+2 HP restored · costs 1 spell slot' },
    ],
    5: [
      { name: 'Turn Undead',
        imgSrc: 'assets/spells and skills/turn undead.jpg',
        desc: 'Action · 30 ft · Undead only · each must pass WIS DC 13 or be Frightened and Incapacitated for 1 minute, fleeing from you · ends early on any damage · once per combat, costs NO spell slot' },
    ],
    6: [
      { name: 'Sanctuary',
        imgSrc: 'assets/spells and skills/sanctuary.jpg',
        desc: 'Bonus action · 30 ft · click an ally to ward them (yourself included) · an enemy must pass WIS DC 13 to attack them at all, or it must pick a different target · 1 minute · ends if the warded ally attacks · costs 1 spell slot' },
    ],
  },
  human: {
    2: [
      { name: 'Rage: Damage Resistance',
        imgSrc: 'assets/spells and skills/rage.jpg',
        desc: 'Rage now negates 10% of incoming damage (up from none)' },
    ],
    4: [
      { name: 'Precision',
        imgSrc: 'assets/spells and skills/precision.jpg',
        desc: 'Passive · +1% chance to hit on all attacks · always active' },
    ],
    5: [
      { name: 'Defensive Stance',
        imgSrc: 'assets/spells and skills/defensive stance.jpg',
        desc: 'Bonus action · +3 AC for 3 rounds · 4-round cooldown' },
    ],
    6: [
      { name: 'Reckless Attack',
        imgSrc: 'assets/spells and skills/recklessattack.jpg',
        desc: 'Free — costs no action at all · declare it before you swing · advantage on your melee attacks, but every attack against you has advantage until the start of your next turn' },
    ],
    7: [
      { name: 'Second Wind',
        imgSrc: 'assets/spells and skills/secondwind.jpg',
        desc: 'Out of combat (Q) · heal yourself 1d8+2 · once between fights, plus one extra use per point of belt Resource-regen' },
    ],
  },
  halfling: {
    2: [
      // Renamed from "Cunning Action: Hide" (user, 2026-07-18): out-of-combat stealth is no
      // longer Milo's alone — the whole party sneaks via the MOVE-widget Stealth button — so
      // the description no longer claims the OOC scouting half as this ability's own.
      { name: 'Combat Hide',
        imgSrc: 'assets/spells and skills/hide.jpg',
        desc: 'Bonus action in combat · Stealth check · 2-turn cooldown. Only usable when no enemy has line of sight to Milo (unless he is inside his own Smoke & Mirrors). Permits subsequent sneak attack on any target if successful.' },
    ],
    3: [
      { name: 'Smoke & Mirrors',
        imgSrc: 'assets/spells and skills/smoke and mirrors.jpg',
        desc: 'Action · twice per combat · lasts for 2 rounds · 10 ft smoke cloud · while within 10 ft of its centre: heavily obscured (+3 AC), advantage on Sneak Attacks, and Hide auto-succeeds' },
    ],
    4: [
      { name: 'Precision',
        imgSrc: 'assets/spells and skills/precision.jpg',
        desc: 'Passive · +1% chance to hit on all attacks · always active' },
    ],
    5: [
      { name: 'Sleight of Hand',
        imgSrc: 'assets/spells and skills/sleightofhand.jpg',
        desc: 'Passive proficiency · a Dexterity skill for manual trickery, stealthy theft and concealing items · adds your proficiency bonus to the roll whenever something calls for it · no button: it is the check other things ask you to make' },
    ],
    6: [
      { name: 'Pick Locks',
        imgSrc: 'assets/spells and skills/picklocks.jpg',
        desc: 'Out of combat (Q) · requires the Thieves’ Tools in your bag · Sleight of Hand check vs the lock (DC 15 for a normal one) · one attempt between fights, plus one per point of belt Resource-regen' },
    ],
  },
  elf: {
    2: [
      { name: 'Mage Armor',
        imgSrc: 'assets/spells and skills/magearmor.jpg',
        desc: 'Self · +3 AC until long rest · stacks with base AC · costs 1 spell slot' },
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
    5: [
      { name: 'Sleep',
        imgSrc: 'assets/spells and skills/sleep.jpg',
        desc: 'Action · pick a target within 90 ft · roll a 5d8 hit-point pool and spend it on the enemies within 20 ft of that target, weakest first — each one it covers falls asleep for 1 minute · any damage wakes them · costs 1 spell slot' },
    ],
    6: [
      { name: 'Burning Hands',
        imgSrc: 'assets/spells and skills/burninghands.jpg',
        desc: 'Action · 15 ft around you · 3d6 fire to every enemy caught · DEX DC 13 for half · widened by the off-hand AoE-radius affix · costs 1 spell slot' },
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
    const _from   = oldLevel ?? newLevel - 1;
    const unlocks = [];
    const lvlMap  = LEVEL_UNLOCKS[hero.type] ?? {};
    for (let lvl = _from + 1; lvl <= newLevel; lvl++) {
      unlocks.push(...(lvlMap[lvl] ?? []));
    }
    // Table-driven gains across the whole jump. Empty on a level-up that crosses no
    // D&D band, which is most of them — 4 of every 5 levels change nothing here.
    const gains = _tableGains(hero, _from, newLevel);

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
        ${gains.map(g => `
        <div class="lum-gain-row">
          <span class="lum-gain-lbl">${g.lbl}</span>
          <span class="lum-gain-val">${g.val}<span class="lum-gain-was">${g.was}</span></span>
        </div>`).join('')}
      </div>
      ${gains.length ? `<div class="lum-band-note">Level ${newLevel} reaches D&amp;D tier ${dndLevelFor(newLevel)}</div>` : ''}
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
