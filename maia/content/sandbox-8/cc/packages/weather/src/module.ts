/**
 * The `weather` module: owns the `climate` data catalog, provides the `weather` port and emits
 * `weather.dayEnded` at 00:00 every day with the day just past (phase `environment`, before any consumer).
 *
 * The port gives the past and the hour under way, never what is still to come (design/physical-state.md,
 * I7): `day()` of a day not yet over, `hour()` of a later hour and a bulletin issued later throw. What is
 * known of today is `soFar()`; what lies ahead is the forecast and the normals. The whole truth is for the
 * world's definition, tests and the debug view only (`weatherTruth`).
 *
 * Weather is a pure function of (runtime seed, climate data, branches, time). The only state is
 * the list of hypothetical branches (what-if forks re-draw the weather from the next hour on). The
 * generator instance (and its caches) lives in the port factory closure, rebuilt when the branch
 * list changes — so caches are per runtime instance and rebuild after restore.
 */
import { Calendar, command, DAY, defineModule, HOUR, s, type ModelDescriptor, type ModuleDef, type ReadCtx, type WriteCtx } from '../../kernel/src/index.ts';
import { ClimateSchema, SERIES_FIELDS, SERIES_UNITS, WeatherBindingSchema, WeatherSeriesSchema, type Climate, type DayWeather, type HourWeather, type WeatherPort, type WeatherSeries } from './contract.ts';
import { createWeather, parseSeries, type ParsedSeries, type WeatherBranch, type WeatherGenerator, type WeatherOptions } from './generator.ts';
import { outdoorLux } from './solar.ts';

declare module '../../kernel/src/index.ts' {
  interface ModuleStateTypes {
    'weather-generator': WeatherModuleState;
    'weather-measured': WeatherModuleState;
    'weather-entered': WeatherModuleState;
    'weather-external': WeatherModuleState;
  }
}

/** rows delivered over a connection while the world runs (recorded inputs, decision 0016) */
export interface ReceivedSeries {
  label: string;
  /** rows in the contract's units: [date, tMin, tMax, tMean, precip, sunshine, wind, relHumidity] */
  rows: (string | number | null)[][];
  /** what an external model said about itself (Describe) */
  descriptor?: ModelDescriptor;
  /** date → when the world received that day's row */
  arrived?: Record<string, number>;
}

export interface WeatherModuleState {
  branches: WeatherBranch[];
  received?: ReceivedSeries;
}

export const DayWeatherSchema = s.object({
  day: s.int(),
  year: s.int(),
  month: s.int({ min: 1, max: 12 }),
  dayOfMonth: s.int({ min: 1, max: 31 }),
  tMin: s.number({ unit: '°C' }),
  tMax: s.number({ unit: '°C' }),
  tMean: s.number({ unit: '°C' }),
  precip: s.number({ min: 0, unit: 'mm' }),
  wetHours: s.int({ min: 0, max: 24 }),
  sunshine: s.number({ min: 0, unit: 'h' }),
  wind: s.number({ min: 0, unit: 'm/s' }),
  relHumidity: s.number({ min: 0, max: 100, unit: '%' }),
  frost: s.boolean(),
  ice: s.boolean(),
  snow: s.boolean(),
  kind: s.enum(['clear', 'fair', 'overcast', 'rain', 'heavyRain', 'snow'] as const),
  sunrise: s.number({ unit: 's' }),
  sunset: s.number({ unit: 's' }),
  provenance: s.object({ kind: s.enum(['model', 'external', 'measured', 'entered']), source: s.string(), confidence: s.enum(['high', 'medium', 'low']), note: s.string().optional() }),
});

/** Module id of the generator (must differ from the port name 'weather': the kernel forbids port/module-id collisions). */
export const WEATHER_MODULE_ID = 'weather-generator';

/** where the generator is valid: temperate climates with rain all year round (decision 0015) */
export const GENERATOR_VALIDITY = { annualMeanTemp: [-5, 20] as [number, number], annualPrecip: [250, 1600] as [number, number], precipMonthRatio: [1, 4] as [number, number] };

