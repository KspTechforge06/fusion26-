# STEP 02 — Warehouse Robot Simulation Specification

**Document type:** Design specification only. No application, UI, backend, or test suite is implemented by this document.

## 1. PROJECT SCOPE

### Problem

The project models a fleet of warehouse robots moving delivery tasks through a two-dimensional grid. Several robots may need to move at the same time, so each robot needs a route that is valid for the map and safe relative to the other robots. A route can become unsafe when a dynamic obstacle appears, a robot fails, or task priorities change. The system therefore needs single-robot pathfinding plus time-aware fleet coordination, replanning, and task recovery.

### Minimum viable implementation (MVP)

The first implementation should provide:

- Loading one validated Moving AI octile map without changing its source file.
- Four-directional movement on traversable cells.
- A* pathfinding for one robot at a time.
- Multiple robots with unique IDs, goals, paths, and operational states.
- Prioritized reservation-based coordination with vertex and edge-swap protection.
- Wait actions when a safe move is temporarily unavailable.
- Deterministic simulation ticks.
- Basic dynamic-obstacle handling, robot-failure handling, priority changes, and no-progress detection.
- A 2D grid visualization of obstacles, robots, goals, and paths.
- Metrics defined in Section 9.

The MVP is a design target, not an implemented feature in Step 02.

### Future enhancements

The following are deliberately deferred: diagonal movement, globally optimal multi-agent planning, lifelong multi-agent search, continuous-time kinematics, battery/charging models, realistic motion dynamics, persistence, networked control, learned dispatching, and advanced corridor deadlock recovery.

## 2. MAP FORMAT AND COORDINATES

### File format

A map is a text file with this structure:

```text
type octile
height H
width W
map
<exactly H grid rows, each exactly W characters>
```

The parser must require the four header lines in that order. `H` and `W` must be positive decimal integers. The source file is read-only from the simulation's perspective; loading must never rewrite, normalize, or repair it.

The initial implementation recognizes:

- `.` — traversable cell;
- `@` — obstacle;
- `T` — obstacle.

The parser must reject an empty/unreadable file, malformed headers, non-positive dimensions, a missing map marker, a wrong row count, a wrong row width, an unknown character, or truncated data. Errors must include the file path and the relevant line/row/column where practical. Unknown characters are never treated as walkable.

The parser should validate `H × W` cells before constructing the in-memory map. Large maps should be streamed or read into bounded line storage as appropriate for the selected runtime, but they must not be copied into or modified on disk. The implementation must not impose a fixed small-map limit.

### Coordinates and boundaries

Use zero-based `(row, column)` coordinates:

- `(0, 0)` is the top-left cell;
- row increases downward;
- column increases to the right.

A coordinate `(r, c)` is in bounds exactly when `0 <= r < height` and `0 <= c < width`. Any out-of-bounds start, goal, event location, or proposed move is rejected with a validation error. A start or goal on `@` or `T` is rejected. A robot may move only to an in-bounds `.` cell.

### Movement model

The MVP uses four-directional movement only: up `(-1, 0)`, down `(1, 0)`, left `(0, -1)`, and right `(0, 1)`. Each move costs 1. Diagonal movement is not allowed. This makes adjacency, edge conflicts, and collision checking unambiguous and avoids corner-cutting rules.

## 3. ROBOT DATA MODEL

Each robot has the following minimum state:

| Field | Meaning |
|---|---|
| `robotId` | Unique, stable identifier. |
| `position` | Current `(row, column)` cell. |
| `taskId` / `goal` | Assigned delivery task and its destination cell; absent when idle. |
| `path` | Ordered planned positions, including the current position. |
| `pathIndex` | Index of the robot's current position in `path`. |
| `status` | One of `IDLE`, `MOVING`, `COMPLETED`, or `FAILED`. |
| `priority` | Optional integer or comparable value used by the deterministic planner; higher priority wins unless the task policy says otherwise. |

