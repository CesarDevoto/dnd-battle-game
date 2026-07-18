# Loot Affix Design (living doc)

_Last updated: 2026-07-16_

Design for a **slot-dedicated affix system**: each equipment slot has a theme, and the gear
that drops in it boosts a specific, legible stat. Upgrades should read at a glance
("boots = movement, gloves = action economy").

## Items are ROLLED, not hand-authored (decided 2026-07-16)

**An item's numbers are derived from `(slot, affix, rarity)` — never written out per item.**
A drop is a **base item** (name / icon / slot / material) + a **rarity** + affixes rolled from
that slot's table below. "Cloth Hood" is ONE base; a green one and a purple one are the same
base with different rolls.

**Why.** The old plan — ~1,000 hand-authored items — was already collapsing under its own
weight at ~50: the catalog had begun shipping the same item twice under different names
(`Dull Copper Band` / `Tarnished Ring`, both "Crit chance +1%"; `Cloth Slippers` / `Worn
Sandals`, both "+5 ft") purely to reach a count. Rolling replaces ~3,600 hand-balanced entries
with ~150 bases + ~170 range rows, and every drop is distinct.

This was always implied by "Rarity is the progression curve. The same affix scales by tier" —
if the tier decides the number, the number isn't authored.

**It needs no schema change.** `getItem()` returns `{...def}` and `placeInFirstEmptyBagSlot`
copies again with `{...cleanItem}`, so item *instances* are already distinct objects rather
than shared references. Roll at drop time, stamp the result on the instance.

**Rules of the model:**
- **Dice, not fixed values** — `1d3+2` is a uniform range wearing a d20-game coat. Keep the notation.
- **Tiers overlap on purpose.** green `1d2` (1–2) vs blue `1d2+1` (2–3): a max-roll green ties a
  floor blue. That's what makes a perfect low-tier roll worth keeping. Do not flatten it.
- **Affix COUNT scales with rarity too** — a second variety axis, free.
  grey 0–1 · green 1 · blue 1–2 · purple 2 · orange 2–3 · red bespoke.
- **Hybrid at the top.** grey→orange roll procedurally; **red is hand-authored uniques** with
  bespoke effects and real names. Target ~20 of them, not hundreds.
- **Base names must be NEUTRAL** — "Cloth Hood", not "Frayed Cloth Hood". A base drops at every
  tier, so weakness can't be baked into its name; rarity and affixes decorate it
  (prefix = one affix, suffix = another, Diablo-style). The existing catalog's names all bake
  in a tier and need renaming as each slot is converted.

### Calibration anchors (from constants.js — check against these, not intuition)
| Engine fact | Value | What it means for loot |
|---|---|---|
| `rageMitigationForLevel` | **10%**, L2+, only while raging, 1–2 uses/day | Anchor for head's mitigation. ⚠ The BUILT ladder deliberately overshoots it from orange up (red `3d6+6` = 9–24%, avg ~16.5) — a recorded choice, not an oversight. See the Head table. |
| `precisionHitBonusForLevel` | **+1% hit**, a whole L4 class passive | Hit% loot must be tiny. ⚠ Green wrist rolls `1d2`, so its *weakest* roll equals this entire L4 passive. Known and ACCEPTED (gear should outdo a low-level passive); revisit when Rage's flat 10% gets its level curve — same frozen-class-number problem. |
| `rollToHit` | `+1 atk = +5% hit`, clamp 5–95 | Percentages here are percentage POINTS of final hit chance. |
| **AC% vs mitigation%** | −10% AC on a 55% attacker = 45% = **18% fewer hits** | ⚠ Not interchangeable: 1 point of AC% ≈ **1.8 points of mitigation** at baseline, and MORE as enemy hit falls. AC% is attack-rolls-only; mitigation covers every damage path. |

## Design principles

- **Slot = identity.** Each slot boosts a themed stat so loot is legible, not a soup of random numbers.
- **Prefer incremental % boosts** over coarse flat steps. When a stat can be expressed as a
  smooth percentage (hit%, AC%, mitigation), do that instead of d20-style 5%-chunk integers.
- **Rarity is the progression curve.** The same affix scales by tier
  (`grey → green → blue → purple → orange → red`) — e.g. green boots +5 ft, blue +10, purple +15.
- **One number per concept.** Don't ship two affixes that mean the same thing (see: attack bonus vs hit%).
- **Material gates the WEARER, not the affix.** An armor item's material (cloth / light / medium /
  heavy) decides *who can equip it* (proficiency), NOT which affix it can roll. A cloth hood can carry
  Damage mitigation just as a plate helm can; a caster is never locked out of a slot's stat by being
  cloth-only. When generating loot, make sure each hero has items in *their* wearable materials for
  every affix their slots offer.

## Existing system (what's already in code)

- **Slots** (`js/equipment.js`): `head, neck, chest, cloak, wrist-l, wrist-r, legs, hands, feet,
  belt, ring-l, ring-r, main-hand, off-hand, ammo, bag`.
- **Rarity tiers** already defined: `grey, green, blue, purple, orange, red`.
- **Wired today:** chest + shield → AC (`computeAC`), neck → soul-shard amulet proc. Everything
  else is scaffolding waiting for affixes.
- **Hit math** (`combat.js` `rollToHit`):
  `Hit% = ((atkBonus + 20 − defAC)/20)×100 + levelTerm×3 + hitPctBonus`, clamped 5–95.
  - `+1 attack bonus = +5% hit`; `+1 hitPctBonus = +1% hit`. They're the same axis at a 5:1 ratio.
  - **Decision:** accuracy affixes use **hit% (`hitPctBonus`)** for smooth incremental tiers.
    Attack bonus stays as the d20 stat that STR/DEX/prof feed; we don't drop it as a loot affix.

## Affix master list

Legend — Difficulty: 🟢 add a number to an existing formula · 🟡 real but contained work · 🔴 touches core loop.
Status: `v?` = tier TBD, `cut` = removed from consideration.

### Offense
| Affix | Mechanic | Difficulty | Status |
|---|---|---|---|
| Hit chance % (ATT%) | flat % added to Hit% (Precision channel) | 🟢 | keep |
| Weapon-attack damage | +% (or flat) to WEAPON-attack damage — sword, dagger, bow, thrown axe. Does NOT touch spells. | 🟢 | keep |
| Crit chance | lower the 96→ auto-crit threshold | 🟢 | keep |
| Crit damage | multiplier on crit rolls | 🟡 | keep |
| STR / DEX | ability scores → atk mod, damage, AC | 🟢 | keep · purple+ ⬥ |
| **Cleave capacity** | melee hit splashes `pct` damage to foes near the target — via the shared splash resolver (`radius`, `maxTargets`, `pct`; grows with tier) | 🟡 | keep (new) |
| **Spell splash damage** | caster's cleave: spell hit splashes `pct` to neighbours of the primary target — SAME shared resolver as Cleave | 🟡 | keep (new) |
| **AoE spell radius** | increases the effect radius of area spells (bigger fireball, etc.) | 🟡 | keep (new) |

### Defense / Survival
| Affix | Mechanic | Difficulty | Status |
|---|---|---|---|
| **AC as %** | reduces attackers' Hit% against you by X% (defensive mirror of hit%) — incremental, not flat +1=5% | 🟢 | keep (changed) |
| Max HP (flat or %) | `maxHp` | 🟢 | keep |
| Damage mitigation % | model on Rage mitigation | 🟡 | keep |
| Saving throws | bonus to STR/DEX/CON/INT/WIS/CHA saves | 🟢 | keep |
| CON | HP + CON saves + unarmored AC | 🟢 | keep · purple+ ⬥ |

