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
const { bundleRecipes } = await import('../../../../scripts/ci/recipe-fixture.mjs');
const made = await bundleRecipes();
mock.module('$app/paths', () => ({ base: '' }));
mock.module('virtual:asset-recipes', () => ({ default: made.index }));
mock.module('virtual:asset-recipes/libraries', () => ({ default: Object.fromEntries(Object.entries(made.libraries).map(([k, text]) => [k, async () => ({ default: text })])) }));

const { NotInVault, StorageOff, parsePin, pinRef, recipeEntryOf, vaultRecipes, versionsOf } = await import('./avendb.js');
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
	expect(Object.keys(v.index.recipes).length).toBe(337);
	expect(v.reads).toEqual([]);
	// The added recipe is elder-woman v2, with its frozen v1 still independently addressable.
	const [one, two] = [1, 2].map(version => v.hashOf(`actors/elder-woman@${version}:elder-woman`));
	expect(one).not.toBe(two);
	expect(v.index.latest['actors/elder-woman']).toBe(2);
	expect([one, two].map(hash => {
		const row = v.index.recipes[hash];
		return [row.group, row.id, row.v, row.variant];
	})).toEqual([['actors', 'elder-woman', 1, 'elder-woman'], ['actors', 'elder-woman', 2, 'elder-woman']]);
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
	expect(v.reads.length).toBe(337);
	await v.recipeAt(hashOf('actors/stand-in@11'));
	expect(v.reads.length).toBe(337);
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
		expect(err.message.startsWith(`${v.nameOf(h)}: `)).toBe(true);
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
		'an engine of another host': changed(row, (r) => (r.record.engine.host = 'logic')),
		'an engine never frozen': changed(row, (r) => (r.record.engine.hash = 'c0ffee'.repeat(10) + 'c0de')),
		'an older engine named by the newest one\'s hash': changed(row, (r) => {
			r.record.engine = { host: 'box', version: ENGINES.at(-2).v, hash: latest.blake3 };
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
		expect(Object.keys(v.index.recipes).length).toBe(336);
	}
	// one made for an older frozen engine, by its hash, is one of the recipes, made for that engine
	const older = vaultOf([
		...ROWS.filter((x) => x !== row),
		changed(row, (r) => {
			r.record.engine = { host: 'box', version: ENGINES.at(-2).v, hash: ENGINES.at(-2).blake3 };
			r.record.card.engine = ENGINES.at(-2).v;
		})
	]);
	expect(older.refused).toEqual([]);
	expect(older.hashOf('plants/apple@2')).toBe(made.index.labels['plants/apple@2']);
	// its tags are not read: an asset is its entry, its versions the entry's (avenDB's ids, not refs)
	for (const tags of [[], ['group:plants', 'ref:plants/apple@1'], ['ref:things/bell-tent@1']]) {
		const v = vaultOf([...ROWS.filter((x) => x !== row), changed(row, (r) => (r.tags = tags))]);
		expect(v.refused).toEqual([]);
		expect(v.index).toEqual(made.index);
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

/**
 * Our recipes as the seed writes them (Samuel 2026-10-18): one entry for each asset, as avenDB's feed lists it, its
 * versions and variants each a write it brought (`brought`): its main line's, each version's first variant, then each
 * other variant's own line; the entry tagged with every recipe's tags.
 */
function assetRows() {
	const assets = new Map();
	for (const { row, bytes } of HELD) {
		const card = row.record.card;
		const asset = `${card.group}/${card.id}`;
		if (!assets.has(asset)) assets.set(asset, []);
		assets.get(asset).push({ row, bytes, card });
	}
	const files = new Map();
	const rows = [...assets].map(([asset, held], i) => {
		const first = (x) => !x.card.variant || made.index.first[`${asset}@${x.card.version}`] === x.card.variant;
		const brought = held.map((x, j) => {
			const edit = `w${String(i).padStart(4, '0')}${String(j).padStart(4, '0')}`;
			files.set(edit, x.bytes);
			const line = first(x) ? null : `line-${x.card.variant}`;
			return { edit, line, version: x.card.version, files: [{ root: edit, size: x.bytes.length, len: x.bytes.length }], record: x.row.record };
		});
		const tags = [...new Set(held.flatMap((x) => x.row.tags))];
		return { vault: VAULT, entry: `asset-${asset}`, type: 'recipe', tags, heads: [], record: held.at(-1).row.record, files: [], brought };
	});
	return { rows, files };
}

test('an asset is one entry: each version and variant it brought is a recipe of the index, its file its own', async () => {
	const { rows, files } = assetRows();
	expect(rows.length).toBe(201);
	const reads = [];
	const v = vaultRecipes(rows, {
		read: async (row) => {
			reads.push(row.edit);
			return files.get(row.edit);
		}
	});
	expect(v.refused).toEqual([]);
	expect(v.index).toEqual(made.index);
	for (const label of ['plants/apple@1', 'plants/apple@2', 'actors/goat@2:goat-boer', 'actors/goat@2']) {
		const hash = v.hashOf(label);
		expect(hash).toBe(hashOf(label));
		expect(await v.recipeAt(hash)).toEqual({ hash, code: FILES[hash] });
		expect(v.rowOf(hash).entry).toBe(`asset-${label.split('@')[0]}`);
	}
	expect(reads.length).toBe(4);
	// a row that brought nothing more than once stands for itself
	expect(versionsOf(ROWS[0])).toEqual([ROWS[0]]);
	// a variant on its own line is never its kind's first, whatever its tags say
	const goat = rows.find((r) => r.entry === 'asset-actors/goat');
	const moved = { ...goat, brought: goat.brought.map((b) => (b.line === null && b.record.card.variant ? { ...b, line: 'line-x' } : b)) };
	const w = vaultRecipes(rows.map((r) => (r === goat ? moved : r)), { read: async () => undefined });
	expect(w.index.first['actors/goat@2']).toBeUndefined();
	expect(w.hashOf('actors/goat@2:goat-boer')).toBe(hashOf('actors/goat@2:goat-boer'));
});

test('an entry is one asset: its versions count with no tags at all, and one naming another asset is refused', () => {
	const { rows } = assetRows();
	// the truck's entry as the seed wrote it at v1, its v2 then accepted onto main by a proposal, and no tags at all
	const truck = rows.find((r) => r.entry === 'asset-machines/truck');
	expect(Math.max(...truck.brought.map((b) => b.version))).toBe(2);
	const bare = rows.map((r) => ({ ...r, tags: [] }));
	const v = vaultRecipes(bare, { read: async () => undefined });
	expect(v.refused).toEqual([]);
	expect(v.index).toEqual(made.index);
	expect(v.hashOf('machines/truck')).toBe(hashOf('machines/truck@2:truck'));
	expect(v.hashOf('machines/truck@1')).toBe(hashOf('machines/truck@1:truck'));
	expect(v.rowOf(hashOf('machines/truck@2:truck')).main).toBe(2);
	// a variant's own line is never its kind's first, tags or none
	const goat = bare.find((r) => r.entry === 'asset-actors/goat');
	expect(goat.brought.some((b) => b.line !== null)).toBe(true);
	expect(v.index.first['actors/goat@2']).toBe(made.index.first['actors/goat@2']);
	// an asset's entry never holds another asset's recipe: refused, and the asset's own entry still names it
	const pickup = rows.find((r) => r.entry === 'asset-machines/pickup').brought[0];
	const smuggled = { ...truck, tags: [], brought: [...truck.brought, { ...pickup, edit: 'w-smuggled' }] };
	const x = vaultRecipes(bare.map((r) => (r.entry === truck.entry ? smuggled : r)), { read: async () => undefined });
	expect(x.refused.length).toBe(1);
	expect(x.refused[0]).toMatch(/^machines\/pickup@1:pickup \(entry asset-machin…\): its entry is machines\/truck’s, and an entry is one asset$/);
	expect(x.hashOf('machines/pickup@1')).toBe(hashOf('machines/pickup@1:pickup'));
	expect(x.rowOf(hashOf('machines/pickup@1:pickup')).entry).toBe('asset-machines/pickup');
	// and where the pickup's own entry is gone, the truck's still doesn't speak for it
	const y = vaultRecipes(bare.filter((r) => r.entry !== 'asset-machines/pickup').map((r) => (r.entry === truck.entry ? smuggled : r)), { read: async () => undefined });
	expect(() => y.hashOf('machines/pickup@1')).toThrow(NotInVault);
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

/** a hash of the test's own, 64 hex digits, for an id avenDB would give @param {string} what */
const idOf = (what) => bytesToHex(blake3(utf8ToBytes(what)));

/**
 * Our recipes as the seed writes them, by avenDB's own ids (N6, Samuel 2026-10-20): each asset's entry a hash, and each
 * version it brought listing the heads a pin of it names (`at`, avenDB's `engine::version_heads`): of main's, the
 * release of main that took it in; of a variant's, its own write. An asset that brought one version says them itself.
 */
function pinnedRows() {
	const { rows, files } = assetRows();
	const out = rows.map((r) => {
		const entry = idOf(r.entry);
		const brought = r.brought.map((b) => ({ ...b, at: [idOf(`${r.entry} ${b.line ?? 'main'} v${b.version}`)] }));
		const one = brought.length === 1 ? { at: brought[0].at } : {};
		return { ...r, entry, ...(brought.length === 1 ? { files: brought[0].files, record: brought[0].record, brought: [] } : { brought }), ...one };
	});
	return { rows: out, files };
}

test('a pin names an asset by its entry and the heads of its version, whatever its card says, and avenDB names it', async () => {
	const { rows, files } = pinnedRows();
	const v = vaultRecipes(rows, { read: async (row) => files.get(row.edit ?? row.files.at(-1)?.root) });
	expect(v.refused).toEqual([]);
	expect(v.index).toEqual(made.index);
	let n = 0;
	for (const hash of Object.keys(v.index.recipes)) {
		const pin = v.pinOf(hash);
		expect(pin?.entry).toMatch(/^[0-9a-f]{64}$/);
		// as a string and as stored, each the same recipe as the old ref named
		expect(v.hashOf(pinRef(pin))).toBe(hash);
		expect(v.hashOf({ entry: pin.entry, at: pin.at })).toBe(hash);
		// named by avenDB alone: its title, its entry's version number and its short id
		const row = v.rowOf(hash);
		expect(v.nameOf(hash).endsWith(` v${row.main ?? row.record.card.version} · ${pin.entry.slice(0, 8)}…`)).toBe(true);
		expect(row.record.title.startsWith(v.nameOf(hash).replace(/ v\d+ · [0-9a-f]{8}…$/, '').split(' · ')[0])).toBe(true);
		n++;
	}
	expect(n).toBe(337);
	// one asset's versions, by the heads each names
	const truck = rows.find((r) => r.entry === idOf('asset-machines/truck'));
	const [one, two] = [1, 2].map((x) => truck.brought.find((b) => b.version === x && b.line === null));
	expect(v.hashOf({ entry: truck.entry, at: one.at })).toBe(hashOf('machines/truck@1:truck'));
	expect(v.hashOf({ entry: truck.entry, at: two.at })).toBe(hashOf('machines/truck@2:truck'));
	expect(v.nameOf(hashOf('machines/truck@2:truck'))).toMatch(/^Truck v2 · [0-9a-f]{8}…$/);
	expect(v.nameOf(hashOf('actors/goat@2:goat-boer'))).toMatch(/^Goat · Boer v2 · [0-9a-f]{8}…$/);
	// with the values it is built with, read as a ref's
	const apple = v.pinOf(hashOf('plants/apple@2'));
	const ref = pinRef(apple, 'stage=9&seed=maia');
	expect(parsePin(ref)).toEqual({ ...apple, params: { stage: '9', seed: 'maia' } });
	expect(v.hashOf(ref)).toBe(hashOf('plants/apple@2'));
	// its heads in any order are one version
	expect(v.hashOf({ entry: apple.entry, at: [...apple.at].reverse() })).toBe(hashOf('plants/apple@2'));
	expect(await v.recipeAt(v.hashOf(ref))).toEqual({ hash: hashOf('plants/apple@2'), code: FILES[hashOf('plants/apple@2')] });
});

test('a pin the vault holds no version of fails, saying what it holds of that entry instead', () => {
	const { rows } = pinnedRows();
	const v = vaultRecipes(rows, { read: async () => undefined });
	const apple = v.pinOf(hashOf('plants/apple@2'));
	const said = (ref) => {
		try {
			v.hashOf(ref);
		} catch (e) {
			expect(e).toBeInstanceOf(NotInVault);
			return e.message;
		}
		throw new Error('it named a recipe');
	};
	const elsewhere = idOf('another version');
	expect(said({ entry: apple.entry, at: [elsewhere] })).toBe(`${[1, 2].map((x) => v.nameOf(hashOf(`plants/apple@${x}`))).join(', ')}: no version of entry ${apple.entry.slice(0, 8)}… at ${elsewhere.slice(0, 8)}… is in the Maia City vault`);
	expect(said({ entry: elsewhere, at: apple.at })).toBe(`entry ${elsewhere.slice(0, 8)}… is not in the Maia City vault`);
	expect(said(pinRef({ ...apple, vault: 'ef'.repeat(32) }))).toBe(`entry ${apple.entry.slice(0, 8)}… is in vault ${VAULT.slice(0, 8)}…, not in vault efefefef…`);
	// nothing else is a pin: an old ref, a vault's group ref, a short id, a pin with no heads
	expect(parsePin('plants/apple@2')).toBeNull();
	expect(parsePin(`vault:${VAULT}/plants/apple@2`)).toBeNull();
	expect(parsePin(`vault:${VAULT}/${apple.entry.slice(0, 8)}@${apple.at[0]}`)).toBeNull();
	expect(parsePin({ entry: apple.entry, at: [] })).toBeNull();
	expect(() => v.hashOf({ entry: 'x', at: ['y'] })).toThrow(/not an asset ref/);
});

test("an entry handed out older than this device proved it (game/code/fresh.js): its newest is refused, saying why, its exact versions still read", async () => {
	const { rows, files } = pinnedRows();
	const apple = rows.find((r) => r.entry === idOf('asset-plants/apple'));
	const error = 'plants/apple: refused, the version handed out (v2, 5 writes, at aaaaaaaa…) is older than the newest this device already proved (v3, 7 writes, at bbbbbbbb…)';
	const v = vaultRecipes(rows, { read: async (row) => files.get(row.edit ?? row.files.at(-1)?.root), stale: [{ row: apple, error }] });
	expect(v.refused).toEqual([error]);
	// the newest, which a ref that names no version means, is not read off it
	expect(() => v.hashOf('plants/apple')).toThrow(NotInVault);
	expect(() => v.hashOf('plants/apple?stage=9')).toThrow(`plants/apple?stage=9: its newest version can't be read: ${error}`);
	// a version it names, or a pin by heads, is that version whatever is newer
	expect(v.hashOf('plants/apple@2')).toBe(hashOf('plants/apple@2'));
	const pin = v.pinOf(hashOf('plants/apple@1'));
	expect(v.hashOf(pin)).toBe(hashOf('plants/apple@1'));
	expect(await v.recipeAt(v.hashOf(pinRef(pin)))).toEqual({ hash: hashOf('plants/apple@1'), code: FILES[hashOf('plants/apple@1')] });
	// and every other asset as ever
	expect(v.hashOf('machines/truck')).toBe(hashOf('machines/truck'));
});
