/**
 * Footprints: rectangles placed on the ground (a centre, a rotation in degrees, half length along u and
 * half width along v), whether two of them overlap or come near each other, and whether a polyline of a
 * given half width (a road) runs within one.
 */
import type { Vec2 } from './types.ts';

/** a footprint on the ground: its centre, its rotation (degrees), its length and width (m) */
export interface Rect {
  pos: Vec2;
  rotation: number;
  length: number;
  width: number;
}

/** local (u along length, v along width) → world */
export function toWorld(center: Vec2, rotationDeg: number, u: number, v: number): Vec2 {
  const a = (rotationDeg * Math.PI) / 180;
  return [center[0] + u * Math.cos(a) - v * Math.sin(a), center[1] + u * Math.sin(a) + v * Math.cos(a)];
}

/** the corners of a footprint grown by `pad` on every side */
export function footprintCorners(center: Vec2, rotDeg: number, hl: number, hw: number, pad: number): Vec2[] {
  return [toWorld(center, rotDeg, -hl - pad, -hw - pad), toWorld(center, rotDeg, hl + pad, -hw - pad), toWorld(center, rotDeg, hl + pad, hw + pad), toWorld(center, rotDeg, -hl - pad, hw + pad)];
}

/** do two convex polygons intersect (separating axis test)? */
export function convexOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const n: Vec2 = [q[1] - p[1], p[0] - q[0]];
      const proj = (pts: Vec2[]) => pts.map((x) => x[0] * n[0] + x[1] * n[1]);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) < Math.min(...pb) - 1e-9 || Math.max(...pb) < Math.min(...pa) - 1e-9) return false;
    }
  }
  return true;
}

/** is another footprint within `pad` metres of this one (0: do they overlap)? */
export function closerThan(center: Vec2, rot: number, hl: number, hw: number, other: Rect, pad: number): boolean {
  return convexOverlap(footprintCorners(center, rot, hl, hw, pad), footprintCorners(other.pos, other.rotation, other.length / 2, other.width / 2, 0));
}

/** is a point within a footprint? */
export function pointInRect(center: Vec2, rotationDeg: number, halfL: number, halfW: number, p: Vec2): boolean {
  const a = (rotationDeg * Math.PI) / 180;
  const dx = p[0] - center[0];
  const dz = p[1] - center[1];
  const u = dx * Math.cos(a) + dz * Math.sin(a);
  const v = -dx * Math.sin(a) + dz * Math.cos(a);
  return Math.abs(u) <= halfL && Math.abs(v) <= halfW;
}

/** does a polyline (a road of the given half width) come within `pad` metres of the footprint? */
export function roadWithin(center: Vec2, rot: number, hl: number, hw: number, pts: readonly Vec2[], pad: number): boolean {
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const bb = pts[i]!;
    const segLen = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
    const k = Math.max(1, Math.ceil(segLen / 2));
    for (let j = 0; j <= k; j += 1) {
      const p: Vec2 = [a[0] + ((bb[0] - a[0]) * j) / k, a[1] + ((bb[1] - a[1]) * j) / k];
      if (pointInRect(center, rot, hl + pad, hw + pad, p)) return true;
    }
  }
  return false;
}
