// js/spellbook.js — Spell Index overlay

const SPELL_DATA = [
  // ── Cantrips ───────────────────────────────────────────────────────────────
  {
    name:       'Fire Bolt',
    level:      0,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '90 ft',
    effect:     '1d10+INT fire',
    effectNote: 'INT + prof to hit',
    conc:       false,
    desc: 'Hurl a mote of fire at a creature or object. Make a ranged spell attack (INT modifier + proficiency to hit). On a hit the target takes 1d10 + INT modifier fire damage. Flammable objects ignite.',
  },
  {
    name:       'Sacred Flame',
    level:      0,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      '60 ft',
    effect:     '1d8 radiant',
    effectNote: 'DEX save DC 13',
    conc:       false,
    notImpl:    true,
    desc: 'Flame-like radiance descends on a creature you can see. It must succeed on a DEX saving throw or take 1d8 radiant damage. Cover provides no benefit against this spell.',
  },
  {
    // Level 0 to match js/spells.js, where Turn Undead sits in Leugren's CANTRIP row rather
    // than costing a slot — not 5e's Channel Divinity. The index follows the game.
    name:       'Turn Undead',
    level:      0,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      '30 ft',
    effect:     'Frightened + Incapacitated',
    effectNote: 'undead only · WIS DC 13 · once per combat',
    conc:       false,
    desc: 'Undead within range must succeed on a WIS saving throw DC 13 or become Frightened and Incapacitated for 1 minute, fleeing from you and unable to act. A turned creature shakes it off early if it takes damage. Usable once per combat, and has no effect on the living.',
  },
  // ── 1st Level ──────────────────────────────────────────────────────────────
  {
    name:       'Bless',
    level:      1,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      '30 ft',
    effect:     '+1d2 atk & saves',
    effectNote: 'up to 3 allies · 10 rounds',
    conc:       true,
    desc: 'You bless up to 3 creatures within range. Each blessed target adds 1d2 to every attack roll and saving throw for the duration. Requires concentration, up to 1 minute.',
  },
  {
    name:       'Cure Wounds',
    level:      1,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      'Touch',
    effect:     '2d6+2 HP',
    effectNote: 'healing',
    conc:       false,
    desc: 'A creature you touch regains 2d6 + 2 hit points. No effect on undead or constructs.',
  },
  {
    name:       'Healing Word',
    level:      0,
    spellClass: 'Cleric',
    actionType: 'Bonus',
    range:      '60 ft',
    effect:     '1d8+WIS HP',
    effectNote: 'healing',
    conc:       false,
    desc: 'A creature you can see within range regains 1d8 + WIS modifier hit points. Cast as a bonus action, leaving the main action free.',
  },
  {
    name:       'Sanctuary',
    level:      1,
    spellClass: 'Cleric',
    actionType: 'Bonus',
    range:      '30 ft',
    effect:     'Ward one ally',
    effectNote: 'WIS DC 13 to attack them · 10 rounds',
    conc:       false,
    desc: 'Ward an ally you can see within range. Any enemy that tries to attack them must first succeed on a WIS saving throw DC 13; on a failure it cannot attack that target at all and must choose a different one. Lasts 1 minute, and ends early the moment the warded ally makes an attack of their own.',
  },
  {
    name:       'Burning Hands',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '15 ft cone',
    effect:     '3d6 fire',
    effectNote: 'DEX DC 13 half',
    conc:       false,
    desc: 'A thin sheet of flame jets from outstretched fingertips in a 15 ft cone, aimed where you choose — the grid lights up the squares it covers. The cone is as wide at any point as that point is far from you, and your own square is not included. Each creature caught must make a DEX saving throw DC 13, taking 3d6 fire damage on a failure or half on a success.',
  },
  {
    name:       'Mage Armor',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      'Self',
    effect:     '+3 AC',
    effectNote: 'until long rest · stacks with base AC',
    conc:       false,
    desc: 'You sheathe yourself in a protective magical force, gaining +3 AC. Unlike the book version this stacks on top of your existing armour rather than replacing it, and it lasts until your next long rest instead of expiring on a timer.',
  },
  {
    name:       'Magic Missile',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '90 ft',
    effect:     '3 × (1d4+1) force',
    effectNote: 'auto-hit',
    conc:       false,
    desc: 'Three glowing darts of magical force unerringly strike one or more targets. Each dart deals 1d4 + 1 force damage. All three can be directed at the same creature.',
  },
  {
    name:       'Find Familiar',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '10 ft',
    effect:     'Summon owl familiar',
    effectNote: 'ritual · rides your shoulder',
    conc:       false,
    desc: 'You summon a loyal otherworldly spirit that takes the form of an owl. It rests on your shoulder out of combat and acts on its own initiative in battle — it can scout, take the Help action to grant you advantage, and moves with a 60 ft fly speed. Its Flyby means it never provokes opportunity attacks.',
  },
  {
    name:       'Sleep',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '90 ft · 20 ft radius',
    effect:     '5d8 HP pool',
    effectNote: 'around the target · lowest HP first · 10 rounds',
    conc:       false,
    desc: 'Choose a target within 90 ft, then roll 5d8 to determine how many hit points of creatures are affected. Starting from the creature with the lowest current HP, each enemy within 20 ft of that target falls unconscious until the spell ends or the creature takes damage.',
  },
  {
    name:       'Silvery Barbs',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Reaction',
    range:      '60 ft',
    effect:     'Force a reroll',
    effectNote: 'lower roll · ally gains ADV',
    conc:       false,
    notImpl:    true,
    desc: 'When a creature you can see within 60 ft succeeds on an attack roll, ability check, or saving throw, you can react to force it to reroll and use the lower result. A different creature you can see (you may choose yourself) then has advantage on its next attack roll, ability check, or saving throw within 1 minute.',
  },
  // ── 2nd Level ──────────────────────────────────────────────────────────────
  {
    name:       'Misty Step',
    level:      2,
    spellClass: 'Wizard',
    actionType: 'Bonus',
    range:      'Self',
    effect:     'Teleport 30 ft',
    effectNote: 'to a space you can see',
    conc:       false,
    notImpl:    true,
    desc: 'Briefly surrounded by silvery mist, you teleport up to 30 feet to an unoccupied space you can see. Cast as a bonus action.',
  },
  {
    name:       'Web',
    level:      2,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '60 ft',
    effect:     'Restrain in webbing',
    effectNote: 'DEX save · 20 ft cube · conc',
    conc:       true,
    notImpl:    true,
    desc: 'You conjure a mass of thick, sticky webbing filling a 20-ft cube within range. The webs are difficult terrain and lightly obscure the area. A creature that starts its turn in the webs or enters them must make a DEX saving throw or be restrained while caught. A restrained creature can use its action to make a STR check to break free. Concentration, up to 1 hour.',
  },
  // ── 3rd Level ──────────────────────────────────────────────────────────────
  {
    name:       'Counterspell',
    level:      3,
    spellClass: 'Wizard',
    actionType: 'Reaction',
    range:      '60 ft',
    effect:     'Negate a spell',
    effectNote: 'lvl ≤ 3 auto · else check',
    conc:       false,
    notImpl:    true,
    desc: "When you see a creature within 60 ft casting a spell, you attempt to interrupt it. If the creature is casting a spell of 3rd level or lower, its spell automatically fails. If 4th level or higher, make a spellcasting ability check (DC 10 + the spell's level); on a success the spell fails and has no effect.",
  },
  {
    name:       'Fly',
    level:      3,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      'Touch',
    effect:     '60 ft fly speed',
    effectNote: 'willing target · conc · 10 min',
    conc:       true,
    notImpl:    true,
    desc: 'You touch a willing creature, granting it a flying speed of 60 feet for the duration. When the spell ends, the target falls if it is still aloft. Concentration, up to 10 minutes.',
  },
  {
    name:       'Hypnotic Pattern',
    level:      3,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '120 ft',
    effect:     'Charm & incapacitate',
    effectNote: 'WIS save · 30 ft cube · conc',
    conc:       true,
    notImpl:    true,
    desc: 'You create a twisting pattern of colors in a 30-ft cube within range. Each creature in the area that can see it must succeed on a WIS saving throw or become charmed — incapacitated, with a speed of 0 — for the duration. The effect ends for a creature if it takes any damage or if someone else uses an action to shake it out of the stupor. Concentration, up to 1 minute.',
  },
  {
    name:       'Spirit Guardians',
    level:      3,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      'Self (15 ft)',
    effect:     '3d8 radiant',
    effectNote: 'WIS save half · speed halved · conc',
    conc:       true,
    notImpl:    true,
    desc: 'Protective spirits flit around you in a 15-ft radius for the duration. An enemy that enters the area for the first time on a turn or starts its turn there takes 3d8 radiant damage (WIS saving throw for half), and the area is difficult terrain for your enemies. Concentration, up to 10 minutes.',
  },
  // ── 4th Level ──────────────────────────────────────────────────────────────
  {
    name:       'Polymorph',
    level:      4,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '60 ft',
    effect:     'Transform into a beast',
    effectNote: 'WIS save negates · conc',
    conc:       true,
    notImpl:    true,
    desc: "You transform a creature you can see within range into a new form — a beast whose challenge rating is no higher than the target's level. An unwilling target makes a WIS saving throw to avoid the effect. Its game statistics are replaced by the beast's (it keeps its alignment and personality), and it can't cast spells or take actions the new form can't. It reverts when it drops to 0 hit points in beast form or when the spell ends. Concentration, up to 1 hour.",
  },
];

