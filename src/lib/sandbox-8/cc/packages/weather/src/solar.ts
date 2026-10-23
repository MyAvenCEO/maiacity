/**
 * Solar geometry and clear-sky irradiance.
 *
 * Sun position follows the NOAA Solar Calculator (NOAA Global Monitoring Laboratory,
 * "General Solar Position Calculations" / NOAA_Solar_Calculations_day.xls, after
 * J. Meeus, *Astronomical Algorithms*, 2nd ed., 1998, ch. 25). Accuracy is about ±1 min in
 * sunrise/sunset and < 0.1° in position for years 1800–2100, ample for a settlement sim.
 *
 * All times here are LOCAL STANDARD TIME (utcOffset hours east of UTC, no DST), matching
 * the kernel calendar.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Julian Day of 1970-01-01T00:00 UTC. */
const JD_UNIX_EPOCH = 2_440_587.5;

export interface SolarParams {
  /** solar declination (rad) */
  decl: number;
  /** equation of time (minutes) */
  eqTime: number;
}

/**
 * Declination and equation of time for a Julian Day (NOAA spreadsheet formulas,
 * columns G–V; Meeus 1998 eqs. 25.2–25.8, 22.2, 28.3).
 */
export function solarParams(jd: number): SolarParams {
  const T = (jd - 2_451_545) / 36_525; // Julian centuries since J2000.0
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360; // geom. mean longitude (deg)
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T); // geom. mean anomaly (deg)
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T); // orbit eccentricity
  const Mr = M * RAD;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289; // equation of centre (deg)
  const trueLong = L0 + C;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega); // apparent longitude (deg)
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60; // mean obliquity
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD; // corrected obliquity (rad)
  const decl = Math.asin(Math.sin(eps) * Math.sin(appLong * RAD));
  const y = Math.tan(eps / 2) ** 2;
  const L0r = L0 * RAD;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eqTime };
}

/** Julian Day for a civil day (days since 1970-01-01) at `localHours` local standard time. */
export function julianDay(epochDay: number, localHours: number, utcOffset: number): number {
  return JD_UNIX_EPOCH + epochDay + (localHours - utcOffset) / 24;
}

export interface SunPos {
  /** apparent elevation above horizon incl. refraction (deg) */
  elevation: number;
  /** azimuth clockwise from north (deg) */
  azimuth: number;
  /** cosine of the geometric (unrefracted) zenith angle */
  cosZenith: number;
}

/** Sun position at a local standard time (NOAA spreadsheet columns AB–AH). */
export function sunPosition(epochDay: number, localHours: number, lat: number, lon: number, utcOffset: number): SunPos {
  const { decl, eqTime } = solarParams(julianDay(epochDay, localHours, utcOffset));
  // true solar time (min) = local clock minutes + equation of time + 4 min/deg · lon − 60 · tz
  const tst = (((localHours * 60 + eqTime + 4 * lon - 60 * utcOffset) % 1440) + 1440) % 1440;
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * RAD; // hour angle (rad)
  const phi = lat * RAD;
  const cosZ = Math.max(-1, Math.min(1, Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha)));
  const zen = Math.acos(cosZ);
  const elev = 90 - zen * DEG;
  // Atmospheric refraction (NOAA approximation after Bennett / Sæmundsson), degrees.
  let refr = 0;
  if (elev <= 85) {
    const te = Math.tan(elev * RAD);
    if (elev > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) refr = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else refr = -20.772 / te;
    refr /= 3600;
  }
  const sinZ = Math.sin(zen);
  let azimuth: number;
  if (sinZ < 1e-9) azimuth = 180;
  else {
    const c = Math.max(-1, Math.min(1, (Math.sin(phi) * cosZ - Math.sin(decl)) / (Math.cos(phi) * sinZ)));
    const a = Math.acos(c) * DEG;
    azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  }
  return { elevation: elev + refr, azimuth, cosZenith: cosZ };
}

export interface SunTimes {
  /** local standard hours of day (may be < 0 or > 24 only in pathological cases) */
  sunrise: number;
  sunset: number;
  solarNoon: number;
  /** 'normal' | 'polarDay' (sun never sets) | 'polarNight' (never rises) */
  kind: 'normal' | 'polarDay' | 'polarNight';
}

/** Hour angle of sunrise (deg) for apparent elevation −0.833° (refraction + solar semi-diameter). */
function sunriseHourAngle(lat: number, decl: number): number {
  const phi = lat * RAD;
  return DEG * Math.acos(Math.cos(90.833 * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl));
}

/**
 * Sunrise, sunset and solar noon for a civil day (NOAA: solar noon = 720 − 4·lon − EoT + 60·tz,
 * sunrise/set = noon ∓ 4·HA). Declination and EoT are re-evaluated at the first estimate of each
 * event (one fixed-point iteration), which brings the error below ~30 s at mid-latitudes.
 */
