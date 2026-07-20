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
  // ── L5–L7 abilities (2026-07-20) ──────────────────────────────────────────
  // No art yet, so these use the {label, cssClass} text-icon shape (as dash/dodge do)
  // rather than {imgSrc}. Drop a .jpg into assets/spells and skills/ and swap the entry
  // to imgSrc — this table is the only place the hotbar and the S&S window read.
  sleep:            { name: 'Sleep',            label: 'SLEEP',              cssClass: 'hb-sleep' },
  burning_hands:    { name: 'Burning Hands',    label: 'BURN<br>HANDS',      cssClass: 'hb-burning-hands' },
  reckless_attack:  { name: 'Reckless Attack',  label: 'RECK<br>LESS',       cssClass: 'hb-reckless' },
  turn_undead:      { name: 'Turn Undead',      label: 'TURN<br>UNDEAD',     cssClass: 'hb-turn-undead' },
  sanctuary:        { name: 'Sanctuary',        label: 'SANC<br>TUARY',      cssClass: 'hb-sanctuary' },
  // NOT here on purpose: sleight_of_hand (a passive proficiency — nothing to activate,
  // see js/skills.js), pick_locks and second_wind (out-of-combat only, bound straight to
  // KeyQ by their own OOC modules the way Healing Word OOC is).
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
