// @ts-nocheck — plain JS
// V5 of the avenDB migration: the avenDB app's Assets ($lib/avendb/Assets.svelte), a vault's recipes shown from the
// vault alone, with no repo fallback (Samuel 2026-10-17). The rows are the vault's `recipe` entries as the device's
// database op hands them out, each recipe's source the newest file its entry brings, read from the device a window at
// a time ($lib/avendb/assets.js); the list is those entries by group, asset, version and variant (./shelf.js); a build
// is the entry's file, held to its hash before anything else, then the cache or the box, checked (./viewer.js). The
// device here is a stand-in made from the repo as the seed will write it (`recipeEntryOf`, ./cards.json), as
// ./vault.test.js makes its vault: the repo feeds this test, never the viewer, whose modules import nothing of it.
// Run: bun test src/lib/assets/sources/viewer.test.js
import { expect, mock, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;

// our recipes, as Vite's build hands them to the page (../box/plugin.js): what the stand-in device is made of
const { bundleRecipes } = await import('../box/plugin.js');
const made = await bundleRecipes();
mock.module('$app/paths', () => ({ base: '' }));

const { NotInVault, recipeEntryOf } = await import('./avendb.js');
const { GROUPS, nameOf, refusedOf, shelfOf } = await import('./shelf.js');
const { buildName, vaultBuild } = await import('./viewer.js');
const { MOST, fileReader, newestFile, proposedSource, recipeRows, vaultSource } = await import('../../avendb/assets.js');
const { ENGINES, recipeFile } = await import('../engines.js');
const { keyOf } = await import('../cache.js');
const { recipeOfFile } = await import('./cards.js');
const { buildWith, refOf } = await import('../refs.js');
const { cardOf } = await import('../card.js');
const { bake } = await import('../box/bake.js');
const { catalogOf, viewOf } = await import('../box/view.js');
const { serialize } = await import('../box/serialize.js');

const ROOT = new URL('../../../../', import.meta.url).pathname;
const CARDS = JSON.parse(readFileSync(new URL('./cards.json', import.meta.url), 'utf8')).cards;
const VAULT = 'ab12cd34'.repeat(8);
/** the vault the person acts as there, which reads its entries */
const ACTOR = 'cd'.repeat(32);
const FIRSTS = new Set(Object.entries(made.index.first).map(([at, variant]) => `${at}:${variant}`));
const HASHES = Object.keys(made.index.recipes);
const LABEL = made.index.labels;

/** each recipe's file, by its hash, as the box plugin makes it */
const FILES = Object.fromEntries(Object.entries(made.index.recipes).map(([hash, at]) => [hash, recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant)]));

/** a file as the device seals it: its root (iroh's BLAKE3 of the sealed pieces, never the plaintext's), its sizes */
const sealed = (bytes, salt = '') => ({ root: bytesToHex(blake3(utf8ToBytes(`sealed ${salt}${bytes.length} ${bytesToHex(blake3(bytes))}`))), size: bytes.length + 48, len: bytes.length, pieces: 1, syncedTo: [] });

/**
 * This browser's device as the seed leaves it: the vault's database (the `database` op's rows) and the world (each
 * entry with the files it brings, oldest first), each recipe an entry whose file is its recipe, and `readFile`
 * serving a file's bytes by its root, a range at a time, counting each read.
 */
