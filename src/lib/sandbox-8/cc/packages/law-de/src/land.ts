/**
 * Land and those who hold it (decision 0025): what a holder of land in Germany may do about someone
 * camping or building on it without leave, what the building authority does about a use the zoning
 * allows none of, and what the authorities fine. How holders come to notice is practice (practice-de,
 * detectionSettings). Federal law speaks for Germany; Lower Saxony's building order and enforcement
 * law for Lower Saxony (`buildingLawNi`), the two merged key by key along the chain of areas.
 */
import { ASSUMPTION, p } from './sources.ts';

const BGB_1004 = { title: '§ 1004 BGB (Beseitigungs- und Unterlassungsanspruch) with §§ 858–862 BGB (verbotene Eigenmacht, Besitzschutz)', publisher: 'BMJ (gesetze-im-internet.de)' };
const ZPO = { title: '§§ 885, 887 ZPO (Räumung, Ersatzvornahme) and the GvKostG fee schedule; § 123 StGB (Hausfriedensbruch) only where the land is fenced', publisher: 'BMJ (gesetze-im-internet.de)' };

/** what a holder does, step by step: a word (a notice), a letter (an order), the eviction (a clearance) */
export const trespass = {
  wood: {
    value: p(60, 'EUR/t', ASSUMPTION, { range: [30, 120], confidence: 'low', note: 'what the wood is worth to its holder: logs at the roadside, firewood standing (to be sourced)' }),
    rule: '§§ 823, 249 BGB (damages), § 953 BGB (the wood is the holder’s)',
  },
  steps: [
    { act: 'notice', label: 'asked to leave in person', days: p(3, 'd', ASSUMPTION, { range: [0, 7], confidence: 'low', note: 'most holders first ask; some call the police at once' }) },
    { act: 'order', label: 'a removal claim by letter (§ 1004 BGB)', days: p(14, 'd', BGB_1004, { range: [7, 28], confidence: 'low', note: 'a deadline set in the letter; the law sets none' }) },
    { act: 'clearance', label: 'cleared by court order and bailiff, at the trespasser’s cost', cost: p(1500, 'EUR', ZPO, { range: [500, 5000], confidence: 'low', note: 'court, bailiff and removal costs for a camp; far more for a building' }) },
  ],
};

const BGB_546 = { title: '§ 546 BGB (the tenant gives the thing back at the let\'s end, cleared), § 546a BGB (kept after the end: the rent agreed is owed as compensation for the time), § 985 BGB', publisher: 'BMJ (gesetze-im-internet.de)' };
const ZPO_885 = { title: '§§ 885, 885a ZPO (Räumung by the bailiff; the goods taken away and stored at the debtor\'s cost) with § 940a ZPO and the GvKostG fee schedule', publisher: 'BMJ (gesetze-im-internet.de)' };
const ZPO_885_GOODS = { title: '§ 885 Abs. 3 ZPO (goods not handed to the debtor taken by the bailiff into storage at the debtor\'s cost), Abs. 4 (not demanded within a month of the clearance, or demanded without the costs paid: sold, the proceeds deposited for the debtor; what cannot be sold is destroyed); § 788 ZPO (the costs of enforcement are the debtor\'s)', publisher: 'BMJ (gesetze-im-internet.de)' };

/**
 * A thing let and not given back at the end of its let (a yard with the tenant's goods on it): the lessor asks for it
 * back cleared, then sues for it, then has it cleared by the bailiff at the former tenant's cost; for every day it is
 * kept, the rent agreed is owed. Days and sums are estimates (to be sourced from court statistics).
 */
