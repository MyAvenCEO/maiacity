/**
 * Human needs (decision 0025): what a person needs a day to keep going — food energy, drinking
 * water, sleep — is a model contract with two implementations (physiology after FAO/WHO/UNU; the
 * Sphere humanitarian minimum standards). The living module runs the days of the people who live
 * on site: they eat and drink from their store, and what is missing adds up.
 */
import { s, type EntityId, type Explained, type Infer, type Provenance } from '../../kernel/src/index.ts';

/** what a day asks of someone */
export interface NeedsDay {
  /** hours of work that day */
  workHours: number;
  /** the day's highest air temperature (°C) */
  tMax: number;
}

/** what a person needs that day */
export interface Requirement {
  /** food energy (kcal) */
  energy: Explained;
  /** drinking water (l) */
  water: Explained;
  /** sleep (h) */
  sleep: Explained;
  /** water for washing (l): hands, body, clothes (camp L3) */
  hygiene: Explained;
  provenance: Provenance;
}

/** the needs contract */
export interface NeedsPort {
  requirement(person: EntityId, day: NeedsDay): Requirement;
}

/** human physiology (practice pack): energy after FAO/WHO/UNU, water by heat and work, sleep */
export const PhysiologySchema = s.object({
  /** the body mass of the reference adult (people carry no weight of their own yet) */
  bodyMass: s.param('kg'),
  /** basal metabolic rate = a · mass + b (kcal/d), by age band [from, to) */
  bmr: s.array(s.object({ from: s.int(), to: s.int(), a: s.param('kcal/kg'), b: s.param('kcal') })),
  /** physical activity ratios (multiples of BMR per hour): asleep, awake at rest, at heavy manual work */
  par: s.object({ sleep: s.param('1'), rest: s.param('1'), work: s.param('1') }),
  /** drinking water: a day at rest, and sweat per hour of work: at or below the reference heat, more per degree above */
  water: s.object({ base: s.param('l'), sweat: s.param('l/h'), reference: s.param('°C'), perDegree: s.param('l/h') }),
  sleep: s.param('h'),
  /** washing: a day at rest, and more after a day of sweaty work */
  hygiene: s.object({ base: s.param('l'), work: s.param('l') }),
});
export type Physiology = Infer<typeof PhysiologySchema>;

/** the Sphere minimum standards: a person a day, whatever the work and the weather */
export const SphereSchema = s.object({
  energy: s.param('kcal'),
  water: s.param('l'),
  sleep: s.param('h'),
  hygiene: s.param('l'),
});
export type Sphere = Infer<typeof SphereSchema>;

