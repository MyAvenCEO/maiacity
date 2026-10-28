/**
 * Base terrain generator — a PURE function of (seed, terrainSettings, soilClasses).
 *
 * Target landscape: central German hill country (Mittelgebirgsvorland, e.g. Hessian or
 * Thuringian loess hills): broad rolling hills with ~20–60 m of relief, convex loess-covered
 * plateaus, a flat-floored valley (Sohlental) whose meadow floor is 80–160 m wide, a small
 * creek (Bach, 1.5–3.5 m wide, 0.3–0.6 m deep) meandering on it with a gradient of a few per
 * mille, and optionally a pond (Dorf-/Fischteich) in a hollow.
 *
 * Pipeline (each step deterministic, no RNG state — only `hashNoise`-based fields):
 *  1. valley axis + centreline   random orientation and down-valley direction
 *  2. relief                     fBm hills (+ ridged component with hilliness) faded out
 *                                towards the valley floor, plus a down-valley floor gradient
 *                                and metre-scale micro relief; rescaled to exactly `relief`
 *  3. creek                      meandering centreline on the valley floor, water levels
 *                                strictly decreasing downstream, channel and banks carved
 *  4. pond                       best hollow among candidates, basin carved below its rim
 *  5. soil columns               topsoil / subsoil(s) / rock by landscape position (catena)
 *
 * Heights are stored as Float32 (mm precision is ample at ≤ 2000 m a.s.l.).
 */
import { hash32, hashNoise } from '../../kernel/src/index.ts';
import {
  clamp,
  clamp01,
  containsXZ,
  cumulativeLengths,
  fbm1,
  fbm2,
  gridBounds,
  lerp,
  pointSegment,
  polygonBounds,
  ridged2,
  sampleBilinear,
  segmentHash,
  smoothstep,
  type Bounds,
  type GridSpec,
  type SpatialHash,
  type Vec2,
} from '../../geo/src/index.ts';
import type { SoilClass, TerrainSettings, WaterBody } from './contract.ts';
import { resolveSoilRoles, type Landscape, type SoilRoles } from './soils.ts';

export const NO_CLASS = 255;
/** Thickness reported for the rock layer: the "depth limit" of a soil column. */
export const ROCK_LAYER_THICKNESS = 20;

export interface CreekGeometry {
  points: Vec2[];
  cum: number[];
  widths: number[];
  /** water surface per point, strictly decreasing downstream */
  levels: number[];
  /** water depth at the thalweg per point */
  depths: number[];
  hash: SpatialHash<number>;
  maxHalfWidth: number;
}

export interface PondGeometry {
  outline: Vec2[];
  /** its level when the world is made: the water table there */
  level: number;
  /** the lowest point of its rim: above it, it overflows */
  rim: number;
  depth: number;
  bounds: Bounds;
  centre: Vec2;
}

export interface BaseSoil {
  roles: SoilRoles;
  /** topsoil thickness (m) per vertex */
  topsoil: Float32Array;
  /** first subsoil class index and thickness */
  sub1: Uint8Array;
  sub1Thick: Float32Array;
  /** optional second subsoil (NO_CLASS = none), extends to rock */
  sub2: Uint8Array;
  /** depth to rock below original surface (m) */
  rockDepth: Float32Array;
  /** landscape position per vertex (index into LANDSCAPE_CODES) */
  landscape: Uint8Array;
}

export const LANDSCAPE_CODES: readonly Landscape[] = ['upland', 'slope', 'valleyFloor', 'waterside'];

export interface BaseTerrain {
  key: string;
  grid: GridSpec;
  bounds: Bounds;
  /** original (virgin) surface, row-major vertices */
  heights: Float32Array;
  minHeight: number;
  maxHeight: number;
  /** 1 on the valley floor … 0 on the uplands */
  valleyness: Float32Array;
  /** distance to the creek centreline (m), Infinity beyond 150 m or without creek */
  creekDist: Float32Array;
  creek?: CreekGeometry;
  pond?: PondGeometry;
  water: WaterBody[];
  soil: BaseSoil;
}

const CREEK_REACH = 150;

/** Nearest creek segment within maxD (or undefined). */
export function creekNearest(c: CreekGeometry, x: number, z: number, maxD: number): { d: number; seg: number; t: number } | undefined {
  let best: { d: number; seg: number; t: number } | undefined;
  for (const k of c.hash.queryRadius(x, z, maxD)) {
    const r = pointSegment([x, z], c.points[k]!, c.points[k + 1]!);
    if (r.d <= maxD && (!best || r.d < best.d)) best = { d: r.d, seg: k, t: r.t };
  }
  return best;
}