export const leaseEnd = {
  rule: '§ 546 BGB',
  compensation: '§ 546a BGB: the rent agreed, for the days it was kept after the let ended',
  steps: [
    { act: 'order', label: 'asked by letter to give it back cleared (§ 546 BGB), the rent owed for each day it is kept (§ 546a BGB)', days: p(14, 'd', BGB_546, { range: [7, 30], confidence: 'low', note: 'a deadline set in the letter; the law sets none' }) },
    { act: 'order', label: 'sued for it at the local court (Räumungsklage), the judgment enforceable', days: p(120, 'd', ZPO_885, { range: [30, 365], confidence: 'low', note: 'a claim for possession of business premises: some months to an enforceable judgment (estimate)' }) },
    { act: 'clearance', label: 'cleared by the bailiff, its goods taken away and stored, at the former tenant\'s cost (§§ 885, 885a ZPO)', cost: p(3000, 'EUR', ZPO_885, { range: [1500, 10_000], confidence: 'low', note: 'court, lawyer, bailiff, a removal firm and storage for a yard with some goods (estimate)' }) },
  ],
  // (the goods stay the former tenant's: stored, handed back on demand, else sold for it, review x)
  goods: {
    rule: '§ 885 Abs. 3 and 4 ZPO',
    left: '§ 885a ZPO: the enforcement limited to possession, the goods left where they are; the debtor may have them within a month, then the creditor may sell them',
    vehicle: 'flatbed',
    tries: p(3, '1', ASSUMPTION, { range: [1, 5], confidence: 'low', note: 'a removal firm that cannot get to the goods comes again on the next days, then the bailiff reports the clearance as not done (estimate)' }),
    keep: p(30, 'd', ZPO_885_GOODS, { confidence: 'high', note: 'a month from the clearance (§ 885 Abs. 4 S. 1 ZPO), or from the lessor put in possession with the goods left there (§ 885a Abs. 4 S. 1 ZPO)' }),
    fetches: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.6], confidence: 'low', note: 'a bailiff\'s sale of used stock and site gear (Versteigerung, often online on justiz-auktion.de) fetches some third of its price new (estimate: no statistic found)' }),
    saleCosts: p(0.2, '1', ZPO_885_GOODS, { range: [0.1, 0.4], confidence: 'low', note: 'the bailiff\'s fees for the sale (GvKostG KV 300 ff.), its notice and carrying, taken from what it fetches (estimate)' }),
    back: p(400, 'EUR', ASSUMPTION, { range: [200, 1000], confidence: 'low', note: 'a removal firm\'s lorry and two men bringing the goods back from storage (estimate)' }),
  },
};

const BAUGB_35 = { title: '§ 35 BauGB (Bauen im Außenbereich) with §§ 59, 60 NBauO (genehmigungspflichtige Nutzung)', publisher: 'BMJ (gesetze-im-internet.de); Niedersächsisches Vorschriftsinformationssystem' };
const NBAUO_79 = { title: '§ 79 NBauO (Baurechtswidrige Zustände: Nutzungsuntersagung) with § 28 VwVfG (Anhörung)', publisher: 'Niedersächsisches Vorschriftsinformationssystem; BMJ' };
const NBAUO_ANHANG = { title: '§ 60 NBauO with Anhang 1 (verfahrensfreie Baumaßnahmen)', publisher: 'Niedersächsisches Vorschriftsinformationssystem' };
const ZWANG = { title: '§ 70 NVwVG with §§ 65–67, 69 NPOG (Zwangsgeld, unmittelbarer Zwang)', publisher: 'Niedersächsisches Vorschriftsinformationssystem' };

const NBAUO_ASK = { title: 'NBauO § 73 (preliminary enquiry, binding for three years), §§ 64, 67, 70 (application and its decision), § 53 (who may submit plans); the Nds. building fee ordinance (BauGO); HOAI (architects’ fees)', publisher: 'Land Niedersachsen' };

/**
 * What the building authority does about a home where the zoning allows none (camp L6): living in a
 * tent or a caravan for good in the outer area is a use that needs a permit it would not give; a stay
 * of some weeks is camping. Step by step: a hearing, an order to stop the use, enforcement fines, and
 * the use ended by force. Durations and sums are estimates to be sourced (each authority sets them).
 *
 * Federal planning law (§ 35 BauGB) says when a stay in the outer area is a home; how soon one becomes
 * known is an estimate kept with it. The procedures are the state's (`buildingLawNi`).
 */
export const buildingLaw = {
  tolerance: p(90, 'd', BAUGB_35, { range: [14, 180], confidence: 'low', note: 'a stay of some weeks is camping; living there longer is a home (an estimate: the law sets no number)' }),
  notice: p(180, 'd', ASSUMPTION, { range: [30, 730], confidence: 'low', note: 'a home in the outer area becomes known through neighbours, walkers, the post or a registration (to be sourced)' }),
};

