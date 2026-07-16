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
| `rageMitigationForLevel` | **10%**, L2+, only while raging, 1–2 uses/day | A permanent head item must stay UNDER this. Red caps at 9%. |
| `precisionHitBonusForLevel` | **+1% hit**, a whole L4 class passive | Hit% loot must be tiny. ⚠ The current catalog gives +1% on its *weakest green* wrist item — equal to a level-4 class feature. Fix when Wrist is converted. |
| `rollToHit` | `+1 atk = +5% hit`, clamp 5–95 | Percentages here are percentage POINTS of final hit chance. |

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
| Main-hand | Weapon-attack damage · Cleave · Grants spell (caster wands/staves) · [prof] |
| Off-hand | Spell splash · AoE spell radius · Two-handed wielding · [prof] |
| Ammo | Attack range |

**[prof]** = *Grants proficiency*, a multi-slot affix. Rolls on weapon/shield/armor slots only:
head, chest, wrist, legs, hands, feet, main-hand, off-hand. NOT on neck, cloak, belt, ring, ammo
(jewelry / cloth / consumable).

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

## Roll tables (by slot)

One table per slot. Columns = rarity tier, rows = the stats that slot owns (per the allocation
above). A cell is the dice rolled for that stat at that tier; `—` = doesn't roll at that tier.
**Ranges are shown in parentheses** so the curve is checkable at a glance.

**"↳ how many of the above roll"** is the affix-COUNT row: how many of that slot's stat rows
actually land on a given item. It's the second variety axis — a blue hat at `1–2` might carry only
mitigation, or mitigation AND spell damage, so two blue hats differ before you even compare numbers.
Grey at `0–1` means a grey item can roll **nothing at all** (vendor trash, as intended).

⚠ **The count row saturates on thin slots.** Head owns only 2 stats, so it maxes at 2 from purple
on — orange and red can't roll a third because a third doesn't exist; they separate by BIGGER
numbers instead. Don't paste a generic `2–3`/`3–4` ladder into a 2-stat slot. The count axis only
does real work on fat slots (Hands = 4 stats, Ring/Main-hand = 3). Thin slots — Chest (AC% only),
Legs (Max HP only), Ammo (range only) — have no count axis at all: it's always 1.

Unlock affixes (Grants proficiency, Two-handed wielding, Grants spell) are **not** counted in that
row — they're not stats. They roll independently, at their own rarity floor.

Building these SLOWLY, one slot at a time — same rule as the item catalog. Done: Head.

---

### Head — Damage mitigation % · Spell damage % · [prof]

| Stat | grey | green | blue | purple | orange | red |
|---|---|---|---|---|---|---|
| **Damage mitigation %** | — | `1d2` (1–2) | `1d2+1` (2–3) | `1d3+2` (3–5) | `1d3+4` (5–7) | `1d3+6` (7–9) |
| **Spell damage %** | — | — ⛔ | `1d4+2` (3–6) | `1d6+6` (7–12) | `1d8+12` (13–20) | `1d10+20` (21–30) |
| **↳ how many of the above roll** | 0–1 | 1 | 1–2 | 2 | 2 | bespoke |
| **Grants proficiency** *(unlock — rolls separately, not counted above)* | — | — | — | ✓ | ✓ | ✓ |

**Mitigation is anchored to Rage (10%, temporary, 1–2/day).** A head item is permanent and
always-on, so the ladder tops out at **9% at red** — the best hat in the game never quite matches
the barbarian's signature button, and a purple (3–5%) is roughly a third to a half of it.
Averages: 1.5 → 2.5 → 4 → 6 → 8. Every step overlaps its neighbour by exactly one point.

**⛔ Spell damage is gated to blue+** (user's call, 2026-07-16). Rarity floors are an explicit
lever ("other affixes can get min-rarity floors later"), and green wants to stay a one-stat tier.

**Spell damage % is the least certain table here — it has NO engine precedent, unlike mitigation.**
It's a percentage of a small number: Fire Bolt is `1d10` (avg 5.5), so **+10% ≈ +0.55 damage** —
which is why the old catalog's "+1% spell damage" was worth +0.055 and meant nothing at all. The
ladder is therefore much steeper than mitigation's, reaching **21–30% at red (≈ +1.2–1.7 per bolt)**.
Head is the ONLY slot that rolls spell damage, so there's no stacking to fear. **Playtest before
trusting these** — if it still feels weightless, scale the whole row, not the mitigation row.

**Spell slots were considered and rejected for Head** (2026-07-16). They aren't a Head stat under
"each stat appears on exactly ONE slot type" — the nearest affix is **Resource regen**, which lives
on **Belt**. They're also far too strong: Rasec holds ~2–3 level-1 slots at low level, so a green
`1d2` would nearly DOUBLE his casting for a whole day, next to green mitigation's 1–2%. That's the
same "resource economy, not a linear boost" family as the already-cut *extra action every N rounds*
and the purple-gated *Cast speed*. **If slots ever ship: Belt, purple+ ⬥, +1 flat.** Not a hat.

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
