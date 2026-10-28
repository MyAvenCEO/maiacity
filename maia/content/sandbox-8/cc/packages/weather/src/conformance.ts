/**
 * Conformance suite of the weather contract (decision 0015). Every source of weather — the
 * generator, measured series, entered series, and external simulations behind the gRPC bridge —
 * must pass it over the window it covers.
 */
import { check, DAY, HOUR, Runtime, type ConformanceSuite, type Provenance, type RuntimeConfig } from '../../kernel/src/index.ts';
import type { DayWeather } from './contract.ts';
import { weatherTruth, type WeatherTruth } from './module.ts';

export interface WeatherSubject {
  /** the configuration of a world bound to the implementation under test (same seed every call) */
  config(): RuntimeConfig;
  /** the window the source covers [from, to) in sim seconds; the world is advanced to `from` first */
  from: number;
  to: number;
  /** what the source delivered as recorded inputs (an external model or feed over the bridge), given to each world first */
  inputs?: { type: string; payload: unknown }[];
}

const KINDS: Provenance['kind'][] = ['model', 'external', 'measured', 'entered'];

/** the source under test as it is, the whole window: the truth (a conformance check is the world's definition, not play) */
const portAt = (subject: WeatherSubject, listen?: (type: string, payload: unknown, t: number) => void): { rt: Runtime; w: WeatherTruth } => {
  const rt = Runtime.create(subject.config());
  if (listen) rt.onEvent(listen);
  for (const i of subject.inputs ?? []) {
    const r = rt.dispatchInput(i.type, i.payload);
    check(r.ok, `input ${i.type} refused`);
  }
  if (subject.from > rt.now) rt.advance(subject.from);
  return { rt, w: weatherTruth(rt.read) };
};

const daysOf = (subject: WeatherSubject, w: WeatherTruth): DayWeather[] => w.days(subject.from, subject.to);

const provenanceOk = (p: Provenance | undefined, where: string): void => {
  check(p !== undefined, `${where}: no provenance`);
  check(KINDS.includes(p.kind), `${where}: provenance kind '${p.kind}' unknown`);
  check(typeof p.source === 'string' && p.source.length > 0, `${where}: provenance without source`);
  check(['high', 'medium', 'low'].includes(p.confidence), `${where}: provenance confidence '${p.confidence}'`);
};

