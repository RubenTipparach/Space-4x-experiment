# HQ city, docking & the galaxy map

Design + vertical-slice notes for three connected systems: **docking at HQ**, the
**HQ space-city screen**, and the **galactic (local-cluster) map**.

## 1. Docking

HQ is a station orbiting the home planet (Verdantia). A ship is **docked** when it is
idle at HQ; ships start docked.

- **State:** each ship has a `docked` flag. It becomes `true` when a ship finishes
  *returning* to HQ (or at game start), and `false` the moment it is given any order
  (move / mine). A docked ship contributes its cargo to HQ stores on arrival.
- **Hotbar marker:** docked ships show a small **HQ badge** on their fleet-bar tile so
  the player can see at a glance which ships are home.
- **Undock on order:** selecting a docked ship and clicking anywhere (empty space, a
  planet, a node) simply undocks it — it leaves HQ and flies to the target using the
  normal flight model. No explicit "undock" button needed.
- Docked ships are the ones eligible to use city facilities (crew, refit, etc.) later.

## 2. HQ space-city screen (vertical slice)

A full-screen overlay (opened by clicking the HQ station, or an **HQ** HUD button)
showing the home station as a **space city** of upgradeable facilities. The player
spends mined resources (ore / crystal / gas / rare minerals …) to level them up.

### Facilities (initial set)

| Facility | Role | Upgrade effect (planned) |
|---|---|---|
| **Admin Spire** | Command hub; raises facility/ship caps | +build & fleet capacity |
| **Crew Quarters** | Houses crew | +crew pool for ships |
| **Research Lab** | Tech | unlocks/【speeds】 research |
| **Academy** | Trains officers/pilots | better ship stats, faster XP |
| **Shipyard** | Builds & refits ships | unlock hulls, faster builds |
| **Trading Post** | Buy/sell, contracts | better prices, market access |
| **Foundry** | Refines ore→alloys | resource conversion |
| **Sensor Array** | Scanning/recon | reveals galaxy systems, detect fleets |

Each facility has a **level**, a short description, and a **cost** that scales with
level (`cost(level) = base * growth^level`, paid in a mix of resources). Upgrading
deducts resources if affordable and increments the level.

### Slice scope (what's built now)

- **Interactive isometric 3D city** (`client/src/hqcity.ts`): a hex platform floating in
  space with one **distinct building per facility** (Admin Spire center; Crew Quarters,
  Research Lab, Academy, Shipyard, Trading Post, Foundry, Sensor Array on a ring), glowing
  lanes/beacons, and the nebula skybox behind it. Its own Three.js scene + OrbitControls at a
  fixed isometric angle (**no rotation**); **left-drag pans across the plane and scroll zooms,
  exactly like the solar-system view**. Hovering a building makes it **glow** (cyan emissive).
- Click a building → an HTML panel shows its name, level, description and upgrade cost with
  an **Upgrade** button (enabled only when affordable; deducts from HQ stores). Upgrading
  **regrows the building** (taller / more floors / extra stacks).
- Costs/levels are real and persist for the session; **facility *effects* are still stubs**
  (levels rise and resources are spent, but gameplay hooks like build speed / caps come
  later).

### Later

- Placeable/reorderable buildings; per-facility detail screens; build queue in the
  Shipyard; research tree from the Lab; contracts in the Trading Post; crew/officer assign.

## 3. Galaxy map — local cluster (vertical slice)

A **local cluster of 100 procedurally generated star systems**, connected by a
**Delaunay graph** (jump lanes), statically cached so it can be hand-edited later.

- **Generation:** `scripts/galaxy/gen_galaxy.mjs` (seeded, deterministic) samples 100
  systems in a disc with a minimum separation, assigns names + star classes
  (O/B/A/F/G/K/M + exotic), and computes Delaunay edges (Bowyer-Watson). The home
  system is id 0 at the center.
- **Cache:** output is committed to `client/public/data/galaxy.json`
  (`{ meta, systems:[{id,name,x,y,star,planets}], links:[[i,j]] }`). Edit that file
  directly to tweak the map; re-run the script to regenerate from scratch.
- **Map view (slice):** a full **3D scene** (`client/src/galaxymap.ts` → `makeGalaxy3D`),
  toggled by the **Galaxy Map** HUD button (which relabels to **Solar System**). Stars sit on
  the XZ plane as emissive spheres (colored by class, with additive halos) and **each star
  shows its own little system of orbiting planets** (one `InstancedMesh`, per-instance colors,
  animated each frame); the Delaunay lanes draw as faint lines and the home system gets a cyan
  ring. The scene renders on the **main canvas with the fleet hotbar still visible** (no opaque
  overlay). OrbitControls: drag to orbit, scroll to zoom. A hover readout names the system under
  the cursor and shows the ETA for the selected ship.
- **Finding your ships:** every ship gets a small floating **find button** over its position on
  the map (buttons sharing a spot stack); clicking one selects that ship and recenters the camera
  on it. The **selected** ship is also marked by a large bobbing arrow so it's obvious where it is.
- **Interstellar travel (slice):** select a ship from the hotbar, then **click a star** — it
  routes via the **shortest path** over the jump-lane graph (Dijkstra, weighted by lane length)
  and travels at **~1 minute per segment** (`segSeconds`, lightly scaled by lane length). On
  hover the **planned route is drawn from the ship's current star through the jump lanes to the
  target star** (raised above the plane so it reads clearly); active voyages draw as dashed paths
  and every ship shows a cone fleet marker at its interpolated galaxy position. A ship in transit (or in any non-home
  system) is removed from the local system view; arriving back home re-docks it at HQ.
- **Hyperspace tunnel (slice):** while the **selected** ship is mid-jump, the map view swaps to
  a hyperspace scene (`makeHyperspace`): the ship's real glTF model flies down a wormhole tube
  (scrolling additive ring wall) with **star streaks** rushing past and an engine glow. Selecting
  a ship that is *not* travelling returns to the cluster map.
- **Procedural star systems (slice):** every system on the map is a REAL, enterable solar
  system. `client/src/sysgen.ts` expands a cached galaxy entry into a deterministic
  `SystemSpec` (same seed → same system): star radius + tint from its spectral class (the sun
  shader takes a class tint and the system's key light matches), N planets with Kepler-ish
  orbits, types (gas giants past the frost line, with rings + atmosphere nodes), resource
  tags, moons, and usually an asteroid belt with 1–2 glowing mineral fields parked in the
  widest orbital gap. The home system stays hand-authored (`data.ts`).
- **Entering systems:** on the galaxy map, **clicking the star your selected ship is at
  enters that system** (the hover readout shows "click to ENTER"); the whole system view
  tears down and rebuilds (`loadSystem`), and a HUD badge names the viewed system. Ships
  arriving in a remote system drop out on an entry ring; ships that fill their cargo in a
  remote system **auto-route home through the jump lanes** and deposit on docking; Recall
  from another system routes the ship home first. Orders re-link by node name when a system
  is re-entered (systems rebuild deterministically).
- **Later:** fog-of-war via the Sensor Array, per-system contents to fly into on arrival,
  fuel/range limits, multi-ship fleet orders, expansion beyond the cluster (the cache is
  the editable seed for that).
