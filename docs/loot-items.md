# Loot Items (living catalog)

_Building toward ~1,000 items. Companion to `loot-affix-design.md`._

> **STATUS / how we're building this:** SLOWLY — one slot at a time, per hero. Weakest→strongest
> within each slot. Done so far: all-hero weak by-slot overview + **Rasec's full weak set**. Not done:
> Gobo, Milo, Leugren; and mid/strong/purple+ tiers for everyone. Resume by picking a hero + slot.

## Conventions
- **Organized by slot → hero.** Under each slot, the four heroes with the weak items each can equip.
- Items come in **armor-type / weapon-type variants**; who can use each is gated by proficiency.
- Weakest end first; rarity labels deferred. Chase stats (STR/DEX, Attack/Cast speed, CON) and the
  unlock affixes (proficiency, 2H-wielding) appear much higher up, not here.

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

## Head  *(both Damage mitigation % AND Spell damage roll on any material — material only gates the wearer)*
- **Gobo** — Cloth Hood (spell dmg +2%), Padded Cloth Cap (mit +1%), Dented Leather Cap (mit +1%), Cracked Leather Coif (mit +2%), Dented Iron Helm (mit +2%)
- **Rasec** *(cloth only)* — Frayed Cloth Hood (spell dmg +2%), Threadbare Circlet (spell dmg +3%), Padded Cloth Cap (mit +1%), Quilted Hood (mit +2%)
- **Milo** — Rasec's cloth hats + Dented Leather Cap (mit +1%), Cracked Leather Coif (mit +2%)
- **Leugren** — all cloth + leather + Dented Iron Helm + Rusted Plate Helm (mit +2%)

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

### Head (cloth — spell damage & damage mitigation)
- Frayed Cloth Hood — Spell damage +1%
- Apprentice's Hood — Spell damage +2%
- Threadbare Circlet — Spell damage +3%
- Padded Cloth Cap — Damage mitigation +1%
- Quilted Hood — Damage mitigation +2%

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
