// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * OUR RECIPES, FROM THE MAIA CITY VAULT — where every page that builds an asset reads its recipes (V5 of the avenDB
 * migration; Samuel 2026-10-17, "Ok do it!"): the sandboxes and the worlds, MaiaCity V1, the Things, Machines, Actors,
 * Plants, Buildings, Biomes and Factories, an asset's own page and the box's lab. The index (each recipe's hash, what it
 * builds and takes, the labels at it), `hashOf`, `recipeAt` and each recipe's card come from the `recipe` entries of the
 * server's own seed's coop, Maia City, on avenDB's feed, read as the code our hosts run is read (C10,
 * game/code/sources/feed.js: `seed=1`, one vault only, the seed's), and checked as ./sources/avendb.js `vaultRecipes`
 * checks them (each card, its tags and its engine; a file held to its ref's hash, as UTF-8, its last line the version
 * and variant its card says):
 *
 *   <feed>/code?seed=1&type=recipe                 the rows, each with its record and its card: once a page, the
 *                                                  first that builds an asset
 *   <feed>/entry/<vault>/<entry>/file?seed=1       a recipe's source, its entry's newest file: only when this device's
 *                                                  cache lacks the build and the file (./cache.js `fileAt`), which
 *                                                  then keeps it under its hash, held to it again when read back
 *
 * `<feed>` is avenDB's server's (game/code/sources/feed.js FEED), the one every page and build reads.
 *
 * There is no repo fallback (Samuel 2026-10-17, 12:01): a ref the vault doesn't hold, a file that isn't the recipe its
 * ref names, a feed that can't be reached, each fails, naming the ref, so we see what still needs porting. Each is told
 * (`recipes.missed`, and the console) and shown on the page (./VaultRecipes.svelte, which the app's layout holds an
 * asset page behind until the recipes are in, `ASSET_PAGES`); a viewer shows its own as its error. The builds are named
 * as the repo's were (./builds.js), so the same bytes are the same build, kept in this device's cache under the same
 * key (../load.js, ./cache.js).
 *
 * The repo's index (./recipes.js, `virtual:asset-recipes`, ./box/plugin.js, ./sources/cards.json) only feeds the seed
 * that writes the recipes into the vault (src/lib/avendb/seed.js, scripts/seed-ops.mjs), the dev server's stand-in for
 * the feed (./sources/devfeed.js: `VITE_RECIPE_FEED=dev bun run dev`, never in a build) and the tests; ./vault.test.js
 * holds every other module to that.
 */
import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { idOf, slug } from '$lib/ids.js';
import { CODE_FEED, fileOf, seedFeedOf, seedRows } from '../../../game/code/sources/feed.js';
import { buildOf } from './builds.js';
import * as cache from './cache.js';
import { LATEST } from './engines.js';
import { queryOf } from './params.js';
import { parseRef } from './refs.js';
import { NotInVault, vaultRecipes } from './sources/avendb.js';

export { buildOf, checked, hashText, parseBuild } from './builds.js';
export { NotInVault };

/**
 * The app's pages that build assets: the app's layout holds one until the recipes are in (./VaultRecipes.svelte), so a
 * world's first `use` finds them. ./vault.test.js finds every page that reaches this module among these (an asset's own
 * page and a film's world wait for them themselves).
 */
export const ASSET_PAGES = /^\/app\/(?:buildings|biomes|factories|maiacity-v1|worlds\/[^/]+|games\/sandbox-[45]|assets\/(?:box|render)(?:\/levels)?)\/?$/;

/**
 * The code feed the recipes are read from: avenDB's server in every build. Only a dev server a developer started for it
 * (`VITE_RECIPE_FEED=dev bun run dev`, where avenDB's server can't be reached) serves a stand-in made from the repo
 * (./sources/devfeed.js, where ./box/plugin.js serves it); `import.meta.env.DEV` is false in a build, so a build never
 * reads it, nor names it: its address is written in this one branch alone, which a build drops.
 */
export const feedOf = () => (import.meta.env.DEV && import.meta.env.VITE_RECIPE_FEED === 'dev' ? '/__recipe-feed/code' : CODE_FEED);

/** the most a recipe's file may be (the stand-in's, the largest, is 315 kB), as the avenDB app's Assets read one */
export const MOST = 16_000_000;

/** how long the feed may take to answer, and a recipe's file once it is asked for (ms) */
const TIMEOUT = { rows: 15000, file: 30000 };

