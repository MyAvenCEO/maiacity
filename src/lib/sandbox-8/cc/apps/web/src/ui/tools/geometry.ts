/** Client-side geometry helpers on the static world (snapping, heights). */
import type { Vec2 } from '../../../../../packages/geo/src/index.ts';
import type { StaticWorld } from '../../protocol.ts';

/** Bilinear terrain height from the static heightfield. */
export function heightAt(w: StaticWorld | null, x: number, z: number): number {
  if (!w) return 0;
  const g = w.grid;
  const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.cell));
  const fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / g.cell));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const h = w.heights;
  const k = j * g.nx + i;
  const a = h[k] ?? 0;
  const b = h[k + 1] ?? a;
  const c = h[k + g.nx] ?? a;
  const d = h[k + g.nx + 1] ?? a;
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; distance: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  const q: Vec2 = [a[0] + dx * t, a[1] + dz * t];
  return { point: q, distance: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

export interface SnapHit {
  point: Vec2;
  distance: number;
  label: string;
  /** network edge or planned/existing road id */
  id: string;
  kind: 'edge' | 'road';
}

/** Nearest point on existing network edges and planned roads within maxDistance. */
export function nearestRoad(w: StaticWorld | null, p: Vec2, maxDistance: number): SnapHit | null {
  if (!w) return null;
  let best: SnapHit | null = null;
  const consider = (pts: Vec2[], id: string, label: string, kind: SnapHit['kind']) => {
    for (let i = 1; i < pts.length; i += 1) {
      const r = closestOnSegment(p, pts[i - 1]!, pts[i]!);
      if (r.distance <= maxDistance && (!best || r.distance < best.distance)) best = { point: r.point, distance: r.distance, label, id, kind };
    }
  };
  for (const e of w.edges) consider(e.points, e.id, e.label ?? (e.surface === 'asphalt' ? 'asphalt road' : `${e.surface} track`), 'edge');
  for (const r of w.roads) if (r.status !== 'open') consider(r.design.alignment, r.id, `${r.label} (${r.status})`, 'road');
  return best;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function polylineLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i += 1) l += dist(pts[i - 1]!, pts[i]!);
  return l;
}
