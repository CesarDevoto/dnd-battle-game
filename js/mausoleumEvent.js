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

// ── Morvath — encounter intro (mausoleum) ─────────────────────────────────────
// He had no start-of-fight dialogue (only a death taunt). It CANNOT fire on
// combat:start — that hits dagnaEvent's _combatActive deferral (the dialogue would
// be parked until combat ends, like the Dagna-TPK bug). So trigger it out of combat
// on approach, placed short of Morvath so it lands before he aggros.
// NOTE: lines are drafted from his death-taunt voice — rewrite to taste. The trigger
// x/z + radius may need nudging so it fires before the fight starts.
const _MORVATH_INTRO_ID = 'morvath_intro';
const _MORVATH_X = 24, _MORVATH_Z = -22;   // short of Morvath (35.99, -31.64), on the approach
const _MORVATH_INTRO_LINES = [
  { s: 'Morvath', t: "So... the Forge-god's little sparks come crawling into my tomb. Did the withered dwarf send you here to die in my dark?" },
  { s: 'Leugren', t: "Foul thing! 'Tis you who withers these lands. By Moradin's hammer, your corruption ends here!" },
  { s: 'Morvath', t: "Ends? Child, I am only the shadow at the threshold. Come, then — feed the oblivion, and learn what your faith is worth." },
];
registerDialogueScene({ id: 'dlg_morvath_intro', name: 'Morvath — Encounter Intro', lines: _MORVATH_INTRO_LINES });

window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'mausoleum') return;
  if (isMarkerSeen(_MORVATH_INTRO_ID)) return;

  const marker = mkExclamationMarker();
  marker.position.set(_MORVATH_X, getTerrainHeight(_MORVATH_X, _MORVATH_Z) + 2.5, _MORVATH_Z);
  scene.add(marker);

  trackExclamation(marker, _MORVATH_X, _MORVATH_Z, {
    id:        _MORVATH_INTRO_ID,
    onTrigger: () => showQuickDialogue(_MORVATH_INTRO_LINES),
  });
});
