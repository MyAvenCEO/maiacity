/**
 * Palette and colour ramps shared by the renderer (and usable by the UI for legends).
 */
import { Color } from 'three';

/** Viridis-like ramp (t in 0..1) → sRGB 0..255 */
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

export function viridis(t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i]!;
  const b = VIRIDIS[i + 1]!;
  out[0] = a[0] + (b[0] - a[0]) * f;
  out[1] = a[1] + (b[1] - a[1]) * f;
  out[2] = a[2] + (b[2] - a[2]) * f;
  return out;
}

/** Categorical palette for class overlays (soil) — distinguishable, earthy-but-clear. */
export const CATEGORICAL = ['#e6a141', '#4e9bd6', '#7cbf5a', '#d1495b', '#9b6fd1', '#3fb8af', '#f2d15c', '#c97b4a', '#8a8f99', '#e377c2'];

/** Overlay colour for a value in a layer (sRGB 0..255, alpha 0..255). Exported for UI legends. */
export function overlayRgba(layer: string, value: number, min: number, max: number, out: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] {
  if (!Number.isFinite(value)) {
    // a goal rules the place out: grey; other layers have no data there: transparent
    if (layer.startsWith('goal:') && Number.isNaN(value)) {
      out[0] = out[1] = out[2] = 110;
      out[3] = 255;
    } else out[0] = out[1] = out[2] = out[3] = 0;
    return out;
  }
  if (layer === 'soil') {
    const hex = CATEGORICAL[Math.max(0, Math.round(value)) % CATEGORICAL.length]!;
    const n = parseInt(hex.slice(1), 16);
    out[0] = (n >> 16) & 255;
    out[1] = (n >> 8) & 255;
    out[2] = n & 255;
    out[3] = 255;
    return out;
  }
  const t = max > min ? (value - min) / (max - min) : 0;
  if (layer.startsWith('goal:')) {
    // suitability: red (poor) → yellow → green (good)
    const stops: [number, number, number][] = [[198, 40, 40], [250, 215, 60], [46, 160, 67]];
    const x = Math.max(0, Math.min(1, t)) * 2;
    const a = stops[Math.min(1, Math.floor(x))]!;
    const b = stops[Math.min(2, Math.floor(x) + 1)]!;
    const f = x - Math.min(1, Math.floor(x));
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = a[2] + (b[2] - a[2]) * f;
    out[3] = 255;
    return out;
  }
  const rgb = viridis(t);
  out[0] = rgb[0];
  out[1] = rgb[1];
  out[2] = rgb[2];
  out[3] = layer === 'frost' && value <= 0.001 ? 0 : 255;
  return out;
}

/** ZEB condition grade 1.0 (very good) … 5.0 (very poor) → colour */
export function gradeColor(grade: number, out = new Color()): Color {
  const stops: [number, string][] = [
    [1.0, '#2e9e4f'],
    [2.0, '#8cc63f'],
    [3.0, '#f2c230'],
    [4.0, '#ef7d22'],
    [5.0, '#d7263d'],
  ];
  const g = Math.min(5, Math.max(1, grade));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [g0, c0] = stops[i]!;
    const [g1, c1] = stops[i + 1]!;
    if (g <= g1) {
      const f = (g - g0) / (g1 - g0);
      return out.set(c0).lerp(_tmp.set(c1), f);
    }
  }
  return out.set(stops[stops.length - 1]![1]);
}
const _tmp = new Color();

export const PALETTE = {
  asphalt: '#48494c',
  asphaltBase: '#5a5856',
  gravelGrey: '#a49d8f',
  crushedStone: '#b0a898',
  wearing: '#bba887',
  formation: '#9d8262',
  subgrade: '#a88f6d',
  stripped: '#6b5541',
  disturbed: '#5d4935',
  shoulder: '#9d9479',
  verge: '#7b7560',
  marking: '#f1f0ea',
  stakePost: '#d8c39a',
  stakeCap: '#e0402c',
  water: '#3e6f78',
  waterDeep: '#2a4f5c',
  plinthTop: '#4e3d2c',
  plinthMid: '#8a6d4c',
  plinthRock: '#6f5444',
};

/** sRGB hex → linear Color (three's working space) */
export function col(hex: string): Color {
  return new Color(hex);
}

/** deterministic hash → 0..1 */
export function hash2(x: number, z: number): number {
  let h = Math.imul((x * 73856093) | 0, 0x9e3779b1) ^ Math.imul((z * 19349663) | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
}
