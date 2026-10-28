/**
 * `network` module: owns the transport graph (NetNode / NetEdge) and provides the `routing`
 * port (nearest point on the network, fastest route per vehicle profile, ESAL per pass).
 *
 * Routing works on a derived graph (CSR adjacency + uniform-grid segment index) that is
 * rebuilt lazily whenever the NetNode / NetEdge revisions change; per-profile edge travel
 * times are memoized on top of it. Nothing derived is stored in the world state.
 */
import { command, convert, defineModule, ex, s, type EntityId, type Explained, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type {} from '../../soil/src/index.ts';
import {
  NetworkSettingsSchema,
  VehicleProfileSchema,
  type NearestResult,
  type NetEdge,
  type NetNode,
  type NetworkSettings,
  type Route,
  type RouteStretch,
  type RoutingPort,
  type VehicleProfile,
} from './contract.ts';
import { bboxOf, cumulative, dedupe, dist, polylineLength, projectOnPolyline, projectOnSegment, segmentIntersection, subPolyline } from './geom.ts';

// ------------------------------------------------------------------ schemas

const ExternalSchema = s.object({ label: s.string(), distanceKm: s.number({ min: 0, unit: 'km' }), surface: s.string().optional() });

export const NetNodeSchema = s.object({
  pos: s.point(),
  external: ExternalSchema.optional(),
});

export const NetEdgeSchema = s.object({
  a: s.ref('net-node'),
  b: s.ref('net-node'),
  mode: s.enum(['road']),
  geometry: s.array(s.point()),
  length: s.number({ min: 0, unit: 'm' }),
  open: s.boolean(),
  surface: s.string(),
  width: s.number({ min: 0, unit: 'm' }),
  speedLimit: s.number({ min: 0, unit: 'km/h' }),
  speedFactor: s.number({ min: 0, max: 1 }),
  asset: s.ref().optional(),
  label: s.string().optional(),
});

const EdgePatchSchema = s.object({
  open: s.boolean().optional(),
  surface: s.string().optional(),
  speedFactor: s.number({ min: 0, max: 1 }).optional(),
  width: s.number({ min: 0 }).optional(),
  speedLimit: s.number({ min: 0 }).optional(),
});

const NODE_KIND = 'net-node';
const EDGE_KIND = 'net-edge';
/** Default maximum off-network approach / exit leg (m). */
export const DEFAULT_MAX_OFFROAD = 400;
/** how often a way off the road is sounded for water (m) */
/** how finely a vehicle's way to as near a place as it gets is searched back towards its way in (m) */
const APPROACH_STEP = 25;
/** directions tried on each ring round a place a vehicle cannot reach */
const APPROACH_DIRS = 8;

/** within the map's bounds */
function onMapOf(ctx: ReadCtx, q: Vec2): boolean {
  const b = ctx.port('terrain').bounds;
  return q[0] >= b.x0 && q[0] <= b.x1 && q[1] >= b.z0 && q[1] <= b.z1;
}
const WADE_STEP = 4;
const WADE_FINE = 0.5;
/** the slowest pace off the ways, as a share of the off-road speed: a floor where slope, ground and trees multiply (a numeric guard) */
const MIN_PACE = 0.05;
/** the pace kept driving round a lone trunk in the way (some metres more, slowly): an estimate */
const LONE_TREE = 0.85;
/** so many trunks within some 9 m of a step off the ways (about one to 50 m²) are a stand, a wood or a hedgerow: an estimate */
const STAND_TREES = 5;
/** the clear room a vehicle needs either side of it through trees (m): an estimate */
const LANE_MARGIN = 1;
/** within so many metres of a way's line a place is on it (m) */
const ON_WAY = 3;
/** the ground off the ways is looked at every so many metres (slope, wetness, trees: design/realism-plan.md S3) */
const GROUND_STEP = 10;
const MIN_SPEED_FACTOR = 0.05;
/** stretches shorter than this (m) are dropped */
const LEG_EPS = 1e-3;

// ------------------------------------------------------------------ shared helpers

const settingsOf = (ctx: ReadCtx): NetworkSettings => ctx.data('networkSettings');

export function profileOf(ctx: ReadCtx, id: string): VehicleProfile {
  const all = ctx.data('vehicleProfiles');
  const p = Object.hasOwn(all, id) ? all[id] : undefined;
  if (!p) throw new Error(`Unknown vehicle profile "${id}"`);
  return p;
}

const isVec2 = (p: unknown): p is Vec2 => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** ESAL of one pass: Σ (axle load / reference axle load)^exponent. */
export function esalOf(profile: VehicleProfile, settings: NetworkSettings, loaded: boolean): number {
  const axles = (loaded ? profile.axleLoadsLoaded : profile.axleLoadsEmpty).values;
  const ref = settings.referenceAxleLoad.value;
  const k = settings.loadEquivalenceExponent.value;
  let sum = 0;
  for (const a of axles) sum += (a / ref) ** k;
  return sum;
}

/** Effective speed on an edge (km/h) as an explain trace: min(surface cap, limit, vehicle max) × condition. */
function edgeSpeedExplain(prof: VehicleProfile, edge: Readonly<NetEdge>): Explained {
  const surfaceParam = Object.hasOwn(prof.surfaceSpeed, edge.surface) ? prof.surfaceSpeed[edge.surface] : undefined;
  if (!surfaceParam) return ex.value(0, 'km/h', `${prof.label} cannot use ${edge.surface}`);
  const cap = ex.min(
    'speed cap',
    'km/h',
    ex.param(surfaceParam, `${prof.label} on ${edge.surface}`),
    ex.value(edge.speedLimit, 'km/h', 'speed limit'),
    ex.param(prof.maxSpeed, `${prof.label} max speed`),
  );
  const factor = Math.min(1, Math.max(MIN_SPEED_FACTOR, edge.speedFactor));
  return ex.mul('effective speed', 'km/h', cap, ex.value(factor, '', 'condition speed factor'));
}

/** the way beyond the map: a public road unless the access says otherwise */
const outsideOf = (ext: NonNullable<NetNode['external']>) => ext.surface ?? 'external';

/** can a profile go the way beyond the map (a vehicle needs road legality on public roads, and a speed on its surface) */
const canGoOutside = (prof: VehicleProfile, ext: NonNullable<NetNode['external']>) => Object.hasOwn(prof.surfaceSpeed, outsideOf(ext)) && (prof.roadLegal || outsideOf(ext) !== 'external');

function externalDurationExplain(prof: VehicleProfile, ext: NonNullable<NetNode['external']>): Explained {
  const surf = prof.surfaceSpeed[outsideOf(ext)]!;
  const speed = ex.min(
    'external road speed',
    'km/h',
    ex.param(surf, `${prof.label} on ${outsideOf(ext) === 'external' ? 'external roads' : outsideOf(ext)}`),
    ex.param(prof.maxSpeed, `${prof.label} max speed`),
  );
  return ex.div(`external: ${ext.label}`, 's', ex.value(ext.distanceKm * 1000, 'm', 'distance outside the map'), ex.convert(speed, 'm/s'));
}

function offroadExplain(prof: VehicleProfile, length: number, label: string, seconds?: number): Explained {
  const speed = ex.convert(ex.param(prof.offroadSpeed, `${prof.label} off-road speed`), 'm/s');
  const plain = length / speed.v;
  // (the ground as it is: slope, wetness, trees, as a share of the off-road speed)
  if (seconds === undefined || !(seconds > 0) || Math.abs(seconds - plain) < 1e-6) return ex.div(label, 's', ex.value(length, 'm', 'off-road distance'), speed);
  return ex.div(label, 's', ex.value(length, 'm', 'off-road distance'), ex.mul('pace over this ground', 'm/s', speed, ex.value(plain / seconds, '1', 'the ground: slope, wet or soaked soil, trees')));
}

/**
 * What the ground is at a place, the hour's: its trafficability, whether work made it firm, the trees about it. Kept per
 * world (its network) for the hour and the trees as they stand; looked up by a few metres' grid (a route asks the same
 * ground thousands of times)
 */
interface GroundCache {
  hour: number;
  /** the terrain's heights and its ponds' level (to 5 cm) as they were, and what makes ground firm */
  heights: Float32Array | undefined;
  pond: number;
  firmRev: number;
  traf: Map<number, 'good' | 'reduced' | 'none'>;
  firm: Map<number, boolean>;
  cleared: Map<number, boolean>;
  /** ways round found on this ground: profile, firm and the exact ends to the way */
  detours: Map<string, { t: number; pts: Vec2[] } | null>;
  /** the time of each step between the detour grid's points (a lattice over the world), by profile, wading and firm */
  steps: Map<string, Map<number, number>>;
  /** what does not change with the hour: the trees as they stand, the water's edges as the terrain is */
  lasting: LastingGround;
}
interface LastingGround {
  veg: number;
  heights: Float32Array | undefined;
  pond: number;
  trees: Map<number, { x: number; z: number; dbh: number }[]>;
  /** the edges of the water (a creek's centreline with its half-width, a pond's shore) by 50 m cells, made when first asked */
  water?: Map<number, { a: Vec2; b: Vec2; reach: number }[]>;
}

/** the water's edges by 50 m cell: where a line comes near one, its depth is looked at finely (a creek narrower than a step) */
function waterIndex(terrain: { waterBodies(): { kind: string; points: Vec2[]; widths?: number[] }[] }): Map<number, { a: Vec2; b: Vec2; reach: number }[]> {
  const out = new Map<number, { a: Vec2; b: Vec2; reach: number }[]>();
  for (const w of terrain.waterBodies()) {
    const pts = w.points;
    const n = w.kind === 'pond' ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      // (a creek's half-width about its line; about a shore, the step the ground is otherwise looked at by)
      const reach = (w.kind === 'creek' ? Math.max(w.widths?.[i] ?? 0, w.widths?.[i + 1] ?? 0) / 2 : 0) + WADE_STEP;
      for (let cx = Math.floor((Math.min(a[0], b[0]) - reach) / 50); cx <= Math.floor((Math.max(a[0], b[0]) + reach) / 50); cx += 1)
        for (let cz = Math.floor((Math.min(a[1], b[1]) - reach) / 50); cz <= Math.floor((Math.max(a[1], b[1]) + reach) / 50); cz += 1) {
          const k = (cx + 2048) * 4096 + (cz + 2048);
          const list = out.get(k);
          if (list) list.push({ a, b, reach });
          else out.set(k, [{ a, b, reach }]);
        }
    }
  }
  return out;
}

