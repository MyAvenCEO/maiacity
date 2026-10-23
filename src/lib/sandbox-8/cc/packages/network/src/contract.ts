/**
 * Network, traffic and moves contracts.
 *
 *  - `network` owns the graph (nodes/edges). Domain packs (roads, later pipes/cables) create
 *    edges through commands and keep their attributes (open, surface, speed factor) current.
 *  - `traffic` accumulates loads per edge (vehicles, ESAL = equivalent 10-t axle passes) from
 *    any source (moves, haul cycles, future residents via the `traffic-sources` extension
 *    point). Road deterioration reads it.
 *  - `moves` carries loads (goods, machines and vehicles, people) along legs, each leg on a carrier
 *    (decision 0026 part A): it is what makes lorries, vans and machines on the way exist in time
 *    and space (rendering, traffic, arrival events). A carrier is also a load: a low-loader carries
 *    an excavator, a transporter a car.
 */
import { s, type EntityId, type Explained, type Infer } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';

export const VehicleProfileSchema = s.object({
  label: s.string(),
  /** speed on an open road of the best surface */
  maxSpeed: s.param('km/h'),
  /** speed when off the network (site tracks, fields) */
  offroadSpeed: s.param('km/h'),
  /** how far it goes off the ways, across fields and rough ground, to where it is going (absent: the network's default) */
  offroadReach: s.param('m').optional(),
  /** speed per surface type ('asphalt', 'gravel', 'earth', 'path', 'external' …): a surface it has no speed for, it cannot use */
  surfaceSpeed: s.record(s.param('km/h')),
  /** axle loads when loaded / empty (t per axle) — ESAL derive from the 4th-power law */
  axleLoadsLoaded: s.series('t'),
  axleLoadsEmpty: s.series('t'),
  /** how deep a water it goes through off the road (a ford, a flooded field); absent: none (design/physical-state.md, traversability) */
  wading: s.param('m').optional(),
  /**
   * how the ground off the ways bears and slows it (design/realism-plan.md S3, audit E1/E2): its width among trees (a
   * trunk nearer the line than half of it bars the way, but to one who walks), the steepest ground it climbs, its pace
   * as a share of its off-road speed on ground of each trafficability (dry and firm, softened, soaked; 0: it does not go
   * there) and among trees; absent: the off-road speed everywhere it can wade
   */
  ground: s.object({ width: s.param('m'), maxGrade: s.param('1'), slope: s.param('1').optional(), good: s.param('1'), reduced: s.param('1'), none: s.param('1'), woods: s.param('1') }).optional(),
  /** it walks (a person, a pushed bicycle): the slope sets its pace by Tobler's hiking function, and it passes between trees */
  walks: s.boolean().optional(),
  /** off the ways in less light than `below` (S7): its off-road pace is `pace` of the day's; with a light carried, `lit` (one who walks) */
  dark: s.object({ below: s.param('lx'), pace: s.param('1'), lit: s.param('1').optional() }).optional(),
  /** payload capacity, if it carries cargo */
  payload: s.param('t').optional(),
  payloadVolume: s.param('m3').optional(),
  /** can it use the external (public) road connection? */
  roadLegal: s.boolean(),
  /** its pace loaded, as a share of its speed empty (a loaded tipper climbs and brakes slower) */
  loadedSpeed: s.param('1').optional(),
  /**
   * how it unloads itself at the end of a move (decision 0026 A2): tipping, its loader crane, its
   * pump, discharging, the driver by hand, driving off a ramp. A set-up time and a time per tonne.
   * Without it, the carrier cannot unload itself (the receiver's hands or machines must: A3).
   */
  unloading: s.object({ kind: s.enum(['tip', 'crane', 'pump', 'discharge', 'hand', 'driveOff']), fixed: s.param('s'), perTonne: s.param('s/t').optional() }).optional(),
  /**
   * what can stop it on the way (stock on the way is not in our hands): it breaks down at random, on
   * average once in `mtbf` hours under way, and then stands for about `standstill` hours until it goes
   * on (repaired at the roadside, or the load taken over). Drawn for a firm's vehicle on a move; our
   * own machines break down by their own records (equipment).
   */
  breakdown: s.object({ mtbf: s.param('h'), standstill: s.param('h') }).optional(),
});
export type VehicleProfile = Infer<typeof VehicleProfileSchema>;

