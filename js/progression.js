import * as THREE from 'three';
import { camera, renderer } from './scene.js';
import { units, heroRoster } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { playSound } from './audio.js';
import { showLevelUpModal } from './levelUpModal.js';

const _pv             = new THREE.Vector3();
const _xpBubbleFills  = Array.from(document.querySelectorAll('.xp-bubble-fill'));
const _xpCurLabel     = document.getElementById('xp-cur-label');
const _xpPctLabel     = document.getElementById('xp-pct-label');
const _xpNextLabel    = document.getElementById('xp-next-label');

// Custom 100-level progression — cumulative XP to reach each level (index = level, 1-indexed)
// Matches the XP Table displayed in-game. First 20 levels shown explicitly; expands to 100.
const XP_THRESHOLDS = [
  0,      // level 1  (starting)
  200,    // level 2
  450,    // level 3
  750,    // level 4
  1100,   // level 5
  1500,   // level 6
  1950,   // level 7
  2450,   // level 8
  3000,   // level 9
  3600,   // level 10
  4300,   // level 11
  5100,   // level 12
  6000,   // level 13
  7000,   // level 14
  8200,   // level 15
  9500,   // level 16
  11000,  // level 17
  12700,  // level 18
  14600,  // level 19
  16700,  // level 20
];
const MAX_LEVEL = XP_THRESHOLDS.length; // 20

function _xpFloor(lvl) { return XP_THRESHOLDS[lvl - 1] ?? XP_THRESHOLDS[MAX_LEVEL - 1]; }
function _xpCeil(lvl)  { return XP_THRESHOLDS[lvl]     ?? Infinity; }

// Cumulative XP needed to reach a given level — exported for the dev-only
// "set party level" tool, which awards this much XP in one shot starting
// from level 1 so every intermediate level-up (HP gain, ability unlocks,
// hero:levelup event) fires exactly as it would in a real playthrough.
export function xpForLevel(level) {
  return _xpFloor(Math.max(1, Math.min(level, MAX_LEVEL)));
}
export const MAX_HERO_LEVEL = MAX_LEVEL;

// Level-aware XP progress for a hero — single source of truth so every
// display (top XP bar, character sheet, etc.) agrees with the actual
// XP_THRESHOLDS table instead of each computing its own (wrong) numbers.
export function getXpProgress(hero) {
  const level = hero?.level ?? 1;
  const floor = _xpFloor(level);
  const ceil  = level >= MAX_LEVEL ? floor : _xpCeil(level);
  const span  = Math.max(1, ceil - floor);
  const earned = Math.max(0, (hero?.xp ?? 0) - floor);
  return { level, earned, span, maxed: level >= MAX_LEVEL };
}

function showFloatingXP(hero, amount) {
  if (!hero.anchor) return;
  _pv.set(hero.anchor.x, hero.anchor.y + 1.0, hero.anchor.z).project(camera);
  if (_pv.z >= 1) return;
  const el = document.createElement('div');
  el.className   = 'xp-float';
  el.textContent = `+${amount} XP`;
  el.style.left  = ((_pv.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  el.style.top   = ((-_pv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 3500);
}

export function showLevelUpFloat(hero) {
  if (!hero.anchor) return;
  _pv.set(hero.anchor.x, hero.anchor.y + 1.6, hero.anchor.z).project(camera);
  if (_pv.z >= 1) return;
  const el = document.createElement('div');
  el.className   = 'levelup-float';
  el.textContent = '⬆ LEVEL UP!';
  el.style.left  = ((_pv.x * 0.5 + 0.5) * renderer.domElement.clientWidth)  + 'px';
  el.style.top   = ((-_pv.y * 0.5 + 0.5) * renderer.domElement.clientHeight) + 'px';
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 5000);
}

export function updateXPBar() {
  const hero = heroRoster[0];
  if (!hero) return;

  const { level, earned, span, maxed } = getXpProgress(hero);
  const pct = maxed ? 1 : Math.min(1, earned / span);

  if (_xpCurLabel)  _xpCurLabel.textContent  = earned.toLocaleString();
  if (_xpPctLabel)  _xpPctLabel.textContent  = `Level ${level}`;
  if (_xpNextLabel) _xpNextLabel.textContent = span.toLocaleString();

  const N = _xpBubbleFills.length;
  _xpBubbleFills.forEach((fill, i) => {
    const bubblePct = Math.max(0, Math.min(1, (pct * N - i)));
    fill.style.width = `${bubblePct * 100}%`;
  });
}

// addLog is passed in to avoid a circular import with combat.js
export function awardXP(amount, addLog) {
  const heroes = heroRoster;
  if (!heroes.length) return;

  addLog(`✦ Party gains ${amount} XP`, 'xp');

  // Collect all level-ups across all heroes (a single award could span multiple levels)
  const levelUps = [];
  heroes.forEach(hero => {
    const oldLevel = hero.level ?? 1;
    hero.xp += amount;
    while ((hero.level ?? 1) < MAX_LEVEL && hero.xp >= _xpCeil(hero.level ?? 1)) {
      hero.level = (hero.level ?? 1) + 1;
      levelUps.push({ hero, newLevel: hero.level, oldLevel });
    }
  });

  updateXPBar();
  setTimeout(() => heroes.forEach(h => showFloatingXP(h, amount)), 300);

  if (levelUps.length) {
    setTimeout(() => {
      playSound('level_up');
      const modalMap = new Map();
      levelUps.forEach(({ hero, newLevel, oldLevel }) => {
        const heroDef = UNIT_TYPES[hero.type] ?? {};
        const _hpRate = { elf: 1, dwarf: 2, halfling: 2, human: 2.5 }[hero.type] ?? 2;
        const _frac   = (hero.hpFrac ?? 0) + _hpRate;
        const hpGain  = Math.floor(_frac);
        hero.hpFrac   = _frac - hpGain;
        hero.maxHp   += hpGain;
        hero.hp      += hpGain;
        showLevelUpFloat(hero);
        addLog(`⬆ ${heroDef.name} reaches Level ${newLevel}! +${hpGain} HP`, 'levelup');
        window.dispatchEvent(new CustomEvent('hero:levelup', { detail: { hero, newLevel } }));
        // Aggregate per hero for the modal (handles multi-level jumps)
        if (modalMap.has(hero)) {
          const e = modalMap.get(hero);
          e.hpGain  += hpGain;
          e.newLevel = newLevel;
        } else {
          modalMap.set(hero, { hero, newLevel, hpGain, oldLevel });
        }
      });
      setTimeout(() => showLevelUpModal([...modalMap.values()]), 700);
    }, 1800);
  }
}
