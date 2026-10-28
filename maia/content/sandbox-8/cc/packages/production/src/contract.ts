/**
 * Production contract — how physical work happens.
 *
 * An *activity* (data) says what kind of work it is: crew and machine roles, how the hourly
 * output is computed from the actual machines/people/soil/haul route (a chain of rate
 * components whose minimum is the bottleneck), what weather and soil it tolerates, and which
 * materials it consumes per unit.
 *
 * A *project* (created by a domain pack, e.g. roads) is a set of *work packages*: an activity,
 * a quantity, a location, precedence links and domain data. Production assigns qualified
 * people and suitable machines, moves machines to the work front, re-rates progress hourly
 * from weather/shift/breakdowns/materials, accounts operating hours and materials, and emits
 * completion events the domain pack turns into physical change.
 */
import { s, type EntityId, type Explained, type Infer, type Source } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
// Contracts of the ports production consumes (type-only imports load their kernel augmentations).
import type { SoilColumn } from '../../terrain/src/index.ts';
import type {} from '../../weather/src/index.ts';
import type {} from '../../soil/src/index.ts';
import type {} from '../../network/src/index.ts';
import type {} from '../../workforce/src/index.ts';
import type {} from '../../equipment/src/index.ts';
import type {} from '../../inventory/src/index.ts';
import type {} from '../../economy/src/index.ts';

/** Quantity whose unit depends on context (validated at setup) — e.g. {value: 2.1, unit: 't/m3'}. */
export interface FlexQuantity {
  value: number;
  unit: string;
  source?: Source;
  note?: string;
}
const Flex = s.any<FlexQuantity>();

/**
 * Rate components. Each yields an hourly output in the ACTIVITY unit for the assigned
 * resources at the package location. Activity rate = min(components) × job efficiency ×
 * operator skill × environment factors.
 */
export const RateComponentSchema = s.union(
  /** crew output independent of machines, e.g. survey staking 120 m/h per crew */
  s.object({ kind: s.literal('crew'), output: Flex, label: s.string().optional() }),
  /** each machine of `role` produces `output` scaled by (machine attribute / reference) */
  s.object({
    kind: s.literal('perMachine'),
    role: s.string(),
    output: Flex,
    scaleBy: s.enum(['none', 'enginePower', 'workingWidth', 'bucket', 'payload', 'operatingWeight']),
    reference: s.number().optional(),
    label: s.string().optional(),
  }),
  /** hydraulic excavator / loader cycles: bucket × fill / swell × 3600 / cycle → bank m³/h */
  s.object({
    kind: s.literal('loading'),
    role: s.string(),
    fillFactor: s.param('1'),
    /** cycle time by soil excavation class (easy/medium/hard/rock) */
    cycleTime: s.record(s.param('s')),
    label: s.string().optional(),
  }),
  /** trucks of `role` hauling between package location and `haul.to`: Σ payload_bank / cycle */
  s.object({
    kind: s.literal('haul'),
    role: s.string(),
    loadingRole: s.string(),
    /** exchange at the loader (the unloading is the truck's own: its carrier class) */
    manoeuvreTime: s.param('s'),
    label: s.string().optional(),
  }),
  /** rollers: speed × (drum width − overlap) × layer thickness / passes */
  s.object({
    kind: s.literal('compaction'),
    role: s.string(),
    speed: s.param('km/h'),
    passes: s.param('1'),
    overlap: s.param('m'),
    label: s.string().optional(),
  }),
  /** graders/dozers spreading/trimming: speed × effective width / passes (m²/h, or m³/h × thickness) */
  s.object({
    kind: s.literal('grading'),
    role: s.string(),
    speed: s.param('km/h'),
    passes: s.param('1'),
    effectiveWidth: s.param('1'),
    label: s.string().optional(),
  }),
  /** pavers: min(screed capacity, plant supply) in t/h */
  s.object({
    kind: s.literal('paving'),
    role: s.string(),
    speed: s.param('m/min'),
    supply: s.param('t/h'),
    label: s.string().optional(),
  }),
);
export type RateComponent = Infer<typeof RateComponentSchema>;

