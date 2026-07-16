import { UNIT_TYPES } from './constants.js';
import { totalSpellSlots, totalSpellSlotsMax } from './spells.js';

// NOTE: these pips show the TOTAL slots across every spell level, which is exactly what
// they showed before slots went per-level — and is still accurate while every spell in
// the game is level 0 or 1. Once 2nd-level spells exist this row has to become one row
// PER spell level, or a caster with 4×1st + 3×2nd reads as an undifferentiated "7".

// Builds the per-hero spell/ability panel from scratch (called from activateTurn).
// Handlers are injected as callbacks so this module stays decoupled from combat.js.
export function buildHeroSpellPanel(u, el, {
  turnAttacked, turnBonusActioned,
  onSpellBtn, onRageBtn, onElfSpellBtn, onSneakBtn,
}) {
  el.innerHTML = '';

  if (u.type === 'human' && u.rageUses !== undefined) {
    const rageDef = UNIT_TYPES[u.type].rage;
    const usesMax = u.rageUsesMax ?? rageDef.uses;
    const rageRow = document.createElement('div');
    rageRow.className = 'thud-slot-row';
    rageRow.innerHTML =
      '<span class="thud-label thud-spell-lbl">RAGES</span>' +
      '<span class="thud-slot-pips">' +
      Array.from({ length: usesMax }, (_, i) =>
        `<span class="slot-pip${i < (u.rageUses ?? 0) ? ' filled' : ''}">◆</span>`
      ).join('') + '</span>';
    el.appendChild(rageRow);
    const rageBtn = document.createElement('button');
    rageBtn.className     = 'spell-btn rage-btn';
    rageBtn.dataset.spell = 'rage';
    rageBtn.innerHTML     = '<span class="sp-name">⚔ Rage</span><span class="sp-tag sp-ba">BA</span>';
    rageBtn.disabled      = (u.rageUses ?? 0) <= 0 || u.raging || turnBonusActioned;
    rageBtn.classList.toggle('spell-active', !!u.raging);
    rageBtn.addEventListener('click', onRageBtn);
    el.appendChild(rageBtn);

  } else if (u.type === 'elf' && Array.isArray(u.spellSlotsByLevel)) {
    const slotsMax = totalSpellSlotsMax(u);
    const slotRow  = document.createElement('div');
    slotRow.className = 'thud-slot-row';
    slotRow.innerHTML =
      '<span class="thud-label thud-spell-lbl">SLOTS</span>' +
      '<span class="thud-slot-pips">' +
      Array.from({ length: slotsMax }, (_, i) =>
        `<span class="slot-pip${i < totalSpellSlots(u) ? ' filled' : ''}">◆</span>`
      ).join('') + '</span>';
    el.appendChild(slotRow);

  } else if (u.type === 'halfling') {
    const sneakBtn = document.createElement('button');
    sneakBtn.className     = 'spell-btn sneak-btn';
    sneakBtn.dataset.spell = 'sneak_attack';
    sneakBtn.innerHTML     = '<span class="sp-name">Sneak Attack</span>';
    sneakBtn.disabled      = turnAttacked;
    sneakBtn.addEventListener('click', onSneakBtn);
    el.appendChild(sneakBtn);
  }
}

// Updates an already-built panel's button states (called from updateCombatStatus).
export function refreshHeroSpellPanel(u, el, { turnAttacked, turnBonusActioned, heroMode }) {
  if (!el) return;

  if (u.type === 'human') {
    const rageBtn = el.querySelector('.spell-btn[data-spell="rage"]');
    if (rageBtn) {
      rageBtn.disabled = (u.rageUses ?? 0) <= 0 || u.raging || turnBonusActioned;
      rageBtn.classList.toggle('spell-active', !!u.raging);
    }
    el.querySelectorAll('.slot-pip').forEach((pip, i) =>
      pip.classList.toggle('filled', i < (u.rageUses ?? 0))
    );

  } else if (u.type === 'elf') {
    el.querySelectorAll('.spell-btn[data-spell]').forEach(btn => {
      btn.disabled = totalSpellSlots(u) <= 0 || turnAttacked;
      btn.classList.toggle('spell-active', heroMode === 'elfatk_' + btn.dataset.spell);
    });
    el.querySelectorAll('.slot-pip').forEach((pip, i) =>
      pip.classList.toggle('filled', i < totalSpellSlots(u))
    );

  } else if (u.type === 'halfling') {
    const sneakBtn = el.querySelector('.spell-btn[data-spell="sneak_attack"]');
    if (sneakBtn) sneakBtn.disabled = turnAttacked;
  }
}
