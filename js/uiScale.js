// js/uiScale.js — adjustable UI text scale for large / high-DPI screens.
//
// Every UI font is rem-based, so multiplying the root font-size (via the
// --ui-scale CSS variable, applied in style.css's `html { font-size: … }`)
// grows all UI text together. The combat log opts out (its font sizes are px).
// This scales TEXT only — panels are px-sized and don't grow — so keep the
// range modest; the Settings slider lets each player pick what fits their
// screen. Persisted to localStorage.

const KEY = 'dnd-ui-scale';
const MIN = 1, MAX = 1.5;

const _clamp = v => Math.max(MIN, Math.min(MAX, v));

export function getUiScale() {
  const v = parseFloat(localStorage.getItem(KEY) ?? '1');
  return Number.isFinite(v) ? _clamp(v) : 1;
}

export function setUiScale(v) {
  const s = _clamp(v);
  document.documentElement.style.setProperty('--ui-scale', s);
  try { localStorage.setItem(KEY, String(s)); } catch {}
  return s;
}

export function initUiScale() {
  // Apply the saved scale immediately (before the slider is touched).
  setUiScale(getUiScale());

  const el = document.getElementById('amx-uiscale');
  if (!el) return;
  el.value = getUiScale();
  const lbl = el.parentElement?.querySelector('.amx-val');
  const update = () => {
    const s = setUiScale(parseFloat(el.value));
    if (lbl) lbl.textContent = Math.round(s * 100) + '%';
  };
  update();
  el.addEventListener('input', update);
}
