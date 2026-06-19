import { UNIT_TYPES } from './constants.js';

const XP_TO_CR = {
  25:   '1/8',
  50:   '1/4',
  100:  '1/2',
  200:  '1',
  450:  '2',
  700:  '3',
  1100: '4',
  1800: '5',
};

const CR_SORT = {
  '1/8': 0.125, '1/4': 0.25, '1/2': 0.5,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
};

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

// Biomes each enemy can appear in (matches the game's env buttons)
const ENEMY_BIOMES = {
  kobold:                   ['dungeon', 'forest'],
  goblin:                   ['forest',  'dungeon'],
  orc:                      ['forest',  'dungeon',  'savanna'],
  ogre:                     ['forest',  'dungeon',  'tundra'],
  wolf:                     ['forest',  'tundra',   'savanna'],
  ice_mephit:               ['tundra'],
  gnoll:                    ['savanna', 'desert'],
  hyena:                    ['savanna', 'desert'],
  giant_spider:             ['forest',  'dungeon',  'swamp'],
  twig_blight:              ['forest',  'swamp',   'graveyard'],
  stirge:                   ['forest',  'dungeon',  'swamp'],
  giant_rat:                ['dungeon', 'swamp',   'graveyard'],
  troglodyte:               ['dungeon', 'swamp'],
  constrictor_snake:        ['swamp',   'forest',   'savanna'],
  lizardfolk:               ['swamp',   'forest'],
  bugbear:                  ['forest',  'dungeon'],
  dire_wolf:                ['forest',  'tundra'],
  hobgoblin:                ['forest',  'dungeon'],
  gnoll_pack_lord:          ['savanna', 'desert'],
  yuan_ti_pureblood:        ['desert',  'forest'],
  giant_constrictor_snake:  ['swamp',   'forest',   'savanna'],
  troll:                    ['forest',  'swamp'],
  yeti:                     ['tundra'],
  gnoll_fang:               ['savanna', 'desert'],
  owlbear:                  ['forest'],
  werewolf:                 ['forest',  'graveyard'],
  minotaur:                 ['dungeon'],
  yuan_ti_malison:          ['desert',  'forest'],
  shambling_mound:          ['swamp',   'forest'],
  giant_frog:               ['swamp'],
  bullywug:                 ['swamp'],
  mud_mephit:               ['swamp',   'desert'],
  crocodile:                ['swamp',   'savanna'],
  giant_toad:               ['swamp',   'forest'],
  bullywug_croaker:         ['swamp'],
  swarm_of_insects:         ['swamp',   'forest',   'savanna',  'desert'],
  lizardfolk_shaman:        ['swamp',   'forest'],
  green_hag:                ['swamp',   'forest',   'graveyard'],
  skeleton:                 ['graveyard', 'dungeon', 'swamp'],
  shadow:                   ['graveyard', 'dungeon'],
  specter:                  ['graveyard'],
  ghast:                    ['graveyard', 'dungeon'],
  wight:                    ['graveyard', 'dungeon'],
  banshee:                  ['graveyard'],
  revenant:                 ['graveyard', 'dungeon'],
  ghoul:                    ['graveyard', 'dungeon'],
  zombie:                   ['graveyard', 'dungeon', 'swamp'],
  hill_giant:               ['forest',  'tundra',   'savanna'],
  ettin:                    ['forest',  'tundra',   'dungeon'],
};

const BIOME_META = {
  forest:    { abbr: 'FOR', cls: 'for' },
  desert:    { abbr: 'DES', cls: 'des' },
  swamp:     { abbr: 'SWP', cls: 'swp' },
  tundra:    { abbr: 'TUN', cls: 'tun' },
  savanna:   { abbr: 'SAV', cls: 'sav' },
  graveyard: { abbr: 'GRV', cls: 'grv' },
  dungeon:   { abbr: 'DNG', cls: 'dng' },
};

const COL_COUNT = 17; // NAME HP NewHP AC MOVE XP NewXP BIOME STR DEX CON INT WIS CHA NewMelee NewRange ATTACKS

