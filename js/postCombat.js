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
    // Each handler's done() advances the chain AT MOST ONCE. A handler whose dialogue got
    // banked behind the dead-hero gate calls done() right away so the chain (loot panel!)
    // isn't held hostage until the player short-rests — but that same dialogue still owns an
    // onDone that calls done() when it finally plays. Without this guard that second call
    // would re-run the rest of the chain from where it left off.
    let advanced = false;
    queue[i++].fn(ctx, () => {
      if (advanced) return;
      advanced = true;
      next();
    });
  }

  next();
}
