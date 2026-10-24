// @ts-nocheck — plain JS
// Phase 10 of the asset pipeline: avenDB ready, not stored. A ref may name an asset kept in a vault
// (`vault:<vault id>/<group>/<id>@<v>`, ./avendb.js); it is read strictly, and every loader refuses it with one error
// while avenDB storage is not switched on. A recipe of ours maps onto avenDB's `recipe` entry (its code entry schema of
// C4b, read from avendb/ and never changed there), its source the entry's file (V5), and nothing here writes to avenDB.
// Run: bun test src/lib/assets/sources
import { expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;

// our recipes, as Vite's build hands them to the page (../box/plugin.js)
const { hashText } = await import('../box/plugin.js');
const { bundleRecipes } = await import('../../../../scripts/ci/recipe-fixture.mjs');
const made = await bundleRecipes();
mock.module('$app/paths', () => ({ base: '' }));
mock.module('virtual:asset-recipes', () => ({ default: made.index }));
mock.module('virtual:asset-recipes/libraries', () => ({ default: Object.fromEntries(Object.entries(made.libraries).map(([k, text]) => [k, async () => ({ default: text })])) }));

const { StorageOff, VAULT_REF, avendb, parseVaultRef, recipeEntryOf } = await import('./avendb.js');
const { readRef, repoRef, assetAt, objectAt, parseRef } = await import('../index.js');
const { buildAt, hashOf, parseBuild, recipeAt } = await import('../recipes.js');
const { canonical, keyOf, loadAsset } = await import('../load.js');
const { ENGINES, recipeFile } = await import('../engines.js');
const { check, checkCard } = await import('../schemas/index.js');
const { TIMEOUT } = await import('../../sandbox/frame.js');
const { parseCodeRef } = await import('../../../../game/code/index.js');

const ROOT = new URL('../../../../', import.meta.url).pathname;
// every recipe's card, as the box hands it back for a build at its own values (./cards.js)
const CARDS = JSON.parse(readFileSync(new URL('./cards.json', import.meta.url), 'utf8')).cards;
const V = 'ab12cd34'.repeat(8);
const HEX = 'c0ffee'.repeat(10) + 'c0de';

const GOOD = {
	[`vault:${HEX}/plants/fern@2`]: { source: 'vault', vault: HEX, group: 'plants', id: 'fern', v: 2 },
	[`vault:${V}/machines/pickup@1:pickup-cube`]: { source: 'vault', vault: V, group: 'machines', id: 'pickup', v: 1, variant: 'pickup-cube' },
	[`vault:${V}/plants/apple@2?seed=maia&stage=9`]: { source: 'vault', vault: V, group: 'plants', id: 'apple', v: 2, params: { seed: 'maia', stage: '9' } },
	[`vault:${HEX}/things/bell-tent@100000`]: { source: 'vault', vault: HEX, group: 'things', id: 'bell-tent', v: 100000 },
	[`vault:${V}/factories/batterypack-line@1`]: { source: 'vault', vault: V, group: 'factories', id: 'batterypack-line', v: 1 },
	[`vault:${V}/worlds/sandbox-5@3`]: { source: 'vault', vault: V, group: 'worlds', id: 'sandbox-5', v: 3 }
};

const HOSTILE = [
	`vault:${V}/plants/fern`, // a vault ref always names its version
	`vault:${V}/plants/fern@0`,
	`vault:${V}/plants/fern@02`,
	`vault:${V}/plants/fern@-1`,
	`vault:${V}/plants/fern@1.5`,
	`vault:${V}/plants/fern@100001`,
	`vault:${V}/plants/fern@9999999`,
	`vault:${V}/plants/fern@２`,
	'vault:short/plants/fern@2',
	`vault:${'a'.repeat(129)}/plants/fern@2`,
	`vault:../../${V}/plants/fern@2`,
	`vault:${V}/../plants/fern@2`,
	`vault:${V}/plants/../fern@2`,
	`vault:${V}//fern@2`,
	`vault:${V}/plants//fern@2`,
	`vault:${V}/plants/fern/x@2`,
	`vault:${V}/weapons/gun@1`,
	`vault:${V}/__proto__/fern@1`,
	`vault:${V}/plants/__proto__@1`,
	`vault:${V}/plants/Fern@2`,
	`vault:${V}/plants/${'a'.repeat(81)}@2`,
	`vault:${V}/plants/fern@2:`,
	`vault:${V}/plants/fern@2:Big`,
	`vault:${V}/plants/fern@2:__proto__`,
	`vault:${V}/plants/fern@2#x`,
	`vault:${V}/plants/fern@2 `,
	`vault:${V}/plants/fern@2\n`,
	`vault:${V}/plants/fern\u0000@2`,
	`vault:${V}/plants/fern@2/more`,
	`vault:${V}/plants/fern@2%00`,
	`vault:${V}/plants/fern@2?__proto__=x`,
	`vault:${V}/plants/fern@2?seed=a&seed=b`,
	`vault:${V}/plants/fern@2?=x`,
	`vault:${V}/plants/fern@2?seed=a b`,
	`vault:${V}/plants/fern@2?${'x=1&'.repeat(200)}`,
	`vault:vault:${V}/plants/fern@2`,
	`vault:${V}\\plants\\fern@2`,
	`VAULT:${V}/plants/fern@2`,
	`vаult:${V}/plants/fern@2`, // a Cyrillic а
	` vault:${V}/plants/fern@2`,
	'vault:',
	'vault:/',
	'',
	'javascript:alert(1)',
	'https://example.com/plants/fern@2',
	'data:text/plain,plants/fern@2',
	null,
	undefined,
	42,
	{},
	[`vault:${V}/plants/fern@2`],
	{ toString: () => `vault:${V}/plants/fern@2` }
];

const off = (err) => err instanceof StorageOff && /^avenDB storage is not switched on: /.test(err.message);
/** what `f` threw or rejected with, or null */
async function thrown(f) {
	try {
		await f();
	} catch (err) {
		return err;
	}
	return null;
}

test('a vault ref is read strictly: its vault, group, id, version, variant and values', () => {
	for (const [ref, parts] of Object.entries(GOOD)) {
		expect(parseVaultRef(ref)).toEqual(parts);
		expect(readRef(ref)).toEqual(parts);
	}
	// a repo ref reads as it always has, with its source named
	expect(readRef('plants/apple@2?seed=maia')).toEqual({ source: 'repo', ...parseRef('plants/apple@2?seed=maia') });
	expect(readRef('things/bell-tent').source).toBe('repo');
	expect(repoRef('machines/pickup@1:pickup-cube')).toEqual(parseRef('machines/pickup@1:pickup-cube'));
});

test('a hostile ref is refused as no ref at all, never taken for one of the vault, and pollutes nothing', () => {
	for (const ref of HOSTILE) {
		let err = null;
		try {
			readRef(ref);
		} catch (e) {
			err = e;
		}
		if (!err) throw new Error(`read as a ref: ${JSON.stringify(String(ref)).slice(0, 80)}`);
		expect(off(err)).toBe(false);
		if (typeof ref === 'string' && ref.startsWith('vault:')) expect(() => parseVaultRef(ref)).toThrow(/not an asset ref|not a parameter|named twice/);
	}
	expect(Object.prototype.polluted).toBeUndefined();
	expect({}.seed).toBeUndefined();
});

test('a vault id reads the same in an asset ref as in a code ref (game/code/ref.js): an avenDB id, 64 hex digits', () => {
	const entry = `vault:%/${'cd'.repeat(32)}@${'ef'.repeat(32)}`;
	for (const id of [HEX, V, 'a'.repeat(64)]) {
		expect(readRef(`vault:${id}/plants/fern@2`).vault).toBe(id);
		expect(parseCodeRef(entry.replace('%', id)).vault).toBe(id);
	}
	for (const id of ['ab12cd34', 'Ab_-1234', 'a'.repeat(128), 'a'.repeat(63), HEX.toUpperCase(), 'short', 'ab12cd3!', 'ab12 cd34', '../ab12cd34', 'ab12cd34.x']) {
		expect(() => readRef(`vault:${id}/plants/fern@2`)).toThrow(/not an asset ref/);
		expect(() => parseCodeRef(entry.replace('%', id))).toThrow();
	}
});

test('every loader refuses a vault ref with the one error: avenDB storage is not switched on', async () => {
	expect(avendb.on).toBe(false);
	const loaders = {
		repoRef: (r) => repoRef(r),
		assetAt: (r) => assetAt(r),
		objectAt: (r) => objectAt(r),
		hashOf: (r) => hashOf(r),
		buildAt: (r) => buildAt(r),
		parseBuild: (r) => parseBuild(r),
		canonical: (r) => canonical(r),
		keyOf: (r) => keyOf(r),
		loadAsset: (r) => loadAsset(r),
		'avendb.recipeAt': (r) => avendb.recipeAt(parseVaultRef(r))
	};
	for (const ref of Object.keys(GOOD))
		for (const [name, load] of Object.entries(loaders)) {
			const err = await thrown(() => load(ref));
			if (!off(err)) throw new Error(`${name}(${ref}) ${err ? `refused it otherwise: ${err.message}` : 'took it'}`);
			expect(err.message).toContain(`${GOOD[ref].group}/${GOOD[ref].id}@${GOOD[ref].v}`);
		}
	// what is no ref at all, each loader refuses as before, never with that error
	for (const ref of HOSTILE.filter((r) => typeof r === 'string'))
		for (const [name, load] of Object.entries(loaders).filter(([n]) => n !== 'avendb.recipeAt')) {
			const err = await thrown(() => load(ref));
			if (!err || off(err)) throw new Error(`${name}(${JSON.stringify(ref).slice(0, 60)}) ${err ? 'refused it as a vault ref' : 'took it'}`);
		}
	// and a repo ref loads as it always has
	expect(hashOf('plants/apple@2')).toBe(made.index.labels['plants/apple@2']);
	expect(buildAt('plants/apple@2?stage=9')).toBe(`${made.index.labels['plants/apple@2']}?stage=9`);
	expect((await assetAt('things/bell-tent@1')).item.id).toBe('bell-tent');
}, 60000);

/** avenDB's `Recipe, v1` as lens.rs ships it: its code entry base (`code_entry!`, `engine_and_manifest!`) and its card */
function recipeSchema() {
	const rs = readFileSync(`${ROOT}avendb/crates/avendb/src/lens.rs`, 'utf8');
	const part = (from, to) => {
		const a = rs.indexOf(from);
		const b = a < 0 ? -1 : rs.indexOf(to, a);
		return b < 0 ? '' : rs.slice(a, b);
	};
	const raw = (s) => [...s.matchAll(/r#"([\s\S]*?)"#/g)].map((m) => m[1]);
	const em = raw(part('macro_rules! engine_and_manifest', 'macro_rules! code_entry'));
	const ce = raw(part('macro_rules! code_entry', 'pub mod blobs'));
	const def = /pub const RECIPE_V1: &str = code_entry!\(\s*"([^"]*)",\s*"([^"]*)",\s*r#"([\s\S]*?)"#\s*\);/.exec(rs);
	if (em.length !== 1 || ce.length !== 5 || !def) throw new Error("avenDB's Recipe, v1 is not where lens.rs kept it (code_entry!, RECIPE_V1): read it again, and map our recipes onto it (./avendb.js recipeEntryOf)");
	return JSON.parse(ce[0] + def[1] + ce[1] + def[2] + ce[2] + em[0] + ce[3] + def[3] + ce[4]);
}

const SAMPLES = ['plants/apple@2', 'things/bell-tent@1', 'machines/powercube@3', 'biomes/cover@1:fern'];

test("a recipe of ours is avenDB's recipe entry: its file the source, the card beside it, the engine it names", async () => {
	const RECIPE = recipeSchema();
	expect(RECIPE.title).toBe('Recipe, v1');
	expect(RECIPE.properties.kind.const).toBe('recipe');
	expect(Object.keys(RECIPE.properties).sort()).toEqual(['card', 'contract', 'engine', 'kind', 'manifest', 'note', 'params', 'source', 'tags', 'title'].sort());
	for (const label of SAMPLES) {
		const hash = hashOf(label);
		const { code } = await recipeAt(hash);
		const card = CARDS[hash];
		expect(checkCard(card).ok).toBe(true);
		const { type, tags, value, file } = recipeEntryOf({ code, card, ms: TIMEOUT });
		expect(type).toBe('recipe');
		// it fits avenDB's schema; the card is held to what reads it, our checker against card.v1.json (which refuses any
		// text naming a place to load from, as a card's sources do)
		const fits = check(RECIPE, { ...value, card: {} });
		expect(fits.ok ? [] : fits.errors).toEqual([]);
		// the source is the entry's file, the recipe byte for byte: its BLAKE3 hash is the name the card gives it and
		// the box checks; the record's own source is empty
		expect(value.source).toBe('');
		expect(file).toEqual({ media: 'text/javascript', text: code });
		expect(hashText(file.text)).toBe(value.card.recipe);
		expect(value.engine).toEqual({ host: 'box', version: made.index.engine, hash: ENGINES.find((e) => e.v === made.index.engine).blake3 });
		expect(value.manifest.libs.every((m) => ENGINES.at(-1).modules.includes(m))).toBe(true);
		expect(value.manifest.libs).toContain('three');
		// a row for every parameter a number holds; the card keeps all of them, as the recipe declares them
		const declared = (card.params ?? []).filter((p) => p.type !== 'string');
		expect(value.params.map((p) => p.name)).toEqual(declared.map((p) => p.id));
		expect(value.params.map((p) => p.default)).toEqual(declared.map((p) => p.value));
		expect(value.contract.budgets.ms).toBe(TIMEOUT);
		// found by its group and its ref
		expect(tags).toEqual([`group:${card.group}`, `ref:${card.group}/${card.id}@${card.version}${card.variant ? `:${card.variant}` : ''}`]);
	}
	// a file that is not the recipe its card names is no entry of it
	const hash = hashOf('plants/apple@2');
	const { code } = await recipeAt(hash);
	expect(() => recipeEntryOf({ code: `${code} `, card: CARDS[hash] })).toThrow(/names another recipe/);
});

test('every recipe of ours is a recipe entry, the stand-in too: its record fits Recipe, v1 and its file is the recipe', () => {
	const RECIPE = recipeSchema();
	const firsts = new Set(Object.entries(made.index.first).map(([at, variant]) => `${at}:${variant}`));
	const oversized = [];
	const named = new Map();
	for (const [hash, at] of Object.entries(made.index.recipes)) {
		const code = recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant);
		const { tags, value, file } = recipeEntryOf({ code, card: CARDS[hash], ms: TIMEOUT, first: firsts.has(at.label) });
		const fits = check(RECIPE, { ...value, card: {} });
		if (!fits.ok) throw new Error(`${at.label}: its record does not fit Recipe, v1: ${fits.errors.slice(0, 3).join('; ')}`);
		expect(hashText(file.text)).toBe(hash);
		if ([...file.text].length > RECIPE.properties.source.maxLength) oversized.push(at.label);
		for (const t of tags.filter((x) => x.startsWith('ref:'))) {
			if (named.has(t)) throw new Error(`${t} names two recipes: ${named.get(t)} and ${at.label}`);
			named.set(t, at.label);
		}
	}
	// Frozen stand-in v1–v11 and elder-woman v1/v2 exceed inline source limits; their files retain every version.
	expect(oversized.sort()).toEqual([
		...Array.from({ length: 11 }, (_, i) => `actors/stand-in@${i + 1}:stand-in`),
		'actors/elder-woman@1:elder-woman', 'actors/elder-woman@2:elder-woman'
	].sort());
	// each recipe is found by its ref, and a kind's first variant by its ref without a variant as well
	expect(named.size).toBe(Object.keys(made.index.recipes).length + Object.keys(made.index.first).length);
	for (const [at, variant] of Object.entries(made.index.first)) expect(named.get(`ref:${at}`)).toBe(`${at}:${variant}`);
});

test('nothing here writes to avenDB: no module of the assets imports its client or calls its server', () => {
	const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(`${dir}/${f}`).isDirectory() ? walk(`${dir}/${f}`) : [`${dir}/${f}`]));
	const lib = `${ROOT}src/lib/assets`;
	for (const f of walk(lib).filter((x) => /\.(js|svelte)$/.test(x) && !/\.test\.js$/.test(x))) {
		const text = readFileSync(f, 'utf8');
		const imports = [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
		const theirs = imports.filter((i) => /avendb/i.test(i) && !/(^|\/)sources\/avendb\.js$|^\.\/avendb\.js$/.test(i));
		if (theirs.length) throw new Error(`${f.slice(lib.length)} imports ${theirs.join(', ')}`);
		expect(text).not.toMatch(/avendb\.maia\.city|\/api\/avendb/i);
	}
	const source = readFileSync(`${lib}/sources/avendb.js`, 'utf8');
	expect([...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort()).toEqual(['../../../../game/code/ref.js', '../../../../game/hash.js', '../engines.js', '../params.js', '../refs.js', '../schemas/asset.v1.json', '../schemas/index.js', '@noble/hashes/utils.js']);
	expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|indexedDB/);
	expect(VAULT_REF.source.startsWith('^vault:')).toBe(true);
});
