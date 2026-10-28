/**
 * What people need a day, and what going without does (decision 0025). Physiology and the Sphere
 * standards hold anywhere; they sit in the practice pack with their sources. What deficits do to
 * the pace of work and to health is an assumption of the pack (low confidence).
 */
import { ASSUMPTION, p } from './sources.ts';

const FAO = { title: 'Human energy requirements: report of a joint FAO/WHO/UNU expert consultation (Rome 2001), Food and Nutrition Technical Report Series 1, table 5.2 and annex 5', publisher: 'FAO', year: 2004 };
const EFSA = { title: 'Scientific Opinion on Dietary Reference Values for water', publisher: 'EFSA Panel on Dietetic Products, Nutrition and Allergies', year: 2010 };
const TBMED = { title: 'TB MED 507: Heat stress control and heat casualty management (fluid replacement guidelines)', publisher: 'US Army', year: 2022 };
const SLEEP = { title: 'Recommended amount of sleep for a healthy adult: a joint consensus statement of the AASM and SRS (Watson et al.)', publisher: 'Journal of Clinical Sleep Medicine 11(6)', year: 2015 };
const WATER = { title: 'Popkin, D’Anci, Rosenberg: Water, hydration and health. Nutrition Reviews 68(8): 439–458 (survival without water is a matter of days)', publisher: 'Nutrition Reviews', year: 2010 };
const FAST = { title: 'Peel, M.: Hunger strikes. BMJ 315: 829–830 (death after about 45–75 days of total fasting)', publisher: 'BMJ', year: 1997 };
const SPHERE = { title: 'The Sphere Handbook: Humanitarian Charter and Minimum Standards in Humanitarian Response', publisher: 'Sphere Association', year: 2018 };

export const physiology = {
  bodyMass: p(70, 'kg', ASSUMPTION, { range: [50, 100], confidence: 'low', note: 'a reference adult; people carry no body mass of their own yet' }),
  // Schofield equations (men) as given by FAO/WHO/UNU: BMR (kcal/d) = a · mass + b
  bmr: [
    { from: 0, to: 30, a: p(15.057, 'kcal/kg', FAO, { confidence: 'high', note: 'men 18–30 years' }), b: p(692.2, 'kcal', FAO, { confidence: 'high' }) },
    { from: 30, to: 60, a: p(11.472, 'kcal/kg', FAO, { confidence: 'high', note: 'men 30–60 years' }), b: p(873.1, 'kcal', FAO, { confidence: 'high' }) },
    { from: 60, to: 150, a: p(11.711, 'kcal/kg', FAO, { confidence: 'high', note: 'men over 60 years' }), b: p(587.7, 'kcal', FAO, { confidence: 'high' }) },
  ],
  par: {
    sleep: p(1.0, '1', FAO, { confidence: 'high', note: 'physical activity ratio of sleeping' }),
    rest: p(1.5, '1', FAO, { range: [1.2, 1.9], confidence: 'medium', note: 'awake, light activities: eating, washing, sitting, walking about' }),
    work: p(4.0, '1', FAO, { range: [3, 6], confidence: 'low', note: 'heavy manual work (digging, carrying, construction labour); annex 5 lists PARs of about 3–6 for such tasks' }),
  },
  water: {
    base: p(2.0, 'l', EFSA, { range: [1.5, 2.5], confidence: 'medium', note: 'adequate total water intake for men 2.5 l/d, of which about 20 % comes with food' }),
    sweat: p(0.4, 'l/h', TBMED, { range: [0.25, 0.75], confidence: 'low', note: 'water lost in sweat per hour of moderate to hard work in mild weather' }),
    reference: p(20, '°C', ASSUMPTION, { confidence: 'low', note: 'above this day maximum sweating grows with the heat' }),
    perDegree: p(0.03, 'l/h', TBMED, { range: [0.02, 0.05], confidence: 'low', note: 'per °C of day maximum above the reference: the replacement tables rise to about 0.75–1 l/h in hot conditions' }),
  },
  sleep: p(7, 'h', SLEEP, { range: [7, 9], confidence: 'high', note: 'adults need 7 hours or more a night' }),
  hygiene: {
    base: p(4, 'l', SPHERE, { range: [2, 6], confidence: 'medium', note: 'hygiene practices 2–6 l a person a day (the Sphere water standard), washing from a bowl or a canister' }),
    work: p(3, 'l', ASSUMPTION, { range: [1, 6], confidence: 'low', note: 'after a day of dusty, sweaty work: a wash down and the work clothes' }),
  },
};

