import { distanceField, fieldDistance, shortestPathLength, spaceTimeAStar } from "./astar.js";
import { makeCodec } from "./codec.js";
import { idx, isFree } from "./grid.js";
import { Rng } from "./rng.js";
import { ReservationTable } from "./reservation.js";
import { PRIORITY_WEIGHT } from "./types.js";
import type {
  AgentState,
  Grid,
  LogEvent,
  Metrics,
  Position,
  ReplanCause,
  RobotSpec,
  Task,
  TaskPriority,
} from "./types.js";

/**
 * Consecutive stationary ticks a robot has spent. Tracked for the metrics panel
 * and for spotting standoffs; it deliberately does not by itself trigger a
 * re-plan, because ordinary queueing behind a slow robot is not a deadlock.
 */
/**
 * How long a robot must sit still before the robots behind it treat it as stalled
 * rather than merely slow. Queueing is the common case in a warehouse aisle and
 * must not be reported, or re-planned, as a deadlock.
 */
const STALLED_WAIT_LIMIT = 4;

export interface Robot {
  id: number;
  x: number;
  y: number;
  state: AgentState;
  battery: number;
  taskId: number | null;
  /** Stage of the current job. */
  stage: "to-pickup" | "picking" | "to-dropoff" | "dropping" | null;
  serviceUntil: number;
  /** Remaining committed route; index 0 is the next cell to enter. */
  committed: Position[];
  /** Absolute tick at which the committed route runs out. */
  replanAt: number;
  replanCause: ReplanCause | null;
  /** Loaded-leg distance walked since claiming the current order. */
  taskDistance: number;
  waitTicks: number;
  moves: number;
  replans: number;
  /**
   * Consecutive ticks spent not moving. Tracked for the metrics panel and to spot
   * standoffs; it does not by itself trigger a re-plan, because queueing behind a
   * slow robot is not a deadlock.
   */
  consecutiveWaits: number;
  /** Cached BFS field, valid while the robot has not moved. */
  distField: Int32Array | null;
  /** Position the cached field was built from. */
  distFieldAt: Position | null;
  /** Tick the robot failed, for the repair timer. */
  brokenAt: number;
}

export interface WorldOptions {
  grid: Grid;
  robots: RobotSpec[];
  tasks: Task[];
  docks: Position[];
  packingStations: Position[];
  chargers: Position[];
  horizon: number;
  serviceTime: number;
  batteryDrain: number;
  lowBattery: number;
  chargeRate: number;
  seed: number;
  /**
   * How many ticks of a plan a robot commits to before re-planning.
   *
   * This is the central knob for the "no central bottleneck" claim: replanning is
   * per-robot and looks only this far ahead. Larger values mean fewer re-plans but
   * staler reactions to faults.
   */
  commitLength: number;
  /** Ticks after which a wreck is brought back online. */
  repairTicks: number;
  taskSpawnInterval: number;
  taskTimeout: number;
}

export class World {
  readonly grid: Grid;
  readonly robots: Robot[];
  readonly tasks: Map<number, Task>;
  readonly docks: Position[];
  readonly packingStations: Position[];
  readonly chargers: Position[];
  readonly horizon: number;
  readonly serviceTime: number;
  readonly batteryDrain: number;
  readonly lowBattery: number;
  readonly chargeRate: number;
  readonly commitLength: number;
  readonly repairTicks: number;
  readonly taskSpawnInterval: number;
  readonly taskTimeout: number;
  /** Visits per cell, for the congestion heatmap. */
  readonly congestion: Float32Array;

  tick = 0;
  log: LogEvent[] = [];
  metrics: Metrics;

  private codec: ReturnType<typeof makeCodec>;
  private rng: Rng;
  private nextTaskId: number;
  private spawnAccumulator = 0;
  private occupancy = new Map<number, number>();
  private epoch = 0;