/** the kinds of day a timetable has its departures by */
export const TIMETABLE_DAYS = ['weekday', 'saturday', 'sunday'] as const;
export type TimetableDay = (typeof TIMETABLE_DAYS)[number];

export const NetworkSettingsSchema = s.object({
  /** reference axle load for ESAL (Germany: 10 t) */
  referenceAxleLoad: s.param('t'),
  /** exponent of the load-equivalence law (AASHO: 4) */
  loadEquivalenceExponent: s.param('1'),
  /** endpoints closer than this snap to existing nodes/edges */
  snapDistance: s.param('m'),
  /** how near a unit must be to where its leg starts, and a leg to where the one before ended (a few steps) */
  atPlace: s.param('m'),
  /** beyond the map, a vehicle of ours broken down is towed on (a recovery service), one run dry fills up at a station: how long it stands */
  recovery: s.object({ towed: s.param('h'), refuel: s.param('h') }),
  /**
   * which of a timetable's kinds of day each calendar weekday runs as (0 Monday .. 6 Sunday), and what a public holiday
   * runs as (practice, design/modular-split.md §5.3 item 2); a weekday without one has no departures
   */
  timetableDays: s.object({ week: s.array(s.enum(TIMETABLE_DAYS)), holiday: s.enum(TIMETABLE_DAYS) }),
});
export type NetworkSettings = Infer<typeof NetworkSettingsSchema>;

export interface NetNode {
  pos: Vec2;
  /** set when this node connects to the world outside the map: how far, and on what (a public road 'external', a footpath 'path') */
  external?: { label: string; distanceKm: number; surface?: string };
}

/** the modes a world is reached by */
export const ACCESS_MODES = ['road', 'track', 'footpath', 'rail', 'river'] as const;

/** a way into the map (region data): where it enters, what it is on the map and beyond */
/** departures by the kind of day, as hours of the day (7.25 = 07:15) */
const DeparturesSchema = s.object({ weekday: s.array(s.number({ min: 0, max: 24 })), saturday: s.array(s.number({ min: 0, max: 24 })), sunday: s.array(s.number({ min: 0, max: 24 })) });

/**
 * A public transport line (region data, A4): it stops where one of the map's ways in reaches the
 * public road and runs to town (where the employers beyond the map are) in so many minutes, by its
 * timetable each way. Its fare is the economy pack's (transitFares).
 */
export const TransitLineSchema = s.object({
  label: s.string(),
  /** the way in whose road it stops on (where it leaves the map) */
  access: s.string(),
  minutes: s.param('min'),
  toTown: DeparturesSchema,
  fromTown: DeparturesSchema,
  source: s.any().optional(),
});
export type TransitLine = Infer<typeof TransitLineSchema>;

/** the fare of a line, one way (economy pack) */
export const TransitFareSchema = s.object({ single: s.param('EUR') });

export const AccessSchema = s.object({
  label: s.string(),
  mode: s.enum(ACCESS_MODES),
  side: s.enum(['west', 'east', 'north', 'south']),
  /** position along that side, −0.5..0.5 */
  offset: s.number({ min: -0.5, max: 0.5 }),
  /** how far it runs into the map */
  length: s.param('m'),
  /** its surface on the map ('asphalt', 'gravel', 'earth', 'path', 'rail', 'water'): who can use it follows from the vehicle profiles */
  surface: s.string(),
  width: s.param('m'),
  speedLimit: s.param('km/h'),
  /** beyond the map: the distance to the places it leads to (a town and its suppliers), and on what */
  externalDistance: s.param('km'),
  outside: s.string(),
});
export type Access = Infer<typeof AccessSchema>;

/** an access laid down: its node at the edge and its edges on the map */
export interface ResolvedAccess {
  id: string;
  label: string;
  mode: (typeof ACCESS_MODES)[number];
  point: Vec2;
  /** unit vector pointing into the map */
  inward: Vec2;
  /** where it ends on the map */
  end: Vec2;
  points: Vec2[];
  node: EntityId;
  edges: EntityId[];
  width: number;
}

