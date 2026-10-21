import RAPIER from '@dimforge/rapier3d-compat';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { DT, G, initialize, Simulation, boundsY, verticesOf, rotationOf, inverseRotation, transform, volumeOf } from '../src/simulation';
import { jointPoint, shedPlan, shedScenario, ShedBuild, STAGES, ROOF_PITCH, roofUndersideY } from '../src/shed';

beforeAll(initialize);
const worlds: Simulation[] = [];
afterEach(() => worlds.splice(0).forEach(s => s.dispose()));
function lab(dt = DT) { const sim = new Simulation(shedScenario(), dt); worlds.push(sim); return { sim, build: new ShedBuild(sim, undefined, false) }; }

test('roof bearings fill the slope and pitched boards drain geometrically away from the doorway', () => {
  const { sim, build } = lab();
  while (!build.complete) build.placeNext();
  const supports = build.plan.filter(p => p.box.taper);
  expect(supports).toHaveLength(7);
  for (const { box } of supports) {
    const vertices = verticesOf(box).map(p => transform(p, rotationOf(box), box.position));
    for (const p of vertices) expect(Math.min(Math.abs(p.y - 2.54), Math.abs(p.y - roofUndersideY(p.z)))).toBeLessThan(1e-9);
    expect(sim.body(box.id).mass()).toBeCloseTo(volumeOf(box) * box.density, 4);
  }
  const roof = build.plan.filter(p => p.box.id.startsWith('roof-board-'));
  for (const { box } of roof) {
    // Both long underside edges bear on the same plane as the firring tops.
    for (const x of [-box.size[0] / 2, box.size[0] / 2]) for (const z of [-box.size[2] / 2, box.size[2] / 2]) {
      const p = transform({ x, y: -box.size[1] / 2, z }, rotationOf(box), box.position);
      expect(p.y).toBeCloseTo(roofUndersideY(p.z), 9);
    }
    const n = transform({ x: 0, y: 1, z: 0 }, rotationOf(box), { x: 0, y: 0, z: 0 });
    const downhillZ = G * n.y * n.z; // gravity minus its normal component
    expect(downhillZ).toBeLessThan(0);
    expect(Math.atan2(-n.z, n.y)).toBeCloseTo(ROOF_PITCH, 9);
  }
  sim.run(3);
  // Fixed connections must preserve the authored pitch, not flatten the deck.
  for (const { box } of roof) expect(sim.body(box.id).rotation().x).toBeCloseTo(rotationOf(box).x, 3);
});

test('continuous felt covers every roof board and the gaps, with a separate accounted mass and bonds', () => {
  const { sim, build } = lab();
  while (!build.complete) build.placeNext();
  const felt = sim.parts.get('roofing-felt')!;
  expect(felt.spec.waterBarrier).toBe(true);
  expect(felt.body.mass()).toBeCloseTo(3.24 * 2.696 * .004 * 1000, 4);
  const boardParts = [...sim.parts.values()].filter(p => p.spec.id.startsWith('roof-board-'));
  const coveredZ: number[] = [];
  for (const { spec } of boardParts) for (const x of [-spec.size[0] / 2, spec.size[0] / 2]) for (const z of [-spec.size[2] / 2, spec.size[2] / 2]) {
    const world = transform({ x, y: spec.size[1] / 2, z }, rotationOf(spec), spec.position);
    const local = transform({ x: world.x - felt.spec.position.x, y: world.y - felt.spec.position.y, z: world.z - felt.spec.position.z }, inverseRotation(rotationOf(felt.spec)), { x: 0, y: 0, z: 0 });
    expect(local.y).toBeCloseTo(-felt.spec.size[1] / 2, 9);
    expect(Math.abs(local.x)).toBeLessThanOrEqual(felt.spec.size[0] / 2 + 1e-9);
    expect(Math.abs(local.z)).toBeLessThanOrEqual(felt.spec.size[2] / 2 + 1e-9);
    coveredZ.push(local.z);
  }
  expect(Math.min(...coveredZ)).toBeCloseTo(-felt.spec.size[2] / 2, 9);
  expect(Math.max(...coveredZ)).toBeCloseTo(felt.spec.size[2] / 2, 9);
  // A single cuboid spans the whole interval, including all nine deck gaps.
  expect(felt.colliders).toHaveLength(1);
  const bonds = [...build.connections.values()].filter(c => c.a === 'roofing-felt');
  expect(bonds.map(c => c.b)).toEqual(boardParts.map(p => p.spec.id));
  expect(bonds.every(c => c.fastening === 'felt-bond')).toBe(true);
  expect(build.plan.at(-1)!.stage).toBe(STAGES.length - 1);
});

