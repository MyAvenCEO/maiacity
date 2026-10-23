/**
 * Structures (decisions 0025, 0026): everything built is a structure, built to a plan. A tent, a
 * wall, a house and a hall are one kind of thing: a plan of elements (with the site work that comes
 * first), built by work, standing on the land, answered by its physics, ageing element by element.
 * A template (practice data) is a way to draw a plan from a few parameters; a planner (an extension
 * point) draws it. Kinds of structures differ in their data and their planner, never in their rules.
 */
import { s, type EntityId, type Explained, type Infer, type Param, type Provenance } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { Finding } from '../../rulebooks/src/index.ts';
import type { Fells, GroundWork } from '../../production/src/index.ts';

/** the kits and walls the structures package plans itself (practice pack) */
export const StructureTemplateSchema = s.object({
  label: s.string(),
  /** how it carries loads: a tent pegged down, a free-standing wall by its weight */
  form: s.enum(['tent', 'wall', 'body']),
  /** footprint length × width (m; a wall's width is its thickness) and height (m) */
  length: s.param('m'),
  width: s.param('m'),
  height: s.param('m'),
  /** what it is made of, by element (for the record and its exposure) */
  elements: s.array(s.object({ id: s.string(), label: s.string(), material: s.string().optional() })),
  /** the work that builds it: an activity, and its quantity per structure (a wall: per m² of face) */
  build: s.object({ activity: s.string(), per: s.enum(['structure', 'face']) }),
  /** a kit taken down and put up again (a tent): goods it is made of, returned when struck */
  kit: s.boolean(),
  /** it is a vehicle of this equipment class, set up where it stands (a caravan): built on it, one thing in two roles */
  vehicle: s.string().optional(),
  /** what it asks of the ground: the steepest slope it sits well on */
  /** the ground: the slope it stands on well, and how deep its pegs or posts go into it (frost below them lifts them) */
  ground: s.object({ maxSlope: s.param('1'), embed: s.param('m').optional() }),
  /** shelter: people it sleeps, how well at best, and how much warmer than outside the night is in it (the bedding is the sleepers' own) */
  shelter: s.object({
    /** open to the front (a lean-to): a fire before it warms it */
    open: s.boolean().optional(),
    sleeps: s.int({ min: 0 }),
    quality: s.param('1'),
    warming: s.param('K'),
    /** the room inside: its air, how often the air is changed closed up for the night, the heat it loses per K, and whether a flue pipe can go through it */
    envelope: s.object({ volume: s.param('m3'), airChange: s.param('1/h'), loss: s.param('W/K'), flue: s.boolean() }).optional(),
  }).optional(),
  /** it catches rain (a tarp or a roof with its barrel): area, what it holds, the water it gives and how much of the rain on it gets there (camp L2) */
  catchment: s.object({ area: s.param('m2'), capacity: s.param('l'), material: s.string(), efficiency: s.param('1') }).optional(),
  /** what holds it: pegs and guy lines (tent), or its weight (wall) */
  anchorage: s.param('kN').optional(),
  /** mass per m² of a wall's face, or of the whole tent or body (kg) */
  mass: s.param('kg'),
  /** what a wind rating says it withstands (rules of thumb, manufacturer data) */
  /** snow: the weight of snow its roof bears (kg/m²: water of the snow lying on it) */
  rating: s.object({ wind: s.param('m/s').optional(), slenderness: s.param('1').optional(), snow: s.param('kg/m2').optional() }),
  /** the reference life of what it is made of (a tent's fabric), when it ages */
  life: s.param('a').optional(),
  /** how it burns (VISION "Fire is one process"): how near a fire's heat must come for it to catch, how fast it burns; what burns is what is built into it (its goods' `burns`), and a unit's own body (a caravan's: `load`) */
  fire: s.object({ catches: s.param('m'), load: s.param('kg').optional(), rate: s.param('kg/h') }).optional(),
});
export type StructureTemplate = Infer<typeof StructureTemplateSchema>;

