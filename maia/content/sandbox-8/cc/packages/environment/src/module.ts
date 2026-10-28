/**
 * Environment modules: the built-in exposure model, and a recorded exposure series (decision 0015:
 * two implementations of one contract). Both run the stages 2–4 contributions and the practice
 * pack's classifications.
 */
import { daysFromCivil, defineModule, ex, HOUR, DAY, ProvenanceTrail, type ModelDescriptor, type Provenance, type ReadCtx } from '../../kernel/src/index.ts';
import { orientation } from '../../space/src/index.ts';
import type { PlacementIn } from '../../space/src/index.ts';
import type { DayWeather, HourWeather } from '../../weather/src/index.ts';
import { EnvironmentSettingsSchema, ExposureBindingSchema, ExposureClassificationSchema, ExposureSeriesSchema, type AgentHazard, type ClassMetric, type ExposureProfile, type ExposureSeries, type ExposureStage, type HourExposure, type Meets } from './contract.ts';
import { decayTemperatureResponse, dewPoint, evaporation, MAX_DRYING_HOURS, PENMAN, SURFACE_FILM, drivingRainVertical, ERBS, groundStep, GUNN_KINZER, ISO_15927_3, planeIrradiance, SCHEFFER, windFrom } from './physics.ts';
import { s } from '../../kernel/src/index.ts';

export const EXPOSURE_MODEL: ModelDescriptor = {
  contract: 'environment',
  implementation: 'exposure-model',
  kind: 'model',
  label: 'Exposure from the weather at the placement (ISO 15927-3 driving rain, Erbs radiation, ground lag)',
  validity: {
    notes: 'Driving rain is the free-field (airfield) amount for the orientation: no wall factor, terrain roughness, height or obstruction. Surface temperatures are taken as air temperatures. Enclosed spaces are unconditioned (outdoor air, sheltered from rain and sun). Parts in the ground count as wet while unfrozen.',
  },
  resolution: 'hourly',
  confidence: 'medium',
  sources: [ISO_15927_3, ERBS, GUNN_KINZER],
};

interface Situation {
  meets: Meets;
  /** outward normal of the part's exposed side (faces) */
  normal: [number, number, number] | null;
  /** depth of the part's centre in the ground or water (m) */
  depth: number;
}

function situation(read: ReadCtx, at: PlacementIn): Situation {
  if ('space' in at) return { meets: 'space', normal: null, depth: 0 };
  if ('medium' in at) return { meets: at.medium, normal: null, depth: at.depth + (at.thickness ?? 0) / 2 };
  const face = read.get('Face', at.face);
  if (!face) throw new Error(`environment: no face ${at.face}`);
  const side = face.between[at.side];
  const n = face.normal;
  const normal: [number, number, number] = at.side === 1 ? [n[0], n[1], n[2]] : [-n[0], -n[1], -n[2]];
  if (side === 'outside') return { meets: 'outside', normal, depth: 0 };
  if (side === 'ground') return { meets: 'ground', normal: null, depth: 0 };
  return { meets: 'space', normal: null, depth: 0 };
}

const dayOfYear = (read: ReadCtx, t: number): number => {
  const c = read.calendar.at(t);
  return daysFromCivil(c.year, c.month, c.day) - daysFromCivil(c.year, 1, 1) + 1;
};

const NOTES: Record<Meets, string> = {
  outside: 'wet while rain reaches the part and until a 0.5 mm reference film has dried; surface temperature taken as air temperature, so no surface condensation (night-sky cooling not modelled yet); driving rain is the free-field amount for the orientation (no wall factor, roughness or obstruction)',
  space: 'enclosed space without a building-physics model: outdoor air temperature and humidity, sheltered from rain and sun',
  ground: 'in contact with moist soil: counted wet while unfrozen (soil moisture not resolved); temperature lags the air with depth',
  water: 'in water: permanently wet; temperature lags the air with depth',
};

/** the period's profile before agents and classes, from hourly exposures */
interface Accumulated {
  profile: Omit<ExposureProfile, 'agents' | 'classes'>;
}

