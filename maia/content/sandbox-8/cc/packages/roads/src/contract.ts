/**
 * Roads domain contract.
 *
 * A road is designed from the player's control points following German practice:
 *   alignment  — tangent polygon filleted with circular arcs ≥ class min radius (RASt 06 / RLW)
 *   gradeline  — follows terrain, smoothed, limited to the class max grade, ≥ freeboard over water
 *   build-up   — RStO 12/24 Tafel 1 Zeile 1 (asphalt on frost protection layer) or RLW unbound;
 *                frost protection thickness from RStO Tab. 6/7 per section (soil frost class,
 *                frost zone, cut/embankment)
 *   earthworks — numeric cross-sections every few metres (formation + side slopes vs terrain),
 *                topsoil, cut (bank) / fill (compacted), mass balance, spoil, imported fill
 * and built through production work packages per section. In service it deteriorates
 * (HDM-4/Paterson models), is graded on the ZEB scale 1.0–5.0 only through inspections, and
 * is maintained with interventions that are again physical work.
 */
import { s, type EntityId, type Explained, type Infer } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type { NearestResult } from '../../network/src/index.ts';
import type {} from '../../production/src/index.ts';
import type { Finding } from '../../rulebooks/src/index.ts';
import type {} from '../../terrain/src/index.ts';
import type {} from '../../inventory/src/index.ts';
import type {} from '../../soil/src/index.ts';
import type {} from '../../weather/src/index.ts';

export const LayerSchema = s.object({
  id: s.string(),
  label: s.string(),
  kind: s.enum(['asphaltSurface', 'asphaltBinder', 'asphaltBase', 'unboundSurface', 'unboundBase', 'frostProtection']),
  /** fixed thickness; omit for the frost protection layer (computed from RStO Tab. 6/7) */
  thickness: s.param('m').optional(),
  material: s.string(),
  activity: s.string(),
  compactedDensity: s.param('t/m3'),
  looseDensity: s.param('t/m3'),
  /** layer extends this far beyond the carriageway edge on each side */
  extraWidth: s.param('m'),
});
export type Layer = Infer<typeof LayerSchema>;

export const RoadClassSchema = s.object({
  label: s.string(),
  description: s.string(),
  standard: s.string(),
  surface: s.enum(['asphalt', 'gravel']),
  /** RStO load class (Belastungsklasse) */
  loadClass: s.string().optional(),
  carriageway: s.param('m'),
  shoulder: s.param('m'),
  crossfall: s.param('%'),
  designSpeed: s.param('km/h'),
  minRadius: s.param('m'),
  maxGrade: s.param('%'),
  speedLimit: s.param('km/h'),
  /** layers top-down */
  layers: s.array(LayerSchema),
  /** RStO Tab. 6 base frost-safe thickness for F2 / F3 subgrade (F1: none) — only asphalt classes */
  frostSafe: s.object({ F2: s.param('m'), F3: s.param('m') }).optional(),
  /** minimum frost-protection layer for bearing capacity (Ev2) */
  minFrostLayer: s.param('m').optional(),
  shoulderMaterial: s.string(),
  /** shoulder material per metre of road edge */
  shoulderMass: s.param('t/m'),
  swales: s.boolean(),
  /** the work of its stages where it differs from the settings' (a path built by hand: spades, a barrow and a tamper) */
  activities: s.record(s.string()).optional(),
  /** how high it goes above water at a culvert, where it differs from the settings' */
  freeboard: s.param('m').optional(),
  /** the surface the network knows it by, where it differs (a footpath's 'path': who has no speed on it cannot use it) */
  networkSurface: s.string().optional(),
  color: s.string(),
});
export type RoadClass = Infer<typeof RoadClassSchema>;

/**
 * How a road is handed over to the public body that keeps a place's streets (practice pack: law): which
 * classes it takes, in what condition (the worst section's grade), how long until it decides, and the rule
 */
export const RoadDedicationSchema = s.object({
  authority: s.string(),
  classes: s.array(s.string()),
  worstGrade: s.param('1'),
  days: s.param('d'),
  rule: s.string(),
});
export type RoadDedication = Infer<typeof RoadDedicationSchema>;

