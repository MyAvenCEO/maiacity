/**
 * Numerical helpers for the weather generator: mean-preserving interpolation of monthly
 * normals, inverse normal CDF, saturation vapour pressure, civil-day helpers.
 */
import { civilFromDays, daysFromCivil, isLeapYear } from '../../kernel/src/index.ts';

/** Days per month of a non-leap year. */
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Day-of-year (1-based) of the first day of each month, non-leap and leap year. */
function monthStarts(leap: boolean): number[] {
  const out: number[] = [];
  let acc = 1;
  for (let m = 0; m < 12; m += 1) {
    out.push(acc);
    acc += MONTH_DAYS[m]! + (leap && m === 1 ? 1 : 0);
  }
  return out;
}

const HARMONICS = 6;

/** Fourier coefficients [a0, a1, b1, …, a6, b6] of a 12-value monthly series, mean-corrected per Epstein (1991). */
function harmonicCoefficients(monthly: readonly number[]): number[] {
  const coef = new Array<number>(1 + 2 * HARMONICS).fill(0);
  coef[0] = monthly.reduce((a, b) => a + b, 0) / 12;
  for (let k = 1; k <= HARMONICS; k += 1) {
    let a = 0;
    let b = 0;
    for (let j = 0; j < 12; j += 1) {
      const c = (2 * Math.PI * k * (j + 0.5)) / 12; // month centres
      a += monthly[j]! * Math.cos(c);
      b += monthly[j]! * Math.sin(c);
    }
    const norm = k === HARMONICS ? 1 / 12 : 2 / 12;
    // The mean of cos/sin(2πkx) over a month of width 1/12 is its centre value × sinc(πk/12);
    // dividing by that factor makes the continuous curve reproduce the monthly MEANS, not the
    // mid-month values (Epstein 1991, J. Climate 4:365–368, "On obtaining daily climatological
    // values from monthly means").
    const sinc = Math.sin((Math.PI * k) / 12) / ((Math.PI * k) / 12);
    coef[2 * k - 1] = (a * norm) / sinc;
    coef[2 * k] = (b * norm) / sinc;
  }
  return coef;
}

function evalHarmonic(coef: readonly number[], x: number): number {
  let v = coef[0]!;
  for (let k = 1; k <= HARMONICS; k += 1) {
    const w = 2 * Math.PI * k * x;
    v += coef[2 * k - 1]! * Math.cos(w) + coef[2 * k]! * Math.sin(w);
  }
  return v;
}

/**
 * Smooth periodic daily curve from 12 monthly means (Epstein 1991 harmonic method), refined by
 * a few fixed-point corrections so that the means over the REAL (unequal) calendar months of a
 * non-leap year reproduce the input exactly. Returns tables indexed by day-of-year (index 0 unused)
 * for 365- and 366-day years. Optional clamp keeps rates/probabilities in range.
 */
export function dailyFromMonthly(monthly: readonly number[], lo = -Infinity, hi = Infinity): { 365: Float64Array; 366: Float64Array } {
  if (monthly.length !== 12) throw new Error('dailyFromMonthly needs 12 values');
  const starts = monthStarts(false);
  const target = [...monthly];
  let input = [...monthly];
  let coef = harmonicCoefficients(input);
  const sample = (len: number): Float64Array => {
    const out = new Float64Array(len + 1);
    for (let doy = 1; doy <= len; doy += 1) out[doy] = Math.min(hi, Math.max(lo, evalHarmonic(coef, (doy - 0.5) / len)));
    return out;
  };
  for (let iter = 0; iter < 6; iter += 1) {
    const t = sample(365);
    let maxErr = 0;
    input = input.map((v, m) => {
      let sum = 0;
      for (let i = 0; i < MONTH_DAYS[m]!; i += 1) sum += t[starts[m]! + i]!;
      const err = target[m]! - sum / MONTH_DAYS[m]!;
      maxErr = Math.max(maxErr, Math.abs(err));
      return v + err;
    });
    if (maxErr < 1e-9 * (1 + Math.abs(target.reduce((a, b) => a + Math.abs(b), 0)))) break;
    coef = harmonicCoefficients(input);
  }
  return { 365: sample(365), 366: sample(366) };
}

/**
 * Inverse of the standard normal CDF — P. J. Acklam's rational approximation (2003),
 * relative error < 1.2e-9. Lets one uniform hash draw become one normal deviate.
 */
export function invNorm(p0: number): number {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, p0));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Saturation vapour pressure over water (hPa), Magnus form with Sonntag (1990) coefficients as in WMO-No. 8 (2018), Annex 4.B. */
export function satVapourPressure(tC: number): number {
  return 6.112 * Math.exp((17.62 * tC) / (243.12 + tC));
}

export interface DayInfo {
  /** days since 1970-01-01 */
  epochDay: number;
  year: number;
  month: number;
  dayOfMonth: number;
  /** 1-based */
  doy: number;
  yearLen: 365 | 366;
}

export function dayInfo(epochDay: number): DayInfo {
  const c = civilFromDays(epochDay);
  return {
    epochDay,
    year: c.year,
    month: c.month,
    dayOfMonth: c.day,
    doy: epochDay - daysFromCivil(c.year, 1, 1) + 1,
    yearLen: isLeapYear(c.year) ? 366 : 365,
  };
}
