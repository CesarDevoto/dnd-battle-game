import { UNIT_TYPES } from './constants.js';

/* ── Game XP → CR (the game uses its own compressed XP scale) ─────────── */
const XP_TO_CR = {
  0:   '0',
  5:   '1/8',
  10:  '1/4',
  20:  '1/2',
  40:  '1',
  90:  '2',
  100: '2',   // Morvath (boss) sits between the 90 and 140 bands
  140: '3',
  220: '4',
  360: '5',
};

/* Full CR ordering, 0 → 30, for sorting any stray custom buckets */
const CR_SORT = {
  '0': 0, '1/8': 0.125, '1/4': 0.25, '1/2': 0.5,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, '10': 10, '11': 11, '12': 12, '13': 13, '14': 14, '15': 15,
  '16': 16, '17': 17, '18': 18, '19': 19, '20': 20, '21': 21, '22': 22,
  '23': 23, '24': 24, '30': 30, '?': 999,
};

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function crOf(def)     { return XP_TO_CR[def.xpReward] ?? '?'; }

function newHpOf(def) {
  const xp   = def.xpReward ?? 0;
  const mult = xp >= 1000 ? 1.0 : xp >= 220 ? 1.2 : 1.5;
  return Math.round(def.hp * mult);
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

/* ── Monster Manual roster, ordered by CR ────────────────────────────────
   Source of truth for the accordion structure. Names matched (case-
   insensitive) against in-game UNIT_TYPES get full stat blocks; the rest
   render as name-only "reference" entries.                                */
const MM_ROSTER = [
  { cr: '0', names: [
    'Awakened Shrub','Baboon','Badger','Bat','Cat','Commoner','Crab','Deer','Eagle','Frog',
    'Giant Fire Beetle','Goat','Hawk','Homunculus','Hyena','Jackal','Lemure','Lizard','Octopus',
    'Owl','Quipper','Rat','Raven','Scorpion','Sea Horse','Shrieker','Spider','Vulture','Weasel',
  ]},
  { cr: '1/8', names: [
    'Bandit','Blood Hawk','Camel','Cultist','Flying Snake','Giant Crab','Giant Rat','Giant Weasel',
    'Guard','Kobold','Mastiff','Merfolk','Mule','Noble','Poisonous Snake','Pony','Stirge','Tribal Warrior',
  ]},
  { cr: '1/4', names: [
    'Acolyte','Axe Beak','Blink Dog','Boar','Constrictor Snake','Draft Horse','Dretch','Drow Elf','Elk',
    'Flying Sword','Giant Badger','Giant Bat','Giant Centipede','Giant Frog','Giant Lizard','Giant Owl',
    'Giant Poisonous Snake','Giant Wolf Spider','Goblin','Grimlock','Panther','Pseudodragon','Riding Horse',
    'Skeleton','Sprite','Steam Mephit','Swarm of Bats','Swarm of Rats','Swarm of Ravens','Violet Fungus',
    'Wolf','Zombie',
  ]},
  { cr: '1/2', names: [
    'Ape','Black Bear','Cockatrice','Crocodile','Darkmantle','Dust Mephit','Giant Goat','Giant Sea Horse',
    'Giant Wasp','Gnoll','Deep Gnome (Svirfneblin)','Gray Ooze','Hobgoblin','Ice Mephit','Lizardfolk',
    'Magma Mephit','Magmin','Orc','Reef Shark','Rust Monster','Sahuagin','Satyr','Scout','Shadow',
    'Swarm of Insects','Thug','Warhorse','Warhorse Skeleton','Worg',
  ]},
  { cr: '1', names: [
    'Animated Armor','Brass Dragon Wyrmling','Brown Bear','Bugbear','Copper Dragon Wyrmling','Death Dog',
    'Dire Wolf','Dryad','Duergar','Ghoul','Giant Eagle','Giant Hyena','Giant Octopus','Giant Spider',
    'Giant Toad','Giant Vulture','Harpy','Hippogriff','Imp','Lion','Quasit','Specter','Spy',
    'Swarm of Quippers','Tiger',
  ]},
  { cr: '2', names: [
    'Ankheg','Awakened Tree','Azer','Bandit Captain','Berserker','Black Dragon Wyrmling',
    'Bronze Dragon Wyrmling','Centaur','Cult Fanatic','Druid','Ettercap','Gargoyle','Gelatinous Cube',
    'Ghast','Giant Boar','Giant Constrictor Snake','Giant Elk','Gibbering Mouther','Green Dragon Wyrmling',
    'Grick','Griffon','Hunter Shark','Merrow','Mimic','Minotaur Skeleton','Ochre Jelly','Ogre',
    'Ogre Zombie','Pegasus','Plesiosaurus','Polar Bear','Priest','Rhinoceros','Rug of Smothering',
    'Saber-Toothed Tiger','Sea Hag','Silver Dragon Wyrmling','Swarm of Poisonous Snakes','Wererat',
    'White Dragon Wyrmling',"Will-o'-Wisp",
  ]},
  { cr: '3', names: [
    'Basilisk','Bearded Devil','Blue Dragon Wyrmling','Doppelganger','Giant Scorpion','Gold Dragon Wyrmling',
    'Green Hag','Hell Hound','Killer Whale','Knight','Manticore','Minotaur','Mummy','Nightmare','Owlbear',
    'Phase Spider','Veteran','Werewolf','Wight','Winter Wolf',
  ]},
  { cr: '4', names: [
    'Black Pudding','Chuul','Couatl','Elephant','Ettin','Ghost','Lamia','Red Dragon Wyrmling',
    'Succubus/Incubus','Wereboar','Weretiger',
  ]},
  { cr: '5', names: [
    'Air Elemental','Barbed Devil','Bulette','Earth Elemental','Fire Elemental','Flesh Golem',
    'Giant Crocodile','Giant Shark','Gladiator','Gorgon','Half-Red Dragon Veteran','Hill Giant','Night Hag',
    'Otyugh','Roper','Salamander','Shambling Mound','Triceratops','Troll','Unicorn','Vampire Spawn',
    'Water Elemental','Werebear','Wraith','Xorn',
  ]},
  { cr: '6', names: [
    'Chimera','Drider','Invisible Stalker','Mage','Mammoth','Medusa','Vrock','Wyvern','Young Brass Dragon',
    'Young White Dragon',
  ]},
  { cr: '7', names: [
    'Giant Ape','Oni','Shield Guardian','Stone Giant','Young Black Dragon','Young Copper Dragon',
  ]},
  { cr: '8', names: [
    'Assassin','Chain Devil','Cloaker','Frost Giant','Hezrou','Hydra','Spirit Naga','Tyrannosaurus Rex',
    'Young Bronze Dragon','Young Green Dragon',
  ]},
  { cr: '9', names: [
    'Bone Devil','Clay Golem','Cloud Giant','Fire Giant','Glabrezu','Treant','Young Blue Dragon',
    'Young Silver Dragon',
  ]},
  { cr: '10', names: [
    'Aboleth','Deva','Guardian Naga','Stone Golem','Young Gold Dragon','Young Red Dragon',
  ]},
  { cr: '11', names: [
    'Behir','Djinni','Efreeti','Gynosphinx','Horned Devil','Remorhaz','Roc',
  ]},
  { cr: '12', names: [
    'Archmage','Erinyes',
  ]},
  { cr: '13', names: [
    'Adult Brass Dragon','Adult White Dragon','Nalfeshnee','Rakshasa','Storm Giant','Vampire',
  ]},
  { cr: '14', names: [
    'Adult Black Dragon','Adult Copper Dragon','Ice Devil',
  ]},
  { cr: '15', names: [
    'Adult Bronze Dragon','Adult Green Dragon','Mummy Lord','Purple Worm',
  ]},
  { cr: '16', names: [
    'Adult Blue Dragon','Adult Silver Dragon','Iron Golem','Marilith','Planetar',
  ]},
  { cr: '17', names: [
    'Adult Gold Dragon','Adult Red Dragon','Androsphinx','Dragon Turtle',
  ]},
  { cr: '19', names: [ 'Balor' ]},
  { cr: '20', names: [ 'Ancient Brass Dragon','Ancient White Dragon','Pit Fiend' ]},
  { cr: '21', names: [ 'Ancient Black Dragon','Ancient Copper Dragon','Lich','Solar' ]},
  { cr: '22', names: [ 'Ancient Bronze Dragon','Ancient Green Dragon' ]},
  { cr: '23', names: [ 'Ancient Blue Dragon','Ancient Silver Dragon','Kraken' ]},
  { cr: '24', names: [ 'Ancient Gold Dragon','Ancient Red Dragon' ]},
  { cr: '30', names: [ 'Tarrasque' ]},
];

/* lowercased MM name → index of its CR section */
const MM_NAME_TO_SEC = new Map();
MM_ROSTER.forEach((sec, i) => sec.names.forEach(n => MM_NAME_TO_SEC.set(n.toLowerCase(), i)));

const COLGROUP = `<colgroup>
  <col class="bst-c-name"><col class="bst-c-num"><col class="bst-c-num"><col class="bst-c-num">
  <col class="bst-c-num"><col class="bst-c-num">
  <col class="bst-c-ab"><col class="bst-c-ab"><col class="bst-c-ab">
  <col class="bst-c-ab"><col class="bst-c-ab"><col class="bst-c-ab">
  <col class="bst-c-atks">
</colgroup>`;

const THEAD = `<thead><tr>
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
  <th class="bst-th-atks">ATTACKS</th>
</tr></thead>`;

function statRow(def, cr) {
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

  // Creature-wide traits (Multiattack today) sit above the attack list — they qualify
  // the whole block rather than any single attack.
  const traitHTML = def.multiattackNote
    ? `<div class="bst-trait">${def.multiattackNote}</div>`
    : '';

  return `
    <tr class="bst-monster-row bst-stat-row" data-name="${nameLower}" data-cr="${cr}" data-ingame="1">
      <td class="bst-name-cell">${def.name}</td>
      <td class="bst-num bst-col-retired">${def.hp}</td>
      <td class="bst-num">${newHpOf(def)}</td>
      <td class="bst-num">${def.ac}</td>
      <td class="bst-num">${def.speed ?? 30} ft</td>
      <td class="bst-num">${def.xpReward ?? 0}</td>
      ${abCells(def)}
      <td class="bst-atks-cell">${traitHTML}${atksHTML}</td>
    </tr>`;
}

function refRow(name, cr) {
  return `
    <tr class="bst-monster-row bst-ref-row" data-name="${name.toLowerCase()}" data-cr="${cr}" data-ingame="0">
      <td class="bst-name-cell bst-ref-name">${name}</td>
      <td class="bst-ref-note" colspan="12">reference — not yet statted in game</td>
    </tr>`;
}

function sectionHTML(cr, entries, inGame) {
  const rows = entries.map(e => e.def ? statRow(e.def, cr) : refRow(e.name, cr)).join('');
  const noun = entries.length === 1 ? 'creature' : 'creatures';
  const statBadge = inGame > 0 ? `<span class="bst-cr-statted">${inGame} in game</span>` : '';
  return `
    <section class="bst-cr-sec" data-cr="${cr}">
      <button class="bst-cr-head" type="button" aria-expanded="false">
        <span class="bst-cr-chev">▸</span>
        <span class="bst-cr-title">Challenge ${cr}</span>
        <span class="bst-cr-meta">${entries.length} ${noun}${statBadge ? ' · ' : ''}${statBadge}</span>
      </button>
      <div class="bst-cr-body">
        <table class="bst-table">${COLGROUP}${THEAD}<tbody>${rows}</tbody></table>
      </div>
    </section>`;
}

function buildAccordion() {
  const redDefs = Object.entries(UNIT_TYPES)
    .filter(([, d]) => d.team === 'red')
    .map(([, d]) => d);

  // Attach in-game defs to their MM section; collect custom (non-MM) enemies.
  const attached    = MM_ROSTER.map(() => new Map());  // secIndex → Map(lowerName → def)
  const customsByCr = new Map();                        // cr → def[]
  for (const def of redDefs) {
    const key = def.name.toLowerCase();
    if (MM_NAME_TO_SEC.has(key)) {
      attached[MM_NAME_TO_SEC.get(key)].set(key, def);
    } else {
      const cr = crOf(def);
      if (!customsByCr.has(cr)) customsByCr.set(cr, []);
      customsByCr.get(cr).push(def);
    }
  }

  let totalCount = 0, totalInGame = 0;
  const usedCrs = new Set();
  let html = '<div id="bestiary-accordion">';

  for (let i = 0; i < MM_ROSTER.length; i++) {
    const sec = MM_ROSTER[i];
    usedCrs.add(sec.cr);
    const defMap  = attached[i];
    const customs = (customsByCr.get(sec.cr) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));

    const entries = sec.names.map(n => ({ name: n, def: defMap.get(n.toLowerCase()) ?? null }));
    for (const c of customs) entries.push({ name: c.name, def: c });

    const inGame = entries.filter(e => e.def).length;
    totalCount  += entries.length;
    totalInGame += inGame;
    html += sectionHTML(sec.cr, entries, inGame);
  }

  // Any custom enemies whose CR isn't represented in the MM roster (e.g. '?').
  const strayCrs = [...customsByCr.keys()]
    .filter(cr => !usedCrs.has(cr))
    .sort((a, b) => (CR_SORT[a] ?? 999) - (CR_SORT[b] ?? 999));
  for (const cr of strayCrs) {
    const entries = customsByCr.get(cr).slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(d => ({ name: d.name, def: d }));
    totalCount  += entries.length;
    totalInGame += entries.length;
    html += sectionHTML(cr === '?' ? '—' : cr, entries, entries.length);
  }

  html += '</div>';

  const subtitle = document.getElementById('bestiary-subtitle');
  if (subtitle) subtitle.textContent =
    `Monster Manual · ${totalCount} creatures · ${totalInGame} playable`;

  return `${html}
    <div id="bestiary-no-results">No creatures match your search.</div>
    <div class="bst-footnote">† Long range halved from D&D RAW — attacks beyond normal range are made with disadvantage. · “Reference” entries are catalogued by name &amp; CR but not yet built into the game.</div>`;
}