test('released felt remains a movable material and falls once pushed clear of its deck', () => {
  const { sim, build } = lab();
  while (!build.complete) build.placeNext();
  sim.run(1);
  const body = sim.body('roofing-felt'), mass = sim.mass, height = body.translation().y;
  expect(build.release('roofing-felt')).toBe(10);
  body.applyImpulse({ x: 250, y: 0, z: 0 }, true);
  sim.run(2);
  expect(body.translation().y).toBeLessThan(height - .5);
  expect(sim.mass).toBe(mass);
});

test('first four rails meet only at inner vertical edges and leave exact post sockets', () => {
  const { sim, build } = lab();
  for (let i = 0; i < 4; i++) { build.placeNext(); sim.run(.4); }
  expect(build.connections.size).toBe(0);
  expect(sim.world.impulseJoints.len()).toBe(0);
  for (const side of ['left', 'right']) for (const end of ['back', 'front']) {
    const a = sim.parts.get(`base-${side}`)!.spec, b = sim.parts.get(`base-${end}`)!.spec;
    for (const [axis, dimension] of [['x', 0], ['z', 2]] as const) {
      const overlap = Math.min(a.position[axis] + a.size[dimension] / 2, b.position[axis] + b.size[dimension] / 2)
        - Math.max(a.position[axis] - a.size[dimension] / 2, b.position[axis] - b.size[dimension] / 2);
      expect(Math.abs(overlap)).toBeLessThan(1e-9);
    }
    const post = build.plan.find(p => p.box.id === `post-${side}-${end}`)!;
    expect(post.box.size).toEqual([.12, 2.39, .12]);
    expect(post.box.position.y - post.box.size[1] / 2).toBe(0);
    expect(post.connectTo).toEqual([a.id, b.id]);
    const patchA = jointPoint(post.box, a), patchB = jointPoint(post.box, b);
    expect(patchA.y).toBeCloseTo(.075); expect(patchB.y).toBeCloseTo(.075);
    // Post outer faces coincide exactly with the frame's outer footprint.
    expect(Math.abs(post.box.position.x) + .06).toBe(1.5);
    expect(Math.abs(post.box.position.z) + .06).toBe(1.2);
  }
});

test('notched end floor boards keep their identity, account for removed volume and clear the posts', () => {
  const { sim, build } = lab();
  while (build.next?.stage < 3) build.placeNext();
  for (const name of ['floor-board-1', 'floor-board-8']) {
    const part = sim.parts.get(name)!;
    expect(part.colliders.length).toBe(name === 'floor-board-8' ? 6 : 3);
    expect(part.body.mass()).toBeCloseTo((3 * .04 * .296 - 2 * .12 * .118 * .04 - (name === 'floor-board-8' ? 2 * .112 * .118 * .04 : 0)) * 600, 4);
    for (const post of [...sim.parts.values()].filter(p => p.spec.id.startsWith('post-')))
      for (const collider of part.colliders) expect(collider.contactCollider(post.collider, 0)?.distance ?? 0).toBeGreaterThan(-.0001);
  }
  for (const connection of build.connections.values()) if (connection.a.startsWith('post-')) {
    expect(connection.b.startsWith('base-')).toBe(true);
    expect(connection.fastening).toBe('post-to-rail-screw-group');
  }
});

