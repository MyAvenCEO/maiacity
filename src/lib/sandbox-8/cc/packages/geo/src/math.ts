/**
 * Small scalar and 2D vector helpers shared by the geometry modules.
 * Vectors are plain `[x, z]` tuples (ground plane, metres) — cheap to create, trivially
 * serialisable, and the same shape that contracts and snapshots use.
 */
import type { Vec2 } from './types.ts';

export const EPS = 1e-9;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite smoothstep of x between edges e0 < e1 (0 below e0, 1 above e1). */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
/** z-component of the 3D cross product of (a, 0) × (b, 0) in the (x, z) plane. */
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const dist2 = (a: Vec2, b: Vec2): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a[0], a[1]);
  return l > EPS ? [a[0] / l, a[1] / l] : [0, 0];
}

/**
 * Left-hand normal of a direction as seen on a north-up map (x = east to the right,
 * z = south downwards): travelling east (1, 0), "left" is north (0, −1).
 */
export const leftNormal = (d: Vec2): Vec2 => [d[1], -d[0]];

/** Distance from p to segment ab, plus the parameter t ∈ [0, 1] of the closest point. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number; x: number; z: number } {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2 : 0;
  t = clamp01(t);
  const x = a[0] + dx * t;
  const z = a[1] + dz * t;
  return { d: Math.hypot(p[0] - x, p[1] - z), t, x, z };
}