/** whether a line comes within an edge's reach of the water anywhere (by the cells it passes) */
function nearWater(index: Map<number, { a: Vec2; b: Vec2; reach: number }[]>, p: Vec2, q: Vec2): boolean {
  const L = dist(p, q);
  const n = Math.max(1, Math.ceil(L / 25));
  const seen = new Set<number>();
  for (let i = 0; i <= n; i += 1) {
    const x = p[0] + ((q[0] - p[0]) * i) / n;
    const z = p[1] + ((q[1] - p[1]) * i) / n;
    const k = (Math.floor(x / 50) + 2048) * 4096 + (Math.floor(z / 50) + 2048);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const e of index.get(k) ?? []) if (segmentsDistance(p, q, e.a, e.b) <= e.reach) return true;
  }
  return false;
}

/** the least distance between two segments */
function segmentsDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const cross = (o: Vec2, p: Vec2, q: Vec2) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segmentDistance(c, a, b), segmentDistance(d, a, b), segmentDistance(a, c, d), segmentDistance(b, c, d));
}
const groundCaches = new WeakMap<object, GroundCache>();
const cell = (x: number, z: number, size: number) => (Math.round(x / size) + 2048) * 4096 + (Math.round(z / size) + 2048);

/** what a route asks of the ground, gathered once: the ports, the firm ground's contributions, the hour's cache */
interface GroundEnv {
  /** where the water's edges are (see waterIndex) */
  water: () => Map<number, { a: Vec2; b: Vec2; reach: number }[]>;
  terrain: ReturnType<ReadCtx['port']> & { waterDepthAt(x: number, z: number): number; heightAt(x: number, z: number): number } | undefined;
  isFirm: (x: number, z: number) => boolean;
  isCleared: (x: number, z: number) => boolean;
  trafficability: ((x: number, z: number) => 'good' | 'reduced' | 'none') | undefined;
  treesNear: ((p: Vec2, r: number) => { x: number; z: number; dbh: number }[]) | undefined;
  /** its off-road pace in the light there is (1 by day; in the dark, the profile's: S7) */
  pace: number;
}

function groundEnv(ctx: ReadCtx, cache: GroundCache): GroundEnv {
  const terrain = ctx.hasPort('terrain') ? ctx.port('terrain') : undefined;
  const soil = ctx.hasPort('soil-state') ? ctx.port('soil-state') : undefined;
  const veg = ctx.hasPort('vegetation') ? ctx.port('vegetation') : undefined;
  const firmGround = ctx.contributions('firmGround');
  const clearedGround = ctx.contributions('clearedGround');
  return {
    pace: 1,
    water: () => (cache.lasting.water ??= terrain ? waterIndex(terrain) : new Map()),
    terrain: terrain as GroundEnv['terrain'],
    // (each looked up at its cell's centre, never at the point first asked: the answer does not depend on who asked
    // before, review S3 #3)
    isFirm: (x, z) => {
      if (!firmGround.length) return false;
      const k = cell(x, z, 4);
      let v = cache.firm.get(k);
      if (v === undefined) cache.firm.set(k, (v = firmGround.some((c) => c.impl.at(ctx, Math.round(x / 4) * 4, Math.round(z / 4) * 4))));
      return v;
    },
    isCleared: (x, z) => {
      if (!clearedGround.length) return false;
      const k = cell(x, z, 4);
      let v = cache.cleared.get(k);
      if (v === undefined) cache.cleared.set(k, (v = clearedGround.some((c) => c.impl.at(ctx, Math.round(x / 4) * 4, Math.round(z / 4) * 4))));
      return v;
    },
    trafficability: soil
      ? (x, z) => {
          const k = cell(x, z, 8);
          let v = cache.traf.get(k);
          if (v === undefined) cache.traf.set(k, (v = soil.trafficability(Math.round(x / 8) * 8, Math.round(z / 8) * 8)));
          return v;
        }
      : undefined,
    treesNear: veg
      ? (p, r) => {
          const rr = Math.ceil(r) + 3;
          const k = cell(p[0], p[1], 4) * 64 + Math.min(63, rr);
          let v = cache.lasting.trees.get(k);
          if (v === undefined) cache.lasting.trees.set(k, (v = veg.treesNear([Math.round(p[0] / 4) * 4, Math.round(p[1] / 4) * 4], rr).map((tr) => ({ x: tr.x, z: tr.z, dbh: tr.dbh }))));
          return v.filter((tr) => (tr.x - p[0]) ** 2 + (tr.z - p[1]) ** 2 <= r * r);
        }
      : undefined,
  };
}

/**
 * The time to go straight from a to b off the ways (s), over the ground as it is (design/realism-plan.md S3, audit
 * E1/E2): the profile's off-road speed, slowed by the slope (by Tobler's hiking function for one who walks; up to the
 * steepest it climbs for a vehicle), by the ground's trafficability today (a soaked loess field: no lorry) and among
 * trees; barred by a stand of trees about the line (but to one who walks between them) and by water deeper than it wades.
 * On ground made firm by work done on it (a road's formation accepted, its gravel laid) as on dry ground. `firm`: a
 * plan's estimate, the ground as if dry and the trees felled. Infinity where it cannot go.
 */
function groundTime(env: GroundEnv, prof: VehicleProfile, a: Vec2, b: Vec2, wade: number, firm = false): number {
  const L = dist(a, b);
  if (L < 1e-9) return 0;
  const offV = convert(prof.offroadSpeed.value, 'km/h', 'm/s') * env.pace;
  const terrain = env.terrain;
  if (terrain) {
    // (by the step; where the line comes near the water, every half metre: a creek is narrower than a step, review S3)
    const n = Math.max(1, Math.ceil(L / (nearWater(env.water(), a, b) ? WADE_FINE : WADE_STEP)));
    for (let i = 0; i <= n; i += 1) if (terrain.waterDepthAt(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n) > wade + 1e-3) return Infinity;
  }
  const g = prof.ground;
  if (!g || !terrain) return L / offV;
  const half = g.width.value / 2;
  const n = Math.max(1, Math.ceil(L / GROUND_STEP));
  const l = L / n;
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    const p0: Vec2 = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
    const p1: Vec2 = [a[0] + ((b[0] - a[0]) * (i + 1)) / n, a[1] + ((b[1] - a[1]) * (i + 1)) / n];
    const mid: Vec2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const grade = (terrain.heightAt(p1[0], p1[1]) - terrain.heightAt(p0[0], p0[1])) / l;
    if (Math.abs(grade) > g.maxGrade.value) return Infinity;
    // (one who walks by Tobler's hiking function, 1993; a vehicle losing its `slope` share of pace at its steepest grade)
    let f = prof.walks ? Math.exp(-3.5 * (Math.abs(grade + 0.05) - 0.05)) : 1 - (g.slope?.value ?? 0) * (Math.abs(grade) / g.maxGrade.value);
    // (on ground made firm by work done on it, a road's gravel laid: as on dry ground, the trees long felled)
    if (env.isFirm(mid[0], mid[1])) {
      t += l / (offV * Math.max(MIN_PACE, f * g.good.value));
      continue;
    }
    if (env.trafficability) {
      const share = g[firm ? 'good' : env.trafficability(mid[0], mid[1])].value;
      if (!(share > 0)) return Infinity;
      f *= share;
    }
    // (a plan's estimate does not reckon with the trees: the work fells what stands in its way first)
    if (env.treesNear && !firm) {
      const near = env.treesNear(mid, l / 2 + half + 3);
      // (a trunk in a vehicle's way it drives round, a little longer, where there is room beside it; two trunks closer
      // together than it is wide are a wall it does not pass, and a stand is many: it goes round by a detour; one who
      // walks steps round them all, review S3 #5)
      if (!prof.walks) {
        // (in a stand, so many trunks about a step with no clear lane through them, a trunk within a metre of its sides: a
        // vehicle goes among them at its share of pace in woods, a lorry not at all; an open grove with a lane through it,
        // or a corridor felled by work, is no stand, whatever stands at its edges; review S1b #6)
        if (near.length >= STAND_TREES && !env.isCleared(mid[0], mid[1]) && near.some((tr) => segmentDistance([tr.x, tr.z], p0, p1) < half + LANE_MARGIN + tr.dbh / 2)) {
          if (!(g.woods.value > 0)) return Infinity;
          f *= g.woods.value;
        }
        const inWay = near.filter((tr) => segmentDistance([tr.x, tr.z], p0, p1) < half + tr.dbh / 2);
        if (inWay.length) {
          const width = g.width.value;
          const around = env.treesNear(mid, l / 2 + half + width + 2);
          for (const a of inWay) for (const b of around) if ((b.x !== a.x || b.z !== a.z) && Math.hypot(b.x - a.x, b.z - a.z) - (a.dbh + b.dbh) / 2 < width) return Infinity;
          f *= LONE_TREE ** inWay.length;
        }
      } else if (near.length) f *= g.woods.value;
    }
    t += l / (offV * Math.max(MIN_PACE, f));
  }
  return t;
}

