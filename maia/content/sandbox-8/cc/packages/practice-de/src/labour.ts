/**
 * Qualifications (German trade certificates) and working-time law: the tariff week (BRTV), annual
 * leave, the ArbZG daily maximum and minimum breaks. Temporary agency work for construction labour
 * is banned (§ 1b AÜG), so the game offers none. Wages and the labour market are in the economy pack.
 */
import { ASSUMPTION, ARBZG, TARIF_MV, cite, p } from './sources.ts';

const DGUV_EARTH = { title: 'DGUV Regel 100-500, Kap. 2.12 (Erdbaumaschinen) / 2.15 (Straßenbaumaschinen): machines only by operators aged 18+, trained and authorised in writing by the employer', publisher: 'DGUV', year: 2023 };
const FEV = { title: 'Fahrerlaubnis-Verordnung (class CE) and Berufskraftfahrerqualifikationsgesetz (BKrFQG): HGV licence and driver qualification for commercial haulage', publisher: 'BMJ (gesetze-im-internet.de)' };
const FEV_B = { title: 'Fahrerlaubnis-Verordnung (FeV) § 6: class B, motor vehicles up to 3.5 t (a trailer up to 750 kg, or 3.5 t together)', publisher: 'BMJ (gesetze-im-internet.de)' };
const DGUV_SAW = { title: 'DGUV Information 214-059: chainsaw work only after training (Motorsägenlehrgang)', publisher: 'DGUV', year: 2019 };
const earth = { certificate: true, certificateSource: DGUV_EARTH };

/** skills, and whether German law asks for a certificate to exercise them commercially */
export const qualifications = {
  labour: { label: 'Bauwerker (general site labour)', category: 'labour', certificate: false, open: true },
  'op.excavator': { label: 'Baggerführer (excavator operator)', category: 'operator', ...earth },
  'op.loader': { label: 'Radladerfahrer (wheel loader operator)', category: 'operator', ...earth },
  'op.dozer': { label: 'Raupenfahrer (dozer operator)', category: 'operator', ...earth },
  'op.grader': { label: 'Graderfahrer (motor grader operator)', category: 'operator', description: 'Fine grading to ±3 cm Planum tolerance (ZTV E-StB), usually with 3D machine control.', ...earth },
  'op.roller': { label: 'Walzenfahrer (roller operator)', category: 'operator', ...earth },
  'op.paver': { label: 'Fertigerfahrer / Bohlenführer (paver operator, screedman)', category: 'operator', ...earth },
  'driver.b': { label: 'Führerschein Klasse B (cars and vans up to 3.5 t)', category: 'driver', certificate: true, certificateSource: FEV_B },
  'driver.ce': { label: 'Berufskraftfahrer CE (HGV licence + BKrFQG)', category: 'driver', certificate: true, certificateSource: FEV },
  survey: { label: 'Vermessung / Absteckung (setting out, GNSS rover)', category: 'engineering', certificate: false },
  chainsaw: { label: 'Motorsägenschein (chainsaw certificate, DGUV 214-059)', category: 'trade', certificate: true, certificateSource: DGUV_SAW },
  foreman: { label: 'Polier (site foreman)', category: 'supervision', certificate: false },
  engineer: { label: 'Bauingenieur / Bauleiter (site engineer)', category: 'engineering', certificate: false },
  asphalt: { label: 'Asphaltbauer (asphalt worker)', category: 'trade', certificate: false },
};

const h = (v: number) => p(v, 'h');
const workday = (start: number, end: number, breaks: number) => ({ start: h(start), end: h(end), breaks: h(breaks) });
const off = workday(0, 0, 0);
/** a weight of the leave season, from a day of the year on: the pack author's estimate (no survey of when leave is taken at hand) */
const leaveFrom = (month: number, day: number, weight: number, note: string) => ({ month, day, weight: p(weight, '1', ASSUMPTION, { confidence: 'low', note }) });

