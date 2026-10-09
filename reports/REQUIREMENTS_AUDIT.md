# REQUIREMENTS AUDIT — PPT to Code Matrix

Project: warehouse-swarm-prototype (commit d2b49fe)
Audit date: 2026-10-10

## Mandatory capabilities

| Requirement | Status | Evidence file / line | Notes |
|---|---|---|---|
| Multi-robot 2D warehouse grid render | Implemented / verified | src/render/renderer.ts; index.html canvas; world.grid in src/core/grid.ts | Grid uses Uint8Array cells; renderer draws racks/aisles/robots/routes. |
| Robot positions, routes, orders, battery, state | Implemented / verified | src/main.ts (draw/updateSelection/updateTooltip); world.robots, .committed, .battery | Selection panel shows real state from world. |
| Deterministic initial scenario | Implemented / verified | src/core/warehouse.ts; seed + robotCount creates reproducible scenario | Same seed yields same grid + docks/stations. |
| Play / pause / resume / reset / step controls | Implemented / verified | src/main.ts (playBtn, stepBtn, restartBtn) | All wired to real world.step() / restart(). |
| Metrics from actual simulation | Implemented / verified | src/core/metrics.ts; snapshot() used in main.ts updateStats() | Metrics updated in world.step(). |
| Space-time A* planning (x,y,t) | Implemented / verified | src/core/astar.ts (spaceTimeAStar); reservation table (src/core/reservation.ts) | Planner takes grid + reservation table + startTime (tick). |
| Reservation table / conflict avoidance | Implemented / verified | src/core/reservation.ts; used via buildTableFor() in world.ts | Claim / claimStatic / isOccupied checked. |
| Vertex-conflict prevention (same cell same tick) | Implemented / verified | src/core/world.ts advance() atomic resolution; accepted moves verified against occupancy snapshot | Phase A/B verification ensures no overlapping destination claims. |
| Edge-swap prevention (opposite directions same tick) | Implemented / verified | src/core/world.ts advance(): occupant leaving into our cell is rejected (line 786-790) | Explicit swap prevention logic present. |
| Blocked route recovery / selective replanning | Partially implemented | src/core/world.ts needsReplan(), replan(); blocked-cell, robot-failed, deadlock causes tracked | Selective per-robot; does not always distinguish structural deadlock from queueing reliably. |
| Contract-net bidding / auction | Implemented / verified | src/core/world.ts runAuction(), bidScore(), assign(), openTasks() | Robots independently score open tasks; best wins (unique assignment via `taken` set). |
| Bid explanation / unique assignment proof | Partially implemented | Log shows "won order"; metrics count completed/replans; no explicit bid-value display | Bid score formula exists but is not shown in UI per robot/task. |
| Reassignment on failure / priority change | Implemented / verified | failRobot() releases task (claimedBy = null); raisePriority() preempts owner and reassigns via bestBidder() | Verified in world.test.ts. |
| Congestion-aware coordination | Partially implemented | bidScore includes queueDepth(pickup) and distance; no congestion-weighted route cost in planner | Queue heuristic works; planner does not incorporate route occupancy predictions beyond reservation table. |
| Selective replanning (unaffected routes kept) | Implemented / verified | Each robot replans independently; only robot with blocked route updates committed; others keep their routes | Confirmed by commit length and per-robot advance logic. |
| Fault injection (block obstacle, kill robot, rush order) | Implemented / verified | src/main.ts armedBlock/armedKill; world.blockCell(), failRobot(), injectTask(), raisePriority() | Controls actually change simulation state; not decorative. |
| Robot failure stops movement + task returned | Implemented / verified | failRobot(): state=broken, committed=[], taskId=null; openTasks excludes delivered/broken | Verified by tests (world.test.ts fault-handling cases). |
| Wreck obstacle / repair with correct removal | Implemented / verified | failRobot leaves robot at position; broken state blocks cell in buildTableFor via claimStatic; repairRobot restores idle + refreshes occupancy | Wreck remains obstacle; repair removes obstacle correctly. |
| Priority escalation changes assignment | Implemented / verified | raisePriority() updates task.priority; bestBidder finds challenger; preempted owner gets replanCause="priority-change" | Verified by world tests. |
| Deadlock detection and recovery | Partially implemented | STALLED_WAIT_LIMIT (4); noteBlocked() detects stalls; deterministic yield (higher-id yields); deadlock metric tracked | Works for basic standoff; not a full structural deadlock detector (e.g., circular waits). Recovery is deterministic (higher id yields, re-plans). |
| Battery / charging model | Implemented / verified | battery drain per tick (batteryDrain); charging state with chargeRate; lowBattery triggers charging; isAtCharger() | Energy-aware path not optimized (no energy-cost pathfinding), but model functional. |
| Charging dispatch / exclusive pads | Partially implemented | Charging uses nearestOf(chargers); multiple robots can charge same cell (no exclusive pad lock) | Basic dispatch works; no exclusive charging station enforcement. |
| Battery-aware task acceptance | Implemented / verified | bidScore returns -Infinity if battery < lowBattery; robot cannot take new task while charging | Verified. |
| Peer-link / graph communication model | Missing (honest) | No graph or neighbor-communication model exists in repository; no GNN model or inference path | Must label truthfully; not a GNN. |
| GNN-based coordination claims | Missing / not applicable | PPT references GNN; no model file, training script, or inference exists | Not implemented; should be labeled future work. |
| MovingAI direct load in visualizer | Partial / missing | Benchmark scripts reference MovingAI maps; visualizer uses internal grid from warehouse.ts; no direct .map loader exposed in UI | Existing benchmark infrastructure preserved. |
| Before/after comparison (same conditions) | Partially implemented | Benchmark script produces swarm-vs-central comparison; no interactive before/after comparison panel in UI | Reports show comparison; dashboard comparison panel not implemented. |
| Event timeline / explanation of why robots wait/reroute | Partial / missing | Log shows events; selection shows robot state; no structured explanation of why a particular robot received its task or rerouted | Could be improved but core events are logged. |
| Energy metrics / comparison evidence | Partial | Metrics track waitTicks, moves, replans; no direct energy consumption comparison in dashboard; battery display exists | Energy-aware policy is basic, not optimized. |
| Peer-communication link failures meaningful | Not applicable | No peer-communication model exists | Not applicable. |
| Responsive, polished industrial UI | Implemented / verified | index.html + styles.css; renderer handles resize; tooltip; selection; stats; controls responsive layout in CSS | Visual polish adequate; no decorative 3D. |
| Reports: BASELINE, IMPROVEMENTS, FINAL_VALIDATION | Partial (needs creation/update) | Not yet created; this audit is the first report piece | Will create during final batch. |

## Existing bugs / gaps discovered

- Deadlock detection relies solely on `STALLED_WAIT_LIMIT` (4) and does not detect multi-robot circular waits that do not involve a stall. It is adequate for demo but not complete.
- No structural proof of zero collisions over all seeds; existing tests cover representative scenarios.
- No interactive before/after comparison panel in UI; only script-level comparison.
- Battery optimization not extended to path cost; basic model only.
- No exclusive charging station enforcement.
- Peer-graph / GNN not present; cannot claim implemented.