/** where a vehicle stands nearest a place among trees: the place, or the nearest spot within 8 m no trunk is within its half-width of */
function clearOf(env: GroundEnv, prof: VehicleProfile, p: Readonly<Vec2>, firm: boolean): Vec2 {
  const g = prof.ground;
  if (!g || prof.walks || firm || !env.treesNear) return [p[0], p[1]];
  const half = g.width.value / 2;
  const clear = (q: Vec2) => !env.treesNear!(q, half + 1).some((tr) => Math.hypot(tr.x - q[0], tr.z - q[1]) < half + tr.dbh / 2);
  if (clear([p[0], p[1]])) return [p[0], p[1]];
  for (let r = 1; r <= 8; r += 1)
    for (let k = 0; k < 16; k += 1) {
      const q: Vec2 = [Math.round((p[0] + Math.cos((k * Math.PI) / 8) * r) * 100) / 100, Math.round((p[1] + Math.sin((k * Math.PI) / 8) * r) * 100) / 100];
      if (clear(q)) return q;
    }
  return [p[0], p[1]];
}

/** the grid off the ways a detour is looked for on (m): coarse enough to be quick, fine enough for gaps in a hedgerow */
const DETOUR_STEP = 20;
/** the most grid points a detour search looks at (a box some 2.8 km square at 20 m) */
const DETOUR_MAX_NODES = 20_000;
/** the most grid points a detour search expands before it gives up */
const DETOUR_MAX_EXPANDED = 6_000;

/**
 * A way round off the ways when the straight line is barred (a stand of trees, a hedgerow, a pond, ground too soft or
 * steep for it; design/realism-plan.md S3, audit E1): the quickest path over a grid of the ground about the two points,
 * each step priced by the same ground as a straight line. Null when there is none within the box.
 */
function groundDetour(ctx: ReadCtx, env: GroundEnv, prof: VehicleProfile, a: Vec2, b: Vec2, wade: number, firm: boolean, steps: Map<number, number>): { t: number; pts: Vec2[] } | null {
  if (!ctx.hasPort('terrain')) return null;
  const bounds = ctx.port('terrain').bounds;
  const pad = Math.max(150, dist(a, b) * 0.5);
  // (the grid's points on a lattice over the world: the steps between them are the same whoever asks, kept for the hour)
  const x0 = Math.ceil(Math.max(bounds.x0, Math.min(a[0], b[0]) - pad) / DETOUR_STEP) * DETOUR_STEP;
  const z0 = Math.ceil(Math.max(bounds.z0, Math.min(a[1], b[1]) - pad) / DETOUR_STEP) * DETOUR_STEP;
  const x1 = Math.min(bounds.x1, Math.max(a[0], b[0]) + pad);
  const z1 = Math.min(bounds.z1, Math.max(a[1], b[1]) + pad);
  const nx = Math.floor((x1 - x0) / DETOUR_STEP) + 1;
  const nz = Math.floor((z1 - z0) / DETOUR_STEP) + 1;
  if (nx < 2 || nz < 2 || nx * nz > DETOUR_MAX_NODES) return null;
  const pos = (k: number): Vec2 => [x0 + (k % nx) * DETOUR_STEP, z0 + Math.floor(k / nx) * DETOUR_STEP];
  const offV = convert(prof.offroadSpeed.value, 'km/h', 'm/s');
  const edge = (p: Vec2, q: Vec2) => groundTime(env, prof, p, q, wade, firm);
  // in and out by the grid points about each end that can be reached straight
  const near = (p: Vec2): number[] => {
    const i = Math.floor((p[0] - x0) / DETOUR_STEP);
    const j = Math.floor((p[1] - z0) / DETOUR_STEP);
    const out: number[] = [];
    for (let di = -1; di <= 2; di += 1) for (let dj = -1; dj <= 2; dj += 1) {
      const ii = i + di;
      const jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) out.push(jj * nx + ii);
    }
    return out;
  };
  const g = new Float64Array(nx * nz).fill(Infinity);
  const prev = new Int32Array(nx * nz).fill(-1);
  const closed = new Uint8Array(nx * nz);
  const goal = new Map<number, number>();
  for (const k of near(b)) {
    const t = edge(pos(k), b);
    if (Number.isFinite(t)) goal.set(k, t);
  }
  if (!goal.size) return null;
  // a binary heap of [f, node]
  const heap: [number, number][] = [];
  const push = (f: number, k: number) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const h = (k: number) => dist(pos(k), b) / offV;
  for (const k of near(a)) {
    const t = edge(a, pos(k));
    if (Number.isFinite(t) && t < g[k]!) {
      g[k] = t;
      push(t + h(k), k);
    }
  }
  let best = Infinity;
  let bestK = -1;
  // (looked for so far, no farther: a way round that needs more than this is none worth taking)
  let expanded = 0;
  while (heap.length) {
    const [f, k] = pop();
    if (f >= best) break;
    if (closed[k]) continue;
    closed[k] = 1;
    if (++expanded > DETOUR_MAX_EXPANDED) break;
    const tail = goal.get(k);
    if (tail !== undefined && g[k]! + tail < best) {
      best = g[k]! + tail;
      bestK = k;
    }
    const i = k % nx;
    const j = Math.floor(k / nx);
    const p = pos(k);
    for (let di = -1; di <= 1; di += 1) for (let dj = -1; dj <= 1; dj += 1) {
      if (!di && !dj) continue;
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const q = jj * nx + ii;
      if (closed[q]) continue;
      const sk = ((Math.round(p[0] / DETOUR_STEP) + 4096) * 8192 + (Math.round(p[1] / DETOUR_STEP) + 4096)) * 9 + (di + 1) * 3 + (dj + 1);
      let c = steps.get(sk);
      if (c === undefined) steps.set(sk, (c = edge(p, pos(q))));
      if (!Number.isFinite(c)) continue;
      const ng = g[k]! + c;
      if (ng < g[q]!) {
        g[q] = ng;
        prev[q] = k;
        push(ng + h(q), q);
      }
    }
  }
  if (bestK < 0) return null;
  const path: Vec2[] = [b];
  for (let k = bestK; k >= 0; k = prev[k]!) path.push(pos(k));
  path.push(a);
  path.reverse();
  return { t: best, pts: path };
}

/** the distance from a point to the segment a–b */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz;
  const u = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)) : 0;
  return Math.hypot(a[0] + u * dx - p[0], a[1] + u * dz - p[1]);
}

// ------------------------------------------------------------------ derived graph

interface Grid {
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  start: Int32Array;
  items: Int32Array;
  segEdge: Int32Array;
  segIdx: Int32Array;
  seen: Uint32Array;
  gen: number;
}

interface Weights {
  /** seconds to traverse the whole edge (Infinity = unusable) */
  time: Float64Array;
}

interface Graph {
  key: string;
  nodeIds: EntityId[];
  nodeIndex: Map<EntityId, number>;
  nx: Float64Array;
  nz: Float64Array;
  ext: (NetNode['external'] | undefined)[];
  edgeIds: EntityId[];
  edges: Readonly<NetEdge>[];
  ea: Int32Array;
  eb: Int32Array;
  geomLen: Float64Array;
  cums: number[][];
  adjStart: Int32Array;
  adjEdge: Int32Array;
  adjOther: Int32Array;
  grid: Grid;
  weights: Map<string, Weights>;
  // A* scratch (generation-stamped, reused between queries)
  g: Float64Array;
  seen: Uint32Array;
  done: Uint32Array;
  prevEdge: Int32Array;
  prevNode: Int32Array;
  gen: number;
}

function buildGrid(edges: Readonly<NetEdge>[]): Grid {
  let nseg = 0;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const e of edges) {
    nseg += Math.max(0, e.geometry.length - 1);
    const [a, b, c, d] = bboxOf(e.geometry);
    x0 = Math.min(x0, a);
    z0 = Math.min(z0, b);
    x1 = Math.max(x1, c);
    z1 = Math.max(z1, d);
  }
  if (nseg === 0) {
    return { x0: 0, z0: 0, cell: 1, nx: 0, nz: 0, start: new Int32Array(1), items: new Int32Array(0), segEdge: new Int32Array(0), segIdx: new Int32Array(0), seen: new Uint32Array(0), gen: 0 };
  }
  const W = Math.max(x1 - x0, 1);
  const H = Math.max(z1 - z0, 1);
  let cell = Math.max(1, Math.sqrt((W * H) / nseg) * 2);
  while ((Math.floor(W / cell) + 1) * (Math.floor(H / cell) + 1) > 1 << 20) cell *= 2;
  const nx = Math.floor(W / cell) + 1;
  const nz = Math.floor(H / cell) + 1;
  const segEdge = new Int32Array(nseg);
  const segIdx = new Int32Array(nseg);
  const counts = new Int32Array(nx * nz + 1);
  const cellRange = (a: Readonly<Vec2>, b: Readonly<Vec2>): [number, number, number, number] => [
    Math.min(nx - 1, Math.max(0, Math.floor((Math.min(a[0], b[0]) - x0) / cell))),
    Math.min(nz - 1, Math.max(0, Math.floor((Math.min(a[1], b[1]) - z0) / cell))),
    Math.min(nx - 1, Math.max(0, Math.floor((Math.max(a[0], b[0]) - x0) / cell))),
    Math.min(nz - 1, Math.max(0, Math.floor((Math.max(a[1], b[1]) - z0) / cell))),
  ];
  let k = 0;
  edges.forEach((e, ei) => {
    for (let j = 0; j + 1 < e.geometry.length; j += 1) {
      segEdge[k] = ei;
      segIdx[k] = j;
      const [i0, j0, i1, j1] = cellRange(e.geometry[j]!, e.geometry[j + 1]!);
      for (let jj = j0; jj <= j1; jj += 1) for (let ii = i0; ii <= i1; ii += 1) counts[jj * nx + ii + 1]! += 1;
      k += 1;
    }
  });
  for (let c = 1; c < counts.length; c += 1) counts[c]! += counts[c - 1]!;
  const start = Int32Array.from(counts);
  const fill = Int32Array.from(counts);
  const items = new Int32Array(start[start.length - 1]!);
  for (let sgi = 0; sgi < nseg; sgi += 1) {
    const e = edges[segEdge[sgi]!]!;
    const j = segIdx[sgi]!;
    const [i0, j0, i1, j1] = cellRange(e.geometry[j]!, e.geometry[j + 1]!);
    for (let jj = j0; jj <= j1; jj += 1) for (let ii = i0; ii <= i1; ii += 1) items[fill[jj * nx + ii]!++] = sgi;
  }
  return { x0, z0, cell, nx, nz, start, items, segEdge, segIdx, seen: new Uint32Array(nseg), gen: 0 };
}

