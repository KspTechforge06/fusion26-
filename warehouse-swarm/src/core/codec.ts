import type { Grid } from "./types.js";

export interface Codec {
  width: number;
  height: number;
  cellCount: number;
  /** Position -> flat cell index. */
  cell(x: number, y: number): number;
  /** Flat cell index -> Position. */
  coord(cell: number): { x: number; y: number };
  /** (tick, cell) -> single flat key. */
  key(t: number, cell: number): number;
  /** Flat key -> tick. */
  tick(k: number): number;
  /** Flat key -> flat cell index. */
  cellOfKey(k: number): number;
}

/**
 * The single owner of the integer encoding used by the reservation table, the A*
 * visited set and the CBS constraint set, so the decode logic exists exactly once.
 */
export function makeCodec(grid: Grid): Codec {
  const width = grid.width;
  const height = grid.height;
  const cellCount = width * height;
  return {
    width,
    height,
    cellCount,
    cell: (x, y) => y * width + x,
    coord(cell) {
      const x = cell % width;
      return { x, y: (cell - x) / width };
    },
    key: (t, cell) => t * cellCount + cell,
    tick: (k) => Math.floor(k / cellCount),
    cellOfKey: (k) => k - Math.floor(k / cellCount) * cellCount,
  };
}