const LEVEL_LABELS = { 0: 'Cantrip', 1: '1st Level', 2: '2nd Level', 3: '3rd Level', 4: '4th Level' };

const CLASS_META = {
  Cleric: { cls: 'sp-cleric', abbr: 'CLR' },
  Wizard: { cls: 'sp-wizard', abbr: 'WIZ' },
};

const ACTION_META = {
  Action:   { cls: 'sp-act-action',   abbr: 'A' },
  Bonus:    { cls: 'sp-act-bonus',    abbr: 'BA' },
  Reaction: { cls: 'sp-act-reaction', abbr: 'R' },
};

const COL_COUNT = 7;

function buildTable() {
  const levels  = [...new Set(SPELL_DATA.map(s => s.level))].sort((a, b) => a - b);

  let rows = '';
  for (const lvl of levels) {
    const spells = SPELL_DATA.filter(s => s.level === lvl)
      .sort((a, b) => a.spellClass.localeCompare(b.spellClass) || a.name.localeCompare(b.name));

    rows += `<tr class="sp-lvl-row" data-level="${lvl}"><td colspan="${COL_COUNT}">${LEVEL_LABELS[lvl] ?? `${lvl}th Level`}</td></tr>`;

    for (const sp of spells) {
      const cm  = CLASS_META[sp.spellClass]  ?? { cls: '', abbr: sp.spellClass };
      const am  = ACTION_META[sp.actionType] ?? { cls: '', abbr: sp.actionType };

      const concBadge = sp.conc
        ? `<span class="sp-badge sp-conc">CONC</span>`
        : '';
      const notImplBadge = sp.notImpl
        ? `<span class="sp-badge sp-notimpl">NYI</span>`
        : '';

      rows += `
        <tr class="sp-spell-row" data-name="${sp.name.toLowerCase()}" data-level="${lvl}">
          <td class="sp-name-cell">${sp.name}${concBadge}${notImplBadge}</td>
          <td class="sp-class-cell"><span class="sp-class-tag ${cm.cls}">${cm.abbr}</span></td>
          <td class="sp-act-cell"><span class="sp-act-tag ${am.cls}">${am.abbr}</span></td>
          <td class="sp-range-cell">${sp.range}</td>
          <td class="sp-effect-cell">
            <div class="sp-effect-main">${sp.effect}</div>
            ${sp.effectNote ? `<div class="sp-effect-note">${sp.effectNote}</div>` : ''}
          </td>
          <td class="sp-desc-cell">${sp.desc}</td>
        </tr>`;
    }
  }

  document.getElementById('spellbook-subtitle').textContent =
    `Spell Compendium · ${SPELL_DATA.length} Spells`;

  return `
    <table class="sp-table">
      <thead>
        <tr>
          <th class="sp-th-name">NAME</th>
          <th class="sp-th-class">CLASS</th>
          <th class="sp-th-act">ACTION</th>
          <th class="sp-th-range">RANGE</th>
          <th class="sp-th-effect">EFFECT</th>
          <th class="sp-th-desc">DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div id="spellbook-no-results">No spells match your search.</div>`;
}