function buildGraph(ctx: ReadCtx, key: string): Graph {
  const nodeIds: EntityId[] = [];
  const nodeIndex = new Map<EntityId, number>();
  const xs: number[] = [];
  const zs: number[] = [];
  const ext: (NetNode['external'] | undefined)[] = [];
  for (const [id, n] of ctx.all('NetNode')) {
    nodeIndex.set(id, nodeIds.length);
    nodeIds.push(id);
    xs.push(n.pos[0]);
    zs.push(n.pos[1]);
    ext.push(n.external);
  }
  const edgeIds: EntityId[] = [];
  const edges: Readonly<NetEdge>[] = [];
  const ea: number[] = [];
  const eb: number[] = [];
  for (const [id, e] of ctx.all('NetEdge')) {
    const a = nodeIndex.get(e.a);
    const b = nodeIndex.get(e.b);
    if (a === undefined || b === undefined || e.geometry.length < 2) continue;
    edgeIds.push(id);
    edges.push(e);
    ea.push(a);
    eb.push(b);
  }
  const N = nodeIds.length;
  const deg = new Int32Array(N + 1);
  for (let i = 0; i < edges.length; i += 1) {
    deg[ea[i]! + 1]! += 1;
    deg[eb[i]! + 1]! += 1;
  }
  for (let i = 1; i <= N; i += 1) deg[i]! += deg[i - 1]!;
  const adjStart = Int32Array.from(deg);
  const fill = Int32Array.from(deg);
  const adjEdge = new Int32Array(adjStart[N]!);
  const adjOther = new Int32Array(adjStart[N]!);
  for (let i = 0; i < edges.length; i += 1) {
    const a = ea[i]!;
    const b = eb[i]!;
    adjEdge[fill[a]!] = i;
    adjOther[fill[a]!++] = b;
    adjEdge[fill[b]!] = i;
    adjOther[fill[b]!++] = a;
  }
  const cums = edges.map((e) => cumulative(e.geometry));
  return {
    key,
    nodeIds,
    nodeIndex,
    nx: Float64Array.from(xs),
    nz: Float64Array.from(zs),
    ext,
    edgeIds,
    edges,
    ea: Int32Array.from(ea),
    eb: Int32Array.from(eb),
    geomLen: Float64Array.from(cums.map((c) => c[c.length - 1]!)),
    cums,
    adjStart,
    adjEdge,
    adjOther,
    grid: buildGrid(edges),
    weights: new Map(),
    g: new Float64Array(N),
    seen: new Uint32Array(N),
    done: new Uint32Array(N),
    prevEdge: new Int32Array(N),
    prevNode: new Int32Array(N),
    gen: 0,
  };
}

interface Hit {
  edge: number;
  chainage: number;
  point: Vec2;
  distance: number;
}

/** the connected parts of a graph by the ways a profile uses (a node's part), kept with its weights */
const PARTS = new WeakMap<object, Int32Array>();
function componentsOf(G: Graph, W: object, accept: (edge: number) => boolean): Int32Array {
  let c = PARTS.get(W);
  if (c) return c;
  const n = G.nx.length;
  const up = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (up[i] !== i) i = up[i] = up[up[i]!]!;
    return i;
  };
  for (let e = 0; e < G.ea.length; e += 1) if (accept(e)) up[find(G.ea[e]!)] = find(G.eb[e]!);
  c = new Int32Array(n).map((_, i) => find(i));
  PARTS.set(W, c);
  return c;
}

function nearestIdx(G: Graph, p: Readonly<Vec2>, accept: (edge: number) => boolean, maxDist: number, hitOk?: (point: Vec2) => boolean, tries = Infinity): Hit | null {
  const grid = G.grid;
  if (grid.nx === 0) return null;
  grid.gen += 1;
  if (grid.gen === 0xffffffff) {
    grid.seen.fill(0);
    grid.gen = 1;
  }
  const { x0, z0, cell, nx, nz } = grid;
  const ci = Math.floor((p[0] - x0) / cell);
  const cj = Math.floor((p[1] - z0) / cell);
  const dxo = ci < 0 ? -ci : ci >= nx ? ci - nx + 1 : 0;
  const dzo = cj < 0 ? -cj : cj >= nz ? cj - nz + 1 : 0;
  const rmin = Math.max(dxo, dzo);
  const rmax = Math.max(Math.abs(ci), Math.abs(ci - (nx - 1)), Math.abs(cj), Math.abs(cj - (nz - 1)));
  let best: Hit | null = null;
  let bestD = maxDist;
  const visitCell = (i: number, j: number) => {
    const c = j * nx + i;
    for (let k = grid.start[c]!; k < grid.start[c + 1]!; k += 1) {
      const sg = grid.items[k]!;
      if (grid.seen[sg] === grid.gen) continue;
      grid.seen[sg] = grid.gen;
      const e = grid.segEdge[sg]!;
      if (!accept(e)) continue;
      const geom = G.edges[e]!.geometry;
      const jj = grid.segIdx[sg]!;
      const pr = projectOnSegment(p, geom[jj]!, geom[jj + 1]!);
      if (pr.distance < bestD || (pr.distance === bestD && best === null)) {
        // (a costly check is tried on so many candidates at most)
        if (hitOk && tries <= 0) continue;
        if (hitOk) tries -= 1;
        if (hitOk && !hitOk(pr.point)) continue;
        const cum = G.cums[e]!;
        bestD = pr.distance;
        best = { edge: e, chainage: cum[jj]! + pr.t * (cum[jj + 1]! - cum[jj]!), point: pr.point, distance: pr.distance };
      }
    }
  };
  for (let r = rmin; r <= rmax; r += 1) {
    if (r > 0 && (r - 1) * cell > bestD) break;
    const jLo = Math.max(0, cj - r);
    const jHi = Math.min(nz - 1, cj + r);
    for (let j = jLo; j <= jHi; j += 1) {
      if (j === cj - r || j === cj + r) {
        const iLo = Math.max(0, ci - r);
        const iHi = Math.min(nx - 1, ci + r);
        for (let i = iLo; i <= iHi; i += 1) visitCell(i, j);
      } else {
        if (ci - r >= 0 && ci - r < nx) visitCell(ci - r, j);
        if (r > 0 && ci + r >= 0 && ci + r < nx) visitCell(ci + r, j);
      }
    }
  }
  return best;
}

/** Binary min-heap of (priority, node). */
class MinHeap {
  private f: number[] = [];
  private n: number[] = [];
  get size(): number {
    return this.f.length;
  }
  clear(): void {
    this.f.length = 0;
    this.n.length = 0;
  }
  push(f: number, n: number): void {
    const F = this.f;
    const Nn = this.n;
    let i = F.length;
    F.push(f);
    Nn.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p]! <= f) break;
      F[i] = F[p]!;
      Nn[i] = Nn[p]!;
      i = p;
    }
    F[i] = f;
    Nn[i] = n;
  }
  /** pops the minimum; returns its priority and writes the node into out[0] */
  pop(out: number[]): number {
    const F = this.f;
    const Nn = this.n;
    const topF = F[0]!;
    out[0] = Nn[0]!;
    const lastF = F.pop()!;
    const lastN = Nn.pop()!;
    const len = F.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        const c = r < len && F[r]! < F[l]! ? r : l;
        if (F[c]! >= lastF) break;
        F[i] = F[c]!;
        Nn[i] = Nn[c]!;
        i = c;
      }
      F[i] = lastF;
      Nn[i] = lastN;
    }
    return topF;
  }
}

type End = { kind: 'point'; p: Vec2 } | { kind: 'external'; node: EntityId };

// ------------------------------------------------------------------ routing port

