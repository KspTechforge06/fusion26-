# FUSION26 — Warehouse Robot Fleet Coordination

**Read this file first.** It explains the problem, exactly what we must build, and — most
importantly — what the evaluation is really going to reward.

> Workspace: `/home/ksp/fusion26`
> Source problem: **SIH 2026, Problem Statement ID 26123**
> Title: *Edge-AI Based Distributed Fleet Coordination for Autonomous Mobile Robots in smart warehouses.*
> Theme: Smart Automation · Category: Software
> Reference benchmark: <https://movingai.com/benchmarks/mapf.html>

---

## 0. TL;DR (one screen)

Build a **simulated warehouse grid** with **many robot agents** that:
1. **Find paths** to tasks (Multi-Agent Path Finding, MAPF),
2. **Allocate tasks** among themselves (who delivers what, in what order),
3. **Re-route on the fly** when a path is blocked (congestion), a robot dies
   (equipment failure), or priorities change,
4. **Do all of the above without a central controller that replans the whole world
   from scratch** — decisions must be local / incremental / distributed,
5. Show all of it **live on a 2D grid** (the "fleet map" visualization).

The single thing that matters most: **graceful, real-time, *decentralized* re-routing.**
A pretty grid with one central planner is a fail. A plain grid where robots recover from
blockages and failures by talking only to their neighbours is a pass.

---

## 1. The official problem statement

**Edge-AI Based Distributed Fleet Coordination for Autonomous Mobile Robots in smart
warehouses.**

Today's warehouses use a **central server** to plan paths for the whole fleet. That
approach has three fatal problems, as stated in the submission:

| Centralized system (the problem) | Decentralized system (what we want) |
|---|---|
| One controller = **single point of failure**. Server down → all robots stop. | **No central server.** One robot fails → the rest keep going. |
| **Limited scalability.** Arbitration slows as the fleet grows (~14-robot ceiling for centralized planners). | Computation and bandwidth scale with the **local neighbourhood** (60+ robots). |
| **Stop-and-wait.** Robots idle waiting for central decisions. | Every robot is an **intelligent node** that senses, decides and communicates locally. |

Stated benefits of the target: *eliminates single point of failure, high resiliency &
fault tolerance, linear scalability, reduced latency (≈70% via real-time local
re-routing), lower infrastructure cost, energy-aware motion planning.*

### The task we are given (as written)

> Warehouse robot fleets must dynamically re-route around **congestion**, **equipment
> failure**, and **priority order changes** without a central bottleneck controller
> re-planning everything from scratch.

### Expected solution (as written)

> Build a **simulated warehouse grid** with multiple robot agents that coordinate
> **path-finding** and **task allocation** in real time, demonstrating **graceful
> re-routing** when a path is blocked or a robot "fails", **visualized on a 2D grid**.

### Dataset

None required. Optional external maps/problems come from the **MovingAI MAPF benchmark**
(already downloaded into `fusion26/maps/`, see §8).

---

## 2. Restated in plain English

Imagine an Amazon-style warehouse floor drawn as a big **grid of cells** (open floor,
shelves, walls). Several **AMRs (robots)** live on that grid. Work arrives as **tasks**
(generally: "go from this pickup cell to that drop-off cell", possibly with a priority
and a deadline). Each robot must:
- get assigned tasks (task allocation),
- compute a route that **does not collide** with other robots (MAPF),
- and **keep moving** when reality changes underneath it.

The "without a central bottleneck" clause is the heart of the problem: when something
changes, the fleet must adapt **locally and incrementally**, not freeze while one server
recomputes every robot's entire route.

---

## 3. What we must build (the deliverable)

A runnable simulation with these components:

1. **Warehouse grid world / map** — 2D grid with passable cells, static obstacles
   (shelves/walls), pickup/drop-off (goal) cells.
2. **Robot agents** (≥ 8, ideally 20–50+) — each an independent decision-maker with:
   position, goal, current path, and a tiny local "brain".
3. **Task generator** — produces delivery tasks continuously (origin → destination,
   priority, timestamps).
4. **Task allocator** — assigns tasks to robots (distributed, not a god-object).
5. **MAPF path planner** — collision-free, time-aware routing for all agents.
6. **Dynamic re-routing engine** — handles the three disruptions (§4) **incrementally**.
7. **Conflict / collision handling** — edge and vertex conflicts, deadlocks.
8. **2D visualization** — live grid with robots, paths, tasks, obstacles and events.
9. **Metrics + logging** — throughput, makespan, delay, replan cost, collisions, etc.
10. **Scenario controls** — buttons/keys to *inject* congestion, kill a robot, or bump a
    task's priority so the grader can watch recovery happen.

