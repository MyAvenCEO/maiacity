/**
 * Inventory contract: matter in holdings (design/physical-state.md, I1 and I3). A store is a holding: a heap, a
 * depot, a vessel, a machine's tank (riding with it), a work front, what is built into a structure. Matter changes
 * only by a transfer between holdings at the same place, a transform balanced in mass (what is not in its products
 * goes to a named sink: the air, the ground), a bridge from nature (the ground, trees, rain, a creek: only the
 * module that owns that nature may call it), the world's edge (deliveries in, hauls out), and opening stock when a
 * world is made. The module's audit checks every material's balance after every command.
 */
import { s, type EntityId, type Infer, type Source } from '../../kernel/src/index.ts';

/**
 * A quantity whose unit depends on the material (EUR/t, EUR/m3, t, m3 …). Validated by the
 * inventory module at setup against the material's unit and converted to "per material unit".
 */
export interface MaterialQuantity {
  value: number;
  unit: string;
  source?: Source;
  note?: string;
}
const MaterialQuantitySchema = s.any<MaterialQuantity>();
import type { Vec2 } from '../../geo/src/index.ts';

export const MaterialSchema = s.object({
  label: s.string(),
  /** accounting unit of the material */
  unit: s.enum(['t', 'kg', 'm3', 'l', 'pcs', 'kWh']),
  /** loose density for transport */
  density: s.param('t/m3'),
  category: s.enum(['aggregate', 'soil', 'asphalt', 'binder', 'concrete', 'steel', 'timber', 'fuel', 'food', 'water', 'energy', 'other']),
  /** a vessel: how many litres of a water it holds (a bottle); water is carried only in one */
  vessel: s.object({ litres: s.param('l') }).optional(),
  /** food energy per unit (food) */
  energy: s.param('kcal').optional(),
  /** a food eaten only cooked (pasta, rice): the heat into the pot and the water a unit takes (camp L1) */
  cook: s.object({ heat: s.param('kWh'), water: s.param('l') }).optional(),
  /** a capability (camp L1): it cooks with its heat (a camping stove, a grill, a wood stove's top), this share of its heat going into the pot; `only`: for cooking, never left burning to warm a room */
  cooks: s.object({ efficiency: s.param('1'), only: s.boolean().optional() }).optional(),
  /** drinkable water per unit (drinking water, drinks) */
  water: s.param('l').optional(),
  /** water as it comes (a creek, a pond, a roof): expected cases of illness per litre drunk untreated (camp L2) */
  pathogens: s.param('1/l').optional(),
  /** a capability (camp C4): it treats drinking water, removing this share of what makes one ill (a filter, a UV lamp) */
  treats: s.object({ removal: s.param('1') }).optional(),
  /**
   * a capability (camp L3): a toilet. It keeps this share of the illness excreta spread from the camp;
   * one that needs cover (sawdust over each visit) uses so much of it a person a day, and keeps only
   * `without` when there is none
   */
  sanitation: s.object({
    contains: s.param('1'),
    cover: s.object({ material: s.string(), use: s.param('kg/d'), without: s.param('1') }).optional(),
    /** a toilet that collects (a bucket): what it fills with (with its cover) and how much one holds; full, it keeps nothing back until emptied */
    collects: s.object({ material: s.string(), capacity: s.param('kg') }).optional(),
  }).optional(),
  /** a capability (camp L3): it cleans (soap): so much of it a person uses a day of washing (kg) */
  cleans: s.object({ use: s.param('kg/d') }).optional(),
  /** a durable good that keeps the age it has had in use when it is stored (a tent struck): put up again, it is as old as it was */
  keepsAge: s.boolean().optional(),
  /** taken off a structure again (a part taken down): this share of it comes back as it was; the rest as that other good (broken logs as brash, broken bricks as fill), by mass */
  salvage: s.object({ share: s.number({ min: 0, max: 1 }), rest: s.string().optional() }).optional(),
  /** what using it up leaves behind where it was kept (provisions their packaging): so much of that material for each unit used */
  leaves: s.object({ material: s.string(), per: s.number({ min: 0 }) }).optional(),
  /** it seasons where it is kept (green firewood dries): after so many days it is that other material, so much of its mass kept */
  seasons: s.object({ into: s.string(), days: s.param('d'), keeps: s.param('1') }).optional(),
  /** the mass of one piece (goods counted in pieces: a brick, a pipe) */
  pieceMass: s.param('kg').optional(),
  /**
   * a capability (camp C4): what it keeps warm. A sleeping bag's comfort temperature (EN ISO 23537-1,
   * the coldest night a person sleeps comfortably in it on a good mat), a mat's thermal resistance (R,
   * ASTM F3340). Behaviour follows from these numbers, never from what the good is called (0009).
   */
  insulation: s.object({ comfort: s.param('°C').optional(), rValue: s.param('m2·K/W').optional() }).optional(),
  /**
   * a capability (camp C4): it gives heat by burning a fuel (a material of the store, so much an hour);
   * with a flue its fumes go outside, without one the carbon monoxide it makes stays in the room
   */
  heat: s.object({ output: s.param('kW'), fuel: s.string(), use: s.param('kg/h').optional(), draw: s.param('kW').optional(), flue: s.boolean(), co: s.param('g/h') }).optional(),
  /** a light one carries (a headlamp, a torch: S7): what it gives; one who goes on foot at night with it sees the ground */
  light: s.object({ output: s.param('lm') }).optional(),
  /** what of its mass burns in a fire, and what of that is left as ash (as `ashAs`, else fire debris); absent: it does not burn */
  burns: s.object({ share: s.param('1'), ash: s.param('1'), ashAs: s.string().optional() }).optional(),
  /** hot-mix asphalt / ready-mix concrete must be placed within this time after it is batched (at the plant) */
  perishableHours: s.param('h').optional(),
  /** kept past its time (`perishableHours`, from batching) it is this other good, by mass: set concrete, cooled hot mix (G7) */
  perishesInto: s.string().optional(),
  color: s.string().optional(),
});
export type Material = Infer<typeof MaterialSchema>;