export function createRoutingPort(ctx: ReadCtx): RoutingPort {
  let cache: Graph | null = null;
  const heap = new MinHeap();
  const popOut = [0];

  const graph = (): Graph => {
    const key = `${ctx.revision('NetNode')}:${ctx.revision('NetEdge')}`;
    if (!cache || cache.key !== key) cache = buildGraph(ctx, key);
    return cache;
  };

  /** routing.approach, not cached (see the port) */
  const approachUncached = (node: EntityId, to: Vec2, profile: string, within: number, walk: string | undefined, dir: 'in' | 'out', opts: { maxOffroad?: number; openOnly?: boolean; reach?: number } | undefined): Vec2 | undefined => {
    const drives = (q: Vec2) => (dir === 'in' ? computeRoute({ kind: 'external', node }, { kind: 'point', p: q }, profile, opts) : computeRoute({ kind: 'point', p: q }, { kind: 'external', node }, profile, opts)) !== null;
    if (drives(to)) return [to[0], to[1]];
    const gate = ctx.get('NetNode', node)?.pos;
    if (!gate) return undefined;
    // (on foot to the place, or to dry ground within reach of it: the bank of a crossing being built)
    let target: Vec2 = to;
    if (walk && opts?.reach && ctx.hasPort('terrain')) {
      const wp = profileOf(ctx, walk);
      const wade = wp.wading ? convert(wp.wading.value, wp.wading.unit, 'm') : 0;
      const t = ctx.port('terrain');
      if (t.waterDepthAt(to[0], to[1]) > wade + 1e-3) {
        const dryAt = [2, 5, 10, 15, 20, 25, 35, 50].filter((r) => r <= opts.reach!).flatMap((r) => Array.from({ length: APPROACH_DIRS }, (_, k): Vec2 => [to[0] + Math.cos((k * 2 * Math.PI) / APPROACH_DIRS) * r, to[1] + Math.sin((k * 2 * Math.PI) / APPROACH_DIRS) * r])).find((q) => onMapOf(ctx, q) && t.waterDepthAt(q[0], q[1]) <= wade + 1e-3);
        if (!dryAt) return undefined;
        target = dryAt;
        if (drives(target)) return [target[0], target[1]];
      }
    }
    // rings round the place, the nearest first, and on each the side towards the way in first (r38: not only the
    // straight line back to it: the dry ground 20 m to one side of a machine in the creek's low ground)
    const towards = Math.atan2(gate[1] - to[1], gate[0] - to[0]);
    const angles = Array.from({ length: APPROACH_DIRS }, (_, k) => towards + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((2 * Math.PI) / APPROACH_DIRS));
    // (rings 12.5, 25, 50, 75, 100 m, then half as far again each: near places closely, far ones coarsely; a place in
    // water deeper than the vehicle wades is not tried)
    const vp = profileOf(ctx, profile);
    const vwade = vp.wading ? convert(vp.wading.value, vp.wading.unit, 'm') : 0;
    const terrain = ctx.hasPort('terrain') ? ctx.port('terrain') : undefined;
    const radii: number[] = [APPROACH_STEP / 2, APPROACH_STEP, 2 * APPROACH_STEP, 3 * APPROACH_STEP, 4 * APPROACH_STEP];
    while (radii.at(-1)! * 1.5 <= within) radii.push(Math.round(radii.at(-1)! * 1.5));
    if (radii.at(-1)! < within) radii.push(within);
    for (const r of radii) {
      if (r > within) break;
      for (const a of angles) {
        const q: Vec2 = [to[0] + Math.cos(a) * r, to[1] + Math.sin(a) * r];
        if (!onMapOf(ctx, q) || (terrain && terrain.waterDepthAt(q[0], q[1]) > vwade + 1e-3)) continue;
        if (drives(q) && (!walk || computeRoute({ kind: 'point', p: q }, { kind: 'point', p: target }, walk, opts))) return q;
      }
    }
    return undefined;
  };
  // the ground's cache of this world for the hour, the trees as they stand, the terrain and its ponds as they are and
  // the ground made firm as it is: anything kept of the ground is asked again when one of them changes (review S3 #2)
  const groundCacheOf = (G: object): GroundCache => {
    const hour = Math.floor(ctx.now / 3600);
    const vegRev = ctx.hasPort('vegetation') ? ctx.port('vegetation').revision() : 0;
    const t = ctx.hasPort('terrain') ? ctx.port('terrain') : undefined;
    const heights = t?.heights();
    const pond = t ? Math.round((t.pondLevel() ?? 0) * 20) : 0;
    const firmRev = [...ctx.contributions('firmGround'), ...ctx.contributions('clearedGround')].reduce((a, c) => a + c.impl.revision(ctx), 0);
    let c = groundCaches.get(G);
    const l = c?.lasting;
    const lasting: LastingGround = l && l.veg === vegRev && l.heights === heights && l.pond === pond ? l : { veg: vegRev, heights, pond, trees: new Map() };
    if (!c || c.hour !== hour || c.lasting !== lasting || c.firmRev !== firmRev) groundCaches.set(G, (c = { hour, heights, pond, firmRev, traf: new Map(), firm: new Map(), cleared: new Map(), detours: new Map(), steps: new Map(), lasting }));
    return c;
  };
  // (a way round, kept with the ground it was found on, for these very ends)
  const detour = (cache: GroundCache, env: GroundEnv, prof: VehicleProfile, profileId: string, a: Vec2, b: Vec2, wade: number, firm: boolean): { t: number; pts: Vec2[] } | null => {
    const key = `${profileId}|${firm}|${wade}|${env.pace}|${a[0]},${a[1]}|${b[0]},${b[1]}`;
    if (cache.detours.has(key)) return cache.detours.get(key)!;
    const sk = `${profileId}|${firm}|${wade}|${env.pace}`;
    let steps = cache.steps.get(sk);
    if (!steps) cache.steps.set(sk, (steps = new Map()));
    const answer = groundDetour(ctx, env, prof, a, b, wade, firm, steps);
    cache.detours.set(key, answer);
    return answer;
  };
  let approachCache: { g: Graph; ground: GroundCache; answers: Map<string, Vec2 | undefined> } | undefined;

  const weights = (G: Graph, profileId: string, prof: VehicleProfile, openOnly: boolean): Weights => {
    const wkey = `${profileId}|${openOnly ? 1 : 0}`;
    let w = G.weights.get(wkey);
    if (!w) {
      const time = new Float64Array(G.edges.length);
      G.edges.forEach((e, i) => {
        const usable = (!openOnly || e.open) && (prof.roadLegal || e.surface !== 'external');
        const v = usable ? edgeSpeedExplain(prof, e).v : 0;
        time[i] = v > 0 ? e.length / convert(v, 'km/h', 'm/s') : Infinity;
      });
      w = { time };
      G.weights.set(wkey, w);
    }
    return w;
  };

  const astar = (
    G: Graph,
    W: Weights,
    starts: [number, number][],
    goals: Map<number, number>,
    tx: number,
    tz: number,
    invV: number,
    bound: number,
  ): { goal: number; total: number } | null => {
    G.gen += 1;
    if (G.gen === 0xffffffff) {
      G.seen.fill(0);
      G.done.fill(0);
      G.gen = 1;
    }
    const gen = G.gen;
    const { g, seen, done, prevEdge, prevNode, nx, nz, adjStart, adjEdge, adjOther } = G;
    const time = W.time;
    heap.clear();
    let best = bound;
    let bestNode = -1;
    const h = (n: number) => Math.hypot(nx[n]! - tx, nz[n]! - tz) * invV;
    for (const [n, c] of starts) {
      if (seen[n] === gen && g[n]! <= c) continue;
      seen[n] = gen;
      g[n] = c;
      prevEdge[n] = -1;
      prevNode[n] = -1;
      heap.push(c + h(n), n);
      const extra = goals.get(n);
      if (extra !== undefined && c + extra < best) {
        best = c + extra;
        bestNode = n;
      }
    }
    while (heap.size > 0) {
      const f = heap.pop(popOut);
      if (f >= best) break;
      const n = popOut[0]!;
      if (done[n] === gen) continue;
      done[n] = gen;
      const gn = g[n]!;
      for (let k = adjStart[n]!; k < adjStart[n + 1]!; k += 1) {
        const e = adjEdge[k]!;
        const w = time[e]!;
        if (w === Infinity) continue;
        const m = adjOther[k]!;
        const ng = gn + w;
        if (seen[m] === gen && ng >= g[m]!) continue;
        seen[m] = gen;
        g[m] = ng;
        prevEdge[m] = e;
        prevNode[m] = n;
        const extra = goals.get(m);
        if (extra !== undefined && ng + extra < best) {
          best = ng + extra;
          bestNode = m;
        }
        heap.push(ng + h(m), m);
      }
    }
    return bestNode >= 0 ? { goal: bestNode, total: best } : null;
  };

  const computeRoute = (from: End, to: End, profileId: string, opts?: { maxOffroad?: number; openOnly?: boolean; firm?: boolean; unit?: EntityId }): Route | null => {
    const prof = profileOf(ctx, profileId);
    const G = graph();
    const openOnly = opts?.openOnly !== false;
    const maxOff = opts?.maxOffroad ?? (prof.offroadReach ? convert(prof.offroadReach.value, prof.offroadReach.unit, 'm') : DEFAULT_MAX_OFFROAD);
    const W = weights(G, profileId, prof, openOnly);
    const accept = (e: number) => W.time[e]! !== Infinity;
    const vmax = convert(prof.maxSpeed.value, 'km/h', 'm/s');
    // off the road, no deeper water than it wades through (finding 21: a tipper into a pond 1.8 m deep)
    const wade = prof.wading ? convert(prof.wading.value, prof.wading.unit, 'm') : 0;
    // (and over the ground as it is: slope, wetness, trees, S3; the same stretch asked again within a route, once)
    const offMemo = new Map<string, number>();
    const gcache = groundCacheOf(G);
    // (in the dark off the ways: the profile's pace, with a light carried its lit pace; a plan's estimate as by day: S7)
    const dk = prof.dark;
    const lx = dk && !opts?.firm && ctx.hasPort('weather') ? ctx.port('weather').light(ctx.now) : Infinity;
    // (one who goes with a light: what they carry, or one of theirs by them where they set out; asked once, for plans and moves alike)
    const lit = dk && lx < dk.below.value && dk.lit && opts?.unit !== undefined && ctx.contributions('carriesLight').some((c) => c.impl(ctx, opts.unit!, from.kind === 'point' ? from.p : [Number.NaN, Number.NaN]));
    const genv = { ...groundEnv(ctx, gcache), pace: dk && lx < dk.below.value ? (lit ? dk.lit!.value : dk.pace.value) : 1 };
    // (a vehicle goes no nearer a trunk than its half-width: a place beside a tree is reached at the nearest clear spot a
    // few metres off, where it stops)
    // (a place on a way it uses is clear: the way is)
    const onWay = (p: Readonly<Vec2>) => nearestIdx(G, p, accept, ON_WAY) !== null;
    if (from.kind === 'point' && !onWay(from.p)) from = { kind: 'point', p: clearOf(genv, prof, from.p, opts?.firm === true) };
    if (to.kind === 'point' && !onWay(to.p)) to = { kind: 'point', p: clearOf(genv, prof, to.p, opts?.firm === true) };
    const offTime = (a: Vec2, b: Vec2): number => {
      const key = `${a[0]},${a[1]},${b[0]},${b[1]}`;
      let v = offMemo.get(key);
      if (v === undefined) offMemo.set(key, (v = groundTime(genv, prof, a, b, wade, opts?.firm === true)));
      return v;
    };
    // (and round what bars the straight line: a detour over the ground, S3)
    const pathMemo = new Map<string, { t: number; pts: Vec2[] }>();
    const offPath = (a: Vec2, b: Vec2): { t: number; pts: Vec2[] } => {
      const t = offTime(a, b);
      if (Number.isFinite(t)) return { t, pts: [a, b] };
      const key = `${a[0]},${a[1]},${b[0]},${b[1]}`;
      let v = pathMemo.get(key);
      if (!v) pathMemo.set(key, (v = detour(gcache, genv, prof, profileId, a, b, wade, opts?.firm === true) ?? { t: Infinity, pts: [a, b] }));
      return v;
    };
    const offT = (a: Vec2, b: Vec2): number => offPath(a, b).t;
    // (the nearest way is looked for along straight lines, quickly; only when none is open is a way round looked for)
    const dry = (a: Vec2, b: Vec2): boolean => Number.isFinite(offTime(a, b));
    const roundabout = (a: Vec2, b: Vec2): boolean => Number.isFinite(offT(a, b));

    const extNode = (id: EntityId): number | null => {
      const i = G.nodeIndex.get(id);
      if (i === undefined || !G.ext[i] || !canGoOutside(prof, G.ext[i]!)) return null;
      return i;
    };

    // (a point is joined to a way connected to the other end: not to an island way nearer by that nothing reaches, r30;
    // the vehicle then goes off the way to it from the ways it can get to)
    const comp = componentsOf(G, W, accept);
    let anchor: number | undefined;
    if (from.kind === 'external') {
      const i = extNode(from.node);
      if (i !== null) anchor = comp[i];
    } else if (to.kind === 'external') {
      const i = extNode(to.node);
      if (i !== null) anchor = comp[i];
    }
    const joined = (e: number) => accept(e) && (anchor === undefined || comp[G.ea[e]!] === anchor);

    const fromPos: Vec2 = from.kind === 'point' ? [from.p[0], from.p[1]] : [0, 0];
    const toPos: Vec2 = to.kind === 'point' ? [to.p[0], to.p[1]] : [0, 0];
    const starts: [number, number][] = [];
    const goals = new Map<number, number>();
    let fromHit: Hit | null = null;
    let toHit: Hit | null = null;
    let fromExt = -1;
    let toExt = -1;
    const partial = (e: number, c: number) => (W.time[e]! * c) / G.geomLen[e]!;

    if (from.kind === 'external') {
      const i = extNode(from.node);
      if (i === null) return null;
      fromExt = i;
      fromPos[0] = G.nx[i]!;
      fromPos[1] = G.nz[i]!;
      starts.push([i, externalDurationExplain(prof, G.ext[i]!).v]);
    } else {
      // (the nearest way it can get to without wading deeper than it can)
      fromHit = nearestIdx(G, from.p, joined, maxOff, (q) => dry(from.p, q)) ?? nearestIdx(G, from.p, joined, maxOff, (q) => roundabout(from.p, q), 10);
      if (fromHit && anchor === undefined) anchor = comp[G.ea[fromHit.edge]!];
      if (fromHit) {
        const e = fromHit.edge;
        const tA = offT(from.p, fromHit.point);
        starts.push([G.ea[e]!, tA + partial(e, fromHit.chainage)]);
        starts.push([G.eb[e]!, tA + partial(e, G.geomLen[e]! - fromHit.chainage)]);
      }
    }
    if (to.kind === 'external') {
      const i = extNode(to.node);
      if (i === null) return null;
      toExt = i;
      toPos[0] = G.nx[i]!;
      toPos[1] = G.nz[i]!;
      goals.set(i, externalDurationExplain(prof, G.ext[i]!).v);
    } else {
      toHit = nearestIdx(G, to.p, joined, maxOff, (q) => dry(q, to.p)) ?? nearestIdx(G, to.p, joined, maxOff, (q) => roundabout(q, to.p), 10);
      if (toHit) {
        const e = toHit.edge;
        const tX = offT(toHit.point, to.p);
        const ca = partial(e, toHit.chainage) + tX;
        const cb = partial(e, G.geomLen[e]! - toHit.chainage) + tX;
        goals.set(G.ea[e]!, Math.min(ca, goals.get(G.ea[e]!) ?? Infinity));
        goals.set(G.eb[e]!, Math.min(cb, goals.get(G.eb[e]!) ?? Infinity));
      }
    }

    // candidates: direct off-road, along a single edge, through the graph
    let best = Infinity;
    let choice: 'direct' | 'sameEdge' | 'graph' | null = null;
    if (from.kind === 'point' && to.kind === 'point') {
      const d = dist(from.p, to.p);
      const t = d <= maxOff ? offT(from.p, to.p) : Infinity;
      if (Number.isFinite(t)) {
        best = t;
        choice = 'direct';
      }
    }
    if (fromHit && toHit && fromHit.edge === toHit.edge) {
      const e = fromHit.edge;
      const c = offT(fromPos, fromHit.point) + partial(e, Math.abs(fromHit.chainage - toHit.chainage)) + offT(toHit.point, toPos);
      if (c < best) {
        best = c;
        choice = 'sameEdge';
      }
    }
    let path: { goal: number; total: number } | null = null;
    if (starts.length && goals.size) {
      const tgt: Vec2 = toHit ? toHit.point : toPos;
      path = astar(G, W, starts, goals, tgt[0], tgt[1], 1 / vmax, best);
      if (path && path.total < best) {
        best = path.total;
        choice = 'graph';
      }
    }
    if (choice === null) return null;

    // ---- assemble stretches with explain traces
    const stretches: RouteStretch[] = [];
    const legEx: Explained[] = [];
    const push = (leg: Omit<RouteStretch, 'duration'>, durEx: Explained) => {
      stretches.push({ ...leg, duration: durEx.v });
      legEx.push(durEx);
    };
    const offroad = (a: Vec2, b: Vec2, label: string, force = false) => {
      const straight = dist(a, b);
      if (straight < LEG_EPS && !force) return;
      // (the way it goes: straight, or round what bars it)
      const way = offPath(a, b);
      const pts = way.pts.map((q): Vec2 => [q[0], q[1]]);
      const L = pts.length > 2 ? polylineLength(pts) : straight;
      push({ kind: 'offroad', from: [a[0], a[1]], to: [b[0], b[1]], length: L, points: pts }, offroadExplain(prof, L, pts.length > 2 ? `${label}, round what bars the straight line` : label, way.t));
    };
    const along = (e: number, c0: number, c1: number) => {
      const L = Math.abs(c1 - c0);
      if (L < LEG_EPS) return;
      const edge = G.edges[e]!;
      const pts = subPolyline(edge.geometry, c0, c1, G.cums[e]);
      const id = G.edgeIds[e]!;
      const speed = edgeSpeedExplain(prof, edge);
      const durEx = ex.div(`${edge.label ?? id} (${edge.surface}, ${L.toFixed(0)} m)`, 's', ex.value(L, 'm', 'length'), ex.convert(speed, 'm/s'));
      push({ edge: id, kind: 'network', from: pts[0]!, to: pts[pts.length - 1]!, length: L, points: pts }, durEx);
    };
    const external = (i: number) => {
      const x = G.ext[i]!;
      const pos: Vec2 = [G.nx[i]!, G.nz[i]!];
      push({ kind: 'external', from: pos, to: [pos[0], pos[1]], length: x.distanceKm * 1000, points: [[pos[0], pos[1]]] }, externalDurationExplain(prof, x));
    };

    if (choice === 'direct') {
      offroad(fromPos, toPos, 'off-road (direct)', true);
    } else if (choice === 'sameEdge') {
      offroad(fromPos, fromHit!.point, 'off-road approach');
      along(fromHit!.edge, fromHit!.chainage, toHit!.chainage);
      offroad(toHit!.point, toPos, 'off-road exit');
    } else {
      const seq: number[] = [];
      let n = path!.goal;
      while (G.prevNode[n]! >= 0) {
        seq.push(G.prevEdge[n]!);
        n = G.prevNode[n]!;
      }
      seq.reverse();
      const startNode = n;
      if (fromExt >= 0) external(fromExt);
      else {
        const e = fromHit!.edge;
        offroad(fromPos, fromHit!.point, 'off-road approach');
        along(e, fromHit!.chainage, startNode === G.ea[e] ? 0 : G.geomLen[e]!);
      }
      let cur = startNode;
      for (const e of seq) {
        const forward = G.ea[e] === cur;
        along(e, forward ? 0 : G.geomLen[e]!, forward ? G.geomLen[e]! : 0);
        cur = forward ? G.eb[e]! : G.ea[e]!;
      }
      if (toExt >= 0) external(toExt);
      else {
        const e = toHit!.edge;
        along(e, cur === G.ea[e] ? 0 : G.geomLen[e]!, toHit!.chainage);
        offroad(toHit!.point, toPos, 'off-road exit');
      }
    }

    const polyline: Vec2[] = [];
    let length = 0;
    let networkLength = 0;
    let offroadLength = 0;
    let externalKm = 0;
    for (const leg of stretches) {
      if (leg.kind === 'external') {
        externalKm += leg.length / 1000;
        if (polyline.length === 0) polyline.push([leg.from[0], leg.from[1]]);
        continue;
      }
      length += leg.length;
      if (leg.kind === 'network') networkLength += leg.length;
      else offroadLength += leg.length;
      for (const pt of leg.points) {
        const last = polyline[polyline.length - 1];
        if (!last || dist(last, pt) > 1e-9) polyline.push([pt[0], pt[1]]);
      }
    }
    if (polyline.length === 0) polyline.push([fromPos[0], fromPos[1]]);
    const explain = legEx.length ? ex.sum(`trip duration (${prof.label})`, 's', ...legEx) : ex.value(0, 's', 'trip duration');
    return {
      from: fromPos,
      to: toPos,
      stretches,
      polyline,
      length,
      networkLength,
      offroadLength,
      duration: explain.v,
      externalKm,
      explain,
    };
  };

  return {
    nodes: () => ctx.all('NetNode'),
    edges: () => ctx.all('NetEdge'),
    nearest(p, opts) {
      const G = graph();
      const openOnly = opts?.openOnly === true;
      const prof = opts?.profile ? profileOf(ctx, opts.profile) : undefined;
      // with a carrier: only ways it has a speed on (a van not on a footpath)
      const usable = (e: number) => (!openOnly || G.edges[e]!.open) && (!prof || (Object.hasOwn(prof.surfaceSpeed, G.edges[e]!.surface) && edgeSpeedExplain(prof, G.edges[e]!).v > 0));
      const hit = nearestIdx(G, p, usable, opts?.maxDistance ?? Infinity);
      if (!hit) return null;
      const r: NearestResult = { edge: G.edgeIds[hit.edge]!, point: hit.point, chainage: hit.chainage, distance: hit.distance };
      return r;
    },
    route: (from, to, profile, opts) => computeRoute({ kind: 'point', p: from }, { kind: 'point', p: to }, profile, opts),
    routeFromExternal: (node, to, profile, opts) => computeRoute({ kind: 'external', node }, { kind: 'point', p: to }, profile, opts),
    routeToExternal: (from, node, profile, opts) => computeRoute({ kind: 'point', p: from }, { kind: 'external', node }, profile, opts),
    approach: (node, to, profile, within, walk, dir = 'in', opts) => {
      // (the same question on the same network and ground has the same answer: a commuter's parking asked every day)
      // (and the ground as it is: its heights, the ponds' level (r40), the hour's wetness, the trees and firm ground, S3)
      const G0 = graph();
      const ground = groundCacheOf(G0);
      if (!approachCache || approachCache.g !== G0 || approachCache.ground !== ground) approachCache = { g: G0, ground, answers: new Map() };
      const key = JSON.stringify([node, to, profile, within, walk ?? null, dir, opts ?? null]);
      if (approachCache.answers.has(key)) return approachCache.answers.get(key);
      const answer = approachUncached(node, to, profile, within, walk, dir, opts);
      approachCache.answers.set(key, answer);
      return answer;
    },
    externalNodes: () => {
      const out: EntityId[] = [];
      for (const [id, n] of ctx.all('NetNode')) if (n.external) out.push(id);
      return out;
    },
    profile: (id) => profileOf(ctx, id),
    esal: (profile, loaded) => esalOf(profileOf(ctx, profile), settingsOf(ctx), loaded),
    revision: () => ctx.revision('NetNode') + ctx.revision('NetEdge'),
  };
}