function accumulate(read: ReadCtx, at: PlacementIn, from: number, to: number, provenance: Provenance): Accumulated {
  const sit = situation(read, at);
  const weather = read.port('weather');
  const settings = read.data('environmentSettings');
  const contributions = read.contributions('exposure').filter((c) => c.impl.hour && (c.impl.stage === 'passive' || c.impl.stage === 'active'));
  contributions.sort((a, b) => (a.impl.stage === b.impl.stage ? 0 : a.impl.stage === 'passive' ? -1 : 1));
  const effects = contributions.map(() => ({ rain: 0, wet: 0, temp: 0, radiation: 0, hours: 0 }));

  // ground and water: the temperature at depth lags the air. It is a function of time, not of the
  // question: a daily chain from the world's first day (starting at the annual mean, where the deep
  // ground is), stepped hourly within each day
  const kappa = settings.soilThermalDiffusivity.value;
  let chainDay = 0;
  const normals = read.data('climate').monthly.tMean.values;
  let chainT = normals.reduce((a, x) => a + x, 0) / normals.length;
  const groundAtDay = (d: number): number => {
    while (chainDay < d) {
      chainT = groundStep(chainT, weather.day(chainDay * DAY).tMean, DAY, sit.depth, kappa);
      chainDay += 1;
    }
    return chainT;
  };
  let tGround = 0;
  let groundDay = -1;
  const horiz = sit.normal ? Math.hypot(sit.normal[0], sit.normal[2]) : 0;
  const nh: [number, number] = horiz > 1e-9 ? [sit.normal![0] / horiz, sit.normal![2] / horiz] : [0, 0];
  const cosTilt = sit.normal ? sit.normal[1] : 1;

  let n = 0;
  let tSum = 0;
  let tMin = Infinity;
  let tMax = -Infinity;
  let frozen: boolean = false;
  let thaws = 0;
  let rhSum = 0;
  let dpSum = 0;
  let dpMin = Infinity;
  let above80 = 0;
  let wetHours = 0;
  let decayHours = 0;
  let water = 0;
  let climateWater = 0;
  let climateWet = 0;
  let freeRain = 0;
  let tow = 0;
  let radiation = 0;
  /** an outside hour from the climate (stage 1) */
  const outsideHour = (t: number, hw: HourWeather): HourExposure => {
    const wf = windFrom(hw.windDir);
    const cosToWind = nh[0] * wf[0] + nh[1] * wf[2];
    const vertical = drivingRainVertical(hw.wind, hw.precip, cosToWind);
    const rain = hw.precip * Math.max(0, cosTilt) + vertical * horiz;
    return { temp: hw.airTemp, rh: hw.relHumidity, rain, wet: rain > 0.01 ? 1 : 0, radiation: planeIrradiance(hw.ghi, hw.sunElevation, hw.sunAzimuth, dayOfYear(read, t), sit.normal!, settings.albedo.value), windNormal: Math.max(0, hw.wind * cosToWind) };
  };
  /** stages 2 and 3 on an hour, without bookkeeping */
  const contributed = (h: HourExposure, hw: HourWeather): HourExposure => contributions.reduce((x, c) => c.impl.hour!(at, x, hw) ?? x, h);
  /** stage 1 for an hour (call with increasing t: the ground keeps its state) */
  const climateHour = (t: number, hw: HourWeather): HourExposure => {
    if (sit.meets === 'outside') return outsideHour(t, hw);
    if (sit.meets === 'space') return { temp: hw.airTemp, rh: hw.relHumidity, rain: 0, wet: 0, radiation: 0, windNormal: 0 };
    const d = Math.floor(t / DAY);
    if (d !== groundDay) {
      groundDay = d;
      tGround = groundAtDay(d);
      for (let t0 = d * DAY; t0 + HOUR <= t + 1e-9; t0 += HOUR) tGround = groundStep(tGround, weather.hour(t0 + HOUR / 2).airTemp, HOUR, sit.depth, kappa);
    }
    tGround = groundStep(tGround, hw.airTemp, HOUR, sit.depth, kappa);
    return { temp: tGround, rh: 100, rain: 0, wet: sit.meets === 'water' || tGround > 0 ? 1 : 0, radiation: 0, windNormal: 0 };
  };
  // the drying film: after rain a surface stays wet until a reference film has evaporated in the
  // following hours — computed from the past only (decision 0004), at most MAX_DRYING_HOURS long
  let film = 0;
  let tailWeight = 0;
  let sinceWet = Infinity;
  const drying = (h: HourExposure, hw: HourWeather): number => {
    if (sit.meets !== 'outside') return 0;
    if (h.wet > 0) {
      film = SURFACE_FILM;
      tailWeight = h.wet;
      sinceWet = 0;
      return 0;
    }
    sinceWet += 1;
    if (film <= 0 || sinceWet > MAX_DRYING_HOURS) return 0;
    const e = evaporation(hw.airTemp, hw.relHumidity, hw.wind, h.radiation);
    const part = e >= film ? film / e : 1;
    film -= e;
    return tailWeight * part;
  };
  const freeze = (temp: number): boolean => {
    if (temp < -0.5) frozen = true;
    else if (temp > 0.5 && frozen) {
      frozen = false;
      return true;
    }
    return false;
  };
  // warm-up: the state at `from` comes from the hours before it, the same whichever period is asked
  for (let t = Math.max(0, from - MAX_DRYING_HOURS * HOUR); t + HOUR <= from + 1e-9; t += HOUR) {
    const hw = weather.hour(t + HOUR / 2);
    const h = contributed(climateHour(t, hw), hw);
    drying(h, hw);
    freeze(h.temp);
  }
  let dryingTail = 0;
  // what the profile rests on: the weather of the period, wherever it came from
  const trail = new ProvenanceTrail();
  for (let t = from; t + HOUR <= to + 1e-9; t += HOUR) {
    const hw = weather.hour(t + HOUR / 2);
    trail.add(hw.provenance);
    let h = climateHour(t, hw);
    climateWater += h.rain;
    climateWet += h.wet;
    contributions.forEach((c, i) => {
      const next = c.impl.hour!(at, h, hw);
      if (!next) return;
      const e = effects[i]!;
      e.rain += next.rain - h.rain;
      e.wet += next.wet - h.wet;
      e.temp += next.temp - h.temp;
      e.radiation += next.radiation - h.radiation;
      e.hours += 1;
      h = next;
    });
    n += 1;
    tSum += h.temp;
    tMin = Math.min(tMin, h.temp);
    tMax = Math.max(tMax, h.temp);
    if (freeze(h.temp)) thaws += 1;
    rhSum += h.rh;
    const dp = dewPoint(h.temp, h.rh);
    dpSum += dp;
    dpMin = Math.min(dpMin, dp);
    if (h.rh > 80) above80 += 1;
    if (h.rh > 80 && h.temp > 0) tow += 1;
    const tail = drying(h, hw);
    dryingTail += tail;
    wetHours += h.wet + tail;
    decayHours += (h.wet + tail) * decayTemperatureResponse(h.temp);
    water += h.rain;
    freeRain += hw.precip;
    radiation += (h.radiation * 3600) / 1e6;
  }
  const notes = [NOTES[sit.meets]];
  const contribs = contributions
    .map((c, i) => ({ c, e: effects[i]! }))
    .filter(({ e }) => e.hours > 0 && (Math.abs(e.rain) > 1e-9 || Math.abs(e.wet) > 1e-9 || Math.abs(e.temp) > 1e-9 || Math.abs(e.radiation) > 1e-9))
    .map(({ c, e }) => ({
      stage: c.impl.stage as ExposureStage,
      module: c.module,
      label: c.impl.label,
      effect: [Math.abs(e.rain) > 1e-9 ? `water ${e.rain > 0 ? '+' : '−'}${Math.abs(e.rain).toFixed(1)} mm` : '', Math.abs(e.wet) > 1e-9 ? `wetted hours ${e.wet > 0 ? '+' : '−'}${Math.abs(e.wet).toFixed(0)} h` : '', Math.abs(e.temp) > 1e-9 ? `temperature ${(e.temp / e.hours).toFixed(1)} K on average` : '', Math.abs(e.radiation) > 1e-9 ? `radiation ${((e.radiation * 3600) / 1e6).toFixed(0)} MJ/m²` : ''].filter(Boolean).join(', '),
    }));
  const climateLabel = sit.meets === 'outside' ? 'climate: rain on the part (ISO 15927-3 driving rain on this orientation + rain on its horizontal share)' : 'climate: no rain reaches the part';
  const drivingRain = ex.sum('water reaching the part', 'mm', ex.value(climateWater, 'mm', climateLabel, sit.meets === 'outside' ? ISO_15927_3 : undefined), ...contribs.map((c, i) => ex.value(effects[contributions.findIndex((x) => x.module === c.module && x.impl.label === c.label)]?.rain ?? 0, 'mm', `${c.stage}: ${c.label}`)).slice(0, 8));
  const wettingHours = ex.sum('area-weighted hours wet', 'h', ex.value(climateWet, 'h', sit.meets === 'outside' ? 'climate: hours with water reaching the part' : sit.meets === 'space' ? 'climate: sheltered' : 'climate: hours in moist, unfrozen ground'), ...contribs.map((c) => ex.value(effects[contributions.findIndex((x) => x.module === c.module && x.impl.label === c.label)]?.wet ?? 0, 'h', `${c.stage}: ${c.label}`)).slice(0, 8), ...(sit.meets === 'outside' ? [ex.value(dryingTail, 'h', `drying after rain: a ${SURFACE_FILM} mm film evaporating (Penman aerodynamic term + half the sunlight)`, PENMAN)] : []));
  return {
    profile: {
      placement: at,
      period: [from, to],
      hours: n,
      meets: sit.meets,
      temperature: { mean: n ? tSum / n : NaN, min: tMin, max: tMax, freezeThawCycles: thaws },
      relativeHumidity: { mean: n ? rhSum / n : NaN, hoursAbove80: above80 },
      dewPoint: { mean: n ? dpSum / n : NaN, min: dpMin },
      wetting: { hours: wetHours, decayHours, drivingRain: water, rain: freeRain },
      timeOfWetness: tow,
      radiation,
      contributions: contribs,
      notes,
      explain: { drivingRain, wettingHours },
      provenance: trail.derive(provenance, 'weather'),
    },
  };
}