/** a material counted in pieces (a brick, a tent's pack piece): drawn, carried and built in whole pieces */
export const isCounted = (m: Pick<Material, 'unit'>): boolean => m.unit === 'pcs';

/** the mass of one unit of a material (kg); a piece good states its piece mass (checked at setup, never guessed) */
export function unitMass(mat: Material): number {
  switch (mat.unit) {
    case 'kg':
      return 1;
    case 't':
      return 1000;
    case 'l':
      return mat.density.value; // t/m3 = kg/l
    case 'm3':
      return mat.density.value * 1000;
    case 'pcs':
      if (!mat.pieceMass) throw new Error(`${mat.label}: a good counted in pieces needs its piece mass`);
      return mat.pieceMass.value;
    // (energy has no mass: it is held in a battery and goes along a cable, never loaded as goods)
    case 'kWh':
      return 0;
  }
}

/** what a heater or a cooker uses an hour, in its fuel's own unit: its draw (kWh an hour) on electricity, else its use in kg over its fuel's mass a unit */
export function perHourOf(heat: NonNullable<Material['heat']>, fuel: Material): number {
  if (heat.draw) return heat.draw.value;
  if (!heat.use) throw new Error(`a heat source on ${fuel.label} says neither its use (kg/h) nor its draw (kW)`);
  return heat.use.value / Math.max(1e-12, unitMass(fuel));
}

/** energy (electricity): held in batteries, conducted along a cable within reach or carried in a battery, never loaded as goods */
export const isConducted = (m: Pick<Material, 'unit'>): boolean => m.unit === 'kWh';

