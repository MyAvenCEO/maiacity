/** Binary min-heap keyed by (time, rank, seq) — fully deterministic ordering. */
export interface Keyed {
  time: number;
  rank: number;
  seq: number;
}

const less = (a: Keyed, b: Keyed): boolean =>
  a.time < b.time || (a.time === b.time && (a.rank < b.rank || (a.rank === b.rank && a.seq < b.seq)));

export class Heap<T extends Keyed> {
  items: T[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }

  /** Remove all items matching predicate (O(n) rebuild). */
  removeWhere(pred: (item: T) => boolean): number {
    const kept = this.items.filter((x) => !pred(x));
    const removed = this.items.length - kept.length;
    if (removed) {
      this.items = [];
      for (const k of kept) this.push(k);
    }
    return removed;
  }

  /** Items in pop order (copy). */
  sorted(): T[] {
    return [...this.items].sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
  }
}
