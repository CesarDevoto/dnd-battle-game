# Loot Affix Design (living doc)

_Last updated: 2026-07-15_

Design for a **slot-dedicated affix system**: each equipment slot has a theme, and the gear
that drops in it boosts a specific, legible stat. Upgrades should read at a glance
("boots = movement, gloves = action economy").

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
