// js/spellbook.js — Spell Index overlay

const SPELL_DATA = [
  // ── Cantrips ───────────────────────────────────────────────────────────────
  {
    name:       'Fire Bolt',
    level:      0,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '120 ft',
    effect:     '1d10+INT fire',
    effectNote: 'INT to hit',
    conc:       false,
    desc: 'Hurl a mote of fire at a creature or object. Make a ranged spell attack. On a hit the target takes 1d10 + INT modifier fire damage. Flammable objects ignite.',
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
  // ── 1st Level ──────────────────────────────────────────────────────────────
  {
    name:       'Bless',
    level:      1,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      '30 ft',
    effect:     '+1d4 atk & saves',
    effectNote: 'up to 3 allies · 10 rounds',
    conc:       true,
    desc: 'You bless up to 3 creatures within range. Each blessed target adds 1d4 to every attack roll and saving throw for the duration. Requires concentration, up to 1 minute.',
  },
  {
    name:       'Cure Wounds',
    level:      1,
    spellClass: 'Cleric',
    actionType: 'Action',
    range:      'Touch',
    effect:     '1d8+2 HP',
    effectNote: 'healing',
    conc:       false,
    desc: 'A creature you touch regains 1d8 + 2 hit points. No effect on undead or constructs.',
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
    name:       'Burning Hands',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '15 ft cone',
    effect:     '3d6 fire',
    effectNote: 'DEX DC 13 half',
    conc:       false,
    desc: 'A thin sheet of flame jets from outstretched fingertips in a 15 ft cone. Each creature in the area must make a DEX saving throw DC 13, taking 3d6 fire damage on a failure or half on a success.',
  },
  {
    name:       'Magic Missile',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '120 ft',
    effect:     '3 × (1d4+1) force',
    effectNote: 'auto-hit',
    conc:       false,
    desc: 'Three glowing darts of magical force unerringly strike one or more targets. Each dart deals 1d4 + 1 force damage. All three can be directed at the same creature.',
  },
  {
    name:       'Sleep',
    level:      1,
    spellClass: 'Wizard',
    actionType: 'Action',
    range:      '90 ft',
    effect:     '5d8 HP pool',
    effectNote: 'lowest HP first · 10 rounds',
    conc:       false,
    desc: 'Roll 5d8 to determine how many hit points of creatures are affected. Starting from the creature with the lowest current HP, each target in range falls unconscious until the spell ends or the creature takes damage.',
  },
];

const LEVEL_LABELS = { 0: 'Cantrip', 1: '1st Level' };

const CLASS_META = {
  Cleric: { cls: 'sp-cleric', abbr: 'CLR' },
  Wizard: { cls: 'sp-wizard', abbr: 'WIZ' },
};

const ACTION_META = {
  Action: { cls: 'sp-act-action', abbr: 'A' },
  Bonus:  { cls: 'sp-act-bonus',  abbr: 'BA' },
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