/** how the physics is reckoned (practice pack): wind on a face, gusts over the day's mean */
export const StructureSettingsSchema = s.object({
  airDensity: s.param('kg/m3'),
  /** drag (pressure) coefficient of a face across the wind */
  drag: s.param('1'),
  /** peak gust over the day's mean wind */
  gustFactor: s.param('1'),
  /** the snow on a roof over the snow on the ground (shape coefficient) */
  roofSnow: s.param('1'),
  /**
   * Frost heave: frost reaching below a peg or post in wet, frost-susceptible ground grips and lifts it,
   * a little each day, and it does not settle back. Per day of frost below its foot, by frost class
   * (ZTV E-StB F1 none, F2 some, F3 much), once the soil is at least this wet.
   */
  frostHeave: s.object({ perDay: s.record(s.param('m/d')), wet: s.param('1') }).optional(),
  /** sleep in a shelter on a slope: lost per 0.1 of slope beyond its limit */
  slopePenalty: s.param('1'),
  /** a night of heavy rain (mm) in a hollow without a prepared pad: the shelter leaks, sleep this much worse */
  leak: s.object({ rain: s.param('mm'), hollow: s.param('m'), penalty: s.param('1') }),
  /** rules of thumb for a building (the rules model): its load per m² of floor area and storey, and what the ground carries by kind of soil */
  rules: s.object({ storeyLoad: s.param('kN/m2'), allowable: s.record(s.param('kPa')) }),
  /** taking down what is built: the activity, and its hours as a share of the hours it took to build */
  removal: s.object({ activity: s.string(), share: s.param('1') }),
  /** Weibull shape of the decline of an element's condition over its life (higher: later and steeper) */
  ageingShape: s.param('1'),
  /** fire (8h): how much farther sparks carry downwind a m/s of wind, the chance an hour that sparks beyond a fire's reach set something alight, the water it takes to put out a kg burning and how fast one person pours it, how near one must be to see a fire and call it in, and the fire brigade: how soon it comes and what it charges one who caused the fire on purpose or by gross negligence */
  fire: s.object({ windReach: s.param('m'), spark: s.param('1/h'), water: s.param('l/kg'), pour: s.param('l/min'), call: s.param('m'), brigade: s.object({ response: s.param('min'), fee: s.param('EUR') }) }).optional(),
});
export type StructureSettings = Infer<typeof StructureSettingsSchema>;

/** where a finished element sits (decision 0014) */
export interface ElementPlace {
  on: 'walls' | 'roof' | 'groundFloor' | 'floors' | 'interior' | 'ground';
  side?: 'inside' | 'outside';
}

/** an element of a plan: the work that makes it, what it is, and what doing it does to the site */
export interface PlanElement {
  id: string;
  label: string;
  activity: string;
  quantity: number;
  /** elements to finish first (FS) */
  after: string[];
  /** elements it is laid alongside (SS: begun with them, never ahead of them) */
  with?: string[];
  /**
   * built in lifts, one after another (a building's storeys, H1): each from a level to a level (a storey's walls from
   * its floor to its top; a slab at its level); its work is one package per lift, the last under the element's own key
   */
  lifts?: { from: number; to: number; label: string }[];
  /** elements whose lifts its lifts stand on: a lift begins after the highest lift of each that tops out at or below its foot */
  on?: string[];
  /** part of the finished structure (false: site work, setting out, acceptance) */
  part: boolean;
  /** construction stage it completes (for the record and the picture) */
  stage?: string;
  /** what it is made of (materialProperties: its life then comes from the durability contract at its placement) */
  material?: string;
  place?: ElementPlace;
  /** reference service life (a) where it has one */
  life?: number;
  /** renewal work at the end of its life */
  renewal?: { activity: string; quantity: number; label: string };
  /**
   * what doing it does to the site: trees felled, the ground dug or filled as it goes (design/physical-state.md §5), soil
   * won and where it goes (store keys of the structure's heaps), what it lays and from which heap
   */
  site?: { trees?: string[]; ground?: Omit<GroundWork, 'store'> & { store?: string }; haulTo?: Vec2; soilClass?: string; soilDepth?: number; produces?: { material: string; perUnit: number; store: string }[]; fells?: Fells<string>; consumes?: Record<string, number>; from?: string; params?: Record<string, number>; substitutes?: Record<string, { material: string; perUnit: number }> };
}

/** what a structure's physics needs to know (from its template, with sources) */
export interface PlanPhysics {
  form: 'tent' | 'wall' | 'body' | 'building';
  /** thickness of a wall, depth of a tent (m) */
  width: Param;
  /** mass per m² of a wall's face, of a whole tent (kg) */
  mass: Param;
  anchorage?: Param;
  rating: { wind?: Param; slenderness?: Param; snow?: Param };
  maxSlope: Param;
  /** how deep its pegs or posts go */
  embed?: Param;
  shelter?: { open?: boolean; sleeps: number; quality: Param; warming: Param; envelope?: { volume: Param; airChange: Param; loss: Param; flue: boolean } };
  catchment?: { area: Param; capacity: Param; material: string; efficiency: Param };
  /** how it burns: how near heat must come for it to catch, what of it burns, how fast */
  fire?: { catches: Param; load?: Param; rate: Param };
  /** a building's weight and how it bears on the ground */
  bearing?: { dead: Param; imposed: Param; bearer: Param; floorArea: number; footprint: number; perimeter: number; floors: number; foundation: string; depth: number; storey?: number; unbraced?: Unbraced };
}