export const labourSettings = {
  // how people get about: one living beyond the map comes to work by car (some two thirds of commuters in Germany,
  // Mikrozensus 2020: to be cited), on the map on foot; at a place is within a short call of it
  ways: {
    commute: 'car',
    walk: 'foot',
    hearing: p(40, 'm', ASSUMPTION, { range: [15, 80], confidence: 'low', note: 'a word called across a quiet site; a running machine shortens it (not yet modelled)' }),
    phoneDays: p(1.5, 'd', ASSUMPTION, { range: [0.5, 3], confidence: 'low', note: 'a smartphone in use, without a charger' }),
    phoneBattery: p(0.015, 'kWh', ASSUMPTION, { range: [0.01, 0.02], confidence: 'medium', note: 'a smartphone of some 4,000 mAh at 3.85 V' }),
    phoneCharger: p(0.01, 'kW', ASSUMPTION, { range: [0.005, 0.025], confidence: 'medium', note: 'a USB charger of 5 V and 2 A (USB BC 1.2: 1.5 A at 5 V at least); a fast charger 18–25 W' }),
    phoneCharging: p(0.8, '1', ASSUMPTION, { range: [0.7, 0.9], confidence: 'low', note: 'a USB charger from a power station’s socket, and the phone’s own charging' }),
    reach: p(15, 'm', ASSUMPTION, { range: [5, 30], confidence: 'low', note: 'at a yard, a camp or a work front: within a short call of it (closer than the work’s own reach, so one sent to it is at it)' }),
  },
  vacationDaysPerYear: p(30, 'd', cite(TARIF_MV, 'Urlaubsdauer 30 Arbeitstage'), { confidence: 'high' }),
  // when leave is taken: the school summer holidays and the Christmas break dominate in Germany (the states' summer
  // holidays are staggered over June to September), January and November least; the one long block of the year, two
  // weeks, in the summer months, June to August
  vacationSeason: {
    weights: [
      leaveFrom(1, 1, 0.4, 'January: the Christmas break just over'),
      leaveFrom(2, 1, 0.7, 'February and March: winter and early spring holidays of a week'),
      leaveFrom(4, 1, 1.3, 'April: the Easter holidays'),
      leaveFrom(5, 1, 1.1, 'May: bridge days around the spring holidays'),
      leaveFrom(6, 1, 1.5, 'June: the first states’ summer holidays begin'),
      leaveFrom(7, 1, 3, 'July and August: the school summer holidays'),
      leaveFrom(9, 1, 1.1, 'September: the last summer holidays, late summer'),
      leaveFrom(10, 1, 1.3, 'October: the autumn holidays'),
      leaveFrom(11, 1, 0.4, 'November: no school holidays'),
      leaveFrom(12, 1, 0.7, 'December before the Christmas break'),
      leaveFrom(12, 18, 5, 'the Christmas break: schools close about the 20th, many firms between the years'),
    ],
    long: { from: 6, to: 8 },
  },
  /**
   * Monday..Sunday. 4 × 8.5 h + 6 h = 40 h/week paid = the tariff annual average
   * (BRTV §3: 41 h Apr–Nov with Mon–Thu 8.5 h / Fri 7 h, 38 h Dec–Mar with 8 h / 6 h).
   * Mon–Thu 07:00–16:15 with 15 min breakfast + 30 min lunch (research "typical site day",
   * low confidence); Fri 07:00–13:30 with 30 min break.
   */
  schedule: [
    workday(7, 16.25, 0.75),
    workday(7, 16.25, 0.75),
    workday(7, 16.25, 0.75),
    workday(7, 16.25, 0.75),
    workday(7, 13.5, 0.5),
    off,
    off,
  ],
  /**
   * Monday..Sunday: the working day of people who work for themselves (a household, friends on
   * their own project): no tariff, every day from morning to late afternoon with meal breaks. How
   * much of it they really work is up to their needs (rest, food, daylight) and the player.
   * An assumption of the pack author (low confidence).
   */
  ownSchedule: [workday(8, 17, 1.5), workday(8, 17, 1.5), workday(8, 17, 1.5), workday(8, 17, 1.5), workday(8, 17, 1.5), workday(8, 17, 1.5), workday(8, 17, 1.5)],
  // (§ 622 Abs. 1 BGB: four weeks to the 15th or to the end of a calendar month)
  noticeTo: ['15th', 'monthEnd'],
  dismissalNotice: p(28, 'd', { title: '§ 622 Abs. 1 BGB: basic notice period of four weeks (to the 15th or the end of a month); longer with years of service (Abs. 2)', publisher: 'BMJ (gesetze-im-internet.de)' }, { range: [14, 210], confidence: 'medium', note: 'the basic period; tariff contracts may shorten it, years of service lengthen it (not modelled)' }),
  // short-time work (Kurzarbeit): the Bundesagentur pays 60/67 % of the net pay lost; the employer keeps the social insurance on 80 % of it
  shortTime: {
    rule: '§§ 95–109 SGB III (Kurzarbeitergeld), § 101 SGB III (Saison-Kurzarbeitergeld in construction)',
    remanence: p(0.25, '1', { title: '§ 106 SGB III with § 163 Abs. 6 SGB VI, § 232a Abs. 2 SGB V: social insurance on 80 % of the pay lost, borne by the employer alone (not refunded since 2024)', publisher: 'BMJ (gesetze-im-internet.de)' }, { range: [0.2, 0.35], confidence: 'low', note: 'some 40 % social insurance on 80 % of the gross lost, against a wage cost of gross plus surcharges (an estimate of the share)' }),
    seasonal: p(0, '1', { title: '§ 102 Abs. 4 SGB III: in the bad-weather season the employer\'s social insurance on Saison-Kurzarbeitergeld is refunded from the winter levy (Winterbeschäftigungs-Umlage)', publisher: 'BMJ (gesetze-im-internet.de)' }, { range: [0, 0.05], confidence: 'medium' }),
    season: { from: 12, to: 3 },
    maxMonths: p(12, 'mo', { title: '§ 104 SGB III: Kurzarbeitergeld for at most twelve months', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
    restartAfter: p(3, 'mo', { title: '§ 104 Abs. 3 SGB III: a new period of Kurzarbeitergeld begins after three months without it', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
    // (a business, § 97 SGB III; the season's only the building trade, § 101: the firms of this world that build)
    eligible: ['company', 'firm'],
    seasonalFor: ['company'],
    // (Saison-Kurzarbeitergeld is paid for the bad-weather season apart: not counted in the twelve months, § 104 Abs. 4 SGB III)
    seasonApart: '§ 104 Abs. 4 SGB III: Saison-Kurzarbeitergeld is paid for the bad-weather season, not counted in the twelve months',
    // (a day of short time with no work is no day of work for the leave it earns: BAG 30.11.2021, 9 AZR 225/21)
    leaveShrinks: 'BAG 30.11.2021, 9 AZR 225/21: days of short time without work earn no leave (§ 3 Abs. 1 BUrlG, reckoned pro rata)',
    // (no allowance: sent home, the wage is owed in full; reduced pay only by the employee's agreement)
    afterwards: '§ 615 BGB: an employer who does not take the work offered owes the wage (the risk of having no work is its own); less only by agreement',
  },
  // leave not taken: carried over to 31 March (§ 7 Abs. 3 BUrlG), and lapsing then only where the employer asked the
  // employee in time to take it, told them it would lapse, and they did not take it (BAG 19.2.2019, 9 AZR 541/15; EuGH
  // 6.11.2018, C-684/16): the employer's plan asks, and everyone in this game takes the leave planned when they can, so
  // what is left was kept from them and stays. Kept from them by illness, it lapses fifteen months after the end of its
  // year, the employer having asked in time (EuGH 22.11.2011, C-214/10; BAG 7.8.2012, 9 AZR 353/10; EuGH 22.9.2022,
  // C-518/20 and C-727/20; BAG 20.12.2022, 9 AZR 245/19); kept by the employer (no room, its short time) it does not lapse
  vacationCarryOver: {
    until: { month: 4, day: 1 },
    rule: '§ 7 Abs. 3 BUrlG: carried over to 31 March; lapsing only where the employer asked in time and the employee did not take it (BAG 19.2.2019, 9 AZR 541/15)',
    keptMonths: p(15, 'mo', { title: 'EuGH 22.11.2011, C-214/10 (KHS/Schulte); BAG 7.8.2012, 9 AZR 353/10: leave illness kept from being taken lapses fifteen months after the end of its year; only where the employer had asked for it in time (EuGH 22.9.2022, C-518/20 and C-727/20; BAG 20.12.2022, 9 AZR 245/19)', publisher: 'EuGH / BAG' }, { confidence: 'high', note: 'the time illness may keep leave; the employer\'s plan is its request here' }),
    keptRule: '§ 7 Abs. 3 BUrlG read with EuGH C-214/10 and BAG 9 AZR 353/10: fifteen months after the end of its year',
  },
  // the leave of a year an employment begins or ends in (BUrlG): the law's 24 Werktage (six a week, § 3: 20 working days
  // of a five-day week) are had in full once the employment has lasted six months (§ 4), so a hire by 1 July has them all
  // in its first year; one hired later, or leaving before the six months or in the first half of a year, has a twelfth
  // for each full month (§ 5 Abs. 1), a fraction of at least half a day rounded up (§ 5 Abs. 2). The tariff's leave above
  // the law's (30 days) comes by the months employed (TVöD § 26 Abs. 2 b: a twelfth a full month, § 5 BUrlG untouched;
  // BRTV-Bau § 8 earns it by the days employed). A hire on 1 June: 20 + 10 × 7/12 = 25.8, so 26 days (not 7/12 of 30 =
  // 18: the waiting period ends on 30 November, within the year). Leave given or paid out by an earlier employer in the
  // year counts against it (§ 6 Abs. 1; the certificate of § 6 Abs. 2 says it); leave not taken at the end is paid out
  // (§ 7 Abs. 4), at the pay of a working day (§ 11 Abs. 1), with the last wages; on death to the heirs (EuGH 6.11.2018,
  // C-569/16 and C-570/16, Bauer; BAG 22.1.2019, 9 AZR 45/16). (In construction the SOKA-BAU leave fund carries leave from
  // one building employer to the next, § 13 Abs. 2 BUrlG, BRTV-Bau § 8: not modelled, each employment settles its own.)
  leaveLaw: {
    minimum: p(24, 'd', { title: 'Bundesurlaubsgesetz (BUrlG) § 3 Abs. 1: at least 24 Werktage a year', publisher: 'BMJ (gesetze-im-internet.de)', url: 'https://www.gesetze-im-internet.de/burlg/' }, { confidence: 'high', note: 'Werktage: every calendar day that is not a Sunday or a public holiday (§ 3 Abs. 2)' }),
    perWeek: p(6, 'd', { title: 'BUrlG § 3 Abs. 2: Werktage are all calendar days that are not Sundays or public holidays (six a week)', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high', note: 'the law’s 24 Werktage are 20 working days of a five-day week (BAG: converted by the working days of the week)' }),
    waiting: p(6, 'mo', { title: 'BUrlG § 4: the full leave is had first after the employment has lasted six months', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
    rule: '§§ 4, 5 BUrlG: the full leave once six months have passed within the year (hired by 1 July); else, or leaving in the first half of a year, a twelfth a full month; a half day or more rounded up',
    surplus: 'TVöD § 26 Abs. 2 b, BRTV-Bau § 8: the tariff’s leave above the law’s by the months (days) employed',
    earlier: '§ 6 Abs. 1 BUrlG: no leave for what an earlier employer gave or paid out for the same calendar year',
    payout: '§ 7 Abs. 4 BUrlG: leave that cannot be given because the employment ends is paid out (at a working day’s pay, § 11 Abs. 1)',
  },
  // (§ 5 Abs. 1 JArbSchG: no child (under 15, § 2 Abs. 1) may be employed (light work from 13 with the parents' consent,
  // two hours a day, § 5 Abs. 3); youths of 15 to 17 at most 8 hours a day and 40 a week (§ 8) and at no work beyond their
  // strength or with accident hazards (§ 22): the jobs here are full tariff days of site work, taken from 18)
  minWorkingAge: p(18, 'a', { title: 'Jugendarbeitsschutzgesetz (JArbSchG) §§ 2, 5, 8, 22: children (under 15) are not employed; youths (15–17) at most 8 h a day, 40 h a week, and at no hazardous work', publisher: 'BMJ (gesetze-im-internet.de)' }, { range: [15, 18], confidence: 'medium', note: 'the youngest age for the full-time site and yard jobs of this world (a tariff day of 8.5 h on site); a 15-year-old out of full-time school could take a lighter job under the JArbSchG limits (not modelled)' }),
  maxDailyHours: p(10, 'h', ARBZG, { confidence: 'high', note: 'ArbZG §3: 8 h, up to 10 h if 8 h is kept on average over 6 months' }),
  relations: {
    family: { label: 'Family', description: 'a relative who comes to help (Familienmithilfe)' },
    friend: { label: 'Friend', description: 'a friend who helps as a favour (Gefälligkeit) or neighbourly help' },
    member: { label: 'Member', description: 'oneself, or a member of the household or group the work is for', fed: false },
  },
  /** by relation; family help (Familienmithilfe) is not limited */
  unpaidHelpDaysPerYear: {
    friend: p(10, 'd', { title: 'Schwarzarbeitsbekämpfungsgesetz (SchwarzArbG) § 1 Abs. 3: unpaid help as a favour (Gefälligkeit) or neighbourly help (Nachbarschaftshilfe) is not undeclared work if occasional and not aimed at profit', publisher: 'BMJ (gesetze-im-internet.de)' }, { range: [5, 20], confidence: 'low', note: 'the law sets no number: ten days a year is this pack\'s reading of "occasional" for a friend helping a business; family help (Familienmithilfe) is not limited' }),
  },
  aptitude: {
    sd: p(0.1, '1', ASSUMPTION, { range: [0.05, 0.2], confidence: 'low', note: 'how much people differ in the pace of the same work at the same practice' }),
    min: p(0.75, '1', ASSUMPTION, { confidence: 'low' }),
    max: p(1.25, '1', ASSUMPTION, { confidence: 'low' }),
  },
  learning: {
    rate: p(0.85, '1', { title: 'Wright (1936): Factors affecting the cost of airplanes; UN/ECE (1965): Effect of repetition on building operations and processes on site — construction learning rates about 0.80–0.95', publisher: 'J. Aeronautical Sciences / United Nations' }, { range: [0.8, 0.95], confidence: 'medium', note: 'each doubling of practice cuts the time per unit by 15 %' }),
    expertHours: p(2000, 'h', ASSUMPTION, { range: [1000, 5000], confidence: 'low', note: 'about a year of full-time practice to work at an experienced pace' }),
    firstHours: p(40, 'h', ASSUMPTION, { range: [16, 80], confidence: 'low', note: 'a week of instruction before anyone works on their own' }),
  },
  minBreaks: [
    { over: p(6, 'h', ARBZG), break: p(0.5, 'h', ARBZG, { confidence: 'high', note: 'ArbZG §4: 30 min for more than 6 h of work' }) },
    { over: p(9, 'h', ARBZG), break: p(0.75, 'h', ARBZG, { confidence: 'high', note: 'ArbZG §4: 45 min for more than 9 h of work' }) },
  ],
};

/** courses that lead to certificates in German practice (what they grant, how long people are away) */
export const courses = {
  earthmoving: { label: 'Erdbaumaschinenführer (excavator, wheel loader, dozer)', grants: ['op.excavator', 'op.loader', 'op.dozer'], workdays: p(5, 'd', DGUV_EARTH, { range: [3, 10], confidence: 'medium' }), practice: p(30, 'h', ASSUMPTION, { confidence: 'low', note: 'supervised practice during the course' }), source: DGUV_EARTH },
  roadPlant: { label: 'Straßenbaumaschinenführer (roller, grader)', grants: ['op.roller', 'op.grader'], workdays: p(3, 'd', DGUV_EARTH, { range: [2, 5], confidence: 'medium' }), practice: p(20, 'h', ASSUMPTION, { confidence: 'low' }), source: DGUV_EARTH },
  chainsaw: { label: 'Motorsägenlehrgang Modul A/B', grants: ['chainsaw'], workdays: p(3, 'd', DGUV_SAW, { range: [2, 5], confidence: 'medium' }), practice: p(16, 'h', ASSUMPTION, { confidence: 'low' }), source: DGUV_SAW },
  ceLicence: { label: 'Führerschein CE + Berufskraftfahrer-Grundqualifikation (beschleunigt)', grants: ['driver.ce'], workdays: p(30, 'd', FEV, { range: [20, 45], confidence: 'medium', note: '140 h accelerated basic qualification plus driving lessons and tests' }), practice: p(60, 'h', ASSUMPTION, { confidence: 'low' }), source: FEV },
};