export function sunTimes(epochDay: number, lat: number, lon: number, utcOffset: number): SunTimes {
  const noonParams = solarParams(julianDay(epochDay, 12, utcOffset));
  const solarNoon = (720 - 4 * lon - noonParams.eqTime + 60 * utcOffset) / 60;
  const phi = lat * RAD;
  const arg = Math.cos(90.833 * RAD) / (Math.cos(phi) * Math.cos(noonParams.decl)) - Math.tan(phi) * Math.tan(noonParams.decl);
  if (arg <= -1) return { sunrise: 0, sunset: 24, solarNoon, kind: 'polarDay' };
  if (arg >= 1) return { sunrise: solarNoon, sunset: solarNoon, solarNoon, kind: 'polarNight' };
  const refine = (sign: -1 | 1): number => {
    let h = solarNoon + (sign * 4 * sunriseHourAngle(lat, noonParams.decl)) / 60;
    for (let i = 0; i < 2; i += 1) {
      const p = solarParams(julianDay(epochDay, h, utcOffset));
      const ha = sunriseHourAngle(lat, p.decl);
      if (!Number.isFinite(ha)) break;
      h = (720 - 4 * lon - p.eqTime + 60 * utcOffset + sign * 4 * ha) / 60;
    }
    return h;
  };
  return { sunrise: refine(-1), sunset: refine(1), solarNoon, kind: 'normal' };
}

/**
 * Astronomical day length (h) from a simple declination model (Spencer 1971 Fourier series),
 * used only to turn monthly sunshine normals into relative sunshine. `doy` 1-based, `yearLen` 365/366.
 */
export function dayLengthClimatological(lat: number, doy: number, yearLen: number): number {
  const g = (2 * Math.PI * (doy - 1)) / yearLen;
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const phi = lat * RAD;
  const arg = Math.cos(90.833 * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  if (arg <= -1) return 24;
  if (arg >= 1) return 0;
  return (2 * DEG * Math.acos(arg)) / 15;
}

/**
 * Clear-sky global horizontal irradiance, Haurwitz (1945) model as recommended for its
 * simplicity by Reno, Hansen & Stein (2012, SAND2012-2389): GHI_cs = 1098 · cos z · exp(−0.057 / cos z) W/m².
 */
export function clearSkyGhi(cosZenith: number): number {
  if (cosZenith <= 0.01) return 0;
  return 1098 * cosZenith * Math.exp(-0.057 / cosZenith);
}

/**
 * Clear-sky GHI after Ineichen & Perez (2002, Solar Energy 73:151–157), the Kasten (1984)
 * Linke-turbidity formulation:
 *   GHI_cs = cg1 · I0 · cos z · exp(−cg2 · AM · (fh1 + fh2 · (TL − 1))) · exp(0.01 · AM^1.8)
 *   cg1 = 5.09e−5·h + 0.868, cg2 = 3.92e−5·h + 0.0387, fh1 = exp(−h/8000), fh2 = exp(−h/1250)
 * with h the site elevation (m), TL the Linke turbidity (air mass 2), AM the Kasten & Young (1989)
 * relative optical air mass, and I0 the extraterrestrial normal irradiance (solar constant 1361 W/m²,
 * Kopp & Lean 2011, with the orbital eccentricity factor 1 + 0.033·cos(2π·doy/365)).
 */
export function clearSkyGhiIneichen(cosZenith: number, elevationM: number, linkeTurbidity: number, doy: number): number {
  if (cosZenith <= 0.01) return 0;
  const zDeg = Math.acos(Math.min(1, cosZenith)) * DEG;
  const am = 1 / (cosZenith + 0.50572 * (96.07995 - zDeg) ** -1.6364);
  const i0 = 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365));
  const cg1 = 5.09e-5 * elevationM + 0.868;
  const cg2 = 3.92e-5 * elevationM + 0.0387;
  const fh1 = Math.exp(-elevationM / 8000);
  const fh2 = Math.exp(-elevationM / 1250);
  return Math.max(0, cg1 * i0 * cosZenith * Math.exp(-cg2 * am * (fh1 + fh2 * (linkeTurbidity - 1))) * Math.exp(0.01 * am ** 1.8));
}

/**
 * Cloud attenuation after Kasten & Czeplak (1980, Solar Energy 24:177–189):
 * G / G_clear = 1 − 0.75 · N^3.4, with N the cloud cover fraction (oktas / 8).
 */
export function cloudFactor(cloud: number): number {
  const c = Math.max(0, Math.min(1, cloud));
  return 1 - 0.75 * c ** 3.4;
}

/**
 * Horizontal illuminance outdoors from the sun and the sky (lx) by the sun's elevation (°), under a clear sky: log-linear
 * between points of the natural illumination tables (Bond & Henderson 1963, "Sun and Moon Illumination" (US Naval
 * Ordnance); the US Naval Observatory's illuminance-by-altitude figures): about 100,000 lx at 90°, 15,000 at 10°, 700 at
 * sunrise, 3.4 at the end of civil twilight (−6°), 0.008 at the end of nautical twilight (−12°), a starlit night's 0.001
 * below −18°. Clouds dim it as they dim the irradiance (`cloudFactor`). The moon is left out (at most about 0.3 lx).
 */
const LUX: [number, number][] = [
  [-18, 0.0007],
  [-12, 0.008],
  [-9, 0.15],
  [-6, 3.4],
  [-4, 30],
  [-2, 200],
  [0, 730],
  [5, 6000],
  [10, 15000],
  [20, 35000],
  [30, 55000],
  [60, 90000],
  [90, 105000],
];
export function outdoorLux(elevation: number, cloud = 0): number {
  const e = Math.max(LUX[0]![0], Math.min(LUX[LUX.length - 1]![0], elevation));
  let i = 0;
  while (i < LUX.length - 2 && e > LUX[i + 1]![0]) i += 1;
  const [e0, l0] = LUX[i]!;
  const [e1, l1] = LUX[i + 1]!;
  const lg = Math.log10(l0) + ((e - e0) / (e1 - e0)) * (Math.log10(l1) - Math.log10(l0));
  return 10 ** lg * cloudFactor(cloud);
}