A task should additionally have a stable `taskId`, pickup/delivery information if needed by the later implementation, a goal, a priority, and an assignment state. Task state is not robot state and should remain in the task/dispatch layer.

### State transitions

- `IDLE -> MOVING`: a valid task is assigned and a safe non-empty plan is committed.
- `MOVING -> COMPLETED`: the robot reaches its goal and the task is marked complete.
- `MOVING -> IDLE`: the current task is removed or reassigned before completion, with reservations released.
- `MOVING -> FAILED`: a failure event is accepted; future movement is disabled immediately.
- `FAILED -> FAILED`: failure is terminal for the MVP; recovery of hardware is deferred.
- `COMPLETED -> IDLE`: allowed only if a new task is explicitly assigned.
- `IDLE -> FAILED`: allowed if an idle robot reports a failure.

A completed robot has successfully reached its goal and does not move unless assigned a new task. A failed robot is unavailable, cannot execute additional movements, and may continue to occupy a blocked cell according to the policy in Section 7.

## 4. PATH REPRESENTATION

A path is an ordered list of `(row, column)` positions. The starting cell is included at index 0, and the goal is the final position. For a path from start `s` to goal `g`, `path[0] = s` and, if successful, `path[last] = g`.

A wait action is represented by repeating the current cell in the next time slot. For example, `[(2, 2), (2, 2), (2, 3)]` means wait one tick, then move right. A wait is legal only if the cell is reserved for that robot at both times and no edge or vertex rule is violated.

One simulation time step (tick) advances the reservation time by one. A robot's intended transition for tick `t -> t+1` is `(position_at_t, position_at_t+1)`. A robot that reaches its goal remains at the goal in subsequent planning horizons unless it is assigned a new task; its continued occupancy must be represented both by horizon-limited reservations and by persistent physical occupancy while it remains parked in the simulation. A robot waiting in place similarly remains physically occupying its current cell; waiting does not make that cell available to another robot.

If no valid route exists, the robot keeps its current position, has no committed future path, and remains `IDLE` if it has not started the task or `MOVING` with a blocked/unplanned condition if the task was already active. The exact UI label should distinguish `UNPLANNED` from the four required robot statuses without pretending that an unplanned robot is failed. If an additional status is not desired, record the condition as a task/planning error while leaving the robot `IDLE`.

Before each movement, the engine must verify that the path version and reservations used to plan it are still current. A robot must not advance along a stale path after a map, failure, priority, or reservation disruption. The path is invalidated and replanned instead.

## 5. SINGLE-ROBOT PATHFINDING

The initial algorithm is A* over the four-directional grid.

- **Start node:** the robot's current position.
- **Goal node:** the assigned task's goal cell.
- **Neighbors:** in-bounds cells one step up, down, left, or right.
- **Blocked nodes:** map obstacles plus any cells explicitly blocked by the current planning context.
- **Move cost:** 1 per move.
- **Path cost `g(n)`:** cost from the start to node `n`.
- **Heuristic:**

  ```text
  h(n) = abs(row_n - row_goal) + abs(col_n - col_goal)
  ```

- **Priority:** select the open node with the lowest `f(n) = g(n) + h(n)`; use deterministic tie-breakers such as lower `h`, then row, then column.
- **Open set:** candidates discovered but not fully expanded, with their best known scores.
- **Closed set:** nodes already expanded at their best known score.
- **Parent map:** records the predecessor used to reconstruct the path.

A node is not expanded if it is out of bounds, an obstacle, or blocked by a planning reservation when the reservation-aware planner invokes A*. The goal is valid only if it is traversable and reachable under the current constraints.

When the goal is reached, follow parent links back to the start, reverse the sequence, and include both endpoints. If the open set becomes empty before reaching the goal, return `NO_ROUTE` with a reason and do not fabricate a partial route. This ordinary spatial A* uses `(row, column)` as its search state and is intentionally separate from the time-aware reservation planner below. Ordinary A* solves one robot's route; it does not by itself guarantee collision-free multi-robot execution.

## 6. MULTI-ROBOT COORDINATION

