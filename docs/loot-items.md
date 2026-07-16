# Loot Items — base catalog (living)

_Companion to `loot-affix-design.md`. **Read its "Items are ROLLED" section first.**_

> **STATUS (2026-07-16):** Rebuilt around the **rolled** model. The old goal — ~1,000 hand-authored
> items — is DEAD; it was already duplicating itself at ~50 entries just to reach a count. A drop is
> now a **base item** (below) + a rarity + affixes rolled from that slot's table in the affix doc.
> Target: **~150 bases + ~20 red uniques**, not 1,000 items.
>
> **Converted to bases: Head.** Everything below the Head section is still the OLD per-item format
> and is kept only as raw material — its numbers are superseded by the roll tables, and its names
> bake in a tier ("Frayed…", "Threadbare…") which the rolled model forbids. Convert one slot at a
> time; delete each old section as it's replaced.

## Conventions
- **A base carries NO stats.** Only `id, name, slot, material, icon`. Numbers come from the roll
  table at drop time. If you're typing a number here, you're in the wrong file.
- **Names are NEUTRAL** — "Cloth Hood", never "Frayed Cloth Hood". A base drops at every tier, so
  its name can't imply one. Rarity + affixes decorate it (prefix/suffix).
- **Material gates the WEARER, not the affix** — every material in a slot can roll every stat that
  slot owns. Each hero needs a base in a material they can wear for each of that slot's stats.
- **Bases per slot are deliberately few.** Variety comes from rolls × rarity × prefix/suffix, not
  from more bases.

## Proficiency matrix (from constants.js)
| Hero | Class | Armor | Shields | Weapons |
|---|---|---|---|---|
| Gobo | Human Barbarian | Light, Medium (+ Unarmored Def.) | yes | ALL simple + martial |
| Rasec | Elf Mage | none (cloth only) | no | Dagger, Dart, Sling, Quarterstaff, Light Crossbow |
| Milo | Halfling Rogue | Light | no | Simple + Hand Crossbow, Longsword, Rapier, Shortsword, Shortbow |
| Leugren | Dwarf Cleric | Light, Medium, Heavy | yes | Simple + Battleaxe, Handaxe, Light Hammer, Warhammer |

Armor weight → who: Cloth = all · Light = Gobo/Milo/Leugren · Medium = Gobo/Leugren · Heavy =
Leugren · Shield = Gobo/Leugren · Caster focus = Rasec/Leugren.

---

## Head — BASES ✅ *(converted 2026-07-16 — roll table: `loot-affix-design.md` → Roll tables → Head)*

Head owns **Damage mitigation %** and **Spell damage %**. Both roll on *every* material — material
only decides who can wear the hat. Rasec is cloth-only, so the cloth bases are the ones that must
cover both stats for him; they're deliberately the largest group.

| id | Name | Material | Who can wear |
|---|---|---|---|
| `head_cloth_hood` | Cloth Hood | cloth | all |
| `head_cloth_cap` | Cloth Cap | cloth | all |
| `head_cloth_cowl` | Cloth Cowl | cloth | all |
| `head_silk_circlet` | Silk Circlet | cloth | all |
| `head_silk_wrap` | Silk Head Wrap | cloth | all |
| `head_quilted_hood` | Quilted Hood | cloth | all |
| `head_leather_cap` | Leather Cap | light | Gobo · Milo · Leugren |
| `head_leather_coif` | Leather Coif | light | Gobo · Milo · Leugren |
| `head_hide_helm` | Hide Helm | medium | Gobo · Leugren |
| `head_mail_coif` | Mail Coif | medium | Gobo · Leugren |
| `head_iron_helm` | Iron Helm | heavy | Leugren |
| `head_plate_helm` | Plate Helm | heavy | Leugren |

**12 bases cover the whole Head slot, for every hero and every tier** — replacing what would have
been ~100+ hand-written hats. Rasec draws from the 6 cloth bases; each can roll mitigation OR spell
damage at any tier, so his "spell damage hat" and his "mitigation hat" are the same six bases with
different rolls.

