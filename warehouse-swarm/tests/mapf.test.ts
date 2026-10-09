import { describe, expect, it } from "vitest";
import { cbs, prioritizedPlanning } from "../src/core/cbs.js";
import { validateSolution, unassignedAgents } from "../src/core/conflicts.js";
import { isFree } from "../src/core/grid.js";
import { parseMap } from "../src/core/mapf.js";
import { sampleMapfAgents, suggestedHorizon } from "../src/core/scenario.js";
import { listMaps, mapsAvailable } from "./helpers/benchmarkMaps.js";

function loadGrid(mapName: string) {
  const entry = listMaps().find((m) => m.name === mapName);
  expect(entry, `benchmark map ${mapName} missing. Run: npm run benchmarks:download`).toBeDefined();
  return parseMap(entry!.text, mapName).grid;
}

function describeViolations(violations: ReturnType<typeof validateSolution>): string {
  return violations.slice(0, 5).map((v) => `${v.kind}@t${v.t}: ${v.detail}`).join("\n      ");
}

/**
 * Agent counts each map can actually absorb.
 *
 * The 1-cell-corridor mazes serialise badly and saturate well before the open
 * maps do, so the count is per-map rather than uniform. The density ceiling is
 * measured below rather than assumed.
 */
const SWEEP: Array<[string, number]> = [
  ["random-32-32-10", 64],
  ["random-32-32-20", 64],
  ["random-64-64-10", 96],
  ["room-32-32-4", 64],
  ["room-64-64-8", 96],
  ["maze-32-32-4", 32],
  ["warehouse-10-20-10-2-1", 64],
  ["warehouse-10-20-10-2-2", 64],
  ["warehouse-20-40-10-2-1", 64],
  ["warehouse-20-40-10-2-2", 64],
];