export const creekValue = (arr: readonly number[], seg: number, t: number): number => lerp(arr[seg]!, arr[seg + 1]!, t);

/** Distance from a point to a closed polygon outline. */
export function outlineDistance(poly: readonly Vec2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) d = Math.min(d, pointSegment([x, z], poly[j]!, poly[i]!).d);
  return d;
}

const memo = new Map<string, BaseTerrain>();

/** Memoised `generateTerrain` (derived data only — safe to share between runtimes). */
export function baseTerrain(seed: number, settings: TerrainSettings, soilClasses: Record<string, SoilClass>): BaseTerrain {
  const key = `${seed >>> 0}|${JSON.stringify(settings)}|${JSON.stringify(soilClasses)}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const t = generateTerrain(seed, settings, soilClasses, key);
  memo.set(key, t);
  if (memo.size > 6) memo.delete(memo.keys().next().value!);
  return t;
}

export function generateTerrain(seed: number, settings: TerrainSettings, soilClasses: Record<string, SoilClass>, key = ''): BaseTerrain {
  const sizeX = settings.sizeX.value;
  const sizeZ = settings.sizeZ.value;
  const cell = settings.cellSize.value;
  if (!(sizeX > 0 && sizeZ > 0 && cell > 0)) throw new Error('terrainSettings: sizes and cellSize must be > 0');
  if (sizeX / cell > 4096 || sizeZ / cell > 4096) throw new Error('terrainSettings: grid larger than 4097² vertices');
  const nx = Math.round(sizeX / cell) + 1;
  const nz = Math.round(sizeZ / cell) + 1;
  const grid: GridSpec = { x0: -sizeX / 2, z0: -sizeZ / 2, cell, nx, nz };
  const bounds = gridBounds(grid);
  const n = nx * nz;
  const roles = resolveSoilRoles(settings, soilClasses);

  const base = settings.baseElevation.value;
  const R = Math.max(0, settings.relief.value);
  const hil = settings.hilliness;
  const minSize = Math.min(sizeX, sizeZ);
  const seedT = (hash32('terrain') ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0;
  const S = (k: number): number => (seedT + Math.imul(k, 0x632be5ab)) >>> 0;
  const h01 = (k: number, ...c: number[]): number => hashNoise(S(k), ...c);

  // ---------------------------------------------------------------- 1. valley frame
  const theta = h01(1, 0) * Math.PI;
  const ax: Vec2 = [Math.cos(theta), Math.sin(theta)]; // along-valley axis
  const px: Vec2 = [-ax[1], ax[0]]; // across-valley axis
  const flow = h01(1, 1) < 0.5 ? 1 : -1; // downstream = flow · ax
  const U = Math.abs(ax[0]) * (sizeX / 2) + Math.abs(ax[1]) * (sizeZ / 2);
  const vOff = (h01(1, 2) - 0.5) * 0.3 * minSize;
  const valleyCentre = (u: number): number => vOff + 0.16 * minSize * fbm1(S(2), u / 850, 3);
  /** valley floor half-width and side-slope width (m): broader, gentler valleys in flat country */
  const wf = 40 + 40 * (1 - hil);
  const ws = 220 + 200 * (1 - hil);
  /** valley floor gradient: 0.4–0.8 % — typical of small central German creeks (Bäche) */
  const gFloor = 0.004 + 0.004 * hil;

  // ---------------------------------------------------------------- 2. relief
  const raw = new Float64Array(n);
  const valleyness = new Float32Array(n);
  const lambda = 700 - 250 * hil; // dominant hill wavelength (m)
  const gain = 0.45 + 0.12 * hil;
  for (let j = 0; j < nz; j += 1) {
    const z = grid.z0 + j * cell;
    for (let i = 0; i < nx; i += 1) {
      const x = grid.x0 + i * cell;
      const u = x * ax[0] + z * ax[1];
      const v = x * px[0] + z * px[1];
      const d = Math.abs(v - valleyCentre(u)) + 25 * fbm2(S(3), x / 180, z / 180, { octaves: 2 });
      const up = smoothstep(wf, wf + ws, d); // 0 on the floor → 1 on the uplands
      const hills01 = 0.5 + 0.5 * fbm2(S(4), x / lambda, z / lambda, { octaves: 6, gain });
      const ridge = hil > 0 ? ridged2(S(5), x / (lambda * 1.3), z / (lambda * 1.3), { octaves: 4 }) : 0;
      const hills = (1 - 0.4 * hil) * hills01 + 0.4 * hil * ridge;
      const micro = 0.5 * fbm2(S(6), x / 45, z / 45, { octaves: 3 }) * (0.4 + 0.6 * up);
      const k = j * nx + i;
      raw[k] = R * (up * hills + (1 - up) * 0.06 * hills) - gFloor * flow * u + micro;
      valleyness[k] = 1 - up;
    }
  }
  let rmin = Infinity;
  let rmax = -Infinity;
  for (let k = 0; k < n; k += 1) {
    rmin = Math.min(rmin, raw[k]!);
    rmax = Math.max(rmax, raw[k]!);
  }
  const heights = new Float32Array(n);
  const scale = rmax - rmin > 1e-9 ? R / (rmax - rmin) : 0;
  for (let k = 0; k < n; k += 1) heights[k] = base + (raw[k]! - rmin) * scale;

  // ---------------------------------------------------------------- 3. creek
  const creekDist = new Float32Array(n).fill(Infinity);
  const creekSeg = new Int32Array(n).fill(-1);
  const creekT = new Float32Array(n);
  let creek: CreekGeometry | undefined;
  if (settings.creek) {
    creek = buildCreek();
    carveCreek(creek);
  }

  function buildCreek(): CreekGeometry {
    const step = 6;
    const ext = U + 40;
    const am = Math.min(0.6 * wf, 30); // meander amplitude stays on the valley floor
    const inside: Vec2[][] = [[]];
    for (let s = -ext; s <= ext; s += step) {
      const u = flow * s; // upstream → downstream
      const v = valleyCentre(u) + am * fbm1(S(7), u / 110, 3);
      const p: Vec2 = [u * ax[0] + v * px[0], u * ax[1] + v * px[1]];
      const pad = 12;
      const isIn = p[0] >= bounds.x0 - pad && p[0] <= bounds.x1 + pad && p[1] >= bounds.z0 - pad && p[1] <= bounds.z1 + pad;
      if (isIn) inside[inside.length - 1]!.push(p);
      else if (inside[inside.length - 1]!.length) inside.push([]);
    }
    const points = inside.reduce((a, b) => (b.length > a.length ? b : a), []);
    if (points.length < 2) throw new Error('terrain: creek does not cross the map');
    const cum = cumulativeLengths(points);
    const L = cum[cum.length - 1]!;
    const widths: number[] = [];
    const depths: number[] = [];
    const levels: number[] = [];
    // Water levels: follow the floor ~0.6–0.9 m below the bank (typical incision of a
    // meadow creek), never rising downstream (minimum fall 0.5 ‰ so the creek always flows).
    let prev = Infinity;
    for (let k = 0; k < points.length; k += 1) {
      const f = cum[k]! / L;
      widths.push(1.6 + 1.6 * f + 0.4 * fbm1(S(8), cum[k]! / 60, 2));
      depths.push(0.25 + 0.3 * f);
      const ground = sampleBilinear(grid, heights, points[k]![0], points[k]![1]);
      const bank = 0.6 + 0.3 * f;
      const ds = k > 0 ? cum[k]! - cum[k - 1]! : 0;
      const level = Math.min(prev - 0.0005 * ds, ground - bank);
      levels.push(level);
      prev = level;
    }
    let maxHalfWidth = 0;
    for (const w of widths) maxHalfWidth = Math.max(maxHalfWidth, w / 2);
    return { points, cum, widths, levels, depths, hash: segmentHash(points, 24), maxHalfWidth };
  }

  function carveCreek(c: CreekGeometry): void {
    const seg = creekSeg;
    const segT = creekT;
    for (let k = 0; k < c.points.length - 1; k += 1) {
      const a = c.points[k]!;
      const b = c.points[k + 1]!;
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - CREEK_REACH - grid.x0) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + CREEK_REACH - grid.x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - CREEK_REACH - grid.z0) / cell));
      const j1 = Math.min(nz - 1, Math.ceil((Math.max(a[1], b[1]) + CREEK_REACH - grid.z0) / cell));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const r = pointSegment([grid.x0 + i * cell, grid.z0 + j * cell], a, b);
          const idx = j * nx + i;
          if (r.d < CREEK_REACH && r.d < creekDist[idx]!) {
            creekDist[idx] = r.d;
            seg[idx] = k;
            segT[idx] = r.t;
          }
        }
      }
    }
    // Channel: every vertex within half a cell beyond the water's edge is lowered to a
    // parabolic bed so that the 4 m grid resolves a continuous channel; banks (6 m) blend
    // from just above water level back to the original surface. Carving only ever lowers.
    const bankW = 6;
    for (let idx = 0; idx < n; idx += 1) {
      const k = seg[idx]!;
      if (k < 0) continue;
      const d = creekDist[idx]!;
      const t = segT[idx]!;
      const hw = creekValue(c.widths, k, t) / 2;
      const level = creekValue(c.levels, k, t);
      const bed = level - creekValue(c.depths, k, t);
      const inner = hw + 0.5 * cell;
      let target: number;
      if (d <= inner) target = bed + (level - bed) * 0.6 * (d / inner) ** 2;
      else if (d <= inner + bankW) target = lerp(level + 0.15, heights[idx]!, smoothstep(inner, inner + bankW, d));
      else continue;
      if (target < heights[idx]!) heights[idx] = target;
    }
  }

  // ---------------------------------------------------------------- 4. pond
  let pond: PondGeometry | undefined;
  if (settings.pond) pond = buildPond();

  function buildPond(): PondGeometry | undefined {
    const margin = Math.min(150, minSize * 0.2);
    let best: { score: number; c: Vec2; r: number } | undefined;
    for (let k = 0; k < 80; k += 1) {
      const c: Vec2 = [bounds.x0 + margin + h01(9, k, 0) * (sizeX - 2 * margin), bounds.z0 + margin + h01(9, k, 1) * (sizeZ - 2 * margin)];
      const r = 16 + 14 * h01(9, k, 2); // 800–2800 m² open water: a typical village/fish pond
      if (creek && creekNearest(creek, c[0], c[1], r * 1.8 + 25)) continue;
      const hc = sampleBilinear(grid, heights, c[0], c[1]);
      let lo = Infinity;
      let hi = -Infinity;
      for (let a = 0; a < 12; a += 1) {
        const ang = (a / 12) * 2 * Math.PI;
        const h = sampleBilinear(grid, heights, c[0] + Math.cos(ang) * r, c[1] + Math.sin(ang) * r);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      // prefer low, enclosed, gently sloping sites (hollows on or beside the valley floor)
      const rel = R > 0 ? R : 1;
      const enclosed = Math.max(0, hc - lo); // centre above the lowest rim point = no hollow
      const score = (hc - base) / rel + (2 * (hi - lo)) / rel + (3 * enclosed) / rel;
      if (!best || score < best.score) best = { score, c, r };
    }
    if (!best) return undefined;
    const { c, r } = best;
    const phi = h01(10, 0) * Math.PI;
    const elong = 1.15 + 0.25 * h01(10, 1);
    const outline: Vec2[] = [];
    const nv = 28;
    for (let k = 0; k < nv; k += 1) {
      const ang = (k / nv) * 2 * Math.PI;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const rr = r * (1 + 0.18 * fbm2(S(11), ca * 1.2, sa * 1.2, { octaves: 2 }));
      const lx = rr * elong * ca;
      const lz = (rr / elong) * sa;
      outline.push([c[0] + lx * Math.cos(phi) - lz * Math.sin(phi), c[1] + lx * Math.sin(phi) + lz * Math.cos(phi)]);
    }
    let rim = Infinity;
    for (let k = 0; k < nv; k += 1) {
      const a = outline[k]!;
      const b = outline[(k + 1) % nv]!;
      rim = Math.min(rim, sampleBilinear(grid, heights, a[0], a[1]), sampleBilinear(grid, heights, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
    }
    const level = rim - 0.25; // freeboard below the lowest rim point
    const depth = 1.5 + 0.6 * h01(10, 2); // fish ponds are typically 1–2 m deep
    const pb = polygonBounds(outline);
    const bankW = 8;
    const i0 = Math.max(0, Math.floor((pb.x0 - bankW - grid.x0) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((pb.x1 + bankW - grid.x0) / cell));
    const j0 = Math.max(0, Math.floor((pb.z0 - bankW - grid.z0) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((pb.z1 + bankW - grid.z0) / cell));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const x = grid.x0 + i * cell;
        const z = grid.z0 + j * cell;
        const idx = j * nx + i;
        const dEdge = outlineDistance(outline, x, z);
        let target: number;
        if (containsXZ(outline, x, z)) target = level - (0.25 + (depth - 0.25) * smoothstep(0, 0.6 * r, dEdge));
        else if (dEdge < bankW) target = lerp(level + 0.2, heights[idx]!, smoothstep(0, bankW, dEdge));
        else continue;
        if (target < heights[idx]!) heights[idx] = target;
      }
    }
    return { outline, level, rim, depth, bounds: pb, centre: c };
  }

  // ---------------------------------------------------------------- 5. soil columns
  const soil = buildSoil();
  function buildSoil(): BaseSoil {
    const topsoil = new Float32Array(n);
    const sub1 = new Uint8Array(n);
    const sub1Thick = new Float32Array(n);
    const sub2 = new Uint8Array(n).fill(NO_CLASS);
    const rockDepth = new Float32Array(n);
    const landscape = new Uint8Array(n);
    const td0 = settings.soil.topsoilDepth.value;
    const rd0 = settings.soil.rockDepth.value;
    const waterside = roles.byLandscape.waterside;
    for (let j = 0; j < nz; j += 1) {
      const z = grid.z0 + j * cell;
      for (let i = 0; i < nx; i += 1) {
        const x = grid.x0 + i * cell;
        const idx = j * nx + i;
        const h = heights[idx]!;
        // slope from central differences on the base surface
        const hxm = heights[idx - (i > 0 ? 1 : 0)]!;
        const hxp = heights[idx + (i < nx - 1 ? 1 : 0)]!;
        const hzm = heights[idx - (j > 0 ? nx : 0)]!;
        const hzp = heights[idx + (j < nz - 1 ? nx : 0)]!;
        const slope = Math.hypot((hxp - hxm) / (cell * (i > 0 && i < nx - 1 ? 2 : 1)), (hzp - hzm) / (cell * (j > 0 && j < nz - 1 ? 2 : 1)));
        const vf = valleyness[idx]!;
        const cd = creekDist[idx]!;
        const nA = 0.5 + 0.5 * fbm2(S(12), x / 140, z / 140, { octaves: 3 });
        const nB = 0.5 + 0.5 * fbm2(S(13), x / 180, z / 180, { octaves: 2 });
        const nC = 0.5 + 0.5 * fbm2(S(14), x / 220, z / 220, { octaves: 3 });
        // landscape position (thresholds jittered by noise so unit boundaries are irregular)
        let lc: Landscape;
        if (creek && cd < 8 + 14 * nA) lc = 'waterside'; // sand/gravel bars and banks
        else if (vf > 0.7 + 0.2 * nB || (creek && cd < 60 && h - nearestLevel(idx) < 1.2)) lc = 'valleyFloor';
        else if (slope > 0.08 + 0.04 * nA) lc = 'slope';
        else lc = 'upland';
        landscape[idx] = LANDSCAPE_CODES.indexOf(lc);
        const cands = roles.byLandscape[lc];
        const cls = cands[Math.min(cands.length - 1, Math.floor(nB * cands.length))]!;
        // Topsoil (Oberboden/Mutterboden): thicker in hollows and on the floor (colluvium),
        // thinner on steep slopes and crests; 0.65–1.65 × the configured depth (0.2–0.5 m at 0.3).
        const td = clamp(td0 * (0.8 + 0.5 * nC) + 0.1 * vf * td0 - 1.2 * Math.max(0, slope - 0.06) * td0, 0.65 * td0, 1.65 * td0);
        // Depth to rock: shallower on high ground and steep slopes (erosion), deeper under the
        // valley floor where alluvium has accumulated.
        const hn = R > 0 ? (h - base) / R : 0;
        let rd = rd0 * (0.6 + 0.8 * nA) * (1 - 0.35 * clamp01(hn)) * (1 - Math.min(0.5, 2.5 * slope)) + 2 * vf * (creek ? 1 : 0.5);
        rd = clamp(rd, td + 0.5, 3 * rd0 + 3);
        topsoil[idx] = td;
        rockDepth[idx] = rd;
        sub1[idx] = cls;
        let thick = rd - td;
        // valley floor: fine alluvial loam/clay (Auelehm, 0.8–2.2 m) over creek gravel
        if (lc === 'valleyFloor' && waterside.length && !waterside.includes(cls)) {
          const t1 = 0.8 + 1.4 * nC;
          if (rd - td > t1 + 0.2) {
            thick = t1;
            sub2[idx] = waterside[0]!;
          }
        }
        sub1Thick[idx] = thick;
      }
    }
    return { roles, topsoil, sub1, sub1Thick, sub2, rockDepth, landscape };

    function nearestLevel(idx: number): number {
      const k = creekSeg[idx]!;
      return creek && k >= 0 ? creekValue(creek.levels, k, creekT[idx]!) : -Infinity;
    }
  }

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let k = 0; k < n; k += 1) {
    minHeight = Math.min(minHeight, heights[k]!);
    maxHeight = Math.max(maxHeight, heights[k]!);
  }

  const water: WaterBody[] = [];
  if (creek) water.push({ id: 'creek', kind: 'creek', points: creek.points, widths: creek.widths, levels: creek.levels });
  if (pond) water.push({ id: 'pond', kind: 'pond', points: pond.outline, levels: [pond.level] });

  return { key, grid, bounds, heights, minHeight, maxHeight, valleyness, creekDist, creek, pond, water, soil };
}