export const SupplierSchema = s.object({
  label: s.string(),
  /** a buyer pays its price for what it collects (a sawmill buying logs at the roadside) */
  kind: s.enum(['quarry', 'asphaltPlant', 'concretePlant', 'merchant', 'disposalSite', 'buyer']),
  /** distance from the way into the map it comes by (km) */
  distance: s.param('km'),
  /** the way into the map it comes by (an access id); absent: the first one its vehicle can use */
  access: s.string().optional(),
  /** a supplier on the map itself (a farm, a neighbour's yard): its trucks start here, no way in needed */
  pos: s.point().optional(),
  /** a shop in a town a bus line goes to (its id, the network's transit lines): the walk from the town's stop to it */
  transit: s.object({ line: s.string(), walk: s.param('min') }).optional(),
  /** vehicle profile used for deliveries */
  /** how many of its vehicles it sends to one customer at once (its fleet for us): more loads wait for one back */
  fleet: s.param('1'),
  vehicleProfile: s.string(),
  /**
   * what its price includes, as in the trade (decision 0026 A3): `site` (frei Baustelle) the lorry drives
   * onto the site as far as it can; `kerb` (frei Bordsteinkante) it stops on the way nearest the store,
   * and carrying it in is ours; `collect` (ab Werk) it does not deliver, it is fetched. Default `site`.
   */
  delivery: s.enum(['site', 'kerb', 'collect']).optional(),
  /**
   * how it hands goods over (realism S5): `attended` to one of ours at the drop point (its driver rings when there and
   * waits `failed.wait` for someone to come; nobody: the goods go back, `failed.fee` is charged, and it comes again on
   * its next loading day, the order called off after `failed.attempts`); `drop` set down there, received or not (a
   * standing consent, an Abstellgenehmigung). Default `drop`; an order may say otherwise.
   */
  handover: s.enum(['attended', 'drop']).optional(),
  failed: s.object({ fee: s.param('EUR'), wait: s.param('min'), attempts: s.int({ min: 1 }) }).optional(),
  /** an attended delivery's driver rings this long before he is at the drop point, so that one of ours can be there (S5b) */
  ringsAhead: s.param('min').optional(),
  /**
   * how often its lorry comes when it said (stock on the way is not in our hands): on time in the share
   * `onTime` of deliveries, else late by about `late` hours (drawn when the lorry is due, never before)
   */
  punctuality: s.object({ onTime: s.param('1'), late: s.param('h') }).optional(),
  /** the days its counter is open (calendar weekdays, 0 Monday .. 6 Sunday); none said: the usual week's (`supplierWeek.counter`) */
  openDays: s.array(s.int({ min: 0, max: 6 })).optional(),
  /** opening: deliveries only within these hours */
  openFrom: s.param('h'),
  openTo: s.param('h'),
  offers: s.record(
    s.object({
      /** price delivered to site, e.g. {value: 14.5, unit: 'EUR/t'} — must be convertible to EUR per material unit */
      price: MaterialQuantitySchema,
      leadTime: s.param('d'),
      /** minimum order, e.g. {value: 25, unit: 't'} */
      minOrder: MaterialQuantitySchema,
      /**
       * a buyer of used goods (of a good that keeps its age): `price` is for one as good as new; it pays
       * less by the share of its `life` (years in use) it has had, never less than `floor` of it
       */
      byAge: s.object({ life: s.param('a'), floor: s.param('1') }).optional(),
      /**
       * what it has (design/physical-state.md 8c, finding 18: the outside world is finite): `held` at most, made or
       * restocked at `perDay` over its working hours; held 0: made to order at that rate (a plant mixes each load as the
       * lorry before is loaded). Absent: as much as wanted
       */
      stock: s.object({ held: MaterialQuantitySchema, perDay: MaterialQuantitySchema }).optional(),
    }),
  ),
});
export type Supplier = Infer<typeof SupplierSchema>;

/** what a store is: a depot or heap of ours, a site store, a machine's tank, the goods at a work front, what is built into a work */
/** `transit`: a flow's loads on the road (a haul's trucks between its front and its heap) */
/** `carried`: what a person carries (a backpack, the pockets), riding `on` them (design/physical-state.md 8b) */
export type StoreKind = 'depot' | 'stockpile' | 'site' | 'tank' | 'front' | 'built' | 'transit' | 'carried' | 'battery';

/** where matter goes when it is used up and not into a good: the air (burnt, breathed, dried off), the ground (poured out, seeped in) */
export type Sink = 'air' | 'ground';

/**
 * Goods moved between two holdings not at the same place by an aggregate carrier the work itself reckons (its rate
 * includes the carrying or the haul): declared here, one by one, until moves carry them (design/physical-state.md,
 * slices 4 and 5). 'passed at the toilet': what one drank, passed at a toilet a few steps from where they drank it (S1b).
 */
export type Via = 'carried by the work' | 'hauled by the work' | 'carried in cans' | 'passed at the toilet';

/** where the nature a bridge draws from belongs: only that module may call it */
export type Nature = 'ground' | 'trees' | 'rain' | 'water' | 'sun';