---

## 4. What is expected MOST (the grading heart)

This section is the answer to *"what do they actually care about?"* Rank your effort
top-to-bottom.

### 4.1 The three disruption types AND graceful recovery

The problem names exactly three triggers. Build a demo for **each**, and make recovery
visible:

| Trigger | Example in the sim | Required graceful behaviour |
|---|---|---|
| **Congestion** | A corridor/aisle becomes busy; robots pile up | Robots detect the jam locally, pick an alternate lane/detour, spread load; throughput does not collapse. |
| **Equipment failure** | Kill a robot (or block its cell) mid-route | Its reserved cells are released; neighbours re-route around the dead robot; its tasks are **re-allocated** to survivors; rest of fleet never stops. |
| **Priority change** | A high-priority urgent order arrives, or a task's priority is raised | The urgent robot pre-empts; lower-priority robots yield / step aside / re-route **without a global restart**. |

"Graceful" means: no crash, no permanent deadlock, no wild oscillation, no fleet-wide
freeze, and metrics recover quickly.

### 4.2 Decentralization / no central bottleneck (the differentiator)

This is the clause that separates a top solution from a toy. Concretely:

- **No single process that owns all robot states and reruns one giant planner every
  tick.** If you have a `CentralController.replan()` that recomputes every agent's full
  path whenever anything changes, you have failed the brief.
- **Incremental replanning:** when a conflict/blockage is detected, replan only the
  **affected agents** and/or only the **affected time window** of their plans. Untouched
  robots keep their plans.
- **Local information:** each robot decides from a bounded neighbourhood (itself +
  nearby robots). Avoid global broadcasts of the entire world state.
- **Peer-to-peer coordination:** robots negotiate directly (or via a light local
  coordinator / edge node), not through one master.
- **Self-healing:** if one agent / link / edge-node disappears, the rest keep going.

> Practical suggestion: you may start with a shared in-memory world for development,
> but structure the code as **per-robot agents with message-passing** (an event bus /
> mailbox). Swapping the bus for real sockets is then trivial and proves the architecture.

### 4.3 It must actually run and be watchable

A 2D grid visualization is explicitly required. The grader should be able to open it,
press a button, and *see* a robot fail and the fleet route around it. If it only exists
as a CSV, it does not count.

---

## 5. Functional requirements

Number them so you can tick them off.

- **F1 — Grid world.** Load a warehouse map (from §8 or hand-made). Cells are
  free / static obstacle / pickup / drop-off.
- **F2 — Agents.** N robots, each with id, position, goal, path, state machine
  (`IDLE → ASSIGNED → MOVING → WAITING → DONE/FAILED`).
- **F3 — Tasks.** Generated over time with origin, destination, priority, size/weight
  (optional), deadline (optional). Support dynamic insertion & priority edits.
- **F4 — Task allocation.** Assign tasks to capable robots by a cost (distance, ETA,
  battery, current load, priority). Must be **distributed / local**, not global.
- **F5 — MAPF.** Compute collision-free plans; disallow vertex conflicts (two robots on
  the same cell same time) and edge conflicts (swap on an edge). Support wait actions.
- **F6 — Congestion handling.** Detect jams, measure density, reroute/apply congestion
  cost, avoid livelock.
- **F7 — Failure handling.** A robot can be marked failed mid-mission; release its
  reservations; reallocate its tasks; neighbours reroute.
- **F8 — Priority handling.** Preemption / yielding based on priority; reordering.
- **F9 — Incremental replanning.** Repairs are local/partial, never full-world.
- **F10 — Visualization.** Live 2D grid (§11).
- **F11 — Metrics & logging.** (§12)
- **F12 — Scenario injection & reset.** Controls to trigger disruptions and reset.

---

## 6. Non-functional requirements

- **Real-time feel:** the sim should run/settle in seconds, not minutes, per disruption.
  Interactions should complete within a "tick" budget.
- **Scalability:** aim to demonstrate smooth behaviour as N grows (e.g. 8 → 16 → 32
  robots). Show that per-tick cost grows ~with local density, not N² globally.
- **Robustness:** no deadlocks, no lost agents, no collisions in the resolved plans.
- **Determinism/reproducibility:** seedable RNG; a scenario can be replayed.
- **Modularity:** planner, allocator, simulator, and renderer are swappable.
- **Testability:** unit tests for conflicts, allocation, failure recovery; a headless
  mode for CI.

