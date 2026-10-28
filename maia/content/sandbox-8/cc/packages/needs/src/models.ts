/**
 * Two implementations of the needs contract (decision 0015): human physiology (energy after
 * FAO/WHO/UNU from the basal metabolic rate and the day's activity, water by heat and work) and the
 * Sphere minimum standards (a fixed ration a person a day).
 */
import { defineModule, ex, type EntityId, type ModelDescriptor, type ReadCtx } from '../../kernel/src/index.ts';
import type {} from '../../workforce/src/index.ts';
import { type NeedsDay, type NeedsPort, type Requirement } from './contract.ts';

export const PHYSIOLOGY_MODEL: ModelDescriptor = {
  contract: 'needs',
  implementation: 'physiology',
  kind: 'model',
  label: 'Daily needs from physiology: energy = basal metabolic rate × physical activity level (FAO/WHO/UNU), water by heat and hours of work, sleep',
  validity: { ranges: { tMax: [-20, 40], workHours: [0, 12] }, notes: 'A reference adult (one body mass, no sex difference); no pregnancy, illness or acclimatisation.' },
  resolution: 'per person and day',
  confidence: 'medium',
  sources: [{ title: 'practice pack: physiology' }],
};

function physiology(read: ReadCtx, person: EntityId, day: NeedsDay): Requirement {
  const ph = read.data('physiology');
  if (!ph) throw new Error('needs (physiology): the world has no physiology data');
  const age = read.calendar.at(read.now).year - (read.get('Person', person)?.birthYear ?? read.calendar.at(read.now).year - 40);
  const band = ph.bmr.find((b) => age >= b.from && age < b.to) ?? ph.bmr[ph.bmr.length - 1]!;
  const bmr = ex.sum(`basal metabolic rate at ${age} years`, 'kcal', ex.mul('a × body mass', 'kcal', ex.param(band.a), ex.param(ph.bodyMass, 'body mass')), ex.param(band.b));
  const sleep = ph.sleep.value;
  const work = Math.min(24 - sleep, day.workHours);
  const rest = 24 - sleep - work;
  const pal = ex.div(
    'physical activity level',
    '1',
    ex.sum('activity over the day (PAR × h)', 'h', ex.mul('asleep', 'h', ex.param(ph.par.sleep), ex.value(sleep, 'h')), ex.mul('at work', 'h', ex.param(ph.par.work), ex.value(work, 'h')), ex.mul('awake, at rest', 'h', ex.param(ph.par.rest), ex.value(rest, 'h'))),
    ex.value(24, 'h'),
  );
  const heat = Math.max(0, day.tMax - ph.water.reference.value);
  const water = ex.sum(
    'drinking water',
    'l',
    ex.param(ph.water.base, 'a day at rest'),
    ex.mul('sweat at work', 'l', ex.value(work, 'h', 'hours of work'), ex.sum('per hour', 'l/h', ex.param(ph.water.sweat, `up to ${ph.water.reference.value} °C`), ex.mul('heat', 'l/h', ex.param(ph.water.perDegree), ex.value(heat, '°C', `${day.tMax.toFixed(0)} °C, above the reference`)))),
  );
  // washing: more after a day's sweaty work
  const hygiene = work > 0 ? ex.sum('washing', 'l', ex.param(ph.hygiene.base, 'a day at rest'), ex.param(ph.hygiene.work, 'after a day of work')) : ex.param(ph.hygiene.base, 'washing');
  return { energy: ex.mul('food energy', 'kcal', bmr, pal), water, sleep: ex.param(ph.sleep, 'sleep'), hygiene, provenance: { kind: 'model', source: 'physiology', confidence: 'medium' } };
}

export const physiologyModule = defineModule({
  id: 'needs-physiology',
  // other modules' components still read raw, not through their owners' ports (design/modular-split.md P2): only shrinks
  reads: ['Person'],
  label: 'Needs (physiology)',
  provides: ['needs'],
  models: [PHYSIOLOGY_MODEL],
  ports: { needs: (read: ReadCtx): NeedsPort => ({ requirement: (person, day) => physiology(read, person, day) }) },
});

export const SPHERE_MODEL: ModelDescriptor = {
  contract: 'needs',
  implementation: 'sphere',
  kind: 'model',
  label: 'Daily needs as the Sphere minimum standards: a fixed ration of food energy and drinking water a person a day',
  validity: { notes: 'Minimum standards for planning, not physiology: hard work and heat need more than the ration.' },
  resolution: 'per person and day',
  confidence: 'medium',
  sources: [{ title: 'practice pack: sphereStandards' }],
};

export const sphereModule = defineModule({
  id: 'needs-sphere',
  label: 'Needs (Sphere minimum standards)',
  provides: ['needs'],
  models: [SPHERE_MODEL],
  ports: {
    needs: (read: ReadCtx): NeedsPort => ({
      requirement: () => {
        const sp = read.data('sphereStandards');
        if (!sp) throw new Error('needs (Sphere): the world has no sphereStandards data');
        return { energy: ex.param(sp.energy, 'food energy (Sphere minimum)'), water: ex.param(sp.water, 'drinking water (Sphere minimum)'), sleep: ex.param(sp.sleep, 'sleep'), hygiene: ex.param(sp.hygiene, 'washing (Sphere minimum)'), provenance: { kind: 'model', source: 'sphere', confidence: 'medium' } };
      },
    }),
  },
});