The MVP uses prioritized, reservation-based, time-aware planning. Robots are planned in deterministic priority order: higher task priority first, then lower `taskId`, then lower `robotId` as tie-breakers. The ordering is recorded for each planning cycle.

### Reservations

A reservation table contains:

1. **Vertex reservations:** `(cell, time) -> robotId`. A reservation means that the robot occupies the cell at the start of that time slot.
2. **Directed edge reservations:** `(from_cell, to_cell, time) -> robotId`. A reservation means that the robot traverses that directed edge during the interval from `time` to `time + 1`.
3. **Persistent physical occupancy:** `cell -> robotId` for a robot that physically remains in the cell beyond the finite planning horizon. This is separate from a time-limited future reservation.

### Time-aware reservation search

The reservation-aware planner's search state is exactly `(row, column, time_step)`. It represents one robot at cell `(row, column)` at the beginning of `time_step`; the same cell at two different times is therefore two different search states. The initial state is `(start_row, start_column, current_time)`. A movement successor changes the cell to one valid four-directional neighbor and advances time by one: `(r, c, t) -> (r2, c2, t + 1)`. A wait successor preserves the cell and advances time by one: `(r, c, t) -> (r, c, t + 1)`.

For every successor, the planner checks persistent physical occupancy and time-limited vertex reservations at the **arrival time** `t + 1`. Persistent occupancy is treated as blocking unless the occupying robot has a validated, conflict-free departure in the same transition interval; only then can the cell become available at `t + 1`. Thus a robot may follow another robot into a cell that is safely vacated, but never pass through a cell whose occupant remains there. A movement transition also checks the directed edge reservation for `(from, to, t)` over the interval `t -> t + 1`, and rejects it if an existing reservation uses the reverse edge `(to, from, t)` during that same interval. A wait transition is subject to the same arrival-vertex check and must retain the robot's current occupancy reservation for the interval. The planner must not route through a persistent-occupancy cell merely because no time-indexed reservation exists for it.

The finite planning horizon is a configurable positive number of ticks. Search expands only states with `time_step <= current_time + horizon`; successors that would exceed that bound are not generated. A goal is successful only when reached at an allowed time within the horizon and after its arrival checks pass. If no safe goal state is found within the horizon, the planner returns `NO_SAFE_ROUTE_WITHIN_HORIZON`, commits no partial future reservations, and leaves the robot at its last safe position for a later replanning attempt. The spatial A* heuristic remains `h = Manhattan distance to the goal`; it is admissible because waiting costs one tick and cannot reduce the minimum number of grid moves. Time is part of the state and is never discarded when comparing, closing, or deduplicating search states.

The planning horizon limits future reservations, not physical occupancy. A robot that will remain in a cell after the horizon is represented in persistent physical occupancy, so another robot cannot be routed through it merely because its time-indexed reservations ended.

The planner must reserve a robot's current position at the current time and reserve its future path positions and directed edges. A robot that has completed a task reserves its goal for the horizon while it remains there, and its persistent occupancy record protects the goal beyond the horizon.

### Conflict rules

- **Vertex conflict:** two different robots occupy the same cell at the same simulation time. This is prohibited.
- **Edge-swap conflict:** robot A traverses `u -> v` while robot B traverses `v -> u` during the same interval. This is prohibited.
- A robot may enter a cell another robot just vacated only when the destination vertex reservation at the arrival time is free and the directed edge reservation rules show no edge swap. The fact that a cell was occupied at the prior time alone is not a conflict.
- A wait `u -> u` is allowed only when robot u has a vertex reservation for `u` at both the departure and arrival times. It must not collide with another robot's reservation.
- A robot may not be assigned a goal currently occupied or reserved by another robot unless task semantics explicitly support shared goals. The MVP does not support shared goals; the assignment is rejected or delayed.
- Map obstacles and disabled robots treated as blocking remain unavailable regardless of reservation ownership.