function metric(p: Omit<ExposureProfile, 'agents' | 'classes'>, m: ClassMetric): number {
  const perYear = p.hours > 0 ? 8766 / p.hours : 0;
  switch (m) {
    case 'wettingHoursPerYear':
      return p.wetting.hours * perYear;
    case 'decayHoursPerYear':
      return p.wetting.decayHours * perYear;
    case 'timeOfWetnessPerYear':
      return p.timeOfWetness * perYear;
    case 'drivingRainPerYear':
      return p.wetting.drivingRain * perYear;
    case 'hoursAbove80PerYear':
      return p.relativeHumidity.hoursAbove80 * perYear;
    case 'freezeThawCyclesPerYear':
      return p.temperature.freezeThawCycles * perYear;
    case 'meanTemperature':
      return p.temperature.mean;
  }
}

/** stage 4 and the practice pack's classifications */
function finish(read: ReadCtx, at: PlacementIn, acc: Accumulated): ExposureProfile {
  const p = acc.profile;
  // whole days inside the period only: today's rest has not happened yet (decision 0004)
  const days = read.port('weather').days(Math.ceil(p.period[0] / DAY) * DAY, Math.floor(p.period[1] / DAY) * DAY);
  const agents: Record<string, AgentHazard> = {};
  for (const c of read.contributions('exposure')) {
    if (c.impl.stage !== 'agents' || !c.impl.agents) continue;
    const got = c.impl.agents(at, p, days);
    if (got) Object.assign(agents, got);
  }
  const classes: Record<string, string> = {};
  for (const [key, cl] of Object.entries(read.hasData('exposureClasses') ? (read.data('exposureClasses') ?? {}) : {})) {
    const hit = cl.rules.find((r) => (!r.meets || r.meets.includes(p.meets)) && Object.entries(r.min ?? {}).every(([m, v]) => metric(p, m as ClassMetric) >= v) && Object.entries(r.max ?? {}).every(([m, v]) => metric(p, m as ClassMetric) < v));
    if (hit) classes[key] = hit.class;
  }
  return { ...p, agents, classes };
}

