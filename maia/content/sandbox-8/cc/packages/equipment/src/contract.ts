/**
 * Equipment contract: machines are individual entities of a model, owned or rented, that
 * need a qualified operator, burn fuel, accrue hours, need service, and break down.
 * Production reports operating hours; this module turns them into wear, fuel and cost.
 */
import { s, type EntityId, type Explained, type Infer, type Provenance, type Source } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';

/** a kind of equipment (practice pack): from a knife to an excavator */
/** trailer: moved only behind a vehicle that can tow it (a caravan, a construction trailer) */
export const EquipmentClassSchema = s.object({ label: s.string(), kind: s.enum(['hand', 'powered', 'machine', 'vehicle', 'trailer']) });
export type EquipmentClass = Infer<typeof EquipmentClassSchema>;
/** an equipment class id of the practice pack's catalog */
export type MachineClass = string;

/** an engine: fuel, a tank, services and breakdowns */
export const EngineSchema = s.object({
  power: s.param('kW'),
  /** average fuel consumption at typical duty */
  fuelUse: s.param('l/h'),
  /** usable fuel carried on the machine (for hand-held tools including the operator's canister) */
  tankSize: s.param('l'),
  /** inventory material it burns (default 'diesel') */
  fuel: s.string().optional(),
  serviceInterval: s.param('h'),
  serviceDuration: s.param('h'),
  /** mean operating hours between failures */
  mtbf: s.param('h'),
  /** mean hands-on repair time of a breakdown on site (fitter working hours; travel and parts waits come on top) */
  mttr: s.param('h'),
  /** what a service costs for this machine (the visit or the shop, and its consumables; wear parts come on top); absent: the settings' */
  serviceCost: s.param('EUR').optional(),
  /** who mends a breakdown: the dealer's field service (default), or its holder (or a workshop it is taken to): out for its repair time, billed what the cost list leaves per breakdown */
  repairBy: s.enum(['fieldService', 'holder']).optional(),
  /** of its fuel use at full load, the share it burns running idle (default 0.6: a diesel machine; an inverter generator much less) */
  idleShare: s.param('1').optional(),
});
export type Engine = Infer<typeof EngineSchema>;

/** a battery the unit carries (a portable power station): electricity held, charged and drawn at its rates (design/physical-state.md 8g) */
export const BatterySchema = s.object({
  /** what it holds new (usable) */
  capacity: s.param('kWh'),
  /** the most it takes (its charger, its solar input) */
  chargeRate: s.param('kW'),
  /** the most it gives */
  outputRate: s.param('kW'),
  /** of what goes in, the share it stores (its charger and cells) */
  efficiency: s.param('1'),
  /** what it loses standing, a month (its cells and its electronics) */
  selfDischarge: s.param('1/mo'),
  /** full cycles until it holds 80 % of what it did new */
  cycles: s.param('1'),
  /** below this it takes no charge (its management protects the cells) */
  minChargeTemp: s.param('degC'),
  /** charged as it is delivered (as they ship) */
  shipped: s.param('1'),
});
export type Battery = Infer<typeof BatterySchema>;

/** a solar panel: its peak power, set facing south at a tilt, what reaches its battery of it (heat, its controller, cable, dirt), and its cable */
export const PanelSchema = s.object({ peak: s.param('kW'), tilt: s.param('deg'), derate: s.param('1'), cable: s.param('m') });
/** a light at the work (a light tower: S7): the light it gives over an area round it (lx, on average, at ground level) */
export const LightSchema = s.object({ lux: s.param('lx'), area: s.param('m2') });
/** a generator: what its engine turns into electricity at most, and its cable */
export const GeneratorSchema = s.object({ output: s.param('kW'), cable: s.param('m') });

/** moving under its own power on the network */
export const TransportSchema = s.object({
  travelSpeed: s.param('km/h'),
  /** vehicle profile used when it drives on the network */
  vehicleProfile: s.string(),
  /** needs a low-loader to move on public roads */
  needsLowLoader: s.boolean(),
});

