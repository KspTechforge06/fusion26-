import type { Coordinate, ParsedMap } from './types.js';

const DIRECTIONS: ReadonlyArray<Coordinate> = [
  { row: -1, column: 0 },
  { row: 1, column: 0 },
  { row: 0, column: -1 },
  { row: 0, column: 1 },
];

export class CoordinateValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CoordinateValidationError';
  }
}

function isGridCoordinate(coordinate: Coordinate): boolean {
  return Number.isSafeInteger(coordinate.row) && Number.isSafeInteger(coordinate.column);
}

export function isInBounds(map: ParsedMap, coordinate: Coordinate): boolean {
  return isGridCoordinate(coordinate)
    && coordinate.row >= 0
    && coordinate.row < map.height
    && coordinate.column >= 0
    && coordinate.column < map.width;
}

export function isTraversable(map: ParsedMap, coordinate: Coordinate): boolean {
  return isInBounds(map, coordinate) && map.rows[coordinate.row]?.[coordinate.column] === '.';
}

export function getNeighbors(map: ParsedMap, coordinate: Coordinate): Coordinate[] {
  if (!isInBounds(map, coordinate)) {
    throw new CoordinateValidationError(`${map.sourceName}: coordinate (${coordinate.row}, ${coordinate.column}) is out of bounds`);
  }
  return DIRECTIONS
    .map((direction) => ({ row: coordinate.row + direction.row, column: coordinate.column + direction.column }))
    .filter((neighbor) => isTraversable(map, neighbor));
}

export function validateWalkCoordinate(map: ParsedMap, coordinate: Coordinate, label: 'start' | 'goal'): void {
  if (!isInBounds(map, coordinate)) {
    throw new CoordinateValidationError(
      `${map.sourceName}: ${label} coordinate (${coordinate.row}, ${coordinate.column}) is out of bounds`,
    );
  }
  if (!isTraversable(map, coordinate)) {
    throw new CoordinateValidationError(
      `${map.sourceName}: ${label} coordinate (${coordinate.row}, ${coordinate.column}) is blocked`,
    );
  }
}

export function validateStartAndGoal(map: ParsedMap, start: Coordinate, goal: Coordinate): void {
  validateWalkCoordinate(map, start, 'start');
  validateWalkCoordinate(map, goal, 'goal');
}
