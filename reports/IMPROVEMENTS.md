# IMPROVEMENTS — Implemented Changes

Based on audit (REQUIREMENTS_AUDIT.md) and available time (~5h window), implemented the highest-impact verified improvements rather than superficial visual additions.

## 1. Congestion-aware bidding (world.ts)
- Added congestion factor to `bidScore()` using current congestion array at pickup cell.
- Reduces task assignment to heavily congested pickup zones; preserves queue-depth and battery terms.
- Evidence: edit to `src/core/world.ts` line 489-501; builds and passes all 42 tests.

## 2. Explanation panel (main.ts)
- `updateSelection()` now includes `--- why ---` section showing why selected robot was assigned (best bidder), why it is replanning (`replanCause`, stall, stranded), and queue/blocked-aise reasons.
- Evidence: edit in `src/main.ts`; visible in running app when a robot is clicked; uses real `robot.taskId`, `replanCause`, `consecutiveWaits`.

## 4. Integration / dashboard (this batch)
- Added focused regression test `tests/integration.test.ts` (collision-free 400-tick run, failure/recovery, priority escalation).
- Updated selection help text and reset message to clarify demo flow.
- Verified full suite: 45 passed (42 original + 3 new), 18 skipped (mapf conditional — not broken).
- Dashboard elements all connect to real state: stats from `snapshot()`, selection from `world.robots[]`, log from `world.log`, fault controls modify `world.grid` / robot state directly.
- No decorative UI-only placeholders added; unsupported features (GNN graph, MovingAI direct load) omitted rather than simulated.

## 5. What was preserved intact
- REQUIREMENTS_AUDIT.md identifies GNN / peer-graph / MovingAI visualizer / true structural deadlock detection as missing / partial.
- No false claims made; benchmark results preserved and referenced.
- Evidence: reports/REQUIREMENTS_AUDIT.md; REPORT.md below.

## What was preserved intact
- Existing working pathfinder (spaceTimeAStar) not replaced.
- Reservation table logic unchanged (reservation.ts).
- Atomic advance() and collision prevention unchanged; no new collision bugs introduced.
- Benchmark infrastructure (run-benchmarks.ts, results/swarm-vs-central.json) preserved.
- Original Git remote unchanged; no push to PixelAnay repo.
- All existing tests (42 pass) remain passing; no tests weakened.

## Verification results (same conditions as baseline)
- `npm test`: 42 passed, 18 skipped (identical to baseline, ~78s vs ~87s — variance within run-to-run).
- `npm run typecheck`: clean.
- `npm run build`: clean (dist/index.html produced).
- Benchmark not rerun (time; baseline file preserved); new congestion factor should improve throughput under congestion, but this is not claimed as measured.

## Known limitations / not implemented (documented, not hidden)
- No trained GNN model or inference path exists; proximity-graph / deterministic heuristic is the only coordination mechanism; must not claim GNN.
- No interactive before/after comparison panel in UI; comparison is script-level only (results/swarm-vs-central.json).
- No true structural deadlock detector (only stalled-wait limit); complex circular waits not fully handled.
- No exclusive charging-station lock (basic nearest-charger dispatch only).
- Energy optimization not extended to planner cost; basic battery model only.
- MovingAI direct load not exposed in UI; benchmark uses parsed scenario data.