### Action Economy
| Affix | Mechanic | Difficulty | Status |
|---|---|---|---|
| Attack speed (extra attack) | a second weapon swing on the turn | 🟡 | keep · purple+ ⬥ |
| Cast speed | cantrip/spell as a bonus action | 🟡 | keep · purple+ ⬥ |
| Cooldown reduction | when abilities get cooldowns | 🟡 | keep |

### Movement / Positioning
| Affix | Mechanic | Difficulty | Status |
|---|---|---|---|
| Movement per turn | `speed` budget (vs `turnMovedFt`) | 🟢 | keep |
| Initiative | bonus to the initiative roll | 🟢 | keep |
| Attack range | bonus to weapon/spell range | 🟢 | keep |

### Utility / Procs
| Affix | Mechanic | Difficulty | Status |
|---|---|---|---|
| Life steal % | heal on hit | 🟡 | keep |
| On-hit rider | one Neck affix, a MENU of effects (see "On-hit rider — condition menu" below): weakest = flat poison/bleed dmg; then soft CC (slow/root/prone/blind/weaken/fear); then hard CC (restrain/silence/stun/sleep/daze/paralyze). Hard CC = purple+ ⬥. Reuses setActionSave. | 🟡 | keep (expanded) |
| Healing power | boost heals given/received | 🟢 | keep |
| Spell damage | +% to the damage the wearer's SPELLS deal (Fire Bolt, Fireball, etc.) — the caster's counterpart to Weapon-attack damage. Does NOT touch weapon swings. | 🟢 | keep |
| Stealth / perception | Milo's hide, detection range | 🟡 | keep |
| Resource regen | short-rest charges, rage uses, potion slots | 🟡 | keep |
| **Grants proficiency** | an *unlock*, not a stat: lets a hero equip/use an item they otherwise couldn't (plate on a wizard), so a drop isn't dead weight for 3 of 4 heroes. Depends on a restriction system existing first — see note. | 🟡† | keep (new) |
| **Two-handed wielding** (off-hand only) | an *unlock*: lets the hero equip a two-handed weapon in the main hand WITHOUT giving up this off-hand item. Bypasses the current rule (`equipItem` makes a 2H weapon and an off-hand item mutually exclusive). Off-hand exclusive. | 🟡 | keep (new) |
| **Grants spell** (caster main-hand only) | a wand/staff/rod that lets the wielder CAST a specific spell they wouldn't otherwise have (Wand of Fireball, etc.). Caster-only (Rasec, Leugren); rolls on main-hand. Injects a castable into the hero's spell list while equipped. | 🔴 | keep (new) |

**† Grants-proficiency dependency:** there is **no equipment proficiency/class gating in the code
today** — `equipItem` equips anything into any hero's slot; the only "wrong item" consequence is
flavor (e.g. Gobo loses his unarmored-defense AC in chest armor). So this affix has nothing to
bypass yet. It becomes meaningful only once we add proficiency restrictions (heavy armor / martial
weapons usable only by certain heroes, or with a penalty). Sequence: build the restriction system
first, then this affix is the key that opens it.

**Current count: 28 affixes** (8 offense, 5 defense, 3 action-economy, 3 movement, 9 utility).

## On-hit rider — condition menu (Neck)

On-hit rider is a single Neck affix with a **menu** of effects; the effect's power scales with rarity.
Each works the same way: a **% proc on hit → target rolls a save (stat + DC) → on fail the condition
lands**. Reuses the engine's `setActionSave` framework (immobilize / locksTurn / save-to-break — the
web-restrain and ghoul-paralyze already run through it). Proc chance + DC scale with rarity
(e.g. green ~5% / DC 11 → purple ~15% / DC 15). **One rider per item.**

**Duration models** (each rider picks one): *save-ends* (re-roll at end of each turn — the default) ·
*N turns fixed* (no re-save; high rarity only) · *until damaged* (breaks on any damage — Sleep) ·
*save-negates* (save when hit; success = nothing — Prone).

**Weakest — flat damage riders (any rarity):** Poison (+N poison dmg on hit) · Bleed (+N bleed dmg).

**Soft CC (mid rarity — green/blue+):**
| Condition | Effect | Save | Duration |
|---|---|---|---|
| Slow | speed halved, no reactions | DEX | save-ends |
| Root / Immobilize | speed 0, can still act | STR | save-ends |
| Prone / Knockdown | melee ADV vs it, ranged DIS; spends movement to stand | STR | save-negates → until it stands |
| Blind | its attacks DIS, attacks vs it ADV | CON | save-ends |
| Weaken | its damage −25% | CON | save-ends |
| Fear | can't move toward the party, attacks DIS | WIS | save-ends |

**Hard CC (purple+ only ⬥ — losing an enemy turn is a power spike on par with the extra-action affixes):**
| Condition | Effect | Save | Duration |
|---|---|---|---|
| Restrain | speed 0 AND its attacks DIS / attacked at ADV; can still act | STR | save-ends |
| Silence | can't cast (shuts down enemy casters) | WIS | save-ends |
| Stun | loses its whole turn; attacked at ADV | CON | save-ends |
| Sleep | incapacitated — breaks the instant it takes any damage | CON | until damaged |
| Daze / Confuse | skips next turn (or acts randomly) | WIS | 1 turn / save-ends |
| Paralyze | can't act/move, auto-fail STR/DEX saves, melee auto-crits | CON | save-ends |

## Cut from consideration (don't re-litigate)
- **Attack bonus** (offense) — redundant with hit%; we use hit% for accuracy loot.
- **Bonus damage dice** (offense) — cut.
- **Extra action every N rounds** (action economy) — cut (too swingy / core-loop heavy).
- **Dodge / evasion** (movement) — cut.
- **Grant Advantage on a class of rolls** (utility) — cut, too OP.

## Slot → affix allocation (2026-07-15)

**Rule: each stat appears on exactly ONE slot type.** Grants-proficiency (multi-slot) and
Two-handed wielding (off-hand only) are the slot-scoped unlock exceptions. **Wrist and Ring are
interchangeable pairs** — no left/right; any wrist item fits either wrist slot, any ring either ring
slot — so both physical slots of a pair draw from the same bundled pool.

| Slot | Stat(s) — unique to this slot type |
|---|---|
| Head | Damage mitigation % · Spell damage · [prof] |
| Neck | On-hit rider · Healing power |
| Chest | AC % · [prof] |
| Cloak | Saving throws · Stealth/perception |
| Wrist (×2, interchangeable) | Hit chance % (ATT%) · STR/DEX ⬥ · [prof] |
| Legs | Max HP · [prof] |
| Hands (gloves) | Attack speed ⬥ · Cast speed ⬥ · Life steal % · [prof] |
| Feet (boots) | Movement/turn · Initiative · [prof] |
| Belt | CON ⬥ · Resource regen |
| Ring (×2, interchangeable) | Crit chance · Crit damage · Cooldown reduction |
| Main-hand | Weapon-attack damage · Cleave · Grants spell (caster wands/staves) |
| Off-hand | Spell splash · AoE spell radius · Two-handed wielding · [prof] |
| Ammo | Attack range |