// ------------------------------------------------------------------ commands

interface Ev {
  /** chainage along the new polyline */
  c: number;
  point: Vec2;
  node?: EntityId;
  split?: { edge: EntityId; c: number };
}

interface Group {
  cMin: number;
  cMax: number;
  point: Vec2;
  node?: EntityId;
  splits: { edge: EntityId; c: number }[];
}

function createNode(ctx: WriteCtx, pos: Vec2, external?: NetNode['external']): EntityId {
  const id = ctx.spawn(NODE_KIND);
  const node: NetNode = { pos: [pos[0], pos[1]] };
  if (external) node.external = { label: external.label, distanceKm: external.distanceKm, ...(external.surface ? { surface: external.surface } : {}) };
  ctx.set('NetNode', id, node);
  return id;
}

function nearestNodeWithin(ctx: ReadCtx, p: Readonly<Vec2>, maxD: number): EntityId | undefined {
  let best: EntityId | undefined;
  let bestD = maxD;
  for (const [id, n] of ctx.all('NetNode')) {
    const d = dist(p, n.pos);
    if (d < bestD || (best === undefined && d <= bestD)) {
      best = id;
      bestD = d;
    }
  }
  return best;
}

interface AddPolylinePayload {
  points: Vec2[];
  open: boolean;
  surface: string;
  width: number;
  speedLimit: number;
  asset?: EntityId;
  label?: string;
}

