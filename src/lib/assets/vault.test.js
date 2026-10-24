// @ts-nocheck
// Runtime assets read only local avenDB. Remote fallback contracts were replaced with no-network regressions.
import { expect, mock, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

// the page's own ops, not the manifests' walk a device opened on it makes first (game/code/sources/manifests.js)
const ownOps = (o) => o.where?.type?.[0] !== 'manifest' && o.op !== 'synced';

// outside a page: textures draw on a stand-in canvas, and a module's runes are plain values
const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop, set: () => true });
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => noop, style: {} }) };
globalThis.$state ??= (x) => x;

const ROOT = join(import.meta.dir, '../../..');

// our recipes, as Vite's build hands them to the seed (./box/plugin.js): what the stand-in feed is made of, and what a
// page reading the vault must build the same as
const { bundleRecipes } = await import('../../../scripts/ci/recipe-fixture.mjs');
const made = await bundleRecipes();
mock.module('$app/paths', () => ({ base: '' }));
mock.module('virtual:asset-recipes', () => ({ default: made.index }));
mock.module('virtual:asset-recipes/libraries', () => ({ default: Object.fromEntries(Object.entries(made.libraries).map(([k, text]) => [k, async () => ({ default: text })])) }));

const CARDS = JSON.parse(readFileSync(new URL('./sources/cards.json', import.meta.url), 'utf8')).cards;
const { DEV_VAULT, devFeedOf, serveDevFeed } = await import('./sources/devfeed.js');
const vault = await import('./vault.js');
const repo = await import('./recipes.js');
const { canonical, keyOf, loadAsset } = await import('./load.js');
const cache = await import('./cache.js');
const { engineAt, recipeFile } = await import('./engines.js');
const { valuesOf } = await import('./params.js');
const { buildWith, parseRef, refOf } = await import('./refs.js');
const { NotInVault } = await import('./sources/avendb.js');
const { recipeOfFile } = await import('./sources/cards.js');
const { cardOf } = await import('./card.js');
const { bake } = await import('./box/bake.js');
const { catalogOf, viewOf } = await import('./box/view.js');
const { serialize } = await import('./box/serialize.js');
const { CODE_FEED, fileOf, listingOf, proofOf, seedFeedOf, verifyProof } = await import('../../../game/code/sources/feed.js');
const { slug } = await import('$lib/ids.js');
const { blake3 } = await import('@noble/hashes/blake3.js');
const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils.js');

/** the stand-in for the vault's feed, made from the repo as the seed writes it */
const FEED = devFeedOf(made, CARDS);
/** where the test's feed is: as avenDB's server's, at another address */
const AT = 'https://feed.example/feed/code';
const ROWS_URL = `https://feed.example/feed/code?vault=${DEV_VAULT}&type=recipe`;
/** where the proof of some entries is */
const proofAt = (entries) => proofOf(['recipe'], { vault: DEV_VAULT, feed: AT, entries });
/** the entries a proof's address asks for */
const entriesOf = (url) => (new URL(url).searchParams.get('entry') ?? '').split(',').filter(Boolean);
const LABEL = made.index.labels;
/** each recipe's file, by its hash, as the box plugin makes it */
const FILES = Object.fromEntries(Object.entries(made.index.recipes).map(([hash, at]) => [hash, recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant)]));
/** the row of a recipe of ours, by its label */
const rowAt = (label) => FEED.rows.find((r) => r.record.card.recipe === LABEL[label]);

/**
 * A feed as avenDB's server serves one, as a fetch: `…/feed/code?…` the rows it lists, `…/feed/proof?…&entry=…` the
 * proof of some entries, here their rows as JSON, which `trusting` reads back, tagged by their hash and not modified
 * for a reader that holds that tag, and each row's newest file at `…/feed/entry/<vault>/<entry>/file`, counting what
 * is asked of it and how many proofs at once. `status` is how the listing is answered, `proving` how a proof is;
 * `proven` the rows a proof proves (the listed rows by default).
 */
