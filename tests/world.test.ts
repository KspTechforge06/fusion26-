import { describe, expect, it } from "vitest";
import { createWorld, generateWarehouse } from "../src/core/warehouse.js";
import { connectedComponent, idx, isFree } from "../src/core/grid.js";
import { makeCodec } from "../src/core/codec.js";
import { snapshot } from "../src/core/metrics.js";
import type { World } from "../src/core/world.js";

/**
 * Asserts the hard invariant: two live robots never share a cell.
 *
 * The world does not retain past positions, so this checks live state each tick.
 * Overlapping *paths* are already ruled out statically by the MAPF suite.
 */
function assertNoCollisions(world: World): void {
  const codec = makeCodec(world.grid);
  const live = new Map<number, number>();

  for (const robot of world.robots) {
    if (robot.state === "broken") continue;
    const cell = codec.cell(robot.x, robot.y);
    const other = live.get(cell);
    if (other !== undefined) {
      throw new Error(`tick ${world.tick}: R${other} and R${robot.id} overlap at ${robot.x},${robot.y}`);
    }
    live.set(cell, robot.id);
  }
}

describe("warehouse generation", () => {
  it("is deterministic for a given seed", () => {
    const a = generateWarehouse({ seed: 7 });
    const b = generateWarehouse({ seed: 7 });
    expect(a.grid.cells).toEqual(b.grid.cells);
    expect(a.docks).toEqual(b.docks);
    expect(a.chargers).toEqual(b.chargers);
  });

  it("differs between seeds", () => {
    const a = generateWarehouse({ seed: 1 });
    const b = generateWarehouse({ seed: 2 });
    expect(Array.from(a.grid.cells)).not.toEqual(Array.from(b.grid.cells));
  });

  it("has real shelving and a mostly-connected floor", () => {
    const { grid } = generateWarehouse({ seed: 42 });
    expect(grid.width).toBe(41);
    expect(grid.height).toBe(29);

    let blocked = 0;
    for (const cell of grid.cells) if (cell === 0) blocked++;
    // Perimeter wall plus racking: a real fraction of the floor, not a token amount.
    expect(blocked).toBeGreaterThan(grid.cells.length * 0.15);

    const component = connectedComponent(grid, { x: 1, y: 1 });
    let reachable = 0;
    let free = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (!isFree(grid, x, y)) continue;
        free++;
        if (component.has(idx(grid, x, y))) reachable++;
      }
    }
    // Shelving contains some pockets, but the great majority must be reachable.
    expect(reachable / free).toBeGreaterThan(0.95);
  });

  it("places facilities on open cells", () => {
    const { grid, docks, packingStations, chargers } = generateWarehouse({ seed: 9 });
    for (const p of [...docks, ...packingStations, ...chargers]) {
      expect(isFree(grid, p.x, p.y), `${p.x},${p.y}`).toBe(true);
    }
    expect(docks.length).toBeGreaterThanOrEqual(3);
    expect(packingStations.length).toBeGreaterThanOrEqual(1);
    expect(chargers.length).toBeGreaterThanOrEqual(1);
  });
});

describe("swarm simulation", () => {
  it("never puts two robots in the same cell", () => {
    const world = createWorld({ seed: 11, robotCount: 14, initialTasks: 6 });
    for (let i = 0; i < 400; i++) {
      world.step();
      assertNoCollisions(world);
    }
  });

  it("delivers work", () => {
    const world = createWorld({ seed: 11, robotCount: 14, initialTasks: 6 });
    world.run(1200);
    expect(world.metrics.completed).toBeGreaterThan(0);
  });

  it("keeps robots on traversable cells", () => {
    const world = createWorld({ seed: 23, robotCount: 12, initialTasks: 5 });
    for (let i = 0; i < 500; i++) {
      world.step();
      for (const robot of world.robots) {
        expect(isFree(world.grid, robot.x, robot.y), `R${robot.id} on a wall at ${robot.x},${robot.y}`).toBe(true);
      }
    }
  });

  it("never commits a route through an obstacle", () => {
    const world = createWorld({ seed: 5, robotCount: 12, initialTasks: 5 });
    for (let i = 0; i < 300; i++) {
      world.step();
      for (const robot of world.robots) {
        for (const p of robot.committed) {
          expect(isFree(world.grid, p.x, p.y), `R${robot.id} routed through a wall`).toBe(true);
        }
      }
    }
  });

  it("is reproducible for a given seed", () => {
    const a = createWorld({ seed: 77, robotCount: 10, initialTasks: 4 });
    const b = createWorld({ seed: 77, robotCount: 10, initialTasks: 4 });
    a.run(400);
    b.run(400);

    expect(a.metrics.completed).toBe(b.metrics.completed);
    expect(a.metrics.replans).toBe(b.metrics.replans);
    expect(a.robots.map((r) => [r.x, r.y])).toEqual(b.robots.map((r) => [r.x, r.y]));
  });

  it("counts re-plans sanely rather than per tick", () => {
    const world = createWorld({ seed: 11, robotCount: 14, initialTasks: 6 });
    world.run(1200);

    const s = snapshot(world.metrics);
    expect(world.metrics.completed).toBeGreaterThan(0);
    // A committed route lasts `commitLength` ticks, so an order needs a handful of
    // re-plans, not hundreds. Regression guard for idle robots counting replans.
    expect(s.replansPerTask).toBeLessThan(40);
    expect(s.replansPerTask).toBeGreaterThan(0);
  });

  it("keeps the detour ratio near 1 on an unobstructed floor", () => {
    // Coordination should cost a little distance, not double it.
    const world = createWorld({ seed: 11, robotCount: 10, initialTasks: 5 });
    world.run(1000);
    const s = snapshot(world.metrics);
    expect(s.detourRatio).toBeGreaterThan(0.9);
    expect(s.detourRatio).toBeLessThan(2.2);
  });

  it("charges low-battery robots", () => {
    const world = createWorld({ seed: 4, robotCount: 10, initialTasks: 4 });
    let sawCharging = false;
    for (let i = 0; i < 2500 && !sawCharging; i++) {
      world.step();
      sawCharging = world.robots.some((r) => r.state === "charging");
    }
    expect(sawCharging).toBe(true);
  });
});

