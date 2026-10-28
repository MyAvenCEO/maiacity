/**
 * Soil state module: daily water balance and frost on a coarse (32 m) grid.
 *
 * Runs at 00:00 in phase 'physical' — after the weather (phase 'environment') — and books
 * the day that has just ended. State is per-cell relative moisture and frost depth plus a
 * few map-wide indices; cell soil parameters are derived from the terrain's soil columns
 * (original surface) and cached per terrain port instance.
 */
import { DAY, HOUR, defineModule, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { clamp, sampleBilinear, type GridSpec } from '../../geo/src/index.ts';
import type { TerrainPort } from '../../terrain/src/index.ts';
import type { WeatherPort } from '../../weather/src/index.ts';
import type { SoilStateModuleState, SoilStatePort, Trafficability } from './contract.ts';
import {
  bucketStep,
  cellSoil,
  CLIMATOLOGICAL_MOISTURE,
  CROP_COEFFICIENT,
  extraterrestrialRadiation,
  frostCoefficient,
  frostStep,
  hargreavesET0,
  SNOW_DDF,
  snowNFactor,
  type CellSoil,
} from './physics.ts';

/** Grid cell size (m): soil moisture and frost vary over tens of metres, not metres. */
export const SOIL_CELL = 32;

/** Trafficability thresholds (relative moisture, rain in the last 24 h in mm). */
export const TRAFFICABILITY = {
  /**
   * Cohesive soils (UL/TL/TM…) lose bearing capacity and cannot be compacted to ZTV E-StB
   * requirements when wetter than about field capacity; after > 15 mm of rain work on them
   * stops (rule of thumb in German earthworks practice: "nach ergiebigem Regen ruhen die
   * Erdarbeiten in bindigen Böden").
   */
  cohesive: { none: 1.0, reduced: 0.85, rainNone: 15 },
  /** Granular soils drain quickly and tolerate much wetter conditions. */
  granular: { none: 1.3, reduced: 1.1, rainNone: 30, rainReduced: 20 },
  /**
   * Frozen ground carries plant well, but frozen soil must not be compacted or built on
   * (ZTV E-StB) — so > 0.1 m frost counts as 'reduced'. While a frozen layer thaws from the
   * top (Tauperiode) cohesive soils turn to mud over an impermeable frozen base → 'none'.
   */
  frostDepth: 0.1,
} as const;

const emptyState = (): SoilStateModuleState => ({
  cell: SOIL_CELL,
  nx: 0,
  nz: 0,
  x0: 0,
  z0: 0,
  moisture: [],
  frostDepth: [],
  freezingIndex: 0,
  thawIndex: 0,
  freezeThawCycles: 0,
  lastFrozen: false,
  snowWater: 0,
});

/** Grid spec of cell CENTRES for sampling. */
const centreGrid = (st: Readonly<SoilStateModuleState>): GridSpec => ({ x0: st.x0, z0: st.z0, cell: st.cell, nx: st.nx, nz: st.nz });

const cellCache = new WeakMap<object, CellSoil[]>();

/** Per-cell soil parameters, derived from the terrain (cached per state of the ground: its heights change with its strata, §5). */
function cellsFor(ctx: ReadCtx, st: Readonly<SoilStateModuleState>): CellSoil[] {
  const terrain = ctx.port('terrain');
  const key = terrain.heights();
  const hit = cellCache.get(key);
  if (hit && hit.length === st.nx * st.nz) return hit;
  const cells: CellSoil[] = [];
  for (let j = 0; j < st.nz; j += 1) {
    for (let i = 0; i < st.nx; i += 1) {
      const col = terrain.soilAt(st.x0 + i * st.cell, st.z0 + j * st.cell);
      cells.push(cellSoil(col.layers, (id) => terrain.soilClass(id)));
    }
  }
  cellCache.set(key, cells);
  return cells;
}

function layout(terrain: TerrainPort): Pick<SoilStateModuleState, 'nx' | 'nz' | 'x0' | 'z0' | 'cell'> {
  const b = terrain.bounds;
  const nx = Math.max(1, Math.ceil((b.x1 - b.x0) / SOIL_CELL));
  const nz = Math.max(1, Math.ceil((b.z1 - b.z0) / SOIL_CELL));
  // cells are centred on the map; centres at x0 + (i + 0.5)·cell of the covering block
  const cx = (b.x0 + b.x1) / 2 - (nx * SOIL_CELL) / 2 + SOIL_CELL / 2;
  const cz = (b.z0 + b.z1) / 2 - (nz * SOIL_CELL) / 2 + SOIL_CELL / 2;
  return { cell: SOIL_CELL, nx, nz, x0: cx, z0: cz };
}

const round = (v: number, k: number): number => Math.round(v * k) / k;

/** a snow pack through a day: solid precipitation is stored, and melts by degree-days */
function snowPack(prev: number, w: { snow: boolean; precip: number; tMean: number }): { snow: number; melt: number } {
  const fallen = prev + (w.snow ? w.precip : 0);
  const melt = Math.min(fallen, SNOW_DDF * Math.max(0, w.tMean));
  return { snow: fallen - melt, melt };
}

function dailyStep(ctx: WriteCtx): void {
  if (ctx.now < DAY) return; // nothing has happened yet at the epoch
  const weather: WeatherPort = ctx.port('weather');
  const st = ctx.state('soil');
  const t = ctx.now - DAY; // the day that just ended
  const w = weather.day(t);
  const cal = ctx.calendar.at(t);
  const cells = cellsFor(ctx, st);

  // season bookkeeping: frost indices count from 1 July (the conventional frost-year start)
  let freezingIndex = st.freezingIndex;
  let thawIndex = st.thawIndex;
  let cycles = st.freezeThawCycles;
  if (cal.month === 7 && cal.day === 1) {
    freezingIndex = 0;
    thawIndex = 0;
    cycles = 0;
  }

  // snow pack: solid precipitation is stored, melts by degree-days
  const { snow, melt } = snowPack(st.snowWater, w);
  const input = (w.snow ? 0 : w.precip) + melt;

  // evapotranspiration demand: none under snow or with frozen plant cover
  const ra = extraterrestrialRadiation(weather.location.lat, cal.dayOfYear);
  const etc = snow > 5 || w.tMean <= 0 ? 0 : CROP_COEFFICIENT * hargreavesET0(w.tMin, w.tMax, w.tMean, ra);

  // freezing / thawing indices (air, K·d) and freeze–thaw cycles
  if (w.tMean < 0) freezingIndex += -w.tMean;
  const anyFrost = st.frostDepth.some((d) => d > 0);
  if (w.tMean > 0 && anyFrost) thawIndex += w.tMean;
  // a cycle = a frost-change day (Frostwechseltag, Tmin < 0 < Tmax, DWD definition) or the
  // first frost-free day after a spell of ice days (Tmax ≤ 0)
  if ((w.tMin < 0 && w.tMax > 0) || (st.lastFrozen && w.tMin >= 0)) cycles += 1;
  const lastFrozen = w.tMax <= 0;

  const n = snowNFactor(st.snowWater);
  const moisture = new Array<number>(cells.length);
  const frostDepth = new Array<number>(cells.length);
  for (let k = 0; k < cells.length; k += 1) {
    const cell = cells[k]!;
    const m0 = st.moisture[k] ?? 1;
    const d0 = st.frostDepth[k] ?? 0;
    const d1 = frostStep(d0, frostCoefficient(cell, m0), w.tMean, n);
    const step = bucketStep(cell, m0, input, etc, d1 > TRAFFICABILITY.frostDepth);
    moisture[k] = round(step.moisture, 1e6);
    frostDepth[k] = round(d1, 1e4);
  }
  ctx.setState('soil', {
    ...st,
    moisture,
    frostDepth,
    freezingIndex: round(freezingIndex, 1e6),
    thawIndex: round(thawIndex, 1e6),
    freezeThawCycles: cycles,
    lastFrozen,
    snowWater: round(snow, 1e6),
  });
}

function createSoilPort(ctx: ReadCtx): SoilStatePort {
  const st = () => ctx.state('soil');
  let rainHour = NaN;
  let rainValue = 0;
  /** liquid precipitation over the last 24 hours (mm), cached per hour */
  const rain24 = (): number => {
    const h = Math.floor(ctx.now / HOUR);
    if (h === rainHour) return rainValue;
    const weather = ctx.port('weather');
    let sum = 0;
    for (let k = 1; k <= 24; k += 1) {
      const t = (h - k) * HOUR;
      if (t < 0) break;
      const hw = weather.hour(t);
      if (!hw.snow) sum += hw.precip;
    }
    rainHour = h;
    rainValue = sum;
    return sum;
  };
  const sample = (arr: readonly number[], x: number, z: number): number => {
    const s = st();
    if (s.nx === 0) return 0;
    return sampleBilinear(centreGrid(s), arr, x, z);
  };
  const port: SoilStatePort = {
    moistureAt: (x, z) => sample(st().moisture, x, z),
    frostDepthAt: (x, z) => sample(st().frostDepth, x, z),
    trafficability(x, z): Trafficability {
      const s = st();
      if (s.nx === 0) return 'good';
      const m = port.moistureAt(x, z);
      const frost = port.frostDepthAt(x, z);
      const g = centreGrid(s);
      const i = clamp(Math.round((x - g.x0) / g.cell), 0, g.nx - 1);
      const j = clamp(Math.round((z - g.z0) / g.cell), 0, g.nz - 1);
      const cell = cellsFor(ctx, s)[j * g.nx + i]!;
      const rain = rain24();
      if (frost > TRAFFICABILITY.frostDepth) {
        const thawing = !s.lastFrozen && ctx.now >= DAY && ctx.port('weather').day(ctx.now - DAY).tMean > 0;
        return cell.cohesive && thawing ? 'none' : 'reduced';
      }
      if (cell.cohesive) {
        const c = TRAFFICABILITY.cohesive;
        if (m > c.none || rain > c.rainNone) return 'none';
        if (m > c.reduced) return 'reduced';
        return 'good';
      }
      const g2 = TRAFFICABILITY.granular;
      if (m > g2.none || rain > g2.rainNone) return 'none';
      if (m > g2.reduced || rain > g2.rainReduced) return 'reduced';
      return 'good';
    },
    freezingIndex: () => st().freezingIndex,
    snowWater: () => st().snowWater,
    snowAfter: (prev, t) => snowPack(prev, ctx.port('weather').day(t)).snow,
    freezeThawCycles: () => st().freezeThawCycles,
    grid() {
      const s = st();
      return { x0: s.x0, z0: s.z0, cell: s.cell, nx: s.nx, nz: s.nz, moisture: s.moisture as number[], frostDepth: s.frostDepth as number[] };
    },
  };
  return port;
}

export const soilModule = defineModule({
  id: 'soil',
  label: 'Soil water & frost',
  description: 'Daily bucket water balance (Hargreaves ET), snow pack, Stefan frost depth and trafficability on a 32 m grid.',
  provides: ['soil-state'],
  requires: ['terrain', 'weather'],
  state: { initial: emptyState },
  systems: [{ id: 'daily', every: DAY, offset: 0, phase: 'physical', run: (ctx) => dailyStep(ctx) }],
  ports: { 'soil-state': (ctx) => createSoilPort(ctx) },
  projections: {
    'soil.summary': {
      label: 'Soil state summary',
      compute: (ctx) => {
        const s = ctx.state('soil');
        const mean = (a: readonly number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
        return {
          meanMoisture: mean(s.moisture),
          maxFrostDepth: s.frostDepth.reduce((a, b) => Math.max(a, b), 0),
          freezingIndex: s.freezingIndex,
          thawIndex: s.thawIndex,
          freezeThawCycles: s.freezeThawCycles,
          snowWater: s.snowWater,
        };
      },
    },
  },
  setup(ctx) {
    // initial moisture: climatological mean for the epoch month (no spin-up history exists)
    const terrain = ctx.port('terrain');
    const lay = layout(terrain);
    const m0 = CLIMATOLOGICAL_MOISTURE[ctx.calendar.at(0).month - 1]!;
    ctx.setState('soil', {
      ...emptyState(),
      ...lay,
      moisture: new Array<number>(lay.nx * lay.nz).fill(m0),
      frostDepth: new Array<number>(lay.nx * lay.nz).fill(0),
    });
  },
});