function setAllOpen(open) {
  document.querySelectorAll('#bestiary-accordion .bst-cr-sec').forEach(sec => {
    sec.classList.toggle('open', open);
    const head = sec.querySelector('.bst-cr-head');
    if (head) head.setAttribute('aria-expanded', String(open));
  });
}

function filterBestiary(query) {
  const q    = query.toLowerCase().trim();
  const secs = document.querySelectorAll('#bestiary-accordion .bst-cr-sec');
  if (!secs.length) return;

  let anyVisible = false;

  secs.forEach(sec => {
    let secMatches = 0;
    sec.querySelectorAll('tr.bst-monster-row').forEach(row => {
      const match = !q || row.dataset.name.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) secMatches++;
    });

    sec.style.display = secMatches > 0 ? '' : 'none';
    if (secMatches > 0) anyVisible = true;

    if (q) {
      // Auto-expand sections with matches while searching.
      sec.classList.add('open');
      sec.querySelector('.bst-cr-head')?.setAttribute('aria-expanded', 'true');
    }
  });

  if (!q) setAllOpen(false);  // restore collapsed default when search cleared

  const noResults = document.getElementById('bestiary-no-results');
  if (noResults) noResults.style.display = anyVisible ? 'none' : 'block';
}

export function initBestiary() {
  const overlay  = document.getElementById('bestiary-overlay');
  const closeBtn = document.getElementById('bestiary-close');
  const body     = document.getElementById('bestiary-body');
  const searchEl = document.getElementById('bestiary-search');
  const clearBtn = document.getElementById('bestiary-search-clear');
  const expandBtn   = document.getElementById('bestiary-expand-all');
  const collapseBtn = document.getElementById('bestiary-collapse-all');

  body.innerHTML = buildAccordion();

  // Accordion open/close via event delegation on the CR headers.
  body.addEventListener('click', e => {
    const head = e.target.closest('.bst-cr-head');
    if (!head) return;
    const sec  = head.closest('.bst-cr-sec');
    const open = sec.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
  });

  expandBtn?.addEventListener('click', () => setAllOpen(true));
  collapseBtn?.addEventListener('click', () => setAllOpen(false));

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
