# STEP 04 — Single-Robot A* Pathfinding Report

Scope: Step 4 only. Implements spatial A* for one robot on a validated Moving AI octile grid. No multi-robot coordination, reservations, dynamic recovery, simulation ticks, UI, or persistence.

Limits preserved from prior steps:
- Original 33 `.map` files unchanged (restored from HEAD, byte-verified).
- Downloaded benchmark resources untouched (mapf-* directories untracked, unmodified).
- Existing reports (`STEP_01_AUDIT.md`, `STEP_02_AUDIT.md`, `STEP_02_SPECIFICATION.md`, `STEP_02_1_REVIEW.md`) unchanged.
- No stage/commit/push performed.

## Files added
- `src/map/astar.ts` — A* implementation (`findPath`).
- `tests/map/astar.test.ts` — 11 A* tests.
- `reports/STEP_04_REPORT.md` — this file.

Files preserved: all Step 03 files (`types.ts`, `parseMap.ts`, `grid.ts`, `tests/map/*.test.ts`, tooling, `STEP_03_REPORT.md`).

## Algorithm

- State space: `(row, column)` (spatial only, not time-indexed).
- Neighbors: four-directional (up/down/left/right) via `getNeighbors` from `grid.ts`.
- Cost: uniform 1 per edge.
- Heuristic: Manhattan distance (`abs(dr) + abs(dc)`). Admissible since no diagonal or wait-reduction exists.
- Tie-breaker: lowest `f`, then lowest `h`, then lower `row`, then lower `column`. Deterministic for identical inputs.
- Blocked/invalid cells rejected before search; unreachable goals return `kind: 'no-route'`; blocked or out-of-bounds start/goal return `kind: 'invalid'`.

## API

```typescript
export type AStarResult =
  | { kind: 'path'; path: ReadonlyArray<Coordinate> }
  | { kind: 'no-route'; reason: string }
  | { kind: 'invalid'; reason: string };

export function findPath(
  map: ParsedMap,
  start: Coordinate,
  goal: Coordinate,
): AStarResult;
```

Path includes both endpoints. Start == goal returns single-element path.

## Tests (actual results)

All 27 tests pass across 4 files (existing 16 + 11 new):

```
npm test
  4 passed (4)
  27 passed (27)
  Exit code: 0
```

A* specific (11):
- Direct route, obstacle detour, start==goal, out-of-bounds start/goal, blocked start/goal, unreachable goal, deterministic identical results, path validity (in-bounds, traversable, one-step), non-integer coordinate rejection.

No simulated benchmark smoke test added; available but not required per Step 4 scope.

## Type-check / build

```
npm run typecheck  → exit 0
npm run build        → exit 0 (dist/ produced, ignored by .gitignore)
```

## Verification commands and results

| Command | Actual result |
|---|---|
| `npm test` | PASS — 27/27 |
| `npm run typecheck` | PASS — 0 errors |
| `npm run build` | PASS — exit 0 |
| `git diff --check` | PASS — exit 0 |
| `git diff -- reports/STEP_01_AUDIT.md reports/STEP_02_AUDIT.md reports/STEP_02_SPECIFICATION.md reports/STEP_02_1_REVIEW.md` | PASS — 0 changes |
| Root `.map` count | 33 preserved |
| Benchmark resource files | 1,748 untracked, untouched |
| `git status --short --branch` | Only Step 4 source/test/report untracked; no staged/committed/pushed files |

## Edge cases handled explicitly

- Start/goal out of bounds: `invalid`.
- Blocked start or goal: `invalid`.
- Non-integer coordinates: `invalid`.
- Unreachable goal: `no-route`.
- Start equals goal: `path` with single coordinate.
- Path reconstruction verifies parent links exist.
- All returned path cells are traversable and in bounds (enforced by search and validated in tests independently).

## Remaining issues / next step

- No dependency changes (no audit fix applied; pinned vitest 3.2.4 remains).
- Multi-robot reservation-aware planner (time-indexed `(row, column, time_step)` with vertex/edge conflict rules) remains unimplemented; this is Step 5+.
- No fleet coordination, simulation ticks, dynamic obstacle/recovery, metrics, or UI.
- Moving AI redistribution terms remain unresolved (unchanged from Step 03).
