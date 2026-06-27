import { CUTSCENE as CUTSCENE_INTRO } from './cutscenes/cutscene_intro.js';
import { CUTSCENE as CUTSCENE_WAYSTONE_FIRST } from './cutscenes/cutscene_waystone_first.js';
import { playCombatMusic, stopCombatMusic } from './audio.js';

const _ORDER    = [CUTSCENE_INTRO, CUTSCENE_WAYSTONE_FIRST];
const _registry = Object.fromEntries(_ORDER.map(c => [c.id, c]));

// ── seen tracking ─────────────────────────────────────────────────────────────
const _seenKey  = id => `cs_seen_${id}`;
const _wasSeen  = id => { try { return !!localStorage.getItem(_seenKey(id)); } catch { return false; } };
const _markSeen = id => { try { localStorage.setItem(_seenKey(id), '1'); } catch {} };
export const resetSeen = id => { try { localStorage.removeItem(_seenKey(id)); } catch {} };

// ── state ─────────────────────────────────────────────────────────────────────
let _playing = false, _slideIdx = 0, _cs = null, _locked = false;
let _overlay, _img, _textEl, _promptEl, _skipBtn, _dotsEl, _fadeEl;

// ── public trigger ────────────────────────────────────────────────────────────
export function triggerCutscene(trigger) {
  if (_playing) return;
  const cs = _ORDER.find(c => c.trigger === trigger);
  if (!cs || (cs.playOnce && _wasSeen(cs.id))) {
    if (trigger === 'game_start') window.dispatchEvent(new CustomEvent('game:ready'));
    return;
  }
  _play(cs);
}

// ── player ────────────────────────────────────────────────────────────────────
function _play(cs) {
  _cs = cs; _playing = true; _slideIdx = 0;
  playCombatMusic('prologue_music');
  _overlay.style.display = 'flex';
  // double-rAF so display:flex has painted before opacity transition starts
  requestAnimationFrame(() => requestAnimationFrame(() => {
    _overlay.classList.add('cs-active');
    _loadSlide(0);
  }));
}

function _loadSlide(idx) {
  const slide = _cs.slides[idx];

  // Ensure black overlay is up while image/position changes
  _fadeEl.classList.add('cs-fade-on');

  // Title-card mode (no image) vs normal image slide
  if (slide.img) {
    _img.style.display = '';
    _img.className = 'cs-img';
    _img.style.animation = 'none';
    void _img.offsetWidth;
    _img.style.animation = '';
    _img.className = `cs-img cs-pan-${slide.pan ?? 'left'}`;
    _img.style.objectPosition = slide.objPos ?? '';
    _img.src = slide.img;
    _overlay.classList.remove('cs-title-card');
  } else {
    _img.style.display = 'none';
    _overlay.classList.add('cs-title-card');
  }

  // Fade from black once image is ready
  setTimeout(() => _fadeEl.classList.remove('cs-fade-on'), 120);

  _textEl.classList.remove('cs-text-in');
  _promptEl.classList.remove('cs-prompt-in');

  _dotsEl.innerHTML = _cs.slides.map((_, i) =>
    `<span class="cs-dot${i === idx ? ' cs-dot-on' : ''}"></span>`).join('');

  // Lock click-through briefly, then reveal text 1 second after image fades in (~120ms)
  // textContent is set here — not earlier — so the new text never flashes during the fade-out
  _locked = true;
  setTimeout(() => { _locked = false; }, 400);
  setTimeout(() => {
    _textEl.textContent = slide.text;
    _textEl.classList.add('cs-text-in');
    setTimeout(() => _promptEl.classList.add('cs-prompt-in'), 700);
  }, 1120);
}

function _advance() {
  if (_locked || !_playing) return;
  _slideIdx++;
  if (_slideIdx >= _cs.slides.length) { _finish(); return; }
  _locked = true;
  _fadeEl.classList.add('cs-fade-on');
  _textEl.classList.remove('cs-text-in');
  _promptEl.classList.remove('cs-prompt-in');
  setTimeout(() => _loadSlide(_slideIdx), 460);
}

function _finish() {
  if (_cs.playOnce) _markSeen(_cs.id);
  const trigger = _cs.trigger;
  stopCombatMusic();
  _overlay.classList.remove('cs-active');
  setTimeout(() => {
    _overlay.style.display = 'none';
    _playing = false;
    _cs = null;
    if (trigger === 'game_start') window.dispatchEvent(new CustomEvent('game:ready'));
  }, 420);
}

// ── dev panel ─────────────────────────────────────────────────────────────────
function _buildPanel() {
  const listEl = document.getElementById('cutscene-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  _ORDER.forEach(cs => {
    const row = document.createElement('div');
    row.className = 'cs-row';
    row.innerHTML =
      `<div class="cs-row-info">
        <div class="cs-row-name">${cs.name}</div>
        <div class="cs-row-meta">
          <span class="cs-badge">${cs.trigger}</span>
          <span class="cs-slide-count">${cs.slides.length} slides</span>
        </div>
      </div>
      <div class="cs-row-btns">
        <button class="s-btn cs-btn-play" data-id="${cs.id}" title="Preview">▶</button>
        <button class="s-btn cs-btn-reset" data-id="${cs.id}" title="Reset seen flag">↺</button>
      </div>`;
    listEl.appendChild(row);
  });
  listEl.addEventListener('click', e => {
    const p = e.target.closest('.cs-btn-play');
    if (p) { const c = _registry[p.dataset.id]; if (c) _play(c); return; }
    const r = e.target.closest('.cs-btn-reset');
    if (r) resetSeen(r.dataset.id);
  });
}

// ── init ──────────────────────────────────────────────────────────────────────
export function initCutsceneUI() {
  _overlay  = document.getElementById('cutscene-overlay');
  _img      = document.getElementById('cs-img');
  _fadeEl   = document.getElementById('cs-fade');
  _textEl   = document.getElementById('cs-text');
  _promptEl = document.getElementById('cs-prompt');
  _skipBtn  = document.getElementById('cs-skip');
  _dotsEl   = document.getElementById('cs-dots');

  _overlay.addEventListener('click', _advance);
  _skipBtn.addEventListener('click', e => { e.stopPropagation(); _finish(); });

  window.addEventListener('zone:loaded',        e  => triggerCutscene(`zone_enter:${e.detail?.id}`));
  window.addEventListener('combat:ended',      () => triggerCutscene('combat_ended'));
  window.addEventListener('ui:ready',          () => triggerCutscene('game_start'));
  window.addEventListener('waystone:activated', () => triggerCutscene('waystone_first'));

  _buildPanel();
}
