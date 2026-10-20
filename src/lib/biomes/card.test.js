// @ts-nocheck — plain JS
// A biome as its card says it (./card.js): each biome's numbers written into a card's catalog and read back the same,
// and a card whose numbers are no floor's refused, as a world reads a card the vault hands it.
// Run: bun test src/lib/biomes/card.test.js
import { expect, test } from 'bun:test';
import { BiomeCardError, biomeCatalog, biomeOfCard } from './card.js';
import { COVER } from './cover.js';
import { BIOMES, coverSeed } from './index.js';

const ref = (kind, i) => `biomes/cover@1:${kind}?seed=${coverSeed(i, kind)}`;
const cardOf = (b) => ({ group: 'biomes', id: b.id, version: 1, label: b.label, note: b.note, ref: `biomes/${b.id}@1`, catalog: biomeCatalog(b, { ref, label: (k) => COVER[k].label }) });

test('every biome reads back from its card as it was written', () => {
	for (const b of BIOMES) {
		const back = biomeOfCard(cardOf(b));
		expect(back.surface).toEqual(Object.fromEntries(Object.entries(b.surface).filter(([, w]) => w > 0)));
		expect(back.density).toBe(b.density);
		expect(back.cover).toEqual(b.cover.map((c, i) => ({ ...c, ref: ref(c.kind, i) })));
		expect(back.version).toBe(1);
	}
});

test('a card whose numbers are no floor’s is refused', () => {
	const b = BIOMES[0];
	/** the card with one change to its parts @param {(parts: any[]) => void} change */
	const changed = (change) => {
		const card = structuredClone(cardOf(b));
		change(card.catalog.parts);
		return card;
	};
	const spec = (parts, id, name, v) => (parts.find((p) => p.id === id).specs.find((s) => s[0] === name)[1] = v);
	const cover = `cover-${b.cover[0].kind}`;
	const bad = [
		{ ...cardOf(b), group: 'plants' },
		{ ...cardOf(b), id: 'cover' },
		changed((p) => spec(p, 'density', 'Plants a square metre', '1e9')),
		changed((p) => spec(p, 'density', 'Plants a square metre', 'many')),
		changed((p) => spec(p, cover, 'Share', '-1')),
		changed((p) => spec(p, cover, 'Ground its colonies take', '2')),
		changed((p) => (p.find((x) => x.id === cover).ref = undefined)),
		changed((p) => p.find((x) => x.assembly === 'ground').id = 'ground-lava'),
		changed((p) => p.splice(0, p.length, ...p.filter((x) => x.assembly !== 'ground'))),
		changed((p) => p.splice(0, p.length, ...p.filter((x) => x.id !== 'density'))),
		changed((p) => p.splice(0, p.length, ...p.filter((x) => x.assembly !== 'cover' || x.id === 'density')))
	];
	for (const card of bad) expect(() => biomeOfCard(card)).toThrow(BiomeCardError);
});
