/**
 * General physics of exposure: driving rain on an oriented surface, radiation on a tilted plane,
 * temperature in the ground at depth. Methods only; place-specific parameters come from data.
 */
import type { Source } from '../../kernel/src/index.ts';

export const ISO_15927_3: Source = { title: 'ISO 15927-3:2009 Hygrothermal performance of buildings — Calculation and presentation of climatic data — Part 3: Driving rain index for vertical surfaces from hourly wind and rain data', publisher: 'ISO', year: 2009 };
export const ERBS: Source = { title: 'Erbs, Klein & Duffie (1982): Estimation of the diffuse radiation fraction for hourly, daily and monthly-average global radiation. Solar Energy 28(4), 293–302', publisher: 'Elsevier', year: 1982 };
export const GUNN_KINZER: Source = { title: 'Gunn & Kinzer (1949): The terminal velocity of fall for water droplets in stagnant air. J. Meteorology 6, 243–248', publisher: 'AMS', year: 1949 };
export const SCHEFFER: Source = { title: 'Scheffer (1971): A climate index for estimating potential for decay in wood structures above ground. Forest Products Journal 21(10), 25–31', publisher: 'Forest Products Society', year: 1971 };

export const MAGNUS: Source = { title: 'Alduchov & Eskridge (1996): Improved Magnus form approximation of saturation vapor pressure. J. Applied Meteorology 35, 601–609', publisher: 'AMS', year: 1996 };

/** dew point (°C) from air temperature (°C) and relative humidity (%), Magnus form (Alduchov & Eskridge 1996) */
export function dewPoint(temp: number, rh: number): number {
  const a = 17.625;
  const b = 243.04;
  const g = Math.log(Math.max(1e-3, rh) / 100) + (a * temp) / (b + temp);
  return (b * g) / (a - g);
}

export const DECAY_TEMPERATURE: Source = { title: 'Temperature range of wood-decay fungi: activity from about 0–5 °C, optimum 20–30 °C, ceasing at about 40 °C (Viitanen 1997, Holzforschung 51; Schmidt 2006, Wood and Tree Fungi)', publisher: 'de Gruyter / Springer', year: 2006 };

/** relative activity of wood-decay fungi at a temperature (0..1): 0 at ≤ 0 °C, linear to 1 at 20 °C, 1 to 30 °C, linear to 0 at 40 °C */
export function decayTemperatureResponse(t: number): number {
  if (t <= 0 || t >= 40) return 0;
  if (t < 20) return t / 20;
  if (t <= 30) return 1;
  return (40 - t) / 10;
}

export const PENMAN: Source = { title: 'Penman (1948): Natural evaporation from open water, bare soil and grass. Proc. R. Soc. A 193, 120–145 (wind function 0.26·(1 + 0.54·u₂) mm/d/hPa); 10 m → 2 m wind by the FAO-56 log profile (×0.748)', publisher: 'Royal Society', year: 1948 };

/** water a wetted reference surface holds after rain (mm) — the definition of the reference surface (assumption) */
export const SURFACE_FILM = 0.5;
/** longest a surface is counted wet after rain (h) */
export const MAX_DRYING_HOURS = 72;

/**
 * Evaporation from a wet reference surface in one hour (mm): Penman's aerodynamic term from the
 * vapour pressure deficit and wind, plus half the sunlight on the surface spent on evaporation
 * (assumption).
 */
export function evaporation(temp: number, rh: number, wind10: number, irradiance: number): number {
  const es = 6.1094 * Math.exp((17.625 * temp) / (temp + 243.04)); // hPa
  const vpd = Math.max(0, es * (1 - rh / 100));
  const aero = (0.26 * (1 + 0.54 * 0.748 * wind10) * vpd) / 24; // mm/h
  const rad = (0.5 * irradiance * 3600) / 1e6 / 2.45; // mm/h
  return aero + rad;
}

/** terminal fall speed of a ~1 mm raindrop (m/s), Gunn & Kinzer 1949 */
export const RAINDROP_FALL_SPEED = 4.0;

/** a unit vector from compass azimuth (deg clockwise from north) and elevation (deg), x east, y up, z south */
export function direction(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
}

/** the horizontal unit vector pointing to where the wind comes from */
export function windFrom(windDirDeg: number): [number, number, number] {
  return direction(windDirDeg, 0);
}

/**
 * Driving rain on a vertical surface this hour (l/m² = mm), ISO 15927-3 airfield relation:
 * (2/9)·v·r^(8/9)·cos(D − θ), for winds towards the surface. `cosToWind` is cos(D − θ).
 */
export function drivingRainVertical(wind: number, rain: number, cosToWind: number): number {
  if (rain <= 0 || wind <= 0 || cosToWind <= 0) return 0;
  return (2 / 9) * wind * rain ** (8 / 9) * cosToWind;
}

/** Erbs diffuse fraction from the clearness index */
export function diffuseFraction(kt: number): number {
  if (kt <= 0.22) return 1 - 0.09 * kt;
  if (kt <= 0.8) return 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  return 0.165;
}

/**
 * Solar radiation on a plane with outward normal n (W/m²): beam from the Erbs split of global
 * horizontal irradiance, isotropic sky diffuse, and ground-reflected radiation.
 */
export function planeIrradiance(ghi: number, sunElevation: number, sunAzimuth: number, dayOfYear: number, n: readonly [number, number, number], albedo: number): number {
  if (ghi <= 0) return 0;
  const cosZ = Math.sin((sunElevation * Math.PI) / 180);
  const sky = (1 + n[1]) / 2;
  const reflected = (ghi * albedo * (1 - n[1])) / 2;
  if (cosZ < 0.05) return ghi * sky + reflected; // sun near the horizon: all diffuse
  const i0 = 1367 * (1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365)) * cosZ;
  const kt = Math.min(1, ghi / i0);
  const dhi = diffuseFraction(kt) * ghi;
  const dni = (ghi - dhi) / cosZ;
  const s = direction(sunAzimuth, sunElevation);
  const cosInc = n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
  return Math.max(0, dni * Math.max(0, cosInc) + dhi * sky + reflected);
}

/**
 * Ground temperature at depth z (m) as a first-order lag of the air temperature. The lag's time
 * constant is chosen so that it damps the seasonal wave as the heat equation does: amplitude ratio
 * exp(−z/d) with damping depth d = √(2κ/ω), ω = 2π per year (Carslaw & Jaeger). Daily waves are
 * damped more strongly than in reality, and phases are approximate.
 */
export function groundStep(tGround: number, tAir: number, dtSeconds: number, depth: number, diffusivity: number): number {
  const tau = groundTimeConstant(depth, diffusivity);
  if (tau <= 0) return tAir;
  const k = 1 - Math.exp(-dtSeconds / tau);
  return tGround + (tAir - tGround) * k;
}

const OMEGA_YEAR = (2 * Math.PI) / (365.25 * 86400);

/** time constant (s) of the lag at depth z: 1/√(1 + (ωτ)²) = exp(−z/d) */
export function groundTimeConstant(depth: number, diffusivity: number): number {
  if (depth <= 0) return 0;
  const d = Math.sqrt((2 * diffusivity) / OMEGA_YEAR);
  return Math.sqrt(Math.exp((2 * depth) / d) - 1) / OMEGA_YEAR;
}
