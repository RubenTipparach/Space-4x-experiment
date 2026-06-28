# Factions & Art Direction — **Stellar Frontier**

> How factions work (pick a start faction, earn ships through reputation), and the
> **SVG design-language system** that gives each faction a distinct, recognizable
> look. Companion to [`GAME_DESIGN.md`](GAME_DESIGN.md) (mechanics) and
> [`TECH_DESIGN.md`](TECH_DESIGN.md) (§4 rendering, §9 ship data model).

**Status:** Draft v1 · **Last updated:** 2026-06-28

> **Awaiting input:** the canonical faction list comes from the team. This doc
> defines the **template and pipeline**; §5 is a single *illustrative* example to be
> replaced/extended once real factions land. See §8 for exactly what I need per
> faction.

---

## 1. Goals

- **Star-Trek-*inspired* sci-fi look** — sleek hulls, glowing drives, clean silhouettes
  — without copying trademarked names or designs (original IP; see §3.1).
- **A distinct design language per faction** so a player can identify a ship's faction
  *by silhouette and palette alone*, even as a tiny top-down icon.
- **SVG-first**, so art is crisp on every device and faction style is expressed as
  **reusable, parameterized parts** rather than one-off drawings (ties to
  `TECH_DESIGN.md` §4.2 SVG→texture pipeline and §9.2 parametric generator).
- **Scales with content** — new ships in an existing faction = recombine the kit;
  new factions = a new palette + part variants + grammar.

---

## 2. Faction System (gameplay)

