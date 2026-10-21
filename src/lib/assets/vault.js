// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * OUR RECIPES, FROM THE MAIA CITY VAULT — where every page that builds an asset reads its recipes (V5 of the avenDB
 * migration; Samuel 2026-10-17, "Ok do it!"): the sandboxes and the worlds, MaiaCity V1, the Things, Machines, Actors,
 * Plants, Buildings, Biomes and Factories, an asset's own page and the box's lab. The index (each recipe's hash, what it
 * builds and takes, the labels at it), `hashOf` and each recipe's card come from the `recipe` entries of the coop Maia
 * City, of its vault by its id (game/code/sources/anchor.js `MAIA_CITY`), as avenDB's feed lists them, checked as
 * ./sources/avendb.js `vaultRecipes` checks them (each card, its tags and its engine). Nothing of a recipe is built on
 * that word alone (H2, game/code/sources/feed.js `provenRows`): before a page builds a recipe, from the box or from
 * this device's cache, the proof of its entry, Maia City's own signed edits, is checked by avenDB's WebAssembly, every
 * signature and rule, and it must name that recipe by the label the index does (`provenAt`). A page asks for the
 * proofs of the entries it builds alone, together, one proof at a time (`proverOf`), and its file is held to the hash
 * the proven card names, as UTF-8, its last line the version and variant its card says:
 *
 *   <feed>/code?vault=<Maia City>&type=recipe      the index's rows, each with its record and its card: once a page,
 *                                                  the first that builds an asset, as JSON
 *   <feed>/proof?vault=<Maia City>&type=recipe     the proof of the entries a page builds: what it asked for before
 *     &entry=<entry>,…                             at once, the rest as they are wanted; checked once a device while
 *                                                  it is unchanged, the rows it proved kept, and asked again by its
 *                                                  tag (304)
 *   <feed>/entry/<vault>/<entry>/file?seed=1       a recipe's source, its entry's newest file: only when this device's
 *                                                  cache lacks the build and the file (./cache.js `fileAt`), which
 *                                                  then keeps it under its hash, held to it again when read back
 *
 * `<feed>` is avenDB's server's (game/code/sources/feed.js FEED), the one every page and build reads while it holds
 * no avenDB open. A page that holds the person's avenDB open reads the recipes off its own device instead (Samuel
 * 2026-10-20, "all games and sandboxes should load always from local avenDB! Also the asset viewers"): the same rows,
 * of the device's own copy of Maia City once it brought the vault from its peers, and each recipe's file off its own
 * store (game/code/sources/device.js `deviceRows`, `deviceFile`). The device checked every signed edit as it took it,
 * so nothing it reads needs a proof; a file it can't read in time is asked of the feed, held to the same hash.
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
import { holds } from '../../../game/hash.js';
import { idOf, slug } from '$lib/ids.js';
import { CODE_FEED, KEPT_PROOFS, MAIA_CITY, NO_ANCHOR, fileOf, listedRows, listingOf, proofOf, provenRows, seedFeedOf } from '../../../game/code/sources/feed.js';
import { READ, bringRows, deviceFile, deviceOf, deviceRows, whenBrought } from '../../../game/code/sources/device.js';
import { KEPT_NEWEST, fresh } from '../../../game/code/fresh.js';
import { buildOf } from './builds.js';
import * as cache from './cache.js';
import { LATEST } from './engines.js';
import { queryOf } from './params.js';
import { parseRef } from './refs.js';
import { NotInVault, Unread, parsePin, pinRef, vaultRecipes } from './sources/avendb.js';

export { buildOf, checked, hashText, parseBuild } from './builds.js';
export { NotInVault, Unread, parsePin, pinRef };

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

/** how long the index's rows may take, a proof fetched and checked, and a recipe's file once it is asked for (ms) */
const TIMEOUT = { rows: 30000, file: 30000 };

/** the most entries one proof asks for: its address stays under 16 kB, each entry's id 65 characters of it */
const MOST_IN_ONE = 200;

/**
 * How long the entries a page wants wait to be asked for together (ms): until none was wanted for `quiet`, and no
 * longer than `most` after the first, so the kinds a world sets up one after another go in one proof.
 */
const BATCH = { quiet: 100, most: 1000 };

/** how many proofs a page remembers it asked for (`proverOf`): the oldest beyond them are forgotten */
const MOST_BATCHES = 8;