  constructor(options: WorldOptions) {
    this.grid = options.grid;
    this.horizon = options.horizon;
    this.serviceTime = options.serviceTime;
    this.batteryDrain = options.batteryDrain;
    this.lowBattery = options.lowBattery;
    this.chargeRate = options.chargeRate;
    this.commitLength = options.commitLength;
    this.repairTicks = options.repairTicks;
    this.taskSpawnInterval = options.taskSpawnInterval;
    this.taskTimeout = options.taskTimeout;
    this.docks = options.docks;
    this.packingStations = options.packingStations;
    this.chargers = options.chargers;

    this.codec = makeCodec(options.grid);
    this.rng = new Rng(options.seed);

    this.robots = options.robots.map((spec) => ({
      id: spec.id,
      x: spec.start.x,
      y: spec.start.y,
      state: "idle" as AgentState,
      battery: spec.battery,
      taskId: null,
      stage: null,
      serviceUntil: 0,
      committed: [],
      replanAt: 0,
      replanCause: null,
      taskDistance: 0,
      waitTicks: 0,
      moves: 0,
      replans: 0,
      consecutiveWaits: 0,
      distField: null,
      distFieldAt: null,
      brokenAt: 0,
    }));

    this.tasks = new Map(options.tasks.map((t) => [t.id, t]));
    this.nextTaskId = options.tasks.length;
    this.congestion = new Float32Array(this.codec.cellCount);
    this.metrics = freshMetrics();

    for (const task of options.tasks) {
      this.metrics.tasksByPriority[task.priority].created++;
    }

    this.refreshOccupancy();
  }

  // ---------------------------------------------------------------- queries

  isBlocked(x: number, y: number): boolean {
    return !isFree(this.grid, x, y);
  }

  robotAt(x: number, y: number): Robot | null {
    const id = this.occupancy.get(this.codec.cell(x, y));
    return id === undefined ? null : this.robots[id];
  }

  openTasks(): Task[] {
    return [...this.tasks.values()].filter((t) => t.claimedBy === null && t.deliveredTick === null);
  }

  /** Bumped whenever a fault changes the world, so a UI can react. */
  get currentEpoch(): number {
    return this.epoch;
  }

  /** Live robots that want to be somewhere, and where. */
  activeTargets(): Array<{ robot: Robot; target: Position }> {
    const out: Array<{ robot: Robot; target: Position }> = [];
    for (const robot of this.robots) {
      if (robot.state === "broken" || robot.state === "charging") continue;
      const target = this.targetFor(robot);
      if (target) out.push({ robot, target });
    }
    return out;
  }

  // ------------------------------------------------------------- fault hooks

  /**
   * Drops shelving into a cell. Any robot routed through it notices on its own
   * next tick and re-plans locally -- nothing is broadcast.
   */
  blockCell(x: number, y: number): boolean {
    if (!isFree(this.grid, x, y)) return false;
    if (this.robotAt(x, y)) return false; // never entomb a robot

    this.grid.cells[idx(this.grid, x, y)] = 0;
    this.congestion[this.codec.cell(x, y)] = 0;
    this.epoch++;
    this.addLog(null, "cell-blocked", `shelving dropped at (${x},${y})`);
    return true;
  }

  unblockCell(x: number, y: number): boolean {
    if (isFree(this.grid, x, y)) return false;
    this.grid.cells[idx(this.grid, x, y)] = 1;
    this.epoch++;
    this.addLog(null, "cell-blocked", `(${x},${y}) aisle cleared`);
    return true;
  }

  /**
   * Kills a robot where it stands. Its job returns to the pool and the wreck
   * becomes a permanent obstacle. With no central plan to invalidate, the fleet
   * simply carries on.
   */
  failRobot(robotId: number): boolean {
    const robot = this.robots[robotId];
    if (!robot || robot.state === "broken") return false;

    if (robot.taskId !== null) {
      const task = this.tasks.get(robot.taskId);
      if (task) {
        task.claimedBy = null;
        this.addLog(robotId, "robot-failed", `R${robotId} failed; order ${task.id} returned to pool`);
      }
    }

    robot.state = "broken";
    robot.brokenAt = this.tick;
    robot.taskId = null;
    robot.stage = null;
    robot.committed = [];
    robot.serviceUntil = 0;
    this.invalidateFields();
    this.epoch++;
    this.addLog(robotId, "robot-failed", `R${robotId} motor failure at (${robot.x},${robot.y})`);
    this.refreshOccupancy();
    return true;
  }

