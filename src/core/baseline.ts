import { cbs, type CbsAgent } from "./cbs.js";
import type { World } from "./world.js";

export interface BaselineOptions {
  /** How often the controller re-plans the entire fleet, in ticks. */
  replanEveryTicks?: number;
  /** Hard cap on the makespan of a single central re-plan. */
  horizon?: number;
  maxNodes?: number;
  timeLimitMs?: number;
}

export interface BaselineReport {
  /** Wall-clock milliseconds spent inside the central planner. */
  planningMs: number;
  /** Number of full-fleet re-plans. */
  replans: number;
  /** Robots given no route in some re-plan. */
  unassigned: number;
  /** Times a robot had no route from the controller and sat still. */
  strandedTicks: number;
}

/**
 * The design the challenge rules out, implemented honestly rather than as a
 * strawman: one controller that re-plans *every* robot from scratch whenever
 * anything changes.
 *
 * Its planning is strictly better than the swarm's -- CBS over the whole fleet's
 * current goals, near-optimal. What it costs is the reason decentralisation
 * exists:
 *
 *   - every fault costs every robot a fresh plan, not just the affected ones;
 *   - planning time grows with fleet size, so a large fleet cannot keep pace with
 *     the tick rate and the whole simulation stalls behind the planner;
 *   - it is a single point of failure: while it thinks, nothing moves.
 */
export class CentralizedBaseline {
  readonly world: World;
  readonly report: BaselineReport = {
    planningMs: 0,
    replans: 0,
    unassigned: 0,
    strandedTicks: 0,
  };

  private readonly replanEvery: number;
  private readonly horizon: number;
  private readonly maxNodes: number;
  private readonly timeLimitMs: number;
  private ticksSincePlan = 0;
  private pendingReplan = false;

  constructor(world: World, options: BaselineOptions = {}) {
    this.world = world;
    this.replanEvery = options.replanEveryTicks ?? 25;
    this.horizon = options.horizon ?? 120;
    this.maxNodes = options.maxNodes ?? 600;
    this.timeLimitMs = options.timeLimitMs ?? 250;
  }

  step(): void {
    // The world advances normally; only route assignment is centralised.
    this.world.step();
    this.ticksSincePlan++;

    if (this.pendingReplan || this.ticksSincePlan >= this.replanEvery) {
      this.ticksSincePlan = 0;
      this.pendingReplan = false;
      this.replanFleet();
    }
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /** Force a full re-plan, as a fault would. */
  requestReplan(): void {
    this.pendingReplan = true;
  }

  private replanFleet(): void {
    const targets = this.world.activeTargets();
    if (targets.length === 0) return;

    const agents: CbsAgent[] = targets.map(({ robot, target }) => ({
      id: robot.id,
      start: { x: robot.x, y: robot.y },
      goal: target,
    }));

    const started = performance.now();
    const result = cbs(agents, {
      grid: this.world.grid,
      horizon: this.horizon,
      startTime: this.world.tick,
      maxNodes: this.maxNodes,
      timeLimitMs: this.timeLimitMs,
    });
    this.report.planningMs += performance.now() - started;
    this.report.replans++;

    for (const { robot } of targets) {
      const path = result.paths.get(robot.id);

      if (!path || path.length <= 1) {
        // No route this cycle: hold position and count the stall.
        this.report.strandedTicks++;
        this.report.unassigned++;
        robot.committed = [{ x: robot.x, y: robot.y }];
        robot.replanAt = this.world.tick + this.replanEvery;
        continue;
      }

      robot.committed = path.slice(1);
      robot.replanAt = this.world.tick + path.length - 1;
    }
  }
}