function deviceOf(hashes = HASHES) {
	const store = new Map();
	const rows = [];
	const entries = [];
	hashes.forEach((hash, i) => {
		const at = made.index.recipes[hash];
		const { type, tags, value, file } = recipeEntryOf({ code: FILES[hash], card: CARDS[hash], first: FIRSTS.has(at.label) });
		const entry = `${i.toString(16).padStart(4, '0')}${hash}`.slice(0, 64);
		const bytes = utf8ToBytes(file.text);
		const f = sealed(bytes);
		store.set(f.root, bytes);
		rows.push({ entry, type, tags, kind: 'recipe', title: value.title, record: value, authored: [], edits: 1, held: 1, lines: 1, proposals: [], audience: 'a'.repeat(64), epoch: 0, bytes: 0, author: null, actor: VAULT, public: false, levels: {} });
		entries.push({ entry, vault: VAULT, by: VAULT, type, tags, public: false, readers: [VAULT, ACTOR], writers: [VAULT], sharers: [VAULT], kind: 'record', files: [f] });
	});
	const reads = [];
	const readFile = async (root, size, from, to) => {
		reads.push({ root, size, from, to });
		const b = store.get(root);
		if (!b) throw new Error('no peer hands over that file');
		return b.slice(from, to);
	};
	return { db: { vault: VAULT, rows }, world: { entries, vaults: [] }, readFile, reads, store };
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

/** a device's row and world entry for a label */
const of = (device, label) => {
	const i = device.db.rows.findIndex((r) => r.record.card.recipe === LABEL[label]);
	return { row: device.db.rows[i], entry: device.world.entries[i] };
};

/** an asset's entry id as the stand-in device makes it: a hash, as avenDB's are, of nothing a page reads */
const assetEntry = (asset) => bytesToHex(blake3(utf8ToBytes(`entry ${asset}`)));

/**
 * This browser's device as the seed writes it since generation 15 (Samuel 2026-10-18): one entry for each asset, with
 * no tags, its versions and variants each a write it brought (`brought`, as the device's `data::database` lists them),
 * its main line's, each version's first variant, then each other variant's own line, each with its own file.
 */
function assetDeviceOf() {
	const d = deviceOf();
	const assets = new Map();
	d.db.rows.forEach((row, i) => {
		const card = row.record.card;
		const asset = `${card.group}/${card.id}`;
		assets.set(asset, [...(assets.get(asset) ?? []), { row, file: d.world.entries[i].files[0] }]);
	});
	const rows = [];
	const entries = [];
	for (const [asset, held] of assets) {
		const entry = assetEntry(asset);
		held.sort((a, b) => a.row.record.card.version - b.row.record.card.version);
		const brought = held.map(({ row, file }) => {
			const card = row.record.card;
			const first = !card.variant || made.index.first[`${asset}@${card.version}`] === card.variant;
			const line = first ? null : bytesToHex(blake3(utf8ToBytes(`line ${asset} ${card.variant}`)));
			return { edit: bytesToHex(blake3(utf8ToBytes(`edit ${card.recipe}`))), line, version: card.version, files: [file], record: row.record };
		});
		const last = held.at(-1).row;
		rows.push({ ...last, entry, tags: [], record: last.record, brought });
		entries.push({ ...d.world.entries[0], entry, tags: [], files: held.map((x) => x.file) });
	}
	return { ...d, db: { vault: VAULT, rows }, world: { entries, vaults: [] } };
}

/**
 * The box as a stand-in that builds in this process as the frozen engine does (../box/engine.js `buildOne`): the
 * recipe file it is handed, run with the engine's modules, built, carried out as data. It keeps what it was asked.
 */
function boxOf() {
	const asked = [];
	return {
		engine: made.index.engine,
		asked,
		async build(recipe, given) {
			asked.push({ recipe, given });
			const { meta, build } = recipeOfFile(recipe.code);
			let cast = null;
			const keep = async (...a) => {
				const m = await build(...a);
				cast = m && !m.isObject3D && m.rig?.object?.isObject3D ? m : null;
				return m;
			};
			const obj = await buildWith({ build: keep, params: meta.params, ref: refOf(meta.group, meta.id, meta.version, meta.variant) }, given);
			if (cast?.catalog && !obj.userData.catalog) obj.userData.catalog = catalogOf(cast.catalog);
			const card = cardOf(obj, meta, { recipe: recipe.hash, engine: made.index.engine });
			const { data } = await serialize(obj, { controls: bake(obj).controls, view: viewOf(obj, cast) });
			return { data, card, ms: {} };
		}
	};
}

/** this device's cache as a stand-in, counting what is asked of it */
function storeOf() {
	const kept = new Map();
	const asked = { get: 0, put: 0, drop: 0 };
	return {
		kept,
		asked,
		get: async (k) => (asked.get++, kept.get(k)),
		put: async (k, b) => (asked.put++, kept.set(k, b), true),
		drop: async (k) => (asked.drop++, kept.delete(k))
	};
}

test("the Assets page reads the vault's recipes from this device alone: the repo's index, every file the device's", async () => {
	const d = deviceOf();
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	expect(v.refused).toEqual([]);
	expect(v.index).toEqual(made.index);
	expect(d.reads).toEqual([]);
	for (const hash of HASHES) expect(await v.recipeAt(hash)).toEqual({ hash, code: FILES[hash] });
	// each file read whole, by the root its entry's world names, in windows of at most 4 MiB
	const roots = new Set(d.world.entries.map((e) => e.files[0].root));
	expect(new Set(d.reads.map((r) => r.root))).toEqual(roots);
	expect(d.reads.every((r) => r.to - r.from <= 4 << 20 && roots.has(r.root))).toBe(true);
	// the stand-in's head, over a code entry's 200,000 characters, comes whole from its file
	expect((await v.recipeAt(LABEL['actors/stand-in@11:stand-in'])).code.length).toBeGreaterThan(300000);
	// each recipe's row is the entry it was read from, its card beside it
	const { row } = of(d, 'plants/apple@2');
	expect(v.rowOf(LABEL['plants/apple@2']).entry).toBe(row.entry);
	expect(v.rowOf(LABEL['plants/apple@2']).record.card).toEqual(CARDS[LABEL['plants/apple@2']]);
	for (const no of ['constructor', '__proto__', '', undefined, 'c0ffee'.repeat(10) + 'c0de']) expect(v.rowOf(no)).toBeUndefined();
});

test('the newest file an entry brings is its source, and one that is not the recipe its ref names is refused', async () => {
	const d = deviceOf();
	const { entry } = of(d, 'plants/apple@2');
	const right = entry.files[0];
	const wrong = sealed(utf8ToBytes(FILES[LABEL['plants/apple@1']]), 'older ');
	d.store.set(wrong.root, utf8ToBytes(FILES[LABEL['plants/apple@1']]));
	expect(newestFile({ files: [wrong, right] })).toBe(right);
	// an older file before it is never read
	entry.files = [wrong, right];
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	expect((await v.recipeAt(LABEL['plants/apple@2'])).code).toBe(FILES[LABEL['plants/apple@2']]);
	expect(d.reads.some((r) => r.root === wrong.root)).toBe(false);
	// a newer file that is another recipe: refused, naming it as avenDB does, and the older right one is no fallback
	entry.files = [right, wrong];
	const w = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	const err = await thrown(() => w.recipeAt(LABEL['plants/apple@2']));
	expect(err).toBeInstanceOf(NotInVault);
	expect(w.nameOf(LABEL['plants/apple@2'])).toMatch(/^Apple v2 · [0-9a-f]{8}…$/);
	expect(err.message.startsWith(`${w.nameOf(LABEL['plants/apple@2'])}: refused, its file in the Maia City vault hashes to`)).toBe(true);
});

test("a file this device can't hand out fails, naming it and why, and nothing stands in for it", async () => {
	const label = 'things/bell-tent@1';
	const hash = LABEL[label];
	/** the reader's error for the bell tent's file when its entry is changed by `f` */
	const failing = async (f, read) => {
		const d = deviceOf();
		f(of(d, label).entry, d);
		const v = vaultSource(d.world, d.db, VAULT, ACTOR, read ?? d.readFile);
		expect(v.hashOf(label)).toBe(hash);
		const err = await thrown(() => v.recipeAt(hash));
		expect(err).toBeInstanceOf(NotInVault);
		expect(err.message.startsWith(`${v.nameOf(hash)}: `)).toBe(true);
		return err.message;
	};
	expect(await failing((e) => (e.files = []))).toMatch(/could not be read from the Maia City vault \(its entry brings no file\)/);
	expect(await failing((e) => delete e.files)).toMatch(/its entry brings no file/);
	expect(await failing((e) => (e.files = [{ ...e.files[0], len: null }]))).toMatch(/holds no key to its file yet/);
	expect(await failing((e) => (e.files = [{ ...e.files[0], len: MOST + 1 }]))).toMatch(/its file is 16 MB, larger than a recipe may be \(16 MB at most\)/);
	expect(await failing((e, d) => d.store.delete(e.files[0].root))).toMatch(/could not be read.*no peer hands over that file/);
	// its bytes changed on the way, one of them
	const flipped = (b) => Uint8Array.from(b, (x, i) => (i === 100 ? x ^ 1 : x));
	expect(await failing((e, d) => d.store.set(e.files[0].root, flipped(d.store.get(e.files[0].root))))).toMatch(/hashes to .*not to/);
	expect(await failing(() => {}, async () => new Uint8Array())).toMatch(/the file ends early/);
	// a reader of its own still reads the rows' files only through `read`
	const d = deviceOf([hash]);
	const own = fileReader(d.world, d.readFile);
	expect(new TextDecoder().decode(await own(d.db.rows[0]))).toBe(FILES[hash]);
	expect(await thrown(() => own({ entry: 'f'.repeat(64) }))).toBeInstanceOf(Error);
});

test("rows the acting vault doesn't read, another vault's database and other types hold no recipe", () => {
	const d = deviceOf();
	expect(recipeRows(d.db, VAULT).length).toBe(327);
	expect(recipeRows(d.db, 'ef'.repeat(32))).toEqual([]);
	expect(recipeRows(null, VAULT)).toEqual([]);
	// another vault's own: it reads only what is shared with it, or Public
	const other = 'ef'.repeat(32);
	expect(Object.keys(vaultSource(d.world, d.db, VAULT, other, d.readFile).index.recipes)).toEqual([]);
	const apple = of(d, 'plants/apple@2');
	apple.row.public = true;
	expect(Object.keys(vaultSource(d.world, d.db, VAULT, other, d.readFile).index.recipes)).toEqual([LABEL['plants/apple@2']]);
	// a row whose record this browser doesn't hold, or of another type, is no recipe row, and is refused for nothing
	apple.row.record = null;
	const notes = { ...d.db.rows[1], type: 'note', kind: 'note' };
	const v = vaultSource(d.world, { ...d.db, rows: [...d.db.rows, notes] }, VAULT, ACTOR, d.readFile);
	expect(v.refused).toEqual([]);
	expect(Object.keys(v.index.recipes).length).toBe(326);
	expect(() => v.hashOf('plants/apple@2')).toThrow(/plants\/apple@2 is not in the Maia City vault/);
});

test('the shelf lists every recipe of the vault once, by group, asset (its entry), version and variant, from its entries alone', () => {
	const d = assetDeviceOf();
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	expect(v.refused).toEqual([]);
	expect(v.index).toEqual(made.index);
	const shelf = shelfOf(v);
	const groups = shelf.map((g) => g.group);
	expect(groups).toEqual(GROUPS.filter((g) => groups.includes(g)));
	expect(new Set(groups)).toEqual(new Set(Object.values(made.index.recipes).map((r) => r.group)));
	// one asset for each entry, named by its entry, never a slug
	const assets = shelf.flatMap((g) => g.assets);
	expect(assets.map((a) => a.entry).sort()).toEqual(d.db.rows.map((r) => r.entry).sort());
	for (const a of assets) expect(Object.keys(a).sort()).toEqual(['entry', 'title', 'versions']);
	const items = assets.flatMap((a) => a.versions.flatMap((x) => x.recipes));
	expect(items.length).toBe(327);
	expect(new Set(items.map((x) => x.hash))).toEqual(new Set(HASHES));
	for (const x of items) {
		expect(x.entry).toBe(assetEntry(`${x.card.group}/${x.card.id}`));
		expect([x.title, x.note]).toEqual([CARDS[x.hash].label, CARDS[x.hash].note ?? '']);
	}
	const asset = (name) => assets.find((a) => a.entry === assetEntry(name));
	// an asset's versions by its entry's own numbers, the newest first; its variants, its first first, each named as
	// its card names it
	expect(asset('plants/apple').versions.map((x) => x.v)).toEqual([2, 1]);
	const ant = asset('actors/ant');
	expect(ant.title).toBe('Ant');
	expect(ant.versions[0].recipes[0].variant).toBe(made.index.first['actors/ant@1']);
	expect(ant.versions[0].recipes.map((x) => x.name).sort()).toEqual(['Ant hill', 'Wood ant']);
	for (const a of assets) for (const x of a.versions) expect(x.recipes.filter((r) => r.first).length).toBeLessThanOrEqual(1);
	// an asset of one recipe goes by its card's label
	expect(asset('things/bell-tent').title).toBe(CARDS[LABEL['things/bell-tent@1']].label);
	// a version is named by avenDB alone: its title, its variant's own name, its number and its entry's short id
	const truck = asset('machines/truck');
	expect(nameOf(truck, truck.versions[0].recipes[0])).toBe(`${truck.title} v2 · ${truck.entry.slice(0, 8)}…`);
	expect(nameOf(ant, ant.versions[0].recipes.find((x) => x.name === 'Ant hill'))).toBe(`Ant · Ant hill v1 · ${ant.entry.slice(0, 8)}…`);
	// the number is the entry's own, where it says one, not its card's
	const renumbered = { ...d.db, rows: d.db.rows.map((r) => (r.entry === truck.entry ? { ...r, brought: r.brought.map((b) => ({ ...b, version: b.version + 4 })) } : r)) };
	const moved = shelfOf(vaultSource(d.world, renumbered, VAULT, ACTOR, d.readFile)).flatMap((g) => g.assets).find((a) => a.entry === truck.entry);
	expect(moved.versions.map((x) => x.v)).toEqual([6, 5]);
	// an empty vault lists nothing
	expect(shelfOf(vaultSource(d.world, null, VAULT, ACTOR, d.readFile))).toEqual([]);
});

test('an entry the reader refused says why, naming its entry, where the shelf leaves it out', () => {
	const d = assetDeviceOf();
	const row = d.db.rows.find((r) => r.entry === assetEntry('plants/apple'));
	// its v2 made for an engine this page doesn't run
	const v2 = row.brought.find((b) => b.version === 2);
	v2.record = { ...v2.record, engine: { ...v2.record.engine, hash: 'f'.repeat(64) } };
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	expect(v.refused.length).toBe(1);
	expect(refusedOf(v, row)).toEqual(v.refused);
	expect(refusedOf(v, row)[0]).toMatch(new RegExp(`^plants/apple@2 \\(entry ${row.entry.slice(0, 12)}…\\): made for box engine \\d+ \\(ffffffffffff…\\)`));
	expect(shelfOf(v).flatMap((g) => g.assets).find((a) => a.entry === row.entry).versions.map((x) => x.v)).toEqual([1]);
	// an entry it said nothing of
	expect(refusedOf(v, d.db.rows.find((r) => r.entry === assetEntry('things/bell-tent')))).toEqual([]);
	expect(refusedOf(v, { entry: 'f'.repeat(64), record: { card: 'not a card' } })).toEqual([]);
});

test("a build is its entry's file, run in the box, checked; the cache only once the vault's file checks", async () => {
	const label = 'things/bell-tent@1';
	const hash = LABEL[label];
	const d = deviceOf([hash, LABEL['actors/ant@1:ant']]);
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	const box = boxOf();
	const store = storeOf();
	const got = await vaultBuild(v, hash, {}, { box, store });
	// the box was handed the vault's file, byte for byte, and nothing else
	expect(box.asked).toEqual([{ recipe: { hash, code: FILES[hash] }, given: undefined }]);
	expect([got.from, got.label, got.name, got.card.recipe, got.card.triangles]).toEqual(['box', label, hash, hash, CARDS[hash].triangles]);
	expect(got.obj.isObject3D).toBe(true);
	expect(await got.stored).toBe(true);
	// kept under the key a build of that recipe on that engine is kept by, wherever its recipe came from
	const key = keyOf({ engine: ENGINES.find((e) => e.v === made.index.engine).blake3, recipe: hash });
	expect([...store.kept.keys()]).toEqual([key]);
	// built again: from the cache, its file still held to its hash first
	const again = await vaultBuild(v, hash, {}, { box, store });
	expect([again.from, again.card.triangles, box.asked.length]).toEqual(['cache', CARDS[hash].triangles, 1]);
	// a vault that has lost its file shows nothing, though this device built it before
	const lost = deviceOf([hash]);
	lost.world.entries[0].files = [];
	const gets = store.asked.get;
	const gone = vaultSource(lost.world, lost.db, VAULT, ACTOR, lost.readFile);
	const err = await thrown(() => vaultBuild(gone, hash, {}, { box, store }));
	expect(err).toBeInstanceOf(NotInVault);
	expect(err.message.startsWith(`${gone.nameOf(hash)}: its file could not be read`)).toBe(true);
	expect([store.asked.get, box.asked.length]).toEqual([gets, 1]);
	// a spoiled build in the cache is dropped and built again
	store.kept.set(key, { data: null, card: { nope: true } });
	const fresh = await vaultBuild(v, hash, {}, { box, store });
	expect([fresh.from, store.asked.drop, box.asked.length]).toEqual(['box', 1, 2]);
}, 60000);

test('what its recipe is built with, from its card: given as text, checked, named the one way', async () => {
	const label = 'actors/ant@1:ant';
	const hash = LABEL[label];
	const d = deviceOf([hash]);
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	const box = boxOf();
	const got = await vaultBuild(v, hash, { detail: '0.5' }, { box, store: storeOf() });
	expect(box.asked[0].given).toEqual({ detail: '0.5' });
	expect([got.name, got.values]).toEqual([`${hash}?detail=0.5`, { detail: 0.5 }]);
	expect(got.card.ref).toBe(`${label}?detail=0.5`);
	expect(buildName(hash, { b: 2, a: 1 })).toBe(`${hash}?a=1&b=2`);
	// a value out of its range, or one it doesn't take: refused, naming the ref, before anything is read or built
	const reads = d.reads.length;
	expect((await thrown(() => vaultBuild(v, hash, { detail: '7' }, { box, store: storeOf() }))).message).toMatch(/^actors\/ant@1:ant: detail: 7 is out of/);
	expect((await thrown(() => vaultBuild(v, hash, { seed: 'x' }, { box, store: storeOf() }))).message).toMatch(/^actors\/ant@1:ant: no parameter seed/);
	const tent = deviceOf([LABEL['things/bell-tent@1']]);
	const t = vaultSource(tent.world, tent.db, VAULT, ACTOR, tent.readFile);
	expect((await thrown(() => vaultBuild(t, LABEL['things/bell-tent@1'], { seed: 'x' }, { box, store: storeOf() }))).message).toBe('things/bell-tent@1 takes no parameters');
	expect([d.reads.length, tent.reads.length, box.asked.length]).toEqual([reads, 0, 1]);
	// a hash the vault doesn't hold, however it is spelt
	for (const no of [LABEL['plants/apple@2'], 'constructor', '__proto__', '', undefined]) expect(await thrown(() => vaultBuild(v, no, {}, { box, store: storeOf() }))).toBeInstanceOf(NotInVault);
}, 60000);

test("what the box hands back is checked as every build is: a card that doesn't fit, or names another recipe, is refused", async () => {
	const label = 'things/bell-tent@1';
	const hash = LABEL[label];
	const d = deviceOf([hash]);
	const v = vaultSource(d.world, d.db, VAULT, ACTOR, d.readFile);
	const real = boxOf();
	const lying = (f) => ({ engine: made.index.engine, build: async (recipe, given) => f(await real.build(recipe, given)) });
	const refused = async (box) => (await thrown(() => vaultBuild(v, hash, {}, { box, keep: false }))).message;
	expect(await refused(lying((b) => ({ ...b, card: { ...b.card, recipe: LABEL['things/bell-tent-bag@1'] } })))).toBe(`${label}: refused, its card names another recipe`);
	expect(await refused(lying((b) => ({ ...b, card: { ...b.card, size: 'big' } })))).toMatch(/^things\/bell-tent@1: refused, its card does not fit/);
	expect(await refused({ engine: made.index.engine, build: async () => Promise.reject(new Error('the box crashed')) })).toBe(`${label}: the box could not build it (the box crashed)`);
}, 60000);

/**
 * The modules a module imports, as its source names them, followed through ours (`$lib/`, relative): every file and
 * every name it reaches, so a test can say what it never reaches.
 */
function reached(...from) {
	const seen = new Set();
	const names = new Set();
	const resolved = (spec, dir) => {
		const base = spec.startsWith('$lib/') ? resolve(ROOT, 'src/lib', spec.slice(5)) : spec.startsWith('.') ? resolve(dir, spec) : null;
		if (!base) return null;
		for (const p of [base, `${base}.js`, `${base}.ts`, `${base}.svelte`, `${base}/index.js`]) if (existsSync(p) && !p.endsWith('/')) return p;
		return null;
	};
	const walk = (file) => {
		if (seen.has(file) || !/\.(js|ts|svelte)$/.test(file)) return;
		seen.add(file);
		// what it runs, not what its comments and types name (a JSDoc `import('./groups.js')` is no import)
		const text = readFileSync(file, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
		for (const m of text.matchAll(/(?:^|[^.\w])(?:import|export)\s*(?:[\w*{}\s,$]+\s+from\s+)?\(?\s*['"]([^'"]+)['"]/gm)) {
			names.add(m[1]);
			const p = resolved(m[1], dirname(file));
			if (p) walk(p);
		}
	};
	for (const f of from) walk(resolve(ROOT, f));
	return { files: [...seen].map((f) => f.slice(ROOT.length)), names: [...names] };
}

test("an AIP's version of an asset is read on its line and built from its own file, before its vault accepts it", async () => {
	const [one, two] = [LABEL['machines/truck@1:truck'], LABEL['machines/truck@2:truck']];
	const entryOf = (hash) => recipeEntryOf({ code: FILES[hash], card: CARDS[hash], first: true });
	const store = new Map();
	const fileOf = (hash) => {
		const bytes = utf8ToBytes(FILES[hash]);
		const f = sealed(bytes, hash);
		store.set(f.root, bytes);
		return f;
	};
	const readFile = async (root, size, from, to) => store.get(root).slice(from, to);
	// the truck's entry as the seed wrote it at v1, and v2 proposed on a line of it (scripts/propose-version.mjs), as
	// `get` reads that line: v2's record, and what the line brings, v1's file first; its tags are not read
	const truck = { entry: 'e'.repeat(64), vault: VAULT, type: 'recipe', tags: [], record: entryOf(one).value, line: null, heads: ['c'.repeat(64)], files: [fileOf(one)] };
	const row = { ...truck, record: entryOf(two).value, line: 'a'.repeat(64), heads: ['b'.repeat(64)], files: [fileOf(one), fileOf(two)] };
	const p = proposedSource([row], readFile, [truck]);
	expect(p.refused).toEqual([]);
	expect(Object.keys(p.index.recipes)).toEqual([two]);
	expect(await p.recipeAt(two)).toEqual({ hash: two, code: FILES[two] });
	const built = await vaultBuild(p, two, {}, { box: boxOf(), keep: false });
	expect(built.card.version).toBe(2);
	// another asset's version on the truck's line is refused: the entry's first version says it is the truck
	const other = { ...row, record: entryOf(LABEL['machines/pickup@1:pickup']).value };
	expect(proposedSource([other], readFile, [truck]).refused).toEqual([`machines/pickup@1:pickup (entry eeeeeeeeeeee…): its entry is machines/truck’s, and an entry is one asset`]);
	// a new entry, which the AIP lands on Accept, has no first version yet: its line is its first
	expect(proposedSource([other], readFile, []).refused).toEqual([]);
	// a device older than `get`'s files says so, and a file that isn't the recipe its card names is refused
	expect((await thrown(() => proposedSource([{ ...row, files: undefined }], readFile).recipeAt(two))).message).toMatch(/needs a newer avenDB/);
	expect(await thrown(() => proposedSource([{ ...row, files: [fileOf(two), fileOf(one)] }], readFile).recipeAt(two))).toBeInstanceOf(NotInVault);
});

test("the viewer's modules reach nothing of the repo's recipes, cards or libraries: only the kernel", () => {
	const { files, names } = reached('src/lib/avendb/Assets.svelte', 'src/lib/assets/VaultAsset.svelte', 'src/lib/avendb/Hitl.svelte', 'src/lib/proposals/AvendbAip.svelte');
	for (const f of ['src/lib/avendb/assets.js', 'src/lib/assets/sources/shelf.js', 'src/lib/assets/sources/viewer.js', 'src/lib/assets/sources/avendb.js', 'src/lib/assets/box/host.js', 'src/lib/assets/hero.js', 'src/lib/assets/stage.js', 'src/lib/render/stage.js', 'src/lib/assets/cache.js'])
		expect(files).toContain(f);
	for (const f of ['src/lib/assets/recipes.js', 'src/lib/assets/load.js', 'src/lib/assets/AssetViewer.svelte', 'src/lib/assets/index.js', 'src/lib/assets/sources/cards.js', 'src/lib/assets/box/plugin.js', 'src/lib/assets/recipe.js', 'src/lib/assets/groups.js'])
		expect(files).not.toContain(f);
	expect(names.filter((n) => n.startsWith('virtual:') || n.endsWith('cards.json'))).toEqual([]);
	// and the table editor's drawer leads a recipe row there, by its entry
	const editor = readFileSync(resolve(ROOT, 'src/lib/avendb/TableEditor.svelte'), 'utf8');
	expect(editor).toContain('href="#assets/{row.entry}"');
	const apps = readFileSync(resolve(ROOT, 'src/lib/avendb/VaultApps.svelte'), 'utf8');
	expect(apps).toContain("['assets', 'Assets', 'asset']");
	const shell = readFileSync(resolve(ROOT, 'src/lib/avendb/Shell.svelte'), 'utf8');
	expect(shell).toContain('<Assets {world} vault={context} {actor} {api} entry={route.asset} recipe={route.recipe} />');
});
