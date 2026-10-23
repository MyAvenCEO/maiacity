/**
 * Regular grids (`GridSpec`): heightmaps, soil grids, overlays.
 *
 * A GridSpec describes *vertices* (samples): vertex (i, j) sits at (x0 + i·cell, z0 + j·cell)
 * and is stored row-major at index j·nx + i. Bilinear sampling treats the samples as the
 * corners of cells; queries outside the grid are clamped to the border.
 */
import { clamp } from './math.ts';
import { clipPolygonToRect, polygonBounds, polygonCentroid, polygonSignedArea } from './polygon.ts';
import type { Bounds, GridSpec, Vec2 } from './types.ts';

/** Vertex grid covering `bounds` with spacing `cell` (the far edge is rounded to whole cells). */
export function makeGrid(bounds: Bounds, cell: number): GridSpec {
  if (!(cell > 0)) throw new Error('makeGrid: cell must be > 0');
  return {
    x0: bounds.x0,
    z0: bounds.z0,
    cell,
    nx: Math.round((bounds.x1 - bounds.x0) / cell) + 1,
    nz: Math.round((bounds.z1 - bounds.z0) / cell) + 1,
  };
}

export const gridIndex = (g: GridSpec, i: number, j: number): number => j * g.nx + i;
export const gridSize = (g: GridSpec): number => g.nx * g.nz;
export const gridPosition = (g: GridSpec, i: number, j: number): Vec2 => [g.x0 + i * g.cell, g.z0 + j * g.cell];
export const inGrid = (g: GridSpec, i: number, j: number): boolean => i >= 0 && j >= 0 && i < g.nx && j < g.nz && Number.isInteger(i) && Number.isInteger(j);

export function gridBounds(g: GridSpec): Bounds {
  return { x0: g.x0, z0: g.z0, x1: g.x0 + (g.nx - 1) * g.cell, z1: g.z0 + (g.nz - 1) * g.cell };
}

/** Fractional grid coordinates of a world point (not clamped). */
export function worldToGrid(g: GridSpec, x: number, z: number): Vec2 {
  return [(x - g.x0) / g.cell, (z - g.z0) / g.cell];
}

/** Nearest vertex (clamped into the grid). */
export function nearestVertex(g: GridSpec, x: number, z: number): [number, number] {
  return [clamp(Math.round((x - g.x0) / g.cell), 0, g.nx - 1), clamp(Math.round((z - g.z0) / g.cell), 0, g.nz - 1)];
}

/** Bilinear interpolation of vertex data at a world point (clamped to the grid). */
export function sampleBilinear(g: GridSpec, data: ArrayLike<number>, x: number, z: number): number {
  const fx = clamp((x - g.x0) / g.cell, 0, g.nx - 1);
  const fz = clamp((z - g.z0) / g.cell, 0, g.nz - 1);
  const i = Math.min(Math.floor(fx), g.nx - 2);
  const j = Math.min(Math.floor(fz), g.nz - 2);
  if (i < 0 || j < 0) return data[0] ?? 0; // degenerate 1-wide grid
  const tx = fx - i;
  const tz = fz - j;
  const k = j * g.nx + i;
  const h00 = data[k]!;
  const h10 = data[k + 1]!;
  const h01 = data[k + g.nx]!;
  const h11 = data[k + g.nx + 1]!;
  return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz;
}

/** Gradient [∂/∂x, ∂/∂z] of the bilinear surface at a world point (per metre). */
export function sampleGradient(g: GridSpec, data: ArrayLike<number>, x: number, z: number): Vec2 {
  if (g.nx < 2 || g.nz < 2) return [0, 0];
  const fx = clamp((x - g.x0) / g.cell, 0, g.nx - 1);
  const fz = clamp((z - g.z0) / g.cell, 0, g.nz - 1);
  const i = Math.min(Math.floor(fx), g.nx - 2);
  const j = Math.min(Math.floor(fz), g.nz - 2);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * g.nx + i;
  const h00 = data[k]!;
  const h10 = data[k + 1]!;
  const h01 = data[k + g.nx]!;
  const h11 = data[k + g.nx + 1]!;
  const dx = ((h10 - h00) * (1 - tz) + (h11 - h01) * tz) / g.cell;
  const dz = ((h01 - h00) * (1 - tx) + (h11 - h10) * tx) / g.cell;
  return [dx, dz];
}

/** Sorted x-crossings of the polygon boundary with the horizontal line z (even–odd pairs). */
function scanCrossings(poly: readonly Vec2[], z: number): number[] {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const zi = poly[i]![1];
    const zj = poly[j]![1];
    if (zi > z !== zj > z) xs.push(poly[i]![0] + ((poly[j]![0] - poly[i]![0]) * (z - zi)) / (zj - zi));
  }
  return xs.sort((a, b) => a - b);
}

