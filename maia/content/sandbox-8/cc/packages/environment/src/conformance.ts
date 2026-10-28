/**
 * Conformance suite of the environment contract (decision 0015). Every implementation — the
 * built-in model, a recorded series, later an external hygrothermal simulation — must pass it for
 * the placements it stands for.
 */
import { check, DAY, Runtime, type ConformanceSuite, type RuntimeConfig } from '../../kernel/src/index.ts';
import type { PlacementIn } from '../../space/src/index.ts';
import type { ExposureProfile } from './contract.ts';

export interface EnvironmentSubject {
  /** a world bound to the implementation under test (the same every call) */
  config(): RuntimeConfig;
  /** run in a fresh world before asking (e.g. build the faces); returns the placements to test */
  prepare(rt: Runtime): PlacementIn[];
  /** whole days [from, to) the implementation covers (sim seconds, on day boundaries) */
  from: number;
  to: number;
}

const world = (subject: EnvironmentSubject): { rt: Runtime; at: PlacementIn[] } => {
  const rt = Runtime.create(subject.config());
  const at = subject.prepare(rt);
  check(at.length > 0, 'the subject prepares no placements');
  // the window lived through: exposure is of the past (the future is not to be read, design/physical-state.md I7)
  if (subject.to > rt.now) rt.advance(subject.to);
  return { rt, at };
};

const exposure = (rt: Runtime, at: PlacementIn, from: number, to: number): ExposureProfile => rt.read.port('environment').exposure(at, from, to);

const KINDS = ['model', 'external', 'measured', 'entered'];

export const environmentConformance: ConformanceSuite<EnvironmentSubject> = {
  contract: 'environment',
  cases: [
    {
      name: 'profiles are physical and consistent',
      run(subject) {
        const { rt, at } = world(subject);
        for (const p of at) {
          const e = exposure(rt, p, subject.from, subject.to);
          const where = JSON.stringify(p);
          check(e.hours > 0 && e.hours <= (subject.to - subject.from) / 3600 + 1e-6, `${where}: ${e.hours} h in the period`);
          check(e.temperature.min <= e.temperature.mean + 1e-9 && e.temperature.mean <= e.temperature.max + 1e-9, `${where}: temperature min ≤ mean ≤ max violated`);
          check(e.temperature.min > -60 && e.temperature.max < 80, `${where}: temperatures out of range`);
          check(e.relativeHumidity.mean >= 0 && e.relativeHumidity.mean <= 100, `${where}: relative humidity ${e.relativeHumidity.mean}`);
          check(e.dewPoint.mean <= e.temperature.mean + 1e-6 && e.dewPoint.min <= e.dewPoint.mean + 1e-9, `${where}: dew point above the temperature`);
          for (const [k, v] of [['hours above 80 %', e.relativeHumidity.hoursAbove80], ['wetted hours', e.wetting.hours], ['time of wetness', e.timeOfWetness]] as const) check(v >= 0 && v <= e.hours + 1e-6, `${where}: ${k} ${v} of ${e.hours} h`);
          check(e.wetting.drivingRain >= 0 && e.radiation >= 0 && e.temperature.freezeThawCycles >= 0, `${where}: negative water, radiation or cycles`);
          check(KINDS.includes(e.provenance.kind) && e.provenance.source.length > 0, `${where}: provenance missing`);
        }
      },
    },
    {
      name: 'what the physics forbids: no rain or sun reaches a part facing an enclosed space; none of the sun reaches into the ground',
      run(subject) {
        const { rt, at } = world(subject);
        for (const p of at) {
          const e = exposure(rt, p, subject.from, subject.to);
          if (e.meets === 'space') check(e.wetting.drivingRain === 0 && e.radiation === 0, `${JSON.stringify(p)}: rain or sun inside an enclosed space`);
          if (e.meets === 'ground' || e.meets === 'water') check(e.radiation === 0, `${JSON.stringify(p)}: sun in the ground`);
        }
      },
    },
    {
      name: 'periods add up',
      run(subject) {
        const { rt, at } = world(subject);
        const mid = subject.from + Math.floor((subject.to - subject.from) / 2 / DAY) * DAY;
        for (const p of at) {
          const whole = exposure(rt, p, subject.from, subject.to);
          const a = exposure(rt, p, subject.from, mid);
          const b = exposure(rt, p, mid, subject.to);
          const near = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x));
          check(near(a.hours + b.hours, whole.hours), `${JSON.stringify(p)}: hours do not add up`);
          check(near(a.wetting.drivingRain + b.wetting.drivingRain, whole.wetting.drivingRain), `${JSON.stringify(p)}: water does not add up`);
          check(near(a.timeOfWetness + b.timeOfWetness, whole.timeOfWetness), `${JSON.stringify(p)}: time of wetness does not add up`);
          check(near(Math.min(a.temperature.min, b.temperature.min), whole.temperature.min) && near(Math.max(a.temperature.max, b.temperature.max), whole.temperature.max), `${JSON.stringify(p)}: extremes do not combine`);
        }
      },
    },
    {
      name: 'deterministic and restorable',
      run(subject) {
        const one = world(subject);
        const two = world(subject);
        const back = Runtime.restore(subject.config(), JSON.parse(JSON.stringify(one.rt.snapshot())));
        one.at.forEach((p, i) => {
          const a = JSON.stringify(exposure(one.rt, p, subject.from, subject.to));
          check(a === JSON.stringify(exposure(two.rt, two.at[i]!, subject.from, subject.to)), `${JSON.stringify(p)}: two worlds made alike differ`);
          check(a === JSON.stringify(exposure(back, p, subject.from, subject.to)), `${JSON.stringify(p)}: a restored world differs`);
        });
      },
    },
  ],
};
