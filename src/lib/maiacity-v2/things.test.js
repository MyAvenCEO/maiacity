// @ts-nocheck — plain JS
// MaiaCity V2's measures (./things.js) are what the library's builders hand back: the world lays its story out by
// them without building anything.
// Run: bun test src/lib/maiacity-v2/things.test.js
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

test("the bell tent's lantern and canvas, its bag's parts and where the fire place catches, as their builders make them", async () => {
	const { TENT_LAMP, TENT_CLOTH, BAG_PARTS, FIRE_CATCHES } = await import('./things.js');
	const { bellTent, bellTentBag, FIRE_PLACE } = await import('$lib/models/belltent.js');
	const down = (o, path) => path.reduce((x, i) => x.children[i], o);
	const tent = bellTent();
	expect(down(tent.getObjectByName(TENT_LAMP.part), TENT_LAMP.path)).toBe(tent.userData.lamp);
	expect(tent.userData.canvas.emissive.getHex()).toBe(TENT_CLOTH.emissive);
	// only the canvas glows so by day
	const cloths = new Set();
	tent.traverse((o) => o.isMesh && [].concat(o.material).forEach((m) => m.emissive?.getHex() === TENT_CLOTH.emissive && cloths.add(m)));
	expect([...cloths]).toEqual([tent.userData.canvas]);
	const bag = bellTentBag();
	expect(bag.children.slice(-BAG_PARTS.length)).toEqual(BAG_PARTS.map((id) => bag.userData.parts[id]));
	expect(FIRE_PLACE.steps.light).toEqual(FIRE_CATCHES);
	expect(Math.max(...Object.values(FIRE_PLACE.steps).map((s) => s[1]))).toBe(1);
});

test("the bell tent's work as it is pitched, where its builder has it", async () => {
	const { tentWork } = await import('./things.js');
	const { bellTent } = await import('$lib/models/belltent.js');
	const work = bellTent().userData.work;
	for (let i = 0; i <= 20000; i++) {
		const k = i / 20000, a = tentWork(k), b = work(k);
		expect(a.x).toBeCloseTo(b.x, 9);
		expect(a.y).toBeCloseTo(b.y, 9);
		expect(a.z).toBeCloseTo(b.z, 9);
	}
});

test("the plant stake's flag, and the open backpack's bottle, cap and packets, as their builders make them", async () => {
	const { STAKE_FLAG, PACK_PACKETS, BOTTLE_MOUTH, stakeRef } = await import('./things.js');
	const { plantStake, backpack, SEED_PACKETS, BOTTLE } = await import('$lib/models/planting.js');
	const stake = plantStake({ name: 'Samuel', seed: 'apple' });
	expect(STAKE_FLAG.path.reduce((x, i) => x.children[i], stake)).toBe(stake.userData.flag);
	expect(stakeRef('Ana Lu', 'pear')).toBe('things/plant-stake@2?name=Ana+Lu&seed=pear');
	expect(PACK_PACKETS).toEqual(Object.keys(SEED_PACKETS));
	expect(BOTTLE_MOUTH).toBe(BOTTLE.mouth);
	const pack = backpack();
	const first = (n) => {
		let f = null;
		pack.traverse((o) => !f && o.name === n && (f = o));
		return f;
	};
	expect(first('inside')).toBe(pack.userData.inside);
	expect(first('water-bottle')).toBe(pack.userData.bottle);
	expect(first('cap')).toBe(pack.userData.bottle.userData.cap);
	expect(pack.userData.bottle.userData.mouth.toArray()).toEqual([0, BOTTLE_MOUTH, 0]);
	for (const id of PACK_PACKETS) expect(first(`seed-packet:${id}`)).toBe(pack.userData.packets[id]);
	expect(Object.keys(pack.userData.packets)).toEqual(PACK_PACKETS);
});

test("the people: the stand-in's ref, built with their height and look, and its walk's round", async () => {
	const { STAND_IN, WALK_CYCLE, standInRef } = await import('./things.js');
	const { FAMILIES } = await import('$lib/actors');
	const { human } = await import('$lib/actors/human.ts');
	expect(standInRef(1.8, { trousers: '#5b5145', shirt: '#3f6f9a' })).toBe(`${STAND_IN}?height=1.8&shirt=%233f6f9a&trousers=%235b5145`);
	// the version it names builds human(look, height): its params in their order, after its height
	const fam = FAMILIES.find((f) => f.id === 'stand-in');
	const v = Number(STAND_IN.split('@')[1]);
	const at = fam.versions.find((x) => x.v === v);
	expect(at?.kept).toBe(true);
	expect(fam.params[0]).toMatchObject({ id: 'height', type: 'number', min: 1, max: 2.2 });
	const look = { face: 'woman', skin: '#b07a56', hair: 'long', hairColour: '#3b2418', shirt: '#4f6b3a' };
	const args = fam.params.slice(1).map((p) => look[p.id] ?? p.value);
	const boxed = at.build[0].make(1.66, ...args).rig.object, paged = human(look, 1.66).rig.object;
	expect(Array.from(boxed.geometry.attributes.position.array)).toEqual(Array.from(paged.geometry.attributes.position.array));
	expect(Array.from(boxed.geometry.attributes.color?.array ?? [])).toEqual(Array.from(paged.geometry.attributes.color?.array ?? []));
	expect(boxed.skeleton.bones.map((b) => b.position.toArray())).toEqual(paged.skeleton.bones.map((b) => b.position.toArray()));
	expect(Object.keys(boxed.morphTargetDictionary)).toEqual(['joy', 'friendly']);
	// its walk comes round every WALK_CYCLE seconds of its clip: V1 plays it within one round
	const walk = human({}, 1.8).clips.walk;
	for (const t of [0, 0.13, 0.5, 0.77, 1.01, 3.3]) {
		const a = walk(t), b = walk(t + WALK_CYCLE), c = walk(t + 7 * WALK_CYCLE);
		for (const k of Object.keys(a)) a[k].forEach((x, i) => (expect(b[k][i]).toBeCloseTo(x, 9), expect(c[k][i]).toBeCloseTo(x, 9)));
	}
	// and nowhere sooner: half a round on, the legs are the other way round
	expect(walk(0.25 + WALK_CYCLE / 2).thighL[0]).toBeCloseTo(-walk(0.25).thighL[0], 9);
}, 60000);
