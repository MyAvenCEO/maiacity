// @ts-nocheck — plain JS
// A plant growing on a viewer's stage, smoothly, by the clock on the wall (./grow.js).
import { expect, test } from 'bun:test';
import { PACE, growth, stageAt, whole } from './grow.js';

const stages = { min: 0, max: 9 };

test('a plant grows on smoothly by the clock on the wall, between its stages too, and stops at its last', () => {
	const g = growth(stages, 2);
	expect(g.at).toBe(2);
	expect(g.on(0.1)).toBeCloseTo(2 + 0.1 * PACE);
	expect(whole(stageAt(g.at))).toBe(false);
	// seed to ripe in 18 s, however the frames come
	for (let t = 0; t < 20; t += 0.25) g.on(0.25);
	expect(g.at).toBe(9);
	expect(g.done).toBe(true);
});

test('one at its last stage grows again from its first; one between two stages from where it stands', () => {
	expect(growth(stages, 9).at).toBe(0);
	expect(growth(stages, 4.37).at).toBe(4.37);
	expect(growth({ min: 6, max: 9 }, 2).at).toBe(6);
});

test('a stage is named to a thousandth', () => {
	expect(stageAt(3.14159)).toBe(3.142);
	expect(whole(stageAt(4.0001))).toBe(true);
});
