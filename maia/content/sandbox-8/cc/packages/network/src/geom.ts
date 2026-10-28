/**
 * Small private 2D polyline helpers (ground plane, metres). Kept inside @cc/network on
 * purpose so the package does not depend on helpers that may not exist in @cc/geo yet.
 */
import type { Vec2 } from '../../geo/src/index.ts';

export const dist = (a: Readonly<Vec2>, b: Readonly<Vec2>): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function polylineLength(pts: readonly Readonly<Vec2>[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i += 1) L += dist(pts[i - 1]!, pts[i]!);
  return L;
}

/** Cumulative chainage at every vertex (first = 0, last = length). */
export function cumulative(pts: readonly Readonly<Vec2>[]): number[] {
  const out = [0];
  for (let i = 1; i < pts.length; i += 1) out.push(out[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return out;
}

export interface SegProjection {
  /** parameter 0..1 along the segment */
  t: number;
  point: Vec2;
  distance: number;
}

export function projectOnSegment(p: Readonly<Vec2>, a: Readonly<Vec2>, b: Readonly<Vec2>): SegProjection {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const point: Vec2 = [a[0] + t * dx, a[1] + t * dz];
  return { t, point, distance: dist(p, point) };
}

export interface PolylineProjection {
  point: Vec2;
  chainage: number;
  distance: number;
  segment: number;
}

export function projectOnPolyline(p: Readonly<Vec2>, pts: readonly Readonly<Vec2>[], cum?: readonly number[]): PolylineProjection {
  const c = cum ?? cumulative(pts);
  let best: PolylineProjection = { point: [pts[0]![0], pts[0]![1]], chainage: 0, distance: dist(p, pts[0]!), segment: 0 };
  for (let i = 1; i < pts.length; i += 1) {
    const pr = projectOnSegment(p, pts[i - 1]!, pts[i]!);
    if (pr.distance < best.distance) {
      best = { point: pr.point, chainage: c[i - 1]! + pr.t * (c[i]! - c[i - 1]!), distance: pr.distance, segment: i - 1 };
    }
  }
  return best;
}

/** Point at chainage `c` (clamped) along a polyline. */
export function pointAt(pts: readonly Readonly<Vec2>[], c: number, cum?: readonly number[]): Vec2 {
  const cc = cum ?? cumulative(pts);
  const L = cc[cc.length - 1]!;
  if (c <= 0 || pts.length < 2) return [pts[0]![0], pts[0]![1]];
  if (c >= L) return [pts[pts.length - 1]![0], pts[pts.length - 1]![1]];
  for (let i = 1; i < pts.length; i += 1) {
    if (cc[i]! >= c) {
      const seg = cc[i]! - cc[i - 1]!;
      const t = seg > 0 ? (c - cc[i - 1]!) / seg : 0;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return [pts[pts.length - 1]![0], pts[pts.length - 1]![1]];
}

/**
 * Sub-polyline between chainages c0 and c1 (c0 may be greater than c1: the result then runs
 * backwards). Interior vertices are kept; ends are interpolated.
 */
export function subPolyline(pts: readonly Readonly<Vec2>[], c0: number, c1: number, cum?: readonly number[]): Vec2[] {
  const cc = cum ?? cumulative(pts);
  const lo = Math.min(c0, c1);
  const hi = Math.max(c0, c1);
  const out: Vec2[] = [pointAt(pts, lo, cc)];
  for (let i = 0; i < pts.length; i += 1) {
    const ci = cc[i]!;
    if (ci > lo + 1e-9 && ci < hi - 1e-9) out.push([pts[i]![0], pts[i]![1]]);
  }
  out.push(pointAt(pts, hi, cc));
  return c0 <= c1 ? out : out.reverse();
}

export interface SegmentHit {
  /** parameter along p1→p2 */
  t: number;
  /** parameter along q1→q2 */
  u: number;
  point: Vec2;
}

/** Proper intersection of two segments (parallel / collinear overlaps are ignored). */
export function segmentIntersection(p1: Readonly<Vec2>, p2: Readonly<Vec2>, q1: Readonly<Vec2>, q2: Readonly<Vec2>): SegmentHit | null {
  const rx = p2[0] - p1[0];
  const rz = p2[1] - p1[1];
  const sx = q2[0] - q1[0];
  const sz = q2[1] - q1[1];
  const denom = rx * sz - rz * sx;
  const scale = Math.hypot(rx, rz) * Math.hypot(sx, sz);
  if (scale === 0 || Math.abs(denom) <= 1e-12 * scale) return null;
  const qpx = q1[0] - p1[0];
  const qpz = q1[1] - p1[1];
  const t = (qpx * sz - qpz * sx) / denom;
  const u = (qpx * rz - qpz * rx) / denom;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  const tc = Math.min(1, Math.max(0, t));
  return { t: tc, u: Math.min(1, Math.max(0, u)), point: [p1[0] + tc * rx, p1[1] + tc * rz] };
}

/** Remove consecutive points closer than `eps`. */
export function dedupe(pts: readonly Readonly<Vec2>[], eps = 1e-6): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > eps) out.push([p[0], p[1]]);
  }
  return out;
}

/** Heading in radians: 0 = +x, counterclockwise towards −z (three.js ground plane seen from above). */
export const headingOf = (a: Readonly<Vec2>, b: Readonly<Vec2>): number => Math.atan2(-(b[1] - a[1]), b[0] - a[0]);

export const bboxOf = (pts: readonly Readonly<Vec2>[]): [number, number, number, number] => {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return [x0, z0, x1, z1];
};
