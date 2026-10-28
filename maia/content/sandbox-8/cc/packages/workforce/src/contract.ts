/**
 * Workforce contract: people as individuals with qualifications, employment, shifts and
 * absences. Production asks this module who can work when; payroll is posted daily.
 */
import { s, type Source, type EntityId, type Explained, type Infer, type ReadCtx, type Remedy } from '../../kernel/src/index.ts';

/**
 * A skill (an ability that grows with practice) and whether exercising it needs a formal
 * certificate (a licence, an instruction record — practice data, decision 0010).
 */
export const QualificationSchema = s.object({
  label: s.string(),
  category: s.enum(['labour', 'operator', 'driver', 'trade', 'supervision', 'engineering']),
  description: s.string().optional(),
  /** only people holding the certificate may do this work (the law of the practice pack) */
  certificate: s.boolean(),
  /** the rule behind it */
  certificateSource: s.any<Source>().optional(),
  /**
   * anyone may do this work after instruction on site (hand work); otherwise it takes the first
   * practice (`learning.firstHours`, e.g. an apprenticeship or a course) before someone can start
   */
  open: s.boolean().optional(),
});
export type Qualification = Infer<typeof QualificationSchema>;

/** a course that leads to certificates (practice: what it grants and takes) */
export const CourseSchema = s.object({
  label: s.string(),
  grants: s.array(s.string()),
  /** working days away from work */
  workdays: s.param('d'),
  /** supervised practice during the course, shared among the granted skills */
  practice: s.param('h'),
  source: s.any<Source>().optional(),
});
export type Course = Infer<typeof CourseSchema>;

/** what a course costs and how long until the next one starts (economy) */
export const CourseOfferSchema = s.object({ price: s.param('EUR'), leadTime: s.param('d') });
export type CourseOffer = Infer<typeof CourseOfferSchema>;

export const JobSchema = s.object({
  label: s.string(),
  /** the certificates and skills the job brings */
  qualifications: s.array(s.string()),
  /** practice a hire typically brings in each of them (median; the range spans newcomers to veterans) */
  experience: s.param('h'),
  /** tariff wage for this job */
  hourlyWage: s.param('EUR/h'),
  /**
   * Regional labour market for this job. Suitable applicants who accept the offer arrive as a
   * Poisson process with this mean interval (per advertised job, not per vacancy); each fills
   * one open vacancy and starts after the notice period at their current employer.
   */
  market: s.object({
    meanApplicantInterval: s.param('d'),
    noticePeriod: s.param('d'),
    /** job advert (portals, newspaper) per recruitment campaign */
    advertCost: s.param('EUR'),
    /**
     * the region's suitable job seekers for it (design/physical-state.md 8c: labour pools that empty): each hire of
     * anyone's takes one, new ones come at `inflow` a year; applicants come the rarer the emptier it is (absent: as many
     * as wanted)
     */
    pool: s.object({ size: s.param('1'), inflow: s.param('1/a') }).optional(),
  }),
});
export type Job = Infer<typeof JobSchema>;

