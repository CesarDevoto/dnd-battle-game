import { loadZone, getActiveZone } from './zoneLoader.js';
import { IS_DEV } from './devConfig.js';

const _STORAGE_KEY = 'dnd-discovered-waystones';
const _discovered  = new Set();

// ── Waypoint data ─────────────────────────────────────────────────────────────
// mapX/mapY: position as fraction [0,1] of basemap image width/height.
// arrivalX/arrivalZ: hero spawn coords in the target zone when teleporting.
export const WAYPOINTS = {
  goblin_ambush: {
    name:     'Goblin Ambush',
    zoneId:   'dungeon_entrance',
    mapX:     0.38, mapY: 0.55,
    arrivalX: 3,    arrivalZ: 38,
  },
};

// ── Roman-numeral location markers on the Lands map ──────────────────────────
// Clicking one switches to that sub-map tab.
const LAND_MARKERS = [
  { id: 'I', mapX: 0.36, mapY: 0.43 },
];

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = localStorage.getItem(_STORAGE_KEY);
    if (raw) JSON.parse(raw).forEach(id => _discovered.add(id));
  } catch {}
}

function _save() {
  try { localStorage.setItem(_STORAGE_KEY, JSON.stringify([..._discovered])); } catch {}
}

export function discoverWaystone(id) {
  if (_discovered.has(id)) return false;
  _discovered.add(id);
  _save();
  _showDiscoveryToast(WAYPOINTS[id]?.name ?? id);
  return true;
}

export function isWaystoneDiscovered(id) {
  return _discovered.has(id);
}

function _showDiscoveryToast(name) {
  const el = document.createElement('div');
  el.className = 'waystone-toast';
  el.textContent = `Waystone discovered: ${name}`;
  document.getElementById('app').appendChild(el);
  requestAnimationFrame(() => el.classList.add('ws-toast-in'));
  setTimeout(() => el.classList.add('ws-toast-out'), 3000);
  setTimeout(() => el.remove(), 4200);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

let _overlay  = null;
let _activeTab = 'Lands';

export function initWorldMap() {
  _load();

  _overlay = document.createElement('div');
  _overlay.id = 'world-map-overlay';
  _overlay.style.display = 'none';
  _overlay.innerHTML = `
    <div id="world-map-container">
      <div id="world-map-tabs">
        <button class="wm-tab active" data-tab="Lands">LANDS</button>
        <button class="wm-tab" data-tab="I">I</button>
        <button class="wm-tab" data-tab="II">II</button>
        <button class="wm-tab" data-tab="III">III</button>
        <button id="world-map-close">✕</button>
      </div>
      <div id="world-map-body"></div>
    </div>
  `;
  document.getElementById('app').appendChild(_overlay);

  _overlay.querySelectorAll('.wm-tab').forEach(btn => {
    btn.addEventListener('click', () => _setTab(btn.dataset.tab));
  });
  document.getElementById('world-map-close').addEventListener('click', closeWorldMap);
  _overlay.addEventListener('click', e => { if (e.target === _overlay) closeWorldMap(); });
  document.getElementById('map-btn')?.addEventListener('click', openWorldMap);
}

export function openWorldMap() {
  _activeTab = 'Lands';
  _overlay.querySelectorAll('.wm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'Lands'));
  _overlay.style.display = 'flex';
  _render();
}

export function closeWorldMap() {
  _overlay.style.display = 'none';
}

function _setTab(tab) {
  _activeTab = tab;
  _overlay.querySelectorAll('.wm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  _render();
}

function _render() {
  const body = document.getElementById('world-map-body');
  _activeTab === 'Lands' ? _renderLands(body) : _renderSubmap(body, _activeTab);
}

function _renderLands(body) {
  const currentZoneId = getActiveZone()?.id ?? '';
  let pinsHtml = '';

  for (const [id, wp] of Object.entries(WAYPOINTS)) {
    if (!_discovered.has(id)) continue;
    const isCurrent = wp.zoneId === currentZoneId;
    pinsHtml += `
      <div class="map-pin${isCurrent ? ' map-pin-is-current' : ''}"
           style="left:${wp.mapX * 100}%;top:${wp.mapY * 100}%"
           data-waypoint="${id}">
        <div class="map-pin-circle"></div>
        ${isCurrent ? '<div class="map-here-icon">⚑</div>' : ''}
        <div class="map-pin-tooltip">${wp.name}</div>
      </div>`;
  }

  for (const m of LAND_MARKERS) {
    pinsHtml += `
      <div class="map-land-marker"
           style="left:${m.mapX * 100}%;top:${m.mapY * 100}%"
           data-marker="${m.id}">${m.id}</div>`;
  }

  body.innerHTML = `
    <div id="world-map-inner">
      <img id="world-map-img"
           src="assets/Pictures%20Cutscenes%20Icons/basemap.jpg"
           draggable="false">
      <div id="world-map-pins">${pinsHtml}</div>
    </div>`;

  body.querySelectorAll('.map-pin:not(.map-pin-is-current)').forEach(pin => {
    pin.addEventListener('click', e => { e.stopPropagation(); _travelTo(pin.dataset.waypoint); });
  });
  body.querySelectorAll('.map-land-marker').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); _setTab(el.dataset.marker); });
  });

  if (IS_DEV) _attachCoordPicker(body);
}

function _attachCoordPicker(body) {
  const inner = body.querySelector('#world-map-inner');
  const img   = body.querySelector('#world-map-img');
  if (!inner || !img) return;

  let label = body.querySelector('#wm-coord-label');
  if (!label) {
    label = document.createElement('div');
    label.id = 'wm-coord-label';
    label.style.cssText = 'position:absolute;bottom:6px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#0ff;font-size:0.72rem;padding:3px 10px;border-radius:3px;pointer-events:none;z-index:10;display:none;white-space:nowrap;';
    inner.appendChild(label);
  }

  inner.addEventListener('click', e => {
    if (e.target.closest('.map-pin') || e.target.closest('.map-land-marker')) return;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width).toFixed(3);
    const y = ((e.clientY - rect.top)  / rect.height).toFixed(3);
    label.textContent = `mapX: ${x}  mapY: ${y}`;
    label.style.display = 'block';
  });
}

const _SUBMAP_SRCS = {
  I:   'assets/Pictures%20Cutscenes%20Icons/map1.jpg',
  II:  null,
  III: null,
};

function _renderSubmap(body, tab) {
  const src = _SUBMAP_SRCS[tab];
  if (src) {
    body.innerHTML = `<div id="world-map-inner">
      <img id="world-map-img" src="${src}" draggable="false">
    </div>`;
  } else {
    body.innerHTML = `<div id="world-map-submap">
      <span>Map ${tab} — coming soon</span>
    </div>`;
  }
}

function _travelTo(id) {
  const wp = WAYPOINTS[id];
  if (!wp) return;
  closeWorldMap();
  loadZone(wp.zoneId, true, { x: wp.arrivalX, z: wp.arrivalZ });
}
