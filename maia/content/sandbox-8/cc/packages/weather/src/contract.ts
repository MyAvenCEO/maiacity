/**
 * Weather contract. Weather is an *input timeline*: a pure, deterministic function of
 * (seed, climate data, time). Nothing is stored; any model may query any past/future hour
 * (planning tools may look ahead only through `climate` normals, never `hour()` of the future —
 * the UI enforces that; models must not peek ahead either).
 */
import { s, type Infer, type Provenance } from '../../kernel/src/index.ts';

export const ClimateSchema = s.object({
  station: s.object({
    name: s.string(),
    /** degrees north */
    lat: s.number({ min: -90, max: 90 }),
    /** degrees east */
    lon: s.number({ min: -180, max: 180 }),
    elevation: s.param('m'),
    /** UTC offset of local standard time used by the calendar (Germany: 1) */
    utcOffset: s.param('h'),
  }),
  /**
   * Wind rose: frequency of the direction the wind comes from in 12 sectors of 30° centred on N,
   * 30°, … 330°, over all hours and over the hours with precipitation (which drive rain on walls)
   */
  windRose: s.object({ all: s.series('1', 12), rain: s.series('1', 12) }),
  monthly: s.object({
    tMean: s.series('°C', 12),
    tMax: s.series('°C', 12),
    tMin: s.series('°C', 12),
    precip: s.series('mm', 12),
    /** days with ≥ 1.0 mm */
    wetDays: s.series('d', 12),
    sunshine: s.series('h', 12),
    wind: s.series('m/s', 12),
    relHumidity: s.series('%', 12),
    /** OPTIONAL days with ≥ 0.1 mm (adds trace-precipitation days below the 1 mm threshold); default: 20 % of < 1 mm days */
    precipDays01: s.series('d', 12).optional(),
    /** OPTIONAL mean cloud cover fraction (oktas / 8); default: cloud = 1 − relative sunshine */
    cloudCover: s.series('1', 12).optional(),
  }),
  generator: s.object({
    /** lag-1 autocorrelation of daily temperature anomalies */
    tempAutocorr: s.param('1'),
    /** std dev of daily mean temperature anomaly, per month */
    tempAnomalySd: s.series('K', 12),
    /** P(wet | previous day wet) − P(wet | previous day dry) — persistence of wet spells */
    wetPersistence: s.param('1'),
    /** gamma shape for wet-day precipitation amounts */
    precipGammaShape: s.param('1'),
    /** mean hours with rain on a wet day */
    wetHoursPerWetDay: s.param('h'),
    /** amount of a trace day (0.1 to < 1 mm): min + span·u², u uniform (fitted to the region's gauge record) */
    traceAmount: s.object({ min: s.param('mm'), span: s.param('mm') }),
    /** lag-1 autocorrelation of daily mean wind */
    windAutocorr: s.param('1'),
    /** sd of ln(daily mean wind) */
    windLogSd: s.param('1'),
    // ---- OPTIONAL per-month refinements; when absent the scalar parameters above apply ----
    /** per-month p11 − p01 of the ≥ 1 mm occurrence chain (overrides wetPersistence) */
    wetPersistenceMonthly: s.series('1', 12).optional(),
    /** per-month shape of (amount − precipShift) on ≥ 1 mm days (overrides precipGammaShape) */
    precipGammaShapeMonthly: s.series('1', 12).optional(),
    /** wet-day amount = precipShift + Gamma(shape, scale); default 0.95 mm (1.0 mm threshold − half the 0.1 mm gauge resolution) */
    precipShift: s.param('mm').optional(),
    /** per-month lag-1 autocorrelation of daily-mean anomalies (overrides tempAutocorr) */
    tempAutocorrMonthly: s.series('1', 12).optional(),
    /** WGEN wet-state conditioning: mean Tmax(wet day) − Tmax(dry day), per month; default −1 K */
    wetTMaxShift: s.series('K', 12).optional(),
    /** mean Tmin(wet day) − Tmin(dry day), per month; default +1 K */
    wetTMinShift: s.series('K', 12).optional(),
    /** per-month mean hours with precipitation on ≥ 1 mm days (overrides wetHoursPerWetDay) */
    wetHoursPerWetDayMonthly: s.series('h', 12).optional(),
    /** per-month typical hour of the daily maximum, local standard time; default solar noon + 2.5 h */
    tMaxHour: s.series('h', 12).optional(),
    /** per-month Linke turbidity (air mass 2) for the clear-sky model; default central-European climatology */
    linkeTurbidity: s.series('1', 12).optional(),
  }),
  /**
   * Skill of the weather service's forecasts in the region: errors grow with lead time. Tmax/Tmin
   * error sd = tempSd + tempSdPerDay·lead; the precipitation signal decays towards climatology with
   * e-folding time precipDecay; wind error sd of ln(wind) = windLogSd + windLogSdPerDay·lead.
   */
  forecastSkill: s.object({
    tempSd: s.param('K'),
    tempSdPerDay: s.param('K'),
    precipDecay: s.param('d'),
    windLogSd: s.param('1'),
    windLogSdPerDay: s.param('1'),
  }),
});
export type Climate = Infer<typeof ClimateSchema>;

export interface DayWeather {
  /** day index since epoch (0 = epoch day) */
  day: number;
  year: number;
  month: number;
  dayOfMonth: number;
  tMin: number;
  tMax: number;
  tMean: number;
  /** total precipitation (mm) */
  precip: number;
  /** hours with precipitation */
  wetHours: number;
  sunshine: number;
  wind: number;
  /** prevailing direction the wind comes from (deg clockwise from north) */
  windDir: number;
  relHumidity: number;
  frost: boolean;
  ice: boolean;
  /** precipitation falls as snow (tMean ≤ 0.5 °C) */
  snow: boolean;
  kind: 'clear' | 'fair' | 'overcast' | 'rain' | 'heavyRain' | 'snow';
  sunrise: number;
  sunset: number;
  /** where these values come from: generated, measured, entered … (decision 0022) */
  provenance: Provenance;
}

