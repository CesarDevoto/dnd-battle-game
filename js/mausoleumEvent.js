import { scene } from './scene.js';
import { getTerrainHeight } from './terrain.js';
import { mkExclamationMarker } from './propBuilders.js';
import { trackExclamation, isMarkerSeen } from './exclamationMarkers.js';
import { showQuickDialogue, registerDialogueScene } from './dagnaEvent.js';

const _MARKER_ID = 'mausoleum_entrance';
const _EXCL_X    = -9.37;
const _EXCL_Z    = -68.08;

const _LINES = [
  { s: 'Leugren', t: "By Moradin's forge, I feel it. Strong evil stirs within yon tomb — corruption darker than the foulest depths. 'Tis the wellspring of the corruption that withers these lands, of this I am certain." },
];

registerDialogueScene({ id: 'dlg_mausoleum_entrance', name: 'Mausoleum Entrance — Leugren', lines: _LINES });

window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'haunted_wood') return;
  if (isMarkerSeen(_MARKER_ID)) return;

  const marker = mkExclamationMarker();
  marker.position.set(_EXCL_X, getTerrainHeight(_EXCL_X, _EXCL_Z) + 2.5, _EXCL_Z);
  scene.add(marker);

  trackExclamation(marker, _EXCL_X, _EXCL_Z, {
    id:        _MARKER_ID,
    onTrigger: () => showQuickDialogue(_LINES),
  });
});
