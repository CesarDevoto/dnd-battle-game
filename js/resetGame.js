// js/resetGame.js — "New Game" button.
//
// The game's "continue where you left off" behaviour is entirely localStorage —
// no cookies. So starting fresh (like an incognito window, but discoverable and
// repeatable) just means wiping this game's saved keys and reloading.
//
// KEY NAMESPACES. Most of what the game persists is namespaced 'dnd-' / 'dnd_',
// but not all of it — cutscene-seen flags are 'cs_seen_<id>' and the waystone
// intro is 'dlg_waystone_first_seen'. Wiping only the 'dnd' prefixes left those
// behind, so a "new game" silently skipped every cutscene the player had already
// watched, including the intro. Every prefix the game writes under must be listed
// here; if you add a persisted key, either name it 'dnd-…' or add its prefix.
const GAME_KEY_PREFIXES = [
  'dnd-',      // most game state: quests, waystones, respawn timers, world clock, settings
  'dnd_',      // short rest, one-shot loot drops
  'cs_seen_',  // cutsceneManager — which cutscenes have played
  'dlg_',      // one-shot dialogue flags (dagnaEvent's waystone intro)
];

function _isGameKey(k) {
  return !!k && GAME_KEY_PREFIXES.some(p => k.startsWith(p));
}

export function initResetGame() {
  const btn = document.getElementById('new-game-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const ok = confirm(
      'Start a NEW GAME?\n\n' +
      'This erases ALL saved progress — quests, story flags, unlocked waystones, ' +
      'defeated-enemy respawn timers, cutscenes you\'ve watched, your resume point, ' +
      'and settings — and cannot be undone.'
    );
    if (!ok) return;

    // Tell modules that persist on unload to stand down BEFORE we wipe. location.reload()
    // fires 'beforeunload', and respawn.js saves the world clock there — so without this it
    // would write the clock straight back out after the wipe, and the "fresh" game would
    // resume with hours already on it.
    window.dispatchEvent(new CustomEvent('game:reset'));

    try {
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (_isGameKey(k)) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
    } catch { /* private-mode / storage disabled — reload still gives a clean run */ }

    location.reload();
  });
}
