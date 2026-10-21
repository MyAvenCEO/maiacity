import { writeFileSync } from 'node:fs';
import { G, initialize, Simulation } from '../src/simulation';
import { ShedBuild } from '../src/shed';
import { brickHouseDefinition, brickHouseScenario } from '../src/brick-house';

await initialize();
const definition = brickHouseDefinition(), sim = new Simulation(brickHouseScenario()), build = new ShedBuild(sim, definition);
const stages = [];
for (let stage = 0; stage < definition.stages.length; stage++) {
  while (build.next?.stage === stage) { if (!build.placeNext()) throw Error(`Assembly interrupted: ${JSON.stringify(build.failures.at(-1))}`); sim.run(definition.interval); }
  sim.run(.5);
  const measurement = { stage: definition.stages[stage], parts: build.count, joints: build.connections.size, massKg: sim.mass,
    maxAnchorErrorM: build.maxAnchorError(), maxSpeedMps: Math.max(...[...sim.parts.values()].map(p => Math.hypot(...Object.values(p.body.linvel())))) };
  if (measurement.maxAnchorErrorM > .002 || measurement.maxSpeedMps > .01) throw Error(`Unsettled stage: ${measurement.stage}`);
  stages.push(measurement); console.log(measurement);
}
sim.run(2);
let reaction = 0;
for (let i = 0; i < 120; i++) { sim.step(); reaction += sim.contacts().filter(c => c.a === 'ground').reduce((sum, c) => sum + c.force * Math.abs(c.normal.y), 0) / 120; }
if (Math.abs(reaction / (sim.mass * G) - 1) > .03) throw Error('Ground reaction does not balance weight');
writeFileSync('brick-house-measurements.json', JSON.stringify({ runtime: process.version, timestep: sim.dt, solverIterations: sim.world.numSolverIterations,
  internalPgsIterations: sim.world.integrationParameters.numInternalPgsIterations, stages, finalWeightN: sim.mass * G, meanGroundReactionN: reaction,
  construction: build.record(), bodies: sim.state() }, null, 2) + '\n');
console.log({ weightN: sim.mass * G, groundReactionN: reaction }); sim.dispose();