export const ShiftDaySchema = s.object({ start: s.param('h'), end: s.param('h'), breaks: s.param('h') });
export const LabourSettingsSchema = s.object({
  /** employer social-security & statutory surcharges on gross wage (e.g. 0.8 → cost = wage × 1.8 incl. holidays, SOKA etc.) */
  employerSurcharge: s.param('1'),
  sickDaysPerYear: s.param('d'),
  vacationDaysPerYear: s.param('d'),
  /** a business's working time Monday..Sunday (employers and firms); days with end ≤ start are off */
  schedule: s.array(ShiftDaySchema),
  /** the working day of people working for themselves (persons, households, groups), Monday..Sunday */
  ownSchedule: s.array(ShiftDaySchema),
  /** statutory maximum working time per day (labour law of the practice pack) */
  maxDailyHours: s.param('h'),
  /** the employer's notice period when dismissing (labour law of the practice pack) */
  dismissalNotice: s.param('d'),
  /** the days a notice may end on (the law's): the end of the 15th, the end of a month; none said: any day */
  noticeTo: s.array(s.enum(['15th', 'monthEnd'])).optional(),
  /**
   * the public holidays of the region (its law): fixed dates and days counted from Easter Sunday; `rest`:
   * they are days of rest (businesses do not work, shops shut, nothing is loaded); `paid`: employers pay
   * their people for them as for a working day
   */
  holidays: s.object({ rule: s.string(), rest: s.boolean(), paid: s.boolean(), fixed: s.array(s.object({ month: s.int({ min: 1, max: 12 }), day: s.int({ min: 1, max: 31 }), label: s.string() })), easter: s.array(s.object({ offset: s.int(), label: s.string() })) }).optional(),
  /**
   * short-time work (labour law of the practice pack): the public insurance pays for the hours lost; of a
   * lost hour's wage cost the employer keeps `remanence` (in the season `seasonal`: winter in construction,
   * from month `season.from` to month `season.to`), for at most `maxMonths`, then all of it again; a new
   * period after a pause of `restartAfter`; only employers of the `eligible` party kinds get it, the season's
   * share only those of `seasonalFor` (construction firms)
   */
  shortTime: s.object({ remanence: s.param('1'), seasonal: s.param('1'), season: s.object({ from: s.int({ min: 1, max: 12 }), to: s.int({ min: 1, max: 12 }) }), maxMonths: s.param('mo'), restartAfter: s.param('mo'), eligible: s.array(s.string()), seasonalFor: s.array(s.string()), rule: s.string(), seasonApart: s.string().optional(), leaveShrinks: s.string().optional(), afterwards: s.string().optional() }).optional(),
  /**
   * leave not taken in its year (labour law of the practice pack): carried into the next, planned first, before the day
   * `until` (month and day). It lapses only where the employer made it possible to take it and the employee did not:
   * the employer's plan is its prompt, and everyone here takes the leave planned for them when they can, so days still
   * left were kept from them (by illness, or by the employer: no room, its short time). Kept by illness they lapse
   * `keptMonths` after the end of their year (none said: never); kept by the employer they do not lapse
   */
  vacationCarryOver: s.object({ until: s.object({ month: s.int({ min: 1, max: 12 }), day: s.int({ min: 1, max: 31 }) }), rule: s.string(), keptMonths: s.param('mo').optional(), keptRule: s.string().optional() }).optional(),
  /**
   * when people like to take their leave (practice, design/modular-split.md §5.3 item 2: the season of the school
   * holidays): the weight of a block of leave starting in a week, from a day of the year on (the last one begun by the
   * week's first day; before the first, the year's last), and the months the one long block of the year falls in, from
   * `long.from` to `long.to` (over the new year when `from` is the later)
   */
  vacationSeason: s.object({ weights: s.array(s.object({ month: s.int({ min: 1, max: 12 }), day: s.int({ min: 1, max: 31 }), weight: s.param('1') })), long: s.object({ from: s.int({ min: 1, max: 12 }), to: s.int({ min: 1, max: 12 }) }) }),
  /**
   * the leave of a year begun or ended in it, and of an employment's end (labour law of the practice pack): the law's
   * least leave a year, `minimum` of its own days (`perWeek` of them a week), is had in full once the employment has
   * lasted `waiting` months within the calendar year, unless they leave in its first half; else a twelfth of it for
   * each full month employed in the year; the contract's leave above it comes by the full months employed (`surplus`);
   * a fraction of at least half a day is a whole day. Leave given by an earlier employer in the year counts against it
   * (`earlier`); leave not taken when an employment ends is paid out with the last wages (`payout`). None said: the
   * year's leave by its full months employed, nothing paid out
   */
  leaveLaw: s.object({ minimum: s.param('d'), perWeek: s.param('d'), waiting: s.param('mo'), rule: s.string(), surplus: s.string(), earlier: s.string(), payout: s.string() }).optional(),
  /** the youngest age at which one may be taken on for a job (labour law of the practice pack; none said: any age) */
  minWorkingAge: s.param('a').optional(),
  /** of a gross wage, what an employee takes home (after their social insurance and income tax) */
  netShare: s.param('1'),
  /**
   * how people get about (design/physical-state.md I2: a person changes place only by a move): `commute` the
   * vehicle profile one living beyond the map comes to work by (their own, from beyond it); `walk` the profile
   * of going on foot on the map; `reach` how near a place counts as being there; `hearing` how far a word carries
   * spoken; `phoneDays` how long a phone lasts on the map without power (full again beyond it: VISION 11, I9), what its
   * battery holds, what its charger draws at most and the share of what is drawn to charge it that it keeps (a charger and its cable)
   */
  ways: s.object({ commute: s.string(), walk: s.string(), reach: s.param('m'), hearing: s.param('m'), phoneDays: s.param('d'), phoneBattery: s.param('kWh'), phoneCharger: s.param('kW'), phoneCharging: s.param('1') }),
  /** statutory minimum breaks: a day with more than `over` hours of work needs at least `break` hours of breaks */
  minBreaks: s.array(s.object({ over: s.param('h'), break: s.param('h') })),
  names: s.object({ first: s.array(s.string()), last: s.array(s.string()) }),
  /**
   * Learning by doing (a learning curve): the time per unit of work falls by (1 − rate) with every
   * doubling of practice, until `expertHours`. Below `firstHours` someone can only do open work.
   */
  learning: s.object({ rate: s.param('1'), expertHours: s.param('h'), firstHours: s.param('h') }),
  /** how people differ: a personal knack on the speed of everything they do, normal(1, sd) within [min, max] */
  aptitude: s.object({ sd: s.param('1'), min: s.param('1'), max: s.param('1') }),
  /** unpaid help: what helpers cost a day while here (economy) */
  helperUpkeep: s.param('EUR/d'),
  // a bed near the site for a helper who lives too far to go home each night (a guesthouse, a hostel), a night
  helperLodging: s.param('EUR/d').optional(),
  /** the kinds of relationship people can have with a party they help (family, friend, a member of the household …) */
  relations: s.record(s.object({ label: s.string(), description: s.string().optional(), fed: s.boolean().optional() })),
  /** the law on unpaid help for a business, by relation: working days a year beyond which the help is undeclared work (a legal exposure, not a limit) */
  unpaidHelpDaysPerYear: s.record(s.param('d')),
});
export type LabourSettings = Infer<typeof LabourSettingsSchema>;

