// Staged German-house construction, settling, ground reaction and wind trials.
// Run: npm run measure:house   (writes german-house-measurements.json)
import { writeFileSync } from 'node:fs';
import { initialize, Simulation, DT, G, volumeOf } from '../simulation';
import { ShedBuild } from '../shed';
import { Wind } from '../wind';
import { germanHouseDefinition, germanHouseScenario, HOUSE } from '../german-house';
await initialize();
const def = germanHouseDefinition(), sim = new Simulation(germanHouseScenario(), DT), build = new ShedBuild(sim, def);
const stages: unknown[] = [];
const started = performance.now();
let stage = -1, stageStart = 0, stageTicks = 0;
const closeStage = () => {
  const tick = sim.ticks; sim.run(.5);
  const speeds = sim.state().map(p => Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z));
  stages.push({ stage: def.stages[stage], parts: def.plan.filter(p => p.stage === stage).length, placedParts: build.count, timeS: +sim.time.toFixed(3),
    msPerTick: +((performance.now() - stageStart) / (sim.ticks - stageTicks)).toFixed(2), bodies: sim.parts.size, joints: sim.world.impulseJoints.len(),
    failures: build.failures.length, maxAnchorErrorMm: +(build.maxAnchorError() * 1000).toFixed(4), maxSpeedMmS: +(Math.max(...speeds) * 1000).toFixed(3), settleTicks: sim.ticks - tick });
};
while (!build.complete) {
  if (build.next.stage !== stage) { if (stage >= 0) closeStage(); stage = build.next.stage; stageStart = performance.now(); stageTicks = sim.ticks; }
  build.placeNext(); sim.run(def.interval);
}
closeStage(); sim.run(2);
const drift = (id: string) => { const p = sim.parts.get(id)!, t = p.body.translation(); return +((t.y - p.spec.position.y) * 1000).toFixed(3); };
let reaction = 0; const n = Math.round(.2 / DT);
for (let i = 0; i < n; i++) { sim.step(); reaction += sim.contacts().filter(c => c.a === 'ground').reduce((s, c) => s + c.force * Math.abs(c.normal.y), 0) / n; }
const settled = { mass: +sim.mass.toFixed(3), suppliedMassKg: +build.suppliedMass.toFixed(3), plannedMassKg: +def.plan.reduce((s, p) => s + volumeOf(p.box) * p.box.density, 0).toFixed(3),
  aboveFoundationMassKg: +(sim.mass - sim.body('house-foundation').mass()).toFixed(1), groundReactionN: +reaction.toFixed(1), weightN: +(sim.mass * G).toFixed(1),
  reactionRatio: +(reaction / (sim.mass * G)).toFixed(5), failures: build.failures.length, connections: build.connections.size,
  verticalDriftMm: Object.fromEntries(['inner-leaf-upper-front', 'slab-top-2', 'rafter-pair-7', 'shingles-front-20', 'ridge-shingles', 'door-leaf-front-2'].map(id => [id, drift(id)])) };
const wind = new Wind(sim), windTrials: unknown[] = [];
for (const speed of [10, 25, 40, 60, 100]) {
  wind.configure({ enabled: true, speed, from: 'front' }); const before = build.failures.length; sim.run(.4);
  const total = [...wind.loads.values()].reduce((s, l) => s + l.force.z, 0);
  windTrials.push({ speedMS: speed, from: 'front', durationS: .4, netDragZN: +total.toFixed(1), newFailedPoints: build.failures.length - before, separatedConnections: build.failedConnections.size,
    firstFailures: build.failures.slice(before, before + 5).map(f => ({ connection: f.connection, profile: f.material, mode: f.reading.mode, utilization: +f.reading.utilization.toFixed(3) })) });
}
const record = { engine: 'Rapier 0.21.0', timestep: DT, house: HOUSE, solver: { iterations: def.solverIterations, internalPgsIterations: def.internalPgsIterations },
  parts: def.plan.length, wallClockS: +((performance.now() - started) / 1000).toFixed(1), stages, settled, windTrials, failures: build.failures.slice(0, 50) };
writeFileSync('german-house-measurements.json', JSON.stringify(record, null, 1));
console.log(JSON.stringify({ stages: (stages as {stage:string;failures:number;msPerTick:number}[]).map(s => `${s.stage}: ${s.failures} failures, ${s.msPerTick} ms/tick`), settled, windTrials: windTrials.map(w => JSON.stringify(w)) }, null, 1));
