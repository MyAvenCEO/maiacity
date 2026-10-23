/**
 * Insolvency in Germany (Insolvenzordnung): when a party unable to pay comes before the court, and what
 * the administrator keeps to while winding it up.
 */
import { ASSUMPTION, p } from './sources.ts';

const INSO = { title: 'Insolvenzordnung (InsO): § 17 Zahlungsunfähigkeit, § 15a Antragspflicht, §§ 21–22 vorläufiges Verfahren, § 80 Übergang des Verwaltungs- und Verfügungsrechts, §§ 109, 113 Kündigung', publisher: 'BMJ (gesetze-im-internet.de)' };
const BGH_17 = { title: 'BGH, Urteil vom 24.5.2005, IX ZR 123/04: unable to pay when a gap of 10 % or more is not closed within three weeks', publisher: 'Bundesgerichtshof' };

export const insolvencyLaw = {
  // § 15a InsO binds legal persons (a GmbH, an AG); a household or a person files for itself (consumer insolvency), not modelled yet
  filingDuty: ['company'],
  filingDays: p(21, 'd', BGH_17, { range: [21, 42], confidence: 'medium', note: 'three weeks unable to pay (§ 17 InsO, BGH): a company must then file (§ 15a InsO: at most three weeks)' }),
  openingDays: p(30, 'd', ASSUMPTION, { range: [14, 90], confidence: 'low', note: 'the preliminary proceedings until the court opens or dismisses (an expert’s report on the assets; usually one to three months)' }),
  maxNotice: p(90, 'd', INSO, { confidence: 'high', note: '§ 113 InsO (employees) and § 109 InsO (leases of the debtor as tenant): at most three months to the end of a month' }),
  liquidationShare: p(0.6, '1', ASSUMPTION, { range: [0.4, 0.8], confidence: 'low', note: 'what an administrator asks for used plant sold quickly (auctions, dealers), against its market value (to be sourced)' }),
  court: 'the insolvency court (Amtsgericht Göttingen)',
  rule: '§§ 15a, 17, 80 InsO',
};

/**
 * An estate: a party with nobody left of it (its last person dead, a company dissolved) is wound up by its heirs or
 * liquidators (§§ 1922, 1967 BGB; § 70 GmbHG). A tenancy does not end with the tenant's death (§ 564 S. 1 BGB), but the
 * heirs may end it by extraordinary notice with the law's period, a fixed term too (§ 564 S. 2 for a home, within a
 * month of learning of the death; § 580 for other things let): given at once here, at the earliest lawful date.
 */
export const estateLaw = {
  rule: '§§ 564, 580 BGB: the heirs’ extraordinary notice with the law’s period',
  fixedTerm: true,
};
