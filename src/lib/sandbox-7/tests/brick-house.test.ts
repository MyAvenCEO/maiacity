// @ts-nocheck — run by bun test, not type-checked, as the app's other tests
import { afterEach, beforeAll, expect, test } from 'vitest';
import { initialize, Simulation, DT, G, piecesOf, volumeOf, type Box } from '../simulation';
import { ShedBuild, jointPoint } from '../shed';
import { brickHouseDefinition, brickHouseScenario, sharedFaceArea } from '../brick-house';
import { Wind } from '../wind';

beforeAll(initialize);
const worlds: Simulation[] = [];
afterEach(() => worlds.splice(0).forEach(s => s.dispose()));
const definition = brickHouseDefinition();
function lab(dt = DT) {
  const sim = new Simulation(brickHouseScenario(), dt); worlds.push(sim);
  return { sim, build: new ShedBuild(sim, definition, false) };
}
const lower = (box: Box) => box.position.y - box.size[1] / 2;
const upper = (box: Box) => box.position.y + box.size[1] / 2;

test('masonry pieces have real mass, no interpenetration, and only predeclared surface connections', () => {
  const masonry = definition.plan.filter(p => !p.box.rotation && !p.box.taper);
  const seen = new Map<string, Box>();
  const overlaps: string[] = [];
  for (const entry of masonry) {
    const a = entry.box;
    expect(a.fixed).not.toBe(true);
    expect(volumeOf(a)).toBeGreaterThan(0);
    for (const target of entry.connectTo) {
      expect(seen.has(target), `${a.id} dependency ${target}`).toBe(true);
      expect(sharedFaceArea(a, seen.get(target)!), `${a.id} / ${target}`).toBeGreaterThan(0);
      expect(() => jointPoint(a, seen.get(target)!)).not.toThrow();
    }
    for (const b of seen.values()) for (const pa of piecesOf(a)) for (const pb of piecesOf(b)) {
      if ((['x', 'y', 'z'] as const).every((axis, i) => Math.min(a.position[axis] + pa.offset[axis] + pa.size[i] / 2, b.position[axis] + pb.offset[axis] + pb.size[i] / 2)
        - Math.max(a.position[axis] + pa.offset[axis] - pa.size[i] / 2, b.position[axis] + pb.offset[axis] - pb.size[i] / 2) > 1e-7)) overlaps.push(`${a.id}/${b.id}`);
    }
    seen.set(a.id, a);
  }
  expect(overlaps).toEqual([]);
  const { sim, build } = lab();
  while (!build.complete) build.placeNext();
  expect(sim.mass).toBeCloseTo(definition.plan.reduce((m, p) => m + volumeOf(p.box) * p.box.density, 0), 2);
  expect(sim.body('foundation').isDynamic()).toBe(true);
  expect(build.connections.size).toBe(definition.plan.reduce((n, p) => n + p.connectTo.length, 0));
  sim.step();
  expect(sim.contacts().filter(c => c.a !== 'ground' && c.b !== 'ground')).toEqual([]);
});

test('each mortar batch bears on already placed material; lintels bridge only their designed openings', () => {
  const placed: Box[] = [];
  for (const { box } of definition.plan) {
    if (box.material.startsWith('Mortar')) {
      const supports = placed.filter(p => Math.abs(upper(p) - lower(box)) < 1e-7 && sharedFaceArea(box, p) > 1e-7);
      expect(supports.length, `${box.id} has a bearing underneath`).toBeGreaterThan(0);
    }
    placed.push(box);
  }
  for (const name of ['window', 'door']) {
    const lintel = definition.plan.find(p => p.box.id === `${name}-lintel`)!;
    expect(lintel.connectTo).toEqual([`${name}-lintel-bed-1`, `${name}-lintel-bed-2`]);
    for (const id of lintel.connectTo) {
      const bed = definition.plan.find(p => p.box.id === id)!;
      expect(sharedFaceArea(lintel.box, bed.box)).toBeCloseTo(.04, 8);
      expect(bed.connectTo.length).toBeGreaterThan(0);
    }
    const opening = { id: 'clear-opening', size: [.799, name === 'door' ? 1.999 : .799, .199], position: { x: 0, y: name === 'door' ? 1.2 : 1.4, z: name === 'door' ? 1.1 : -1.1 } };
    const hits = definition.plan.filter(({ box: b }) => !b.rotation && !b.taper && (['x', 'y', 'z'] as const).every((axis, i) =>
      Math.abs(b.position[axis] - opening.position[axis]) < (b.size[i] + opening.size[i]) / 2 - 1e-7));
    expect(hits).toEqual([]);
  }
});

