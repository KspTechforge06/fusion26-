import { spaceTimeAStar, shortestPathLength, type TimeConstraint } from "./astar.js";
import { detectConflict, makespanOf, unassignedAgents } from "./conflicts.js";
import { manhattan } from "./grid.js";
import { MinHeap } from "./heap.js";
import { ReservationTable } from "./reservation.js";
import { Rng } from "./rng.js";
import type { Grid, Position } from "./types.js";

export interface CbsAgent {
  id: number;
  start: Position;
  goal: Position;
}

export interface CbsOptions {
  grid: Grid;
  /** Lookahead per agent. Also caps the makespan. */
  horizon: number;
  maxNodes?: number;
  timeLimitMs?: number;
  /**
   * Absolute tick the plan starts from.
   *
   * Required when solving mid-simulation: reservation keys are absolute, so a
   * plan built with the default of 0 would be scheduled in the past.
   */
  startTime?: number;
}

export interface SolveResult {
  solved: boolean;
  paths: Map<number, Position[]>;
  makespan: number;
  /** Sum over agents of arrival tick. CBS minimises this. */
  sumOfCosts: number;
  /** Sum of individual shortest paths: an admissible lower bound. */
  lowerBound: number;
  nodes: number;
  reason?: string;
}

interface SearchNode {
  constraints: Map<number, TimeConstraint[]>;
  paths: Map<number, Position[]>;
  cost: number;
  order: number[];
  agents: readonly CbsAgent[];
}

/**
 * Plans agents one at a time in a fixed order, each avoiding everything already
 * committed to the reservation table.
 *
 * A single order is complete only for that order: it returns conflict-free paths
 * or nothing at all. In narrow mazes it fails often, because an early agent that
 * decides to sit in a dead-end corridor strands everyone behind it. The cure is to
 * retry across several orders, which is cheap and far more reliable than any one
 * heuristic.
 */
export function prioritizedPlanning(agents: readonly CbsAgent[], opts: CbsOptions): SolveResult {
  const lowerBound = computeLowerBound(agents, opts.grid);
  let attempts = 0;

  for (const order of candidateOrderings(agents)) {
    attempts++;
    const node = planInOrder(order, emptyConstraints(), agents, opts);
    if (!node) continue;
    return finish(node, agents, lowerBound, attempts);
  }

  return {
    solved: false,
    paths: new Map(),
    makespan: Infinity,
    sumOfCosts: Infinity,
    lowerBound,
    nodes: attempts,
    reason: `prioritized planning found no plan across ${attempts} candidate orderings`,
  };
}

/**
 * Conflict-Based Search with an incumbent.
 *
 * The root prioritized solution is feasible but rarely cost-optimal, so the search
 * does not stop there: every node cheaper than the incumbent is split on its first
 * conflict into two children, each forbidding one agent from one cell at one tick,
 * and each child re-plans only the agents its new constraint touches. Search halts
 * once the cheapest open node can no longer beat the incumbent, which is what makes
 * this terminate instead of burning the entire node budget.
 */
export function cbs(agents: readonly CbsAgent[], opts: CbsOptions): SolveResult {
  const maxNodes = opts.maxNodes ?? 5_000;
  const timeLimitMs = opts.timeLimitMs ?? 30_000;
  const lowerBound = computeLowerBound(agents, opts.grid);
  const deadline = Date.now() + timeLimitMs;

  let incumbent: SearchNode | null = null;
  let nodes = 0;

  // Ordering, not the heuristic, decides whether prioritized planning finds
  // anything at all in a narrow map, so try a spread of orders and keep the best.
  for (const order of candidateOrderings(agents)) {
    nodes++;
    const node = planInOrder(order, emptyConstraints(), agents, opts);
    if (!node) continue;
    if (!incumbent || node.cost < incumbent.cost) incumbent = node;
    if (incumbent.cost <= lowerBound) break;
  }

  if (!incumbent) {
    return {
      solved: false,
      paths: new Map(),
      makespan: Infinity,
      sumOfCosts: Infinity,
      lowerBound,
      nodes,
      reason: `no ordering produced a full plan within the horizon (${nodes} tried)`,
    };
  }

  let best = incumbent;
  const open = new MinHeap<SearchNode>();
  open.push(incumbent, incumbent.cost);

  while (open.size > 0) {
    const cheapest = open.peek()!;

    // No open node can improve on what we already hold.
    if (cheapest.cost >= best.cost) break;
    // Provably optimal; cannot do better.
    if (Number.isFinite(lowerBound) && cheapest.cost <= lowerBound) break;

    if (nodes >= maxNodes) {
      return { ...resultOf(best, agents, lowerBound, nodes), reason: `node budget exhausted (${maxNodes})` };
    }
    if (Date.now() > deadline) {
      return { ...resultOf(best, agents, lowerBound, nodes), reason: `time limit reached (${timeLimitMs}ms)` };
    }

    const node = open.pop()!;
    const conflict = detectConflict(opts.grid, node.paths);

    if (!conflict) {
      best = node;
      continue;
    }

    const branches: Array<[number, TimeConstraint]> = [
      [conflict.agentA, conflict.constraintA],
      [conflict.agentB, conflict.constraintB],
    ];

    for (const [agentId, constraint] of branches) {
      const constraints = cloneConstraints(node.constraints);
      const list = constraints.get(agentId) ?? [];
      list.push(constraint);
      constraints.set(agentId, list);

      // Re-plan the newly constrained agent first: it is the one that broke.
      const child = planInOrder(reorderFor(node.order, agentId), constraints, node.agents, opts);
      if (!child) continue;

      nodes++;
      open.push(child, child.cost);
    }
  }

  return resultOf(best, agents, lowerBound, nodes);
}

