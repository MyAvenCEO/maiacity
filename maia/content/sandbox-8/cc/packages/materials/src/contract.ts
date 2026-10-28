/**
 * Durability contract (decisions 0014, 0015; design/foundations.md §6).
 *
 * `durability.serviceLife(material, exposure)` says how long a material lasts where it sits — from
 * the exposure profile only, never from the weather or the soil (the decision check enforces it).
 * Two implementations: the ISO 15686-1 factor method and a decay-dose model. Material properties
 * are data with their sources.
 */
import { s, type Explained, type Infer, type Provenance } from '../../kernel/src/index.ts';
import type { ExposureProfile } from '../../environment/src/index.ts';

export const USE_CLASSES = ['UC1', 'UC2', 'UC3.1', 'UC3.2', 'UC4'] as const;
export type UseClass = (typeof USE_CLASSES)[number];

const perUseClass = (unit: string) => s.object({ UC1: s.param(unit), UC2: s.param(unit), 'UC3.1': s.param(unit), 'UC3.2': s.param(unit), UC4: s.param(unit) });

export const MaterialPropertiesSchema = s.object({
  label: s.string(),
  /** descriptive only, never branched on (decision 0009) */
  kind: s.string(),
  density: s.param('kg/m3'),
  durability: s.object({
    /** EN 350 natural durability class against wood-destroying fungi: 1 very durable … 5 not durable */
    fungi: s.int({ min: 1, max: 5 }),
    /** EN 350 durability against termites: D durable, M moderately durable, S susceptible */
    termites: s.enum(['D', 'M', 'S']),
    source: s.any<{ title: string; publisher?: string; year?: number; note?: string }>(),
    /** ISO 15686 reference service lives by EN 335 use class, valid in the reference exposure */
    referenceServiceLife: perUseClass('a'),
    /** the reference exposure those lives hold in: decay hours per year by use class */
    referenceDecayHours: perUseClass('h/a'),
    /** decay dose (decay hours) the material withstands until failure: above ground, and in ground or water */
    decayDoseCapacity: s.object({ aboveGround: s.param('h'), inGround: s.param('h') }),
  }),
});
export type MaterialProperties = Infer<typeof MaterialPropertiesSchema>;

export interface ServiceLife {
  /** years until failure (a lower bound when `bounded`) */
  years: number;
  /** the life is not limited by what the model knows (e.g. no decay dose): `years` is a lower bound */
  bounded: boolean;
  limitedBy: 'decay' | 'termites' | 'none';
  explain: Explained;
  provenance: Provenance;
}

/** how the work was done (ISO 15686 factor C, work execution) */
export interface Workmanship {
  /** 0..1: the crew's practice (1: experienced) */
  workmanship: number;
}

/** factor C at the least practised work; experienced work is 1 (practice data) */
export const WorkExecutionSchema = s.object({ floor: s.param('1') });

export interface DurabilityPort {
  /** how long a material lasts at an exposure (the profile of a representative period, e.g. a year), as it was worked */
  serviceLife(material: string, exposure: ExposureProfile, work?: Workmanship): ServiceLife;
}

/** lives longer than this are reported as "at least" (not decay-limited within any planning horizon) */
export const LIFE_CAP = 200;

declare module '../../kernel/src/index.ts' {
  interface PortTypes {
    durability: DurabilityPort;
  }
  interface DataTypes {
    materialProperties: Record<string, MaterialProperties>;
    workExecution: Infer<typeof WorkExecutionSchema>;
  }
}
