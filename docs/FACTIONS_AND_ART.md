# Factions & Art Direction — **Stellar Frontier**

> How factions work (pick a start faction, earn ships through reputation), and the
> **SVG design-language system** that gives each faction a distinct, recognizable
> look. Companion to [`GAME_DESIGN.md`](GAME_DESIGN.md) (mechanics) and
> [`TECH_DESIGN.md`](TECH_DESIGN.md) (§4 rendering, §9 ship data model).

**Status:** Draft v1 · **Last updated:** 2026-06-28

> **Source:** factions, setting, and lore are drawn from
> [`source/Fallen_Tribes__Council_Archives.pdf`](source/Fallen_Tribes__Council_Archives.pdf)
> (the Thallian Nebula "Council Archives"). §5 fills the design-language template for
> all 8 factions; first-pass **SVG concept ships** live in
> [`../assets/concept-art/`](../assets/concept-art/) (see the rendered
> `concept-sheet.png`).

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

## 1b. Setting: The Thallian Nebula

A dense, chaotic nebula on the outer edge of a spiral arm, anchored by a central
**massive black hole** and littered with ancient megastructures (the Ancient Ring,
the Maelstrom, the Ghost Fleet). Crucially for gameplay: **stellar distances are very
short** — systems are packed close, so interstellar travel is quick — but the dense
clouds and gravitational anomalies make navigation treacherous. Each faction holds a
home system orbiting the black hole, connected by **Jump Points**. This maps directly
to our design: a tightly-packed cluster of detailed systems with a galaxy view over
the nebula, and "minutes between stars" travel (`GAME_DESIGN.md` §5) fits the short
distances well.

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
  A's reputation (§2.2).
- **Working graph (derived from the lore; tune later):**
  - **Kareth Nara ⚔ Terra Nexum** — natives vs. encroaching refugee settlers.
  - **Consortium Galactica ⚔ Astryn'Vel** — the order-keeping Council vs. the rebels
    who want it gone.
  - **Illumaria ⚔ Shadur'kai** — shadow manipulators vs. the covert operatives who
    exist to check them.
  - **Ezrathi & Kri'thul** — apocalyptic/void factions, hostile to most "living"
    factions; the Consortium opposes both as threats to order.
  - **Consortium = balancer** — props up the near-extinct (Terra Nexum), restrains the
    too-powerful; broadly neutral-to-wary toward everyone.

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

### 3.1b Ship-art pipeline decision: pre-rendered 3D sprites

Initial SVG ship concepts (`assets/concept-art/`) read too flat. **Ships now use
pre-rendered 3D sprites instead:** model each ship in 3D, light it, and render a
top-down sprite texture (`assets/sprites/`). This is fully compatible with the engine
plan — PixiJS draws the result as a normal sprite texture (`TECH_DESIGN.md` §4) — and
gives shading, depth, and material richness that flat vector ships can't.

- **Tooling (in-repo, reproducible):** procedural models generated and rendered in
  **Blender** via the **`bpy` Python module** with the **Cycles** path-tracer
  (`scripts/concept/blender_ships.py`). The hull uses the well-known greeble algorithm
  (a1studmuffin *SpaceshipGenerator*): box → iterative segment extrudes → asymmetric
  protrusions → face-categorized engines/greebles/lights → bevel → PBR materials, all
  themed per faction (proportions, palette, glow, symmetry, organic flag). A model is
  *code*, so a faction's whole fleet stays on-language and is regenerable; hand-authored
  Blender/glTF hero ships can drop into the same render step later. *(An earlier
  Three.js/Chromium-WebGL pass produced flat results — Blender/Cycles is the pipeline.)*
- **Tradeoff vs. SVG:** sprites are raster, so we **render at multiple resolutions**
  (e.g. 2×/1×/0.5× + mipmaps) and pick per zoom/DPR to stay crisp across devices —
  replacing SVG's free infinite-scaling with a small sprite-atlas pipeline.