export const GENERATOR_MODEL: ModelDescriptor = {
  contract: 'weather',
  implementation: 'wgen-generator',
  kind: 'model',
  label: 'Stochastic weather generator (WGEN type), fitted to climate normals',
  validity: { ranges: { ...GENERATOR_VALIDITY }, notes: 'fitted and validated on a temperate station with rain all year (see the sources of the region climate data); no convective afternoon peak, no wet/dry-season dynamics beyond the monthly normals' },
  resolution: 'daily Markov/AR(1) chain, hours disaggregated',
  confidence: 'medium',
  sources: [{ title: 'Richardson 1981, A stochastic model of daily precipitation, temperature and solar radiation', publisher: 'Water Resources Research 17:182–190' }, { title: 'Richardson & Wright 1984, WGEN', publisher: 'USDA ARS-8' }],
};

const recordedModel = (kind: 'measured' | 'entered' | 'external'): ModelDescriptor => ({
  contract: 'weather',
  implementation: `${kind}-series`,
  kind,
  label: kind === 'measured' ? 'Measured day series (e.g. a weather station)' : kind === 'entered' ? 'Entered day series (typed in or imported by the world author)' : 'External weather model over the gRPC bridge (not described yet)',
  validity: { notes: 'valid at the station or place the series was recorded for and within its period; hours are disaggregated by the weather model' },
  resolution: 'daily values, hours disaggregated',
  confidence: kind === 'measured' ? 'high' : 'medium',
  sources: [],
});

/** climate figures the generator's validity is declared on */
export function climateFigures(c: Climate): { annualMeanTemp: number; annualPrecip: number; precipMonthRatio: number } {
  const p = c.monthly.precip.values;
  return {
    annualMeanTemp: c.monthly.tMean.values.reduce((a, b) => a + b, 0) / 12,
    annualPrecip: p.reduce((a, b) => a + b, 0),
    precipMonthRatio: Math.max(...p) / Math.max(1, Math.min(...p)),
  };
}

/** record where the generator is used outside the climates it was validated for */
function checkGeneratorValidity(ctx: WriteCtx): void {
  const f = climateFigures(ctx.data('climate'));
  const out: string[] = [];
  const fmt = (x: number) => Math.round(x * 10) / 10;
  if (f.annualMeanTemp < GENERATOR_VALIDITY.annualMeanTemp[0] || f.annualMeanTemp > GENERATOR_VALIDITY.annualMeanTemp[1]) out.push(`annual mean ${fmt(f.annualMeanTemp)} °C outside ${GENERATOR_VALIDITY.annualMeanTemp.join('…')} °C`);
  if (f.annualPrecip < GENERATOR_VALIDITY.annualPrecip[0] || f.annualPrecip > GENERATOR_VALIDITY.annualPrecip[1]) out.push(`annual precipitation ${Math.round(f.annualPrecip)} mm outside ${GENERATOR_VALIDITY.annualPrecip.join('…')} mm`);
  if (f.precipMonthRatio > GENERATOR_VALIDITY.precipMonthRatio[1]) out.push(`wettest/driest month ratio ${fmt(f.precipMonthRatio)} above ${GENERATOR_VALIDITY.precipMonthRatio[1]} (strong wet and dry seasons)`);
  if (out.length) ctx.outsideValidity('weather', `weather generator used outside the climates it was validated for: ${out.join('; ')} — its weather is an estimate`);
}

/** great-circle distance (km) */
const distanceKm = (aLat: number, aLon: number, bLat: number, bLon: number): number => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLon - aLon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};
/** a station further away than this does not measure the world's weather */
export const STATION_DISTANCE_KM = 25;

const parsedCache = new WeakMap<WeatherSeries, ParsedSeries>();
const parsed = (s: WeatherSeries): ParsedSeries => {
  let p = parsedCache.get(s);
  if (!p) {
    p = parseSeries(s);
    parsedCache.set(s, p);
  }
  return p;
};

type WeatherModuleId = 'weather-generator' | 'weather-measured' | 'weather-entered' | 'weather-external';
type SourceKind = 'model' | 'measured' | 'entered' | 'external';

const COLUMNS = ['date', 'tMin', 'tMax', 'tMean', 'precip', 'sunshine', 'wind', 'relHumidity', 'windDir'];
const receivedCache = new WeakMap<ReceivedSeries, ParsedSeries>();

