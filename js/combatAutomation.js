import { UNIT_TYPES, WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET } from './constants.js';

// ─── Display metadata ────────────────────────────────────────────────────────
const HERO_META = {
  elf:      { name: 'Rasec',   cls: 'Elf Mage'       },
  dwarf:    { name: 'Leugren', cls: 'Dwarf Cleric'    },
  human:    { name: 'Gobo',    cls: 'Human Barbarian' },
  halfling: { name: 'Milo',    cls: 'Halfling Rogue'  },
};
const HERO_ORDER = ['dwarf', 'human', 'elf', 'halfling'];

// ─── Data-driven tendency categories ────────────────────────────────────────
// Targeting comes first — positioning is derived from the chosen target.
// To add a category: push a new entry. appliesTo(heroType) gates per-hero cells.
const CATEGORIES = [
  {
    id: 'targeting', label: 'TARGETING',
    rows: [
      {
        id: 'target_priority', label: 'Priority order', type: 'priority',
        options: [
          { value: 'lowest_hp',      label: 'Lowest HP enemy'      },
          { value: 'nearest',        label: 'Nearest enemy'        },
          { value: 'most_dangerous', label: 'Most dangerous enemy' },
          { value: 'most_clustered', label: 'Most clustered enemy' },
        ],
        optionsFor: {
          dwarf: [
            { value: 'ally_lowest_hp',   label: 'Wounded ally (lowest HP)' },
            { value: 'ally_any_wounded', label: 'Any wounded ally'         },
            { value: 'lowest_hp',        label: 'Lowest HP enemy'          },
            { value: 'nearest',          label: 'Nearest enemy'            },
            { value: 'most_dangerous',   label: 'Most dangerous enemy'     },
            { value: 'most_clustered',   label: 'Most clustered enemy'     },
          ],
        },
        defaults: {
          elf:      ['lowest_hp', 'nearest', 'most_dangerous', 'most_clustered'],
          dwarf:    ['ally_lowest_hp', 'ally_any_wounded', 'lowest_hp', 'nearest', 'most_dangerous', 'most_clustered'],
          human:    ['most_dangerous', 'nearest', 'lowest_hp', 'most_clustered'],
          halfling: ['lowest_hp', 'nearest', 'most_dangerous', 'most_clustered'],
        },
        appliesTo: () => true,
      },
    ],
  },
  {
    id: 'positioning', label: 'POSITIONING',
    rows: [
      {
        id: 'preferred_range', label: 'Preferred range', type: 'radio',
        options: [
          { value: 'melee',  label: 'Near enemy (melee)'  },
          { value: 'ranged', label: 'Near enemy (ranged)' },
          { value: 'stay',   label: 'Stay put'            },
        ],
        optionsFor: {
          dwarf: [
            { value: 'melee',            label: 'Near enemy (melee)'  },
            { value: 'ranged',           label: 'Near enemy (ranged)' },
            { value: 'stay',             label: 'Stay put'            },
            { value: 'near_ally_ranged', label: 'Near ally (ranged)'  },
            { value: 'near_ally_melee',  label: 'Near ally (melee)'   },
          ],
        },
        defaults:  { elf: 'ranged', dwarf: 'near_ally_melee', human: 'melee', halfling: 'ranged' },
        appliesTo: () => true,
      },
    ],
  },
  {
    id: 'actions', label: 'ACTIONS',
    rows: [
      {
        // Priority order of actions when an enemy is in range after moving.
        // Each value maps to a named attack (lowercased, spaces→underscores) or
        // a special action key. Add new abilities here as heroes level up.
        id: 'action_priority_in_range', label: 'Enemy in range', type: 'priority',
        options: [],
        optionsFor: {
          elf: [
            { value: 'fire_bolt',    label: 'Fire Bolt'    },
            { value: 'dagger',       label: 'Dagger'       },
            { value: 'ready_action', label: 'Ready Action' },
          ],
          dwarf: [
            { value: 'healing_word',   label: 'Healing Word'   },
            { value: 'light_crossbow', label: 'Light Crossbow' },
            { value: 'warhammer',      label: 'Warhammer'      },
            { value: 'ready_action',   label: 'Ready Action'   },
          ],
          human: [
            { value: 'rage',         label: 'Rage'         },
            { value: 'greataxe',     label: 'Greataxe'     },
            { value: 'handaxe',      label: 'Handaxe'      },
            { value: 'ready_action', label: 'Ready Action' },
          ],
          halfling: [
            { value: 'sneak_attack', label: 'Sneak Attack' },
            { value: 'shortbow',     label: 'Shortbow'     },
            { value: 'shortsword',   label: 'Shortsword'   },
            { value: 'ready_action', label: 'Ready Action' },
          ],
        },
        defaults: {
          elf:      ['fire_bolt', 'dagger', 'ready_action'],
          dwarf:    ['healing_word', 'ready_action', 'light_crossbow', 'warhammer'],
          human:    ['rage', 'greataxe', 'handaxe', 'ready_action'],
          halfling: ['sneak_attack', 'shortbow', 'shortsword', 'ready_action'],
        },
        appliesTo: () => true,
      },
      {
        id: 'action_priority_no_range', label: 'No enemy in range', type: 'priority',
        options: [
          { value: 'dodge',        label: 'Dodge'        },
          { value: 'ready_action', label: 'Ready Action' },
          { value: 'end_turn',     label: 'End turn'     },
          { value: 'dash',         label: 'Dash'         },
        ],
        optionsFor: {
          dwarf: [
            { value: 'healing_word', label: 'Healing Word' },
            { value: 'dodge',        label: 'Dodge'        },
            { value: 'ready_action', label: 'Ready Action' },
            { value: 'end_turn',     label: 'End turn'     },
            { value: 'dash',         label: 'Dash'         },
          ],
        },
        defaults: {
          elf:      ['ready_action', 'end_turn', 'dodge', 'dash'],
          dwarf:    ['healing_word', 'ready_action', 'dodge', 'end_turn', 'dash'],
          human:    ['ready_action', 'end_turn', 'dodge', 'dash'],
          halfling: ['ready_action', 'end_turn', 'dodge', 'dash'],
        },
        appliesTo: () => true,
      },
    ],
  },
  {
    id: 'ready_actions', label: 'READY ACTIONS',
    rows: [
      {
        // Which trigger fires the delayed action — checked in priority order.
        // When triggered, executes the action_priority_in_range list as normal.
        id: 'ready_trigger_priority', label: 'Trigger priority', type: 'priority',
        options: [
          { value: 'enemy_in_los',          label: 'Enemy enters LOS'          },
          { value: 'enemy_in_ranged_range',  label: 'Enemy enters ranged range' },
          { value: 'enemy_in_melee_range',   label: 'Enemy enters melee range'  },
          { value: 'ally_loses_hp',          label: 'Ally takes damage'         },
        ],
        defaults: {
          elf:      ['enemy_in_ranged_range', 'enemy_in_melee_range', 'enemy_in_los', 'ally_loses_hp'],
          dwarf:    ['ally_loses_hp', 'enemy_in_melee_range', 'enemy_in_ranged_range', 'enemy_in_los'],
          human:    ['enemy_in_ranged_range', 'enemy_in_melee_range', 'enemy_in_los', 'ally_loses_hp'],
          halfling: ['enemy_in_ranged_range', 'enemy_in_melee_range', 'enemy_in_los', 'ally_loses_hp'],
        },
        appliesTo: () => true,
      },
    ],
  },
];

