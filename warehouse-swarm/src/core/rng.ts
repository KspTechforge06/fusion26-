/**
 * Deterministic PRNG (mulberry32).
 *
 * The same seed must always produce the same warehouse, the same task stream and
 * the same fault sequence -- otherwise an A/B comparison between two coordination
 * strategies measures luck instead of architecture.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid the degenerate all-zero state.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick from empty array");
    return items[this.int(0, items.length)];
  }

  /** In-place Fisher-Yates. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const a = items[i];
      const b = items[j];
      items[i] = b;
      items[j] = a;
    }
    return items;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}