/** Scheffer's decay climate index for wood above ground, from the period's days (annualised) */
export function schefferIndex(days: DayWeather[]): number {
  if (!days.length) return 0;
  const groups = new Map<string, DayWeather[]>();
  for (const d of days) groups.set(`${d.year}-${d.month}`, [...(groups.get(`${d.year}-${d.month}`) ?? []), d]);
  let sum = 0;
  for (const g of groups.values()) {
    const { year, month } = g[0]!;
    const monthLen = (month === 12 ? daysFromCivil(year + 1, 1, 1) : daysFromCivil(year, month + 1, 1)) - daysFromCivil(year, month, 1);
    const t = g.reduce((a, d) => a + d.tMean, 0) / g.length;
    const wet = (g.filter((d) => d.precip >= 0.25).length * monthLen) / g.length;
    sum += (Math.max(0, t - 2) * Math.max(0, wet - 3) * g.length) / monthLen;
  }
  return ((sum / 16.7) * 365.25) / days.length;
}

/** stage 4 of the built-in environment: decay climate above ground; termites in and near the ground (region data) */
const agentsContribution = (read: ReadCtx) => ({
  stage: 'agents' as const,
  label: 'Decay fungi and termites',
  agents(_at: PlacementIn, p: Omit<ExposureProfile, 'agents' | 'classes'>, days: DayWeather[]): Record<string, AgentHazard> | null {
    const out: Record<string, AgentHazard> = {};
    if (p.meets === 'outside') out.fungalClimate = { value: Math.round(schefferIndex(days) * 10) / 10, unit: '1/a', label: 'Scheffer decay climate index (wood above ground, per year)', source: SCHEFFER };
    // subterranean termites reach wood in ground contact; attack above ground through shelter tubes is not modelled
    if (p.meets === 'ground') {
      const termites = read.data('environmentSettings').termiteHazard;
      if (termites.value > 0) out.termites = { value: termites.value, unit: '1', label: 'Subterranean termite hazard (region)', ...(termites.source ? { source: termites.source } : {}) };
    }
    return Object.keys(out).length ? out : null;
  },
});

