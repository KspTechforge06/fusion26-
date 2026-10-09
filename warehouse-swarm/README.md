# Warehouse Swarm

Decentralised coordination for warehouse robot fleets: multi-agent path finding with
graceful re-routing, visualised on a 2D grid. No central controller re-plans the
fleet.

```
npm install
npm run benchmarks:download   # 33 MovingAI MAPF maps (73 KB)
npm test                      # 53 tests
npm run dev                   # visualiser at http://localhost:5173
npm run bench                 # swarm vs centralised controller
```

---

## What it does

A seeded warehouse of racking aisles, docks, packing stations and charging pads.
Robot agents claim orders from a shared pool, route around each other and around
failures, and re-plan individually when the world changes under them.

**Fault injection** — click the grid to target a cell or a robot, or use the buttons:

| Fault | Behaviour |
|---|---|
| Drop shelving | Robots routed through it re-plan on their own next tick |
| Kill a robot | Its order returns to the pool; the wreck becomes a permanent obstacle |
| Escalate an order | The job is preempted and handed to whoever can reach it sooner |
| Auto faults | Random mix of the above at a chosen rate |

---

## ESP link (stream to the OLED node)

The simulation can stream itself to the ESP8266 OLED dashboard node over USB
serial — no server needed. The node renders the fleet on its **WEB / WROB**
OLED pages (see [`esp8266-dashboard/README.md`](esp8266-dashboard/README.md)).

1. `npm run dev` (or serve the built page from `localhost`).
2. Click **Connect ESP** (Chrome/Edge; Web Serial needs a secure context).
3. Pick the NodeMCU's USB-serial port — it starts streaming ~4 frames/s.

The node's own ESP-NOW telemetry keeps printing on the same port; the browser
drains it. The wire format and OLED wiring are in the node's README.

---

## Architecture

```
src/core/
  grid.ts         floor, 4-connectivity, flood fill
  codec.ts        the single owner of the (tick, cell) integer encoding
  heap.ts         binary min-heap, deterministic tie-breaking
  reservation.ts  space-time reservation table + permanent (wreck) obstacles
  astar.ts        A* over (x, y, t); BFS distance field
  conflicts.ts    vertex / edge conflict detection and validation
  cbs.ts          prioritized planning and Conflict-Based Search
  mapf.ts         MovingAI .map / .scen parsers
  scenario.ts     MAPF instance sampler, horizon sizing
  warehouse.ts    seeded warehouse generator
  world.ts        simulation loop, auction, faults, atomic executor
  baseline.ts     centralised controller, for comparison
  metrics.ts      throughput, latency percentiles, detour ratio
src/render/       canvas 2D view
scripts/          benchmark download, solver probe, A/B runner
```

### The idea the whole thing rests on

A single robot's path is a search over `(x, y)`. A fleet's is a search over
**`(x, y, t)`** — a cell is a different thing at every tick. That is what lets an
agent plan to occupy a cell once the previous occupant has cleared it, and it is
why MAPF is its own field rather than "A\* but harder".

Two rules are enforced on every step of every plan:

- **vertex conflict** — never enter a cell another agent holds at that tick
- **edge conflict** — never leave a cell another agent holds at the next tick.
  This is the swap case: A and B exchange cells in one step, never share a cell,
  and still collide.

The edge rule is the one that gets forgotten. It is why `tests/mapf.test.ts`
validates every produced plan for both.

### Two modes, deliberately

`spaceTimeAStar` takes an `allowContestedWait` flag, because the offline solver and
the online simulator want opposite things:

- **Strict (default)** — the plan is provably conflict-free. This is the contract
  the MAPF benchmark results rest on.
- **Relaxed (the live simulation)** — another robot's committed route is a
  *prediction* that goes stale the moment anyone re-plans. Treating it as an
  absolute barrier left a robot unable to move *or* wait whenever a neighbour's
  predicted path crossed its cell, so the search failed outright and the robot sat
  stranded. Measured: 44 orders delivered versus 21, with re-plans per order
  falling from 175 to 34.

### Safety lives in the executor, not the planner

Rolling-horizon planning runs against predictions that go stale. So
`world.advance()` resolves each tick **atomically**: every robot states an
intention, stayers claim their cells first, movers are accepted optimistically and
then verified, and a move is withdrawn if the robot occupying its destination is
not provably leaving somewhere other than our own cell.