/** walls going up: above what braces them (a slab, over the top storey the roof, a storey's cross walls) they stand on their own */
export interface Unbraced {
  walls: string;
  slabs: string;
  roof: string;
  cross: string;
  thickness: Param;
  mass: Param;
  slenderness: Param;
  gust: Param;
}

/** how much of each element of a plan is built (0 … 1, by its id): a structure is answered for as it is built (I8) */
export type Built = Record<string, number>;

/** a plan: what is to be built where, and the work that builds it */
export interface Plan {
  planner: string;
  template: string;
  label: string;
  pos: Vec2;
  /** degrees, counter-clockwise from +x */
  rotation: number;
  length: number;
  width: number;
  height: number;
  /** usable floor area (m²), when it has floors */
  floorArea?: number;
  /** a kit: packed up and taken away again (its goods go back to the store) */
  kit: boolean;
  physics: PlanPhysics;
  /** heaps and stores the work needs (soil won on the plot), by key */
  stores: { key: string; label: string; pos: Vec2; holds?: string[] }[];
  elements: PlanElement[];
  estimate: { cost: number; hours: number; days: number; explain?: Explained };
  /** a condition survey: its activity and quantity */
  inspection?: { activity: string; quantity: number };
  /** on the holder's books: written off at this share a year (absent: an expense, not an asset) */
  depreciation?: number;
  valid: boolean;
  problems: string[];
  warnings: string[];
  /** what the rulebooks advise (decision 0013): never blocks */
  findings: Finding[];
  /** the planner's own design (a building's geometry, platform, access), for its contributions and clients */
  detail?: unknown;
}

/** what a structure is asked to be: a template and its parameters */
export interface PlanSpec {
  template: string;
  pos: Vec2;
  rotation?: number;
  length?: number;
  width?: number;
  height?: number;
  floors?: number;
  /** level and drain the ground first (a pad), where the template does not already */
  prepare?: boolean;
  label?: string;
  /** elements of the template left out (what followed them follows what they followed) */
  drop?: string[];
  /** the structure this plan revises (its own footprint is no obstacle) */
  self?: EntityId;
  /** the store its goods come from: hand work carries from it, and the estimate counts that */
  store?: EntityId;
  /** the vehicle of ours it is set up on (a template that is a vehicle: a caravan) */
  on?: EntityId;
  /** whose plan it is: it is reckoned on what that party knows of the ground (design/physical-state.md 8d; none: the region's soil map) */
  party?: EntityId;
}

/** a kind of structure a planner offers */
export interface TemplateInfo {
  label: string;
  description?: string;
  form: PlanPhysics['form'];
  category?: string;
  length: number;
  width: number;
  height?: number;
  floors?: number;
}

/** a planner: the templates it draws, and how */
export interface Planner {
  id: string;
  templates(read: import('../../kernel/src/index.ts').ReadCtx): Record<string, TemplateInfo>;
  plan(read: import('../../kernel/src/index.ts').ReadCtx, spec: PlanSpec): Plan;
}

export interface Structure {
  holder: EntityId;
  template: string;
  label: string;
  /** what it was asked to be (revised with its plan) */
  spec: PlanSpec;
  plan: Plan;
  status: 'building' | 'standing' | 'collapsed' | 'struck' | 'cancelled' | 'demolished';
  /** being taken down altogether (its parts come off; then it is gone) */
  demolishing?: boolean;
  /** what it was before the work on it now (a revision, a taking down): given up, it is that again */
  before?: { plan: Plan; spec: PlanSpec; status: Structure['status'] };
  /** parts left short of its plan by work given up (a taking down stopped half way): it stands, but not whole */
  unfinished?: string[];
  /** elements finished */
  done: string[];
  /** how well each finished element was done (0..1: the crew's practice; contractors 1) */
  workmanship?: Record<string, number>;
  /** the store its materials come from (a kit's goods go back there) */
  store?: EntityId;
  /** the heaps of the plan, by key */
  stores: Record<string, EntityId>;
  project?: EntityId;
  /** how often its plan was revised */
  revisions?: number;
  createdAt: number;
  builtAt?: number;
  /** the snow lying on its roof (kg/m² of water as it fell on the ground): what fell while it stood, melting as the ground's does */
  roofSnow?: number;
  /** how much of each part has been taken off again (in the part's quantity): what is built of it is what its work did, less this */
  taken?: Record<string, number>;
  /** how far frost has lifted its pegs or posts out of the ground (m), on how many days of frost below their foot, in ground of which frost class */
  heaved?: number;
  /**
   * on fire (8h): since when, what of it is left to burn (kg), what set it alight, and whose fire that was; whether a
   * piece of it has burnt (a kit's: then it is ruined whatever is saved), what is lost of it (€), and who is fighting it
   */
  burning?: { since: number; left: number; from: string; by?: EntityId; offence?: boolean; ruined?: boolean; lost?: number; fighting?: { by: EntityId; until: number } };
  /** when a fire at it was last put out: what burnt near it before then has had its turn at it */
  putOut?: number;
  heaveDays?: number;
  heaveClass?: string;
  /** on the holder's books: what it cost to build, and what is left after depreciation */
  cost?: number;
  bookValue?: number;
}

