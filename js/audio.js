// js/audio.js — Web Audio system: ambient crossfade, combat one-shots, dev mixer

// ── Volume config (edit these to tune the mix) ────────────────────────────────
const VOL = {
  master:  1.0,
  ambient: 0.35,
  combat:  0.80,
  ui:      0.55,
  music:   0.50,
};

// ── Sound manifest ────────────────────────────────────────────────────────────
const SOUNDS = {
  // Ambient loops — one per biome
  forest:        { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  goblin_ambush: { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  river_styx:    { src: 'assets/Audio/ambient/RiverStyxAmbience.mp3', category: 'ambient', loop: true, volume: 0.3 },
  dungeon:       { src: 'assets/Audio/ambient/RiverStyxAmbience.mp3', category: 'ambient', loop: true },
  swamp:         { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  tundra:        { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  savanna:       { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  desert:        { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  graveyard:     { src: 'assets/Audio/ambient/ForestAmbience.mp3', category: 'ambient', loop: true },
  // Unit-specific — aggro & attack vocalizations
  mane_dretch_aggro:  { src: 'assets/Audio/combat/mane dretch aggro.mp3',  category: 'combat' },
  mane_dretch_attack: { src: 'assets/Audio/combat/mane dretch attack.mp3', category: 'combat' },
  orc_aggro:          { src: 'assets/Audio/combat/orc aggro.mp3',           category: 'combat' },
  orc_attack:         { src: 'assets/Audio/combat/orc attack.mp3',          category: 'combat' },
  ogre_aggro:         { src: 'assets/Audio/combat/ogre aggro.mp3',          category: 'combat' },
  ogre_attack:        { src: 'assets/Audio/combat/ogre attack.mp3',         category: 'combat' },
  chicken_aggro:      { src: 'assets/Audio/combat/chicken aggro.mp3',       category: 'combat' },
  chicken_attack:     { src: 'assets/Audio/combat/chicken attack.mp3',      category: 'combat' },
  goblin_aggro:       { src: 'assets/Audio/combat/goblin aggro.mp3',        category: 'combat' },
  goblin_attack:      { src: 'assets/Audio/combat/goblin attack.mp3',       category: 'combat' },
  goblin_yell:        { src: 'assets/Audio/combat/goblin yell.mp3',         category: 'combat' },
  goblin_moving:      { src: 'assets/Audio/combat/goblin moving.mp3',       category: 'combat' },
  wolf_aggro:         { src: 'assets/audio/combat/wolf aggro.mp3',          category: 'combat' },
  wolf_attack:        { src: 'assets/audio/combat/wolf attack.mp3',         category: 'combat' },
  wolf_moving:        { src: 'assets/audio/combat/wolf moving.mp3',         category: 'combat' },
  warg_aggro:         { src: 'assets/audio/combat/warg aggro.mp3',          category: 'combat' },
  warg_attack:        { src: 'assets/audio/combat/warg attack.mp3',         category: 'combat' },
  warg_moving:        { src: 'assets/audio/combat/warg moving.mp3',         category: 'combat' },
  // Cutscene / prologue music
  prologue_music:  { src: 'assets/audio/ambient/prologuemusic.mp3', category: 'music', loop: true },
  // Combat music
  combat_music:    { src: 'assets/Audio/combat/combat background music.mp3', category: 'music', loop: true },
  // Weapon / spell sounds
  berserker_rage:   { src: 'assets/Audio/combat/berserker rage.mp3',                 category: 'combat' },
  sword_swing:      { src: 'assets/Audio/combat/sword swing.mp3',                   category: 'combat' },
  human_attack:     { src: 'assets/Audio/combat/human warrior attack.mp3',          category: 'combat' },
  halfling_attack:  { src: 'assets/Audio/combat/halfling attack.mp3',               category: 'combat' },
  dwarf_attack:     { src: 'assets/Audio/combat/dwarf attack.mp3',                 category: 'combat' },
  range_attack_bow: { src: 'assets/Audio/combat/weapon sounds/range attack bow.mp3', category: 'combat' },
  fire_bolt:        { src: 'assets/Audio/magic sounds/fire bolt.mp3',                category: 'combat' },
  healing:          { src: 'assets/Audio/magic sounds/healing word.mp3',             category: 'combat' },
  // Combat one-shots (files not yet added — will silently skip)
  sword_hit:     { src: 'assets/Audio/combat/sword_hit.mp3',      category: 'combat' },
  arrow_shoot:   { src: 'assets/Audio/combat/arrow_shoot.mp3',    category: 'combat' },
  arrow_hit:     { src: 'assets/Audio/combat/arrow_hit.mp3',      category: 'combat' },
  miss:          { src: 'assets/Audio/combat/miss.mp3',           category: 'combat' },
  death:         { src: 'assets/Audio/combat/death.mp3',          category: 'combat' },
  // UI (files not yet added — will silently skip)
  combat_start:  { src: 'assets/Audio/ui/combat_start.mp3',       category: 'ui' },
  turn_start:    { src: 'assets/Audio/ui/turn_start.mp3',         category: 'ui' },
  level_up:      { src: 'assets/audio/system sounds/Ding.mp3',    category: 'ui' },
};

const FADE_SECS = 1.5;   // ambient crossfade duration

// ── Internal state ────────────────────────────────────────────────────────────
let _ctx           = null;   // AudioContext — created on first user interaction
let _masterGain    = null;
const _catGains    = {};     // category GainNode per category name
const _buffers     = {};     // decoded AudioBuffer per sound key
const _ambientNode = { src: null, gain: null };  // currently playing ambient
const _musicNode   = { src: null, gain: null };  // currently playing combat music

// ── AudioContext bootstrap ────────────────────────────────────────────────────
function _getCtx() {
  if (_ctx) return _ctx;
  _ctx = new (window.AudioContext || window.webkitAudioContext)();

  _masterGain = _ctx.createGain();
  _masterGain.gain.value = VOL.master;
  _masterGain.connect(_ctx.destination);

  for (const cat of ['ambient', 'combat', 'ui', 'music']) {
    const g = _ctx.createGain();
    g.gain.value = VOL[cat] ?? 1.0;
    g.connect(_masterGain);
    _catGains[cat] = g;
  }

  return _ctx;
}

// Resume suspended context on first gesture (browser autoplay policy)
document.addEventListener('pointerdown', () => {
  if (_ctx?.state === 'suspended') _ctx.resume();
}, { once: false });

// ── Buffer loading ────────────────────────────────────────────────────────────
async function _load(key) {
  if (_buffers[key]) return _buffers[key];
  const def = SOUNDS[key];
  if (!def) return null;
  try {
    const resp = await fetch(def.src);
    if (!resp.ok) return null;
    const arr  = await resp.arrayBuffer();
    const ctx  = _getCtx();
    _buffers[key] = await ctx.decodeAudioData(arr);
    return _buffers[key];
  } catch {
    return null;  // file missing — fail silently
  }
}

export async function initAudio() {
  // Pre-load all sounds in parallel; missing files are silently skipped.
  await Promise.all(Object.keys(SOUNDS).map(_load));
}

// ── One-shot playback ─────────────────────────────────────────────────────────
export function playSound(key) {
  const buf = _buffers[key];
  if (!buf) return;
  const ctx = _getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const cat = SOUNDS[key]?.category ?? 'combat';
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(_catGains[cat] ?? _masterGain);
  src.start();
}

// ── Ambient crossfade ─────────────────────────────────────────────────────────
export function playAmbient(biomeKey) {
  const buf = _buffers[biomeKey];
  const ctx = _getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // Fade out and stop old ambient
  if (_ambientNode.src && _ambientNode.gain) {
    const oldGain = _ambientNode.gain;
    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    oldGain.gain.linearRampToValueAtTime(0, now + FADE_SECS);
    const oldSrc = _ambientNode.src;
    setTimeout(() => { try { oldSrc.stop(); } catch {} }, (FADE_SECS + 0.1) * 1000);
    _ambientNode.src  = null;
    _ambientNode.gain = null;
  }

  if (!buf) return;  // no file for this biome yet — silence is fine

  // Fade in new ambient
  const targetVol = SOUNDS[biomeKey]?.volume ?? 1.0;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(targetVol, now + FADE_SECS);
  gain.connect(_catGains.ambient);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop   = true;
  src.connect(gain);
  src.start();

  _ambientNode.src  = src;
  _ambientNode.gain = gain;
}

export function stopAmbient() {
  playAmbient(null);  // fades out current without starting a new one
}

// ── Combat music ──────────────────────────────────────────────────────────────
export function playCombatMusic(key) {
  const buf = key ? _buffers[key] : null;
  const ctx = _getCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  if (_musicNode.src && _musicNode.gain) {
    const oldGain = _musicNode.gain;
    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
    oldGain.gain.linearRampToValueAtTime(0, now + FADE_SECS);
    const oldSrc = _musicNode.src;
    setTimeout(() => { try { oldSrc.stop(); } catch {} }, (FADE_SECS + 0.1) * 1000);
    _musicNode.src  = null;
    _musicNode.gain = null;
  }

  if (!buf) return;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1.0, now + FADE_SECS);
  gain.connect(_catGains.music);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop   = true;
  src.connect(gain);
  src.start();

  _musicNode.src  = src;
  _musicNode.gain = gain;
}

export function stopCombatMusic() {
  playCombatMusic(null);
}

// ── Volume control ────────────────────────────────────────────────────────────
export function setMasterVolume(v) {
  VOL.master = v;
  if (_masterGain) _masterGain.gain.value = v;
}

export function setCategoryVolume(cat, v) {
  VOL[cat] = v;
  if (_catGains[cat]) _catGains[cat].gain.value = v;
}

export function getVolumes() {
  return { ...VOL };
}

// ── Dev mixer panel ───────────────────────────────────────────────────────────
// ── Per-unit-type sound hooks ─────────────────────────────────────────────────
// Add entries here to give any unit type its own aggro / attack sounds.
const UNIT_SOUNDS = {
  mane:           { aggro: 'mane_dretch_aggro', attack: 'mane_dretch_attack' },
  abyssal_wretch: { aggro: 'mane_dretch_aggro', attack: 'mane_dretch_attack' },
  orc:            { aggro: 'orc_aggro',          attack: 'orc_attack' },
  ogre:           { aggro: 'ogre_aggro',         attack: 'ogre_attack' },
  abyssal_chicken: { aggro: 'chicken_aggro',     attack: 'chicken_attack' },
  goblin:          { aggro: 'goblin_aggro',      attack: 'goblin_yell',  move: 'goblin_moving' },
  wolf:            { aggro: 'wolf_aggro',        attack: 'wolf_attack',  move: 'wolf_moving' },
  warg:            { aggro: 'warg_aggro',        attack: 'warg_attack',  move: 'warg_moving' },
  human:           { attack: 'human_attack' },
  halfling:        { attack: 'halfling_attack' },
  dwarf:           { attack: 'dwarf_attack' },
};

export function playUnitAggroSound(unitType) {
  const key = UNIT_SOUNDS[unitType]?.aggro;
  if (key) playSound(key);
}

export function playUnitAttackSound(unitType) {
  const key = UNIT_SOUNDS[unitType]?.attack;
  if (key) playSound(key);
}

export function playUnitMoveSound(unitType) {
  const key = UNIT_SOUNDS[unitType]?.move;
  if (key) playSound(key);
}

export function getUnitAttackDuration(unitType) {
  const key = UNIT_SOUNDS[unitType]?.attack;
  return key ? (_buffers[key]?.duration ?? 0) : 0;
}

// ── Dev mixer panel ───────────────────────────────────────────────────────────
export function initMixerPanel() {
  const btn   = document.getElementById('audio-mixer-btn');
  const panel = document.getElementById('audio-mixer-panel');
  if (!btn || !panel) return;

  btn.addEventListener('click', () => {
    const open = panel.classList.toggle('show');
    btn.classList.toggle('active', open);
  });

  function _bindSlider(id, getter, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = getter();
    const lbl = el.parentElement?.querySelector('.amx-val');
    const update = () => {
      setter(parseFloat(el.value));
      if (lbl) lbl.textContent = Math.round(parseFloat(el.value) * 100) + '%';
    };
    update();
    el.addEventListener('input', update);
  }

  _bindSlider('amx-master',  () => VOL.master,  v => setMasterVolume(v));
  _bindSlider('amx-ambient', () => VOL.ambient, v => setCategoryVolume('ambient', v));
  _bindSlider('amx-combat',  () => VOL.combat,  v => setCategoryVolume('combat', v));
  _bindSlider('amx-ui',      () => VOL.ui,      v => setCategoryVolume('ui', v));
}