/** options of the bound series, if this module serves one: a dataset, or what a connection delivered */
function seriesOptions(ctx: ReadCtx, id: WeatherModuleId, kind: SourceKind): WeatherOptions['series'] {
  if (kind === 'model') return undefined;
  const binding = ctx.data('weatherBinding');
  if (binding.dataset) {
    const series = (ctx.hasData('weatherSeries') ? ctx.data('weatherSeries') : undefined)?.[binding.dataset];
    if (!series) throw new Error(`weather binding: dataset '${binding.dataset}' is not in the world's data`);
    return { data: parsed(series), binding };
  }
  if (!binding.connection) throw new Error('weather binding: needs a dataset or a connection');
  const received = ctx.state(id).received ?? { label: binding.connectionLabel ?? binding.connection, rows: [] };
  let p = receivedCache.get(received);
  if (!p) {
    const conf = received.descriptor?.confidence ?? (kind === 'measured' ? 'high' : 'medium');
    p = parseSeries({ id: binding.connection, label: received.label, kind: kind as 'measured' | 'entered' | 'external', confidence: conf, source: { title: received.label }, columns: COLUMNS, units: SERIES_UNITS, rows: received.rows });
    p.knownFrom = new Map(Object.entries(received.arrived ?? {}).map(([date, t]) => [Calendar.fromDate(parseDate(date)).epochDay, t]));
    receivedCache.set(received, p);
  }
  return { data: p, binding };
}

const RowSchema = s.array(s.any<string | number | null>());

