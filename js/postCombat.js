// js/postCombat.js — Post-combat narrative event sequencer
//
// Handlers run in priority order after a victorious combat ends.
// Each fn receives (ctx, done):
//   ctx  = { isVictory: boolean }
//   done = call to advance to the next handler
//
// NOT calling done() terminates the chain — use this for events that trigger
// a zone change (e.g. Dagna's intro), so nothing runs after them.
//
// Register at module load time (top-level code), before any combat can start.
// Call runPostCombat(ctx) from exitCombat() to kick off the chain.

const _handlers = [];

// Returns an unsubscribe function — call it to remove the handler permanently.
export function registerPostCombatHandler(priority, fn) {
  const entry = { priority, fn };
  _handlers.push(entry);
  _handlers.sort((a, b) => a.priority - b.priority);
  return () => {
    const i = _handlers.indexOf(entry);
    if (i >= 0) _handlers.splice(i, 1);
  };
}

export function runPostCombat(ctx) {
  const queue = [..._handlers];
  let i = 0;

  function next() {
    if (i >= queue.length) {
      window.dispatchEvent(new CustomEvent('postcombat:done', { detail: ctx }));
      return;
    }
    queue[i++].fn(ctx, next);
  }

  next();
}
