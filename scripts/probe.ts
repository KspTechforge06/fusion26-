#!/usr/bin/env node
/**
 * Timing probe for the offline MAPF solver.
 *
 *   npx tsx scripts/probe.ts [map] [agentCounts] [horizon]
 *   npx tsx scripts/probe.ts warehouse-20-40-10-2-2 8,16,32 500
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { parseMap } from "../src/core/mapf.ts";
import { cbs, prioritizedPlanning } from "../src/core/cbs.ts";
import { validateSolution } from "../src/core/conflicts.ts";
import { sampleMapfAgents, suggestedHorizon } from "../src/core/scenario.ts";
import type { Grid } from "../src/core/types.ts";

const BENCH = join(process.cwd(), "benchmarks", "maps");

function loadMap(name: string): Grid {
  return parseMap(readFileSync(join(BENCH, `${name}.map`), "utf8"), name).grid;
}

const mapName = process.argv[2] ?? "random-32-32-20";
const agentCounts = (process.argv[3] ?? "8,16,32").split(",").map(Number);
const horizonArg = process.argv[4];

const grid = loadMap(mapName);
let free = 0;
for (const c of grid.cells) if (c === 1) free++;

const maxAgents = Math.max(...agentCounts);
const horizon = horizonArg ? Number(horizonArg) : suggestedHorizon(grid, maxAgents);

console.log(
  `map ${mapName}  ${grid.width}x${grid.height}  free=${free}/${grid.width * grid.height}  horizon=${horizon}`,
);
console.log("");
console.log("agents  solver        ms   makespan  soc/lb  nodes  violations");

for (const count of agentCounts) {
  const agents = sampleMapfAgents(grid, count, 1234);
  if (agents.length < count) {
    console.log(`${String(count).padEnd(7)} skipped -- map too small for ${count} well-separated agents`);
    continue;
  }

  const opts = { grid, horizon, maxNodes: 1500, timeLimitMs: 20_000 };

  const t0 = performance.now();
  const prioritized = prioritizedPlanning(agents, opts);
  const priMs = performance.now() - t0;

  const t1 = performance.now();
  const res = cbs(agents, opts);
  const cbsMs = performance.now() - t1;

  const violations = res.solved ? validateSolution(grid, res.paths) : [];
  const ratio =
    Number.isFinite(res.lowerBound) && res.lowerBound > 0
      ? (res.sumOfCosts / res.lowerBound).toFixed(2)
      : "-";

  console.log(
    `${String(count).padEnd(7)} ${"prioritized".padEnd(12)} ${priMs.toFixed(0).padStart(5)} ` +
      `${(prioritized.solved ? String(prioritized.makespan) : "FAIL").padStart(9)} ${"-".padStart(8)} ` +
      `${"1".padStart(6)} ${"-"}`,
  );
  console.log(
    `${"".padEnd(7)} ${"cbs".padEnd(12)} ${cbsMs.toFixed(0).padStart(5)} ` +
      `${(res.solved ? String(res.makespan) : "FAIL").padStart(9)} ${ratio.padStart(8)} ` +
      `${String(res.nodes).padStart(6)} ${violations.length === 0 ? "none" : violations[0].detail}`,
  );
  if (!res.solved) console.log(`         reason: ${res.reason}`);
}