test('doorway shoes bear on the frame through floor cutouts and posts attach to their side plates', () => {
  const { sim, build } = lab();
  while (build.next?.stage < 3) build.placeNext();
  for (const side of ['left', 'right']) {
    const shoe = sim.parts.get(`door-shoe-${side}`)!, post = sim.parts.get(`door-post-${side}`)!;
    const shoeEntry = build.plan.findIndex(p => p.box.id === shoe.spec.id), postEntry = build.plan.findIndex(p => p.box.id === post.spec.id);
    expect(shoeEntry).toBeLessThan(postEntry);
    expect(build.plan[shoeEntry].connectTo).toEqual(['base-front']);
    expect(build.plan[postEntry].connectTo).toEqual([shoe.spec.id]);
    expect(shoe.colliders).toHaveLength(3);
    expect(shoe.body.mass()).toBeCloseTo((.112 * .006 * .12 + 2 * .006 * .294 * .12) * 7850, 4);
    expect(boundsY(sim, shoe.spec.id).min).toBeCloseTo(.15, 6);
    expect(boundsY(sim, post.spec.id).min).toBeCloseTo(.156, 6);
    const railConnection = build.connections.get(`${shoe.spec.id}/base-front`)!;
    const postConnection = build.connections.get(`${post.spec.id}/${shoe.spec.id}`)!;
    expect(railConnection.fastening).toBe('shoe-to-frame-screw-group');
    expect(postConnection.fastening).toBe('post-to-shoe-bolt-group');
    const point = transform(postConnection.anchorA, rotationOf(post.spec), post.spec.position);
    expect(Math.abs(point.x - post.spec.position.x)).toBeCloseTo(.05, 9);
    expect(point.y).toBeCloseTo(.303, 9);
    for (const c of shoe.colliders) for (const floor of sim.parts.get('floor-board-8')!.colliders)
      expect(c.contactCollider(floor, 0)?.distance ?? 0).toBeGreaterThan(-.0001);
  }
});

test('unbolting the first doorway post permits tipping without removing its shoe or material', () => {
  const { sim, build } = lab();
  while (!sim.parts.has('door-post-left')) { build.placeNext(); sim.run(.4); }
  sim.run(1);
  const post = sim.body('door-post-left'), mass = sim.mass, y = post.translation().y;
  expect(build.release('door-post-left')).toBe(1);
  expect(build.connections.has('door-shoe-left/base-front')).toBe(true);
  post.applyImpulseAtPoint({ x: 0, y: 0, z: -12 }, { x: -.46, y: 2.2, z: 1.15 }, true);
  sim.run(2);
  expect(post.translation().y).toBeLessThan(y - .2);
  expect(sim.mass).toBe(mass);
  expect(sim.body('door-shoe-left').translation().y).toBeCloseTo(.3, 2);
});

test('recipe has ordered dependencies, touching joint faces, no overlapping parts, and an open doorway', () => {
  const plan = shedPlan(), known = new Map();
  const sim = new Simulation({ ...shedScenario(), boxes: [...shedScenario().boxes, ...plan.map(p => p.box)] }); worlds.push(sim);
  for (const part of plan) {
    for (const target of part.connectTo) { expect(known.has(target)).toBe(true); expect(() => jointPoint(part.box, known.get(target))).not.toThrow(); }
    known.set(part.box.id, part.box);
  }
  const parts = [...sim.parts.values()];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++)
    for (const a of parts[i].colliders) for (const b of parts[j].colliders)
      expect(a.contactCollider(b, 0)?.distance ?? 0, `${parts[i].spec.id}/${parts[j].spec.id}`).toBeGreaterThan(-.0001);
  // A 0.8 m wide, 1.8 m tall opening from floor level must stay clear.
  const door = sim.world.createCollider(RAPIER.ColliderDesc.cuboid(.4, .9, .1).setTranslation(0, 1.1, 1.2).setSensor(true));
  for (const part of parts) for (const collider of part.colliders) expect(collider.contactCollider(door, 0)?.distance ?? 0, part.spec.id).toBeGreaterThan(-.0001);
});

test.each([DT, DT / 2])('every construction stage remains supported and accounts for material, dt=%s', dt => {
  const { sim, build } = lab(dt);
  for (let stage = 0; stage < STAGES.length; stage++) {
    while (build.next?.stage === stage) {
      const existing = [...sim.parts].map(([id, part]) => [id, part.body.handle]);
      build.placeNext();
      for (const [id, handle] of existing) expect(sim.body(id as string).handle).toBe(handle);
      sim.run(.4);
      expect(Math.abs(sim.mass - build.suppliedMass)).toBeLessThan(.002);
      expect(sim.parts.size).toBe(build.count + 1);
    }
    sim.run(1);
    expect(build.maxAnchorError(), STAGES[stage]).toBeLessThan(.015);
    for (const { spec, body } of sim.parts.values()) {
      if (spec.fixed) { expect(spec.id).toBe('ground'); continue; }
      expect(body.isDynamic()).toBe(true);
      expect(boundsY(sim, spec.id).min).toBeGreaterThan(-.005);
      expect(Math.hypot(...Object.values(body.linvel())), spec.id).toBeLessThan(.04);
      expect(Math.abs(body.translation().y - spec.position.y), spec.id).toBeLessThan(.02);
    }
    expect(sim.contacts().some(c => c.a === 'ground' && c.force > 1)).toBe(true);
  }
  expect(build.complete).toBe(true); expect(build.placeNext()).toBe(false);
  let reaction = 0;
  for (let i = 0; i < Math.round(1 / dt); i++) {
    sim.step(); reaction += sim.contacts().filter(c => c.a === 'ground').reduce((sum, c) => sum + c.force * Math.abs(c.normal.y), 0) * dt;
  }
  expect(Math.abs(reaction - sim.mass * G) / (sim.mass * G)).toBeLessThan(.03);
}, 30000);

