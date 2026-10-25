// @ts-nocheck — Bun tests, like the other V2 suites
import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { orbitTarget } from './watering.js';

test('low watering shots hand orbit a pivot on the ground, never below it', () => {
	for (const eye of [new Vector3(1.6, 0.75, -2.2), new Vector3(2.4, 1.7, 2.2)]) {
		const direction = new Vector3(0, 0.45, 0.2).sub(eye).normalize();
		const target = orbitTarget(eye, direction);
		expect(target.y).toBeGreaterThanOrEqual(0);
		expect(target.clone().sub(eye).normalize().distanceTo(direction)).toBeLessThan(1e-10);
		expect(target.distanceTo(eye)).toBeLessThan(40);
	}
});

test('level and upward shots retain their view direction', () => {
	const eye = new Vector3(3, 1.5, 2);
	for (const direction of [new Vector3(0, 0, -1), new Vector3(0, 1, -1).normalize()]) {
		expect(orbitTarget(eye, direction).distanceTo(eye.clone().addScaledVector(direction, 40))).toBeLessThan(1e-10);
	}
});