/** wear by use of a tool without an engine: it needs care (sharpening, setting) and in the end is worn out */
export const WearSchema = s.object({
  /** hours of use after which it needs care */
  careEvery: s.param('h'),
  /** how fast it works when it needs care (a blunt axe) */
  careFactor: s.param('1'),
  /** hours of use until it is worn out */
  life: s.param('h'),
});

export const MachineModelSchema = s.object({
  label: s.string(),
  /** an equipment class of the practice pack */
  class: s.string(),
  /** qualification the operator needs ('' = none, e.g. hand tools) */
  operatorQualification: s.string(),
  operatingWeight: s.param('t'),
  bucket: s.param('m3').optional(),
  payload: s.param('t').optional(),
  payloadVolume: s.param('m3').optional(),
  workingWidth: s.param('m').optional(),
  purchasePrice: s.param('EUR'),
  /** bought new: how long until it is delivered, where its shop says (a bicycle in stock); else the settings' lead time of its kind */
  purchaseLeadTime: s.param('d').optional(),
  /** monthly depreciation + interest of owned machines (a national cost list, from the economy pack) */
  owningCostPerMonth: s.param('EUR/mo'),
  /** monthly repair cost at the standard utilisation of the cost list */
  repairCostPerMonth: s.param('EUR/mo'),
  /** rental day rate (working day), where it can be rented */
  rentalPerDay: s.param('EUR/d').optional(),
  /** an engine, if it has one (decision 0025: not every piece of equipment does) */
  engine: EngineSchema.optional(),
  /** it moves on the network under its own power; without: it is carried */
  transport: TransportSchema.optional(),
  /** a tool without an engine wears by use */
  wear: WearSchema.optional(),
  /** a battery it carries (a power station) */
  battery: BatterySchema.optional(),
  /** it makes electricity from the sun (a panel) */
  panel: PanelSchema.optional(),
  /** it makes electricity from its fuel (a generator: it has an engine) */
  generator: GeneratorSchema.optional(),
  /** it lights the work round it (a light tower, while its engine runs: S7) */
  light: LightSchema.optional(),
  /** what it may tow (a braked trailer, t): a car's tow bar */
  tows: s.param('t').optional(),
  color: s.string().optional(),
});
export type MachineModel = Infer<typeof MachineModelSchema>;

/** the engine of a model that must have one */
export function engineOf(md: MachineModel): Engine {
  if (!md.engine) throw new Error(`${md.label} has no engine`);
  return md.engine;
}

/** the inventory material a machine model burns */
export const fuelOf = (md: MachineModel): string => md.engine?.fuel ?? 'diesel';

/** fuel burnt per operating hour at a load factor 0..1 (idle share 0.6 + 0.4 × load); nothing without an engine */
export const fuelPerHour = (md: MachineModel, load: number): number => {
  if (!md.engine) return 0;
  const idle = md.engine.idleShare?.value ?? 0.6;
  return md.engine.fuelUse.value * (idle + (1 - idle) * Math.min(1, Math.max(0, load)));
};

/** the vehicle profile it moves with on the network: its own, or carried in a van */
export const profileOf = (md: MachineModel): string => md.transport?.vehicleProfile ?? 'van';