---

## 7. What is explicitly NOT wanted

- ❌ A **central controller** that replans all robots from scratch whenever anything
  changes.
- ❌ **Stop-the-world** behaviour (fleet pauses until a global solve finishes).
- ❌ Only **static** MAPF (plan once, run forever). The word is *dynamic*.
- ❌ Robots that **clip through each other** or freeze in **deadlock**.
- ❌ A solution that only works because there is exactly one robot or one bottleneck.
- ❌ "Works in theory but there's no visualization / it doesn't run."

---

## 8. Benchmark & reference material

**MovingAI MAPF benchmarks** — the standard community benchmark. Local copy:
`fusion26/maps/*.map` (33 maps already extracted from `mapf-map.zip`).

Relevant warehouse maps (best fit for this problem):

| Map | Size | Notes |
|---|---|---|
| `warehouse-10-20-10-2-1.map` | 161×63 | Small warehouse, good starting point |
| `warehouse-10-20-10-2-2.map` | 170×84 | Variant |
| `warehouse-20-40-10-2-1.map` | 321×123 | Larger warehouse |
| `warehouse-20-40-10-2-2.map` | 340×164 | Largest warehouse |

Also useful: `empty-32-32`, `random-32-32-*`, `room-64-64-*`, `maze-*` for stress tests.

**Map file format** (MovingAI `.map`):
```
type octile
height 63
width 161
map
....@....@....
```
- `.` = free cell, `@` = blocked/obstacle, `T` = tree/blocked (treat like `@`).
- The map body is `height` rows of `width` characters.

**Scenario file format** (`.scen`) — optional for standardized start/goal pairs:
```
version 1
0  map  width  height  start_x  start_y  goal_x  goal_y  optimal_length
```
Download scenarios from the benchmark page if you want to compare against published
numbers. **We do not need the dataset** — these maps are enough, and you may also build a
custom warehouse map.

**To cite the benchmark:** Stern, Sturtevant, Felner, Koenig, Ma, Walker, Li, Atzmon,
Cohen, Kumar, Boyarski, Barták. *Multi-Agent Pathfinding: Definitions, Variants, and
Benchmarks.* SoCS 2019, pp. 151–158.

---

## 9. Suggested architecture

Keep the **communication layer** between components explicit — that is what makes the
"no central bottleneck" claim credible.

```
                +---------------------------+
                |   Task Generator (events) |
                +-------------+-------------+
                              | new task / priority change
                              v
   +---------------------------------------------+
   |            Event Bus (P2P messages)         |   <-- swap for sockets later
   +--+--------+--------+--------+--------+------+
      |        |        |        |        |
   +--v--+  +--v--+  +--v--+  +--v--+  +--v--+
   |Robot|  |Robot|  |Robot|  |Robot|  |Robot|   each with its own
   |  1  |  |  2  |  |  3  |  |  4  |  |  N  |   local planner + allocator
   +--+--+  +--+--+  +--+--+  +--+--+  +--+--+
      |        |        |        |        |
      +--------+--------+--------+--------+
                       | state (read-only snapshot for rendering)
                       v
                +------+------+
                |  2D Renderer |
                +-------------+

   Edge/local-coordinator nodes: a robot may lead a *local* group to resolve
   conflicts. It is NOT a global master and holds no global plan.
```

Suggested modules:

| Module | Responsibility |
|---|---|
| `world/` | Grid, map loader (`.map`), obstacles, pickup/drop cells |
| `sim/` | Tick loop, clock, event queue, scenario runner |
| `agents/` | Robot class, state machine, local sensing, mailbox |
| `tasks/` | Task model, generator, priority changes |
| `allocation/` | Distributed / market-based task assignment |
| `planning/` | Single-agent A*/Dijkstra, MAPF (see §10), replanning |
| `comm/` | Event bus / message passing, neighbour discovery |
| `render/` | 2D grid visualizer |
| `metrics/` | Counters, logs, charts |
| `tests/` | Unit + scenario regression tests |

---

## 10. Algorithm toolkit (pick and justify)

**Single-agent pathfinding**
- **A\*** with Manhattan/octile heuristic. Add **congestion cost** by inflating cell cost
  with live robot density.
- **Time-expanded A\*** (space-time) when you already have reservations.

**MAPF (initial planning)**
- **Prioritized Planning (PP)** — simplest; order agents, plan one at a time around the
  reserved cells of earlier agents. Good baseline.
