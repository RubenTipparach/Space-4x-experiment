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

### Ships are real-time 3D (glTF), not sprites

The earlier baked-sprite path (24-yaw PNGs, baked normal maps, Pixi) is **abandoned**:
pre-baked lighting always looked washed-out and could never match the live star. Ships
are now the actual Blender models, exported to glTF and lit live in Three.js.

- **Export** (`scripts/concept/export_glb.py`): `python3 scripts/concept/export_glb.py
  [id ...]` builds each ship via `blender_clean.BUILDERS` and writes
  `client/public/models/<id>.glb` (Principled BSDF + Emission materials and Bevel
  modifiers baked in; `export_yup` so Blender +Y nose → glTF −Z forward). Re-run after
  changing a ship model.
- The 24-angle sprite renderer (`blender_clean.py` `make`/`ANGLES`) is kept only for the
  fleet-toolbar thumbnails (`<id>_y000.png`); in-world ships use the GLB.

## Client (vertical slice) — 3D, Three.js

`client/` is a Vite + TypeScript + **Three.js** app (client-only so far): a true-3D
solar system on the XZ plane (sun at the origin lighting everything), 15 procedural
**shader planets** (`src/planet.ts`: terrain/water/ice, animated clouds, night-side city
lights, atmospheric rim; gas giants get turbulent bands + a storm + rings), an asteroid
belt (InstancedMesh), Keplerian comets (eccentric, tails point **away** from the sun),
real 3D glTF ships lit by the star, click-to-move/mine/recall (raycast), and the HTML HUD
(fleet bar, HQ stores). Camera is OrbitControls (drag-orbit, scroll-zoom). Run:
`cd client && npm install && npm run dev`.

Rendering notes:
- Metallic glTF materials read **black** without an environment — `RoomEnvironment` +
  `PMREMGenerator` set `scene.environment` so hulls catch light; the sun is a
  `PointLight` with `decay=0` so it reaches the whole system. `ACESFilmic` tone mapping.
- Planets self-shade in their shaders (sun direction = `normalize(-worldPos)`); they do
  **not** use Three lights, so they're unaffected by `scene.environment`.
- Watch module init order: functions hoist, but top-level/closure `const`s do not —
  don't call a builder (e.g. `buildToolbar`) before the HUD `const`s it closes over are
  declared (TDZ → "Cannot access X before initialization").

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
  Three.js (WebGLRenderer) + custom GLSL + glTF render fine on SwiftShader.
- The client sets **`window.__ready = true`** at the end of boot (after the glTF ships
  load); the screenshot script waits on that before capturing. Keep that marker.
- `window.__game = { ships, scene, camera, controls }` is exposed for tests. To aim a
  screenshot, set **`controls.target` *and* `camera.position`** — OrbitControls owns the
  orientation, so a bare `camera.lookAt()` gets overwritten each frame by `controls.update()`.
- If a screenshot is black, it's almost always app-side (a thrown error before
  `__ready`, or boot ordering), not the renderer.

## Git / workflow

- Develop on `claude/scifi-mmo-engine-research-e1h48o`; open draft PRs.
- `node_modules/` is gitignored; committed art lives in `assets/` (`concept-art/` =
  SVG attempts, `sprites/clean/` = current Blender renders).