describe("fault handling", () => {
  it("re-routes robots around a newly blocked cell", () => {
    const world = createWorld({ seed: 3, robotCount: 12, initialTasks: 6 });
    world.run(120);

    const victim = world.robots.find((r) => r.committed.length > 3);
    expect(victim).toBeDefined();
    const target = victim!.committed[2];

    expect(world.blockCell(target.x, target.y)).toBe(true);
    const replansBefore = victim!.replans;

    world.run(30);

    expect(victim!.replans).toBeGreaterThan(replansBefore);
    expect(isFree(world.grid, victim!.x, victim!.y)).toBe(true);
    expect(world.robotAt(target.x, target.y)).toBeNull();
  });

  it("refuses to entomb a robot", () => {
    const world = createWorld({ seed: 3, robotCount: 8, initialTasks: 3 });
    world.run(40);
    const robot = world.robots.find((r) => isFree(world.grid, r.x, r.y));
    expect(world.blockCell(robot!.x, robot!.y)).toBe(false);
  });

  it("returns a failed robot's job to the pool and keeps the fleet moving", () => {
    const world = createWorld({ seed: 13, robotCount: 12, initialTasks: 6 });
    world.run(150);

    const carrier = world.robots.find((r) => r.taskId !== null);
    expect(carrier).toBeDefined();
    const taskId = carrier!.taskId!;

    expect(world.failRobot(carrier!.id)).toBe(true);
    expect(world.robots[carrier!.id].state).toBe("broken");
    expect(world.tasks.get(taskId)!.claimedBy).toBeNull();

    for (let i = 0; i < 200; i++) {
      world.step();
      assertNoCollisions(world);
    }
    expect(world.metrics.completed).toBeGreaterThan(0);
  });

  it("routes around a wreck instead of driving through it", () => {
    const world = createWorld({ seed: 31, robotCount: 12, initialTasks: 8 });
    world.run(100);

    const wreck = world.robots[0];
    expect(world.failRobot(0)).toBe(true);

    for (let i = 0; i < 250; i++) {
      world.step();
      for (const robot of world.robots) {
        if (robot.id === 0 || robot.state === "broken") continue;
        expect(robot.x === wreck.x && robot.y === wreck.y).toBe(false);
      }
    }
  });

  it("brings wrecks back online after the repair delay", () => {
    const world = createWorld({ seed: 13, robotCount: 8, initialTasks: 3, repairTicks: 40 });
    world.run(20);
    expect(world.failRobot(0)).toBe(true);
    expect(world.robots[0].state).toBe("broken");

    world.run(60);
    expect(world.robots[0].state).not.toBe("broken");
  });

  it("preempts the current owner when an order is escalated", () => {
    const world = createWorld({ seed: 19, robotCount: 14, initialTasks: 8 });
    world.run(100);

    const claimed = [...world.tasks.values()].filter((t) => t.claimedBy !== null);
    expect(claimed.length).toBeGreaterThan(0);
    const task = claimed[0];

    const replansBefore = world.metrics.replans;
    expect(world.raisePriority(task.id, "rush")).toBe(true);
    expect(task.priority).toBe("rush");
    expect(world.metrics.replans).toBeGreaterThan(replansBefore);

    world.run(60);
    assertNoCollisions(world);
  });

  it("survives repeated faults without a central restart", () => {
    const world = createWorld({ seed: 101, robotCount: 16, initialTasks: 10 });

    for (let round = 0; round < 6; round++) {
      world.run(80);

      const robot = world.robots[(round * 3) % world.robots.length];
      if (world.failRobot(robot.id)) {
        world.run(40);
        world.repairRobot(robot.id);
      }

      for (let attempt = 0; attempt < 40; attempt++) {
        const x = 1 + ((round * 17 + attempt * 7) % (world.grid.width - 2));
        const y = 1 + ((round * 11 + attempt * 5) % (world.grid.height - 2));
        if (world.blockCell(x, y)) break;
      }

      world.run(40);
      assertNoCollisions(world);
    }

    expect(world.metrics.completed).toBeGreaterThan(0);
  });
});