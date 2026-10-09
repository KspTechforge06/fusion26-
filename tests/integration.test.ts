import { describe, expect, it } from "vitest";
import { createWorld } from "../src/core/warehouse.js";

/** Integrated dashboard/demo verification: collision-free, reassignment, state consistent. */
describe("integrated demo sequence", () => {
  it("runs seed 42 with 14 robots, 6 tasks, 400 ticks without collisions", () => {
    const world = createWorld({ seed: 42, robotCount: 14, initialTasks: 6 });
    for (let i = 0; i < 400; i++) {
      world.step();
      // vertex conflict check
      const seen = new Set<number>();
      for (const r of world.robots) {
        if (r.state === "broken") continue;
        const c = r.x + r.y * world.grid.width;
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
  });

  it("fails a robot and recovers its task, then completes after repair", () => {
    const world = createWorld({ seed: 7, robotCount: 8, initialTasks: 3, repairTicks: 30 });
    world.run(60);
    const carrier = world.robots.find((r) => r.taskId !== null);
    expect(carrier).toBeDefined();
    const taskId = carrier!.taskId!;

    expect(world.failRobot(carrier!.id)).toBe(true);
    expect(world.tasks.get(taskId)!.claimedBy).toBeNull();

    world.run(40); // repair window
    expect(world.robots[carrier!.id].state).not.toBe("broken");
    world.run(200);
    expect(world.metrics.completed).toBeGreaterThan(0);
  });

  it("priority escalation changes assignment with real preemption", () => {
    const world = createWorld({ seed: 19, robotCount: 14, initialTasks: 8 });
    world.run(100);
    const claimed = [...world.tasks.values()].filter((t) => t.claimedBy !== null);
    expect(claimed.length).toBeGreaterThan(0);
    const task = claimed[0];
    const replansBefore = world.metrics.replans;
    expect(world.raisePriority(task.id, "rush")).toBe(true);
    expect(task.priority).toBe("rush");
    expect(world.metrics.replans).toBeGreaterThan(replansBefore);
  });
});