export const EquipmentSettingsSchema = s.object({
  dieselPrice: s.param('EUR/l'),
  /** delivery lead time of rented machines */
  rentalLeadTime: s.param('d'),
  /** the hire firm wants this many days of hire covered before it delivers (a deposit or a check of our money) */
  rentalCover: s.param('d'),
  /** delivery lead time of a new machine ordered from a dealer */
  purchaseLeadTime: s.param('d'),
  /** a tool from a shop (no engine, carried): bought and brought the next day or so */
  toolLeadTime: s.param('d'),
  /** how often a dealer or a hire firm tries to bring a machine it cannot get to us before it calls the order off */
  deliveryAttempts: s.param('1'),
  /** utilisation basis of the repair costs (operating hours per month of the cost list) */
  repairBasisHours: s.param('h/mo'),
  /** cost of an external service visit (the fitter, oil and filters; wear parts come on top) */
  serviceCost: s.param('EUR'),
  /**
   * One repair model (RUNS2 H9): the repair cost of the cost list (BGL) is what repairs cost on average, and
   * is billed as they happen, never accrued as well. This share of it is wear (tracks, teeth, hoses, brakes)
   * renewed at each service for the hours since the last; the rest is breakdowns, whose ordered parts are
   * what is left of it per breakdown after the fitter's time.
   */
  wearShare: s.param('1'),
  /** how much more often a machine breaks down per interval it is overdue for service (hazard × (1 + this × overdue intervals)) */
  overdueHazard: s.param('1'),
  /**
   * Breakdown repairs by the dealer's / rental company's field service: a fitter drives out in a
   * service van, and some faults need parts that have to be ordered (second visit).
   */
  repairService: s.object({
    /** call-out / travel flat fee per visit */
    calloutFee: s.param('EUR'),
    /** fitter hourly rate on site */
    fitterRate: s.param('EUR/h'),
    /** share of breakdowns needing parts not carried in the van */
    partsShare: s.param('1'),
    /** parts delivery to the dealer, working days */
    partsLeadTime: s.param('d'),
    /** vehicle profile of the service van */
    vehicleProfile: s.string(),
  }),
  /** low-loader hire incl. driver, billed for the round trip plus loading (tracked machines moved > 2 km and deliveries) */
  lowLoaderRate: s.param('EUR/h'),
  /** vehicle profile id of the low-loader */
  lowLoaderProfile: s.string(),
  /** the carrier a tool without transport goes with (carried or pushed by someone on foot) */
  toolCarrier: s.string().optional(),
  /** booking a low-loader haulier: working days ahead (1: book today, pick-up next working morning) */
  lowLoaderLeadTime: s.param('d'),
  /**
   * The dealers' and hire firms' usual week (practice, design/modular-split.md §5.3 item 2): the days they work (calendar
   * weekdays, 0 Monday .. 6 Sunday; a day of hire is owed for each of them a machine is on hire), their field service's
   * hours (`from`, `to`), and the hour from which a breakdown called in is served the next working morning (`cutoff`)
   */
  workingHours: s.object({ days: s.array(s.int({ min: 0, max: 6 })), from: s.param('h'), to: s.param('h'), cutoff: s.param('h') }),
});
export type EquipmentSettings = Infer<typeof EquipmentSettingsSchema>;

export interface Machine {
  model: string;
  /** the party that holds it (owns or rents it) and pays for it (decision 0025) */
  holder: EntityId;
  /** owned (on its holder's books), rented, borrowed (lent by someone), made or found */
  ownership: 'owned' | 'rented' | 'borrowed' | 'made' | 'found';
  acquiredAt: number;
  engineHours: number;
  hoursSinceService: number;
  /** of those hours, run by those who borrowed it for nothing (theirs to keep: their share of the next service) */
  ranBy?: Record<EntityId, number>;
  /** days of this month kept by those who borrowed it for nothing (their share of its month's upkeep) */
  keptBy?: Record<EntityId, number>;
  /** its tank: a holding of its fuel riding with it (design/physical-state.md I1); none without an engine */
  tank?: EntityId;
  /** its battery: a holding of electricity riding with it; and the energy it has taken in so far (its cycles) */
  battery?: EntityId;
  charged?: number;
  status: 'ready' | 'travelling' | 'broken' | 'servicing' | 'arriving' | 'offHired';
  /** status ends at (repair/service/arrival; off-hired: when the hire firm comes for it) */
  until?: number;
  /** a rented machine off-hired: when the notice counts from (the off-hire day, the last day of hire owed) */
  hireEnds?: number;
  /** the move it is on (travelling under its own power, or carried) */
  move?: EntityId;
  /** destination while travelling */
  destination?: Vec2;
  /** remaining book value of an owned machine (purchase price less posted owning cost) */
  bookValue?: number;
  /** last time it worked or arrived somewhere (idle since then) */
  lastActive?: number;
  /** ordered from a dealer: the agreed price, paid on delivery */
  pendingPrice?: number;
  /** the times its delivery could not be brought so far (it is called off after the settings' attempts) */
  deliveryTries?: number;
  /** set up as something else where it stands (a caravan as a home): it does not move until packed up */
  setUp?: boolean;
  /** offered for sale on the used-plant market (when buyers come is the world's knowledge, in module state); `buyer`: one agreed and coming to collect */
  listing?: { ask: number; since: number; buyer?: string; offer?: { price: number; until: number } };
}