export const sphereStandards = {
  energy: p(2100, 'kcal', SPHERE, { confidence: 'high', note: 'food security standard: 2,100 kcal a person a day' }),
  water: p(3, 'l', SPHERE, { range: [2.5, 3], confidence: 'high', note: 'survival needs, drinking and food: 2.5–3 l a person a day, by climate and physiology' }),
  sleep: p(7, 'h', SLEEP, { confidence: 'high', note: 'the Sphere standards set none; the sleep consensus' }),
  hygiene: p(4, 'l', SPHERE, { range: [2, 6], confidence: 'high', note: 'water supply standard: hygiene practices 2–6 l a person a day' }),
};

export const livingSettings = {
  awake: p(6, 'h', ASSUMPTION, { range: [4, 8], confidence: 'low', note: 'awake but not working: meals, washing, chores, getting about' }),
  hunger: {
    deficit: p(10_000, 'kcal', ASSUMPTION, { range: [5000, 20_000], confidence: 'low', note: 'about four or five days without food: a person is markedly weaker' }),
    slows: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.5], confidence: 'low' }),
    harms: p(0.03, '1/d', ASSUMPTION, { range: [0.01, 0.06], confidence: 'low', note: 'health lost a day at that deficit' }),
  },
  thirst: {
    slows: p(0.5, '1', ASSUMPTION, { range: [0.3, 0.7], confidence: 'low', note: 'a day without enough water takes much of the strength' }),
    harms: p(0.25, '1/d', ASSUMPTION, { range: [0.15, 0.4], confidence: 'low', note: 'without water a person lasts only a few days' }),
  },
  tiredness: {
    debt: p(16, 'h', ASSUMPTION, { range: [8, 24], confidence: 'low', note: 'two nights of sleep owed' }),
    slows: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.5], confidence: 'low' }),
    harms: p(0.05, '1/d', ASSUMPTION, { range: [0.02, 0.1], confidence: 'low', note: 'sleep owed far beyond two nights wears the body down: weeks of it make one ill (to be sourced)' }),
  },
  exposure: {
    margin: p(15, 'K', { title: 'EN ISO 23537-1: sleeping bags; comfort, limit and extreme temperatures', publisher: 'ISO/CEN' }, { range: [10, 20], confidence: 'low', note: 'the standard’s extreme temperature, some 15–20 K below comfort, is where hypothermia threatens; above it a cold night is only a poor one' }),
    harm: p(0.04, '1', ASSUMPTION, { range: [0.02, 0.1], confidence: 'low', note: 'health lost per K beyond the margin, a night: a few nights of hard frost in the open, with clothes alone, can kill (to be sourced)' }),
  },
  health: {
    recovers: p(0.1, '1/d', ASSUMPTION, { range: [0.05, 0.2], confidence: 'low' }),
    ill: p(0.4, '1', ASSUMPTION, { confidence: 'low' }),
    well: p(0.7, '1', ASSUMPTION, { confidence: 'low' }),
    walk: p(0.15, '1', ASSUMPTION, { range: [0.05, 0.3], confidence: 'low', note: 'below this one is too weak to walk to the water oneself and needs someone to bring it (the five friends: an illness kept everyone from fetching water; illness has degrees)' }),
  },
  patience: p(2, 'd', ASSUMPTION, { range: [1, 5], confidence: 'low', note: 'days a family member or friend stays without enough to eat or drink' }),
  sleepWindow: {
    bed: p(22.5, 'h', SLEEP, { range: [20, 24], confidence: 'low', note: 'eight hours in bed before a working day that starts at seven; people keep their own hours' }),
    rise: p(6.5, 'h', SLEEP, { range: [5, 9], confidence: 'low' }),
  },
  lieIn: p(2, 'h', SLEEP, { range: [1, 3], confidence: 'low', note: 'catching up on a free morning' }),
  outside: p(0.75, '1', ASSUMPTION, { range: [0.5, 0.9], confidence: 'low', note: 'a night under the open sky on what one has: wind, dew and noises break it (the cold comes from the bedding against the night, apart)' }),
  smell: {
    rest: p(0.3, 'l', ASSUMPTION, { range: [0.1, 0.6], confidence: 'low', note: 'the sweat of a day at rest that stays on skin and clothes (skin bacteria turn it to odour within a day or so)' }),
    work: p(0.4, 'l/h', TBMED, { range: [0.25, 0.75], confidence: 'low', note: 'sweat at moderate work up to the reference heat (the replacement tables)' }),
    perDegree: p(0.03, 'l/h', TBMED, { range: [0.01, 0.06], confidence: 'low', note: 'more sweat per °C above it' }),
    reference: p(20, '°C', TBMED, { confidence: 'low' }),
    noticed: p(1.5, 'l', ASSUMPTION, { range: [0.8, 3], confidence: 'low', note: 'some five days at rest unwashed, or one hard day’s work: others notice (to be sourced)' }),
    strong: p(6, 'l', ASSUMPTION, { range: [3, 10], confidence: 'low', note: 'weeks at rest, or two or three days of hard work unwashed: nobody can miss it (to be sourced)' }),
  },
  hygiene: {
    waterOnly: p(0.5, '1', ASSUMPTION, { range: [0.2, 0.8], confidence: 'low', note: 'hands washed with water alone keep some of what soap keeps away (Luby et al. 2011, PLoS Medicine 8 (6), found water alone protecting less than soap; the share here is an estimate, to be sourced)' }),
    handwashing: p(0.45, '1', { title: 'Curtis, V.; Cairncross, S.: Effect of washing hands with soap on diarrhoea risk in the community: a systematic review', publisher: 'The Lancet Infectious Diseases 3 (5)', year: 2003 }, { range: [0.3, 0.47], confidence: 'medium', note: 'washing hands with soap cuts the risk of diarrhoea by some 42–47 %' }),
  },
  fetchWalk: p(800, 'm', ASSUMPTION, { range: [300, 3000], confidence: 'low', note: 'about ten minutes each way for clean water or one\'s own food (the pantry at the old camp, run 14) before one drinks from the creek beside the camp (to be sourced: water collection distances, WHO/UNICEF JMP use 30 minutes a round trip as the limit of basic service)' }),
  away: {
    workplace: p(1, '1', { title: 'ArbStättV with ASR A4.1 (sanitary rooms and drinking water at the workplace) and DGUV Regel 101-038 (Bauarbeiten: drinking water on site)', publisher: 'BAuA / DGUV' }, { confidence: 'low', note: 'an employer gives water at work (a tap, a cooler, drinks in the heat): all of what the working day asks (the law’s wording varies; an assumption that it is met)' }),
    lunch: {
      at: p(12.5, 'h', ASSUMPTION, { range: [11.5, 13.5], confidence: 'medium', note: 'the midday break, the custom of the place' }),
      share: p(0.35, '1', ASSUMPTION, { range: [0.25, 0.4], confidence: 'low', note: 'the share of the day’s food eaten at midday (a hot lunch is the main meal for many in Germany)' }),
      canteen: p(6, 'EUR', ASSUMPTION, { range: [3.5, 9], confidence: 'low', note: 'a lunch bought at work (a works canteen, a bakery, a snack bar), 2026' }),
    },
    bring: {
      water: p(1.5, 'l', ASSUMPTION, { range: [0.5, 3], confidence: 'low', note: 'a bottle or two filled at home for the working day (DGUV Information 215-450, drinking at work: 1.5–2 l a day and more in heat; what one brings is an estimate)' }),
      drink: 'water.drinking',
      vessel: 'bottle.water',
      food: 'food.provisions',
    },
    short: p(0.5, 'l', ASSUMPTION, { range: [0.3, 1], confidence: 'low', note: 'a body short of about half a litre over some hours of work feels it (thirst, a headache); performance suffers from about 2 % of body mass lost (ACSM 2007), some 1.5 l' }),
  },
  routine: {
    hours: [7, 13, 18],
    waterBelow: p(1.5, 'd', ASSUMPTION, { range: [0.5, 3], confidence: 'low', note: 'a camp sends someone for water when less than a day or two is left (estimate)' }),
    foodBelow: p(2, 'd', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'and for food when two days are left (estimate)' }),
    waterFor: p(3, 'd', ASSUMPTION, { range: [1, 7], confidence: 'low', note: 'water for some days, as far as one carries (estimate)' }),
    foodFor: p(7, 'd', ASSUMPTION, { range: [3, 14], confidence: 'low', note: 'a week’s shopping, as far as one carries (estimate)' }),
    detour: p(0.25, 'h', ASSUMPTION, { range: [0.1, 0.75], confidence: 'low', note: 'the way round by a shop in town on the way home from work (estimate)' }),
  },
  selfCare: p(100, 'm', ASSUMPTION, { range: [30, 200], confidence: 'low', note: 'across a camp: the barrel by the tent, the canister in the next one, the rain catcher at its edge (five friends run 3: 60 m off, out of a 50 m reach)' }),
  atHand: p(200, 'm', ASSUMPTION, { range: [50, 500], confidence: 'low', note: 'at the camp: within a few minutes’ walk of where one lives (a spade, a bicycle)' }),
  sanitation: {
    open: p(0.002, '1/d', ASSUMPTION, { range: [0.0005, 0.01], confidence: 'low', note: 'a bout of diarrhoea every year or so for each of a small camp whose excreta lie about it, carried by flies and hands to food (estimate, to be sourced)' }),
    // a spade digs the hole (15–20 cm, covered after): what outdoor guidance asks where there is no toilet
    cathole: {
      tool: 'spade',
      contains: p(0.9, '1', ASSUMPTION, { range: [0.7, 0.97], confidence: 'low', note: 'a covered hole keeps flies off most of it (estimate, to be sourced)' }) },
    excreta: { faeces: p(0.13, 'kg/d', { title: 'Rose, C. et al. (2015): The characterization of feces and urine: a review of the literature to inform advanced treatment technology. Critical Reviews in Environmental Science and Technology 45(17)', publisher: 'Taylor & Francis' }, { range: [0.05, 0.5], confidence: 'medium', note: 'median wet faeces a person a day' }), urine: p(1.4, 'kg/d', { title: 'Rose, C. et al. (2015): The characterization of feces and urine: a review of the literature to inform advanced treatment technology. Critical Reviews in Environmental Science and Technology 45(17)', publisher: 'Taylor & Francis' }, { range: [0.6, 2.6], confidence: 'medium', note: 'median urine a person a day, with the water drunk' }) },
    reach: p(150, 'm', ASSUMPTION, { range: [50, 300], confidence: 'low', note: 'a few minutes’ walk from where one works to the site toilet; ASR A4.1 asks toilets near the workplaces (its distance to be checked)' }),
    perToilet: p(10, '1', { title: 'ASR A4.1 Sanitärräume (2022), Tabelle 2: Mindestanzahl von Toiletten', publisher: 'BAuA' }, { range: [5, 15], confidence: 'medium', note: 'the table asks toilets by the number who work there, more as they grow; a site toilet cabin is commonly reckoned for some ten (the exact rows to be checked)' }),
  },
  waterIllness: {
    days: p(3, 'd', ASSUMPTION, { range: [1, 7], confidence: 'low', note: 'a bout of travellers’ diarrhoea or the like: a few days' }),
    harm: p(0.15, '1', ASSUMPTION, { range: [0.05, 0.3], confidence: 'low' }),
    // (illness has degrees: most bouts pass in days, some are a gut infection of a week or two, at worst a hospital's)
    serious: {
      share: p(0.1, '1', { title: 'RKI: Campylobacter-Enteritis, Ratgeber (a share of the cases reported are taken into hospital)', publisher: 'Robert Koch-Institut' }, { range: [0.05, 0.2], confidence: 'low', note: 'of bouts from untreated water, the share that are serious (campylobacter, giardia, cryptosporidium): an estimate after the share of reported cases treated in hospital' }),
      days: p(10, 'd', ASSUMPTION, { range: [7, 21], confidence: 'low', note: 'a week or two of illness, weak after' }),
      harm: p(0.45, '1', ASSUMPTION, { range: [0.3, 0.6], confidence: 'low', note: 'it leaves one too weak to fetch much for days' }),
    },
  },
  waste: {
    material: 'waste.household',
    pile: p(10, 'kg', ASSUMPTION, { range: [5, 30], confidence: 'low', note: 'a sack or two of packaging lying about a camp (to be sourced)' }),
  },
  openFire: {
    warming: p(8, 'K', ASSUMPTION, { range: [3, 15], confidence: 'low', note: 'a long log fire before an open lean-to, its heat thrown in by the sloping roof: woodcraft accounts of sleeping out in frost (to be sourced)' }),
    fuel: 'fuel.firewood',
    use: p(3, 'kg/h', ASSUMPTION, { range: [2, 5], confidence: 'low', note: 'two logs laid side by side burning slowly through the night (a long fire), dry wood (to be sourced)' }),
  },
  fumes: {
    ill: p(800, '1', ASSUMPTION, { range: [400, 1500], confidence: 'low', note: 'ppm × hours of carbon monoxide: commonly cited exposure tables give headaches and sickness after 1–2 h at 400 ppm (to be sourced)' }),
    deadly: p(4800, '1', ASSUMPTION, { range: [2500, 8000], confidence: 'low', note: 'ppm × hours: commonly cited tables give unconsciousness and death within about 2–3 h at 1,600 ppm (to be sourced)' }),
  },
  bedding: {
    referenceR: p(4.5, 'm2·K/W', ASSUMPTION, { range: [2, 5.5], confidence: 'low', note: 'a sleeping bag’s comfort rating (EN ISO 23537-1) assumes a good mat under it; the value of the test mat to be sourced' }),
    perR: p(2, 'K', ASSUMPTION, { range: [1, 4], confidence: 'low', note: 'a thinner mat loses heat to the ground: the bag keeps one warm only some degrees above its rating' }),
    noBag: p(15, '°C', ASSUMPTION, { range: [10, 20], confidence: 'low', note: 'in day clothes and a blanket: a mild night at best' }),
    noMatR: p(0.5, 'm2·K/W', ASSUMPTION, { range: [0.2, 1], confidence: 'low', note: 'on the ground or a tent floor with nothing under one' }),
    cold: p(0.05, '1', ASSUMPTION, { range: [0.02, 0.1], confidence: 'low', note: 'waking from the cold: a twentieth of the night’s sleep per °C below comfort' }),
    floor: p(0.3, '1', ASSUMPTION, { range: [0.1, 0.5], confidence: 'low', note: 'however cold, some sleep comes: exhaustion takes over' }),
  },
  rescue: {
    critical: p(0.2, '1', ASSUMPTION, { range: [0.1, 0.35], confidence: 'low', note: 'a body this far gone (days without enough to drink or eat, an illness that keeps one down) is a case for the emergency number 112' }),
    discharge: p(0.9, '1', ASSUMPTION, { range: [0.7, 1], confidence: 'low', note: 'well enough to be sent home from hospital' }),
    vehicle: 'van',
    ride: p(10, 'EUR', { title: '§ 61 Satz 1 SGB V with § 60: an insured person pays 10 % of a ride to hospital, at least 5 and at most 10 €', publisher: 'BMJ (gesetze-im-internet.de)' }, { confidence: 'high' }),
  },
  fatal: {
    dryDays: p(4, 'd', WATER, { range: [3, 7], confidence: 'medium', note: 'days in a row with less than half the water the day asks; in heat the need is larger, so it comes sooner' }),
    starvation: p(130000, 'kcal', FAST, { range: [100000, 165000], confidence: 'low', note: '45–75 days of total fasting at about 2,200 kcal a day: the body’s reserves' }),
  },
};
