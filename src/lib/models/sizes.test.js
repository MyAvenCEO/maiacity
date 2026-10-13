// @ts-nocheck — plain JS
// Every asset at its real size, in the one measure (units.js: 1 = 1 m): its model's outer box must match REAL_SIZES.
// Run: bun test src/lib/models/sizes.test.js
import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { REAL_SIZES } from './units.js';

// textures are drawn on a canvas; outside a page a stand-in canvas takes every call and draws nothing
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
import { batteryPack, pickup, powercube, solarPanel } from './village.js';
import { busStop, gasStation, oldShed, travelVan } from './wayside.js';
import { person, tent } from '../maiacity-v1/world.js';

// a player is measured without the heart that floats over them
const bare = (o) => (o.remove(o.userData.glow), o);
const BUILD = { pickup, powercube, solarPanel, batteryPack, travelVan, busStop, gasStation, oldShed, person: () => bare(person('A')), tent };
const TOLERANCE = 0.12; // 12 %: mirrors, caps, signs and roof bags stick out a little

for (const [id, { size, what }] of Object.entries(REAL_SIZES)) {
	test(`${id} is ${size.map((x) => x.toFixed(2)).join(' × ')} m (${what})`, () => {
		const o = BUILD[id]();
		o.updateMatrixWorld(true);
		const got = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).toArray();
		if (process.env.SIZES) console.log(id, got.map((x) => x.toFixed(2)).join(' x '));
		got.forEach((g, i) => expect(Math.abs(g - size[i]) / size[i]).toBeLessThan(TOLERANCE));
		expect(o.scale.toArray()).toEqual([1, 1, 1]);
	});
}

test('the powercube fits the pickup\'s bed (1.7 m wide, 1.55 m long inside)', () => {
	const c = new THREE.Box3().setFromObject(powercube()).getSize(new THREE.Vector3());
	expect(c.x).toBeLessThan(1.7);
	expect(c.z).toBeLessThan(1.55);
});
