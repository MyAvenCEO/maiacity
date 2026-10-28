/**
 * Stochastic daily/hourly weather generator — a WGEN-style model (Richardson 1981, Water Resour.
 * Res. 17:182–190; Richardson & Wright 1984, USDA ARS-8) driven by monthly climate normals.
 *
 * Weather is a PURE function of (seed, climate data, sim time). The only sequential parts are the
 * wet/dry Markov chain and the AR(1) temperature and wind anomalies; their per-day state is
 * recomputed from the chain head (day 0) on demand, with a checkpoint every CHECKPOINT days so
 * that random access costs at most CHECKPOINT steps once the region has been visited. Everything
 * else for a day is drawn from a counter-based generator keyed by (seed, day), so caches are pure
 * memoisation and can be dropped at any time.
 *
 * Day pipeline (all daily climatological values are smooth curves from monthly normals, see
 * `dailyFromMonthly`):
 *  1. occurrence  wet_d (≥ 1 mm) ~ Markov(p01 = π(1−r), p11 = p01 + r), π = wetDays / days in month,
 *                 r = p11 − p01 (persistence). The chain's stationary probability is exactly π.
 *  2. amount      wet: A = shift + Gamma(k, θ), θ = (μ − shift)/k with μ = (P̄ − E[trace]) / π so that the
 *                 long-run total equals the precipitation normal. Dry (< 1 mm) days get trace
 *                 precipitation 0.1–0.9 mm with probability q = (days≥0.1 − days≥1)/(days − days≥1).
 *                 Amounts are rounded to the 0.1 mm gauge resolution, like DWD observations.
 *  3. sunshine    relative sunshine s = S/N (N astronomical day length) ~ Beta with mean s̄_state, where
 *                 s̄_wet = ρ_s·s̄_dry and π s̄_wet + (1−π) s̄_dry = s̄ (monthly normal / ΣN).
 *  4. cloud       C = 1 − s·(1 − C̄)/s̄ (linear through overcast = no sun and the cloud normal C̄), else C = 1 − s.
 *  5. temperature Tmean = T̄_state + sd'·z, z AR(1): z_d = ρ z_{d−1} + √(1−ρ²) ε (unit variance).
 *                 T̄_state shifts Tmax/Tmin by the observed wet−dry differences (WGEN conditioning),
 *                 mean-preserving: x̄_wet = x̄ + Δ(1−π), x̄_dry = x̄ − Δπ. sd' removes the variance the
 *                 conditioning adds, so total daily sd equals the data. Diurnal range is scaled by
 *                 sunshine: f = 1 + β(s − s̄_state) (clear days larger range, cloudy days smaller).
 *  6. wind        lognormal around the monthly mean with an AR(1) (ρ_w) log-anomaly.
 *  7. humidity    normal ± wet-day shift + noise; hourly RH from constant daily vapour pressure.
 * Hours: two-piece cosine temperature curve (Tmin at sunrise, Tmax at tMaxHour; cf. Parton & Logan
 * 1981, Agric. Meteorol. 23:205–216), precipitation in contiguous-ish blocks of `wetHours` hours,
 * GHI = Haurwitz clear sky × Kasten–Czeplak cloud factor, sun by the NOAA algorithm.
 */
import { convert, DAY, daysFromCivil, HOUR, hashNoise, hash32, Rng, type Calendar, type Provenance } from '../../kernel/src/index.ts';
import { SERIES_FIELDS, SERIES_UNITS, type Climate, type DayWeather, type ForecastDay, type HourWeather, type SeriesField, type SunPosition, type WeatherBinding, type WeatherPort, type WeatherSeries } from './contract.ts';
import { dailyFromMonthly, dayInfo, invNorm, MONTH_DAYS, satVapourPressure, type DayInfo } from './math.ts';
import { clearSkyGhiIneichen, cloudFactor, dayLengthClimatological, sunPosition, sunTimes } from './solar.ts';

// ---------------------------------------------------------------------------------------------
// Model constants that the climate catalog does not (yet) carry. Each is a documented
// assumption; move it into the data pack when a calibrated value becomes available.
// ---------------------------------------------------------------------------------------------
/** checkpoint spacing of the sequential chain state (days) */
const CHECKPOINT = 32;
/** relative sunshine of wet days ÷ that of dry days (assumption; wet ≥ 1 mm days are mostly overcast) */
const WET_SUN_RATIO = 0.35;
/** Beta concentration (a + b) of daily relative sunshine — U-shaped in winter, broad in summer */
const SUN_CONCENTRATION = 2.5;
/** diurnal-range sensitivity to relative sunshine anomaly (1/1) */
const RANGE_SUN_BETA = 1.0;
/** RH wet − dry difference (percentage points) and day-to-day noise sd */
const RH_WET_SHIFT = 8;
const RH_NOISE_SD = 4;
/** default trace-day probability on < 1 mm days, when precipDays01 is absent */
const DEFAULT_TRACE_PROB = 0.2;
/** share of wet-hour variability explained by the day's amount: n = H̄·((1−w)·L + w·A/μ) */
const WET_HOURS_AMOUNT_WEIGHT = 0.5;
/** daily precipitation ≥ this is a heavy-rain day (the ETCCDI climate index R10mm) */
const HEAVY_RAIN_MM = 10;
/**
 * Default monthly Linke turbidity for central European lowland sites (approximate climatology after
 * Remund, Wald, Lefèvre, Ranchin & Page 2003, "Worldwide Linke turbidity information", ISES Solar
 * World Congress; SoDa TL maps): low in winter, ≈ 4.5 in summer haze.
 */
