#!/usr/bin/env node
/**
 * Swarm vs. centralised controller, headless.
 *
 * Both systems get an identical warehouse, an identical fleet and an identical
 * fault schedule, so any difference in the numbers comes from the coordination
 * architecture and nothing else.
 *
 *   npx tsx scripts/run-benchmarks.ts [runs] [ticksPerRun]
 *
 * Full results are written to results/swarm-vs-central.json.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { CentralizedBaseline } from "../src/core/baseline.ts";
import { formatSnapshot, snapshot, type Snapshot } from "../src/core/metrics.ts";
import { createWorld } from "../src/core/warehouse.ts";
import { Rng } from "../src/core/rng.ts";
import type { World } from "../src/core/world.ts";

const RUNS = Number(process.argv[2] ?? 4);
const TICKS = Number(process.argv[3] ?? 1000);
const ROBOTS = 14;
const FAULT_INTERVAL = 40;
const FLEET_SIZES = [6, 10, 14, 20, 28];

interface RunResult {
  metrics: Snapshot;
  /** Wall-clock ms for the whole run: how far ahead of real time the system kept. */
  wallMs: number;
  /** Wall-clock ms spent inside the central planner only. */
  planningMs: number;
  /** Full-fleet re-plans issued. */
  fleetReplans: number;
  /** Times a robot had no route from the controller and sat still. */
  stalls: number;
}

/** Applies the same fault schedule to whichever world it is handed. */
function injectFaults(world: World, rng: Rng): void {
  const roll = rng.next();
  if (roll < 0.12) {
    world.failRobot(rng.int(0, world.robots.length));
  } else if (roll < 0.3) {
    world.blockCell(1 + rng.int(0, world.grid.width - 2), 1 + rng.int(0, world.grid.height - 2));
  } else if (roll < 0.36) {
    world.injectTask("rush");
  }
}

function build(robots: number, seed: number) {
  return createWorld({
    seed,
    robotCount: robots,
    initialTasks: Math.max(4, Math.round(robots / 2)),
  });
}

function runSwarm(seed: number, robots = ROBOTS): RunResult {
  const world = build(robots, seed);
  const faultRng = new Rng(seed ^ 0xabcd);

  const started = performance.now();
  for (let i = 0; i < TICKS; i++) {
    world.step();
    if (i % FAULT_INTERVAL === 0) injectFaults(world, faultRng);
  }
  const wallMs = performance.now() - started;

  return { metrics: snapshot(world.metrics), wallMs, planningMs: 0, fleetReplans: 0, stalls: 0 };
}

