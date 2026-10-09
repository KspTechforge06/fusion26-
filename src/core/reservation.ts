import { idx } from "./grid.js";
import type { Grid, Position } from "./types.js";

/**
 * Space-time reservation table.
 *
 * Key encodes (tick, cell) as one flat integer: `t * cellCount + y * width + x`.
 * The value is the id of the agent holding that cell at that time.
 *
 * Committing a path tick by tick -- waits included -- also encodes "agent X is
 * still standing here", which is what makes following conflicts detectable with no
 * extra mechanism.
 */
export class ReservationTable {
  private readonly cellCount: number;
  private readonly map = new Map<number, number>();

  /**
   * Cells blocked for all time, keyed by cell index.
   *
   * A wreck is a permanent obstacle. Reserving it across the whole horizon costs
   * O(horizon) writes per wreck per plan, which turns one failure into a
   * fleet-wide slowdown; a static set makes it O(1).
   */
  private readonly statics = new Map<number, number>();

  constructor(private readonly grid: Grid) {
    this.cellCount = grid.width * grid.height;
  }

  private key(t: number, x: number, y: number): number {
    return t * this.cellCount + idx(this.grid, x, y);
  }

  claim(t: number, x: number, y: number, agentId: number): void {
    this.map.set(this.key(t, x, y), agentId);
  }

  /** Claims a cell as permanently blocked by `agentId`. */
  claimStatic(x: number, y: number, agentId: number): void {
    this.statics.set(idx(this.grid, x, y), agentId);
  }

  holder(t: number, x: number, y: number): number | undefined {
    return this.map.get(this.key(t, x, y));
  }

  /** True when (t, x, y) is held by an agent other than `selfId`. */
  isHeldByOther(t: number, x: number, y: number, selfId: number): boolean {
    const holder = this.map.get(this.key(t, x, y));
    return holder !== undefined && holder !== selfId;
  }

  /** True when a permanent obstacle owned by another agent sits here. */
  isStaticBlockedByOther(x: number, y: number, selfId: number): boolean {
    const owner = this.statics.get(idx(this.grid, x, y));
    return owner !== undefined && owner !== selfId;
  }

  /** Commits an entire path, including every wait step. */
  commit(path: readonly Position[], agentId: number): void {
    for (let t = 0; t < path.length; t++) {
      this.claim(t, path[t].x, path[t].y, agentId);
    }
  }

  releaseAgent(agentId: number): void {
    for (const [k, v] of this.map) {
      if (v === agentId) this.map.delete(k);
    }
    for (const [cell, v] of this.statics) {
      if (v === agentId) this.statics.delete(cell);
    }
  }

  clear(): void {
    this.map.clear();
    this.statics.clear();
  }

  get size(): number {
    return this.map.size;
  }

  get staticCount(): number {
    return this.statics.size;
  }
}