export interface Person {
  name: string;
  birthYear: number;
  /** formal certificates held (licences, instruction records) */
  certificates: string[];
  /** hours of practice per skill (qualification id) */
  experience: Record<string, number>;
  /** a personal knack: a factor on the speed of everything they do (1 = typical) */
  aptitude: number;
  /** when, of what and where they died */
  died?: { at: number; cause: string; where?: [number, number] };
}

export interface Employment {
  /** the party that employs and pays them (decision 0025) */
  employer: EntityId;
  job: string;
  hourlyWage: number;
  hiredAt: number;
  /** set when dismissed: leaves at this time */
  leavesAt?: number;
}

/**
 * Family and friends who help without wages: they come for a stay (or live with you), work the
 * company's shifts while here, and are fed. How much a friend may help a business unpaid is the law
 * of the practice pack.
 */
export interface Helper {
  /** whose family or friend they are: the party they help, which feeds them */
  of: EntityId;
  /** a kind of relationship of the practice pack's (family, friend, member …) */
  relation: string;
  /** lives with you: here every day */
  resident: boolean;
  /** working days a year they can come (their own lives) */
  daysPerYear: number;
  /** working days asked for, by the calendar year they fall in */
  booked: Record<string, number>;
  /** days to get here */
  travelDays: number;
  /** the current or coming stay [from, until) */
  stay?: { from: number; until: number };
}

export interface Presence {
  status: 'available' | 'sick' | 'vacation' | 'gone' | 'away' | 'training' | 'released' | 'shortTime';
  /** the course being attended (status 'training') */
  course?: string;
  /** absence ends at this time */
  until?: number;
  /** in custody: each detention served after the one before, for what (a claim) */
  custody?: { for: string; from: number; until: number }[];
  vacationDaysLeft: number;
  sickDaysThisYear: number;
}

/** a person held where they are for a purpose of a module, until a time (decision 0028: one owner of a person's time, every hold ends) */
export interface Engaged {
  by: string;
  /** held at this party's own word (the one in charge stays by someone they told): its next command takes them */
  party?: EntityId;
  purpose: string;
  ref?: string;
  since: number;
  until: number;
  timer?: number;
}