**[prof]** = *Grants proficiency*, a multi-slot affix. Rolls on **armor** slots only:
head, chest, wrist, legs, hands, feet, off-hand. NOT on neck, cloak, belt, ring, ammo
(jewelry / cloth / consumable), and **NOT on main-hand** (user, 2026-07-18 — removed when the slot
was built; off-hand keeps it for shields).

**⬥ = purple+ chase affixes (rarity-gated).** STR/DEX, Attack speed, Cast speed, and CON only roll
on **purple / orange / red** items — they're power multipliers, not linear boosts:
- STR/DEX pumps BOTH hit and damage (every 2 ability points = +1 mod = +5% hit + more damage).
- Attack/Cast speed grants effectively a whole extra action.
- CON pumps HP + CON saves + (unarmored) AC at once — too broad to hand out cheaply.
- **Hard CC on-hit riders** (restrain, silence, stun, sleep, daze, paralyze) — taking an enemy's turn
  away is as strong as the extra-action affixes, so they're purple+ too. Soft CC (slow/root/prone/
  blind/weaken/fear) and flat poison/bleed riders can appear at lower rarities.
Rarity gating is a general lever — other affixes can get min-rarity floors later if any prove too
strong at green/blue.

Notes:
- Anchors preserved: wrist = offense, gloves = action economy, boots = movement, neck = procs,
  chest = AC, ring = wildcard, main/off-hand = weapon output.
- **Wrist and Ring are interchangeable** (no L/R). Wrist carries the offense bundle (Hit chance % +
  STR/DEX); Ring is the wildcard bundle (crit chance/damage + cooldown + healing). Both physical
  slots of the pair draw from the same pool, so two wrists / two rings just stack more of that pool.
- **Off-hand is the variable slot** — its item can be a shield, a caster focus, a second weapon, or
  empty (when a 2H weapon is equipped). Spell-splash/AoE affixes ride caster foci; a martial shield
  gives base AC via computeAC + [prof]; **Two-handed wielding** is the off-hand-exclusive unlock that
  lets a 2H main-hand coexist with an off-hand item (bypasses the current mutual-exclusion rule).
- Some slots are "thin" (Chest = AC% only, Legs = Max HP only, Ammo = Attack range only) because a
  premium defensive/utility stat claims a whole slot. Acceptable as-is; revisit only if we want every
  slot equally loaded.
- Bag is storage, not a stat slot — excluded (15 stat slots).

## Drop model — applies to EVERY slot (decided 2026-07-16)

Two independent rolls per kill: **how many** items, then **what quality** each one is.
Loot only — currency is a separate system, not modelled here.

**CR comes from `ENEMY_CR` (constants.js)** — the map combat already trusts (`unitCombatLevel`).
⚠ Do NOT use the bestiary's CR: `bestiary.js` derives it from `XP_TO_CR[def.xpReward]`, a second
independent source. They agree today, but an enemy whose `xpReward` isn't in that map shows `'?'`
in the bestiary while `ENEMY_CR` is fine — and one whose xpReward maps to a *different* CR would
have the drop table paying out at a rarity the bestiary doesn't claim. Worth collapsing onto one.

### 1. Quality — one roll decides IF something drops and HOW GOOD

```
Q = 1d100 + 90 × √(CR / 10)

  ≤80 nothing · 81–115 grey · 116–139 green · 140–164 blue
  165–200 purple · 201–219 orange · ≥220 red
```

**Why one roll instead of a chance-per-rarity:** rarity gating falls out of the arithmetic for
free. A goblin's Q *cannot physically reach* 116, so it can never drop green — no separate
"minimum CR" rule to maintain. The same shift both squeezes out `nothing` and unlocks the top,
so CR raises drop RATE and drop QUALITY with one knob.

**Why the shift is CURVED, not linear.** A straight `CR × W` cannot satisfy both ends: clearing
`nothing` (80 wide) by CR 10 needs ~9/level, but that same slope hands a CR 10 enemy a red drop,
because red sits only ~140 points above nothing's edge. Steep early and shallow late is not a
line. `√` hits 90 at CR 10 while reaching only ~156 by CR 30 (a line would hit 270).

**Band WIDTHS are the tuning surface, not the edges.** Bands are contiguous, so widening one
takes from its neighbour — widening `nothing` eats `grey` specifically, which once crushed grey
to 5% and made green three times commoner than the tier *below* it. To pull a tier N levels
earlier, drop its start; to move a group without deforming anyone, move them as a block.

| CR | nothing | grey | green | blue | purple | orange | red | |
|---|---|---|---|---|---|---|---|---|
| 0 | 80% | 20% | · | · | · | · | · | commoner, goblin2 |
| 1/8 | 69% | 31% | · | · | · | · | · | kobold, stirge, giant rat |
| 1/4 | 65% | 35% | · | · | · | · | · | goblin, wolf, zombie, skeleton |
| 1/2 | 59% | 35% | 6% | · | · | · | · | orc, gnoll, hobgoblin |
| 1 | 51% | 35% | 14% | · | · | · | · | bugbear, ghoul |
| 2 | 39% | 35% | 24% | 2% | · | · | · | ogre, nothic |
| 3 | 30% | 35% | 24% | 11% | · | · | · | owlbear |
| 4 | 23% | 35% | 24% | 18% | · | · | · | |
| 5 | 16% | 35% | 24% | 25% | · | · | · | troll, hill giant — **highest CR built today** |
| 6 | 10% | 35% | 24% | 25% | 6% | · | · | |
| 7 | 4% | 35% | 24% | 25% | 12% | · | · | |
| 8 | · | 34% | 24% | 25% | 17% | · | · | |
| 9 | · | 29% | 24% | 25% | 22% | · | · | |
| 10 | · | 25% | 24% | 25% | 26% | · | · | |
| 11 | · | 20% | 24% | 25% | 31% | · | · | |
| 12 | · | 16% | 24% | 25% | 35% | · | · | |
| 13 | · | 12% | 24% | 25% | 36% | 3% | · | |
| 14 | · | 8% | 24% | 25% | 36% | 7% | · | |
| 15 | · | 4% | 24% | 25% | 36% | 11% | · | |
| 16 | · | 1% | 24% | 25% | 36% | 14% | · | |
| 17 | · | · | 21% | 25% | 36% | 18% | · | |
| 18 | · | · | 18% | 25% | 36% | 19% | 2% | |
| 19 | · | · | 14% | 25% | 36% | 19% | 6% | |
| 20 | · | · | 11% | 25% | 36% | 19% | 9% | |
| 21 | · | · | 8% | 25% | 36% | 19% | 12% | |
| 22 | · | · | 5% | 25% | 36% | 19% | 15% | |
| 23 | · | · | 2% | 25% | 36% | 19% | 18% | |
| 24 | · | · | · | 24% | 36% | 19% | 21% | |
| 25 | · | · | · | 21% | 36% | 19% | 24% | |
| 26 | · | · | · | 18% | 36% | 19% | 27% | |
| 27 | · | · | · | 16% | 36% | 19% | 29% | |
| 28 | · | · | · | 13% | 36% | 19% | 32% | |
| 29 | · | · | · | 10% | 36% | 19% | 35% | |
| 30 | · | · | · | 8% | 36% | 19% | 37% | ancient dragon tier |

