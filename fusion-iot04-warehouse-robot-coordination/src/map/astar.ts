import type { Coordinate, ParsedMap } from './types.js';
import { isInBounds, isTraversable, CoordinateValidationError, getNeighbors } from './grid.js';

export type AStarResult =
  | { kind: 'path'; path: ReadonlyArray<Coordinate> }
  | { kind: 'no-route'; reason: string }
  | { kind: 'invalid'; reason: string };

export function findPath(
  map: ParsedMap,
  start: Coordinate,
  goal: Coordinate,
): AStarResult {
  // Basic integer coordinate check
  if (!Number.isSafeInteger(start.row) || !Number.isSafeInteger(start.column)) {
    return { kind: 'invalid', reason: `start has non-integer coordinates (${start.row}, ${start.column})` };
  }
  if (!Number.isSafeInteger(goal.row) || !Number.isSafeInteger(goal.column)) {
    return { kind: 'invalid', reason: `goal has non-integer coordinates (${goal.row}, ${goal.column})` };
  }
  if (start.row < 0 || start.column < 0 || start.row >= map.height || start.column >= map.width) {
    return { kind: 'invalid', reason: `start is out of bounds (${start.row}, ${start.column})` };
  }
  if (goal.row < 0 || goal.column < 0 || goal.row >= map.height || goal.column >= map.width) {
    return { kind: 'invalid', reason: `goal is out of bounds (${goal.row}, ${goal.column})` };
  }
  if (!isTraversable(map, start)) {
    return { kind: 'invalid', reason: `start is blocked (${start.row}, ${start.column})` };
  }
  if (!isTraversable(map, goal)) {
    return { kind: 'invalid', reason: `goal is blocked (${goal.row}, ${goal.column})` };
  }

  // Start equals goal
  if (start.row === goal.row && start.column === goal.column) {
    return { kind: 'path', path: [start] };
  }

  const openSet: { coord: Coordinate; f: number; g: number; h: number }[] = [];
  const closed = new Set<string>();
  const parents = new Map<string, Coordinate>();
  const gScore = new Map<string, number>();

  function key(c: Coordinate): string {
    return `${c.row},${c.column}`;
  }

  function manhattan(a: Coordinate, b: Coordinate): number {
    return Math.abs(a.row - b.row) + Math.abs(a.column - b.column);
  }

  const h0 = manhattan(start, goal);
  openSet.push({ coord: start, f: h0, g: 0, h: h0 });
  gScore.set(key(start), 0);

  while (openSet.length > 0) {
    // Pick lowest f, tie-break by lower h, then lower row, then lower column
    openSet.sort((a, b) => {
      if (a.f !== b.f) return a.f - b.f;
      if (a.h !== b.h) return a.h - b.h;
      if (a.coord.row !== b.coord.row) return a.coord.row - b.coord.row;
      return a.coord.column - b.coord.column;
    });
    const current = openSet.shift()!;
    const currentKey = key(current.coord);

    if (current.coord.row === goal.row && current.coord.column === goal.column) {
      // Reconstruct
      const path: Coordinate[] = [];
      let curr: Coordinate = goal;
      while (true) {
        path.push({ ...curr });
        if (curr.row === start.row && curr.column === start.column) break;
        const pKey = key(curr);
        const parent = parents.get(pKey);
        if (parent === undefined) {
          return { kind: 'no-route', reason: 'parent map broken during reconstruction' };
        }
        curr = parent;
      }
      path.reverse();
      return { kind: 'path', path };
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    const neighbors = getNeighbors(map, current.coord);
    for (const neighbor of neighbors) {
      const nKey = key(neighbor);
      if (closed.has(nKey)) continue;
      const tentativeG = current.g + 1;
      const existingG = gScore.get(nKey);
      if (existingG === undefined || tentativeG < existingG) {
        parents.set(nKey, current.coord);
        gScore.set(nKey, tentativeG);
        const hNeighbor = manhattan(neighbor, goal);
        const fNeighbor = tentativeG + hNeighbor;
        openSet.push({ coord: neighbor, f: fNeighbor, g: tentativeG, h: hNeighbor });
      }
    }
  }

  return { kind: 'no-route', reason: 'goal unreachable from start' };
}