export const ActivitySchema = s.object({
  label: s.string(),
  category: s.enum(['survey', 'clearing', 'earthworks', 'drainage', 'base', 'paving', 'finishing', 'structure', 'envelope', 'services', 'inspection', 'maintenance', 'logistics', 'other']),
  /** unit of quantity: m, m2, m3, t, pcs, tree … */
  unit: s.string(),
  /** for earthworks: how the quantity is measured */
  measure: s.enum(['bank', 'loose', 'compacted', 'none']),
  description: s.string().optional(),
  /**
   * Work that must harden or dry before what follows it may go on it (realism S6, audit H2): its equivalent age (`age`,
   * hours at `reference` °C) by the Nurse-Saul maturity of the air since it was done, nothing below `datum` °C
   * (ASTM C1074): concrete before it is loaded or its formwork struck, render before it is painted. `what`: said so.
   */
  cures: s.object({ datum: s.param('°C'), reference: s.param('°C'), age: s.param('h'), what: s.string() }).optional(),
  /**
   * people by role: the standard number (`count`, what the crew output is for), the fewest the work
   * can go on with (`min`, default `count`) and the most it has room for (`max`, default `count`):
   * output scales with the hands at work. `tool`: each of them needs a tool of this equipment class
   */
  crew: s.array(s.object({ role: s.string(), qualification: s.string(), count: s.int({ min: 1 }), min: s.int({ min: 1 }).optional(), max: s.int({ min: 1 }).optional(), tool: s.string().optional() })),
  /**
   * machines by role: the standard number (`count`) and the fewest the work can go on with
   * (`min`, default `count`): with fewer, the rate components that count machines (haul) run slower
   */
  equipment: s.array(s.object({ role: s.string(), classes: s.array(s.string()), count: s.int({ min: 1 }), min: s.int({ min: 0 }).optional() })),
  rate: s.array(RateComponentSchema),
  /** productive minutes per hour as a fraction (e.g. 50/60 = 0.83) */
  jobEfficiency: s.param('1'),
  weather: s.object({
    /** no work above this precipitation intensity */
    maxPrecip: s.param('mm/h').optional(),
    /** no work below this air temperature */
    minTemp: s.param('°C').optional(),
    maxWind: s.param('m/s').optional(),
    /** soil trafficability required ('reduced' means reduced or good) */
    trafficability: s.enum(['any', 'reduced', 'good']).optional(),
    /** stop when ground frost deeper than this */
    maxFrostDepth: s.param('m').optional(),
    /** rate factor when trafficability is 'reduced' */
    reducedFactor: s.param('1').optional(),
    /** no work in less light than this (lx: daylight or a light at the work, S7); absent: the settings' `light.work` */
    minLight: s.param('lx').optional(),
  }),
  /** materials consumed per activity unit from the project store, e.g. {"agg.fss": {value: 2.1, unit: 't/m3'}} */
  materials: s.record(Flex),
  /** what the work makes per activity unit (logs split: firewood), put where the work says (production.process) */
  yields: s.record(Flex).optional(),
  /** where what it uses and does not make goes (a fire: to the air, as smoke); absent: the ground */
  loss: s.enum(['air', 'ground']).optional(),
  /** doing it is against the law of the place: the breach (enforcement data) the authorities may find it as (rubbish burnt in the open) */
  offence: s.string().optional(),
  /** it is a fire while it is done: how far its heat and sparks reach (things nearer that burn may catch: 8h) */
  fire: s.object({ reach: s.param('m') }).optional(),
  /**
   * materials bought just-in-time and delivered straight into the work (hot-mix asphalt,
   * ready-mix concrete): paid at the best supplier offer as the work is done, never stored.
   */
  directSupply: s.record(Flex).optional(),
  /**
   * Work let to a subcontractor (Nachunternehmer): their crew and plant come with them, they
   * are paid per unit of output, and they need booking lead time. Own crew/equipment roles
   * may still be listed (e.g. our crane supporting them).
   */
  subcontract: s
    .object({
      label: s.string(),
      /** price per activity unit, e.g. {value: 165, unit: 'EUR/m2'} */
      price: Flex,
      /** their crew's output per hour (activity unit/h) */
      output: Flex,
      crewSize: s.int({ min: 1 }),
      /** typical market backlog (for estimates; actual start comes from the awarded contractor) */
      leadTime: s.param('d'),
      /** material the contractor brings to site by truck, per activity unit */
      deliveries: s
        .object({
          material: s.string(),
          label: s.string(),
          perUnit: Flex,
          profile: s.string(),
        })
        .optional(),
    })
    .optional(),
  /** load factor of machines while working (fuel) */
  machineLoad: s.param('1'),
  /** hold point after the work: inspection/acceptance before successors may start */
  holdAfter: s.param('h').optional(),
  color: s.string().optional(),
});
export type Activity = Infer<typeof ActivitySchema>;