/** what Lower Saxony's building order law adds (NBauO, NVwVG with the NPOG): asking the authority, and its steps against a use or a building */
export const buildingLawNi = {
  rule: '§ 35 BauGB, § 79 NBauO',
  // asking first, or asking after the fact (VISION "Asking the authority is a deed too"): fees even when refused
  applications: {
    enquiry: { label: 'a preliminary enquiry (Bauvoranfrage, § 73 NBauO)', fee: p(200, 'EUR', NBAUO_ASK, { range: [100, 500], confidence: 'low', note: 'the building fee ordinance’s fee for a preliminary decision on whether a use may be permitted' }), designer: p(400, 'EUR', NBAUO_ASK, { range: [0, 1000], confidence: 'low', note: 'a site plan and a description, drawn up by someone who may submit plans' }), days: p(60, 'd', NBAUO_ASK, { range: [30, 120], confidence: 'low' }) },
    permit: { label: 'an application for the permit after the fact (§§ 64, 67 NBauO)', fee: p(600, 'EUR', NBAUO_ASK, { range: [300, 2000], confidence: 'low', note: 'a change of use or a small building: the building fee ordinance’s fee by the value' }), designer: p(2000, 'EUR', NBAUO_ASK, { range: [1000, 5000], confidence: 'low', note: 'the plans and the forms by an architect (HOAI, small projects)' }), days: p(90, 'd', NBAUO_ASK, { range: [30, 180], confidence: 'low', note: 'three months, longer when other offices are heard' }) },
    refusal: {
      dwelling: '§ 35 Abs. 2 and 3 BauGB: living for good in tents or a caravan is not a use privileged in the open countryside; it would begin a splinter settlement and runs against the land-use plan',
      building: '§ 35 Abs. 2 and 3 BauGB: a building that serves no farm or forestry is not privileged in the open countryside; it impairs public concerns there',
    },
  },
  // what is built in place without a permit where it may not stand (§ 59 NBauO: building needs a permit; in the outer area hardly anything is free of one)
  building: {
    rule: '§ 35 BauGB, §§ 59, 79 NBauO',
    free: p(0, 'm3', NBAUO_ANHANG, { range: [0, 40], confidence: 'low', note: 'in the outer area even small buildings and walls need a permit unless they serve a farm (Anhang 1 NBauO; to be checked)' }),
    steps: [
      { act: 'notice', label: 'a hearing before an order (Anhörung, § 28 VwVfG)', days: p(21, 'd', NBAUO_79, { range: [14, 28], confidence: 'low', note: 'the time given to answer' }) },
      { act: 'order', label: 'an order to take it down (Beseitigungsanordnung, § 79 NBauO), with a fine threatened', days: p(60, 'd', NBAUO_79, { range: [30, 180], confidence: 'low', note: 'the deadline set in the order' }) },
      { act: 'fine', label: 'an enforcement fine (Zwangsgeld)', cost: p(2000, 'EUR', ZWANG, { range: [500, 10_000], confidence: 'low' }), days: p(30, 'd', ZWANG, { range: [14, 60], confidence: 'low' }) },
      { act: 'fine', label: 'a second, higher enforcement fine', cost: p(5000, 'EUR', ZWANG, { range: [1000, 25_000], confidence: 'low' }), days: p(30, 'd', ZWANG, { range: [14, 60], confidence: 'low' }) },
      { act: 'clearance', label: 'taken down by a firm the authority sends, at the holder’s cost (Ersatzvornahme)', costPerM3: p(30, 'EUR/m3', ASSUMPTION, { range: [15, 60], confidence: 'low', note: 'demolition and carrying away by the m³ built (to be sourced)' }) },
    ],
  },
  steps: [
    { act: 'notice', label: 'a hearing before an order (Anhörung, § 28 VwVfG)', days: p(21, 'd', NBAUO_79, { range: [14, 28], confidence: 'low', note: 'the time given to answer' }) },
    { act: 'order', label: 'an order to stop living there (Nutzungsuntersagung, § 79 NBauO), with a fine threatened', days: p(30, 'd', NBAUO_79, { range: [14, 90], confidence: 'low', note: 'the deadline set in the order' }) },
    { act: 'fine', label: 'an enforcement fine (Zwangsgeld)', cost: p(1000, 'EUR', ZWANG, { range: [250, 5000], confidence: 'low' }), days: p(30, 'd', ZWANG, { range: [14, 60], confidence: 'low' }) },
    { act: 'fine', label: 'a second, higher enforcement fine', cost: p(2500, 'EUR', ZWANG, { range: [500, 10_000], confidence: 'low' }), days: p(30, 'd', ZWANG, { range: [14, 60], confidence: 'low' }) },
    { act: 'clearance', label: 'the use ended by direct force (unmittelbarer Zwang), at the cost of those who lived there', cost: p(2000, 'EUR', ZWANG, { range: [500, 10_000], confidence: 'low', note: 'officers, a removal firm and storage of what was there' }) },
  ],
};

