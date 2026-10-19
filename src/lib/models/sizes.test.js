// @ts-nocheck — plain JS
// Every asset at its real size, in the one measure (units.js: 1 = 1 m): its model's outer box must match REAL_SIZES.
// Run: bun test src/lib/models/sizes.test.js
import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { REAL_SIZES } from './units.js';

// textures are drawn on a canvas; outside a page a stand-in canvas takes every call and draws nothing
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
import { batteryPack, loadingRamp, pickup, powercube, solarPanel } from './village.js';
import { backpack, dugEarth, markerSticks, plantStake, seedPacket, waterBottle } from './planting.js';
import { domeTent, packedTent, storageTent, storageTentBag } from './tent.js';
import { bellTent, bellTentBag, firePlace } from './belltent.js';
import { busStop, gasStation, oldShed, travelVan } from './wayside.js';
import { pallet } from './pallet.js';
import { PLAYER_HEIGHT, wearPack } from '../maiacity-v1/world.js';
import { human } from '../actors/human.ts';
import { powerCube } from '../actors/powercube.js';
import { powerCube as powerCubeV3 } from '../machines/powercube.js';
import { van as vanMachine } from '../machines/van.js';
import { pickup as pickupMachine } from '../machines/pickup.js';
import { truck as truckMachine } from '../machines/truck.js';
import { electroCube } from '../actors/electrocube.js';
import { batteryCube } from '../actors/batterycube.js';
import { batteryPack as packModule } from '../actors/batterypack.js';
import { batteryPack as batteryPackV10 } from '../machines/batterypack.js';

// a MaiaCity V1 player as its world puts them together (the stand-in at their height, their backpack shut on its
// chest bone), without the heart that floats over them
const player = () => {
	const c = human({}, PLAYER_HEIGHT);
	wearPack(c.rig.bones.chest, backpack({ open: 0 }), c.rig.object);
	return c.rig.object;
};
const still = (c) => (c.rig.pose(c.clips.off(0)), c.rig.object);
const ose = () => still(powerCube());
const BUILD = { pickup, pickupMachine: () => pickupMachine(), vanMachine: () => vanMachine(), truckMachine: () => truckMachine(), powerCube: () => ose(), powerCubeV3: () => powerCubeV3(), electroCube: () => still(electroCube()), batteryCube: () => still(batteryCube()), batteryPack: () => still(packModule()), batteryPackV10: () => batteryPackV10(), genset: powercube, solarPanel, batteryCabinet: batteryPack, travelVan, busStop, gasStation, oldShed, person: player, tent: () => bellTent(), loadingRamp, backpack, waterBottle, seedPacket, markerSticks, plantStake, dugEarth, domeTent, tentBag: packedTent, storageTent, storageTentBag, bellTent, firePlace, bellTentBag, euroPallet: pallet };
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

test('the Power Cube fits the pickup\'s bed (1.7 m wide, 1.55 m long inside)', () => {
	for (const cube of [ose(), powerCubeV3()]) {
		const c = new THREE.Box3().setFromObject(cube).getSize(new THREE.Vector3());
		expect(c.x).toBeLessThan(1.7);
		expect(c.z).toBeLessThan(1.55);
	}
});
