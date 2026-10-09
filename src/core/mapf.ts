import { makeGrid } from "./grid.js";
import type { AgentSpec, Grid } from "./types.js";

/**
 * Reader for the MovingAI MAPF benchmark format.
 *
 * Map file:
 *   type octile
 *   height 32
 *   width 32
 *   map
 *   @@@@....        rows of characters
 *
 * `.` is traversable; `@`, `S` and `T` are not. Every non-`.` character is treated
 * as an obstacle, which is the conservative reading.
 *
 * Scenario file:
 *   version 1
 *   bucket 0
 *   map-name 32 32 100          <- width height problem-count
 *   0 4 0 5 6                    <- index startX startY goalX goalY
 *   1 11 5 12 5
 *
 * Scenarios are generated per agent count, so the first N entries give the
 * N-agent problem.
 *
 * Reference: Stern, Sturtevant et al., "Multi-Agent Pathfinding: Definitions,
 * Variants, and Benchmarks", SoCS 2019. Data under the Open Data Commons
 * Attribution License.
 */

export interface MapfMap {
  grid: Grid;
  name: string;
}

export function parseMap(text: string, name = "unknown"): MapfMap {
  const lines = text.split(/\r?\n/);

  let height = 0;
  let width = 0;
  let mapStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("height")) height = parseInt(line.split(/\s+/)[1], 10);
    else if (line.startsWith("width")) width = parseInt(line.split(/\s+/)[1], 10);
    else if (line === "map") {
      mapStart = i + 1;
      break;
    }
  }

  if (!height || !width) throw new Error(`parseMap(${name}): missing height/width header`);
  if (mapStart < 0) throw new Error(`parseMap(${name}): missing "map" line`);

  const grid = makeGrid(width, height, 0);

  for (let y = 0; y < height; y++) {
    const row = lines[mapStart + y];
    if (row === undefined) throw new Error(`parseMap(${name}): truncated at row ${y}`);
    for (let x = 0; x < width; x++) {
      grid.cells[y * width + x] = row[x] === "." ? 1 : 0;
    }
  }

  return { grid, name };
}

export interface ScenarioFile {
  mapName: string;
  width: number;
  height: number;
  agents: AgentSpec[];
}

export function parseScenario(text: string): ScenarioFile {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let width = 0;
  let height = 0;
  let mapName = "";
  const agents: AgentSpec[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);

    if (parts.length === 4 && Number.isFinite(Number(parts[1]))) {
      mapName = parts[0];
      width = Number(parts[1]);
      height = Number(parts[2]);
      continue;
    }

    if (parts.length === 5) {
      const [id, sx, sy, gx, gy] = parts.map(Number);
      if ([id, sx, sy, gx, gy].every((n) => Number.isFinite(n))) {
        agents.push({ id, start: { x: sx, y: sy }, goal: { x: gx, y: gy } });
      }
    }
  }

  return { mapName, width, height, agents };
}

/** The first `count` agents from a scenario file form the `count`-agent problem. */
export function scenarioPrefix(scenario: ScenarioFile, count: number): AgentSpec[] {
  return scenario.agents.slice(0, count);
}

/** Largest N for which the scenario file has a problem. */
export function maxAgentCount(scenario: ScenarioFile): number {
  return scenario.agents.length;
}