import { makeCodec } from "./codec.js";
import type { Grid, Position } from "./types.js";
import type { TimeConstraint } from "./astar.js";

export type ConflictKind = "vertex" | "edge";

export interface Conflict {
  kind: ConflictKind;
  t: number;
  agentA: number;
  agentB: number;
  /** Branch 1: forbid agentA here. */
  constraintA: TimeConstraint;
  /** Branch 2: forbid agentB here. */
  constraintB: TimeConstraint;
}

export interface Violation {
  kind: ConflictKind | "unreachable";
  t: number;
  agentA: number;
  agentB: number;
  detail: string;
}

/**
 * Finds the earliest conflict in a set of complete paths, or null when valid.
 *
 * Following the MAPF convention an agent is *removed from the grid* the moment it
 * reaches its goal rather than lingering there forever. Without that rule a
 * perfectly good plan, where one robot finishes early and parks while others
 * stream past, is reported as colliding and CBS rejects a valid solution.
 *
 * Sweeping t upwards means the first hit is the conflict nearest the start of the
 * schedule, which is the one worth splitting on: constraining an early collision
 * prunes far more of the search than a late one.
 */
export function detectConflict(
  grid: Grid,
  paths: ReadonlyMap<number, readonly Position[]>,
): Conflict | null {
  const codec = makeCodec(grid);
  const entries = [...paths.entries()].map(([id, path]) => ({ id, path }));

  let horizon = 0;
  for (const e of entries) horizon = Math.max(horizon, e.path.length);

  for (let t = 0; t < horizon; t++) {
    const active = entries.filter((e) => t < e.path.length);

    const occupancy = new Map<number, number>();
    for (const { id, path } of active) {
      const p = path[t];
      const cell = codec.cell(p.x, p.y);
      const other = occupancy.get(cell);
      if (other !== undefined) {
        return {
          kind: "vertex",
          t,
          agentA: other,
          agentB: id,
          constraintA: { t, x: p.x, y: p.y },
          constraintB: { t, x: p.x, y: p.y },
        };
      }
      occupancy.set(cell, id);
    }

    for (let a = 0; a < active.length; a++) {
      const A = active[a];
      for (let b = a + 1; b < active.length; b++) {
        const B = active[b];
        // B must still be moving at t+1 for a swap to be possible.
        if (t + 1 >= B.path.length) continue;

        const aNow = A.path[t];
        const aNext = A.path[t + 1];
        const bNow = B.path[t];
        const bNext = B.path[t + 1];

        if (aNext.x === bNow.x && aNext.y === bNow.y &&
            bNext.x === aNow.x && bNext.y === aNow.y) {
          return {
            kind: "edge",
            t,
            agentA: A.id,
            agentB: B.id,
            constraintA: { t: t + 1, x: aNext.x, y: aNext.y },
            constraintB: { t: t + 1, x: bNext.x, y: bNext.y },
          };
        }
      }
    }
  }

  return null;
}

/**
 * Full validation sweep for the test suite. Returns every violation at once so a
 * failure reports all of them instead of one per run.
 */
export function validateSolution(
  grid: Grid,
  paths: ReadonlyMap<number, readonly Position[]>,
): Violation[] {
  const codec = makeCodec(grid);
  const violations: Violation[] = [];
  const entries = [...paths.entries()].map(([id, path]) => ({ id, path }));

  for (const { id, path } of entries) {
    if (path.length === 0) {
      violations.push({ kind: "unreachable", t: 0, agentA: id, agentB: -1, detail: "empty path" });
      continue;
    }
    for (let t = 0; t < path.length; t++) {
      const p = path[t];
      if (p.x < 0 || p.y < 0 || p.x >= grid.width || p.y >= grid.height) {
        violations.push({
          kind: "unreachable",
          t,
          agentA: id,
          agentB: -1,
          detail: `out of bounds ${p.x},${p.y}`,
        });
      } else if (grid.cells[codec.cell(p.x, p.y)] !== 1) {
        violations.push({
          kind: "unreachable",
          t,
          agentA: id,
          agentB: -1,
          detail: `on obstacle ${p.x},${p.y}`,
        });
      }
    }
  }

  let horizon = 0;
  for (const { path } of entries) horizon = Math.max(horizon, path.length);

  for (let t = 0; t < horizon; t++) {
    const active = entries.filter((e) => t < e.path.length);

    const occupancy = new Map<number, number>();
    for (const { id, path } of active) {
      const p = path[t];
      const cell = codec.cell(p.x, p.y);
      const other = occupancy.get(cell);
      if (other !== undefined) {
        violations.push({
          kind: "vertex",
          t,
          agentA: other,
          agentB: id,
          detail: `agents ${other} and ${id} both on (${p.x},${p.y}) at t=${t}`,
        });
      } else {
        occupancy.set(cell, id);
      }
    }

    for (let a = 0; a < active.length; a++) {
      for (let b = a + 1; b < active.length; b++) {
        const A = active[a];
        const B = active[b];
        if (t + 1 >= A.path.length || t + 1 >= B.path.length) continue;

        const aNow = A.path[t];
        const aNext = A.path[t + 1];
        const bNow = B.path[t];
        const bNext = B.path[t + 1];

        if (aNext.x === bNow.x && aNext.y === bNow.y &&
            bNext.x === aNow.x && bNext.y === aNow.y) {
          violations.push({
            kind: "edge",
            t,
            agentA: A.id,
            agentB: B.id,
            detail:
              `agents ${A.id} and ${B.id} swap ` +
              `(${aNow.x},${aNow.y}) <-> (${aNext.x},${aNext.y}) at t=${t}`,
          });
        }
      }
    }
  }

  return violations;
}

/** Agents that never reached their goal. */
export function unassignedAgents(
  paths: ReadonlyMap<number, readonly Position[]>,
  goals: ReadonlyMap<number, Position>,
): number[] {
  const missing: number[] = [];
  for (const [agent, goal] of goals) {
    const path = paths.get(agent);
    if (!path || path.length === 0) {
      missing.push(agent);
      continue;
    }
    const end = path[path.length - 1];
    if (end.x !== goal.x || end.y !== goal.y) missing.push(agent);
  }
  return missing;
}

export function makespanOf(paths: ReadonlyMap<number, readonly Position[]>): number {
  let max = 0;
  for (const [, p] of paths) max = Math.max(max, p.length - 1);
  return max;
}