export interface Store {
  /** the party that holds it and pays for what is delivered into it (decision 0025) */
  holder: EntityId;
  label: string;
  kind: StoreKind;
  /**
   * where it is: fixed, or (riding) where it was made; a riding holding's place is its unit's, derived on read
   * (the holdings port's `where`, what is shown of it too): never read this of a riding one, and outside inventory
   * nothing reads it (robustness step 6, S504)
   */
  pos: Vec2;
  /** it rides with this unit (a machine's tank): it is where the unit is */
  on?: EntityId;
  /** what it holds at most, in its one good's unit (a barrel's litres, a tank's litres) */
  capacity?: number;
  /** a battery: the most it gives (kW) */
  rate?: number;
  /** a work front's goods, or what is built into a work: the work (a structure, a road, a project); its fronts and what is built in are at the same place */
  work?: EntityId;
  /** material id → quantity in the material's unit */
  contents: Record<string, number>;
  /** goods set down here short of the store they are meant for (a delivery that could not get there) */
  for?: EntityId;
  /** a vessel for these goods only (a rain barrel): nothing else is ordered or put into it */
  holds?: string[];
  /**
   * how it is laid out (decision 0026 A3, the site layout as a plan): goods stacked in the order they will be
   * used, each in its place. Without one it is a heap, and every trip from it is slower by what is in the
   * way. A good put in that has no place in the layout makes it a heap again.
   */
  layout?: { order: string[]; at: number };
}

export interface Order {
  supplier: string;
  material: string;
  store: EntityId;
  qty: number;
  delivered: number;
  /** an outbound order's lorries on their way to load it (still ours, claimed, until they have) */
  collecting?: number;
  /** when its first load is expected, as its supplier's lorries are booked (later than `earliest` when they are busy: S420) */
  expected?: number;
  inTransit: number;
  status: 'open' | 'complete' | 'cancelled';
  orderedAt: number;
  /** first delivery not before */
  earliest: number;
  unitPrice: number;
  /** bought at a counter and carried home: paid, and in the carrier's hands (it cannot be cancelled) */
  carried?: boolean;
  /**
   * 'inbound' (default): purchase delivered from `supplier` into `store`;
   * 'outbound': haul-off from `store` to the disposal site `supplier` (`delivered` = quantity tipped there)
   */
  /** an outbound haul that is a sale: the buyer pays its price as it collects */
  sale?: boolean;
  /** a sale: the lots set aside (when they began to season, their age in use), to come back as they were if it is called off */
  parts?: { qty: number; since: number; age?: number }[];
  direction?: 'inbound' | 'outbound';
  /** how it is handed over (S5): attended, or set down by our consent; none said: the supplier's way */
  handover?: 'attended' | 'drop';
  /** deliveries that found nobody of ours to take them (S5) */
  failures?: number;
  /**
   * when its loads not yet on the road are booked to arrive (robustness step 4: what `expected`, on the way and overdue
   * say); a haul's, when its collector's lorries come to load. Its supplier's loading calendar is read from these
   * (`bookedOf`): a load called off, gone on another lorry or no longer to come holds no time at the yard (review x)
   */
  loads?: number[];
  /** what goes with a load still to come, by its booked arrival in `loads` (kept only as long as that load is): its try after one nobody came for, its lorry drawn late at the yard (review x) */
  loadInfo?: { slot: number; attempt?: number; late?: boolean }[];
}

/** one order's goods on a supplier's lorry (S5b): every order a lorry carries is a load of its own, with its own try (review x) */
export interface LorryLoad {
  order: EntityId;
  material: string;
  qty: number;
  attempt: number;
}

/** Normalised supplier offer: prices in EUR per material unit (epoch price level), quantities in material units. */
export interface NormalizedOffer {
  supplier: string;
  price: number;
  leadTimeDays: number;
  minOrder: number;
  /** a buyer of used goods: what it pays falls with the age in use (life in years, as ages are kept; floor: the least share of `price`) */
  byAge?: { life: number; floor: number };
  /** what it has, in the material's unit: at most `held`, made or restocked at `perDay` (absent: as much as wanted) */
  stock?: { held: number; perDay: number };
}

