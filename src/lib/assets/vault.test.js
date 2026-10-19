// @ts-nocheck — plain JS
// Every page builds its assets from the Maia City vault's recipes (./vault.js; V5 of the avenDB migration, Samuel
// 2026-10-17, "Ok do it!", with no repo fallback): the index, `hashOf`, `recipeAt` and the cards from the vault's
// `recipe` rows on avenDB's feed (`seed=1`, one vault, the seed's), each recipe's file fetched only when this device's
// cache lacks the build, held to its hash. A ref names the same build, page and cache key as the repo's index named; a
// recipe the vault doesn't hold, or holds otherwise, and a feed that can't be reached, fail, naming the ref. The feed here
// is the dev server's stand-in made from the repo (./sources/devfeed.js) behind a fetch of the test's own, so this runs
// where avenDB's server can't be reached. And nothing but the seed, the scripts, the dev feed and the tests reads the
// repo's index (./recipes.js, `virtual:asset-recipes`, ./box/plugin.js, ./sources/cards.json).
// Run: bun test src/lib/assets/vault.test.js
import { expect, mock, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

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
const { CODE_FEED, fileOf, seedFeedOf } = await import('../../../game/code/sources/feed.js');

/** the stand-in for the vault's feed, made from the repo as the seed writes it */
const FEED = devFeedOf(made, CARDS);
/** where the test's feed is: as avenDB's server's, at another address */
const AT = 'https://feed.example/feed/code';
const ROWS_URL = `${AT}?seed=1&type=recipe`;
const LABEL = made.index.labels;
/** each recipe's file, by its hash, as the box plugin makes it */
const FILES = Object.fromEntries(Object.entries(made.index.recipes).map(([hash, at]) => [hash, recipeFile(made.libraries[`${at.group}/${at.id}`], at.id, at.v, at.variant)]));
/** the row of a recipe of ours, by its label */
const rowAt = (label) => FEED.rows.find((r) => r.record.card.recipe === LABEL[label]);

/**
 * A feed as avenDB's server serves one, as a fetch: `<AT>?…` the rows, `{ code }`, and each row's newest file at
 * `…/feed/entry/<vault>/<entry>/file`, counting what is asked of it. `status` is how the rows are answered.
 */
function feedOf({ rows = FEED.rows, files = FEED.files, status = 200, throws = null } = {}) {
	const asked = [];
	const get = async (url) => {
		asked.push(url);
		if (throws) throw new Error(throws);
		const u = new URL(url);
		if (u.pathname === '/feed/code') return status === 200 ? Response.json({ code: rows }) : new Response('down', { status });
		const m = /^\/feed\/entry\/([0-9a-f]{64})\/([0-9a-f]{64})\/file$/.exec(u.pathname);
		const bytes = m && u.searchParams.get('seed') === '1' && rows.some((r) => r.vault === m[1] && r.entry === m[2]) ? files.get(m[2]) : undefined;
		return bytes ? new Response(bytes, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) : new Response('not found', { status: 404 });
	};
	return { get, asked, files: () => asked.filter((u) => u.includes('/file')) };
}

/** the vault's recipes loaded from a feed of the test's own (`kept`: where the files are kept on the device) */
const loaded = (o) => {
	const f = feedOf(o);
	return vault.loadRecipes({ feed: AT, fetch: f.get, timeout: 1000, ...(o?.kept ? { kept: o.kept } : {}) }).then((r) => ({ ...f, r }));
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

test("a page reads avenDB's own feed, the seed's Maia City and its recipes alone; the dev feed never in a build", () => {
	expect(vault.feedOf()).toBe(CODE_FEED);
	expect(CODE_FEED).toBe('https://avendb.maia.city/feed/code');
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
	expect(FEED.rows.length).toBe(327);
	const { r, asked, files } = await loaded();
	expect(r.phase).toBe('ready');
	expect([r.feed, r.vault, r.count, r.refused, r.missed, r.error]).toEqual([ROWS_URL, DEV_VAULT, 327, [], [], '']);
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
			expect([ref, vault.pageOf('/base', want, c.values)]).toEqual([ref, repo.pageOf('/base', want, c.values)]);
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
	expect(String((await thrown(() => vault.recipeAt(fern)))?.message)).toContain('biomes/cover@1:fern: refused');
	expect(held.has(fern)).toBe(false);
}, 60000);

test('a recipe the vault does not hold, or holds otherwise, fails naming its ref, and the page is told: there is no repo to fall back on', async () => {
	const told = [];
	const stop = vault.watchRecipes((r) => told.push([...r.missed]));
	const apple = rowAt('plants/apple@2');
	const { r, files } = await loaded({ rows: FEED.rows.filter((x) => x !== apple) });
	expect([r.phase, r.count]).toEqual(['ready', 326]);
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
		expect(err.message).toContain('plants/apple@2');
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
	expect(r.count).toBe(325);
	expect(r.refused.length).toBe(1);
	expect(r.refused[0]).toMatch(/^things\/bell-tent@1 \(entry .*\): made for box engine 1/);
	expect(() => vault.hashOf('things/bell-tent@1')).toThrow(/things\/bell-tent@1 is not in the Maia City vault: things\/bell-tent@1 \(entry/);
	expect(() => vault.hashOf('plants/apple@1')).toThrow(NotInVault);
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
	await down({ status: 503 }, new RegExp(`^the asset recipes could not be loaded from the Maia City vault: ${ROWS_URL.replace(/[?.]/g, '\\$&')} answered 503$`));
	await down({ throws: 'offline' }, /could not be loaded from the Maia City vault: offline$/);
	await down({ rows: [...FEED.rows.slice(0, 3), { ...FEED.rows[3], vault: 'ef'.repeat(32) }] }, /handed out code of more than one vault/);
	await down({ rows: FEED.rows.map((x) => ({ ...x, seed: 'Maia Town' })) }, /handed out code of a vault that is not the seed's Maia City/);
	await down({ rows: [] }, /^the Maia City vault holds no asset recipes yet: .* listed none$/);
	await down({ rows: FEED.rows.map((x) => changed(x, (c) => (c.record.engine.version = 1))) }, /holds no asset recipes yet: .* listed 327 entries, none of them one \(.*made for box engine 1/);
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
	await vault.loadRecipes({ feed: AT, fetch: get, timeout: 1000, kept: none, again: [0, 0] });
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
	expect(err.message).toBe('actors/ant@1:ant: its file could not be read from the Maia City vault (Load failed, asked 3 times)');
	expect(tries.get(ant)).toBe(3);
	// a file the server hasn't got is no passing failure: asked once
	const lost = feedOf({ files: new Map([...FEED.files].filter(([e]) => e !== tent)) });
	await vault.loadRecipes({ feed: AT, fetch: lost.get, timeout: 1000, kept: none, again: [0, 0] });
	expect((await thrown(() => vault.recipeAt(LABEL['things/bell-tent@1']))).message).toMatch(/answered 404\)$/);
	expect(lost.files().length).toBe(1);
});

test("the dev server's stand-in serves the feed as avenDB's server does: the rows, and each entry's file as plain text", async () => {
	const serve = serveDevFeed('/__recipe-feed', async () => FEED);
	const ask = (url) =>
		new Promise((ok) => {
			const res = { headers: {}, statusCode: 200, setHeader: (k, v) => (res.headers[k] = v), end: (body) => ok({ ...res, body }) };
			serve({ url }, res, () => ok({ next: true }));
		});
	const rows = await ask('/__recipe-feed/code?seed=1&type=recipe');
	expect([rows.statusCode, rows.headers['content-type']]).toEqual([200, 'application/json']);
	expect(JSON.parse(rows.body).code.length).toBe(327);
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
	'vite.config.ts': { 'src/lib/assets/box/plugin.js': 'the build makes the repo\'s recipes for the seed (and serves the box its trials)' }
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
	expect(pages.length).toBeGreaterThan(15);
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
