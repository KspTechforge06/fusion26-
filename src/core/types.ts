export interface Position {
  x: number;
  y: number;
}

export type AgentState =
  | "idle"
  | "moving"
  | "picking"
  | "delivering"
  | "charging"
  | "broken"
  | "stranded";

export interface AgentSpec {
  id: number;
  start: Position;
  goal: Position;
}

export interface RobotSpec {
  id: number;
  start: Position;
  /** Battery 0..1. A robot asks to charge below `lowBattery`. */
  battery: number;
}

export type TaskPriority = "rush" | "high" | "normal" | "low";

/** Bid multiplier per priority tier. Large enough to beat a modest distance gap. */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  rush: 40,
  high: 15,
  normal: 0,
  low: -10,
};

export interface Task {
  id: number;
  /** Where the payload is picked up. */
  pickup: Position;
  /** Where the payload is delivered. */
  dropoff: Position;
  priority: TaskPriority;
  createdTick: number;
  /** Robot that currently owns the job; null means it is in the pool. */
  claimedBy: number | null;
  deliveredTick: number | null;
  originalClaimant: number | null;
}

export interface Grid {
  width: number;
  height: number;
  /** Row-major: index = y * width + x. 1 = free, 0 = obstacle. */
  cells: Uint8Array;
}

export type ReplanCause =
  | "initial"
  | "blocked-cell"
  | "robot-failed"
  | "priority-change"
  | "preempted"
  | "blocked-by-traffic"
  | "deadlock";

export interface LogEvent {
  tick: number;
  robotId: number | null;
  kind: ReplanCause | "task-claimed" | "task-delivered" | "spawn" | "cell-blocked";
  message: string;
}

export interface Metrics {
  ticks: number;
  completed: number;
  /** Order released to delivered, in ticks. */
  latency: number[];
  replans: number;
  replansByCause: Record<ReplanCause, number>;
  deadlocks: number;
  deadlockTicks: number;
  /** Loaded-leg distance actually walked, summed over delivered orders. */
  walkedDistance: number;
  /** pickup -> dropoff shortest distance for the same orders. */
  optimalDistance: number;
  /** Ticks a robot spent stationary while holding a job. */
  waitTicks: number;
  tasksByPriority: Record<TaskPriority, { created: number; delivered: number }>;
}