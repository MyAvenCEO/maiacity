/**
 * A small contractor that rents its yard: a handful of people, a few machines, less capital, and
 * rent to the landlord from the first day.
 */
import { FIRM_FIXED_COSTS, SCENARIO, p } from './sources.ts';

const starter = {
  label: 'Small contractor (renting its yard)',
  party: { id: 'kraemer-erdbau', label: 'Krämer Erdbau', kind: 'company' },
  books: {
    capital: p(700_000, 'EUR', SCENARIO, { note: 'scenario: equity of a small earthworks contractor — its machines (about 480 k) and about four months of running costs' }),
    creditLimit: p(150_000, 'EUR', SCENARIO, { note: 'scenario: Kontokorrent line' }),
    // (wave 24/25, S503/S508: 350 €/d for "site containers, toilets, fencing … insurance, office" ran on with no site at all;
    // the toilets and water are goods in the yard now, the office and workshop containers come with the yard's rent, and a
    // site's set-up is the site's: what is left is what the firm pays whatever it does)
    dailyOverhead: p(40, 'EUR/d', FIRM_FIXED_COSTS, {
      range: [25, 90],
      confidence: 'low',
      note: 'a year: tax adviser (payroll of six, bookkeeping, annual accounts) ≈ 8,000; liability insurance of an earthworks firm ≈ 2,500 (estimate: no published premium found); IHK ≈ 400–550 (an earthworks firm, little profit); phone, software, bank ≈ 2,000 (estimate); ≈ 13,000–14,500 € a year, some 40 € a calendar day. Not in it: the tax and insurance of the lorries (not modelled per vehicle)',
    }),
  },
  crew: [
    { job: 'foreman', count: 1 },
    { job: 'plantOperator', count: 1 },
    { job: 'truckDriver', count: 2 },
    { job: 'worker', count: 2 },
  ],
  fleet: [
    { model: 'exc22', ownership: 'owned' },
    { model: 'tipper4', ownership: 'owned' },
    { model: 'surveyKit', ownership: 'owned' },
  ],
  stock: [
    { material: 'diesel', qty: p(3000, 'l', SCENARIO) },
    // the yard's welfare (realism S1b): a toilet cabin and crates of water, for the building's WC and tap (not modelled)
    { material: 'toilet.mobile', qty: p(1, 'pcs', SCENARIO, { note: 'scenario: a toilet for a crew of a few at the yard' }) },
    { material: 'water.drinking', qty: p(100, 'l', SCENARIO, { note: 'scenario: crates of bottled water in the yard' }) },
  ],
  rents: [{ product: 'yardLease', subject: 'yard' }],
  /** where it settles: a yard beside the end of the way in, cleared already */
  base: { label: 'Bauhof (contractor yard)', kind: 'depot', clear: true },
};

export const smallContractor = { starters: { smallContractor: starter } };
