/**
 * Conformance suite of the durability contract (decision 0015): whatever the model, lives are
 * positive and explained, more decay never lengthens a life, termites never lengthen it, and the
 * same question gives the same answer.
 */
import { check, Runtime, type ConformanceSuite, type RuntimeConfig } from '../../kernel/src/index.ts';
import type { ExposureProfile } from '../../environment/src/index.ts';
import { LIFE_CAP } from './contract.ts';

export interface DurabilitySubject {
  config(): RuntimeConfig;
  /** the material to test */
  material: string;
  /** exposure profiles to test it in (from the world's environment, or recorded) */
  profiles(rt: Runtime): ExposureProfile[];
}

const ask = (rt: Runtime, material: string, e: ExposureProfile) => rt.read.port('durability').serviceLife(material, e);

export const durabilityConformance: ConformanceSuite<DurabilitySubject> = {
  contract: 'durability',
  cases: [
    {
      name: 'lives are positive, capped and explained',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const e of subject.profiles(rt)) {
          const l = ask(rt, subject.material, e);
          const at = `${e.meets} ${JSON.stringify(e.classes)}`;
          check(l.years > 0 && l.years <= LIFE_CAP, `${at}: ${l.years} years`);
          check(Math.abs(l.explain.v - l.years) <= 1e-9 * Math.max(1, l.years) || l.bounded, `${at}: the explanation says ${l.explain.v}, the life ${l.years}`);
          check(l.provenance.source.length > 0, `${at}: no provenance`);
        }
      },
    },
    {
      name: 'more decay never lengthens a life; termites never lengthen it',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const e of subject.profiles(rt)) {
          const base = ask(rt, subject.material, e).years;
          const wetter = ask(rt, subject.material, { ...e, wetting: { ...e.wetting, decayHours: e.wetting.decayHours * 2 + 100, hours: e.wetting.hours * 2 + 100 } }).years;
          check(wetter <= base + 1e-9, `${e.meets}: doubling the decay dose lengthened the life ${base} → ${wetter}`);
          const termites = ask(rt, subject.material, { ...e, agents: { ...e.agents, termites: { value: 1, unit: '1', label: 'test' } } }).years;
          check(termites <= base + 1e-9, `${e.meets}: termites lengthened the life ${base} → ${termites}`);
        }
      },
    },
    {
      name: 'how the work was done: experienced work is the reference, less practised work never lengthens a life, and no more than the floor shortens it',
      run(subject) {
        const rt = Runtime.create(subject.config());
        const floor = rt.read.data('workExecution').floor.value;
        for (const e of subject.profiles(rt)) {
          const base = ask(rt, subject.material, e);
          const expert = rt.read.port('durability').serviceLife(subject.material, e, { workmanship: 1 });
          check(Math.abs(expert.years - base.years) <= 1e-9 * Math.max(1, base.years), `${e.meets}: experienced work changed the life ${base.years} → ${expert.years}`);
          let last = expert.years;
          for (const w of [0.75, 0.5, 0.25, 0]) {
            const l = rt.read.port('durability').serviceLife(subject.material, e, { workmanship: w });
            check(l.years <= last + 1e-9, `${e.meets}: workmanship ${w} lengthened the life ${last} → ${l.years}`);
            check(base.bounded || l.years >= floor * base.years - 1e-9, `${e.meets}: workmanship ${w} shortened the life below the floor ${floor}: ${l.years} of ${base.years}`);
            last = l.years;
          }
        }
      },
    },
    {
      name: 'deterministic',
      run(subject) {
        const a = Runtime.create(subject.config());
        const b = Runtime.create(subject.config());
        const pa = subject.profiles(a);
        const pb = subject.profiles(b);
        pa.forEach((e, i) => check(JSON.stringify(ask(a, subject.material, e)) === JSON.stringify(ask(b, subject.material, pb[i]!)), `${e.meets}: two worlds made alike differ`));
      },
    },
  ],
};
