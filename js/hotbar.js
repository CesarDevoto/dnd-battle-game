// js/hotbar.js — number-row top, QWERTY-partial + mouse-buttons bottom

const TOP_KEYS = [
  { code: 'Backquote', label: '`' },
  { code: 'Digit1',    label: '1' },
  { code: 'Digit2',    label: '2' },
  { code: 'Digit3',    label: '3' },
  { code: 'Digit4',    label: '4' },
  { code: 'Digit5',    label: '5' },
  { code: 'Digit6',    label: '6' },
  { code: 'Digit7',    label: '7' },
  { code: 'Digit8',    label: '8' },
];

// Both rows mirror a physical keyboard — hence the half-key offset on
// #hotbar-row-shift and the /13 in the button-width formula (13 = the real number
// row, ` through =). Keep additions contiguous with the real layout: there is no
// KeyI slot because I is the inventory panel (ui.js), and jumping Y→U→O would
// leave a phantom gap where I physically sits.
// The bottom row is now triggered by SHIFT + number (1–8), freeing plain W/A/S/D for WASD movement.
// `code` stays the internal SLOT ID (Tab/KeyQ/… — kept so every existing binding, auto-fill, owl and
// OOC handler keeps targeting the same slot); `trigger` + Shift is the activation key; `label` is ⇧N.
const BOTTOM_KEYS = [
  { code: 'Tab',  trigger: 'Digit1', label: '⇧1' },
  { code: 'KeyQ', trigger: 'Digit2', label: '⇧2' },
  { code: 'KeyW', trigger: 'Digit3', label: '⇧3' },
  { code: 'KeyE', trigger: 'Digit4', label: '⇧4' },
  { code: 'KeyR', trigger: 'Digit5', label: '⇧5' },
  { code: 'KeyT', trigger: 'Digit6', label: '⇧6' },
  { code: 'KeyY', trigger: 'Digit7', label: '⇧7' },
  { code: 'KeyU', trigger: 'Digit8', label: '⇧8' },
];

