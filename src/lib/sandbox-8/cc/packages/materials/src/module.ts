/**
 * Two durability models (rule of two, decision 0015). Both read the exposure profile only.
 *
 * - ISO 15686-1 factor method: estimated service life = reference service life of the use class ×
 *   factors A–G. Factor E (outdoor environment) scales with the decay dose against the reference
 *   exposure the reference life holds in; C (work execution) follows how practised the crew was; F
 *   (in-use conditions) takes termites. A, B, D and G are 1: the game does not yet know component
 *   quality, design level, indoor environment or maintenance.
 * - Decay dose: the material withstands a decay dose (temperature-weighted wet hours) until it
 *   fails; the life is that capacity over the annual dose, shortened by termites.
 */
import { defineModule, derivedProvenance, ex, s, type Explained, type ModelDescriptor, type Provenance, type ReadCtx } from '../../kernel/src/index.ts';
import type { ExposureProfile } from '../../environment/src/index.ts';
import { LIFE_CAP, MaterialPropertiesSchema, USE_CLASSES, WorkExecutionSchema, type DurabilityPort, type MaterialProperties, type ServiceLife, type UseClass, type Workmanship } from './contract.ts';

const ISO_15686_1 = { title: 'ISO 15686-1:2011 Buildings and constructed assets — Service life planning — Part 1: General principles and framework (factor method)', publisher: 'ISO', year: 2011 };
const EN_350 = { title: 'EN 350:2016 Durability of wood and wood-based products — Testing and classification of the durability to biological agents', publisher: 'CEN', year: 2016 };

/** share of life termites take from wood of an EN 350 termite class at full hazard (assumption: S 0.9, M 0.5, D 0) */
const TERMITE_LOSS: Record<MaterialProperties['durability']['termites'], number> = { S: 0.9, M: 0.5, D: 0 };

const material = (read: ReadCtx, id: string): MaterialProperties => {
  const m = read.data('materialProperties')[id];
  if (!m) throw new Error(`durability: no material properties for '${id}'`);
  return m;
};

const annual = (e: ExposureProfile, x: number): number => (e.hours > 0 ? (x * 8766) / e.hours : 0);

/** termite factor (≤ 1) for wood near the ground in a region with termites, explained */
function termiteFactor(m: MaterialProperties, e: ExposureProfile): Explained | null {
  const hazard = e.agents.termites?.value ?? 0;
  if (hazard <= 0 || e.meets !== 'ground') return null;
  const loss = TERMITE_LOSS[m.durability.termites];
  if (loss <= 0) return null;
  return ex.sub('termites', '1', ex.value(1, '1'), ex.mul('life lost to termites', '1', ex.value(hazard, '1', 'termite hazard (region)', e.agents.termites?.source), ex.value(loss, '1', `EN 350 termite class ${m.durability.termites}: share lost at full hazard (assumption)`, EN_350)));
}

/** ISO 15686 factor C (work execution) from how practised the crew was; null when not known */
function workFactor(read: ReadCtx, work: Workmanship | undefined): Explained | null {
  if (!work) return null;
  const floor = read.data('workExecution').floor;
  const w = Math.max(0, Math.min(1, work.workmanship));
  return ex.sum('C: work execution', '1', ex.param(floor, 'factor C at the least practised work'), ex.mul(undefined, '1', ex.sub(undefined, '1', ex.value(1, '1'), ex.param(floor, 'floor')), ex.value(w, '1', 'workmanship: how practised the crew was')));
}

function cap(years: Explained, limitedBy: ServiceLife['limitedBy'], provenance: Provenance): ServiceLife {
  if (!Number.isFinite(years.v) || years.v >= LIFE_CAP) return { years: LIFE_CAP, bounded: true, limitedBy: 'none', explain: ex.min(`service life: at least ${LIFE_CAP} years (not limited by decay)`, 'a', years, ex.value(LIFE_CAP, 'a', 'longest life reported')), provenance };
  return { years: years.v, bounded: false, limitedBy, explain: years, provenance };
}

// ------------------------------------------------------------------ ISO 15686-1 factor method

export const ISO_FACTOR_MODEL: ModelDescriptor = {
  contract: 'durability',
  implementation: 'iso15686-factor',
  kind: 'model',
  label: 'ISO 15686-1 factor method (reference service life by EN 335 use class × factors)',
  validity: { ranges: { E: [0.2, 5] }, notes: 'C (work execution) from how practised the crew was; A, B, D and G are 1 (component quality, design, indoor environment, maintenance not yet known). E ranges 0.2–5, wider than the usual 0.8–1.2, because worlds span biomes; beyond that it is clamped and the life marked as outside validity.' },
  resolution: 'per exposure profile',
  confidence: 'low',
  sources: [ISO_15686_1, EN_350],
};

/**
 * A life rests on its exposure: no more certain than it, and marked where the model was used
 * outside the inputs it declares valid (decision 0015).
 */
function provenanceOf(model: ModelDescriptor, e: ExposureProfile, outside: string[]): Provenance {
  const own: Provenance = { kind: 'model', source: model.implementation, confidence: model.confidence ?? 'low', ...(outside.length ? { note: `outside validity: ${outside.join('; ')}` } : {}) };
  return derivedProvenance(own, [e.provenance], 'exposure');
}

