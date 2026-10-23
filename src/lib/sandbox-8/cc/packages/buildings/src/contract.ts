/**
 * The building planner (decision 0026): a house or a hall is a structure like any other, built to a
 * plan. This package draws the plan from a building type (an element catalogue), a footprint
 * (centre, rotation, length, width) and storeys: the geometry, the level platform the site needs
 * (cut and fill from the terrain), the quantities by the element method of cost planning (cost
 * groups of the practice pack: excavation, foundation, walls, windows, slabs, roof, services …)
 * and the estimate. It gives the finished building its spaces and faces (decision 0014), and the
 * practice pack's site rules as a rulebook.
 */
import { s, type EntityId, type Explained, type Infer } from '../../kernel/src/index.ts';
import type { Vec2 } from '../../geo/src/index.ts';
import type {} from '../../production/src/index.ts';
import type {} from '../../space/src/index.ts';
import type {} from '../../materials/src/index.ts';
import type { Finding } from '../../rulebooks/src/index.ts';
import type {} from '../../terrain/src/index.ts';
import type {} from '../../network/src/index.ts';
import type {} from '../../structures/src/index.ts';

export const ELEMENT_BASES = ['topsoil', 'excavation', 'footprint', 'perimeter', 'wallNet', 'windowArea', 'roofArea', 'slabArea', 'gfa', 'count'] as const;
export type ElementBasis = (typeof ELEMENT_BASES)[number];

export const ElementSchema = s.object({
  id: s.string(),
  label: s.string(),
  /** DIN 276 cost group */
  din276: s.string(),
  basis: s.enum(ELEMENT_BASES),
  /** quantity = basis × factor (in the activity's unit) */
  factor: s.number(),
  activity: s.string(),
  /** keys of elements that must be finished first (FS) */
  after: s.array(s.string()),
  /** keys of elements it is laid alongside (SS: begun with them, never ahead of them) */
  with: s.array(s.string()).optional(),
  /**
   * laid storey by storey (H1): its work in one lift per storey (walls, cross walls) or per floor slab (over each storey
   * but the top one), each lift begun only on what it stands on (`on`: the lift of those elements below it, done and
   * cured) and after its own lift below
   */
  lifts: s.enum(['storeys', 'slabs']).optional(),
  /** elements whose lifts its lifts stand on (not a precedence of the whole: a storey's walls on the slab below them) */
  on: s.array(s.string()).optional(),
  /** BBSR service life; omit for elements that outlive the building (≥ 50 a) */
  serviceLife: s.param('a').optional(),
  /** the material it is made of (materialProperties): its life then comes from the durability contract at its placement */
  material: s.string().optional(),
  /** renewal work at end of life (activity + quantity factor on the same basis) */
  renewal: s.object({ activity: s.string(), factor: s.number(), label: s.string() }).optional(),
  /**
   * where the finished element sits (decision 0014): on the façades, the roof planes, the ground
   * floor or the floors (on their inside or outside), in the storeys, or in the ground below
   */
  place: s.object({ on: s.enum(['walls', 'roof', 'groundFloor', 'floors', 'interior', 'ground']), side: s.enum(['inside', 'outside']).optional() }),
  /** rendering stage this element completes */
  stage: s.enum(['site', 'foundation', 'shell', 'roof', 'envelope', 'services', 'finishing', 'handover']),
});
export type Element = Infer<typeof ElementSchema>;

export const BuildingTypeSchema = s.object({
  label: s.string(),
  description: s.string(),
  category: s.enum(['residential', 'commercial', 'agricultural', 'public']),
  length: s.param('m'),
  width: s.param('m'),
  floors: s.int({ min: 1, max: 6 }),
  storeyHeight: s.param('m'),
  roofPitch: s.param('deg'),
  roofOverhang: s.param('m'),
  windowShare: s.param('1'),
  minLength: s.param('m'),
  maxLength: s.param('m'),
  minWidth: s.param('m'),
  maxWidth: s.param('m'),
  maxFloors: s.int({ min: 1, max: 6 }),
  elements: s.array(ElementSchema),
  /** what it weighs and how it bears on the ground: permanent and imposed load per m² of floor area, the width it bears on without its foundation, and the element that founds it */
  structure: s.object({
    dead: s.param('kN/m2'),
    imposed: s.param('kN/m2'),
    bearer: s.param('m'),
    foundation: s.string(),
    /** its walls while they go up (design/physical-state.md 8a): above what braces them (the slab over a storey, the roof over the top one, a storey's cross walls) they stand on their own; those elements, the walls' thickness, weight per m² of face, and the rule of thumb's slenderness and gust */
    unbraced: s.object({ walls: s.string(), slabs: s.string(), roof: s.string(), cross: s.string(), thickness: s.param('m'), mass: s.param('kg/m2'), slenderness: s.param('1'), gust: s.param('m/s') }).optional(),
  }),
  wallColor: s.string(),
  roofColor: s.string(),
  roofStyle: s.enum(['gable', 'flat', 'shallow']),
});
export type BuildingType = Infer<typeof BuildingTypeSchema>;

