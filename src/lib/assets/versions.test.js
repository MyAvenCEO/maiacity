// @ts-nocheck — plain JS
// One version control for every asset group ($lib/app/versions.js, ./index.js): every version listed in order, the
// latest the group's own, every older one with its own frozen builder, and every one found again by its ref.
// Run: bun test src/lib/assets/versions.test.js
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop }) };
globalThis.$state ??= (x) => x;
const { GROUPS, assetAt, parseRef, refOf } = await import('./index.js');

test('a ref is group/id@v, and its variant after a colon', () => {
	expect(parseRef('machines/powercube@3')).toEqual({ group: 'machines', id: 'powercube', v: 3, variant: undefined });
	expect(parseRef('machines/powercube@1:powercube-electric')).toEqual({ group: 'machines', id: 'powercube', v: 1, variant: 'powercube-electric' });
	expect(parseRef('plants/apple')).toEqual({ group: 'plants', id: 'apple', v: undefined, variant: undefined });
	expect(refOf('things', 'pickup', 2)).toBe('things/pickup@2');
	expect(() => parseRef('powercube')).toThrow();
});

// a world is a page: its older versions are notes alone (what it anchors are assets, versioned here)
for (const group of Object.keys(GROUPS).filter((g) => g !== 'worlds')) {
	test(`${group}: every version in order, every older one kept, every one found by its ref`, async () => {
		const list = await GROUPS[group].list();
		expect(list.length).toBeGreaterThan(0);
		for (const item of list) {
			const vs = item.versions.map((x) => x.v);
			expect(vs).toEqual([...vs].sort((a, b) => a - b));
			expect(new Set(vs).size).toBe(vs.length);
			expect(item.version).toBe(vs[vs.length - 1]);
			for (const ver of item.versions) {
				expect(ver.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				if (!ver.kept) throw new Error(`${refOf(group, item.id, ver.v)} has no frozen builder: keep the old one (a *.v${ver.v}.js file or a version argument) in its HISTORY entry`);
				const got = await assetAt(refOf(group, item.id, ver.v));
				expect(got?.version.v).toBe(ver.v);
			}
		}
	});
}

test('the Power Cube at each version builds what that version was', async () => {
	const v1 = await assetAt('machines/powercube@1:powercube-electric');
	const v3 = await assetAt('machines/powercube@3');
	expect(v1?.kept).toBe(true);
	expect(v3?.build().asset.lab.hero.label).toBe('Hydraulic power');
	expect(v1?.build().asset).toBeUndefined();
});