function isoServiceLife(read: ReadCtx, id: string, e: ExposureProfile, work?: Workmanship): ServiceLife {
  const m = material(read, id);
  const outside: string[] = [];
  const uc = e.classes['EN 335'] as UseClass | undefined;
  if (!uc || !USE_CLASSES.includes(uc)) throw new Error('durability (ISO 15686): the exposure has no EN 335 use class — the practice pack must classify it');
  const rsl = ex.param(m.durability.referenceServiceLife[uc], `reference service life, ${uc} (${m.label})`);
  const one = (f: string, what: string) => ex.value(1, '1', `${f}: ${what} (not known: 1)`);
  const c = workFactor(read, work);
  const factors: Explained[] = [one('A', 'component quality'), one('B', 'design level'), c ?? one('C', 'work execution'), one('D', 'indoor environment'), one('G', 'maintenance level')];
  let limitedBy: ServiceLife['limitedBy'] = 'decay';
  if (uc !== 'UC1' && uc !== 'UC2') {
    const dose = annual(e, e.wetting.decayHours);
    const ref = m.durability.referenceDecayHours[uc];
    const ratio = dose > 0 ? ref.value / dose : 5;
    const [lo, hi] = ISO_FACTOR_MODEL.validity.ranges!.E as [number, number];
    if (ratio < lo || ratio > hi) outside.push(`factor E ${ratio.toFixed(2)} clamped to ${ratio < lo ? lo : hi}`);
    factors.push(ex.max('E: outdoor environment', '1', ex.value(0.2, '1', 'lower bound'), ex.min(undefined, '1', ex.value(5, '1', 'upper bound'), dose > 0 ? ex.div('reference decay dose / decay dose here', '1', ex.param(ref, `reference decay hours per year, ${uc}`), ex.value(dose, 'h/a', 'decay hours per year here (exposure)')) : ex.value(ratio, '1', 'no decay dose here'))));
  }
  const termites = termiteFactor(m, e);
  if (termites) {
    factors.push(ex.note(termites, 'F: in-use conditions (termites)'));
    if (termites.v < 0.5) limitedBy = 'termites';
  }
  const years = ex.mul(`estimated service life (${m.label}, ${uc})`, 'a', rsl, ...factors);
  const provenance = provenanceOf(ISO_FACTOR_MODEL, e, outside);
  if (uc === 'UC1') return { years: Math.min(LIFE_CAP, years.v), bounded: true, limitedBy: 'none', explain: ex.note(years, 'service life', `${uc}: dry interior, not limited by decay — the reference life is a lower bound`), provenance };
  return cap(years, limitedBy, provenance);
}

// ------------------------------------------------------------------ decay dose

export const DECAY_DOSE_MODEL: ModelDescriptor = {
  contract: 'durability',
  implementation: 'decay-dose',
  kind: 'model',
  label: 'Decay dose: capacity of the material (temperature-weighted wet hours) over the annual dose',
  validity: { ranges: { meanTemperature: [-5, 15] }, notes: 'Wetness is the exposure model\'s wetted time (rain and the drying of a reference film; no wood moisture model); capacities are calibrated to field lives in a central European climate (annual mean temperatures about −5 to 15 °C: elsewhere the life is marked as outside validity). Interior wood without wetting is not decay-limited. Termites only in ground contact.' },
  resolution: 'per exposure profile',
  confidence: 'low',
  sources: [EN_350],
};

function doseServiceLife(read: ReadCtx, id: string, e: ExposureProfile, work?: Workmanship): ServiceLife {
  const m = material(read, id);
  const [tLo, tHi] = DECAY_DOSE_MODEL.validity.ranges!.meanTemperature as [number, number];
  const tMean = e.temperature.mean;
  const provenance = provenanceOf(DECAY_DOSE_MODEL, e, tMean < tLo || tMean > tHi ? [`mean temperature ${tMean.toFixed(1)} °C (calibrated ${tLo} to ${tHi} °C)`] : []);
  const inGround = e.meets === 'ground' || e.meets === 'water';
  const capacity = ex.param(inGround ? m.durability.decayDoseCapacity.inGround : m.durability.decayDoseCapacity.aboveGround, `decay dose capacity ${inGround ? 'in ground' : 'above ground'} (${m.label})`);
  const dose = ex.value(annual(e, e.wetting.decayHours), 'h/a', 'decay hours per year here (exposure)');
  let years = ex.div(`time to reach the capacity (${m.label})`, 'a', capacity, dose);
  // poorly done work (open joints, water traps) shortens the life as in the factor method
  const c = workFactor(read, work);
  if (c && Number.isFinite(years.v)) years = ex.mul(`service life as worked (${m.label})`, 'a', years, c);
  const termites = termiteFactor(m, e);
  let limitedBy: ServiceLife['limitedBy'] = 'decay';
  if (termites && Number.isFinite(years.v)) {
    years = ex.mul(`service life with termites (${m.label})`, 'a', years, termites);
    if (termites.v < 0.5) limitedBy = 'termites';
  } else if (termites) {
    years = ex.mul(`service life with termites (${m.label})`, 'a', ex.value(LIFE_CAP, 'a', 'not decay-limited'), termites);
    limitedBy = 'termites';
  }
  return cap(years, limitedBy, provenance);
}

const DATA = { materialProperties: s.record(MaterialPropertiesSchema), workExecution: WorkExecutionSchema };

export const isoDurabilityModule = defineModule({
  id: 'durability-iso15686',
  label: 'Durability (ISO 15686 factor method)',
  provides: ['durability'],
  requires: ['environment'],
  data: DATA,
  models: [ISO_FACTOR_MODEL],
  ports: { durability: (read: ReadCtx): DurabilityPort => ({ serviceLife: (id, e, w) => isoServiceLife(read, id, e, w) }) },
});

export const doseDurabilityModule = defineModule({
  id: 'durability-dose',
  label: 'Durability (decay dose)',
  provides: ['durability'],
  requires: ['environment'],
  data: DATA,
  models: [DECAY_DOSE_MODEL],
  ports: { durability: (read: ReadCtx): DurabilityPort => ({ serviceLife: (id, e, w) => doseServiceLife(read, id, e, w) }) },
});