/** An advertised position waiting for an applicant. */
export interface Vacancy {
  /** the party hiring */
  employer: EntityId;
  job: string;
  openedAt: number;
  status: 'open' | 'filled' | 'withdrawn';
  /** the person hired into it (starts after their notice period) */
  person?: EntityId;
  closedAt?: number;
}

export interface WorkforcePort {
  /**
   * The working day [start, end) of the calendar day containing t, or null on days off: a party's
   * (a business's working time, or the own day of a person, household or group); without a party,
   * a business's working time (firms, suppliers)
   */
  shiftWindow(t: number, party?: EntityId): { start: number; end: number; paidHours: number } | null;
  onShift(t: number, party?: EntityId): boolean;
  /** next start of the working day ≥ t */
  nextShiftStart(t: number, party?: EntityId): number;
  /** the public holiday a day is (the region's), if it is one: businesses, shops and deliveries rest */
  holiday(t: number): string | undefined;
  /** which working time a party keeps: a business's, or its own day */
  scheduleOf(party?: EntityId): 'business' | 'own';
  /** present, and at work for whom they work at t */
  available(person: EntityId, t: number): boolean;
  /** present today (not sick/away), regardless of shift */
  present(person: EntityId): boolean;
  /** at a job of someone else's at t (one of a household working in town, on its shift): there, not here */
  elsewhere(person: EntityId, t: number): boolean;
  /** when someone not here now is back (ill until, on leave until, home from a job elsewhere); undefined: not known */
  backAt(person: EntityId): number | undefined;
  /** can this person do this work: open work, or the first practice (or a certificate, which brings it) */
  canDo(person: EntityId, skill: string): boolean;
  /** does the law let them: they hold the certificate where the law asks for one */
  licensed(person: EntityId, skill: string): boolean;
  /** every skill this person may exercise */
  skills(person: EntityId): string[];
  /** how fast this person does this work relative to an expert (aptitude × learning curve), explained */
  speed(person: EntityId, skill: string): number;
  speedExplain(person: EntityId, skill: string): Explained;
  /** how practised someone is at a skill, 0..1 on the learning curve (what their record shows; their knack shows only in their work) */
  level(person: EntityId, skill: string): number;
  /** the people at work for anyone now, or for one party (its employees and the helpers here for it) */
  staff(party?: EntityId): EntityId[];
  /** the party a person works for now (employer, or whom they help), if any */
  worksFor(person: EntityId): EntityId | undefined;
  /** a person's name (the id when unknown) */
  name(person: EntityId): string;
  /** start times of hires for this job who are still working their notice elsewhere, earliest first */
  hiresStarting(job: string, employer?: EntityId): number[];
  job(id: string): Job;
  qualification(id: string): Qualification;
  /** loaded hourly labour cost (wage × (1 + surcharge)) */
  hourlyCost(person: EntityId): number;
  /** same as hourlyCost, as an explain trace citing the data sources */
  hourlyCostExplain(person: EntityId): Explained;
  /** employed (hired and not yet left) at t — recruits exist as entities before they arrive */
  employed(person: EntityId, t: number): boolean;
  /** open vacancies (optionally of one job), oldest first */
  openVacancies(job?: string, employer?: EntityId): EntityId[];
  /** expected days from advertising until a new hire starts, with `open` vacancies already queued for the job */
  expectedStartDays(job: string, queued?: number): number;
  /** people of a party's circle who could come and do this work (not here or on the way, with days left), most practised first */
  helpersFor(skill: string, party: EntityId): HelperOffer[];
  /** courses on offer that lead to this certificate, with their dates if enrolled now (none in a world without course data) */
  coursesFor(skill: string): CourseOption[];
  /** who is on the way to a skill through a course, and who on the team could take one now (the course fits their time with you) */
  trainingFor(skill: string, party: EntityId): { waiting: { person: EntityId; name: string; course: string; label: string; until: number }[]; candidates: { person: EntityId; name: string; course: CourseOption }[] };
  /** what stands against enrolling this person in this course now (null: nothing) */
  enrolBlocker(person: EntityId, course: string): { code: string; params: Record<string, string | number> } | null;
  /** working days the person can still help this year (helpers; their own lives and the law) */
  helpDaysLeft(person: EntityId): number;
  /** the person a party acts through (its lead): the player's reach is theirs (I9) */
  lead(party: EntityId): EntityId | undefined;
  /** a household's members (wherever they live now; not its friends or hired hands), its lead first */
  members(party: EntityId): EntityId[];
  /** a party's people now: its members wherever they live, its staff and helpers here (one fact, decision 0028; who is also bound to come: parties' populationOf) */
  population(party: EntityId): EntityId[];
  /** whether someone is held now; with `of`, whether a detention for it is still being served or still to come */
  inCustody(person: EntityId, of?: string): boolean;
  /** whether a word from the party (its lead) reaches this person now, and how; else why not (design/physical-state.md I9) */
  tell(party: EntityId, person: EntityId): { how: 'self' | 'hearing' | 'phone' } | { why: string; walk: boolean };
  /** what would get the word to someone `tell` does not reach: walk over, put one in charge who reaches them, or into town */
  wordWays(party: EntityId, person: EntityId, told: { why: string; walk: boolean }): Remedy[];
  /** what is left in someone's phone (0..1) */
  phone(person: EntityId): number;
  /** who holds someone where they are now, for what, until when (decision 0028); undefined: free */
  engaged(person: EntityId): { by: string; purpose: string; ref?: string; until: number } | undefined;
  /**
   * what keeps `by` (a module, for `party`) from sending someone anywhere now (decision 0028, one owner of a person's
   * time): a hold of another, with what would free them; undefined when they are free for it. Every command that moves
   * a person asks it (and `workforce.take` before it moves them)
   */
  heldFrom(person: EntityId, by: string, party?: EntityId): { code: string; params: Record<string, string>; remedies: Remedy[] } | undefined;
  /** who of a household may look for work now (workforce.seekWork): its members with no job, old enough for one */
  jobSeekers(party: EntityId): EntityId[];
  /**
   * what someone's phone would draw from a power source by them over so many hours (kWh, before what its charger
   * loses): what it lacks, as fast as its charger draws; nothing when full, or when they are not standing on the map
   */
  phoneDraw(person: EntityId, hours: number): number;
}

