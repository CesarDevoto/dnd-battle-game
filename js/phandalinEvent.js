import { units } from './units.js';
import { getTerrainHeight } from './terrain.js';
import { isPrecombat } from './precombat.js';
import { showQuickDialogue, registerDialogueScene } from './dagnaEvent.js';

// ── Phandalin town event ──────────────────────────────────────────────────────
// Peaceful hub zone. Wire townsfolk dialogue, quests, and shop triggers here.
// This is a scaffold: a one-shot arrival greeting fires the first time the party
// walks into town. Extend with proximity triggers / choice UIs as needed.

const _KEY_ARRIVAL = 'dnd-phandalin-arrival-seen';

const _ARRIVAL_LINES = [
  { s: 'Milo',    t: "Phandalin at last. Warm beds and a hot meal — I could weep." },
  { s: 'Leugren', t: "Keep your wits about you. Even quiet towns keep their secrets." },
];
registerDialogueScene({ id: 'dlg_phandalin_arrival', name: 'Phandalin — Arrival', lines: _ARRIVAL_LINES });

let _watchingArrival = false;

function _fireArrivalDialogue() {
  try { if (localStorage.getItem(_KEY_ARRIVAL)) return; } catch {}
  _watchingArrival = false;
  try { localStorage.setItem(_KEY_ARRIVAL, '1'); } catch {}
  showQuickDialogue(_ARRIVAL_LINES);
}

// ── Per-frame tick (called from main.js render loop) ──────────────────────────
export function tickPhandalin(dt) {
  if (_watchingArrival && isPrecombat()) {
    // Fire once any living hero has entered the town proper (near origin).
    const inTown = units.some(u => {
      if (u.team !== 'blue' || u.hp <= 0) return false;
      return u.grp.position.x * u.grp.position.x + u.grp.position.z * u.grp.position.z <= 12 * 12;
    });
    if (inTown) _fireArrivalDialogue();
  }
}

// ── Zone lifecycle ────────────────────────────────────────────────────────────
window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'phandalin') return;
  try { if (!localStorage.getItem(_KEY_ARRIVAL)) _watchingArrival = true; } catch {}
});

window.addEventListener('zone:loading', () => {
  _watchingArrival = false;
});
