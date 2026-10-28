/**
 * Terrain & vegetation contracts.
 *
 * Base terrain (heights, soil columns, water, trees) is a pure function of
 * (seed, terrainSettings, soilClasses). Only *edits* (earthworks, tree removal) are state,
 * so snapshots stay small and any consumer can re-derive the world.
 */
import { s, type EntityId, type Infer } from '../../kernel/src/index.ts';
import type { Bounds, GridSpec, Vec2 } from '../../geo/src/index.ts';

export const SoilClassSchema = s.object({
  label: s.string(),
  description: s.string().optional(),
  group: s.enum(['topsoil', 'cohesive', 'mixed', 'granular', 'rock']),
  /** in-situ (bank) bulk density */
  bulkDensity: s.param('t/m3'),
  /** loose volume / bank volume (Auflockerung), e.g. 1.25 */
  swellFactor: s.param('1'),
  /** compacted volume / bank volume (e.g. 0.9 for clay, 0.95 sand) */
  compactionFactor: s.param('1'),
  /** frost susceptibility per ZTV E-StB */
  frostClass: s.enum(['F1', 'F2', 'F3']),
  /** presumptive bearing pressure of a strip footing about 0.5 m wide and deep: what it carries without harmful settlement (about half of what makes it fail) */
  bearing: s.param('kPa'),
  /** digging difficulty (drives excavator cycle times) */
  excavation: s.enum(['easy', 'medium', 'hard', 'rock']),
  /** plant-available water capacity (for the soil water model) */
  fieldCapacity: s.param('mm/m'),
  /**
   * Soil water and frost of this class (for the soil model, from the region's soil data): the
   * fraction of water above field capacity that drains per day, the storage above field capacity
   * before saturation (fraction of capacity), and Stefan's coefficient 2λ/L at field capacity
   * (frost depth = √(stefan · freezing index)).
   */
  hydraulics: s.object({ drainage: s.param('1/d'), excessStorage: s.param('1'), stefan: s.param('m2/K/d') }),
  /** cohesive soils lose trafficability/compactability when wet */
  cohesive: s.boolean(),
  /** usable as fill material without improvement */
  suitableFill: s.boolean(),
  /** rendering colour (hex) */
  color: s.string(),
  /**
   * Landscape positions where this class forms the subsoil (terrain generator hint). When
   * absent it is inferred from `group` (see terrain/src/soils.ts). Added by @cc/terrain.
   */
  landscape: s.array(s.enum(['upland', 'slope', 'valleyFloor', 'waterside'])).optional(),
});
export type SoilClass = Infer<typeof SoilClassSchema>;

export const TerrainSettingsSchema = s.object({
  sizeX: s.param('m'),
  sizeZ: s.param('m'),
  cellSize: s.param('m'),
  /** elevation of the lowest area above sea level */
  baseElevation: s.param('m'),
  /** typical relief (max − min) across the map */
  relief: s.param('m'),
  /** 0 = plain, 1 = rugged hills */
  hilliness: s.number({ min: 0, max: 1 }),
  creek: s.boolean(),
  pond: s.boolean(),
  /** how fast a pond drawn down (or overfilled) comes back to the water table: the time constant of its exchange with the ground water (absent: it does not) */
  pondRefill: s.param('d').optional(),
  /** the region's soil map (design/physical-state.md 8d): one class per cell of this size, as the ground was when mapped (a 1:50,000 map) */
  soilMap: s.object({ cell: s.param('m') }).optional(),
  /** share of the map covered by woodland */
  forestCover: s.number({ min: 0, max: 1 }),
  /** scattered trees outside woodland per hectare */
  scatteredTreesPerHa: s.param('pcs/ha'),
  soil: s.object({
    topsoilClass: s.string(),
    topsoilDepth: s.param('m'),
    subsoilClasses: s.array(s.string()),
    rockClass: s.string(),
    rockDepth: s.param('m'),
  }),
});
export type TerrainSettings = Infer<typeof TerrainSettingsSchema>;

export const TreeSpeciesSchema = s.object({
  label: s.string(),
  kind: s.enum(['broadleaf', 'conifer']),
  matureHeight: s.param('m'),
  /** green wood density for timber mass */
  woodDensity: s.param('t/m3'),
  /** the stem's form factor: its volume over that of a cylinder of the diameter at breast height and the tree's height */
  formFactor: s.param('1'),
  /** the crown's wood (branches and top: brash) as a share of the stem's mass */
  crownWood: s.param('1'),
  color: s.string(),
});
export type TreeSpecies = Infer<typeof TreeSpeciesSchema>;

export interface SoilLayer {
  classId: string;
  /** thickness in m (rock: Infinity is not used; last layer extends to depth limit) */
  thickness: number;
}

/** Soil profile at a point, measured downward from the ground's surface as it is now (what was laid on it first). */
export interface SoilColumn {
  layers: SoilLayer[];
  /** depth to rock below the surface (m) */
  rockDepth: number;
}

/** a stratum laid on the ground (fill): its soil class and thickness (m) */
export interface Stratum {
  cls: string;
  t: number;
  /** its density as laid (t/m³: compacted fill), when it is not the class's bank density */
  rho?: number;
}

/** a cell of the ground changed since the world was made: how much of its original column is gone from the top (m), and what was laid on it since, the top first */
export interface GroundCell {
  cut: number;
  laid: Stratum[];
}

/** what a dig won: each good's tonnes, and the bank m³ dug */
export interface DigResult {
  won: Record<string, number>;
  m3: number;
}

export interface WaterBody {
  id: string;
  kind: 'creek' | 'pond';
  /** creek: centreline; pond: closed outline */
  points: Vec2[];
  /** creek: width per point (m); pond: undefined */
  widths?: number[];
  /** water surface elevation per point (creek) or single level (pond) */
  levels: number[];
}