/** Workforce module state. */
export interface WorkforceState {
  /** calendar year of the last entitlement reset */
  year: number;
  /** planned vacation blocks per person (start = first workday of a week, days = workdays) */
  vacationPlan: Record<EntityId, { start: number; days: number }[]>;
  /** cumulative statistics since the scenario start */
  totals: { paidHours: number; payroll: number; sickDays: number; vacationDays: number };
  /** job → time of the next applicant (only while the job has open vacancies) */
  nextApplicant: Record<string, number>;
  /** job → those taken from its pool by hires (`taken`) as of `at`: the pool fills again at its inflow */
  pools?: Record<string, { taken: number; at: number }>;
  /** our people looking for work with an employer beyond the map: who, where, the job, and the pending offer's timer (redrawn in a fork) */
  seeking?: Record<EntityId, { employer: string; job: string; timer: number }>;
  /** the person each party acts through (its lead), when set */
  leads?: Record<EntityId, EntityId>;
  /** each person's phone: its charge (0..1) at `at`, running down from then; `socket`: from then on at a charger beyond the map */
  phones?: Record<EntityId, { charge: number; at: number; socket?: boolean }>;
  /** those with no way to where they are to be (robustness plan step 3): since when, and where they were to go */
  noWay?: Record<EntityId, { since: number; why: string; tried?: string }>;
  /** the working day (its 00:00) on which someone found no way to work: not come, not paid for it (the day's own fact, read by its payroll) */
  notCome?: Record<EntityId, number>;
  /**
   * employees on short time: since when (for the most months it is paid), until when; `paused`: the pauses of a month
   * or more since (they lengthen the period); `seasonIdle`: the bad-weather season in its pauses (no allowance drawn
   * then: counted once, as a pause); `over`: its allowance has ended (said once)
   */
  shortTime?: Record<EntityId, { from: number; until: number; paused?: number; seasonIdle?: number; over?: boolean }>;
  /** leave carried over from last year, not yet taken (planned first, before the practice's day: vacationCarryOver) */
  carried?: Record<EntityId, number>;
  /** leave of the year before last still not taken (illness kept it): it lapses at its day (vacationCarryOver.keptMonths) */
  carriedOlder?: Record<EntityId, number>;
  /** leave of a calendar year given (taken or paid out) at employments that ended: a later one that year gives less (leaveLaw.earlier) */
  leaveGiven?: Record<EntityId, { year: number; days: number }>;
}

