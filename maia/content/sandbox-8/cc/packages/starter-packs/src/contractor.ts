/**
 * The contractor start: a small municipal civil-engineering contractor with a yard by the public
 * road, a permanent crew, an owned fleet, a full diesel tank, capital and a credit line.
 */
import { FIRM_FIXED_COSTS, SCENARIO, p } from './sources.ts';

const starter = {
  label: 'Contractor',
  party: { id: 'weber-bau', label: 'Weber Tief- und Straßenbau GmbH', kind: 'company' },
  books: {
    capital: p(3_000_000, 'EUR', SCENARIO, { note: 'scenario: equity of a mid-sized civil-engineering contractor setting up the project' }),
    creditLimit: p(500_000, 'EUR', SCENARIO, { note: 'scenario: Kontokorrent line' }),
    // (wave 24/25: the site containers, toilets and fencing a site hires are the site's, the toilets and water goods in the
    // yard; what is left is what the firm pays whatever it does)
    dailyOverhead: p(110, 'EUR/d', FIRM_FIXED_COSTS, {
      range: [70, 200],
      confidence: 'low',
      note: 'a year: tax adviser (payroll of fifteen, bookkeeping, annual accounts of a turnover of some 2.5 M€) ≈ 19,000; liability insurance ≈ 5,000 (estimate); Handwerkskammer (road building) 480 + 0.91 % of the trade profit ≈ 2,300; phone, IT, software ≈ 4,000 (estimate); its own yard (property tax, buildings insurance, power and water for the office and workshop) ≈ 8,000 (estimate); ≈ 38,000 € a year, some 105 € a calendar day. Not in it: the tax and insurance of the lorries (not modelled per vehicle)',
    }),
  },
  crew: [
    { job: 'siteManager', count: 1 },
    { job: 'foreman', count: 1 },
    { job: 'surveyor', count: 1 },
    { job: 'plantOperator', count: 3 },
    { job: 'roadPlantOperator', count: 2 },
    { job: 'truckDriver', count: 3 },
    { job: 'forester', count: 1 },
    { job: 'worker', count: 3 },
  ],
  fleet: [
    { model: 'exc22', ownership: 'owned' },
    { model: 'loader', ownership: 'owned' },
    { model: 'grader', ownership: 'owned' },
    { model: 'roller12', ownership: 'owned' },
    { model: 'tipper4', ownership: 'owned' },
    { model: 'tipper4', ownership: 'owned' },
    { model: 'tipper4', ownership: 'owned' },
    { model: 'surveyKit', ownership: 'owned' },
    { model: 'chainsaw', ownership: 'owned' },
  ],
  /** family and friends who can come and help (unpaid, fed while here) */
  circle: [
    { name: 'Katrin Weber', relation: 'family', resident: false, daysPerYear: p(20, 'd', SCENARIO, { note: 'a sister nearby with a part-time job' }), travelDays: p(0, 'd', SCENARIO), birthYear: 1986, experience: { labour: 3000, survey: 150 }, certificates: [] },
    { name: 'Markus Weber', relation: 'family', resident: false, daysPerYear: p(15, 'd', SCENARIO, { note: 'a cousin, forestry worker, comes in his holidays' }), travelDays: p(1, 'd', SCENARIO), birthYear: 1979, experience: { labour: 9000, chainsaw: 1500 }, certificates: ['chainsaw'] },
    { name: 'Tobias Krause', relation: 'friend', resident: false, daysPerYear: p(30, 'd', SCENARIO, { note: 'a lorry driver between contracts; the law limits what he may do unpaid' }), travelDays: p(1, 'd', SCENARIO), birthYear: 1983, experience: { 'driver.ce': 9000, labour: 1000 }, certificates: ['driver.ce'] },
  ],
  stock: [
    // the yard's diesel tank starts with a delivery already paid for
    { material: 'diesel', qty: p(8000, 'l', SCENARIO) },
    // and a 200 l drum of 2-stroke mix for the chainsaws
    { material: 'petrol.2t', qty: p(200, 'l', SCENARIO) },
    // the yard's welfare (realism S1b): a toilet cabin and crates of water, for the building's WC and tap (not modelled)
    { material: 'toilet.mobile', qty: p(2, 'pcs', SCENARIO, { note: 'scenario: two toilets for a crew of 15 at the yard' }) },
    { material: 'water.drinking', qty: p(300, 'l', SCENARIO, { note: 'scenario: crates of bottled water in the yard' }) },
  ],
  /** where it settles: a yard beside the end of the way in, cleared already */
  base: { label: 'Bauhof (contractor yard)', kind: 'depot', clear: true },
};

export const contractor = { starters: { contractor: starter } };
