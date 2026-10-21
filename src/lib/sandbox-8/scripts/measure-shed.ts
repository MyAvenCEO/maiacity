import { writeFileSync } from 'node:fs';
import { G, initialize, Simulation } from '../src/simulation';
import { ShedBuild, shedScenario, STAGES } from '../src/shed';

await initialize();
const sim = new Simulation(shedScenario()), build = new ShedBuild(sim);
const stages = [];
for (let stage = 0; stage < STAGES.length; stage++) {
  while (build.next?.stage === stage) { if (!build.placeNext()) throw Error(`Assembly interrupted: ${JSON.stringify(build.failures.at(-1))}`); sim.run(.4); }
  sim.run(1);
  stages.push({ stage: STAGES[stage], parts: build.count, joints: build.connections.size, massKg: sim.mass,
    maxAnchorErrorM: build.maxAnchorError(), maxSpeedMps: Math.max(...[...sim.parts.values()].map(p => Math.hypot(...Object.values(p.body.linvel())))) });
}
let reaction = 0;
for (let i = 0; i < 120; i++) { sim.step(); reaction += sim.contacts().filter(c => c.a === 'ground').reduce((sum, c) => sum + c.force * Math.abs(c.normal.y), 0) / 120; }
writeFileSync('shed-measurements.json', JSON.stringify({ runtime: process.version, timestep: sim.dt, solverIterations: 8, internalPgsIterations: 12,
  stages, finalWeightN: sim.mass * G, meanGroundReactionN: reaction, construction: build.record(), bodies: sim.state() }, null, 2) + '\n');
console.table(stages); console.log({ weightN: sim.mass * G, groundReactionN: reaction }); sim.dispose();