Gates that fall out of it: **green CR 1/2 · blue CR 2 · purple CR 6 · orange CR 13 · red CR 18.**
Something always drops from **CR 8**; grey is gone by **17**.

### 2. Count — how many rolls a kill gets

```
CR < 5   →  P(≥2) = 0
CR ≥ 5   →  P(≥2) = 10 + (CR − 5) × 3      10% at CR 5 → 85% at CR 30
CR < 10  →  P(≥3) = 0
CR ≥ 10  →  P(≥3) = 5  + (CR − 10) × 2      5% at CR 10 → 45% at CR 30
```

Cumulative: `exactly 1 = 100 − P(≥2)` · `exactly 2 = P(≥2) − P(≥3)` · `exactly 3 = P(≥3)`.
P(≥3) starts lower AND climbs slower (2/level vs 3/level), so it can never overtake P(≥2) and
the "exactly 2" split can never go negative.

**Why `start + slope` and not one `(CR − n) × k`:** that form can't set a value and a slope
independently. `(CR−4) × 10` gives the wanted 10% at CR 5 but saturates at **100% by CR 14**,
so every enemy past 14 would always roll 2+.

| CR | 1 loot | 2 loots | 3 loots | avg items |
|---|---|---|---|---|
| 0–4 | 100% | · | · | 0.20 – 0.77 |
| 5 | 90% | 10% | · | 0.92 |
| 10 | 75% | 20% | 5% | 1.30 |
| 15 | 60% | 25% | 15% | 1.55 |
| 20 | 45% | 30% | 25% | 1.80 |
| 25 | 30% | 35% | 35% | 2.05 |
| 30 | 15% | 40% | 45% | 2.30 |

⚠ **These are ROLLS, not guaranteed items.** Each roll runs the quality table independently and
can still come up `nothing`. Only matters at CR 5–7 (nothing is 16%/10%/4% there); from CR 8 up
`nothing` is gone and rolls == items. A troll winning a 2nd roll still has a 16% chance of it
being empty. If "2 loots" should mean two ACTUAL items, the extra rolls must skip the `nothing`
band — that's a rule change, not a tuning change.

### Open on the drop model
- **Red is in the random table** (2% at CR 18 → 37% at CR 30). That fights "red = ~20
  hand-authored uniques" — a dragon rolling a random one of twenty named artifacts is probably
  not wanted. The usual fix: drop red out of the random roll and make uniques scripted/boss-only.
- **Nothing above CR 5 exists yet.** Everything from purple up is unreachable in today's content,
  same as the dormant rows in the class tables.
- **Purple is the widest band (36)** and dominates from CR 13 to 30 — more likely than orange
  everywhere, and than red until CR 26.

## Roll tables (by slot)

One table per slot. Columns = rarity tier, rows = the stats that slot owns (per the allocation
above). A cell is the dice rolled for that stat at that tier; `—` = doesn't roll at that tier.
**Ranges are shown in parentheses** so the curve is checkable at a glance.

**"↳ how many of the above roll"** is the affix-COUNT row: how many of that slot's stat rows
actually land on a given item. It's the second variety axis — a blue hat at `1–2` might carry only
mitigation, or mitigation AND spell damage, so two blue hats differ before you even compare numbers.
Grey at `0–1` means a grey item can roll **nothing at all** (vendor trash, as intended).

⚠ **The count row saturates on thin slots.** It can never exceed the number of stats the slot
owns. Head has 3 (mitigation / spell damage / spell slots) so it can reach 3; but thin slots —
Chest (AC% only), Legs (Max HP only), Ammo (range only) — have no count axis at all: it's always
1. Don't paste a generic `2–3`/`3–4` ladder into a slot that hasn't got the stats to fill it.
The count axis only does real work on fat slots (Hands = 4, Head/Ring/Main-hand = 3).

Unlock affixes (Grants proficiency, Two-handed wielding, Grants spell) are **not** counted in that
row — they're not stats. They roll independently, at their own rarity floor.

Built SLOWLY, one slot at a time — same rule as the item catalog.

**✅ ALL 13 SLOTS ARE BUILT** (finished 2026-07-18 with main-hand, then off-hand): head, neck, chest,
cloak, wrist, legs, hands, feet, belt, ring, main-hand, off-hand, ammo.

If a new slot is ever added, note that an item in a slot with no table simply rolls no affixes — an
unbuilt slot is inert, not broken.

---

### Head — Damage mitigation % · Spell damage % · [prof]

| Stat | grey | green | blue | purple | orange | red |
|---|---|---|---|---|---|---|
| **Damage mitigation %** | — | `1d2` (1–2) | `1d4+1` (2–5) | `1d6+2` (3–8) | `2d6+4` (6–16) | `3d6+6` (9–24) |
| **Spell damage %** | — | — ⛔ | `1d4+2` (3–6) | `1d6+6` (7–12) | `1d8+12` (13–20) | `1d10+20` (21–30) |
| **Spell slots added** | — | — ⛔ | `1d2` @ lv1–3<br>`1d2` @ lv4–6 | `1d2` @ lv1–3<br>`1d2` @ lv4–6<br>`1d2` @ lv7–9 | `1d3` @ lv1–3<br>`1d3` @ lv4–6<br>`1d3` @ lv7–9 | `1d4` @ lv1–3<br>`1d4` @ lv4–6<br>`1d4` @ lv7–9 |
| **↳ how many of the above roll** | 0–1 | 1 | 1–2 | 2–3 | 3 | bespoke |
| **Grants proficiency** *(unlock — rolls separately, not counted above)* | — | — | — | ✓ | ✓ | ✓ |

**Green is mitigation-only** — both spell damage and spell slots are gated to blue+, so green
has exactly one stat it can roll. That's deliberate: it makes green a clean, legible floor tier
instead of a lottery between 1–2% mitigation and a casting-doubling slot roll.