function filterSpellbook(query) {
  const q     = query.toLowerCase().trim();
  const tbody = document.querySelector('.sp-table tbody');
  if (!tbody) return;

  let anyVisible  = false;
  const visLevels = new Set();

  tbody.querySelectorAll('tr.sp-spell-row').forEach(row => {
    const match = !q || row.dataset.name.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) { visLevels.add(row.dataset.level); anyVisible = true; }
  });

  tbody.querySelectorAll('tr.sp-lvl-row').forEach(row => {
    row.style.display = visLevels.has(row.dataset.level) ? '' : 'none';
  });

  const noResults = document.getElementById('spellbook-no-results');
  if (noResults) noResults.style.display = anyVisible ? 'none' : 'block';
}

export function initSpellbook() {
  const overlay  = document.getElementById('spellbook-overlay');
  const closeBtn = document.getElementById('spellbook-close');
  const body     = document.getElementById('spellbook-body');
  const searchEl = document.getElementById('spellbook-search');
  const clearBtn = document.getElementById('spellbook-search-clear');

  body.innerHTML = buildTable();

  document.getElementById('spellbook-btn').addEventListener('click', () => {
    overlay.classList.add('show');
    searchEl.focus();
  });
  closeBtn.addEventListener('click', () => overlay.classList.remove('show'));
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') overlay.classList.remove('show');
  });

  searchEl.addEventListener('input', () => {
    const val = searchEl.value;
    clearBtn.classList.toggle('visible', val.length > 0);
    filterSpellbook(val);
  });

  clearBtn.addEventListener('click', () => {
    searchEl.value = '';
    clearBtn.classList.remove('visible');
    filterSpellbook('');
    searchEl.focus();
  });
}
