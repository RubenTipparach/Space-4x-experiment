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

### Normal-mapped sprite lighting (ships react to the star)

Ships are lit per-pixel in PixiJS (v8 `Mesh` + custom GLSL shader) so the sprite's lit
side follows the in-system star. Each yaw frame ships with a matching **camera-space
normal map**.

- **Render** (`scripts/concept/blender_normal.py`): `ANGLES=24 SAMPLES=48 RES=512 python3
  scripts/concept/blender_normal.py [id ...]` writes `client/public/sprites/nm/<id>_y###_n.png`
  for every 15° yaw — at the **same camera** as `blender_clean.frame(objs, yaw)`, so the
  normal maps register with the existing lit `<id>_y###.png` albedo sprites. Encoding:
  emit `VectorTransform(Geometry.Normal, world→camera) * 0.5 + 0.5` with the **Raw** view
  transform (literal bytes). `ANGLES=1` writes a single hero `<id>_albedo.png` + `<id>_n.png`
  for de-risk tests.
- **Decode** (shader): `n = (r, b, g) * 2 - 1` — the **G/B channel swap** is required
  (validated against the Three.js proof; don't drop it). Then `lit = 1 + strength*(dot(n, L) - bias)`
  *modulates* the already-shaded albedo (keeps baked detail, adds a directional term).
- **Light dir** = ship→star in screen space with `y` flipped (screen-y-down → shader
  y-up) and a small `+z` toward-viewer term; the sprite's residual spin is fed back as
  `uResid` to rotate the normals' XY so lighting stays correct between the 24 frames.
- De-risk harnesses (kept as references): `pixi_nm_test.mjs` (Pixi v8 can do it),
  `pixi_relight_test.mjs` (modulation on the real albedo), `nm_lighting.mjs` (Three.js
  proof). **Pixi v8 gotcha:** UBO uniforms need GLSL ES 3.00 — prefix shaders with
  `#version 300 es` or `Shader.from` compiles them as ES 1.00 and `in/out` fails. Also
  `Texture.from(urlString)` returns `undefined` in v8 (use `Assets.load`'s returned
  record; `Texture.from` only accepts canvas/Image/cached ids).

## Client (vertical slice)

`client/` is a Vite + TypeScript + **PixiJS v8** app (client-only so far): the
solar-system view with 15 planets/moons/gas-giant nodes, a bottom fleet toolbar of 8
ships (the 24-angle Blender sprites in `client/public/sprites/`), click-to-move,
mining→HQ, and resource tags. Run: `cd client && npm install && npm run dev`. See
`client/README.md`. Renderer is WebGL by default (`?r=webgpu` to opt in); headless
software-GL can't init Pixi, so run it in a real browser.

### Visual claims require a screenshot (IMPORTANT)

**Never claim anything about how the game/app looks unless a screenshot proves it.**
Build → serve → screenshot (recipe below) and actually look at the image before saying
"it renders / the ships show / the nebula looks X". Code that compiles is not evidence
of what's on screen. Attach the screenshot when reporting a visual result.

### Rendering game previews in the cloud (headless screenshots)

The client can be screenshotted headlessly here (no GPU) — useful for verifying the
slice from the sandbox:

1. Build + serve: `npm --prefix client run build && npm --prefix client run preview`
   (port 4173; start the preview with `run_in_background`, it must outlive the shell).
2. Screenshot: `PW_PATH="$(npm root -g)/playwright" node scripts/concept/screenshot_client.mjs`
   → writes `assets/sprites/slice.png`.

How it works / gotchas (all already handled in the code):
- Headless Chromium has no GPU, so the script forces **software GL** via
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox`.
  PixiJS v8 renders fine on SwiftShader.
- **Do NOT block boot on a bulk `Assets.load`** — that GPU-bound bulk decode hangs
  under SwiftShader (and stalled real browsers too). The client uses lazy
  `Texture.from(...)` so the scene/camera/HUD come up immediately; sprites stream in.
- The client sets **`window.__ready = true`** at the end of boot; the screenshot
  script waits on that before capturing. Keep that marker.
- Minimal `new Application().init(...)` works headless — if a screenshot comes back
  black, the bug is almost always app-side boot ordering (e.g. fitting the camera
  only *after* an awaited load), not the renderer.

## Git / workflow

- Develop on `claude/scifi-mmo-engine-research-e1h48o`; open draft PRs.
- `node_modules/` is gitignored; committed art lives in `assets/` (`concept-art/` =
  SVG attempts, `sprites/clean/` = current Blender renders).
