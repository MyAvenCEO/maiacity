/**
 * Banks and what they offer (docs/design/economy.md). Rates from the ECB/Bundesbank MFI interest
 * rate statistics for German non-financial corporations, August 2026 (research/de/finance.md).
 */
import type { Source } from '../../kernel/src/index.ts';
import { ASSUMPTION, p } from './sources.ts';

export const MIR: Source = { title: 'ECB Data Portal, MFI interest rate statistics (MIR), Germany, non-financial corporations, 2026-08', publisher: 'European Central Bank / Deutsche Bundesbank', year: 2026, url: 'https://data.ecb.europa.eu/data/datasets/MIR' };

export const counterparties = {
  houseBank: { label: 'Kreissparkasse (house bank)', kind: 'bank', description: 'The regional savings bank that keeps the company account.' },
  yardLandlord: { label: 'Grundstücksgesellschaft (landlord)', kind: 'firm', description: 'Owns the yard by the public road and lets it to firms.' },
  hofLindemann: { label: 'Hof Lindemann (farmer)', kind: 'household', description: 'A farming family with fields and a wood in the valley; a world may give them land.' },
  vsn: { label: 'Verkehrsverbund Süd-Niedersachsen (VSN, buses and trains)', kind: 'firm', description: 'The regional transport association: its buses and trains, single tickets and the Deutschlandticket.' },
  bauaufsicht: { label: 'Bauaufsicht Landkreis Göttingen (building authority)', kind: 'public', description: 'The district’s building authority: it permits and forbids what is built and lived in.' },
  gemeinde: { label: 'Gemeinde (municipality: its streets)', kind: 'public', description: 'The municipality the valley belongs to: it dedicates streets to public use, takes them over from those who built them and keeps them.' },
};