// ─── Persistence ─────────────────────────────────────────────────────────────
const LS_KEY     = 'dnd-combat-tendencies';
const LS_SET_KEY = 'dnd-tendencies-set';

function _save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(_tendencies)); } catch (_) {}
}
function _load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) _tendencies = JSON.parse(raw);
  } catch (_) {}
  _tendenciesSet = localStorage.getItem(LS_SET_KEY) === '1';
}
function _markSet() {
  _tendenciesSet = true;
  try { localStorage.setItem(LS_SET_KEY, '1'); } catch (_) {}
}

// ─── State ────────────────────────────────────────────────────────────────────
let _mode          = 'manual';
let _pendingSwitch = null;
let _tendenciesSet = false;
let _tendencies    = {};
let _combatActive  = false;

// ─── Tendency access ──────────────────────────────────────────────────────────
function _default(heroType, rowId) {
  for (const cat of CATEGORIES) {
    for (const row of cat.rows) {
      if (row.id !== rowId) continue;
      const def = row.defaults[heroType];
      if (def !== undefined) return def;
      return row.type === 'priority'
        ? row.options.map(o => o.value)
        : row.options[0].value;
    }
  }
  return null;
}

export function getTendency(heroType, rowId) {
  return _tendencies[heroType]?.[rowId] ?? _default(heroType, rowId);
}
function _set(heroType, rowId, value) {
  if (!_tendencies[heroType]) _tendencies[heroType] = {};
  _tendencies[heroType][rowId] = value;
}

