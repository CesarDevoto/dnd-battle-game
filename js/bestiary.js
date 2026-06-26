import { UNIT_TYPES } from './constants.js';

const XP_TO_CR = {
  5:   '1/8',
  10:  '1/4',
  20:  '1/2',
  40:  '1',
  90:  '2',
  140: '3',
  220: '4',
  360: '5',
};

const CR_SORT = {
  '1/8': 0.125, '1/4': 0.25, '1/2': 0.5,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
};

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const COL_COUNT = 13; // NAME HP NewHP AC MOVE XP STR DEX CON INT WIS CHA ATTACKS

function crOf(def)     { return XP_TO_CR[def.xpReward] ?? '?'; }
function crSortOf(def) { return CR_SORT[crOf(def)] ?? 999; }

function newHpOf(def) {
  const xp   = def.xpReward ?? 0;
  const mult = xp >= 1000 ? 1.0 : xp >= 220 ? 1.2 : 1.5;
  return Math.round(def.hp * mult);
}

function newDmgRange(atk, def) {
  const mod = atk.dmgBonus !== undefined
    ? atk.dmgBonus
    : Math.floor(((def.abilities?.[atk.statMod] ?? 10) - 10) / 2);
  const min = Math.max(1, atk.dice + mod);
  const max = atk.dice * atk.sides + mod;
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
  if (atk.longRange) return `${atk.range}/<span class="bst-long-range" title="Long range (disadvantage) — halved from D&D RAW">${atk.longRange}†</span> ft`;
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

  let rows = '';
  for (const [cr, defs] of groups) {
    rows += `<tr class="bst-cr-row" data-cr="${cr}"><td colspan="${COL_COUNT}">CR ${cr}</td></tr>`;
    for (const def of defs) {
      const nameLower = def.name.toLowerCase();
      const atksHTML  = (def.attacks ?? []).map(atk => `
        <div class="bst-atk">
          <span class="bst-atk-type ${atk.type}">${atk.type === 'melee' ? 'MEL' : 'RNG'}</span>
          <span class="bst-atk-name">${atk.name}</span>
          <span class="bst-atk-hit">${atkHitStr(atk, def)}</span>
          <span class="bst-atk-dmg">${atkDmgStr(atk, def)}</span>
          <span class="bst-atk-rng">${atkRangeStr(atk)}</span>
          ${atk.type === 'ranged' && atk.rawLongRange ? `<span class="bst-atk-dnd">${atk.range}/${atk.rawLongRange} ft</span>` : atk.type === 'ranged' ? `<span class="bst-atk-dnd">${atk.range} ft</span>` : ''}
          ${atk.type === 'ranged' ? `<span class="bst-atk-qty">${atk.qty !== undefined ? `×${atk.qty}` : '—'}</span>` : ''}
          ${atk.note ? `<div class="bst-atk-note">${atk.note}</div>` : ''}
        </div>`).join('');

      rows += `
        <tr class="bst-monster-row" data-name="${nameLower}" data-cr="${cr}">
          <td class="bst-name-cell">${def.name}</td>
          <td class="bst-num bst-col-retired">${def.hp}</td>
          <td class="bst-num">${newHpOf(def)}</td>
          <td class="bst-num">${def.ac}</td>
          <td class="bst-num">${def.speed ?? 30} ft</td>
          <td class="bst-num">${Math.ceil((def.xpReward ?? 0) * 1.5)}</td>
          ${abCells(def)}
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
          <th class="bst-th-num">XP</th>
          <th class="bst-th-ab">STR</th>
          <th class="bst-th-ab">DEX</th>
          <th class="bst-th-ab">CON</th>
          <th class="bst-th-ab">INT</th>
          <th class="bst-th-ab">WIS</th>
          <th class="bst-th-ab">CHA</th>
          <th class="bst-th-atks">ATTACKS
            <div class="bst-atk bst-atk-col-hdr">
              <span class="bst-atk-type"></span>
              <span class="bst-atk-name"></span>
              <span class="bst-atk-hit">Hit</span>
              <span class="bst-atk-dmg">Dmg</span>
              <span class="bst-atk-rng">Range</span>
              <span class="bst-atk-dnd">D&amp;D Range</span>
              <span class="bst-atk-qty">Qty</span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div id="bestiary-no-results">No enemies match your search.</div>
    <div class="bst-footnote">† Long range halved from D&D RAW — attacks beyond normal range are made with disadvantage.</div>`;
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