For each robot in priority order, the planner searches through moves plus a wait successor. A candidate transition is accepted only if its arrival vertex is free, its directed edge is free, and it does not reverse an existing edge reservation at the same time. On success, all future vertex and edge reservations for that path are committed atomically. On failure, no partial reservations from that attempt remain; the system reports `NO_SAFE_ROUTE` and leaves the robot unplanned or waiting according to task state.

Reservations are released when their time slots expire, when a path is invalidated, or when a robot completes/cancels a task. Persistent physical occupancy is not released by horizon expiry or by another robot's replanning: it remains while a completed robot is parked at its goal, while a failed robot remains physically present, or while any robot is physically waiting in its cell. Current occupancy reservations remain until the robot actually leaves the cell. When a robot legitimately leaves a cell, the engine updates/removes that cell's persistent occupancy at the same atomic movement commit; an explicit removal/recovery event also clears the occupancy only for the physically removed robot. Replanning must remove only the replanning robot's old future reservations before searching, never another robot's current or persistent occupancy, then commit the replacement only after the complete candidate path passes validation.

This prioritized method is not complete and is not globally optimal: a lower-priority robot may fail even when a joint solution exists, and the priority order can affect distance and fairness.

## 7. DISRUPTIONS AND RECOVERY

### A. Dynamic obstacle or blocked route

1. Process the event at the beginning of a tick.
2. Validate that the event location is in bounds and update the dynamic-block set, without modifying the source map.
3. Identify robots whose current/future paths or reservations use the affected cell or edge.
4. Invalidate unsafe future path segments and release their future reservations.
5. Keep each affected robot at its last safe position; it must not execute an invalid next move.
6. Replan affected robots in deterministic priority order using the updated blocked set.
7. If no safe route is found, report `NO_SAFE_ROUTE`, retain the robot at its safe position, and keep the task unfinished.

A dynamic obstacle cannot be placed on a currently occupied robot cell without an explicit policy decision; the MVP should reject that event or treat it as an emergency state requiring a later safety policy.

### B. Robot failure

On a failure event, set the robot's status to `FAILED`, cancel its future movements, and release only its future time-limited reservations. The failed robot cannot move again in the MVP. Its current cell receives persistent physical occupancy from the disabled robot and remains blocked until an explicit removal/recovery event exists; this conservative rule prevents other robots from being planned through its physical location, even after the planning horizon ends. Replan robots that depended on its reservations or whose routes are blocked by its cell. If the failed robot owned an unfinished task, mark the task unassigned and make it eligible for reassignment.

### C. Priority change

Represent task priority as an integer where a larger value means more urgent, unless the dispatch policy explicitly chooses the opposite. A priority change is queued as an event and takes effect at the next tick boundary. Reassignment is allowed when a task is unassigned, its robot has failed, or the policy determines that the benefit exceeds a configured threshold. Do not continuously churn assignments on equal or nearly equal priorities.

Use this deterministic tie-break order: higher priority first, then lexicographically smaller `taskId`, then smaller `robotId`. Replanning after a priority change must invalidate affected future reservations and commit a new coordinated plan before movement.

### D. Narrow-corridor deadlock

Collision avoidance does not guarantee progress: robots can legally wait forever or block one another in a corridor. Track each robot's position and task progress. If no affected robot reduces its Manhattan distance to its current goal and no task completes for a configurable number of consecutive ticks, emit a `NO_PROGRESS`/deadlock-candidate event.

The MVP recovery policy is conservative: stop the involved robots, retain their current safe positions, release only future reservations, and run one deterministic replan with reversed priority for the lowest-priority involved robot. If that attempt fails, keep the robots stopped and report a planning failure for operator intervention. Complete corridor negotiation, backtracking, and global deadlock resolution are future enhancements.

## 8. SIMULATION ENGINE AND VISUALIZATION

The design separates these modules:

- **Map data:** immutable static obstacles, dimensions, and validated cells; dynamic blocked cells are a separate overlay.
- **Occupancy state:** current physical positions and persistent occupancy for parked, failed, or waiting robots; this is distinct from expiring future reservations.
- **Pathfinding:** A* and reservation-aware search; no UI responsibilities.
- **Coordination:** priority ordering, reservation tables, conflict checks, and replanning.
- **Robot/task state:** robot lifecycle, assignments, goals, and progress.
- **Simulation updates:** event queue, tick sequencing, and movement commits.
- **Metrics:** counters and durations derived from state transitions and events.
- **User interface:** renders map and state; sends commands/events but does not decide whether a move is safe.

### Deterministic tick

The final tick order is:

1. **Process queued events:** apply validated obstacle, failure, task, and priority events at the tick boundary.
2. **Invalidate paths and reservations:** remove future reservations affected by those events or by stale map/path versions.
3. **Replan affected robots:** plan in the deterministic priority order, including wait actions, and commit complete replacement reservations atomically.
4. **Compute intended moves:** each active robot proposes its next path transition for this interval.
5. **Validate the joint move set:** check map/dynamic obstacles, persistent physical occupancy, vertex reservations at arrival time, same-destination conflicts, and opposite directed edges. A proposed destination is invalid if another robot will still physically occupy it, regardless of whether that robot's finite-horizon reservation has expired.
6. **Commit safe movements atomically:** either apply the validated move for each robot or hold a robot at its current cell and record the reason; never partially apply a conflicting move. Update persistent occupancy at this same commit: remove it from a cell only when its robot legitimately leaves, and retain it for a robot that waits, completes and parks, or fails.
7. **Update robot/task states:** advance path indexes, mark reached goals `COMPLETED`, and preserve failures as terminal.
8. **Update reservations:** consume expired future intervals, retain current occupancy and all persistent occupancy, and ensure the committed positions agree with the table.
9. **Update metrics and visualization data:** record events, conflicts prevented, invalid moves, progress, and renderable state.

This order ensures that an event cannot be followed by movement on an old path and that reservations describe the positions actually committed.

### Visualization

The intended visualization is a 2D grid showing static obstacles, dynamic blocked cells, robot positions/IDs, goals, planned paths, failures, and a tick/metric panel. It is a proposed interface only. No framework is selected because the current workspace has no application stack or package manifest.

## 9. METRICS

Metrics are collected per simulation run and, where useful, per task or robot.

| Metric | Calculation | Meaning |
|---|---|---|
| Tasks completed | Count of tasks entering `COMPLETED`. | Absolute delivery output. |
| Task completion rate | Completed tasks / total accepted tasks, reported with denominator. | Fraction completed by the observation end. |
| Total path distance | Sum of non-wait grid moves executed by all robots. | Actual fleet travel, not merely planned distance. |
| Simulation/delivery time | Number of ticks from run start to task completion; report makespan and per-task duration. | Time efficiency. |
| Replanning events | Count each committed replanning cycle, including disruption-triggered cycles. | Planning workload/adaptation. |
| Recovery time | Ticks from disruption event to affected task's next safe plan or completion; report both if a route is never recovered. | Disruption response. |
| Vertex conflicts | Count attempted or detected same-time same-cell conflicts before prevention. | Safety pressure; must remain zero after validation/commit. |
| Edge-swap conflicts | Count attempted opposite-edge traversals detected in one interval. | Safety pressure; must remain zero after validation/commit. |
| Invalid moves | Count proposals rejected for bounds, obstacles, stale paths, reservations, or failed status. | Execution correctness. |
| Failed tasks | Count tasks whose assigned robot failed and were not completed by run end. | Unfinished work caused by failure. |
| Unassigned tasks | Count accepted tasks without an eligible robot at observation end. | Dispatch shortfall. |
| No-progress events | Count configured deadlock/lack-of-progress detections. | Liveness warning. |

A **safety violation** is a committed prohibited vertex conflict or edge swap; it must be zero. A **prevented conflict** is a detected proposal that was rejected or delayed before commit and is counted separately in conflict metrics. A **planning failure** means no safe route was found under the current constraints; it is not automatically a safety violation. An unfinished task is any task not completed at the observation end, regardless of whether it failed, remained unassigned, or was awaiting a route.

