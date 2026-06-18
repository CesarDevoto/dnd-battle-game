// js/hotbar.js — number-row top, QWERTY-partial + mouse-buttons bottom

const TOP_KEYS = [
  { code: 'Backquote', label: '`' },
  { code: 'Digit1',    label: '1' },
  { code: 'Digit2',    label: '2' },
  { code: 'Digit3',    label: '3' },
  { code: 'Digit4',    label: '4' },
  { code: 'Digit5',    label: '5' },
  { code: 'Digit6',    label: '6' },
];

const BOTTOM_KEYS = [
  { code: 'Tab',  label: 'Tab' },
  { code: 'KeyQ', label: 'Q' },
  { code: 'KeyW', label: 'W' },
  { code: 'KeyE', label: 'E' },
  { code: 'KeyR', label: 'R' },
  { code: 'KeyT', label: 'T' },
  { code: 'KeyY', label: 'Y' },
];

const MOUSE_SLOTS_TOP    = [{ code: 'MouseMiddle', label: 'MMB', button: 1 }];
const MOUSE_SLOTS_BOTTOM = [{ code: 'MouseLeft',   label: 'LMB', button: 0 }];

const ALL_KEYBOARD_KEYS = [...TOP_KEYS, ...BOTTOM_KEYS];

// registry: slotKey → { label, fn, rangeFn }
const _reg  = {};
// keys that survive clearAllHotkeys() (e.g. Top View)
const _perm = new Set();
// button elements: slotKey → <button>
const _btns = {};

function _key(code, shift) { return shift ? code + '_s' : code; }

const _AT_CLASS = { action: 'hb-at-action', bonus: 'hb-at-bonus', reaction: 'hb-at-reaction' };
const _AT_TEXT  = { action: 'A',            bonus: 'BA',           reaction: 'R'              };

function _setActionTag(el, type) {
  if (!type || !_AT_CLASS[type]) {
    el.style.display = 'none';
    el.textContent   = '';
    el.className     = 'hb-action-tag';
    return;
  }
  el.style.display = '';
  el.textContent   = _AT_TEXT[type];
  el.className     = 'hb-action-tag ' + _AT_CLASS[type];
}

// ── Public API ─────────────────────────────────────────────────────────────────

// actionType: 'action' | 'bonus' | 'reaction' | null
export function bindHotkey(code, shift, label, fn, rangeFn = null, actionType = null) {
  const k = _key(code, shift);
  _reg[k] = { label, fn, rangeFn };
  const btn = _btns[k];
  if (btn) {
    btn.querySelector('.hb-label').innerHTML = label;
    _setActionTag(btn.querySelector('.hb-action-tag'), actionType);
  }
}

export function updateHotkeyRanges() {
  for (const [k, entry] of Object.entries(_reg)) {
    const btn = _btns[k];
    if (!btn) continue;
    if (!entry.rangeFn) { btn.classList.remove('hb-disabled'); continue; }
    btn.classList.toggle('hb-disabled', !entry.rangeFn());
  }
}

export function unbindHotkey(code, shift) {
  const k = _key(code, shift);
  delete _reg[k];
  const btn = _btns[k];
  if (btn) {
    btn.querySelector('.hb-label').textContent = '';
    _setActionTag(btn.querySelector('.hb-action-tag'), null);
  }
}

export function clearAllHotkeys() {
  for (const k of Object.keys(_reg)) {
    if (_perm.has(k)) continue;
    delete _reg[k];
    const btn = _btns[k];
    if (btn) {
      btn.querySelector('.hb-label').innerHTML = '';
      btn.classList.remove('hb-disabled');
      _setActionTag(btn.querySelector('.hb-action-tag'), null);
    }
  }
}

// Bind a hotkey that persists across clearAllHotkeys() calls (e.g. global toggles).
// Pass getActive() to keep the button visually toggled.
export function bindPermanentHotkey(code, label, fn, getActive = null) {
  _perm.add(code);
  _reg[code] = { label, fn, rangeFn: null };
  const btn = _btns[code];
  if (!btn) return;
  btn.querySelector('.hb-label').innerHTML = label;
  btn.classList.add('hb-permanent');
  if (getActive) {
    const _syncToggle = () => btn.classList.toggle('hb-toggled', getActive());
    const _origFn = fn;
    _reg[code].fn = () => { _origFn(); _syncToggle(); };
    btn.addEventListener('click', _syncToggle);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initHotbar() {
  const normalRow = document.getElementById('hotbar-row-normal');
  const shiftRow  = document.getElementById('hotbar-row-shift');

  // Top row — number/symbol keys
  for (const k of TOP_KEYS) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn';

    let _typeIcon = '';
    if (k.code === 'Digit2') _typeIcon = '<span class="hb-type-icon hb-melee">⚔</span>';
    if (k.code === 'Digit3') _typeIcon = '<span class="hb-type-icon hb-ranged">🏹</span>';

    btn.innerHTML =
      _typeIcon +
      `<span class="hb-action-tag" style="display:none"></span>` +
      `<span class="hb-key">${k.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => {
      _flash(btn);
      _reg[k.code]?.fn?.();
    });
    normalRow.appendChild(btn);
    _btns[k.code] = btn;
  }

  // Bottom row — Q W E R T Y keys
  for (const k of BOTTOM_KEYS) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn';

    btn.innerHTML =
      `<span class="hb-action-tag" style="display:none"></span>` +
      `<span class="hb-key">${k.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => {
      _flash(btn);
      _reg[k.code]?.fn?.();
    });
    shiftRow.appendChild(btn);
    _btns[k.code] = btn;
  }

  // Top row — MMB slot (right of 6)
  for (const ms of MOUSE_SLOTS_TOP) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn hb-mouse-btn';
    btn.innerHTML =
      `<span class="hb-key">${ms.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => { _flash(btn); _reg[ms.code]?.fn?.(); });
    normalRow.appendChild(btn);
    _btns[ms.code] = btn;
  }

  // Bottom row — LMB slot (right of Y)
  for (const ms of MOUSE_SLOTS_BOTTOM) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn hb-mouse-btn';
    btn.innerHTML =
      `<span class="hb-key">${ms.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => { _flash(btn); _reg[ms.code]?.fn?.(); });
    shiftRow.appendChild(btn);
    _btns[ms.code] = btn;
  }

  // Keyboard event listener — fires matching slot regardless of shift
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = ALL_KEYBOARD_KEYS.find(k => k.code === e.code);
    if (!k) return;
    e.preventDefault();
    const btn = _btns[k.code];
    if (btn) _flash(btn);
    _reg[k.code]?.fn?.();
  });

  // Middle-click anywhere fires the MMB slot
  document.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    const btn = _btns['MouseMiddle'];
    if (btn) _flash(btn);
    _reg['MouseMiddle']?.fn?.();
  });
}

function _flash(btn) {
  btn.classList.add('hb-active');
  setTimeout(() => btn.classList.remove('hb-active'), 180);
}