export interface NetEdge {
  a: EntityId;
  b: EntityId;
  mode: 'road';
  /** polyline from node a to node b */
  geometry: Vec2[];
  length: number;
  /** usable by traffic (a planned or unfinished road is not open) */
  open: boolean;
  /** 'asphalt' | 'gravel' | 'earth' | 'external' | ... */
  surface: string;
  /** m */
  width: number;
  /** km/h */
  speedLimit: number;
  /**
   * 0..1 speed multiplier from condition (roughness, potholes) set by the owning asset:
   * 1 = sound surface, 0.5 = half speed. Floored at 0.05 when routing.
   */
  speedFactor: number;
  /** entity of the asset that realizes this edge (e.g. a road) */
  asset?: EntityId;
  label?: string;
}

export interface RouteStretch {
  edge?: EntityId;
  /**
   * 'network' legs follow an edge; 'offroad' legs are straight site tracks; 'external' legs are
   * the distance driven outside the map to/from an external node (from = to = node position,
   * `length` = external distance in m, not part of the on-map polyline).
   */
  kind: 'network' | 'offroad' | 'external';
  from: Vec2;
  to: Vec2;
  length: number;
  duration: number;
  points: Vec2[];
}

export interface Route {
  from: Vec2;
  to: Vec2;
  /** the stretches of the route: on the network, off it, beyond the map */
  stretches: RouteStretch[];
  /** full path polyline */
  polyline: Vec2[];
  length: number;
  networkLength: number;
  offroadLength: number;
  /** seconds */
  duration: number;
  /** extra distance driven outside the map (external suppliers), km */
  externalKm: number;
  explain: Explained;
}

export interface NearestResult {
  edge: EntityId;
  point: Vec2;
  /** chainage along the edge geometry from node a (m) */
  chainage: number;
  distance: number;
}

export interface RoutingPort {
  nodes(): IterableIterator<[EntityId, Readonly<NetNode>]>;
  edges(): IterableIterator<[EntityId, Readonly<NetEdge>]>;
  /** the nearest point on the network (with `profile`: on a way that carrier can use) */
  nearest(p: Vec2, opts?: { openOnly?: boolean; maxDistance?: number; profile?: string }): NearestResult | null;
  /**
   * Fastest route for a vehicle profile. Off-network approach/exit legs are allowed up to
   * `maxOffroad` metres (default 400 m), over the ground as it is today (wet, soaked: S3); `firm`: as if it were dry and
   * firm (a plan's estimate, which the day's ground does not change: the work itself waits for the ground). Returns null
   * when unreachable.
   */
  route(from: Vec2, to: Vec2, profile: string, opts?: { maxOffroad?: number; openOnly?: boolean; firm?: boolean; unit?: EntityId }): Route | null;
  /** route from an external node (supplier) to a point on the map */
  routeFromExternal(externalNode: EntityId, to: Vec2, profile: string, opts?: { maxOffroad?: number; openOnly?: boolean; firm?: boolean; unit?: EntityId }): Route | null;
  /** route from a point on the map to an external node (deliveries leaving the map, return trips) */
  routeToExternal(from: Vec2, externalNode: EntityId, profile: string, opts?: { maxOffroad?: number; openOnly?: boolean; firm?: boolean; unit?: EntityId }): Route | null;
  /**
   * Where a vehicle coming in by a way (or going out by it) gets to near a point: the point itself, else the nearest point
   * round it, within `within` m, from which `walk` (a profile on foot) reaches it, or dry ground within `reach` m of it
   * (work at a creek's crossing is reached from its bank); undefined: none
   */
  approach(node: EntityId, to: Vec2, profile: string, within: number, walk?: string, dir?: 'in' | 'out', opts?: { maxOffroad?: number; openOnly?: boolean; reach?: number }): Vec2 | undefined;
  externalNodes(): EntityId[];
  profile(id: string): VehicleProfile;
  /** ESAL of one pass of the profile (loaded or empty) */
  esal(profile: string, loaded: boolean): number;
  revision(): number;
}

export interface EdgeTraffic {
  /** today's counters (reset at midnight) */
  vehToday: number;
  esalToday: number;
  /** exponentially-weighted 30-day averages per day */
  vehPerDay: number;
  esalPerDay: number;
  totalVeh: number;
  totalEsal: number;
  /** last 30 daily totals (most recent last) */
  recent: { veh: number; esal: number }[];
}

export interface TrafficPort {
  edge(id: EntityId): Readonly<EdgeTraffic> | undefined;
}

export interface TrafficContribution {
  /** called once per day at 00:00 for background traffic of the past day */
  dailyTrips(): { edges: EntityId[]; vehicles: number; esalPerVehicle: number; kind: string }[];
}