export const products = {
  campingPermission: {
    label: 'Permission to camp on a farmer’s land',
    description: 'The farmer lets a corner of a field or wood for a tent and a fireplace, by the month (a small lease, Pacht).',
    party: 'hofLindemann',
    instrument: 'lease',
    role: 'lessee',
    subjectKind: 'parcel',
    terms: {
      rent: p(60, 'EUR', ASSUMPTION, { range: [0, 200], confidence: 'low', note: 'a month; many farmers would ask little or nothing of someone they know, others say no' }),
      period: 'month',
      tenantNotice: p(14, 'd', ASSUMPTION, { confidence: 'low' }),
      landlordNotice: p(14, 'd', ASSUMPTION, { confidence: 'low' }),
      arrearsLimit: p(2, '1', { title: '§ 543 Abs. 2 Nr. 3 BGB', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'medium' }),
    },
    leadTime: p(1, 'd', ASSUMPTION, { range: [0, 7], confidence: 'low', note: 'a talk at the farm gate' }),
  },
  standingWood: {
    label: 'Wood to fell on a farmer’s land (Selbstwerber)',
    description: 'The farmer lets you fell trees in their wood over the felling season and take them away, paid by the tonne of logs felled. No camping with it.',
    party: 'hofLindemann',
    instrument: 'lease',
    role: 'lessee',
    subjectKind: 'parcel',
    permits: ['felling'],
    terms: {
      rent: p(0, 'EUR', ASSUMPTION, { confidence: 'low', note: 'nothing for the season itself: the wood is paid for' }),
      period: 'month',
      days: p(150, 'd', ASSUMPTION, { range: [90, 180], confidence: 'low', note: 'a felling season, October to March (fewer birds nesting, sap down)' }),
      royalty: p(35, 'EUR/t', ASSUMPTION, { range: [20, 60], confidence: 'low', note: 'ESTIMATE, to be sourced: self-cut firewood (Selbstwerber) ≈ 15–30 EUR a stacked m³, some 0.5–0.7 t green; a farmer may ask more for stem wood' }),
      tenantNotice: p(0, 'd', ASSUMPTION, { confidence: 'low' }),
      landlordNotice: p(14, 'd', ASSUMPTION, { confidence: 'low' }),
    },
    leadTime: p(1, 'd', ASSUMPTION, { range: [0, 7], confidence: 'low', note: 'a talk at the farm gate; the trees are shown' }),
  },
  deutschlandticket: {
    label: 'Deutschlandticket (monthly pass)',
    description: 'A personal monthly pass for every local bus and train in Germany, by subscription: paid each month, ended by the month.',
    party: 'vsn',
    instrument: 'lease',
    role: 'lessee',
    subjectKind: 'person',
    permits: ['transit'],
    terms: {
      rent: p(63, 'EUR', { title: 'Verkehrsministerkonferenz, decision of 18 Sept 2025: the Deutschlandticket costs 63 € a month from 1 Jan 2026', publisher: 'VMK / BMV' }, { range: [58, 70], confidence: 'medium', note: 'a month (58 € in 2025); later rises not known' }),
      period: 'month',
      expense: 'transport',
      tenantNotice: p(21, 'd', ASSUMPTION, { range: [10, 31], confidence: 'low', note: 'cancelled by the 10th for the end of the month in most subscriptions' }),
      arrearsLimit: p(1, '1', ASSUMPTION, { confidence: 'low', note: 'an unpaid month ends the subscription' }),
    },
    leadTime: p(1, 'd', ASSUMPTION, { range: [0, 7], confidence: 'low', note: 'bought in an app; a subscription by post takes longer' }),
  },
  yardLease: {
    label: 'Yard by the public road (rented)',
    description: 'A paved yard of about 3,000 m² with office and workshop containers, let to a firm.',
    party: 'yardLandlord',
    instrument: 'lease',
    role: 'lessee',
    subjectKind: 'store',
    unique: true,
    terms: {
      rent: p(5500, 'EUR', ASSUMPTION, { range: [3000, 9000], confidence: 'low', note: 'about 1.80 €/m² a month for a paved commercial yard with containers near Göttingen (2025–26)' }),
      period: 'month',
      deposit: p(16500, 'EUR', ASSUMPTION, { range: [0, 33000], confidence: 'low', note: 'three months, usual for business premises' }),
      tenantNotice: p(182, 'd', { title: '§ 580a Abs. 2 BGB: business premises, about six months', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
      landlordNotice: p(182, 'd', { title: '§ 580a Abs. 2 BGB: business premises, about six months', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
      arrearsLimit: p(2, '1', { title: '§ 543 Abs. 2 Nr. 3 BGB: two months of rent in arrears entitle the landlord to end the let without notice', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
    },
    leadTime: p(0, 'd', ASSUMPTION, { confidence: 'medium', note: 'the starter rents it already; for a new let, the landlord and the firm agree within days' }),
  },
  callDeposit: {
    label: 'Tagesgeld (business call deposit)',
    description: 'Money that is not needed for a while earns interest and stays available.',
    party: 'houseBank',
    instrument: 'callDeposit',
    role: 'depositor',
    terms: {
      rate: p(0.015, '1/a', MIR, { range: [0.008, 0.0225], confidence: 'medium', note: 'between the overnight-deposit average of 0.81 % (MIR L21, outstanding) and the 1-year term rate of 2.25 % (MIR L22, new business); call deposits offered to win money pay near the upper end' }),
      withdrawalNotice: p(0, 'd', ASSUMPTION, { confidence: 'medium', note: 'Tagesgeld: available every banking day' }),
    },
    minAmount: p(5000, 'EUR', ASSUMPTION, { range: [0, 25000], confidence: 'low' }),
    leadTime: p(1, 'd', ASSUMPTION, { range: [0, 5], confidence: 'low', note: 'a sub-account at the house bank: no new identity checks' }),
  },
  termDeposit3m: {
    label: 'Festgeld 3 months',
    party: 'houseBank',
    instrument: 'termDeposit',
    role: 'depositor',
    terms: {
      rate: p(0.02, '1/a', MIR, { range: [0.015, 0.025], confidence: 'low', note: 'MIR L22 (agreed maturity up to 1 year, new business) is 2.25 %; shorter terms pay somewhat less' }),
      term: p(91, 'd', ASSUMPTION, { confidence: 'high' }),
    },
    minAmount: p(10000, 'EUR', ASSUMPTION, { range: [2500, 50000], confidence: 'low' }),
    leadTime: p(1, 'd', ASSUMPTION, { range: [0, 5], confidence: 'low' }),
  },
  investmentLoan: {
    label: 'Investitionskredit (5-year investment loan)',
    description: 'Borrow for machines, buildings or land: an annuity over five years at a fixed rate.',
    party: 'houseBank',
    instrument: 'loan',
    role: 'borrower',
    terms: {
      rate: p(0.0429, '1/a', MIR, { range: [0.035, 0.055], confidence: 'medium', note: 'MIR A2A, loans to corporations over EUR 0.25 M up to 1 M, new business, 2026-08; up to 0.25 M: 4.70 %' }),
      months: p(60, 'mo', ASSUMPTION, { confidence: 'high' }),
      repayment: 'annuity',
      prepaymentFee: p(0.02, '1', ASSUMPTION, { range: [0.005, 0.05], confidence: 'low', note: 'Vorfälligkeitsentschädigung for a fixed-rate business loan depends on the rate difference; about 1–3 % of the amount repaid early' }),
      maxDebtToNetWorth: p(1.5, '1', ASSUMPTION, { range: [1, 2.5], confidence: 'low', note: 'banks lend to small firms while the equity ratio stays above roughly 30–40 %' }),
      defaultAfter: p(60, 'd', ASSUMPTION, { range: [30, 90], confidence: 'low', note: 'two missed instalments typically entitle the bank to call in the loan' }),
    },
    minAmount: p(50_000, 'EUR', ASSUMPTION, { range: [10_000, 100_000], confidence: 'low' }),
    maxAmount: p(1_000_000, 'EUR', ASSUMPTION, { range: [250_000, 5_000_000], confidence: 'low' }),
    leadTime: p(21, 'd', ASSUMPTION, { range: [7, 42], confidence: 'low', note: 'credit assessment and approval of a business loan: two to six weeks' }),
  },
  operatingLoan: {
    label: 'Betriebsmittelkredit (12-month operating loan)',
    description: 'Bridge a gap in cash: interest monthly, the whole amount back after a year.',
    party: 'houseBank',
    instrument: 'loan',
    role: 'borrower',
    terms: {
      rate: p(0.0434, '1/a', MIR, { range: [0.035, 0.06], confidence: 'medium', note: 'MIR A2A, loans to corporations up to EUR 0.25 M, variable rate / fixation up to 1 year, new business, 2026-08' }),
      months: p(12, 'mo', ASSUMPTION, { confidence: 'high' }),
      repayment: 'bullet',
      prepaymentFee: p(0, '1', ASSUMPTION, { confidence: 'medium', note: 'a variable-rate loan can be repaid without a fee' }),
      maxDebtToNetWorth: p(1.5, '1', ASSUMPTION, { range: [1, 2.5], confidence: 'low', note: 'banks lend to small firms while the equity ratio stays above roughly 30–40 %' }),
      defaultAfter: p(60, 'd', ASSUMPTION, { range: [30, 90], confidence: 'low' }),
    },
    minAmount: p(10_000, 'EUR', ASSUMPTION, { confidence: 'low' }),
    maxAmount: p(250_000, 'EUR', ASSUMPTION, { range: [50_000, 500_000], confidence: 'low' }),
    leadTime: p(10, 'd', ASSUMPTION, { range: [3, 21], confidence: 'low' }),
  },
  termDeposit12m: {
    label: 'Festgeld 12 months',
    party: 'houseBank',
    instrument: 'termDeposit',
    role: 'depositor',
    terms: {
      rate: p(0.0225, '1/a', MIR, { range: [0.019, 0.027], confidence: 'medium', note: 'MIR L22, deposits with an agreed maturity up to 1 year, new business, 2026-08' }),
      term: p(365, 'd', ASSUMPTION, { confidence: 'high' }),
    },
    minAmount: p(10000, 'EUR', ASSUMPTION, { range: [2500, 50000], confidence: 'low' }),
    leadTime: p(1, 'd', ASSUMPTION, { range: [0, 5], confidence: 'low' }),
  },
};
