/**
 * Polylines and chainage.
 *
 * Linear infrastructure (roads, pipes, creeks, hedgerows) is described by a centreline
 * polyline and positions along it by *chainage* (Stationierung): the arc length s in metres
 * from the first vertex. All functions treat the polyline as open and work on plain
 * `[x, z]` arrays; none mutate their inputs.
 */
import { clamp, dist, EPS, leftNormal, normalize, pointSegment } from './math.ts';
import type { Vec2 } from './types.ts';

/** Total length of a polyline (m). */
export function polylineLength(pts: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += dist(pts[i - 1]!, pts[i]!);
  return total;
}

/** Cumulative chainage at each vertex: cum[0] = 0, cum[n−1] = length. */
export function cumulativeLengths(pts: readonly Vec2[]): number[] {
  const cum = new Array<number>(pts.length);
  let total = 0;
  for (let i = 0; i < pts.length; i += 1) {
    if (i > 0) total += dist(pts[i - 1]!, pts[i]!);
    cum[i] = total;
  }
  return cum;
}

/** Segment index k with cum[k] ≤ s ≤ cum[k+1] (binary search, clamped to the polyline). */
function segmentAt(cum: readonly number[], s: number): number {
  let lo = 0;
  let hi = cum.length - 2;
  if (hi <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Point at chainage s (clamped to [0, length]). Pass a precomputed `cum` from
 * `cumulativeLengths` when sampling the same polyline repeatedly (O(log n) per call).
 */
export function pointAtChainage(pts: readonly Vec2[], s: number, cum: readonly number[] = cumulativeLengths(pts)): Vec2 {
  if (pts.length === 0) throw new Error('pointAtChainage: empty polyline');
  if (pts.length === 1) return [pts[0]![0], pts[0]![1]];
  const total = cum[cum.length - 1]!;
  const sc = clamp(s, 0, total);
  const k = segmentAt(cum, sc);
  const a = pts[k]!;
  const b = pts[k + 1]!;
  const segLen = cum[k + 1]! - cum[k]!;
  const t = segLen > EPS ? (sc - cum[k]!) / segLen : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Unit tangent (direction of increasing chainage) at chainage s. */
export function tangentAtChainage(pts: readonly Vec2[], s: number, cum: readonly number[] = cumulativeLengths(pts)): Vec2 {
  if (pts.length < 2) return [1, 0];
  const total = cum[cum.length - 1]!;
  let k = segmentAt(cum, clamp(s, 0, total));
  // skip zero-length segments
  while (k < pts.length - 2 && dist(pts[k]!, pts[k + 1]!) <= EPS) k += 1;
  const a = pts[k]!;
  const b = pts[k + 1]!;
  return normalize([b[0] - a[0], b[1] - a[1]]);
}

/**
 * Resample at (approximately) uniform spacing. The spacing is adjusted so that the
 * polyline is divided into equal parts; first and last vertices are kept exactly.
 */
export function resamplePolyline(pts: readonly Vec2[], spacing: number): Vec2[] {
  if (!(spacing > 0)) throw new Error('resamplePolyline: spacing must be > 0');
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]] as Vec2);
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1]!;
  const n = Math.max(1, Math.round(total / spacing));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i += 1) out.push(pointAtChainage(pts, (total * i) / n, cum));
  out[out.length - 1] = [pts[pts.length - 1]![0], pts[pts.length - 1]![1]];
  return out;
}

export interface NearestOnPolyline {
  point: Vec2;
  /** chainage of the nearest point (m) */
  s: number;
  /** distance from the query point (m) */
  distance: number;
  /** index of the segment (vertex k → k+1) */
  segment: number;
  /** parameter on that segment, 0..1 */
  t: number;
  /** signed lateral offset: positive = left of the direction of travel (north-up map) */
  offset: number;
}

/** Nearest point on the polyline to p (linear scan; use a SpatialHash of segments for many queries). */
export function nearestOnPolyline(pts: readonly Vec2[], p: Vec2, cum: readonly number[] = cumulativeLengths(pts)): NearestOnPolyline {
  if (pts.length === 0) throw new Error('nearestOnPolyline: empty polyline');
  if (pts.length === 1) {
    const q = pts[0]!;
    return { point: [q[0], q[1]], s: 0, distance: dist(q, p), segment: 0, t: 0, offset: 0 };
  }
  let best = { d: Infinity, t: 0, x: 0, z: 0 };
  let bestK = 0;
  for (let k = 0; k < pts.length - 1; k += 1) {
    const r = pointSegment(p, pts[k]!, pts[k + 1]!);
    if (r.d < best.d) {
      best = r;
      bestK = k;
    }
  }
  const a = pts[bestK]!;
  const b = pts[bestK + 1]!;
  const s = cum[bestK]! + dist(a, b) * best.t;
  const n = leftNormal(normalize([b[0] - a[0], b[1] - a[1]]));
  const offset = (p[0] - best.x) * n[0] + (p[1] - best.z) * n[1];
  return { point: [best.x, best.z], s, distance: best.d, segment: bestK, t: best.t, offset };
}

