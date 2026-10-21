import { afterEach, beforeAll, expect, test } from 'vitest';
import { DT, initialize, Simulation, Playback, type Box } from '../src/simulation';
import { Wind, AIR_DENSITY, DRAG_COEFFICIENT } from '../src/wind';
import { ShedBuild, shedScenario } from '../src/shed';
beforeAll(initialize);
const worlds: Simulation[] = [];
afterEach(() => worlds.splice(0).forEach(s => s.dispose()));
const panel = (id = 'panel', z = 0): Box => ({ id, size: [2, 2, .1], position: { x: 0, y: 3, z }, density: 600, material: 'Wood', friction: .6, color: 0 });
function lab(boxes = [panel()], dt = DT) {
  const sim = new Simulation({ id: 'wind', title: '', question: '', boxes }, dt); worlds.push(sim);
  sim.world.gravity = { x: 0, y: 0, z: 0 }; const wind = new Wind(sim);
  wind.configure({ enabled: true, speed: 10, from: 'front' }); return { sim, wind };
}
test('isolated panel agrees with drag equation, reverses, scales with area and speed squared', () => {
  const { sim, wind } = lab(); wind.measure();
  const expected = .5 * AIR_DENSITY * DRAG_COEFFICIENT * 100 * 4;
  expect(wind.loads.get('panel')!.force.z).toBeCloseTo(-expected, 5);
  expect(wind.loads.get('panel')!.exposedArea).toBeCloseTo(4, 6);
  wind.configure({ enabled: true, speed: 20, from: 'back' }); wind.measure();
  expect(wind.loads.get('panel')!.force.z).toBeCloseTo(expected * 4, 5);
  wind.configure({ enabled: true, speed: 100, from: 'front' }); wind.measure();
  expect(wind.settings.speed).toBe(100);
  expect(wind.loads.get('panel')!.force.z).toBeCloseTo(-expected * 100, 5);
  sim.step();
  expect(sim.body('panel').linvel().z).toBeCloseTo(-expected * 100 / sim.mass * DT, 5);
  const thin = lab([{ ...panel(), size: [1, 2, .1] }]); thin.wind.measure();
  expect(thin.wind.loads.get('panel')!.force.z).toBeCloseTo(-expected / 2, 5);
});
test('orientation and relative air velocity determine drag', () => {
  const { sim, wind } = lab();
  sim.body('panel').setRotation({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, true);
  wind.measure(); expect(wind.loads.get('panel')!.exposedArea).toBeCloseTo(.2, 5);
  sim.body('panel').setLinvel({ x: 0, y: 0, z: -10 }, true);
  wind.measure(); expect(wind.loads.get('panel')!.force.z).toBe(0);
});
test('shelter works immediately, follows moved blockers, and produces torque under partial exposure', () => {
  const blocker = { ...panel('blocker', 1), fixed: true };
  const { sim, wind } = lab([panel(), blocker]); wind.measure();
  expect(wind.loads.get('panel')!.force.z).toBe(0);
  sim.body('blocker').setTranslation({ x: 1, y: 3, z: 1 }, true); wind.measure();
  expect(wind.loads.get('panel')!.exposedArea).toBeCloseTo(2, 5);
  expect(Math.abs(wind.loads.get('panel')!.torque.y)).toBeGreaterThan(50);
  sim.body('blocker').setTranslation({ x: 10, y: 3, z: 1 }, true); wind.measure();
  expect(wind.loads.get('panel')!.exposedArea).toBeCloseTo(4, 5);
});
test('compound parts do not count internal faces as exposed', () => {
  const compound = { ...panel(), pieces: [
    { size: [2, 2, .05] as [number, number, number], offset: { x: 0, y: 0, z: -.025 } },
    { size: [2, 2, .05] as [number, number, number], offset: { x: 0, y: 0, z: .025 } },
  ] };
  const { wind } = lab([compound]); wind.measure();
  expect(wind.loads.get('panel')!.exposedArea).toBeCloseTo(4, 6);
});
test('turning wind off removes further impulses without resetting motion or mass', () => {
  const { sim, wind } = lab(); const mass = sim.mass;
  sim.step(); const velocity = sim.body('panel').linvel().z;
  expect(velocity).toBeCloseTo(-294 / mass * DT, 6);
  wind.configure({ enabled: false, speed: 10, from: 'front' }); sim.run(1);
  expect(sim.body('panel').linvel().z).toBeCloseTo(velocity, 6); expect(sim.mass).toBe(mass);
  expect(wind.loads.size).toBe(0);
});
test('wind integration converges under timestep refinement and is independent of render cadence', () => {
  const a = lab(), b = lab(), fine = lab([panel()], DT / 2);
  a.sim.run(1); fine.sim.run(1);
  expect(Math.abs(a.sim.body('panel').translation().z - fine.sim.body('panel').translation().z)).toBeLessThan(.003);
  const playback = new Playback(b.sim); playback.running = true;
  for (let i = 0; i < 20; i++) playback.advance(.05);
  expect(b.sim.state()).toEqual(a.sim.state());
});
test('wind loads a shed through physical parts and unbolted posts move through the open shoe direction', () => {
  const sim = new Simulation(shedScenario()); worlds.push(sim); const build = new ShedBuild(sim, undefined, false), wind = new Wind(sim);
  while (!sim.parts.has('door-post-left')) { build.placeNext(); sim.run(.4); }
  sim.run(1); wind.configure({ enabled: true, speed: 15, from: 'front' });
  sim.run(1); expect(build.maxAnchorError()).toBeLessThan(.015);
  const y = sim.body('door-post-left').translation().y, mass = sim.mass;
  expect(build.release('door-post-left')).toBe(1); sim.run(3);
  expect(sim.body('door-post-left').translation().y).toBeLessThan(y - .2);
  expect(build.connections.has('door-shoe-left/base-front')).toBe(true);
  expect(sim.mass).toBe(mass);
});
test('anchored shoe side plates restrain an unbolted post across the closed direction', () => {
  const sim = new Simulation(shedScenario()); worlds.push(sim); const build = new ShedBuild(sim, undefined, false), wind = new Wind(sim);
  while (!sim.parts.has('door-post-left')) build.placeNext();
  sim.run(1); build.release('door-post-left');
  wind.configure({ enabled: true, speed: 15, from: 'left' }); sim.run(3);
  expect(Math.abs(sim.body('door-post-left').rotation().z)).toBeLessThan(.02);
  expect(sim.body('door-post-left').translation().y).toBeGreaterThan(1.25);
  expect(build.connections.has('door-shoe-left/base-front')).toBe(true);
});
test('complete shed remains finite, accounts for mass and shelters its rear wall under steady wind', () => {
  const sim = new Simulation(shedScenario()); worlds.push(sim); const build = new ShedBuild(sim, undefined, false), wind = new Wind(sim);
  while (!build.complete) build.placeNext(); sim.run(1);
  const mass = sim.mass;
  wind.configure({ enabled: true, speed: 10, from: 'front' }); wind.measure();
  expect(wind.loads.get('wall-front-left-3')!.force.z).toBeLessThan(-10);
  expect(wind.loads.get('wall-back-3')!.shelteredArea).toBeGreaterThan(0);
  sim.run(1);
  expect(build.maxAnchorError()).toBeLessThan(.015); expect(sim.mass).toBe(mass);
  for (const p of sim.state()) for (const n of Object.values(p.position)) expect(Number.isFinite(n)).toBe(true);
  expect(wind.record().events[0].tick).toBe(120);
});