const MOUSE_SLOTS_TOP    = [{ code: 'MouseMiddle', label: 'MMB', button: 1 }];
// Right mouse button — permanently the camera pan/swivel (handled in scene.js),
// so this slot is a fixed legend reading RMB · PAN, not a bindable ability slot.
const MOUSE_SLOTS_BOTTOM = [{ code: 'MouseRight',  label: 'RMB', button: 2 }];

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
// title: optional hover tooltip (e.g. the ability's display name) — hotbar
// slots otherwise have no tooltip at all, unlike their Skills & Spells boxes.
export function bindHotkey(code, shift, label, fn, rangeFn = null, actionType = null, title = null) {
  const k = _key(code, shift);
  _reg[k] = { label, fn, rangeFn };
  const btn = _btns[k];
  if (btn) {
    btn.querySelector('.hb-label').innerHTML = label;
    _setActionTag(btn.querySelector('.hb-action-tag'), actionType);
    if (title) btn.title = title; else btn.removeAttribute('title');
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

// Show/hide a slot's baked-in type icon (the ⚔ on slot 2, 🏹 on slot 3). These
// are permanent decorations for the hero melee/ranged slots, but meaningless on
// re-purposed slots (e.g. the owl's Help/Scout), where the big weapon glyph
// otherwise reads as "melee attack." Hidden state is restored per hotbar rebuild.
export function setSlotIcon(code, visible) {
  const icon = _btns[code]?.querySelector('.hb-type-icon');
  if (icon) icon.style.display = visible ? '' : 'none';
}

// Grey out a slot with no functional binding (e.g. a hero with no ranged attack).
export function markHotkeyUnavailable(code, shift = false) {
  const k = _key(code, shift);
  const btn = _btns[k];
  if (btn) btn.classList.add('hb-disabled');
}

export function unbindHotkey(code, shift) {
  const k = _key(code, shift);
  delete _reg[k];
  const btn = _btns[k];
  if (btn) {
    btn.querySelector('.hb-label').textContent = '';
    btn.classList.add('hb-disabled');
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
      // An unbound slot has nothing to do — it should read as inactive, not
      // "ready." Whatever rebinds it next (if anything) will re-enable it via
      // updateHotkeyRanges(). Without this, a slot cleared outside a hero's
      // own turn (enemy turns, page load, combat end) shows fully bright
      // with no functional binding behind it.
      btn.classList.add('hb-disabled');
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
  btn.classList.remove('hb-disabled'); // permanent hotkeys work immediately, no turn/rangeFn gating
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
    btn.className = 'hb-btn hb-disabled';
    btn.dataset.hbKey = k.code; // lets other UI (Skills & Spells drag-drop) map DOM → key code

    let _typeIcon = '';
    if (k.code === 'Digit2') _typeIcon = '<span class="hb-type-icon hb-melee">⚔</span>';
    if (k.code === 'Digit3') _typeIcon = '<span class="hb-type-icon hb-ranged">🏹</span>';
    // Potion lives on Digit8 (user, 2026-07-18 — moved from Digit6). This baked-in icon is
    // what makes the slot read as the potion's even when the hero is carrying none, so it
    // must track the bindHotkey code in combat.js.
    if (k.code === 'Digit8') _typeIcon = '<img class="hb-type-icon hb-potion-icon" src="assets/items/potions/potion5.png" alt="">';

    btn.innerHTML =
      _typeIcon +
      `<span class="hb-action-tag" style="display:none"></span>` +
      `<span class="hb-key">${k.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => {
      _flash(btn);
      _fire(k.code);
    });
    normalRow.appendChild(btn);
    _btns[k.code] = btn;
  }

  // Bottom row — Q W E R T Y keys
  for (const k of BOTTOM_KEYS) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn hb-disabled';
    btn.dataset.hbKey = k.code;

    btn.innerHTML =
      `<span class="hb-action-tag" style="display:none"></span>` +
      `<span class="hb-key">${k.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => {
      _flash(btn);
      _fire(k.code);
    });
    shiftRow.appendChild(btn);
    _btns[k.code] = btn;
  }

  // Top row — MMB slot (right of 8). Appended after TOP_KEYS, so it always
  // sits at the end of the row however many keys that row grows to.
  for (const ms of MOUSE_SLOTS_TOP) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn hb-mouse-btn hb-disabled';
    btn.innerHTML =
      `<span class="hb-key">${ms.label}</span>` +
      `<span class="hb-label"></span>`;
    btn.addEventListener('click', () => { _flash(btn); _fire(ms.code); });
    normalRow.appendChild(btn);
    _btns[ms.code] = btn;
  }

  // Bottom row — RMB slot (right of U). Permanent camera pan/swivel legend.
  for (const ms of MOUSE_SLOTS_BOTTOM) {
    const btn = document.createElement('button');
    btn.className = 'hb-btn hb-mouse-btn hb-permanent';
    btn.innerHTML =
      `<span class="hb-key">${ms.label}</span>` +
      `<span class="hb-label">PAN</span>`;
    shiftRow.appendChild(btn);
    _btns[ms.code] = btn;
  }

  // Keyboard event listener — fires matching slot regardless of shift
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Bottom row = SHIFT + its trigger digit; top row = the plain key (no shift). This keeps plain
    // 1–8 on the top row and W/A/S/D free for movement, while Shift+1–8 hit the bottom row's slots.
    let slotCode = null;
    if (e.shiftKey) { const bk = BOTTOM_KEYS.find(k => k.trigger === e.code); if (bk) slotCode = bk.code; }
    else            { const tk = TOP_KEYS.find(k => k.code === e.code);       if (tk) slotCode = tk.code; }
    if (!slotCode) return;
    e.preventDefault();
    const btn = _btns[slotCode];
    if (btn) _flash(btn);
    _fire(slotCode);
  });

  // Middle-click anywhere fires the MMB slot
  document.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    const btn = _btns['MouseMiddle'];
    if (btn) _flash(btn);
    _fire('MouseMiddle');
  });
}

// Fire a hotkey slot only if its enable function (rangeFn) passes — or if there is none.
// This makes keyboard shortcuts and button clicks both respect the greyed-out state.
function _fire(code) {
  const entry = _reg[code];
  if (!entry) return;
  if (entry.rangeFn && !entry.rangeFn()) return;
  entry.fn?.();
}

function _flash(btn) {
  btn.classList.add('hb-active');
  setTimeout(() => btn.classList.remove('hb-active'), 180);
}
