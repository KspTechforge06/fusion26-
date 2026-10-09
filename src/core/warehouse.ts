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
 * Layout: blocks of shelving separated by open aisles. The perimeter is walled,
 * x=1 and x=width-2 are kept clear as perimeter lanes, and each rack band is
 * punched with periodic gaps so the floor stays connected -- an unreachable aisle
 * makes for a useless test, and real warehouses are designed to avoid that too.
 */
export function generateWarehouse(options: {
  width?: number;
  height?: number;
  seed: number;
  /** Shelving block height in cells. */
  rackWidth?: number;
  /** Aisle width in cells. */
  aisleWidth?: number;
  /** Every Nth rack band is omitted, creating a cross-aisle. */
  crossAisleEvery?: number;
}): WarehouseSpec {
  const {
    width = 41,
    height = 29,
    seed,
    rackWidth = 2,
    aisleWidth = 3,
    crossAisleEvery = 4,
  } = options;

  const rng = new Rng(seed);
  const grid = makeGrid(width, height, 0);

  // Start from open floor, then carve shelving out of it.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) grid.cells[idx(grid, x, y)] = 1;
  }

  const band = rackWidth + aisleWidth;
  const bandsAcross = Math.floor((height - 2) / band);
  let rackRow = 0;

  for (let b = 0; b < bandsAcross; b++) {
    const y0 = 1 + b * band;
    const isCrossAisle = crossAisleEvery > 0 && rackRow % crossAisleEvery === crossAisleEvery - 1;
    rackRow++;
    if (isCrossAisle) continue;

    for (let y = y0; y < y0 + rackWidth && y < height - 1; y++) {
      for (let x = 2; x < width - 2; x++) {
        const gap = (y * 7 + x * 13 + seed) % 11 === 0;
        if (!gap) grid.cells[idx(grid, x, y)] = 0;
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

  const docks: Position[] = [];
  for (let i = 0; i < 4; i++) {
    const y = 3 + Math.floor(((height - 6) * i) / 4);
    const p = nearestOpen(grid, component, { x: 2, y }, open);
    if (p) docks.push(p);
  }

  const packingStations: Position[] = [];
  for (let i = 0; i < 2; i++) {
    const y = 5 + Math.floor(((height - 10) * i) / 2);
    const p = nearestOpen(grid, component, { x: width - 3, y }, open);
    if (p) packingStations.push(p);
  }

  const chargers: Position[] = [];
  for (let i = 0; i < 3; i++) {
    const x = 6 + Math.floor(((width - 12) * i) / 3);
    const p = nearestOpen(grid, component, { x, y: height - 2 }, open);
    if (p) chargers.push(p);
  }

  // Spawn robots on the perimeter lanes so none starts inside racking.
  const parking = open.filter((p) => p.x <= 2 || p.x >= width - 3 || p.y <= 2 || p.y >= height - 3);
  rng.shuffle(parking);

  return { grid, docks, packingStations, chargers, parking };
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
    serviceTime = 4,
    commitLength = 18,
    taskSpawnInterval = 14,
    taskTimeout = 400,
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