/**
 * Binary min-heap keyed on an arbitrary numeric score.
 *
 * Ties break on insertion order so expansion is fully deterministic. That matters
 * for more than tidiness: CBS replays search nodes, and a planner that expands
 * ties differently on each run cannot reproduce the node it is branching from.
 */
export class MinHeap<T> {
  private items: T[] = [];
  private scores: number[] = [];
  private order: number[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(item: T, score: number): void {
    this.items.push(item);
    this.scores.push(score);
    this.order.push(this.seq++);
    this.bubbleUp(this.items.length - 1);
  }

  peek(): T | undefined {
    return this.items[0];
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;

    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastScore = this.scores.pop()!;
    const lastOrder = this.order.pop()!;

    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.scores[0] = lastScore;
      this.order[0] = lastOrder;
      this.sinkDown(0);
    }

    return top;
  }

  clear(): void {
    this.items.length = 0;
    this.scores.length = 0;
    this.order.length = 0;
  }

  private less(a: number, b: number): boolean {
    if (this.scores[a] !== this.scores[b]) return this.scores[a] < this.scores[b];
    return this.order[a] < this.order[b];
  }

  private swap(a: number, b: number): void {
    const ti = this.items[a];
    const ts = this.scores[a];
    const to = this.order[a];
    this.items[a] = this.items[b];
    this.scores[a] = this.scores[b];
    this.order[a] = this.order[b];
    this.items[b] = ti;
    this.scores[b] = ts;
    this.order[b] = to;
  }

  private bubbleUp(start: number): void {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private sinkDown(start: number): void {
    const n = this.items.length;
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < n && this.less(left, best)) best = left;
      if (right < n && this.less(right, best)) best = right;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }
}