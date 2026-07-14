import { UNIT_TYPES, WORLD_UNITS_PER_SQUARE, GRID_SQUARE_FEET, ADJACENT_WU } from './constants.js';
import { LEVEL_SPELLS, isAbilityUnlocked } from './spells.js';
import { units } from './units.js';

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
          { value: 'lowest_hp',       label: 'Lowest HP enemy'      },
          { value: 'nearest',         label: 'Nearest enemy'        },
          { value: 'most_dangerous',  label: 'Most dangerous enemy' },
          { value: 'most_clustered',  label: 'Most clustered enemy' },
          // Generic focus-fire: an enemy an ally is already engaging. Carries no mechanical
          // bonus — this combat has no flanking — it just concentrates damage on whatever the
          // frontline is holding. Milo never sees it (see optionsFor.halfling): for him it's
          // strictly dominated by sneak_possible.
          { value: 'engaged_by_ally', label: 'Enemy in melee range of ally' },
          // Milo only: ANY foe that currently satisfies a Sneak Attack condition — ally
          // adjacent to it, OR Milo hidden. A superset of engaged_by_ally, and it tracks
          // the real condition rather than one instance of it, so any condition added to
          // hasSneakAttackCondition later flows straight into his targeting.
          { value: 'sneak_possible',  label: 'Enemy I can Sneak Attack', heroes: ['halfling'] },
          // Rasec only: the foe Iffir has Helped on. He has ADVANTAGE against it, so it
          // is nearly always his best shot. Elf-only, and hidden until L4 Find Familiar.
          { value: 'helped_by_owl',   label: 'Enemy Helped by Iffir',
            heroes: ['elf'], requires: 'find_familiar' },
        ],
        optionsFor: {
          dwarf: [
            { value: 'ally_lowest_hp',   label: 'Wounded ally (lowest HP)' },
            { value: 'ally_any_wounded', label: 'Any wounded ally'         },
            { value: 'lowest_hp',        label: 'Lowest HP enemy'          },
            { value: 'nearest',          label: 'Nearest enemy'            },
            { value: 'most_dangerous',   label: 'Most dangerous enemy'     },
            { value: 'most_clustered',   label: 'Most clustered enemy'     },
            { value: 'engaged_by_ally',  label: 'Enemy in melee range of ally' },
          ],
          // Milo gets sneak_possible INSTEAD OF engaged_by_ally, never both: sneak_possible
          // is a strict superset (same ADJACENT_WU ally test, plus the hidden case), so for
          // him engaged_by_ally can't select a target sneak_possible wouldn't. Offering both
          // is a trap — it reads like two knobs but the lower one could only ever be dead
          // weight below the upper. Other heroes keep engaged_by_ally as plain focus-fire,
          // which for them has nothing to do with Sneak Attack.
          halfling: [
            { value: 'sneak_possible',  label: 'Enemy I can Sneak Attack', heroes: ['halfling'] },
            { value: 'lowest_hp',       label: 'Lowest HP enemy'      },
            { value: 'nearest',         label: 'Nearest enemy'        },
            { value: 'most_dangerous',  label: 'Most dangerous enemy' },
            { value: 'most_clustered',  label: 'Most clustered enemy' },
          ],
        },
        defaults: {
          // Rasec leads with the Helped foe — advantage beats every other consideration.
          elf:      ['helped_by_owl', 'lowest_hp', 'nearest', 'most_dangerous', 'most_clustered', 'engaged_by_ally'],
          dwarf:    ['ally_lowest_hp', 'ally_any_wounded', 'lowest_hp', 'nearest', 'most_dangerous', 'most_clustered', 'engaged_by_ally'],
          human:    ['lowest_hp', 'nearest', 'most_dangerous', 'most_clustered', 'engaged_by_ally'],
          // Milo leads with it: sneak dice are worth far more than shaving the last HP
          // off some other foe. engaged_by_ally is left out — sneak_possible contains it.
          halfling: ['sneak_possible', 'lowest_hp', 'nearest', 'most_dangerous', 'most_clustered'],
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
        options: [
          { value: 'use_potion', label: 'Use Healing Potion (<33% HP)' },
        ],
        optionsFor: {
          elf: [
            { value: 'use_potion',    label: 'Use Healing Potion (<33% HP)' },
            { value: 'mage_armor',    label: 'Mage Armor'    },
            { value: 'magic_missile', label: 'Magic Missile' },
            { value: 'fire_bolt',     label: 'Fire Bolt'     },
            { value: 'quarterstaff',  label: 'Quarterstaff'  },
            { value: 'ready_action',  label: 'Ready Action'  },
          ],
          dwarf: [
            { value: 'use_potion',   label: 'Use Healing Potion (<33% HP)' },
            { value: 'bless',        label: 'Bless'        },
            { value: 'cure_wounds',  label: 'Cure Wounds (ally <33% HP)' },
            { value: 'healing_word', label: 'Healing Word' },
            { value: 'sacred_flame', label: 'Sacred Flame' },
            { value: 'warhammer',    label: 'Warhammer'    },
            { value: 'ready_action', label: 'Ready Action' },
          ],
          human: [
            { value: 'use_potion',        label: 'Use Healing Potion (<33% HP)' },
            { value: 'rage',              label: 'Rage'              },
            { value: 'defensive_stance',  label: 'Defensive Stance'  },
            { value: 'greataxe',          label: 'Greataxe'          },
            { value: 'handaxe',           label: 'Handaxe'           },
            { value: 'ready_action',      label: 'Ready Action'      },
          ],
          halfling: [
            { value: 'use_potion',    label: 'Use Healing Potion (<33% HP)' },
            { value: 'smoke_mirrors', label: 'Smoke & Mirrors' },
            { value: 'hide',          label: 'Hide'         },
            { value: 'sneak_attack',  label: 'Sneak Attack' },
            { value: 'shortbow',      label: 'Shortbow'     },
            { value: 'shortsword',    label: 'Shortsword'   },
            { value: 'ready_action',  label: 'Ready Action' },
          ],
        },
        defaults: {
          elf:      ['use_potion', 'mage_armor', 'magic_missile', 'fire_bolt', 'quarterstaff'],
          dwarf:    ['use_potion', 'bless', 'cure_wounds', 'healing_word', 'sacred_flame', 'warhammer', 'ready_action'],
          human:    ['use_potion', 'rage', 'defensive_stance', 'greataxe', 'handaxe'],
          halfling: ['use_potion', 'smoke_mirrors', 'hide', 'sneak_attack', 'shortbow', 'shortsword'],
        },
        appliesTo: () => true,
      },
      {
        id: 'action_priority_no_range', label: 'No enemy in range', type: 'priority',
        options: [
          { value: 'use_potion',   label: 'Use Healing Potion (<33% HP)' },
          { value: 'dodge',        label: 'Dodge'        },
          { value: 'ready_action', label: 'Ready Action' },
          { value: 'end_turn',     label: 'End turn'     },
          { value: 'dash',         label: 'Dash'         },
        ],
        optionsFor: {
          // No Magic Missile here: it needs a target, so in the no-enemy-in-range branch
          // it can never fire — it would only sit in the list burning a priority slot.
          // Mage Armor stays: it's a self-buff, exactly the thing to cast with no foe up.
          elf: [
            { value: 'use_potion',    label: 'Use Healing Potion (<33% HP)' },
            { value: 'mage_armor',    label: 'Mage Armor'    },
            { value: 'dodge',         label: 'Dodge'         },
            { value: 'ready_action',  label: 'Ready Action'  },
            { value: 'end_turn',      label: 'End turn'      },
            { value: 'dash',          label: 'Dash'          },
          ],
          dwarf: [
            { value: 'use_potion',   label: 'Use Healing Potion (<33% HP)' },
            { value: 'bless',        label: 'Bless'        },
            { value: 'cure_wounds',  label: 'Cure Wounds (ally <33% HP)' },
            { value: 'healing_word', label: 'Healing Word' },
            { value: 'sacred_flame', label: 'Sacred Flame' },
            { value: 'dodge',        label: 'Dodge'        },
            { value: 'ready_action', label: 'Ready Action' },
            { value: 'end_turn',     label: 'End turn'     },
            { value: 'dash',         label: 'Dash'         },
          ],
          human: [
            { value: 'use_potion',       label: 'Use Healing Potion (<33% HP)' },
            { value: 'defensive_stance', label: 'Defensive Stance' },
            { value: 'dodge',            label: 'Dodge'            },
            { value: 'ready_action',     label: 'Ready Action'     },
            { value: 'end_turn',         label: 'End turn'         },
            { value: 'dash',             label: 'Dash'             },
          ],
          halfling: [
            { value: 'use_potion',    label: 'Use Healing Potion (<33% HP)' },
            { value: 'smoke_mirrors', label: 'Smoke & Mirrors' },
            { value: 'hide',          label: 'Hide'         },
            { value: 'dodge',         label: 'Dodge'        },
            { value: 'ready_action',  label: 'Ready Action' },
            { value: 'end_turn',      label: 'End turn'     },
            { value: 'dash',          label: 'Dash'         },
          ],
        },
        defaults: {
          elf:      ['use_potion', 'mage_armor', 'ready_action', 'dodge', 'end_turn'],
          dwarf:    ['use_potion', 'bless', 'cure_wounds', 'healing_word', 'sacred_flame', 'ready_action', 'dodge', 'end_turn'],
          human:    ['use_potion', 'defensive_stance', 'ready_action', 'dodge', 'end_turn'],
          halfling: ['use_potion', 'smoke_mirrors', 'hide', 'ready_action', 'dodge', 'end_turn'],
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
          { value: 'enemy_in_ranged_range',  label: 'Enemy enters spell/ranged range' },
          { value: 'enemy_in_melee_range',   label: 'Enemy enters melee range'  },
          // Milo's Sneak Attack needs an ally adjacent to his target (combat.js
          // _allyAdjacentToTarget). Holding his shot until a hero engages, then shooting
          // THAT enemy, turns a readied action into a guaranteed Sneak Attack.
          { value: 'ally_in_enemy_melee',    label: 'Ally enters enemy melee range' },
          // Rasec only: hold the cantrip until Iffir distracts something, then fire on
          // that foe with advantage. Hidden until L4 Find Familiar.
          { value: 'owl_helped',             label: 'Iffir uses Help action',
            heroes: ['elf'], requires: 'find_familiar' },
          { value: 'ally_loses_hp',          label: 'Ally takes damage'         },
        ],
        defaults: {
          elf:      ['owl_helped', 'enemy_in_ranged_range', 'enemy_in_melee_range', 'enemy_in_los', 'ally_in_enemy_melee', 'ally_loses_hp'],
          dwarf:    ['ally_loses_hp', 'enemy_in_melee_range', 'enemy_in_ranged_range', 'enemy_in_los', 'ally_in_enemy_melee'],
          human:    ['enemy_in_ranged_range', 'enemy_in_melee_range', 'enemy_in_los', 'ally_in_enemy_melee', 'ally_loses_hp'],
          // Milo leads with it — it's the whole point of him readying an action.
          halfling: ['ally_in_enemy_melee', 'enemy_in_ranged_range', 'enemy_in_melee_range', 'enemy_in_los', 'ally_loses_hp'],
        },
        appliesTo: () => true,
      },
    ],
  },
];

