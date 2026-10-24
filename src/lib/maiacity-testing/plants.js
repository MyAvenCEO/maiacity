// @ts-nocheck — compare each world's species and stages with the shared plant library.
import { describe, expect, test } from 'bun:test';
import { plantAt } from '$lib/plants/index.js';
export function plantsContract(version, { PLANT_IDS, plantOf }, SEEDLINGS) {
describe(version, () => {
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


});
}
