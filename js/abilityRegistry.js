// js/abilityRegistry.js — single source of truth for what abilities (skills,
// cantrips, spells) each hero type can have, and how to display them. Shared
// between combat.js (hotbar execution) and ui.js (Skills & Spells window +
// drag-and-drop onto the hotbar).
import { isAbilityUnlocked } from './spells.js';

// Display metadata only — execution/availability logic lives in combat.js's
// _ABILITY_HANDLERS (keeps this module free of combat-state imports).
export const ABILITY_META = {
  dash:             { name: 'Dash',             label: 'DASH',               cssClass: 'hb-sprint' },
  dodge:            { name: 'Dodge',            label: 'DODGE',              cssClass: 'hb-dodge' },
  rage:             { name: 'Rage',             imgSrc: 'assets/spells and skills/rage.jpg' },
  sneak_attack:     { name: 'Sneak Attack',     imgSrc: 'assets/spells and skills/sneak attack.jpg' },
  // Precision is a PASSIVE with no button — it's here purely as the one place its art is
  // named, the way ui.js already pulls ABILITY_META.sneak_attack.imgSrc for an inline row
  // image. It is deliberately absent from HERO_ABILITY_LAYOUT below, so it never renders
  // as a hotbar slot (it couldn't anyway — human and halfling are both at the 5-skill cap).
  precision:        { name: 'Precision',        imgSrc: 'assets/spells and skills/precision.jpg' },
  // "Combat Hide" since 2026-07-18 — out-of-combat stealth is the whole party's now, so this
  // key is specifically the in-combat bonus-action version.
  hide:             { name: 'Combat Hide',     imgSrc: 'assets/spells and skills/hide.jpg' },
  defensive_stance: { name: 'Defensive Stance', imgSrc: 'assets/spells and skills/defensive stance.jpg' },
  smoke_mirrors:    { name: 'Smoke & Mirrors',  imgSrc: 'assets/spells and skills/smoke and mirrors.jpg' },
  healing_word:     { name: 'Healing Word',     imgSrc: 'assets/spells and skills/healingword.jpg' },
  cure_wounds:      { name: 'Cure Wounds',      imgSrc: 'assets/spells and skills/cure wounds.jpg' },
  sacred_flame:     { name: 'Sacred Flame',     imgSrc: 'assets/spells and skills/sacred flame.jpg' },
  fire_bolt:        { name: 'Fire Bolt',        imgSrc: 'assets/spells and skills/firebolt.jpg' },
  bless:            { name: 'Bless',            imgSrc: 'assets/spells and skills/bless.jpg' },
  mage_armor:       { name: 'Mage Armor',       imgSrc: 'assets/spells and skills/magearmor.jpg' },
  magic_missile:    { name: 'Magic Missile',    imgSrc: 'assets/spells and skills/magicmissile.jpg' },
  find_familiar:    { name: 'Find Familiar',    imgSrc: 'assets/spells and skills/find familiar.jpg' },
  sleep:            { name: 'Sleep',            imgSrc: 'assets/spells and skills/sleep.jpg' },
  reckless_attack:  { name: 'Reckless Attack',  imgSrc: 'assets/spells and skills/recklessattack.jpg' },
  sanctuary:        { name: 'Sanctuary',        imgSrc: 'assets/spells and skills/sanctuary.jpg' },
  turn_undead:      { name: 'Turn Undead',      imgSrc: 'assets/spells and skills/turn undead.jpg' },
  burning_hands:    { name: 'Burning Hands',    imgSrc: 'assets/spells and skills/burninghands.jpg' },
  // The L5–L7 abilities (2026-07-20) all shipped as {label, cssClass} text icons because no
  // art existed for them. Every one got its .jpg on 2026-07-27 and moved up to {imgSrc}, so
  // dash and dodge are now the ONLY text-icon entries left — deliberately, they've always
  // been text. If a future ability lands art-less, give it {label, cssClass} and an .hb-*
  // rule in style.css; this table stays the only place the hotbar and S&S window read.
  // second_wind and pick_locks are out-of-combat only (their own modules bind KeyQ directly,
  // the way Healing Word OOC does) so neither is in HERO_ABILITY_LAYOUT and neither renders
  // as a combat slot. They're listed here purely because their art is read from TWO files
  // each — the OOC module's hotbar button and ui.js's S&S row — and one path beats two
  // literals drifting apart.
  second_wind:      { name: 'Second Wind',      imgSrc: 'assets/spells and skills/secondwind.jpg' },
  pick_locks:       { name: 'Pick Locks',       imgSrc: 'assets/spells and skills/picklocks.jpg' },
  // sleight_of_hand is a PASSIVE proficiency with nothing to activate (see js/skills.js) —
  // here for its art alone, like precision above. Not in HERO_ABILITY_LAYOUT, so no button.
  sleight_of_hand:  { name: 'Sleight of Hand',  imgSrc: 'assets/spells and skills/sleightofhand.jpg' },
};

// HTML for a fixed hotbar (.hb-btn) slot — absolutely-positioned image fill,
// matching the pre-existing per-ability hotbar markup.
export function hotbarIconHTML(key) {
  const meta = ABILITY_META[key];
  if (!meta) return key;
  if (meta.imgSrc) return `<img class="hb-spell-img-fill" src="${meta.imgSrc}" alt="${meta.name ?? key}">`;
  return `<span class="${meta.cssClass ?? ''}">${meta.label}</span>`;
}

// HTML for a Skills & Spells window box (.sb-btn) — flex-fit image, matching
// the pre-existing sb-spell-img convention used for prepared spells/cantrips.
export function sbIconHTML(key) {
  const meta = ABILITY_META[key];
  if (!meta) return key;
  if (meta.imgSrc) return `<img src="${meta.imgSrc}" class="sb-spell-img" alt="${meta.name ?? key}">`;
  return meta.label; // innerHTML — label may contain <br>
}

// Per-hero-type ordering within each category. Abilities are shown left to
// right in this order, filtered down to whatever the hero has unlocked at
// their current level (isAbilityUnlocked — abilities not gated in
// LEVEL_SPELLS default to available from level 1, e.g. dash/dodge/rage).
// ⚠ `skills` is capped at FIVE — the buttons are static markup (index.html #sb-skill-0..4)
// and ui.js loops to 5. A sixth entry is computed and then silently dropped, with no error.
// human and halfling are both AT the cap now; anything further needs new buttons first.
const HERO_ABILITY_LAYOUT = {
  dwarf:    { skills: ['dash', 'dodge'],                                       cantrips: ['healing_word', 'sacred_flame', 'turn_undead'], spells: ['bless', 'cure_wounds', 'sanctuary'] },
  human:    { skills: ['dash', 'dodge', 'rage', 'defensive_stance', 'reckless_attack'], cantrips: [],                       spells: [] },
  elf:      { skills: ['dash', 'dodge'],                                       cantrips: ['fire_bolt'],                    spells: ['mage_armor', 'magic_missile', 'sleep', 'burning_hands'] },
  halfling: { skills: ['dash', 'dodge', 'sneak_attack', 'hide', 'smoke_mirrors'], cantrips: [],                             spells: [] },
};

// Returns the ordered list of ability keys a hero currently has unlocked in
// one category ('skills' | 'cantrips' | 'spells').
export function getAvailableAbilities(heroType, level, category) {
  const keys = HERO_ABILITY_LAYOUT[heroType]?.[category] ?? [];
  return keys.filter(key => isAbilityUnlocked(heroType, level ?? 1, key));
}
