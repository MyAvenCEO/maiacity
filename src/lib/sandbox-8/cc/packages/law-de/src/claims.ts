/**
 * The law of claims in Germany (docs/design/claims.md, VISION "Owing, and being made to pay"): how each kind of claim is
 * to be paid, objected to, deferred and, unpaid, enforced step by step. Fees, periods and the court's times are
 * estimates where no figure is fixed by law (low confidence); the rules are named.
 */
import { p } from './sources.ts';

const NVWVG = { title: 'Niedersächsisches Verwaltungsvollstreckungsgesetz (NVwVG) with §§ 64–70 NPOG (§ 67 coercive fine, § 68 substitute coercive detention, one day to two weeks), the Nds. enforcement cost ordinance', publisher: 'Land Niedersachsen' };
const VWGO = { title: 'VwGO § 74 (an action within a month of the notice), § 154 (the loser bears the costs); § 80 NJG (no objection procedure in Lower Saxony)', publisher: 'BMJ / Land Niedersachsen' };
const OWIG = { title: 'Gesetz über Ordnungswidrigkeiten (OWiG): § 66 Abs. 2 and § 95 (payable two weeks after it is final), § 67 objection, § 18 payment facilities, § 94 (part payments to the fine first), § 96 coercive detention (not when unable to pay; not again for the same amount), § 97 (ends on payment), § 34 term of enforcement, § 107 fees', publisher: 'BMJ (gesetze-im-internet.de)' };
const ZPO = { title: 'BGB § 286 (default by a reminder or a date set), § 288 (default interest: 5 points above the base rate, 9 between firms), § 247 (base rate 1.27 % from 1 July 2025), § 367 (costs, interest, then the claim), §§ 195, 197, 204, 214 (terms); ZPO §§ 688 ff. (dunning procedure: § 692 objection within two weeks, § 700 against the enforcement order), § 829, § 833a (account seizure, later credits too), § 850c (exempt amounts from 1 July 2025: 1,555.00 €, 585.23 € for the first and 326.04 € for each further one maintained), § 899 (P-Konto); GKG, GvKostG (fees)', publisher: 'BMJ (gesetze-im-internet.de); Pfändungsfreigrenzenbekanntmachung 2025' };
const AO = { title: 'Abgabenordnung: § 222 deferral, § 225 (order of payments), § 228 term of enforcement (5 years), § 231 (restarted by enforcement steps), §§ 234, 238 (deferral interest: 0.5 % for each full month, on the sum rounded down to 50 €), § 239 Abs. 2 (interest rounded down to full euros in the debtor’s favour, none fixed under 10 €), § 240 (late surcharge: 1 % a month begun, on the sum rounded down to 50 €), § 261 write-off (Niederschlagung), §§ 309, 314 (seizure of claims, later credits too); § 37 Abs. 2 (what was paid without ground is paid back); NKAG § 11 (municipal levies under the AO: Abs. 1 Nr. 5 b applies the interest rules, §§ 233, 234 Abs. 1 and 2, 235–237, 238 and 239, not the full interest of § 233a)', publisher: 'BMF / Land Niedersachsen' };
const STUNDUNG = { title: 'AO § 222 (a deferral only where paying at once would be a considerable hardship, and the claim not endangered; as a rule against security), § 234 (interest for the time granted), § 238 (0.5 % for each full month, the sum rounded down to 50 €), § 239 Abs. 2 (the interest rounded down to full euros in the debtor’s favour, and not fixed under 10 €); Niedersächsische Landeshaushaltsordnung § 59 Abs. 1 Nr. 1 and the municipal budget law after it (a deferral at appropriate interest)', publisher: 'BMF (gesetze-im-internet.de) / Land Niedersachsen' };
const EST = { title: 'Estimate (court times and practice)', publisher: 'Constructible City' };
const STGB = { title: 'StGB § 40 (daily rates), § 43 (substitute imprisonment: one day for two daily rates, since 2024), § 79 (term); StPO § 407 (penalty order), § 410 (objection within two weeks), § 451 (the public prosecutor enforces), § 459b (part payments to the fine first), § 459e (substitute imprisonment ends on payment); JBeitrG', publisher: 'BMJ (gesetze-im-internet.de)' };