/**
 * Parallel offset polyline at lateral distance d (positive = left of travel direction on a
 * north-up map). Joins are mitred; the mitre is limited to `miterLimit`·|d| and bevelled
 * beyond (two vertices). On the inside of curves tighter than |d| the result self-overlaps —
 * fillet alignments first (radius ≥ |d|) when a clean offset is needed.
 */
export function offsetPolyline(pts: readonly Vec2[], d: number, miterLimit = 4): Vec2[] {
  const clean = dedupe(pts);
  if (clean.length < 2) return clean.map((p) => [p[0], p[1]] as Vec2);
  const out: Vec2[] = [];
  const dirs: Vec2[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    const a = clean[i]!;
    const b = clean[i + 1]!;
    dirs.push(normalize([b[0] - a[0], b[1] - a[1]]));
  }
  const n0 = leftNormal(dirs[0]!);
  out.push([clean[0]![0] + n0[0] * d, clean[0]![1] + n0[1] * d]);
  for (let i = 1; i < clean.length - 1; i += 1) {
    const na = leftNormal(dirs[i - 1]!);
    const nb = leftNormal(dirs[i]!);
    const p = clean[i]!;
    const bis = normalize([na[0] + nb[0], na[1] + nb[1]]);
    const cosHalf = bis[0] * nb[0] + bis[1] * nb[1];
    if (cosHalf > EPS && 1 / cosHalf <= miterLimit) {
      const m = d / cosHalf;
      out.push([p[0] + bis[0] * m, p[1] + bis[1] * m]);
    } else {
      out.push([p[0] + na[0] * d, p[1] + na[1] * d]);
      out.push([p[0] + nb[0] * d, p[1] + nb[1] * d]);
    }
  }
  const nl = leftNormal(dirs[dirs.length - 1]!);
  const last = clean[clean.length - 1]!;
  out.push([last[0] + nl[0] * d, last[1] + nl[1] * d]);
  return out;
}

/** Remove consecutive duplicate vertices (closer than 1 µm). */
export function dedupe(pts: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || dist(prev, p) > 1e-6) out.push([p[0], p[1]]);
  }
  return out;
}

export interface FilletResult {
  /** dense, smooth polyline: straights and circular arcs */
  points: Vec2[];
  /** smallest arc radius actually used (Infinity if there were no bends) */
  minRadius: number;
  /** per-corner radius used (vertex index 1..n−2); smaller than requested where segments are too short */
  radii: number[];
}

/**
 * Fillet a polyline with circular arcs (Kreisbogen) of radius `radius` at every interior
 * vertex — the classic way to turn a surveyed tangent polygon (Polygonzug) into a road
 * alignment. The tangent length of a corner with deflection angle Δ is T = R·tan(Δ/2).
 * When two neighbouring corners would need more than the segment between them, the radius
 * of those corners is reduced (each corner may use at most half of each adjacent segment;
 * end segments may be used fully). `minRadius` reports the radius actually achieved so a
 * caller can reject alignments below its design minimum (e.g. RASt 06 / RAL minimum radii).
 *
 * Clothoid transitions are not modelled — fine for low-speed rural and estate roads.
 * The output is densified so that neither chords on arcs nor straight parts exceed `spacing`.
 */
