/**
 * Heightfield sampling and ray marching on the terrain grid (fast picking without a BVH).
 *
 * Scene coordinates: x = east, z = south, y = up, with y = elevation − baseY (a fixed base offset
 * keeps float32 precision in the GPU). `meshY` reproduces the exact triangulation of the terrain
 * mesh so draped ribbons never dip below it.
 */
import type { GridSpec } from '../../../../packages/geo/src/index.ts';
import type { Vector3 } from 'three';

export class Heightfield {
  grid: GridSpec;
  heights: Float32Array;
  readonly baseY: number;
  x1: number;
  z1: number;
  minY = 0;
  maxY = 0;

  constructor(grid: GridSpec, heights: Float32Array, baseY: number) {
    this.grid = grid;
    this.heights = heights;
    this.baseY = baseY;
    this.x1 = grid.x0 + (grid.nx - 1) * grid.cell;
    this.z1 = grid.z0 + (grid.nz - 1) * grid.cell;
    this.updateRange();
  }

  set(heights: Float32Array): void {
    this.heights = heights;
    this.updateRange();
  }

  private updateRange(): void {
    let mn = Infinity;
    let mx = -Infinity;
    const h = this.heights;
    for (let i = 0; i < h.length; i += 1) {
      const v = h[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    this.minY = mn - this.baseY;
    this.maxY = mx - this.baseY;
  }

  inside(x: number, z: number): boolean {
    return x >= this.grid.x0 && x <= this.x1 && z >= this.grid.z0 && z <= this.z1;
  }

  clampX(x: number): number {
    return x < this.grid.x0 ? this.grid.x0 : x > this.x1 ? this.x1 : x;
  }

  clampZ(z: number): number {
    return z < this.grid.z0 ? this.grid.z0 : z > this.z1 ? this.z1 : z;
  }

  /** absolute elevation (m a.s.l.), bilinear, clamped to the grid */
  elevation(x: number, z: number): number {
    return this.y(x, z) + this.baseY;
  }

  /** scene y on the terrain mesh surface (same triangle split as the mesh index) */
  y(x: number, z: number): number {
    const g = this.grid;
    let fx = (x - g.x0) / g.cell;
    let fz = (z - g.z0) / g.cell;
    if (fx < 0) fx = 0;
    else if (fx > g.nx - 1.000001) fx = g.nx - 1.000001;
    if (fz < 0) fz = 0;
    else if (fz > g.nz - 1.000001) fz = g.nz - 1.000001;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * g.nx + i;
    const h = this.heights;
    const a = h[k]!;
    const b = h[k + 1]!;
    const c = h[k + g.nx]!;
    const d = h[k + g.nx + 1]!;
    // mesh triangles: (a, c, b) and (b, c, d) — split along the a/d anti-diagonal b–c
    let r: number;
    if (u + v <= 1) r = a + (b - a) * u + (c - a) * v;
    else r = d + (c - d) * (1 - u) + (b - d) * (1 - v);
    return r - this.baseY;
  }

  /** gradient (dy/dx, dy/dz) by central differences */
  gradient(x: number, z: number, out: { x: number; z: number }): void {
    const e = this.grid.cell;
    out.x = (this.y(x + e, z) - this.y(x - e, z)) / (2 * e);
    out.z = (this.y(x, z + e) - this.y(x, z - e)) / (2 * e);
  }

  /**
   * Intersect a ray (scene coordinates) with the terrain. Marches in ~cell/1.5 steps inside the
   * map's bounding box and refines by bisection. Returns false when the ray misses.
   */
  raycast(origin: Vector3, dir: Vector3, out: Vector3): boolean {
    const g = this.grid;
    // clip against the bounding box
    let t0 = 0;
    let t1 = 20000;
    const bmin = [g.x0, this.minY - 1, g.z0];
    const bmax = [this.x1, this.maxY + 1, this.z1];
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];
    for (let a = 0; a < 3; a += 1) {
      const da = d[a]!;
      const oa = o[a]!;
      if (Math.abs(da) < 1e-12) {
        if (oa < bmin[a]! || oa > bmax[a]!) return false;
      } else {
        let ta = (bmin[a]! - oa) / da;
        let tb = (bmax[a]! - oa) / da;
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return false;
      }
    }
    const step = g.cell / 1.5;
    let prevT = t0;
    let prevD = origin.y + dir.y * t0 - this.y(origin.x + dir.x * t0, origin.z + dir.z * t0);
    if (prevD < 0) {
      out.set(origin.x + dir.x * t0, this.y(origin.x + dir.x * t0, origin.z + dir.z * t0), origin.z + dir.z * t0);
      return true;
    }
    for (let t = t0 + step; t <= t1 + step; t += step) {
      const tt = t > t1 ? t1 : t;
      const x = origin.x + dir.x * tt;
      const z = origin.z + dir.z * tt;
      const dd = origin.y + dir.y * tt - this.y(x, z);
      if (dd <= 0) {
        let lo = prevT;
        let hi = tt;
        for (let k = 0; k < 10; k += 1) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid;
          const mz = origin.z + dir.z * mid;
          if (origin.y + dir.y * mid - this.y(mx, mz) > 0) lo = mid;
          else hi = mid;
        }
        const ft = (lo + hi) * 0.5;
        const fx = origin.x + dir.x * ft;
        const fz = origin.z + dir.z * ft;
        out.set(fx, this.y(fx, fz), fz);
        return true;
      }
      prevT = tt;
      prevD = dd;
      if (tt >= t1) break;
    }
    void prevD;
    return false;
  }
}