/** a trade that only subcontractors do (building trades); other activities with a subcontract block may be let optionally */
export const subcontractOnly = (activity: Activity): boolean => Boolean(activity.subcontract) && activity.rate.length === 0;

/** the package is done by a subcontractor: always for subcontract-only trades, otherwise once it has been awarded */
export const isSubcontracted = (pkg: { contractor?: string | undefined }, activity: Activity): boolean => Boolean(activity.subcontract) && (activity.rate.length === 0 || pkg.contractor !== undefined);

export const ContractorSchema = s.object({
  label: s.string(),
  /** activity ids this company does */
  trades: s.array(s.string()),
  /** parallel crews (jobs at the same time) */
  crews: s.int({ min: 1 }),
  /** price relative to the market reference price of the trade */
  priceFactor: s.param('1'),
  /** order backlog at the market's reference activity and season: a new order starts after it */
  leadTime: s.param('d'),
  /** a site that is not ready on the booked date: the soonest the crew can come back (a regular client's job) */
  rebookDelay: s.param('d'),
});
export type Contractor = Infer<typeof ContractorSchema>;

/** how the firms' order books behave (the contractor market of a region) */
export const ContractorMarketSchema = s.object({
  /** the construction activity (1 = normal) and season factor the firms' lead times describe */
  reference: s.object({ level: s.param('1'), season: s.param('1') }),
  /** order books follow the construction cycle: ∝ activity^elasticity */
  cycleElasticity: s.param('1'),
  /** construction work by month, January … December (1 = the year's average) */
  season: s.array(s.param('1')),
  /** order books follow the season: ∝ season^elasticity */
  seasonElasticity: s.param('1'),
  /** a firm's order book moves towards where the market pushes it over about this many days */
  adjustDays: s.param('d'),
  /** firms' luck: σ of the log of a firm's order book against the market's, drawn each month */
  firmSpread: s.param('1'),
  /** busy firms charge more: price ∝ (order book / normal)^elasticity */
  priceElasticity: s.param('1'),
  /** a firm whose order book is this many times its normal one takes no new orders */
  fullAt: s.param('1'),
  /** jumping the queue: the crew comes within these days, at a surcharge × (order book / normal) */
  rush: s.object({ days: s.param('d'), premium: s.param('1') }),
  /** the jobs ahead of ours overrun: by this share of the queue ahead (mean, σ); the firm tells us these days before our start */
  overrun: s.object({ mean: s.param('1'), spread: s.param('1'), noticeDays: s.param('d') }),
  /** regular clients: standing 1 − e^(−jobs/n) after n jobs given to a firm (each missed slot takes one back) */
  regularAfter: s.param('1'),
  /** a regular's site that is not ready: the firm waits up to this many days before moving on */
  graceDays: s.param('d'),
});
export type ContractorMarket = Infer<typeof ContractorMarketSchema>;