// ─── Public state API ─────────────────────────────────────────────────────────
export function isAutomated()      { return _mode === 'automated'; }
export function hasPendingSwitch() { return _pendingSwitch !== null; }

export function updateButtonLabel() {
  const btn = document.getElementById('combat-mode-btn');
  if (!btn) return;
  btn.textContent = _mode === 'manual' ? '⚔ AUTOMATE' : '☰ MANUAL';
  btn.classList.toggle('is-automated', _mode === 'automated');
}

// ─── Queue / clear pending switch ─────────────────────────────────────────────
function _queueSwitch(mode) {
  _pendingSwitch = mode;
  document.getElementById('combat-mode-btn')?.classList.add('pending-switch');
}
function _clearQueue() {
  _pendingSwitch = null;
  document.getElementById('combat-mode-btn')?.classList.remove('pending-switch');
}

// ─── Button click handler ─────────────────────────────────────────────────────
function _onButtonClick() {
  const targetMode = _mode === 'manual' ? 'automated' : 'manual';

  if (targetMode === 'manual') {
    if (_combatActive) { _queueSwitch('manual'); }
    else { _mode = 'manual'; updateButtonLabel(); }
    return;
  }

  if (!_tendenciesSet || !_combatActive) {
    _openTendencies(() => {
      if (_combatActive) { _queueSwitch('automated'); }
      else { _mode = 'automated'; updateButtonLabel(); }
    });
  } else {
    _queueSwitch('automated');
  }
}

// ─── Round-start intercept ────────────────────────────────────────────────────
export function handleRoundStartSwitch(resumeFn) {
  const mode = _pendingSwitch;
  _clearQueue();
  _mode = mode;
  updateButtonLabel();

  const overlay = document.getElementById('mode-switch-banner');
  const msg     = document.getElementById('mode-switch-msg');
  const okBtn   = document.getElementById('mode-switch-ok');
  if (!overlay) { resumeFn(); return; }

  msg.textContent = mode === 'automated'
    ? 'Switching to Automated Mode'
    : 'Switching to Manual Mode';

  overlay.classList.remove('hidden');
  const handler = () => {
    overlay.classList.add('hidden');
    okBtn.removeEventListener('click', handler);
    resumeFn();
  };
  okBtn.addEventListener('click', handler);
}

// ─── Tendencies window ────────────────────────────────────────────────────────
function _openTendencies(onSave) {
  const overlay = document.getElementById('tendencies-overlay');
  if (!overlay) { onSave?.(); return; }

  _buildTable(overlay);
  overlay.classList.remove('hidden');

  const okBtn = overlay.querySelector('#tendencies-ok');
  const handler = () => {
    _readTable(overlay);
    _markSet();
    _save();
    overlay.classList.add('hidden');
    okBtn.removeEventListener('click', handler);
    onSave?.();
  };
  okBtn.addEventListener('click', handler);
}

