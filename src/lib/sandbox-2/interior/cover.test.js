// @ts-nocheck — plain JS
// Phase 8c of the asset pipeline: a floor's cover drawn by the renderer (./cover.js) stands where the stream lays it
// and grows as far as the stream's shader grows it ($lib/biomes/stream.js `coverLaid`, the Biomes explorer's sum),
// each kind the box's build at its seed; the copies put away when it is hidden or let go.
// Run: bun test src/lib/sandbox-2/interior/cover.test.js
import { expect, test } from 'bun:test';
import * as THREE from 'three';

/** a renderer that only remembers where each copy stands */
function fakeDrawn() {
	const kinds = new Map(), standing = new Set(), free = [];
	return {
		kinds,
		standing,
		use: (ref, shadows, picture) => {
			if (!kinds.has(ref)) kinds.set(ref, { key: ref, shadows, picture });
			return kinds.get(ref);
		},
		take: (k, at) => {
			const c = { kind: k, m: at.clone() };
			standing.add(c);
			return c;
		},
		move: (c, at) => void c.m.copy(at),
		give: (c) => {
			standing.delete(c);
			free.push(c);
		}
	};
}

test('the cover stands where the stream lays it, as far grown, each kind its box build at its seed', async () => {
	const { BIOMES, coverSeed } = await import('$lib/biomes/index.js');
	const { coverRef } = await import('$lib/biomes/built.js');
	const { coverLaid } = await import('$lib/biomes/stream.js');
	const { createCover } = await import('./cover.js');
	const recipe = BIOMES.find((b) => b.id === 'food-forest');
	const o = { tile: 10, reach: 28, near: 7, thin: 0.2, density: 3.4, seed: 505, open: (x, z) => Math.hypot(x - 3, z) > 2 };
	const drawn = fakeDrawn();
	const cover = createCover({ drawn, recipe, ...o });
	cover.update(4, -6, 999);
	// every kind asked for by its ref, casting no shadow and never a picture
	expect([...drawn.kinds.keys()]).toEqual(recipe.cover.map((c, i) => coverRef(c.kind, coverSeed(i, c.kind))));
	for (const k of drawn.kinds.values()) expect([k.shadows, k.picture]).toEqual([false, false]);
	const laid = coverLaid(recipe, { ...o, eye: [4, -6] });
	const refs = [...drawn.kinds.keys()];
	refs.forEach((ref, k) => {
		const mine = [...drawn.standing].filter((c) => c.kind.key === ref).map((c) => c.m.toArray());
		const theirs = [];
		for (let i = 0; i < laid[k].length; i += 16) theirs.push(Array.from(laid[k].subarray(i, i + 16)));
		const key = (a) => a.map((v) => v.toFixed(3)).join(',');
		expect(mine.map(key).sort()).toEqual(theirs.map(key).sort());
	});
	expect(cover.count()).toBe(laid.reduce((a, m) => a + m.length / 16, 0));
	expect(cover.count()).toBeGreaterThan(1000);
	// off in a dome's own ground: the same, stood where that ground lies
	const inDome = fakeDrawn();
	createCover({ drawn: inDome, recipe, ...o, at: [100, 0.03, -50] }).update(4, -6, 999);
	const a = [...drawn.standing][0].m, b = [...inDome.standing][0].m;
	expect(b.elements[12] - a.elements[12]).toBeCloseTo(100, 5);
	expect(b.elements[13] - a.elements[13]).toBeCloseTo(0.03, 5);
	expect(b.elements[14] - a.elements[14]).toBeCloseTo(-50, 5);
	// hidden, every copy put away; shown, back as it was; let go, put away
	const n = cover.count();
	cover.show(false);
	expect(drawn.standing.size).toBe(0);
	cover.show(true);
	cover.update(4, -6, 999);
	expect(cover.count()).toBe(n);
	cover.dispose();
	expect(drawn.standing.size).toBe(0);
	void THREE;
});
