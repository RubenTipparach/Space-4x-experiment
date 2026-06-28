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
- The ship must then **return to a base** to deposit before mining more once full.

### 2.2 Gas (and Lagrange nodes)
- Gas is harvested **only near gas giants**, at fixed **Lagrange nodes** — stable
  orbital points where a ship can "park" and mine.
- Each gas giant exposes a **limited number of Lagrange node slots**. Slots are
  **finite and contestable**, which makes gas the naturally **scarce, PvP-flavored**
  resource: prime gas spots are worth fighting over, and holding them is a strategic
  objective. (Contrast with ore/crystal, which are more plentiful and spread out.)
- Parking a ship at a Lagrange slot mines gas over time, same accrue-to-cargo model.

> **Design intent:** ore/crystal = steady economic backbone (low conflict); gas =
> concentrated, contested high-value resource that drives territorial play around gas
> giants. This gives the map natural "hot" locations even before formal objectives.

### 2.3 Accrual & offline play
- Mining is **time-based and continues while the player is offline** — the
  server-side simulation accrues output deterministically and caps it at the ship's
  cargo. (See `TECH_DESIGN.md` §6.2 "continuous world" + scheduled jobs.)

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
- `agility` — evasion; reduces the chance/effectiveness of incoming hits.
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

---

## 4. Combat (Deterministic, Reviewable)

Combat is **fully deterministic from ship stats**. Given the same combatants and
ruleset version, the outcome is always identical — which lets us **analyze balance
precisely** and lets players **review exactly how a battle was decided**.

### 4.1 Resolution rules
- Combat runs in **rounds**, up to a **maximum of 100 rounds**.
- It ends early **the moment a ship is destroyed** (for 1v1) / one side is wiped (for
  fleets). *(Open: see §4.4 for the multi-ship end condition.)*
- If neither side is destroyed by round 100, the battle ends as a **stalemate /
  disengage** — combatants survive with accrued damage and break off. *(Tunable.)*

### 4.2 What happens in a round (working model)
Each round, deterministically:
1. **Ordering by `range`** — longer-range ships act/fire first (first-strike
   advantage; out-ranging a target can mean firing before it can reply).
2. **Attacks resolve** — `missiles` produce incoming damage; the target's `agility`
   reduces effective hits and `countermeasures` mitigate missile damage.
3. **Damage applied** — `shieldHp` absorbs first, then `hullHp`. A ship at 0 hull is
   destroyed and removed.
4. **End of round** — surviving ships recover `shieldRegen` shield HP (up to max).

> **Determinism:** the resolver is a **pure function** of the combatants' stats (no
> hidden RNG, or a *recorded seed* if we want controlled variance). This is the key
> property — see `TECH_DESIGN.md` §6.4 for how this enables instant server-side
> resolution + exact replay.

### 4.3 Watching / reviewing a battle
- The server resolves combat instantly and produces a **round-by-round event log**
  (who fired, hits, damage, shield/hull after each step, destructions).
- Players can **watch the battle play back** in the system view — the client animates
  the log so the player sees *how the outcome was decided*, round by round.
- Because it's deterministic, replays are exact and auditable; we can also re-derive a
  battle from its inputs + ruleset version (useful for balance analysis and dispute
  resolution).

### 4.4 Open combat questions
- **Fleet vs fleet** target selection & end condition (last-ship-standing? morale/
  retreat threshold? focus-fire rules?).
- Whether to keep combat **pure-deterministic** (easiest to balance/analyze) or use a
  **recorded seed** for some variance while staying replayable.
- Stalemate handling at round 100 (disengage vs. damage-based victor).
- How `agility`/`countermeasures` numerically convert to mitigation (formula tuning).

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

## 8. Open design questions (for the team)

1. Combat: pure-deterministic vs recorded-seed variance? (§4.4)
2. Fleet combat target-selection & end conditions? (§4.4)
3. Do miners deposit to *any* friendly base or only the **home base**?
4. Lagrange slot count per gas giant, and whether slots are claimable/holdable.
5. Resource sinks — what do crystal/ore/gas each primarily build or fuel?

---

*Living document. Mechanics here are the launch baseline; balance numbers (stat
values, mining rates, slot counts, travel durations) get tuned during the Phase 0/1
spikes.*