export interface HourWeather {
  t: number;
  airTemp: number;
  /** precipitation intensity this hour (mm/h) */
  precip: number;
  snow: boolean;
  wind: number;
  /** direction the wind comes from (deg clockwise from north) */
  windDir: number;
  /** cloud cover 0..1 */
  cloud: number;
  relHumidity: number;
  /** global horizontal irradiance (W/m²) */
  ghi: number;
  sunElevation: number;
  sunAzimuth: number;
  daylight: boolean;
  provenance: Provenance;
}

export interface SunPosition {
  /** degrees above horizon */
  elevation: number;
  /** degrees clockwise from north */
  azimuth: number;
}

/** A day of a weather forecast as issued at some time (what planners and players may see). */
export interface ForecastDay {
  day: number;
  /** days ahead of the issue day (0 = today) */
  lead: number;
  year: number;
  month: number;
  dayOfMonth: number;
  tMin: number;
  tMax: number;
  /** probability of ≥ 1 mm */
  precipProbability: number;
  /** expected precipitation (mm) */
  precip: number;
  wind: number;
  frost: boolean;
  snow: boolean;
  kind: DayWeather['kind'];
  /** the forecast is a model product on top of the truth (whatever its source) */
  provenance: Provenance;
}

/**
 * A recorded day series (measured or entered, decision 0022): one row per day,
 * columns as declared, units as declared (converted on load), null = no value.
 */
export const WeatherSeriesSchema = s.object({
  id: s.string(),
  label: s.string(),
  kind: s.enum(['measured', 'entered', 'external']),
  confidence: s.enum(['high', 'medium', 'low']),
  station: s.object({ id: s.string(), name: s.string(), lat: s.number({ min: -90, max: 90 }), lon: s.number({ min: -180, max: 180 }), elevation: s.number() }).optional(),
  source: s.object({ title: s.string(), publisher: s.string().optional(), year: s.int().optional(), url: s.string().optional(), note: s.string().optional() }),
  columns: s.array(s.string()),
  units: s.record(s.string()),
  rows: s.array(s.array(s.any<string | number | null>())),
});
export type WeatherSeries = Infer<typeof WeatherSeriesSchema>;

/** the weather values a recorded day must or may provide */
export const SERIES_FIELDS = ['tMin', 'tMax', 'tMean', 'precip', 'sunshine', 'wind', 'relHumidity', 'windDir'] as const;
export type SeriesField = (typeof SERIES_FIELDS)[number];
export const SERIES_UNITS: Record<SeriesField, string> = { tMin: '°C', tMax: '°C', tMean: '°C', precip: 'mm', sunshine: 'h', wind: 'm/s', relHumidity: '%', windDir: 'deg' };

/**
 * How the weather contract is bound to a recorded series (decisions 0021, 0022): which dataset,
 * which fields the author accepts from the model where the series has none, and the gap policy.
 */
export const WeatherBindingSchema = s.object({
  /** a dataset in the world's data (recorded before play) … */
  dataset: s.string().optional(),
  /** … or a connection of the world definition that delivers the series while the world runs (decision 0024) */
  connection: s.string().optional(),
  /** how players see that connection named (its label in the world definition) */
  connectionLabel: s.string().optional(),
  /** fields taken from the model when the series lacks them (declared by the author, never silent) */
  modelledFields: s.array(s.enum(SERIES_FIELDS)).optional(),
  gap: s.object({ policy: s.enum(['wait', 'fallback', 'fail']) }),
});
export type WeatherBinding = Infer<typeof WeatherBindingSchema>;

export interface WeatherPort {
  readonly location: { name: string; lat: number; lon: number; elevation: number };
  /** the hour containing t: the past or the hour under way (a later one throws: it is the future) */
  hour(t: number): HourWeather;
  /** the day containing t, once it is over (today's whole day, or a later one, throws: it is the future) */
  day(t: number): DayWeather;
  /** all days overlapping [t0, t1), all of them over: from the day containing t0 to the day containing t1 − ε */
  days(t0: number, t1: number): DayWeather[];
  /** the day containing t from its start up to t (or now, if sooner): what has been seen of it, from its hours */
  soFar(t: number): DayWeather;
  sun(t: number): SunPosition;
  /** the light outdoors at t (lx, horizontal): the sun's elevation then, dimmed by the hour's cloud (now or past: S7) */
  light(t: number): number;
  /** the light outdoors at t under a clear sky (lx): astronomy alone, known ahead (when it gets light, when dark) */
  clearLight(t: number): number;
  /**
   * The forecast issued at `issuedAt` (now or before; a later one throws) for `days` days from that day on
   * (lead 0 = today). Errors grow with lead time; the same bulletin is returned all day. This, the normals,
   * the day so far and the past are what anyone in the world may know.
   */
  forecast(issuedAt: number, days: number): ForecastDay[];
  /** long-term normals for a month (1–12) — what planners may legitimately use for look-ahead */
  normals(month: number): { tMean: number; tMin: number; tMax: number; precip: number; wetDays: number; sunshine: number };
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    weather: WeatherPort;
  }
  interface DataTypes {
    climate: Climate;
    weatherSeries?: Record<string, WeatherSeries>;
    weatherBinding: WeatherBinding;
  }
  interface EventTypes {
    /** emitted at 00:00 every day with the day just past (for daily-step models) */
    'weather.dayEnded': DayWeather;
  }
}