const FKS = { title: 'Finanzkontrolle Schwarzarbeit (Zoll): annual checks of about 50,000 employers, construction a focus sector; SchwarzArbG § 8 (fines)', publisher: 'BMF / Zoll', year: 2024 };
const STVG21 = { title: '§ 21 StVG: driving without a licence, imprisonment up to one year or a fine (Geldstrafe in daily rates); police road checks', publisher: 'BMJ (gesetze-im-internet.de)' };
const SGB7 = { title: '§ 209 SGB VII (fines up to 10,000 € for breaching accident-prevention rules) with DGUV Vorschrift 1 § 7 (Befähigung) and DGUV Grundsatz 100-500/600', publisher: 'BMAS / DGUV' };

/** how the authorities come to know of what is against the law, and what it costs */
const KRWG = { title: '§ 28 KrWG (waste only in licensed plants), § 69 KrWG (fines up to 100,000 €); the Länder fine catalogues for the environment (burning waste in the open: some hundreds of euros)', publisher: 'BMUV / Länder' };
export const enforcement = {
  burningWaste: {
    label: 'Burning waste in the open (§ 28 KrWG)',
    foundPerYear: p(3, '1/a', KRWG, { range: [0.5, 10], confidence: 'low', note: 'the smoke and its smell carry: neighbours and passers-by call the authority; far from anyone less' }),
    fine: p(300, 'EUR', KRWG, { range: [100, 2500], confidence: 'low', note: 'a first case of household rubbish burnt' }),
    kind: 'administrative',
    by: 'umweltamt',
    byLabel: 'Umweltamt des Landkreises (the lower waste authority)',
  },
  undeclaredWork: {
    label: 'Undeclared work (SchwarzArbG)',
    foundPerYear: p(0.05, '1/a', FKS, { range: [0.01, 0.2], confidence: 'low', note: 'the chance a year that a check finds it; on a busy site more, in a private garden hardly ever' }),
    fine: p(3000, 'EUR', FKS, { range: [500, 30_000], confidence: 'low', note: 'what an occasional case of unpaid help beyond a favour costs; organised undeclared work up to 300,000 €' }),
    // (a regulatory offence, fined by the customs' Financial Control of Undeclared Work)
    kind: 'administrative',
    by: 'hauptzollamt',
    byLabel: 'Hauptzollamt (Finanzkontrolle Schwarzarbeit)',
  },
  unlicensedDriving: {
    label: 'Driving without a licence (§ 21 StVG)',
    foundPerYear: p(0.2, '1/a', STVG21, { range: [0.05, 1], confidence: 'low', note: 'a road check or an accident, for someone who drives now and then' }),
    fine: p(2000, 'EUR', STVG21, { range: [500, 10_000], confidence: 'low', note: 'a fine of some 30–60 daily rates for a first offence; the car may be taken and a licence barred for a time (not modelled)' }),
    // (a criminal offence: a penalty order of the local court, on the public prosecutor's application, who enforces it, § 451 StPO; the driver's own)
    kind: 'criminal',
    by: 'staatsanwaltschaft',
    byLabel: 'Staatsanwaltschaft (enforcement of the penalty order)',
  },
  unlicensedWork: {
    label: 'Work without the certificate the rules ask for',
    foundPerYear: p(0.1, '1/a', SGB7, { range: [0.02, 0.3], confidence: 'low', note: 'inspections of the Berufsgenossenschaft and after accidents' }),
    fine: p(1000, 'EUR', SGB7, { range: [100, 10_000], confidence: 'low' }),
    // (a regulatory offence, fined by the accident insurer of the trade)
    kind: 'administrative',
    by: 'bg-bau',
    byLabel: 'BG BAU (Berufsgenossenschaft der Bauwirtschaft)',
  },
};