function feedOf({ rows = FEED.rows, proven = rows, files = FEED.files, status = 200, proving = 200, throws = null } = {}) {
	const asked = [];
	let now = 0, most = 0;
	const get = async (url, o) => {
		asked.push(url);
		if (throws) throw new Error(throws);
		const u = new URL(url);
		if (u.pathname === '/feed/code') return status === 200 ? Response.json({ code: rows }) : new Response('down', { status });
		if (u.pathname === '/feed/proof') {
			most = Math.max(most, ++now);
			try {
				await new Promise((r) => setTimeout(r, 5));
				if (proving !== 200) return new Response('down', { status: proving });
				const want = new Set(entriesOf(url));
				const body = JSON.stringify(proven.filter((r) => want.has(r.entry)));
				const tag = `"${bytesToHex(blake3(utf8ToBytes(body)))}"`;
				if (o?.headers?.['if-none-match'] === tag) return new Response(null, { status: 304, headers: { etag: tag } });
				return new Response(body, { headers: { etag: tag } });
			} finally {
				now--;
			}
		}
		const m = /^\/feed\/entry\/([0-9a-f]{64})\/([0-9a-f]{64})\/file$/.exec(u.pathname);
		const bytes = m && u.searchParams.get('seed') === '1' && rows.some((r) => r.vault === m[1] && r.entry === m[2]) ? files.get(m[2]) : undefined;
		return bytes ? new Response(bytes, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : new Response('not found', { status: 404 });
	};
	return { get, asked, files: () => asked.filter((u) => u.includes('/file')), proofs: () => asked.filter((u) => u.includes('/feed/proof')), most: () => most };
}

/**
 * A stand-in for avenDB's WebAssembly (game/code/sources/feed.js `verifyProof`) that reads the test's rows back as
 * proven: what the loader does with proven rows is under test here; that only a proof proves any is avenDB's
 * (avendb/crates/avendb/tests/provenance.rs), and that the loader takes nothing else, below and ../code/proof.test.js.
 */
const trusting = async (bytes) => JSON.parse(new TextDecoder().decode(bytes));
/** how the test's loads prove their rows: anchored to the stand-in's vault, by the stand-in */
const PROVING = { vault: DEV_VAULT, verify: trusting };

/** where a load keeps the rows it proved and the proofs each page asked for: a fresh device's, the test's own */
const keepOf = () => {
	const held = new Map();
	return { held, get: (k) => held.get(k), put: (k, v) => void held.set(k, v) };
};

/**
 * The vault's recipes loaded from a feed of the test's own (`kept`: where the files are kept on the device; `proofs`
 * where the rows proved are, a fresh device's by default; `page` the page's address)
 */
const { useDevice } = await import('../../../game/code/sources/device.js');
const loaded = async (o = {}) => {
 const rows = o.rows ?? FEED.rows;
 const files = o.files ?? FEED.files;
 const reads = [];
 const byRoot = new Map(rows.map(r => [r.files?.at(-1)?.root, files.get(r.entry)]));
 useDevice({
  run: async op => {
   if (op.op === 'read_file') { expect(op.local).toBe(true); reads.push(op.root); return { ok: {}, bytes: byRoot.get(op.root)?.slice(op.from, op.to) }; }
   return op.op === 'code' ? { ok: rows } : { ok: { new: 0, peers: 0, behind: 0 } };
  },
  read: async (root, size, from, to) => { reads.push(root); return byRoot.get(root)?.slice(from, to); }
 });
 const asked = [];
 const r = await vault.loadRecipes({ vault: DEV_VAULT, ...o, kept: o.kept ?? keepOf(), fetch: async url => { asked.push(url); throw new Error('HTTP forbidden'); } });
 return { r, asked, files: () => reads };
};

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

/**
 * The box as a stand-in that builds in this process as the frozen engine does (./box/engine.js `buildOne`), as
 * ./sources/viewer.test.js has it: the recipe file it is handed, run with the engine's modules, carried out as data.
 */
function boxOf() {
	const asked = [];
	return {
		engine: made.index.engine,
		asked,
		async build(recipe, given, o) {
			asked.push({ recipe, given, ...(o ? { o } : {}) });
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
	return { kept, asked, get: async (k) => (asked.get++, kept.get(k)), put: async (k, b) => (asked.put++, kept.set(k, b), true), drop: async (k) => (asked.drop++, kept.delete(k)) };
}

/** the key a build was kept under on the repo's index: the engine's hash, the recipe's, every value it takes */
const repoKey = (hash, params) => {
	const at = made.index.recipes[hash];
	return cache.keyOf({ engine: engineAt(made.index.engine).blake3, recipe: hash, params: at.params?.length ? valuesOf(at.params, params) : undefined });
};

test('before the recipes are in, nothing is built, and a ref says why', () => {
	expect(vault.recipes.phase).toBe('idle');
	const err = (() => {
		try {
			vault.hashOf('plants/apple@2');
		} catch (e) {
			return e;
		}
	})();
	expect(err).toBeInstanceOf(NotInVault);
	expect(err.message).toBe("plants/apple@2 can't be built yet: the asset recipes of the Maia City vault are not loaded (a page loads them before its first build: loadRecipes)");
	expect(() => canonical(LABEL['plants/apple@2'])).toThrow(NotInVault);
	expect(vault.INDEX.recipes).toEqual({});
});

test("loaded once from local avenDB, the vault's index is the repo's: every version and variant, its latest, its first variant, its parameters", async () => {
	expect(FEED.missing).toEqual([]);
	expect(FEED.rows.length).toBe(337);
	const { r, asked, files } = await loaded();
	expect(r.phase).toBe('ready');
	expect([r.feed, r.vault, r.count, r.refused, r.missed, r.error]).toEqual(['this device', DEV_VAULT, FEED.rows.length, [], [], '']);
	// the index alone: no proof is asked for before a build
	expect(asked).toEqual([]);
	expect(vault.INDEX).toEqual(made.index);
	expect(files()).toEqual([]);
	// each card is the one the vault keeps beside its recipe
	for (const hash of Object.keys(made.index.recipes)) expect(vault.cardOf(hash)).toEqual(CARDS[hash]);
	expect(vault.cardOf('constructor')).toBeUndefined();
	// and loaded once a page: asked again, the same, nothing fetched
	expect(await vault.loadRecipes()).toBe(r);
	expect(asked.length).toBe(0);
});

test('a ref names the same build, the same page and the same cache key as the repo did, however it is named', async () => {
	await loaded();
	const refs = new Set(Object.keys(LABEL));
	for (const r of Object.values(made.index.recipes)) {
		refs.add(`${r.group}/${r.id}`);
		refs.add(`${r.group}/${r.id}@${r.v}`);
		if (r.variant) refs.add(`${r.group}/${r.id}:${r.variant}`);
		if (r.params?.length) refs.add(`${r.label}?${r.params[0].id}=${encodeURIComponent(String(r.params[0].value))}`);
	}
	let n = 0, fallbacks = 0;
	for (const ref of refs) {
		const want = repo.hashOf(ref);
		const asked = parseRef(ref).variant;
		if (want && (!asked || made.index.recipes[want].variant === asked)) {
			expect([ref, vault.hashOf(ref)]).toEqual([ref, want]);
			const name = vault.buildAt(ref);
			expect([ref, name]).toEqual([ref, repo.buildAt(ref)]);
			const c = canonical(name);
			expect([ref, keyOf(name)]).toEqual([ref, repoKey(want, parseRef(ref).params)]);
			// the same page, its words (`?t=`) the name avenDB gives it, never its old ref
			const page = vault.pageOf('/base', want, c.values);
			expect([ref, page.replace(/\?t=[^&]*/, '')]).toEqual([ref, repo.pageOf('/base', want, c.values).replace(/\?t=[^&]*/, '')]);
			expect([ref, new URL(page, 'https://x').searchParams.get('t')]).toEqual([ref, slug(vault.nameOf(want), 'asset')]);
			n++;
		} else {
			// a variant its latest version doesn't have: the repo's index named its first variant instead, the vault nothing
			expect(() => vault.hashOf(ref)).toThrow(NotInVault);
			fallbacks++;
		}
	}
	expect(n).toBeGreaterThan(600);
	console.log(`${n} refs name the same build in the vault as in the repo; ${fallbacks} named a variant their version lacks, which the repo's index swapped for the first`);
}, 60000);

test("a recipe's source is its entry's file, fetched only when this device's cache lacks the build, held to its hash, the bytes the repo built", async () => {
	const { files } = await loaded();
	for (const label of ['plants/apple@2', 'actors/stand-in@11:stand-in', 'biomes/cover@1:fern']) {
		const hash = LABEL[label];
		const got = await vault.recipeAt(hash);
		expect(got).toEqual(await repo.recipeAt(hash));
		expect(got.code).toBe(FILES[hash]);
	}
	expect(files().length).toBe(3);
	// read once a page
	await vault.recipeAt(LABEL['plants/apple@2']);
	expect(files().length).toBe(3);
	// a build: from the box, its recipe the vault's file, kept under the key the repo's build was kept by
	const box = boxOf();
	const store = storeOf();
	const name = vault.buildAt('things/bell-tent@1');
	const hash = LABEL['things/bell-tent@1'];
	const first = await loadAsset(name, { box, store });
	expect([first.from, first.card.recipe, first.label, first.key]).toEqual(['box', hash, 'things/bell-tent@1', repoKey(hash)]);
	expect(box.asked.map((a) => a.recipe)).toEqual([{ hash, code: FILES[hash] }]);
	expect(files().length).toBe(4);
	await first.stored;
	// again, and on a page loaded afresh with the build kept: from the cache, no file fetched, no box asked
	expect((await loadAsset(name, { box, store })).from).toBe('cache');
	const fresh = await loaded();
	const again = await loadAsset(name, { box, store });
	expect([again.from, again.card.recipe, again.key]).toEqual(['cache', hash, repoKey(hash)]);
	expect(fresh.files()).toEqual([]);
	expect(box.asked.length).toBe(1);
}, 120000);

test("what a recipe's entry declares is held: the modules it requires, the checks its contract names, its bytes, its time and its engine", async () => {
	const tent = rowAt('things/bell-tent@1');
	const name = () => vault.buildAt('things/bell-tent@1');
	/** the tent built as the vault holds it once its row is changed by `f`: the box it was asked of, and why it was refused */
	const built = async (f) => {
		await loaded({ rows: FEED.rows.map((x) => (x === tent ? changed(x, f) : x)) });
		const box = boxOf();
		const err = await thrown(() => loadAsset(name(), { box, store: storeOf(), cache: false }));
		return { box, err };
	};
	// as the seed writes it: every module its file names, the checks the page runs on every build, the box's own 20 s
	expect(tent.record.manifest.libs).toContain('three');
	expect(tent.record.contract).toEqual({ budgets: { ms: 20000 }, invariants: ['hash', 'card', 'budget'] });
	let { box, err } = await built(() => {});
	expect(err).toBeNull();
	expect(box.asked.map((a) => a.o)).toEqual([{ timeout: 20000 }]);
	// a shorter time its contract gives is its build's
	({ box, err } = await built((c) => (c.record.contract.budgets.ms = 1500)));
	expect(err).toBeNull();
	expect(box.asked.map((a) => a.o)).toEqual([{ timeout: 1500 }]);
	// a module its file requires that its manifest doesn't name, a module its engine lacks, a check the page doesn't run,
	// a file past its bytes: refused, and nothing built
	for (const [f, said] of [
		[(c) => (c.record.manifest.libs = c.record.manifest.libs.filter((l) => l !== 'three')), /requires three, which its manifest doesn't name/],
		[(c) => c.record.manifest.libs.push('three/addons/loaders/GLTFLoader.js'), new RegExp(`names three/addons/loaders/GLTFLoader.js, which box engine ${made.index.engine} doesn't have`)],
		[(c) => c.record.contract.invariants.push('proven'), /asks for proven, a check the page doesn't run/],
		[(c) => (c.record.contract.budgets.bytes = 100), /bigger than the 100 bytes its contract gives it/]
	]) {
		({ box, err } = await built(f));
		expect(err?.message).toMatch(said);
		expect(box.asked).toEqual([]);
	}
	// an entry that declares nothing is held to its engine alone
	({ box, err } = await built((c) => (delete c.record.manifest, delete c.record.contract)));
	expect(err).toBeNull();
	expect(box.asked.map((a) => a.o)).toEqual([{ timeout: 20000 }]);
	// it runs on the box engine its card names, and a box handed in for another engine is not asked
	await loaded();
	expect(canonical(name()).engine.v).toBe(tent.record.card.engine);
	const other = { ...boxOf(), engine: made.index.engine - 1, build: async () => Promise.reject(new Error('asked of the wrong engine')) };
	const fine = boxOf();
	const { boxOf: pageBox } = await import('./load.js');
	const real = pageBox(made.index.engine);
	const was = real.build;
	real.build = fine.build;
	try {
		expect((await loadAsset(name(), { box: other, store: storeOf(), cache: false })).from).toBe('box');
		expect(fine.asked.length).toBe(1);
	} finally {
		real.build = was;
	}
}, 60000);

test("a recipe's file read from local avenDB is kept on this device under its hash: a page loaded afresh reads it there, a spoiled copy reread locally", async () => {
	const held = new Map();
	const kept = { get: async (h) => held.get(h), put: async (h, b) => (held.set(h, b), true) };
	const hash = LABEL['plants/apple@2'];
	const one = await loaded({ kept });
	expect((await vault.recipeAt(hash)).code).toBe(FILES[hash]);
	expect(one.files().length).toBe(1);
	expect(new TextDecoder().decode(held.get(hash))).toBe(FILES[hash]);
	// a page loaded afresh (what runs in the box after a build came out of the cache asks for it): no file fetched
	const two = await loaded({ kept });
	expect(await vault.recipeAt(hash)).toEqual(await repo.recipeAt(hash));
	expect(two.files()).toEqual([]);
	// a copy spoiled on the device is not used: the feed's again, kept anew
	held.set(hash, new TextEncoder().encode(`${FILES[hash]} `));
	const three = await loaded({ kept });
	expect((await vault.recipeAt(hash)).code).toBe(FILES[hash]);
	expect(three.files().length).toBe(1);
	expect(new TextDecoder().decode(held.get(hash))).toBe(FILES[hash]);
	// a file the feed hands out that is not the recipe is refused, and never kept
	const fern = LABEL['biomes/cover@1:fern'];
	const files = new Map(FEED.files);
	files.set(rowAt('biomes/cover@1:fern').entry, new TextEncoder().encode('not the recipe'));
	await loaded({ files, kept });
	expect(vault.nameOf(fern)).toMatch(/^Biome cover · Fern v1 · [0-9a-f]{8}…$/);
	expect(String((await thrown(() => vault.recipeAt(fern)))?.message)).toContain(`${vault.nameOf(fern)}: its file could not be read`);
	expect(held.has(fern)).toBe(false);
}, 60000);

test('a recipe the vault does not hold, or holds otherwise, fails naming its ref, and the page is told: there is no repo to fall back on', async () => {
	const told = [];
	const stop = vault.watchRecipes((r) => told.push([...r.missed]));
	const apple = rowAt('plants/apple@2');
	const { r, files } = await loaded({ rows: FEED.rows.filter((x) => x !== apple) });
	expect([r.phase, r.count]).toEqual(['ready', FEED.rows.length - 1]);
	const missing = (f, ...said) => {
		let err = null;
		try {
			f();
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(NotInVault);
		for (const s of said) expect(err.message).toContain(s);
		return err;
	};
	missing(() => vault.hashOf('plants/apple@2'), 'plants/apple@2', 'is not in the Maia City vault');
	missing(() => vault.hashOf('plants/apple@2'), 'plants/apple@2', 'is not in the Maia City vault');
	missing(() => vault.buildAt('plants/apple@2?seed=maia&stage=9'), 'plants/apple@2?seed=maia&stage=9', 'is not in the Maia City vault');
	missing(() => canonical(LABEL['plants/apple@2']), `no recipe ${LABEL['plants/apple@2'].slice(0, 12)}… is in the Maia City vault`);
	expect(await thrown(() => loadAsset(LABEL['plants/apple@2'], { box: boxOf(), store: storeOf() }))).toBeInstanceOf(NotInVault);
	// a ref that names no version names the latest the vault holds, never one it lacks
	expect(vault.hashOf('plants/apple')).toBe(LABEL['plants/apple@1']);
	// each told once, on the page and in the console
	expect(vault.recipes.missed.filter((m) => m.startsWith('plants/apple@2 ')).length).toBe(1);
	await Promise.resolve();
	expect(told.at(-1)).toEqual(vault.recipes.missed);
	expect(files()).toEqual([]);
	stop();
	// a file that isn't the recipe its ref names (another's bytes), an entry that brings none, one too large: refused,
	// naming the ref, and nothing is built from it
	const hash = LABEL['plants/apple@2'];
	const box = boxOf();
	const refused = async (o, pattern) => {
		await loaded(o);
		const err = await thrown(() => loadAsset(vault.buildAt('plants/apple@2'), { box, store: storeOf() }));
		expect(err).toBeInstanceOf(NotInVault);
		expect(err.message.startsWith(`${vault.nameOf(hash)}: `)).toBe(true);
		expect(err.message).toMatch(pattern);
		expect([...vault.recipes.missed, ...vault.recipes.unread]).toContain(err.message);
	};
	await refused({ files: new Map([...FEED.files, [apple.entry, FEED.files.get(rowAt('plants/apple@1').entry)]]) }, /does not match/);
	await refused({ files: new Map([...FEED.files].filter(([e]) => e !== apple.entry)) }, /Waiting for this recipe file/);
	await refused({ rows: FEED.rows.map((x) => (x === apple ? changed(x, (c) => (c.files = [])) : x)) }, /brings no file/);
	await refused({ rows: FEED.rows.map((x) => (x === apple ? changed(x, (c) => (c.files[0].len = vault.MOST + 1)) : x)) }, /size limit/);
	expect(box.asked).toEqual([]);
	// and the same served as it should be builds it
	await loaded();
	expect((await vault.recipeAt(hash)).code).toBe(FILES[hash]);
}, 60000);

test("an entry the reader refuses, or the vault deleted, is none of its recipes, and the page is told which", async () => {
	const tent = rowAt('things/bell-tent@1');
	const { r } = await loaded({
		rows: FEED.rows.map((x) => (x === tent ? changed(x, (c) => (c.record.engine.version = 1)) : x === rowAt('plants/apple@1') ? changed(x, (c) => c.tags.push('avendb:deleted')) : x))
	});
	expect(r.phase).toBe('ready');
	expect(r.count).toBe(FEED.rows.length - 2);
	expect(r.refused.length).toBe(1);
	expect(r.refused[0]).toMatch(/^things\/bell-tent@1 \(entry .*\): made for box engine 1/);
	expect(() => vault.hashOf('things/bell-tent@1')).toThrow(/things\/bell-tent@1 is not in the Maia City vault: things\/bell-tent@1 \(entry/);
	expect(() => vault.hashOf('plants/apple@1')).toThrow(NotInVault);
});

test('a recipe made for an older frozen box engine is one of the recipes and runs on that engine; one naming an engine otherwise is refused', async () => {
	const tent = rowAt('things/bell-tent@1');
	const older = made.index.engine - 1;
	/** the tent's row made for box engine `v`, its hash `hash`, its card for `card` */
	const madeFor = (v, hash, card = v) => changed(tent, (c) => ((c.record.engine = { host: 'box', version: v, hash }), (c.record.card.engine = card)));
	const { r } = await loaded({ rows: FEED.rows.map((x) => (x === tent ? madeFor(older, engineAt(older).blake3) : x)) });
	expect(r.refused).toEqual([]);
	expect(canonical(vault.buildAt('things/bell-tent@1')).engine).toEqual(engineAt(older));
	for (const [row, said] of [
		[madeFor(older, engineAt(made.index.engine).blake3), `made for box engine ${older} \\(${engineAt(made.index.engine).blake3.slice(0, 12)}…\\)`],
		[madeFor(older, engineAt(older).blake3, made.index.engine), `made for box engine ${older} .*, its card for ${made.index.engine}`],
		[madeFor(99, 'f'.repeat(64)), 'made for box engine 99'],
		[changed(tent, (c) => (c.record.engine.host = 'view')), `made for view engine ${made.index.engine}`]
	]) {
		const { r: no } = await loaded({ rows: FEED.rows.map((x) => (x === tent ? row : x)) });
		expect(no.refused.length).toBe(1);
		expect(no.refused[0]).toMatch(new RegExp(`^things/bell-tent@1 \\(entry .*\\): ${said}`));
	}
});

test("a recipe's entry listed older than this device proved it (game/code/fresh.js) is refused where its newest is asked for, naming both versions; a version named still builds", async () => {
	const { useDevice } = await import('../../../game/code/sources/device.js');
	const { newestKeeper } = await import('../../../game/code/fresh.js');
	const apple = rowAt('plants/apple@2');
	const at = (writes) => FEED.rows.map((r) => (r === apple ? { ...r, version: { version: 2, edits: 0, writes } } : r));
	const newest = newestKeeper({ storage: false });
	// this device's own avenDB proved the entry at 9 writes
	useDevice({ run: async (op) => (op.op === 'bring' ? { ok: { new: 0, peers: 1, reached: true } } : { ok: at(9) }), read: async () => new Uint8Array() });
	try {
		const r = await vault.loadRecipes({ feed: AT, fetch: feedOf().get, timeout: 1000, ...PROVING, proofs: keepOf(), newest });
		expect([r.feed, r.refused]).toEqual(['this device', []]);
	} finally {
		useDevice(null);
	}
	// then the feed lists it at 5
	const f = feedOf({ rows: at(5) });
	const { r } = await loaded({ rows: at(5), newest });
	expect(r.phase).toBe('ready');
	expect(r.refused).toEqual([expect.stringMatching(/^plants\/apple@2 \(entry [0-9a-f]{8}…\) of vault [0-9a-f]{8}…: refused, the version handed out \(v2, 5 writes, .*older than the newest this device already proved \(v2, 9 writes/)]);
	expect(() => vault.hashOf('plants/apple')).toThrow(/^plants\/apple: its newest version can't be read: plants\/apple@2 \(entry .*refused/);
	expect(vault.hashOf('plants/apple@2')).toBe(LABEL['plants/apple@2']);
	expect(vault.hashOf('things/bell-tent')).toBe(LABEL['things/bell-tent@1']);
}, 60000);

test("the dev server's stand-in serves the feed as avenDB's server does: the rows, and each entry's file as plain text", async () => {
	const serve = serveDevFeed('/__recipe-feed', async () => FEED);
	const ask = (url) =>
		new Promise((ok) => {
			const res = { headers: {}, statusCode: 200, setHeader: (k, v) => (res.headers[k] = v), end: (body) => ok({ ...res, body }) };
			serve({ url }, res, () => ok({ next: true }));
		});
	const rows = await ask('/__recipe-feed/code?seed=1&type=recipe');
	expect([rows.statusCode, rows.headers['content-type']]).toEqual([200, 'application/json']);
	expect(JSON.parse(rows.body).code.length).toBe(FEED.rows.length);
	expect(JSON.parse((await ask('/__recipe-feed/code?seed=1&type=view,logic')).body)).toEqual({ code: [] });
	const apple = rowAt('plants/apple@2');
	const file = await ask(`/__recipe-feed/entry/${DEV_VAULT}/${apple.entry}/file?seed=1`);
	expect([file.statusCode, file.headers['content-type'], file.headers['x-content-type-options']]).toEqual([200, 'text/plain; charset=utf-8', 'nosniff']);
	expect(new TextDecoder().decode(file.body)).toBe(FILES[LABEL['plants/apple@2']]);
	expect((await ask(`/__recipe-feed/entry/${'ef'.repeat(32)}/${apple.entry}/file`)).statusCode).toBe(404);
	expect((await ask('/__recipe-feed/entry/x/y/file')).statusCode).toBe(404);
	expect(await ask('/app/buildings/')).toEqual({ next: true });
});

test('the app holds every page that builds assets until the recipes are in, and no other', () => {
	for (const p of ['/app/buildings/', '/app/biomes/', '/app/factories/', '/app/maiacity-v1/', '/app/worlds/tired-land/', '/app/games/sandbox-3/', '/app/games/sandbox-4/', '/app/assets/box/', '/app/assets/render/', '/app/assets/render/levels/'])
		expect([p, vault.ASSET_PAGES.test(p)]).toEqual([p, true]);
	for (const p of ['/app/', '/app/avendb/', '/app/assets/', '/app/worlds/', '/app/games/', '/app/games/sandbox-2/', '/app/coops/', '/app/studio/', '/app/plants/', '/app/machines/', '/app/plantsx/', '/app/buildings/x/y'])
		expect([p, vault.ASSET_PAGES.test(p)]).toEqual([p, false]);
});

/* ── who reads the repo's index ── */

const SOURCES = /\.(js|mjs|ts|svelte)$/;
function* files(dir) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'target') continue;
		const p = join(dir, e.name);
		if (e.isDirectory()) yield* files(p);
		else if (SOURCES.test(e.name)) yield p;
	}
}
const isTest = (path) => /\.test\.[jt]s$/.test(path);

/** a module's code without its comments (a JSDoc import('…') names a type, and imports nothing), and a component's markup's */
function code(file) {
	let s = readFileSync(file, 'utf8');
	if (file.endsWith('.svelte')) s = s.replace(/<!--[\s\S]*?-->/g, '');
	return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** what a module imports, as written: static imports and re-exports, dynamic imports, and the files a glob names */
function specifiers(file) {
	const s = code(file);
	const out = new Set();
	for (const m of s.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[\w*$\s{},]*?\s+from\s+)?['"]([^'"]+)['"]/g)) out.add(m[1]);
	for (const m of s.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]);
	for (const m of s.matchAll(/\bimport\.meta\.glob\(\s*\[?\s*['"]([^'"]+)['"]/g)) out.add(m[1]);
	return [...out];
}

const EXT = ['', '.js', '.ts', '.svelte', '.mjs', '/index.js', '/index.ts'];
/** a specifier as the file of ours it names, relative to the repo; the specifier itself for a virtual module; null for a package */
function resolveOf(from, spec) {
	if (spec.startsWith('virtual:')) return spec;
	let base;
	spec = spec.split('?')[0];
	if (spec === '$lib' || spec.startsWith('$lib/')) base = join(ROOT, 'src/lib', spec.slice(5));
	else if (spec.startsWith('/src/')) base = join(ROOT, spec);
	else if (spec.startsWith('.')) base = join(dirname(from), spec);
	else return null;
	for (const e of EXT) if (existsSync(base + e) && statSync(base + e).isFile()) return relative(ROOT, base + e);
	return null;
}

/** the repo's index of recipes, and what it is made of or made with: only the seed, the scripts and the tests read it */
const REPO_INDEX = ['src/lib/assets/recipes.js', 'src/lib/assets/box/plugin.js', 'src/lib/assets/sources/cards.json', 'src/lib/assets/sources/cards.js', 'src/lib/assets/sources/devfeed.js'];
const isRepoIndex = (to) => REPO_INDEX.includes(to) || to === 'virtual:asset-recipes' || to.startsWith('virtual:asset-recipes/');

/** who else may, and why */
const MAY = {
	'src/lib/avendb/seed.js': { 'src/lib/assets/recipes.js': 'the seed writes the repo\'s recipes into the Maia City vault', 'src/lib/assets/sources/cards.json': "and each one's card beside it" },
	'src/lib/assets/recipes.js': { 'virtual:asset-recipes': 'the repo\'s index itself', 'virtual:asset-recipes/libraries': "the repo's index itself: each asset's library" },
	'vite.config.ts': { 'src/lib/assets/box/plugin.js': 'the build makes the repo\'s recipes for the seed (and serves the box its trials)' },
	'src/lib/sandbox/bundle.js': { 'src/lib/assets/box/plugin.js': 'freezing a box engine bundles it as the build does (scripts/freeze-engine.mjs), never in a page' }
};
const mayRead = (path, to) => isTest(path) || path.startsWith('scripts/') || !!MAY[path]?.[to];

/** every module that reads the repo's index: path -> what of it */
function readers() {
	const found = {};
	const tops = ['src', 'game', 'api/src', 'scripts'].map((t) => join(ROOT, t));
	for (const file of [...tops.flatMap((t) => [...files(t)]), join(ROOT, 'vite.config.ts')]) {
		const path = relative(ROOT, file);
		for (const spec of specifiers(file)) {
			const to = resolveOf(file, spec);
			if (to && to !== path && isRepoIndex(to)) (found[path] ??= []).push(to);
		}
	}
	return found;
}

test("nothing but the seed, the scripts, the dev feed's server and the tests reads the repo's recipe index or virtual:asset-recipes", () => {
	const found = readers();
	const extra = Object.entries(found).flatMap(([path, tos]) => tos.filter((to) => !mayRead(path, to)).map((to) => `${path}: ${to}`));
	expect(extra).toEqual([]);
	// each one allowed is still there, so the rule holds something
	for (const [path, tos] of Object.entries(MAY)) for (const to of Object.keys(tos)) expect(found[path] ?? [], `${path}: ${to}`).toContain(to);
	expect(found['src/lib/assets/sources/vault.test.js']).toContain('src/lib/assets/recipes.js');
	expect(found['scripts/recipe-cards.mjs']).toContain('src/lib/assets/box/plugin.js');
});

/** every module a module reaches through what it imports, never past `stops` */
function reach(from, stops = []) {
	const seen = new Set();
	const walk = (path) => {
		if (seen.has(path)) return;
		seen.add(path);
		if (path.startsWith('virtual:') || stops.includes(path) || !SOURCES.test(path)) return;
		for (const spec of specifiers(join(ROOT, path))) {
			const to = resolveOf(join(ROOT, path), spec);
			if (to) walk(to);
		}
	};
	walk(from);
	return seen;
}

/** every page and layout of the site, and the address it is served at */
const ROUTES = [...files(join(ROOT, 'src/routes'))]
	.map((f) => relative(ROOT, f))
	.filter((p) => /\/\+(page|layout)(\.server)?\.(svelte|js|ts)$/.test(p))
	.map((p) => ({ path: p, at: `${p.replace(/^src\/routes/, '').replace(/\/\+(page|layout)(\.server)?\.(svelte|js|ts)$/, '')}/` }));

test("no page reaches the repo's index but through the seed", () => {
	const SEED = 'src/lib/avendb/seed.js';
	const through = ROUTES.filter((r) => [...reach(r.path, [SEED])].some(isRepoIndex)).map((r) => r.path);
	expect(through).toEqual([]);
	// the rule finds the seed's own way there (so it holds something)
	expect([...reach('src/lib/avendb/seed.js')].some(isRepoIndex)).toBe(true);
});

test('every page that builds assets waits for the vault\'s recipes before its first build', () => {
	const VAULT_JS = 'src/lib/assets/vault.js';
	const pages = ROUTES.filter((r) => r.path.includes('/+page.') && reach(r.path).has(VAULT_JS));
	// (the film's eight pages are one now, src/routes/games/[world=world])
	expect(pages.length).toBeGreaterThan(10);
	const waits = (r) =>
		// the app's layout holds these (./VaultRecipes.svelte), an asset's own page loads them first (its +page.js), and a
		// film's world is raised once they are in ($lib/film/FilmRoute.svelte)
		(r.at.startsWith('/app/') && vault.ASSET_PAGES.test(r.at)) || r.path === 'src/routes/[doc=doc]/+page.js' || r.path === 'src/routes/[doc=doc]/+page.svelte' || (r.at.startsWith('/games/') && reach(r.path).has('src/lib/film/FilmRoute.svelte'));
	expect(pages.filter((r) => !waits(r)).map((r) => r.path)).toEqual([]);
	const layout = readFileSync(join(ROOT, 'src/routes/app/+layout.svelte'), 'utf8');
	expect(layout).toContain('<VaultRecipes hold={assetPage}>{@render children()}</VaultRecipes>');
	expect(layout).toContain('const assetPage = $derived(ASSET_PAGES.test(rel));');
	expect(readFileSync(join(ROOT, 'src/lib/film/FilmRoute.svelte'), 'utf8')).toMatch(/<VaultRecipes><FilmWorld /);
	expect(readFileSync(join(ROOT, 'src/routes/[doc=doc]/+page.js'), 'utf8')).toContain('await loadRecipes()');
});



 test('no local device means no HTTP fallback, even when a feed is supplied', async () => {
  useDevice(null);
  const get = mock(() => { throw new Error('Forbidden HTTP'); });
  const r = await vault.loadRecipes({ vault: DEV_VAULT, feed: AT, fetch: get });
  expect(r.phase).toBe('failed');
  expect(r.error).toContain('Local avenDB');
  expect(get).not.toHaveBeenCalled();
 });
 test('an empty local vault waits for sync without reading a remote index', async () => {
  const { r, asked } = await loaded({ rows: [] });
  expect(r.phase).toBe('failed');
  expect(r.error).toContain('sync into local avenDB');
  expect(asked).toEqual([]);
 });
 test('missing local bytes never fall back to a peer HTTP endpoint', async () => {
  const { asked } = await loaded({ files: new Map() });
  await expect(vault.recipeAt(LABEL['plants/apple@2'])).rejects.toThrow('sync into local avenDB');
  expect(asked).toEqual([]);
 });
 test('a partial local catalog stays authoritative without comparing remote heads', async () => {
  const row = rowAt('plants/apple@2');
  const { r, asked } = await loaded({ rows: [row] });
  expect(r.phase).toBe('ready');
  expect(vault.hashOf('plants/apple')).toBe(LABEL['plants/apple@2']);
  expect(() => vault.hashOf('things/bell-tent')).toThrow();
  expect(asked).toEqual([]);
 });
