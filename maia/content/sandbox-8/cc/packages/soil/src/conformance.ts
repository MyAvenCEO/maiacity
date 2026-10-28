/**
 * Conformance suite of the soil-state contract (decision 0015): the soil model and the fake of `@cc/soil/testing`
 * (design/modular-split.md §7.2) must both pass it, day after day over the window.
 */
import { check, DAY, Runtime, type ConformanceSuite, type RuntimeConfig } from '../../kernel/src/index.ts';
import type { SoilStatePort } from './contract.ts';

export interface SoilStateSubject {
  /** the configuration of a world with the implementation under test (same every call) */
  config(): RuntimeConfig;
  /** the days looked at [from, to) in sim seconds */
  from: number;
  to: number;
}

const TRAFFICABILITY = ['good', 'reduced', 'none'];

/** the port at the end of each day of the window */
const daysOf = (subject: SoilStateSubject, each: (soil: SoilStatePort, t: number) => void): Runtime => {
  const rt = Runtime.create(subject.config());
  for (let t = Math.max(DAY, subject.from); t < subject.to; t += DAY) {
    rt.advance(t);
    each(rt.read.port('soil-state'), t);
  }
  return rt;
};

/** the cell centres of the soil's grid, at most a few hundred of them */
const centres = (soil: SoilStatePort): [number, number, number][] => {
  const g = soil.grid();
  const step = Math.max(1, Math.floor(Math.sqrt((g.nx * g.nz) / 200)));
  const out: [number, number, number][] = [];
  for (let j = 0; j < g.nz; j += step) for (let i = 0; i < g.nx; i += step) out.push([g.x0 + i * g.cell, g.z0 + j * g.cell, j * g.nx + i]);
  return out;
};

const fieldOf = (soil: SoilStatePort): string => JSON.stringify([soil.grid(), soil.freezingIndex(), soil.freezeThawCycles(), soil.snowWater(), centres(soil).map(([x, z]) => soil.trafficability(x, z))]);

export const soilStateConformance: ConformanceSuite<SoilStateSubject> = {
  contract: 'soil-state',
  cases: [
    {
      name: 'soil water, frost, snow and trafficability are physical',
      run(subject) {
        daysOf(subject, (soil, t) => {
          for (const [x, z] of centres(soil)) {
            const m = soil.moistureAt(x, z);
            const f = soil.frostDepthAt(x, z);
            check(Number.isFinite(m) && m >= 0, `day ${t / DAY} at (${x}, ${z}): moisture ${m}`);
            check(Number.isFinite(f) && f >= 0, `day ${t / DAY} at (${x}, ${z}): frost depth ${f} m`);
            check(TRAFFICABILITY.includes(soil.trafficability(x, z)), `day ${t / DAY} at (${x}, ${z}): trafficability '${soil.trafficability(x, z)}'`);
          }
          check(soil.freezingIndex() >= 0, `day ${t / DAY}: freezing index ${soil.freezingIndex()}`);
          check(Number.isInteger(soil.freezeThawCycles()) && soil.freezeThawCycles() >= 0, `day ${t / DAY}: ${soil.freezeThawCycles()} freeze-thaw cycles`);
          check(soil.snowWater() >= 0, `day ${t / DAY}: snow ${soil.snowWater()} mm`);
        });
      },
    },
    {
      name: 'the grid is the field the port answers from',
      run(subject) {
        daysOf(subject, (soil, t) => {
          const g = soil.grid();
          check(g.cell > 0 && g.moisture.length === g.nx * g.nz && g.frostDepth.length === g.nx * g.nz, `day ${t / DAY}: a grid of ${g.nx} × ${g.nz} with ${g.moisture.length} values`);
          for (const [x, z, k] of centres(soil)) {
            check(Math.abs(soil.moistureAt(x, z) - g.moisture[k]!) < 1e-9, `day ${t / DAY} at (${x}, ${z}): moisture ${soil.moistureAt(x, z)}, the grid ${g.moisture[k]}`);
            check(Math.abs(soil.frostDepthAt(x, z) - g.frostDepth[k]!) < 1e-9, `day ${t / DAY} at (${x}, ${z}): frost ${soil.frostDepthAt(x, z)}, the grid ${g.frostDepth[k]}`);
          }
        });
      },
    },
    {
      name: 'snow on an open surface after a day past is never less than none',
      run(subject) {
        daysOf(subject, (soil, t) => {
          for (const prev of [0, 5, 50]) {
            const after = soil.snowAfter(prev, t - DAY);
            check(Number.isFinite(after) && after >= 0, `day ${t / DAY}: ${prev} mm before, ${after} mm after`);
          }
        });
      },
    },
    {
      name: 'deterministic: two worlds made alike have the same soil, and so has a restored snapshot',
      run(subject) {
        const a: string[] = [];
        const b: string[] = [];
        const rt = daysOf(subject, (soil) => a.push(fieldOf(soil)));
        daysOf(subject, (soil) => b.push(fieldOf(soil)));
        check(JSON.stringify(a) === JSON.stringify(b), 'two worlds made alike have different soil');
        const back = Runtime.restore(subject.config(), JSON.parse(JSON.stringify(rt.snapshot())));
        check(fieldOf(back.read.port('soil-state')) === fieldOf(rt.read.port('soil-state')), 'the restored world has different soil');
      },
    },
  ],
};