/**
 * a machine in its holder's hands to use, by its status: not handed back to its hire firm (off-hired, standing to be
 * collected: the hire firm's) and not still to come (arriving), unless `booked`: one still to come may be planned for
 * work ahead. The one test of it (who may use it, what charges from it, what it charges: review x)
 */
export const inHand = (m: Pick<Machine, 'status'>, booked = false): boolean => m.status !== 'offHired' && (booked || m.status !== 'arriving');

// ------------------------------------------------------------------ the used-plant market (decision 0015)

/** what the market would pay for a machine as it is, explained, with where that comes from */
export interface UsedPlantValue {
  value: number;
  explain: Explained;
  provenance: Provenance;
}

/**
 * The used-plant market: a model contract with two implementations (a depreciation curve, and
 * entered comparable sales). It values machines and says how long a sale takes at an asking price.
 */
export interface UsedPlantPort {
  value(machine: EntityId): UsedPlantValue;
  /** prospective buyers: the mean days between them, and how widely what they would pay spreads around the value (σ of its log); `offers`: one whose limit lies below the ask, by at most `below` of it, offers that limit as a round figure (rounded down to the power of ten not above `round` of the ask), and it stands `days` */
  buyers(machine: EntityId): { meanDays: number; spread: number; offers?: { below: number; days: number; round: number } };
}

/** the depreciation-curve market (economy pack) */
export const UsedPlantCurveSchema = s.object({
  /** share of the new price a machine fetches right after it was first sold */
  firstDrop: s.param('1'),
  /** yearly loss of value */
  annualDecline: s.param('1/a'),
  /** operating hours of typical use a year: more use lowers the value, less raises it */
  hoursPerYear: s.param('h/a'),
  /** value lost per typical year of extra hours (as a share) */
  hoursPenalty: s.param('1'),
  /** the least share of the new price any working machine fetches */
  floor: s.param('1'),
  /** mean days between prospective buyers */
  daysToSell: s.param('d'),
  /** how widely what buyers would pay spreads around the value (σ of its log) */
  spread: s.param('1'),
  /** haggling: a buyer whose limit lies below the ask by at most `below` (a share of it) offers that limit as a round figure (rounded down to the power of ten not above `round` of the ask: tens on a few hundred euros, thousands on tens of thousands), and the offer stands `days` */
  offers: s.object({ below: s.param('1'), days: s.param('d'), round: s.param('1') }).optional(),
});
export type UsedPlantCurve = Infer<typeof UsedPlantCurveSchema>;

/** entered comparable sales (an auction record): prices as a share of the new price */
export const UsedPlantSalesSchema = s.object({
  source: s.any<Source>(),
  /** how widely what buyers would pay spreads around the value (σ of its log) */
  spread: s.param('1'),
  /** haggling, as in the curve's market */
  offers: s.object({ below: s.param('1'), days: s.param('d'), round: s.param('1') }).optional(),
  sales: s.array(s.object({ class: s.string(), ageYears: s.number({ min: 0 }), hours: s.number({ min: 0 }), priceShare: s.number({ min: 0, max: 2 }), daysOnMarket: s.number({ min: 0 }) })),
});
export type UsedPlantSales = Infer<typeof UsedPlantSalesSchema>;

