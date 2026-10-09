import type { Grid, Position } from "./types.js";

export const FREE = 1;
export const BLOCKED = 0;

export function makeGrid(width: number, height: number, fill: number = FREE): Grid {
  const cells = new Uint8Array(width * height);
  cells.fill(fill);
  return { width, height, cells };
}

export function idx(grid: Grid, x: number, y: number): number {
  return y * grid.width + x;
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function isFree(grid: Grid, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) return false;
  return grid.cells[idx(grid, x, y)] === FREE;
}

/**
 * Manhattan distance.
 *
 * Admissible as an A* heuristic on a 4-connected grid, which is what keeps the
 * search optimal: it never overestimates the remaining cost.
 */
export function manhattan(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function cloneGrid(grid: Grid): Grid {
  return { width: grid.width, height: grid.height, cells: grid.cells.slice() };
}

export function setCell(grid: Grid, x: number, y: number, value: number): void {
  if (inBounds(grid, x, y)) grid.cells[idx(grid, x, y)] = value;
}

export function* freeCells(grid: Grid): Generator<Position> {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.cells[idx(grid, x, y)] === FREE) yield { x, y };
    }
  }
}

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Flood fill from a start cell. Used to reject disconnected maps and to sample agents. */
export function connectedComponent(grid: Grid, start: Position): Set<number> {
  const seen = new Set<number>();
  if (!isFree(grid, start.x, start.y)) return seen;

  const queue: Position[] = [start];
  seen.add(idx(grid, start.x, start.y));

  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!isFree(grid, nx, ny)) continue;
      const k = idx(grid, nx, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }

  return seen;
}