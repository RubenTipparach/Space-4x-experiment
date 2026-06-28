# Game Design Document — **Stellar Frontier**

> Gameplay mechanics: resources, mining, ship roles, deterministic combat, travel,
> and the early-game loop. Companion to [`TECH_DESIGN.md`](TECH_DESIGN.md), which
> covers the engine and architecture. Where a mechanic drives architecture, this
> doc links to the relevant tech section.

**Status:** Draft v1 · **Last updated:** 2026-06-28

---

## 1. Core Loop (early game)

```
Home base ──build──► Mining ship ──travel──► Resource node ──mine──► (cargo fills)
   ▲                                                                      │
   └──────────────── deposit ◄── travel ◄────── return ◄─────────────────┘
                         │
                         └──► build more ships / better ships ──► expand & defend
```

Every player begins with a **home base** and grows by extracting three resources,
constructing ships, and contesting space with other players in the one shared
universe.

---

## 2. Resources

Three base resources at launch:

| Resource | Where it's found | How to mine it |
| --- | --- | --- |
| **Ore** | Asteroids (in asteroid belts / scattered bodies) | Park a mining-capable ship *on the node* to extract over time. |
| **Crystal** | Asteroids (specific crystal-bearing bodies) | Same — station a ship on the node to mine. |
| **Gas** | **Gas giants only**, harvested at **Lagrange nodes** orbiting them | Park a ship at a Lagrange node slot to mine. |

### 2.1 Ore & Crystal
- Found on **asteroid nodes** within a system.
- To mine, a player **places a ship on the node**; extraction accrues over time into
  the ship's cargo at the ship's mining rate, capped by cargo capacity.
- The ship must then **return to the home base** to deposit before mining more once
  full. *(MVP: deposit at the **home base only**; depositing at any owned/forward base
  is a planned post-MVP extension.)*

### 2.2 Gas (and Lagrange nodes)
- Gas is harvested **only near gas giants**, at fixed **Lagrange nodes** — stable
  orbital points where a ship can "park" and mine.
- Each gas giant exposes exactly **5 Lagrange node slots** (orbit nodes). Slots are
  **finite and contestable**, which makes gas the naturally **scarce, PvP-flavored**
  resource: with only 5 parking spots per gas giant, prime gas spots are worth
  fighting over, and holding them is a strategic objective. (Contrast with ore/crystal,
  which are more plentiful and spread out.)
- Parking a ship at a Lagrange slot mines gas over time, same accrue-to-cargo model.

> **Design intent:** ore/crystal = steady economic backbone (low conflict); gas =
> concentrated, contested high-value resource that drives territorial play around gas
> giants. This gives the map natural "hot" locations even before formal objectives.

### 2.3 Accrual & offline play
- Mining is **time-based and continues while the player is offline** — the
  server-side simulation accrues output deterministically and caps it at the ship's
  cargo. (See `TECH_DESIGN.md` §6.2 "continuous world" + scheduled jobs.)

### 2.4 Economic identity (resource sinks)

Each resource has a **distinct role** so all three stay in demand and specialization
matters (rather than one blended cost for everything):

| Resource | Primarily builds / fuels |
| --- | --- |
| **Ore** | Hulls & structures — the bulk material for ships and base construction. |
| **Crystal** | Shields, electronics & modules — the "tech" input for ship systems and upgrades. |
| **Gas** | Fuel & advanced/energy systems — powers travel and high-end/energy-hungry tech. |

*Baseline identities; exact recipe costs are tuned in Phase 1. Because gas is the
scarce, contested resource, gating fuel/advanced tech on it reinforces why gas giants
are worth fighting over.*

---

## 3. Ships & Roles

Ships have a **specialty type** — a role they're good at, with deliberate weaknesses
elsewhere. Roles are expressed entirely through **stats** (data-driven; see
`TECH_DESIGN.md` §9.1), so new ships and roles ship as content, not code.

### 3.1 Roles at launch

| Role | Strength | Weakness |
| --- | --- | --- |
| **Mining ship** | High mining rate + cargo; cheap to field | Poor combat — weak weapons, low HP/shields, low agility. A soft target that needs escorting. |
| **Combat ship(s)** | Built to fight (see combat stats below) | Little/no mining; specialized loadouts trade off against each other (TBD subtypes). |