export const weatherConformance: ConformanceSuite<WeatherSubject> = {
  contract: 'weather',
  cases: [
    {
      name: 'daily values are physical and consistent',
      run(subject) {
        const { w } = portAt(subject);
        for (const d of daysOf(subject, w)) {
          const at = `day ${d.year}-${d.month}-${d.dayOfMonth}`;
          check(d.tMin <= d.tMean + 0.05 && d.tMean <= d.tMax + 0.05, `${at}: tMin ${d.tMin} ≤ tMean ${d.tMean} ≤ tMax ${d.tMax} violated`);
          check(d.tMin > -60 && d.tMax < 60, `${at}: temperatures out of range`);
          check(d.precip >= 0, `${at}: negative precipitation`);
          check(d.relHumidity >= 0 && d.relHumidity <= 100, `${at}: relative humidity ${d.relHumidity}`);
          check(d.wind >= 0, `${at}: negative wind`);
          check(d.windDir >= 0 && d.windDir < 360, `${at}: wind direction ${d.windDir}° outside 0…360`);
          const dayLen = (d.sunset - d.sunrise) / HOUR;
          check(d.sunshine >= 0 && d.sunshine <= dayLen + 0.1, `${at}: sunshine ${d.sunshine} h with a ${dayLen.toFixed(1)} h day`);
          check(d.wetHours >= 0 && d.wetHours <= 24 && (d.precip > 0) === (d.wetHours > 0), `${at}: wet hours ${d.wetHours} with ${d.precip} mm`);
        }
      },
    },
    {
      name: 'hours add up to their day',
      run(subject) {
        const { w } = portAt(subject);
        const days = daysOf(subject, w);
        for (let i = 1; i < days.length - 1; i += 1) {
          const d = days[i]!;
          let rain = 0;
          const lo = Math.min(days[i - 1]!.tMin, d.tMin, days[i + 1]!.tMin) - 0.5;
          const hi = Math.max(days[i - 1]!.tMax, d.tMax, days[i + 1]!.tMax) + 0.5;
          for (let h = 0; h < 24; h += 1) {
            const hw = w.hour(d.day * DAY + h * HOUR + HOUR / 2);
            rain += hw.precip;
            check(hw.airTemp >= lo && hw.airTemp <= hi, `day ${d.day} hour ${h}: ${hw.airTemp.toFixed(1)} °C outside ${lo.toFixed(1)}…${hi.toFixed(1)}`);
            check(hw.relHumidity >= 0 && hw.relHumidity <= 100 && hw.cloud >= 0 && hw.cloud <= 1 && hw.ghi >= 0, `day ${d.day} hour ${h}: humidity, cloud or radiation out of range`);
          }
          check(Math.abs(rain - d.precip) < 0.05, `day ${d.day}: hours give ${rain.toFixed(2)} mm, the day ${d.precip} mm`);
        }
      },
    },
    {
      name: 'every value carries its provenance',
      run(subject) {
        const { w } = portAt(subject);
        const days = daysOf(subject, w);
        for (const d of days) provenanceOk(d.provenance, `day ${d.day}`);
        for (const d of days.slice(0, 3)) provenanceOk(w.hour(d.day * DAY + 12 * HOUR).provenance, `hour of day ${d.day}`);
        for (const f of w.forecast(subject.from, 3)) {
          provenanceOk(f.provenance, `forecast for day ${f.day}`);
          check(f.provenance.kind === 'model', `forecast for day ${f.day}: a forecast is a model product, not '${f.provenance.kind}'`);
        }
      },
    },
    {
      name: 'days() agrees with day()',
      run(subject) {
        const { w } = portAt(subject);
        for (const d of daysOf(subject, w)) check(JSON.stringify(w.day(d.day * DAY + 7 * HOUR)) === JSON.stringify(d), `day ${d.day}: days() and day() differ`);
      },
    },
    {
      name: 'deterministic: the same world gives the same weather',
      run(subject) {
        const a = portAt(subject).w;
        const b = portAt(subject).w;
        check(JSON.stringify(daysOf(subject, a)) === JSON.stringify(daysOf(subject, b)), 'two worlds made alike differ in their days');
        for (let t = subject.from; t < Math.min(subject.to, subject.from + 3 * DAY); t += 5 * HOUR) {
          check(JSON.stringify(a.hour(t)) === JSON.stringify(b.hour(t)), `hour ${t}: differs between two worlds made alike`);
        }
      },
    },
    {
      name: 'a forecast is one bulletin per day, for consecutive days',
      run(subject) {
        const { w } = portAt(subject);
        const morning = Math.floor(subject.from / DAY) * DAY + 6 * HOUR;
        const a = w.forecast(morning, 4);
        check(a.length === 4, `asked for 4 days, got ${a.length}`);
        a.forEach((f, i) => check(f.lead === i && f.day === a[0]!.day + i, `forecast day ${i}: lead ${f.lead}, day ${f.day}`));
        check(JSON.stringify(w.forecast(morning + 9 * HOUR, 4)) === JSON.stringify(a), 'the bulletin changed within the day');
      },
    },
    {
      name: 'the port tells the past and the hour under way, never what is to come',
      run(subject) {
        const { rt } = portAt(subject);
        // (a day and a half into the window, as far as the source lets the world run)
        const until = Math.min(subject.to - DAY, subject.from + DAY + 12 * HOUR);
        if (until > rt.now) rt.advance(until);
        const p = rt.read.port('weather');
        const now = rt.now;
        const told = (f: () => unknown): boolean => {
          try {
            f();
            return true;
          } catch {
            return false;
          }
        };
        check(told(() => p.hour(now)), 'the hour under way is not told');
        check(told(() => p.soFar(now)), 'the day so far is not told');
        check(told(() => p.forecast(now, 2)), 'the bulletin issued now is not told');
        if (now >= DAY) check(told(() => p.day(now - DAY)), 'yesterday is not told');
        check(!told(() => p.hour(now + 2 * HOUR)), 'an hour still to come was told');
        check(!told(() => p.day(now)), 'today was told whole before it is over');
        check(!told(() => p.days(now - DAY, now + DAY)), 'days still to come were told');
        check(!told(() => p.light(now + 2 * HOUR)), 'the light of an hour still to come was told');
        check(!told(() => p.forecast(now + DAY, 2)), 'a bulletin issued later was told');
      },
    },
    {
      name: 'each midnight tells the day just past (weather.dayEnded)',
      run(subject) {
        const ended: { t: number; day: DayWeather }[] = [];
        const { rt, w } = portAt(subject, (type, payload, t) => {
          if (type === 'weather.dayEnded') ended.push({ t, day: payload as DayWeather });
        });
        const start = rt.now;
        rt.advance(Math.min(subject.to, subject.from + 4 * DAY));
        const midnights: number[] = [];
        for (let m = Math.max(DAY, Math.ceil(start / DAY) * DAY); m <= rt.now; m += DAY) midnights.push(m);
        const told = ended.filter((e) => e.t >= start);
        // (the midnight the world stands at may still be to run)
        check(told.length === midnights.length || (told.length === midnights.length - 1 && midnights.at(-1) === rt.now), `${told.length} days told at ${midnights.length} midnights`);
        told.forEach((e, i) => {
          check(e.t === midnights[i], `day told at ${e.t}, not at midnight ${midnights[i]}`);
          check(JSON.stringify(e.day) === JSON.stringify(w.day(e.t - DAY)), `the day told at ${e.t} is not the day just past`);
        });
      },
    },
    {
      name: 'a restored snapshot has the same weather',
      run(subject) {
        const { rt, w } = portAt(subject);
        const back = Runtime.restore(subject.config(), JSON.parse(JSON.stringify(rt.snapshot())));
        check(JSON.stringify(daysOf(subject, weatherTruth(back.read))) === JSON.stringify(daysOf(subject, w)), 'restored world has different weather');
      },
    },
  ],
};