const DEFAULT_LINKE = [3.0, 3.3, 3.7, 4.1, 4.3, 4.5, 4.6, 4.5, 4.0, 3.6, 3.2, 3.0];
/** precipitation falls as snow at or below this air temperature (°C) */
const SNOW_TEMP = 0.5;

// random sub-streams (hashNoise coordinates)
const S_OCC = 1;
const S_TEMP = 2;
const S_WIND = 3;
const S_DAY = 4;
const S_HOUR = 5;
/** wind direction: its own noise stream, so adding it changed no other draw */
const S_DIR = 6;

type Table = { 365: Float64Array; 366: Float64Array };

interface Climatology {
  tMean: Table;
  tMax: Table;
  tMin: Table;
  tSd: Table;
  tRho: Table;
  dTMax: Table;
  dTMin: Table;
  /** mean daily precipitation (mm/d) */
  pDaily: Table;
  /** P(wet ≥ 1 mm) */
  pi: Table;
  /** persistence r = p11 − p01 */
  r: Table;
  shape: Table;
  /** P(trace | day < 1 mm) */
  trace: Table;
  /** mean relative sunshine */
  sun: Table;
  /** mean cloud cover fraction, or null */
  cloud: Table | null;
  wind: Table;
  rh: Table;
  /** cumulative sector frequencies of the wind rose (12 sectors of 30°), all hours and rain hours */
  roseAll: number[];
  roseRain: number[];
  wetHours: Table;
  tMaxHour: Table | null;
  linke: Table;
  shift: number;
}

const monthLen = (m: number): number => (m === 1 ? 28.25 : MONTH_DAYS[m]!);
const constant = (v: number): Table => ({ 365: new Float64Array(366).fill(v), 366: new Float64Array(367).fill(v) });

/** cumulative, normalised frequencies */
function cumulative(freq: number[]): number[] {
  const total = freq.reduce((a, x) => a + Math.max(0, x), 0);
  if (!(total > 0)) throw new Error('climate.windRose: the sector frequencies must add up to more than 0');
  let acc = 0;
  return freq.map((x) => (acc += Math.max(0, x) / total));
}

function buildClimatology(c: Climate): Climatology {
  const mo = c.monthly;
  const g = c.generator;
  const lat = c.station.lat;
  const wetFrac = mo.wetDays.values.map((v, m) => Math.min(0.95, Math.max(0.005, v / monthLen(m))));
  // trace probability on < 1 mm days
  const trace = mo.precipDays01
    ? mo.precipDays01.values.map((v01, m) => {
        const n1 = mo.wetDays.values[m]!;
        return Math.min(0.9, Math.max(0, (v01 - n1) / Math.max(0.5, monthLen(m) - n1)));
      })
    : null;
  // relative sunshine: monthly sunshine hours ÷ astronomical possible hours of that month
  let doy = 1;
  const relSun = mo.sunshine.values.map((h, m) => {
    let possible = 0;
    for (let i = 0; i < MONTH_DAYS[m]!; i += 1) possible += dayLengthClimatological(lat, doy + i, 365);
    doy += MONTH_DAYS[m]!;
    return possible > 0 ? Math.min(0.95, Math.max(0.01, h / possible)) : 0.01;
  });
  const dTx = g.wetTMaxShift?.values ?? new Array<number>(12).fill(-1);
  const dTn = g.wetTMinShift?.values ?? new Array<number>(12).fill(1);
  return {
    tMean: dailyFromMonthly(mo.tMean.values),
    tMax: dailyFromMonthly(mo.tMax.values),
    tMin: dailyFromMonthly(mo.tMin.values),
    tSd: dailyFromMonthly(g.tempAnomalySd.values, 0.1),
    tRho: g.tempAutocorrMonthly ? dailyFromMonthly(g.tempAutocorrMonthly.values, 0, 0.98) : constant(Math.min(0.98, Math.max(0, g.tempAutocorr.value))),
    dTMax: dailyFromMonthly(dTx),
    dTMin: dailyFromMonthly(dTn),
    pDaily: dailyFromMonthly(mo.precip.values.map((p, m) => p / monthLen(m)), 0.01),
    pi: dailyFromMonthly(wetFrac, 0.005, 0.95),
    r: g.wetPersistenceMonthly ? dailyFromMonthly(g.wetPersistenceMonthly.values, -0.5, 0.9) : constant(Math.min(0.9, Math.max(-0.5, g.wetPersistence.value))),
    shape: g.precipGammaShapeMonthly ? dailyFromMonthly(g.precipGammaShapeMonthly.values, 0.2, 10) : constant(Math.max(0.2, g.precipGammaShape.value)),
    trace: trace ? dailyFromMonthly(trace, 0, 0.9) : constant(DEFAULT_TRACE_PROB),
    sun: dailyFromMonthly(relSun, 0.01, 0.95),
    cloud: mo.cloudCover ? dailyFromMonthly(mo.cloudCover.values, 0.02, 1) : null,
    wind: dailyFromMonthly(mo.wind.values, 0.2),
    roseAll: cumulative(c.windRose.all.values),
    roseRain: cumulative(c.windRose.rain.values),
    rh: dailyFromMonthly(mo.relHumidity.values, 20, 100),
    wetHours: g.wetHoursPerWetDayMonthly ? dailyFromMonthly(g.wetHoursPerWetDayMonthly.values, 1, 24) : constant(Math.min(24, Math.max(1, g.wetHoursPerWetDay.value))),
    tMaxHour: g.tMaxHour ? dailyFromMonthly(g.tMaxHour.values, 10, 18) : null,
    linke: dailyFromMonthly(g.linkeTurbidity?.values ?? DEFAULT_LINKE, 1.5, 8),
    shift: g.precipShift?.value ?? 0.95,
  };
}

