// @ts-nocheck — plain JS
// V5 of the avenDB migration: every recipe's card, made in the repo (./cards.js, ./cards.json), for the Maia City vault
// to keep beside the recipe. The file holds the card of each recipe the box plugin makes today, by its hash, and nothing
// else; each card fits its schema and says what the index says of its recipe; and a few, built again from their
// recipe files as the box's engine builds them, are what the file holds. While it is behind (an asset changed, so its
// recipes' hashes moved), run `bun scripts/recipe-cards.mjs`.
// Run: bun test src/lib/assets/sources/cards.test.js
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;

const { bundleRecipes } = await import('../box/plugin.js');
const { recipeFile } = await import('../engines.js');
const { checkCard } = await import('../schemas/index.js');
const { CARDS, cardOfFile } = await import('./cards.js');

const made = await bundleRecipes();
const kept = JSON.parse(readFileSync(CARDS, 'utf8'));
const AGAIN = 'run `bun scripts/recipe-cards.mjs` to make them';

/** the labels of hashes, for a message */
const labels = (hashes) => hashes.map((h) => made.index.recipes[h]?.label ?? h.slice(0, 12)).slice(0, 12).join(', ');

test('the file holds the card of every recipe of ours, by its hash, and of nothing else', () => {
	expect(kept.engine).toBe(made.index.engine);
	const want = Object.keys(made.index.recipes);
	const missing = want.filter((h) => !Object.hasOwn(kept.cards, h));
	if (missing.length) throw new Error(`cards.json has no card of ${missing.length} recipes (${labels(missing)}): ${AGAIN}`);
	const gone = Object.keys(kept.cards).filter((h) => !Object.hasOwn(made.index.recipes, h));
	if (gone.length) throw new Error(`cards.json holds ${gone.length} cards of recipes that are no more (${gone.slice(0, 4).map((h) => kept.cards[h].ref).join(', ')}): ${AGAIN}`);
	expect(Object.keys(kept.cards).length).toBe(want.length);
});

test('each card fits its schema and says what the index says of its recipe', () => {
	for (const [hash, card] of Object.entries(kept.cards)) {
		const at = made.index.recipes[hash];
		const verdict = checkCard(card);
		if (!verdict.ok) throw new Error(`${at.label}: its card does not fit: ${verdict.errors.slice(0, 3).join('; ')}`);
		expect(card.recipe).toBe(hash);
		expect(card.engine).toBe(made.index.engine);
		const label = `${card.group}/${card.id}@${card.version}${card.variant ? `:${card.variant}` : ''}`;
		expect(label).toBe(at.label);
		expect((card.params ?? []).map((p) => [p.id, p.type, p.value])).toEqual((at.params ?? []).map((p) => [p.id, p.type, p.value]));
	}
});

/** two cards alike, their numbers to a millionth of themselves (a sine may round its last bit otherwise elsewhere) */
function alike(a, b, at = 'card') {
	if (typeof a === 'number' && typeof b === 'number') {
		if (Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))) throw new Error(`${at}: ${a} is not ${b}`);
		return;
	}
	if (a && b && typeof a === 'object' && typeof b === 'object') {
		expect(Array.isArray(a)).toBe(Array.isArray(b));
		expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
		for (const k of Object.keys(a)) alike(a[k], b[k], `${at}.${k}`);
		return;
	}
	expect(a).toEqual(b);
}

// one of each group, the stand-in, and two whose card is a rig's catalog
const SAMPLES = ['plants/apple@2', 'things/bell-tent@1', 'machines/powercube@3:powercube-7s', 'machines/lifetrac@1:lifetrac-v25', 'biomes/cover@1:fern', 'buildings/container-kitchen@1', 'actors/stand-in@11:stand-in', 'actors/goat@1:goat-boer'];

test('a card built again from its recipe file, as the box builds it, is the one the file holds', async () => {
	for (const label of SAMPLES) {
		const hash = made.index.labels[label];
		if (!hash) throw new Error(`no recipe ${label}: name another sample`);
		const at = made.index.recipes[hash];
		const card = await cardOfFile(recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant), hash, made.index.engine);
		alike(card, kept.cards[hash], label);
	}
}, 120000);
