# STEP 03 — Map Foundation Report

## Scope implemented

This hardening pass first restored the 33 original root `.map` files directly from `HEAD` after they were found deleted in the working tree. The downloaded benchmark resources were not modified. Step 03 adds the smallest useful application foundation for the warehouse robot project:

- Strict TypeScript types for coordinates, map cells, and parsed maps.
- A read-only parser for the Moving AI octile `.map` format.
- Four-directional grid and coordinate-validation utilities.
- Automated tests for parser and grid behavior, including all 33 repository maps.
- Minimal Node/TypeScript/Vitest tooling.

This step does **not** implement A*, multi-robot coordination, reservations, simulation ticks, disruption recovery, task reassignment, or a user interface.

## Files created

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/map/types.ts`
- `src/map/parseMap.ts`
- `src/map/grid.ts`
- `tests/map/parseMap.test.ts`
- `tests/map/grid.test.ts`
- `reports/STEP_03_REPORT.md`
- `tests/map/integrity.test.ts`

The four existing reports were not modified. The original `.map` files were restored from `HEAD` only; no downloaded benchmark resource was modified, moved, renamed, or deleted.

## Parser behavior

`src/map/parseMap.ts` provides `parseMapText` and the read-only `parseMapFile` wrapper, plus the typed `MapParseError` error class.

The parser requires, in order:

```text
type octile
height H
width W
map
<exactly H rows of exactly W symbols>
```

It accepts these symbols without rewriting them:

- `.` — traversable terrain
- `@` — blocked terrain
- `T` — blocked terrain

It rejects invalid or missing headers, non-positive or malformed dimensions, unsafe dimensions, a `height × width` product that exceeds safe storage, a missing or invalid `map` marker, truncated grids, extra grid rows, incorrect row widths, and unsupported symbols. Positive dimensions may contain leading zeros; signs, decimals, and whitespace are rejected. A single conventional terminal newline is accepted. Errors include the source name and line or column context where applicable. Line-ending normalization is limited to parsing in memory; source files are never written. Unreadable files are reported as `MapParseError` instances with the path.

## Grid and coordinate conventions

`src/map/grid.ts` uses zero-based `{ row, column }` coordinates. It provides:

- `isInBounds`
- `isTraversable`
- `getNeighbors`
- `validateWalkCoordinate`
- `validateStartAndGoal`

Neighbors use only up, down, left, and right movement. They are returned in deterministic order and exclude blocked and out-of-bounds cells. Invalid coordinates and blocked start/goal cells raise `CoordinateValidationError`.

## Automated tests and actual results

The test suite contains 16 tests across 3 test files:

- Valid maps and differing dimensions.
- Missing or malformed type, width, height, and map marker.
- Truncated grids, incorrect row widths, unsupported symbols, extra rows, terminal newlines, leading-zero dimensions, and unsafe dimensions.
- Traversable versus blocked symbols.
- Negative and out-of-bounds coordinates.
- Blocked start and goal coordinates.
- Four-directional neighbors, edge/corner behavior, and diagonal exclusion.
- Parsing all 33 repository maps through the real parser.

Actual command and result:

```text
npm test
Test Files  2 passed (2)
Tests       16 passed (16)
Exit code: 0
```

The all-repository-map test discovered exactly 33 root-level `.map` files and parsed all 33 successfully.

## Type-check and build results

```text
npm run typecheck
Exit code: 0

