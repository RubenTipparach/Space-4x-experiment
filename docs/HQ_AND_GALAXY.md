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

- Overlay with a facility card per structure: name, level, description, cost, **Upgrade**
  button (enabled only when affordable; deducts from HQ stores).
- A simple "city" header; the real isometric/3D city render is a follow-up.
- Costs/levels are real and persist for the session; **facility *effects* are stubs**
  (levels go up and resources are spent, but gameplay hooks like build speed / caps come
  later). This is the slice scaffold to iterate on.

### Later

- 3D/iso city view with placeable buildings; per-facility detail panels; build queue in
  the Shipyard; research tree from the Lab; contracts in the Trading Post.

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
- **Map view (slice):** a full-screen overlay (**Galaxy** HUD button) that draws the
  cached systems as stars (colored by class) with the Delaunay lanes as faint lines,
  the home system highlighted, and hover labels. Pan/zoom.
- **Later:** travel between systems (minutes of flight per GAME_DESIGN), fog-of-war via
  Sensor Array, per-system contents, fleet positions on the map, expansion beyond the
  cluster (the cache is the editable seed for that).