function runCentralized(seed: number, robots = ROBOTS): RunResult {
  const world = build(robots, seed);
  const controller = new CentralizedBaseline(world, { replanEveryTicks: 40 });
  const faultRng = new Rng(seed ^ 0xabcd);

  const started = performance.now();
  for (let i = 0; i < TICKS; i++) {
    controller.step();
    if (i % FAULT_INTERVAL === 0) {
      const before = world.currentEpoch;
      injectFaults(world, faultRng);
      if (world.currentEpoch !== before) controller.requestReplan();
    }
  }
  const wallMs = performance.now() - started;

  return {
    metrics: snapshot(world.metrics),
    wallMs,
    planningMs: controller.report.planningMs,
    fleetReplans: controller.report.replans,
    stalls: controller.report.strandedTicks,
  };
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

async function main(): Promise<void> {
  console.log(
    `Swarm vs centralised — ${RUNS} runs x ${TICKS} ticks, ${ROBOTS} robots, ` +
      `a fault every ${FAULT_INTERVAL} ticks\n`,
  );

  const swarmRuns: RunResult[] = [];
  const centralRuns: RunResult[] = [];

  for (let run = 0; run < RUNS; run++) {
    const seed = 1000 + run * 37;
    const swarm = runSwarm(seed);
    const central = runCentralized(seed);
    swarmRuns.push(swarm);
    centralRuns.push(central);

    console.log(`run ${run + 1} (seed ${seed})`);
    console.log(`  swarm        ${formatSnapshot(swarm.metrics)}`);
    console.log(`                ${swarm.wallMs.toFixed(0)} ms wall`);
    console.log(`  centralised  ${formatSnapshot(central.metrics)}`);
    console.log(
      `                ${central.wallMs.toFixed(0)} ms wall, ${central.planningMs.toFixed(0)} ms of it ` +
        `inside the planner (${((central.planningMs / central.wallMs) * 100).toFixed(1)}%), ` +
        `${central.fleetReplans} fleet re-plans, ${central.stalls} stalls`,
    );
  }

  const throughputSwarm = mean(swarmRuns.map((r) => r.metrics.throughput));
  const throughputCentral = mean(centralRuns.map((r) => r.metrics.throughput));
  const p95Swarm = mean(swarmRuns.map((r) => r.metrics.p95Latency));
  const p95Central = mean(centralRuns.map((r) => r.metrics.p95Latency));
  const wallSwarm = mean(swarmRuns.map((r) => r.wallMs));
  const wallCentral = mean(centralRuns.map((r) => r.wallMs));
  const planningCentral = mean(centralRuns.map((r) => r.planningMs));

  console.log("\n--- means ---");
  console.log(`throughput/100t   swarm ${throughputSwarm.toFixed(3)}    central ${throughputCentral.toFixed(3)}`);
  console.log(`p95 latency       swarm ${p95Swarm.toFixed(1)}      central ${p95Central.toFixed(1)}`);
  console.log(`wall ms per run   swarm ${wallSwarm.toFixed(0)}      central ${wallCentral.toFixed(0)}`);
  console.log(
    `central planner   ${planningCentral.toFixed(0)} ms per run ` +
      `= ${((planningCentral / wallCentral) * 100).toFixed(1)}% of its own runtime`,
  );

  // ---------------------------------------------------------------- scaling
  //
  // The argument against a bottleneck controller is that its cost grows with the
  // whole fleet, while each swarm robot's cost grows only with its own
  // neighbourhood. The planner-time column decides whether a fleet could be driven
  // at all, so it is the one worth plotting.
  const fleetSweep: Array<Record<string, number>> = [];

  console.log("\n--- fleet scaling (same seed per size) ---");
  console.log(
    "robots  swarm ms   central ms   planner ms   planner share   throughput sw/ct   orders sw/ct",
  );

  for (const robots of FLEET_SIZES) {
    const seed = 4242;
    const swarm = runSwarm(seed, robots);
    const central = runCentralized(seed, robots);
    const share = (central.planningMs / Math.max(1, central.wallMs)) * 100;

    fleetSweep.push({
      robots,
      swarmWallMs: swarm.wallMs,
      centralWallMs: central.wallMs,
      centralPlanningMs: central.planningMs,
      plannerSharePercent: share,
      swarmThroughput: swarm.metrics.throughput,
      centralThroughput: central.metrics.throughput,
      swarmOrders: swarm.metrics.completed,
      centralOrders: central.metrics.completed,
    });

    console.log(
      `${String(robots).padEnd(7)} ${swarm.wallMs.toFixed(0).padStart(8)}   ` +
        `${central.wallMs.toFixed(0).padStart(10)}   ${central.planningMs.toFixed(0).padStart(10)}   ` +
        `${share.toFixed(1).padStart(13)}%   ` +
        `${swarm.metrics.throughput.toFixed(2).padStart(9)} / ${central.metrics.throughput.toFixed(2).padStart(2)}   ` +
        `${String(swarm.metrics.completed).padStart(6)} / ${String(central.metrics.completed).padStart(2)}`,
    );
  }

  const summary = {
    config: { runs: RUNS, ticks: TICKS, robots: ROBOTS, faultIntervalTicks: FAULT_INTERVAL },
    means: {
      swarm: { throughput: throughputSwarm, p95Latency: p95Swarm, wallMsPerRun: wallSwarm },
      centralized: {
        throughput: throughputCentral,
        p95Latency: p95Central,
        wallMsPerRun: wallCentral,
        planningMsPerRun: planningCentral,
      },
    },
    fleetSweep,
    swarmRuns,
    centralizedRuns: centralRuns,
  };

  const outDir = join(process.cwd(), "results");
  await mkdir(outDir, { recursive: true });
  const outFile = join(outDir, "swarm-vs-central.json");
  await writeFile(outFile, JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});