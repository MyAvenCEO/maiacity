// @ts-nocheck — plain JS
// Phase 2b of the asset pipeline: every engine is frozen by its version and its BLAKE3 hash, and each asset of ours is
// a recipe file named by its own hash, which builds on the latest engine what the page builds (./engines.js,
// ./recipes.js, ./box/plugin.js, ./box/engine.js).
// Run: bun test src/lib/assets/engines.test.js
//      ALL_ASSETS=1 bun test src/lib/assets/engines.test.js   (every recipe, every version, every variant)
import { expect, test } from 'bun:test';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;
const { LATEST, recipeFile } = await import('./engines.js');
const { hashText } = await import('./box/plugin.js');
const { bundleRecipes } = await import('./testing/recipes.js');
const { MODULES } = await import('./box/modules.js');
const { objectAt } = await import('./index.js');
const { buildWith, refOf } = await import('./refs.js');
const { trianglesOf } = await import('./card.js');

// every box engine frozen, and the source as it is now the latest: ../sandbox/engines.test.js, with every other kind

const made = await bundleRecipes();

test('each asset, version and variant is a recipe of its own, named by the hash of its bytes', () => {
	const { index, libraries } = made;
	const hashes = Object.keys(index.recipes);
	expect(hashes.length).toBeGreaterThan(300);
	expect(new Set(Object.values(index.labels)).size).toBe(hashes.length);
	expect(index.engine).toBe(LATEST.v);
	for (const [hash, at] of Object.entries(index.recipes).slice(0, 40)) {
		expect(hashText(recipeFile(libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant))).toBe(hash);
		expect(index.labels[at.label]).toBe(hash);
	}
	expect(index.recipes[index.labels['plants/apple@2']].params.map((p) => p.id)).toEqual(['stage', 'seed', 'detail', 'fruit']);
});

/** a recipe file of ours started as the engine starts it: run, handed the engine's modules */
async function start(hash) {
	const at = made.index.recipes[hash];
	let f;
	new Function('defineRecipe', recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant))((x) => (f = x));
	return f((id) => {
		if (!Object.hasOwn(MODULES, id)) throw new Error(`no module ${id}`);
		return MODULES[id];
	});
}

const SAMPLES = ['plants/apple@2', 'things/bell-tent@1', 'machines/powercube@3', 'actors/stand-in@1'];

/** a recipe file builds what the page builds from the same label */
async function same(label, given) {
	const hash = made.index.labels[label] ?? made.index.labels[`${label}:${made.index.first[label]}`];
	const { meta, build } = await start(hash);
	const ref = refOf(meta.group, meta.id, meta.version, meta.variant);
	const boxed = await buildWith({ build, params: meta.params, ref }, given);
	const paged = await objectAt(given ? `${ref}?${new URLSearchParams(given)}` : ref);
	return { boxed: trianglesOf(boxed), paged: trianglesOf(paged), ref: boxed.userData.ref };
}

test('a recipe file builds what the page builds', async () => {
	for (const label of SAMPLES) {
		const r = await same(label);
		expect(r.boxed).toBe(r.paged);
		expect(r.boxed).toBeGreaterThan(0);
	}
	const apple = await same('plants/apple@2', { seed: 'isar', stage: '6' });
	expect(apple.boxed).toBe(apple.paged);
	expect(apple.ref).toBe('plants/apple@2?detail=1&fruit=0&seed=isar&stage=6');
}, 120000);

test.skipIf(!process.env.ALL_ASSETS)('every recipe file builds what the page builds', async () => {
	const failed = [];
	for (const at of Object.values(made.index.recipes)) {
		try {
			const r = await same(at.label);
			if (r.boxed !== r.paged) failed.push(`${at.label}: ${r.boxed} triangles, not ${r.paged}`);
		} catch (err) {
			failed.push(`${at.label}: ${String(err?.message ?? err).slice(0, 100)}`);
		}
	}
	console.log(`${Object.keys(made.index.recipes).length} recipes built, ${failed.length} not the same`);
	expect(failed).toEqual([]);
}, 1_800_000);