const MODEL_PROVENANCE: Provenance = { kind: 'model', source: 'exposure-model', confidence: 'medium' };

const environmentPort = (read: ReadCtx) => ({
  exposure: (at: PlacementIn, from: number, to: number) => finish(read, at, accumulate(read, at, from, to, MODEL_PROVENANCE)),
});

/**
 * What the parts of an asset were exposed to over the last `days` (default 365) up to now — never
 * the future: the coming weather is the world's truth (decision 0004).
 */
const exposureProjection = {
  label: 'Exposure of the parts of an asset (past days)',
  description: 'args: owner (asset id), part? (one part), days? (default 365, up to now)',
  compute(read: ReadCtx, args: Record<string, unknown>) {
    const owner = String(args.owner ?? '');
    const days = Math.max(1, Math.min(3650, Number(args.days ?? 365)));
    const to = Math.floor(read.now / HOUR) * HOUR;
    const from = Math.max(0, to - days * DAY);
    if (to - from < HOUR) return { owner, note: 'the world has not run an hour yet: no exposure to report' };
    const env = read.port('environment');
    const seen = new Map<string, unknown>();
    const out = read.port('space').where(owner, args.part === undefined ? undefined : String(args.part)).map((w) => {
      const key = JSON.stringify(w.in);
      let e = seen.get(key) as ExposureProfile | undefined;
      if (!e) seen.set(key, (e = env.exposure(w.in, from, to)));
      const { explain: _e, placement: _p, ...rest } = e;
      return { part: w.part, label: w.label, where: w.description, ...rest };
    });
    return { owner, period: [read.calendar.format(from), read.calendar.format(to)], parts: out };
  },
};

const DATA = { environmentSettings: EnvironmentSettingsSchema, exposureClasses: s.record(ExposureClassificationSchema).optional() };