function makeWeatherModule(id: WeatherModuleId, kind: SourceKind): ModuleDef {
  const recorded = kind !== 'model';
  return defineModule({
    id,
    label: recorded ? `Weather (${kind} data)` : 'Weather',
    description: recorded
      ? `Weather from a ${kind} day series bound by the world definition, with its gap policy; hours, sun and forecasts from the weather model.`
      : 'Stochastic weather generator (WGEN-style) driven by climate normals; pure function of seed + climate + time.',
    provides: ['weather'],
    data: recorded ? { climate: ClimateSchema, weatherSeries: s.record(WeatherSeriesSchema).optional(), weatherBinding: WeatherBindingSchema } : { climate: ClimateSchema },
    state: { initial: (): WeatherModuleState => ({ branches: [] }) },
    models: kind === 'external' ? (read: ReadCtx) => [read.state(id).received?.descriptor ?? recordedModel(kind)] : [recorded ? recordedModel(kind) : GENERATOR_MODEL],
    commands: recorded
      ? {
          // what a connection of the world definition delivers while the world runs — never players (decision 0021)
          'weather.record': command(
            s.object({ rows: s.array(RowSchema), label: s.string().optional() }),
            (ctx: WriteCtx, p) => {
              const st = ctx.state(id);
              const old = st.received ?? { label: p.label ?? ctx.data('weatherBinding').connectionLabel ?? ctx.data('weatherBinding').connection ?? id, rows: [] };
              const today = Math.floor(ctx.now / DAY);
              const known = new Map(old.rows.map((r) => [String(r[0]), r]));
              const arrived = { ...(old.arrived ?? {}) };
              let accepted = 0;
              const rejected: { date: string; reason: string }[] = [];
              for (const row of p.rows) {
                const date = String(row[0]);
                const d = (Calendar.fromDate(parseDate(date)).epochDay - ctx.calendar.epochDay);
                // the past is history: a day the world has entered keeps what it was served (even by the
                // model under a fallback). A waiting world stands before the day it waits for (at the
                // very start, at its first midnight, not yet served); any other world began the day at midnight
                const waiting = ctx.data('weatherBinding').gap.policy === 'wait';
                if (d < today || (d === today && (known.has(date) || ctx.now > today * DAY || !waiting))) {
                  rejected.push({ date, reason: 'the world has already entered this day (the past is history)' });
                  continue;
                }
                if (row.length !== COLUMNS.length) ctx.reject('weather.badRow', { date, columns: row.length });
                const bad = implausible(row);
                if (bad) {
                  rejected.push({ date, reason: bad });
                  continue;
                }
                known.set(date, row);
                arrived[date] = ctx.now;
                accepted += 1;
              }
              const rows = [...known.values()].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
              ctx.setState(id, { ...st, received: { ...old, ...(p.label ? { label: p.label } : {}), rows, arrived } });
              return { accepted, rejected };
            },
            { label: 'Record delivered weather', internal: true, input: true },
          ),
          'weather.describe': command(
            s.object({ descriptor: s.any<ModelDescriptor>() }),
            (ctx: WriteCtx, p) => {
              const st = ctx.state(id);
              ctx.setState(id, { ...st, received: { ...(st.received ?? { label: p.descriptor.label, rows: [] }), label: p.descriptor.label, descriptor: { ...p.descriptor, contract: 'weather', kind } } });
            },
            { label: 'An external weather model describes itself', internal: true, input: true },
          ),
        }
      : {},
    blockers: { 'weather.badRow': 'weather row for {date} has {columns} columns' },
    setup(ctx) {
      const opts = seriesOptions(ctx, id, kind);
      if (!opts) return checkGeneratorValidity(ctx);
      // the generator stands in where the author allowed it (modelled fields, fallback): its validity matters then
      if (opts.binding.gap.policy === 'fallback' || opts.binding.modelledFields?.length) checkGeneratorValidity(ctx);
      const st = opts.data.station;
      const here = ctx.data('climate').station;
      if (st) {
        const km = distanceKm(st.lat, st.lon, here.lat, here.lon);
        if (km > STATION_DISTANCE_KM) ctx.outsideValidity('weather', `series '${opts.data.id}' was measured at ${st.name}, ${Math.round(km)} km from this world — it does not measure this place's weather`);
      }
    },
    horizon(read) {
      const opts = seriesOptions(read, id, kind);
      if (!opts || opts.binding.gap.policy !== 'wait') return null;
      const branches = read.state(id).branches;
      const d0 = Math.floor(read.now / DAY);
      const gap = firstGapOf(opts, read.calendar.epochDay, d0, branches.length ? branches[0]!.fromDay : Infinity);
      if (gap === null) return null;
      // the world may run to the last second before the first day without data
      return { until: gap * DAY - 1, reason: `waiting for ${kind} weather data: '${opts.data.label}' has no complete record for ${read.calendar.format(gap * DAY, 'date')}` };
    },
    branch(ctx, salt) {
      const st = ctx.state(id);
      // a fork keeps what was delivered; its future is re-drawn from tomorrow on
      // a fork keeps what has been and the hour under way; from the next hour on, the weather is drawn again
      // (the rest of today too: a fork must not replay the day's true evening, design/physical-state.md I7)
      ctx.setState(id, { ...st, branches: [...st.branches, { fromDay: Math.floor(ctx.now / DAY), fromT: (Math.floor(ctx.now / HOUR) + 1) * HOUR, salt }] });
    },
    events: { 'weather.dayEnded': DayWeatherSchema },
    systems: [
      {
        id: 'dayEnd',
        every: DAY,
        offset: 0,
        phase: 'environment',
        run: (ctx) => {
          if (ctx.now >= DAY) ctx.emit('weather.dayEnded', { ...ctx.port('weather').day(ctx.now - DAY) });
        },
      },
    ],
    ports: {
      weather: (ctx): WeatherPort => {
        const make = (branches: readonly WeatherBranch[]): WeatherGenerator => {
          const series = seriesOptions(ctx, id, kind);
          return createWeather(ctx.data('climate'), { seed: ctx.seed, calendar: ctx.calendar, branches, ...(series ? { series } : {}) });
        };
        // rebuilt when a branch starts or new data arrive (state objects are replaced, never mutated)
        let key: WeatherModuleState | null = null;
        let gen: WeatherGenerator | null = null;
        const g = (): WeatherGenerator => {
          const st = ctx.state(id);
          if (!gen || st !== key) {
            gen = make(st.branches);
            key = st;
          }
          return gen;
        };
        // the world as it was before a branch began: the weather of the first n branches (a fork re-draws from the
        // hour after it began; the hour under way and all before it are the parent's)
        const earlier = new Map<number, WeatherGenerator>();
        let earlierKey: WeatherModuleState | null = null;
        const upTo = (n: number): WeatherGenerator => {
          const st = ctx.state(id);
          if (n >= st.branches.length) return g();
          if (st !== earlierKey) {
            earlier.clear();
            earlierKey = st;
          }
          let e = earlier.get(n);
          if (!e) earlier.set(n, (e = make(st.branches.slice(0, n))));
          return e;
        };
        const startOf = (b: WeatherBranch) => b.fromT ?? b.fromDay * DAY;
        const inForce = (t: number) => ctx.state(id).branches.filter((b) => startOf(b) <= t).length;
        // a bulletin issued before a branch began was issued in the parent world: same truth, same errors
        const forecastGen = (t: number): WeatherGenerator => upTo(inForce(Math.floor(t / DAY) * DAY));
        const hourAt = (t: number) => upTo(inForce(t)).hour(t);
        // a day a branch began in the middle of: its hours spliced (the parent's, then the branch's), the day from them
        const dayAt = (t: number): DayWeather => {
          const d0 = Math.floor(t / DAY) * DAY;
          return ctx.state(id).branches.some((b) => startOf(b) > d0 && startOf(b) < d0 + DAY) ? soFar(hourAt, upTo(inForce(d0 + DAY - 1)).day(d0), d0, d0 + DAY) : upTo(inForce(d0)).day(t);
        };
        const daysAt = (t0: number, t1: number): DayWeather[] => {
          const out: DayWeather[] = [];
          for (let d = Math.floor(t0 / DAY); d <= Math.ceil(t1 / DAY) - 1; d += 1) out.push(dayAt(d * DAY));
          return out;
        };
        // the past and the hour under way, never what is still to come
        const future = (what: string, t: number): never => {
          throw new Error(`weather: ${what} ${ctx.calendar.format(t)} is in the future (now ${ctx.calendar.format(ctx.now)}): read the forecast, the normals or the day so far`);
        };
        const hourKnown = (t: number) => Math.floor(t / HOUR) * HOUR <= ctx.now;
        const dayOver = (t: number) => (Math.floor(t / DAY) + 1) * DAY <= ctx.now;
        const port: WeatherPort = {
          get location() {
            return g().location;
          },
          hour: (t) => (hourKnown(t) ? hourAt(t) : future('the hour', t)),
          day: (t) => (dayOver(t) ? dayAt(t) : future('the whole of the day', t)),
          days: (t0, t1) => (t1 <= Math.floor(ctx.now / DAY) * DAY ? daysAt(t0, t1) : future('the days up to', t1)),
          soFar: (t) => (Math.floor(t / DAY) * DAY <= ctx.now ? soFar(hourAt, g().day(t), Math.floor(t / DAY) * DAY, Math.min(t, ctx.now)) : future('the day', t)),
          sun: (t) => g().sun(t),
          light: (t) => (hourKnown(t) ? outdoorLux(g().sun(t).elevation, hourAt(t).cloud) : future('the light at', t)),
          clearLight: (t) => outdoorLux(g().sun(t).elevation),
          forecast: (t, n) => (t <= ctx.now ? forecastGen(t).forecast(t, n) : future('a bulletin issued', t)),
          normals: (m) => g().normals(m),
        };
        const truth: WeatherTruth = {
          get location() {
            return g().location;
          },
          hour: hourAt,
          day: dayAt,
          days: daysAt,
          sun: (t) => g().sun(t),
          light: (t) => outdoorLux(g().sun(t).elevation, hourAt(t).cloud),
          clearLight: (t) => outdoorLux(g().sun(t).elevation),
          forecast: (t, n) => forecastGen(t).forecast(t, n),
          normals: (m) => g().normals(m),
        };
        return withTruth(port, truth);
      },
    },
  });
}