npm run build
Exit code: 0
```

The build output is written to `dist/`, which is ignored by `.gitignore`.

## Map validation and integrity

| Category | Passed | Failed | Not tested |
|---|---:|---:|---:|
| Repository maps parsed | 33 | 0 | 0 |
| Source map SHA-256 comparison | 33 | 0 | 0 |

The current SHA-256 hashes for all 33 maps were compared with the 33 hashes recorded in `reports/STEP_01_AUDIT.md`:

```text
MAP_COUNT 33
REPORT_HASH_COUNT 33
MISMATCH_COUNT 0
HASH_STATUS PASS
```

This confirms the current files match the previously recorded audit baseline. The parser and tests perform read-only operations on the maps.

## Protected report verification

The following existing reports were checked for changes with Git:

- `reports/STEP_01_AUDIT.md`
- `reports/STEP_02_AUDIT.md`
- `reports/STEP_02_SPECIFICATION.md`
- `reports/STEP_02_1_REVIEW.md`

`git diff --` over those four tracked paths produced no changes.

## Verification commands

| Command | Result |
|---|---|
| `npm test` | PASS — 3 files and 16 tests passed |
| `npm run typecheck` | PASS — exit code 0 |
| `npm run build` | PASS — exit code 0 |
| Repository map parse test | PASS — 33 passed, 0 failed |
| SHA-256 comparison against Step 01 baseline | PASS — 33 matches, 0 mismatches |
| Protected report diff check | PASS — no changes |
| `git diff --check` | PASS — exit code 0 |
| Final Git status review | PASS — only intended Step 03 files are untracked |

The final status was:

```text
## master...origin/master
?? package-lock.json
?? package.json
?? src/
?? tests/
?? tsconfig.json
```

The Step 03 report was created after the preceding verification commands, so it is the additional intended untracked report file in the final working tree.

## Dependencies and tooling

Development dependencies added with pinned versions:

- `@types/node` `24.7.2`
- `typescript` `5.9.3`
- `vitest` `3.2.4`

`package-lock.json` was generated by npm. No runtime dependencies, application framework, or unrelated packages were added.

`npm ci --ignore-scripts` completed successfully from the lockfile. `npm audit --json` reported 3 vulnerabilities: 1 moderate and 2 critical. The affected packages are `@vitest/mocker`, `tinypool`, and `vitest`; the dependency paths are `vitest -> @vitest/mocker` and `vitest -> tinypool`, with `vitest` itself also directly affected. The available fix is `vitest@3.2.7` (non-major relative to 3.2.4), but it was not applied automatically because the requested policy forbids blind upgrades and the pinned version change requires review. No forced audit fix was applied.

## Benchmark-resource inventory

The downloaded resources remain untracked and untouched. They are located in:

- `mapf-pdf/` — 32 PDFs, 534,840 bytes; `room-32-32-4.pdf` is not present.
- `mapf-png/` — 33 PNG renderings, 16,706,341 bytes.
- `mapf-svg/` — 33 SVG renderings, 2,054,297 bytes.
- `mapf-scen-even/scen-even/` — 825 `.scen` files, 42,028,878 bytes.
- `mapf-scen-random/scen-random/` — 825 `.scen` files, 37,128,931 bytes.

There are 1,781 downloaded resource files totaling 98,453,287 bytes (about 93.9 MiB), and no archives were found. The scenario sets contain 25 files for each of the 33 original map names. Scenario prefixes exactly match the original map names. The PNG and SVG sets cover all 33 names; the PDF set covers 32. No additional physical `.map` files were found, so no additional map bytes could be hash-compared. The restored root maps match all 33 committed `HEAD` blobs byte-for-byte: 33 matching originals, 0 mismatched, 0 missing, 0 additional physical maps, and 0 filename/hash duplicates in the downloaded folders. No license or redistribution metadata was found for these resources; attribution and redistribution terms remain unresolved.

## Known limitations

- The parser supports the validated format and symbols present in this repository only.
- No pathfinding or time-aware search exists yet.
- No robots, tasks, reservations, conflict checks, simulation clock, disruption events, or recovery behavior exists yet.
- No UI or visualization exists yet.
- Moving AI map redistribution and attribution terms remain unresolved from the local materials; this report does not make a redistribution or ownership claim.

A*, multi-robot coordination, reservations, disruption recovery, task reassignment, simulation ticks, and UI remain explicitly unimplemented for later steps.
