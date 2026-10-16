// @ts-nocheck — plain JS
// MaiaCity V1's measures (./things.js) are what the library's builders hand back: the world lays its story out by
// them without building anything.
// Run: bun test src/lib/maiacity-v1/things.test.js
import { expect, test } from 'bun:test';

// textures are drawn on a canvas; outside a page a stand-in canvas takes every call and draws nothing
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };

const near = (a, b) => {
	expect(a.length).toBe(b.length);
	a.forEach((p, i) => Object.keys(b[i]).forEach((k) => expect(p[k]).toBeCloseTo(b[i][k], 9)));
};

test('the bus stop and the gas station stand where the MaiaCity centre stands them', async () => {
	const { CENTRE_AT } = await import('./things.js');
	const { maiaCentre } = await import('$lib/models/wayside.js');
	const [stop, station] = maiaCentre({ withVan: false, withRoad: false }).children;
	for (const [at, o] of [[CENTRE_AT.busStop, stop], [CENTRE_AT.gasStation, station]]) {
		expect(o.position.x).toBeCloseTo(at.x, 9);
		expect(o.position.y).toBeCloseTo(0, 9);
		expect(o.position.z).toBeCloseTo(at.z, 9);
		expect(o.rotation.y).toBeCloseTo(at.turn, 9);
		expect(o.rotation.x).toBeCloseTo(0, 9);
		expect(o.rotation.z).toBeCloseTo(0, 9);
	}
});

test('the pickup and the ramp measure what their builders say', async () => {
	const ours = await import('./things.js');
	const { PICKUP, RAMP } = await import('$lib/models/village.js');
	expect(ours.PICKUP.tailgate).toBe(PICKUP.tailgate);
	expect(ours.PICKUP.gate).toBe(PICKUP.gate);
	expect(ours.PICKUP.driver).toEqual(PICKUP.driver);
	expect(ours.PICKUP.passenger).toEqual(PICKUP.passenger);
	expect(ours.RAMP.rise).toBe(RAMP.rise);
	expect(ours.RAMP.run).toBe(RAMP.run);
});

test('the bell tent and its fire place measure what their builders say', async () => {
	const ours = await import('./things.js');
	const { BELL_TENT, bellTent, firePlace } = await import('$lib/models/belltent.js');
	expect(ours.BELL_TENT.R).toBe(BELL_TENT.R);
	expect(ours.BELL_TENT.guyOut).toBe(BELL_TENT.guyOut);
	expect(ours.BELL_TENT.steps).toEqual(BELL_TENT.steps);
	expect(ours.BELL_TENT.fire).toEqual({ x: BELL_TENT.fire.x, z: BELL_TENT.fire.z });
	const walk = bellTent().userData.walk;
	expect(ours.TENT_WALK.r).toBe(walk.r);
	expect(ours.TENT_WALK.door).toBe(walk.door);
	expect(ours.TENT_WALK.headroom).toBeCloseTo(walk.headroom, 12);
	near(ours.TENT_WALK.colliders, walk.colliders);
	near(ours.FIRE_WALK.colliders, firePlace().userData.walk.colliders);
});

test("the bell tent's lantern and canvas, and the fire place's light, flames and embers, as their builders make them", async () => {
	const { TENT_LAMP, TENT_CLOTH, FIRE } = await import('./things.js');
	const { bellTent, firePlace, FIRE_PLACE } = await import('$lib/models/belltent.js');
	const down = (o, path) => path.reduce((x, i) => x.children[i], o);
	const tent = bellTent();
	const lamp = tent.userData.lamp;
	expect(down(tent.getObjectByName(TENT_LAMP.part), TENT_LAMP.path)).toBe(lamp);
	expect(lamp.color.getHex()).toBe(TENT_LAMP.color);
	expect(lamp.distance).toBe(TENT_LAMP.distance);
	expect(lamp.decay).toBe(TENT_LAMP.decay);
	expect(tent.userData.canvas.emissive.getHex()).toBe(TENT_CLOTH.emissive);
	// only the canvas glows so by day
	const cloths = new Set();
	tent.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.emissive?.getHex() === TENT_CLOTH.emissive && cloths.add(m)));
	expect([...cloths]).toEqual([tent.userData.canvas]);

	const fire = firePlace();
	const { light } = fire.userData.fire;
	expect(down(fire.getObjectByName(FIRE.light.part), FIRE.light.path)).toBe(light);
	expect(light.color.getHex()).toBe(FIRE.light.color);
	expect(light.distance).toBe(FIRE.light.distance);
	expect(light.decay).toBe(FIRE.light.decay);
	expect(FIRE_PLACE.steps.light).toEqual(FIRE.catches);
	expect(Math.max(...Object.values(FIRE_PLACE.steps).map((s) => s[1]))).toBe(1);
	const glows = (hex) => {
		const s = new Set();
		fire.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.emissive?.getHex() === hex && s.add(m)));
		return [...s];
	};
	const [flame] = glows(FIRE.flame.emissive), [embers] = glows(FIRE.embers.emissive);
	expect(glows(FIRE.flame.emissive).length).toBe(1);
	expect(glows(FIRE.embers.emissive).length).toBe(1);
	// built and lit in full: the flames as opaque, the embers as bright as the world sets them
	expect(flame.opacity).toBeCloseTo(FIRE.flame.opacity, 9);
	expect(embers.emissiveIntensity).toBeCloseTo(FIRE.embers.glow, 9);
	expect(light.intensity).toBeCloseTo(2, 9);
});