/** Sequential per-day state (the only part that depends on previous days). */
interface ChainState {
  wet: boolean;
  /** standardised temperature anomaly */
  z: number;
  /** standardised log-wind anomaly */
  w: number;
}

/** Internal day record: the public DayWeather plus what hours need. */
interface DayCalc {
  pub: DayWeather;
  /** precipitation per hour of day (mm) */
  hourly: Float64Array;
  cloud: number;
  /** vapour pressure (hPa) */
  vapour: number;
  /** local hours */
  sunriseH: number;
  tMaxH: number;
  doy: number;
  linke: number;
  /** provenance of the hours (disaggregated hours of a measured day say so) */
  hourProvenance: Provenance;
}

export interface WeatherOptions {
  seed: number;
  calendar: Calendar;
  /** hypothetical branches: from `fromDay` on, days are drawn with the salt mixed in (what-if forks) */
  branches?: readonly WeatherBranch[];
  /** serve days from a recorded series (measured or entered) instead of generating them (decision 0022) */
  series?: { data: ParsedSeries; binding: WeatherBinding };
}

/** a recorded series indexed by civil epoch day, values converted to the contract's units */
export interface ParsedSeries {
  id: string;
  label: string;
  kind: 'measured' | 'entered' | 'external';
  confidence: Provenance['confidence'];
  station?: WeatherSeries['station'];
  /** civil epoch day → values present that day */
  byDay: Map<number, Partial<Record<SeriesField, number>>>;
  /** civil epoch day → when the world received it (delivered data; absent: known from the start) */
  knownFrom?: Map<number, number>;
  first: number;
  last: number;
}

/** a day the bound series cannot provide, under gap policy 'wait' or 'fail' */
export class DataGapError extends Error {
  constructor(
    readonly dataset: string,
    readonly date: string,
    readonly missing: readonly string[],
  ) {
    super(`no data in '${dataset}' for ${date}${missing.length ? ` (${missing.join(', ')})` : ''}`);
    this.name = 'DataGapError';
  }
}