**Mitigation ladder (user's numbers, 2026-07-16).** Averages: 1.5 → 3.5 → 5.5 → 11 → 16.5, and
every tier still overlaps its neighbour (green max 2 = blue min 2; orange 6–16 straddles all of
red's 9–16 floor).

⚠ **This deliberately overshoots Rage.** `rageMitigationForLevel` is **10%**, temporary, twice a
day, and it is Gobo's signature button. An **orange hat averages 11%** and a **red averages 16.5%
(up to 24%)** — permanent, always-on, and wearable by anyone. So from orange upward a hat simply
beats the barbarian's defining ability at its own job. That's a legitimate ARPG choice (top-tier
loot outclassing an early class feature is normal over 100 levels), but it's a choice: if Rage is
meant to stay meaningful, either raise it with level or cap this row nearer 10%.

**Note the shift to multi-dice at orange/red.** `2d6+4` and `3d6+6` are BELL curves, not the flat
ranges `1dN` gives: 3d6 clusters hard around 10–11, so a red rolling its 24% max is a 1-in-216
event. That's good for chase items — a near-perfect red is genuinely rare — but it means the
posted maximum is not what a typical red looks like. A typical red is ~16%, not 24%.

### Mitigation stacking + where it plugs in (decided 2026-07-16)

**Item mitigation is ADDITIVE with Rage.** Gobo raging (10%) in a 4% hat takes **14%** off — sum
the fractions, then apply ONE multiply. Do NOT chain the multipliers (`×0.90` then `×0.96` = 13.6%);
that's multiplicative stacking and gives a different, worse-feeling number.

**Integration point: `combat.js` ~2702.** Today:
```js
const rageMit  = (target.raging && UNIT_TYPES[target.type]?.rage) ? rageMitigationForLevel(target.level) : 0;
const finalDmg = resisted ? Math.max(1, Math.round(totalRaw * (1 - rageMit))) : totalRaw;
```
The item's % is summed into `rageMit` (rename it `totalMit`) and the existing single multiply
already does the right thing. The `Math.max(1, …)` floor means damage can never reach 0 no matter
how mitigation stacks — a free backstop against any future additive runaway.

**Mitigation applies to ALL damage** (user's rule, 2026-07-16) — every source, not just weapon
hits. `damageMitigationOf()` / `applyMitigation()` are already the single shared helper, called
from all three paths that can hurt a hero: `performAttack`, the enemy AoE-save path, and the
poison rider. **The Head affix plugs in by summing its % inside `damageMitigationOf` — one line,
and every damage path picks it up for free.**

(Those helpers were extracted on 2026-07-16 fixing a live bug: the calc had been inlined in
`performAttack` alone, so Morvath's AoE and poison riders hit a raging Gobo for full damage.)

The three hero-spell damage paths (sacred flame / magic missile / burning hands) need nothing —
they only ever target enemies, and no enemy statblock has `rage` or equipment.

**⛔ Spell damage is gated to blue+** (user's call, 2026-07-16). Rarity floors are an explicit
lever ("other affixes can get min-rarity floors later"), and green wants to stay a one-stat tier.

**Spell damage % is the least certain table here — it has NO engine precedent, unlike mitigation.**
It's a percentage of a small number: Fire Bolt is `1d10` (avg 5.5), so **+10% ≈ +0.55 damage** —
which is why the old catalog's "+1% spell damage" was worth +0.055 and meant nothing at all. The
ladder is therefore much steeper than mitigation's, reaching **21–30% at red (≈ +1.2–1.7 per bolt)**.
Head is the ONLY slot that rolls spell damage, so there's no stacking to fear. **Playtest before
trusting these** — if it still feels weightless, scale the whole row, not the mitigation row.

**Spell slots on Head — user's decision, 2026-07-16.** Band-scoped and gated to **blue+**
(removed from green 2026-07-16): blue unlocks two bands (lv 1–3, lv 4–6), purple all three;
orange and red then grow the die (`1d3` → `1d4`) since there are only three bands to unlock.
Orange/red were an extrapolation of "and so on" — adjust if that wasn't the intent.

Three things this knowingly costs, recorded so they're decisions and not surprises:

- **It breaks "each stat appears on exactly ONE slot type."** Slot regen is Belt's
  (*Resource regen* = "short-rest charges, rage uses, potion slots"). Head now owns three stats.
  Belt's Resource regen should probably drop the slot part to avoid two sources.
- **⚠ Higher-band slots also pay for LOWER spells** — that's 5e upcasting, and `spendSpellSlot`
  already implements it (a slot of level N covers any spell ≤ N, spending the lowest that
  fits). So blue's `1d2 @ lv4–6` is not idle until 4th-level spells exist: it is **+1d2 more
  castings of the level-1 spells Rasec has today**, on top of the `1d2 @ lv1–3`. A blue hat is
  up to **+4 castings**, not +2. If bands are meant to be spendable only within their own band,
  that's a NEW rule and `spendSpellSlot` has to change.
- **Magnitude.** Rasec's base is 2 slots (D&D 1) up to `4/3/2` at game 20. A blue hat is up to
  **+4 castings** (both bands, upcast) against a base of 2–9; a purple up to +6. Slots are
  **per-combat** (initSpellSlots refills every fight), so this is a per-fight swing, not per-day
  — which is also why the totals are already flagged for lowering. Retune this row together with
  that pass, not separately.

---

### Wrist (×2, interchangeable) — Hit chance % · STR/DEX · [prof]

| Stat | grey | green | blue | purple | orange | red |
|---|---|---|---|---|---|---|
| **Hit chance %** | — | `1d2` (1–2) | `1d3+1` (2–4) | `1d4+2` (3–6) | `1d6+3` (4–9) | `1d6+6` (7–12) |
| **Strength** *(even only, ×2)* | — | — ⛔ | — ⛔ | `1d1` (+2) | `1d2` (+2/+4) | `1d2+1` (+4/+6) |
| **Dexterity** *(even only, ×2)* | — | — ⛔ | — ⛔ | `1d1` (+2) | `1d2` (+2/+4) | `1d2+1` (+4/+6) |
| **↳ how many of the above roll** | 0–1 | 1 | 1 | 1 | 1 | 1 |
| **Grants proficiency** *(unlock — not built, no proficiency gating exists)* | — | — | — | ✓ | ✓ | ✓ |

⚠ **WRIST IS A PAIR — every number here lands TWICE.** `affixTotal` sums both wrists, so a red
wrist is +7–12% but a red **pair** is **+14–24%**, taking a baseline 55% swing to ~79%. Price the
pair, not the item. `rollToHit` clamps at **95**, so a ladder much above this wastes rolls at the top.

**Count stays 1 even though wrist owns three stats** — deliberately, and it's load-bearing. STR/DEX
must not stack with hit% on the same wrist: both double, hit%'s red pair already reaches +14–24%
against the clamp, and even-only STR/DEX has a *floor* of +4/pair = +2 mod = +10% hit. Both together
would put a red pair at +34–54%, i.e. rolls thrown away above the ceiling. One stat per wrist keeps
every tier under the clamp **and** makes the pair a decision (two hit%, two STR/DEX, or one of each).

**STR/DEX is EVEN ONLY (user's call).** Modifiers are `floor((score-10)/2)` and the heroes' relevant
scores are mostly even (Gobo STR 16, Milo DEX 16, Rasec DEX 14, Leugren STR 14), so an *odd* bonus is
**invisible**: 16 → 17 is still +3. The `mult: 2` field doubles the roll so every point granted
actually moves a modifier — `parseDiceFormula` only speaks `NdS±M` and cannot express "even only".

⚠ **Green can roll +1% hit, which equals `precisionHitBonusForLevel`** — an entire L4 class passive,
off the cheapest tier. Known and accepted (gear should eventually outdo a low-level passive); the fix,
if wanted, is to scale Precision when Rage's flat 10% gets its level curve. Same frozen-class-number
problem, same fix.

---

### Chest — AC % · [prof]

| Stat | grey | green | blue | purple | orange | red |
|---|---|---|---|---|---|---|
| **AC %** | — | `1d3` (1–3) | `1d4+2` (3–6) | `1d6+4` (5–10) | `1d6+7` (8–13) | `2d6+8` (10–20) |
| **↳ how many of the above roll** | 0–1 | 1 | 1 | 1 | 1 | 1 |
| **Grants proficiency** *(unlock — not built, no proficiency gating exists)* | — | — | — | ✓ | ✓ | ✓ |

Option **C** of three, chosen 2026-07-16 ("go with C for sure"). Averages: 2 → 4.5 → 7.5 → 10.5 → 15.

**A THIN slot — no count axis.** AC% is the only stat chest owns until proficiency gating exists, so
the count is 1 at every tier and tiers separate by **size alone**.

⚠ **AC% is NOT flat AC, and NOT mitigation.** It's a percentage-point reduction of the attacker's hit
chance — the defensive mirror of wrist's hit% — subtracted from the same `rollToHit` channel. Flat AC
is a *different* thing chest armour already supplies via `computeAC`'s `chest.ac` (35 of 46 chest
items carry one, 0–18); AC% stacks **on top** of it.

**It's stronger than the numbers look.** −10% against a 55% attacker means 45%, i.e. **18% fewer
hits** — so one point of AC% is worth **~1.8 points of mitigation** at baseline, and *more* as enemy
hit drops, since it's a proportion of a shrinking number. That ratio is why this ladder sits below
head's mitigation numerically while being comparable in value. Red `2d6+8` is a BELL curve: a typical
red is **~15%, not 20%**.

⚠ **ATTACK ROLLS ONLY.** Save-based AoE and poison never reach `rollToHit`, so AC% does nothing
against them — exactly like real AC vs a fireball. This is the deliberate asymmetry with
`mitigation_pct`, which lives in `damageMitigationOf` and covers *every* damage path. It's what keeps
chest's bigger-looking numbers from outclassing the hat, and it means the two are complementary
rather than redundant: a red chest + red hat ≈ **31–47% less damage taken**, multiplicatively.

**Integration point: `combat.js`, the single `rollToHit` call site.** Netted into the existing
`hitPctBonus` channel — `precisionBonus - affixTotal(target, 'ac_pct')` — rather than given its own
parameter, so hit% keeps exactly one adjustment channel with both sides visible on one line. The 5–95
clamp applies to the result, so armour can never drive an attacker below 5%. No log work was needed:
`atkBreakdown` already prints `needed ≥ threshold`, so AC% surfaces as a visibly higher bar.

---

### Main-hand — Weapon-attack damage % · Cleave · [Grants spell]

| Stat | grey | green | blue | purple | orange | red |
|---|---|---|---|---|---|---|
| **Weapon damage %** | — | `1d2` (1–2) | `1d4+1` (2–5) | `1d6+2` (3–8) | `2d6+4` (6–16) | `3d6+6` (9–24) |
| **Cleave — falloff ladder** | — | `[25]` | `[40]` | `[66, 25]` | `[85, 40, 25]` | `[100, 85, 40, 25]` |
| **↳ how many of the above roll** | 0–1 | 1 | 1–2 | 1–2 | 2 | 2 |

**Weapon damage % is the user's ladder (2026-07-18)** — the same curve as head's mitigation and
cloak's saves. Scoped to **"melee or ranged attacks"**: every weapon swing, no spells. It plugs into
`applyWeaponDamage`, an exact mirror of `applySpellDamage` on the other side of the `atk.spellKey`
split in `_executeAttack`, so a hit is scaled by one of the two and **never both**.

⚠ **`ceil` makes even green land.** Both damage scalers round UP, so +1% of a 13-damage greataxe
swing is 13.13 → **14**. The cheapest tier is worth a guaranteed +1, not zero — which is the whole
reason the spell-damage rule chose `ceil` and is why this small-looking ladder is playable.

⚠ **Sneak Attack sits OUTSIDE it**, exactly as it sits outside spell damage. The rogue's dice are a
class feature with their own level curve (`sneakAttackDiceForLevel`), not weapon output, so a weapon
roll must not multiply Milo's burst on top of it.

**Main-hand is a SINGLE slot, not a pair** — unlike wrist and ring, nothing here doubles. That's why
both stats may land on one item without the clamp problem that pins wrist's count to 1.

**Cleave is a per-target FALLOFF LADDER** (user's spec, 2026-07-18). Entry `i` is the % of the
primary hit that the **i-th nearest** foe takes, within a flat 5 ft ("adjacent") at every tier:

| tier | 1st adjacent | 2nd | 3rd | 4th |
|---|---|---|---|---|
| green | 25% | · | · | · |
| blue | 40% | · | · | · |
| purple | 66% | 25% | · | · |
| orange | 85% | 40% | 25% | · |
| red | **100%** | 85% | 40% | 25% |

Each tier both **raises the front number and grows the tail**, so a tier up is felt twice — the first
neighbour hurts more *and* another neighbour joins. At red the nearest neighbour takes the **full**
hit. Radius never changes: this affix scales by how many it catches and how hard, never by reach.

⚠ **NOTHING about cleave is rolled.** Every other affix in the file rolls dice for its magnitude;
cleave does not — a green cleave is 25% on every green cleaving weapon. That's why it carries
`falloff` where others carry `dice`, and why `_tierEntry()` exists: the eligibility test in
`rollAffixes` has to read *either* key or cleave would be gated out of every tier. Tier variety comes
entirely from the ladder's SHAPE.

**`maxTargets` is the ladder's LENGTH** (1/1/2/3/4), never stored as a second field — so the cap and
the ladder cannot drift apart.

⚠ **Sort order is load-bearing, not cosmetic.** `foes` is sorted nearest-first and the ladder
descends, so the sort decides *who gets the big number*, not merely who is included.

### Each cleaved foe rolls its OWN to-hit (user's call, 2026-07-18)

> *"otherwise hit or miss is massively OP or underpowered"*

One shared roll would make a landed red cleave auto-deal 100/85/40/25% to four foes with no further
counterplay, while a missed swing erases all of it — the affix would be **pure variance amplification
on a single d100**. Per-target rolls give each foe's own AC and dodge state a say, which is what makes
the falloff ladder a curve rather than a coin flip.

- **Attacker-side terms are reused verbatim** from the primary swing (`atkMod`, `precisionBonus`), so
  a cleave can never be more or less accurate than the swing that caused it.
- **Defender-side is recomputed per foe:** its own AC, its own `ac_pct`, its own dodge.
- **Bless rerolls per foe** — it's 1d2 *per attack roll*, and each of these is its own roll.
- **Situational advantages do NOT carry over.** Smoke & Mirrors, Owl's Help and the hidden-attacker
  bonus are relationships with the *primary target*, not with whoever stands beside it. Dodge is a
  property of the foe, so that one comes along.
- ⚠ **A crit on a splash roll is treated as a plain hit** (confirmed 2026-07-18). `raw` already
  doubled if the primary swing crit; doubling again would compound one crit into two. The splash is
  a *share of the hit that happened*, not an independent attack.

⚠ **THE LADDER IS DEALT TO THE FOES THAT HIT, NOT TO DISTANCE.** This is the subtle part, and I got
it backwards on the first pass. One roll goes out per foe in range (up to the ladder's length), then
the percentages are handed to whichever foes **connected**, best share first. The user's worked
example: purple is `[66, 25]` against two adjacent foes, so two rolls go out, and *"if either hits,
then the 66% affects the one hit"* — a lone connecting foe takes the **top** of the ladder, not the
entry matching where it stood.

So **a miss SHORTENS the ladder rather than blanking a slot.** Orange `[85, 40, 25]` landing one of
three rolls deals 85% once; landing two deals 85% and 40%. This is why every roll must be taken
*before* any damage is assigned — a foe's share isn't knowable until the whole volley is in, which
is what the `hitIdx` walk in `_resolveSplash` implements.

`toHit` is a **callback**, not baked into the resolver — melee cleave passes a weapon-attack roll,
and off-hand's Spell splash can pass its own profile, or `null` to auto-hit (which is what a
save-based splash would want).

⚠ **Cleave is MELEE ONLY — confirmed by the user 2026-07-18**, and deliberately NARROWER than
`weapon_damage_pct`, which they scoped to "melee or ranged". The two main-hand stats have different
reach on purpose. `_resolvesRanged` excludes both ranged weapons and attack-roll spells.

**The known cost:** a bow hero who rolls cleave gets a dead affix — the same starvation problem
`lootCoverage` exists to fight. Accepted, not overlooked. (`lootCoverage` abstains on main-hand
anyway, since weapons have no `material`.)

**Cleave is the first NON-SCALAR stat affix.** It carries a whole ladder instead of one `value`, so
`affixTotal` can't read it — summing across two slots would read as one bigger cleave, which isn't
what two cleaving weapons should mean. Consumers look it up **by shape** (`_splashAffixOf`), the way
`_onHitRiderOf` finds a rider. `affixTotal` now guards with `a.value ?? 0` so a stray call on a
non-scalar key returns 0 instead of poisoning the sum to `NaN`.

**The shared splash resolver is built** (`_resolveSplash` in combat.js) — the doc's "one routine,
parameterized" that **off-hand's Spell splash will reuse** with its own numbers. Two things it gets
right that are easy to get wrong:
- **Origin is a captured `{x, z}`, not the target unit.** A lethal swing schedules
  `removeDefeatedUnit` *before* the splash timer fires, so reading `primary.grp.position` inside the
  resolver would touch a mesh that's already gone. Cleaving off a kill is the point of the affix, so
  the origin has to outlive the corpse.
- **It splashes a PRE-mitigation number, not `finalDmg`.** Each splashed foe takes its *own*
  `applyMitigation` cut; splashing the already-mitigated figure would apply the primary target's
  armor to everyone standing near it.
- ⚠ **The base is `dmg + critDmg` — Sneak Attack is EXCLUDED** (user, 2026-07-18: *"sneak attack
  does all damage on a single target"*). `totalRaw` is `dmg + sneakDmg + critDmg`; the sneak dice are
  the rogue's precision strike on ONE foe, not weapon output, so they must not bleed onto the
  neighbours — otherwise a red cleave would splash 100% of a 10d6 sneak sideways. Same principle
  that keeps sneak out of `weapon_damage_pct` and `spell_damage_pct`. The ring's flat crit bonus
  stays in: that *is* part of the swing that landed.
- ⚠ **No stagger and no swing animation** (user, 2026-07-18: *"just do the damage and float the
  damage text over the cleaved targets"*). An earlier pass spaced foes 220ms apart, which bought
  nothing but latency — a red cleave added ~2.6s to one swing, straight onto the known automation
  turn-delay problem. Everything lands on one beat now; the only remaining wait is the 400ms corpse
  pause so the float is readable before the mesh goes.

`done()` fires exactly once on every path (no neighbours, everything died, partial kill) — the same
contract `_resolvePoison` and `_resolveRider` keep, and the freeze class `/timing-audit` hunts.

⚠ **[prof] is REMOVED from main-hand** (user, 2026-07-18). Grants-proficiency is an **armor** affix;
a weapon doesn't teach you to wear plate. Off-hand keeps it for shields. This drops main-hand from
four listed stats to three.

**Not built, blocked on a system rather than on numbers:** *Grants spell* (the doc's last 🔴 —
injects a castable into the wielder's spell list, i.e. hotbar/spell-panel plumbing). The count row
therefore saturates at 2, and will stay there unless Grants spell is built.

---

### Off-hand — Spell splash · AoE spell radius

The caster's mirror of main-hand, and the LAST slot built (2026-07-18).

| Stat | grey | green | blue | purple | orange | red |
|---|---|---|---|---|---|---|
| **Spell splash** | — | `[25]` | `[40]` | `[66, 25]` | `[85, 40, 25]` | `[100, 85, 40, 25]` |
| **AoE spell radius** | — | +5 ft | +5 ft | +10 ft | +15 ft | +20 ft |
| **↳ how many of the above roll** | 0–1 | 1 | 1–2 | 1–2 | 2 | 2 |

**Spell splash is Cleave with a different trigger** — *"use the same formula as cleave"* (user). Both
now read from ONE shared `SPLASH_FALLOFF` const in affixes.js rather than a pasted copy, so they
cannot drift; if they ever *should* differ, that's the moment to split them, not before. Same
resolver, same one-roll-per-foe volley, same deal-to-the-hits ladder, same 5 ft.

⚠ **SINGLE-TARGET SPELLS ONLY — never AoE spells** (user, 2026-07-18). An AoE already hits the whole
cluster, so splashing it would double-dip the same geometry — and the caster's AoE upgrade path is
the *other* stat in this very slot. The two are complementary by design: one widens the spells that
already spread, the other spreads the ones that don't.

**Which spells qualify, and how each splash resolves.** The splash mirrors its PARENT spell's
resolution — this is exactly why `toHit` is a callback rather than baked into the resolver:

| spell | primary | splash resolves as |
|---|---|---|
| **Fire Bolt** | attack roll | attack roll per foe (via `_executeAttack`, same path as cleave) |
| **Magic Missile** | auto-hit | **auto-hit** (`toHit: null`) — full ladder always lands |
| **Sacred Flame** | DEX save, negates | DEX save per foe; a failed save = "hit" |
| Burning Hands | AoE | ✗ excluded — AoE |

⚠ **Magic Missile is the strongest partner** for this affix: it never misses, so its splash never
misses either and the whole ladder always pays out. That's the natural cost of pairing a
never-miss spell with a splash affix, and it's the case the resolver's null-`toHit` branch exists
for — but it's the first place to look if spell splash plays too strong.

**AoE spell radius is FIXED per tier, not rolled** — the third non-rolled shape in the file, after
cleave's falloff ladder. `fixed` sits alongside `dice` and `falloff` in `_tierEntry`.

⚠ **The value is a DIAMETER bonus, so consumers add HALF of it to a radius** — the user's word,
kept literally. `aoeRadiusFtOf()` is the single conversion point, so the distinction can't be got
wrong in two places. **Consequence worth checking in play:** green's +5 ft diameter is **+2.5 ft of
radius**, which does not land on the 5 ft grid — it may or may not catch another tile depending on
geometry. If AoE growth should move in whole tiles, this row wants to mean *radius*, and that's a
one-line change in `aoeRadiusFtOf`.

⚠ **Green and blue are BOTH +5 ft** (user's ladder). Blue separates from green through the COUNT
axis — it can pair AoE size with spell splash — not through size. That's why blue's `[1, 2]` is
load-bearing here in a way it isn't on other slots.

**Only ONE hero AoE spell exists to widen: Burning Hands.** Despite its "15 ft cone" description it
is implemented as a *radius around the caster* (`spell.rangeFt`), so the affix widens exactly the
circle the targeting already uses. Morvath's Grave Curse is the only other AoE and is an ENEMY
attack — enemies carry no `equipment`, so `affixTotal` returns 0 and it's unaffected for free,
with no hero-only test needed.

⚠ **A martial shield can roll caster affixes.** Off-hand holds both shields and caster foci, and
nothing gates the roll by base — so "Vast Buckler of the Maelstrom" is a legal drop that does
nothing for Gobo. Same dead-affix shape as cleave-on-a-bow, and the same accepted cost;
`lootCoverage` abstains on off-hand anyway (no `material`). Gating splash/AoE to focus-type bases
is the fix if it grates.

---

**⚠ Grey is ALWAYS a plain base — on every slot.** No stat in any table above has grey dice, so
`eligible` is empty at grey and `rollAffixes` returns `[]` before the count is read. The `0–1` in
every grey count cell is shape-consistency, **not** a coin flip. (Verified 2026-07-16: 2000/2000 grey
rolls produced nothing.)

## Armor proficiency + material (built 2026-07-17)

**`material` is ONE field doing two jobs**, on all 225 armor items across the 7 armor slots
(chest, head, legs, feet, hands, wrist, belt). It decides **who may equip a piece**, and on chest
**how much DEX it grants**. It replaced the short-lived `armorType` — for chest they're the same
axis, and two fields that must always agree is a drift bug waiting to happen.

| material | proficiency needed | who | chest DEX |
|---|---|---|---|
| `cloth` | — | all 4 | *n/a — no `ac`, counts as unarmored* |
| `leather` | Light | all but Rasec | full |
| `hide` | Medium | Gobo, Leugren | max +2 |
| `plate` | Heavy | Leugren only | none |

**The proficiency data already existed** in `UNIT_TYPES.armorProficiency` and was already rendered
in the stat sheet's traits section. Nothing enforced it — Rasec's own sheet read *"cannot wear
light, medium, or heavy armor"* while he was free to wear Plate. `canEquip()` in equipment.js is
the single gate; loot assignment, drag-drop, the right-click Equip row and `equipItem` itself all
route through it. `equipItem` returns **null** (not `[]`) on refusal so callers must notice.

⚠ **Belts are NOT armor** (user, 2026-07-17) — a belt is a strap. Scale/Studded belts carry
`material: 'cloth'` *despite their names*, because cloth is the no-proficiency bucket and anyone
including Rasec can wear them. Only plate/chain belts are gated, being actual plate.

⚠ **PROFICIENCY IS NESTED, NOT A PARTITION.** This is the fact that breaks most intuitions here:

```
    cloth   ⊂ everyone          leather ⊂ {Milo, Gobo, Leugren}
    hide    ⊂ {Gobo, Leugren}   plate   ⊂ {Leugren}
```

**Only plate is exclusive to anyone.** Leugren is proficient in everything, so *there is no
material meaning "Gobo only"* — anything Gobo can wear, Leugren can too. Consequences: Leugren can
use **100%** of all armor and can never be starved; **Rasec can use 39%** and is the scarce one,
with cloth his only route. Don't try to make a material belong to one hero; it can't.

## Loot coverage — don't let RNG starve a hero (built 2026-07-17)

Lives in **`js/lootCoverage.js`**, deliberately a LEAF (items.js + equipment.js only) so the
probability model is testable — loot.js drags in three.js for its 3D orbs and can't be imported
outside a browser.

**The formula:**
```
1. HERO      w(h) = 1 / (1 + n[slot][rarity][h])   — pick one, proportional to w
2. MATERIAL  the BEST material h is proficient in, walking DOWN if the slot has none
3. ITEM      uniform within (slot, material)
```

`n` increments at **assignment**, not at drop — the game doesn't know who a drop was *for* until
the player says so, and a drop handed elsewhere hasn't covered anyone. Hook is in lootPanel's
commit step. ~312 counters in localStorage under `dnd-loot-coverage`.

**What it's actually for — the TAIL, not the mean.** Four heroes need four items, so the mean
can't beat 4.0 and uniform already averages 4.32. There is nothing to win there. The problem is
that uniform's **p99 is 8 drops and the worst measured run was 19** — one hero waiting through
nineteen drops that were all for someone else. Measured:

| model | mean | p99 | worst |
|---|---|---|---|
| uniform | 4.32 | 8 | **19** |
| material-coverage k=3 | 4.23 | 6 | 9 |
| **hero-targeted k=1** | **4.01** | **4** | **8** |

**Two traps, both of which I walked into — don't repeat them:**

⚠ **Balancing MATERIALS instead of HEROES buys nothing** (4.32 → 4.23, a rounding error). Because
of the nesting, "all four materials have dropped" can be true while Rasec has nothing — four
leather drops cover Milo, Gobo *and* Leugren.

⚠ **Step 2 must take each hero's CEILING, not "any material they can wear."** The latter looks
reasonable and is badly wrong: cloth accrues probability from all four hero picks and lands at
**70%**, while plate — reachable only via Leugren — collapses to **4.5%**, so Leugren would
essentially never see the plate that defines him. Taking the ceiling gives exactly **25% each** on
a fresh tier and recovers the 1:1 feel the design wanted (cloth=Rasec, leather=Milo, hide=Gobo,
plate=Leugren) — not through exclusivity, but through each hero's best.

**No exponent (k=1).** k=3 measured 4.01 vs k=1's 4.02 — identical, because the four-drop floor
dominates. One less dial.

**Measured behaviour:** fresh tier 25/25/25/25 · Rasec takes one cloth → cloth 14.3%, others
28.6% · Rasec starved while others have two → cloth 50% · all covered → back to 25% each, no cliff.

**Slots with no materials abstain** (main-hand, off-hand, ring, cloak, neck, bag) — `coveragePool`
returns null and the caller goes uniform. Nobody can be starved of items anyone can equip.

**head and wrist stock zero hide**, so a Gobo-targeted drop there walks down to leather (he's still
covered — leather is on his ladder) and those slots run cloth 25 / leather 50 / plate 25. That's
cosmetic only: nothing reads head/wrist material beyond the gate. Adding hide helms/bracers would
even the split and change nothing mechanically.

## Resolved decisions
- **Cleave + Spell splash share one splash resolver.** Melee cleave and spell splash both call a
  single "splash to nearby foes" routine. Parameterize it — do NOT hardcode "1 adjacent foe" or a
  5 ft radius:
  - `radius` (WU) — starts at adjacent/5 ft but must be able to grow beyond that with item tier.
  - `maxTargets` — starts at 1 but must be able to splash onto more than one foe.
  - `pct` — fraction of the primary hit's damage that splashes.
  Caller passes the origin (melee target / spell impact point) + these params; the resolver finds
  foes within `radius`, up to `maxTargets`, and applies `pct` of the damage. Higher-rarity gear
  widens radius and/or raises maxTargets.
- **AoE spell radius and Spell splash are DISTINCT affixes** — do not collapse. AoE radius grows the
  spell's own effect area (a bigger fireball zone); spell splash bleeds a % of a hit onto *neighbours
  of the primary target*. Different mechanics, kept separate.

## Open decisions
- **Equipment proficiency restrictions?** Do we want a gating system (heavy armor / martial weapons
  restricted by hero, or with a penalty) at all? The **Grants proficiency** affix only matters if we
  do. If we stay fully unrestricted, that affix has no purpose.
- **Slot mapping**: lock the theme per slot, or allow a slot to roll one of 2–3 themed affixes?
- **v1 scope**: which affixes ship first? (Leaning the 🟢 "add-a-number" set so loot feels good fast,
  then the 🟡 mechanics — cleave, attack speed, life steal.)

## Implementation notes / sequencing
- ~70% of the list is 🟢 — pure formula additions (hit%, AC%, HP, saves, crit chance, speed,
  initiative, range, healing power). These can be a fast first pass that makes loot meaningful.
- The 🟡 mechanics (cleave, attack speed, cast speed, life steal, on-hit riders) each touch the
  attack/turn resolver, not just a stat — sequence after the number affixes.
- No 🔴 items remain after the cuts.
