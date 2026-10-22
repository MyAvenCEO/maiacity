// @ts-nocheck — plain JS
// Every page builds its assets from the Maia City vault's recipes (./vault.js; V5 of the avenDB migration, Samuel
// 2026-10-17, "Ok do it!", with no repo fallback): the index, `hashOf` and the cards from the vault's `recipe` rows as
// avenDB's feed lists them, and nothing built before the proof of its entry, Maia City's own signed edits, checks out
// and names it as the index does (`/feed/proof?…&entry=…`, anchored to Maia City's vault id, H2; avenDB's WebAssembly
// checks a proof, and a stand-in here reads the test's rows back). A page asks for the proofs of the entries it builds
// alone, together, one at a time, and the next time it loads asks for the same again by their tags. Each recipe's file
// is fetched only when this device's cache lacks the build, held to its hash. A ref names the same build, page and
// cache key as the repo's index named; a recipe the vault doesn't hold, or holds otherwise, and a feed that can't be
// reached, fail, naming the ref. The feed here is the dev server's stand-in made from the repo (./sources/devfeed.js)
// behind a fetch of the test's own, so this runs where avenDB's server can't be reached. And nothing but the seed, the
// scripts, the dev feed and the tests reads the repo's index (./recipes.js, `virtual:asset-recipes`, ./box/plugin.js,
// ./sources/cards.json).
// Run: bun test src/lib/assets/vault.test.js
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
const { bundleRecipes } = await import('./box/plugin.js');
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
const loaded = (o) => {
	const f = feedOf(o);
	const proving = { ...PROVING, proofs: o?.proofs ?? keepOf(), ...(o?.vault !== undefined ? { vault: o.vault } : {}), ...(o?.verify ? { verify: o.verify } : {}), ...(o?.page ? { page: o.page } : {}) };
	const waits = { ...(o?.again ? { again: o.again } : {}), ...(o?.patience !== undefined ? { patience: o.patience } : {}) };
	return vault.loadRecipes({ feed: AT, fetch: f.get, timeout: 1000, ...proving, ...waits, ...(o?.kept ? { kept: o.kept } : {}) }).then((r) => ({ ...f, r }));
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

test("a page reads avenDB's own feed, Maia City's recipes and their proofs by its id; the dev feed never in a build", () => {
	expect(vault.feedOf()).toBe(CODE_FEED);
	expect(CODE_FEED).toBe('https://avendb.maia.city/feed/code');
	expect(listingOf(['recipe'], { vault: DEV_VAULT })).toBe(`https://avendb.maia.city/feed/code?vault=${DEV_VAULT}&type=recipe`);
	expect(proofOf(['recipe'], { vault: DEV_VAULT })).toBe(`https://avendb.maia.city/feed/proof?vault=${DEV_VAULT}&type=recipe`);
	// the entries sorted: the same entries are the same proof
	const [x, y] = ['cd'.repeat(32), '01'.repeat(32)];
	expect(proofOf(['recipe'], { vault: DEV_VAULT, entries: [x, y] })).toBe(`https://avendb.maia.city/feed/proof?vault=${DEV_VAULT}&type=recipe&entry=${y},${x}`);
	expect(seedFeedOf(['recipe'])).toBe('https://avendb.maia.city/feed/code?seed=1&type=recipe');
	const [v, e] = ['ab'.repeat(32), 'cd'.repeat(32)];
	expect(fileOf(v, e)).toBe(`https://avendb.maia.city/feed/entry/${v}/${e}/file?seed=1`);
	expect(fileOf(v, e, '/__recipe-feed/code')).toBe(`/__recipe-feed/entry/${v}/${e}/file?seed=1`);
	for (const [a, b] of [['../x', e], [v, `${e}/../..`], [v.toUpperCase(), e], ['', e]]) expect(() => fileOf(a, b)).toThrow('not an entry of a vault');
	// the stand-in only where a dev server is asked for it: `import.meta.env.DEV` is false in a build
	const text = readFileSync(join(ROOT, 'src/lib/assets/vault.js'), 'utf8');
	expect(text).toContain("export const feedOf = () => (import.meta.env.DEV && import.meta.env.VITE_RECIPE_FEED === 'dev' ? '/__recipe-feed/code' : CODE_FEED);");
	// its address in that branch alone, which a build drops
	expect(text.match(/__recipe-feed/g).length).toBe(1);
	const plugin = readFileSync(join(ROOT, 'src/lib/assets/box/plugin.js'), 'utf8');
	expect(plugin).toContain("if (process.env.VITE_RECIPE_FEED !== 'dev') return;");
	expect(plugin).not.toMatch(/configurePreviewServer|generateBundle|writeBundle/);
});

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

test("loaded once from the feed, the vault's index is the repo's: every version and variant, its latest, its first variant, its parameters", async () => {
	expect(FEED.missing).toEqual([]);
	expect(FEED.rows.length).toBe(333);
	const { r, asked, files } = await loaded();
	expect(r.phase).toBe('ready');
	expect([r.feed, r.vault, r.count, r.refused, r.missed, r.error]).toEqual([ROWS_URL, DEV_VAULT, 333, [], [], '']);
	// the index alone: no proof is asked for before a build
	expect(asked).toEqual([ROWS_URL]);
	expect(vault.INDEX).toEqual(made.index);
	expect(files()).toEqual([]);
	// each card is the one the vault keeps beside its recipe
	for (const hash of Object.keys(made.index.recipes)) expect(vault.cardOf(hash)).toEqual(CARDS[hash]);
	expect(vault.cardOf('constructor')).toBeUndefined();
	// and loaded once a page: asked again, the same, nothing fetched
	expect(await vault.loadRecipes()).toBe(r);
	expect(asked.length).toBe(1);
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

test("a recipe's file read off the feed is kept on this device under its hash: a page loaded afresh reads it there, a spoiled copy off the feed again", async () => {
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
	expect(String((await thrown(() => vault.recipeAt(fern)))?.message)).toContain(`${vault.nameOf(fern)}: refused`);
	expect(held.has(fern)).toBe(false);
}, 60000);

test('a recipe the vault does not hold, or holds otherwise, fails naming its ref, and the page is told: there is no repo to fall back on', async () => {
	const told = [];
	const stop = vault.watchRecipes((r) => told.push([...r.missed]));
	const apple = rowAt('plants/apple@2');
	const { r, files } = await loaded({ rows: FEED.rows.filter((x) => x !== apple) });
	expect([r.phase, r.count]).toEqual(['ready', 332]);
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
		expect(vault.recipes.missed).toContain(err.message);
	};
	await refused({ files: new Map([...FEED.files, [apple.entry, FEED.files.get(rowAt('plants/apple@1').entry)]]) }, /hashes to .*not to/);
	await refused({ files: new Map([...FEED.files].filter(([e]) => e !== apple.entry)) }, /could not be read.*answered 404/);
	await refused({ rows: FEED.rows.map((x) => (x === apple ? changed(x, (c) => (c.files = [])) : x)) }, /brings no file/);
	await refused({ rows: FEED.rows.map((x) => (x === apple ? changed(x, (c) => (c.files[0].len = vault.MOST + 1)) : x)) }, /more than a recipe may be/);
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
	expect(r.count).toBe(331);
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

test("a feed that can't be reached, or answers otherwise, fails the page, naming the feed, and nothing is built: never the repo's", async () => {
	const down = async (o, pattern) => {
		const { r } = await loaded(o);
		expect(r.phase).toBe('failed');
		expect(r.error).toMatch(pattern);
		expect(vault.INDEX.recipes).toEqual({});
		const err = await thrown(() => vault.hashOf('plants/apple@2'));
		expect(err).toBeInstanceOf(NotInVault);
		expect(err.message).toBe(`plants/apple@2 can't be built: ${r.error}`);
		expect(await thrown(() => vault.recipeAt(LABEL['plants/apple@2']))).toBeInstanceOf(NotInVault);
		expect(await thrown(() => loadAsset(LABEL['things/bell-tent@1'], { box: boxOf(), store: storeOf() }))).toBeInstanceOf(NotInVault);
		return r;
	};
	await down({ status: 503, patience: 0 }, new RegExp(`^the asset recipes could not be loaded from the Maia City vault: ${ROWS_URL.replace(/[?.]/g, '\\$&')} answered 503$`));
	await down({ throws: 'offline', patience: 0 }, /^the asset recipes could not be loaded from the Maia City vault: offline$/);
	await down({ rows: [...FEED.rows.slice(0, 3), { ...FEED.rows[3], vault: 'ef'.repeat(32) }] }, /listed code of another vault than Maia City's/);
	// no anchor: nothing is taken from the feed at all
	const unset = await down({ vault: '' }, /Maia City's vault id is not set \(game\/code\/sources\/anchor\.js MAIA_CITY/);
	expect(unset.feed).toBe('https://feed.example/feed/code?vault=&type=recipe');
	await down({ rows: [] }, /^the Maia City vault holds no asset recipes yet: .* listed none$/);
	await down({ rows: FEED.rows.map((x) => changed(x, (c) => (c.record.engine.version = 1))) }, /holds no asset recipes yet: .* listed 333 entries, none of them one \(.*made for box engine 1/);
	// and once it answers, the page asks again and builds
	const { r } = await loaded();
	expect(r.phase).toBe('ready');
	expect(vault.hashOf('plants/apple@2')).toBe(LABEL['plants/apple@2']);
});

test("a world's files are read a few at a time, and one the network drops, or the server can't hand out yet, is asked again", async () => {
	// the feed as a phone on a busy network reaches it: each file a moment late, the apple's dropped twice ("Load
	// failed", as Safari says), the tent's answered 503 once, the ant's never; counting how many are read at once
	const f = feedOf();
	const [apple, tent, ant] = ['plants/apple@2', 'things/bell-tent@1', 'actors/ant@1:ant'].map((l) => rowAt(l).entry);
	const drops = new Map([[apple, 2], [tent, 1], [ant, 9]]);
	const tries = new Map();
	let now = 0;
	let most = 0;
	const get = async (url, o) => {
		const entry = /\/entry\/[0-9a-f]{64}\/([0-9a-f]{64})\/file/.exec(url)?.[1];
		if (!entry) return f.get(url, o);
		tries.set(entry, (tries.get(entry) ?? 0) + 1);
		most = Math.max(most, ++now);
		try {
			await new Promise((r) => setTimeout(r, 2));
			const left = drops.get(entry) ?? 0;
			drops.set(entry, left - 1);
			if (left > 0 && entry === tent) return new Response('the server can\'t read this file yet', { status: 503 });
			if (left > 0) throw new TypeError('Load failed');
			return f.get(url, o);
		} finally {
			now--;
		}
	};
	const none = { get: async () => undefined, put: async () => true };
	await vault.loadRecipes({ feed: AT, fetch: get, timeout: 1000, kept: none, again: [0, 0], patience: 0, ...PROVING, proofs: keepOf() });
	const hashes = Object.keys(made.index.recipes).filter((h) => made.index.recipes[h].group === 'plants');
	const asked = [...hashes, LABEL['things/bell-tent@1']];
	const got = await Promise.all(asked.map((h) => vault.recipeAt(h)));
	expect(got.map((x) => x.code)).toEqual(asked.map((h) => FILES[h]));
	expect(hashes.length).toBeGreaterThan(20);
	expect(most).toBeLessThanOrEqual(6);
	// the apple came on its third asking, the tent on its second, every other file on its first; the ant, dropped
	// every time, fails, saying how often it was asked
	expect([tries.get(apple), tries.get(tent)]).toEqual([3, 2]);
	expect([...tries].filter(([e]) => e !== apple && e !== tent).every(([, n]) => n === 1)).toBe(true);
	const err = await thrown(() => vault.recipeAt(LABEL['actors/ant@1:ant']));
	expect(err).toBeInstanceOf(NotInVault);
	expect(err.message).toBe(`${vault.nameOf(LABEL['actors/ant@1:ant'])}: its file could not be read from the Maia City vault (Load failed, asked 3 times)`);
	expect(tries.get(ant)).toBe(3);
	// a file the server hasn't got is no passing failure: asked once
	const lost = feedOf({ files: new Map([...FEED.files].filter(([e]) => e !== tent)) });
	await vault.loadRecipes({ feed: AT, fetch: lost.get, timeout: 1000, kept: none, again: [0, 0], ...PROVING, proofs: keepOf() });
	expect((await thrown(() => vault.recipeAt(LABEL['things/bell-tent@1']))).message).toMatch(/answered 404\)$/);
	expect(lost.files().length).toBe(1);
});

test('a page asks for the proofs of the entries it builds alone: those it wants together in one proof, one proof at a time', async () => {
	const { r, asked, proofs, most } = await loaded();
	// the index is in, and no proof was asked for: nothing is built yet
	expect([r.phase, asked]).toEqual(['ready', [ROWS_URL]]);
	const first = ['plants/apple@2', 'things/bell-tent@1', 'actors/ant@1:ant', 'biomes/cover@1:fern'];
	// a world names its kinds as it sets up (../load.js `canonical`), each build waiting for its proof
	const box = boxOf();
	const built = first.map((l) => loadAsset(vault.buildAt(l), { box, store: storeOf() }));
	// and wants another a moment later, while that proof is out: it goes in the next
	await new Promise((ok) => setTimeout(ok, 120));
	const later = loadAsset(vault.buildAt('plants/pear@1'), { box, store: storeOf() });
	expect((await Promise.all([...built, later])).map((b) => b.label)).toEqual([...first, 'plants/pear@1']);
	expect(proofs().map(entriesOf)).toEqual([first.map((l) => rowAt(l).entry).sort(), [rowAt('plants/pear@1').entry]]);
	expect(proofs()[0]).toBe(proofAt(first.map((l) => rowAt(l).entry)));
	expect(most()).toBe(1);
	// an entry proven once a page: built again, or its file read, no proof is asked for
	expect((await vault.recipeAt(LABEL['plants/apple@2'])).code).toBe(FILES[LABEL['plants/apple@2']]);
	await loadAsset(vault.buildAt('things/bell-tent@1'), { box, store: storeOf() });
	expect(proofs().length).toBe(2);
	// a world of every plant: one proof of them all
	const many = await loaded();
	const plants = Object.keys(made.index.recipes).filter((h) => made.index.recipes[h].group === 'plants');
	await Promise.all(plants.map((h) => vault.recipeAt(h)));
	expect(many.proofs().length).toBe(1);
	expect(entriesOf(many.proofs()[0]).length).toBe(new Set(plants.map((h) => vault.cardOf(h) && FEED.rows.find((x) => x.record.card.recipe === h).entry)).size);
}, 60000);

test("nothing is built, from the box or this device's cache, that Maia City's signed edits don't prove as the index says", async () => {
	const box = boxOf();
	const store = storeOf();
	const tent = 'things/bell-tent@1';
	const name = vault.buildAt(tent);
	await loaded();
	const ok = await loadAsset(vault.buildAt(tent), { box, store });
	await ok.stored;
	expect(box.asked.length).toBe(1);
	// a listing that names the tent's entry, whose proof holds another recipe there: refused, from the cache too
	const lie = rowAt(tent);
	const other = rowAt('things/backpack@1');
	const proven = FEED.rows.map((x) => (x === lie ? { ...other, entry: lie.entry } : x));
	const told = await loaded({ proven });
	const err = await thrown(() => loadAsset(name, { box, store }));
	expect(err).toBeInstanceOf(NotInVault);
	expect(err.message).toBe(`${vault.nameOf(LABEL[tent])}: refused, Maia City's signed edits don't hold recipe ${LABEL[tent].slice(0, 12)}… as the listing says`);
	expect(vault.recipes.missed).toContain(err.message);
	expect(String((await thrown(() => vault.recipeAt(LABEL[tent])))?.message)).toBe(err.message);
	expect([box.asked.length, store.asked.get, told.files()]).toEqual([1, 1, []]);
	// a proof that holds no row of it: the same
	await loaded({ proven: FEED.rows.filter((x) => x !== lie) });
	expect((await thrown(() => loadAsset(name, { box, store })))?.message).toContain("refused, Maia City's signed edits don't hold recipe");
	// a proof that fails, or the rows as the feed lists them, which avenDB's own WebAssembly takes for no proof: every
	// build waiting on it is refused, saying why, and the index stays
	const down = await loaded({ proving: 503, patience: 0 });
	expect(down.r.phase).toBe('ready');
	expect((await thrown(() => loadAsset(name, { box, store })))?.message).toBe(`${vault.nameOf(LABEL[tent])}: not built, as its proof didn't check out: ${proofAt([lie.entry])} answered 503`);
	await loaded({ verify: verifyProof });
	const said = String((await thrown(() => vault.recipeAt(LABEL[tent])))?.message);
	expect(said.startsWith(`${vault.nameOf(LABEL[tent])}: not built, as its proof didn't check out: the proof at `)).toBe(true);
	expect(said).toMatch(/doesn't check out: what the server handed out is no avenDB reply/);
	expect([box.asked.length, store.asked.get]).toEqual([1, 1]);
	// and proven as listed, it is built again, from the cache
	await loaded();
	expect((await loadAsset(name, { box, store })).from).toBe('cache');
}, 60000);

test("a proof the server can't give yet (restarting) is asked again, the page told it waits; one that failed is asked again by the next build", async () => {
	// avenDB's server restarting for a deploy (the village's animals, 2026-10-20): the proxy's 502 twice, then the proof
	const f = feedOf();
	let down = 2;
	const waited = [];
	const stop = vault.watchRecipes((r) => waited.push(r.waiting));
	const get = async (url, o) => (url.includes('/feed/proof') && down-- > 0 ? new Response('bad gateway', { status: 502 }) : f.get(url, o));
	try {
		await vault.loadRecipes({ feed: AT, fetch: get, timeout: 1000, again: [0], ...PROVING, proofs: keepOf() });
		const apple = LABEL['plants/apple@2'];
		expect((await vault.recipeAt(apple)).code).toBe(FILES[apple]);
		expect(down).toBe(-1);
		expect(waited).toContain(1);
	} finally {
		stop();
	}
	// asked for no longer than the page's patience: refused, saying why, and not kept, so the next build asks again
	const g = feedOf();
	let off = 1;
	const once = async (url, o) => (url.includes('/feed/proof') && off-- > 0 ? new Response('bad gateway', { status: 502 }) : g.get(url, o));
	await vault.loadRecipes({ feed: AT, fetch: once, timeout: 1000, again: [0], patience: 0, ...PROVING, proofs: keepOf() });
	const tent = LABEL['things/bell-tent@1'];
	expect((await thrown(() => vault.recipeAt(tent)))?.message).toMatch(/answered 502$/);
	expect((await vault.recipeAt(tent)).code).toBe(FILES[tent]);
	expect(g.proofs().length).toBe(1);
});

test('a page loaded again asks for the proofs it asked for before at once, by their tags: not modified, nothing checked', async () => {
	const proofs = keepOf();
	let checked = 0;
	const verify = (bytes) => (checked++, trusting(bytes));
	const page = () => '/app/worlds/tired-land/';
	const world = ['plants/apple@2', 'things/bell-tent@1', 'actors/ant@1:ant'];
	const one = await loaded({ proofs, verify, page });
	await Promise.all(world.map((l) => vault.recipeAt(LABEL[l])));
	expect([one.proofs().length, checked]).toEqual([1, 1]);
	// the rows it proved are kept once each, and the page's proof by the page
	expect(proofs.get(`page:${DEV_VAULT}:/app/worlds/tired-land/`)).toEqual({ batches: [world.map((l) => rowAt(l).entry).sort()] });
	// loaded again: the proof is asked for beside the index's rows, before any build, and answered not modified
	const two = await loaded({ proofs, verify, page });
	expect(two.asked.slice(0, 2).sort()).toEqual([ROWS_URL, one.proofs()[0]].sort());
	await Promise.all(world.map((l) => vault.recipeAt(LABEL[l])));
	expect([two.proofs(), checked]).toEqual([one.proofs(), 1]);
	// a proof that changed is checked again, and its rows kept anew
	const pear = rowAt('plants/pear@1');
	const three = await loaded({ proofs, verify, page, proven: FEED.rows.map((x) => (x === rowAt(world[0]) ? changed(x, (c) => c.tags.push('new:tag')) : x)) });
	await vault.recipeAt(LABEL[world[0]]);
	expect([three.proofs().length, checked]).toEqual([1, 2]);
	// another page remembers its own; one that wants more remembers that proof too
	const four = await loaded({ proofs, verify, page: () => '/app/maiacity-v1/' });
	await vault.recipeAt(LABEL['plants/pear@1']);
	expect(four.proofs()).toEqual([proofAt([pear.entry])]);
	const five = await loaded({ proofs, verify, page });
	await vault.recipeAt(LABEL['plants/pear@1']);
	await Promise.all(world.map((l) => vault.recipeAt(LABEL[l])));
	expect(five.proofs()).toEqual([one.proofs()[0], proofAt([pear.entry])]);
	expect(proofs.get(`page:${DEV_VAULT}:/app/worlds/tired-land/`).batches.length).toBe(2);
}, 60000);

test("a page that holds its avenDB open reads the recipes off its own device: the same rows, no proof, each file off its store, the feed only where the device can't", async () => {
	const { useDevice } = await import('../../../game/code/sources/device.js');
	const byRoot = new Map(FEED.rows.map((r) => [r.files.at(-1).root, FEED.files.get(r.entry)]));
	const asked = [];
	const reads = [];
	let failing = false;
	const device = {
		run: async (op) => (asked.push(op), op.op === 'bring' ? { ok: { new: 0, peers: 1, reached: true } } : { ok: FEED.rows }),
		read: async (root, size, from, to) => {
			reads.push(root);
			if (failing) throw new Error('no peer hands it over');
			return byRoot.get(root).slice(from, to);
		}
	};
	const held = new Map();
	const kept = { get: async (h) => held.get(h), put: async (h, b) => (held.set(h, b), true) };
	useDevice(device);
	try {
		const f = feedOf();
		const r = await vault.loadRecipes({ feed: AT, fetch: f.get, timeout: 1000, ...PROVING, proofs: keepOf(), kept });
		expect([r.phase, r.feed, r.count]).toEqual(['ready', 'this device', Object.keys(made.index.recipes).length]);
		// what it holds read at once, what changed of the vault since brought beside
		expect(asked.filter(ownOps)).toEqual([
			{ op: 'code', vault: DEV_VAULT, type: ['recipe'] },
			{ op: 'bring', vaults: [DEV_VAULT] }
		]);
		// a recipe built off the device's own copy: its file off its store, no listing, proof or file off the feed
		const apple = LABEL['plants/apple@2'];
		expect(await vault.recipeAt(apple)).toEqual(await repo.recipeAt(apple));
		expect(reads.length).toBe(1);
		expect(f.asked).toEqual([]);
		expect(new TextDecoder().decode(held.get(apple))).toBe(FILES[apple]);
		// a file the device can't read: off the feed, held to the same hash
		failing = true;
		const fern = LABEL['biomes/cover@1:fern'];
		expect((await vault.recipeAt(fern)).code).toBe(FILES[fern]);
		expect([reads.length, f.files().length, f.proofs().length]).toEqual([2, 1, 0]);
		// a device too old for the ops: the feed, every recipe proven before it is built
		useDevice({ run: async () => ({ refused: 'BadOp', why: 'no op is called "bring"' }), read: device.read });
		const old = await loaded();
		expect(old.r.feed).toBe(ROWS_URL);
		await vault.recipeAt(LABEL['things/bell-tent@1']);
		expect(old.proofs().length).toBe(1);
	} finally {
		useDevice(null);
	}
}, 60000);

test("a page whose device holds none of the recipes yet reads the feed and has its device bring the entries the feed named, those alone, a bring at a time", async () => {
	const { useDevice, whenBrought, AT_ONCE } = await import('../../../game/code/sources/device.js');
	const asked = [];
	const device = {
		run: async (op) => (asked.push(op), op.op === 'bring' ? { ok: { new: op.entries?.length ?? 0, peers: 1, reached: true } } : { ok: [] }),
		read: async () => new Uint8Array()
	};
	useDevice(device);
	try {
		const f = feedOf();
		const r = await vault.loadRecipes({ feed: AT, fetch: f.get, timeout: 1000, ...PROVING, proofs: keepOf() });
		expect([r.phase, r.feed]).toEqual(['ready', ROWS_URL]);
		const b = await whenBrought(DEV_VAULT);
		const entries = [...new Set(FEED.rows.map((x) => x.entry))].sort();
		// never the whole vault: the code it holds, then its entries, AT_ONCE at a time
		expect(asked.filter((o) => o.op === 'bring' && o.vaults)).toEqual([]);
		expect(asked.filter((o) => o.op === 'bring').flatMap((o) => o.entries)).toEqual(entries);
		expect(asked.filter((o) => o.op === 'bring').every((o) => o.entries.length <= AT_ONCE)).toBe(true);
		expect(b).toEqual({ ok: { new: entries.length, peers: 1, reached: true } });
	} finally {
		useDevice(null);
	}
}, 60000);

test("a page whose device is still syncing and lacks recipes the feed lists reads the feed, every recipe proven, has its device bring those entries first and never the whole vault; offline, what it holds", async () => {
	const { useDevice } = await import('../../../game/code/sources/device.js');
	const tent = rowAt('things/bell-tent@1');
	const half = FEED.rows.filter((r) => r.entry !== tent.entry);
	const asked = [];
	const behind = (synced) => ({
		run: async (op) => (asked.push(op), op.op === 'synced' ? { ok: synced } : op.op === 'bring' ? { ok: { new: op.entries?.length ?? 0, peers: 1, reached: true } } : { ok: half }),
		read: async () => new Uint8Array()
	});
	useDevice(behind({ peers: 1, logs: 2416, behind: 2136, pulling: 3, pages: 40 }));
	try {
		const f = feedOf();
		const r = await vault.loadRecipes({ feed: AT, fetch: f.get, timeout: 1000, ...PROVING, proofs: keepOf() });
		expect([r.phase, r.feed]).toEqual(['ready', ROWS_URL]);
		// the listing asked once, held to what the device holds, and the recipe it lacks built off the feed, proven
		expect(f.asked.filter((u) => u === ROWS_URL).length).toBe(1);
		expect(vault.hashOf('things/bell-tent@1')).toBe(LABEL['things/bell-tent@1']);
		expect((await vault.recipeAt(LABEL['things/bell-tent@1'])).code).toBe(FILES[LABEL['things/bell-tent@1']]);
		expect(f.proofs().length).toBe(1);
		await new Promise((r) => setTimeout(r, 0));
		const brings = asked.filter((o) => o.op === 'bring');
		expect(brings.filter((o) => o.vaults)).toEqual([]);
		expect(brings[0]).toEqual({ op: 'bring', entries: [tent.entry] });
		// a device that holds all its peers hold reads itself, the feed never asked
		asked.length = 0;
		useDevice(behind({ peers: 1, logs: 2416, behind: 0, pulling: 0, pages: 400 }));
		const g = feedOf();
		expect((await vault.loadRecipes({ feed: AT, fetch: g.get, timeout: 1000, ...PROVING, proofs: keepOf() })).feed).toBe('this device');
		expect(g.asked).toEqual([]);
		// still syncing with the feed out of reach: what it holds, local first
		useDevice(behind({ peers: 0, logs: 0, behind: 0, pulling: 0, pages: 0 }));
		const h = feedOf({ throws: 'offline' });
		expect((await vault.loadRecipes({ feed: AT, fetch: h.get, timeout: 1000, ...PROVING, proofs: keepOf() })).feed).toBe('this device');
	} finally {
		useDevice(null);
	}
}, 60000);

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
	const r = await vault.loadRecipes({ feed: AT, fetch: f.get, timeout: 1000, ...PROVING, proofs: keepOf(), newest });
	expect(r.phase).toBe('ready');
	expect(r.refused).toEqual([expect.stringMatching(/^plants\/apple@2 \(entry [0-9a-f]{8}…\) of vault [0-9a-f]{8}…: refused, the version handed out \(v2, 5 writes, .*older than the newest this device already proved \(v2, 9 writes/)]);
	expect(() => vault.hashOf('plants/apple')).toThrow(/^plants\/apple: its newest version can't be read: plants\/apple@2 \(entry .*refused/);
	expect(vault.hashOf('plants/apple@2')).toBe(LABEL['plants/apple@2']);
	expect(vault.hashOf('things/bell-tent')).toBe(LABEL['things/bell-tent@1']);
}, 60000);

test("a server restarting is waited for, saying so: the listing and each file asked again together, never told missing; a file it never hands over is told unread, not missing", async () => {
	// avenDB's server restarting for a deploy (Sandbox 4 on a phone, 2026-10-20): the listing and every file "Load
	// failed" for a while, the proxy's 502 in between, then all of it answers
	const f = feedOf();
	let down = true;
	let lists = 0;
	const asked = [];
	const get = async (url, o) => {
		const file = /\/file/.test(url);
		if (!file) lists++;
		else asked.push(url);
		if (down && (!file || asked.length % 2)) throw new TypeError('Load failed');
		if (down) return new Response('bad gateway', { status: 502 });
		return f.get(url, o);
	};
	const none = { get: async () => undefined, put: async () => true };
	const seen = [];
	const stop = vault.watchRecipes((r) => seen.push(r.waiting));
	setTimeout(() => (down = false), 60);
	const r = await vault.loadRecipes({ feed: AT, fetch: get, timeout: 1000, kept: none, again: [5, 10, 20], ...PROVING, proofs: keepOf() });
	expect(r.phase).toBe('ready');
	expect(lists).toBeGreaterThan(1);
	// the page was told it waits, and that it waits no more
	expect(seen).toContain(1);
	expect(r.waiting).toBe(0);
	// now the files: down again, a world's two dozen at once; they wait together, the feed asked a few at a time
	down = true;
	asked.length = 0;
	setTimeout(() => (down = false), 80);
	const hashes = Object.keys(made.index.recipes).filter((h) => made.index.recipes[h].group === 'plants');
	const got = await Promise.all(hashes.map((h) => vault.recipeAt(h)));
	expect(got.map((x) => x.code)).toEqual(hashes.map((h) => FILES[h]));
	expect(vault.recipes.missed.filter((m) => m.startsWith('plants/'))).toEqual([]);
	expect(vault.recipes.unread).toEqual([]);
	expect([vault.recipes.waiting, vault.recipes.reading]).toEqual([0, 0]);
	// every file once at least, and while it was down no more than a few at each asking, not each file again and again
	expect(asked.length).toBeGreaterThanOrEqual(hashes.length);
	expect(asked.length).toBeLessThan(3 * hashes.length);
	// a file that never comes, once the page waited as long as it waits: unread, it may well be there, not missing
	await vault.loadRecipes({ feed: AT, fetch: async (url, o) => (/\/file/.test(url) ? new Response('', { status: 503 }) : f.get(url, o)), timeout: 1000, kept: none, again: [1], patience: 30, ...PROVING, proofs: keepOf() });
	const tent = LABEL['things/bell-tent@1'];
	const err = await thrown(() => vault.recipeAt(tent));
	expect(err).toBeInstanceOf(vault.Unread);
	expect(err.message.startsWith(`${vault.nameOf(tent)}: its file could not be read from the Maia City vault (`)).toBe(true);
	expect(err.message).toMatch(/ answered 503, asked \d+ times\)$/);
	expect(vault.recipes.unread).toEqual([err.message]);
	expect(vault.recipes.missed).toEqual([]);
	stop();
}, 60000);

test("a file the page's device is slow to hand over is asked of the feed too, and the first to hand it over is read; the device's, where the feed doesn't answer", async () => {
	const { useDevice } = await import('../../../game/code/sources/device.js');
	const byRoot = new Map(FEED.rows.map((r) => [r.files.at(-1).root, FEED.files.get(r.entry)]));
	// a light copy still bringing each file's pieces from its peers: every read takes `slow` ms
	let slow = 0;
	const device = {
		run: async (op) => (op.op === 'bring' ? { ok: { new: 0, peers: 1, reached: true } } : { ok: FEED.rows }),
		read: async (root, size, from, to) => (await new Promise((r) => setTimeout(r, slow)), byRoot.get(root).slice(from, to))
	};
	const none = { get: async () => undefined, put: async () => true };
	useDevice(device);
	try {
		let feedDown = false;
		const f = feedOf();
		const get = async (url, o) => {
			if (feedDown) throw new TypeError('Load failed');
			return f.get(url, o);
		};
		const r = await vault.loadRecipes({ feed: AT, fetch: get, timeout: 1000, kept: none, lead: 20, again: [5], ...PROVING, proofs: keepOf() });
		expect(r.feed).toBe('this device');
		// quick: the device's, the feed never asked
		const apple = LABEL['plants/apple@2'];
		expect((await vault.recipeAt(apple)).code).toBe(FILES[apple]);
		expect(f.files()).toEqual([]);
		// slow: the feed's, asked once the device took longer than `lead`
		slow = 400;
		const fern = LABEL['biomes/cover@1:fern'];
		expect((await vault.recipeAt(fern)).code).toBe(FILES[fern]);
		expect(f.files().length).toBe(1);
		// slow, and the feed down: the device's, once it hands it over, with no error
		feedDown = true;
		slow = 150;
		const tent = LABEL['things/bell-tent@1'];
		expect((await vault.recipeAt(tent)).code).toBe(FILES[tent]);
		expect([vault.recipes.missed, vault.recipes.unread]).toEqual([[], []]);
	} finally {
		useDevice(null);
	}
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
	expect(JSON.parse(rows.body).code.length).toBe(333);
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
	for (const p of ['/app/buildings/', '/app/biomes/', '/app/factories/', '/app/maiacity-v1/', '/app/worlds/tired-land/', '/app/games/sandbox-4/', '/app/games/sandbox-5/', '/app/assets/box/', '/app/assets/render/', '/app/assets/render/levels/'])
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