/** what deficits do (practice pack): how fast they slow work, cost health, and when helpers give up */
export const LivingSettingsSchema = s.object({
  /** awake but not working: meals, chores, getting about (h a day) */
  awake: s.param('h'),
  /** an energy deficit this large (kcal) takes this share off the pace of work */
  hunger: s.object({ deficit: s.param('kcal'), slows: s.param('1'), harms: s.param('1/d') }),
  /** a day's water short by this share of the need takes this off the pace of work */
  thirst: s.object({ slows: s.param('1'), harms: s.param('1/d') }),
  /** sleep owed (h) up to this takes this share off the pace of work */
  tiredness: s.object({ debt: s.param('h'), slows: s.param('1'), harms: s.param('1/d').optional() }),
  /**
   * a night far colder than one's bedding keeps one warm in is not only poor sleep: beyond `margin`
   * below comfort the body cools (hypothermia), costing `harm` of health per K a night; at none left one dies
   */
  exposure: s.object({ margin: s.param('K'), harm: s.param('1') }).optional(),
  /** health regained in a day with needs met; below `ill` a person falls ill until it is back above `well` */
  /** health: how fast it comes back, below what one is ill, above what well again, and below what one is too weak to walk */
  health: s.object({ recovers: s.param('1/d'), ill: s.param('1'), well: s.param('1'), walk: s.param('1') }),
  /** days in a row with needs unmet after which a helper goes home */
  patience: s.param('d'),
  /** when people go to bed and get up, unless their own rhythm says otherwise (hours of the day) */
  sleepWindow: s.object({ bed: s.param('h'), rise: s.param('h') }),
  /** with no working day set by others in the morning, they sleep this much longer if they need it */
  lieIn: s.param('h'),
  /** how well one sleeps with no shelter at all (share of a night's sleep that counts) */
  outside: s.param('1'),
  /**
   * when a body gives out (the user, 2026-10-09: let people die): days in a row with less than half the
   * water the day asked, and the food energy missing in all (the body's reserves)
   */
  fatal: s.object({ dryDays: s.param('d'), starvation: s.param('kcal') }).optional(),
  /**
   * The rescue service (Qwen S506/S507: a founder too weak to walk died with money, a phone and nobody called): a body
   * this far gone (health) is a case for 112, called by them or one of theirs within hearing with a phone with charge;
   * fetched to hospital by its vehicle (profile) as near as it gets and carried from there; home again this well; what a
   * ride costs the insured
   */
  rescue: s.object({ critical: s.param('1'), discharge: s.param('1'), vehicle: s.string(), ride: s.param('EUR') }).optional(),
  /**
   * the night composed (camp C6): the coldest night one sleeps well in is the bag's comfort temperature
   * on a mat as good as the rating assumes (`referenceR`), this much warmer per m²·K/W the mat is short of
   * it, and `noBag` in what one wears; each °C the night inside is colder takes `cold` of the sleep
   */
  bedding: s.object({ referenceR: s.param('m2·K/W'), perR: s.param('K'), noBag: s.param('°C'), noMatR: s.param('m2·K/W'), cold: s.param('1'), floor: s.param('1') }),
  /**
   * carbon monoxide in the room a night (concentration × hours asleep): from `ill` on one wakes with a
   * headache and sickness, from `deadly` on one does not wake
   */
  fumes: s.object({ ill: s.param('1'), deadly: s.param('1') }).optional(),
  /** household waste: the good it is, and from how much of it at a camp it is a matter (it smells, it draws animals) */
  waste: s.object({ material: s.string(), pile: s.param('kg') }).optional(),
  /** a fire kept before an open shelter through the night (a long log fire before a lean-to): how much warmer it is there, what it burns an hour */
  openFire: s.object({ warming: s.param('K'), fuel: s.string(), use: s.param('kg/h') }).optional(),
  /** an illness from untreated water: how long one is ill, and what it takes of one's health */
  /** a bout of illness from water or excreta: how long and how much it harms; a share of bouts are serious (longer, harder: a gut infection one sees a doctor for) */
  waterIllness: s.object({ days: s.param('d'), harm: s.param('1'), serious: s.object({ share: s.param('1'), days: s.param('d'), harm: s.param('1') }).optional() }).optional(),
  /**
   * smell (the user, 2026-10-09: one smells before one falls ill, and others notice): the sweat since the
   * last wash builds it, a little a day at rest and what work and heat make one sweat (the extra water
   * the day asks); from `noticed` litres others notice it, from `strong` they cannot miss it
   */
  smell: s.object({ rest: s.param('l'), work: s.param('l/h'), perDegree: s.param('l/h'), reference: s.param('°C'), noticed: s.param('l'), strong: s.param('l') }).optional(),
  /** what washing hands does: the share of illness from what is drunk and eaten washing with soap prevents; `waterOnly`: the part of it water alone gives */
  hygiene: s.object({ handwashing: s.param('1'), waterOnly: s.param('1') }).optional(),
  /**
   * toilets (camp L3): `open` is the illness a person a day from excreta left about the camp (no toilet,
   * no hole dug); a toilet keeps away its share of it (goods with `sanitation`), and so does a hole dug
   * for each visit and covered with a tool of the class `cathole.tool` the household has at hand (within `atHand` of the camp, sound)
   */
  sanitation: s.object({
    open: s.param('1/d'),
    cathole: s.object({ tool: s.string(), contains: s.param('1') }).optional(),
    /** what a person leaves a day into a toilet that collects it: faeces (by the food eaten) and urine (by the water drunk) */
    excreta: s.object({ faeces: s.param('kg/d'), urine: s.param('kg/d') }).optional(),
    /** on a site (realism S1b): so many people a toilet serves (what a site is told to set up for those who work there) */
    perToilet: s.param('1').optional(),
    /** how far one walks from where one works to a toilet (beyond it, one goes behind a bush) */
    reach: s.param('m').optional(),
  }).optional(),
  /** what is at hand at a camp: a tool or a vehicle of ours within this distance of where people live */
  atHand: s.param('m'),
  /** how far one goes oneself for a drink or a bite from the household's goods (a barrel by the tent), without it being work */
  selfCare: s.param('m'),
  /** how far one goes oneself for the household's clean water and food (before drinking water as it comes nearer by) */
  fetchWalk: s.param('m'),
  // the household's own errands (design/realism-plan.md S2): the hours of the day it looks at what the camp is short of,
  // below how many days of water or food someone free goes, and for how many days they fetch (as far as one carries)
  routine: s.object({ hours: s.array(s.number({ min: 0, max: 24 })), waterBelow: s.param('d'), foodBelow: s.param('d'), waterFor: s.param('d'), foodFor: s.param('d'), detour: s.param('h').optional() }).optional(),
  /** away from home (design/physical-state.md 8b): the share of a job's drinking water the workplace gives (its tap), and how many litres short one goes before it is said */
  away: s.object({
    workplace: s.param('1'),
    short: s.param('l'),
    lunch: s.object({ at: s.param('h'), share: s.param('1'), canteen: s.param('EUR') }),
    // what someone who lives beyond the map brings for a day on it: the water (in vessels of this good) and a lunch of this food
    bring: s.object({ water: s.param('l'), drink: s.string(), vessel: s.string(), food: s.string() }).optional(),
  }).optional(),
});
export type LivingSettings = Infer<typeof LivingSettingsSchema>;