More roles (scout, hauler, support, etc.) are expected later; the stat model below is
designed to absorb them.

### 3.2 Stat model

**Shared stats (all ships):**
- `hullHp` — structural health; ship is destroyed at 0.
- `shieldHp` — absorbs damage before hull; **regenerates per round** by `shieldRegen`.
- `speed` — in-system movement speed.
- `cargo` — resource-carrying capacity.

**Mining stats:**
- `miningRate` — resource units mined per unit time when stationed on a node.

**Combat stats** *(to be tuned; this is the working set):*
- `agility` — evasion; reduces the chance/effectiveness of incoming hits. Also the
  **survival/escape stat**: there is no retreat, so a high-agility ship survives by
  dodging long enough to reach the round-100 stalemate and disengage (§4.3).
- `range` — engagement distance; **longer range fires first / out-ranges shorter
  ships** (initiative & first-strike).
- `missiles` — primary offensive weapon profile (volley size / damage / type).
- `countermeasures` — defense vs. missiles (point-defense / decoys); mitigates
  incoming missile damage.
- `shieldRegen` — shield HP recovered at the end of each combat round.

> These five combat stats are the parameters we'll balance against each other so that
> no single build dominates (e.g. long-range missile boats countered by high-agility
> + countermeasure ships, etc.). Because combat is deterministic (§4), we can analyze
> these tradeoffs precisely.

### 3.3 Mining ship vs combat ship — intended tension
- A mining ship is **efficient but defenseless**: left alone at a node it's easy
  prey, so players must **escort miners or risk losing them** (and their cargo).
- This makes the economy *and* combat interact: raiding enemy miners is a viable
  strategy; defending your extraction is a constant cost.

### 3.4 Factions & acquisition
- Players **pick a starting faction** (sets starting ships, home-base styling, and
  initial standings). New ships are **earned through faction reputation** — by running
  missions for a faction *or* by destroying that faction's enemies.
- Full faction system, relationships, and the per-faction **SVG design language** live
  in [`FACTIONS_AND_ART.md`](FACTIONS_AND_ART.md).

---

## 4. Combat (Deterministic, Reviewable)

Combat is **fully deterministic from ship stats**. Given the same combatants and
ruleset version, the outcome is always identical — which lets us **analyze balance
precisely** and lets players **review exactly how a battle was decided**.

### 4.1 Resolution rules
- Combat runs in **rounds**, up to a **maximum of 100 rounds**.
- It ends early **the moment one side is wiped** (1v1: a ship destroyed; fleet:
  all ships on a side destroyed).
- **Stalemate at round 100:** if neither side is wiped by round 100, **both sides
  exit combat with their accrued damage** (hull/shield carry over) and disengage.
  No winner is declared; the ships survive and break off.

### 4.2 What happens in a round (working model)
Each round, deterministically:
1. **Ordering by `range`** — longer-range ships act/fire first (first-strike
   advantage; out-ranging a target can mean firing before it can reply).
2. **Attacks resolve** — `missiles` produce incoming damage; the target's `agility`
   reduces effective hits and `countermeasures` mitigate missile damage.
3. **Damage applied** — `shieldHp` absorbs first, then `hullHp`. A ship at 0 hull is
   destroyed and removed.
4. **End of round** — surviving ships recover `shieldRegen` shield HP (up to max).

> **Determinism & seed:** every battle is stamped with a **combat seed ID** — a large
> unique identifier (a **GUID**) recorded with the battle. The resolver is a function
> of `(combatants, rulesetVersion, seedId)`, so any battle is **exactly reproducible**
> from those inputs. The seed drives any controlled variance (and tie-breaks), while
> staying fully replayable and analyzable — see `TECH_DESIGN.md` §6.4.

### 4.3 Fleet combat rules
- **Target selection — focus-fire weakest:** each side concentrates fire on the enemy
  ship with the **lowest effective HP** (shield + hull) first, removing enemy ships —
  and their damage output — as fast as possible. Deterministic given the seed; ties
  broken by the seed.
- **End condition:** a side loses when **all its ships are destroyed**; otherwise the
  round-100 stalemate (§4.1) applies and both fleets disengage with damage.