function addPolyline(ctx: WriteCtx, p: AddPolylinePayload): { edges: EntityId[]; nodes: EntityId[] } {
  if (!p.points.every(isVec2)) ctx.reject('network.invalidGeometry', { reason: 'every point must be [x, z] with finite numbers' });
  const pts = dedupe(p.points, 1e-6);
  const total = polylineLength(pts);
  if (pts.length < 2 || !(total > 0)) ctx.reject('network.invalidGeometry', { reason: 'a polyline needs at least two distinct points' });
  const snap = settingsOf(ctx).snapDistance.value;
  const cum = cumulative(pts);
  const nodePos = new Map<EntityId, Vec2>();
  for (const [id, n] of ctx.all('NetNode')) nodePos.set(id, [n.pos[0], n.pos[1]]);
  const oldEdges = [...ctx.all('NetEdge')].map(([id, e]) => ({ id, e, cum: cumulative(e.geometry), bbox: bboxOf(e.geometry) }));
  const [bx0, bz0, bx1, bz1] = bboxOf(pts);

  const edgeEvent = (E: (typeof oldEdges)[number], cOld: number, point: Vec2, cNew: number): Ev => {
    const L = E.cum[E.cum.length - 1]!;
    if (cOld <= snap) return { c: cNew, point: nodePos.get(E.e.a)!, node: E.e.a };
    if (cOld >= L - snap) return { c: cNew, point: nodePos.get(E.e.b)!, node: E.e.b };
    return { c: cNew, point, split: { edge: E.id, c: cOld } };
  };
  const endpointEvent = (pt: Vec2, c: number): Ev => {
    const n = nearestNodeWithin(ctx, pt, snap);
    if (n) return { c, point: nodePos.get(n)!, node: n };
    let best: { E: (typeof oldEdges)[number]; c: number; point: Vec2; d: number } | null = null;
    for (const E of oldEdges) {
      if (pt[0] < E.bbox[0] - snap || pt[0] > E.bbox[2] + snap || pt[1] < E.bbox[1] - snap || pt[1] > E.bbox[3] + snap) continue;
      const pr = projectOnPolyline(pt, E.e.geometry, E.cum);
      if (pr.distance <= snap && (!best || pr.distance < best.d)) best = { E, c: pr.chainage, point: pr.point, d: pr.distance };
    }
    if (best) return edgeEvent(best.E, best.c, best.point, c);
    return { c, point: [pt[0], pt[1]] };
  };

  const events: Ev[] = [endpointEvent(pts[0]!, 0), endpointEvent(pts[pts.length - 1]!, total)];
  // existing nodes lying on the new polyline (dead ends of other roads touching it)
  for (const [id, pos] of nodePos) {
    if (pos[0] < bx0 - snap || pos[0] > bx1 + snap || pos[1] < bz0 - snap || pos[1] > bz1 + snap) continue;
    const pr = projectOnPolyline(pos, pts, cum);
    if (pr.distance <= snap) events.push({ c: pr.chainage, point: pos, node: id });
  }
  // crossings with existing edges ⇒ junctions
  for (const E of oldEdges) {
    if (E.bbox[2] < bx0 - snap || E.bbox[0] > bx1 + snap || E.bbox[3] < bz0 - snap || E.bbox[1] > bz1 + snap) continue;
    const g = E.e.geometry;
    for (let i = 0; i + 1 < pts.length; i += 1) {
      for (let j = 0; j + 1 < g.length; j += 1) {
        const hit = segmentIntersection(pts[i]!, pts[i + 1]!, g[j]!, g[j + 1]!);
        if (!hit) continue;
        const cNew = cum[i]! + hit.t * (cum[i + 1]! - cum[i]!);
        const cOld = E.cum[j]! + hit.u * (E.cum[j + 1]! - E.cum[j]!);
        events.push(edgeEvent(E, cOld, hit.point, cNew));
      }
    }
  }

  // group events that land on the same spot (within snap) in order along the new polyline
  const order = events.map((e, i) => [e, i] as const).sort((x, y) => x[0].c - y[0].c || x[1] - y[1]);
  const groups: Group[] = [];
  for (const [ev] of order) {
    const g = groups[groups.length - 1];
    if (g && dist(g.point, ev.point) <= snap) {
      g.cMax = Math.max(g.cMax, ev.c);
      if (ev.node && !g.node) {
        g.node = ev.node;
        g.point = nodePos.get(ev.node)!;
      }
      if (ev.split) g.splits.push(ev.split);
      continue;
    }
    const ng: Group = { cMin: ev.c, cMax: ev.c, point: ev.point, splits: ev.split ? [ev.split] : [] };
    if (ev.node) ng.node = ev.node;
    groups.push(ng);
  }
  // resolve groups to nodes (reusing nodes created in this command when they coincide, e.g. closed loops)
  const created: EntityId[] = [];
  const groupNodes: EntityId[] = groups.map((g) => {
    if (g.node) return g.node;
    const reuse = created.find((id) => dist(nodePos.get(id)!, g.point) <= snap);
    if (reuse) return reuse;
    const id = createNode(ctx, g.point);
    nodePos.set(id, [g.point[0], g.point[1]]);
    created.push(id);
    return id;
  });

  // split existing edges at junctions
  const splitReq = new Map<EntityId, { c: number; node: EntityId }[]>();
  groups.forEach((g, gi) => {
    for (const sp of g.splits) {
      const list = splitReq.get(sp.edge) ?? [];
      list.push({ c: sp.c, node: groupNodes[gi]! });
      splitReq.set(sp.edge, list);
    }
  });
  const splitEdges: EntityId[] = [];
  const allEdges: { a: EntityId; b: EntityId; length: number; id: EntityId; asset?: EntityId }[] = [];
  for (const E of oldEdges) {
    const reqs = splitReq.get(E.id);
    if (!reqs) {
      allEdges.push({ a: E.e.a, b: E.e.b, length: E.e.length, id: E.id, ...(E.e.asset !== undefined ? { asset: E.e.asset } : {}) });
      continue;
    }
    const L = E.cum[E.cum.length - 1]!;
    const seen = new Set<EntityId>([E.e.a, E.e.b]);
    const chain = [{ c: 0, node: E.e.a }];
    for (const r of [...reqs].sort((x, y) => x.c - y.c)) {
      if (seen.has(r.node)) continue;
      seen.add(r.node);
      chain.push(r);
    }
    chain.push({ c: L, node: E.e.b });
    if (chain.length === 2) {
      allEdges.push({ a: E.e.a, b: E.e.b, length: E.e.length, id: E.id, ...(E.e.asset !== undefined ? { asset: E.e.asset } : {}) });
      continue;
    }
    for (let k = 0; k + 1 < chain.length; k += 1) {
      const s0 = chain[k]!;
      const s1 = chain[k + 1]!;
      const geometry = subPolyline(E.e.geometry, s0.c, s1.c, E.cum);
      geometry[0] = [...nodePos.get(s0.node)!];
      geometry[geometry.length - 1] = [...nodePos.get(s1.node)!];
      const piece: NetEdge = { ...E.e, a: s0.node, b: s1.node, geometry, length: polylineLength(geometry) };
      const id = k === 0 ? E.id : ctx.spawn(EDGE_KIND);
      ctx.set('NetEdge', id, piece);
      splitEdges.push(id);
      allEdges.push({ a: piece.a, b: piece.b, length: piece.length, id, ...(piece.asset !== undefined ? { asset: piece.asset } : {}) });
    }
  }

  // the new edges between consecutive junctions
  const newEdges: EntityId[] = [];
  for (let k = 0; k + 1 < groups.length; k += 1) {
    const na = groupNodes[k]!;
    const nb = groupNodes[k + 1]!;
    if (na === nb) continue;
    const geometry = subPolyline(pts, groups[k]!.cMax, groups[k + 1]!.cMin, cum);
    geometry[0] = [...nodePos.get(na)!];
    geometry[geometry.length - 1] = [...nodePos.get(nb)!];
    const clean = dedupe(geometry, 1e-9);
    if (clean.length < 2) clean.push([...nodePos.get(nb)!]);
    const length = polylineLength(clean);
    // re-drawing an existing connection of the same way does not duplicate it (another's way along it is a way of its own beside it: a track along a footpath)
    const dup = allEdges.find((x) => ((x.a === na && x.b === nb) || (x.a === nb && x.b === na)) && Math.abs(x.length - length) <= snap && x.asset === p.asset);
    if (dup) {
      newEdges.push(dup.id);
      continue;
    }
    const edge: NetEdge = { a: na, b: nb, mode: 'road', geometry: clean, length, open: p.open, surface: p.surface, width: p.width, speedLimit: p.speedLimit, speedFactor: 1 };
    if (p.asset !== undefined) edge.asset = p.asset;
    if (p.label !== undefined) edge.label = p.label;
    const id = ctx.spawn(EDGE_KIND);
    ctx.set('NetEdge', id, edge);
    newEdges.push(id);
    allEdges.push({ a: na, b: nb, length, id, ...(p.asset !== undefined ? { asset: p.asset } : {}) });
  }
  if (splitEdges.length) ctx.emit('network.changed', { edges: splitEdges, reason: 'split' });
  if (newEdges.length) ctx.emit('network.changed', { edges: newEdges, reason: 'added' });
  const nodes: EntityId[] = [];
  for (const n of groupNodes) if (nodes[nodes.length - 1] !== n) nodes.push(n);
  return { edges: newEdges, nodes };
}