- **Cooperative A\*** / windowed variants — better quality, still manageable.
- **Conflict-Based Search (CBS)** — optimal, conflict-driven. The submission explicitly
  names CBS; implement it if you can, and use its conflict/constraint idea for repairs.
- **Local Repair A\*** / **Windowed MAPF** — replan only a time-window or a small agent
  set. **This is your incremental engine.**

**Incremental / dynamic replanning (the key part)**
- **D\* Lite / LPA\*** — reuse previous search when the graph changes (blocked cells,
  failed robot). Classic for dynamic environments.
- **Conflict-triggered repair** — detect a vertex/edge conflict, then re-plan only the
  conflicting agents (alternate priority or CBS repair).
- **Reservation table** — each cell-time pair is reserved; on change, release only the
  affected reservations.

**Collision & deadlock avoidance**
- Reservation/claiming scheme, **priority-based yielding**, token passing.
- Deadlock detection via wait-for graph; break with a deterministic tie-break/re-route.

**Task allocation (distributed)**
- **Market / auction-based** (contract-net): robots bid on tasks via their local ETA
  cost; winner announced locally. Naturally decentralized.
- **Cost-based greedy with locality**, or potential-field/auction hybrids.
- Re-auction only the affected tasks when a robot fails.

**Edge-AI framing (matches the SIH statement, optional but on-theme)**
- Mention/label the onboard component as the "Edge-AI decision unit" (Jetson/RPi in the
  real deployment).
- The statement's fancy terms: **GNN** (representing robots as graph nodes for
  coordination), **DM³-Nav** (semantic navigation), **Swarm-SLAM** (collaborative SLAM),
  **OpenClaw** (on-device action logic). For a simulation you can:
  - implement the **graph abstraction** (robots = nodes, proximity = edges) that the GNN
    idea implies, even if you use rule-based logic instead of a trained GNN;
  - keep perception/semantics out of scope or stubbed, and say so clearly.

> Pragmatic path: a solid **Prioritized Planning + reservation table + conflict-triggered
> local repair + market-based allocation** beats a half-working GNN. Show the graph/edge
> abstraction, but invest first in correctness of dynamic re-routing.

---

## 11. 2D visualization spec

Required, and it is how the grader judges "graceful". Minimum features:

- Grid rendering of the map: free cells, obstacles/shelves (grey), pickup/drop zones
  (coloured).
- Each robot drawn as a distinct coloured dot/arrow; **id** and optionally state.
- Its **current path** drawn as a polyline/overlay; recompute overlay updates live.
- **Tasks** marked (e.g. red = unassigned, yellow = in progress, green = done).
- **Events** visibly annotated: "congested at (x,y)", "robot 5 FAILED", "priority
  raised on task 12".
- Live **metrics panel**: active robots, tasks completed, avg delay, replans/tick,
  collisions = 0, deadlocks = 0.
- **Controls**: pause/play, speed, spawn task, raise priority, kill robot, add obstacle,
  reset.
- (Optional) heat map of congestion; time slider / replay.

Tech: Python + **pygame** or **matplotlib** (or a web canvas / JS if preferred). Keep
rendering decoupled from simulation so headless runs work.

---

## 12. Metrics that prove success

Log and show at least:

| Metric | Meaning | Target |
|---|---|---|
| **Tasks completed / throughput** | Deliveries per unit time | Increases over time; small dip on disruption, quick recovery |
| **Makespan / sum-of-costs** | Time for a batch of tasks | Competitively low |
| **Average delay** | Actual vs ideal (unobstructed) time | Low; strong recovery after disruption |
| **Replan count & replan scope** | How many agents/time-steps re-planned | **Small & local** → proves no global replan |
| **Replan latency** | Wall-clock to recover from a disruption | Milliseconds–low seconds |
| **Collisions** | Vertex/edge conflicts in executed plan | **0** |
| **Deadlocks** | Stuck robot clusters | **0** |
| **Congestion index** | Max/average local density or wait time | Bounded, drops after reroute |
| **Recovery time** | Ticks from disruption to normal throughput | Small |
| **Scalability curve** | per-tick cost vs N robots | Sub-quadratic / ~linear in local density |

The pair **"replan count stays small and local when a disruption happens"** is the single
best evidence that you satisfied the "no central bottleneck" requirement. Instrument it.

---

## 13. Suggested tech stack

- **Language:** Python 3 (fast to build, great viz). C++/Rust only if you need the speed.
- **Core:** NumPy for the grid/planner hot paths; `heapq` for A*/CBS open lists.
- **Viz:** pygame (recommended, smooth) or matplotlib/networkx for a quick start; or a
  small web front-end.