/**
 * Somewhere to live beyond the map (VISION "Leaving goes somewhere", design/physical-state.md 8c): a campsite, a hostel,
 * a rented room, the municipality's emergency shelter. Its price a night, the food bought while there a day, the months
 * it is open (absent: all year), how long finding one takes, and whether it takes in anyone (the shelter: the
 * municipality must house the homeless)
 */
export const LodgingSchema = s.object({
  label: s.string(),
  kind: s.enum(['campsite', 'hostel', 'room', 'shelter', 'hospital']),
  perNight: s.param('EUR'),
  food: s.param('EUR'),
  months: s.array(s.int({ min: 1, max: 12 })).optional(),
  wait: s.param('d').optional(),
  always: s.boolean().optional(),
  /** a day's charge paid for at most so many days a calendar year (a hospital's co-payment) */
  daysAYear: s.param('d').optional(),
  /** what one must bring (a campsite lets a pitch only): each list is goods of which one must be carried by those who come */
  bring: s.array(s.array(s.string())).optional(),
});
export type LodgingData = Infer<typeof LodgingSchema>;

/** someone of a party living beyond the map at a lodging: since when, at what a night (`next`: one found, moved to then) */
export interface Lodging {
  party: EntityId;
  lodging: string;
  since: number;
  next?: { lodging: string; at: number };
  /** still on the map on a move when they left: they walk out when it ends (r42) */
  out?: boolean;
  /** in hospital: the store they lived at, to come back to when they are well */
  back?: EntityId;
  /** in hospital: the last calendar day (days since the epoch) the insured's share was charged for */
  paid?: number;
}

/** someone who lives on site: where (the store they live from), with whom; their body is their own (`Body`) */
export interface Resident {
  /** the party they live with (whose stores feed them) */
  party: EntityId;
  /** the store they eat and drink from */
  store: EntityId;
  /** when they came to live there */
  since: number;
  /** today's way to a job beyond the map: its hours there and back, of them before the shift (`out`), by what */
  went?: { day: number; hours: number; out?: number; by?: EntityId; bus?: string };
}

/**
 * A person's body: what it owes and how it is, and its days and nights. Every person has one, made once when they
 * come into the world (design/realism-plan.md S1) and never made again: moving house, moving out and in, being hired
 * do not touch it (design/physical-state.md §3, finding 4). Days away from here are reckoned where they are; the
 * hours of one who lives beyond the map and comes onto it (to work, to help) are drunk and eaten where they are.
 */
