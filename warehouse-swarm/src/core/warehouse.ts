import { makeGrid, isFree, connectedComponent, idx, freeCells } from "./grid.js";
import { Rng } from "./rng.js";
import { World } from "./world.js";
import type { Grid, Position, RobotSpec, Task, TaskPriority } from "./types.js";

export interface WarehouseSpec {
  grid: Grid;
  docks: Position[];
  packingStations: Position[];
  chargers: Position[];
  /** Cells chosen as robot spawn points. */
  parking: Position[];
}

/**
 * Generates a warehouse with regular racking aisles.
 *
 * Layout, outermost first:
 *   - a solid perimeter wall;
 *   - wide service lanes down both sides (laneWidth cells), where the docks and
 *     packing stations live;
 *   - racking bands running horizontally between them, separated by cross aisles.
 *
 * The side lanes must be more than one cell wide. With a single-cell lane every
 * robot bound for a dock forms an unpassable queue, and the fleet's throughput ends
 * up measuring dock logistics rather than coordination -- robots spend their lives
 * shuffling along a corridor with no way to overtake.
 */
export function generateWarehouse(options: {
  width?: number;
  height?: number;
  seed: number;
  /** Shelving block height in cells. */
  rackWidth?: number;
  /** Aisle width in cells. */
  aisleWidth?: number;
  /** Cells of open service lane down each side. */
  laneWidth?: number;
  /** Every Nth rack band is omitted, creating a cross-aisle. */
  crossAisleEvery?: number;
}): WarehouseSpec {
  const {
    width = 51,
    height = 29,
    seed,
    rackWidth = 2,
    aisleWidth = 3,
    laneWidth = 3,
    crossAisleEvery = 4,
  } = options;

  const grid = makeGrid(width, height, 0);

  // Start from open floor, then carve shelving out of it.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid.cells[idx(grid, x, y)] = 1;
  }

  // Racking occupies only the middle, leaving `laneWidth` cells of service lane on
  // each side and a cross aisle at the very top and bottom.
  const rackXFrom = laneWidth + 1;
  const rackXTo = width - laneWidth - 2;
  const rackYTo = height - 3;

  const band = rackWidth + aisleWidth;
  const bandsAcross = Math.floor((rackYTo - 2) / band);
  let rackRow = 0;

  for (let b = 0; b < bandsAcross; b++) {
    const y0 = 2 + b * band;
    const isCrossAisle = crossAisleEvery > 0 && rackRow % crossAisleEvery === crossAisleEvery - 1;
    rackRow++;
    if (isCrossAisle) continue;

    for (let y = y0; y < y0 + rackWidth && y <= rackYTo; y++) {
      for (let x = rackXFrom; x <= rackXTo; x++) {
        // A real integer hash rather than a linear expression: `y*7 + x*13` reduces
        // to nothing mod 13 in x, which could leave a whole band gap-free and make
        // two different seeds generate byte-identical warehouses.
        const h = ((x * 73856093) ^ (y * 19349663) ^ (seed * 83492791)) >>> 0;
        if (h % 13 !== 0) grid.cells[idx(grid, x, y)] = 0;
      }
    }
  }

  // Perimeter last, so it always wins.
  for (let x = 0; x < width; x++) {
    grid.cells[idx(grid, x, 0)] = 0;
    grid.cells[idx(grid, x, height - 1)] = 0;
  }
  for (let y = 0; y < height; y++) {
    grid.cells[idx(grid, 0, y)] = 0;
    grid.cells[idx(grid, width - 1, y)] = 0;
  }

  // Seed the flood fill from any traversable cell, not a fixed corner: racking can
  // legitimately occupy whichever cell a hardcoded seed would pick.
  let seedCell: Position | null = null;
  for (let y = 0; y < height && seedCell === null; y++) {
    for (let x = 0; x < width; x++) {
      if (isFree(grid, x, y)) {
        seedCell = { x, y };
        break;
      }
    }
  }
  if (!seedCell) throw new Error("generateWarehouse produced no floor");

  const component = connectedComponent(grid, seedCell);
  const open = [...freeCells(grid)].filter((p) => component.has(idx(grid, p.x, p.y)));
  if (open.length === 0) throw new Error("generateWarehouse produced no reachable floor");

  // Facilities live on the wide side lanes, which racking never touches. Placing
  // them with a nearest-open search instead can drop them into a one-cell gap
  // between shelf blocks -- a dead end that robots drive into, queue inside, and
  // cannot get out of.
  const westLane = laneWidth > 1 ? 2 : 1;
  const eastLane = width - (laneWidth > 1 ? 2 : 1);

  const docks: Position[] = [];
  for (let i = 0; i < 8; i++) {
    const y = 3 + Math.floor(((height - 6) * i) / 8);
    const p = nearestOpen(grid, component, { x: westLane, y }, open);
    if (p && !docks.some((d) => d.x === p.x && d.y === p.y)) docks.push(p);
  }

  // Packing is the narrow end of the funnel: every job ends here. Too few stations
  // and the whole fleet queues on two cells, which measures logistics rather than
  // coordination.
  const packingStations: Position[] = [];
  for (let i = 0; i < 5; i++) {
    const y = 4 + Math.floor(((height - 8) * i) / 5);
    const p = nearestOpen(grid, component, { x: eastLane, y }, open);
    if (p && !packingStations.some((s) => s.x === p.x && s.y === p.y)) packingStations.push(p);
  }

  const chargers: Position[] = [];
  for (let i = 0; i < 4; i++) {
    const p = nearestOpen(grid, component, { x: 1 + (i % 2), y: height - 2 }, open);
    if (p && !chargers.some((c) => c.x === p.x && c.y === p.y)) chargers.push(p);
  }

  // Robots start in the service lanes. Spreading them over the whole floor looked
  // more realistic but parked them inside single-cell rack gaps and side aisles
  // where they immediately wedged.
  const parking = shuffleInPlace(
    open.filter((p) => p.x <= laneWidth || p.x >= width - laneWidth - 1),
    seed,
  );

  return { grid, docks, packingStations, chargers, parking };
}

