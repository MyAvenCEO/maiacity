/**
 * What every instrument must hold (decision 0015 applied to agreements): money is never made up
 * (an asset balance never goes below zero, an ended agreement holds nothing), a refused action
 * changes nothing, and the same commands give the same world.
 */
import { check, DAY, Runtime, type ConformanceSuite, type RuntimeConfig } from '../../kernel/src/index.ts';

export interface InstrumentSubject {
  config: () => RuntimeConfig;
  /** a product of the world that uses the instrument */
  product: string;
  amount?: number;
  /** days to run (past its end, if it has one) */
  days: number;
}

const agreementOf = (rt: Runtime) => [...rt.read.all('Agreement')].at(-1)!;

function run(subject: InstrumentSubject): Runtime {
  const rt = Runtime.create(subject.config());
  const r = rt.dispatch('agreements.open', { product: subject.product, ...(subject.amount !== undefined ? { amount: subject.amount } : {}) });
  check(r.ok, `opening ${subject.product}: ${r.ok ? '' : rt.formatBlocker(r.reasons[0]!)}`);
  return rt;
}

export const instrumentConformance: ConformanceSuite<InstrumentSubject> = {
  contract: 'instruments',
  cases: [
    {
      name: 'money is not made up: an asset balance never goes negative; an ended agreement holds nothing',
      run(subject) {
        const rt = run(subject);
        for (let d = 0; d < subject.days; d += 1) {
          rt.advance(rt.now + DAY);
          const [, a] = agreementOf(rt);
          if (a.account?.startsWith('asset:')) check(rt.read.balance(a.account) >= -1e-6, `day ${d}: ${a.label} holds ${rt.read.balance(a.account)}`);
        }
        rt.dispatch('agreements.notice', { agreement: agreementOf(rt)[0] });
        rt.advance(rt.now + 400 * DAY);
        const [, a] = agreementOf(rt);
        check(a.status === 'ended', `${a.label} has not ended (${a.status})`);
        if (a.account) check(Math.abs(rt.read.balance(a.account)) < 0.005, `${a.label} ended holding ${rt.read.balance(a.account)}`);
        check(a.open.every((o) => o.paid >= o.amount), `${a.label} ended with open items`);
      },
    },
    {
      name: 'a refused action changes nothing',
      run(subject) {
        const rt = run(subject);
        rt.advance(rt.now + 3 * DAY);
        const [id] = agreementOf(rt);
        const before = rt.hash();
        for (const action of ['withdraw', 'payIn', 'noSuchAction']) {
          const r = rt.dispatch('agreements.act', { agreement: id, action, amount: 1e12 });
          if (!r.ok) check(rt.hash() === before, `a refused ${action} changed the world`);
        }
      },
    },
    {
      name: 'deterministic: the same commands give the same world, also restored and replayed',
      run(subject) {
        const a = run(subject);
        const b = run(subject);
        a.advance(a.now + subject.days * DAY);
        b.advance(b.now + subject.days * DAY);
        check(a.hash() === b.hash(), 'two runs differ');
        check(Runtime.restore(subject.config(), a.snapshot()).hash() === a.hash(), 'restore differs');
        check(Runtime.replay(subject.config(), a.commandLog, a.now).hash() === a.hash(), 'replay differs');
      },
    },
  ],
};

export interface TenantDemandSubject {
  config: () => RuntimeConfig;
  /** lettable things with their uses: [subject, use]; `worse` makes a subject's condition poorer */
  subjects: (rt: Runtime) => [string, string][];
  worse: (rt: Runtime, subject: string) => void;
}

/**
 * What every tenant-demand model must hold (decision 0015): a rent is positive and explained, a
 * poorer condition never raises it, prospective tenants come, their behaviour is sane, and
 * the same world gives the same answers.
 */
export const tenantDemandConformance: ConformanceSuite<TenantDemandSubject> = {
  contract: 'tenantDemand',
  cases: [
    {
      name: 'a rent is positive and explained; tenants behave sanely',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const [id, use] of subject.subjects(rt)) {
          const r = rt.read.port('tenantDemand').rent(id, use);
          check(r.rent > 0, `${id} as ${use}: rent ${r.rent}`);
          check(Math.abs(r.explain.v - r.rent) <= 1, `${id} as ${use}: the explanation says ${r.explain.v}, the rent ${r.rent}`);
          check(r.provenance.source.length > 0, `${id}: no provenance`);
          const b = rt.read.port('tenantDemand').behaviour(id, use);
          check(b.lateShare >= 0 && b.lateShare <= 1 && b.lateDays >= 0 && (b.stayDays === undefined || b.stayDays > 0), `${id}: behaviour ${JSON.stringify(b)}`);
        }
      },
    },
    {
      name: 'a poorer condition never raises the rent; prospective tenants come, and what they pay spreads',
      run(subject) {
        const rt = Runtime.create(subject.config());
        for (const [id, use] of subject.subjects(rt)) {
          const d = rt.read.port('tenantDemand');
          const r0 = d.rent(id, use).rent;
          const t = d.tenants(id, use);
          check(t.meanDays > 0 && Number.isFinite(t.meanDays) && t.spread >= 0 && t.spread < 3, `${id} as ${use}: tenants ${JSON.stringify(t)}`);
          subject.worse(rt, id);
          check(rt.read.port('tenantDemand').rent(id, use).rent <= r0, `a poorer condition raised the rent of ${id}`);
        }
      },
    },
    {
      name: 'deterministic',
      run(subject) {
        const a = Runtime.create(subject.config());
        const b = Runtime.create(subject.config());
        const ra = subject.subjects(a).map(([id, use]) => a.read.port('tenantDemand').rent(id, use).rent);
        const rb = subject.subjects(b).map(([id, use]) => b.read.port('tenantDemand').rent(id, use).rent);
        check(JSON.stringify(ra) === JSON.stringify(rb), 'two worlds made alike differ');
      },
    },
  ],
};
