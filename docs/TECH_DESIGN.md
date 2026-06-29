# Technical Design Document — Working Title: **Stellar Frontier**

> A long-running, browser-based sci-fi MMO. Colonize asteroids, mine resources, and
> build a fleet of starships you dispatch on missions across highly detailed solar
> systems — then zoom all the way out to a galaxy of thousands of stars.

**Status:** Draft v1 · **Owner:** TBD · **Last updated:** 2026-06-28

---

## 1. Executive Summary

Stellar Frontier is a persistent, top-down, 2D sci-fi MMO inspired by the
aesthetics and fiction of *Star Trek* and *Star Wars*. The world simulates
continuously — mining accrues, fleets travel, and colonies grow whether or not
a player is online — which makes it a **long-running** game rather than a
session-based one.

This document recommends a concrete technology stack and architecture. The
headline decisions:

| Concern | Recommendation |
| --- | --- |
| **Rendering** | **PixiJS v8** (WebGL2 default, WebGPU progressive enhancement) with an SVG-to-GPU-texture pipeline. HTML/CSS/SVG for HUD/UI. |
| **Client framework** | TypeScript + Vite. Thin React/Preact layer for menus/HUD; PixiJS owns the game canvas. |
| **Real-time transport** | WebSockets for live play; REST/HTTP for async actions and bootstrapping. |
| **Backend** | Node.js (TypeScript) — stateless edge/gateway + stateful, sharded simulation workers. |
| **Hosting** | **Fly.io** Machines (Firecracker microVMs) — *non-negotiable, org standard*. |
| **Persistence** | Start: SQLite + LiteFS (mirrors the reference repo). Target at scale: Fly **Managed Postgres** + **Redis** for pub/sub & presence. |
| **Identity & social** | **Discord** OAuth2 login + bot + (later) Embedded App SDK Activity — *non-negotiable, org standard*. |
| **Content pipeline** | Data-driven, parametric **SVG** ships and stations so we can ship new starships continuously without engine changes. |