No performance results are reported here because no application exists and no simulation was run.

## 10. ACCEPTANCE TEST PLAN

These are future acceptance tests. **Every test is NOT RUN in Step 02 because the application has not been implemented.**

1. **MAP-001 — Valid map loads correctly**  
   **Setup:** Use one of the validated octile maps. **Action:** Load it through the parser. **Expected:** Dimensions and every cell match the file; no error is returned. **Verification:** Compare parsed dimensions/cell symbols with a known fixture. **Status: NOT RUN.**

2. **MAP-002 — Malformed map is rejected**  
   **Setup:** Fixture with a wrong header, row count, row width, or unknown symbol. **Action:** Load it. **Expected:** Loading fails with a useful file/line/row/column error. **Verification:** Assert failure category and diagnostic location. **Status: NOT RUN.**

3. **MAP-003 — Out-of-bounds coordinates are rejected**  
   **Setup:** Valid map and coordinates such as `(-1, 0)` or `(height, 0)`. **Action:** Use them as start, goal, or event locations. **Expected:** Validation rejects them before planning. **Verification:** Assert the bounds error and no state mutation. **Status: NOT RUN.**

4. **MAP-004 — Blocked start or goal is rejected**  
   **Setup:** Valid map with a selected `@` or `T` cell. **Action:** Use it as a start or goal. **Expected:** Assignment/planning is rejected. **Verification:** Assert the blocked-cell error. **Status: NOT RUN.**

5. **PATH-001 — A* routes around an obstacle**  
   **Setup:** Small map where a direct route is blocked but a four-directional detour exists. **Action:** Plan from start to goal. **Expected:** Path begins at start, ends at goal, uses only valid neighbors, and avoids obstacles. **Verification:** Check every path transition and endpoint. **Status: NOT RUN.**

6. **PATH-002 — A* reports no route**  
   **Setup:** Map partitions the start from the goal. **Action:** Plan. **Expected:** Result is `NO_ROUTE`, with no fabricated partial path. **Verification:** Assert result code and empty committed path. **Status: NOT RUN.**

7. **ROBOT-001 — Robot follows path to goal**  
   **Setup:** One robot with a valid path. **Action:** Advance deterministic ticks. **Expected:** It moves one path transition per tick and becomes `COMPLETED` at the goal. **Verification:** Inspect positions, path index, and final status. **Status: NOT RUN.**

8. **COORD-001 — Vertex conflicts are prevented**  
   **Setup:** Two robots whose uncoordinated routes would arrive at one cell simultaneously. **Action:** Plan and execute. **Expected:** No committed same-time cell occupancy; one robot waits or replans. **Verification:** Inspect time-indexed positions and safety counter. **Status: NOT RUN.**

9. **COORD-002 — Edge swaps are prevented**  
   **Setup:** Two adjacent robots with opposite goals. **Action:** Plan and execute. **Expected:** They do not traverse the shared edge in opposite directions in one interval. **Verification:** Inspect directed edge reservations and committed transitions. **Status: NOT RUN.**

10. **COORD-003 — Wait actions are handled**  
    **Setup:** A route temporarily requires a robot to remain in place. **Action:** Plan with a wait successor. **Expected:** Repeated position is represented, reserved safely, and followed for one tick. **Verification:** Check path sequence, vertex reservations, and position history. **Status: NOT RUN.**

11. **RECOVER-001 — Blocked route triggers safe replanning**  
    **Setup:** Moving robot with a future route; inject a dynamic obstacle on that route. **Action:** Process the event at a tick boundary. **Expected:** Unsafe future path is invalidated, robot does not enter the blocked cell, and a safe replacement is committed if available. **Verification:** Check event log, reservations, and transitions. **Status: NOT RUN.**