- **Faction palette** still lives in data: model materials read from the faction's
  color tokens (§4), so re-skinning a hull for another faction means swapping the
  palette and re-rendering, not remodeling.
- **Roles & multi-angle:** one model yields the miner/combat/hero variants by
  swapping kit parts; if gameplay needs rotation beyond cheap runtime sprite rotation,
  we can pre-render an angle set per ship.
- **SVG is retained** for **UI/HUD, icons, insignia, and procedural overlays**
  (selection rings, trajectories, damage states) — see §3.2; it's the in-world *ship
  bodies* that move to 3D sprites.

### 3.2 SVG principles (UI, icons, overlays)
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

## 5. Faction Roster & Design Languages

All 8 Thallian Nebula factions, each with its filled template and the signature
concept ship in [`../assets/concept-art/`](../assets/concept-art/). Palettes list the
concept-pass hex (production swaps to tokens). Concept ships are the **first pass for
approval** — silhouette + palette established; full per-role fleets follow once
approved.

### 5.1 Consortium Galactica — *Galactic Council · Universal Order*
- **Feel:** gleaming, authoritative peacekeepers; the most "classic sci-fi" look.
- **Silhouette:** saucer primary hull + engineering hull + two nacelles on pylons.
  **Symmetry:** strict bilateral. **Line:** smooth, clean.
- **Palette:** hull `#e8edf2` pearl-white, trim `#d9a93a` gold; **glow** `#5ec8ff` blue.
- **Drives:** twin nacelles, soft blue. **Plating:** smooth, subtle panels. **Greeble:** minimal.
- **Material:** matte ceramic-white. **Naming:** *Meridian / Aegis / Arbiter*.
- **Concept:** `consortium-galactica.svg`.

### 5.2 Kareth Nara — *Karisen Natives · Natural Sovereignty*
- **Feel:** spiritual nature-keepers; grown, not built; bioluminescent.
- **Silhouette:** organic manta/leaf with swept curved wings. **Symmetry:** bilateral.
  **Line:** flowing curves.
- **Palette:** hull `#1f5a3a` forest-green, trim `#39b58a` jade; **glow** `#7dffc4`
  bioluminescent cyan-green.
- **Drives:** organic vents, soft green. **Plating:** smooth with glowing veins.
  **Greeble:** crystal-shard accents. **Material:** living ceramic/chitin.
  **Naming:** *Seedsong / Verdant / Spirewing*.
- **Concept:** `kareth-nara.svg`.

### 5.3 Terra Nexum — *Terran · Human Ascendancy*
- **Feel:** near-extinct refugees; gritty Old-West salvage; cobbled-together.
- **Silhouette:** blocky industrial gunship, chamfered nose, **deliberately
  asymmetric** salvage pods/struts. **Line:** hard, angular.
- **Palette:** hull `#9c5a2c` rust, trim `#caa45a` weathered tan; **glow** `#ff8a3c`
  orange exhaust.
- **Drives:** twin chunky engine blocks. **Plating:** riveted, patchwork, weathered.
  **Greeble:** heavy (antennae, struts, gun barrels). **Material:** scarred steel.
  **Naming:** *Prospector / Ironside / Coyote*.
- **Concept:** `terra-nexum.svg`.

### 5.4 Illumaria — *Benefactor · Guided Enlightenment*
- **Feel:** shadowy manipulators; sleek, predatory elegance; deceptive.
- **Silhouette:** sharp stealth arrowhead with swept wings. **Symmetry:** bilateral.
  **Line:** sharp, swept.
- **Palette:** hull `#2a2440` dark indigo, trim `#7a5cff` violet; **glow** `#d24bff`
  magenta spine.
- **Drives:** single concealed drive, magenta. **Plating:** smooth dark composite.
  **Greeble:** minimal. **Material:** light-drinking matte. **Naming:** *Whisper /
  Cipher / Velvet*.
- **Concept:** `illumaria.svg`.

### 5.5 Astryn'Vel — *Rebels · Freedom Through Defiance*
- **Feel:** scrappy guerrilla freedom-fighters; fast, mismatched, defiant.
- **Silhouette:** strike fighter with swept wings, **slightly asymmetric**; patch
  panels. **Line:** aggressive, improvised.