- **Sim loop:** fixed tick (e.g. 10–20 Hz) with an event queue.
- **Tests:** pytest. One headless scenario per disruption type.
- **Optional real-robot tie-in:** ROS 2 + Gazebo exists on this machine (`/home/ksp/ros2_ws`).
  Nice-to-have, **not required** — the deliverable is explicitly a *simulated grid*.

---

## 14. Phased plan

**Phase 0 — Skeleton**
- Repo layout, grid + map loader (`.map`), agent/task models, tick loop, pygame grid.

**Phase 1 — Static MAPF**
- A* single agent → prioritized planning with a reservation table.
- Visualize multiple robots moving collision-free to fixed goals.

**Phase 2 — Task allocation**
- Continuous task generation; market/auction allocation; robots pick up → deliver → repeat.
- Metrics panel (throughput, delay).

**Phase 3 — Dynamic re-routing (the core)**
- Congestion detection + congestion-aware costs.
- Edge failure: kill robot widget → release reservations → reallocate its tasks →
  neighbours reroute.
- Priority preemption: raise priority → yielding/step-aside.
- Prove replans are **local & incremental** (log scope).

**Phase 4 — Robustness & scale**
- Deadlock detection/avoidance, livelock guards.
- Stress at 8/16/32 robots; headless benchmark mode; scalability curve.

**Phase 5 — Polish**
- Event annotations, replay/heatmap, scenario presets, README + demo video, tests.

---

## 15. Deliverables checklist

- [ ] Source code, modular (`world/ sim/ agents/ tasks/ allocation/ planning/ comm/ render/ metrics/`).
- [ ] Working 2D visualization with disruption controls.
- [ ] Demonstrations (recorded/screenshots) of all **three** disruptions and recovery.
- [ ] Metrics logging + evidence that replanning is **local/incremental**.
- [ ] `README.md` with setup, run instructions, architecture diagram.
- [ ] Tests (at least one scenario per disruption) + a headless benchmark run.
- [ ] Short write-up mapping features → requirements (F1–F12) and to the SIH benefits.
- [ ] (Optional) comparison table vs a centralized baseline to show the improvement.

---

## 16. Definition of Done

The project is done when a reviewer can, **without reading the code**:
1. Launch the sim and see a multi-robot warehouse fleet delivering tasks on a 2D grid.
2. Block a corridor → watch robots **detour** and throughput **recover**, with no
   central freeze.
3. Kill a robot → watch survivors **reroute** and its tasks get **reassigned**.
4. Raise a task's priority → watch robots **yield/pre-empt** on the spot.
5. Confirm from the metrics/logs that **only affected agents** were replanned, and that
   **collisions = 0, deadlocks = 0**.

---

## 17. Glossary

- **AMR** — Autonomous Mobile Robot.
- **MAPF** — Multi-Agent Path Finding: find collision-free paths for many agents.
- **Vertex conflict** — two agents occupy the same cell at the same time.
- **Edge conflict** — two agents traverse the same edge in opposite directions.
- **Makespan** — time until the last agent finishes.
- **Sum-of-costs** — total steps over all agents (plan quality measure).
- **CBS** — Conflict-Based Search, an optimal MAPF algorithm.
- **Prioritized Planning** — plan agents one-by-one avoiding earlier agents' plans.
- **D\* Lite / LPA\*** — incremental search that repairs a previous path after changes.
- **Contract Net / auction** — decentralized task allocation by bidding.
- **Deadlock** — a cyclic wait where robots block each other forever.
- **Edge-AI** — computation done on the device (robot), not a central server.

---

## 18. References

- Problem source: SIH 2026, PS ID **26123**, *Edge-AI Based Distributed Fleet
  Coordination for Autonomous Mobile Robots in smart warehouses* (team Vector6 docs in
  `/home/ksp/Downloads/SIH 123.pptx.pdf`).
- MAPF benchmarks: <https://movingai.com/benchmarks/mapf.html> (local maps: `fusion26/maps/`).
- Stern et al., *Multi-Agent Pathfinding: Definitions, Variants, and Benchmarks*, SoCS 2019.
- Basics: Red Blob Games, *Introduction to A\** —
  <https://www.redblobgames.com/pathfinding/a-star/introduction.html>.
- Cited in submission (for framing, not necessarily implementation): DM³-Nav (IROS 2026),
  Swarm-SLAM, GNN-based decentralized multi-robot path planning.