export const RoadSettingsSchema = s.object({
  frostZone: s.enum(['I', 'II', 'III']),
  frostZoneAddition: s.object({ I: s.param('m'), II: s.param('m'), III: s.param('m') }),
  cutAddition: s.param('m'),
  highEmbankmentDeduction: s.param('m'),
  highEmbankment: s.param('m'),
  /** horizontal run per unit rise of cut/fill slopes */
  sideSlope: s.param('1'),
  stationSpacing: s.param('m'),
  sectionLength: s.param('m'),
  /** design keeps the road surface at least this far above water */
  freeboard: s.param('m'),
  /** max distance from an existing/planned road for a new road to connect */
  connectDistance: s.param('m'),
  swaleWidth: s.param('m'),
  swaleDepth: s.param('m'),
  culvertActivity: s.string(),
  culvertMaterial: s.string(),
  materials: s.object({ topsoil: s.string(), fill: s.string(), spoil: s.string(), importFill: s.string(), logs: s.string(), brash: s.string() }),
  activities: s.object({
    survey: s.string(),
    clearing: s.string(),
    topsoil: s.string(),
    excavation: s.string(),
    fill: s.string(),
    subgrade: s.string(),
    shoulder: s.string(),
    swale: s.string(),
    acceptance: s.string(),
    inspection: s.string(),
  }),
  /** imported fill compacted density */
  importFillDensity: s.param('t/m3'),
  /** the soil class imported fill makes when laid (a granular fill: what a dig there later meets) */
  importFillClass: s.string(),
  fillLayerThickness: s.param('m'),
  /** material ordering allowance for losses */
  wasteAllowance: s.param('1'),
  deterioration: s.object({
    /** HDM-4 environmental roughness coefficient for temperate, shallow-freeze, sub-humid climates */
    envCoefficient: s.param('1/a'),
    initialIri: s.param('m/km'),
    /** roughness added at construction by unpractised work: IRI × (1 + k·(1 − workmanship)) */
    workmanshipRoughness: s.param('1'),
    /** HDM-III structural cracking initiation: ICA = Kcia · 4.21 · exp(0.139·SNC − 17.1·YE4/SNC²) */
    crackInitKcia: s.param('1'),
    /** logistic cracking progression rate after initiation */
    crackGrowth: s.param('1/a'),
    rutBase: s.param('mm/a'),
    rutPerMesal: s.param('mm'),
    /** pothole area growth per % cracking above 20 % per year (amplified by freeze–thaw cycles) */
    potholeGrowth: s.param('%/a'),
    /** Paterson gravel loss: MLA = 3.65·(3.46 + 2.46·MMP·G + KT·ADT) mm/a — material constants */
    gravelP075: s.param('%'),
    gravelPI: s.param('%'),
    /** unpaved roughness model (sawtooth): IRI → RImax exponentially with vehicle passes */
    unpavedRiMax: s.param('m/km'),
    unpavedRiMin: s.param('m/km'),
    /** per-pass approach rate towards RImax (calibrated to optimal blading every ~4,000 passes) */
    unpavedRate: s.param('1'),
    /** blading reduces roughness by this share (Paterson: 17–45 %) */
    bladingReduction: s.param('1'),
  }),
  /** ZEB support points (values at grade 3.5 / 4.5) */
  zeb: s.object({
    rut: s.series('mm', 2),
    cracks: s.series('%', 2),
    patchesPotholes: s.series('%', 2),
    /** IRI is not a ZEB indicator (ZEB uses AUN); mapping used here is an explicit assumption */
    iri: s.series('m/km', 2),
    unpavedIri: s.series('m/km', 2),
    gravelLossShare: s.series('1', 2),
  }),
});
export type RoadSettings = Infer<typeof RoadSettingsSchema>;

export const InterventionSchema = s.object({
  label: s.string(),
  surface: s.enum(['asphalt', 'gravel']),
  activity: s.string(),
  /** quantity basis per section */
  basis: s.enum(['area', 'length', 'surfaceLayerVolume', 'surfaceLayerMass', 'cracks', 'patches']),
  /** for volume/mass basis */
  thickness: s.param('m').optional(),
  /** compacted density of the placed material (mass basis, unbound volume work) */
  density: s.param('t/m3').optional(),
  effect: s.object({
    iriFactor: s.number().optional(),
    iriSet: s.param('m/km').optional(),
    cracks: s.number().optional(),
    potholes: s.number().optional(),
    patchesAdd: s.boolean().optional(),
    rutFactor: s.number().optional(),
    /** lays the intervention's thickness of gravel on what is left */
    laysGravel: s.boolean().optional(),
    resetSurfaceAge: s.boolean().optional(),
  }),
  description: s.string(),
});
export type Intervention = Infer<typeof InterventionSchema>;

export interface Station {
  s: number;
  x: number;
  z: number;
  ground: number;
  surface: number;
  formation: number;
  /** cut / fill cross-section areas (m²) */
  cut: number;
  fill: number;
  /** footprint half-widths (daylight points) left/right */
  left: number;
  right: number;
  water: boolean;
}