export const ProductionSettingsSchema = s.object({
  /** how near its work someone or something must be to work at it (of the work's own section: design/physical-state.md I6) */
  workReach: s.param('m'),
  /**
   * what a party knows of the ground (design/physical-state.md 8d, decision 0017): a test pit (`testPit`, an activity)
   * shows the column to its depth, and is taken to hold within `reach` of it; elsewhere the region's soil map
   */
  soilKnowledge: s.object({ testPit: s.string(), depth: s.param('m'), reach: s.param('m') }).optional(),
  /** how far from the work a vehicle may stop for those it brings to walk on (a van at the bank of a creek it cannot ford) */
  walkOn: s.param('m'),
  /** the light own work outdoors needs (lx, ASR A3.4): daylight, or a light tower's at the work (S7); a firm's crew brings its own */
  light: s.object({ work: s.param('lx') }).optional(),
  /** representative machine model per class (for estimates) */
  standardModels: s.record(s.string()),
  /** representative soil class when estimating without a location */
  standardSoil: s.string(),
  /** felling for the wood: the activities by chainsaw and by hand, and what the stems and crowns become */
  felling: s.object({ chainsaw: s.string(), hand: s.string(), logs: s.string(), brash: s.string() }).optional(),
});
export type ProductionSettings = Infer<typeof ProductionSettingsSchema>;

export interface PackageLink {
  package: EntityId;
  type: 'FS' | 'SS';
  /** FS: hours after predecessor finish; SS: fraction of predecessor that must be done first */
  lag: number;
}

/** trees a work fells, in order, each with its share of the work (activity units), and where their wood goes */
export interface Fells<S = EntityId> {
  trees: { id: string; q: number }[];
  logs: string;
  brash: string;
  store: S;
}

/**
 * The ground a work digs or fills (design/physical-state.md §5): grid vertices and the m³ at each ([i, j, m³]: bank m³
 * dug, compacted m³ laid), in the order the work reaches them; the package's quantity is done in proportion to it.
 */
export interface GroundWork {
  op: 'dig' | 'fill';
  cells: [number, number, number][];
  /** dig: the goods what is dug becomes by its kind (the produces say where each goes; else `store`) */
  as?: { topsoil: string; fill: string; spoil: string };
  /** dig: a strip, taking only the topsoil it finds (none where it is gone) */
  topsoilOnly?: boolean;
  store?: EntityId;
  /** fill: the soil class it lays (absent: the soil the work meets, its package's), and by the good laid where another (imported gravel for the cut it lacked) */
  cls?: string;
  clsOf?: Record<string, string>;
}

/** a good the work produces: so much of it per activity unit, into a store */
export interface Produce {
  material: string;
  perUnit: number;
  store: EntityId;
}

export interface PackageSpec {
  key: string;
  activity: string;
  label: string;
  quantity: number;
  /** work front: centre point and, for linear works, the path */
  pos: Vec2;
  path?: Vec2[];
  after?: { key: string; type: 'FS' | 'SS'; lag?: number }[];
  /** activity parameters, e.g. layerThickness (m) */
  params?: Record<string, number>;
  /** where hauled material goes (earthworks) */
  haulTo?: Vec2;
  /** what the work produces per activity unit, each into its store (excavated soil, t per bank m³) */
  produces?: Produce[];
  /** the trees it fells, one by one as the work passes them (their wood onto the heap) */
  fells?: Fells;
  /** the ground it digs or fills as it goes (earthworks: its produces are what the planner expects of it) */
  ground?: GroundWork;
  /** override/extend activity materials per unit (material unit per activity unit) */
  consumes?: Record<string, number>;
  /** store materials are drawn from (default: project store) */
  store?: EntityId;
  /**
   * fallback material when a consumed material runs out and nothing in the project will
   * produce more of it (e.g. imported fill when excavated soil is exhausted)
   */
  substitutes?: Record<string, { material: string; perUnit: number; store?: EntityId }>;
  /** soil class for earthworks rate components, as the plan takes it (default: from terrain at pos) */
  soilClass?: string;
  /**
   * where the work meets its soil (m below the surface at `pos`): the work goes by the ground as it is there, whatever
   * the plan took it for (`soilClass`, its party's knowledge: design/physical-state.md 8d)
   */
  soilDepth?: number;
  data?: unknown;
}

export interface Project {
  label: string;
  /** the domain module that made it (roads, buildings …) */
  owner: string;
  /** the party whose project it is: its people and equipment work it, it pays (decision 0025) */
  party: EntityId;
  ref?: EntityId;
  status: 'active' | 'paused' | 'complete' | 'cancelled';
  priority: number;
  site: Vec2;
  store?: EntityId;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  packages: EntityId[];
  /** estimate at creation (planned) */
  estimate: { hours: number; cost: number; finish: number };
  /** how its materials are ordered: up front, or just in time against the schedule (none: the player orders) */
  supply?: { mode: 'upfront' | 'justInTime'; bufferHours?: number; coverDays?: number };
  /** the orders production placed for it (cancelled with it) */
  orders?: EntityId[];
}