/**
 * How many recipe files a page asks the feed for at once: a world asks for dozens together, and a phone's network or
 * a busy server drops what it can't carry (Sandbox 4 on an iPad, 2026-10-19: 79 at once, each "Load failed").
 */
const AT_ONCE = 6;

/** after how long (ms) a file the network dropped, that took too long, or that the server couldn't hand out yet is
 *  asked again: twice, then it fails */
const AGAIN = [1000, 4000];

/** the files being read, and those waiting their turn @type {{ running: number, waiting: (() => void)[] }} */
const turns = { running: 0, waiting: [] };
/** a turn to read a file: at once while fewer than `AT_ONCE` are read, else when one ends */
const turn = () => (turns.running < AT_ONCE ? (turns.running++, Promise.resolve()) : new Promise((go) => turns.waiting.push(go)));
/** a turn over: the next waiting one takes it */
const done = () => {
	const next = turns.waiting.shift();
	if (next) next();
	else turns.running--;
};

/** an answer the server may give otherwise when asked again: it couldn't read the file yet, or a proxy before it failed */
const passing = (/** @type {number} */ status) => status === 502 || status === 503 || status === 504;

/**
 * A file's bytes off the feed at `url`, in its turn (`AT_ONCE`), within `TIMEOUT.file` from when it is asked: asked
 * again (`again`, the waits between) where the network dropped it, it took too long, or the server couldn't hand it out
 * yet; what failed the last time is said, and how often it was asked.
 * @param {typeof globalThis.fetch} get @param {string} url @param {number[]} again
 */
async function fetched(get, url, again) {
	for (let i = 0; ; i++) {
		/** what failed this time, and whether asking again may help */
		let failed, retry;
		await turn();
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), TIMEOUT.file);
		try {
			const res = await get(url, { signal: ctl.signal });
			if (res.ok) return new Uint8Array(await res.arrayBuffer());
			[failed, retry] = [new Error(`${url} answered ${res.status}`), passing(res.status)];
		} catch (e) {
			// the network dropped it, or it took too long
			[failed, retry] = [e instanceof Error ? e : new Error(String(e)), true];
		} finally {
			clearTimeout(t);
			done();
		}
		if (!retry || i >= again.length) throw i ? new Error(`${failed.message}, asked ${i + 1} times`) : failed;
		await new Promise((r) => setTimeout(r, again[i]));
	}
}

/**
 * The index of the vault's recipes, as the repo's was shaped (`virtual:asset-recipes`): the engine they are made for,
 * each recipe by its hash, the hash each label names, each asset's latest version and each version's first variant.
 * Empty until the recipes are in (`loadRecipes`), then filled in place, so a module that holds it reads them.
 */
export const INDEX = { engine: LATEST.v, recipes: {}, labels: {}, latest: {}, first: {} };

/**
 * What the page knows of the vault's recipes: `phase` (idle, loading, ready, failed), the `feed` they are read from,
 * the `vault`, how many (`count`), why none were (`error`), the entries the reader refused (`refused`) and every ref
 * a build asked for that the vault couldn't give (`missed`), each saying why.
 */
export const recipes = { phase: 'idle', feed: '', vault: '', count: 0, error: '', refused: [], missed: [] };

/** @type {Set<(r: typeof recipes) => void>} */
const watchers = new Set();
let telling = false;
/**
 * What the page knows, told to whoever watches: a moment later, once, however many things changed meanwhile, so a
 * ref told missed while a component works out what it shows (a Svelte `$derived`) changes nothing of it then.
 */
const tell = () => {
	if (telling) return;
	telling = true;
	queueMicrotask(() => {
		telling = false;
		for (const f of watchers)
			try {
				f(recipes);
			} catch {
				// a watcher that fails is its own
			}
	});
};
/** heard now and whenever what the page knows of the recipes changes; the function returned stops it */
export function watchRecipes(f) {
	watchers.add(f);
	f(recipes);
	return () => watchers.delete(f);
}

/** the most refs told missed (a world that asks for hundreds of one ref tells it once) */
const MOST_MISSED = 200;
/** a ref the vault couldn't give, told on the page and in the console, once @param {Error} e */
function noted(e) {
	if (e instanceof NotInVault && !recipes.missed.includes(e.message) && recipes.missed.length < MOST_MISSED) {
		recipes.missed = [...recipes.missed, e.message];
		console.error(`asset recipes: ${e.message}`);
		tell();
	}
	return e;
}

/** the vault's recipes as ./sources/avendb.js `vaultRecipes` reads them, once they are in */
let source = null;