This makes collisions **structurally impossible** rather than merely unlikely, and
it is what permits the planner to be relaxed. Measured across 7 seeds × 1200 ticks
with faults: **0 collisions**.

### Deadlock

Two robots meeting head-on each wait for the other, and neither re-plans because
both routes are still inside their commit window. A blocker that is neither moving
nor legitimately busy (loading, unloading, charging) is treated as stalled, and
the higher id yields deterministically. Ordinary queueing never trips this —
that distinction matters, because treating every queue as a deadlock caused a
livelock before it was fixed.

---

## Benchmark results

### Solver, against the 33 published MovingAI maps

Validated in `npm test`. Every instance the solver accepts is checked for vertex
conflicts, edge conflicts, off-grid moves and unreached goals.

| Map | Agents | Result |
|---|---|---|
| `random-32-32-10/20`, `room-32-32-4`, `room-64-64-8` | 64–96 | solved, 0 violations |
| `warehouse-10-20-10-2-1`, `-2-2`, `20-40-10-2-1` | 64 | solved, 0 violations |
| `warehouse-20-40-10-2-2` (340×164) | 96 | solved, 0 violations |
| `maze-32-32-4` (1-cell corridors) | 8–64 | solved up to 48; fails cleanly beyond, never with collisions |

Suboptimality against the optimality lower bound stays under 1.25×, and typically
lands at 1.00–1.09 — CBS reaches the lower bound outright on warehouse maps.

Two findings worth naming:

- **Prioritized planning is far weaker than it looks.** It is complete only for its
  agent ordering, and on a 1-wide maze it failed at 48 agents until the solver was
  given several orderings to retry. That change alone took the maze ceiling from
  32 to 48.
- **Oversubscription must fail loudly.** On a saturated maze the solver reports a
  reason rather than returning colliding paths. That invariant is tested directly.

### Swarm vs centralised controller

Identical warehouse, fleet and fault schedule (`npm run bench`, 14 robots, a fault
every 40 ticks):

| | Throughput /100t | p95 latency | Wall ms per run |
|---|---|---|---|
| Swarm | **2.00** | 466 | 2062 |
| Centralised | 1.06 | 367 | 348 |

Read honestly, this **favours the central controller** on these numbers, and the
report should not pretend otherwise:

- The centralised solver reasons globally and produces shorter routes, so its p95
  latency is lower.
- In wall-clock the swarm is *slower*, because each robot independently runs A\*
  every commit window. The swarm trades CPU for fault isolation; at these fleet
  sizes that is not a good trade on raw throughput.

Where centralisation actually loses is **scaling**, and it loses badly. Given a
generous horizon, node budget and time limit, whole-fleet CBS solved 6 robots and
14 robots, but returned **no plan at all** for 10 and 28 robot fleets, leaving
hundreds of robots stalled per run:

| Robots | Swarm orders | Central orders | Central planner ms |
|---|---|---|---|
| 6 | 18 | 19 | 16 |
| 10 | 21 | **0** | 38 |
| 14 | 17 | 10 | 38 |
| 20 | 18 | 7 | 53 |
| 28 | 20 | **0** | 138 |

Joint MAPF is much harder than independent MAPF, and a central bottleneck does not
merely get slower as the fleet grows — it stops being able to answer at all. That
is the strongest argument here, and it is an empirical one rather than an
architectural assertion.

### Simulation health

14 robots, 1200 ticks, faults injected — typical seed:

- **0 collisions**, guaranteed by construction
- detour ratio **1.00–1.16** — coordination costs 0–16% extra walking
- robots are stationary ~37% of ticks

That idle fraction is the main weakness. Throughput is dock- and lane-bound rather
than coordination-bound, and improving it means revisiting the warehouse layout and
commit-window policy. The detour ratio and collision count are the numbers that
reflect coordination quality; throughput currently does not.

---

## Known limitations

- Robots idle ~37% of the time; throughput is lower than the fleet could reach.
- Task allocation is a first-price auction computed every tick. It ignores future
  contention, so two robots will bid for the same congested aisle.
- Charging is modelled but not optimised; robots drain at a constant rate.
- The visualisation does not yet load the MovingAI maps directly, though the
  solver and tests both use them.

## Attribution

Benchmark maps and scenarios from [MovingAI Lab](https://movingai.com/benchmarks/mapf.html),
used under the Open Data Commons Attribution License. Cite Stern, Sturtevant et al.,
*Multi-Agent Pathfinding: Definitions, Variants, and Benchmarks*, SoCS 2019, if
this is used in published work.