export interface ElementCondition {
  id: string;
  label: string;
  /** years in service since it was built or last renewed */
  age: number;
  life: number;
  /** remaining condition 1 (new) … 0 (failed) */
  condition: number;
  /** where the life comes from: the durability contract at the element's placement, provisionally the reference life, or the reference life */
  lifeFrom?: 'durability' | 'provisional' | 'reference';
  lifeExplain?: Explained;
  /** 1.0 (very good) … 5.0 (very poor) */
  grade: number;
}

export interface StructureCondition {
  elements: ElementCondition[];
  lastUpdate: number;
}

export interface StructureInspection {
  at: number;
  elements: { id: string; label: string; grade: number }[];
  worst: number;
}

/** what the structural contract answers: how close to failing it is today (≥ 1: it fails), and how close the ground is to settling under it (> 1: it settles and cracks) */
export interface Assessment {
  utilisation: number;
  /** walls going up standing on their own: how high, and how close they are to coming down (only they come down) */
  unbraced?: { height: number; utilisation: number };
  explain: Explained;
  provenance: Provenance;
  settlement?: { utilisation: number; explain: Explained };
}

export interface StructuralPort {
  /** how close to failing it is, as built (`built`: the share of each element there is; left out, as planned) */
  assess(structure: EntityId, day: { wind: number }, built?: Built): Assessment;
}

export interface StructuresPort {
  /** every template of every planner */
  templates(): Record<string, TemplateInfo & { planner: string }>;
  /** draw a plan without building it */
  plan(spec: PlanSpec): Plan;
  /** how much of each of its elements is built now: what its work laid, less what was taken off (I8) */
  built(structure: EntityId): Built;
}

/** structures' own state: the fires of goods being burnt, as far as their burning has been reckoned for spreading */
export interface StructuresState {
  /** work package → the hours it had burnt by the last hourly reckoning (while it is alight) */
  fires: Record<EntityId, number>;
}

declare module '../../kernel/src/index.ts' {
  interface ModuleStateTypes {
    structures: StructuresState;
  }
  interface ComponentTypes {
    Structure: Structure;
    StructureCondition: StructureCondition;
    StructureInspection: StructureInspection;
  }
  interface PortTypes {
    structural: StructuralPort;
    structures: StructuresPort;
  }
  interface ContributionTypes {
    /** planners of kinds of structures (a building planner, …) */
    planners: Planner;
  }
  interface DataTypes {
    structureTemplates: Record<string, StructureTemplate>;
    structureSettings: StructureSettings;
  }
  interface EventTypes {
    /** an element of a plan is finished (its place in the structure can be taken) */
    'structures.elementDone': { structure: EntityId; element: string; package: EntityId };
    /** an element is taken down (a plan revised) */
    'structures.elementRemoved': { structure: EntityId; element: string };
    'structures.completed': { structure: EntityId };
    'structures.demolished': { structure: EntityId };
    'structures.cancelled': { structure: EntityId };
  }
  interface CommandTypes {
    /** build a structure from a template: a tent from its kit, a wall from bricks, a house from its plan */
    'structures.build': { payload: PlanSpec & { store?: EntityId; priority?: number }; result: { structure: EntityId; project: EntityId } };
    'structures.cancel': { payload: { structure: EntityId }; result: void };
    /** take a structure down: a kit goes back to its store */
    'structures.strike': { payload: { structure: EntityId }; result: void };
    /** take a built structure down altogether, by our own work (its material is lost) */
    'structures.demolish': { payload: { structure: EntityId }; result: { removed: number } };
    'structures.inspect': { payload: { structure: EntityId }; result: EntityId };
    'structures.renew': { payload: { structure: EntityId; elements?: string[] }; result: EntityId };
    /** change a structure's plan, while building or later: the difference is work (built things no longer wanted are taken down) */
    'structures.revise': { payload: { structure: EntityId; length?: number; width?: number; height?: number; floors?: number; drop?: string[] }; result: { added: number; redrawn: number; dropped: number; removed: number } };
  }
}
