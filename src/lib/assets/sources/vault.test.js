// @ts-nocheck — plain JS
// V5 of the avenDB migration: the Maia City vault's recipes as a page will read them (./avendb.js `vaultRecipes`), with
// no repo fallback (Samuel 2026-10-17). A ref resolves only from the vault's `recipe` entries, a recipe's source only
// from its entry's file, held to the hash its ref names, and what the vault doesn't hold, or holds otherwise, fails,
// naming the ref. Nothing reads it yet. The vault here is a stand-in made from the repo as the seed will write it
// (`recipeEntryOf`, ./cards.json), each row as avenDB's feed hands one out, its file served by `read`.
// Run: bun test src/lib/assets/sources/vault.test.js
import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;

// our recipes, as Vite's build hands them to the page (../box/plugin.js): the repo's index, which the vault's must match
const { bundleRecipes } = await import('../box/plugin.js');
const made = await bundleRecipes();
mock.module('$app/paths', () => ({ base: '' }));
mock.module('virtual:asset-recipes', () => ({ default: made.index }));
mock.module('virtual:asset-recipes/libraries', () => ({ default: Object.fromEntries(Object.entries(made.libraries).map(([k, text]) => [k, async () => ({ default: text })])) }));

const { NotInVault, StorageOff, recipeEntryOf, vaultRecipes } = await import('./avendb.js');
const { hashOf } = await import('../recipes.js');
const { ENGINES, recipeFile } = await import('../engines.js');
const { parseRef } = await import('../refs.js');
const { cardOfFile } = await import('./cards.js');

const CARDS = JSON.parse(readFileSync(new URL('./cards.json', import.meta.url), 'utf8')).cards;
const VAULT = 'ab12cd34'.repeat(8);
const FIRSTS = new Set(Object.entries(made.index.first).map(([at, variant]) => `${at}:${variant}`));

/** each recipe's file, by its hash, as the box plugin makes it */
const FILES = Object.fromEntries(Object.entries(made.index.recipes).map(([hash, at]) => [hash, recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant)]));

/** a row of the vault's feed for one of our recipes, as the seed writes it, and its file */
function rowOf(hash, i) {
	const at = made.index.recipes[hash];
	const { type, tags, value, file } = recipeEntryOf({ code: FILES[hash], card: CARDS[hash], first: FIRSTS.has(at.label) });
	return { row: { vault: VAULT, entry: `e${String(i).padStart(4, '0')}${hash.slice(0, 27)}`, type, tags, heads: [hash.slice(0, 16)], record: value }, bytes: utf8ToBytes(file.text) };
}
const HELD = Object.keys(made.index.recipes).map(rowOf);
const ROWS = HELD.map((x) => x.row);

/** the vault's files, by entry, and `read` serving them as the feed will, counting each read */
function vaultOf(rows = ROWS, files = new Map(HELD.map((x) => [x.row.entry, x.bytes]))) {
	const reads = [];
	const v = vaultRecipes(rows, {
		read: async (row) => {
			reads.push(row.entry);
			return files.get(row.entry);
		}
	});
	return { ...v, reads, files };
}

/** what `f` threw or rejected with, or null */
async function thrown(f) {
	try {
		await f();
	} catch (err) {
		return err;
	}
	return null;
}

/** a copy of a row, changed by `f` */
const changed = (row, f) => {
	const copy = structuredClone(row);
	f(copy);
	return copy;
};

/** the row of a recipe of ours, by its label */
const at = (label) => ROWS.find((r) => r.record.card.recipe === made.index.labels[label]);

test("the vault's index is the repo's: every version and variant, its latest, its first variant, its parameters", () => {
	const v = vaultOf();
	expect(v.refused).toEqual([]);
	expect(v.index).toEqual(made.index);
	expect(Object.keys(v.index.recipes).length).toBe(326);
	expect(v.reads).toEqual([]);
});

test('a ref names the same recipe in the vault as in the repo, however it is named', () => {
	const v = vaultOf();
	const refs = new Set(Object.keys(made.index.labels));
	for (const r of Object.values(made.index.recipes)) {
		refs.add(`${r.group}/${r.id}`);
		refs.add(`${r.group}/${r.id}@${r.v}`);
		if (r.variant) refs.add(`${r.group}/${r.id}:${r.variant}`);
		if (r.params?.length) refs.add(`${r.label}?${r.params[0].id}=${encodeURIComponent(String(r.params[0].value))}`);
	}
	let n = 0;
	for (const ref of refs) {
		const want = hashOf(ref);
		const asked = parseRef(ref).variant;
		if (want && (!asked || made.index.recipes[want].variant === asked)) {
			expect([ref, v.hashOf(ref)]).toEqual([ref, want]);
			n++;
		} else {
			// a variant its latest version doesn't have: the repo's index names its first variant instead, the vault nothing
			expect(() => v.hashOf(ref)).toThrow(NotInVault);
		}
	}
	expect(n).toBeGreaterThan(600);
});