const civil = (epochDay: number): string => {
  const c = dayInfo(epochDay);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.dayOfMonth).padStart(2, '0')}`;
};

/** validate and index a recorded series; units are converted to the contract's (decision 0006) */
export function parseSeries(series: WeatherSeries): ParsedSeries {
  const dateCol = series.columns.indexOf('date');
  if (dateCol < 0) throw new Error(`weather series ${series.id}: needs a 'date' column`);
  const cols = SERIES_FIELDS.map((f) => [f, series.columns.indexOf(f)] as const).filter(([, i]) => i >= 0);
  for (const [f] of cols) if (!series.units[f]) throw new Error(`weather series ${series.id}: no unit declared for ${f}`);
  const byDay = new Map<number, Partial<Record<SeriesField, number>>>();
  let first = Infinity;
  let last = -Infinity;
  for (const row of series.rows) {
    const date = String(row[dateCol]);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) throw new Error(`weather series ${series.id}: bad date ${date}`);
    const ed = daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
    const values: Partial<Record<SeriesField, number>> = {};
    for (const [f, i] of cols) {
      const v = row[i];
      if (v === null || v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`weather series ${series.id}: ${f} on ${date} is not a number`);
      values[f] = convert(v, series.units[f]!, SERIES_UNITS[f]);
    }
    byDay.set(ed, values);
    first = Math.min(first, ed);
    last = Math.max(last, ed);
  }
  const out: ParsedSeries = { id: series.id, label: series.label, kind: series.kind, confidence: series.confidence, byDay, first, last };
  if (series.station) out.station = series.station;
  return out;
}

export interface WeatherBranch {
  fromDay: number;
  /** the moment it began: the hours before it are the parent's (absent: the start of fromDay) */
  fromT?: number;
  salt: number;
}

/** Statistics a caller may want for diagnostics (cache behaviour). */
/** the generator knows every day, the future too (the port guards it: design/physical-state.md I7) */
export interface WeatherGenerator extends Omit<WeatherPort, 'soFar' | 'light' | 'clearLight'> {
  /** number of chain steps computed so far (diagnostics/tests) */
  readonly stats: { chainSteps: number; dayComputations: number };
}

export function createWeather(climate: Climate, opts: WeatherOptions): WeatherGenerator {
  const clim = buildClimatology(climate);
  // the region's fitted generator parameters and its forecast skill (decision 0010)
  const fit = climate.generator;
  const windAutocorr = fit.windAutocorr.value;
  const windLogSd = fit.windLogSd.value;
  const traceMin = fit.traceAmount.min.value;
  const traceSpan = fit.traceAmount.span.value;
  /** mean of min + span·u² */
  const traceMean = traceMin + traceSpan / 3;
  const skill = climate.forecastSkill;
  const { lat, lon } = climate.station;
  const tz = climate.station.utcOffset.value;
  const elevation = climate.station.elevation.value;
  const cal = opts.calendar;
  const seed = (opts.seed ^ hash32('weather')) >>> 0;
  const stats = { chainSteps: 0, dayComputations: 0 };

  const branches = [...(opts.branches ?? [])].sort((a, b) => a.fromDay - b.fromDay);
  /** day d's noise seed: the world seed with the salts of all branches that started on or before d */
  const seedFor = (d: number): number => {
    let s = seed;
    for (const b of branches) if (b.fromDay <= d) s = (Math.imul(s ^ b.salt, 0x85ebca6b) + 0x632be5ab) >>> 0;
    return s;
  };

  const u = (d: number, stream: number, k = 0): number => hashNoise(branches.length ? seedFor(d) : seed, d, stream, k);
  const n01 = (d: number, stream: number, k = 0): number => invNorm(u(d, stream, k) + 2 ** -33);
  /** counter-based RNG for one day's non-sequential draws */
  const dayRng = (d: number): Rng => {
    const st: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) st[i] = Math.floor(u(d, S_DAY, i) * 4294967296) >>> 0;
    st[3] = (st[3]! | 1) >>> 0;
    const rng = new Rng(st);
    for (let i = 0; i < 8; i += 1) rng.nextU32();
    return rng;
  };

  // ---- info + climatology lookup ----
  const infoOf = (d: number): DayInfo => dayInfo(cal.epochDay + d);
  const at = (t: Table, info: DayInfo): number => t[info.yearLen][info.doy]!;

  // ---- sequential chain with checkpoints ----
  // Chain 0 runs forward from day 0; chain 1 runs backward from day −1 (two-state Markov chains
  // and Gaussian AR(1) processes are time-reversible, so the backward chain has the same law).
  const checkpoints: [ChainState[], ChainState[]] = [[], []];
  const last: [{ pos: number; st: ChainState } | null, { pos: number; st: ChainState } | null] = [null, null];
  const dayOfPos = (chain: 0 | 1, pos: number): number => (chain === 0 ? pos : -1 - pos);

  const head = (d: number): ChainState => {
    const info = infoOf(d);
    return { wet: u(d, S_OCC) < at(clim.pi, info), z: n01(d, S_TEMP), w: n01(d, S_WIND) };
  };
  const step = (prev: ChainState, d: number): ChainState => {
    stats.chainSteps += 1;
    const info = infoOf(d);
    const pi = at(clim.pi, info);
    const r = at(clim.r, info);
    // Richardson (1981): p01 = π(1 − r), p11 = p01 + r  ⇒ stationary P(wet) = p01/(1 − r) = π
    const p01 = Math.min(1, Math.max(0, pi * (1 - r)));
    const p11 = Math.min(1, Math.max(0, p01 + r));
    const wet = u(d, S_OCC) < (prev.wet ? p11 : p01);
    const rho = at(clim.tRho, info);
    const z = rho * prev.z + Math.sqrt(1 - rho * rho) * n01(d, S_TEMP);
    const w = windAutocorr * prev.w + Math.sqrt(1 - windAutocorr * windAutocorr) * n01(d, S_WIND);
    return { wet, z, w };
  };

  const chainState = (d: number): ChainState => {
    const chain: 0 | 1 = d >= 0 ? 0 : 1;
    const pos = chain === 0 ? d : -1 - d;
    const ck = checkpoints[chain];
    const lastRec = last[chain];
    if (lastRec && lastRec.pos === pos) return lastRec.st;
    // best known starting point at or before pos
    let startPos = -1;
    let st: ChainState | null = null;
    const ckIdx = Math.min(ck.length - 1, Math.floor((pos + 1) / CHECKPOINT) - 1);
    if (ckIdx >= 0) {
      startPos = ckIdx * CHECKPOINT + CHECKPOINT - 1;
      st = ck[ckIdx]!;
    }
    if (lastRec && lastRec.pos < pos && lastRec.pos > startPos) {
      startPos = lastRec.pos;
      st = lastRec.st;
    }
    if (!st) {
      startPos = 0;
      st = head(dayOfPos(chain, 0));
    }
    for (let p = startPos + 1; p <= pos; p += 1) {
      st = step(st, dayOfPos(chain, p));
      if ((p + 1) % CHECKPOINT === 0 && ck.length === (p + 1) / CHECKPOINT - 1) ck.push(st);
    }
    last[chain] = { pos, st };
    return st;
  };

  // ---- day computation ----
  const dayCache = new Map<number, DayCalc>();
  const DAY_CACHE_MAX = 4096;

  /** what the generator draws for day d, before hours (the order of draws is part of the model) */
  interface DayValues {
    info: DayInfo;
    sunT: ReturnType<typeof sunTimes>;
    dayLen: number;
    pi: number;
    meanWet: number;
    sBar: number;
    precip: number;
    relSun: number;
    tMean: number;
    tMax: number;
    tMin: number;
    wind: number;
    rh: number;
    rng: Rng;
    /** a recorded direction, when the series has one; otherwise drawn from the wind rose */
    windDir?: number;
  }

  /** the day's prevailing wind direction: a sector of the rain rose on wet days, of the all-hours rose otherwise */
  const drawDir = (d: number, wet: boolean): number => {
    const rose = wet ? clim.roseRain : clim.roseAll;
    const x = u(d, S_DIR, 0);
    let k = 0;
    while (k < 11 && x > rose[k]!) k += 1;
    return (k * 30 - 15 + 30 * u(d, S_DIR, 1) + 360) % 360;
  };

  const generate = (d: number): DayValues => {
    const info = infoOf(d);
    const st = chainState(d);
    const rng = dayRng(d);
    const pi = at(clim.pi, info);
    const wet = st.wet;

    // 2. precipitation amount
    const q = at(clim.trace, info);
    const shape = at(clim.shape, info);
    const meanWet = Math.max(clim.shift + 0.2, (at(clim.pDaily, info) - (1 - pi) * q * traceMean) / pi);
    let precip = 0;
    if (wet) precip = clim.shift + rng.gamma(shape, (meanWet - clim.shift) / shape);
    else if (rng.next() < q) precip = traceMin + traceSpan * rng.next() ** 2;
    else rng.next();
    precip = Math.round(precip * 10) / 10;

    // 3. sunshine (relative), conditioned on wet state
    const sunT = sunTimes(info.epochDay, lat, lon, tz);
    const dayLen = Math.max(0, sunT.sunset - sunT.sunrise);
    const sBar = at(clim.sun, info);
    const kDry = 1 / (pi * WET_SUN_RATIO + 1 - pi);
    const sState = Math.min(0.9, sBar * (wet ? WET_SUN_RATIO * kDry : kDry));
    const ga = rng.gamma(sState * SUN_CONCENTRATION, 1);
    const gb = rng.gamma((1 - sState) * SUN_CONCENTRATION, 1);
    const relSun = ga + gb > 0 ? ga / (ga + gb) : sState;

    // 5. temperature
    const dTx = at(clim.dTMax, info);
    const dTn = at(clim.dTMin, info);
    const dTm = (dTx + dTn) / 2;
    const cond = (delta: number): number => (wet ? delta * (1 - pi) : -delta * pi);
    const tMeanB = at(clim.tMean, info) + cond(dTm);
    const tMaxB = at(clim.tMax, info) + cond(dTx);
    const tMinB = at(clim.tMin, info) + cond(dTn);
    const sd = at(clim.tSd, info);
    const sdAr = Math.sqrt(Math.max(0.01, sd * sd - dTm * dTm * pi * (1 - pi)));
    const tMean = tMeanB + sdAr * st.z;
    const f = Math.min(2, Math.max(0.3, 1 + RANGE_SUN_BETA * (relSun - sState)));
    const tMax = tMean + f * Math.max(0.25, tMaxB - tMeanB);
    const tMin = tMean - f * Math.max(0.25, tMeanB - tMinB);

    // 6. wind (lognormal, mean-preserving: E[exp(sZ − s²/2)] = 1)
    const wind = at(clim.wind, info) * Math.exp(windLogSd * st.w - (windLogSd * windLogSd) / 2);

    // 7. humidity
    const rh = Math.min(100, Math.max(25, at(clim.rh, info) + cond(RH_WET_SHIFT) + RH_NOISE_SD * invNorm(rng.next())));
    return { info, sunT, dayLen, pi, meanWet, sBar, precip, relSun, tMean, tMax, tMin, wind, rh, rng };
  };

  /** derive cloud, the hourly rain schedule and the public record from a day's values */
  const finish = (d: number, v: DayValues, provenance: Provenance): DayCalc => {
    const { info, sunT, dayLen, precip, relSun, tMean, tMax, tMin, wind, rh, rng, meanWet, sBar } = v;
    const windDir = v.windDir !== undefined ? ((v.windDir % 360) + 360) % 360 : drawDir(d, precip >= 0.1);
    // 4. cloud cover
    const cBar = clim.cloud ? at(clim.cloud, info) : null;
    const cloud = Math.min(1, Math.max(0, cBar === null ? 1 - relSun : 1 - (relSun * (1 - cBar)) / sBar));

    // hourly precipitation schedule
    const hourly = new Float64Array(24);
    let wetHours = 0;
    if (precip > 0) {
      let n: number;
      if (precip >= 1) {
        const L = Math.exp(0.5 * invNorm(rng.next()) - 0.125); // lognormal, mean 1
        const g = (1 - WET_HOURS_AMOUNT_WEIGHT) * L + (WET_HOURS_AMOUNT_WEIGHT * precip) / meanWet;
        n = Math.min(24, Math.max(1, Math.round(at(clim.wetHours, info) * g)));
      } else n = rng.next() < 0.6 ? 1 : 2;
      const mark = new Array<boolean>(24).fill(false);
      const blocks = n >= 4 && rng.next() < 0.4 ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
      let end = 0;
      for (const len of blocks) {
        const s0 = rng.int(0, 24 - len);
        for (let i = 0; i < len; i += 1) mark[s0 + i] = true;
        end = s0 + len;
      }
      let count = mark.filter(Boolean).length;
      for (let h = end % 24; count < n; h = (h + 1) % 24) {
        if (!mark[h]) {
          mark[h] = true;
          count += 1;
        }
      }
      let wsum = 0;
      const weights = mark.map((m) => (m ? rng.exponential(1) + 1e-6 : 0));
      for (const w of weights) wsum += w;
      for (let h = 0; h < 24; h += 1) hourly[h] = (precip * weights[h]!) / wsum;
      wetHours = n;
    }

    const snow = precip > 0 && tMean <= SNOW_TEMP;
    const kind: DayWeather['kind'] =
      precip >= 1 ? (snow ? 'snow' : precip >= HEAVY_RAIN_MM ? 'heavyRain' : 'rain') : relSun >= 0.6 ? 'clear' : relSun >= 0.25 ? 'fair' : 'overcast';
    const t0 = d * DAY;
    const sunriseH = sunT.kind === 'normal' ? sunT.sunrise : 6;
    const pub: DayWeather = Object.freeze({
      day: d,
      year: info.year,
      month: info.month,
      dayOfMonth: info.dayOfMonth,
      tMin,
      tMax,
      tMean,
      precip,
      wetHours,
      sunshine: relSun * dayLen,
      wind,
      windDir,
      relHumidity: rh,
      frost: tMin < 0,
      ice: tMax < 0,
      snow,
      kind,
      sunrise: t0 + Math.round(sunT.sunrise * HOUR),
      sunset: t0 + Math.round(sunT.sunset * HOUR),
      provenance,
    });
    const tMaxH = clim.tMaxHour ? at(clim.tMaxHour, info) : Math.min(18, sunT.solarNoon + 2.5);
    const hourProvenance = provenance.kind === 'model' ? provenance : Object.freeze({ ...provenance, note: [provenance.note, 'hourly values disaggregated from daily values by the weather model'].filter(Boolean).join('; ') });
    return { pub, hourly, cloud, vapour: (rh / 100) * satVapourPressure(tMean), sunriseH, tMaxH: Math.max(tMaxH, sunriseH + 1), doy: info.doy, linke: at(clim.linke, info), hourProvenance };
  };

  const forecastCache = new Map<Provenance, Provenance>();
  /** a forecast is a model product on top of the truth, whatever the truth's source */
  const forecastProvenance = (truth: Provenance): Provenance => {
    let p = forecastCache.get(truth);
    if (!p) {
      p = Object.freeze({ kind: 'model', source: 'forecast-error-model', confidence: 'medium', note: `errors growing with lead time, on ${truth.kind} truth (${truth.source})` } as Provenance);
      forecastCache.set(truth, p);
    }
    return p;
  };
  const GENERATED: Provenance = Object.freeze({ kind: 'model', source: 'wgen-generator', confidence: 'medium' });
  const BRANCHED: Provenance = Object.freeze({ kind: 'model', source: 'wgen-generator', confidence: 'medium', note: 'what-if branch: this future is re-drawn' });
  const series = opts.series;
  const firstBranch = branches.length ? branches[0]!.fromDay : Infinity;
  const modelled = new Set<SeriesField>(series?.binding.modelledFields ?? []);
  const recordedProvenance = series ? Object.freeze({ kind: series.data.kind, source: series.data.id, confidence: series.data.confidence } as Provenance) : GENERATED;

  /** day d from the bound series; null when the series cannot provide it (a gap) */
  const recorded = (d: number): { calc: DayCalc } | { gap: string[] } => {
    const g = generate(d);
    const values = series!.data.byDay.get(cal.epochDay + d);
    if (!values) return { gap: [] };
    const missing = SERIES_FIELDS.filter((f) => values[f] === undefined && !modelled.has(f));
    if (missing.length) return { gap: missing };
    const fromModel = SERIES_FIELDS.filter((f) => values[f] === undefined);
    const relSun = values.sunshine !== undefined ? (g.dayLen > 0 ? Math.min(1, values.sunshine / g.dayLen) : 0) : g.relSun;
    const v: DayValues = { ...g, precip: values.precip ?? g.precip, relSun, tMean: values.tMean ?? g.tMean, tMax: values.tMax ?? g.tMax, tMin: values.tMin ?? g.tMin, wind: values.wind ?? g.wind, rh: values.relHumidity ?? g.rh, ...(values.windDir !== undefined ? { windDir: values.windDir } : {}) };
    const prov = fromModel.length ? Object.freeze({ ...recordedProvenance, note: `${fromModel.join(', ')} from the weather model (declared by the world author)` }) : recordedProvenance;
    return { calc: finish(d, v, prov) };
  };

  const computeDay = (d: number): DayCalc => {
    stats.dayComputations += 1;
    if (!series || d >= firstBranch) return finish(d, generate(d), d >= firstBranch ? BRANCHED : GENERATED);
    const r = recorded(d);
    if ('calc' in r) return r.calc;
    const date = civil(cal.epochDay + d);
    if (series.binding.gap.policy === 'fallback') {
      return finish(d, generate(d), Object.freeze({ kind: 'model', source: 'wgen-generator', confidence: 'low', note: `fallback: '${series.data.id}' has no ${r.gap.length ? r.gap.join(', ') : 'data'} for ${date}` } as Provenance));
    }
    throw new DataGapError(series.data.id, date, r.gap);
  };


  const calc = (d: number): DayCalc => {
    let c = dayCache.get(d);
    if (!c) {
      c = computeDay(d);
      if (dayCache.size >= DAY_CACHE_MAX) dayCache.delete(dayCache.keys().next().value as number);
      dayCache.set(d, c);
    }
    return c;
  };

  const dayIndex = (t: number): number => Math.floor(t / DAY);

  /** a neighbouring day for the diurnal curve; at the edge of recorded data, the day itself */
  const neighbour = (d: number, self: DayCalc): DayCalc => {
    try {
      return calc(d);
    } catch (e) {
      if (e instanceof DataGapError) return self;
      throw e;
    }
  };

  /** Two-piece diurnal temperature curve, continuous across midnight. h = local hours of day d. */
  const airTemp = (d: number, h: number): number => {
    const D = calc(d);
    const { tMin, tMax } = D.pub;
    if (h < D.sunriseH) {
      const P = neighbour(d - 1, D);
      const start = P.tMaxH - 24;
      const x = (h - start) / (D.sunriseH - start);
      return tMin + (P.pub.tMax - tMin) * 0.5 * (1 + Math.cos(Math.PI * x));
    }
    if (h <= D.tMaxH) {
      const x = (h - D.sunriseH) / (D.tMaxH - D.sunriseH);
      return tMin + (tMax - tMin) * 0.5 * (1 - Math.cos(Math.PI * x));
    }
    // the evening leads to the next day's minimum, if the world knew it then: an hour lived before
    // the next day was delivered keeps the curve it was served (the past does not change)
    const arrived = opts.series?.data.knownFrom?.get(cal.epochDay + d + 1);
    const N = arrived !== undefined && arrived > d * DAY + h * HOUR ? D : neighbour(d + 1, D);
    const x = (h - D.tMaxH) / (N.sunriseH + 24 - D.tMaxH);
    return N.pub.tMin + (tMax - N.pub.tMin) * 0.5 * (1 + Math.cos(Math.PI * x));
  };

  const sun = (t: number): SunPosition => {
    const d = dayIndex(t);
    const p = sunPosition(cal.epochDay + d, (t - d * DAY) / HOUR, lat, lon, tz);
    return { elevation: p.elevation, azimuth: p.azimuth };
  };

  const hour = (t: number): HourWeather => {
    const d = dayIndex(t);
    const h = (t - d * DAY) / HOUR;
    const hi = Math.min(23, Math.floor(h));
    const D = calc(d);
    const precip = D.hourly[hi]!;
    const temp = airTemp(d, h);
    const hu = u(d, S_HOUR, hi);
    const cloud = precip > 0 ? Math.max(D.cloud, 0.9) : Math.min(1, Math.max(0, D.cloud + 0.15 * (2 * hu - 1)));
    const pos = sunPosition(cal.epochDay + d, h, lat, lon, tz);
    const rh = Math.min(100, Math.max(10, (100 * D.vapour) / satVapourPressure(temp)));
    return {
      t,
      airTemp: temp,
      precip,
      snow: precip > 0 && temp <= SNOW_TEMP,
      // diurnal wind cycle (afternoon maximum from daytime mixing), mean-preserving over the day
      wind: D.pub.wind * (1 + 0.25 * Math.cos((2 * Math.PI * (h - 14)) / 24)) * (1 + 0.1 * (2 * u(d, S_HOUR, 100 + hi) - 1)),
      // the day's direction, veering by up to ±20° from hour to hour (assumption)
      windDir: (D.pub.windDir + 20 * (2 * u(d, S_DIR, 10 + hi) - 1) + 360) % 360,
      cloud,
      relHumidity: precip > 0 ? Math.max(rh, 90) : rh,
      ghi: clearSkyGhiIneichen(pos.cosZenith, elevation, D.linke, D.doy) * cloudFactor(cloud),
      sunElevation: pos.elevation,
      sunAzimuth: pos.azimuth,
      daylight: pos.elevation > -0.833,
      provenance: D.hourProvenance,
    };
  };

  const m = climate.monthly;
  return {
    location: { name: climate.station.name, lat, lon, elevation: climate.station.elevation.value },
    stats,
    hour,
    day: (t) => calc(dayIndex(t)).pub,
    days: (t0, t1) => {
      const out: DayWeather[] = [];
      const last = Math.ceil(t1 / DAY) - 1;
      for (let d = dayIndex(t0); d <= last; d += 1) out.push(calc(d).pub);
      return out;
    },
    sun,
    forecast: (issuedAt, n) => {
      const issueDay = dayIndex(issuedAt);
      const out: ForecastDay[] = [];
      // forecast errors are keyed by (issue day, target day): the same bulletin all day, a new one tomorrow
      // salted like the days: a branch's own bulletins get their own errors (no differencing against the parent)
      const fu = (target: number, k: number) => hashNoise(seedFor(issueDay) ^ 0x5f0ca57, issueDay, target, k);
      const fn = (target: number, k: number) => invNorm(fu(target, k) + 2 ** -33);
      for (let lead = 0; lead < Math.max(0, Math.floor(n)); lead += 1) {
        const d = issueDay + lead;
        // the future beyond the data is unknown: a forecast for it rests on the model's climate
        let truth: DayWeather;
        try {
          truth = calc(d).pub;
        } catch (e) {
          if (!(e instanceof DataGapError)) throw e;
          truth = finish(d, generate(d), Object.freeze({ kind: 'model', source: 'wgen-generator', confidence: 'low', note: 'beyond the recorded data' } as Provenance)).pub;
        }
        const info = infoOf(d);
        const sdT = skill.tempSd.value + skill.tempSdPerDay.value * lead;
        const tMax = truth.tMax + sdT * fn(d, 1);
        const tMin = Math.min(tMax - 0.5, truth.tMin + sdT * fn(d, 2));
        // the bulletin issued at midnight looks half a day ahead into the day it names, on average: even today's is not the truth
        const w = Math.exp(-(lead + 0.5) / skill.precipDecay.value);
        const wetTruth = truth.precip >= 1 ? 1 : truth.precip >= 0.1 ? 0.4 : 0;
        const pClim = at(clim.pi, info);
        const pRain = Math.min(0.97, Math.max(0.03, w * wetTruth + (1 - w) * pClim + 0.12 * (1 - w) * fn(d, 3)));
        // climatological amount on a wet day of this month
        const climWet = m.precip.values[truth.month - 1]! / Math.max(1, m.wetDays.values[truth.month - 1]!);
        const precip = Math.max(0, w * truth.precip + (1 - w) * pRain * climWet) * Math.exp(0.35 * (1 - w) * fn(d, 4));
        const wind = truth.wind * Math.exp((skill.windLogSd.value + skill.windLogSdPerDay.value * lead) * fn(d, 5));
        const tMean = (tMax + tMin) / 2;
        const snow = tMean <= 0.5 && pRain >= 0.5;
        // the sky of a dry day: its sunshine as the bulletin knows it (near days the truth, far ones the climate), as the day itself is named
        const len = (truth.sunset - truth.sunrise) / HOUR;
        const sky = Math.min(1, Math.max(0, w * (len > 0 ? truth.sunshine / len : 0) + (1 - w) * at(clim.sun, info) + 0.1 * (1 - w) * fn(d, 6)));
        const kind: DayWeather['kind'] = snow ? 'snow' : pRain >= 0.6 ? (precip >= 10 ? 'heavyRain' : 'rain') : pRain >= 0.35 ? 'overcast' : sky >= 0.6 ? 'clear' : sky >= 0.25 ? 'fair' : 'overcast';
        out.push({
          day: d,
          lead,
          year: truth.year,
          month: truth.month,
          dayOfMonth: truth.dayOfMonth,
          tMin: Math.round(tMin * 10) / 10,
          tMax: Math.round(tMax * 10) / 10,
          precipProbability: Math.round(pRain * 100) / 100,
          precip: Math.round(precip * 10) / 10,
          wind: Math.round(wind * 10) / 10,
          frost: tMin < 0,
          snow,
          kind,
          provenance: forecastProvenance(truth.provenance),
        });
      }
      return out;
    },
    normals: (month) => {
      const i = Math.min(12, Math.max(1, Math.round(month))) - 1;
      return {
        tMean: m.tMean.values[i]!,
        tMin: m.tMin.values[i]!,
        tMax: m.tMax.values[i]!,
        precip: m.precip.values[i]!,
        wetDays: m.wetDays.values[i]!,
        sunshine: m.sunshine.values[i]!,
      };
    },
  };
}