/**
 * A material's books (design/physical-state.md, I1): Σ stores + transit = stocked + delivered + extracted + made −
 * used − released − disposed, at every instant.
 */
/**
 * What a roadside is to goods left there (S5b, audit G1): a heap in the open that a van stopping on a way can load from
 * (within the handling reach of one), whoever's and however it got there, a night with nobody of its holder by it
 * (within `watch`), has a chance to be taken, by its worth (`perNight` for a lot worth `worth` or more, less for less),
 * as much as a thief carries off in a van (`load`), the dearest by weight first; only goods worth taking by their
 * weight (`dear`)
 */
export const RoadsideSchema = s.object({ perNight: s.param('1'), worth: s.param('EUR'), load: s.param('kg'), watch: s.param('m'), dear: s.param('EUR/kg') });

export type Roadside = Infer<typeof RoadsideSchema>;

/**
 * The suppliers' usual week here (practice, design/modular-split.md §5.3 item 2): the days their lorries are loaded, and
 * the days a counter is open where a supplier says none (calendar weekdays, 0 Monday .. 6 Sunday). On a public holiday
 * neither loads nor sells.
 */
export const SupplierWeekSchema = s.object({ loading: s.array(s.int({ min: 0, max: 6 })), counter: s.array(s.int({ min: 0, max: 6 })) });

export type SupplierWeek = Infer<typeof SupplierWeekSchema>;

export interface MaterialFlows {
  /** what a world began with (opening stock, its definition) */
  stocked: number;
  /** come in over the world's edge (deliveries, counter purchases, a machine's first tank) */
  delivered: number;
  /** drawn from nature on the map (the ground dug, trees felled, rain caught, a creek drawn) */
  extracted: number;
  /** made by a transform (seasoned wood, packaging left, excreta) */
  made: number;
  /** used by a transform */
  used: number;
  /** gone to a sink (the air, the ground) */
  released: number;
  /** gone over the world's edge (sold, disposed, a machine handed back with its tank) */
  disposed: number;
  /** on its way between stores of ours (loaded, not yet unloaded) */
  transit: number;
}

/** Inventory module state. */
export interface InventoryState {
  /** supplier|material → what it had (`qty`) at `at`, and the takes booked from then on (loads at their slots, by order): it fills up at its rate over its working hours */
  stocks?: Record<string, { qty: number; at: number; takes: { t: number; qty: number; order?: string }[] }>;
  /** material → its books (Σ stores + transit = stocked + delivered + extracted + made − used − released − disposed) */
  flows: Record<string, MaterialFlows>;
  /** the open orders, in the order they were made: kept where an order is written, the one population of orders that can still come, be late or hold the yard (decision 0025: never every order ever made; review y) */
  open?: EntityId[];
  /** what has gone to each sink, by mass (kg) */
  sinks?: Partial<Record<Sink, number>>;
  /** store|material → what of a seasoning or perishable good lies there since when (oldest first; a perishable's since its batching) */
  /** age: of a good that keeps its age, the years it has had in use */
  seasoning?: Record<string, { qty: number; since: number; age?: number }[]>;
  /** our goods a carrier comes to load (a hired van's move): claimed in their store until it is there to take them (r37) */
  pickups?: Record<string, { store: EntityId; material: string; qty: number; leg: number }>;
  /** our goods a carrier has taken on at a pickup, as they were (their age and lots): what it brings in or sets down (r38) */
  aboard?: Record<string, { material: string; qty: number } & Lots>;
  /**
   * lorries at a drop point waiting for one of ours to take their goods (S5), by move: the loads still to hand over,
   * where they stand, until when they wait, the way back beyond the map they came by, and the one of ours held to meet
   * them (let go when the handover is done, whatever its outcome)
   */
  handovers?: Record<string, { loads: LorryLoad[]; at: Vec2; until: number; profile: string; fleet: string; home: Vec2; node?: EntityId; beyondKm?: number; meeter?: EntityId; back?: Vec2 }>;
  /** a delivery lorry on its way, by move: whether it left to hand over to one of ours (it waits at the drop point), every order's load on it, and the one of ours set out to meet it (review S5 #3, #4; review x) */
  lorries?: Record<string, { attended: boolean; loads: LorryLoad[]; coming?: { person: EntityId; at: number; from: [number, number] } }>;
}