export interface SectionDesign {
  index: number;
  s0: number;
  s1: number;
  length: number;
  mid: Vec2;
  path: Vec2[];
  /** net cut (bank m³, below topsoil) */
  cut: number;
  /** fill (compacted m³) */
  fill: number;
  topsoil: number;
  topsoilClass: string;
  cutClass: string;
  /** the depth (m below the surface at its middle) the cut is reckoned dug in: the plan takes its class from what its party knows, the work meets the ground as it is there */
  cutDepth: number;
  cutSuitable: boolean;
  fillSource: string;
  footprint: number;
  formationArea: number;
  maxCut: number;
  maxFill: number;
  frostClass: 'F1' | 'F2' | 'F3';
  frostLayer: number;
  frostExplain?: Explained;
  layerThickness: Record<string, number>;
  /** quantity per layer in the activity unit (t for asphalt, compacted m³ for unbound) */
  layerQuantity: Record<string, number>;
  trees: string[];
  culvert: number;
}

export interface RoadDesign {
  classId: string;
  valid: boolean;
  problems: string[];
  warnings: string[];
  controlPoints: Vec2[];
  alignment: Vec2[];
  length: number;
  minRadius: number;
  maxGradeUsed: number;
  stations: Station[];
  sections: SectionDesign[];
  totals: {
    cut: number;
    fill: number;
    topsoil: number;
    suitableCut: number;
    spoilTonnes: number;
    importFill: number;
    trees: number;
    culverts: number;
    /** materials to order, in material units */
    materials: Record<string, number>;
  };
  stockpile: Vec2;
  siteStore: Vec2;
  connections: { start: NearestResult | null; end: NearestResult | null };
  estimate: { cost: number; hours: number; days: number; explain: Explained };
  /** what the rulebooks advise (decision 0013): never blocks */
  findings: Finding[];
}

export interface Road {
  /** the party whose road it is: it plans and pays (decision 0025) */
  holder: EntityId;
  label: string;
  classId: string;
  status: 'construction' | 'open' | 'closed' | 'cancelled';
  design: RoadDesign;
  project?: EntityId;
  edges: EntityId[];
  stores: { site: EntityId; soil: EntityId; topsoil: EntityId; wood?: EntityId };
  createdAt: number;
  openedAt?: number;
  /** completed construction stages per section index */
  stages: Record<string, string[]>;
  /** offered to the public body that keeps the streets: when, and when it decides */
  handover?: { at: number; decideAt: number };
}

export interface SectionCondition {
  s0: number;
  s1: number;
  surface: 'asphalt' | 'gravel';
  /** years since surface laid */
  age: number;
  iri: number;
  /** asphalt */
  cracks: number;
  rut: number;
  potholes: number;
  patches: number;
  crackInitAge: number;
  /** gravel */
  gravel: number;
  gravelDesign: number;
  passesSinceBlading: number;
  /** ZEB grade 1.0–5.0 computed from the true state */
  grade: number;
}

export interface RoadCondition {
  sections: SectionCondition[];
  /** traffic-weighted structural number used by HDM models */
  snc: number;
  lastUpdate: number;
  daysInService?: number;
  /** running mean of ESAL/day since opening (crack initiation uses the long-run load, not the first days) */
  meanEsalPerDay?: number;
}

export interface RoadInspection {
  at: number;
  sections: { s0: number; s1: number; grade: number; iri: number; cracks: number; rut: number; potholes: number; gravel: number }[];
  worst: number;
  mean: number;
}

export interface SectionProgress {
  index: number;
  s0: number;
  s1: number;
  /** stages done (topsoil, cut, fill, subgrade, layer ids …) */
  done: string[];
  /** stage in progress with fraction */
  active?: { stage: string; progress: number };
}

export interface RoadsPort {
  classes(): Record<string, RoadClass>;
  /** design a road from control points (pure; does not change the world) */
  design(points: Vec2[], classId: string): RoadDesign;
  progress(road: EntityId): SectionProgress[];
}

declare module '../../kernel/src/index.ts' {
  interface ModuleStateTypes {
    /** when the authority decides each road offered to it (drawn, not told: the world's, not the player's) */
    roads: { handover: Record<string, number> };
  }
  interface ComponentTypes {
    Road: Road;
    RoadCondition: RoadCondition;
    RoadInspection: RoadInspection;
  }
  interface PortTypes {
    roads: RoadsPort;
  }
  interface DataTypes {
    roadClasses: Record<string, RoadClass>;
    roadSettings: RoadSettings;
    roadInterventions: Record<string, Intervention>;
    roadDedication: RoadDedication | undefined;
  }
  interface EventTypes {
    'roads.opened': { road: EntityId };
    'roads.inspected': { road: EntityId; worst: number };
    'roads.handedOver': { road: EntityId; from: EntityId; to: EntityId };
  }
  interface CommandTypes {
    'roads.plan': { payload: { points: Vec2[]; classId: string; label?: string; priority?: number }; result: { road: EntityId; project: EntityId } };
    'roads.cancel': { payload: { road: EntityId }; result: void };
    'roads.inspect': { payload: { road: EntityId }; result: EntityId };
    'roads.maintain': { payload: { road: EntityId; intervention: string; sections?: number[] }; result: EntityId };
    'roads.handOver': { payload: { road: EntityId }; result: { decideAt: number } };
  }
}
