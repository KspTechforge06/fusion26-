import { connectedComponent, idx, isFree } from "./grid.js";
import { Rng } from "./rng.js";
import type { Grid, Position } from "./types.js";
import type { CbsAgent } from "./cbs.js";

/** First traversable cell, used as the seed for connected-component analysis. */
export function firstFree(grid: Grid): Position {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (isFree(grid, x, y)) return { x, y };
    }
  }
  throw new Error("map has no traversable cells");
}

/** Every traversable cell actually reachable from `origin`. */
export function reachableCells(grid: Grid, origin: Position = firstFree(grid)): Position[] {
  const component = connectedComponent(grid, origin);
  const out: Position[] = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (isFree(grid, x, y) && component.has(idx(grid, x, y))) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Builds a MAPF-style instance on an arbitrary map.
 *
 * Starts are spread out so agents are not trivially adjacent, and each goal is the
 * farthest reachable cell from its start, which produces long paths and therefore
 * genuinely conflicting traffic -- the case the benchmark is designed to stress.
 *
 * The minimum separation is relaxed progressively when a dense map cannot supply
 * enough well-spaced starts, so the requested count is honoured whenever the map
 * has room. Returns fewer only when there are genuinely not enough distinct cells.
 */
export function sampleMapfAgents(grid: Grid, count: number, seed: number): CbsAgent[] {
  if (count <= 0) return [];

  const rng = new Rng(seed);
  const free = reachableCells(grid);
  if (free.length < count + 1) return [];

  const shuffled = rng.shuffle([...free]);
  const ideal = Math.max(3, Math.round(Math.sqrt((grid.width * grid.height) / count) / 2));

  let starts: Position[] = [];
  for (let separation = ideal; separation >= 1 && starts.length < count; separation--) {
    starts = [];
    for (const cell of shuffled) {
      if (starts.length >= count) break;
      const far = starts.every(
        (s) => Math.abs(s.x - cell.x) + Math.abs(s.y - cell.y) >= separation,
      );
      if (far) starts.push(cell);
    }
  }

  for (const cell of shuffled) {
    if (starts.length >= count) break;
    starts.push(cell);
  }

  return starts.slice(0, count).map((start, id) => ({
    id,
    start,
    goal: farthestCell(free, start),
  }));
}

function farthestCell(candidates: readonly Position[], from: Position): Position {
  let best = from;
  let bestDist = -1;
  for (const cell of candidates) {
    const d = Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y);
    if (d > bestDist) {
      bestDist = d;
      best = cell;
    }
  }
  return best;
}

/**
 * A planning horizon that scales with the map.
 *
 * No shortest path on a grid exceeds (width + height - 2) steps, which is the base
 * allowance; the per-agent term is headroom for yielding to traffic. A fixed
 * horizon is the classic mistake here: too small and a large map reports false
 * unsolvability, after which the search burns its whole space-time volume trying to
 * prove it.
 */
export function suggestedHorizon(grid: Grid, agentCount: number): number {
  return grid.width + grid.height - 2 + agentCount * 2;
}