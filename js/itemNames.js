// js/itemNames.js — procedural, affix-derived item names (Diablo-style).
//
// A dropped item's name is GENERATED from (slot/material/weaponType, rarity, rolled affixes),
// not read from the catalog — so "Necklace III" becomes "Blazing Pendant of Mending". Rules:
//   • Specific/scripted items keep their authored name (rider amulets, soul-shard, potions).
//   • grey  → "Simple <noun>"            (the affix-less bottom tier — user's rule)
//   • other → "<Prefix> <noun> of <Suffix>", prefix from the 1st affix, suffix from the 2nd,
//             degrading to "<Prefix> <noun>" (1 affix) or just "<noun>" (0 affixes / unbuilt slot).
//
// Leaf module: no imports, so it's node-testable alongside affixes.js/lootCoverage.js.

// ── Base nouns ────────────────────────────────────────────────────────────────
// Weapons resolve their noun straight from `weaponType` (already a clean word: Dagger, Longsword,
// Quarterstaff…). Armor slots key by material (cloth/leather/hide/plate); jewelry & misc slots are
// a flat pool. Index [0] is the PLAINEST noun — grey items use it so "Simple X" reads generic.
const SLOT_NOUNS = {
  neck:  ['Necklace', 'Pendant', 'Amulet', 'Locket', 'Talisman', 'Medallion'],
  ring:  ['Ring', 'Band', 'Signet', 'Loop'],
  cloak: ['Cloak', 'Cape', 'Mantle', 'Shroud'],
  belt:  ['Belt', 'Girdle', 'Sash', 'Cord'],
  ammo:  ['Arrows', 'Bolts', 'Shot'],
  bag:   ['Bag', 'Pack', 'Satchel', 'Pouch'],
  'off-hand': ['Shield', 'Bulwark', 'Buckler'],   // weapon off-hands resolve via weaponType first
  head: {
    cloth:   ['Hood', 'Cowl', 'Cap'],
    leather: ['Cap', 'Coif'],
    hide:    ['Helm', 'Headguard'],
    plate:   ['Helm', 'Greathelm'],
    _default:['Headgear'],
  },
  chest: {
    cloth:   ['Robe', 'Vestment', 'Tunic'],
    leather: ['Jerkin', 'Vest'],
    hide:    ['Hauberk', 'Brigandine'],
    plate:   ['Cuirass', 'Breastplate'],
    _default:['Armor'],
  },
  legs: {
    cloth:   ['Leggings', 'Trousers'],
    leather: ['Leggings', 'Chaps'],
    hide:    ['Greaves', 'Legguards'],
    plate:   ['Legplates', 'Greaves'],
    _default:['Leggings'],
  },
  hands: {
    cloth:   ['Gloves', 'Wraps'],
    leather: ['Gloves', 'Grips'],
    hide:    ['Gauntlets', 'Handguards'],
    plate:   ['Gauntlets', 'Fists'],
    _default:['Gloves'],
  },
  feet: {
    cloth:   ['Slippers', 'Shoes'],
    leather: ['Boots', 'Treads'],
    hide:    ['Boots', 'Striders'],
    plate:   ['Sabatons', 'Warboots'],
    _default:['Boots'],
  },
  wrist: {
    cloth:   ['Wraps', 'Bands'],
    leather: ['Bracers', 'Armlets'],
    hide:    ['Bracers', 'Armguards'],
    plate:   ['Vambraces', 'Bracers'],
    _default:['Bracers'],
  },
};

// ── Affix → name words ────────────────────────────────────────────────────────
// Each affix contributes a PREFIX (as the 1st affix) or a SUFFIX noun ("of X", as the 2nd).
// Keyed by the affix `key` the roller stamps. An affix with no entry just doesn't decorate the
// name (the item falls back to fewer words), so a new affix degrades gracefully until it's added.
// Riders are signatureOnly (their amulet keeps its authored name), so they need no entry.
const AFFIX_WORDS = {
  mitigation_pct:       { prefix: 'Warding',  suffix: 'Warding' },
  spell_damage_pct:     { prefix: 'Arcane',   suffix: 'Power' },
  ac_pct:               { prefix: 'Sturdy',   suffix: 'Protection' },
  hit_pct:              { prefix: 'Keen',     suffix: 'Precision' },
  str:                  { prefix: 'Mighty',   suffix: 'the Bear' },
  dex:                  { prefix: 'Agile',    suffix: 'the Fox' },
  con:                  { prefix: 'Stalwart', suffix: 'the Ox' },
  resource_regen:       { prefix: 'Replenishing', suffix: 'Renewal' },
  crit_chance_pct:      { prefix: 'Deadly',    suffix: 'the Assassin' },
  crit_damage:          { prefix: 'Brutal',    suffix: 'Savagery' },
  projectile_range:     { prefix: 'Farshot',   suffix: 'the Horizon' },
  healing_received_pct: { prefix: 'Blessed',  suffix: 'Recovery' },
  healing_done_pct:     { prefix: 'Sacred',   suffix: 'Mending' },
  saving_throw_pct:     { prefix: 'Resolute', suffix: 'Resolve' },
  stealth_pct:          { prefix: 'Shadowed', suffix: 'Shadows' },
  perception_pct:       { prefix: 'Watchful', suffix: 'the Owl' },
  max_hp:               { prefix: 'Vital',    suffix: 'Vitality' },
  move_speed:           { prefix: 'Swift',    suffix: 'Swiftness' },
  initiative_bonus:     { prefix: 'Alert',    suffix: 'the Vanguard' },
  attack_speed:         { prefix: 'Rapid',    suffix: 'Fury' },
  cast_speed:           { prefix: 'Quickened',suffix: 'Alacrity' },
  life_steal_pct:       { prefix: 'Vampiric', suffix: 'Leeching' },
};

// A drop keeps its authored name when it's a specific/scripted item rather than generic loot:
// signature items (rider amulets), scripted no-drops (soul shard), and consumables (potions).
function _hasFixedName(base) {
  return !!(base?.signatureAffix || base?.noDrop || base?.fixedName || base?.heal);
}

function _nounsFor(base) {
  if (base?.weaponType) return [base.weaponType];       // Dagger, Longsword, … already clean
  const bySlot = SLOT_NOUNS[base?.slot];
  if (!bySlot) return ['Trinket'];
  if (Array.isArray(bySlot)) return bySlot;
  return bySlot[base?.material] ?? bySlot._default ?? ['Trinket'];   // material-keyed armor
}

// Build the display name for one dropped item. `affixes` is the rolled array from rollAffixes().
export function generateItemName(base, rarity, affixes) {
  if (_hasFixedName(base)) return base.name;

  const nouns = _nounsFor(base);
  // grey is the affix-less floor: always "Simple <plain noun>" (user's rule).
  if (rarity === 'grey') return `Simple ${nouns[0]}`;

  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const worded = (affixes ?? []).map(a => AFFIX_WORDS[a.key]).filter(Boolean);
  if (!worded.length) return noun;   // 0 affixes (unbuilt slot) — just the noun

  // Every enchanted item reads as "<Prefix> <noun> of <Suffix>". With ONE affix, that affix
  // supplies both words (Keen Bracers of Precision); with TWO+, the prefix comes from the first
  // and the suffix from the second, so each affix shows once (Keen Bracers of Mending).
  let name = noun;
  const pre = worded[0];
  const suf = worded.length === 1 ? worded[0] : worded[1];
  if (pre.prefix) name = `${pre.prefix} ${name}`;
  if (suf.suffix) name = `${name} of ${suf.suffix}`;
  return name;
}
