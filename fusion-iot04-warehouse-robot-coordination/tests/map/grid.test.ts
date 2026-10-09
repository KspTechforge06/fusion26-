import { describe, expect, it } from 'vitest';
import {
  CoordinateValidationError,
  getNeighbors,
  isInBounds,
  isTraversable,
  validateStartAndGoal,
  validateWalkCoordinate,
} from '../../src/map/grid.js';
import { parseMapText } from '../../src/map/parseMap.js';
import type { Coordinate } from '../../src/map/types.js';

const map = parseMapText([
  'type octile',
  'height 3',
  'width 4',
  'map',
  '.@..',
  '....',
  '..@.',
].join('\n'), 'grid.map');

function expectCoordinateError(action: () => void, message: RegExp): void {
  expect(action).toThrowError(CoordinateValidationError);
  expect(action).toThrowError(message);
}

describe('grid utilities', () => {
  it('checks bounds and distinguishes traversable from blocked cells', () => {
    expect(isInBounds(map, { row: 0, column: 0 })).toBe(true);
    expect(isInBounds(map, { row: -1, column: 0 })).toBe(false);
    expect(isTraversable(map, { row: 0, column: 0 })).toBe(true);
    expect(isTraversable(map, { row: 0, column: 1 })).toBe(false);
    expect(isTraversable(map, { row: 9, column: 9 })).toBe(false);
  });

  it('returns only valid four-directional neighbors', () => {
    expect(getNeighbors(map, { row: 1, column: 1 })).toEqual([
      { row: 0, column: 1 },
      { row: 2, column: 1 },
      { row: 1, column: 0 },
      { row: 1, column: 2 },
    ].filter((coordinate) => isTraversable(map, coordinate)));
    expect(getNeighbors(map, { row: 0, column: 0 })).toEqual([{ row: 1, column: 0 }]);
    expect(getNeighbors(map, { row: 2, column: 3 })).toEqual([{ row: 1, column: 3 }]);
  });

  it('never includes diagonal or out-of-bounds neighbors', () => {
    const neighbors = getNeighbors(map, { row: 1, column: 1 });
    expect(neighbors).not.toContainEqual({ row: 0, column: 0 });
    expect(neighbors).not.toContainEqual({ row: 2, column: 2 });
    expect(neighbors.every(({ row, column }) => isInBounds(map, { row, column }))).toBe(true);
  });

  it('rejects negative, non-integral, and beyond-bound coordinates', () => {
    const negative: Coordinate = { row: -1, column: 0 };
    const fractional: Coordinate = { row: 0.5, column: 0 };
    const nonFinite: Coordinate = { row: Number.NaN, column: 0 };
    const beyond: Coordinate = { row: 3, column: 0 };
    expectCoordinateError(() => validateWalkCoordinate(map, negative, 'start'), /start.*out of bounds/);
    expectCoordinateError(() => validateWalkCoordinate(map, fractional, 'start'), /start.*out of bounds/);
    expectCoordinateError(() => validateWalkCoordinate(map, nonFinite, 'start'), /start.*out of bounds/);
    expectCoordinateError(() => validateWalkCoordinate(map, beyond, 'goal'), /goal.*out of bounds/);
    expectCoordinateError(() => getNeighbors(map, negative), /out of bounds/);
  });

  it('rejects blocked start and goal cells', () => {
    expectCoordinateError(() => validateWalkCoordinate(map, { row: 0, column: 1 }, 'start'), /start.*blocked/);
    expectCoordinateError(() => validateWalkCoordinate(map, { row: 2, column: 2 }, 'goal'), /goal.*blocked/);
    expectCoordinateError(
      () => validateStartAndGoal(map, { row: 0, column: 0 }, { row: 0, column: 1 }),
      /goal.*blocked/,
    );
  });
});
