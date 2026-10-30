// The base resources (./resources.js) and their pixels (./pixels.js): every resource is whole, in a group, gathered
// with a known tool, and paints its tiles, the same every time.
// Run: bun test maia-city/game
import { expect, test } from 'bun:test';
import { GROUPS, RESOURCES, TOOLS, resourceOf } from './resources.js';
import { SIZE, tilesOf } from './pixels.js';

const COLOUR = /^#[0-9a-f]{6}$/;

test('every resource has its own id, a name, a group, a form, where it is found and a note', () => {
	expect(new Set(RESOURCES.map((r) => r.id)).size).toBe(RESOURCES.length);
	const groups = GROUPS.map((g) => g.id);
	for (const r of RESOURCES) {
		expect(r.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
		expect(groups).toContain(r.group);
		expect(['block', 'item']).toContain(r.form);
		expect(r.name.length && r.found.length && r.note.length).toBeGreaterThan(0);
		expect(r.tool === null || r.tool in TOOLS).toBe(true);
		expect(resourceOf(r.id)).toBe(r);
	}
});

test('every group has resources, and only blocks carry a weight', () => {
	for (const g of GROUPS) expect(RESOURCES.some((r) => r.group === g.id)).toBe(true);
	for (const r of RESOURCES) {
		if (r.density !== undefined) expect(r.form).toBe('block');
		if (r.group === 'ore') expect([r.mineral, r.density, r.yields].every((v) => v !== undefined)).toBe(true);
	}
});

test('a block paints a whole top and side, an item a picture with room round it for its outline', () => {
	for (const r of RESOURCES) {
		const tiles = tilesOf(r);
		for (const pixels of Object.values(tiles)) {
			expect(pixels.length).toBe(SIZE * SIZE);
			for (const c of pixels) if (c !== null) expect(c).toMatch(COLOUR);
		}
		if ('item' in tiles) {
			const filled = tiles.item.filter((c) => c !== null).length;
			expect(filled).toBeGreaterThan(20);
			expect(filled).toBeLessThan(SIZE * SIZE);
		} else {
			expect(tiles.top.every((c) => c !== null) && tiles.side.every((c) => c !== null)).toBe(true);
		}
	}
});

test('a resource paints the same pixels every time', () => {
	for (const r of RESOURCES) expect(tilesOf(r)).toEqual(tilesOf(r));
});
