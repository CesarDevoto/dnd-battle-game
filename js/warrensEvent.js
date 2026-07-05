// js/warrensEvent.js — Warrens zone events (dialogue, NPC quests, triggers)
// Empty scaffold — fill in once terrain/props are built out.

window.addEventListener('zone:loaded', e => {
  if (e.detail?.id !== 'warrens') return;
});

window.addEventListener('zone:loading', () => {
  // Reset any Warrens-specific state here once it exists.
});

export function tickWarrens(dt) {
  // no-op until this zone has something to animate/watch
}