/** the index filled in place with what the vault holds (empty for nothing) */
function fill(index) {
	for (const k of ['recipes', 'labels', 'latest', 'first']) {
		for (const key of Object.keys(INDEX[k])) delete INDEX[k][key];
		Object.assign(INDEX[k], index?.[k] ?? {});
	}
	INDEX.engine = index?.engine ?? LATEST.v;
}

/** where a recipe's file read off the feed is kept on this device, by the recipe's hash (./cache.js) */
const KEPT = { get: cache.fileAt, put: cache.keepFile };

/** the recipe each row of the feed is, by its hash, once the rows are read: its file is kept on the device by it */
let hashOfRow = new WeakMap();

/** whether bytes hash to a recipe's hash @param {Uint8Array} bytes @param {string} hash */
const holds = (bytes, hash) => bytes instanceof Uint8Array && bytesToHex(blake3(bytes)) === hash;

/**
 * How a row's file is read: this device's copy of it, where it keeps one that hashes to the recipe's hash (`kept`);
 * otherwise the newest its entry brings (the feed lists them oldest first), or for one version of an asset's entry,
 * the file of its own write (./sources/avendb.js `versionsOf`), by its root, from the feed beside the rows, whole, as
 * bytes, a few at a time and asked again where it was dropped (`fetched`), so its hash is of the bytes the server
 * holds, kept on the device once it hashes to the recipe's. Refused, saying why, where its entry brings none or one
 * larger than a recipe may be. Either way ./sources/avendb.js holds what it hands out to the ref's hash, version and
 * variant.
 */
const readerOf = (get, feed, kept, again) => async (row) => {
	const hash = hashOfRow.get(row);
	const had = hash ? await Promise.resolve(kept.get(hash)).catch(() => undefined) : undefined;
	if (had && holds(had, hash)) return had;
	const file = Array.isArray(row?.files) ? row.files.at(-1) : undefined;
	if (!file) throw new Error('its entry brings no file');
	if (typeof file.len === 'number' && file.len > MOST) throw new Error(`its file is ${file.len.toLocaleString('en')} bytes, more than a recipe may be (${MOST.toLocaleString('en')})`);
	const bytes = await fetched(get, fileOf(row.vault, row.entry, feed, row.edit ? file.root : undefined), again);
	if (hash && holds(bytes, hash)) Promise.resolve(kept.put(hash, bytes)).catch(() => {});
	return bytes;
};

/** the recipes read off the feed: what the page knows of them after */
async function load({ feed = feedOf(), fetch: get = globalThis.fetch, timeout = TIMEOUT.rows, kept = KEPT, again = AGAIN } = {}) {
	const url = seedFeedOf(['recipe'], feed);
	source = null;
	fill(null);
	Object.assign(recipes, { phase: 'loading', feed: url, vault: '', count: 0, error: '', refused: [], missed: [] });
	tell();
	const got = await seedRows(url, { fetch: get, timeout });
	/** @param {string} error */
	const failed = (error) => {
		Object.assign(recipes, { phase: 'failed', error });
		console.error(`asset recipes: ${error}`);
		tell();
		return recipes;
	};
	if ('error' in got) return failed(`the asset recipes could not be loaded from the Maia City vault: ${got.error}`);
	// an entry the vault deleted (tagged so: src/lib/avendb/seed.js GONE) is no recipe of it
	const rows = got.rows.filter((r) => !(r?.tags ?? []).includes('avendb:deleted'));
	const read = vaultRecipes(rows, { read: readerOf(get, feed, kept, again) });
	hashOfRow = new WeakMap(Object.keys(read.index.recipes).map((h) => [read.rowOf(h), h]));
	if (!Object.keys(read.index.recipes).length)
		return failed(`the Maia City vault holds no asset recipes yet: ${url} listed ${rows.length ? `${rows.length} entries, none of them one` : 'none'}${read.refused.length ? ` (${read.refused.slice(0, 3).join('; ')})` : ''}`);
	source = read;
	fill(read.index);
	Object.assign(recipes, { phase: 'ready', vault: String(rows[0]?.vault ?? ''), count: Object.keys(INDEX.recipes).length, refused: [...read.refused] });
	for (const r of read.refused) console.error(`asset recipes: refused, ${r}`);
	tell();
	return recipes;
}

