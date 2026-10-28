/**
 * What every construction cycle must hold (decision 0015): only the months up to now are known,
 * each with a level and where it comes from; the cycle stays within what construction markets do;
 * the same world gives the same cycle, also restored and replayed.
 */
import { check, DAY, Runtime, type ConformanceSuite, type RuntimeConfig } from '../../kernel/src/index.ts';

export interface CycleSubject {
  config: () => RuntimeConfig;
  /** days to run */
  days: number;
}

export const cycleConformance: ConformanceSuite<CycleSubject> = {
  contract: 'constructionCycle',
  cases: [
    {
      name: 'only the past is known: one month per month so far, none after now, each with a level and a provenance',
      run(subject) {
        const rt = Runtime.create(subject.config());
        const cycle = () => rt.read.port('constructionCycle');
        for (let d = 0; d < subject.days; d += 7) {
          rt.advance(rt.now + 7 * DAY);
          const c = rt.read.calendar.at(rt.now);
          const month = `${c.year}-${String(c.month).padStart(2, '0')}`;
          check(cycle().current().month === month, `day ${d}: the current month is ${cycle().current().month}, not ${month}`);
          check(cycle().history().every((m) => m.month <= month), `day ${d}: a month after now is known`);
        }
        const h = cycle().history();
        const months = new Set(h.map((m) => m.month));
        check(months.size === h.length, 'a month is listed twice');
        for (const m of h) {
          check(Number.isFinite(m.level) && m.level > 0, `${m.month}: level ${m.level}`);
          check(Boolean(m.provenance?.kind && m.provenance.source), `${m.month}: no provenance`);
        }
        check(Number.isFinite(cycle().current().explain.v), 'the current level has no explanation');
      },
    },
    {
      name: 'within what construction markets do: never below 0.4 or above 2.5 of normal',
      run(subject) {
        const rt = Runtime.create(subject.config());
        rt.advance(rt.now + subject.days * DAY);
        for (const m of rt.read.port('constructionCycle').history()) check(m.level >= 0.4 && m.level <= 2.5, `${m.month}: ${m.level}`);
      },
    },
    {
      name: 'deterministic: the same world gives the same cycle, also restored and replayed',
      run(subject) {
        const a = Runtime.create(subject.config());
        const b = Runtime.create(subject.config());
        a.advance(a.now + subject.days * DAY);
        b.advance(b.now + subject.days * DAY);
        check(a.hash() === b.hash(), 'two runs differ');
        check(Runtime.restore(subject.config(), a.snapshot()).hash() === a.hash(), 'restore differs');
        check(Runtime.replay(subject.config(), a.commandLog, a.now).hash() === a.hash(), 'replay differs');
      },
    },
  ],
};
