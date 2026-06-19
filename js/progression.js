import * as THREE from 'three';
import { camera, renderer } from './scene.js';
import { units } from './units.js';
import { UNIT_TYPES } from './constants.js';
import { playSound } from './audio.js';

const _pv        = new THREE.Vector3();
const _xpBarFill = document.getElementById('xp-bar-fill');

function showFloatingXP(hero, amount) {
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

function showLevelUpFloat(hero) {
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
  const hero = units.find(h => h.team === 'blue');
  if (!hero || !_xpBarFill) return;
  const xpNext = UNIT_TYPES[hero.type]?.xpNext ?? 300;
  _xpBarFill.style.width = `${Math.min(100, ((hero.xp ?? 0) / xpNext) * 100)}%`;
}

// addLog is passed in to avoid a circular import with combat.js
export function awardXP(amount, addLog) {
  const heroes = units.filter(h => h.team === 'blue' && h.hp > 0);
  if (!heroes.length) return;

  addLog(`✦ Party gains ${amount} XP`, 'xp');

  const leveledUp = [];
  heroes.forEach(hero => {
    const prev   = hero.xp;
    hero.xp     += amount;
    const xpNext = UNIT_TYPES[hero.type]?.xpNext;
    if (xpNext && prev < xpNext && hero.xp >= xpNext) leveledUp.push(hero);
  });

  updateXPBar();
  setTimeout(() => heroes.forEach(h => showFloatingXP(h, amount)), 300);

  if (leveledUp.length) {
    setTimeout(() => {
      playSound('level_up');
      leveledUp.forEach(hero => {
        const heroDef = UNIT_TYPES[hero.type] ?? {};
        const conMod  = Math.floor(((heroDef.abilities?.con ?? 10) - 10) / 2);
        const hpGain  = (heroDef.hitDie ?? 8) + conMod;
        hero.maxHp   += hpGain;
        hero.hp      += hpGain;
        showLevelUpFloat(hero);
        addLog(`⬆ ${heroDef.name} reaches Level 2! +${hpGain} HP`, 'levelup');
      });
    }, 1800);
  }
}
