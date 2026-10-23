/**
 * What every needs model must hold (decision 0015): a positive, finite need of each kind with its
 * provenance; more work or more heat never asks for less; the same day asks the same.
 */
import { check, Runtime, type ConformanceSuite, type EntityId } from '../../kernel/src/index.ts';

export interface NeedsSubject {
  world: () => Runtime;
  /** a person of that world */
  person: (rt: Runtime) => EntityId;
}

export const needsConformance: ConformanceSuite<NeedsSubject> = {
  contract: 'needs',
  cases: [
    {
      name: 'every need is positive and finite, explained, with its provenance',
      run(subject) {
        const rt = subject.world();
        const r = rt.read.port('needs').requirement(subject.person(rt), { workHours: 8, tMax: 22 });
        for (const k of ['energy', 'water', 'sleep', 'hygiene'] as const) check(Number.isFinite(r[k].v) && r[k].v > 0, `${k}: ${r[k].v}`);
        check(Boolean(r.provenance.kind && r.provenance.source), 'no provenance');
      },
    },
    {
      name: 'more work and more heat never ask for less',
      run(subject) {
        const rt = subject.world();
        const needs = rt.read.port('needs');
        const p = subject.person(rt);
        const rest = needs.requirement(p, { workHours: 0, tMax: 15 });
        const work = needs.requirement(p, { workHours: 9, tMax: 15 });
        const hot = needs.requirement(p, { workHours: 9, tMax: 32 });
        check(work.energy.v >= rest.energy.v && work.water.v >= rest.water.v && work.hygiene.v >= rest.hygiene.v, 'work asks for less');
        check(hot.water.v >= work.water.v && hot.energy.v >= work.energy.v - 1e-9, 'heat asks for less');
      },
    },
    {
      name: 'the same day asks the same',
      run(subject) {
        const rt = subject.world();
        const p = subject.person(rt);
        const a = rt.read.port('needs').requirement(p, { workHours: 6, tMax: 25 });
        const b = rt.read.port('needs').requirement(p, { workHours: 6, tMax: 25 });
        check(a.energy.v === b.energy.v && a.water.v === b.water.v && a.sleep.v === b.sleep.v && a.hygiene.v === b.hygiene.v, 'two answers differ');
      },
    },
  ],
};
