// @ts-nocheck — plain JS
// Row 2c of the asset pipeline: each asset's recipe holds its own code and nothing of another asset's. Its library is
// its group's list narrowed to it (./box/narrow.js, ./box/plugin.js), so the index lists every recipe the groups list,
// each with its parameters, as when each group was one library; and a change to one asset's code leaves every other
// asset's library as it was, and so every hash made of it.
// Run: bun test src/lib/assets/narrow.test.js
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const { bundleAsset, bundleGroup, hashText } = await import('./box/plugin.js');
const { bundleRecipes } = await import('../../../scripts/ci/recipe-fixture.mjs');
const { recipeFile } = await import('./engines.js');
const { OBJECT_GROUPS } = await import('./groups.js');

const LIB = new URL('../', import.meta.url).pathname;
const GROUPS = Object.keys(OBJECT_GROUPS);
const made = await bundleRecipes();
const wholes = Object.fromEntries(await Promise.all(GROUPS.map(async (g) => [g, await bundleGroup(g)])));

/** `f` over `xs`, four at once */
async function each(xs, f) {
	const out = [];
	let next = 0;
	await Promise.all(Array.from({ length: 4 }, async () => {
		while (next < xs.length) {
			const i = next++;
			out[i] = await f(xs[i]);
		}
	}));
	return out;
}

test('the index lists every recipe its groups list, each with its parameters, as one library per group did', () => {
	const label = (g, r) => `${g}/${r.id}@${r.v}${r.variant ? `:${r.variant}` : ''}`;
	const want = GROUPS.flatMap((g) => wholes[g].listed.map((r) => ({ label: label(g, r), params: r.meta.params })));
	const got = Object.values(made.index.recipes).map((r) => ({ label: r.label, params: r.params }));
	expect(got).toEqual(want);
	expect(got.length).toBeGreaterThan(300);
	console.log(`${got.length} recipes of ${Object.keys(made.libraries).length} assets, each asset its own library`);
	// one library for each asset, and each recipe the bytes its hash names: its asset's library and the line naming it
	expect(Object.keys(made.libraries)).toEqual(GROUPS.flatMap((g) => [...new Set(wholes[g].listed.map((r) => `${g}/${r.id}`))]));
	for (const [hash, at] of Object.entries(made.index.recipes)) expect(hashText(recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant))).toBe(hash);
});

// a change to each kind of place an asset's code is written, and the assets whose libraries it must move (`moves`);
// `may`: others it is allowed to move as well
const EDITS = [
	// a plant in a file of its own
	{ file: 'plants/strawberry.js', from: 'size: v3(0.00065, 0.00042, 0.00042)', to: 'size: v3(0.00066, 0.00042, 0.00042)', moves: ['plants/strawberry'] },
	// one tree of six in one file (mango, apple, orange, lemon, durian, jackfruit)
	{ file: 'plants/trees.js', from: "coat: '#d9c49a'", to: "coat: '#d9c49b'", moves: ['plants/mango'] },
	// a plant of a list spread into the plants' list from another module (the forest garden's)
	{ file: 'plants/wald-canopy.js', from: "coat: '#a8875a'", to: "coat: '#a8875b'", moves: ['plants/walnut'] },
	// one thing of six in one file (backpack, water bottle, seed packet, marker sticks, plant stake, dug earth)
	{ file: 'models/planting.js', from: 's.rotation.set(0.04 * sx, 0, -0.06 * sx);', to: 's.rotation.set(0.05 * sx, 0, -0.06 * sx);', moves: ['things/marker-sticks'] },
	// a machine another carries: the goods pod is loaded by forklifts built into its rig
	{ file: 'actors/forklift.js', from: 'put(block(0.76, 0.36, 0.86, [0, 0.29, -0.52], 0.08), BODY, body);', to: 'put(block(0.77, 0.36, 0.86, [0, 0.29, -0.52], 0.08), BODY, body);', moves: ['machines/forklift', 'machines/pod'] },
	// Both human builders depend on the same skin geometry.
	{ file: 'actors/human.ts', from: '[skin(0.74), skin(0.12)', to: '[skin(0.75), skin(0.12)', moves: ['actors/stand-in', 'actors/elder-woman'] },
	// an animal: every animal carries every species while ../actors/casts.ts maps them all in one object, read by id
	// as the animal is built, so it may move the other animals; never the stand-in, a machine, a thing or a plant
	{ file: 'actors/species/frog.ts', from: "const k = kind === 'common' ? 0.7 : 1;", to: "const k = kind === 'common' ? 0.71 : 1;", moves: ['actors/frog'], may: ['actors/chicken', 'actors/rabbit', 'actors/goose', 'actors/goat', 'actors/sheep', 'actors/bee', 'actors/ant', 'actors/songbird', 'actors/fish'] }
];

test('a change to one asset leaves every other asset’s library, and so its hashes, as they were', async () => {
	for (const e of EDITS) expect(readFileSync(`${LIB}${e.file}`, 'utf8').split(e.from).length).toBe(2);
	// each file changed as it is bundled, never on disk
	const edit = {
		name: 'edit',
		transform(code, id) {
			const e = EDITS.find((x) => id === `${LIB}${x.file}`);
			return e ? { code: code.replace(e.from, e.to), map: null } : null;
		}
	};
	const assets = GROUPS.flatMap((g) => [...new Set(wholes[g].listed.map((r) => r.id))].map((id) => ({ group: g, id })));
	const moved = (await each(assets, async ({ group, id }) => {
		const { code } = await bundleAsset(group, id, wholes[group], { plugins: [edit] });
		return code === made.libraries[`${group}/${id}`] ? null : `${group}/${id}`;
	})).filter(Boolean);
	const must = EDITS.flatMap((e) => e.moves);
	const may = new Set([...must, ...EDITS.flatMap((e) => e.may ?? [])]);
	console.log(`${assets.length} assets made again with ${EDITS.length} changes: ${moved.length} moved (${moved.join(', ')})`);
	for (const name of must) expect(moved).toContain(name);
	expect(moved.filter((m) => !may.has(m))).toEqual([]);
}, 300_000);

test('an asset’s library is made of its own files: a plant’s file is read by no other plant’s, so a change to it makes only that one again', () => {
	const readers = (file) => Object.entries(made.sources).filter(([name, files]) => name.startsWith('plants/') && files.includes(`${LIB}${file}`)).map(([name]) => name).sort();
	expect(readers('plants/strawberry.js')).toEqual(['plants/strawberry']);
	expect(readers('plants/jackfruit.js')).toEqual(['plants/jackfruit']);
	// a file of six trees is read by those six alone, and the plants' list by every plant
	expect(readers('plants/trees.js')).toEqual(['plants/apple', 'plants/durian', 'plants/jackfruit', 'plants/lemon', 'plants/mango', 'plants/orange']);
	expect(readers('plants/index.js').length).toBe(Object.keys(made.libraries).filter((n) => n.startsWith('plants/')).length);
	// a list spread in from another module is bundled only into the plants it lists; every other plant reads which ids
	// it lists without bundling it, and is made again only if those change
	const berries = [...readFileSync(`${LIB}plants/wald-berries.js`, 'utf8').matchAll(/^\t\tid: '([^']+)'/gm)].map((m) => `plants/${m[1]}`).sort();
	expect(berries.length).toBe(8);
	expect(readers('plants/wald-berries.js')).toEqual(berries);
});