// (what an account seizure leaves: the debtor's own, more for those it maintains; § 850c ZPO, as of 1 July 2025)
const protect = {
  debtor: p(1555, 'EUR', ZPO, { range: [1555, 1560], confidence: 'high', note: 'a month (§ 850c Abs. 1 ZPO; about 1,560 € on a P-Konto, § 899 ZPO)' }),
  first: p(585.23, 'EUR', ZPO, { confidence: 'high', note: 'more for the first one maintained (a spouse, a child)' }),
  further: p(326.04, 'EUR', ZPO, { confidence: 'high', note: 'more for each further one maintained, up to four' }),
};

/**
 * A coercive fine of Lower Saxony's authorities (Zwangsgeld): enforced by the state's administrative enforcement law
 * (NVwVG, NPOG), challenged under its rules (§ 80 NJG), deferred by its budget law (§ 59 LHO). It speaks for Lower
 * Saxony (`claimLawNi`); the other kinds of claim are federal law.
 */
export const claimLawNi = {
  coercive: {
    label: 'An enforcement fine (Zwangsgeld)',
    pay: p(14, 'd', NVWVG, { range: [7, 30], confidence: 'medium', note: 'the payment period the fixing notice sets' }),
    order: 'claimFirst',
    // (Lower Saxony: no objection procedure; a challenge at court does not suspend enforcement, § 64 Abs. 4 NPOG)
    objection: { label: 'a challenge at the administrative court (§ 74 VwGO; no objection procedure, § 80 NJG)', within: p(30, 'd', VWGO, { confidence: 'high', note: 'a month' }), court: p(240, 'd', EST, { range: [120, 540], confidence: 'low', note: 'an administrative court’s time to judgment' }), upheld: p(0.85, '1', EST, { range: [0.7, 0.95], confidence: 'low', note: 'most such fines stand' }), suspends: false, fee: p(250, 'EUR', VWGO, { range: [150, 500], confidence: 'low', note: 'court fees for a small value in dispute (GKG): the court’s, borne by the loser (§ 154 VwGO)' }) },
    // (a coercive fine of the county is deferred by its budget law as the State's by § 59 LHO: only where paying it at once
    // would be a considerable hardship, and at appropriate interest; the AO's rate for deferred public claims, § 238 AO)
    deferral: { label: 'a deferral (Stundung)', granted: p(0.4, '1', EST, { confidence: 'low' }), days: p(60, 'd', EST, { range: [30, 180], confidence: 'low' }), hardship: true, interest: { perMonth: p(0.005, '1', STUNDUNG, { confidence: 'medium', note: 'the AO’s 0.5 % for each full month as the appropriate interest the budget law asks for (§ 59 Abs. 1 Nr. 1 LHO); the county may ask other' }), roundDown: p(50, 'EUR', STUNDUNG, { confidence: 'medium', note: 'the sum it is reckoned on, rounded down (§ 238 Abs. 2 AO, as the AO’s interest is taken)' }), whole: p(1, 'EUR', STUNDUNG, { confidence: 'medium', note: 'the interest rounded down to full euros (§ 239 Abs. 2 S. 1 AO, as the AO’s interest is taken)' }), least: p(10, 'EUR', STUNDUNG, { confidence: 'medium', note: 'none fixed under 10 € (§ 239 Abs. 2 S. 2 AO, as the AO’s interest is taken)' }), rule: 'deferral interest as §§ 238, 239 AO, § 59 LHO' } },
    steps: [
      { after: p(7, 'd', NVWVG, { confidence: 'low' }), act: 'reminder', label: 'a reminder (Mahnung)', rule: 'NVwVG', fee: p(5, 'EUR', NVWVG, { range: [2, 10], confidence: 'low' }) },
      { after: p(14, 'd', NVWVG, { confidence: 'low' }), act: 'seizure', label: 'an account seizure (Pfändungs- und Einziehungsverfügung)', rule: 'NVwVG with §§ 309 ff. AO', fee: p(25, 'EUR', NVWVG, { range: [15, 50], confidence: 'low' }), term: p(5, 'a', AO, { confidence: 'medium', note: 'an enforcement step starts the term anew (§ 231 AO)' }) },
      { after: p(14, 'd', NVWVG, { confidence: 'low' }), act: 'court', label: 'an application for substitute coercive detention to the administrative court', rule: '§ 68 NPOG', fee: p(0, 'EUR', NVWVG), person: true },
      { after: p(30, 'd', EST, { range: [14, 90], confidence: 'low', note: 'the court’s time' }), act: 'detention', label: 'substitute coercive detention (Ersatzzwangshaft)', rule: '§ 68 NPOG', days: p(7, 'd', NVWVG, { range: [1, 14], confidence: 'medium', note: 'one day to two weeks' }), extinguishes: false, person: true },
    ],
    protect,
    writeOff: p(20, 'EUR', AO, { range: [10, 50], confidence: 'low', note: 'what costs more to collect than it brings (§ 261 AO): owed, not pursued' }),
    expires: p(5, 'a', AO, { confidence: 'high', note: 'the term of enforcement (§ 228 AO)' }),
    compels: 'a means of compulsion ends once what it was to compel is done (NPOG, § 15 Abs. 3 VwVG)',
  },
};

