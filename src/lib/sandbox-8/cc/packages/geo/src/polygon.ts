/**
 * Polygons (simple, implicitly closed — the last vertex connects back to the first)
 * and segment intersection.
 */
import { EPS } from './math.ts';
import type { Bounds, Vec2 } from './types.ts';

/** Signed area (shoelace). Positive for counter-clockwise in the (x, z) math frame. */
export function polygonSignedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    a += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  }
  return a / 2;
}

/** Area in m² (absolute). */
export function polygonArea(poly: readonly Vec2[]): number {
  return Math.abs(polygonSignedArea(poly));
}

/** Area centroid (falls back to the vertex mean for degenerate polygons). */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const f = poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
    a += f;
    cx += (poly[j]![0] + poly[i]![0]) * f;
    cz += (poly[j]![1] + poly[i]![1]) * f;
  }
  if (Math.abs(a) < EPS) {
    let sx = 0;
    let sz = 0;
    for (const p of poly) {
      sx += p[0];
      sz += p[1];
    }
    return poly.length ? [sx / poly.length, sz / poly.length] : [0, 0];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

/** Point-in-polygon by the even–odd rule (points exactly on an edge may go either way). */
export function polygonContains(poly: readonly Vec2[], p: Vec2): boolean {
  return containsXZ(poly, p[0], p[1]);
}

/** Allocation-free variant of `polygonContains`. */
export function containsXZ(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i]![0];
    const zi = poly[i]![1];
    const xj = poly[j]![0];
    const zj = poly[j]![1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBounds(poly: readonly Vec2[]): Bounds {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return { x0, z0, x1, z1 };
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
}

export function boundsContains(b: Bounds, x: number, z: number): boolean {
  return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
}

export function expandBounds(b: Bounds, m: number): Bounds {
  return { x0: b.x0 - m, z0: b.z0 - m, x1: b.x1 + m, z1: b.z1 + m };
}

export interface SegmentHit {
  point: Vec2;
  /** parameter along a→b */
  t: number;
  /** parameter along c→d */
  u: number;
}

/**
 * Intersection of segments ab and cd (endpoints inclusive). Collinear overlaps return null —
 * callers that care (e.g. snapping roads) should test for collinearity separately.
 */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): SegmentHit | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < EPS) return null;
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  const tol = 1e-12;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return { point: [a[0] + rx * t, a[1] + rz * t], t, u };
}

/** All intersections of polyline A with polyline B (pairwise segment test). */
export function polylineIntersections(a: readonly Vec2[], b: readonly Vec2[]): { point: Vec2; segA: number; segB: number; t: number; u: number }[] {
  const out: { point: Vec2; segA: number; segB: number; t: number; u: number }[] = [];
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      const h = segmentIntersection(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!);
      if (h) out.push({ point: h.point, segA: i, segB: j, t: h.t, u: h.u });
    }
  }
  return out;
}

/**
 * Clip a polygon to an axis-aligned rectangle (Sutherland–Hodgman). Works for concave
 * subject polygons (the result may contain zero-width bridges, which do not affect area).
 */
export function clipPolygonToRect(poly: readonly Vec2[], r: Bounds): Vec2[] {
  let out: Vec2[] = poly.map((p) => [p[0], p[1]] as Vec2);
  const edges: [number, number, 1 | -1][] = [
    [0, r.x0, 1],
    [0, r.x1, -1],
    [1, r.z0, 1],
    [1, r.z1, -1],
  ];
  for (const [axis, v, sign] of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    const inside = (p: Vec2) => (p[axis]! - v) * sign >= 0;
    for (let i = 0; i < input.length; i += 1) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      const cin = inside(cur);
      const pin = inside(prev);
      if (cin !== pin) {
        const t = (v - prev[axis]!) / (cur[axis]! - prev[axis]!);
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
      if (cin) out.push(cur);
    }
  }
  return out;
}