export interface Body {
  /** food energy missing (kcal, cumulative) */
  hunger: number;
  /** days in a row with less than half the water the day asked */
  dryDays?: number;
  /** drinking water missing yesterday (l) */
  thirst: number;
  /** sleep owed (h) */
  sleepDebt: number;
  /** 0..1 */
  health: number;
  /** days in a row with a need unmet */
  unmetDays: number;
  /** days in a row without the water to wash (camp L3) */
  unwashedDays?: number;
  /** sweat on the body since it was last washed (l): one smells of it (the user: one smells before one falls ill) */
  sweat?: number;
  /** washed with soap at the last wash (absent: not known yet, as with soap) */
  soaped?: boolean;
  /** the hours they worked today (kept at the evening, before an illness of the evening changes how they count) */
  worked?: number;
  /**
   * the night under way, slept hour by hour from bedtime (`from`, for `hours`): the sleep the day asked, whether
   * the day's food and water were met, the day's other harms; so far the hours slept, the worst cold beyond the
   * bedding (K) and the carbon monoxide breathed (ppm·h). Reckoned when it ends (dawn).
   */
  night?: { from: number; hours: number; need: number; met: boolean; others: number; slept: number; chill: number; dose: number; bedding: string; bed?: { quality: number; warming: number; place?: EntityId }; away?: boolean };
  /** the hours slept last night */
  slept?: number;
  /** what the last evening left for the night to come: the sleep the day asked, fed and watered or not, the day's other harms, its working span (h) */
  day?: { need: number; met: boolean; others: number; span: number };
  /** when they next go to bed (the night begins then; a night ends before the next is due) */
  bedAt?: number;
  /** the last day settled (day index) */
  lastDay: number;
  /** their own rhythm: when they go to bed and get up (hours of the day; absent: the custom of the place) */
  sleep?: { bed: number; rise: number };
  /** away from home on the map since (from a move's departure), at the place they went to: drunk there as it is settled */
  away?: { since: number; at: [number, number] };
  /** what of what they carry is their own, brought from their home beyond the map (no household of ours may take it) */
  own?: Record<string, number>;
  /** shopping carried home in what they carry, to be put away at home (review S2 #11: only that, not what was packed) */
  bought?: Record<string, number>;
  /** ill of what the camp brought (its water, its toilet, unwashed hands): what it is and how bad, why, until when, and what keeps it away */
  ill?: { reason: string; until: number; ways: ('treat' | 'toilet' | 'cover' | 'soap' | 'wash')[] };
  /** the days in hospital the insured has paid a share of this calendar year (the law caps them: the lodging's `daysAYear`) */
  copaid?: { year: number; days: number };
  /** today so far, away from home: litres drunk (from what they carry, water by them, the workplace's tap) and litres gone short; food eaten (kcal) and missed */
  today?: { drank: number; short: number; where: string[]; ate?: number; missed?: number };
}

/** living's own: who of those living beyond the map is on it now (their hours there are settled at the evening) */
export interface LivingState {
  onMap: EntityId[];
  /**
   * today at each store of ours people worked by away from home (realism S1b): who was there, the water their hours
   * asked and what they went short of, and who had no toilet there; said on the store, cleared when a day passes
   */
  sites?: Record<string, { day: number; want: number; short: number; dry: EntityId[]; open: EntityId[]; toilet?: EntityId; way?: { water: boolean; toilet: boolean; waterHere: boolean; toiletHere: boolean }; fresh?: boolean }>;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    needs: NeedsPort;
  }
  interface ModuleStateTypes {
    living: LivingState;
  }
  interface ComponentTypes {
    Resident: Resident;
    Body: Body;
    Lodging: Lodging;
    /** on a store: whether its household runs its heaters through the night, and the night each place was last heated */
    /** whether the household runs its heaters through the night; per place the hour each last burned and how much of it (0..1), and tonight's plan */
    Heating: { night: boolean; burnt: Record<string, number>; lit?: Record<string, number>; plan?: Record<string, { label: string; fuel: string; perHour: number; dT: number; ppm: number }> };
  }
  interface EventTypes {
    /** someone living on site died of thirst or hunger */
    'living.died': { person: EntityId; party: EntityId; cause: string };
    /** others notice something about a person (their smell …): what they remember of us comes from such moments */
    'living.noticed': { person: EntityId; party: EntityId; what: string; level: string };
    /** the last person of a party has died */
    'living.noOneLeft': { party: EntityId };
  }
  interface DataTypes {
    physiology?: Physiology;
    sphereStandards?: Sphere;
    livingSettings: LivingSettings;
    lodgings?: Record<string, LodgingData>;
  }
  interface ContributionTypes {
    /** how well someone sleeps tonight in what shelters them (a tent, a hut, a house), explained; null: nothing of this module's */
    shelter: (read: import('../../kernel/src/index.ts').ReadCtx, person: EntityId) => { quality: number; explain: Explained; warming?: number; place?: EntityId; envelope?: { volume: number; airChange: number; loss: number; flue: boolean }; open?: boolean } | null;
  }
  interface CommandTypes {
    /** someone lives on site with a party, eating and drinking from a store (a starter, a move) */
    'living.settle': { payload: { person: EntityId; party: EntityId; store: EntityId; sleep?: { bed: number; rise: number } }; result: void };
    /** one of ours lives at a store of ours from now on (or moves there) */
    'living.moveIn': { payload: { person: EntityId; store: EntityId }; result: void };
    'living.callRescue': { payload: { person: EntityId }; result: string };
    /** one of ours no longer lives on site */
    'living.moveOut': { payload: { person: EntityId }; result: void };
    /** someone keeps other hours: when they go to bed and get up (a night owl, a lark, a night shift) */
    'living.keepHours': { payload: { person: EntityId; bed: number; rise: number }; result: void };
  }
}