export function filletPolyline(pts: readonly Vec2[], radius: number, spacing = 2): FilletResult {
  if (!(radius > 0)) throw new Error('filletPolyline: radius must be > 0');
  if (!(spacing > 0)) throw new Error('filletPolyline: spacing must be > 0');
  const p = dedupe(pts);
  if (p.length < 3) return { points: densify(p, spacing), minRadius: Infinity, radii: [] };
  const n = p.length;
  const segLen: number[] = [];
  for (let i = 0; i < n - 1; i += 1) segLen.push(dist(p[i]!, p[i + 1]!));
  // deflection angle at each interior vertex
  const defl: number[] = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    const a = normalize([p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1]]);
    const b = normalize([p[i + 1]![0] - p[i]![0], p[i + 1]![1] - p[i]![1]]);
    const c = clamp(a[0] * b[0] + a[1] * b[1], -1, 1);
    defl[i] = Math.acos(c);
  }
  const radii: number[] = [];
  const tangents: number[] = new Array<number>(n).fill(0);
  let minRadius = Infinity;
  for (let i = 1; i < n - 1; i += 1) {
    const delta = defl[i]!;
    if (delta < 1e-6 || delta > Math.PI - 1e-6) {
      radii.push(delta < 1e-6 ? Infinity : 0);
      if (delta > Math.PI - 1e-6) minRadius = 0;
      continue;
    }
    const tanHalf = Math.tan(delta / 2);
    const availPrev = i - 1 === 0 ? segLen[i - 1]! : segLen[i - 1]! / 2;
    const availNext = i + 1 === n - 1 ? segLen[i]! : segLen[i]! / 2;
    const t = Math.min(radius * tanHalf, availPrev, availNext);
    tangents[i] = t;
    const r = t / tanHalf;
    radii.push(r);
    minRadius = Math.min(minRadius, r);
  }

  const out: Vec2[] = [[p[0]![0], p[0]![1]]];
  const pushStraightTo = (q: Vec2) => {
    const last = out[out.length - 1]!;
    const l = dist(last, q);
    const k = Math.max(1, Math.ceil(l / spacing - 1e-9));
    for (let j = 1; j <= k; j += 1) out.push([last[0] + ((q[0] - last[0]) * j) / k, last[1] + ((q[1] - last[1]) * j) / k]);
  };
  for (let i = 1; i < n - 1; i += 1) {
    const t = tangents[i]!;
    const v = p[i]!;
    if (t <= 1e-9) {
      pushStraightTo(v);
      continue;
    }
    const a = normalize([v[0] - p[i - 1]![0], v[1] - p[i - 1]![1]]);
    const b = normalize([p[i + 1]![0] - v[0], p[i + 1]![1] - v[1]]);
    const start: Vec2 = [v[0] - a[0] * t, v[1] - a[1] * t];
    const end: Vec2 = [v[0] + b[0] * t, v[1] + b[1] * t];
    pushStraightTo(start);
    const r = radii[i - 1]!;
    // The arc centre lies on the inside of the bend, at distance r from the tangent point.
    // turn = a × b > 0 is a counter-clockwise turn in the (x, z) math frame, so the centre is
    // on the CCW normal (−a.z, a.x) and the arc sweeps by +Δ; otherwise mirrored.
    const turn = a[0] * b[1] - a[1] * b[0];
    const nrm: Vec2 = turn > 0 ? [-a[1], a[0]] : [a[1], -a[0]];
    const c: Vec2 = [start[0] + nrm[0] * r, start[1] + nrm[1] * r];
    const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
    const sweep = (turn > 0 ? 1 : -1) * defl[i]!;
    const arcLen = Math.abs(sweep) * r;
    const k = Math.max(1, Math.ceil(arcLen / spacing - 1e-9));
    for (let j = 1; j <= k; j += 1) {
      const ang = a0 + (sweep * j) / k;
      out.push([c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r]);
    }
    out[out.length - 1] = end;
  }
  pushStraightTo(p[n - 1]!);
  return { points: dedupe(out), minRadius, radii };
}

/** Insert vertices so that no segment is longer than `spacing` (original vertices kept). */
export function densify(pts: readonly Vec2[], spacing: number): Vec2[] {
  if (pts.length === 0) return [];
  const out: Vec2[] = [[pts[0]![0], pts[0]![1]]];
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const k = Math.max(1, Math.ceil(dist(a, b) / spacing - 1e-9));
    for (let j = 1; j <= k; j += 1) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/**
 * Corridor polygon of half-width w around a polyline (e.g. road formation, creek buffer).
 * Built from the left offset forward and the right offset backward, with flat ends.
 * Counter-clockwise or clockwise depending on direction — use `polygonArea` (abs) for area.
 */
export function bufferPolyline(pts: readonly Vec2[], w: number): Vec2[] {
  if (!(w > 0)) throw new Error('bufferPolyline: half-width must be > 0');
  const left = offsetPolyline(pts, w);
  const right = offsetPolyline(pts, -w);
  return [...left, ...right.reverse()];
}

/** Turn angle (radians, signed: positive = turning right on a north-up map) at each interior vertex. */
export function turnAngles(pts: readonly Vec2[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = normalize([pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]]);
    const b = normalize([pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]]);
    out.push(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
  }
  return out;
}