  repairRobot(robotId: number): boolean {
    const robot = this.robots[robotId];
    if (!robot || robot.state !== "broken") return false;
    robot.state = "idle";
    robot.battery = Math.max(robot.battery, 0.45);
    robot.replanAt = this.tick;
    this.invalidateFields();
    this.epoch++;
    this.addLog(robotId, "robot-failed", `R${robotId} repaired and back online`);
    this.refreshOccupancy();
    return true;
  }

  injectTask(priority: TaskPriority = "rush"): Task | null {
    if (this.docks.length === 0) return null;
    return this.spawnTask(this.rng.pick(this.docks), priority);
  }

  /**
   * Escalates an order. If an idle robot can reach the pickup sooner than the
   * current owner, the job is preempted and reassigned -- a localised ripple, not
   * a fleet-wide restart.
   */
  raisePriority(taskId: number, priority: TaskPriority): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.deliveredTick !== null) return false;

    task.priority = priority;
    this.epoch++;
    if (task.claimedBy === null) return true;

    const ownerId = task.claimedBy;
    const owner = this.robots[ownerId];
    if (!owner || owner.state === "broken") return true;

    const challenger = this.bestBidder(task, ownerId);
    if (challenger === null) return true;

    task.claimedBy = null;
    task.originalClaimant = null;
    owner.taskId = null;
    owner.stage = null;
    owner.committed = [];
    owner.replanAt = this.tick;
    owner.replanCause = "priority-change";
    this.countReplan("priority-change");

    this.assign(this.robots[challenger], task, "priority-change");
    this.addLog(
      ownerId,
      "priority-change",
      `order ${task.id} escalated to ${priority}; R${ownerId} preempted, R${challenger} takes over`,
    );
    return true;
  }

  // ------------------------------------------------------------- main loop

  step(): void {
    this.tick++;
    this.metrics.ticks = this.tick;

    this.runService();
    this.runRepairs();
    this.releaseOrders();
    this.expireTasks();
    this.runAuction();

    // Each robot re-plans for itself, and only for itself.
    for (const robot of this.robots) {
      if (robot.state === "broken") continue;
      if (this.needsReplan(robot)) this.replan(robot);
    }

    this.advance();
    this.updateEnergy();
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  // ------------------------------------------------------------- internals

  private runService(): void {
    for (const robot of this.robots) {
      if (robot.state === "charging" || robot.state === "broken") continue;
      if (robot.serviceUntil === 0 || this.tick < robot.serviceUntil) continue;

      const task = robot.taskId === null ? null : this.tasks.get(robot.taskId);
      if (!task) {
        robot.serviceUntil = 0;
        continue;
      }

      if (robot.stage === "picking") {
        robot.stage = "to-dropoff";
        robot.serviceUntil = 0;
        robot.taskDistance = 0;
        robot.committed = [];
        robot.replanAt = this.tick;
        robot.state = "moving";
        this.addLog(robot.id, "task-claimed", `R${robot.id} loaded order ${task.id}, heading out`);
      } else if (robot.stage === "dropping") {
        this.deliver(robot, task);
      }
    }
  }

  /** Brings wrecks back online after the repair delay. */
  private runRepairs(): void {
    if (this.repairTicks <= 0) return;
    for (const robot of this.robots) {
      if (robot.state !== "broken") continue;
      if (this.tick - robot.brokenAt >= this.repairTicks) this.repairRobot(robot.id);
    }
  }

  private deliver(robot: Robot, task: Task): void {
    task.deliveredTick = this.tick;
    task.claimedBy = null;

    this.metrics.completed++;
    this.metrics.latency.push(this.tick - task.createdTick);
    this.metrics.tasksByPriority[task.priority].delivered++;
    this.metrics.walkedDistance += robot.taskDistance;
    this.metrics.optimalDistance += shortestPathLength(this.grid, task.pickup, task.dropoff);

    robot.taskId = null;
    robot.stage = null;
    robot.serviceUntil = 0;
    robot.state = "idle";
    robot.committed = [];
    robot.taskDistance = 0;
    robot.replanAt = this.tick;

    this.addLog(robot.id, "task-delivered", `R${robot.id} delivered order ${task.id} (${task.priority})`);
  }

  private releaseOrders(): void {
    this.spawnAccumulator++;
    if (this.spawnAccumulator < this.taskSpawnInterval) return;
    this.spawnAccumulator = 0;
    if (this.rng.chance(0.7)) this.injectTask(this.rng.chance(0.12) ? "high" : "normal");
  }

  private expireTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.claimedBy !== null || task.deliveredTick !== null) continue;
      if (this.tick - task.createdTick > this.taskTimeout) task.deliveredTick = this.tick;
    }
  }

  /**
   * Market-based allocation. Idle robots each bid on the best order they can
   * reach; the top scorer wins. Every robot is scored independently, so no
   * component decides who works on what.
   */
  private runAuction(): void {
    const open = this.openTasks();
    if (open.length === 0) return;

    const taken = new Set<number>();

    for (const robot of this.robots) {
      if (robot.taskId !== null) continue;
      if (robot.state === "broken" || robot.state === "charging") continue;

      const field = this.fieldFor(robot);
      let bestTask: Task | null = null;
      let bestScore = -Infinity;

      for (const task of open) {
        if (taken.has(task.id)) continue;
        const score = this.bidScore(robot, task, field);
        if (score > bestScore) {
          bestScore = score;
          bestTask = task;
        }
      }

      if (!bestTask) continue;
      taken.add(bestTask.id);
      this.assign(robot, bestTask, "task-claimed");
    }
  }

  private assign(robot: Robot, task: Task, kind: LogEvent["kind"]): void {
    task.claimedBy = robot.id;
    task.originalClaimant = robot.id;
    robot.taskId = task.id;
    robot.stage = "to-pickup";
    robot.committed = [];
    robot.taskDistance = 0;
    robot.replanAt = this.tick;
    robot.state = "moving";
    this.addLog(robot.id, kind, `R${robot.id} won order ${task.id} (${task.priority})`);
  }

  /**
   * Cached BFS field for a robot, rebuilt only after it moves.
   *
   * Without the cache an auction costs O(idle robots x open orders x cells); with
   * it, O(cells) per robot per move. On a 340x164 warehouse map with 40 robots
   * that is the difference between a demo and a slideshow.
   */
  private fieldFor(robot: Robot): Int32Array {
    const cachedAt = robot.distFieldAt;
    if (robot.distField && cachedAt && cachedAt.x === robot.x && cachedAt.y === robot.y) {
      return robot.distField;
    }
    const field = distanceField(this.grid, { x: robot.x, y: robot.y });
    robot.distField = field;
    robot.distFieldAt = { x: robot.x, y: robot.y };
    return field;
  }

  private invalidateFields(): void {
    for (const robot of this.robots) {
      robot.distField = null;
      robot.distFieldAt = null;
    }
  }

  /**
   * Higher is better: reachability first, then travel cost, dock queue depth,
   * battery headroom and order priority. Battery and priority are what let the
   * swarm make sensible global trades from purely local information.
   */
  private bidScore(robot: Robot, task: Task, field: Int32Array): number {
    if (robot.battery < this.lowBattery) return -Infinity;

    const dist = fieldDistance(this.grid, field, task.pickup);
    if (!Number.isFinite(dist)) return -Infinity;

    // Congestion factor: estimate congestion at the pickup from current congestion array
    const pickupCellIdx = (task.pickup.y * this.grid.width + task.pickup.x);
    const congestionFactor = Math.min(0.3, this.congestion[pickupCellIdx] * 0.05);

    return (
      PRIORITY_WEIGHT[task.priority] * 2 -
      dist -
      this.queueDepth(task.pickup) * 6 -
      (1 - robot.battery) * 30 -
      congestionFactor * 20
    );
  }

  /** Robots already heading to the same pickup. Drives the queue heuristic. */
  private queueDepth(pickup: Position): number {
    let count = 0;
    for (const robot of this.robots) {
      if (robot.taskId === null || robot.state === "broken") continue;
      const task = this.tasks.get(robot.taskId);
      if (task && task.pickup.x === pickup.x && task.pickup.y === pickup.y) count++;
    }
    return count;
  }

  private bestBidder(task: Task, excludeRobot: number): number | null {
    let best: number | null = null;
    let bestScore = -Infinity;

    for (const robot of this.robots) {
      if (robot.id === excludeRobot) continue;
      if (robot.taskId !== null || robot.state === "broken" || robot.state === "charging") continue;
      const score = this.bidScore(robot, task, this.fieldFor(robot));
      if (score > bestScore) {
        bestScore = score;
        best = robot.id;
      }
    }

    return bestScore > -Infinity ? best : null;
  }

  private needsReplan(robot: Robot): boolean {
    if (robot.state === "charging") return false;

    // Busy loading or unloading: the plan is complete, there is nothing to chase.
    if (this.tick < robot.serviceUntil) return false;

    // Standing still this long means the committed route will not clear itself.
    // Two robots meeting head-on in an aisle each politely wait for the other, and
    // neither re-plans because both routes are still inside their commit window.
    // Forcing a re-plan breaks the standoff: one of them yields.
    if (this.tick < robot.replanAt) {
      return robot.committed.some((p) => !isFree(this.grid, p.x, p.y));
    }

    return true;
  }

  /** Attributes a re-plan to the reason it was needed, for the metrics panel. */
  private causeFor(robot: Robot): ReplanCause {
    if (robot.replanCause) {
      const cause = robot.replanCause;
      robot.replanCause = null;
      return cause;
    }
    if (robot.committed.length > 0 && robot.committed.some((p) => !isFree(this.grid, p.x, p.y))) {
      return "blocked-cell";
    }
    if (this.committedContainsWreck(robot)) return "robot-failed";
    if (robot.replans === 0) return "initial";
    return "blocked-by-traffic";
  }

  /** True when a wreck sits on this robot's previously committed route. */
  private committedContainsWreck(robot: Robot): boolean {
    for (const other of this.robots) {
      if (other.id === robot.id || other.state !== "broken") continue;
      const cell = this.codec.cell(other.x, other.y);
      if (robot.committed.some((p) => this.codec.cell(p.x, p.y) === cell)) return true;
    }
    return false;
  }

  /**
   * Per-robot re-planning.
   *
   * The reservation table is rebuilt from every *other* robot's committed prefix.
   * That is the only shared input: no fleet-wide plan, no coordinator, and this
   * robot never reasons about anyone else's goals.
   */
  private replan(robot: Robot): void {
    const target = this.targetFor(robot);

    if (!target) {
      // Nothing to do. Not a re-plan, and it must not be counted as one --
      // otherwise an idle fleet reports thousands of re-plans per order.
      robot.committed = [];
      robot.replanAt = this.tick + this.commitLength;
      robot.replanCause = null;
      return;
    }

    const cause = this.causeFor(robot);
    robot.replans++;
    this.countReplan(cause);

    const result = spaceTimeAStar({ x: robot.x, y: robot.y }, target, {
      grid: this.grid,
      table: this.buildTableFor(robot),
      selfId: robot.id,
      startTime: this.tick,
      horizon: this.horizon,
      // Neighbour routes here are predictions that go stale the moment anyone
      // re-plans. Refusing to hold position would leave robots stranded with no
      // legal option; the atomic executor in advance() is what guarantees safety.
      allowContestedWait: true,
    });

    if (!result) {
      // No route within the horizon: hold position and look again shortly with a
      // fresher view of the traffic. A local backoff, not a restart -- the retry
      // interval is deliberately short so recovery stays responsive.
      robot.committed = [{ x: robot.x, y: robot.y }];
      robot.replanAt = this.tick + 4;
      if (robot.state === "moving") robot.state = "stranded";
      return;
    }

    const commit = Math.min(this.commitLength, result.path.length);
    robot.committed = result.path.slice(0, commit);
    robot.replanAt = this.tick + commit;
    if (robot.state === "stranded") robot.state = "moving";

    // Note: service is armed in advance(), on arrival only. Arming it here with
    // `target` would complete the pickup the moment a plan was *committed*, before
    // the robot had walked anywhere.
  }

  /** Where this robot is currently trying to get to. */
  private targetFor(robot: Robot): Position | null {
    if (robot.state === "charging") return null;
    if (robot.battery < this.lowBattery) return this.nearestOf(this.chargers, robot);
    if (robot.taskId === null) return null;

    const task = this.tasks.get(robot.taskId);
    if (!task) return null;
    return robot.stage === "to-pickup" ? task.pickup : task.dropoff;
  }

  private nearestOf(points: readonly Position[], robot: Robot): Position | null {
    const field = this.fieldFor(robot);
    let best: Position | null = null;
    let bestDist = Infinity;
    for (const p of points) {
      const d = fieldDistance(this.grid, field, p);
      if (Number.isFinite(d) && d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  private buildTableFor(robot: Robot): ReservationTable {
    const table = new ReservationTable(this.grid);
    table.claim(this.tick, robot.x, robot.y, robot.id);

    for (const other of this.robots) {
      if (other.id === robot.id) continue;

      // A wreck is a permanent obstacle; O(1) to record, not O(horizon).
      if (other.state === "broken") {
        table.claimStatic(other.x, other.y, other.id);
        continue;
      }

      const prefix = this.committedPrefix(other);
      for (let i = 0; i < prefix.length; i++) {
        table.claim(this.tick + i, prefix[i].x, prefix[i].y, other.id);
      }
    }

    return table;
  }

  /** A neighbour's committed route starting from the current tick. */
  private committedPrefix(other: Robot): Position[] {
    const out: Position[] = [{ x: other.x, y: other.y }, ...other.committed];
    if (other.state === "charging") {
      const last = out[out.length - 1];
      for (let i = 0; i < this.horizon; i++) out.push({ x: last.x, y: last.y });
    }
    return out;
  }

  private armService(robot: Robot, at: Position): void {
    const task = robot.taskId === null ? null : this.tasks.get(robot.taskId);
    if (!task) return;

    if (robot.stage === "to-pickup" && at.x === task.pickup.x && at.y === task.pickup.y) {
      robot.stage = "picking";
      robot.serviceUntil = this.tick + this.serviceTime;
      robot.state = "picking";
    } else if (robot.stage === "to-dropoff" && at.x === task.dropoff.x && at.y === task.dropoff.y) {
      robot.stage = "dropping";
      robot.serviceUntil = this.tick + this.serviceTime;
      robot.state = "delivering";
    }
  }

  /**
   * Applies one tick of movement as a single atomic commit.
   *
   * Every robot states an intention, then all intentions are resolved before any
   * robot moves. This is what makes collisions structurally impossible rather than
   * merely unlikely: a move is rejected unless the destination is free, or its
   * occupant is provably leaving somewhere other than our own cell.
   *
   * The planner's cooperation is treated as a preference; this function is the
   * guarantee. A rolling-horizon simulation plans against other robots'
   * *predictions*, which go stale, so correctness cannot rest on them.
   */
  private advance(): void {
    // Snapshot who can actually make progress, so a blocked robot can tell the
    // difference between "they are coming through" and "they are stuck too".
    const willMove = this.computeWillMove();

    // 1. Collect intentions.
    const intents = new Map<number, Position>();
    for (const robot of this.robots) {
      if (robot.state === "broken") continue;

      if (robot.committed.length === 0) {
        // Servicing, or idle with nowhere to be: stationary by choice, not stuck.
        robot.consecutiveWaits = 0;
        continue;
      }

      const next = robot.committed[0];
      if (!isFree(this.grid, next.x, next.y)) {
        robot.committed = [];
        robot.replanAt = this.tick;
        continue;
      }
      intents.set(robot.id, next);
    }

    // 2. Resolve.
    //
    //    Phase A -- stayers claim their cells first, so nothing may enter a cell a
    //    stayer occupies.
    const accepted = new Map<number, Position>();
    let claimed = new Set<number>();

    for (const id of [...intents.keys()].sort((a, b) => a - b)) {
      const robot = this.robots[id];
      const next = intents.get(id)!;
      if (next.x !== robot.x || next.y !== robot.y) continue;

      accepted.set(id, next);
      claimed = new Set(claimed).add(this.codec.cell(next.x, next.y));
    }

    const movers = [...intents.keys()].filter((id) => !accepted.has(id)).sort((a, b) => a - b);

    // Phase B -- movers are accepted optimistically, then verified. A move is only
    // safe if the robot currently occupying its destination is itself leaving, and
    // is not leaving into our own cell (a head-on swap). Verifying after the fact
    // lets whole chains move together: A may follow B into the cell B is vacating
    // even when B has a higher id, which a strict in-order check would forbid and
    // which serialised the entire fleet into a queue.
    for (let round = 0; round <= movers.length + 1; round++) {
      const tentative = new Map(accepted);
      const taken = new Set(claimed);

      for (const id of movers) {
        const next = intents.get(id)!;
        const cell = this.codec.cell(next.x, next.y);
        if (taken.has(cell)) continue;
        tentative.set(id, next);
        taken.add(cell);
      }

      let removed = false;

      for (const id of movers) {
        if (!tentative.has(id)) continue;

        const robot = this.robots[id];
        const next = tentative.get(id)!;
        const occupantId = this.occupancy.get(this.codec.cell(next.x, next.y));
        if (occupantId === undefined || occupantId === id) continue;

        const occupantNext = tentative.get(occupantId);

        // The occupant is staying put, or is leaving into our own cell.
        if (occupantNext === undefined ||
            (occupantNext.x === robot.x && occupantNext.y === robot.y)) {
          tentative.delete(id);
          removed = true;
          this.noteBlocked(robot, occupantId, willMove);
        }
      }

      accepted.clear();
      for (const [k, v] of tentative) accepted.set(k, v);
      claimed = taken;

      // Stable: no move depended on another that has now been withdrawn.
      if (!removed) break;
    }

    // 3. Apply, then rebuild occupancy from scratch so the map can never drift out
    //    of step with reality.
    for (const [id, next] of accepted) {
      const robot = this.robots[id];
      const sameCell = next.x === robot.x && next.y === robot.y;

      if (sameCell) {
        robot.waitTicks++;
        robot.consecutiveWaits++;
        this.metrics.waitTicks++;
      } else {
        robot.consecutiveWaits = 0;
        robot.moves++;
        // Only the loaded leg counts toward the detour ratio, so it is compared
        // against the pickup -> dropoff shortest path, not against deadheading.
        if (robot.stage === "to-dropoff") {
          robot.taskDistance += Math.abs(next.x - robot.x) + Math.abs(next.y - robot.y);
        }
        if (robot.state === "moving" || robot.state === "picking" || robot.state === "delivering") {
          robot.state = "moving";
        }
      }

      robot.x = next.x;
      robot.y = next.y;
      robot.committed.shift();
      this.congestion[this.codec.cell(robot.x, robot.y)] += 1;

      if (robot.serviceUntil === 0) this.armService(robot, { x: robot.x, y: robot.y });
    }

    this.refreshOccupancy();
  }

  /**
   * A robot could not take the step it wanted. Decide whether that is ordinary
   * queueing or a standoff worth breaking.
   */
  private noteBlocked(robot: Robot, occupantId: number, willMove: Set<number>): void {
    robot.waitTicks++;
    robot.consecutiveWaits++;
    this.metrics.waitTicks++;

    const blocker = this.robots[occupantId];
    const blockerBusy =
      blocker.serviceUntil > this.tick ||
      blocker.state === "charging" ||
      blocker.committed.length === 0;

    // The blocker is neither moving nor legitimately busy. Queueing behind a robot
    // that is loading, unloading or charging is normal and must never trip this;
    // nor is queueing behind one that is merely stepping aside for a moment, which
    // is what `consecutiveWaits` distinguishes.
    if (willMove.has(occupantId) || blockerBusy) return;
    if (blocker.consecutiveWaits < STALLED_WAIT_LIMIT) return;

    // Deterministic tie-break: the higher id yields. Both then re-plan with fresh
    // information, and the exchange rule keeps them from meeting again.
    if (robot.id > occupantId) {
      robot.replanAt = this.tick;
      robot.replanCause = "deadlock";
      robot.consecutiveWaits = 0;
      this.metrics.deadlocks++;
      this.metrics.deadlockTicks += blocker.consecutiveWaits;
      this.addLog(robot.id, "deadlock", `R${robot.id} yields to stalled R${occupantId}`);
    }
  }

  /**
   * Robots that will change cell this tick.
   *
   * Snapshot before anyone moves, so a robot blocked by a peer can tell the
   * difference between "they are coming through" (normal queueing) and "they are
   * stuck too" (a deadlock).
   */
  private computeWillMove(): Set<number> {
    const willMove = new Set<number>();

    for (const robot of this.robots) {
      if (robot.state === "broken" || robot.committed.length === 0) continue;

      const next = robot.committed[0];
      if (!isFree(this.grid, next.x, next.y)) continue;
      if (next.x === robot.x && next.y === robot.y) continue; // waiting is not progress

      const occupant = this.occupancy.get(this.codec.cell(next.x, next.y));
      if (occupant !== undefined && occupant !== robot.id) continue;

      willMove.add(robot.id);
    }

    return willMove;
  }

  private updateEnergy(): void {
    for (const robot of this.robots) {
      if (robot.state === "broken") continue;

      if (robot.state === "charging") {
        robot.battery = Math.min(1, robot.battery + this.chargeRate);
        if (robot.battery >= 0.98) {
          robot.state = "idle";
          robot.committed = [];
          robot.replanAt = this.tick;
          this.addLog(robot.id, "task-claimed", `R${robot.id} finished charging`);
        }
        continue;
      }

      robot.battery = Math.max(0, robot.battery - this.batteryDrain);

      // Plug in on arrival. Without this transition a spent robot would sit on the
      // charger forever, re-planning to the cell it is already standing on, once
      // per tick.
      if (robot.battery < this.lowBattery && this.isAtCharger(robot)) {
        robot.state = "charging";
        robot.committed = [];
        continue;
      }

      if (robot.battery > 0) continue;

      robot.battery = 0;
      robot.state = "idle";
      robot.taskId = null;
      robot.stage = null;
      robot.committed = [];
      robot.replanAt = this.tick;
    }
  }

  private isAtCharger(robot: Robot): boolean {
    return this.chargers.some((c) => c.x === robot.x && c.y === robot.y);
  }

  private refreshOccupancy(): void {
    this.occupancy.clear();
    for (const robot of this.robots) {
      this.occupancy.set(this.codec.cell(robot.x, robot.y), robot.id);
    }
  }

  private spawnTask(pickup: Position, priority: TaskPriority): Task {
    const task: Task = {
      id: this.nextTaskId++,
      pickup,
      dropoff: this.rng.pick(this.packingStations),
      priority,
      createdTick: this.tick,
      claimedBy: null,
      deliveredTick: null,
      originalClaimant: null,
    };
    this.tasks.set(task.id, task);
    this.metrics.tasksByPriority[priority].created++;
    this.addLog(null, "spawn", `order ${task.id} (${priority}) released at dock ${this.docks.indexOf(pickup) + 1}`);
    return task;
  }

  private countReplan(cause: ReplanCause): void {
    this.metrics.replans++;
    this.metrics.replansByCause[cause]++;
  }

  private addLog(robotId: number | null, kind: LogEvent["kind"], message: string): void {
    this.log.push({ tick: this.tick, robotId, kind, message });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }
}

export function freshMetrics(): Metrics {
  return {
    ticks: 0,
    completed: 0,
    latency: [],
    replans: 0,
    replansByCause: {
      initial: 0,
      "blocked-cell": 0,
      "robot-failed": 0,
      "priority-change": 0,
      preempted: 0,
      "blocked-by-traffic": 0,
      deadlock: 0,
    },
    deadlocks: 0,
    deadlockTicks: 0,
    walkedDistance: 0,
    optimalDistance: 0,
    waitTicks: 0,
    tasksByPriority: {
      rush: { created: 0, delivered: 0 },
      high: { created: 0, delivered: 0 },
      normal: { created: 0, delivered: 0 },
      low: { created: 0, delivered: 0 },
    },
  };
}