test('courses alternate corner ownership and half-module bond; steel straps touch brick and timber', () => {
  const bricks = definition.plan.filter(p => p.box.material.startsWith('Clay'));
  const row1 = bricks.filter(p => p.box.id.startsWith('left-course-1-brick'));
  const row2 = bricks.filter(p => p.box.id.startsWith('left-course-2-brick'));
  expect(row1).toHaveLength(6); expect(row2).toHaveLength(5);
  expect(row2[1].box.position.z - row1[1].box.position.z).toBeCloseTo(.2, 8);
  // The front end of the first corner brick reaches the outside wall face.
  const corner = row1[0].box;
  expect(corner.position.z - corner.size[2] / 2).toBeCloseTo(-1.2, 8);
  const jamb = bricks.find(p => p.box.id === 'front-course-1-brick-2')!.box;
  expect(jamb.position.x + jamb.size[0] / 2).toBeCloseTo(-.4, 8);
  const straps = definition.plan.filter(p => p.fastening === 'masonry-anchor');
  expect(straps).toHaveLength(4);
  for (const strap of straps) {
    expect(strap.connectTo.some(id => id.startsWith('plate-'))).toBe(true);
    expect(strap.connectTo.some(id => id.includes('course-11-brick'))).toBe(true);
  }
});

test.each([DT, DT / 2])('finished house carries its weight to the movable foundation at dt=%s', dt => {
  const { sim, build } = lab(dt);
  while (!build.complete) build.placeNext();
  sim.run(3);
  let reaction = 0;
  for (let i = 0; i < Math.round(.25 / dt); i++) {
    sim.step(); reaction += sim.contacts().filter(c => c.a === 'ground').reduce((n, c) => n + c.force * Math.abs(c.normal.y), 0) / Math.round(.25 / dt);
  }
  expect(reaction / (sim.mass * G)).toBeCloseTo(1, 2);
  expect(build.maxAnchorError()).toBeLessThan(.002);
  for (const { spec, body } of sim.parts.values()) {
    expect(Math.abs(body.translation().y - spec.position.y)).toBeLessThan(.005);
    expect(Math.hypot(...Object.values(body.linvel()))).toBeLessThan(.01);
  }
}, 60000);

test('a released lintel still bears on its two jambs, then falls when pushed clear', () => {
  const { sim, build } = lab();
  while (build.next?.box.id !== 'window-lintel') build.placeNext();
  build.placeNext(); sim.run(.5);
  const body = sim.body('window-lintel'), mass = sim.mass, start = body.translation().y;
  expect(build.release('window-lintel')).toBe(2);
  sim.run(.5);
  expect(body.translation().y).toBeCloseTo(start, 2);
  for (const bed of ['window-lintel-bed-1', 'window-lintel-bed-2']) {
    expect(sim.contacts().some(c => c.a === bed && c.b === 'window-lintel' && c.force > 0)).toBe(true);
    expect(sim.parts.get('window-lintel')!.collider.contactCollider(sim.parts.get(bed)!.collider, .1)!.distance).toBeGreaterThan(-.003);
  }
  body.applyImpulse({ x: 0, y: 0, z: -body.mass() * 2 }, true);
  sim.run(1);
  expect(body.translation().y).toBeLessThan(start - .5);
  expect(sim.mass).toBe(mass);
  expect(build.placeNext()).toBe(false);
}, 60000);

test('high wind acts on the assembled house and release preserves separate parts and mass', () => {
  const { sim, build } = lab();
  while (!build.complete) build.placeNext();
  sim.run(.1);
  const wind = new Wind(sim);
  wind.configure({ enabled: true, speed: 100, from: 'front' });
  wind.measure();
  const total = [...wind.loads.values()].reduce((n, load) => n + load.force.z, 0);
  expect(Number.isFinite(total)).toBe(true); expect(total).toBeLessThan(-1000);
  expect(wind.loads.get('front-course-1-brick-1')!.exposedArea).toBeGreaterThan(0);
  const mass = sim.mass, handle = sim.body('house-roofing-felt').handle;
  expect(build.release('house-roofing-felt')).toBe(10);
  sim.step();
  expect(sim.mass).toBe(mass);
  expect(sim.body('house-roofing-felt').handle).toBe(handle);
  expect(sim.state().every(p => Object.values(p.velocity).every(Number.isFinite))).toBe(true);
}, 60000);
