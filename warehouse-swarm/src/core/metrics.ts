import type { Metrics } from "./types.js";

export interface Snapshot {
  tick: number;
  completed: number;
  /** Deliveries per 100 ticks, so runs of different length still compare. */
  throughput: number;
  meanLatency: number;
  p95Latency: number;
  /** Re-plans divided by completed orders. */
  replansPerTask: number;
  totalReplans: number;
  waitTicks: number;
  /**
   * Walked distance / optimal distance over the loaded leg.
   *
   * 1.0 means every robot took the shortest possible route and coordination cost
   * nothing. Anything above 1.0 is the price of avoiding each other -- the number
   * that justifies coordination rather than letting robots run independently.
   */
  detourRatio: number;
  byPriority: Record<string, { created: number; delivered: number }>;
  replansByCause: Record<string, number>;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export function snapshot(metrics: Metrics): Snapshot {
  const sorted = [...metrics.latency].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);

  return {
    tick: metrics.ticks,
    completed: metrics.completed,
    throughput: metrics.ticks > 0 ? (metrics.completed / metrics.ticks) * 100 : 0,
    meanLatency: mean,
    p95Latency: percentile(sorted, 0.95),
    replansPerTask: metrics.completed > 0 ? metrics.replans / metrics.completed : 0,
    totalReplans: metrics.replans,
    waitTicks: metrics.waitTicks,
    detourRatio: metrics.optimalDistance > 0 ? metrics.walkedDistance / metrics.optimalDistance : 1,
    byPriority: metrics.tasksByPriority,
    replansByCause: metrics.replansByCause,
  };
}

/** Compact single-line summary for CLI benchmark output. */
export function formatSnapshot(s: Snapshot): string {
  return [
    `completed=${s.completed}`,
    `throughput=${s.throughput.toFixed(2)}/100t`,
    `p95=${s.p95Latency.toFixed(0)}t`,
    `replans/order=${s.replansPerTask.toFixed(2)}`,
    `detour=${s.detourRatio.toFixed(3)}`,
  ].join("  ");
}