/** an employer beyond the map: who they are, which jobs they hire for, how far it is, how long an opening takes */
export const TownEmployerSchema = s.object({
  label: s.string(),
  jobs: s.array(s.string()),
  /** the way to it from the way into the map (km), walked or driven each day */
  distance: s.param('km'),
  /** how long, on average, until an opening for someone looking */
  opening: s.param('d'),
});
export type TownEmployer = Infer<typeof TownEmployerSchema>;

export interface RosterEntry {
  id: EntityId;
  name: string;
  /** the job, or 'family' / 'friend' for helpers */
  job: string;
  /** of the circle: how many more working days they could be asked for this year (beyond a stay already agreed), and the stay */
  helper?: { relation: string; resident: boolean; moreDaysThisYear: number; stay?: { from: number; until: number } };
  status: Presence['status'] | 'recruiting';
  /** until when the status holds (sim seconds), and as a date */
  until?: number;
  untilDate?: string;
  hourlyCost: number;
  vacationDaysLeft: number;
  sickDaysThisYear: number;
  /** whether the party's word reaches them now (I9): they are its lead, within hearing of it, by phone, or why not; and their phone's charge (%) */
  word?: { lead: boolean; how?: 'self' | 'hearing' | 'phone'; why?: string; phone: number };
  /** on their way somewhere now (an errand, the walk to work, a drive): what for, and until when (S403: not "available" to the eye) */
  onTheWay?: { purpose: string; until: number; untilDate: string };
}

/** a course someone is enrolled in and has not yet started */
export interface Enrolment {
  course: string;
  from: number;
  until: number;
}

/** someone of the circle who could come and help with some work */
export interface HelperOffer {
  person: EntityId;
  name: string;
  /** days they can still come this year (a friend's within the law) */
  days: number;
  /** when they would arrive if asked now */
  arrives: number;
  /** how practised at the skill (see WorkforcePort.level) */
  level: number;
}

