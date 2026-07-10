// js/resetGame.js — "New Game" button.
//
// The game's "continue where you left off" behaviour is entirely localStorage —
// no cookies. So starting fresh (like an incognito window, but discoverable and
// repeatable) just means wiping this game's saved keys. Everything the game
// persists is namespaced 'dnd-' / 'dnd_', so we remove exactly those (leaving
// other sites' data untouched) and reload.

export function initResetGame() {
  const btn = document.getElementById('new-game-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const ok = confirm(
      'Start a NEW GAME?\n\n' +
      'This erases ALL saved progress — quests, story flags, unlocked waystones, ' +
      'your resume point, and settings — and cannot be undone.'
    );
    if (!ok) return;

    try {
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('dnd-') || k.startsWith('dnd_'))) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
    } catch { /* private-mode / storage disabled — reload still gives a clean run */ }

    location.reload();
  });
}