// ─── Persistence ─────────────────────────────────────────────────────────────
// Bump this whenever defaults change — clears any saved tendencies on next load.
const TENDENCIES_VERSION = 15;   // 15: drop magic_missile from Rasec's no-enemy-in-range list; engaged_by_ally off Milo's target list (sneak_possible supersedes it)

const LS_KEY     = 'dnd-combat-tendencies';
const LS_SET_KEY = 'dnd-tendencies-set';
const LS_VER_KEY = 'dnd-tendencies-version';

function _save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(_tendencies));
    localStorage.setItem(LS_VER_KEY, String(TENDENCIES_VERSION));
  } catch (_) {}
}
function _load() {
  try {
    const savedVer = parseInt(localStorage.getItem(LS_VER_KEY) ?? '0', 10);
    if (savedVer !== TENDENCIES_VERSION) {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_SET_KEY);
      localStorage.removeItem(LS_VER_KEY);
    } else {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) _tendencies = JSON.parse(raw);
    }
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

// ─── Auto-append new abilities to tendencies on level-up ─────────────────────
window.addEventListener('hero:levelup', ({ detail: { hero, newLevel } }) => {
  const newKeys = LEVEL_SPELLS[hero.type]?.[newLevel] ?? [];
  if (!newKeys.length) return;

  for (const cat of CATEGORIES) {
    for (const row of cat.rows) {
      const available = row.optionsFor?.[hero.type];
      if (!available) continue;
      const availableValues = available.map(o => o.value);
      const toAdd = newKeys.filter(k => availableValues.includes(k));
      if (!toAdd.length) continue;

      const current = getTendency(hero.type, row.id);
      const list = Array.isArray(current) ? [...current] : (current ? [current] : []);
      let changed = false;
      for (const k of toAdd) {
        if (!list.includes(k)) { list.push(k); changed = true; }
      }
      if (changed) { _set(hero.type, row.id, list); _save(); }
    }
  }
});