/** Deterministic shuffle without threading an Rng instance through the generator. */
function shuffleInPlace<T>(items: T[], seed: number): T[] {
  return new Rng(seed).shuffle(items);
}

function nearestOpen(
  grid: Grid,
  component: Set<number>,
  target: Position,
  candidates: readonly Position[],
): Position | null {
  let best: Position | null = null;
  let bestDist = Infinity;
  for (const p of candidates) {
    if (!component.has(idx(grid, p.x, p.y))) continue;
    const d = Math.abs(p.x - target.x) + Math.abs(p.y - target.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

export interface WorldOptions {
  seed: number;
  robotCount?: number;
  initialTasks?: number;
  horizon?: number;
  serviceTime?: number;
  /** Ticks of lookahead each robot commits to before re-planning. */
  commitLength?: number;
  width?: number;
  height?: number;
  taskSpawnInterval?: number;
  taskTimeout?: number;
  /** Ticks before a wreck is repaired; 0 disables auto-repair. */
  repairTicks?: number;
}

/** Builds a complete, runnable world from a seed. */
export function createWorld(options: WorldOptions): World {
  const {
    seed,
    robotCount = 12,
    initialTasks = 6,
    horizon = 64,
    serviceTime = 3,
    commitLength = 18,
    taskSpawnInterval = 26,
    taskTimeout = 700,
    repairTicks = 90,
  } = options;

  const spec = generateWarehouse({ seed, width: options.width, height: options.height });
  const rng = new Rng(seed ^ 0x5f3759df);

  if (spec.parking.length < robotCount) {
    throw new Error(`seed ${seed}: only ${spec.parking.length} parking cells for ${robotCount} robots`);
  }

  const robots: RobotSpec[] = [];
  for (let i = 0; i < robotCount; i++) {
    const spot = spec.parking[i];
    robots.push({
      id: i,
      start: spot,
      battery: rng.chance(0.25) ? rng.int(15, 40) / 100 : rng.int(65, 100) / 100,
    });
  }

  const priorities: TaskPriority[] = ["normal", "normal", "normal", "high", "normal", "low"];
  const tasks: Task[] = [];
  for (let i = 0; i < initialTasks; i++) {
    tasks.push({
      id: i,
      pickup: rng.pick(spec.docks),
      dropoff: rng.pick(spec.packingStations),
      priority: rng.pick(priorities),
      createdTick: 0,
      claimedBy: null,
      deliveredTick: null,
      originalClaimant: null,
    });
  }

  return new World({
    grid: spec.grid,
    robots,
    tasks,
    docks: spec.docks,
    packingStations: spec.packingStations,
    chargers: spec.chargers,
    horizon,
    serviceTime,
    // Deliberately slow drain: energy management should be an occasional event,
    // not something that keeps a third of the fleet commuting to chargers and
    // swamps the coordination metrics with charger traffic.
    batteryDrain: 0.00025,
    lowBattery: 0.22,
    chargeRate: 0.012,
    seed,
    commitLength,
    repairTicks,
    taskSpawnInterval,
    taskTimeout,
  });
}