export interface ProfileSample {
  /** chainage along the polyline (m) */
  s: number;
  x: number;
  z: number;
  /** current surface height */
  h: number;
  /** original (virgin) height */
  h0: number;
  water: number;
}

export interface TerrainPort {
  readonly bounds: Bounds;
  readonly grid: GridSpec;
  /** current surface elevation (m a.s.l.), bilinear */
  heightAt(x: number, z: number): number;
  originalHeightAt(x: number, z: number): number;
  /** gradient magnitude (m/m) of the current surface */
  slopeAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
  soilAt(x: number, z: number): SoilColumn;
  /** soil class found at depth d below the surface as it is now */
  soilClassAtDepth(x: number, z: number, depth: number): string;
  /** what the region's soil map says is at a depth there: the class of its cell as the ground was (anyone's knowledge; it is wrong where the soil changes within a cell) */
  soilMapAt(x: number, z: number, depth: number): string;
  /** the column the region's soil map gives for the unit there (as the ground was when mapped) */
  soilMapColumn(x: number, z: number): SoilColumn;
  /**
   * The ground keeps its strata on a grid of its own, finer than the heights' (design/physical-state.md §5): a cell of
   * it is a metre square, so many to a height vertex, the vertex's height their mean. The area of one (m²).
   */
  readonly cellArea: number;
  /** the ground at a cell of the ground's grid: where it is, its surface height and its column from there down */
  groundAt(fi: number, fj: number): { x: number; z: number; h: number; column: SoilColumn };
  /** the cells of the ground's grid a polygon covers ([fi, fj, m²]), in their order on the grid */
  cover(polygon: Vec2[]): [number, number, number][];
  /** the pond's water level now (m a.s.l.), from its volume over its basin; none without a pond */
  pondLevel(): number | undefined;
  /** the pond's water now (m³) */
  pondVolume(): number | undefined;
  soilClass(id: string): SoilClass;
  /** water depth above current terrain (0 if dry) */
  waterDepthAt(x: number, z: number): number;
  waterBodies(): WaterBody[];
  profile(points: Vec2[], spacing: number): ProfileSample[];
  /** current heights for the whole grid (row-major), cached per revision — do not mutate */
  heights(): Float32Array;
  revision(): number;
}

export interface Tree {
  id: string;
  x: number;
  z: number;
  species: string;
  height: number;
  /** trunk diameter at breast height (m) */
  dbh: number;
  crownRadius: number;
  /** where the tree stands (rendering, felling rules — hedgerows/riparian trees are protected in the breeding season) */
  setting?: 'woodland' | 'hedgerow' | 'riparian' | 'solitary';
}

export interface VegetationPort {
  /** current trees (after removals), cached per revision — do not mutate */
  trees(): readonly Tree[];
  treesIn(polygon: Vec2[]): Tree[];
  treesNear(p: Vec2, radius: number): Tree[];
  species(id: string): TreeSpecies;
  /** a current (not removed) tree by id */
  tree(id: string): Tree | undefined;
  /** a tree's wood: its stem's volume (m³) and green mass (t), and its crown's (brash, t) */
  wood(tree: Tree): { stemVolume: number; stem: number; crown: number };
  revision(): number;
}

export interface TerrainState {
  /** edited tiles: key "ti,tj" → heights of that tile (tileSize × tileSize vertices, row-major); the heights the strata give, kept for fast reading */
  tiles: Record<string, number[]>;
  revision: number;
  /**
   * the ground where it was changed, in shards of 32 × 32 cells (so a change copies only its shards): shard "si,sj" →
   * cell of the ground's grid (fj · columns + fi) → its strata (design/physical-state.md §5)
   */
  ground?: Record<string, Record<string, GroundCell>>;
  /** the pond's water (m³), as it was at `at` (it comes back to the water table from there) */
  pond?: { volume: number; at: number };
}

export interface VegetationState {
  removed: string[];
  revision: number;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    terrain: TerrainPort;
    vegetation: VegetationPort;
  }
  interface DataTypes {
    soilClasses: Record<string, SoilClass>;
    terrainSettings: TerrainSettings;
    treeSpecies: Record<string, TreeSpecies>;
  }
  interface ModuleStateTypes {
    terrain: TerrainState;
    vegetation: VegetationState;
  }
  interface CommandTypes {
    /** world definition only (setup, trusted): heights set as if they had always been so */
    'terrain.setHeights': { payload: { cells: [number, number, number][]; reason: string }; result: number };
    /** so many m³ dug at cells of the ground's grid ([fi, fj, m³]): what lies there into a store as goods by its kind */
    'terrain.dig': { payload: { cells: number[][]; as: { topsoil: string; fill: string; spoil: string }; into: EntityId; why: string; topsoilOnly?: boolean }; result: DigResult };
    /** goods from a store laid at cells of the ground's grid ([fi, fj, m³]) as a stratum of a soil class */
    'terrain.fill': { payload: { cells: number[][]; cls: string; from: EntityId; take: { material: string; qty: number }[]; tonnes?: number; why: string }; result: void };
    /** water drawn at a place: from the pond (as far as it holds) or the creek; the quantity drawn */
    'terrain.draw': { payload: { at: Vec2; material: string; qty: number; m3: number; into: EntityId; why: string }; result: number };
  }
  interface EventTypes {
    'terrain.changed': { bounds: Bounds; cells: number; reason: string };
    'vegetation.changed': { removed: string[]; reason: string };
  }
  interface CommandTypes {
    'vegetation.removeTrees': { payload: { ids: string[]; reason: string }; result: number };
  }
}

export type { EntityId };