export interface WorkPackage {
  project: EntityId;
  key: string;
  activity: string;
  label: string;
  quantity: number;
  unit: string;
  pos: Vec2;
  path?: Vec2[];
  after: PackageLink[];
  params: Record<string, number>;
  haulTo?: Vec2;
  /**
   * the haul as loads (design/physical-state.md I5, flows): its holding on the road, a truck's cycle (s), what one takes
   * (in the activity's unit), and when the next load is at the heap; what is dug goes on the road and arrives load by load
   */
  haul?: { store?: EntityId; cycle: number; perLoad: number; next?: number; tally?: number; truck?: { profile: string; t: number } };
  produces?: Produce[];
  fells?: Fells;
  ground?: GroundWork;
  /** how many of its trees are felled, and their logs (t) */
  felled?: number;
  felledLogs?: number;
  /** each tree felled: where it stood, its logs (t) and when it came down: whose land it was on, and with whose leave */
  felledAt?: [number, number, number, number][];
  /** material → the stores it was drawn from, how much from each (a kit struck goes back where it came from) */
  drawn?: Record<string, Record<string, number>>;
  consumes: Record<string, number>;
  store?: EntityId;
  /** material → the store of ours it is drawn from instead (production.supplyFrom) */
  supply?: Record<string, EntityId>;
  substitutes?: Record<string, { material: string; perUnit: number; store?: EntityId }>;
  /** materials for which the substitute is now in use */
  switched?: string[];
  soilClass: string;
  status: 'waiting' | 'ready' | 'active' | 'hold' | 'done' | 'cancelled';
  process?: string;
  crew: EntityId[];
  machines: EntityId[];
  /** current hourly rate (activity unit/h) */
  rate: number;
  /** progress already accounted (materials, hours) */
  accounted: number;
  /** wall time with rate > 0 not yet accounted */
  activeSince?: number;
  workedHours: number;
  /**
   * the goods at its work front: a holding of its own (design/physical-state.md I1), drawn ahead of the work and
   * built in, or moved on, as it is done; what is left there when it ends stays there
   */
  front?: EntityId;
  /** attributed (management-accounting) costs */
  cost: { labour: number; equipment: number; materials: number; subcontract: number };
  /** how well the work was done, per unit of work: the quantity done and the sum of quantity × the hands' practice (own crew: their capped speed; a contractor: 1) */
  workmanship?: { qty: number; sum: number };
  /** subcontracted work cannot start before the subcontractor's booked date */
  earliestStart?: number;
  /** awarded contractor and contract terms */
  contractor?: string;
  /** price per unit, start and end agreed; `agreed`: the price before a rush surcharge (bought forward) */
  contract?: { price: number; start: number; end: number; agreed?: number };
  /** contractor crew arrived on site today */
  crewOnSite?: boolean;
  supplies?: SiteSupply[];
  supplyBooking?: { supplier: string; from: number; calledOffDay?: number };
  startedAt?: number;
  completedAt?: number;
  /** work that cures (its activity's `cures`): its equivalent age so far since it was done (h at the reference temperature) */
  cured?: number;
  /** lit by a light tower since then (S7): its hours are booked when the next decision is made (it burns its fuel for them) */
  lit?: { by: EntityId; since: number };
  /** given up: when (what it laid was laid by then) */
  cancelledAt?: number;
  holdUntil?: number;
  /** estimate at creation */
  estimate: { rate: number; hours: number; rateExplain: Explained; cost?: number };
  data?: unknown;
}

/** material on its way to / waiting at a work front (contractor deliveries, booked hot-mix) */
export interface SiteSupply {
  kind: 'subcontract' | 'booked';
  material: string;
  label: string;
  /** material units per activity unit */
  perUnit: number;
  unit: string;
  profile: string;
  supplier?: string;
  /** EUR per material unit (booked supplies, paid on delivery) */
  price?: number;
  perishableHours?: number;
  delivered: number;
  inbound: number;
  used: number;
  wasted: number;
}