let loading = null;
/**
 * The vault's recipes, loaded once a page (and shared by every module of it): resolves to what the page knows of them
 * (`recipes`), ready or failed; never throws. With options, loaded again from there: `feed` where /feed/code is,
 * `fetch`, `timeout`, `kept` where the files are kept on the device (`{ get(hash), put(hash, bytes) }`, ./cache.js's
 * by default), `again` the waits before a dropped file is asked again (ms, `AGAIN`): a test's, or a page's that asks
 * again (`reloadRecipes`).
 * @param {{ feed?: string, fetch?: typeof globalThis.fetch, timeout?: number, kept?: { get: (hash: string) => any, put: (hash: string, bytes: Uint8Array) => any }, again?: number[] }} [o]
 * @returns {Promise<typeof recipes>}
 */
export const loadRecipes = (o) => (o ? (loading = load(o)) : (loading ??= load()));

/** the recipes loaded again, from the feed they were loaded from (a page whose load failed asks again) */
export const reloadRecipes = () => (loading = load());

/** why a ref can't be built while the recipes aren't in @param {string} what */
const notIn = (what) =>
	new NotInVault(
		recipes.phase === 'failed'
			? `${what} can't be built: ${recipes.error}`
			: `${what} can't be built yet: the asset recipes of the Maia City vault are not loaded (a page loads them before its first build: loadRecipes)`
	);

/**
 * The hash a ref names in the Maia City vault: `plants/apple@2:variant?its=values`, its latest version when none is
 * named, its first variant when none is, never another variant than the one it names. Throws NotInVault naming the ref
 * for one the vault doesn't hold (and while the recipes aren't in), and tells it (`recipes.missed`).
 * @param {string} ref @returns {string}
 */
export function hashOf(ref) {
	try {
		if (!source) throw notIn(String(ref));
		return source.hashOf(ref);
	} catch (e) {
		throw noted(e);
	}
}

/** A build named from a label and its values: the hash the label names in the vault, the same values. @param {string} label */
export const buildAt = (label) => buildOf(hashOf(label), parseRef(label).params);

/** What a hash names in the vault's index: its group, id, version, variant, label and parameters; undefined if none. */
export const recipeInfo = (hash) => (typeof hash === 'string' && Object.hasOwn(INDEX.recipes, hash) ? INDEX.recipes[hash] : undefined);

/** What a hash names in the vault's index, or NotInVault naming it (told, as `hashOf` tells one). @param {string} hash */
export function heldAt(hash) {
	const at = recipeInfo(hash);
	if (at) return at;
	throw noted(source ? new NotInVault(`no recipe ${String(hash).slice(0, 12)}… is in the Maia City vault`) : notIn(`recipe ${String(hash).slice(0, 12)}…`));
}

/** The card the vault keeps beside a recipe (Recipe, v1's `card`, a build of it at its own values); undefined if none. */
export const cardOf = (hash) => (recipeInfo(hash) ? source?.rowOf(hash)?.record?.card : undefined);

/**
 * What the vault's entry declares beside a recipe (Recipe, v1's `manifest` and `contract`), which ../load.js holds its
 * builds to; undefined if none.
 */
export const declaredOf = (hash) => {
	const r = recipeInfo(hash) ? source?.rowOf(hash)?.record : undefined;
	return r ? { manifest: r.manifest, contract: r.contract } : undefined;
};

/**
 * A build's page: on the root, its recipe's hash as an address reads it ($lib/ids.js), its label in words (`?t=`,
 * never one of its values), then its values, sorted ($lib/assets/AssetPage.svelte).
 * @param {string} base the site's base path @param {string} hash @param {Record<string, unknown>} [values]
 */
export const pageOf = (base, hash, values) => {
	const q = queryOf(values);
	return `${base}/${idOf(hash)}/?t=${slug(recipeInfo(hash)?.label ?? '', 'asset')}${q ? `&${q}` : ''}`;
};

/**
 * A recipe of the vault by its hash: `{ hash, code }`, its entry's file read off the feed once a page and held to its
 * hash, its version and its variant (./sources/avendb.js `vaultRecipes`). Rejects with NotInVault naming its ref for
 * one the vault doesn't hold, or holds otherwise, or whose file can't be read; told, as `hashOf` tells one.
 * @param {string} hash @returns {Promise<{ hash: string, code: string }>}
 */
export async function recipeAt(hash) {
	await loadRecipes();
	if (!source) throw noted(notIn(`recipe ${String(hash).slice(0, 12)}…`));
	try {
		return await source.recipeAt(hash);
	} catch (e) {
		throw noted(e);
	}
}
