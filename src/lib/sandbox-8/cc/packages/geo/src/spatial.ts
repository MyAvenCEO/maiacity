/**
 * Uniform-grid spatial hash for points and boxes (trees, segments, buildings).
 *
 * Choose `cellSize` around the typical query radius: queries then touch O(1) buckets and
 * cost O(k) in the number of nearby items. Results are returned in insertion order, so
 * consumers stay deterministic regardless of bucket layout.
 */
import type { Bounds, Vec2 } from './types.ts';

interface Entry<T> {
  item: T;
  seq: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Cell coordinates are packed into one number; ±2^20 cells per axis is plenty. */
const OFFSET = 1 << 20;
const key = (ci: number, cj: number): number => (ci + OFFSET) * 2 ** 21 + (cj + OFFSET);

export class SpatialHash<T> {
  private readonly buckets = new Map<number, Entry<T>[]>();
  private seq = 0;
  private count = 0;

  constructor(readonly cellSize: number) {
    if (!(cellSize > 0)) throw new Error('SpatialHash: cellSize must be > 0');
  }

  get size(): number {
    return this.count;
  }

  /** Insert a point item. */
  insert(item: T, x: number, z: number): void {
    this.insertBounds(item, { x0: x, z0: z, x1: x, z1: z });
  }

  /** Insert an item with an extent (stored in every bucket it overlaps). */
  insertBounds(item: T, b: Bounds): void {
    const e: Entry<T> = { item, seq: this.seq++, x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 };
    const s = this.cellSize;
    for (let cj = Math.floor(b.z0 / s); cj <= Math.floor(b.z1 / s); cj += 1) {
      for (let ci = Math.floor(b.x0 / s); ci <= Math.floor(b.x1 / s); ci += 1) {
        const k = key(ci, cj);
        let list = this.buckets.get(k);
        if (!list) {
          list = [];
          this.buckets.set(k, list);
        }
        list.push(e);
      }
    }
    this.count += 1;
  }

  /** Items whose extent intersects the box (inclusive). */
  queryBounds(b: Bounds): T[] {
    return this.collect(b, (e) => e.x0 <= b.x1 && e.x1 >= b.x0 && e.z0 <= b.z1 && e.z1 >= b.z0);
  }

  /** Items whose extent lies within distance r of (x, z) (points: Euclidean distance ≤ r). */
  queryRadius(x: number, z: number, r: number): T[] {
    const r2 = r * r;
    return this.collect({ x0: x - r, z0: z - r, x1: x + r, z1: z + r }, (e) => {
      const dx = x < e.x0 ? e.x0 - x : x > e.x1 ? x - e.x1 : 0;
      const dz = z < e.z0 ? e.z0 - z : z > e.z1 ? z - e.z1 : 0;
      return dx * dx + dz * dz <= r2;
    });
  }

  /** Nearest item by distance to its extent, searching rings out to maxRadius. */
  nearest(x: number, z: number, maxRadius: number): { item: T; distance: number } | undefined {
    let r = this.cellSize;
    for (;;) {
      const radius = Math.min(r, maxRadius);
      let best: { item: T; distance: number; seq: number } | undefined;
      for (const e of this.collectEntries({ x0: x - radius, z0: z - radius, x1: x + radius, z1: z + radius })) {
        const dx = x < e.x0 ? e.x0 - x : x > e.x1 ? x - e.x1 : 0;
        const dz = z < e.z0 ? e.z0 - z : z > e.z1 ? z - e.z1 : 0;
        const d = Math.hypot(dx, dz);
        if (d <= radius && (!best || d < best.distance || (d === best.distance && e.seq < best.seq))) best = { item: e.item, distance: d, seq: e.seq };
      }
      if (best) return { item: best.item, distance: best.distance };
      if (radius >= maxRadius) return undefined;
      r *= 2;
    }
  }

  private collectEntries(b: Bounds): Entry<T>[] {
    const s = this.cellSize;
    const seen = new Set<number>();
    const out: Entry<T>[] = [];
    const ci0 = Math.floor(b.x0 / s);
    const ci1 = Math.floor(b.x1 / s);
    const cj0 = Math.floor(b.z0 / s);
    const cj1 = Math.floor(b.z1 / s);
    for (let cj = cj0; cj <= cj1; cj += 1) {
      for (let ci = ci0; ci <= ci1; ci += 1) {
        const list = this.buckets.get(key(ci, cj));
        if (!list) continue;
        for (const e of list) {
          if (seen.has(e.seq)) continue;
          seen.add(e.seq);
          out.push(e);
        }
      }
    }
    return out;
  }

  private collect(b: Bounds, test: (e: Entry<T>) => boolean): T[] {
    const hits = this.collectEntries(b).filter(test);
    hits.sort((p, q) => p.seq - q.seq);
    return hits.map((e) => e.item);
  }
}

/** Convenience: hash a polyline's segments (item = segment index) for fast nearest-segment queries. */
export function segmentHash(pts: readonly Vec2[], cellSize: number): SpatialHash<number> {
  const h = new SpatialHash<number>(cellSize);
  for (let k = 0; k < pts.length - 1; k += 1) {
    const a = pts[k]!;
    const b = pts[k + 1]!;
    h.insertBounds(k, { x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]) });
  }
  return h;
}