export interface Assignment {
  package: EntityId;
  role: string;
  /** the skill (qualification) a person exercises here: their practice in it grows with the hours */
  skill?: string;
}

export interface Estimate {
  rate: Explained;
  hours: number;
  crew: { role: string; qualification: string; count: number }[];
  equipment: { role: string; model: string; count: number }[];
  /** labour + equipment + materials cost estimate (EUR) */
  cost: Explained;
}

export interface ScheduleRow {
  package: EntityId;
  label: string;
  activity: string;
  /** planned (estimate) or forecast (remaining work at current/estimated rates) */
  start: number;
  finish: number;
  progress: number;
  status: WorkPackage['status'];
  actualStart?: number;
  actualFinish?: number;
  /** it does not go on without a decision (not let, or blocked), or waits for work that does: the forecast is only a plan */
  stalled?: string;
  /** the package the decision is needed for (this one, or work before it) */
  stalledAt?: EntityId;
}

export interface ProductionPort {
  activity(id: string): Activity;
  /** estimate a package with standard resources (planning; uses climate normals only) */
  /** with `store`: hand work carries from it, as the work will */
  /** what the work would take, reckoned on what `party` knows of the ground (absent: on the region's soil map) */
  estimate(spec: Pick<PackageSpec, 'activity' | 'quantity' | 'pos' | 'params' | 'haulTo' | 'soilClass' | 'consumes' | 'store' | 'produces' | 'fells'>, party?: EntityId): Estimate;
  /** what a party knows of the soil at a depth there (8d): from its test pit within reach, else from the soil map (no party: the soil map) */
  knownSoil(party: EntityId | undefined, pos: Vec2, depth: number): { id: string; from: 'test pit' | 'soil map' | 'the ground'; at?: Vec2 };
  /** the soil column as a party knows it there: its test pit's, the soil map's below it and where it has none (no party: the soil map) */
  knownColumn(party: EntityId | undefined, pos: Vec2): SoilColumn;
  /** forecast schedule of a project (CPM with working calendar and expected weather) */
  schedule(project: EntityId): ScheduleRow[];
  progress(pkg: EntityId): number;
  /** how well the package was done (0..1 per unit of work: the own crew's practice, 1 for a contractor's experienced crew); null before any work */
  workmanship(pkg: EntityId): number | null;
  /** how well a project's work was done: its packages (those `which` selects by their data) weighted by their cost; null before any work */
  projectWorkmanship(project: EntityId, which?: (data: unknown) => boolean): number | null;
  /** what a project cost (labour, plant, materials, subcontracts attributed to its packages) */
  projectCost(project: EntityId): number;
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    Project: Project;
    WorkPackage: WorkPackage;
    Assignment: Assignment;
  }
  interface PortTypes {
    production: ProductionPort;
  }
  interface ContributionTypes {
    /** whose a tree standing here is when it is not ours to fell (the land's holder, without leave), and how to ask them: null when we may */
    notOursToFell: (read: import('../../kernel/src/index.ts').ReadCtx, party: EntityId, pos: [number, number]) => { holder: string; ask: import('../../kernel/src/index.ts').Remedy[] } | null;
  }
  interface DataTypes {
    activities: Record<string, Activity>;
    productionSettings: ProductionSettings;
    contractors: Record<string, Contractor>;
    contractorMarket?: ContractorMarket;
    handling?: import('./carry.ts').Handling;
  }
  interface EventTypes {
    'production.packageStarted': { package: EntityId; project: EntityId };
    /** someone works without the certificate the law asks for (decision 0025: law is a consequence) */
    'production.legalExposure': { person: EntityId; party: EntityId; what: string; rule: string; kind?: string };
    /** someone drove one of our vehicles on an errand without the licence it needs (decision 0025: the law answers) */
    'errands.legalExposure': { person: EntityId; party: EntityId; what: string; rule: string };
    'production.packageCompleted': { package: EntityId; project: EntityId; owner: string; ref?: EntityId; key: string; activity: string; data?: unknown };
    'production.projectCompleted': { project: EntityId; owner: string; ref?: EntityId };
    'production.projectCancelled': { project: EntityId; owner: string; ref?: EntityId };
  }
  interface CommandTypes {
    /** someone walks to a supplier, buys at the counter what one person can carry and brings it back */
    /** `party` and `routine`: a household's own errand, sent by the simulation (needs' routines, design/realism-plan.md S2) */
    'errands.goToTown': { payload: { person: EntityId; hours?: number }; result: { back: number } };
    'errands.fetch': { payload: { person: EntityId; material: string; qty: number; store: EntityId; supplier: string; vehicle?: EntityId; service?: string; bus?: boolean; party?: EntityId; routine?: boolean }; result: { order: EntityId; back: number } };
    'errands.drawWater': { payload: { person: EntityId; store: EntityId; qty: number; party?: EntityId; routine?: boolean }; result: { back: number } };
    'errands.carry': { payload: { person: EntityId; from: EntityId; to: EntityId; material: string; qty: number; party?: EntityId; routine?: boolean }; result: { back: number } };
    'production.createProject': {
      payload: { label: string; owner: string; party?: EntityId; ref?: EntityId; priority?: number; site: Vec2; store?: EntityId; supply?: NonNullable<Project['supply']>; packages: PackageSpec[] };
      result: { project: EntityId; packages: Record<string, EntityId> };
    };
    'production.setPriority': { payload: { project: EntityId; priority: number }; result: void };
    'production.pauseProject': { payload: { project: EntityId }; result: void };
    'production.resumeProject': { payload: { project: EntityId }; result: void };
    'production.cancelProject': { payload: { project: EntityId }; result: void };
    'production.setSupply': { payload: { project: EntityId; mode: 'upfront' | 'justInTime' | 'none'; bufferHours?: number; coverDays?: number }; result: Project['supply'] | null };
    /** a plan revised: more work in a running project (keys new; `after` may name its existing packages) */
    'production.extendProject': { payload: { project: EntityId; packages: PackageSpec[] }; result: Record<string, EntityId> };
    /** a plan revised: one package dropped */
    'production.cancelPackage': { payload: { package: EntityId }; result: void };
    'production.award': {
      payload: { package: EntityId; contractor: string };
      result: { contractor: string; price: number; start: number; end: number };
    };
    'production.awardProject': {
      payload: { project: EntityId; strategy?: 'earliest' | 'cheapest' };
      result: number;
    };
    'production.bookSupply': {
      payload: { package: EntityId; supplier?: string };
      result: { from: number; supplier: string };
    };
    /** lay out one of our stores (work): its goods in the planner's order of use, or the one given */
    'production.layOut': { payload: { store: EntityId; order?: string[] }; result: { project: EntityId; packages: Record<string, EntityId> } };
    /** move our goods between two of our stores, by hand or by machine: a project of one work package */
    'production.moveGoods': { payload: { from: EntityId; to: EntityId; material: string; qty: number; by: 'hand' | 'machine' | 'service'; service?: string; label?: string; party?: EntityId }; result: { project: EntityId; packages: Record<string, EntityId> } | { move: EntityId; arrives: number; price: number } };
    /** buy a booked job forward as a rush job (the firm's rush surcharge) */
    'production.hurry': { payload: { package: EntityId; notBefore?: number }; result: { start: number; price: number } };
    /** do work that makes goods of goods (an activity with yields: splitting logs into firewood), from a store into a store */
    'production.process': { payload: { activity: string; quantity: number; store: EntityId; label?: string }; result: { project: EntityId; packages: Record<string, EntityId> } };
    /** fell trees for their wood: by chainsaw or by hand, onto a heap */
    'production.fell': { payload: { trees?: string[]; area?: Vec2[]; by: 'chainsaw' | 'hand'; store?: EntityId; label?: string }; result: { project: EntityId; packages: Record<string, EntityId>; store: EntityId; volume: number; trees: number } };
    /** draw a package's material (or all of them) from this store of ours */
    'production.supplyFrom': { payload: { package: EntityId; store: EntityId; material?: string }; result: void };
    'production.useSubstitute': {
      payload: { package: EntityId; material: string };
      result: void;
    };
  }
}
