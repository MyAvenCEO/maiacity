/**
 * Environment contract (decision 0014; design/foundations.md §5).
 *
 * `environment.exposure(placement, from, to)` resolves what a part placed somewhere is exposed to
 * over a period, in four ordered stages:
 *   1. climate  — the weather contract seen from the placement (orientation, tilt, what it meets)
 *   2. passive  — shelter and shading by other things (a roof overhang over a façade …)
 *   3. active   — heating, ventilation, irrigation … (none yet)
 *   4. agents   — hazards from the resulting climate (fungal decay climate …)
 * Stages 2–4 are an extension point: any module may contribute. Classifications (EN 335 use
 * classes, ISO 9223 time-of-wetness categories) are derived from the physical quantities by the
 * rules of a practice pack (decision 0010). Material-response models read profiles only, never the
 * weather or soil (decision 0014).
 */
import { s, type Explained, type Infer, type Provenance, type Schema } from '../../kernel/src/index.ts';
import type { PlacementIn } from '../../space/src/index.ts';
import type { DayWeather, HourWeather } from '../../weather/src/index.ts';

/** what the placed part meets on its exposed side */
export type Meets = 'outside' | 'ground' | 'water' | 'space';

/** one hour of exposure at a placement (stage 1, changed by stages 2 and 3) */
export interface HourExposure {
  /** °C at the part */
  temp: number;
  /** % */
  rh: number;
  /** water reaching the part this hour (mm = l/m²) */
  rain: number;
  /** share of the part's area wetted this hour (0..1) */
  wet: number;
  /** solar radiation on the part (W/m²) */
  radiation: number;
  /** wind speed towards the part (m/s, ≥ 0) */
  windNormal: number;
}

export interface AgentHazard {
  value: number;
  unit: string;
  label: string;
  source?: { title: string; publisher?: string; year?: number };
}

export interface ExposureProfile {
  placement: PlacementIn;
  period: [number, number];
  hours: number;
  meets: Meets;
  /** °C; freeze-thaw cycles: thaws after a freeze (±0.5 °C hysteresis) */
  temperature: { mean: number; min: number; max: number; freezeThawCycles: number };
  /** %; hours with RH > 80 % */
  relativeHumidity: { mean: number; hoursAbove80: number };
  /** dew point of the air at the part (°C, Magnus formula): mean and lowest */
  dewPoint: { mean: number; min: number };
  /**
   * hours: area-weighted hours wetted; decayHours: wetted hours weighted by the temperature response
   * of wood-decay fungi (0 at ≤ 0 °C and ≥ 40 °C, 1 at 20–30 °C); drivingRain: water reaching the
   * part (mm = l/m²); rain: free rain on the horizontal (mm)
   */
  wetting: { hours: number; decayHours: number; drivingRain: number; rain: number };
  /** ISO 9223 time of wetness: hours with RH > 80 % and T > 0 °C (h) */
  timeOfWetness: number;
  /** solar radiation received (MJ/m²) */
  radiation: number;
  /** stage 4 hazards, by key */
  agents: Record<string, AgentHazard>;
  /** classifications by the practice pack's rules, e.g. { 'EN 335': 'UC3.2', 'ISO 9223 TOW': 'τ3' } */
  classes: Record<string, string>;
  /** what stages 2–4 changed */
  contributions: { stage: ExposureStage; module: string; label: string; effect: string }[];
  /** what is not modelled, estimates, fallbacks */
  notes: string[];
  explain: { drivingRain: Explained; wettingHours: Explained };
  provenance: Provenance;
}

export type ExposureStage = 'passive' | 'active' | 'agents';

/** a contribution to stages 2–4 (extension point 'exposure') */
export interface ExposureContribution {
  stage: ExposureStage;
  label: string;
  /** passive/active: change one hour at a placement; null when the placement is none of its business */
  hour?(at: PlacementIn, h: HourExposure, w: HourWeather): HourExposure | null;
  /** agents: hazards from the period's profile and days; null when not concerned */
  agents?(at: PlacementIn, profile: Omit<ExposureProfile, 'agents' | 'classes'>, days: DayWeather[]): Record<string, AgentHazard> | null;
}

export interface EnvironmentPort {
  /** what a placed part is exposed to over [from, to) (sim seconds) */
  exposure(at: PlacementIn, from: number, to: number): ExposureProfile;
}

export const EnvironmentSettingsSchema = s.object({
  /** ground reflectance for radiation on tilted planes */
  albedo: s.param('1'),
  /** thermal diffusivity of the ground, for temperatures at depth */
  soilThermalDiffusivity: s.param('m2/s'),
  /** hazard of subterranean termites for wood in or near the ground (0 none … 1 high) */
  termiteHazard: s.param('1'),
});
export type EnvironmentSettings = Infer<typeof EnvironmentSettingsSchema>;

/** quantities a classification rule can test (per year: scaled from the period) */
export const CLASS_METRICS = ['wettingHoursPerYear', 'decayHoursPerYear', 'timeOfWetnessPerYear', 'drivingRainPerYear', 'hoursAbove80PerYear', 'freezeThawCyclesPerYear', 'meanTemperature'] as const;
export type ClassMetric = (typeof CLASS_METRICS)[number];

const RuleSchema = s.object({
  class: s.string(),
  meets: s.array(s.enum(['outside', 'ground', 'water', 'space'])).optional(),
  min: s.record(s.number()).optional(),
  max: s.record(s.number()).optional(),
  note: s.string().optional(),
});

/** a classification of a practice pack: the first rule that matches gives the class */
export const ExposureClassificationSchema = s.object({
  label: s.string(),
  source: s.any<{ title: string; publisher?: string; year?: number; note?: string }>(),
  rules: s.array(RuleSchema),
});
export type ExposureClassification = Infer<typeof ExposureClassificationSchema>;

/** a recorded exposure: daily measurements at a reference part (e.g. a sensor on a façade) */
export interface ExposureSeries {
  id: string;
  label: string;
  kind: 'measured' | 'entered';
  confidence: 'high' | 'medium' | 'low';
  source: { title: string; publisher?: string; year?: number; url?: string; note?: string };
  /** the placements it stands for: what they meet and, for faces, their orientation */
  reference: { meets: Meets; azimuth?: number; tilt?: number; tolerance?: number };
  /** daily rows: date, tMean, tMin, tMax (°C), rhMean (%), hoursAbove80 (h), wetHours (h), drivingRain (mm), radiation (MJ/m²), timeOfWetness (h), freezeThawCycles */
  rows: (string | number)[][];
}

export const ExposureSeriesSchema = s.any<ExposureSeries>() as Schema<ExposureSeries>;

export const ExposureBindingSchema = s.object({
  dataset: s.string(),
  /** placements the series does not stand for: the model fills in (marked) or the run fails */
  gap: s.object({ policy: s.enum(['fallback', 'fail']) }),
});
export type ExposureBinding = Infer<typeof ExposureBindingSchema>;

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    environment: EnvironmentPort;
  }
  interface ContributionTypes {
    exposure: ExposureContribution;
  }
  interface DataTypes {
    environmentSettings: EnvironmentSettings;
    exposureClasses?: Record<string, ExposureClassification>;
    exposureSeries?: Record<string, ExposureSeries>;
    exposureBinding: ExposureBinding;
  }
}
