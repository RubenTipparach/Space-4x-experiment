# Stellar Frontier (working title)

A long-running, browser-based **sci-fi MMO** inspired by *Star Trek* and *Star Wars*.
Colonize asteroids, mine resources, and build a fleet of starships you send out on
missions — across highly detailed solar systems that you can zoom all the way out
from into a galaxy of thousands of stars.

The world is **persistent and always simulating**: mining accrues, fleets travel,
and colonies grow whether or not you're online. Presented **top-down in 2D**, with
new starships added on a regular cadence.

## Design

- 📄 **[docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)** — engine choice, rendering
  strategy, networking, backend, persistence, single-universe sharding, Discord, and
  the starship content pipeline.
- 📄 **[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)** — gameplay: resources (ore /
  crystal / gas), mining, ship roles, deterministic reviewable combat, travel, and
  the home-base core loop.

### Headline decisions

| Concern | Choice |
| --- | --- |
| Rendering | **PixiJS v8** (WebGL2 default, WebGPU opt-in) with an SVG → GPU-texture pipeline |
| UI / HUD | React/Preact + DOM SVG over the game canvas |
| Realtime | WebSockets (live deltas) + REST (async actions) |
| Backend | Node.js/TypeScript — stateless gateway + sharded, stateful simulation workers |
| Hosting | **Fly.io** (org standard) |
| Persistence | SQLite + LiteFS → Fly Managed Postgres + Redis at scale |
| Identity & community | **Discord** OAuth2 + bot + (later) Embedded App SDK (org standard) |
| Content | Data-driven, parametric SVG ships for continuous releases |

Infrastructure mirrors and extends the reference project
[`RubenTipparach/high-frontier-fan-game`](https://github.com/RubenTipparach/high-frontier-fan-game).

> Status: pre-implementation. See the design doc's roadmap for Phase 0 (renderer
> spike) onward.
