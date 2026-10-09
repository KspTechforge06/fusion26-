import { describe, expect, it } from "vitest";
import { makeGrid, BLOCKED, FREE } from "../src/core/grid.js";
import {
  spaceTimeAStar,
  shortestPathLength,
  planCost,
  pathLength,
  distanceField,
  fieldDistance,
} from "../src/core/astar.js";
import { ReservationTable } from "../src/core/reservation.js";

function room(width: number, height: number) {
  return makeGrid(width, height, FREE);
}

function wallRow(grid: ReturnType<typeof makeGrid>, y: number, from: number, to: number): void {
  for (let x = from; x <= to; x++) grid.cells[y * grid.width + x] = BLOCKED;
}

describe("spaceTimeAStar", () => {
  it("walks a straight line in open space", () => {
    const grid = room(10, 10);
    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 5, y: 0 }, {
      grid,
      selfId: 0,
      horizon: 50,
    });
    expect(result).not.toBeNull();
    expect(planCost(result!.path)).toBe(5);
    expect(pathLength(result!.path)).toBe(5);
  });

  it("is optimal on an open field -- cross-checked against BFS", () => {
    const grid = room(40, 40);
    for (let i = 0; i < 25; i++) {
      const sx = (i * 7) % 35;
      const sy = (i * 11) % 35;
      const gx = 35 - sx;
      const gy = 35 - sy;
      const astar = spaceTimeAStar({ x: sx, y: sy }, { x: gx, y: gy }, {
        grid,
        selfId: 0,
        horizon: 200,
      });
      expect(astar).not.toBeNull();
      expect(planCost(astar!.path)).toBe(shortestPathLength(grid, { x: sx, y: sy }, { x: gx, y: gy }));
    }
  });

  it("routes around an obstacle and stays optimal", () => {
    const grid = room(10, 10);
    wallRow(grid, 5, 0, 5);

    const result = spaceTimeAStar({ x: 0, y: 5 }, { x: 9, y: 5 }, {
      grid,
      selfId: 0,
      horizon: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.path.some((p) => p.y !== 5)).toBe(true);
    // 9 across + 1 up + 1 down = 11.
    expect(planCost(result!.path)).toBe(11);
  });

  it("returns null when the goal is walled off", () => {
    const grid = room(7, 7);
    for (let y = 0; y < 7; y++) grid.cells[y * 7 + 3] = BLOCKED;
    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 6, y: 6 }, {
      grid,
      selfId: 0,
      horizon: 200,
    });
    expect(result).toBeNull();
  });

  it("respects the horizon", () => {
    const grid = room(30, 2);
    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 25, y: 0 }, {
      grid,
      selfId: 0,
      horizon: 10,
    });
    expect(result).toBeNull();
  });

  it("honours startTime, so mid-simulation plans schedule correctly", () => {
    const grid = room(20, 3);
    const result = spaceTimeAStar({ x: 0, y: 1 }, { x: 10, y: 1 }, {
      grid,
      selfId: 0,
      startTime: 1000,
      horizon: 50,
    });
    expect(result).not.toBeNull();
    expect(planCost(result!.path)).toBe(10);
    expect(result!.path[0]).toEqual({ x: 0, y: 1 });
  });

  it("queues behind a stationary robot instead of driving through it", () => {
    const grid = room(9, 1);
    const table = new ReservationTable(grid);

    // Robot 0 parked at x=4 through tick 20.
    for (let t = 0; t <= 20; t++) table.claim(t, 4, 0, 0);

    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 8, y: 0 }, {
      grid,
      table,
      selfId: 1,
      horizon: 60,
    });

    expect(result).not.toBeNull();
    // Single-row corridor: no way around, so it waits at x=3 and moves on at t=21.
    expect(planCost(result!.path)).toBe(25);
    expect(result!.path[20]).toEqual({ x: 3, y: 0 });
    expect(result!.path[21]).toEqual({ x: 4, y: 0 });

    for (let t = 0; t < result!.path.length; t++) {
      const p = result!.path[t];
      expect(table.isHeldByOther(t, p.x, p.y, 1)).toBe(false);
    }
  });

  it("refuses to swap cells with another agent", () => {
    const grid = room(5, 1);
    const table = new ReservationTable(grid);

    // Robot 0 sits at x=4 and steps to x=3 next tick. A naive agent 1 stepping
    // x=3 -> x=4 would exchange cells with it.
    table.claim(0, 4, 0, 0);
    table.claim(1, 3, 0, 0);

    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 4, y: 0 }, {
      grid,
      table,
      selfId: 1,
      horizon: 40,
    });

    expect(result).not.toBeNull();
    // The swap would show up as agent 1 entering x=4 (or x=3) on tick 1.
    expect(result!.path[1]).not.toEqual({ x: 4, y: 0 });
    expect(result!.path[1]).not.toEqual({ x: 3, y: 0 });
    // And it costs nothing: robot 0 has cleared x=4 by tick 4, so agent 1 simply
    // walks straight through at full speed.
    expect(planCost(result!.path)).toBe(4);
  });

  it("treats a permanent obstacle as impassable for everyone", () => {
    const grid = room(9, 1);
    const table = new ReservationTable(grid);
    table.claimStatic(4, 0, 7);

    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 8, y: 0 }, {
      grid,
      table,
      selfId: 1,
      horizon: 60,
    });

    expect(result).toBeNull();
    expect(table.staticCount).toBe(1);
  });

  it("lets an agent pass through its own permanent obstacle", () => {
    const grid = room(9, 1);
    const table = new ReservationTable(grid);
    table.claimStatic(4, 0, 7);

    const result = spaceTimeAStar({ x: 4, y: 0 }, { x: 8, y: 0 }, {
      grid,
      table,
      selfId: 7,
      horizon: 30,
    });
    expect(result).not.toBeNull();
  });

  it("obeys CBS constraints at the constrained tick only", () => {
    const grid = room(10, 1);
    const result = spaceTimeAStar({ x: 0, y: 0 }, { x: 9, y: 0 }, {
      grid,
      selfId: 0,
      horizon: 40,
      constraints: [{ t: 4, x: 4, y: 0 }],
    });

    expect(result).not.toBeNull();
    // Forbidden at tick 4 specifically -- the robot may still cross later, once
    // the constraint's purpose (avoiding one specific collision) is served.
    expect(result!.path[4]).not.toEqual({ x: 4, y: 0 });
    // The detour costs at least one extra tick.
    expect(planCost(result!.path)).toBeGreaterThan(9);
  });
});

describe("distanceField", () => {
  it("agrees with single-pair shortest path", () => {
    const grid = room(30, 30);
    wallRow(grid, 10, 0, 20);
    const from = { x: 2, y: 2 };
    const field = distanceField(grid, from);

    for (const to of [{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 2, y: 25 }]) {
      expect(fieldDistance(grid, field, to)).toBe(shortestPathLength(grid, from, to));
    }
  });

  it("marks unreachable cells as infinite", () => {
    const grid = room(7, 7);
    for (let y = 0; y < 7; y++) grid.cells[y * 7 + 3] = BLOCKED;
    const field = distanceField(grid, { x: 0, y: 0 });
    expect(fieldDistance(grid, field, { x: 5, y: 0 })).toBe(Infinity);
  });

  it("returns zero at the origin", () => {
    const grid = room(5, 5);
    expect(shortestPathLength(grid, { x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});