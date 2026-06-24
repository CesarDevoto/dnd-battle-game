// ── Core die functions ────────────────────────────────────────────────────────

export function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

export const d4  = () => rollDie(4);
export const d6  = () => rollDie(6);
export const d8  = () => rollDie(8);
export const d10 = () => rollDie(10);
export const d12 = () => rollDie(12);
export const d20 = () => rollDie(20);

// ── Full roll with D&D semantics ──────────────────────────────────────────────

/**
 * Roll one or more dice with an optional modifier and advantage/disadvantage.
 *
 * @param {object}  opts
 * @param {number}  opts.sides              Die faces: 4, 6, 8, 10, 12, 20
 * @param {number}  [opts.count=1]          Dice count for multi-die damage (e.g. 2d6)
 * @param {number}  [opts.modifier=0]       Flat modifier added to the result
 * @param {'normal'|'advantage'|'disadvantage'} [opts.mode='normal']
 *
 * @returns {{ dice, keptIdx, kept, modifier, total, isCrit, isFumble, mode, sides, count }}
 */
export function roll({ sides, count = 1, modifier = 0, mode = 'normal' }) {
  if (mode === 'advantage' || mode === 'disadvantage') {
    const a = rollDie(sides), b = rollDie(sides);
    const keptIdx = mode === 'advantage'
      ? (a >= b ? 0 : 1)
      : (a <= b ? 0 : 1);
    const kept = keptIdx === 0 ? a : b;
    return {
      dice: [a, b], keptIdx, kept, modifier,
      total:    kept + modifier,
      isCrit:   sides === 20 && kept === 20,
      isFumble: sides === 20 && kept === 1,
      mode, sides, count: 1,
    };
  }

  const dice = Array.from({ length: count }, () => rollDie(sides));
  const sum  = dice.reduce((t, v) => t + v, 0);
  return {
    dice, keptIdx: null, kept: sum, modifier,
    total:    sum + modifier,
    isCrit:   count === 1 && sides === 20 && dice[0] === 20,
    isFumble: count === 1 && sides === 20 && dice[0] === 1,
    mode: 'normal', sides, count,
  };
}

// ── Floating roll feed ────────────────────────────────────────────────────────

let feed = null;
function getFeed() {
  if (!feed) {
    feed = document.createElement('div');
    feed.id = 'roll-feed';
    document.getElementById('app').appendChild(feed);
  }
  return feed;
}

function buildHTML(label, r) {
  const { dice, keptIdx, modifier, total, mode, isCrit, isFumble, count } = r;

  // Dice string: strike-through the dropped die for adv/disadv
  let diceStr;
  if (mode === 'advantage' || mode === 'disadvantage') {
    diceStr = '[' + dice.map((d, i) =>
      i === keptIdx ? `<b>${d}</b>` : `<s>${d}</s>`
    ).join(', ') + ']';
  } else if (count > 1) {
    diceStr = '[' + dice.join(' + ') + ']';
  } else {
    diceStr = String(dice[0]);
  }

  const modStr = modifier > 0 ? ` + ${modifier}`
               : modifier < 0 ? ` &minus; ${Math.abs(modifier)}`
               : '';
  const advTag = mode === 'advantage'    ? '<span class="roll-adv">ADV</span> '
               : mode === 'disadvantage' ? '<span class="roll-dis">DIS</span> '
               : '';
  const totCls = isCrit ? 'crit' : isFumble ? 'fumble' : '';
  const badge  = isCrit   ? ' <span class="roll-crit">CRIT!</span>'
               : isFumble ? ' <span class="roll-fumble">FUMBLE</span>'
               : '';

  return (
    `${advTag}<span class="roll-label">${label}:</span> ` +
    `<span class="roll-dice">${diceStr}</span>` +
    `<span class="roll-mod">${modStr}</span>` +
    ` = <span class="roll-total ${totCls}">${total}</span>${badge}`
  );
}

const SPIN_TICKS = 9;
const SPIN_MS    = 45;   // ms per tick → 405 ms total spin
const SHOW_MS    = 3400; // ms result stays visible before fading

/**
 * Show a floating roll result in the centre of the screen with a brief spin animation.
 * @param {string}     label   e.g. 'Attack Roll', 'Initiative'
 * @param {RollResult} result  Returned by roll()
 */
export function showRoll(label, result, { autoDismiss = true, skip3D = false } = {}) {
  return result;
}

export function clearRollFeed() {}

