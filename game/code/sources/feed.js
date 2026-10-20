// @ts-nocheck — plain JS, kept loose on purpose
/**
 * avenDB's FEED, AS OUR PAGES AND THE API READ CODE OFF IT (C10) — the one client for the code entries the server
 * serves to everyone (avendb/crates/avendb-server/src/feed.rs): the views, logic modules and configs (./avendb.js
 * `loadCode`) and the asset recipes ($lib/assets/vault.js) of the coop Maia City.
 *
 * Which code is Maia City's is proven where it runs, never taken on the server's word (H2 of the hardening plan,
 * /mnt/project-files/code-architecture/h2-provenance.md). The server hands out the signed edits that prove a vault's
 * public code (`/feed/proof`, one avenDB `wire::Reply`), of some kinds and, if asked, of some entries alone
 * (`proofOf`). avenDB's WebAssembly, the page's own device module, takes them as a device of no vault takes a sync
 * reply, every signature checked and every rule replayed, and hands back the rows of the one vault it is anchored to
 * (`provenRows`, `verifyProof`). The anchor is Maia City's vault id, pinned in the repo (./anchor.js `MAIA_CITY`):
 * never a name, which any vault may take, nor the server's or a deploy's say.
 *
 * Rows the server lists as JSON (`/feed/code`, `listedRows`) run nowhere: the asset recipes' index is read off them
 * (which assets there are, and the hash each label names), and each recipe a page builds is proven before it runs. A
 * code entry's newest file (a recipe's source) is served whole beside them, as plain text no page runs (`fileOf`), and
 * any file its row lists by its root; its loader holds it to the hash the proven record names.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { MAIA_CITY } from './anchor.js';

/** avenDB's server, as browsers reach it (post-quantum key exchange only; the API reads its own feed inside, AVENDB_FEED) */
export const FEED = 'https://avendb.maia.city/feed';

/** where it serves public code entries (its feed, as /feed/posts serves posts): { code: [row] } */
export const CODE_FEED = `${FEED}/code`;

/** a vault's id, or an entry's: 64 hex digits */
const ID = /^[0-9a-f]{64}$/;

/**
 * The trust anchor: Maia City's vault id, 64 hex digits, pinned in the repo (./anchor.js). The code our hosts run is
 * the code this vault's own signed edits prove (`provenRows`). While it is empty, no code is taken from the feed:
 * views, logic and configs run the repo's seed, and the asset recipes fail, saying so.
 */
export { MAIA_CITY };

/** why no code is taken from the feed while the anchor is not set */
export const NO_ANCHOR = "Maia City's vault id is not set (game/code/sources/anchor.js MAIA_CITY, 64 hex digits), so no code is taken from avenDB's feed";

/**
 * The query for the code entries of some kinds (`view`, `logic`, `recipe`) of the server's own seed's Maia City vault.
 * @param {string[]} kinds @param {string} [feed] where /feed/code is
 */
export const seedFeedOf = (kinds, feed = CODE_FEED) => `${feed}?seed=1&type=${kinds.join(',')}`;

/**
 * The query for the code entries of some kinds of vault `vault`, the anchor's by default: what the server lists of
 * them, as JSON, on its word (`listedRows`).
 * @param {string[]} kinds @param {{ vault?: string, feed?: string }} [o] `feed` where /feed/code is
 */
export const listingOf = (kinds, { vault = MAIA_CITY, feed = CODE_FEED } = {}) => `${feed}?vault=${vault}&type=${kinds.join(',')}`;

/**
 * Where a code entry's newest file is served, beside the code feed `feed` (`<feed>/../entry/<vault>/<entry>/file`), held
 * to the seed's vault as the rows were (`seed=1`); with `root`, the file of that root among those its row lists, as
 * an asset's versions each bring their own (`<…>/file/<root>`). Throws for a vault, entry or root that is no id.
 * @param {string} vault @param {string} entry @param {string} [feed] where /feed/code is @param {string} [root]
 */
export function fileOf(vault, entry, feed = CODE_FEED, root = undefined) {
	if (!ID.test(String(vault)) || !ID.test(String(entry))) throw new Error(`not an entry of a vault: ${String(entry).slice(0, 16)}… of ${String(vault).slice(0, 16)}…`);
	if (root !== undefined && !ID.test(String(root))) throw new Error(`not a file's root: ${String(root).slice(0, 16)}…`);
	return `${feed.replace(/\/code\/?$/, '')}/entry/${vault}/${entry}/file${root === undefined ? '' : `/${root}`}?seed=1`;
}

