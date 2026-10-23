/**
 * What tenants pay around Göttingen and how they behave (the rent-level model of the
 * tenant-demand contract). The law of letting is the practice pack's.
 */
import { ASSUMPTION, p } from './sources.ts';

export const rentLevels = {
  home: {
    rentPerM2: p(11, 'EUR/m2/mo', ASSUMPTION, { range: [8.5, 14], confidence: 'low', note: 'net rent of newly let homes in and around Göttingen, 2025–26 (listing portals about 10–11 €/m²; new houses at the upper end)' }),
    vacancyDays: p(30, 'd', ASSUMPTION, { range: [10, 90], confidence: 'low', note: 'a tight market (vacancy around 1–2 %): a fairly priced home finds a tenant within weeks' }),
    spread: p(0.08, '1', ASSUMPTION, { range: [0.04, 0.15], confidence: 'low', note: 'what prospective tenants would pay spreads by about 8 % around the market rent' }),
    stayElasticity: p(3, '1', ASSUMPTION, { range: [1, 6], confidence: 'low', note: 'a tenant paying above the market moves sooner' }),
    conditionWeight: p(0.5, '1', ASSUMPTION, { range: [0.3, 0.8], confidence: 'low' }),
    stayDays: p(2920, 'd', ASSUMPTION, { range: [1095, 4380], confidence: 'low', note: 'about eight years: shorter than the average tenancy, which includes long-standing ones' }),
    lateShare: p(0.04, '1', ASSUMPTION, { range: [0.01, 0.1], confidence: 'low', note: 'share of monthly rents paid late' }),
    lateDays: p(20, 'd', ASSUMPTION, { range: [5, 60], confidence: 'low' }),
  },
  premises: {
    rentPerM2: p(5, 'EUR/m2/mo', ASSUMPTION, { range: [3.5, 7], confidence: 'low', note: 'halls and workshops around Göttingen, 2025–26' }),
    vacancyDays: p(120, 'd', ASSUMPTION, { range: [30, 365], confidence: 'low' }),
    spread: p(0.12, '1', ASSUMPTION, { range: [0.05, 0.25], confidence: 'low' }),
    stayElasticity: p(2, '1', ASSUMPTION, { range: [1, 5], confidence: 'low' }),
    conditionWeight: p(0.5, '1', ASSUMPTION, { range: [0.3, 0.8], confidence: 'low' }),
    stayDays: p(1825, 'd', ASSUMPTION, { range: [730, 3650], confidence: 'low', note: 'about five years' }),
    lateShare: p(0.06, '1', ASSUMPTION, { range: [0.01, 0.15], confidence: 'low' }),
    lateDays: p(30, 'd', ASSUMPTION, { range: [7, 90], confidence: 'low' }),
  },
  dayHire: {
    rentPerM2: p(1.5, 'EUR/m2/d', ASSUMPTION, { range: [0.5, 4], confidence: 'low', note: 'a plain hall for a day (a company event, a training, a market), about 1,000–2,000 € for 1,000 m²' }),
    vacancyDays: p(21, 'd', ASSUMPTION, { range: [7, 90], confidence: 'low', note: 'mean days between bookings at the market price' }),
    spread: p(0.25, '1', ASSUMPTION, { range: [0.1, 0.5], confidence: 'low', note: 'events vary a lot in what they can pay' }),
    conditionWeight: p(0.6, '1', ASSUMPTION, { range: [0.3, 0.9], confidence: 'low' }),
  },
};