/** Grid vertices whose position lies inside the polygon (even–odd), row by row. */
export function verticesInPolygon(g: GridSpec, poly: readonly Vec2[]): [number, number][] {
  const out: [number, number][] = [];
  if (poly.length < 3) return out;
  const b = polygonBounds(poly);
  const j0 = Math.max(0, Math.ceil((b.z0 - g.z0) / g.cell));
  const j1 = Math.min(g.nz - 1, Math.floor((b.z1 - g.z0) / g.cell));
  for (let j = j0; j <= j1; j += 1) {
    const xs = scanCrossings(poly, g.z0 + j * g.cell);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ia = Math.max(0, Math.ceil((xs[k]! - g.x0) / g.cell - 1e-9));
      const ib = Math.min(g.nx - 1, Math.floor((xs[k + 1]! - g.x0) / g.cell + 1e-9));
      for (let i = ia; i <= ib; i += 1) out.push([i, j]);
    }
  }
  return out;
}

export interface CoverageCell {
  i: number;
  j: number;
  /** area of the polygon inside this cell (m²) */
  area: number;
  /** centroid of that part (world coordinates) */
  x: number;
  z: number;
}

/**
 * Exact area coverage of a polygon on a square lattice of cells of size `spacing` anchored
 * at (x0, z0): cell (i, j) spans [x0 + i·s, x0 + (i+1)·s] × [z0 + j·s, …]. Cells crossed by the
 * boundary are clipped exactly (Sutherland–Hodgman); all other cells are classified by their
 * centre with a scanline. The areas sum to the polygon area up to rounding — the basis for
 * mass-haul quantities (cut/fill) that do not depend on how the polygon meets the grid.
 */
export function polygonCoverage(poly: readonly Vec2[], spacing: number, x0 = 0, z0 = 0): CoverageCell[] {
  if (poly.length < 3) return [];
  if (!(spacing > 0)) throw new Error('polygonCoverage: spacing must be > 0');
  const b = polygonBounds(poly);
  const i0 = Math.floor((b.x0 - x0) / spacing);
  const i1 = Math.floor((b.x1 - x0) / spacing);
  const j0 = Math.floor((b.z0 - z0) / spacing);
  const j1 = Math.floor((b.z1 - z0) / spacing);
  const w = i1 - i0 + 1;
  const boundary = new Set<number>();
  // Mark every cell the boundary passes through: split each edge at all lattice-line
  // crossings and mark the cell containing the midpoint of every piece.
  for (let e = 0; e < poly.length; e += 1) {
    const a = poly[e]!;
    const c = poly[(e + 1) % poly.length]!;
    const ts: number[] = [0, 1];
    const dx = c[0] - a[0];
    const dz = c[1] - a[1];
    if (dx !== 0) {
      const ka = (a[0] - x0) / spacing;
      const kc = (c[0] - x0) / spacing;
      for (let k = Math.ceil(Math.min(ka, kc)); k <= Math.floor(Math.max(ka, kc)); k += 1) ts.push((x0 + k * spacing - a[0]) / dx);
    }
    if (dz !== 0) {
      const ka = (a[1] - z0) / spacing;
      const kc = (c[1] - z0) / spacing;
      for (let k = Math.ceil(Math.min(ka, kc)); k <= Math.floor(Math.max(ka, kc)); k += 1) ts.push((z0 + k * spacing - a[1]) / dz);
    }
    ts.sort((p, q) => p - q);
    for (let k = 0; k + 1 < ts.length; k += 1) {
      const tm = (ts[k]! + ts[k + 1]!) / 2;
      const ci = Math.floor((a[0] + dx * tm - x0) / spacing);
      const cj = Math.floor((a[1] + dz * tm - z0) / spacing);
      // a piece lying exactly on a lattice line touches cells on both sides
      for (const [oi, oj] of [[0, 0], [-1, 0], [0, -1]] as const) {
        const ii = ci + oi;
        const jj = cj + oj;
        if (ii < i0 || ii > i1 || jj < j0 || jj > j1) continue;
        if (oi !== 0 && Math.abs(a[0] + dx * tm - (x0 + ci * spacing)) > 1e-9) continue;
        if (oj !== 0 && Math.abs(a[1] + dz * tm - (z0 + cj * spacing)) > 1e-9) continue;
        boundary.add((jj - j0) * w + (ii - i0));
      }
    }
  }
  const out: CoverageCell[] = [];
  const full = spacing * spacing;
  for (let j = j0; j <= j1; j += 1) {
    const zc = z0 + (j + 0.5) * spacing;
    const xs = scanCrossings(poly, zc);
    let k = 0;
    for (let i = i0; i <= i1; i += 1) {
      const key = (j - j0) * w + (i - i0);
      const xc = x0 + (i + 0.5) * spacing;
      if (boundary.has(key)) {
        const rect = { x0: x0 + i * spacing, z0: z0 + j * spacing, x1: x0 + (i + 1) * spacing, z1: z0 + (j + 1) * spacing };
        const clipped = clipPolygonToRect(poly, rect);
        if (clipped.length < 3) continue;
        const area = Math.abs(polygonSignedArea(clipped));
        if (area < 1e-12) continue;
        const [cx, cz] = polygonCentroid(clipped);
        out.push({ i, j, area, x: cx, z: cz });
        continue;
      }
      while (k < xs.length && xs[k]! <= xc) k += 1;
      if (k % 2 === 1) out.push({ i, j, area: full, x: xc, z: zc });
    }
  }
  return out;
}