- **Palette:** hull `#5c6645` olive-drab, trim `#d7822e` rebel-orange; **glow**
  `#9be84a` green.
- **Drives:** twin small engines. **Plating:** mismatched panels, painted stripe.
  **Greeble:** moderate (wingtip cannons, patches). **Material:** scavenged composite.
  **Naming:** *Freehold / Defiant / Emberkin*.
- **Concept:** `astryn-vel.svg`.

### 5.6 Ezrathi — *Cultists · Void Reverence*
- **Feel:** void-worshipping cult; monolithic, ritualistic, ominous.
- **Silhouette:** angular obsidian hull with sharp asymmetric blades + floating
  monolith shards; glowing rune-core. **Symmetry:** ritual-asymmetric. **Line:** sharp.
- **Palette:** hull `#1a1622` obsidian, trim `#6b3fa0` violet; **glow** `#8cff6b`
  void-green (with violet drive).
- **Drives:** arcane core, violet. **Plating:** smooth black stone. **Greeble:** ritual
  sigils, monolith fragments. **Material:** dark monolith. **Naming:** *Threnody /
  Sablerite / Hollow Choir*.
- **Concept:** `ezrathi.svg`.

### 5.7 Kri'thul — *Plague · Inevitable Corruption*
- **Feel:** apocalyptic blight; grown-diseased biomechanical horror.
- **Silhouette:** bulbous **asymmetric** infected pod with trailing tendrils. **Line:**
  organic, irregular.
- **Palette:** hull `#6f7a2e` sickly green, trim `#9fae3e` necrotic; **glow** `#c6ff3a`
  toxic-green pustules.
- **Drives:** organic spore-vents. **Plating:** infected, lumpen, veined. **Greeble:**
  heavy (pustules, tendrils, growths). **Material:** diseased chitin. **Naming:**
  *Rotmaw / Blightspawn / Wail*.
- **Concept:** `krithul.svg`.

### 5.8 Shadur'kai — *Rogue · Shadowed Autonomy*
- **Feel:** covert-justice operatives; clean knife-edge stealth (the "righteous"
  mirror of Illumaria).
- **Silhouette:** long knife/dagger fuselage with swept tail fins. **Symmetry:**
  bilateral. **Line:** clean, sharp.
- **Palette:** hull `#16202e` blue-black, trim `#3aa0b5` steel-cyan; **glow** `#37e6ff`
  cold cyan edges.
- **Drives:** single low-signature drive, cyan. **Plating:** smooth dark with glowing
  edge-lines. **Greeble:** minimal. **Material:** stealth composite. **Naming:**
  *Veil / Edict / Nightglass*.
- **Concept:** `shadur-kai.svg`.

> **Per-faction fleets (next step, once silhouettes are approved):** each faction gets
> 3–5 ships mapped to roles (`miner`, `combat`, hero) built from the shared kit under
> its palette — e.g. a Consortium `meridian-prospector` (miner) and `aegis-escort`
> (combat), a Terra Nexum `prospector-rig` and `ironside-gunship`, etc.

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

## 8. Approval & next steps

The §5 roster + the concept sheet (`assets/concept-art/concept-sheet.png`) are a
**first pass for your approval.** Feedback I'd find useful per faction:

1. **Silhouette** — does each shape read as the faction's identity? Any that should be
   re-thought (e.g. want Consortium more/less "classic," Kri'thul more grotesque)?
2. **Palette** — colors right, or shift any (e.g. Ezrathi greener vs. more violet)?
3. **Relationship graph** (§2.3) — did I read the rivalries correctly?

Once silhouettes are approved, the next deliverable is **per-faction fleets** (3–5
ships each mapped to roles), built from the shared kit so each faction stays
on-language, plus original **faction insignia**.

Hand me the faction list and I'll produce a filled design-language entry + kit recipe
for each, ready for SVG authoring.