### 2.1 Starting faction
- At character creation the player **picks a starting faction**.
- That choice determines their **starting ships**, their **home base's** faction
  styling, and their **initial reputation standings** (positive with their faction,
  baseline/negative with that faction's rivals).

### 2.2 Reputation & acquiring ships
Ships are **earned through reputation**, not just bought. To unlock a faction's ships
you raise your standing with that faction by either:

1. **Running missions** for the faction (mine/deliver, patrol, escort, recon, etc.) —
   the cooperative path; or
2. **Attacking that faction's enemies** — destroying ships of a faction they're
   hostile to grants reputation with them (the aggressive path).

- Reputation is **per-faction** and sits on a tiered track (e.g. Hostile → Neutral →
  Friendly → Allied → *Honored*). Crossing a tier **unlocks that tier's ships/modules**
  for construction at your base.
- Because acquisition is reputation-gated, **fielding another faction's ships is a
  goal you work toward**, and the two paths (missions vs. enemy-hunting) suit
  different playstyles.

### 2.3 Faction relationships
- Each faction has **allies and enemies**. Helping one can *lower* standing with its
  rivals — choices have opportunity cost.
- This relationship graph also feeds acquisition: attacking Faction A's enemies raises
  A's reputation (§2.2). The concrete graph is defined once the faction list is set
  (§8).

### 2.4 Open questions
- Can players **realign / switch** primary faction later, and at what cost (rep reset,
  losing access to ships already built)?
- Does negative reputation make a faction **actively hostile** (their patrols attack
  you / deny their space)?
- Are some **flagship/capital** ships locked behind the top "Honored" tier only?
- Do missions come from **NPC faction agents**, player alliances, or both?

---

## 3. Art Direction (global)

### 3.1 Visual North Star
- **Genre touchstone:** classic sleek-sci-fi starships — smooth primary hulls, paired
  glowing drive nacelles, deflector-style dishes, bilateral symmetry, confident clean
  lines. This is the *feel* we're after.
- **Original IP rule:** we take inspiration from the **archetypes**, not the
  trademarks. No canon names, insignia, or recognizable copyrighted hull designs. Our
  factions, names, and emblems are original.

### 3.2 SVG-first principles
- **Top-down canonical orientation:** every ship is authored **nose-up**, centered, in
  a square `viewBox` (e.g. `0 0 100 100`), so the renderer can rotate/scale freely.
- **Palette via tokens, not hard-coded fills:** ships reference **CSS variables /
  named color tokens** (`--hull`, `--trim`, `--glow`, `--accent`) so one SVG body can
  be **re-skinned per faction** by swapping the token set. Enables faction palettes and
  later player customization with zero re-drawing.
- **Layered structure** (consistent layer ids so code can target them):
  `hull → plating → glow (nacelles/windows) → insignia → damage-overlay`.
- **Bilateral symmetry via mirror transform:** author one half, mirror it — halves the
  work and guarantees clean symmetry (factions that *break* symmetry do so
  deliberately).
- **Two tiers of art** (per `TECH_DESIGN.md` §9.2): hand-authored **hero** ships for
  flagships; **parametric-generated** variants for the long tail, both built from the
  shared kit so they stay on-language.
- All SVGs flow through the §4.2 rasterize-to-texture + LOD pipeline; keep node counts
  modest and shapes clean so they read at icon size.

### 3.3 Shared ship-part kit
A library of reusable, parameterized SVG parts is the backbone of the system. Parts
are drawn neutral and **colored by faction tokens**:

- **Primary hull blanks** — saucer/disc, arrowhead, ovoid, blocky, organic.
- **Secondary hull / engineering section.**
- **Drive nacelles** — count (0–4+), shape, glow color/intensity.
- **Pylons** connecting nacelles to hull.
- **Deflector/sensor dish.**
- **Weapon hardpoints / missile racks.**
- **Greebling decals** and **window/light patterns.**
- **Faction insignia** slot.

Composing kit parts under a faction's palette + grammar yields ships that are varied
yet unmistakably "that faction."

---

## 4. Faction Design-Language Template

This is the **reusable spec** to fill per faction (the deliverable when you hand me a
faction in §8). Every faction defines values for these axes:

| Axis | What it specifies | Example values |
| --- | --- | --- |
| **Hull archetype / silhouette** | The instantly-recognizable shape | saucer+nacelles, swept wing, blocky/industrial, organic/curved, radial |
| **Symmetry** | Visual order | strict bilateral, radial, deliberately asymmetric |
| **Line language** | Edge feel | smooth & clean, swept curves, angular/aggressive |
| **Primary palette** | `--hull`, `--trim` | (2–3 hex values) |
| **Accent / glow** | `--glow`, `--accent` (nacelles, windows, weapons) | (1–2 hex values) |
| **Nacelle / drive treatment** | Count, shape, glow | e.g. "two long nacelles, soft blue glow" |
| **Plating / surface motif** | Hull texture grammar | smooth, paneled, ridged, segmented |
| **Greeble density** | Detail level | minimal · moderate · heavy |
| **Insignia / emblem** | Faction mark + placement | (original emblem) |
| **Material feel** | Finish | matte ceramic, brushed metal, dark composite |
| **Ship-class naming** | Naming convention | e.g. explorer/cruiser/escort vs. raptor/talon/reaver |
| **Generator params** | The SVG generator knobs that encode the above | `hullShape`, `nacelleCount`, palette tokens, `symmetry`, `panelStyle`, `greeble`, `insigniaRef` |

**Per faction we also list 3–5 representative ship classes** mapped to the gameplay
roles (`miner`, `combat`, and later scout/hauler/etc. — see `GAME_DESIGN.md` §3), each
described as a kit recipe so art and stats stay aligned.

---

## 5. Worked Example *(illustrative — to be replaced)*

> A placeholder faction to demonstrate the template's format. **Not canon** — swap for
> real factions in §8.

### Faction: "Concord Explorers" *(example)*
- **Fiction/feel:** idealist explorer-diplomats; ships read as calm, capable, clean.
- **Hull archetype:** saucer primary hull + slim engineering section.
- **Symmetry:** strict bilateral. **Line language:** smooth, clean curves.
- **Palette:** `--hull #d9e2ec` (pale grey-white), `--trim #5b7fa6` (steel blue).
- **Accent/glow:** `--glow #6fd3ff` (cyan drives), `--accent #f2b134` (running lights).
- **Nacelles:** two long nacelles on raised pylons, soft cyan glow.
- **Plating:** smooth with subtle panel lines. **Greeble:** minimal.
- **Material:** matte ceramic-white. **Naming:** *Pathfinder / Meridian / Aegis*.
- **Representative ships:**
  - `concord-prospector` (**miner**) — saucer + cargo blisters, single nacelle, no
    weapons; high cargo/mining, fragile.
  - `concord-escort` (**combat**) — trimmed saucer, twin nacelles, forward missile
    rack; balanced agility/range.
  - `concord-pathfinder` (**combat/hero**) — full saucer + engineering hull, twin
    nacelles, deflector dish; flagship silhouette.

*(A contrasting example — an aggressive, asymmetric, green-hued raider faction with
swept-wing hulls and heavy greebling — would slot in the same format to prove the
language separates cleanly. Left out until real factions arrive.)*

---

## 6. How factions & art map to the data model

- **Ship schema** gains a `faction` field and palette/style tokens (see
  `TECH_DESIGN.md` §9.1). A ship record points at either a hand-authored SVG or a set
  of **generator params** (the §4 axes) plus its faction token set.
- **Faction definition** is its own data record: id, name, palette tokens, kit/grammar
  defaults, insignia ref, relationship graph (allies/enemies), and reputation tiers →
  unlocks.
- **Reputation/unlocks** are data too: per-tier lists of ships/modules a faction grants
  (§2.2), so progression is content, not code.
- **Re-skinning is free:** because color lives in tokens, the same hull SVG can serve a
  faction's palette now and player customization later.

---

## 7. Open questions (art)

- Insignia system: hand-drawn per faction, or also parametric (procedural emblems)?
- How much **player customization** of ship color/markings do we allow (and does it
  override faction palette)?
- Damage/state overlays: a shared SVG layer (scorch, breached hull) applied over any
  ship?
- Do captured/cross-faction ships keep their **origin faction's** look or get re-skinned
  to the player's faction?

---

## 8. What I need from you per faction

To fill the §4 template (and §5-style writeup) for each real faction, give me as much
of this as you have — I'll infer the rest and flag assumptions:

1. **Name & one-line fiction** (who they are, their vibe).
2. **Silhouette idea** (saucer? wing? blocky? organic?) and **symmetry**.
3. **Colors** (even rough — "cold steel blue," "menacing green").
4. **Drive/nacelle feel** (how many, what glow).
5. **Allies & enemies** (even just "rivals with X").
6. **A few ship-class names** if you have them (else I'll propose per the naming axis).

Hand me the faction list and I'll produce a filled design-language entry + kit recipe
for each, ready for SVG authoring.
