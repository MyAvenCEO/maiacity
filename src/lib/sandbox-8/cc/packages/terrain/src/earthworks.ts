/**
 * Pure earthworks helpers over any TerrainPort.
 *
 * Volumes are bank (in-situ, "fest") cubic metres: the geometric difference between the
 * current surface and a design surface. Swell (Auflockerung) for haulage and compaction for
 * placement are applied by the consumer with the soil class factors.
 */
import { polygonCoverage, verticesInPolygon, type Vec2 } from '../../geo/src/index.ts';
import type { TerrainPort } from './contract.ts';

export interface CutFill {
  /** volume to excavate where the surface is above design (m³, bank) */
  cut: number;
  /** volume to place where the surface is below design (m³, compacted geometry) */
  fill: number;
  /** plan area integrated (m²) */
  area: number;
  /** cut − fill (m³); > 0 means surplus material */
  net: number;
}

/**
 * Integrate (current surface − design) over a polygon. The polygon is covered exactly by
 * sub-cells of `sampleSpacing` aligned with the terrain grid (boundary cells clipped), and
 * each piece is evaluated at its centroid (midpoint rule — exact for planar differences,
 * second-order accurate for the bilinear terrain surface). The area returned therefore
 * equals the polygon area regardless of how it meets the grid.
 */
export function cutFillVolumes(terrain: TerrainPort, polygon: Vec2[], design: (x: number, z: number) => number, sampleSpacing = terrain.grid.cell / 2): CutFill {
  let cut = 0;
  let fill = 0;
  let area = 0;
  for (const c of polygonCoverage(polygon, sampleSpacing, terrain.grid.x0, terrain.grid.z0)) {
    const dh = terrain.heightAt(c.x, c.z) - design(c.x, c.z);
    if (dh > 0) cut += dh * c.area;
    else fill -= dh * c.area;
    area += c.area;
  }
  return { cut, fill, area, net: cut - fill };
}

/**
 * Vertex edits that make the terrain follow `design` at every grid vertex inside the polygon,
 * ready for `terrain.setHeights`. Vertices already within `tolerance` (default 1 mm) are
 * skipped. Heights are rounded to millimetres.
 *
 * Note: the bilinear surface between edited vertices and untouched neighbours forms a
 * transition one cell wide, so the volume physically moved by applying these edits differs
 * from `cutFillVolumes` over the same polygon by roughly perimeter × cell/2 × mean step.
 */
export function designVertexEdits(terrain: TerrainPort, polygon: Vec2[], design: (x: number, z: number) => number, tolerance = 0.001): [number, number, number][] {
  const g = terrain.grid;
  const heights = terrain.heights();
  const out: [number, number, number][] = [];
  for (const [i, j] of verticesInPolygon(g, polygon)) {
    const x = g.x0 + i * g.cell;
    const z = g.z0 + j * g.cell;
    const h = Math.round(design(x, z) * 1000) / 1000;
    if (Math.abs(h - heights[j * g.nx + i]!) > tolerance) out.push([i, j, h]);
  }
  return out;
}