function crOf(def)     { return XP_TO_CR[def.xpReward] ?? '?'; }
function crSortOf(def) { return CR_SORT[crOf(def)] ?? 999; }

function newHpOf(def) {
  const xp   = def.xpReward ?? 0;
  const mult = xp >= 5000 ? 1.3 : xp >= 1100 ? 1.6 : 2.0;
  return Math.round(def.hp * mult);
}

function newDmgRange(atk, def) {
  const mod     = atk.dmgBonus !== undefined
    ? atk.dmgBonus
    : Math.floor(((def.abilities?.[atk.statMod] ?? 10) - 10) / 2);
  const baseAvg = atk.dice * (atk.sides + 1) / 2 + mod;
  const newAvg  = baseAvg * 1.4;
  const min     = Math.max(1, Math.round(newAvg * 0.8));
  const max     = Math.round(newAvg * 1.2);
  return `${min}–${max}`;
}

function abMod(score) {
  const m = Math.floor((score - 10) / 2);
  return (m >= 0 ? '+' : '') + m;
}

function atkHitStr(atk, def) {
  if (atk.hitBonus !== undefined) return atk.hitBonus >= 0 ? `+${atk.hitBonus}` : String(atk.hitBonus);
  const mod   = Math.floor(((def.abilities?.[atk.statMod] ?? 10) - 10) / 2);
  const total = mod + (def.profBonus ?? 2);
  return total >= 0 ? `+${total}` : String(total);
}

function atkDmgStr(atk, def) {
  const mod = atk.dmgBonus !== undefined
    ? atk.dmgBonus
    : Math.floor(((def.abilities?.[atk.statMod] ?? 10) - 10) / 2);
  if (mod > 0) return `${atk.dice}d${atk.sides}+${mod}`;
  if (mod < 0) return `${atk.dice}d${atk.sides}${mod}`;
  return `${atk.dice}d${atk.sides}`;
}

function atkRangeStr(atk) {
  if (atk.type === 'melee') return '5 ft';
  if (atk.longRange) return `${atk.range}/${atk.longRange} ft`;
  return `${atk.range} ft`;
}

function abCells(def) {
  const ab = def.abilities ?? {};
  return ABILITY_KEYS.map(key => {
    const score = ab[key] ?? 10;
    const low   = score < 10;
    return `<td class="bst-ab-cell${low ? ' bst-ab-low' : ''}">
      <div class="bst-ab-score">${score}</div>
      <div class="bst-ab-mod">${abMod(score)}</div>
    </td>`;
  }).join('');
}

function biomeCell(key) {
  const biomes = ENEMY_BIOMES[key] ?? [];
  if (!biomes.length) return '<td class="bst-biome-cell">—</td>';
  const tags = biomes
    .map(b => BIOME_META[b])
    .filter(Boolean)
    .map(m => `<span class="bst-biome ${m.cls}">${m.abbr}</span>`)
    .join('');
  return `<td class="bst-biome-cell">${tags}</td>`;
}

