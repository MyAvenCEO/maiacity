/**
 * Economy settings: overdraft interest, construction price escalation (road-construction price
 * index trend) and how prices follow the construction cycle. The capital, credit line and
 * overhead a party starts with come from its starter pack.
 */
import { ASSUMPTION, BAUPREIS_BW, p } from './sources.ts';
import { MIR } from './finance.ts';

export const economySettings = {
  overdraftRate: p(0.0505, '1/a', MIR, {
    range: [0.04, 0.09],
    confidence: 'medium',
    note: 'MIR A2Z: revolving loans and overdrafts to corporations, Germany, 2026-08 (research/de/finance.md); small firms pay more than the average',
  }),
  priceEscalation: p(0.03, '1/a', BAUPREIS_BW, {
    range: [0.02, 0.055],
    confidence: 'medium',
    note: 'Straßenbau index BW: 2019→2024 ≈ +5.5 %/a incl. the 2022 shock (97 → ≈127), Aug 2024 +5.0 % y/y; pre-2021 trend ≈ +2–3 %/a. Scenario assumes moderation to 3 %/a.',
  }),
  cyclePriceElasticity: p(0.6, '1', ASSUMPTION, {
    range: [0.2, 1.2],
    confidence: 'low',
    note: 'construction prices rose faster in the 2016–2022 boom (activity ≈ 1.03–1.11 of normal, Baupreisindex +3–4 %/a before the 2022 shock) than in the 2005–2010 low (≈ 0.91, +1–2 %/a): a level about 5 % above trend for 10 % more activity. The pack prices are 2025/26 prices, at about normal activity (1.01–1.02).',
  }),
};