/**
 * How many recipe files a page asks the feed for at once: a world asks for dozens together, and a phone's network or
 * a busy server drops what it can't carry (Sandbox 4 on an iPad, 2026-10-19: 79 at once, each "Load failed").
 */
const AT_ONCE = 6;

/** after how long (ms) a file the network dropped, that took too long, or that the server couldn't hand out yet is
 *  asked again: these waits, then the last of them again and again, until `PATIENCE` passed since it was first asked */
const AGAIN = [1000, 2000, 4000, 8000, 15000];

/**
 * How long a page keeps asking for a file the feed doesn't hand out yet (ms). A server that restarts for a deploy answers
 * again within a minute or two, and a page waits for it, saying so (`recipes.waiting`), rather than tell a file missing
 * that is only late (Sandbox 4 on a phone, 2026-10-20: 53 plants "not in it", "Load failed, asked 3 times", while
 * avenDB's server restarted).
 */
const PATIENCE = 10 * 60_000;

/**
 * Until when the feed is not asked for a file, since one it was asked for failed in passing (ms since the epoch): every
 * file waits for it, so a feed that doesn't answer is asked a few files at a time (`AT_ONCE`), after each wait, never
 * once for every file a world wants (a server coming back stalled under a burst, 2026-10-19). A file it hands out ends it.
 */
let calm = 0;

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

/** an answer the server may give otherwise when asked again: it couldn't read the file yet, it was asked too much, or
 *  a proxy before it failed (a server restarting) */
const passing = (/** @type {number} */ status) => status === 429 || status === 502 || status === 503 || status === 504;

/** a turn to read a file off the feed, once the feed may be asked again (`calm`): one taken while a file failed
 *  meanwhile is handed on, and waits again */
async function calmTurn() {
	for (;;) {
		while (calm > Date.now()) await new Promise((r) => setTimeout(r, calm - Date.now()));
		await turn();
		if (calm <= Date.now()) return;
		done();
	}
}

/** how many files wait for the feed to answer again (`recipes.waiting`), told as it changes @param {number} n */
function waits(n) {
	recipes.waiting = Math.max(0, recipes.waiting + n);
	tell();
}

/**
 * A file's bytes off the feed at `url`, in its turn (`AT_ONCE`), within `TIMEOUT.file` from when it is asked: asked
 * again (`again`, the waits between, the last again and again) where the network dropped it, it took too long, or the
 * server couldn't hand it out yet, until `patience` passed since it was first asked; meanwhile the page is told it waits
 * (`recipes.waiting`), and every file holds back with it (`calm`). What failed the last time is said, and how often it
 * was asked, and whether it failed only in passing (`passing`).
 * `signal` stops it (the page's device handed the file over meanwhile: `eitherOf`).
 * @param {typeof globalThis.fetch} get @param {string} url @param {number[]} again @param {number} [patience]
 * @param {AbortSignal} [signal]
 */