// ------------------------------------------------------------------ module

export const networkModule = defineModule({
  id: 'network',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Road', 'WorkPackage'],
  commandDocs: {
    "network.addNode": {
      internal: true,
    },
    "network.addPolyline": {
      internal: true,
    },
    "network.updateEdges": {
      internal: true,
    },
    "network.removeEdges": {
      internal: true,
    }
  },
  label: 'Transport network',
  description: 'Nodes and edges of the transport network; routing for vehicle profiles.',
  provides: ['routing'],
  components: { NetNode: NetNodeSchema, NetEdge: NetEdgeSchema },
  data: { vehicleProfiles: s.record(VehicleProfileSchema), networkSettings: NetworkSettingsSchema },
  events: { 'network.changed': s.object({ edges: s.array(s.ref(EDGE_KIND)), reason: s.string() }) },
  blockers: {
    'network.invalidGeometry': 'Invalid network geometry: {reason}',
    'network.unknownEdge': 'Unknown network edge {edge}',
  },
  commands: {
    'network.addNode': command(
      s.object({ pos: s.point(), external: ExternalSchema.optional() }),
      (ctx, p) => {
        if (!isVec2(p.pos)) ctx.reject('network.invalidGeometry', { reason: 'pos must be [x, z] with finite numbers' });
        const near = nearestNodeWithin(ctx, p.pos, settingsOf(ctx).snapDistance.value);
        if (near) {
          if (p.external) ctx.patch('NetNode', near, { external: { label: p.external.label, distanceKm: p.external.distanceKm, ...(p.external.surface ? { surface: p.external.surface } : {}) } });
          return near;
        }
        return createNode(ctx, p.pos, p.external);
      },
      'Add network node',
    ),
    'network.addPolyline': command(
      s.object({
        points: s.array(s.point()),
        open: s.boolean(),
        surface: s.string(),
        width: s.number({ min: 0, unit: 'm' }),
        speedLimit: s.number({ min: 0, unit: 'km/h' }),
        asset: s.ref().optional(),
        label: s.string().optional(),
      }),
      addPolyline,
      'Add network polyline',
    ),
    'network.updateEdges': command(
      s.object({ edges: s.array(s.ref(EDGE_KIND)), patch: EdgePatchSchema }),
      (ctx, p) => {
        const patch: Partial<NetEdge> = {};
        for (const k of ['open', 'surface', 'speedFactor', 'width', 'speedLimit'] as const) {
          if (p.patch[k] !== undefined) (patch as Record<string, unknown>)[k] = p.patch[k];
        }
        for (const id of p.edges) {
          if (!ctx.has('NetEdge', id)) ctx.reject('network.unknownEdge', { edge: id });
          ctx.patch('NetEdge', id, patch);
        }
        if (p.edges.length) ctx.emit('network.changed', { edges: [...p.edges], reason: 'updated' });
        return p.edges.length;
      },
      'Update network edges',
    ),
    'network.removeEdges': command(
      s.object({ edges: s.array(s.ref(EDGE_KIND)) }),
      (ctx, p) => {
        const touched = new Set<EntityId>();
        let n = 0;
        const ids = [...new Set(p.edges)];
        for (const id of ids) {
          const e = ctx.get('NetEdge', id);
          if (!e) return ctx.reject('network.unknownEdge', { edge: id });
          touched.add(e.a);
          touched.add(e.b);
          ctx.destroy(id);
          n += 1;
        }
        // drop nodes left without edges (external connections stay)
        const used = new Set<EntityId>();
        for (const [, e] of ctx.all('NetEdge')) {
          used.add(e.a);
          used.add(e.b);
        }
        for (const id of touched) {
          const node = ctx.get('NetNode', id);
          if (node && !node.external && !used.has(id)) ctx.destroy(id);
        }
        if (n) ctx.emit('network.changed', { edges: ids, reason: 'removed' });
        return n;
      },
      'Remove network edges',
    ),
  },
  ports: { routing: createRoutingPort },
  projections: {
    'network.graph': {
      label: 'Network nodes and edges',
      compute: (ctx) => ({
        nodes: [...ctx.all('NetNode')].map(([id, n]) => ({ id, ...n })),
        edges: [...ctx.all('NetEdge')].map(([id, e]) => ({ id, ...e })),
      }),
    },
  },
});