describe.skipIf(!mapsAvailable())("MAPF benchmark", () => {
  it("parses all 33 published maps", () => {
    const maps = listMaps();
    expect(maps.length).toBe(33);

    for (const { name, text } of maps) {
      const { grid } = parseMap(text, name);
      expect(grid.width, name).toBeGreaterThan(0);
      expect(grid.height, name).toBeGreaterThan(0);
      expect(grid.cells.length, name).toBe(grid.width * grid.height);

      let free = 0;
      for (const c of grid.cells) if (c === 1) free++;
      expect(free, `${name} has no traversable cells`).toBeGreaterThan(0);
    }
  });

  // The point of this sweep is proving zero collisions, not squeezing the last
  // millisecond out of the solver.
  for (const [mapName, agentCount] of SWEEP) {
    it(`solves ${mapName} with ${agentCount} agents with zero collisions`, () => {
      const grid = loadGrid(mapName);
      const agents = sampleMapfAgents(grid, agentCount, 4242);
      expect(agents.length).toBe(agentCount);

      const result = cbs(agents, {
        grid,
        horizon: suggestedHorizon(grid, agents.length),
        maxNodes: 4000,
        timeLimitMs: 60_000,
      });

      expect(result.solved, `CBS failed: ${result.reason}`).toBe(true);

      const violations = validateSolution(grid, result.paths);
      expect(violations, `collisions:\n      ${describeViolations(violations)}`).toHaveLength(0);

      const goals = new Map(agents.map((a) => [a.id, a.goal]));
      expect(unassignedAgents(result.paths, goals)).toHaveLength(0);
    });
  }

  it("beats or matches prioritized planning on cost", () => {
    const grid = loadGrid("warehouse-10-20-10-2-1");
    const agents = sampleMapfAgents(grid, 64, 909);
    const opts = {
      grid,
      horizon: suggestedHorizon(grid, agents.length),
      maxNodes: 4000,
      timeLimitMs: 60_000,
    };

    const prioritized = prioritizedPlanning(agents, opts);
    const improved = cbs(agents, opts);

    expect(prioritized.solved).toBe(true);
    expect(improved.solved).toBe(true);
    expect(improved.sumOfCosts).toBeLessThanOrEqual(prioritized.sumOfCosts);
    expect(validateSolution(grid, improved.paths)).toHaveLength(0);
  });

  it("stays within 25% of the optimality lower bound", () => {
    const grid = loadGrid("random-32-32-20");
    const agents = sampleMapfAgents(grid, 32, 1717);
    const result = cbs(agents, {
      grid,
      horizon: suggestedHorizon(grid, agents.length),
      maxNodes: 6000,
      timeLimitMs: 60_000,
    });

    expect(result.solved).toBe(true);
    expect(Number.isFinite(result.lowerBound)).toBe(true);
    expect(result.sumOfCosts / result.lowerBound).toBeLessThan(1.25);
  });

  /**
   * The benchmark's own protocol: add agents one at a time until the solver cannot
   * cope. The invariant is not "solve them all" but "never return colliding paths,
   * and always say why when it gives up".
   */
  it("degrades cleanly as density climbs on a 1-cell-corridor maze", () => {
    const grid = loadGrid("maze-32-32-4");
    const counts = [8, 16, 24, 32, 48, 64];

    let solved = 0;
    let failed = 0;
    let maxSolved = 0;

    for (const count of counts) {
      const agents = sampleMapfAgents(grid, count, 808 + count);
      expect(agents.length).toBe(count);

      const result = cbs(agents, {
        grid,
        horizon: suggestedHorizon(grid, agents.length),
        maxNodes: 2000,
        timeLimitMs: 30_000,
      });

      if (result.solved) {
        expect(validateSolution(grid, result.paths), `${count} agents`).toHaveLength(0);
        solved++;
        maxSolved = Math.max(maxSolved, count);
      } else {
        expect(result.reason, `${count} agents should explain itself`).toBeTruthy();
        failed++;
      }
    }

    expect(solved + failed).toBe(counts.length);
    expect(maxSolved).toBeGreaterThanOrEqual(32);
  });

  it("switches agent counts cleanly on one map", () => {
    const grid = loadGrid("random-32-32-20");
    const horizon = suggestedHorizon(grid, 200);

    for (const count of [8, 16, 32, 64, 128, 200]) {
      const agents = sampleMapfAgents(grid, count, 31 + count);
      expect(agents.length).toBe(count);

      const result = cbs(agents, { grid, horizon, maxNodes: 2500, timeLimitMs: 45_000 });
      if (!result.solved) {
        expect(result.reason).toBeTruthy();
        continue;
      }

      const violations = validateSolution(grid, result.paths);
      expect(violations, `${count} agents:\n      ${describeViolations(violations)}`).toHaveLength(0);
    }
  });

  it("reports failure instead of unsafe paths when massively oversubscribed", () => {
    const grid = loadGrid("maze-32-32-4");
    const agents = sampleMapfAgents(grid, 200, 3);
    expect(agents.length).toBe(200);

    const result = cbs(agents, {
      grid,
      horizon: suggestedHorizon(grid, agents.length),
      maxNodes: 500,
      timeLimitMs: 20_000,
    });

    if (!result.solved) {
      expect(result.reason).toBeTruthy();
    } else {
      expect(validateSolution(grid, result.paths)).toHaveLength(0);
    }
  });

  it("handles the largest warehouse map", () => {
    const grid = loadGrid("warehouse-20-40-10-2-2");
    expect(grid.width).toBe(340);
    expect(grid.height).toBe(164);

    const agents = sampleMapfAgents(grid, 96, 5150);
    expect(agents.length).toBe(96);

    const result = cbs(agents, {
      grid,
      horizon: suggestedHorizon(grid, agents.length),
      maxNodes: 3000,
      timeLimitMs: 90_000,
    });

    expect(result.solved, `CBS failed: ${result.reason}`).toBe(true);
    expect(validateSolution(grid, result.paths)).toHaveLength(0);
  });

  it("plans mid-simulation with absolute tick offsets", () => {
    const grid = loadGrid("warehouse-10-20-10-2-1");
    const agents = sampleMapfAgents(grid, 32, 61);

    const result = cbs(agents, {
      grid,
      horizon: 300,
      startTime: 5000,
      maxNodes: 2000,
      timeLimitMs: 60_000,
    });

    expect(result.solved).toBe(true);
    expect(validateSolution(grid, result.paths)).toHaveLength(0);
  });
});

describe("mapf format parsers", () => {
  it("parses a header and character grid", () => {
    const text = ["type octile", "height 3", "width 4", "map", "@@..", "..@.", "...."].join("\n");
    const { grid } = parseMap(text, "synthetic");
    expect(grid.width).toBe(4);
    expect(grid.height).toBe(3);
    expect(isFree(grid, 0, 0)).toBe(false);
    expect(isFree(grid, 2, 0)).toBe(true);
    expect(isFree(grid, 2, 1)).toBe(false);
  });

  it("rejects a map with no header", () => {
    expect(() => parseMap("just some text", "broken")).toThrow(/height|width/);
  });
});