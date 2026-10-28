/**
 * Jobs (tariff wages TV Lohn/West, national from 01.04.2026 — GTL incl. 5.9 %
 * Bauzuschlag), employer surcharges and sickness: the labour market. Qualifications and working-time
 * law are building practice (practice-de); the names of applicants belong to the region.
 *
 * Recruitment is a labour market, not a lead time: an advert draws suitable applicants at random
 * (Poisson, mean interval per job) and each hire starts after the notice period at their current
 * employer. Registered vacancies for plant operators stayed open 277 days on average (BA, Feb 2025
 * – Jan 2026); that is the upper end, since firms fill many posts through their own networks
 * before (or without) registering them. Temporary agency staff is no way out: § 1b AÜG bans
 * agency work for construction labour.
 */
import { AOK_SICK, ASSUMPTION, BA_VACANCY, BGB_622, HDB_LZK, TARIF_MV, TV_LOHN, cite, p } from './sources.ts';

const VACANCY_NOTE = 'ESTIMATE: mean wait for a suitable applicant who accepts; BA registered vacancies (plant operators 277 d, Hochbau 281 d incl. notice) bound it from above';
/** labour market of a job: mean days between suitable applicants, their notice period, advert cost */
/**
 * the region's pool of suitable job seekers for a job (design/physical-state.md 8c): how many there are, how many come
 * new a year; estimates after the BA's labour market statistics for the Göttingen district (job seekers by occupation),
 * to be sourced
 */
const POOL = { title: 'Estimate after Bundesagentur für Arbeit, Arbeitsmarkt nach Berufen (Agenturbezirk Göttingen)', publisher: 'Bundesagentur für Arbeit' };
const pool = (size: number, inflow: number) => ({ size: p(size, '1', POOL, { range: [Math.round(size / 3), size * 3], confidence: 'low', note: 'suitable job seekers in the region at a time' }), inflow: p(inflow, '1/a', POOL, { range: [Math.round(inflow / 3), inflow * 3], confidence: 'low', note: 'new ones a year (who leave one job, finish training, move here)' }) });
const market = (interval: number, range: [number, number], notice: number, noticeNote: string, advert: number, seekers?: [number, number]) => ({
  meanApplicantInterval: p(interval, 'd', BA_VACANCY, { range, confidence: 'low', note: VACANCY_NOTE }),
  noticePeriod: p(notice, 'd', BGB_622, {
    confidence: 'medium',
    note: noticeNote,
  }),
  advertCost: p(advert, 'EUR', ASSUMPTION, {
    range: [0, advert * 2],
    confidence: 'low',
    note: 'job portal listing 30 days (BA Jobbörse is free; commercial portals 400–1,500 EUR)',
  }),
  ...(seekers ? { pool: pool(seekers[0], seekers[1]) } : {}),
});
const WAGE_EARNER = 'blue-collar notice § 622 BGB: 4 weeks (longer after years of service; BRTV § 11 shortens it in the first months)';
const wage = (v: number, lg: string, range?: [number, number], confidence: 'high' | 'medium' | 'low' = 'high') =>
  p(v, 'EUR/h', cite(TV_LOHN, lg), range ? { range, confidence } : { confidence });

/** Salaried staff: monthly salary ÷ 173.3 paid hours per month (40 h/week, TARIF_MV). */
const HOURS_PER_MONTH = 173.3;
const salary = (eurPerMonth: number, note: string, range: [number, number]) =>
  p(Number((eurPerMonth / HOURS_PER_MONTH).toFixed(2)), 'EUR/h', cite(TARIF_MV, note), {
    range: [Number((range[0] / HOURS_PER_MONTH).toFixed(2)), Number((range[1] / HOURS_PER_MONTH).toFixed(2))],
    confidence: 'medium',
    note: `salaried: ${eurPerMonth} EUR/month ÷ ${HOURS_PER_MONTH} h/month`,
  });

