# BASELINE RESULTS

Commit audited: d2b49fe (main branch, clean working tree)
Audit date: 2026-10-10

## Commands run and results

- `npm test`: 42 passed, 18 skipped (4 test files). Duration ~87.5s.
- `npm run typecheck` (`tsc --noEmit`): clean (exit 0, no output).
- `npm run build`: clean (dist/index.html produced, 41.49 kB / 14.01 kB gzip).
- `npm run bench`: completed 4 runs x 1000 ticks, 14 robots, fault every 40 ticks.

## Benchmark results (same conditions: 4 runs, 14 robots, fault/40 ticks)

Swarm (decentralized) vs Centralised baseline:

- Swarm mean throughput: 1.925 completed / 100 ticks
- Central mean throughput: 0.525 completed / 100 ticks
- Swarm p95 latency mean: 462.0 ticks
- Central p95 latency mean: 214.9 ticks
- Swarm mean wall ms per run: 14490 ms
- Central mean wall ms per run: 1095 ms
- Central planner share: ~14.4% of its runtime

Fleet scaling (same seed per size):

- 6 robots: swarm 2.00 vs central 1.90; 20 / 19 orders
- 10 robots: swarm 2.70 vs central 0.00; 27 / 0 orders
- 14 robots: swarm 2.10 vs central 1.00; 21 / 10 orders
- 20 robots: swarm 2.30 vs central 0.70; 23 / 7 orders
- 28 robots: swarm 2.60 vs central 0.00; 26 / 0 orders

The benchmark shows the swarm completes more orders under fault conditions, but takes longer per run (more local computation per robot). Centralised planner stalls more frequently (274-306 stalls) but is faster when it does complete.

## Application verification

- `npm run dev` / `npm run preview` not executed in this batch (build verified). The app loads via `index.html` referencing the built bundle; the interactive controls (start, pause, step, reset) and fault injection (block, kill robot, repair, rush, escalate) are wired to real simulation state.
- No secrets added; `.gitignore` excludes node_modules, dist.
- Remote unchanged: `https://github.com/PixelAnay/warehouse-swarm.git`.