/**
 * Where the proof of vault `vault`'s public code of some kinds is served, beside the code feed `feed`
 * (`<feed>/../proof?vault=<vault>&type=<kinds>`): the signed edits `provenRows` checks. With `entries`, of those
 * entries alone (`&entry=<id>,…`, sorted, so the same entries are always the same address and the same proof).
 * @param {string[]} kinds @param {{ vault?: string, feed?: string, entries?: string[] }} [o] `feed` where /feed/code is
 */
export const proofOf = (kinds, { vault = MAIA_CITY, feed = CODE_FEED, entries } = {}) =>
	`${feed.replace(/\/code\/?$/, '')}/proof?vault=${vault}&type=${kinds.join(',')}${entries ? `&entry=${[...entries].sort().join(',')}` : ''}`;

/** the device module's WebAssembly, started once (the page's own avenDB device, which the page loads anyway) */
let wasm = null;

/**
 * The rows the proof `bytes` proves of vault `vault`'s public code of kinds `kinds`, as avenDB's WebAssembly reads
 * them back (avendb-browser's `provenCode`, `avendb::provenance::verify`): a device of no vault takes the edits as it
 * takes a sync reply, each signature checked, every rule replayed, and reads the rows of that vault alone. Throws why
 * for bytes that are no reply or prove no vault of that id. In a page and in the API (Bun) alike.
 * @param {Uint8Array} bytes @param {string} vault @param {string[]} kinds @returns {Promise<any[]>}
 */
export async function verifyProof(bytes, vault, kinds) {
	wasm ??= import('../../../src/lib/avendb/device/avendb_browser.js').then(async (pkg) => (await pkg.default(), pkg));
	const pkg = await wasm.catch((e) => {
		wasm = null;
		throw e;
	});
	return JSON.parse(pkg.provenCode(bytes, vault, kinds.join(',')));
}

/** what the page's storage holds under `name`, as JSON; undefined where it holds nothing or there is none */
function stored(name) {
	try {
		return JSON.parse(globalThis.localStorage?.getItem(name) ?? 'null') ?? undefined;
	} catch {
		return undefined;
	}
}