const TRUTH = Symbol('weather truth');
/** the whole weather, the future included: for the world's definition, tests and the debug view, never for simulation or players */
export type WeatherTruth = Omit<WeatherPort, 'soFar'>;
export const weatherTruth = (read: ReadCtx): WeatherTruth => (read.port('weather') as unknown as Record<symbol, WeatherTruth>)[TRUTH]!;
/** a port with its whole truth attached, for `weatherTruth` (package-internal: the weather modules and the fakes of testing.ts) */
export function withTruth(port: WeatherPort, truth: WeatherTruth): WeatherPort {
  Object.defineProperty(port, TRUTH, { value: truth });
  return port;
}

/** the day from its start to `until` (≤ now), from its hours: what has been seen of it (`whole`: the day for its sun and its name) */
export function soFar(hour: (t: number) => HourWeather, whole: DayWeather, start: number, until: number): DayWeather {
  const hours: { w: HourWeather; f: number }[] = [];
  for (let t = start; t < Math.max(until, start + 1); t += HOUR) hours.push({ w: hour(t), f: Math.min(1, Math.max(0, (until - t) / HOUR)) || (t === start ? 1 : 0) });
  const temps = hours.map((h) => h.w.airTemp);
  const tMin = Math.min(...temps);
  const tMax = Math.max(...temps);
  const precip = hours.reduce((a, h) => a + h.w.precip * h.f, 0);
  const light = hours.filter((h) => h.w.daylight);
  const sunshine = light.reduce((a, h) => a + (1 - h.w.cloud) * h.f, 0);
  const mean = (k: 'wind' | 'relHumidity') => hours.reduce((a, h) => a + h.w[k], 0) / hours.length;
  const snow = hours.some((h) => h.w.snow && h.w.precip > 0);
  const kind: DayWeather['kind'] = snow ? 'snow' : precip >= 10 ? 'heavyRain' : precip >= 1 ? 'rain' : light.length && sunshine / light.length >= 0.6 ? 'clear' : light.length && sunshine / light.length >= 0.25 ? 'fair' : 'overcast';
  return { ...whole, tMin, tMax, tMean: temps.reduce((a, x) => a + x, 0) / temps.length, precip: Math.round(precip * 10) / 10, wetHours: hours.filter((h) => h.w.precip > 0 && h.f > 0).length, sunshine: Math.round(sunshine * 10) / 10, wind: mean('wind'), windDir: hours.at(-1)!.w.windDir, relHumidity: mean('relHumidity'), frost: tMin < 0, ice: tMin < 0 && precip > 0, snow, kind };
}

