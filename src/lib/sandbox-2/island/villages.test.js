// @ts-nocheck — plain JS
// A city's villages on Sandbox 1's island (./villages.js): every level as game/island/villages.ts plans it, the way
// Sandbox 2's own copy of the island laid them before there was one island.
// Run: bun test src/lib/sandbox-2/island/villages.test.js
import { describe, expect, test } from 'bun:test';
import { planFor, ringBeds, VILLAGE_PLANS } from '../../../../game/island/villages';
import { levelOf, villageKind, VILLAGE_KINDS, VILLAGES } from './villages.js';

describe("a city's villages", () => {
	test('a kind for every level, V1 … V12, and back', () => {
		expect(VILLAGE_KINDS).toEqual(VILLAGE_PLANS.map((p) => `V${p.level}`));
		expect(VILLAGE_KINDS.length).toBe(12);
		for (const k of VILLAGE_KINDS) expect(villageKind(levelOf(k))).toBe(k);
		expect(villageKind(0)).toBe('V1');
		expect(villageKind(99)).toBe('V12');
		expect(VILLAGES.kindFor(5)).toBe('V5');
	});

	test('every level lays the planned rings, outside in, the master dome last', () => {
		for (const plan of VILLAGE_PLANS) {
			const rings = VILLAGES.rings(plan.level);
			const want = /** @type {const} */ (['TENT', 'GLAMP', 'DOME3', 'DOME4']).filter((k) => plan.counts[k]).map((k) => [k, plan.counts[k]]);
			expect(rings).toEqual(plan.master ? [...want, ['DOME5', 1]] : want);
		}
		expect(VILLAGES.rings(12).at(-1)).toEqual(['DOME5', 1]);
		expect(VILLAGES.rings(1)).toEqual([['TENT', 1]]);
	});

	test('beds, camp stage and forest follow the plan', () => {
		for (const plan of VILLAGE_PLANS) {
			expect(VILLAGES.capacity(plan.level)).toBe(Math.max(ringBeds(plan), plan.master ? plan.to : 0));
			expect(VILLAGES.stage(plan.level)).toBe(plan.stage);
			expect(VILLAGES.forest(plan.level)).toBe(plan.forest);
		}
		// the whole village: 216 in the rings and 17 in the master dome
		expect(VILLAGES.capacity(12)).toBe(233);
		expect(planFor(12).forest).toBe(true);
	});

	test('laid clear of what stands, the fire kept until the master dome, no pavilion', () => {
		expect(VILLAGES.layout).toBe('clear');
		expect(VILLAGES.pieces).toEqual({ fire: [1, 4], pavilion: null });
		expect(VILLAGES.id).not.toBe('sandbox-1');
	});

	test("a fresh island's own villages name only kinds that exist", () => {
		const { hero, ring1, ring2, any, focus } = VILLAGES.demo;
		const villages = new Set(VILLAGE_KINDS);
		const works = new Set(['SOLAR', 'HEMP', 'LIFETRAC', 'POWER_CUBE', 'BAMBOO']);
		for (const k of [hero, ...ring1, ...ring2.filter(Boolean), ...focus]) expect(villages.has(k) || works.has(k)).toBe(true);
		expect(any).toBe(VILLAGE_KINDS);
		expect(ring1.length).toBe(6);
		expect(ring2.length).toBe(12);
	});
});
