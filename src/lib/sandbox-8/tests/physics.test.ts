import { afterEach, beforeAll, expect, test } from 'vitest';
import { boundsY, DT, G, initialize, Playback, scenarios, Simulation } from '../src/simulation';

beforeAll(initialize);
const live: Simulation[] = [];
function make(id: string, dt = DT) {
  const s = new Simulation(scenarios().find(s => s.id === id)!, dt); live.push(s); return s;
}
afterEach(() => { live.splice(0).forEach(s => s.dispose()); });
const speed = (s: Simulation, id = 'board') => Math.hypot(...Object.values(s.body(id).linvel()));

// Criteria are declared before the first run. SI units throughout.
test('free fall agrees with analytical velocity and position; halving dt improves position', () => {
  const errors = [DT, DT / 2].map(dt => {
    const s = make('freefall', dt); s.run(.5);
    expect(Math.abs(s.body('board').linvel().y + G * .5)).toBeLessThan(.002);
    const error = Math.abs(s.body('board').translation().y - (5 - G * .5 ** 2 / 2));
    expect(error).toBeLessThan(.025);
    return error;
  });
  expect(errors[1]).toBeLessThan(errors[0]);
});

test.each([DT, DT / 2])('ground impact, settling and subsequent drift at dt=%s', dt => {
  const s = make('ground', dt);
  for (let i = 0; i < 6 / dt; i++) { s.step(); expect(boundsY(s, 'board').min).toBeGreaterThan(-.005); }
  expect(Math.abs(s.body('board').translation().y - .04)).toBeLessThan(.005);
  expect(speed(s)).toBeLessThan(.01);
  const before = s.body('board').translation(); s.run(4);
  expect(Math.hypot(...Object.keys(before).map(k => s.body('board').translation()[k as 'x'] - before[k as 'x']))).toBeLessThan(.005);
});

test.each(['supported', 'loaded'])('%s retains separate bodies, mass, contacts and correct ground reaction', id => {
  const s = make(id); const initial = s.state(); const mass = s.mass;
  s.run(3);
  let reaction = 0;
  for (let i = 0; i < 120; i++) {
    s.step();
    reaction += s.contacts().filter(c => c.a === 'ground' || c.b === 'ground').reduce((sum, c) => sum + c.force * Math.abs(c.normal.y), 0) / 120;
  }
  expect(Math.abs(reaction - mass * G) / (mass * G)).toBeLessThan(.03);
  expect(Math.abs(s.body('board').translation().y - .64)).toBeLessThan(.005);
  expect(speed(s)).toBeLessThan(.01);
  expect(s.state().map(p => [p.id, p.mass])).toEqual(initial.map(p => [p.id, p.mass]));
  const pairs = new Set(s.contacts().filter(c => c.force > .1).map(c => [c.a, c.b].sort().join('/')));
  for (const pair of ['ground/support-1', 'ground/support-2', 'board/support-1', 'board/support-2']) expect(pairs.has(pair)).toBe(true);
  if (id === 'loaded') expect(pairs.has('board/load')).toBe(true);
});

test.each(['tip-right', 'tip-left'])('%s rotates in the expected direction and lands', id => {
  for (const dt of [DT, DT / 2]) {
    const s = make(id, dt); s.run(.4);
    expect(s.body('board').rotation().z * (id === 'tip-right' ? -1 : 1)).toBeGreaterThan(.02);
    s.run(5.6);
    expect(boundsY(s, 'board').min).toBeGreaterThan(-.005);
    expect(boundsY(s, 'board').min).toBeLessThan(.01);
    expect(speed(s)).toBeLessThan(.03);
  }
});

test.each([DT, DT / 2])('incline acceleration matches Coulomb friction at dt=%s', dt => {
  const s = make('incline-slip', dt); const a = Math.PI / 9; const acceleration = G * (Math.sin(a) - .1 * Math.cos(a));
  const start = s.body('board').translation(); s.run(1);
  const velocity = s.body('board').linvel(), end = s.body('board').translation();
  const downhillSpeed = -velocity.x * Math.cos(a) - velocity.y * Math.sin(a);
  const distance = -(end.x - start.x) * Math.cos(a) - (end.y - start.y) * Math.sin(a);
  expect(Math.abs(downhillSpeed - acceleration)).toBeLessThan(.04);
  expect(Math.abs(distance - acceleration / 2)).toBeLessThan(.025);
});

