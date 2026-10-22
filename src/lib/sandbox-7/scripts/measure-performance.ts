// Retains the detailed-stand baseline used by the saved historical measurements.
// Headless, same-world wind comparison. No physics settings are changed.
// Run: node --import tsx scripts/measure-performance.ts
import { strict as assert } from 'node:assert';
import { initialize, Simulation } from '../simulation';
import { domeDefinition, domeScenario } from '../dome';
import { ShedBuild } from '../shed';
import { Wind } from '../wind';
import { ReferenceWind } from '../tests/helpers/reference-wind';
await initialize();
for (const diameter of [8, 16]) {
  const sim = new Simulation(domeScenario(diameter));
  try {
    const build = new ShedBuild(sim, domeDefinition(diameter, {detailedShoring: true}));
    while (!build.complete) build.placeNext();
    sim.step(3);
    const wind = new Wind(sim), reference = new ReferenceWind(sim);
    wind.configure({ enabled: true, speed: 10, from: 'front' }); reference.configure(wind.settings);
    assert.deepEqual(wind.measure(), reference.measure());
    const measure = (fn: () => unknown) => {
      const times = Array.from({ length: 5 }, () => { const start = performance.now(); fn(); return performance.now() - start; });
      return +times.sort((a, b) => a - b)[2].toFixed(2);
    };
    const oldTimes: number[] = [], newTimes: number[] = [];
    sim.environmentStep = () => wind.apply();
    for (let i = 0; i < 5; i++) {
      sim.step(); // Move the world so blocker hints must be checked again.
      let start = performance.now(); const oldSamples = reference.measure(); oldTimes.push(performance.now() - start);
      start = performance.now(); const newSamples = wind.measure(); newTimes.push(performance.now() - start);
      assert.deepEqual(newSamples, oldSamples);
      assert.deepEqual([...wind.loads], [...reference.loads]);
    }
    const median = (times: number[]) => +times.sort((a, b) => a - b)[2].toFixed(2);
    const oldWindMs = median(oldTimes), newWindMs = median(newTimes);
    sim.environmentStep = undefined;
    const gravityStepMs = measure(() => sim.step());
    console.log(JSON.stringify({ diameterM: diameter, bodies: sim.parts.size, joints: sim.world.impulseJoints.len(), oldWindMs, newWindMs, windSpeedup: +(oldWindMs / newWindMs).toFixed(1), gravityStepMs, identicalWindSamples: true }));
  } finally { sim.dispose(); }
}