async function fetched(get, url, again, patience = PATIENCE, signal) {
	const first = Date.now();
	let waiting = false;
	try {
		for (let i = 0; ; i++) {
			/** what failed this time, and whether asking again may help */
			let failed, retry;
			await calmTurn();
			if (signal?.aborted) {
				done();
				throw new Error('read off this device instead');
			}
			const ctl = new AbortController();
			const t = setTimeout(() => ctl.abort(), TIMEOUT.file);
			const stop = () => ctl.abort();
			signal?.addEventListener('abort', stop, { once: true });
			try {
				const res = await get(url, { signal: ctl.signal });
				if (res.ok) {
					const bytes = new Uint8Array(await res.arrayBuffer());
					calm = 0;
					return bytes;
				}
				[failed, retry] = [new Error(`${url} answered ${res.status}`), passing(res.status)];
			} catch (e) {
				// the network dropped it, it took too long, or a proxy's answer bore no leave to read it ("Load failed")
				[failed, retry] = [e instanceof Error ? e : new Error(String(e)), true];
			} finally {
				clearTimeout(t);
				signal?.removeEventListener('abort', stop);
				done();
			}
			// stopped, not failed: the feed is none the worse for it
			if (signal?.aborted) throw new Error('read off this device instead');
			if (!retry || (i >= again.length && Date.now() - first >= patience)) {
				const out = i ? new Error(`${failed.message}, asked ${i + 1} times`) : failed;
				// failed in passing however long it was asked: the file may well be there (./sources/avendb.js `Unread`)
				if (retry) Object.assign(out, { passing: true });
				throw out;
			}
			calm = Math.max(calm, Date.now() + (again[Math.min(i, again.length - 1)] ?? 0));
			if (!waiting) waits(+(waiting = true));
		}
	} finally {
		if (waiting) waits(-1);
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
 * the `vault`, how many (`count`), why none were (`error`), the entries the reader refused (`refused`), every ref a
 * build asked for that the vault doesn't give (`missed`) and every one whose file wasn't handed over, after the page
 * waited for it (`unread`: it may well be in the vault), each saying why; and how many files are being read now
 * (`reading`) and how many of them wait for the feed to answer again (`waiting`).
 */
export const recipes = { phase: 'idle', feed: '', vault: '', count: 0, error: '', refused: [], missed: [], unread: [], reading: 0, waiting: 0 };

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
/** a ref the vault couldn't give, or whose file wasn't handed over (`Unread`), told on the page and in the console,
 *  once @param {Error} e */
function noted(e) {
	const list = e instanceof Unread ? 'unread' : 'missed';
	if (e instanceof NotInVault && !recipes[list].includes(e.message) && recipes[list].length < MOST_MISSED) {
		recipes[list] = [...recipes[list], e.message];
		console.error(`asset recipes: ${e.message}`);
		tell();
	}
	return e;
}

/** the vault's recipes as ./sources/avendb.js `vaultRecipes` reads them off the index's rows, once they are in */
let source = null;

/** how the page proves the recipes it builds (`proverOf`): none on the dev server's stand-in */
let prover = null;

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

/** the recipe each row of the feed is, by its hash, once the rows are proven: its file is kept on the device by it */
const hashOfRow = new WeakMap();

/** how many files are read now (`recipes.reading`), told as it changes @param {number} n */
function reads(n) {
	recipes.reading = Math.max(0, recipes.reading + n);
	tell();
}

/**
 * A file the page's own device reads (`own`), or the feed's (`off`) where the device hasn't handed it over within
 * `READ`, or failed: a light copy still bringing the file's pieces from its peers reads on, beside the feed, and the
 * first to hand over bytes that hold to the recipe's hash (`fits`) is the file, so a page never gives up on a device
 * still syncing, nor waits on it alone. Fails as the feed fails, once the device failed too.
 * @param {Promise<Uint8Array | null>} own @param {() => Promise<Uint8Array>} off @param {(b: any) => boolean} fits
 * @param {number} lead how long the device reads alone (ms, `READ`)
 */
async function eitherOf(own, off, fits, lead) {
	const mine = own.then((b) => (fits(b) ? b : Promise.reject(new Error('this device handed over no such file'))));
	let t;
	const late = new Promise((r) => (t = setTimeout(() => r(null), lead)));
	const first = await Promise.race([mine.catch(() => null), late]).finally(() => clearTimeout(t));
	if (first) return first;
	// the feed's read stops once the device handed the file over: never asked again in the background, nor a turn held
	const stop = new AbortController();
	const theirs = off(stop.signal);
	mine.then(() => stop.abort(), () => {});
	return Promise.any([mine, theirs]).catch(() => theirs);
}

/**
 * How a row's file is read: this device's copy of it, where it keeps one that hashes to the recipe's hash (`kept`);
 * otherwise the newest its entry brings (the feed lists them oldest first), or for one version of an asset's entry,
 * the file of its own write (./sources/avendb.js `versionsOf`), by its root: off the page's own avenDB, for rows its
 * device read (`local`, game/code/sources/device.js `deviceFile`), the feed's beside it once that takes longer than
 * `READ` (`eitherOf`); else from the feed beside the rows, whole, as bytes, a few at a time and asked again where it
 * was dropped, for as long as `patience` (`fetched`), so its hash is of the bytes the server holds. Kept on the device
 * once it hashes to the recipe's. Refused, saying why, where its entry brings none or one larger than a recipe may be.
 * Either way ./sources/avendb.js holds what it hands out to the ref's hash, version and variant. `how` is the load's:
 * `get` its fetch, and its `feed`, `kept`, `again`, `patience` and `lead`.
 * @param {{ get: typeof globalThis.fetch, feed: string, kept: { get: (hash: string) => any, put: (hash: string, bytes: Uint8Array) => any }, again: number[], patience: number, lead: number }} how
 */
const readerOf = ({ get, feed, kept, again, patience, lead }, local = false) => async (row) => {
	const hash = hashOfRow.get(row);
	const had = hash ? await Promise.resolve(kept.get(hash)).catch(() => undefined) : undefined;
	if (had && holds(had, hash)) return had;
	const file = Array.isArray(row?.files) ? row.files.at(-1) : undefined;
	if (!file) throw new Error('its entry brings no file');
	if (typeof file.len === 'number' && file.len > MOST) throw new Error(`its file is ${file.len.toLocaleString('en')} bytes, more than a recipe may be (${MOST.toLocaleString('en')})`);
	const off = (/** @type {AbortSignal | undefined} */ signal) => fetched(get, fileOf(row.vault, row.entry, feed, row.edit ? file.root : undefined), again, patience, signal);
	const fits = (/** @type {any} */ b) => b instanceof Uint8Array && (!hash || holds(b, hash));
	reads(+1);
	try {
		const bytes = local ? await eitherOf(deviceFile(file, { wait: patience }), off, fits, lead) : await off();
		if (hash && holds(bytes, hash)) Promise.resolve(kept.put(hash, bytes)).catch(() => {});
		return bytes;
	} finally {
		reads(-1);
	}
};

/**
 * How a page proves the recipes it builds (H2). Each recipe's entry is asked for once the page wants it (`want`), and
 * the entries wanted together go in one proof: one proof at a time, never one for each entry, nor many at once (the
 * feed stopped answering at a hundred reads at once, 2026-10-19). The proofs a page asked for are remembered, by the
 * page (`MOST_BATCHES`), and asked for first, as they were, the next time it loads: the same entries are the same
 * proof, which the server answers unchanged (304) while it is, and the rows this device proved of it are read back
 * with no WebAssembly run. `prove(entries)` is `{ source }` (`vaultRecipes` of the rows proved) or `{ error }`; `keep`
 * where the page's proofs are remembered (game/code/sources/feed.js `KEPT_PROOFS`), and `pageOf` the page's address.
 * @param {{ prove: (entries: string[]) => Promise<any>, keep: { get: (key: string) => any, put: (key: string, value: any) => void }, vault: string, pageOf?: () => string }} o
 */
function proverOf({ prove, keep, vault, pageOf = () => globalThis.location?.pathname ?? '' }) {
	/** each entry's proof, once wanted or asked for: a promise of `{ source }` or `{ error }` @type {Map<string, Promise<any>>} */
	const proofs = new Map();
	/** how each entry's proof settles, while it waits */
	const settle = new Map();
	/** the proofs a page asked for before, waiting to be asked for again, in order */
	const queue = [];
	/** the entries wanted since, not asked for yet, and when the first and the latest were wanted */
	const open = new Set();
	let since = 0, latest = 0;
	let flying = false, timer = null, page = null;
	const waiting = (entry) => {
		if (!proofs.has(entry)) proofs.set(entry, new Promise((ok) => settle.set(entry, ok)));
		return proofs.get(entry);
	};
	const remembered = (at) => keep.get(`page:${vault}:${at}`)?.batches ?? [];
	/** the next proof asked for, once none is: one the page asked for before at once, the entries wanted since once quiet */
	function pump() {
		if (flying) return;
		clearTimeout(timer);
		const again = queue.shift();
		if (again) return void send(again, null);
		if (!open.size) return;
		const wait = Math.min(latest + BATCH.quiet, since + BATCH.most) - Date.now();
		if (wait > 0) return void (timer = setTimeout(pump, wait));
		const entries = [...open].sort().slice(0, MOST_IN_ONE);
		for (const e of entries) open.delete(e);
		since = latest = Date.now();
		send(entries, page);
	}
	/** the proof of `entries` asked for, and each settled; remembered by page `at`, a proof it asked for afresh */
	async function send(entries, at) {
		flying = true;
		const got = await prove(entries).catch((e) => ({ error: e?.message || String(e) }));
		for (const e of entries) {
			settle.get(e)?.(got);
			settle.delete(e);
			// a proof that failed is not kept: the next build that wants its entry asks again (the server may be back)
			if ('error' in got) proofs.delete(e);
		}
		if (at !== null && 'source' in got) keep.put(`page:${vault}:${at}`, { batches: [...remembered(at), entries].slice(-MOST_BATCHES) });
		flying = false;
		pump();
	}
	/** the proofs the page at `at` asked for before, asked for again, each as it was, before any it wants now */
	function recall(at) {
		page = at;
		for (const entries of remembered(at)) {
			if (!Array.isArray(entries) || entries.every((e) => proofs.has(e))) continue;
			for (const e of entries) {
				waiting(e);
				open.delete(e);
			}
			queue.push(entries);
		}
		pump();
	}
	return {
		recall,
		/** entry `entry`'s proof, asked for with the others wanted meanwhile: `{ source }` or `{ error }` */
		want(entry) {
			if (pageOf() !== page) recall(pageOf());
			if (proofs.has(entry)) return proofs.get(entry);
			const proof = waiting(entry);
			if (!open.size) since = Date.now();
			open.add(entry);
			latest = Date.now();
			pump();
			return proof;
		}
	};
}

/** a row the vault deleted (tagged so: src/lib/avendb/seed.js GONE) is no recipe of it */
const live = (r) => !(r?.tags ?? []).includes('avendb:deleted');

/**
 * The recipes of `rows`, read off by `read` (`vaultRecipes`), each entry held to the newest version this device
 * proved of it (game/code/fresh.js `fresh`, kept in `newest`): a ref that names no version is refused off an entry
 * handed out older, naming both. Rows a device checked or a proof proved (`proven`) are kept as their entries' newest;
 * a listing on the server's word never is.
 */
const recipesOf = (rows, read, newest, proven) => {
	const held = rows.filter(live);
	return vaultRecipes(held, { read, stale: fresh(held, { proven, keep: newest }).stale });
};

/**
 * The recipes read off the page's own avenDB, where it holds one open that brought Maia City from its peers
 * (game/code/sources/device.js `deviceRows`), else off the feed: what the page knows of them after. The index is read
 * off the rows; a recipe the feed lists is built only once its entry's proof checks out (H2, `provenAt`), one the
 * device read at once, as the device checked its edits as it took them, and so on a dev server that reads its
 * stand-in, whose rows are no vault's. `device` false reads the feed whatever the page holds open.
 */
async function load({ feed = feedOf(), fetch: get = globalThis.fetch, timeout = TIMEOUT.rows, kept = KEPT, again = AGAIN, patience = PATIENCE, lead = READ, vault = MAIA_CITY, verify, proofs = KEPT_PROOFS, page, device = true, newest = KEPT_NEWEST } = {}) {
	const how = { get, feed, kept, again, patience, lead };
	const standIn = import.meta.env.DEV && import.meta.env.VITE_RECIPE_FEED === 'dev' && feed === feedOf();
	const url = standIn ? seedFeedOf(['recipe'], feed) : listingOf(['recipe'], { vault, feed });
	source = null;
	prover = null;
	fill(null);
	Object.assign(recipes, { phase: 'loading', feed: url, vault: '', count: 0, error: '', refused: [], missed: [], unread: [] });
	tell();
	/** @param {string} error */
	const failed = (error) => {
		Object.assign(recipes, { phase: 'failed', error });
		console.error(`asset recipes: ${error}`);
		tell();
		return recipes;
	};
	const couldNot = (why) => failed(`the asset recipes could not be loaded from the Maia City vault: ${why}`);
	if (!standIn && !/^[0-9a-f]{64}$/.test(String(vault))) return couldNot(NO_ANCHOR);
	// the page's own avenDB first, its own copy of Maia City, which needs no proof: read at once, whatever its peers
	// answer (local first), and read again once they brought it something new (`fresher`)
	const local = device && !standIn ? await deviceRows(['recipe'], { vault }) : null;
	if (local) {
		const read = recipesOf(local, readerOf(how, true), newest, true);
		if (Object.keys(read.index.recipes).length) {
			void fresher(vault, how, newest);
			return ready(read, null, String(local[0]?.vault ?? vault), 'this device');
		}
	}
	/**
	 * The proof of `entries`, asked again as a file is (`fetched`) where the server couldn't give it yet, until `patience`
	 * passed, the page told it waits: a world whose kinds' proof failed while avenDB's server restarted never built them,
	 * and its shots never stood (the village's animals, 2026-10-20).
	 * @param {string[]} entries
	 */
	const prove = async (entries) => {
		const proving = { vault, kinds: ['recipe'], entries, fetch: get, timeout, keep: proofs, ...(verify ? { verify } : {}) };
		const at = proofOf(['recipe'], { vault, feed, entries });
		const first = Date.now();
		let got = await provenRows(at, proving);
		let held = false;
		try {
			for (let i = 0; 'error' in got && got.passing && Date.now() - first < patience; i++) {
				if (!held) waits(+(held = true));
				await new Promise((r) => setTimeout(r, again[Math.min(i, again.length - 1)] ?? 0));
				got = await provenRows(at, proving);
			}
		} finally {
			if (held) waits(-1);
		}
		if ('error' in got) return got;
		const read = recipesOf(got.rows, readerOf(how), newest, true);
		for (const h of Object.keys(read.index.recipes)) hashOfRow.set(read.rowOf(h), h);
		return { source: read };
	};
	// the proofs this page asked for before go at once, beside the index's rows
	const pageOf = page ?? (() => globalThis.location?.pathname ?? '');
	const proving = standIn ? null : proverOf({ prove, keep: proofs, vault, pageOf });
	proving?.recall(pageOf());
	const listed = () => (standIn ? listedRows(url, { fetch: get, timeout }) : listedRows(url, { vault, fetch: get, timeout }));
	let got = await listed();
	// a feed that doesn't answer yet (a server restarting) is asked again, the page told it waits, for `patience`; the
	// page's device may bring Maia City meanwhile, and is read then
	const first = Date.now();
	let held = false;
	try {
		for (let i = 0; 'error' in got && got.passing && Date.now() - first < patience; i++) {
			if (!held) {
				held = true;
				waits(1);
			}
			await new Promise((r) => setTimeout(r, again[Math.min(i, again.length - 1)] ?? 0));
			const brought = device && !standIn ? await deviceRows(['recipe'], { vault, wait: 0 }) : null;
			const read = brought && recipesOf(brought, readerOf(how, true), newest, true);
			if (read && Object.keys(read.index.recipes).length) return ready(read, null, String(brought[0]?.vault ?? vault), 'this device');
			got = await listed();
		}
	} finally {
		if (held) waits(-1);
	}
	if ('error' in got) return couldNot(got.error);
	const rows = got.rows.filter(live);
	const read = recipesOf(rows, readerOf(how), newest, false);
	if (!Object.keys(read.index.recipes).length)
		return failed(`the Maia City vault holds no asset recipes yet: ${url} listed ${rows.length ? `${rows.length} entries, none of them one` : 'none'}${read.refused.length ? ` (${read.refused.slice(0, 3).join('; ')})` : ''}`);
	// the page's device, holding none of them yet, brings these recipes alone from its peers, for the next page
	if (device && !standIn) void bringRows(rows, String(rows[0]?.vault ?? vault));
	return ready(read, proving, String(rows[0]?.vault ?? ''), url);
}

/**
 * The recipes read again off the page's device once its peers brought it new edits of vault `vault` (its bring, which
 * goes on while the page reads what the device held): the builds asked for from then on read the vault as they hold it.
 * Nothing where the page has moved on to another source meanwhile.
 * @param {string} vault @param {Parameters<typeof readerOf>[0]} how @param {typeof KEPT_NEWEST} newest
 */
async function fresher(vault, how, newest) {
	const was = source;
	const b = await whenBrought(vault);
	if (!b?.ok?.new || source !== was) return;
	const rows = await deviceRows(['recipe'], { vault });
	if (!rows || source !== was) return;
	const read = recipesOf(rows, readerOf(how, true), newest, true);
	if (Object.keys(read.index.recipes).length) ready(read, null, String(rows[0]?.vault ?? vault), 'this device');
}

/**
 * The recipes `read` in (a ./sources/avendb.js `vaultRecipes`), of vault `vault`, read from `from` (the feed's address,
 * or this device): what the page knows of them now. `proving` proves each before it is built (`proverOf`); none for
 * what the page's own device read, or the dev server's stand-in.
 */
function ready(read, proving, vault, from) {
	if (!proving) for (const h of Object.keys(read.index.recipes)) hashOfRow.set(read.rowOf(h), h);
	source = read;
	prover = proving;
	fill(read.index);
	Object.assign(recipes, { phase: 'ready', feed: from, vault, count: Object.keys(INDEX.recipes).length, refused: [...read.refused] });
	for (const r of read.refused) console.error(`asset recipes: refused, ${r}`);
	tell();
	return recipes;
}

let loading = null;
/**
 * The vault's recipes, loaded once a page (and shared by every module of it): resolves to what the page knows of them
 * (`recipes`), ready or failed; never throws. With options, loaded again from there: `feed` where /feed/code is,
 * `fetch`, `timeout`, `kept` where the files are kept on the device (`{ get(hash), put(hash, bytes) }`, ./cache.js's
 * by default), `again` the waits before a dropped file is asked again (ms, `AGAIN`), `patience` how long it is asked
 * again at most (ms, `PATIENCE`), `lead` how long a file the page's device reads is read off it alone before the feed
 * is asked too (ms, `READ`), `vault` the anchor (Maia City's
 * id, `MAIA_CITY`), `verify` and `proofs` how a proof is checked and where what it proved, and the proofs each page
 * asked for, are kept (game/code/sources/feed.js `provenRows`, `KEPT_PROOFS`), `page` the page's address (`location`'s
 * path), `newest` where the newest version proved of each entry is kept (game/code/fresh.js `KEPT_NEWEST`): a test's,
 * or a page's that asks again (`reloadRecipes`).
 * @param {{ newest?: { get: (key: string) => any, put: (key: string, value: any) => void }, feed?: string, fetch?: typeof globalThis.fetch, timeout?: number, kept?: { get: (hash: string) => any, put: (hash: string, bytes: Uint8Array) => any }, again?: number[], patience?: number, lead?: number, vault?: string, verify?: (bytes: Uint8Array, vault: string, kinds: string[]) => Promise<any[]>, proofs?: { get: (key: string) => any, put: (key: string, value: any) => void }, page?: () => string }} [o]
 * @returns {Promise<typeof recipes>}
 */
export function loadRecipes(o) {
	const d = deviceOf();
	if (o) return ((loadedWith = d), (loading = load(o)));
	// a device the page opened since they were read off the feed (or failed to be): read again, off it (local first)
	if (loading && d && d !== loadedWith && recipes.feed !== 'this device') loading = null;
	loadedWith = d;
	return (loading ??= load());
}
/** the device the recipes were last asked for with (game/code/sources/device.js `deviceOf`) */
let loadedWith = /** @type {any} */ (undefined);

/** the recipes loaded again, from the feed they were loaded from (a page whose load failed asks again) */
export const reloadRecipes = () => ((loadedWith = deviceOf()), (loading = load()));

/** why a ref can't be built while the recipes aren't in @param {string} what */
const notIn = (what) =>
	new NotInVault(
		recipes.phase === 'failed'
			? `${what} can't be built: ${recipes.error}`
			: `${what} can't be built yet: the asset recipes of the Maia City vault are not loaded (a page loads them before its first build: loadRecipes)`
	);

/**
 * The hash a ref names in the Maia City vault: a pin, an asset by its entry and the heads of its version
 * (`vault:<vault>/<entry>@<heads>?its=values`, or `{ entry, at }`, ./sources/avendb.js `PIN_REF`), or an old ref read
 * through the entries' cards, `plants/apple@2:variant?its=values`, its latest version when none is named, its first
 * variant when none is, never another variant than the one it names. Throws NotInVault naming the ref for one the
 * vault doesn't hold (and while the recipes aren't in), and tells it (`recipes.missed`).
 * @param {string | { entry: string, at: string[] }} ref @returns {string}
 */
export function hashOf(ref) {
	try {
		if (!source) throw notIn(typeof ref === 'string' ? ref : JSON.stringify(ref));
		return source.hashOf(ref);
	} catch (e) {
		throw noted(e);
	}
}

/** The values a ref names its build with, as text: a pin's, or an old ref's. @param {string | { params?: any }} ref */
export const paramsOf = (ref) => {
	const pin = parsePin(ref);
	return pin ? pin.params : parseRef(/** @type {string} */ (ref)).params;
};

/** A build named from a ref and its values: the hash the ref names in the vault, the same values. @param {string} ref */
export const buildAt = (ref) => buildOf(hashOf(ref), paramsOf(ref));

/**
 * A recipe's name, avenDB's alone ("Oats v1 · 1a2b3c4d…": its title, its version's number, its entry's short id), as
 * every page shows it; its old ref while the recipes aren't in, or the hash's start for one the vault doesn't hold.
 * @param {string} hash
 */
export const nameOf = (hash) => source?.nameOf(hash) ?? recipeInfo(hash)?.label ?? `recipe ${String(hash).slice(0, 12)}…`;

/** The name of what a ref names in the vault (`nameOf`), or the ref itself where it names nothing, never told missed. */
export function refName(ref) {
	try {
		const hash = source?.hashOf(ref);
		if (hash) return nameOf(hash);
	} catch {
		// named as it is written
	}
	return typeof ref === 'string' ? ref : JSON.stringify(ref);
}

/** The pin that names a recipe of the vault, `{ vault, entry, at }`, where its rows say; undefined otherwise. */
export const pinOf = (hash) => source?.pinOf(hash);

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
 * A build's page: on the root, its recipe's hash as an address reads it ($lib/ids.js), its name in words (`?t=`,
 * never one of its values), then its values, sorted ($lib/assets/AssetPage.svelte).
 * @param {string} base the site's base path @param {string} hash @param {Record<string, unknown>} [values]
 */
export const pageOf = (base, hash, values) => {
	const q = queryOf(values);
	return `${base}/${idOf(hash)}/?t=${slug(recipeInfo(hash) ? nameOf(hash) : '', 'asset')}${q ? `&${q}` : ''}`;
};

/**
 * That recipe `hash` is about to be built (../load.js `canonical`): its entry's proof is asked for with the others the
 * page wants meanwhile, so a world's kinds go in one proof (`provenAt`). Nothing for a hash the index doesn't hold.
 * @param {string} hash
 */
export function wants(hash) {
	const entry = prover && recipeInfo(hash) ? source?.rowOf(hash)?.entry : undefined;
	if (entry) prover.want(entry);
}

/**
 * What proves recipe `hash` (H2): the recipes its entry's proof proves (a ./sources/avendb.js `vaultRecipes`), once
 * the proof the page asked for it with is checked and names that recipe by the label the index does; on the dev
 * server's stand-in, its rows, which prove nothing. Every build waits for it (../load.js `loadAsset`, `recipeAt`).
 * Rejects with NotInVault naming its ref, told as `hashOf` tells one, for a recipe the vault doesn't hold, whose proof
 * failed, or that Maia City's signed edits don't hold as the index says.
 * @param {string} hash
 */
export async function provenAt(hash) {
	await loadRecipes();
	const at = recipeInfo(hash);
	if (!source || !at) throw noted(source ? new NotInVault(`no recipe ${String(hash).slice(0, 12)}… is in the Maia City vault`) : notIn(`recipe ${String(hash).slice(0, 12)}…`));
	if (!prover) return source;
	const got = await prover.want(source.rowOf(hash).entry);
	// a proof the server couldn't give, however long the page asked (`prove`), may well be there: told apart (`Unread`),
	// and a world asks again for what waited on it
	if ('error' in got) throw noted(new (got.passing ? Unread : NotInVault)(`${nameOf(hash)}: not built, as its proof didn't check out: ${got.error}`));
	if (got.source.index.recipes[hash]?.label !== at.label)
		throw noted(new NotInVault(`${nameOf(hash)}: refused, Maia City's signed edits don't hold recipe ${hash.slice(0, 12)}… as the listing says`));
	return got.source;
}

/**
 * A recipe of the vault by its hash: `{ hash, code }`, once its entry's proof checks out (`provenAt`), its file read
 * off the feed once a page and held to the hash, the version and the variant its proven card names
 * (./sources/avendb.js `vaultRecipes`). Rejects with NotInVault naming its ref for one the vault doesn't hold, or holds
 * otherwise, whose proof fails or whose file can't be read; told, as `hashOf` tells one.
 * @param {string} hash @returns {Promise<{ hash: string, code: string }>}
 */
export async function recipeAt(hash) {
	const proven = await provenAt(hash);
	try {
		return await proven.recipeAt(hash);
	} catch (e) {
		throw noted(e);
	}
}