/**
 * The carrier of a leg: its class (a vehicle profile: speeds by surface, axle loads, payload) and,
 * when it is a thing in the world, that thing (one of our machines or vehicles). A supplier's or
 * haulier's lorry is a carrier of their fleet beyond the map and has no `unit`.
 */
export interface Carrier {
  class: string;
  unit?: EntityId;
  /** one of a firm's vehicles beyond the map (a supplier's lorry, a buyer's van): which firm's, of its finite fleet */
  fleet?: string;
}

/**
 * What rides a move: goods (held by `holder` until unloaded; absent: by whoever sends them), a
 * machine or vehicle carried by another (a carrier carried), a person.
 */
export type Load = { goods: { material: string; qty: number; unit: string; holder?: EntityId; mass?: number; order?: EntityId; since?: number; age?: number; parts?: { qty: number; since: number; age?: number }[] } } | { machine: EntityId; mass?: number; towed?: boolean } | { person: EntityId };

/** the mass of loads (t), as their senders state it */
export const loadMass = (loads: readonly Load[]): number => loads.reduce((a, l) => a + ('goods' in l ? (l.goods.mass ?? 0) : 'machine' in l ? (l.mass ?? 0) : 0), 0);

/** one carrier's run from a place to a place: on the network, across open ground or beyond the map */
export interface Leg {
  carrier: Carrier;
  route: Route;
  depart: number;
  arrive: number;
  /** driven on it before it was rerouted from where it was (s): counted with what it drives after (r39) */
  drivenBefore?: number;
  /** what rides this leg (the walk to a shop carries nothing, the walk back what was bought) */
  loads: Load[];
  /** a loaded pass (axle loads, the loaded pace) */
  loaded: boolean;
  /** the person driving or leading it (0025: every vehicle has someone in charge) */
  inCharge?: EntityId;
  /** where it stood on the way, and why (a breakdown): the leg arrives later by as much */
  stops?: { at: number; until: number; why: string }[];
  /** it starts beyond the map, in by this way (an external node) */
  fromNode?: EntityId;
  /** how far off the network it may go (as asked: a rerouted leg keeps it) */
  maxOffroad?: number;
  /** it ends beyond the map, out by this way (an external node) */
  toNode?: EntityId;
}

/** loads carried along a chain of legs; it exists while under way. What it delivers is its last leg's loads */
export interface Move {
  /** module that requested the move (receives moves.arrived) */
  requester: string;
  ref?: string;
  purpose: string;
  legs: Leg[];
  /** while the carrier unloads at the end of its last leg: until when */
  unloadUntil?: number;
  status: 'underway' | 'unloading' | 'arrived' | 'stopped';
  /** the legs done so far */
  done?: number;
  /** when its carrier of ours runs dry on it, if it does */
  dryAt?: number;
  /** its carrier of ours on a tow truck from beyond the map: it drives no more */
  towed?: boolean;
}

/** what a move delivers: its last leg's loads */
export const deliveredBy = (m: Pick<Move, 'legs'>): Load[] => m.legs.at(-1)?.loads ?? [];

export interface MovePosition {
  pos: Vec2;
  /** heading in radians, 0 = +x, counterclockwise towards −z */
  heading: number;
  /** of the whole move, 0..1 */
  progress: number;
  /** the leg under way */
  leg: number;
  /** true while the carrier is on the external (off-map) part of its route */
  offMap?: boolean;
  /** why it stands where it is (a breakdown), while it does */
  stopped?: string;
}

/** Running totals of completed legs (moves module state). */
export interface MoveStats {
  completedLegs: number;
  /** total vehicle-km of completed legs (on-map + external) */
  vehicleKm: number;
  /** of which outside the map */
  externalKm: number;
  /** sum of the ESAL of one pass of every completed leg */
  esal: number;
  /** breakdowns on the way so far */
  breakdowns: number;
  /** move → its pending breakdown timer (drawn at departure, re-drawn in a fork; the time is not state) */
  hazards: Record<string, number>;
}

/**
 * Where a unit is (design/physical-state.md I2): standing somewhere, on a move, or beyond the map at a way in. One
 * place a unit, written only by the moves module: a unit changes place only by a move.
 */
export interface Place {
  at?: Vec2;
  /** on this move (where along it: the move's position) */
  on?: EntityId;
  /** beyond the map, out by this way in (an external node) */
  beyond?: EntityId;
}

