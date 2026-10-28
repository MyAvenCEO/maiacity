/**
 * The German construction cycle: an AR(1) process on the log of production in construction
 * against its 2000–2026 mean, fitted to Eurostat sts_copr_m (DE, seasonally and calendar adjusted;
 * fitted on quarterly means, converted to months). The record shows irregular booms and busts
 * (2005–2010 low, 2016–2023 high), no regular period: an AR(2) fit has real roots.
 */
import { eurostatCoprDe } from './datasets/eurostat-copr-de.ts';
import { p } from './sources.ts';

const COPR = eurostatCoprDe.source;

export const constructionCycleModel = {
  start: p(1.021, '1', COPR, { note: 'Q2/2026: mean adjusted index 91.3 against the 2000–2026 mean 89.4', confidence: 'medium' }),
  startMonth: '2026-05',
  persistence: p(0.969, '1', COPR, { range: [0.95, 0.985], note: 'quarterly AR(1) on the log level 0.909 (2000–2026), per month 0.909^(1/3): a boom or bust halves in ≈ 22 months', confidence: 'medium' }),
  shock: p(0.0194, '1', COPR, { range: [0.015, 0.03], note: 'from the spread of the log level (σ 0.078) and the persistence: σ·√(1−ρ²); the monthly record is noisier (σ 0.03), most of it measurement noise', confidence: 'medium' }),
};

/** recorded construction-activity series, by id (decision 0022) */
export const datasets: Record<string, unknown> = { [eurostatCoprDe.id]: eurostatCoprDe };