/**
 * What to look for among a party's holdings (design/modular-split.md §4.1, `ofParty`): all of them in the order they
 * were made, unless asked otherwise
 */
export interface HoldingQuery {
  /** of this kind (or these kinds) only */
  kind?: StoreKind | readonly StoreKind[];
  /** riding on a unit (true), or standing somewhere of its own (false) */
  riding?: boolean;
  /** where it keeps goods: standing somewhere of its own (riding on no unit), and no work's front or what is built into one */
  kept?: boolean;
  /** a store for any goods: no vessel for some goods only (a rain barrel) */
  general?: boolean;
  /** holding some of this material */
  has?: string;
  /** taking this material in (a vessel only its own goods) */
  accepts?: string;
  /** nearest this point first (ties by id), each where it is now (`where`) */
  near?: Vec2;
  /** only those within this distance of `near` (m) */
  within?: number;
  /** not this one */
  except?: EntityId;
}

/**
 * The holdings port (design/modular-split.md §4.1, P2): every question other modules ask of a holding, never the
 * holding itself. Inventory provides it until holdings is a package of its own (stage 1b).
 */
export interface HoldingsPort {
  material(id: string): Material;
  /** changes whenever any holding changes (for memos) */
  revision(): number;
  exists(store: EntityId): boolean;
  label(store: EntityId): string | undefined;
  kind(store: EntityId): StoreKind | undefined;
  /** the party that holds it */
  holder(store: EntityId): EntityId | undefined;
  /** who uses a holding: its holder, or for one riding on a unit lent out, its borrower */
  userOf(store: EntityId): EntityId | undefined;
  /** where it is now (a riding one: where its unit is): the one way to ask (robustness step 6, S504) */
  where(store: EntityId): Vec2 | undefined;
  /** whether it is within so far of a point (m), where it is now */
  near(store: EntityId, point: Vec2, within: number): boolean;
  /** whether two holdings are at the same place (within the handling reach) */
  together(a: EntityId, b: EntityId): boolean;
  /** how much of a good is in it */
  stock(store: EntityId, material: string): number;
  /** what of a good in it is free to take: not claimed by a sale or a haul waiting for its lorry */
  free(store: EntityId, material: string): number;
  /**
   * what of a good can be drawn at it: its own stock; for energy, what the batteries of its holder within reach hold
   * (along a cable), only those whose output carries the device's draw (kW, if said)
   */
  supply(store: EntityId, material: string, draw?: number): number;
  /** everything in it: material → quantity in the material's unit (none: empty) */
  contents(store: EntityId): Readonly<Record<string, number>>;
  /** what its goods weigh (kg) */
  mass(store: EntityId): number;
  /** whether it takes a good in: a vessel only its own goods */
  accepts(store: EntityId, material: string): boolean;
  /** the goods it is a vessel for (a rain barrel, a compost heap), if it is one */
  holds(store: EntityId): readonly string[] | undefined;
  /** whether it is laid out, each good in its place (else a heap, where what else lies there is in the way) */
  laidOut(store: EntityId): boolean;
  /** the work a front's goods or what is built in are of */
  work(store: EntityId): EntityId | undefined;
  /** what is built into a work (its holdings of built material): material → quantity */
  builtInto(work: EntityId): Record<string, number>;
  /** the oldest age in use (years) of the goods kept by their age in a holding (a kit's parts); 0 if none */
  ageIn(store: EntityId | undefined): number;
  /** when the lots of a good in a holding began to season, on average (undefined: not a good kept by lots) */
  sinceIn(store: EntityId, material: string): number | undefined;
  /** what still uses a holding (one fact, decision 0028): asked before it is given up or closed; none, it may go */
  usesOf(store: EntityId): StoreUse[];
  /** a party's holdings (an index, never a scan of every holding: decision 0028 rule 4) */
  ofParty(party: EntityId, q?: HoldingQuery): EntityId[];
  /** what a person carries (the holding riding on them), if anything */
  carriedBy(person: EntityId): EntityId | undefined;
  /**
   * what is at hand for one at a point: what rides on them (what they carry), and the holdings their party keeps within
   * so far of the point, in the order they were made
   */
  atHand(person: EntityId, party: EntityId, at: Vec2, within: number): EntityId[];
  /** the holdings riding on a unit (a machine's tank and battery, what a person carries) */
  ridingOn(unit: EntityId): EntityId[];
  /** the goods set down short of a holding, for it (a delivery that could not get there) */
  setDownFor(store: EntityId): EntityId[];
  /** the holding the goods set down here are meant for, if they were set down short of it */
  meantFor(store: EntityId): EntityId | undefined;
  /** a work's holdings (of a kind: the goods at its front, what is built into it, its loads on the road), in the order they were made */
  ofWork(work: EntityId, kind?: StoreKind): EntityId[];
}