- **No retreat mechanic.** There is no voluntary or threshold-based disengage —
  fights run to a wipe or the round-100 stalemate. **Survival *is* the escape route:**
  a ship with high `agility` (evasion) can dodge enough incoming fire to **last all
  100 rounds and walk away** via the stalemate disengage (with whatever damage it
  took). This makes `agility` the defensive/escape stat — evasion-built ships (e.g.
  fast scouts or fleeing miners) survive by not dying rather than by bugging out.

### 4.5 Watching / reviewing a battle
- The server resolves combat instantly and produces a **round-by-round event log**
  (who fired, hits, damage, shield/hull after each step, destructions).
- Players can **watch the battle play back** in the system view — the client animates
  the log so the player sees *how the outcome was decided*, round by round.
- Because it's deterministic, replays are exact and auditable; a battle can be
  re-derived from its inputs (`combatants + rulesetVersion + seedId`) — useful for
  balance analysis and dispute resolution.

### 4.6 Open combat questions (tuning only)
- Exact numeric formulas: how `agility` and `countermeasures` convert to mitigation,
  and the missile damage curve. (Agility tuning is now doubly important — it governs
  both in-fight survivability *and* the round-100 escape, §4.3.)
- Round-100 stalemate frequency — tune so reaching round 100 is an *earned* outcome
  of high evasion, not a default for ordinary ships.

---

## 5. Travel & Movement

Two scales of travel, both modeled as timed jobs (see `TECH_DESIGN.md` §6.2):

| Scale | Duration | Notes |
| --- | --- | --- |
| **In-system** (body ↔ body, node ↔ base) | **a few seconds** | Short hop; client animates the ship moving across the system view. |
| **Interstellar** (star ↔ star) | **minutes** | Long transit; ship is "in flight" between systems, surfaced in the UI and (optionally) a Discord arrival notification. |

- Travel times are **deterministic** and scheduled, so arrivals resolve correctly
  even while offline.
- Interstellar travel being *minutes* makes fleet positioning a real strategic
  decision (you can't instantly reinforce a distant system), while in-system travel
  staying *seconds* keeps moment-to-moment play snappy.

---

## 6. Home Base

- **Every player starts with a home base** in their assigned starting system (start
  systems are capacity-managed; see `TECH_DESIGN.md` §7.2).
- The home base is the player's anchor: **ship construction**, **resource deposit /
  storage**, and the **spawn/return point** for their fleet.
- Early progression flows through the base: deposit mined resources → build/upgrade
  ships → push outward to more nodes (and contested gas giants).

---

## 7. How mechanics map to the tech design

| Mechanic | Tech implication | Where |
| --- | --- | --- |
| Offline mining accrual | Continuous server sim + scheduled jobs | TECH §6.2 |
| Travel (sec / min) | Deterministic timed jobs | TECH §6.2, §6.4 |
| Deterministic combat + replay | Pure-function resolver, stored event log, ruleset versioning | TECH §6.4, §9.3 |
| Ship roles & stats | Data-driven ship/module schema | TECH §9.1 |
| Gas Lagrange slot scarcity | Finite contestable entities → natural hotspots | TECH §7.3 |
| Home base per player | Spawn distribution / start-system caps | TECH §7.2 |

---

## 8. Decisions locked & questions remaining

**Decided (this pass):**
- Combat uses a **per-battle GUID seed ID** for reproducible variance/tie-breaks (§4.2).
- Fleet combat: **focus-fire the weakest**; a side loses when **all its ships die**;
  round-100 **stalemate = both disengage with damage** (§4.1, §4.3).
- **No retreat mechanic** — survival is via **evasion** (high `agility` lasts to the
  round-100 stalemate and escapes); `agility` is the defensive/escape stat (§4.3).
- Miners deposit at the **home base only** for MVP (§2.1).
- **5 Lagrange slots per gas giant** (§2.2).
- Resource identities: **ore→hulls/structures, crystal→shields/electronics/modules,
  gas→fuel & advanced/energy** (§2.4).

**Still open:**
1. Are Lagrange slots **claimable/holdable** (persistent ownership) or pure
   first-come occupancy?
2. Combat **numeric formulas** for agility/countermeasures mitigation (§4.6).
3. Post-MVP: depositing at **forward/owned bases** beyond the home base (§2.1).

---

*Living document. Mechanics here are the launch baseline; balance numbers (stat
values, mining rates, slot counts, travel durations) get tuned during the Phase 0/1
spikes.*
