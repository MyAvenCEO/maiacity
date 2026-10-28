/**
 * Climate: DWD station 01691 Göttingen, normals 1991–2020, plus weather-generator parameters
 * derived from the DWD CDC daily/hourly open data (research/de/climate.json: tables
 * monthly_climate_goettingen_1991_2020, markov_precip_occurrence_goettingen,
 * precip_amount_gamma_monthly, diurnal_temperature_shape and entries weathergen.*).
 * Seasonal statistics (DJF/MAM/JJA/SON) are expanded to the three months of each season.
 */
import { dwd01691WindRose as rose } from './datasets/dwd-01691-windrose.ts';
import { ASSUMPTION, DWD_DERIVED, DWD_NORMALS, cite, p, series } from './sources.ts';

/** Expand [DJF, MAM, JJA, SON] to Jan..Dec. */
const seasonal = (djf: number, mam: number, jja: number, son: number): number[] => [djf, djf, mam, mam, mam, jja, jja, jja, son, son, son, djf];
const hi = { confidence: 'high' as const };

export const climate = {
  station: {
    name: 'Göttingen (DWD 01691)',
    lat: 51.5002,
    lon: 9.9507,
    elevation: p(167.4, 'm', DWD_NORMALS, hi),
    utcOffset: p(1, 'h', undefined, { note: 'CET = local standard time (UTC+1); the calendar ignores daylight saving', confidence: 'high' }),
  },
  windRose: {
    all: series(rose.all, '1', rose.source, { confidence: 'high', note: 'all hours with wind ≥ 0.5 m/s; the Leine valley channels winds from SE' }),
    rain: series(rose.rain, '1', rose.source, { confidence: 'high', note: 'hours with precipitation ≥ 0.1 mm: rain comes mostly from SW to NW' }),
  },
  monthly: {
    tMean: series([1.4, 2.0, 5.0, 9.1, 12.9, 15.9, 17.9, 17.9, 13.9, 9.6, 5.4, 2.4], '°C', DWD_NORMALS, hi),
    tMax: series([3.88, 5.24, 9.42, 14.69, 18.56, 21.64, 24.01, 24.08, 19.42, 13.86, 8.16, 4.68], '°C', DWD_DERIVED, hi),
    tMin: series([-1.39, -1.21, 0.89, 3.14, 6.8, 9.82, 11.89, 11.82, 8.71, 5.65, 2.55, -0.18], '°C', DWD_DERIVED, hi),
    precip: series([48.3, 37.5, 42.9, 35.3, 63.3, 65.3, 72.2, 63.4, 48.4, 48.3, 49.2, 47.3], 'mm', DWD_NORMALS, hi),
    wetDays: series([10.5, 8.7, 9.3, 7.7, 9.3, 9.5, 11.1, 8.7, 8.3, 9.6, 9.5, 10.5], 'd', cite(DWD_DERIVED, 'days with RSK ≥ 1.0 mm'), hi),
    precipDays01: series([17, 15.4, 15.2, 12.6, 14.2, 14.2, 15.2, 13.9, 13.2, 15.4, 16.4, 18.4], 'd', cite(DWD_DERIVED, 'days with RSK ≥ 0.1 mm'), hi),
    sunshine: series([49.2, 70.7, 117.2, 173.5, 200.9, 205.9, 207.3, 196.1, 144.1, 98.8, 47.6, 37.6], 'h', DWD_NORMALS, hi),
    wind: series([3.77, 3.6, 3.6, 3.07, 2.82, 2.63, 2.57, 2.6, 2.66, 3.05, 3.25, 3.6], 'm/s', DWD_DERIVED, { confidence: 'medium' }),
    relHumidity: series([83.8, 80.6, 76.9, 71.7, 73.5, 75, 73.8, 72.4, 78.3, 83.3, 85.9, 85.5], '%', DWD_DERIVED, hi),
    cloudCover: series(
      [6.36, 6.11, 5.69, 5.14, 5.27, 5.27, 5.23, 5.09, 5.32, 5.73, 6.54, 6.6].map((okta) => Number((okta / 8).toFixed(4))),
      '1',
      cite(DWD_DERIVED, 'mean cloud cover in oktas ÷ 8'),
      hi,
    ),
  },
  generator: {
    tempAutocorr: p(0.8, '1', cite(DWD_DERIVED, 'lag-1 ACF of daily-mean anomalies, annual mean of seasonal values 0.76–0.85'), { range: [0.76, 0.85], confidence: 'high' }),
    tempAnomalySd: series(seasonal(4.59, 3.56, 3.11, 3.25), 'K', cite(DWD_DERIVED, 'sd of daily-mean anomaly by season (weathergen.temp.*.tmean_sd)'), hi),
    wetPersistence: p(0.26, '1', cite(DWD_DERIVED, 'r = p11 − p01 of the ≥ 1 mm occurrence chain, annual mean'), { range: [0.135, 0.349], confidence: 'high' }),
    precipGammaShape: p(0.82, '1', cite(DWD_DERIVED, 'shifted-gamma shape of ≥ 1 mm amounts, annual mean'), { range: [0.726, 0.889], confidence: 'high' }),
    wetHoursPerWetDay: p(6.7, 'h', cite(DWD_DERIVED, 'hourly RR data, mean wet hours on ≥ 1 mm days'), { range: [5.24, 7.83], confidence: 'high' }),
    traceAmount: {
      min: p(0.1, 'mm', cite(DWD_DERIVED, 'gauge resolution'), { confidence: 'high' }),
      span: p(0.8, 'mm', cite(DWD_DERIVED, 'trace amount = 0.1 + 0.8·u² → mean 0.37 mm = (P − n≥1·mean≥1)/(n≥0.1 − n≥1), 1991–2020'), { confidence: 'medium' }),
    },
    windAutocorr: p(0.6, '1', ASSUMPTION, { range: [0.5, 0.7], confidence: 'low', note: 'typical of German lowland stations; not fitted to the Göttingen record yet' }),
    windLogSd: p(0.4, '1', ASSUMPTION, { range: [0.3, 0.5], confidence: 'low', note: 'coefficient of variation of daily mean wind ≈ 0.4; not fitted yet' }),
    wetPersistenceMonthly: series(
      [0.317, 0.349, 0.312, 0.261, 0.242, 0.18, 0.205, 0.135, 0.302, 0.264, 0.249, 0.261],
      '1',
      cite(DWD_DERIVED, 'markov_precip_occurrence_goettingen r_ge1mm'),
      hi,
    ),
    precipGammaShapeMonthly: series(
      [0.884, 0.836, 0.83, 0.843, 0.76, 0.732, 0.748, 0.889, 0.866, 0.726, 0.838, 0.883],
      '1',
      cite(DWD_DERIVED, 'precip_amount_gamma_monthly shifted_gamma_shape (amount = 0.95 mm + Gamma)'),
      hi,
    ),
    precipShift: p(0.95, 'mm', cite(DWD_DERIVED, '1.0 mm threshold − half the 0.1 mm gauge resolution'), hi),
    tempAutocorrMonthly: series(seasonal(0.848, 0.803, 0.762, 0.788), '1', cite(DWD_DERIVED, 'weathergen.temp.*.tmean_lag1'), hi),
    wetTMaxShift: series(seasonal(2.45, -1.66, -1.81, -0.92), 'K', cite(DWD_DERIVED, 'weathergen.temp.*.tmax_wet_minus_dry'), hi),
    wetTMinShift: series(seasonal(3.39, 1.81, 1.06, 1.61), 'K', cite(DWD_DERIVED, 'weathergen.temp.*.tmin_wet_minus_dry'), hi),
    wetHoursPerWetDayMonthly: series(seasonal(7.83, 6.83, 5.24, 7.11), 'h', cite(DWD_DERIVED, 'weathergen.precip.hourly.*.mean_wet_hours'), hi),
    tMaxHour: series(
      [15, 15, 15, 15, 15, 15.5, 16, 16, 15, 15, 14, 14],
      'h',
      cite(DWD_DERIVED, 'diurnal_temperature_shape hour_of_max_utc_median + 1 h (UTC → CET)'),
      hi,
    ),
  },
  forecastSkill: {
    tempSd: p(0.8, 'K', ASSUMPTION, { confidence: 'low', note: 'with tempSdPerDay: Tmax/Tmin RMSE ≈ 1.3–1.6 K tomorrow rising to ≈ 3 K at day 5, the order of DWD MOS / ECMWF verification summaries' }),
    tempSdPerDay: p(0.5, 'K', ASSUMPTION, { confidence: 'low' }),
    precipDecay: p(3, 'd', ASSUMPTION, { confidence: 'low', note: 'the precipitation signal decays towards climatology over ~3 days' }),
    windLogSd: p(0.12, '1', ASSUMPTION, { confidence: 'low' }),
    windLogSdPerDay: p(0.06, '1', ASSUMPTION, { confidence: 'low' }),
  },
};
