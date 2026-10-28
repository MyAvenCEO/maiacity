/**
 * Physical units with explicit dimensions.
 *
 * Every quantity that crosses a module boundary (data packs, component schemas,
 * commands, ledgers, explain traces) declares its unit. Conversion is explicit:
 * `convert(value, from, to)` throws when dimensions differ, so "kg treated as t"
 * or "kW treated as kWh" fails loudly instead of silently.
 *
 * Unit strings are compositional: `m3/h`, `EUR/t`, `t/m3`, `kWh/(m2·a)` is written
 * `kWh/m2/a`, `l/h`, `km/h`, `veh/d`. Tokens may carry an integer exponent suffix
 * (`m2`, `s2`). `/` divides everything that follows it once (`a/b/c` = a/(b·c)),
 * `·` or `*` multiplies.
 */

/** Dimension exponents: length, mass, time, temperature, currency, count, luminous intensity (cd). */
export type Dimension = readonly [number, number, number, number, number, number, number];

interface BaseUnit {
  readonly factor: number; // multiply to get SI-ish base (m, kg, s, K, EUR, 1)
  readonly dim: Dimension;
  readonly offset?: number; // affine units (°C) — only valid standalone
}

const D = (l = 0, m = 0, t = 0, k = 0, c = 0, n = 0, j = 0): Dimension => [l, m, t, k, c, n, j];

const BASE: Record<string, BaseUnit> = {
  // dimensionless / counts
  '1': { factor: 1, dim: D() },
  '%': { factor: 0.01, dim: D() },
  permille: { factor: 0.001, dim: D() },
  rad: { factor: 1, dim: D() },
  deg: { factor: Math.PI / 180, dim: D() },
  pcs: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) },
  veh: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) },
  person: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) },
  trip: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) },
  tree: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) },
  esal: { factor: 1, dim: D(0, 0, 0, 0, 0, 1) }, // equivalent 10-t standard axle passes
  // length
  mm: { factor: 0.001, dim: D(1) },
  cm: { factor: 0.01, dim: D(1) },
  m: { factor: 1, dim: D(1) },
  km: { factor: 1000, dim: D(1) },
  // area / volume shortcuts
  ha: { factor: 10_000, dim: D(2) },
  l: { factor: 0.001, dim: D(3) },
  // mass
  g: { factor: 0.001, dim: D(0, 1) },
  kg: { factor: 1, dim: D(0, 1) },
  t: { factor: 1000, dim: D(0, 1) },
  // time
  s: { factor: 1, dim: D(0, 0, 1) },
  min: { factor: 60, dim: D(0, 0, 1) },
  h: { factor: 3600, dim: D(0, 0, 1) },
  d: { factor: 86_400, dim: D(0, 0, 1) },
  wk: { factor: 604_800, dim: D(0, 0, 1) },
  mo: { factor: 2_629_800, dim: D(0, 0, 1) }, // mean month = 365.25/12 d
  a: { factor: 31_557_600, dim: D(0, 0, 1) }, // Julian year
  // temperature
  K: { factor: 1, dim: D(0, 0, 0, 1) },
  degC: { factor: 1, dim: D(0, 0, 0, 1), offset: 273.15 },
  '°C': { factor: 1, dim: D(0, 0, 0, 1), offset: 273.15 },
  Kd: { factor: 86_400, dim: D(0, 0, 1, 1) }, // degree-days
  // currency
  EUR: { factor: 1, dim: D(0, 0, 0, 0, 1) },
  ct: { factor: 0.01, dim: D(0, 0, 0, 0, 1) },
  kEUR: { factor: 1000, dim: D(0, 0, 0, 0, 1) },
  // energy / power (J = kg m2 s-2)
  J: { factor: 1, dim: D(2, 1, -2) },
  kJ: { factor: 1e3, dim: D(2, 1, -2) },
  MJ: { factor: 1e6, dim: D(2, 1, -2) },
  Wh: { factor: 3600, dim: D(2, 1, -2) },
  kWh: { factor: 3.6e6, dim: D(2, 1, -2) },
  kcal: { factor: 4184, dim: D(2, 1, -2) }, // food energy (thermochemical kilocalorie)
  MWh: { factor: 3.6e9, dim: D(2, 1, -2) },
  W: { factor: 1, dim: D(2, 1, -3) },
  kW: { factor: 1e3, dim: D(2, 1, -3) },
  MW: { factor: 1e6, dim: D(2, 1, -3) },
  // light (photometric: the lumen is a candela over a steradian, the lux a lumen per m²)
  cd: { factor: 1, dim: D(0, 0, 0, 0, 0, 0, 1) },
  lm: { factor: 1, dim: D(0, 0, 0, 0, 0, 0, 1) },
  lx: { factor: 1, dim: D(-2, 0, 0, 0, 0, 0, 1) },
  // force / pressure
  N: { factor: 1, dim: D(1, 1, -2) },
  kN: { factor: 1e3, dim: D(1, 1, -2) },
  Pa: { factor: 1, dim: D(-1, 1, -2) },
  kPa: { factor: 1e3, dim: D(-1, 1, -2) },
  MPa: { factor: 1e6, dim: D(-1, 1, -2) },
  MN: { factor: 1e6, dim: D(1, 1, -2) },
};

