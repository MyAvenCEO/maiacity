/**
 * How things are let in Germany (the law and custom of it): homes, business premises, halls by
 * the day. Rent levels and tenants' behaviour are the economy pack's.
 */
import { ASSUMPTION, p } from './sources.ts';

const BGB = (para: string, what: string) => ({ title: `${para} BGB: ${what}`, publisher: 'BMJ (gesetze-im-internet.de)' });

export const lettingUses = {
  home: {
    label: 'Home (residential tenancy)',
    description: 'Let as a home for as long as the tenant wants: the landlord cannot simply give notice (§ 573 BGB needs a legitimate interest).',
    types: ['efh'],
    period: 'month',
    tenantNotice: p(91, 'd', BGB('§ 573c Abs. 1', "the tenant's notice is three months"), { confidence: 'high' }),
    depositPeriods: p(3, '1', BGB('§ 551 Abs. 1', 'a deposit of at most three months of net rent'), { confidence: 'high', note: 'the usual deposit is the legal maximum' }),
    areaShare: p(0.75, '1', ASSUMPTION, { range: [0.65, 0.85], confidence: 'low', note: 'living area (WoFlV) as a share of the gross floor area of a single-family house' }),
    rentCap: p(1.1, '1', BGB('§ 556d Abs. 1', 'in areas with a tight housing market (Göttingen under the Lower Saxony tenant protection ordinance) a new let may ask at most 10 % above the local comparative rent'), { confidence: 'medium', note: 'new buildings first let after 1 October 2014 are exempt (§ 556f BGB); the cap is kept here for simplicity' }),
    capClaim: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.6], confidence: 'low', note: 'of tenants who sign above the cap, those who claim the excess as void (§ 556g BGB) at once; many do not know the rule or do not want a quarrel at the start (to be sourced)' }),
    arrearsLimit: p(2, '1', BGB('§ 543 Abs. 2 Nr. 3', 'two months of rent in arrears entitle the landlord to end the let without notice'), { confidence: 'high' }),
    tenantKind: 'household',
    tenantLabel: 'Household',
  },
  premises: {
    label: 'Business premises',
    description: 'Let to a firm as a workshop, store or depot; either side can give notice.',
    types: ['hall'],
    period: 'month',
    tenantNotice: p(182, 'd', BGB('§ 580a Abs. 2', 'business premises: notice by the third working day of a quarter to the end of the next quarter (about six months)'), { confidence: 'high' }),
    landlordNotice: p(182, 'd', BGB('§ 580a Abs. 2', 'business premises: the same notice for the landlord'), { confidence: 'high' }),
    depositPeriods: p(3, '1', ASSUMPTION, { range: [0, 6], confidence: 'medium', note: 'no legal cap for business premises; three months is usual' }),
    arrearsLimit: p(2, '1', BGB('§ 543 Abs. 2 Nr. 3', 'two months of rent in arrears entitle the landlord to end the let without notice'), { confidence: 'high' }),
    areaShare: p(0.9, '1', ASSUMPTION, { range: [0.8, 0.95], confidence: 'low', note: 'usable area as a share of the gross floor area of a hall' }),
    tenantKind: 'firm',
    tenantLabel: 'Firm',
  },
  dayHire: {
    label: 'Hall by the day (events, training, storage)',
    description: 'Booked for a day at a time; the hall stays on offer between bookings.',
    types: ['hall'],
    period: 'day',
    bookingDays: p(1, 'd', ASSUMPTION, { confidence: 'medium' }),
    tenantNotice: p(0, 'd', ASSUMPTION, { confidence: 'high', note: 'a booking ends by itself' }),
    areaShare: p(0.9, '1', ASSUMPTION, { range: [0.8, 0.95], confidence: 'low' }),
    tenantKind: 'firm',
    tenantLabel: 'Event booking',
  },
};