test("each recipe's source is its entry's file, read once and held to its hash", async () => {
	const v = vaultOf();
	for (const hash of Object.keys(made.index.recipes)) expect(await v.recipeAt(hash)).toEqual({ hash, code: FILES[hash] });
	expect(v.reads.length).toBe(326);
	await v.recipeAt(hashOf('actors/stand-in@11'));
	expect(v.reads.length).toBe(326);
	// the stand-in's head, over a code entry's 200,000 characters, comes whole from its file
	expect((await v.recipeAt(hashOf('actors/stand-in@11'))).code.length).toBeGreaterThan(300000);
});

test("a recipe built from the vault's file is the one its card says", async () => {
	const v = vaultOf();
	for (const label of ['plants/apple@2', 'actors/stand-in@11:stand-in']) {
		const hash = v.hashOf(label);
		const { code } = await v.recipeAt(hash);
		const card = await cardOfFile(code, hash, v.index.engine);
		expect([card.ref, card.recipe, card.triangles]).toEqual([CARDS[hash].ref, hash, CARDS[hash].triangles]);
	}
}, 120000);

test('a recipe the vault does not hold fails, naming its ref: there is no repo to fall back on', async () => {
	const apple = made.index.labels['plants/apple@2'];
	const v = vaultOf(ROWS.filter((r) => r.record.card.recipe !== apple));
	const missing = (f, ref) => {
		let err = null;
		try {
			f();
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(NotInVault);
		expect(err.message).toContain(ref);
		expect(err.message).toContain('is not in the Maia City vault');
		return err;
	};
	missing(() => v.hashOf('plants/apple@2'), 'plants/apple@2');
	missing(() => v.hashOf('plants/apple@2?seed=maia'), 'plants/apple@2?seed=maia');
	// a ref that names no version names the latest the vault holds
	expect(v.hashOf('plants/apple')).toBe(made.index.labels['plants/apple@1']);
	// a version or a variant it never held, and an asset it holds nothing of
	missing(() => v.hashOf('plants/apple@99'), 'plants/apple@99');
	missing(() => v.hashOf('machines/powercube@3:no-such-cube'), 'machines/powercube@3:no-such-cube');
	missing(() => v.hashOf('things/no-such-thing'), 'things/no-such-thing');
	// and the rest is as it was
	expect(v.hashOf('plants/apple@1')).toBe(made.index.labels['plants/apple@1']);
	// an empty vault holds nothing a page asks for
	const empty = vaultOf([]);
	for (const label of Object.keys(made.index.labels)) missing(() => empty.hashOf(label), label);
	expect(empty.index.recipes).toEqual({});
	// a hash it doesn't hold is no recipe, however it is spelled
	for (const hash of [apple, 'constructor', '__proto__', 'toString', '', undefined]) {
		const err = await thrown(() => v.recipeAt(hash));
		expect(err).toBeInstanceOf(NotInVault);
	}
	expect(v.reads).toEqual([]);
});

test("a file that is not the recipe its ref names is refused, naming the ref, and nothing is built from it", async () => {
	const hash = made.index.labels['plants/apple@2'];
	const other = made.index.labels['plants/apple@1'];
	const row = at('plants/apple@2');
	const served = (bytes) => {
		const files = new Map(HELD.map((x) => [x.row.entry, x.bytes]));
		files.set(row.entry, bytes);
		return vaultOf(ROWS, files);
	};
	const refused = async (v, h, pattern) => {
		const err = await thrown(() => v.recipeAt(h));
		expect(err).toBeInstanceOf(NotInVault);
		expect(err.message).toContain('plants/apple@2');
		expect(err.message).toMatch(pattern);
	};
	await refused(served(utf8ToBytes(`${FILES[hash]} `)), hash, /hashes to .*not to/);
	await refused(served(utf8ToBytes(FILES[other])), hash, /hashes to .*not to/);
	await refused(served(new Uint8Array()), hash, /hashes to .*not to/);
	await refused(served(undefined), hash, /handed out no file/);
	await refused(served('not bytes at all'), hash, /hashes to .*not to/);
	// a feed that can't be reached: refused, and read again when asked again
	let fail = true;
	const v = vaultRecipes(ROWS, {
		read: async (r) => {
			if (fail) throw new Error('offline');
			return HELD.find((x) => x.row.entry === r.entry).bytes;
		}
	});
	await refused(v, hash, /could not be read.*offline/);
	fail = false;
	expect((await v.recipeAt(hash)).code).toBe(FILES[hash]);
	// a card that names, as its recipe, bytes that are no text: they hash as named, and are still no recipe
	const junk = new Uint8Array([0xff, 0xfe, 0x00, 0xc3]);
	const lying = changed(row, (r) => (r.record.card.recipe = bytesToHex(blake3(junk))));
	const files = new Map([[lying.entry, junk]]);
	await refused(vaultOf([lying], files), lying.record.card.recipe, /not UTF-8/);
	// a card that names another version's recipe as its own: its file hashes as named, and is that other version
	const borrowed = changed(row, (r) => (r.record.card.recipe = other));
	await refused(vaultOf([borrowed], new Map([[borrowed.entry, utf8ToBytes(FILES[other])]])), other, /another version or variant/);
});

test("a row that doesn't check is left out, saying why, and the ref it would name fails with that reason", () => {
	const row = at('plants/apple@2');
	const latest = ENGINES.at(-1);
	const bad = {
		'not a recipe entry': changed(row, (r) => (r.type = 'view')),
		'a record of another kind': changed(row, (r) => (r.record.kind = 'view')),
		'a card that does not fit': changed(row, (r) => delete r.record.card.size),
		'a card naming no recipe': changed(row, (r) => delete r.record.card.recipe),
		'no ref tag': changed(row, (r) => (r.tags = r.tags.filter((t) => !t.startsWith('ref:')))),
		'the ref tag of another version': changed(row, (r) => (r.tags = ['group:plants', 'ref:plants/apple@1'])),
		'no group tag': changed(row, (r) => (r.tags = r.tags.filter((t) => !t.startsWith('group:')))),
		'an engine of another host': changed(row, (r) => (r.record.engine.host = 'logic')),
		'an engine never frozen': changed(row, (r) => (r.record.engine.hash = 'c0ffee'.repeat(10) + 'c0de')),
		'an older engine than pages run': changed(row, (r) => {
			r.record.engine = { host: 'box', version: ENGINES.at(-2).v, hash: ENGINES.at(-2).blake3 };
			r.record.card.engine = ENGINES.at(-2).v;
		}),
		'a card made for another engine than its entry': changed(row, (r) => (r.record.card.engine = ENGINES.at(-2).v))
	};
	expect(row.record.engine).toEqual({ host: 'box', version: latest.v, hash: latest.blake3 });
	for (const [what, r] of Object.entries(bad)) {
		const v = vaultOf([...ROWS.filter((x) => x !== row), r]);
		if (v.refused.length !== 1) throw new Error(`${what}: refused ${JSON.stringify(v.refused)}`);
		expect(v.index.labels['plants/apple@2']).toBeUndefined();
		let err = null;
		try {
			v.hashOf('plants/apple@2');
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(NotInVault);
		expect(err.message).toContain('plants/apple@2');
		// the rest of the vault reads as before
		expect(v.hashOf('plants/apple@1')).toBe(made.index.labels['plants/apple@1']);
		expect(Object.keys(v.index.recipes).length).toBe(325);
	}
	// what is no row at all is left out the same way, and takes nothing with it
	const v = vaultOf([null, 42, 'plants/apple@2', {}, { type: 'recipe', record: null }, ...ROWS]);
	expect(v.refused.length).toBe(5);
	expect(v.index).toEqual(made.index);
	expect(Object.prototype.polluted).toBeUndefined();
	expect(vaultOf(null).index.recipes).toEqual({});
});

test('a ref two entries claim as two recipes names neither, and a kind with two first variants has none', () => {
	const row = at('plants/apple@2');
	// the same recipe kept twice is one
	expect(vaultOf([...ROWS, changed(row, (r) => (r.entry = 'another-entry'))]).refused).toEqual([]);
	// two recipes under one ref: no page could say which it names
	const twice = changed(row, (r) => {
		r.entry = 'another-entry';
		r.record.card.recipe = made.index.labels['plants/apple@1'];
	});
	const v = vaultOf([...ROWS, twice]);
	expect(v.refused.some((x) => /plants\/apple@2: held twice/.test(x))).toBe(true);
	expect(() => v.hashOf('plants/apple@2')).toThrow(/plants\/apple@2 is not in the Maia City vault: .*held twice/);
	// and one recipe under two refs (its own and apple@2's) names neither: plants/apple@1 is refused as well
	expect(() => v.hashOf('plants/apple@1')).toThrow(NotInVault);
	expect(v.hashOf('things/bell-tent@1')).toBe(made.index.labels['things/bell-tent@1']);
	// two variants that both say they are their kind's first: a ref naming none of them names nothing
	const [at3, first] = Object.entries(made.index.first).find(([k]) => Object.keys(made.index.labels).filter((l) => l.startsWith(`${k}:`)).length > 1);
	const another = Object.keys(made.index.labels).find((l) => l.startsWith(`${at3}:`) && l !== `${at3}:${first}`);
	const second = at(another);
	const rows = ROWS.map((r) => (r === second ? changed(r, (x) => x.tags.push(`ref:${at3}`)) : r));
	const w = vaultOf(rows);
	expect(w.refused.length).toBe(1);
	expect(w.index.first[at3]).toBeUndefined();
	expect(() => w.hashOf(at3)).toThrow(NotInVault);
	expect(w.hashOf(`${at3}:${first}`)).toBe(made.index.labels[`${at3}:${first}`]);
	expect(w.hashOf(another)).toBe(made.index.labels[another]);
});

test("a vault's ref is still refused: avenDB storage is not switched on", () => {
	const v = vaultOf();
	let err = null;
	try {
		v.hashOf(`vault:${VAULT}/plants/apple@2`);
	} catch (e) {
		err = e;
	}
	expect(err).toBeInstanceOf(StorageOff);
	expect(() => v.hashOf('not a ref')).toThrow(/not an asset ref/);
});