/** what others may know of an order (design/modular-split.md §4.1, the trade port): never the order itself */
export interface OrderView {
  store: EntityId;
  material: string;
  status: Order['status'];
  qty: number;
  delivered: number;
  direction: 'inbound' | 'outbound';
  /** when its first load is expected */
  expected?: number;
}

/**
 * The trade port (design/modular-split.md §4.1): orders, suppliers and buyers. Inventory provides it until trade is a
 * package of its own (stage 1b).
 */
export interface TradePort {
  /** who sells a material, at today's price, sorted by price; `delivers`: their trucks can reach the map */
  offers(material: string): { supplier: string; supplierLabel: string; price: number; leadTimeDays: number; minOrder: number; delivers: boolean }[];
  /** can whoever takes this good away (a disposal site's or a buyer's vehicle) get to the store and back out */
  collectable(store: EntityId, material: string): boolean;
  order(id: EntityId): OrderView | undefined;
  isOpen(id: EntityId): boolean;
  /** open orders for store+material: remaining quantity not yet delivered, and our own goods on their way to it from another store */
  onOrder(store: EntityId, material: string): number;
  /** the earliest any open order of a good for a store may come (its first delivery not before), if one is open */
  firstDue(store: EntityId, material: string): number | undefined;
  /** the open orders (inbound and outbound), of a party's (the holder of the store they are for), a store or a good, in the order they were made */
  openOrders(f?: { party?: EntityId; store?: EntityId; material?: string }): EntityId[];
}

/** something that still uses a store: `by` (an order, a work, a person) and why; `holdFor`: the store may be held for it (it ends with it) */
export type StoreUse = { by: EntityId; why: string; holdFor?: boolean };

export type Part = { qty: number; since: number; age?: number };
/** the lots of a good moved: when they began to season and their age in use (on average, and lot by lot) */
export type Lots = { since?: number; age?: number; parts?: Part[] };