/** the stochastic generator (binding kind 'model') */
export const weatherModule = makeWeatherModule('weather-generator', 'model');
/** a measured day series bound by the world definition (data: weatherSeries, weatherBinding) */
export const measuredWeatherModule = makeWeatherModule('weather-measured', 'measured');
/** an entered day series bound by the world definition (data: weatherSeries, weatherBinding) */
export const enteredWeatherModule = makeWeatherModule('weather-entered', 'entered');
/** an external weather model over the gRPC bridge (data: weatherBinding with a connection) */
export const externalWeatherModule = makeWeatherModule('weather-external', 'external');

const parseDate = (date: string): { year: number; month: number; day: number } => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`bad date ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
};

/** first day ≥ d0 the bound series cannot provide, before the first branch (null: none) */
/** why a delivered row cannot be weather (null: plausible), in the contract's units */
export function implausible(row: readonly (string | number | null)[]): string | null {
  const v = (f: (typeof SERIES_FIELDS)[number]) => {
    const x = row[COLUMNS.indexOf(f)];
    return typeof x === 'number' ? x : null;
  };
  for (const f of SERIES_FIELDS) {
    const x = row[COLUMNS.indexOf(f)];
    if (x !== null && x !== undefined && (typeof x !== 'number' || !Number.isFinite(x))) return `${f} is not a number`;
  }
  const range = (f: (typeof SERIES_FIELDS)[number], lo: number, hi: number) => {
    const x = v(f);
    return x !== null && (x < lo || x > hi) ? `${f} ${x} ${SERIES_UNITS[f]} is outside ${lo}…${hi}` : null;
  };
  const [lo, mid, hi] = [v('tMin'), v('tMean'), v('tMax')];
  const order = lo !== null && hi !== null && lo > hi + 0.05 ? 'tMin above tMax' : mid !== null && ((lo !== null && mid < lo - 0.05) || (hi !== null && mid > hi + 0.05)) ? 'tMean outside tMin…tMax' : null;
  return range('tMin', -90, 60) ?? range('tMax', -90, 60) ?? range('tMean', -90, 60) ?? order ?? range('precip', 0, 2000) ?? range('sunshine', 0, 24) ?? range('wind', 0, 120) ?? range('relHumidity', 0, 100) ?? range('windDir', 0, 360);
}

function firstGapOf(opts: NonNullable<WeatherOptions['series']>, epochDay: number, d0: number, firstBranch: number): number | null {
  const modelled = new Set(opts.binding.modelledFields ?? []);
  const fields = SERIES_FIELDS;
  for (let d = d0; d < firstBranch; d += 1) {
    const values = opts.data.byDay.get(epochDay + d);
    if (!values) return d;
    if (fields.some((f) => values[f] === undefined && !modelled.has(f))) return d;
  }
  return null;
}
