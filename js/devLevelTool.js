// js/devLevelTool.js — dev-only "set party level" tool for testing higher-level heroes.
// Resets the party to level 1 / 0 XP / full HP, then awards exactly the XP needed to
// reach the target level in one shot. This replays every real level-up (HP gain per
// hero:levelup listeners, ability unlocks via LEVEL_SPELLS) instead of just poking
// hero.level directly, so spell slots/prepared spells/tendencies all end up in the
// same state a real playthrough would leave them in.
import { heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { IS_DEV } from './devConfig.js';
import { awardXP, xpForLevel, updateXPBar, MAX_HERO_LEVEL } from './progression.js';
import { addLog } from './combat.js';
import { updateHeroUI } from './heroPortraits.js';

function setPartyLevel(target) {
  if (!heroRoster.length) return;
  const lvl = Math.max(1, Math.min(target, MAX_HERO_LEVEL));

  heroRoster.forEach(hero => {
    const base = UNIT_TYPES[hero.type] ?? {};
    hero.level  = 1;
    hero.xp     = 0;
    hero.hpFrac = 0;
    hero.maxHp  = base.hp ?? hero.maxHp;
    hero.hp     = hero.maxHp;
  });
  updateXPBar();
  updateHeroUI();

  if (lvl > 1) awardXP(xpForLevel(lvl), addLog);
}

export function initDevLevelTool() {
  const btn     = document.getElementById('dev-level-btn');
  const overlay = document.getElementById('dev-level-overlay');
  if (!btn || !overlay) return;
  if (!IS_DEV) { btn.style.display = 'none'; return; }

  const closeBtn = document.getElementById('dev-level-close');
  const input    = document.getElementById('dev-level-input');
  const applyBtn = document.getElementById('dev-level-apply');

  btn.addEventListener('click', () => overlay.classList.toggle('show'));
  closeBtn.addEventListener('click', () => overlay.classList.remove('show'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('show'); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') overlay.classList.remove('show');
  });

  applyBtn.addEventListener('click', () => {
    const target = parseInt(input.value, 10) || 1;
    setPartyLevel(target);
    overlay.classList.remove('show');
  });
}
