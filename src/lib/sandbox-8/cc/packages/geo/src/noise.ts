/**
 * Deterministic coherent noise built on the kernel's stateless `hashNoise(seed, ...ints)`.
 *
 * These are *derived-field* generators (terrain relief, soil patches, woodland masks): pure
 * functions of seed and coordinates, nothing to snapshot. Coordinates are in lattice units —
 * divide world metres by the feature wavelength you want (e.g. x / 400 for ~400 m hills).
 *
 * Gradient noise uses a fixed table of 8 directions (no trigonometry), so values are
 * bit-identical across JavaScript engines.
 */
import { hashNoise } from '../../kernel/src/index.ts';

/**
 * Fixed-arity copies of the kernel's `hashNoise(seed, a)` / `hashNoise(seed, a, b)`:
 * bit-identical results (asserted in tests) without the rest-parameter allocation, which
 * dominates the cost of generating 10⁷ noise samples for a 401 × 401 heightmap.
 */
export function hash1(seed: number, a: number): number {
  let h = seed >>> 0;
  h ^= Math.imul((a | 0) ^ 0x27d4eb2d, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(seed: number, a: number, b: number): number {
  let h = seed >>> 0;
  h ^= Math.imul((a | 0) ^ 0x27d4eb2d, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h ^= Math.imul((b | 0) ^ 0x27d4eb2d, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10); // quintic, C2-continuous

const R = Math.SQRT1_2;
const GX = [1, -1, 0, 0, R, -R, R, -R];
const GZ = [0, 0, 1, -1, R, R, -R, -R];

/** Value noise in [−1, 1]: hashed lattice values, quintic interpolation. */
export function valueNoise2(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = hash2(seed, ix, iz);
  const b = hash2(seed, ix + 1, iz);
  const c = hash2(seed, ix, iz + 1);
  const d = hash2(seed, ix + 1, iz + 1);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

function grad(seed: number, ix: number, iz: number, dx: number, dz: number): number {
  const g = (hash2(seed, ix, iz) * 8) | 0;
  return GX[g]! * dx + GZ[g]! * dz;
}

/** Gradient (Perlin-type) noise, approximately in [−1, 1], zero at lattice points. */
export function gradientNoise2(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = grad(seed, ix, iz, fx, fz);
  const n10 = grad(seed, ix + 1, iz, fx - 1, fz);
  const n01 = grad(seed, ix, iz + 1, fx, fz - 1);
  const n11 = grad(seed, ix + 1, iz + 1, fx - 1, fz - 1);
  const top = n00 + (n10 - n00) * u;
  const bot = n01 + (n11 - n01) * u;
  // the theoretical range of 2D Perlin noise is ±√2/2; rescale to ≈ ±1
  return (top + (bot - top) * v) * Math.SQRT2;
}

/** 1D gradient noise in ≈ [−1, 1] (meander curves, profiles). */
export function noise1(seed: number, x: number): number {
  const ix = Math.floor(x);
  const f = x - ix;
  const g0 = hash1(seed, ix) * 2 - 1;
  const g1 = hash1(seed, ix + 1) * 2 - 1;
  const n0 = g0 * f;
  const n1 = g1 * (f - 1);
  return (n0 + (n1 - n0) * fade(f)) * 2;
}

export interface FbmOptions {
  octaves?: number;
  /** frequency multiplier per octave (default 2) */
  lacunarity?: number;
  /** amplitude multiplier per octave (default 0.5) */
  gain?: number;
  /** base noise (default gradient) */
  basis?: 'gradient' | 'value';
}

/** Per-octave seed and lattice shift so octaves are uncorrelated and lattices don't align. */
const octaveSeed = (seed: number, o: number): number => (seed + Math.imul(o + 1, 0x9e3779b1)) >>> 0;
const SHIFT_X = [0, 17.31, -41.7, 73.13, -5.97, 29.41, -61.3, 11.11, 47.9, -23.3];
const SHIFT_Z = [0, -9.67, 33.29, -12.51, 58.07, -44.4, 7.77, 81.9, -30.3, 19.7];

/** Fractional Brownian motion: sum of octaves, normalised to ≈ [−1, 1]. */
export function fbm2(seed: number, x: number, z: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 5;
  const lac = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  const basis = opts.basis === 'value' ? valueNoise2 : gradientNoise2;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * basis(octaveSeed(seed, o), x * freq + (SHIFT_X[o % 10] ?? 0), z * freq + (SHIFT_Z[o % 10] ?? 0));
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/** 1D fBm in ≈ [−1, 1]. */
export function fbm1(seed: number, x: number, octaves = 4, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * noise1(octaveSeed(seed, o), x * freq + (SHIFT_X[o % 10] ?? 0));
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Ridged multifractal (Musgrave): sharp crests from 1 − |noise|, with each octave weighted by
 * the previous one so ridges stay crisp while valleys stay smooth. Result in [0, 1].
 */
export function ridged2(seed: number, x: number, z: number, opts: FbmOptions = {}): number {
  const octaves = opts.octaves ?? 5;
  const lac = opts.lacunarity ?? 2;
  const gain = opts.gain ?? 0.5;
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o += 1) {
    let n = 1 - Math.abs(gradientNoise2(octaveSeed(seed, o), x * freq + (SHIFT_X[o % 10] ?? 0), z * freq + (SHIFT_Z[o % 10] ?? 0)));
    n = n < 0 ? 0 : n * n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

/** Deterministic uniform in [0, 1) for an integer key tuple (thin re-export for convenience). */
export const hash01 = hashNoise;
