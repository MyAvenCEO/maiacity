import { beforeAll, expect, test } from 'vitest';
import { initialize, Simulation, type Box } from '../src/simulation';
import { Wind, WIND_DIRECTIONS } from '../src/wind';
import { ReferenceWind } from './helpers/reference-wind';
import { domeDefinition, domeScenario } from '../src/dome';
import { ShedBuild, shedScenario } from '../src/shed';
beforeAll(initialize);

function compare(sim: Simulation, wind: Wind, reference: ReferenceWind) {
  // Compare every sample's impulse position and force, plus total force, torque
  // and exposed/sheltered areas. Matching totals alone could hide local errors.
  expect(wind.measure()).toEqual(reference.measure());
  expect([...wind.loads]).toEqual([...reference.loads]);
}

test.each([8, 16])('%s m dome wind is identical to the old all-collider search', diameter => {
  const sim = new Simulation(domeScenario(diameter));
  try {
    const build = new ShedBuild(sim, domeDefinition(diameter));
    while (!build.complete) build.placeNext();
    const wind = new Wind(sim), reference = new ReferenceWind(sim);
    // Check before the first step: spatial queries must see new parts and
    // withdrawn support stands without relying on a stale physics broad phase.
    for (const from of Object.keys(WIND_DIRECTIONS) as (keyof typeof WIND_DIRECTIONS)[]) {
      const settings = { enabled: true, speed: 30, from };
      wind.configure(settings); reference.configure(settings);
      compare(sim, wind, reference);
    }
  } finally { sim.dispose(); }
}, 120000);

test('search follows translations, rotations, new blockers, motion and the 100 m ray limit', () => {
  const box = (id: string, x: number, z: number): Box => ({ id, size: [2, 2, .1], position: { x, y: 3, z }, density: 600, material: 'Wood', friction: .6, color: 0 });
  const sim = new Simulation({ id: 'equivalence', title: '', question: '', boxes: [box('target', 0, 0), ...Array.from({ length: 30 }, (_, i) => box(`blocker-${i}`, (i % 6 - 2) * 3, Math.floor(i / 6) * 3 + 1))] });
  try {
    const wind = new Wind(sim), reference = new ReferenceWind(sim);
    for (let pass = 0; pass < 8; pass++) {
      for (const [i, p] of [...sim.parts.values()].entries()) {
        const angle = pass * .17 + i * .11;
        p.body.setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) }, true);
        p.body.setTranslation({ x: p.spec.position.x + Math.sin(angle), y: p.spec.position.y, z: p.spec.position.z + pass }, true);
        p.body.setLinvel({ x: Math.cos(angle), y: .3, z: -.5 }, true);
        p.body.setAngvel({ x: .2, y: -.1, z: .3 }, true);
      }
      if (pass === 4) sim.addPart({ ...box('new-blocker', 0, 0), size: [10, 10, .5] });
      const settings = { enabled: true, speed: pass ? 25 : 0, from: (['front', 'back', 'left', 'right'] as const)[pass % 4] };
      wind.configure(settings); reference.configure(settings); compare(sim, wind, reference);
    }
    for (const p of [...sim.parts.values()].slice(1)) p.body.setTranslation({ x: 1000, y: 3, z: 0 }, true);
    sim.body('target').setTranslation({ x: 0, y: 3, z: 0 }, true);
    sim.body('target').setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    const blocker = sim.body('new-blocker'); blocker.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    for (const z of [99.9, 100.5, -1]) {
      blocker.setTranslation({ x: 0, y: 3, z }, true);
      wind.configure({ enabled: true, speed: 30, from: 'front' }); reference.configure(wind.settings);
      compare(sim, wind, reference);
    }
  } finally { sim.dispose(); }
});

test('optimized wind preserves the full release and progressive-failure trajectory', () => {
  const a = new Simulation(shedScenario()), b = new Simulation(shedScenario());
  try {
    const buildA = new ShedBuild(a), buildB = new ShedBuild(b);
    while (!buildA.complete) { buildA.placeNext(); buildB.placeNext(); }
    const wind = new Wind(a), reference = new ReferenceWind(b);
    a.run(.3); b.run(.3);
    buildA.release('door-post-left'); buildB.release('door-post-left');
    wind.configure({ enabled: true, speed: 150, from: 'front' }); reference.configure(wind.settings);
    for (let step = 0; step < 120; step++) {
      a.step(); b.step();
      expect(a.state()).toEqual(b.state());
      expect(buildA.failures).toEqual(buildB.failures);
    }
    expect(buildA.failures.length).toBeGreaterThan(0);
    expect(a.mass).toBe(b.mass);
  } finally { a.dispose(); b.dispose(); }
}, 120000);