function buildTable() {
  const enemies = Object.entries(UNIT_TYPES)
    .filter(([, d]) => d.team === 'red')
    .sort((a, b) => crSortOf(a[1]) - crSortOf(b[1]) || a[1].name.localeCompare(b[1].name));

  const groups = new Map();
  for (const [, def] of enemies) {
    const cr = crOf(def);
    if (!groups.has(cr)) groups.set(cr, []);
    groups.get(cr).push(def);
  }

  // Also track keys alongside defs for biome lookup
  const keyMap = new Map();
  for (const [key, def] of enemies) keyMap.set(def, key);

  let rows = '';
  for (const [cr, defs] of groups) {
    rows += `<tr class="bst-cr-row" data-cr="${cr}"><td colspan="${COL_COUNT}">CR ${cr}</td></tr>`;
    for (const def of defs) {
      const key       = keyMap.get(def);
      const nameLower = def.name.toLowerCase();
      const atksHTML  = (def.attacks ?? []).map(atk => `
        <div class="bst-atk">
          <span class="bst-atk-type ${atk.type}">${atk.type === 'melee' ? 'MEL' : 'RNG'}</span>
          <span class="bst-atk-name">${atk.name}</span>
          <span class="bst-atk-hit">${atkHitStr(atk, def)}</span>
          <span class="bst-atk-dmg">${atkDmgStr(atk, def)}</span>
          <span class="bst-atk-rng">${atkRangeStr(atk)}</span>
          ${atk.qty !== undefined ? `<span class="bst-atk-qty">×${atk.qty}</span>` : ''}
          ${atk.note ? `<div class="bst-atk-note">${atk.note}</div>` : ''}
        </div>`).join('');

      rows += `
        <tr class="bst-monster-row" data-name="${nameLower}" data-cr="${cr}">
          <td class="bst-name-cell">${def.name}</td>
          <td class="bst-num bst-col-retired">${def.hp}</td>
          <td class="bst-num">${newHpOf(def)}</td>
          <td class="bst-num">${def.ac}</td>
          <td class="bst-num">${def.speed ?? 30} ft</td>
          <td class="bst-num bst-col-retired">${def.xpReward}</td>
          <td class="bst-num">${Math.round((def.xpReward ?? 0) / 5)}</td>
          ${biomeCell(key)}
          ${abCells(def)}
          <td class="bst-num">${(def.attacks ?? []).filter(a => a.type === 'melee') .map(a => newDmgRange(a, def)).join(', ') || '—'}</td>
          <td class="bst-num">${(def.attacks ?? []).filter(a => a.type === 'ranged').map(a => newDmgRange(a, def)).join(', ') || '—'}</td>
          <td class="bst-atks-cell">${atksHTML}</td>
        </tr>`;
    }
  }

  document.getElementById('bestiary-subtitle').textContent =
    `Enemy Compendium · ${enemies.length} Creatures`;

  return `
    <table class="bst-table">
      <thead>
        <tr>
          <th class="bst-th-name">NAME</th>
          <th class="bst-th-num bst-col-retired">HP</th>
          <th class="bst-th-num">New HP</th>
          <th class="bst-th-num">AC</th>
          <th class="bst-th-num">MOVE</th>
          <th class="bst-th-num bst-col-retired">XP</th>
          <th class="bst-th-num">New XP</th>
          <th class="bst-th-biome">BIOME</th>
          <th class="bst-th-ab">STR</th>
          <th class="bst-th-ab">DEX</th>
          <th class="bst-th-ab">CON</th>
          <th class="bst-th-ab">INT</th>
          <th class="bst-th-ab">WIS</th>
          <th class="bst-th-ab">CHA</th>
          <th class="bst-th-num">New Melee</th>
          <th class="bst-th-num">New Range</th>
          <th class="bst-th-atks">ATTACKS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div id="bestiary-no-results">No enemies match your search.</div>`;
}

function filterBestiary(query) {
  const q     = query.toLowerCase().trim();
  const tbody = document.querySelector('.bst-table tbody');
  if (!tbody) return;

  let anyVisible = false;
  const visibleCRs = new Set();

  tbody.querySelectorAll('tr.bst-monster-row').forEach(row => {
    const match = !q || row.dataset.name.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) { visibleCRs.add(row.dataset.cr); anyVisible = true; }
  });

  tbody.querySelectorAll('tr.bst-cr-row').forEach(row => {
    row.style.display = visibleCRs.has(row.dataset.cr) ? '' : 'none';
  });

  const noResults = document.getElementById('bestiary-no-results');
  if (noResults) noResults.style.display = anyVisible ? 'none' : 'block';
}

export function initBestiary() {
  const overlay  = document.getElementById('bestiary-overlay');
  const closeBtn = document.getElementById('bestiary-close');
  const body     = document.getElementById('bestiary-body');
  const searchEl = document.getElementById('bestiary-search');
  const clearBtn = document.getElementById('bestiary-search-clear');

  body.innerHTML = buildTable();

  document.getElementById('bestiary-btn').addEventListener('click', () => {
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
    filterBestiary(val);
  });

  clearBtn.addEventListener('click', () => {
    searchEl.value = '';
    clearBtn.classList.remove('visible');
    filterBestiary('');
    searchEl.focus();
  });
}