/** the built-in exposure model */
export const environmentModule = defineModule({
  id: 'environment',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Face'],
  label: 'Environment (exposure at placements)',
  provides: ['environment'],
  requires: ['weather', 'space'],
  data: DATA,
  models: [EXPOSURE_MODEL],
  ports: { environment: environmentPort },
  contributes: { exposure: agentsContribution },
  projections: { 'environment.exposure': exposureProjection },
});

// ------------------------------------------------------------------ recorded exposure

const RECORDED_MODEL = (series: ExposureSeries | undefined): ModelDescriptor => ({
  contract: 'environment',
  implementation: 'exposure-recorded',
  kind: series?.kind ?? 'measured',
  label: series ? `Recorded exposure: ${series.label}` : 'Recorded exposure series',
  validity: { notes: series ? `Stands for parts that meet ${series.reference.meets}${series.reference.azimuth !== undefined ? `, facing ${series.reference.azimuth}° ± ${series.reference.tolerance ?? 22.5}°` : ''}${series.reference.tilt !== undefined ? `, tilted ${series.reference.tilt}°` : ''}; whole days only.` : 'Whole days only.' },
  resolution: 'daily',
  confidence: series?.confidence ?? 'medium',
  sources: series ? [series.source] : [],
});

const angleDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

function seriesOf(read: ReadCtx): ExposureSeries {
  const b = read.data('exposureBinding');
  const s0 = (read.hasData('exposureSeries') ? read.data('exposureSeries') : undefined)?.[b.dataset];
  if (!s0) throw new Error(`environment: dataset '${b.dataset}' is not in the world's data`);
  return s0;
}

function standsFor(read: ReadCtx, series: ExposureSeries, at: PlacementIn): boolean {
  const sit = situation(read, at);
  if (sit.meets !== series.reference.meets) return false;
  if (!sit.normal) return series.reference.azimuth === undefined;
  const o = orientation(sit.normal);
  const tol = series.reference.tolerance ?? 22.5;
  if (series.reference.tilt !== undefined && Math.abs(o.tilt - series.reference.tilt) > tol) return false;
  if (series.reference.azimuth !== undefined && o.tilt > 5 && angleDiff(o.azimuth, series.reference.azimuth) > tol) return false;
  return true;
}

/** the columns of a recorded exposure row after the date, and what a value may be (a value outside is not a measurement) */
const EXPOSURE_COLUMNS: { name: string; min: number; max: number }[] = [
  { name: 'tMean', min: -90, max: 70 },
  { name: 'tMin', min: -90, max: 70 },
  { name: 'tMax', min: -90, max: 70 },
  { name: 'rhMean', min: 0, max: 100 },
  { name: 'hoursAbove80', min: 0, max: 24 },
  { name: 'wetHours', min: 0, max: 24 },
  { name: 'drivingRain', min: 0, max: 2000 },
  { name: 'radiation', min: 0, max: 60 },
  { name: 'timeOfWetness', min: 0, max: 24 },
  { name: 'freezeThawCycles', min: 0, max: 24 },
];

/** what is wrong with a recorded day (null: a complete, possible record); a blank is missing, never zero */
function rowProblem(r: readonly unknown[]): string | null {
  const missing: string[] = [];
  const impossible: string[] = [];
  EXPOSURE_COLUMNS.forEach((c, i) => {
    const v = r[i + 1];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n)) missing.push(c.name);
    else if (n < c.min || n > c.max) impossible.push(`${c.name} ${n}`);
  });
  if (missing.length) return `misses ${missing.join(', ')}`;
  const [tMean, tMin, tMax] = [1, 2, 3].map((i) => Number(r[i]));
  if (tMin! > tMean! || tMean! > tMax!) impossible.push(`tMin ${tMin} ≤ tMean ${tMean} ≤ tMax ${tMax} does not hold`);
  return impossible.length ? `holds impossible values (${impossible.join(', ')})` : null;
}