/** Runs prioritized planning under one node's constraints. Null if any agent is stuck. */
function planInOrder(
  order: readonly number[],
  constraints: Map<number, TimeConstraint[]>,
  agents: readonly CbsAgent[],
  opts: CbsOptions,
): SearchNode | null {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const table = new ReservationTable(opts.grid);
  const startTime = opts.startTime ?? 0;

  // Seed every start so all agents are mutually aware from tick 0. Without this the
  // first agent happily plans through cells the later ones are standing on.
  for (const agent of agents) {
    table.claim(startTime, agent.start.x, agent.start.y, agent.id);
  }

  const paths = new Map<number, Position[]>();
  let cost = 0;

  for (const agentId of order) {
    const agent = byId.get(agentId);
    if (!agent) return null;

    const result = spaceTimeAStar(agent.start, agent.goal, {
      grid: opts.grid,
      table,
      selfId: agent.id,
      startTime,
      horizon: opts.horizon,
      constraints: constraints.get(agent.id),
    });

    if (!result) return null;

    paths.set(agent.id, result.path);
    // Commit at absolute ticks. A* reserved against absolute time, so committing
    // by path index would silently shift every reservation by `startTime`.
    for (let t = 0; t < result.path.length; t++) {
      table.claim(startTime + t, result.path[t].x, result.path[t].y, agent.id);
    }
    cost += result.cost;
  }

  return { constraints, paths, cost, order: [...order], agents };
}

/**
 * A handful of deterministic orderings to try.
 *
 * Whoever plans first gets their ideal route and everyone else yields, so the
 * ordering dominates the outcome: try natural, reversed, longest-path-first,
 * shortest-path-first, then seeded shuffles for diversity.
 */
function candidateOrderings(agents: readonly CbsAgent[]): number[][] {
  const ids = agents.map((a) => a.id);

  const byDistance = [...agents]
    .sort((a, b) => manhattan(a.start, a.goal) - manhattan(b.start, b.goal))
    .map((a) => a.id);

  return [
    ids,
    [...ids].reverse(),
    byDistance,
    [...byDistance].reverse(),
    ...[1, 2, 3].map((seed) => new Rng(seed).shuffle([...ids])),
  ];
}

function reorderFor(order: readonly number[], agentId: number): number[] {
  const next = [...order];
  const at = next.indexOf(agentId);
  if (at > 0) {
    next.splice(at, 1);
    next.unshift(agentId);
  }
  return next;
}

function emptyConstraints(): Map<number, TimeConstraint[]> {
  return new Map();
}

function cloneConstraints(
  source: ReadonlyMap<number, TimeConstraint[]>,
): Map<number, TimeConstraint[]> {
  const out = new Map<number, TimeConstraint[]>();
  for (const [k, v] of source) out.set(k, [...v]);
  return out;
}

function computeLowerBound(agents: readonly CbsAgent[], grid: Grid): number {
  let total = 0;
  for (const agent of agents) {
    const d = shortestPathLength(grid, agent.start, agent.goal);
    if (!Number.isFinite(d)) return Infinity;
    total += d;
  }
  return total;
}

function resultOf(
  node: SearchNode,
  agents: readonly CbsAgent[],
  lowerBound: number,
  nodes: number,
): SolveResult {
  const goals = new Map(agents.map((a) => [a.id, a.goal]));
  const missing = unassignedAgents(node.paths, goals);

  if (missing.length > 0) {
    return {
      solved: false,
      paths: node.paths,
      makespan: makespanOf(node.paths),
      sumOfCosts: node.cost,
      lowerBound,
      nodes,
      reason: `agents did not reach their goals: ${missing.join(", ")}`,
    };
  }

  return {
    solved: true,
    paths: node.paths,
    makespan: makespanOf(node.paths),
    sumOfCosts: node.cost,
    lowerBound,
    nodes,
  };
}

function finish(
  node: SearchNode,
  agents: readonly CbsAgent[],
  lowerBound: number,
  nodes: number,
): SolveResult {
  return resultOf(node, agents, lowerBound, nodes);
}