// @ts-nocheck — plain JS
// The first trees' plants as MaiaCity V1 reads them (./plants.js) are the Plants' own: every seed a tree may grow
// from, every version of it, its name and its stages' days and names.
// Run: bun test src/lib/maiacity-v1/plants.test.js
import { expect, test } from 'bun:test';
import { PLANT_IDS, plantOf, plantRef } from './plants.js';
import { plantAt } from '$lib/plants/index.js';
import { SEEDLINGS } from '../../../game/maiacity-v1/engine.js';

test('every seed a newcomer plants is here', () => {
	for (const s of SEEDLINGS) expect(PLANT_IDS).toContain(s.id);
});

test('each plant, at each of its versions and at none, is the Plants’ own', () => {
	for (const id of PLANT_IDS) {
		const latest = plantAt(id);
		expect(plantOf(id).version).toBe(latest.version);
		for (let v = 1; v <= latest.version + 1; v++) {
			const theirs = plantAt(id, v) ?? latest;
			const ours = plantOf(id, v);
			expect(ours.version).toBe(theirs.version);
			expect(ours.label).toBe(theirs.label);
			expect(ours.stages).toEqual(theirs.stages.map((s) => ({ day: s.day, name: s.name })));
		}
	}
	expect(plantOf('no-such-plant')).toBeUndefined();
});

test('a tree’s ref names the plant, its version, its stage and its seed', () => {
	expect(plantRef(plantOf('apple', 1), 3.25, 'Ada B')).toBe('plants/apple@1?stage=3.25&seed=Ada%20B');
});