/** `value` kept in the page's storage under `name`, as JSON: false where it is full, or there is none */
function store(name, value) {
	try {
		if (!globalThis.localStorage) return false;
		globalThis.localStorage.setItem(name, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

/**
 * Where the rows a device proved are kept, never the proof's bytes: by the query they answer (`provenRows`), with the
 * proof's tag (`ETag`), in the page's own storage, so a page loaded again whose proof hasn't changed runs no
 * WebAssembly. Each row is kept once (`avendb-row:<vault>/<entry>`), however many queries' proofs hold it (a world's,
 * and each of its assets' own pages), and a query's record names its rows: the page's storage holds about 5 MB, and
 * every recipe's row together about 1.5. What it can't hold, and the API, which has no storage, are kept in `memory`
 * alone. `put` keeps any other value (a page's batches, $lib/assets/vault.js) as it is.
 */
const memory = new Map();
export const KEPT_PROOFS = {
	get(key) {
		if (memory.has(key)) return memory.get(key);
		const kept = stored(`avendb-proof:${key}`);
		if (!kept) return undefined;
		const { entries, ...value } = kept;
		if (Array.isArray(entries)) value.rows = entries.map((e) => memory.get(`row:${e}`) ?? stored(`avendb-row:${e}`));
		// a row the storage lost since: the proof is checked again
		if (value.rows?.some((r) => !r)) return undefined;
		memory.set(key, value);
		return value;
	},
	put(key, value) {
		memory.set(key, value);
		if (!Array.isArray(value?.rows)) return void store(`avendb-proof:${key}`, value);
		const entries = value.rows.map((r) => `${r?.vault}/${r?.entry}`);
		value.rows.forEach((r, i) => memory.set(`row:${entries[i]}`, r));
		// the record only once every row it names is kept
		if (value.rows.every((r, i) => store(`avendb-row:${entries[i]}`, r))) store(`avendb-proof:${key}`, { ...value, rows: undefined, entries });
	}
};

/** what a query is kept by: its anchor, its kinds and, for some entries alone, a hash of them, sorted */
const keyOf = (vault, kinds, entries) =>
	`${vault}/${kinds.join(',')}${entries ? `/${bytesToHex(blake3(utf8ToBytes([...entries].sort().join(',')))).slice(0, 32)}` : ''}`;

/**
 * The rows of vault `vault`'s public code of kinds `kinds`, of `entries` alone if given, that the proof at `url`
 * (`proofOf`) proves, and nothing else: { rows } or { error } (no anchor, offline, a proof that doesn't check out or
 * proves no such vault). Never throws, and never hands out a row it didn't prove. `verify` checks a proof
 * (`verifyProof`); `keep` holds what was proved by the proof's tag (`KEPT_PROOFS`), which the server answers unchanged
 * (304) or alike for a proof it already handed out, so a proof is checked once a device. `timeout` (ms) is how long
 * the proof may take, fetched and checked; a check that runs past it still keeps what it proves, for the next load.
 * @param {string} url
 * @param {{ vault?: string, kinds: string[], entries?: string[], fetch?: typeof globalThis.fetch, timeout?: number, verify?: typeof verifyProof, keep?: typeof KEPT_PROOFS }} o
 * @returns {Promise<{ rows: any[] } | { error: string }>}
 */
export async function provenRows(url, { vault = MAIA_CITY, kinds, entries, fetch: get = globalThis.fetch, timeout = 4000, verify = verifyProof, keep = KEPT_PROOFS }) {
	if (!ID.test(String(vault))) return { error: NO_ANCHOR };
	const key = keyOf(vault, kinds, entries);
	const work = async () => {
		const had = keep.get(key);
		// a page's browser asks again by the tag itself (the proof is `no-cache`), and a header of its own would cost
		// it a preflight; the API asks by the tag
		const asks = had?.tag && typeof window === 'undefined' ? { headers: { 'if-none-match': had.tag } } : {};
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), timeout);
		const res = await get(url, { ...asks, signal: ctl.signal }).finally(() => clearTimeout(t));
		const tag = res.headers?.get?.('etag') ?? '';
		if (had && (res.status === 304 || (res.ok && tag && tag === had.tag))) return { rows: had.rows };
		if (!res.ok) return { error: `${url} answered ${res.status}` };
		const proved = await verify(new Uint8Array(await res.arrayBuffer()), vault, kinds);
		if (!Array.isArray(proved)) return { error: `the proof at ${url} proved no rows` };
		// what avenDB's WebAssembly reads back is the anchor's alone; held to it again here all the same
		if (proved.some((r) => r?.vault !== vault)) return { error: `the proof at ${url} proved code of another vault than Maia City's` };
		// a proof of some entries also holds, as it was then, the entry that first stayed in each audience they stayed
		// in (its key is published from then on): proven, but not what was asked for
		const asked = entries && new Set(entries);
		const rows = asked ? proved.filter((r) => asked.has(r?.entry)) : proved;
		if (tag) keep.put(key, { tag, rows });
		return { rows };
	};
	const failed = (e) => ({ error: e?.name === 'AbortError' ? `${url} took longer than ${timeout} ms` : `the proof at ${url} doesn't check out: ${e?.message || String(e)}` });
	const proving = work().catch(failed);
	let late;
	const timer = new Promise((ok) => (late = setTimeout(() => ok({ error: `${url} took longer than ${timeout} ms to prove` }), timeout)));
	return Promise.race([proving, timer]).finally(() => clearTimeout(late));
}

/**
 * The rows the feed at `url` lists (`listingOf`), all of vault `vault`, or without one all of the server's seed's Maia
 * City: { rows } or { error } (offline, a feed that answers something else, rows of another vault or of more than
 * one). Never throws. `timeout` (ms) is how long the feed may take to answer. Unproven, on the server's word: the
 * asset recipes' index is read off them, each recipe proven before it runs ($lib/assets/vault.js), and the dev
 * server's stand-in reads code so (never in a build); everything else that runs reads `provenRows`.
 * @param {string} url @param {{ vault?: string, fetch?: typeof globalThis.fetch, timeout?: number }} [o]
 * @returns {Promise<{ rows: any[] } | { error: string }>}
 */
export async function listedRows(url, { vault, fetch: get = globalThis.fetch, timeout = 4000 } = {}) {
	try {
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), timeout);
		const res = await get(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
		if (!res.ok) return { error: `${url} answered ${res.status}` };
		const body = await res.json();
		const rows = Array.isArray(body) ? body : (body?.code ?? body?.entries);
		if (!Array.isArray(rows)) return { error: `${url} answered no rows` };
		// the code our hosts run comes from the one vault, the anchor's (or the seed's): a feed listing more than one, or
		// another's, is not what was asked for
		if (vault !== undefined && rows.some((r) => r?.vault !== vault)) return { error: `${url} listed code of another vault than Maia City's` };
		if (new Set(rows.map((r) => r?.vault)).size > 1) return { error: `${url} handed out code of more than one vault` };
		if (vault === undefined && rows.some((r) => r && 'seed' in r && r.seed !== 'Maia City')) return { error: `${url} handed out code of a vault that is not the seed's Maia City` };
		return { rows };
	} catch (e) {
		return { error: e?.message || String(e) };
	}
}