export const claimLaw = {
  administrative: {
    label: 'An administrative fine (Bußgeld)',
    pay: p(28, 'd', OWIG, { confidence: 'high', note: 'final two weeks after it is served without objection, payable two weeks after (§ 66 Abs. 2 Nr. 2 a, § 95 Abs. 1 OWiG)' }),
    noticeFee: { share: p(0.05, '1', OWIG, { confidence: 'high' }), min: p(25, 'EUR', OWIG, { confidence: 'high' }), max: p(7500, 'EUR', OWIG, { confidence: 'high' }), outlay: p(3.5, 'EUR', OWIG, { confidence: 'high', note: 'its service (§ 107 Abs. 3 OWiG)' }), rule: '§ 107 OWiG' },
    order: 'claimFirst',
    objection: { label: 'an objection (Einspruch, § 67 OWiG), heard by the local court', within: p(14, 'd', OWIG, { confidence: 'high' }), court: p(120, 'd', EST, { range: [60, 270], confidence: 'low', note: 'to the hearing at the local court' }), upheld: p(0.8, '1', EST, { range: [0.6, 0.9], confidence: 'low' }), suspends: true },
    deferral: { label: 'payment facilities (§ 18 OWiG)', granted: p(0.7, '1', EST, { confidence: 'low' }), days: p(90, 'd', OWIG, { range: [30, 365], confidence: 'low' }) },
    steps: [
      { after: p(14, 'd', OWIG, { confidence: 'low' }), act: 'reminder', label: 'a reminder (Mahnung)', rule: '§ 90 OWiG', fee: p(5, 'EUR', OWIG, { confidence: 'low' }) },
      { after: p(14, 'd', OWIG, { confidence: 'low' }), act: 'seizure', label: 'an account seizure', rule: '§ 90 OWiG with the enforcement acts', fee: p(25, 'EUR', OWIG, { confidence: 'low' }) },
      { after: p(14, 'd', OWIG, { confidence: 'low' }), act: 'court', label: 'an application for coercive detention to the local court', rule: '§ 96 OWiG', fee: p(0, 'EUR', OWIG), person: true, unlessUnable: true },
      { after: p(30, 'd', EST, { range: [14, 90], confidence: 'low' }), act: 'detention', label: 'coercive detention (Erzwingungshaft)', rule: '§ 96 OWiG', days: p(14, 'd', OWIG, { range: [1, 42], confidence: 'medium', note: 'up to six weeks for one fine, once; the fine is still owed after, and paying ends it (§ 97 OWiG)' }), extinguishes: false, person: true, unlessUnable: true },
    ],
    protect,
    writeOff: p(20, 'EUR', AO, { range: [10, 50], confidence: 'low' }),
    expires: p(3, 'a', OWIG, { confidence: 'high', note: 'for fines up to 1,000 €, from when it is final (§ 34 OWiG)' }),
    expiresAbove: { amount: p(1000, 'EUR', OWIG, { confidence: 'high' }), term: p(5, 'a', OWIG, { confidence: 'high', note: '§ 34 Abs. 2 Nr. 1 OWiG' }) },
  },
  criminal: {
    label: 'A criminal fine (Geldstrafe, by a penalty order)',
    pay: p(28, 'd', STGB, { confidence: 'medium', note: 'final two weeks after it is served, payable on the enforcement office’s demand' }),
    order: 'claimFirst',
    objection: { label: 'an objection to the penalty order (§ 410 StPO): a trial at the local court', within: p(14, 'd', STGB, { confidence: 'high' }), court: p(150, 'd', EST, { range: [60, 365], confidence: 'low' }), upheld: p(0.8, '1', EST, { confidence: 'low' }), suspends: true },
    deferral: { label: 'instalments (§ 42 StGB)', granted: p(0.7, '1', EST, { confidence: 'low' }), days: p(120, 'd', EST, { confidence: 'low' }) },
    steps: [
      { after: p(14, 'd', STGB, { confidence: 'low' }), act: 'reminder', label: 'a reminder of the public prosecutor’s enforcement office', rule: '§§ 451, 459 StPO', fee: p(0, 'EUR', STGB) },
      { after: p(14, 'd', STGB, { confidence: 'low' }), act: 'seizure', label: 'an account seizure', rule: '§ 459 StPO with the JBeitrG', fee: p(25, 'EUR', STGB, { confidence: 'low' }) },
      { after: p(21, 'd', STGB, { confidence: 'low' }), act: 'detention', label: 'substitute imprisonment (Ersatzfreiheitsstrafe)', rule: '§ 43 StGB', days: p(30, 'd', STGB, { range: [5, 180], confidence: 'low', note: 'one day for two daily rates of what is unpaid: some 60 daily rates for a first offence; paying the rest ends it (§ 459e StPO)' }), extinguishes: true, person: true },
    ],
    protect,
    expires: p(5, 'a', STGB, { confidence: 'medium', note: '§ 79 StGB: five years for fines of more than 30 daily rates' }),
  },
  private: {
    label: 'A private claim (damages, an invoice)',
    pay: p(14, 'd', ZPO, { range: [7, 30], confidence: 'medium', note: 'the date the creditor’s letter sets: in default after it (§ 286 Abs. 1 BGB)' }),
    account: 'damages',
    late: { label: 'default interest', rule: '§ 288 BGB', from: 'due', perYear: p(0.0627, '1/a', ZPO, { confidence: 'high', note: '5 points above the base rate of 1.27 % (from 1 July 2025)' }), perYearFirms: p(0.1027, '1/a', ZPO, { confidence: 'high', note: '9 points above the base rate between firms' }) },
    order: 'costsFirst',
    // (there is nothing to object to until a court's order is served: a dunning order, then the enforcement order)
    objection: { label: 'an objection to the court’s order (Widerspruch, § 694 ZPO; Einspruch, § 700 ZPO): the creditor must sue', within: p(14, 'd', ZPO, { confidence: 'high', note: 'two weeks from its service' }), court: p(240, 'd', EST, { range: [120, 540], confidence: 'low' }), upheld: p(0.6, '1', EST, { range: [0.4, 0.8], confidence: 'low' }), suspends: true, served: true },
    deferral: { label: 'instalments asked of the creditor', granted: p(0.5, '1', EST, { confidence: 'low' }), days: p(60, 'd', EST, { confidence: 'low' }) },
    steps: [
      { after: p(7, 'd', ZPO, { confidence: 'low' }), act: 'reminder', label: 'a reminder (Mahnung)', rule: '§ 286 BGB', fee: p(5, 'EUR', ZPO, { range: [0, 10], confidence: 'low', note: 'its cost, in default already (damages for the delay)' }) },
      { after: p(14, 'd', EST, { confidence: 'low' }), act: 'court', label: 'a dunning order (Mahnbescheid)', rule: '§§ 688 ff. ZPO', fee: p(38, 'EUR', ZPO, { confidence: 'medium', note: 'the court’s minimum fee (GKG)' }), served: true },
      { after: p(21, 'd', ZPO, { confidence: 'low' }), act: 'court', label: 'an enforcement order (Vollstreckungsbescheid)', rule: '§ 699 ZPO', fee: p(0, 'EUR', ZPO), served: true, term: p(30, 'a', ZPO, { confidence: 'high', note: 'a title lapses after thirty years (§ 197 Abs. 1 Nr. 3 BGB)' }) },
      { after: p(21, 'd', EST, { confidence: 'low' }), act: 'seizure', label: 'an account seizure by the enforcement court (Pfändungs- und Überweisungsbeschluss)', rule: '§§ 829, 835 ZPO', fee: p(45, 'EUR', ZPO, { range: [30, 80], confidence: 'low', note: 'court fees (GKG)' }) },
    ],
    protect,
    writeOff: p(15, 'EUR', EST, { range: [5, 40], confidence: 'low', note: 'a private creditor lets a claim go that the court fee would eat' }),
    expires: p(3, 'a', ZPO, { confidence: 'high', note: '§ 195 BGB' }),
  },
  public: {
    label: 'A public fee or cost (Gebühr, Kosten)',
    pay: p(30, 'd', AO, { confidence: 'medium' }),
    late: { label: 'a late surcharge (Säumniszuschlag)', rule: '§ 240 AO', from: 'due', perMonth: p(0.01, '1', AO, { confidence: 'high', note: 'for each month begun' }), roundDown: p(50, 'EUR', AO, { confidence: 'high' }) },
    order: 'claimFirst',
    objection: { label: 'a challenge at the administrative court (§ 80 NJG)', within: p(30, 'd', VWGO, { confidence: 'high' }), court: p(240, 'd', EST, { range: [120, 540], confidence: 'low' }), upheld: p(0.85, '1', EST, { confidence: 'low' }), suspends: false, fee: p(250, 'EUR', VWGO, { confidence: 'low' }) },
    deferral: { label: 'a deferral (§ 222 AO)', granted: p(0.4, '1', EST, { confidence: 'low' }), days: p(60, 'd', EST, { confidence: 'low' }), hardship: true, interest: { perMonth: p(0.005, '1', AO, { confidence: 'high', note: 'for each full month (§§ 234, 238 Abs. 1 AO, via § 11 Abs. 1 Nr. 5 b NKAG)' }), roundDown: p(50, 'EUR', AO, { confidence: 'high', note: 'the sum it is reckoned on, rounded down to full 50 € (§ 238 Abs. 2 AO)' }), whole: p(1, 'EUR', AO, { confidence: 'medium', note: 'rounded down to full euros in the debtor’s favour (§ 239 Abs. 2 S. 1 AO; applied to municipal levies by § 11 Abs. 1 Nr. 5 b NKAG as read from memory, its current text not checked online)' }), least: p(10, 'EUR', AO, { confidence: 'medium', note: 'not fixed when under 10 € (§ 239 Abs. 2 S. 2 AO, via § 11 NKAG as above)' }), rule: 'Stundungszinsen, §§ 234, 238, 239 AO' } },
    steps: [
      { after: p(7, 'd', AO, { confidence: 'low' }), act: 'reminder', label: 'a reminder (Mahnung)', rule: '§ 259 AO', fee: p(5, 'EUR', AO, { confidence: 'low' }) },
      { after: p(14, 'd', AO, { confidence: 'low' }), act: 'seizure', label: 'an account seizure', rule: '§§ 309 ff. AO', fee: p(25, 'EUR', AO, { confidence: 'low' }), term: p(5, 'a', AO, { confidence: 'medium', note: 'an enforcement step starts the term anew (§ 231 AO)' }) },
    ],
    protect,
    writeOff: p(20, 'EUR', AO, { confidence: 'low' }),
    expires: p(5, 'a', AO, { confidence: 'high', note: '§ 228 AO' }),
  },
};