export interface MovesPort {
  /** where a unit is now: a point on the map (on a move: where the move is); beyond the map: undefined */
  where(unit: EntityId): Vec2 | undefined;
  /** where a unit will be at t (now or later) as its moves now stand: undefined beyond the map */
  whereAt(unit: EntityId, t: number): Vec2 | undefined;
  /** its place, as kept */
  placeOf(unit: EntityId): Readonly<Place> | undefined;
  underway(): [EntityId, Readonly<Move>][];
  positionAt(move: EntityId, t: number): MovePosition | null;
  /** how long a carrier class takes to unload `tonnes` itself (0 when it has no way to: the receiver's work) */
  unloadTime(carrier: string, tonnes: number): number;
  /** position along an arbitrary route at elapsed seconds (used for cyclic hauls) */
  positionOnRoute(route: Route, elapsed: number): Omit<MovePosition, 'leg'>;
  stats(): Readonly<MoveStats>;
  /** a point on the map (beyond its edge, only a way out leads) */
  onMap(p: Vec2): boolean;
}

/** a leg as asked for: the carrier, and where from and to (a point, or a way in at either end) */
export interface LegRequest {
  carrier: Carrier;
  from: Vec2;
  to: Vec2;
  /** start from this external node instead of `from` */
  externalNode?: EntityId;
  /** end at this external node instead of `to` (leaving the map) */
  externalDestination?: EntityId;
  /** allow longer off-network stretches (construction plant crossing a site); default 400 m */
  maxOffroad?: number;
  /** what rides this leg (default: the move's loads) */
  loads?: Load[];
  /** it leaves no earlier than this (a shop that opens later, a stop on the way) */
  notBefore?: number;
  /** the person driving or leading it */
  inCharge?: EntityId;
  /** km beyond the way in or out (a shop past the next town): driven at the carrier's top speed, counted in the leg */
  beyondKm?: number;
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    NetNode: NetNode;
    NetEdge: NetEdge;
    EdgeTraffic: EdgeTraffic;
    Move: Move;
    Place: Place;
  }
  interface PortTypes {
    routing: RoutingPort;
    traffic: TrafficPort;
    moves: MovesPort;
  }
  interface ModuleStateTypes {
    moves: MoveStats;
    accesses: { built: Record<string, ResolvedAccess> };
  }
  interface ContributionTypes {
    'traffic-sources': TrafficContribution;
    /** whether one who goes on foot carries a light (a headlamp in what they carry, or by them where they set out): S7 */
    carriesLight: (read: import('../../kernel/src/index.ts').ReadCtx, unit: EntityId, at: Vec2) => boolean;
    /** what one setting out on foot takes along from their own stores by them (a lamp): the command that does it, if any (S7) */
    setsOut: (read: import('../../kernel/src/index.ts').ReadCtx, unit: EntityId, at: Vec2) => { type: string; payload: Record<string, unknown> } | undefined;
    /**
     * ground made firm off the ways by work done on it (a road's gravel laid, a site track): a vehicle drives on it
     * whatever the wetness, and nothing stands on it in its way (design/realism-plan.md S3)
     */
    firmGround: {
      at: (read: import('../../kernel/src/index.ts').ReadCtx, x: number, z: number) => boolean;
      /** changes whenever the ground it makes firm does (a stage done): what is kept of it is asked again */
      revision: (read: import('../../kernel/src/index.ts').ReadCtx) => number;
    };
    /**
     * ground cleared of trees off the ways by work (a road's corridor felled): no stand of trees there for a vehicle,
     * whatever stands at its edges (S3)
     */
    clearedGround: {
      at: (read: import('../../kernel/src/index.ts').ReadCtx, x: number, z: number) => boolean;
      revision: (read: import('../../kernel/src/index.ts').ReadCtx) => number;
    };
    /** how many hours a unit carrier runs on average before it breaks down (one of ours on the road); undefined: it does not */
    failures: (read: import('../../kernel/src/index.ts').ReadCtx, unit: EntityId) => number | undefined;
    /** how long a unit carrier can drive on what is in its tank (s); undefined: as long as it likes (no engine, nobody knows) */
    range: (read: import('../../kernel/src/index.ts').ReadCtx, unit: EntityId) => number | undefined;
    /** what a load weighs (t), as the catalogue of its kind says (goods: their material; a machine: its model); undefined: not known here */
    loadMass: (read: import('../../kernel/src/index.ts').ReadCtx, load: Load) => number | undefined;
    /** where a party's people report for work: its yard, its camp (the first module that knows it says) */
    base: (read: import('../../kernel/src/index.ts').ReadCtx, party: EntityId) => Vec2 | undefined;
    /** where a person sleeps on the map (their home store); undefined: they live beyond it */
    home: (read: import('../../kernel/src/index.ts').ReadCtx, person: EntityId) => Vec2 | undefined;
  }
  interface DataTypes {
    vehicleProfiles: Record<string, VehicleProfile>;
    networkSettings: NetworkSettings;
    accesses?: Record<string, Access>;
    transitLines?: Record<string, TransitLine>;
    transitFares?: Record<string, Infer<typeof TransitFareSchema>>;
  }
  interface EventTypes {
    'network.changed': { edges: EntityId[]; reason: string };
    /** a leg is done: its carrier is at `to` after `seconds` on the way (fuel, wear, where a vehicle is) */
    /** `left`: the units this leg was the last of the move for, standing where it ended now (or beyond the map) */
    'moves.legDone': { move: EntityId; requester: string; purpose: string; leg: number; carrier: Carrier; seconds: number; to: Vec2; inCharge?: EntityId; carried?: EntityId[]; left?: EntityId[] };
    /** a move reached the end of its last leg: its loads are at `to`, to be unloaded */
    'moves.arrived': { move: EntityId; requester: string; purpose: string; ref?: string; carrier: Carrier; loads: Load[]; to: Vec2 };
    /** a carrier stood on the way (a breakdown): the move arrives `by` seconds later, at `arrive` */
    'moves.delayed': { move: EntityId; requester: string; purpose: string; ref?: string; leg: number; by: number; arrive: number; why: string };
    /**
     * a move stopped where it is (broken down, run dry, its way closed, called off): its units stand there now, `at`
     * (absent: beyond the map, or before it set out); what its carrier drove on that leg (s), and what it carried
     */
    'moves.stopped': { move: EntityId; requester: string; purpose: string; ref?: string; leg: number; carrier: Carrier; inCharge?: EntityId; seconds: number; cause: 'breakdown' | 'dry' | 'closed' | 'stopped'; why: string; at?: Vec2; units: EntityId[]; loads: Load[] };
  }
  interface CommandTypes {
    /** a unit comes into the world: at a place when the world is made (or by a test harness), else beyond the map at a way in */
    /** a move called off: it stops where it is, its units stand there (moves.stopped follows) */
    'moves.stop': { payload: { move: EntityId; why: string }; result: void };
    'moves.place': { payload: { unit: EntityId; at?: Vec2; beyond?: EntityId }; result: void };
    'network.addNode': { payload: { pos: Vec2; external?: { label: string; distanceKm: number; surface?: string } }; result: EntityId };
    /**
     * Add a polyline as one or more edges. Endpoints within snapDistance of existing nodes
     * snap to them; endpoints touching an existing edge split it (T-junction).
     */
    'network.addPolyline': {
      payload: { points: Vec2[]; open: boolean; surface: string; width: number; speedLimit: number; asset?: EntityId; label?: string };
      result: { edges: EntityId[]; nodes: EntityId[] };
    };
    'network.updateEdges': { payload: { edges: EntityId[]; patch: { open?: boolean; surface?: string; speedFactor?: number; width?: number; speedLimit?: number } }; result: number };
    'network.removeEdges': { payload: { edges: EntityId[] }; result: number };
    'traffic.record': { payload: { edges: EntityId[]; vehicles: number; esalPerVehicle: number; kind: string }; result: void };
    'moves.dispatch': {
      payload: {
        legs: LegRequest[];
        loads?: Load[];
        purpose: string;
        ref?: string;
        /** depart at absolute sim time (default now) */
        departAt?: number;
        /** the last leg's carrier also runs back empty (for traffic and rendering) */
        returnEmpty?: boolean;
        /** the empty return goes out by this way (a firm's vehicle home to its base), not back the last leg's way */
        returnVia?: { externalDestination: EntityId; beyondKm?: number };
        /** module that requested the move, echoed in moves.arrived (default 'client') */
        requester?: string;
        /** a loaded pass for ESAL (default: when there are loads) */
        loaded?: boolean;
      };
      result: EntityId;
    };
  }
}
