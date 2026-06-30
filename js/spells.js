// ════════════════════════════════════════════════════════════════════════════
//  SPELLS — Leugren (Dwarf Cleric) spell definitions, bless condition,
//            spell-slot helpers
// ════════════════════════════════════════════════════════════════════════════

export const SPELLS = {
  // ── Cantrips (level 0) ──────────────────────────────────────────────────────
  sacred_flame: {
    key:         'sacred_flame',
    name:        'Sacred Flame',
    level:       0,
    actionType:  'action',
    displayOnly: true,   // not yet implemented in combat
    desc:        '60 ft · 1d8 radiant · DEX save DC 13',
  },
  healing_word: {
    key:        'healing_word',
    name:       'Healing Word',
    level:      0,
    actionType: 'action',
    rangeFt:    60,
    healDice:   1,
    healSides:  8,
    imgSrc:     'assets/Spells/Healingword.jpg',
    desc:       '60 ft · 1d8+WIS hp restored',
  },
  // ── Level 1 ─────────────────────────────────────────────────────────────────
  cure_wounds: {
    key:        'cure_wounds',
    name:       'Cure Wounds',
    level:      1,
    actionType: 'action',
    rangeFt:    5,
    healDice:   1,
    healSides:  8,
    healMod:    2,
    desc:       'Touch · 1d8+2 hp restored',
  },
  bless: {
    key:           'bless',
    name:          'Bless',
    level:         1,
    actionType:    'action',
    concentration: true,
    imgSrc:        'assets/Spells/bless.jpg',
    desc:          'Party · all allies · +1d4 to atk & saves · conc',
  },
};

// ── Bless condition state ─────────────────────────────────────────────────────
export const blessedUnits = new Set();   // Set<unit object>
export let concentrating      = null;    // unit currently concentrating
export let concentratingSpell = '';      // name of the spell being concentrated on
let _blessRoundsLeft = 0;
export function getBlessRoundsLeft() { return _blessRoundsLeft; }

export function applyBless(caster, targets) {
  blessedUnits.clear();
  _blessRoundsLeft    = 10;   // 1 minute = 10 rounds
  concentrating       = caster;
  concentratingSpell  = 'Bless';
  targets.forEach(u => blessedUnits.add(u));
}

export function clearBless() {
  blessedUnits.clear();
  _blessRoundsLeft    = 0;
  concentrating       = null;
  concentratingSpell  = '';
}

export function tickBless() {
  if (!_blessRoundsLeft) return;
  _blessRoundsLeft--;
  if (_blessRoundsLeft <= 0) clearBless();
}

// ── Rasec (Elf Mage) spells ───────────────────────────────────────────────────
export const ELF_SPELLS = {
  // ── Cantrips (level 0) ──────────────────────────────────────────────────────
  fire_bolt: {
    key:         'fire_bolt',
    name:        'Fire Bolt',
    level:       0,
    actionType:  'action',
    imgSrc:      'assets/Spells/Firebolt.jpg',
    displayOnly: true,   // combat handled via attacks[] in constants.js
    desc:        '120 ft · 1d10+INT fire · INT to hit',
  },
  // ── Level 1 ─────────────────────────────────────────────────────────────────
  mage_armor: {
    key:        'mage_armor',
    name:       'Mage Armor',
    level:      1,
    actionType: 'action',
    imgSrc:     'assets/Spells/magearmor.jpg',
    desc:       'Self · +3 AC until long rest · stacks with base AC',
  },
  magic_missile: {
    key:       'magic_missile',
    name:      'Magic Missile',
    level:     1,
    actionType:'action',
    rangeFt:   120,
    darts:     3,
    dice:      1,
    sides:     4,
    flatBonus: 1,
    desc:      '120 ft · 3 darts · 1d4+1 each · auto-hit',
  },
  burning_hands: {
    key:       'burning_hands',
    name:      'Burning Hands',
    level:     1,
    actionType:'action',
    rangeFt:   15,
    dice:      3,
    sides:     6,
    saveStat:  'dex',
    saveDC:    13,
    desc:      '15 ft cone · 3d6 fire · DEX DC 13 for half',
  },
};

// Spells available from level 1
export const STARTING_SPELLS = {
  dwarf: new Set(['healing_word']),
  elf:   new Set(['fire_bolt']),
};

// Abilities/spells that unlock at specific levels (keyed by required level).
// Values are action/bonus-action keys used by both the tendencies system
// and _tryHeroAction in combat.js. Add new entries here as heroes gain abilities.
export const LEVEL_SPELLS = {
  dwarf:    { 2: ['bless'] },
  elf:      { 2: ['mage_armor'] },
  human:    { 2: ['defensive_stance'] },
  halfling: { 2: ['hide'] },
};

// ── Spell slot initialisation (called when battle begins) ─────────────────────
export function initSpellSlots(units) {
  units.forEach(u => {
    const lvl = u.level ?? 1;
    if (u.type === 'dwarf') {
      const clericSlots = lvl >= 3 ? 3 : lvl >= 2 ? 2 : 0;
      u.spellSlots     = clericSlots;
      u.spellSlotsMax  = clericSlots;
      u.preparedSpells = new Set(STARTING_SPELLS[u.type]);
    } else if (u.type === 'elf') {
      const elfSlots   = lvl >= 2 ? 2 : 0;
      u.spellSlots     = elfSlots;
      u.spellSlotsMax  = elfSlots;
      u.preparedSpells = new Set(STARTING_SPELLS[u.type]);
    } else {
      return;
    }
    // Add any spells that unlock at or below the hero's current level
    for (const [reqLvl, keys] of Object.entries(LEVEL_SPELLS[u.type] ?? {})) {
      if (lvl >= +reqLvl) keys.forEach(k => u.preparedSpells.add(k));
    }
  });
}