function recordedExposure(read: ReadCtx, at: PlacementIn, from: number, to: number): ExposureProfile {
  const series = seriesOf(read);
  const binding = read.data('exposureBinding');
  const provenance: Provenance = { kind: series.kind, source: series.id, confidence: series.confidence };
  const fallback = (why: string): ExposureProfile => {
    if (binding.gap.policy === 'fail') throw new Error(`environment: '${series.id}' ${why}`);
    const acc = accumulate(read, at, from, to, { kind: 'model', source: 'exposure-model', confidence: 'low', note: `fallback: '${series.id}' ${why}` });
    return finish(read, at, acc);
  };
  if (!standsFor(read, series, at)) return fallback('does not stand for this placement');
  const byDay = new Map(series.rows.map((r) => [String(r[0]), r]));
  // every day the period touches, weighted by the share of it inside the period
  const rows: { r: (string | number)[]; w: number }[] = [];
  for (let d = Math.floor(from / DAY); d * DAY < to; d += 1) {
    const w = (Math.min(to, (d + 1) * DAY) - Math.max(from, d * DAY)) / DAY;
    if (w <= 0) continue;
    const c = read.calendar.at(d * DAY);
    const key = `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
    const r = byDay.get(key);
    if (!r) return fallback(`has no record for ${key}`);
    const problem = rowProblem(r);
    if (problem) return fallback(`${problem} on ${key}`);
    rows.push({ r, w });
  }
  if (!rows.length) return fallback('has nothing for an empty period');
  const num = (r: (string | number)[], i: number) => Number(r[i]);
  const weight = rows.reduce((a, x) => a + x.w, 0);
  const sum = (i: number) => rows.reduce((a, x) => a + num(x.r, i) * x.w, 0);
  const days = read.port('weather').days(Math.ceil(from / DAY) * DAY, Math.floor(to / DAY) * DAY);
  const partial = rows.some((x) => x.w < 1);
  const profile: Omit<ExposureProfile, 'agents' | 'classes'> = {
    placement: at,
    period: [from, to],
    hours: weight * 24,
    meets: series.reference.meets,
    temperature: { mean: sum(1) / weight, min: Math.min(...rows.map((x) => num(x.r, 2))), max: Math.max(...rows.map((x) => num(x.r, 3))), freezeThawCycles: sum(10) },
    relativeHumidity: { mean: sum(4) / weight, hoursAbove80: sum(5) },
    dewPoint: { mean: rows.reduce((a, x) => a + dewPoint(num(x.r, 1), num(x.r, 4)) * x.w, 0) / weight, min: Math.min(...rows.map((x) => dewPoint(num(x.r, 2), num(x.r, 4)))) },
    wetting: { hours: sum(6), decayHours: rows.reduce((a, x) => a + num(x.r, 6) * decayTemperatureResponse(num(x.r, 1)) * x.w, 0), drivingRain: sum(7), rain: days.reduce((a, d) => a + d.precip, 0) },
    timeOfWetness: sum(9),
    radiation: sum(8),
    contributions: [],
    notes: [`recorded: ${series.label}; stages 2–3 are in the record itself`, ...(partial ? ['daily records pro-rated to the part of a day inside the period; extremes are the whole day\'s'] : [])],
    explain: { drivingRain: ex.value(sum(7), 'mm', `recorded: ${series.label}`, series.source), wettingHours: ex.value(sum(6), 'h', `recorded: ${series.label}`, series.source) },
    provenance,
  };
  return finish(read, at, { profile });
}

/** an exposure series bound by the world definition (data: exposureSeries, exposureBinding) */
export const recordedEnvironmentModule = defineModule({
  id: 'environment-recorded',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Face'],
  label: 'Environment (recorded exposure)',
  provides: ['environment'],
  requires: ['weather', 'space'],
  data: { ...DATA, exposureSeries: s.record(ExposureSeriesSchema).optional(), exposureBinding: ExposureBindingSchema },
  models: (read: ReadCtx) => [RECORDED_MODEL(read.hasData('exposureSeries') ? read.data('exposureSeries')?.[read.data('exposureBinding').dataset] : undefined)],
  ports: { environment: (read: ReadCtx) => ({ exposure: (at: PlacementIn, from: number, to: number) => recordedExposure(read, at, from, to) }) },
  contributes: { exposure: agentsContribution },
  projections: { 'environment.exposure': exposureProjection },
});
