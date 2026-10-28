/**
 * Deterministic random streams.
 *
 * Every consumer draws from a *named* stream derived from the master seed, so adding
 * a new model (or a new draw in one model) never perturbs another model's sequence.
 * Stream state is plain data and lives in the snapshot.
 */

/** 32-bit FNV-1a hash of a string. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 — used to expand seeds into generator state. */
function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/** sfc32 generator state: four uint32 words. */
export type RngState = [number, number, number, number];

export function seedState(masterSeed: number, stream: string): RngState {
  const mix = splitmix32((masterSeed >>> 0) ^ hash32(stream));
  const state: RngState = [mix(), mix(), mix(), mix()];
  // warm up
  const rng = new Rng(state);
  for (let i = 0; i < 12; i += 1) rng.nextU32();
  return rng.state;
}

export class Rng {
  constructor(public state: RngState) {}

  nextU32(): number {
    let [a, b, c, d] = this.state;
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.state = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Standard normal via Box–Muller (consumes two draws). */
  normal(mean = 0, sd = 1): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  exponential(mean: number): number {
    return -mean * Math.log(1 - this.next());
  }

  /** Gamma(shape k, scale θ) — Marsaglia–Tsang. */
  gamma(shape: number, scale: number): number {
    if (shape < 1) {
      const u = Math.max(this.next(), 1e-12);
      return this.gamma(shape + 1, scale) * u ** (1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4) return d * v * scale;
      if (Math.log(Math.max(u, 1e-300)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }
}

/** Stateless deterministic noise in [0,1) from integer coordinates — for derived (non-snapshotted) fields. */
export function hashNoise(seed: number, ...coords: number[]): number {
  let h = seed >>> 0;
  for (const c of coords) {
    h ^= Math.imul((c | 0) ^ 0x27d4eb2d, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** the standard normal distribution function Φ(x) (Abramowitz & Stegun 7.1.26, error below 1.5e-7) */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/**
 * Someone whose highest price is log-normal around a value (spread: σ of its log) takes an ask
 * with this probability; the expected wait for a taker is the mean wait for someone over it.
 */
export function shareWillingToPay(ask: number, value: number, spread: number): number {
  if (!(spread > 0)) return ask <= value ? 1 : 0;
  return 1 - normalCdf(Math.log(Math.max(1e-9, ask) / Math.max(1e-9, value)) / spread);
}
