import {
  setZoneFogDensity, setFogDensityMultiplier,
  getBaseFogDensity, getFogDensityMultiplier, getFogColorHex,
} from './environments.js';
import { IS_DEV } from './devConfig.js';

// Dev-only live fog controller. Density + color persist to the zone file;
// "dev-view amount" is the live fog multiplier (setFogDensityMultiplier) — a
// view preference, not saved. In dev view the multiplier is normally 0.15 so
// far zoom stays usable; crank it to 1 here to preview the true play-mode fog.

let _activeZoneId = null;
let _devMult      = 0.15;   // remembered dev-view amount, restored when leaving player preview

function _els() {
  return {
    d:  document.getElementById('fog-density'),
    dv: document.getElementById('fog-density-val'),
    c:  document.getElementById('fog-color'),
    m:  document.getElementById('fog-mult'),
    mv: document.getElementById('fog-mult-val'),
  };
}

// Pull the live scene values back into the controls (on open + zone load).
function _refresh() {
  const { d, dv, c, m, mv } = _els();
  if (!d) return;
  const density = getBaseFogDensity();
  const mult    = getFogDensityMultiplier();
  d.value        = density;
  dv.textContent = density.toFixed(3);
  c.value        = getFogColorHex();
  m.value        = mult;
  mv.textContent = `${mult.toFixed(2)}×`;
  _updatePreviewBtn();
}

// Toggle: snap the live multiplier between player view (1×) and the dev amount.
function _togglePreview() {
  if (getFogDensityMultiplier() >= 0.999) {
    setFogDensityMultiplier(_devMult);          // player → back to dev amount
  } else {
    _devMult = getFogDensityMultiplier();        // remember dev amount
    setFogDensityMultiplier(1);                   // dev → player view
  }
  _refresh();
}

function _updatePreviewBtn() {
  const btn = document.getElementById('fog-preview');
  if (!btn) return;
  const player = getFogDensityMultiplier() >= 0.999;
  btn.textContent = player ? 'Viewing: PLAYER fog' : 'Viewing: DEV fog';
  btn.classList.toggle('fog-on', player);
}

function _applyDensity() {
  const { d, dv, c } = _els();
  const val = parseFloat(d.value);
  dv.textContent = val.toFixed(3);
  setZoneFogDensity(val, c.value);
}

function _applyColor() {
  const { d, c } = _els();
  setZoneFogDensity(parseFloat(d.value), c.value);
}

function _applyMult() {
  const { m, mv } = _els();
  const val = parseFloat(m.value);
  mv.textContent = `${val.toFixed(2)}×`;
  setFogDensityMultiplier(val);
  _updatePreviewBtn();
}

async function _save() {
  const el = document.getElementById('fog-status');
  if (!_activeZoneId) { if (el) el.textContent = 'No zone loaded'; return; }
  const { d, c } = _els();
  const payload = { zoneId: _activeZoneId, fogDensity: parseFloat(d.value), fogColor: c.value };
  if (el) el.textContent = 'Saving…';
  try {
    const res = await fetch('/__save_zone_fog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (el) el.textContent = j.ok ? `Saved density ${payload.fogDensity} ✓` : `Error: ${j.error}`;
  } catch (err) {
    if (el) el.textContent = `Failed: ${err.message}`;
  }
}

function _buildPanel() {
  const p = document.createElement('div');
  p.id = 'fog-panel';
  p.innerHTML = `
    <div class="fog-title">FOG</div>
    <label class="fog-lab">Density <span id="fog-density-val" class="fog-num"></span></label>
    <input id="fog-density" class="fog-range" type="range" min="0" max="0.08" step="0.001">
    <label class="fog-lab">Color</label>
    <input id="fog-color" class="fog-color" type="color">
    <button id="fog-preview" class="fog-btn fog-toggle">Viewing: DEV fog</button>
    <label class="fog-lab">Dev-view amount <span id="fog-mult-val" class="fog-num"></span></label>
    <input id="fog-mult" class="fog-range" type="range" min="0" max="1" step="0.05">
    <button id="fog-save" class="fog-btn">SAVE TO ZONE</button>
    <div id="fog-status" class="fog-status"></div>`;
  const s = document.createElement('style');
  s.textContent = `
    #fog-panel { display:none; position:fixed; top:92px; right:10px; z-index:60; width:190px;
      background:rgba(10,8,4,0.92); border:1px solid #4a3412; border-radius:5px;
      padding:8px; font-family:sans-serif; color:#cdbf9a; box-shadow:0 3px 12px rgba(0,0,0,0.5); }
    #fog-panel .fog-title { font-size:0.62rem; letter-spacing:2px; color:#d4af37; margin-bottom:6px; text-align:center; }
    #fog-panel .fog-lab { display:block; font-size:0.6rem; color:#9a8f70; margin:5px 0 2px; }
    #fog-panel .fog-num { color:#d4af37; }
    #fog-panel .fog-range { width:100%; }
    #fog-panel .fog-color { width:100%; height:26px; background:none; border:1px solid #3a2a08; border-radius:3px; cursor:pointer; }
    #fog-panel .fog-btn { width:100%; background:#1a130a; border:1px solid #3a2a08; color:#c9b98a;
      font-size:0.66rem; padding:6px; border-radius:3px; cursor:pointer; margin-top:7px; }
    #fog-panel .fog-btn:hover { border-color:#d4af37; color:#f0e0a0; }
    #fog-panel .fog-toggle { margin-top:6px; }
    #fog-panel .fog-toggle.fog-on { background:#123a12; color:#8fe08f; border-color:#3a7a3a; }
    #fog-panel .fog-status { font-size:0.58rem; color:#9a8f70; margin-top:4px; line-height:1.3; min-height:1.2em; }`;
  document.head.appendChild(s);
  document.body.appendChild(p);

  document.getElementById('fog-density').addEventListener('input', _applyDensity);
  document.getElementById('fog-color').addEventListener('input', _applyColor);
  document.getElementById('fog-mult').addEventListener('input', _applyMult);
  document.getElementById('fog-preview').addEventListener('click', _togglePreview);
  document.getElementById('fog-save').addEventListener('click', _save);
}

export function initFogEditor() {
  if (!IS_DEV) return;
  _buildPanel();

  document.getElementById('fog-editor-btn')?.addEventListener('click', () => {
    const panel = document.getElementById('fog-panel');
    if (!panel) return;
    const open = panel.style.display !== 'block';
    panel.style.display = open ? 'block' : 'none';
    document.getElementById('fog-editor-btn').classList.toggle('active', open);
    if (open) _refresh();
  });

  window.addEventListener('zone:loaded', e => {
    _activeZoneId = e.detail?.id ?? null;
    _refresh();
  });
}
