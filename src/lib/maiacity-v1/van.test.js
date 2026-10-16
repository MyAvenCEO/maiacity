// @ts-nocheck — plain JS
// The van V1 rides in: its body is the library's minibus as the box builds it (things/travel-van@1), made see-through
// by finding its glass and its lower body in what was built. Held here to the builder, so a change to the minibus
// that would leave the van's lid on (or its glass dark) is seen.
import { expect, test } from 'bun:test';
import { travelVan } from '$lib/models/wayside.js';
import { LOWER_BODY, seeThrough } from './van.js';

test('the minibus: its glass made see-through, and one lower body found and its lid cut away', () => {
	const body = travelVan();
	const was = new Map();
	body.traverse((o) => o.isMesh && was.set(o, o.geometry));
	seeThrough(body);
	let cut = 0, glass = 0;
	body.traverse((o) => {
		if (!o.isMesh) return;
		if (o.geometry !== was.get(o)) {
			cut++;
			expect(o.position.y).toBeCloseTo(LOWER_BODY.y, 6);
		}
		if (o.material.transparent && o.material.opacity === 0.12) glass++;
	});
	expect(cut).toBe(1);
	expect(glass).toBeGreaterThanOrEqual(8);
});
