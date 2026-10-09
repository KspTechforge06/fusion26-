import { MinHeap } from "./heap.js";
import { DIRS, isFree, manhattan } from "./grid.js";
import { makeCodec } from "./codec.js";
import type { Grid, Position } from "./types.js";
import { ReservationTable } from "./reservation.js";

/** "This agent may not occupy (x, y) at tick t." Produced by CBS. */
export interface TimeConstraint {
  t: number;
  x: number;
  y: number;
}

export interface PlanOptions {
  grid: Grid;
  /** Omit for a single-agent plan with no traffic to avoid. */
  table?: ReservationTable;
  /** Agent id, so an agent may re-reserve its own committed cells. */
  selfId: number;
  /** Absolute tick the plan begins at. Defaults to 0. */
  startTime?: number;
  /** Ticks of lookahead. */
  horizon: number;
  /** Constraints that apply to this agent specifically. */
  constraints?: readonly TimeConstraint[];
  /**
   * Allow a robot to hold position on a cell another agent has reserved for a
   * later tick, and to plan a move that would require it to vacate.
   *
   * Strict mode (the default) is what makes a plan provably conflict-free, which
   * is the contract the offline MAPF solver and its benchmark results depend on.
   *
   * The online warehouse simulation turns it on. There, other robots' committed
   * routes are *predictions* that go stale as soon as anyone re-plans, and a
   * robot faced with a neighbour predicted to cross its cell would otherwise have
   * no legal option at all -- it can neither move nor wait, so the search fails and
   * it sits stranded. Letting it hold makes it queue and forces the neighbour to
   * yield. Safety does not depend on the plan: world.ts resolves every tick's moves
   * atomically and refuses anything that would put two robots in one cell.
   */
  allowContestedWait?: boolean;
}

export interface PlanResult {
  /** path[t - startTime] is the position at tick t; path[0] === start. */
  path: Position[];
  /** Ticks from start to goal. */
  cost: number;
  expanded: number;
}

interface Node {
  x: number;
  y: number;
  t: number;
}

/**
 * A* over (x, y, t).
 *
 * The search state is space *and* time. A cell is a different thing at every
 * tick, which is what makes multi-agent planning tractable: an agent can plan to
 * occupy a cell once the previous occupant has cleared it.
 *
 * Two safety rules are enforced on every successor. Both are easy to forget and
 * produce subtle, hard-to-reproduce bugs:
 *
 *   vertex conflict -- never enter a cell held by another agent at that tick.
 *   edge conflict   -- never leave a cell another agent holds at the next tick.
 *                      That is exactly the swap case, where A and B exchange cells
 *                      in one step, never share a cell, and still collide.
 *
 * Waits are modelled as real moves. Without them agents cannot queue behind each
 * other and the search livelocks in any corridor.
 *
 * Every edge costs 1 on a uniform grid, so g(n) === t - startTime: the timestep
 * carries the cost and no separate gScore map is needed.
 *
 * A note on the edge rule: when a reservation forces a robot to vacate, waiting is
 * still offered as a fallback. In a rolling-horizon simulation another robot's
 * committed route is a *prediction*, not a fact, and treating it as an absolute
 * barrier makes the search return no plan at all -- a robot one step from its goal
 * will refuse to plan because a neighbour's predicted route crosses its cell.
 * Actual collisions are prevented unconditionally by the atomic executor in
 * world.ts, so relaxing this here costs correctness nothing and buys liveness.
 */