declare module '../../kernel/src/index.ts' {
  interface ContributionTypes {
    /** other ways than an order to get a material into a store (someone fetching it on foot …), as remedies a holder can take */
    provision: (read: import('../../kernel/src/index.ts').ReadCtx, store: EntityId, material: string, qty: number) => import('../../kernel/src/index.ts').Remedy[];
    /** who uses the holdings riding on a unit when not their holder (a machine lent: its borrower draws on its battery) */
    holdingUser: (read: import('../../kernel/src/index.ts').ReadCtx, unit: EntityId) => EntityId | null;
    /**
     * what of a module's still uses a store (work that puts its goods there, someone who lives there): a store is not
     * given up or closed from under it (decision 0028: what depends on something is asked before it ends)
     */
    storeUses: (read: import('../../kernel/src/index.ts').ReadCtx, store: EntityId) => StoreUse[];
  }
  interface ComponentTypes {
    Store: Store;
    Order: Order;
  }
  interface PortTypes {
    holdings: HoldingsPort;
    trade: TradePort;
  }
  interface ModuleStateTypes {
    inventory: InventoryState;
  }
  interface DataTypes {
    materials: Record<string, Material>;
    suppliers: Record<string, Supplier>;
    supplierWeek: SupplierWeek;
    roadside?: Roadside;
  }
  interface EventTypes {
    'inventory.delivered': { order: EntityId; store: EntityId; material: string; qty: number };
    'inventory.orderComplete': { order: EntityId };
  }
  interface CommandTypes {
    'inventory.createStore': { payload: { holder: EntityId; label: string; kind: StoreKind; pos: Vec2; holds?: string[]; on?: EntityId; capacity?: number; rate?: number; work?: EntityId }; result: EntityId };
    'inventory.order': { payload: { material: string; qty: number; store: EntityId; supplier?: string }; result: EntityId };
    'inventory.cancelOrder': { payload: { order: EntityId }; result: void };
    /** goods from one holding into another at the same place (or by a declared aggregate carrier, `via`); result: the lots moved */
    'inventory.transfer': { payload: { from: EntityId; to: EntityId; material: string; qty: number; via?: Via; why?: string; age?: number; work?: EntityId }; result: Lots };
    /** goods used up at a holding into others (a meal, a seasoning, a mix), balanced in mass: what is in no product goes to `sink` */
    'inventory.transform': { payload: { at: EntityId; take: { material: string; qty: number }[]; give: { material: string; qty: number; into?: EntityId; since?: number }[]; sink?: Sink; ground?: number; why: string }; result: Lots };
    /** goods used up into a sink, whole (burnt, poured out, eaten to nothing but air and water); what using it up leaves (its packaging) stays */
    'inventory.release': { payload: { from: EntityId; material: string; qty: number; to: Sink; why: string; usedUp?: boolean }; result: Lots };
    'inventory.draw': { payload: { at: EntityId; material: string; qty: number; to: Sink; why: string; draw?: number; usedUp?: boolean }; result: number };
    /** goods drawn from nature on the map into a holding: only the module whose nature it is may call it */
    'inventory.extract': { payload: { from: Nature; into: EntityId; material: string; qty: number; why: string; since?: number; age?: number; parts?: Part[] }; result: void };
    /** goods loaded onto a carrier (they arrive in another store with its move): in transit meanwhile */
    'inventory.load': { payload: { store: EntityId; material: string; qty: number }; result: Lots };
    'inventory.unload': { payload: { store: EntityId; material: string; qty: number }; result: void };
    'inventory.pickup': { payload: { move: EntityId; store: EntityId; material: string; qty: number; leg: number }; result: void };
    /** goods over the world's edge, in or out (a dealer's first tank, a firm's site supplies, a machine handed back with its tank) */
    'inventory.fromOutside': { payload: { into: EntityId; material: string; qty: number; why: string }; result: void };
    'inventory.toOutside': { payload: { from: EntityId; material: string; qty: number; why: string }; result: Lots };
    /** the world's definition: goods it begins with, given (tests and world setup only) */
    /** a holding no longer needed (a machine's tank when it is gone): only an empty one */
    'inventory.closeStore': { payload: { store: EntityId }; result: void };
    /** a holding that exists for something (a felling's heap for the felling, decision 0028): it ends with it, closed when empty, else kept as a store of its holder */
    'inventory.holdFor': { payload: { store: EntityId; for: EntityId }; result: void };
    'inventory.takeAlong': { payload: { unit: EntityId; at: Vec2 }; result: void };
    'inventory.genesis': { payload: { store: EntityId; material: string; qty: number; why: string }; result: void };
    'inventory.remove': { payload: { store: EntityId; material: string; qty: number; why: string }; result: void };
    /** bought at a supplier's counter and carried home (an errand): paid now, in the store when the carrier is back */
    'inventory.buyAtCounter': { payload: { store: EntityId; material: string; qty: number; supplier: string; arrives: number; carrier: string }; result: { order: EntityId; cost: number } };
    /** bought at a counter beyond the map into what one carries there, by one who is there (living: shopping on the way home) */
    'inventory.buyBeyond': { payload: { into: EntityId; material: string; qty: number; supplier: string; carrier: string }; result: { cost: number } };
    /** haul material to an external disposal site (cost + truck trips) */
    /** sell goods of a store to a buyer who collects them (paid as each lorry is loaded) */
    'inventory.sell': { payload: { store: EntityId; material: string; qty: number; buyer?: string; party?: EntityId }; result: EntityId };
    'inventory.dispose': { payload: { store: EntityId; material: string; qty: number }; result: EntityId };
    /** scenario setup: opening stock already on site, paid at the best offer price */
    'inventory.stock': { payload: { store: EntityId; material: string; qty: number }; result: void };
    /** a store laid out (the work of laying it out is done): its goods in this order, each in its place */
    'inventory.setLayout': { payload: { store: EntityId; order: string[] }; result: void };
  }
}