// ─── Public state API ─────────────────────────────────────────────────────────
export function isAutomated()      { return _mode === 'automated'; }
export function hasPendingSwitch() { return _pendingSwitch !== null; }

// Light the selected mode's button, grey out the other. (Name kept — it's
// called from handleRoundStartSwitch and init.)
export function updateButtonLabel() {
  const auto = document.getElementById('combat-mode-auto');
  const man  = document.getElementById('combat-mode-manual');
  if (!auto || !man) return;
  const automated = _mode === 'automated';
  auto.classList.toggle('active',   automated);
  auto.classList.toggle('inactive', !automated);
  man.classList.toggle('active',   !automated);
  man.classList.toggle('inactive',  automated);
}

// ─── Queue / clear pending switch ─────────────────────────────────────────────
function _queueSwitch(mode) {
  _pendingSwitch = mode;
  const id = mode === 'automated' ? 'combat-mode-auto' : 'combat-mode-manual';
  document.getElementById(id)?.classList.add('pending');
}
function _clearQueue() {
  _pendingSwitch = null;
  document.getElementById('combat-mode-auto')?.classList.remove('pending');
  document.getElementById('combat-mode-manual')?.classList.remove('pending');
}

// ─── Button click handler ─────────────────────────────────────────────────────
// Each button targets a fixed mode. Clicking the already-active mode (with
// nothing queued) is a no-op.
function _selectMode(targetMode) {
  if (targetMode === 'manual') {
    if (_mode === 'manual' && !_pendingSwitch) return;   // already manual — nothing to do
    if (_combatActive) { _queueSwitch('manual'); }
    else { _mode = 'manual'; updateButtonLabel(); }
    return;
  }

  // ─── Automated ───
  // Open the tendencies page when first switching to automated (never set), or
  // when AUTOMATED is clicked while already automated — so you can re-edit the
  // tendencies at any time (e.g. out of combat). Otherwise just queue the switch.
  const alreadyAutomated = _mode === 'automated' && !_pendingSwitch;
  if (!_tendenciesSet || !_combatActive || alreadyAutomated) {
    _openTendencies(() => {
      if (_combatActive && !alreadyAutomated) { _queueSwitch('automated'); }
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

function _heroLevel(heroType) {
  const hero = units.find(u => u.team === 'blue' && u.type === heroType);
  return hero?.level ?? 1;
}

// Options a hero can currently pick from — catalog entry, minus anything
// gated behind a level they haven't reached yet (isAbilityUnlocked, shared
// with the execution-time guards in combat.js — single source of truth).
//
// Two extra per-option gates:
//   heroes:   ['elf']          — option belongs to one hero only (Iffir is Rasec's owl,
//                                so his Help-related tendencies are meaningless to anyone
//                                else and shouldn't clutter their table).
//   requires: 'find_familiar'  — option depends on an ABILITY rather than being one. The
//                                option's own value isn't a spell key, so isAbilityUnlocked
//                                on it would return level 1 and always pass; gate on the
//                                ability it actually needs. Rasec only sees the owl
//                                tendencies once Find Familiar unlocks at L4.
function _availableOpts(row, heroType) {
  const opts  = row.optionsFor?.[heroType] ?? row.options;
  const level = _heroLevel(heroType);
  return opts.filter(o => {
    if (o.heroes && !o.heroes.includes(heroType)) return false;
    if (o.requires && !isAbilityUnlocked(heroType, level, o.requires)) return false;
    return isAbilityUnlocked(heroType, level, o.value);
  });
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
            const opts = _availableOpts(row, heroType);
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
            const opts    = _availableOpts(row, heroType);
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

                const top = document.createElement('button');
                top.className   = 'tend-priority-btn tend-priority-top';
                top.textContent = '⤒';
                top.title       = 'Move to top';
                top.disabled    = idx === 0;
                top.addEventListener('click', () => {
                  const [moved] = order.splice(idx, 1);
                  order.unshift(moved);
                  render();
                });

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

                item.append(num, lbl, top, up, dn);
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

function _scoreEnemy(e, criterion, heroPos, enemies, helpTarget = null, sneakable = null) {
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
    // An enemy some OTHER hero is standing next to — the Sneak Attack condition
    // (combat.js _allyAdjacentToTarget), tested with the very same ADJACENT_WU, so what
    // this criterion promises and what the damage code grants can't drift apart. Milo
    // picking one of these means his shot carries sneak damage. Unengaged enemies score
    // Infinity, so they never win this criterion and it falls through to the next one;
    // among engaged foes the nearest wins.
    case 'engaged_by_ally': {
      const engaged = units.some(a =>
        a.team === 'blue' && a.hp > 0 &&
        // Exclude the scoring hero himself: standing next to a foe doesn't let YOU sneak
        // attack it — an ALLY has to be the one flanking.
        Math.hypot(a.grp.position.x - heroPos.x, a.grp.position.z - heroPos.z) > 0.1 &&
        Math.hypot(a.grp.position.x - e.grp.position.x, a.grp.position.z - e.grp.position.z) <= ADJACENT_WU
      );
      return engaged ? dist : Infinity;
    }
    // The foe Iffir has Helped — Rasec attacks it with ADVANTAGE.
    case 'helped_by_owl':
      return e === helpTarget ? dist : Infinity;
    // Any foe Milo could Sneak Attack right now — the SUPERSET of engaged_by_ally. The
    // set is computed in combat.js by the same helpers the damage code consults, so a
    // target this criterion picks is guaranteed to carry the sneak dice. Note that when
    // Milo is HIDDEN every enemy qualifies (stealth is a condition of the attacker, not
    // the target), so they all tie and this falls through to his next criterion — which
    // is correct: with stealth up, any target sneaks, so pick on other merits.
    case 'sneak_possible':
      return sneakable?.has(e) ? dist : Infinity;
    default: return dist;
  }
}

// ctx carries facts only combat.js can compute, passed in rather than imported —
// combat.js already imports this module, so reaching back into it would close an import
// cycle:
//   helpTarget — the enemy Iffir has Helped (_owlHelpTarget); Rasec attacks it with
//                advantage.
//   sneakable  — Set of enemies this hero could Sneak Attack RIGHT NOW, computed by
//                combat.js from the same helpers the damage code uses
//                (_allyAdjacentToTarget / _isHiddenForSneak), so the tendency and the
//                dice can never disagree about what qualifies.
export function pickAutoTarget(heroType, heroPos, enemies, allies = [], ctx = {}) {
  const { helpTarget = null, sneakable = null } = ctx;
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
        // Real current maxHp (grows with level-ups), not the static base hp
        // from UNIT_TYPES — that stays fixed at the starting value forever
        // and under-detects wounds once anyone's leveled up.
        const maxHp = a.maxHp ?? UNIT_TYPES[a.type]?.hp ?? a.hp;
        return a.hp <= maxHp * 0.75;
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
      .map(e => ({ unit: e, s: _scoreEnemy(e, criterion, heroPos, enemies, helpTarget, sneakable) }))
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
  document.getElementById('combat-mode-auto')?.addEventListener('click',   () => _selectMode('automated'));
  document.getElementById('combat-mode-manual')?.addEventListener('click', () => _selectMode('manual'));

  window.addEventListener('combat:start', () => { _combatActive = true; });
  window.addEventListener('combat:ended', () => {
    _combatActive = false;
    _clearQueue();
  });
}