/** A breakdown being repaired by field service. */
export interface RepairJob {
  stage: 'awaitingFitter' | 'fitterTravelling' | 'awaitingParts' | 'repairing';
  brokeAt: number;
  /** hands-on repair hours (drawn at the breakdown) */
  hours: number;
  /** needs ordered parts (a second visit) */
  parts: boolean;
  partsOrdered?: boolean;
  /** fitter visits so far */
  visits: number;
  /** the fitter's van on its way */
  move?: EntityId;
  /** expected time of the next stage change (fitter departure/arrival, parts, end of repair) */
  next?: number;
}

/** A booked low-loader relocation (haulier from outside the map). */
export interface LowLoaderTransport {
  stage: 'booked' | 'approaching' | 'loading' | 'loaded';
  /** the haulier sets off from outside the map */
  pickup: number;
  to: Vec2;
  /** the low-loader's current move */
  move?: EntityId;
  /** expected arrival at the destination */
  eta: number;
  /** who booked it and pays for it */
  payer?: EntityId;
}

/** Equipment module state. */
export interface EquipmentState {
  /** machine → when the next prospective buyer comes (drawn: the world's knowledge, not the players') */
  buyers: Record<EntityId, number>;
  /** machine → low-loader relocation in progress */
  transports: Record<EntityId, LowLoaderTransport>;
  /** machine → scheduled service start (pending service timer) */
  serviceDue: Record<EntityId, number>;
  /** broken down beyond the map and towed on: broken when it is in */
  towed?: Record<EntityId, true>;
  /** broken, mended by its holder: the hours of mending still to do, done only while one of theirs is by it (r38) */
  mending?: Record<EntityId, number>;
  /** a leg's driving already burnt before it is done (`move:leg` → s: up to a station or a tow beyond the map, r38) */
  drove?: Record<string, number>;
  /** a service under way by the dealer's fitter (they leave when it is done) */
  fitterServicing?: Record<EntityId, true>;
  /** fuel on its way to machines (a round): the store it is loaded at (at the end of leg `loadAt`), what it carries of each fuel, and at the end of which leg each machine is filled with its own */
  fuelRuns?: Record<EntityId, { store: EntityId; loadAt: number; load: Record<string, number>; stops: { leg: number; machine: EntityId; material: string; qty: number }[] }>;
  /** machine → breakdown repair in progress */
  repairs: Record<EntityId, RepairJob>;
  /** cumulative statistics */
  totals: { engineHours: number; fuelLitres: number; breakdowns: number; services: number };
  /** generators running: until when (started by one of ours there), and whether said to run idle */
  generating?: Record<EntityId, { since: number; until: number; idle?: boolean }>;
  /** the day a battery was last said to be too cold to take a charge */
  coldSaid?: Record<EntityId, number>;
  /** the units that hold or make power (batteries, panels), kept from their acquiring until they leave the world */
  powered?: EntityId[];
  /** person → the vehicle they ride to work (camp L4): while they are at work it is away with them */
  riders?: Record<EntityId, EntityId>;
  /** machine → until when it is away with the one who rode it to work today */
  out?: Record<EntityId, number>;
}

export interface EquipmentPort {
  model(id: string): MachineModel;
  /** the fuel in a machine's tank (in its fuel's unit) */
  fuel(machine: EntityId): number;
  /** may this party set the machine to work now: its holder, unless it is lent to another; or the one it is lent to */
  usableBy(machine: EntityId, party: EntityId): boolean;
  modelOf(machine: EntityId): MachineModel;
  byClass(cls: MachineClass): EntityId[];
  /** ready for work at t (not broken/servicing/travelling, has fuel) */
  ready(machine: EntityId): boolean;
  /** the vehicle someone rides to work, if any */
  riddenBy(person: EntityId): EntityId | undefined;
  /** away with the one who rides it to work, at work now */
  withRider(machine: EntityId): boolean;
  /** position at time t (interpolated while travelling) */
  positionAt(machine: EntityId, t: number): Vec2;
  /**
   * operating cost per hour excluding operator: fuel at typical load + repair accrual (owned)
   * + owning share (owned, per repairBasisHours) or rental share (rented, per 8 h day)
   */
  hourlyCost(machine: EntityId): number;
  hourlyCostExplain(machine: EntityId): Explained;
  /** all machines, in acquisition order */
  machines(): EntityId[];
  /** how well a tool works now: 1, or less when it needs care (a blunt axe) */
  condition(machine: EntityId): number;
  /** the class of equipment (practice pack) */
  equipmentClass(cls: string): EquipmentClass;
}

