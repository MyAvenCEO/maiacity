/** World ground-plane coordinates in metres: x = east, z = south, y = up (three.js convention). */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** Axis-aligned bounding box on the ground plane. */
export interface Bounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A regular grid of samples (vertices), row-major: index = j * nx + i, position = (x0 + i·cell, z0 + j·cell). */
export interface GridSpec {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
}