export interface ParsedUnit {
  readonly text: string;
  readonly factor: number;
  readonly dim: Dimension;
  readonly offset: number;
}

const cache = new Map<string, ParsedUnit>();

function parseToken(token: string): { factor: number; dim: number[]; offset: number } {
  const direct = BASE[token];
  if (direct) return { factor: direct.factor, dim: [...direct.dim], offset: direct.offset ?? 0 };
  const m = /^(.*?)(-?\d+)$/.exec(token);
  if (m && m[1] && BASE[m[1]]) {
    const base = BASE[m[1]]!;
    const exp = Number(m[2]);
    if (base.offset) throw new Error(`Affine unit ${m[1]} cannot carry an exponent`);
    return { factor: base.factor ** exp, dim: base.dim.map((x) => x * exp), offset: 0 };
  }
  throw new Error(`Unknown unit token "${token}"`);
}

/** Parse a unit expression. Throws on unknown tokens. Memoized. */
export function parseUnit(text: string): ParsedUnit {
  const hit = cache.get(text);
  if (hit) return hit;
  const normalized = text.replace(/\s+/g, '').replace(/[()]/g, '');
  let factor = 1;
  const dim = [0, 0, 0, 0, 0, 0, 0];
  let offset = 0;
  let tokenCount = 0;
  const parts = normalized.split('/');
  parts.forEach((part, idx) => {
    if (part === '' && idx === 0) return;
    for (const tok of part.split(/[·*]/)) {
      if (tok === '') throw new Error(`Malformed unit "${text}"`);
      const p = parseToken(tok);
      tokenCount += 1;
      const sign = idx === 0 ? 1 : -1;
      factor *= p.factor ** sign;
      for (let i = 0; i < 7; i += 1) dim[i]! += p.dim[i]! * sign;
      if (p.offset) offset = p.offset;
    }
  });
  if (offset && tokenCount > 1) throw new Error(`Affine unit in compound expression "${text}"`);
  const parsed: ParsedUnit = { text, factor, dim: dim as unknown as Dimension, offset };
  cache.set(text, parsed);
  return parsed;
}

export function sameDimension(a: string, b: string): boolean {
  const pa = parseUnit(a);
  const pb = parseUnit(b);
  return pa.dim.every((x, i) => Math.abs(x - pb.dim[i]!) < 1e-12);
}

export function dimensionOf(unit: string): Dimension {
  return parseUnit(unit).dim;
}

export class UnitError extends Error {}

/** Convert `value` from unit `from` to unit `to`. Throws UnitError if dimensions differ. */
export function convert(value: number, from: string, to: string): number {
  if (from === to) return value;
  const a = parseUnit(from);
  const b = parseUnit(to);
  if (!a.dim.every((x, i) => Math.abs(x - b.dim[i]!) < 1e-12)) {
    throw new UnitError(`Cannot convert ${from} to ${to}: dimensions differ`);
  }
  // affine (°C <-> K) only for standalone temperature units
  const si = (value + a.offset) * a.factor;
  return si / b.factor - b.offset;
}

/** Register an extra base unit (for domain packs, e.g. 'bale'). Must not collide. */
export function registerUnit(token: string, def: { factor: number; dim: Dimension }): void {
  if (BASE[token]) throw new Error(`Unit ${token} already defined`);
  if (!/^[A-Za-z°][A-Za-z°_]*$/.test(token)) throw new Error(`Invalid unit token ${token}`);
  BASE[token] = def;
  cache.clear();
}

export const DIM = {
  none: D(),
  count: D(0, 0, 0, 0, 0, 1),
  length: D(1),
  area: D(2),
  volume: D(3),
  mass: D(0, 1),
  time: D(0, 0, 1),
  temperature: D(0, 0, 0, 1),
  currency: D(0, 0, 0, 0, 1),
  energy: D(2, 1, -2),
  power: D(2, 1, -3),
  pressure: D(-1, 1, -2),
} as const;