test.each([DT, DT / 2])('static friction holds the incline at dt=%s', dt => {
  const s = make('incline-grip', dt); const start = s.body('board').translation(); s.run(4);
  expect(Math.abs(s.body('board').translation().x - start.x)).toBeLessThan(.01);
  expect(speed(s)).toBeLessThan(.01);
});

test('touching pieces separate; no automatic joint or object merge', () => {
  const s = make('unconnected'); const initial = s.state().map(p => [p.id, p.mass]);
  const dy = s.body('neighbor').translation().y - s.body('board').translation().y;
  s.run(3);
  expect(Math.abs(s.body('neighbor').translation().y - s.body('board').translation().y - dy)).toBeGreaterThan(.05);
  expect(s.world.impulseJoints.len()).toBe(0);
  expect(s.state().map(p => [p.id, p.mass])).toEqual(initial);
});

test.each(['supported', 'loaded', 'tip-right', 'incline-slip'])('%s repeats exactly in this runtime', id => {
  const a = make(id), b = make(id); a.run(3); b.run(3); expect(a.state()).toEqual(b.state());
});

test('pause, single steps, render frequency, speed and reset preserve simulation-time results', () => {
  const reference = make('loaded'); reference.run(2);
  for (const hz of [30, 60, 144]) {
    const s = make('loaded'); const playback = new Playback(s);
    playback.advance(100); expect(s.ticks).toBe(0);
    playback.running = true;
    for (let i = 0; i < 2 * hz; i++) playback.advance(1 / hz);
    expect(s.state()).toEqual(reference.state()); expect(s.ticks).toBe(reference.ticks);
  }
  const fast = make('loaded'); const p = new Playback(fast); p.running = true; p.speed = 2;
  for (let i = 0; i < 60; i++) p.advance(1 / 60);
  expect(fast.state()).toEqual(reference.state());
  const stepped = make('loaded'); for (let i = 0; i < 240; i++) stepped.step();
  expect(stepped.state()).toEqual(reference.state());
  expect(make('loaded').state()).toEqual(make('loaded').state());
});

test.each(['supported', 'loaded'])('%s remains stable with a smaller timestep', id => {
  const a = make(id), b = make(id, DT / 2); a.run(4); b.run(4);
  for (const [name, part] of a.parts) {
    expect(Math.hypot(part.body.translation().x - b.body(name).translation().x,
      part.body.translation().y - b.body(name).translation().y, part.body.translation().z - b.body(name).translation().z)).toBeLessThan(.005);
  }
});

test('all presets begin without overlap and use cuboid mass and inertia', () => {
  for (const preset of scenarios()) {
    const s = make(preset.id); const parts = [...s.parts.values()];
    for (const { spec, body } of parts.filter(p => !p.spec.fixed)) {
      const [x, y, z] = spec.size; const mass = x * y * z * spec.density;
      expect(Math.abs(body.mass() - mass)).toBeLessThan(.0001);
      const inertia = body.principalInertia();
      for (const [actual, expected] of [[inertia.x, mass * (y * y + z * z) / 12], [inertia.y, mass * (x * x + z * z) / 12], [inertia.z, mass * (x * x + y * y) / 12]])
        expect(Math.abs(actual - expected)).toBeLessThan(.0001);
    }
    for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
      const contact = parts[a].collider.contactCollider(parts[b].collider, 0);
      expect(contact?.distance ?? 0).toBeGreaterThan(-.0001);
    }
  }
});

test.each([-1, 1])('small offsets around the support edge distinguish stability and tipping, side %s', sign => {
  for (const dt of [DT, DT / 2]) {
    for (const [offset, shouldTip] of [[.925, false], [1.025, true]] as const) {
      const preset = scenarios()[0]; preset.boxes.find(p => p.id === 'board')!.position.x = sign * offset;
      const s = new Simulation(preset, dt); live.push(s); s.run(6);
      if (shouldTip) expect(boundsY(s, 'board').min).toBeLessThan(.01);
      else { expect(Math.abs(s.body('board').translation().y - .64)).toBeLessThan(.005); expect(speed(s)).toBeLessThan(.01); }
    }
  }
});

test('limiting work per rendered frame preserves the fixed-step backlog', () => {
  const sim = make('freefall'), playback = new Playback(sim);
  playback.running = true;
  playback.advance(10 * DT, 2);
  expect(sim.ticks).toBe(2);
  for (let i = 0; i < 4; i++) playback.advance(0, 2);
  expect(sim.ticks).toBe(10);
});
