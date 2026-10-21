import { writeFileSync } from 'node:fs';
import { DT, G, initialize, scenarios, Simulation } from '../simulation';
await initialize();
const rows = scenarios().map(scenario => {
  const s = new Simulation(scenario); const mass = s.mass;
  s.run(scenario.id.startsWith('incline') ? 1 : scenario.id === 'freefall' ? .5 : 4);
  let groundReaction = 0;
  if (['supported', 'loaded'].includes(scenario.id)) {
    for (let i = 0; i < 120; i++) { s.step(); groundReaction += s.contacts().filter(c => c.a === 'ground' || c.b === 'ground').reduce((sum, c) => sum + c.force * Math.abs(c.normal.y), 0) / 120; }
  }
  const result = { scenario: scenario.id, seconds: s.time, dynamicMassKg: mass, weightN: mass * G, groundReactionMeanN: groundReaction || null, bodies: s.state(), contacts: s.contacts() };
  s.dispose(); return result;
});
writeFileSync('measurements.json', JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, dt: DT, solverIterations: 12, rows }, null, 2) + '\n');
console.table(rows.map(r => ({ scenario: r.scenario, seconds: r.seconds, massKg: r.dynamicMassKg.toFixed(3), boardY: r.bodies.find(b => b.id === 'board')!.position.y.toFixed(5), groundReactionN: r.groundReactionMeanN?.toFixed(2) ?? '—' })));
