// @ts-nocheck — shared contract, exercised for every supported version.
import { expect, test } from 'bun:test';
import { travelVan } from '$lib/models/wayside.js';
export function vanContract(version, { LOWER_BODY, seeThrough }) {
test(`${version}: the minibus glass and lower body`, () => {
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

}