12. **RECOVER-002 — Failed robot cannot move afterward**  
    **Setup:** Active robot with a future path. **Action:** Inject a failure event, then advance ticks. **Expected:** Status is `FAILED` and position never changes afterward. **Verification:** Assert all post-failure transitions are absent. **Status: NOT RUN.**

13. **RECOVER-003 — Failed robot task is handled**  
    **Setup:** Robot failure while its task is unfinished. **Action:** Process failure and dispatch cycle. **Expected:** Task becomes unassigned/eligible according to policy, failed robot remains unavailable, and another eligible robot may receive it. **Verification:** Inspect task assignment and robot status. **Status: NOT RUN.**

14. **DISPATCH-001 — Priority changes use deterministic rules**  
    **Setup:** Tasks with different and equal priorities. **Action:** Queue a priority change and replan. **Expected:** Higher priority is considered first; equal priorities use task ID then robot ID; assignment does not churn without policy justification. **Verification:** Compare planning order and assignment log across runs. **Status: NOT RUN.**

15. **LIVE-001 — Lack of progress is detected**  
    **Setup:** Robots in a narrow corridor that cannot progress under current reservations. **Action:** Advance the configured no-progress window. **Expected:** A `NO_PROGRESS`/deadlock-candidate event is emitted and the conservative recovery policy runs. **Verification:** Inspect progress history, event log, and resulting reservations. **Status: NOT RUN.**

16. **DETERM-001 — Repeated runs are consistent**  
    **Setup:** Same map, robots, tasks, event sequence, priorities, and seed/configuration. **Action:** Run the simulation more than once. **Expected:** Same planning order, movements, event results, and metrics when deterministic mode is selected. **Verification:** Compare serialized event traces and metrics. **Status: NOT RUN.**

## 11. ASSUMPTIONS AND UNRESOLVED DECISIONS

### Settled for the MVP

- Coordinates are zero-based `(row, column)`.
- Maps use validated Moving AI octile headers and `.`, `@`, `T` symbols.
- Movement is four-directional with unit cost.
- A* uses Manhattan distance.
- Vertex conflicts and edge swaps are prohibited.
- Reservations are time-indexed by cell and directed edge.
- Waiting repeats a cell and requires reservations.
- Planning order is deterministic by priority, task ID, and robot ID.
- Failed robots cannot move and conservatively keep their cells blocked.
- The simulation tick order is the sequence in Section 8.

### Assumptions

- A cell is small enough that one robot is its only occupant at a time.
- All robots move one grid edge per tick and have identical movement duration.
- Events are delivered to the simulation queue before the tick in which they take effect.
- A goal is exclusive in the MVP.
- The map's static obstacles do not change; dynamic obstacles are an overlay.
- The initial implementation can choose a finite planning horizon and make it configurable.

### Unresolved decisions before implementation

- Programming language and UI framework are not selected; the workspace has no package manifest or evidence of an existing stack.
- The exact planning-horizon default and maximum map/runtime memory budget need confirmation.
- The task schema for pickup locations, multi-stop deliveries, and cancellation needs confirmation.
- The dynamic-obstacle event source and policy for an obstacle requested on an occupied cell need confirmation.
- Whether a failed robot is eventually physically removed needs confirmation; the MVP keeps it blocking.
- The priority-change benefit threshold and no-progress tick threshold need configuration review.
- The exact visualization interaction model and persistence format need confirmation.

### Deferred features

Diagonal motion, shared goals, continuous-time motion, globally optimal multi-robot planning, advanced deadlock recovery, robot repair, charging, network control, and production deployment are outside Step 02.

## 12. REFERENCES

- `reports/STEP_01_AUDIT.md` — existing workspace audit inspected for the 33 supplied map files, their format, dimensions, counts, and hashes.
- The Moving AI octile map structure and symbol meanings are defined by the project requirements and reflected in the Step 01 audit. No additional external reference files were present in the workspace, and no external source was consulted for this specification.

## Document verification notes

This specification was written as a design document only. It does not claim that any pathfinding, coordination, visualization, recovery behavior, metric collection, or acceptance test has been implemented or executed.
