# CLAUDE.md — project guide

**Stellar Frontier** — a long-running, top-down, browser-based sci-fi MMO (Thallian
Nebula setting). This file orients work in the repo and records conventions worth
keeping. Design docs live in `docs/`:

- `docs/TECH_DESIGN.md` — engine (PixiJS), networking, Fly.io backend, single-universe
  sharding, Discord, persistence.
- `docs/GAME_DESIGN.md` — resources, mining, ship roles, deterministic combat, travel.
- `docs/FACTIONS_AND_ART.md` — factions, design languages, ship classes, sprite spec.
- `docs/source/` — source lore (Fallen Tribes / Council Archives).

## Art pipeline: procedural ships (Blender → sprites)

Ship art is **3D modeled procedurally in Blender** (the `bpy` Python module) and
**rendered with Cycles** to top-down sprite textures that PixiJS draws. Earlier
Three.js/WebGL and flat-SVG passes were abandoned — Blender/Cycles is the pipeline.

Scripts (`scripts/concept/`):
- `blender_clean.py` — the production modeler/renderer. Hand-built, deliberate
  hard-surface ships (one builder per faction). `ANGLES=24 python3
  scripts/concept/blender_clean.py [faction-id ...]` renders the 24-angle turnaround;
  default `ANGLES=1` renders just the hero 3/4 view for review.
- `make_sheet.mjs` / `make_turn.mjs` — compose comparison / turnaround PNGs
  (`PW_PATH="$(npm root -g)/playwright" node scripts/concept/make_sheet.mjs`).
- `blender_ships.py` — older random-greeble generator; produces messy hulls, kept only
  for reference. Prefer `blender_clean.py`.

Setup notes: `pip install bpy` (Blender as a module) and `npm install three` are used;
Cycles runs on CPU here (no GPU). Chromium for sheet compositing is the preinstalled
Playwright browser.

### Ship modeling rules (IMPORTANT — follow these)

Messy ships come from asymmetric parts straddling the centerline. The discipline:

1. **Orientation:** forward = `+Y` (nose), up = `+Z`, right = `+X`. The centerline is
   the plane `x = 0`.
2. **Build the main body from a profile, not stacked boxes.** The hull is the most
   important part and must read at a distance, so give it a **unique silhouette in all
   three views** (top, side, front). Use **`loft_hull(shape, stations, ...)`**: a
   cross-section `shape` (the FRONT profile) lofted along the length, with per-station
   `width` (the TOP profile) and `height`+`z_offset` (the SIDE profile). If all three
   silhouettes are non-rectangular, the ship type is identifiable from far away. Avoid
   plain boxes/discs for the core. Build a **symmetric core first** — `loft_hull` is
   symmetric by construction; other core pieces are **centered on `x = 0`** or added as
   **mirrored pairs** via `pair(lambda sx: ...)`. Major features (wings, nacelles,
   engines, fins) are mirrored pairs, never one-off asymmetric shapes.
3. **Add asymmetry only as detail that never crosses the centerline.** Any non-centered,
   non-mirrored shape must lie **entirely on one side** of `x = 0`. Wrap every such
   shape in **`offside(...)`**, which asserts/pushes the shape so its bounding box does
   not cross the midline. Never place a lone shape whose bounds span `x = 0`.
4. **Hard-surface look:** flat shading + a Bevel modifier (chamfered edges) for hull
   plates and boxes; smooth shading **only** on inherently round parts (cylindrical
   nacelles/tubes/discs). Avoid smooth ellipsoid "blobs" — they read as organic unless
   doing true subdiv/NURBS surfacing.
5. **Glow:** emissive materials for engines/windows/accents, colored by the faction's
   glow token.
6. **Proportion & stand-off.** Keep features modest — nacelles/pods should not rival
   the hull in size. Hold nacelles/wings **off the hull on visible pylon struts** (a
   clear gap), never flush against it.
7. **No painted accents as geometry.** Stripes, faction trim, and insignia are
   **textures/decals on the surface**, NOT stuck-on boxes. A flat colored box laid on
   the hull reads as a "random rectangle." Use geometry only for actual 3D structure;
   leave paint/markings to the material layer.

Result: a clean symmetric silhouette with a distinctive profile and believable
one-sided greeble — not random boxes stacked across the middle.

### Rendering & iteration (reliable workflow)

- **Run renders in the foreground with a hard timeout** (e.g. `timeout 220 python3 …`).
  Backgrounding multiple Blender runs causes CPU contention that looks like a hang.
- **Fast iteration knobs (env):** `SAMPLES` (Cycles samples, default 160; use ~48–110
  while iterating) and `RES` (pixels, default 768; use ~640–720). Crank both for finals.
- **Check the silhouette early:** `VIEWS=1 python3 scripts/concept/blender_clean.py
  <id>` renders **top / side / front / hero**; compose with the views sheet to confirm
  all three profiles are non-rectangular before adding detail.
- **Per-faction loop:** model → `VIEWS=1` hero+profiles → review/commit → only then add
  detail or render the full `ANGLES=24` turnaround. Commit each faction's render.

### Sprite spec

Top-down 3/4 view, **24 yaw angles per ship** (360 / 15°), fixed elevation. 6 ship
classes × 8 factions = 48 ships → **1,152 sprites** (before resolution/LOD variants).
See `docs/FACTIONS_AND_ART.md` §5b–5c.

## Client (vertical slice)

`client/` is a Vite + TypeScript + **PixiJS v8** app (client-only so far): the
solar-system view with 15 planets/moons/gas-giant nodes, a bottom fleet toolbar of 8
ships (the 24-angle Blender sprites in `client/public/sprites/`), click-to-move,
mining→HQ, and resource tags. Run: `cd client && npm install && npm run dev`. See
`client/README.md`. Renderer is WebGL by default (`?r=webgpu` to opt in); headless
software-GL can't init Pixi, so run it in a real browser.

## Git / workflow

- Develop on `claude/scifi-mmo-engine-research-e1h48o`; open draft PRs.
- `node_modules/` is gitignored; committed art lives in `assets/` (`concept-art/` =
  SVG attempts, `sprites/clean/` = current Blender renders).