test('released wall plank retains its mass and can be pushed clear of contact support', () => {
  const { sim, build } = lab();
  while (build.next?.stage <= 3) { build.placeNext(); sim.run(.4); }
  sim.run(1); const mass = sim.mass, count = sim.parts.size, initial = sim.body('wall-left-5').translation().y;
  expect(build.release('wall-left-5')).toBe(2);
  // It can still rest on the plank below; supply an explicit outward test impulse.
  sim.body('wall-left-5').applyImpulse({ x: -20, y: 0, z: 0 }, true);
  sim.run(3);
  expect(sim.body('wall-left-5').translation().y).toBeLessThan(initial - .1);
  expect(sim.mass).toBe(mass); expect(sim.parts.size).toBe(count);
  expect(build.placeNext()).toBe(false);
  expect(build.record().events.at(-1)?.massInKg).toBe(0);
}, 30000);

test('fixed joints preserve relative pose but do not anchor a falling assembly; release permits separation', () => {
  const sim = new Simulation({ id: 'joint', title: '', question: '', boxes: ['a', 'b'].map((id, i) => ({ id, size: [.4, .4, .4], position: { x: i * .4, y: 4, z: 0 }, density: 600, material: 'wood', friction: .6, color: 0 })) }); worlds.push(sim);
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const joint = sim.world.createImpulseJoint(RAPIER.JointData.fixed({ x: .2, y: 0, z: 0 }, identity, { x: -.2, y: 0, z: 0 }, identity), sim.body('a'), sim.body('b'), true);
  sim.run(.3);
  expect(sim.body('a').translation().y).toBeLessThan(3.6);
  expect(Math.abs(sim.body('b').translation().x - sim.body('a').translation().x - .4)).toBeLessThan(.001);
  sim.world.removeImpulseJoint(joint, true); sim.body('b').applyImpulse({ x: 38.4, y: 0, z: 0 }, true); sim.run(.2);
  expect(sim.body('b').translation().x - sim.body('a').translation().x).toBeGreaterThan(.59);
});

test('construction scheduling is tick based and stage mode stops at the stage boundary', () => {
  const a = lab(), b = lab(); a.build.start('stage'); a.sim.run(4);
  expect(a.build.count).toBe(shedPlan().filter(p => p.stage === 0).length); expect(a.build.automatic).toBe(false);
  b.build.start('stage'); for (let i = 0; i < 480; i++) b.sim.step();
  expect(a.build.record()).toEqual(b.build.record()); expect(a.sim.state()).toEqual(b.sim.state());
  a.build.start('all'); a.sim.run(30); expect(a.build.complete).toBe(true);
  expect(a.build.maxAnchorError()).toBeLessThan(.015);
  for (const { spec, body } of a.sim.parts.values()) {
    expect(Math.abs(body.translation().y - spec.position.y)).toBeLessThan(.02);
    expect(Math.hypot(...Object.values(body.linvel()))).toBeLessThan(.04);
  }
  const empty = lab(); expect(empty.build.count).toBe(0); expect(empty.sim.parts.size).toBe(1); expect(empty.build.events).toEqual([]);
}, 30000);

test.each(['rapid', 'varied'])('manual %s placement timing leaves a stable shed', cadence => {
  const { sim, build } = lab();
  while (!build.complete) {
    build.placeNext();
    sim.run(cadence === 'rapid' ? 0 : [.05, .3, .7][build.count % 3]);
  }
  sim.run(3);
  expect(build.maxAnchorError()).toBeLessThan(.015);
  for (const { spec, body } of sim.parts.values()) {
    expect(Math.abs(body.translation().y - spec.position.y)).toBeLessThan(.02);
    expect(Math.hypot(...Object.values(body.linvel()))).toBeLessThan(.04);
  }
}, 30000);
