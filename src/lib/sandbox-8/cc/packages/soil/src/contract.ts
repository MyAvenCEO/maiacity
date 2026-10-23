/**
 * Soil state contract: water balance and frost on a coarse grid, driven by the weather port.
 * Other models (earthworks workability, crops, pests, foundations, road frost damage) read it.
 */
export type Trafficability = 'good' | 'reduced' | 'none';

export interface SoilStatePort {
  /** relative soil water of the topsoil/subsoil bucket: 0 = wilting point, 1 = field capacity, >1 = waterlogged */
  moistureAt(x: number, z: number): number;
  /** current frost penetration depth below surface (m) */
  frostDepthAt(x: number, z: number): number;
  /** can heavy plant work / can cohesive soil be compacted right now? */
  trafficability(x: number, z: number): Trafficability;
  /** air freezing index accumulated this winter (K·d, positive) */
  freezingIndex(): number;
  /** frost thaw cycles since 1 July */
  freezeThawCycles(): number;
  /** the snow lying on the ground, as its water (mm = kg/m²), map-wide */
  snowWater(): number;
  /** the snow on any open surface (a roof, a tarp) after the day at `t`, from what lay on it before: it falls and melts as on the ground */
  snowAfter(prev: number, t: number): number;
  /** grid for overlays (row-major, cell centres) */
  grid(): { x0: number; z0: number; cell: number; nx: number; nz: number; moisture: number[]; frostDepth: number[] };
}

export interface SoilStateModuleState {
  cell: number;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  /** relative moisture per cell */
  moisture: number[];
  frostDepth: number[];
  freezingIndex: number;
  thawIndex: number;
  freezeThawCycles: number;
  lastFrozen: boolean;
  /** snow water equivalent of the snow pack (mm), map-wide — added by @cc/soil (snow storage/insulation) */
  snowWater: number;
}

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    'soil-state': SoilStatePort;
  }
  interface ModuleStateTypes {
    soil: SoilStateModuleState;
  }
}