**Naming check:** every name above is tier-neutral on purpose. A `Cloth Hood` is a legitimate grey
drop *and* a legitimate red one. The old entries this replaced ("Frayed Cloth Hood", "Threadbare
Circlet") can't survive rolling — "Threadbare" is a lie on a purple.

_Prefix/suffix decoration (e.g. "Warding Cloth Hood of Flame") is designed but not yet tabled — it's
its own pass once 2–3 slots have bases._

---

# OLD FORMAT BELOW — superseded, kept as raw material only
_Numbers here are dead (roll tables own them) and names bake in a tier (rolled model forbids it).
Mine these for base-name ideas, then delete each section as its slot is converted._

## Neck  *(accessory — no proficiency, all heroes)*
- **Gobo / Rasec / Milo / Leugren** — Cracked Bone Charm (on-hit +1 poison), Chipped Fang Pendant (on-hit +1 bleed), Dull Copper Locket (healing +1), Faded Prayer Bead (healing +2)

## Chest  *(armor: AC%)*
- **Gobo** — Tattered Robe (AC +1%), Tattered Padded Vest (AC +1%), Moth-eaten Gambeson (AC +2%), Rusty Chain Scraps (AC +2%)
- **Rasec** — Tattered Robe (AC +1%)
- **Milo** — Tattered Robe, Tattered Padded Vest, Moth-eaten Gambeson
- **Leugren** — Tattered Robe, Tattered Padded Vest, Moth-eaten Gambeson, Rusty Chain Scraps, Dented Breastplate (AC +2%)

## Cloak  *(accessory — all heroes)*
- **Gobo / Rasec / Milo / Leugren** — Tattered Cloak (saves +1), Frayed Shawl (saves +1), Ragged Grey Cloak (stealth +1), Dusty Traveler's Wrap (stealth +1)

## Wrist  *(armor: hit%)*
- **Gobo** — Frayed Cloth Bands (hit +1%), Worn Leather Bracers (hit +2%), Cracked Iron Bracers (hit +2%)
- **Rasec** — Frayed Cloth Bands (hit +1%)
- **Milo** — Frayed Cloth Bands, Worn Leather Bracers (hit +2%)
- **Leugren** — Frayed Cloth Bands, Worn Leather Bracers, Cracked Iron Bracers, Battered Vambraces (hit +2%)

## Legs  *(armor: max HP)*
- **Gobo** — Frayed Cloth Leggings (HP +2), Torn Leather Leggings (HP +2), Patched Hide Trousers (HP +3), Worn Mail Leggings (HP +4)
- **Rasec** — Frayed Cloth Leggings (HP +2)
- **Milo** — Frayed Cloth Leggings, Torn Leather Leggings, Patched Hide Trousers
- **Leugren** — Frayed Cloth Leggings, Torn Leather Leggings, Patched Hide Trousers, Worn Mail Leggings, Splintered Plate Greaves (HP +5)

## Hands (gloves)  *(armor: life steal %)*
- **Gobo** — Cloth Wraps (LS +1%), Cracked Leather Gloves (LS +1%), Worn Grip Gloves (LS +2%)
- **Rasec** — Cloth Wraps (LS +1%)
- **Milo** — Cloth Wraps, Cracked Leather Gloves, Worn Grip Gloves
- **Leugren** — Cloth Wraps, Cracked Leather Gloves, Worn Grip Gloves, Dented Gauntlets (LS +2%)

## Feet (boots)  *(armor: movement / initiative)*
- **Gobo** — Cloth Slippers (move +5ft), Light Cloth Shoes (init +2), Worn Leather Boots (move +5ft), Bent Spurs (init +1), Muddy Boots (move +5ft)
- **Rasec** — Cloth Slippers (move +5ft), Light Cloth Shoes (init +2)
- **Milo** — Cloth Slippers, Light Cloth Shoes, Worn Leather Boots, Bent Spurs, Muddy Boots
- **Leugren** — all of Gobo's + Plated Sabatons (move +5ft)

## Belt  *(accessory — all heroes)*
- **Gobo / Rasec / Milo / Leugren** — Frayed Rope Belt (regen trickle), Cracked Leather Belt (regen small), Worn Sash (regen small)

## Ring  *(accessory — all heroes)*
- **Gobo / Rasec / Milo / Leugren** — Dull Copper Band (crit chance +1%), Tarnished Ring (crit chance +1%), Chipped Stone Ring (crit dmg +5%), Bent Iron Band (crit dmg +5%), Plain Tin Ring (cooldown, minor)

## Main-hand  *(weapon-type gated)*
- **Gobo** *(all weapons)* — Rusty Dagger (dmg +1), Cracked Quarterstaff (dmg +1), Chipped Shortsword (dmg +1), Rusty Longsword (dmg +1), Cracked Club (cleave 5%), Worn Mace (cleave 5%), Bent Handaxe (dmg +2), Dull Battleaxe (dmg +2), Chipped Warhammer (cleave 5%), Notched Greataxe (dmg +2)
- **Rasec** *(dagger/quarterstaff)* — Rusty Dagger (dmg +1), Cracked Quarterstaff (dmg +1)
- **Milo** *(simple + rogue martial)* — Rusty Dagger, Cracked Quarterstaff, Cracked Club (cleave 5%), Worn Mace (cleave 5%), Chipped Shortsword (dmg +1), Rusty Longsword (dmg +1)
- **Leugren** *(simple + dwarven martial)* — Rusty Dagger, Cracked Quarterstaff, Cracked Club, Worn Mace, Bent Handaxe (dmg +2), Dull Battleaxe (dmg +2), Chipped Warhammer (cleave 5%)

## Off-hand  *(shield / focus / second weapon)*
- **Gobo** *(shield or 2nd weapon)* — Cracked Wooden Shield (base AC), Dented Buckler (base AC); off-hand light weapon: Rusty Dagger, Cracked Club
- **Rasec** *(caster focus)* — Cracked Focus Stone (spell splash 5%), Chipped Orb (spell splash 5%), Dim Crystal Shard (AoE +5%)
- **Milo** *(2nd light weapon)* — Rusty Dagger, Chipped Shortsword
- **Leugren** *(shield or holy-symbol focus)* — Cracked Wooden Shield, Dented Buckler; focus: Cracked Focus Stone (spell splash 5%), Chipped Orb, Dim Crystal Shard

## Ammo  *(matched to ranged weapon)*
- **Gobo** — *(none — throws handaxes, no ammo slot)*
- **Rasec** — Worn Bolts (range +5ft, Light Crossbow), Chipped Sling Stones (range +5ft, Sling)
- **Milo** — Crooked Arrows (range +5ft, Shortbow), Worn Bolts (range +5ft, Hand Crossbow)
- **Leugren** — *(none — throws handaxes)*

---

# Rasec (Elf Mage) — weakest ~50

Cloth-only armor, weapons limited to Dagger/Quarterstaff/Dart/Sling/Light Crossbow, caster foci in
off-hand, arcane accessories. INT caster (str 8 / dex 14 / con 12 / int 16). Per-slot bullets so the
list stays easy to extend. (Damage mitigation and Spell damage both roll on his cloth hats — material
gates the wearer, not the affix.)

### Head — ✅ CONVERTED, see the Head BASES table above (this list is dead)

### Neck (accessory)
- Cracked Bone Charm — On-hit +1 poison
- Chipped Fang Pendant — On-hit +1 bleed
- Dull Copper Locket — Healing power +1
- Faded Prayer Bead — Healing power +2

### Chest (cloth robe — AC%)
- Tattered Robe — AC +1%
- Frayed Acolyte Robe — AC +1%
- Moth-eaten Mantle — AC +2%

### Cloak (accessory)
- Tattered Cloak — Saving throws +1
- Frayed Shawl — Saving throws +1
- Ragged Grey Cloak — Stealth/perception +1
- Dusty Traveler's Wrap — Stealth/perception +1

### Wrist (cloth bands — hit%)
- Frayed Cloth Bands — Hit chance +1%
- Worn Silk Wraps — Hit chance +2%
- Cracked Bone Bracers — Hit chance +2%

### Legs (cloth — max HP)
- Frayed Cloth Leggings — Max HP +2
- Patched Cloth Trousers — Max HP +3
- Worn Robe Skirt — Max HP +4
- Threadbare Leggings — Max HP +5

### Hands (cloth wraps — life steal)
- Cloth Hand Wraps — Life steal +1%
- Frayed Silk Gloves — Life steal +2%
- Worn Cloth Mitts — Life steal +2%

### Feet (cloth — movement / initiative)
- Cloth Slippers — Movement +5 ft
- Worn Sandals — Movement +5 ft
- Light Cloth Shoes — Initiative +1
- Soft Silk Shoes — Initiative +2

### Belt (accessory — resource regen)
- Frayed Rope Belt — Resource regen (trickle)
- Cracked Cord Sash — Resource regen (small)
- Worn Cloth Sash — Resource regen (small)

### Ring (accessory)
- Dull Copper Band — Crit chance +1%
- Tarnished Ring — Crit chance +1%
- Chipped Stone Ring — Crit damage +5%
- Bent Iron Band — Crit damage +5%
- Plain Tin Ring — Cooldown reduction (minor)

### Main-hand (Dagger / Quarterstaff / Wand)
- Rusty Dagger — Weapon-attack damage +1 (Dagger)
- Cracked Quarterstaff — Weapon-attack damage +1 (Quarterstaff)
- Chipped Dagger — Weapon-attack damage +2 (Dagger)
- Gnarled Staff — Cleave 5% to 1 adjacent (Quarterstaff, melee)
- Cracked Wand of Sparks — Grants spell: minor spark bolt cantrip (weakest spell-granting)

### Off-hand (caster focus)
- Cracked Focus Stone — Spell splash 5% to 1 adjacent
- Chipped Orb — Spell splash 5% to 1 adjacent
- Dim Crystal Shard — AoE spell radius +5%
- Clouded Prism — AoE spell radius +5%

### Ammo (bolts / stones / darts)
- Worn Bolts — Attack range +5 ft (Light Crossbow)
- Chipped Sling Stones — Attack range +5 ft (Sling)
- Crooked Darts — Attack range +5 ft (Dart, thrown)

_Next heroes: Gobo, Milo, Leugren (each their own set)._