export const BuildingSettingsSchema = s.object({
  /** working space around the footprint for the excavation (Arbeitsraum) */
  workingSpace: s.param('m'),
  /** foundation excavation depth below platform (frost-free founding depth) */
  excavationDepth: s.param('m'),
  /** the layer a platform's fill is laid and compacted in */
  fillLayerThickness: s.param('m'),
  /** max slope of the plot before a platform is mandatory/expensive (warning) */
  maxSlope: s.param('%'),
  /** straight-line depreciation of a building on the books (a share of its cost a year; the tax law of the practice pack) */
  depreciation: s.param('1/a'),
  /** max distance from an existing/planned road for access (Erschließung) */
  accessDistance: s.param('m'),
  /** clearance to roads and other buildings */
  clearance: s.param('m'),
  sideSlope: s.param('1'),
  activities: s.object({ survey: s.string(), clearing: s.string(), topsoil: s.string(), platform: s.string(), fill: s.string(), excavation: s.string(), acceptance: s.string(), inspection: s.string() }),
  materials: s.object({ topsoil: s.string(), soil: s.string(), spoil: s.string(), importFill: s.string(), logs: s.string(), brash: s.string() }),
  /** imported fill: its compacted density, and the soil class it makes when laid */
  importFillDensity: s.param('t/m3'),
  importFillClass: s.string(),
});
export type BuildingSettings = Infer<typeof BuildingSettingsSchema>;

export interface BuildingSpec {
  type: string;
  center: Vec2;
  /** degrees, counter-clockwise from +x */
  rotation: number;
  length?: number;
  width?: number;
  floors?: number;
  label?: string;
  /** a building whose plan is revised: its own footprint is no obstacle */
  self?: EntityId;
  /** whose plan it is: reckoned on what that party knows of the ground (design/physical-state.md 8d; none: the soil map) */
  party?: EntityId;
}

export interface Geometry {
  length: number;
  width: number;
  floors: number;
  storeyHeight: number;
  height: number;
  roofPitch: number;
  footprint: number;
  perimeter: number;
  wallGross: number;
  windowArea: number;
  wallNet: number;
  roofArea: number;
  slabArea: number;
  gfa: number;
  corners: Vec2[];
  /** platform (finished ground) level and earthworks to make it */
  platform: number;
  platformCut: number;
  platformFill: number;
  topsoil: number;
  excavation: number;
  /** trees standing on the plot (footprint + working space) */
  trees: string[];
}

export interface ElementQuantity {
  id: string;
  label: string;
  din276: string;
  activity: string;
  quantity: number;
  unit: string;
  cost: number;
  hours: number;
  serviceLife?: number;
}

/** a building's design: what the planner keeps in the plan's detail (geometry, platform, access) */
export interface BuildingDesign {
  type: string;
  valid: boolean;
  problems: string[];
  warnings: string[];
  spec: Required<Pick<BuildingSpec, 'type' | 'center' | 'rotation'>> & { length: number; width: number; floors: number; label: string };
  geometry: Geometry;
  elements: ElementQuantity[];
  access: { distance: number; point: Vec2 } | null;
  estimate: { cost: number; costPerM2: number; hours: number; days: number; explain: Explained };
  stockpile: Vec2;
  /** what the rulebooks advise (decision 0013): never blocks */
  findings: Finding[];
}

/** the spaces and faces of a building (decision 0014) */
export interface BuildingShell {
  building: EntityId;
  storeys: EntityId[];
  roofSpace: EntityId | null;
  /** façades */
  walls: EntityId[];
  /** roof planes */
  roof: EntityId[];
  groundFloor: EntityId;
  /** floors between storeys, and the top floor under a roof space */
  floors: EntityId[];
}

declare module '../../kernel/src/index.ts' {
  interface ComponentTypes {
    /** the spaces and faces of a building structure, made when its first element is finished */
    Shell: BuildingShell;
  }
  interface DataTypes {
    buildingTypes: Record<string, BuildingType>;
    buildingSettings: BuildingSettings;
  }
}