These choices deliberately mirror the proven setup in the reference project,
[`RubenTipparach/high-frontier-fan-game`](https://github.com/RubenTipparach/high-frontier-fan-game)
(Express + SQLite + `ws` on a single Fly.io machine, static frontend, parametric
SVG spacecraft), and extend it to MMO scale.

---

## 2. Design Goals & Constraints

### 2.1 Hard constraints (organizational, non-negotiable)
- **Fly.io** for all hosting/compute/storage.
- **Discord** for identity and community integration.
- **JavaScript/TypeScript** end-to-end (single language across client & server).
- **SVG-first art** that renders crisply across a *massive* variety of devices —
  phones, tablets, laptops, desktops, high-DPI ("Retina") and low-end alike.

### 2.2 Product goals
- **Two seamless scales of play:**
  1. *System view* — a single, highly detailed solar system (planets, asteroid
     belts, stations, ships, orbital motion).
  2. *Galaxy view* — thousands of stars in a small slice of the galaxy, with the
     ability to expand the galaxy later.
- **Top-down 2D** presentation throughout.
- **One shared universe ("single server").** All players inhabit the same galaxy —
  no parallel realms or per-lobby world copies. Load is offloaded by *partitioning
  the simulation work* across machines and by *distributing new players across
  capped starting systems*, never by forking the world. (See §7.1–7.3.)
- **Continuous, persistent simulation** — the world advances in real time.
- **Frequent content drops** — new starships added regularly, ideally as pure
  data + art with no code deploys required.

### 2.3 Engineering goals
- Render smoothly at 60 fps on a mid-range phone while displaying thousands of
  on-screen objects in galaxy view.
- Server-authoritative to resist cheating (an MMO economy demands it).
- Horizontally scalable simulation (shard by galaxy sector / solar system).
- Cheap to operate early; clear, incremental path to scale.

---

## 3. Game Vision (Pillars That Drive the Tech)

These pillars matter because each one pushes on the architecture:

1. **Colonize asteroids** → many small, persistent, owned entities per system;
   needs a robust per-entity state store and ownership/permissions model.
2. **Mine resources** → time-based accrual that must tick even while offline →
   server-side persistent simulation + an event/job scheduler.
3. **Build a fleet** → extensible, data-driven ship definitions and a ship-builder.
4. **Send ships on missions** → long-running asynchronous "jobs" (travel, mine,
   patrol, combat) resolved server-side, surfaced via UI *and* Discord.
5. **Zoom from one asteroid to the whole galaxy** → multi-scale rendering with
   level-of-detail (LOD) and floating-origin coordinates.

The genre is closer to a **slow-burn 4X / strategy MMO** than a twitch shooter.
That is a gift architecturally: the simulation is latency-tolerant, so we can use
a tick-based authoritative server with delta sync instead of sub-frame netcode.

---

## 4. Rendering Engine — The Central Decision

The brief is "render SVGs really well on a massive variety of devices" **and**
"thousands of stars." Those two requirements pull in opposite directions, so this
section is deliberately detailed.

### 4.1 Why not "just use SVG in the DOM"?

Native DOM `<svg>` gives perfect crispness for free, but it does **not** scale:

- Each SVG node is a DOM element. A few hundred animated nodes is fine; **thousands
  of moving stars/ships will tank the main thread** as the browser recomputes
  layout, style, and paint every frame.
- No access to GPU shaders for glows, nebulae, additive blending, or post-effects.
- Pan/zoom of huge SVG scenes triggers expensive re-rasterization in the browser's
  compositor.

DOM SVG is the *right* tool for **UI/HUD** (menus, panels, tooltips, fleet lists,
icons) — and we will use it there — but not for the live game world.

### 4.2 Recommendation: **PixiJS v8**, with an SVG → GPU-texture pipeline

[PixiJS](https://pixijs.com/) is a focused, best-in-class **2D WebGL/WebGPU
renderer**. Independent benchmarks repeatedly put it at or near the top for raw 2D
sprite throughput, and it is ~2–3× smaller than full game frameworks. PixiJS v8
adds a **WebGPU backend** while keeping a battle-tested **WebGL2** path, so we get
cutting-edge performance where available and universal compatibility everywhere
else. (Pixi recommends WebGL as the *default* for production today and treats
WebGPU as progressive enhancement — exactly our stance.)

**How we keep SVG crispness while getting GPU performance:**

PixiJS can load an SVG asset and **rasterize it to a GPU texture at a chosen
resolution**. We exploit this:

1. **Author all in-world art as SVG** (ships, stations, asteroids, planet glyphs,
   UI icons). One source of truth, infinitely scalable vectors.
2. At load/spawn time, **rasterize each SVG to a texture sized for the current
   device pixel ratio (DPR)** and the object's likely on-screen size. This makes
   art razor-sharp on a 3× phone display and lightweight on a low-end laptop.
3. Use **texture-LOD / re-rasterization**: when the player zooms in far enough that
   a ship would look soft, re-rasterize that SVG at a higher resolution on the fly;
   when zoomed out, use a low-res or simplified glyph. Cache by `(asset, resBucket)`.
4. Use **`Graphics`** (Pixi's retained-mode vector API) for procedural shapes —
   orbit rings, selection highlights, mining lasers, trajectory lines — which stay
   resolution-independent without any texture at all.

This gives us the best of both worlds: **vector-quality art that adapts to any
screen, rendered through the GPU so thousands of objects stay at 60 fps.**

### 4.3 Rendering thousands of stars (galaxy view)

Galaxy view is a different rendering regime from system view:

- Render stars via Pixi's **`ParticleContainer`** (batched, single draw call for
  tens of thousands of point sprites) rather than individual `Sprite` objects.
- **Viewport culling**: only build/update objects intersecting the camera's visible
  rectangle. Combined with a spatial index this keeps per-frame work bounded by
  what's on screen, not by total world size.
- **Level of Detail (LOD)** by zoom:
  - *Far out:* stars are colored glow points; no labels. (Showing everything at
    once is just a blob, so we cull/aggregate.)
  - *Mid:* show notable stars, faction territory tints, trade-route lines.
  - *Close:* show star names, system summaries, ownership rings; clicking enters
    System view.
- **Spatial index (quadtree or uniform grid)** over star positions for O(log n)
  hit-testing ("which star is under the cursor?") and fast range queries for
  culling and "nearest star" mechanics.

### 4.4 Multi-scale world & coordinate precision

A galaxy spanning thousands of stars exceeds the precision of 32-bit floats used by
GPUs. We handle this with:

- **Floating-origin / camera-relative coordinates**: the renderer works in
  coordinates relative to the camera (or the current sector), so on-screen geometry
  always uses small, precise numbers. World positions are stored server-side in a
  higher-precision integer/double space.
- **Nested coordinate frames**: Galaxy → Sector → System → local. Entering a system
  rebases the origin to that system's center.
- **A single, continuous "scale-space" camera** so zooming from one asteroid out to
  the galaxy is a smooth animated transition, swapping LOD tiers and (optionally)
  cross-fading between the System and Galaxy scene graphs at a threshold zoom.

### 4.5 Engines considered (and why not)

| Engine | Verdict |
| --- | --- |
| **PixiJS v8** | ✅ **Chosen.** Fastest pure 2D renderer, small footprint, first-class SVG-to-texture + Graphics, WebGL2 + WebGPU, huge ecosystem. |
| **Phaser** | A full *game framework* (physics, scenes, input, audio) built on a Pixi-like renderer. Great for self-contained arcade games, but we want a custom, server-authoritative MMO; Phaser's built-ins add weight we'd largely bypass. We can borrow specific ideas, not adopt the framework. |
| **Three.js / Babylon.js** | 3D-first; overkill and heavier for a top-down 2D game. Keep in pocket *only* for optional volumetric nebula/starfield backdrops via a shader layer. |
| **Two.js / SVG.js / Konva** | Lovely vector APIs but canvas/DOM-bound; they do not hit the thousands-of-objects performance bar. Good inspiration for the UI layer only. |
| **Raw Canvas2D / DOM** | Fine for HUD; insufficient for the live world. |

### 4.6 UI / HUD layer

- **HTML + CSS + (DOM) SVG**, driven by a lightweight **React or Preact** layer,
  rendered *over* the Pixi canvas. This is where DOM SVG shines: crisp, accessible,
  responsive icons and panels with zero canvas cost.
- Game canvas (Pixi) and UI (DOM) communicate through a small typed event bus /
  shared store, never by reaching into each other's internals.

---

## 5. Client Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Browser (TypeScript, Vite build)                          │
│                                                            │
│  ┌────────────────────┐      ┌──────────────────────────┐ │
│  │ UI layer (React/    │      │ Game layer (PixiJS)      │ │
│  │ Preact + DOM SVG)   │◄────►│  • Galaxy scene          │ │
│  │  • HUD, menus       │ event│  • System scene          │ │
│  │  • Fleet/colony mgmt│  bus │  • Camera (scale-space)  │ │
│  │  • Ship builder     │      │  • LOD + culling         │ │
│  └────────────────────┘      │  • SVG→texture cache     │ │
│            ▲                  └──────────────────────────┘ │
│            │                            ▲                   │
│  ┌─────────┴────────────────────────────┴────────────────┐ │
│  │ Net layer: WS client (live deltas) + REST client (async)│ │
│  │ Client-side prediction-lite + reconciliation            │ │
│  │ Local world cache / interest set                        │ │
│  └─────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────┘
```

- **State:** a normalized client store (e.g. Zustand/Valtio or a hand-rolled store)
  holds the player's *interest set* — the systems/entities currently relevant.
- **Prediction:** because the game is slow, we use light optimistic UI (show a
  queued order immediately, reconcile on server ack) rather than full rollback
  netcode.
- **Asset loading:** Pixi `Assets` with a manifest; SVGs lazy-loaded per system on
  demand; aggressive texture caching keyed by resolution bucket.
- **Offline/again:** on reconnect, fetch a snapshot of the interest set, then
  resume the delta stream.

---

## 6. Networking & Real-Time Architecture

### 6.1 Transport
- **WebSockets** (`ws` on the server) for the live delta stream and chat — proven in
  the reference repo and well-supported by Fly.io's proxy.
- **HTTP/REST** for login, bootstrap snapshots, async order submission, and
  anything cacheable.
- Message framing: compact JSON to start; **upgrade hot paths to binary**
  (MessagePack or a small custom schema) once the protocol stabilizes.

### 6.2 Authority & simulation model
- **Server-authoritative.** Clients send *intents* ("send fleet 7 to asteroid X",
  "build module Y"); the server validates, simulates, and broadcasts results. This
  is mandatory for a persistent economy.
- **Tick-based simulation** per shard (e.g. 1–10 Hz for live systems; far slower or
  event-driven for dormant ones). Long actions are modeled as **scheduled jobs** with
  deterministic completion times, so they resolve correctly even if no one is
  watching. Job types at launch:
  - **In-system travel** — completes in ~seconds.
  - **Interstellar travel** — completes in ~minutes (see [`GAME_DESIGN.md`](GAME_DESIGN.md) §5).
  - **Mining** — accrues ore/crystal/gas into a ship's cargo at `miningRate`, capped
    by `cargo` (GDD §2).
  - **Construction** — building ships/structures at a base.
  - **Combat** — resolved by the deterministic resolver (§6.4).
- **Continuous world:** a background scheduler advances resource accrual, ship
  arrivals, and construction even while players are offline ("catch-up" computed
  from elapsed time on next load, plus periodic ticks for active systems).

### 6.3 Interest management (the key MMO scaling lever)
- A client only subscribes to the **system(s) it is viewing** plus lightweight
  galaxy-level summaries. The server streams deltas only for that area-of-interest.
- This bounds per-client bandwidth and per-server fan-out by *locality*, not by
  total world size — essential for "thousands of stars."

### 6.4 Deterministic combat resolver & replay

Combat is **fully deterministic from ship stats** (design in [`GAME_DESIGN.md`](GAME_DESIGN.md) §4).
That property is an architectural gift:

- **Pure-function resolver:** `resolveCombat(sideA, sideB, rulesetVersion, seedId) →
  { outcome, log }`. No hidden state; given the same inputs it always returns the same
  result. Every battle is stamped with a **GUID `seedId`** (a large unique id) that is
  recorded with the battle and seeds any variance/tie-breaks — so results stay fully
  reproducible and analyzable. Fleet targeting is **focus-fire weakest** (lowest
  effective HP first), ties broken by the seed (see [`GAME_DESIGN.md`](GAME_DESIGN.md) §4.3).
- **Instant server-side resolution:** the server computes the entire battle in one
  shot (max **100 rounds**, early-out on a destruction) rather than simulating it over
  real time. Cheap, cheat-proof, and easy to reason about.
- **Replay, not re-simulation on the client:** the resolver emits a compact
  **round-by-round event log** (orderings, hits, damage, shield/hull after each step,
  destructions). The client *animates the log* in the system view so players can watch
  *how* the outcome was decided — the client never needs the combat math.
- **Storage & audit:** persist the **inputs + `rulesetVersion` + `seedId`** (small,
  lets us re-derive any battle for balance analysis or dispute resolution) plus the
  resolved log for fast playback. Old replays stay faithful because each battle records
  the `rulesetVersion` it was resolved under (balance changes are versioned — §9.3).
- **Balance tooling:** because it's a pure function, we can batch-simulate matchups
  offline (parameter sweeps over `agility`/`range`/`missiles`/`countermeasures`/
  `shieldRegen`) to find dominant builds before shipping content.

---

## 7. Backend Architecture (on Fly.io)

Fly Machines are fast-booting Firecracker microVMs well-suited to long-running,
stateful, WebSocket workloads with global routing. We use them in two tiers:

```
                 Internet
                    │
            Fly Anycast + fly-proxy (TLS, routing)
                    │
        ┌───────────┴───────────┐
        │   Gateway / Edge       │   (stateless, scale horizontally)
        │   • Discord OAuth      │
        │   • WS termination     │
        │   • Auth & rate limit  │
        │   • Route to shard     │
        └───────────┬───────────┘
                    │ internal (WireGuard/6PN) + Redis pub/sub
        ┌───────────┴────────────────────────────┐
        │  Simulation Workers (stateful, sharded) │
        │  • Each owns N solar systems / a sector │
        │  • In-memory hot state + tick loop      │
        │  • Job scheduler (travel/mine/build)    │
        │  • Periodic checkpoint to durable store │
        └───────────┬────────────────────────────┘
                    │
        ┌───────────┴───────────┐        ┌──────────────┐
        │ Durable store          │        │ Redis (Upstash│
        │ Phase 1: SQLite+LiteFS │        │ on Fly)       │
        │ Phase 2: Managed PG    │        │ presence,     │
        │ (accounts, world state)│        │ pub/sub, cache│
        └────────────────────────┘        └──────────────┘
```

### 7.1 One universe, transparently partitioned

**Design rule: there is exactly one shared universe. All players are on "one
server."** This is a core product decision — no parallel realms, no per-lobby
copies of the world, no "which server are you on?" Every player inhabits the same
galaxy, sees the same systems, and can interact with anyone else.

"Sharding," here, never means splitting the *universe*. It means transparently
splitting the *work* of simulating that one universe across machines:

- The galaxy is partitioned into **sectors**; each simulation worker owns a set of
  sectors/systems. There is still only **one canonical copy of every system** — a
  sector is simply assigned to exactly one worker at a time. This is how we scale
  horizontally: add machines, (re)assign sectors. **Players never perceive the
  seams** — the gateway routes their connection to whichever worker owns the system
  they're looking at.
- Cross-worker interactions (a fleet traveling from sector A to B, a cross-system
  message) are handled by **handoff messages** over Redis pub/sub or direct internal
  calls — bounded and infrequent because most action is local to a system.
- Start with **one worker, one region** (the game is latency-tolerant). Because it's
  one universe regardless of worker count, we can split sectors out to new workers
  *later* with no migration of the player's mental model — purely an ops change.

### 7.2 Load offloading via starting-system capacity (the key population lever)

A single shared universe has one classic failure mode: **everyone piles into the
same place.** That's both a load hotspot (one worker melts) *and* a gameplay problem
(no room left to colonize). We solve both with **spawn distribution and soft
per-system caps** — the approach raised in design discussion, formalized here.

- **Curated starting systems.** Maintain a pool of entry-point systems spread across
  many sectors (and therefore across many workers). New players don't choose freely;
  they're **assigned to a starting system that still has capacity**.
- **Soft population cap per starting system.** Each start system has a target
  capacity (e.g. *N* active colonizing players). When it fills, new arrivals route to
  the next start system with room. The cap is a tuning knob, set from measured
  per-worker cost, not guessed.
- **Why this offloads the server:** start-system population is the single biggest
  driver of "hot" simulation cost (active colonies, mining ticks, ships, live
  viewers). Capping players-per-start-system therefore **directly bounds the load on
  the hottest workers** and spreads new population evenly across sectors/machines —
  all while keeping one universe.
- **Freedom preserved.** Caps gate *spawning*, not *movement*. Players can still
  travel, expand, and settle anywhere in the one universe; we only steer where they
  *begin* so the early-game load (and land grab) stays balanced.
- **Capacity reclamation.** Inactive/abandoned starts free capacity over time
  (decay/abandonment rules), so popular start systems keep accepting newcomers as
  veterans push outward into frontier sectors.

> **Open knob (Phase 1):** the per-start-system cap *N* and the number of start
> systems. We'll derive both from the Phase 0/1 load test (cost per active player per
> worker), not pick them upfront.

### 7.3 Handling hotspots that form anyway

Even with balanced spawns, players cluster around desirable or contested systems.
We plan for it:

- **Sector rebalancing:** reassign a busy sector to a less-loaded worker (the
  handoff machinery from §7.1 already supports moving sectors between workers).
- **Sector splitting:** if a single sector gets too hot, subdivide it so its systems
  spread across more workers.
- **Soft caps on concurrent *viewers/combatants* per system**, with overflow handled
  gracefully (queue, spectate, or instanced sub-encounters for large battles) so one
  mega-fight can't stall the worker for everyone else in its sector.
- **Always one universe:** every technique above is an internal load move; none of
  them forks the world or splits the playerbase.

### 7.4 Persistence — phased
- **Phase 1 (MVP, mirrors reference repo):** SQLite, optionally **LiteFS** for
  replication/backup, on a Fly **Volume**. Simple, cheap, fast for a single worker.
- **Phase 2 (scale):** **Fly Managed Postgres** for accounts + durable world state
  (it handles HA, failover, backups), with the sim keeping **hot state in memory**
  and checkpointing. Postgres handles concurrent writers far better than SQLite once
  many players share systems.
- **Redis** (Fly/Upstash) throughout for presence, pub/sub between machines,
  ephemeral locks, leaderboards, and rate limiting.
- **Galaxy generation:** the star map is **procedurally generated from a seed** and
  stored once; this keeps "thousands of stars" tiny on disk (seed + deltas) and
  makes "expand the galaxy later" a matter of generating new seeded sectors.

### 7.5 Deployment & CI/CD (follow the reference repo)
- **GitHub Actions** → deploy backend to Fly.io via `FLY_API_TOKEN`.
- **Static client** can deploy to GitHub Pages (per the reference) or be served by a
  Fly static/edge app; client points at the API via a configurable base URL
  (the reference uses a `<meta name="...-api-base">` tag — we'll use an env-injected
  config).
- **`fly.toml`** per service (gateway, worker), with health checks, a Volume for the
  Phase-1 DB, and `auto_stop_machines`/`min_machines_running` tuned so idle workers
  scale down but the persistent world stays available.

---

## 8. Discord Integration

Discord is both our **identity provider** and our **community surface**.

### 8.1 Authentication (primary login)
- **Discord OAuth2** with the `identify` (and optionally `guilds`) scope is the
  primary — likely *only* — login. No separate password system to build or secure.
- Flow: client → Discord authorize → redirect with `code` → gateway exchanges for
  token using `client_id`/`client_secret` (**server-side only, never in the
  client**) → we mint our own session JWT. Library: `discord-oauth2` or `discord.js`
  helpers.

### 8.2 Bot (community + play-by-Discord)
- A **`discord.js`** bot using **slash commands** (Discord's 2026-recommended
  approach) for:
  - Status queries: `/fleet`, `/colony`, `/missions`.
  - Notifications: mission complete, colony under attack, construction finished —
    pushed via DM or channel webhooks.
  - Light async actions queued from chat (recall a fleet, etc.).
- **Guilds = Alliances:** map a Discord server/role to an in-game alliance for
  shared territory and chat. Server feeds via **webhooks**.

### 8.3 Discord Activity (Phase 2, high-value)
- Ship the game as a **Discord Activity** via the **Embedded App SDK**, so players
  can launch Stellar Frontier directly inside a Discord voice channel and play
  together. This is a natural distribution channel for a social MMO and aligns
  perfectly with the "Discord is core" mandate. Defer until the web build is solid.

> **Security note:** Discord client secret and bot token live only in Fly secrets
> (`fly secrets set`), never in the repo or client bundle.

---

## 9. Starship System (Built for Continuous Content)

"Adding new starships regularly" is a first-class requirement, so ships must be
**data, not code.**

### 9.1 Data-driven ship definitions
- Each ship/hull is a JSON (DB-backed) record. Stats are split into shared,
  mining, and combat groups so a `role` is just a stat profile (see
  [`GAME_DESIGN.md`](GAME_DESIGN.md) §3):
  ```jsonc
  {
    "id": "concord-prospector",
    "faction": "concord-explorers",        // see FACTIONS_AND_ART.md
    "role": "miner",                       // miner | combat | (scout|hauler|… later)
    "art": "ships/concord/prospector.svg", // or { "generator": {…params…} }
    "palette": { "hull": "--hull", "trim": "--trim",
                 "glow": "--glow", "accent": "--accent" }, // faction color tokens
    "slots": { "weapon": 0, "engine": 1, "utility": 3 },
    "shared":  { "hullHp": 600, "shieldHp": 200, "shieldRegen": 10,
                 "speed": 12, "cargo": 1200 },
    "mining":  { "miningRate": 40 },       // units/sec on a node (ore/crystal/gas)
    "combat":  { "agility": 3, "range": 1, "missiles": 0, "countermeasures": 1 },
    "tags": ["economy", "fragile"],
    "unlock": { "faction": "concord-explorers", "repTier": "friendly" }
  }
  ```
  A combat ship inverts the profile: high `agility`/`range`/`missiles`/
  `countermeasures`, low `miningRate`. Combat stats (`agility`, `range`, `missiles`,
  `countermeasures`, `shieldRegen`) are the parameters the deterministic resolver
  (§6.4) consumes and that we balance against each other.
- A **module/component system** fills slots (weapons, engines, mining rigs, scanners)
  with their own data records that add/modify stats, so fleet-building is composition
  over data.
- Adding a ship = add a JSON record + an SVG (or generator params). **No engine
  changes, ideally no deploy** (load from DB / content service).

### 9.2 Parametric SVG art pipeline
- Follow the reference repo's pattern (`generate-background-rockets.mjs`): a
  **parametric SVG generator** produces visual variety (hull shape, wings, engine
  count, faction palette) from parameters. This lets art keep pace with frequent
  ship drops and gives factions a coherent visual language.
- Hand-authored "hero" SVGs for flagship designs; generated SVGs for the long tail.
- All ship SVGs flow through the §4.2 rasterization/LOD pipeline.

### 9.3 Balance & versioning
- Ship/module stats are versioned content; balance changes are data migrations, not
  code releases. Keep a content schema + validation step in CI.

---

## 10. Consolidated Tech Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Language | **TypeScript** (client + server) | One language, shared types/protocol. |
| Client build | **Vite** | Fast dev, modern bundling. |
| Rendering | **PixiJS v8** (WebGL2 default, WebGPU opt-in) | SVG→texture + Graphics; ParticleContainer for stars. |
| UI/HUD | **React or Preact + DOM SVG + CSS** | Over-canvas overlay. |
| Spatial | Quadtree / uniform grid | Culling, picking, range queries. |
| Realtime | **WebSocket (`ws`)** | Live deltas + chat. |
| Async API | **HTTP/REST** (Express or Fastify) | Auth, snapshots, orders. |
| Server runtime | **Node.js (TypeScript)** | Gateway + sim workers. |
| Hosting | **Fly.io Machines + Volumes** | Org standard (non-negotiable). |
| DB (MVP) | **SQLite + LiteFS** | Mirrors reference repo. |
| DB (scale) | **Fly Managed Postgres** | Concurrent writers, HA. |
| Cache/pubsub | **Redis (Upstash on Fly)** | Presence, sharding, rate limit. |
| Identity | **Discord OAuth2** | Org standard (non-negotiable). |
| Community/bot | **discord.js** (slash commands, webhooks) | Notifications, alliances. |
| Embed (later) | **Discord Embedded App SDK** | Play inside Discord. |
| CI/CD | **GitHub Actions → Fly.io** | Per reference repo. |
| Content | Data-driven JSON + parametric SVG | Continuous ship drops. |

---

## 11. Proposed Repository Layout

```
/
├── client/                 # Vite + TS + PixiJS + React/Preact
│   ├── src/
│   │   ├── render/         # Pixi scenes, camera, LOD, svg-texture cache
│   │   ├── ui/             # React/Preact HUD, ship builder, panels
│   │   ├── net/            # ws + rest clients, interest set
│   │   └── state/          # client store
│   └── assets/             # SVG ships/stations/icons
├── server/
│   ├── gateway/            # auth (Discord OAuth), ws termination, routing
│   ├── sim/                # sharded simulation workers, tick loop, jobs
│   ├── shared/             # protocol types, validation (shared w/ client)
│   └── db/                 # migrations, repositories (sqlite→pg)
├── bot/                    # discord.js bot (slash commands, webhooks)
├── content/                # ship/module JSON, parametric SVG generators
│   └── scripts/            # generate-ships.mjs (parametric SVG)
├── infra/                  # fly.toml(s), Dockerfiles, deploy workflows
├── docs/                   # this document + design notes
└── .github/workflows/      # CI/CD → Fly.io
```

---

## 12. Phased Roadmap

**Phase 0 — Spike (prove the renderer).**
PixiJS app that loads SVG ships, rasterizes at DPR, renders a system with orbiting
asteroids + a galaxy view of 10k particle stars with LOD/culling and smooth
scale-space zoom. Validate 60 fps on a mid-range phone. *This de-risks the central
bet.*

**Phase 1 — Vertical slice (single shard).**
Discord login; one solar system; colonize an asteroid; mine a resource that accrues
over time; build one ship; send it on a timed mission. Server-authoritative,
SQLite+LiteFS on one Fly Machine. WebSocket deltas. Deploy via GitHub Actions.

**Phase 2 — MMO foundations.**
Multiple systems + galaxy map; interest management; sharded sim workers; Redis
pub/sub; migrate durable state to Managed Postgres; alliances via Discord guilds;
bot notifications and slash commands.

**Phase 3 — Depth & reach.**
Combat, deeper economy, tech tree, more ship classes; content pipeline for weekly
ship drops; Discord Activity (Embedded SDK); galaxy expansion (new seeded sectors);
binary protocol on hot paths; observability and anti-cheat hardening.

---

## 13. Key Risks & Open Questions

| Risk | Mitigation |
| --- | --- |
| SVG-at-many-resolutions memory bloat | Resolution-bucket cache + eviction; cap rasterization levels; simplify glyphs at distance. |
| 32-bit float precision over galaxy scale | Floating-origin + nested coordinate frames (§4.4). |
| WebGPU browser inconsistency | Default to WebGL2; treat WebGPU as opt-in enhancement. |
| SQLite write contention as players cluster | Phase to Managed Postgres; keep hot state in memory and checkpoint. |
| Sim scaling / cross-shard handoffs | Locality-first design; sector sharding; bounded handoff messages. |
| Continuous-world fairness while offline | Deterministic job scheduling + elapsed-time catch-up. |
| Single-region latency for distant players | Game is latency-tolerant; add regional gateways before regional sim. |

**Open questions for the team:**
1. Real-time *combat* — fully async (resolve on a tick) or short live encounters?
   This decides how tight the netcode must be.
2. Per-start-system soft cap *N* and number of starting systems (§7.2) — derive from
   the Phase 0/1 load test (cost per active player per worker); also sets the
   SQLite→PG timing.
3. Monetization/scope (affects content cadence and infra budget).
4. How "expandable" must the galaxy be day one — fixed seed vs. dynamically grown
   sectors?

---

## 14. References

- Reference infrastructure project: [`RubenTipparach/high-frontier-fan-game`](https://github.com/RubenTipparach/high-frontier-fan-game) — Express + SQLite + `ws`, single Fly.io machine, parametric SVG spacecraft, GitHub Actions → Fly.io / GitHub Pages.
- PixiJS v8 launch & renderers: <https://pixijs.com/blog/pixi-v8-launches> · <https://pixijs.com/8.x/guides/components/renderers>
- JS rendering/game-engine benchmark: <https://github.com/Shirajuki/js-game-rendering-benchmark>
- Phaser vs PixiJS comparison (2026): <https://generalistprogrammer.com/comparisons/phaser-vs-pixijs>
- Large-scale point rendering (LOD/culling): <https://medium.com/@sourabh.siddhu/how-i-visualized-100-000-data-points-without-crashing-the-browser-76199ff23463>
- WebGL galaxy map example: <https://benoitgirard.wordpress.com/2013/01/05/webgl-project-galaxy-map/>
- Fly.io Machines, Volumes, Managed Postgres, LiteFS: <https://fly.io/docs/volumes/overview/> · <https://fly.io/docs/mpg/> · <https://fly.io/blog/how-we-built-fly-postgres/>
- Discord OAuth2: <https://discord.com/developers/docs/topics/oauth2> · discord.js guide: <https://discordjs.guide/>

---

*This is a living document. Update the decision table and roadmap as Phase 0/1
spikes return real performance numbers.*