export function spaceTimeAStar(
  start: Position,
  goal: Position,
  opts: PlanOptions,
): PlanResult | null {
  const { grid, table, selfId, horizon } = opts;
  const lax = opts.allowContestedWait === true;
  const codec = makeCodec(grid);
  const t0 = opts.startTime ?? 0;
  const tEnd = t0 + horizon;

  const constraints = opts.constraints ?? [];
  const blocked = constraints.length > 0 ? buildConstraintKeySet(constraints, codec) : null;

  const heap = new MinHeap<Node>();
  const visited = new Set<number>();
  const cameFrom = new Map<number, number>();

  visited.add(codec.key(t0, codec.cell(start.x, start.y)));
  heap.push({ x: start.x, y: start.y, t: t0 }, manhattan(start, goal));

  let expanded = 0;

  while (heap.size > 0) {
    const cur = heap.pop()!;
    expanded++;

    if (cur.x === goal.x && cur.y === goal.y) {
      return {
        path: tracePath(cameFrom, codec.key(cur.t, codec.cell(cur.x, cur.y)), codec, t0),
        cost: cur.t - t0,
        expanded,
      };
    }

    if (cur.t >= tEnd) continue;

    const nt = cur.t + 1;

    // Someone else has reserved the cell we are standing on for the next tick, so
    // moving now risks a swap with them.
    const vacateRequired = table ? table.isHeldByOther(nt, cur.x, cur.y, selfId) : false;

    if (vacateRequired && !lax) {
      // Strict: neither moving nor waiting is legal, so this node is a dead end.
      continue;
    }

    consider(cur, cur.x, cur.y, nt, true); // wait

    if (!vacateRequired) {
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!isFree(grid, nx, ny)) continue;
        consider(cur, nx, ny, nt, false);
      }
    }
  }

  return null;

  function consider(from: Node, x: number, y: number, t: number, isWait: boolean): void {
    const cell = codec.cell(x, y);

    if (blocked && blocked.has(codec.key(t, cell))) return;

    if (table && table.isStaticBlockedByOther(x, y, selfId)) return;

    // Vertex conflict. In relaxed mode a wait is exempt: holding position is not a
    // move, and the case that matters is a robot whose cell a neighbour has
    // predicted it will enter. See `allowContestedWait`.
    if (!isWait && table && table.isHeldByOther(t, x, y, selfId)) return;
    if (isWait && !lax && table && table.isHeldByOther(t, x, y, selfId)) return;

    const k = codec.key(t, cell);
    if (visited.has(k)) return;

    visited.add(k);
    cameFrom.set(k, codec.key(from.t, codec.cell(from.x, from.y)));
    heap.push({ x, y, t }, t - t0 + manhattan({ x, y }, goal));
  }
}

function buildConstraintKeySet(
  constraints: readonly TimeConstraint[],
  codec: ReturnType<typeof makeCodec>,
): Set<number> {
  const set = new Set<number>();
  for (const c of constraints) set.add(codec.key(c.t, codec.cell(c.x, c.y)));
  return set;
}

/** Walks the parent chain from the goal node back to the start and reverses. */
function tracePath(
  cameFrom: Map<number, number>,
  goalKey: number,
  codec: ReturnType<typeof makeCodec>,
  t0: number,
): Position[] {
  const path: Position[] = [];
  let k: number | undefined = goalKey;

  while (k !== undefined) {
    path.push(codec.coord(codec.cellOfKey(k)));
    if (codec.tick(k) === t0) break;
    k = cameFrom.get(k);
  }

  return path.reverse();
}

/**
 * Single-source BFS distance field over the whole grid.
 *
 * One BFS answers "how far is every cell from here", which turns an auction that
 * needs distances to dozens of jobs from O(jobs x cells) into O(cells). Callers
 * cache the field per robot: it stays valid until the robot moves.
 *
 * -1 marks unreachable.
 */
export function distanceField(grid: Grid, from: Position): Int32Array {
  const codec = makeCodec(grid);
  const dist = new Int32Array(codec.cellCount).fill(-1);
  if (!isFree(grid, from.x, from.y)) return dist;

  const queue = new Int32Array(codec.cellCount);
  let head = 0;
  let tail = 0;

  const start = codec.cell(from.x, from.y);
  dist[start] = 0;
  queue[tail++] = start;

  while (head < tail) {
    const cell = queue[head++];
    const d = dist[cell];
    const x = cell % codec.width;
    const y = (cell - x) / codec.width;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isFree(grid, nx, ny)) continue;
      const ncell = ny * codec.width + nx;
      if (dist[ncell] !== -1) continue;
      dist[ncell] = d + 1;
      queue[tail++] = ncell;
    }
  }

  return dist;
}

/** Reads a cached distance field. */
export function fieldDistance(grid: Grid, field: Int32Array, to: Position): number {
  if (to.x < 0 || to.y < 0 || to.x >= grid.width || to.y >= grid.height) return -1;
  const d = field[to.y * grid.width + to.x];
  return d === -1 ? Infinity : d;
}

/**
 * Convenience single-pair distance. Deliberately a different algorithm from the
 * A* above so it can act as an independent check on A* optimality in the tests.
 */
export function shortestPathLength(grid: Grid, start: Position, goal: Position): number {
  return fieldDistance(grid, distanceField(grid, start), goal);
}

/** Ticks a plan consumes before the agent arrives. */
export function planCost(path: readonly Position[]): number {
  return path.length - 1;
}

/** Manhattan distance actually walked, ignoring waits. */
export function pathLength(path: readonly Position[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    total += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }
  return total;
}