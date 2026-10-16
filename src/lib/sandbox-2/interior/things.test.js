// @ts-nocheck — plain JS
// Phase 8c of the asset pipeline: the library's Things the village puts down (./things.js) stand where the village
// always stood them, in the walker's way as their builders say, at the version the village has them.
// Run: bun test src/lib/sandbox-2/interior/things.test.js
import { expect, test } from 'bun:test';

test('what of each Thing stands in the walker’s way is what its builder hands back with it', async () => {
	const { WALK, THINGS } = await import('./things.js');
	const { henDome, rabbitDome, playDome } = await import('$lib/models/minidomes.js');
	const { playground } = await import('./spaces');
	const near = (a, b) => {
		expect(a.length).toBe(b.length);
		a.forEach((p, i) => ['x', 'z', 'r'].forEach((k) => expect(p[k]).toBeCloseTo(b[i][k], 9)));
	};
	// at the library's seed, and at every seed the village once gave its own (their footprints never moved with it)
	for (const s of [3, 5, 7, 9]) near(WALK[THINGS.hens], henDome(s).colliders);
	for (const s of [4, 6, 8, 10]) near(WALK[THINGS.rabbits], rabbitDome(s).colliders);
	for (const s of [90, 91, 92]) near(WALK[THINGS.playDome], playDome(s).colliders);
	for (const s of [90, 91, 92]) near(WALK[THINGS.playground], playground(s).colliders);
});

test('the coops stand where Sandbox 4 stood its mini domes, turned as they were, in the way as they were', async () => {
	const { coopsOf, collidersAt } = await import('./things.js');
	const { coops } = await import('./spaces');
	const kit = new Proxy({}, { get: () => () => null });
	const R = 57.3;
	const ours = coopsOf(R), theirs = coops(kit, R, true);
	expect(ours.length).toBe(theirs.length);
	ours.forEach((t, i) => {
		const g = theirs[i].group;
		expect(t.x).toBeCloseTo(g.position.x, 9);
		expect(t.z).toBeCloseTo(g.position.z, 9);
		expect(t.turn).toBeCloseTo(g.rotation.y, 9);
		expect(t.ref).toBe(i % 2 === 1 ? 'things/rabbit-hutch@2' : 'things/chicken-coop@2');
		const mine = collidersAt(t.ref, t.x, t.z, t.turn);
		mine.forEach((p, j) => ['x', 'z', 'r'].forEach((k) => expect(p[k]).toBeCloseTo(theirs[i].colliders[j][k], 9)));
	});
});