/** a course on offer, at today's prices */
export interface CourseOption {
  id: string;
  label: string;
  grants: string[];
  price: number;
  workdays: number;
  /** days until the next course starts */
  leadTime: number;
  /** the dates if enrolled now: away from `from` until `until` */
  from: number;
  until: number;
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    Person: Person;
    Employment: Employment;
    Helper: Helper;
    Enrolment: Enrolment;
    Presence: Presence;
    Vacancy: Vacancy;
    Engaged: Engaged;
  }
  interface PortTypes {
    workforce: WorkforcePort;
  }
  interface ContributionTypes {
    /** what else bears on how fast a person works today (hunger, thirst, tiredness …): a factor with its reasons, or null */
    workCapacity: (read: ReadCtx, person: EntityId) => { factor: number; explain: Explained } | null;
    /**
     * what someone's body carries now, as a share of what a well person carries (0: too weak to walk), and why: an illness
     * keeps one from work, not from fetching one's own water (illness by degrees, VISION); null: nothing known
     */
    bodyCarries: (read: ReadCtx, person: EntityId) => { share: number; why: string } | null;
    /** how long the way to a job beyond the map takes someone, one way (h): on foot, or by what they ride; null: nothing known */
    /** the way to work and back today (h): before the shift, and after it */
    commute: (read: ReadCtx, person: EntityId) => { out: number; back: number } | null;
    /** where someone's work is now (the front of the work they are put to); undefined: their party's base */
    post: (read: ReadCtx, person: EntityId) => import('../../geo/src/index.ts').Vec2 | undefined;
  }
  interface ModuleStateTypes {
    /** state of the workforce module  */
    workforce: WorkforceState;
  }
  interface DataTypes {
    courses?: Record<string, Course>;
    courseOffers?: Record<string, CourseOffer>;
    qualifications: Record<string, Qualification>;
    jobs: Record<string, Job>;
    labourSettings: LabourSettings;
    /** employers beyond the map our people can work for (the town's labour demand, economy pack) */
    employers?: Record<string, TownEmployer>;
  }
  interface EventTypes {
    /** a person comes into the world (hired, or a family member or friend): whose they are (needs gives them a body) */
    'workforce.person': { person: EntityId; party: EntityId };
    'workforce.joined': { person: EntityId; job: string };
    'workforce.left': { person: EntityId };
    'workforce.absence': { person: EntityId; kind: 'sick' | 'vacation' | 'training' | 'shortTime'; until: number };
    'workforce.returned': { person: EntityId };
    'workforce.helperArrived': { person: EntityId };
    'workforce.helperLeft': { person: EntityId };
    'workforce.certified': { person: EntityId; course: string; certificates: string[] };
    /** something someone does is against the law of the place: what institutions may come to know of (decision 0025) */
    'workforce.legalExposure': { person: EntityId; party: EntityId; what: string; rule: string };
    'workforce.vacancyFilled': {
      vacancy: EntityId;
      person: EntityId;
      job: string;
      starts: number;
    };
  }
  interface CommandTypes {
    /**
     * Advertise `count` positions on the regional labour market. Returns the vacancy ids. Each
     * vacancy is filled when an applicant turns up (stochastic, see Job.market); the hire then
     * exists as a Person with Employment.hiredAt in the future (their notice period) and joins
     * the staff on that day.
     */
    'workforce.recruit': { payload: { job: string; count: number }; result: EntityId[] };
    /** Withdraw an open vacancy (no applicant is hired for it). */
    'workforce.withdrawVacancy': {
      payload: { vacancy: EntityId };
      result: void;
    };
    /** Scenario setup: an employee who is already on the payroll. */
    'workforce.employ': { payload: { employer: EntityId; job: string; name?: string; aptitude?: number; experience?: Record<string, number> }; result: EntityId };
    'workforce.practise': { payload: { person: EntityId; skill: string; hours: number }; result: void };
    'workforce.addHelper': { payload: { of: EntityId; name: string; relation: string; resident?: boolean; daysPerYear?: number; travelDays?: number; birthYear?: number; aptitude?: number; certificates?: string[]; experience?: Record<string, number> }; result: EntityId };
    'workforce.askForHelp': { payload: { person: EntityId; days: number }; result: { from: number; until: number } };
    'workforce.sendHome': { payload: { person: EntityId }; result: void };
    'workforce.enrol': { payload: { person: EntityId; course: string }; result: { from: number; until: number } };
    'workforce.dismiss': { payload: { person: EntityId; noticeDays?: number }; result: void };
    'workforce.withdrawNotice': { payload: { person: EntityId }; result: void };
    /** someone is taken up by a task outside the work packages (driving a machine across): busy until the time given */
    /** someone falls ill (their needs, an accident): away until the time given */
    'workforce.fallIll': { payload: { person: EntityId; until: number; reason: string }; result: void };
    /** a helper goes home before their stay is over (they had enough) */
    'workforce.goHome': { payload: { person: EntityId; reason: string }; result: void };
    /** one of the household's own comes to live here again (settled at a camp) */
    'workforce.livesElsewhere': { payload: { person: EntityId }; result: void };
    'workforce.moveIn': { payload: { person: EntityId }; result: void };
    'workforce.detain': { payload: { person: EntityId; days: number; for: string; reason: string }; result: void };
    'workforce.release': { payload: { person: EntityId; for: string; why: string }; result: void };
    /** someone dies (of thirst, of hunger …): they are gone, from work and from those they lived with */
    'workforce.die': { payload: { person: EntityId; cause: string }; result: void };
    'workforce.engage': { payload: { person: EntityId; purpose: string; ref?: string; until: number }; result: void };
    'workforce.take': { payload: { person: EntityId; party?: EntityId }; result: void };
    'workforce.letGo': { payload: { person: EntityId; ref?: string }; result: void };
    'workforce.report': { payload: { person: EntityId }; result: void };
    'workforce.setLead': { payload: { person: EntityId }; result: void };
    'workforce.goTo': { payload: { person: EntityId }; result: number };
    'workforce.phonesCharged': { payload: { draws: Record<EntityId, number> }; result: void };
  }
}