export const jobs = {
  worker: {
    label: 'Fachwerker (site worker)',
    qualifications: ['labour'],
    hourlyWage: wage(18.73, 'Lohngruppe 2 Fachwerker (LG1 Werker 15.86, LG2b after 3 months 21.20)', [15.86, 21.2]),
    experience: p(2000, 'h', ASSUMPTION, { range: [100, 15000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(14, [5, 45], 14, 'many applicants are unemployed or in their probation period (2 weeks, § 622 (3) BGB)', 300, [250, 600]),
  },
  plantOperator: {
    label: 'Baumaschinenführer (earthworks plant operator)',
    qualifications: ['op.excavator', 'op.loader', 'op.dozer', 'op.roller', 'labour'],
    hourlyWage: wage(26.45, 'Lohngruppe 4 Baumaschinenführer (Vorarbeiter LG5 27.29)'),
    experience: p(8000, 'h', ASSUMPTION, { range: [1000, 30000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(90, [30, 250], 28, WAGE_EARNER, 900, [40, 80]),
  },
  roadPlantOperator: {
    label: 'Baumaschinenführer Straßenbau (grader / paver / roller)',
    qualifications: ['op.grader', 'op.paver', 'op.roller', 'labour'],
    hourlyWage: wage(26.45, 'Lohngruppe 4 Baumaschinenführer'),
    experience: p(8000, 'h', ASSUMPTION, { range: [1000, 30000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(100, [30, 250], 28, WAGE_EARNER, 900, [15, 30]),
  },
  truckDriver: {
    label: 'Berufskraftfahrer (HGV driver)',
    qualifications: ['driver.ce', 'labour'],
    hourlyWage: wage(23.97, 'Lohngruppe 3 Berufskraftfahrer (LG2 Kraftfahrer 18.73)', [18.73, 23.97]),
    experience: p(8000, 'h', ASSUMPTION, { range: [1000, 30000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(60, [20, 250], 28, WAGE_EARNER, 700, [120, 250]),
  },
  surveyor: {
    label: 'Vermessungstechniker (site surveyor)',
    qualifications: ['survey', 'labour'],
    hourlyWage: wage(26.05, 'Lohngruppe 4 Spezialfacharbeiter (Ecklohn) — assumed grade for a site surveyor', [23.97, 27.29], 'medium'),
    experience: p(6000, 'h', ASSUMPTION, { range: [500, 20000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(60, [20, 150], 28, WAGE_EARNER, 900, [6, 10]),
  },
  forester: {
    label: 'Baumfäller / Forstwirt (tree felling)',
    qualifications: ['chainsaw', 'labour'],
    hourlyWage: wage(23.97, 'Lohngruppe 3 Facharbeiter — Bau tariff equivalent; the forestry tariff (TV-Forst) is not in research', [18.73, 26.05], 'low'),
    experience: p(5000, 'h', ASSUMPTION, { range: [500, 20000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(30, [10, 90], 28, WAGE_EARNER, 500, [8, 12]),
  },
  foreman: {
    label: 'Polier (site foreman)',
    qualifications: ['foreman', 'labour', 'survey'],
    hourlyWage: wage(29.72, 'Lohngruppe 6 Werkpolier; salaried Polier A VII 5,585 EUR/month ≈ 32.23 EUR/h', [29.72, 32.23]),
    experience: p(15000, 'h', ASSUMPTION, { range: [5000, 40000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(120, [45, 250], 42, 'experienced Poliere often have extended contractual notice', 1200, [15, 25]),
  },
  siteManager: {
    label: 'Bauleiter (site manager, salaried)',
    qualifications: ['engineer', 'survey'],
    hourlyWage: salary(6800, 'Bauleiter A VIII – A X: 6,110–7,559 EUR/month; mid value 6,800', [6110, 7559]),
    experience: p(10000, 'h', ASSUMPTION, { range: [2000, 30000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(120, [45, 250], 90, 'salaried staff: typically 3 months to the end of a month (contractual / § 622 (2) BGB with service years)', 1500, [8, 15]),
  },
  asphaltWorker: {
    label: 'Asphaltbauer (asphalt crew)',
    qualifications: ['asphalt', 'op.roller', 'labour'],
    hourlyWage: wage(23.97, 'Lohngruppe 3 Facharbeiter (Spezialfacharbeiter LG4 26.05)', [23.97, 26.05]),
    experience: p(6000, 'h', ASSUMPTION, { range: [500, 20000], confidence: 'low', note: 'practice a hire brings in each of the job\'s skills (log-uniform: newcomers to veterans)' }),
    market: market(60, [20, 150], 28, WAGE_EARNER, 700, [20, 40]),
  },
};

/** the labour-market part of the labour settings (the law part is in the practice pack) */
export const labourSettings = {
  employerSurcharge: p(0.62, '1', HDB_LZK, {
    range: [0.55, 0.68],
    confidence: 'medium',
    note:
      'Derived from HDB Lohnzusatzkosten West 2026 = 90.68 % of wage, minus the ≈ 28 points for vacation pay, public holidays and sick pay: the workforce module already pays absence days as paid hours, so only statutory social insurance, SOKA-BAU, 13th month/Urlaubsgeld and company social costs remain as a surcharge.',
  }),
  sickDaysPerYear: p(17.8, 'd', AOK_SICK, {
    range: [15.7, 19.3],
    confidence: 'medium',
    note: 'construction sickness rate 6.82 % (2024) = 24.9 calendar days/year ≈ 17.8 scheduled workdays (× 5/7); the workforce module counts workdays',
  }),
  netShare: p(0.66, '1', ASSUMPTION, { range: [0.6, 0.8], confidence: 'low', note: 'a full-time wage of some 3,200 € gross in tax class I keeps about two thirds after the employee’s social insurance (~21 %) and income tax (to be sourced)' }),
  helperLodging: p(40, 'EUR/d', ASSUMPTION, { range: [25, 70], confidence: 'low', note: 'a bed in a hostel or guesthouse near Göttingen a night, for a helper who lives a day’s travel away (estimate, as the hostel among the lodgings)' }),
  helperUpkeep: p(11.1, 'EUR/d', { title: 'Sozialversicherungsentgeltverordnung (SvEV) § 2: Sachbezugswerte 2025 — breakfast 2.30 €, lunch 4.40 €, dinner 4.40 €', publisher: 'BMAS' }, { range: [10, 14], confidence: 'medium', note: 'meals for a family member or friend who helps; 2025 values' }),
};

/**
 * Employers beyond the map our people can work for (the region's labour demand). Estimates, to be
 * sourced from the employment agency's vacancy statistics: unskilled work is found in a few weeks.
 */
/** fares of the region's lines, one way (A4) */
export const transitFares = {
  k412Bus: { single: p(3.2, 'EUR', ASSUMPTION, { range: [2.5, 4.5], confidence: 'low', note: 'a single ticket of the regional tariff into town (to be sourced; for daily trips the monthly Deutschlandticket is cheaper: the product deutschlandticket)' }) },
};

export const employers = {
  bauhof: {
    label: 'Bauhof der Stadt Göttingen (municipal works yard)',
    jobs: ['worker'],
    distance: p(8, 'km', ASSUMPTION, { range: [5, 12], confidence: 'low', note: 'into town beyond the way in' }),
    opening: p(30, 'd', BA_VACANCY, { range: [10, 90], confidence: 'low', note: 'how long someone looking waits for an opening for a site worker (estimate)' }),
  },
  merchantYard: {
    label: 'Baustoffhandel Göttingen (yard hand)',
    jobs: ['worker'],
    distance: p(7, 'km', ASSUMPTION, { range: [4, 12], confidence: 'low' }),
    opening: p(21, 'd', BA_VACANCY, { range: [7, 60], confidence: 'low', note: 'yard hands are sought often (estimate)' }),
  },
};

const COURSE_PRICES = { title: 'Typical prices of course providers (BG BAU, DEKRA, TÜV, driving schools), 2025', publisher: 'Constructible City (economy-de)' };
/** what courses cost and how long until the next one starts */
export const courseOffers = {
  earthmoving: { price: p(1200, 'EUR', COURSE_PRICES, { range: [800, 2000], confidence: 'low' }), leadTime: p(21, 'd', ASSUMPTION, { range: [7, 60], confidence: 'low' }) },
  roadPlant: { price: p(800, 'EUR', COURSE_PRICES, { range: [500, 1500], confidence: 'low' }), leadTime: p(21, 'd', ASSUMPTION, { range: [7, 60], confidence: 'low' }) },
  chainsaw: { price: p(350, 'EUR', COURSE_PRICES, { range: [250, 600], confidence: 'low' }), leadTime: p(14, 'd', ASSUMPTION, { range: [7, 45], confidence: 'low' }) },
  ceLicence: { price: p(9000, 'EUR', COURSE_PRICES, { range: [6000, 12000], confidence: 'low' }), leadTime: p(30, 'd', ASSUMPTION, { range: [14, 90], confidence: 'low' }) },
};