function _buildTable(overlay) {
  const thead = overlay.querySelector('#tendencies-thead');
  if (thead) {
    thead.innerHTML = '';
    const tr = document.createElement('tr');
    const blank = document.createElement('th');
    blank.className = 'tend-col-label';
    tr.appendChild(blank);
    for (const heroType of HERO_ORDER) {
      const th = document.createElement('th');
      th.className = 'tend-hero-head tend-col-hero';
      const m = HERO_META[heroType] ?? {};
      th.innerHTML = `<span class="tend-hero-name">${m.name ?? heroType}</span>`
                   + `<span class="tend-hero-class">${m.cls ?? ''}</span>`;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }

  const tbody = overlay.querySelector('#tendencies-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const cat of CATEGORIES) {
    const hdr = document.createElement('tr');
    hdr.className = 'tend-cat-header';
    hdr.innerHTML = `<td colspan="5"><span class="tend-cat-arrow">▼</span>${cat.label}</td>`;
    hdr.addEventListener('click', () => {
      const collapsed = hdr.classList.toggle('collapsed');
      hdr.querySelector('.tend-cat-arrow').textContent = collapsed ? '▶' : '▼';
      tbody.querySelectorAll(`tr.tend-row[data-cat="${cat.id}"]`)
        .forEach(r => { r.style.display = collapsed ? 'none' : ''; });
    });
    tbody.appendChild(hdr);

    for (const row of cat.rows) {
      const tr = document.createElement('tr');
      tr.className = 'tend-row';
      tr.dataset.cat = cat.id;

      const labelTd = document.createElement('td');
      labelTd.className = 'tend-row-label';
      labelTd.textContent = row.label;
      tr.appendChild(labelTd);

      for (const heroType of HERO_ORDER) {
        const td = document.createElement('td');
        td.className = 'tend-hero-cell';

        if (!row.appliesTo(heroType)) {
          td.classList.add('tend-disabled');
          td.textContent = '—';
        } else {
          const curVal = getTendency(heroType, row.id);

          if (row.type === 'radio') {
            const grp = document.createElement('div');
            grp.className = 'tend-radio-group';
            const opts = row.optionsFor?.[heroType] ?? row.options;
            for (const opt of opts) {
              const btn = document.createElement('button');
              btn.className = 'tend-radio-btn' + (opt.value === curVal ? ' active' : '');
              btn.textContent = opt.label;
              btn.dataset.heroType = heroType;
              btn.dataset.rowId    = row.id;
              btn.dataset.value    = opt.value;
              btn.addEventListener('click', () => {
                grp.querySelectorAll('.tend-radio-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
              });
              grp.appendChild(btn);
            }
            td.appendChild(grp);

          } else if (row.type === 'priority') {
            const opts    = row.optionsFor?.[heroType] ?? row.options;
            const allVals = opts.map(o => o.value);
            // Preserve saved order; append any options not yet in it (e.g. newly added)
            const saved   = Array.isArray(curVal) ? curVal.filter(v => allVals.includes(v)) : [];
            const order   = [...saved, ...allVals.filter(v => !saved.includes(v))];

            const list = document.createElement('div');
            list.className = 'tend-priority-list';
            list.dataset.heroType = heroType;
            list.dataset.rowId    = row.id;

            const render = () => {
              list.innerHTML = '';
              order.forEach((val, idx) => {
                const opt  = opts.find(o => o.value === val);
                const item = document.createElement('div');
                item.className        = 'tend-priority-item';
                item.dataset.heroType = heroType;
                item.dataset.rowId    = row.id;
                item.dataset.value    = val;

                const num = document.createElement('span');
                num.className   = 'tend-priority-num';
                num.textContent = idx + 1;

                const lbl = document.createElement('span');
                lbl.className   = 'tend-priority-label';
                lbl.textContent = opt?.label ?? val;

                const up = document.createElement('button');
                up.className   = 'tend-priority-btn';
                up.textContent = '↑';
                up.disabled    = idx === 0;
                up.addEventListener('click', () => {
                  [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                  render();
                });

                const dn = document.createElement('button');
                dn.className   = 'tend-priority-btn';
                dn.textContent = '↓';
                dn.disabled    = idx === order.length - 1;
                dn.addEventListener('click', () => {
                  [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
                  render();
                });

                item.append(num, lbl, up, dn);
                list.appendChild(item);
              });
            };

            render();
            td.appendChild(list);
          }
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
}

function _readTable(overlay) {
  // Radio buttons
  overlay.querySelectorAll('.tend-radio-btn.active').forEach(btn => {
    _set(btn.dataset.heroType, btn.dataset.rowId, btn.dataset.value);
  });
  // Priority lists — read current DOM order of items
  overlay.querySelectorAll('.tend-priority-list').forEach(list => {
    const items = [...list.querySelectorAll('.tend-priority-item')];
    if (!items.length) return;
    _set(items[0].dataset.heroType, items[0].dataset.rowId,
         items.map(el => el.dataset.value));
  });
}

// ─── Decision helpers (called from combat.js _runAutomatedHeroTurn) ──────────
const _AOE_RADIUS_WU = (15 / GRID_SQUARE_FEET) * WORLD_UNITS_PER_SQUARE;

function _scoreEnemy(e, criterion, heroPos, enemies) {
  const dx = e.grp.position.x - heroPos.x, dz = e.grp.position.z - heroPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  switch (criterion) {
    case 'lowest_hp':  return e.hp;
    case 'nearest':    return dist;
    case 'most_dangerous': {
      const def    = UNIT_TYPES[e.type] ?? {};
      const maxDmg = (def.attacks ?? []).reduce((m, a) => Math.max(m, (a.dice ?? 1) * (a.sides ?? 6)), 0);
      return -maxDmg;
    }
    case 'most_clustered': {
      const nearby = enemies.filter(o => {
        if (o === e) return false;
        const odx = o.grp.position.x - e.grp.position.x;
        const odz = o.grp.position.z - e.grp.position.z;
        return Math.sqrt(odx * odx + odz * odz) <= _AOE_RADIUS_WU;
      }).length;
      return -(nearby + 1);
    }
    default: return dist;
  }
}

export function pickAutoTarget(heroType, heroPos, enemies, allies = []) {
  if (!enemies.length && !allies.length) return null;

  let priority = getTendency(heroType, 'target_priority');
  // Coerce legacy single-string values from old localStorage data
  if (!Array.isArray(priority)) {
    const all = ['lowest_hp', 'nearest', 'most_dangerous', 'most_clustered'];
    priority  = [priority, ...all.filter(v => v !== priority)];
  }

  for (const criterion of priority) {
    // ── Ally criteria ─────────────────────────────────────────────────────
    if (criterion === 'ally_lowest_hp' || criterion === 'ally_any_wounded') {
      const wounded = allies.filter(a => {
        const maxHp = UNIT_TYPES[a.type]?.hp ?? a.hp;
        return a.hp < maxHp;
      });
      if (!wounded.length) continue; // no wounded allies → try next criterion

      if (criterion === 'ally_lowest_hp') {
        const sorted = [...wounded].sort((a, b) => a.hp - b.hp);
        // Clear winner: strictly lowest HP
        if (sorted.length === 1 || sorted[0].hp < sorted[1].hp) return sorted[0];
        continue; // tied → fall through
      } else {
        // ally_any_wounded: any wounded ally qualifies — pick lowest HP as tiebreaker
        return wounded.reduce((best, a) => (!best || a.hp < best.hp) ? a : best, null);
      }
    }

    // ── Enemy criteria ─────────────────────────────────────────────────────
    if (!enemies.length) continue;
    const ranked = [...enemies]
      .map(e => ({ unit: e, s: _scoreEnemy(e, criterion, heroPos, enemies) }))
      .sort((a, b) => a.s - b.s);
    // Clear winner = strictly better score than runner-up (no tie)
    if (ranked.length === 1 || ranked[0].s < ranked[1].s) return ranked[0].unit;
    // Tied on this criterion → fall through to next
  }

  return enemies[0] ?? null;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initCombatAutomation() {
  _load();
  updateButtonLabel();
  document.getElementById('combat-mode-btn')?.addEventListener('click', _onButtonClick);

  window.addEventListener('combat:start', () => { _combatActive = true; });
  window.addEventListener('combat:ended', () => {
    _combatActive = false;
    _clearQueue();
  });
}
