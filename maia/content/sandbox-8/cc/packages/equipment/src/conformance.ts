/**
 * What every used-plant market must hold (decision 0015): a value is positive and never above a
 * new machine today, age and hours never raise it, buyers come, and the same
 * world gives the same answers.
 */
import { check, DAY, Runtime, type ConformanceSuite, type EntityId, type RuntimeConfig } from '../../kernel/src/index.ts';

export interface UsedPlantSubject {
  /** a world with the market under test (trusted: the test logs hours on the machines) */
  config: () => RuntimeConfig;
  /** machines of ours to value */
  machines: (rt: Runtime) => EntityId[];
}

export const usedPlantConformance: ConformanceSuite<UsedPlantSubject> = {
  contract: 'usedPlant',
  cases: [
    {
      name: 'a value is positive, explained, and never above a new machine today',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const id of subject.machines(rt)) {
          const v = rt.read.port('usedPlant').value(id);
          const md = rt.read.port('equipment').modelOf(id);
          const newPrice = md.purchasePrice.value * rt.read.port('prices').index(rt.now);
          check(v.value > 0 && v.value <= newPrice + 1, `${md.label}: ${v.value} against a new price of ${newPrice}`);
          check(Math.abs(v.explain.v - v.value) <= 1, `${md.label}: the explanation says ${v.explain.v}, the value ${v.value}`);
          check(v.provenance.source.length > 0, `${md.label}: no provenance`);
        }
      },
    },
    {
      name: 'more hours and more years never raise the value (in real terms)',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const id of subject.machines(rt)) {
          const real = () => rt.read.port('usedPlant').value(id).value / rt.read.port('prices').index(rt.now);
          const v0 = real();
          rt.dispatch('equipment.logWork', { machine: id, hours: 20, load: 0.5 });
          const v1 = real();
          check(v1 <= v0 + 1e-6, `20 more hours raised the value ${v0} → ${v1}`);
        }
        rt.advance(rt.now + 400 * DAY);
        for (const id of subject.machines(rt)) if (rt.read.get('Machine', id)) check(rt.read.port('usedPlant').value(id).value > 0, 'a year later the value is gone');
      },
    },
    {
      name: 'prospective buyers come, and what they pay spreads',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const id of subject.machines(rt)) {
          const b = rt.read.port('usedPlant').buyers(id);
          check(b.meanDays > 0 && Number.isFinite(b.meanDays) && b.spread >= 0 && b.spread < 3, `buyers ${JSON.stringify(b)}`);
        }
      },
    },
    {
      name: 'deterministic',
      run(subject) {
        const a = Runtime.create(subject.config());
        const b = Runtime.create(subject.config());
        const va = subject.machines(a).map((id) => a.read.port('usedPlant').value(id).value);
        const vb = subject.machines(b).map((id) => b.read.port('usedPlant').value(id).value);
        check(JSON.stringify(va) === JSON.stringify(vb), 'two worlds made alike value differently');
      },
    },
  ],
};