declare module '../../kernel/src/index.ts' {
  interface ContributionTypes {
    /** whom a machine is lent to now, if anyone (a loan of it by agreement): they use it, its holder does not meanwhile */
    machineUser: (read: import('../../kernel/src/index.ts').ReadCtx, machine: EntityId) => EntityId | null;
    /** who bears a machine's ordinary upkeep (its services, its month's care) when not its holder: one who borrows it for nothing (a loan for use) */
    machineKeeper: (read: import('../../kernel/src/index.ts').ReadCtx, machine: EntityId) => EntityId | null;
  }
  interface ComponentTypes {
    Machine: Machine;
  }
  interface PortTypes {
    equipment: EquipmentPort;
    usedPlant: UsedPlantPort;
  }
  interface DataTypes {
    equipmentClasses: Record<string, EquipmentClass>;
    machineModels: Record<string, MachineModel>;
    equipmentSettings: EquipmentSettings;
    usedPlantMarket?: UsedPlantCurve;
    usedPlantSales?: Record<string, UsedPlantSales>;
    /** which entered sales the comparables market uses (world definition) */
    usedPlantBinding?: { dataset: string };
  }
  interface EventTypes {
    'equipment.acquired': { machine: EntityId; model: string };
    'equipment.arrived': { machine: EntityId };
    'equipment.brokeDown': { machine: EntityId };
    'equipment.repaired': { machine: EntityId };
    'equipment.serviceStarted': { machine: EntityId; until: number };
    'equipment.serviceDone': { machine: EntityId };
    'equipment.released': { machine: EntityId };
    'equipment.sold': { machine: EntityId; price: number };
    'equipment.legalExposure': { person: EntityId; party: EntityId; what: string; rule: string };
  }
  interface ModuleStateTypes {
    /** state of the equipment module  */
    equipment: EquipmentState;
  }
  interface CommandTypes {
    'equipment.acquire': { payload: { model: string; ownership: 'owned' | 'rented'; pos: Vec2; immediate?: boolean; holder?: EntityId }; result: EntityId };
    'equipment.release': { payload: { machine: EntityId }; result: void };
    'equipment.rideToWork': { payload: { machine: EntityId; person?: EntityId }; result: void };
    'equipment.commuted': { payload: { machine: EntityId; person: EntityId }; result: void };
    'equipment.rideOut': { payload: { machine: EntityId; person: EntityId; until: number }; result: void };
    'equipment.sell': { payload: { machine: EntityId; ask?: number }; result: { ask: number; value: number; expectedDays: number } };
    'equipment.withdrawListing': { payload: { machine: EntityId }; result: void };
    /** report operating hours (load 0..1 scales fuel) — wear, fuel, failures happen here */
    'equipment.logWork': { payload: { machine: EntityId; hours: number; load: number }; result: void };
    'equipment.moveTo': { payload: { machine: EntityId; to: Vec2; by?: EntityId; haulier?: boolean; driver?: EntityId; near?: number }; result: number };
    /** a vehicle wrecked (overturned, crushed): broken for good (internal) */
    'equipment.wreck': { payload: { machine: EntityId; why: string }; result: void };
    /** a vehicle set up as something else where it stands, or packed up again (internal) */
    'equipment.setUp': { payload: { machine: EntityId; on: boolean }; result: void };
    /** one of ours is out on a move someone else made (a car on an errand): not free for work until it is back */
    'equipment.takeOut': { payload: { machine: EntityId; move: EntityId; to: Vec2; until: number }; result: void };
    'equipment.topUp': { payload: { machine: EntityId }; result: { until: number } };
    'equipment.generate': { payload: { machine: EntityId; hours: number }; result: { until: number } };
  }
}
