// @ts-nocheck — plain JS, kept loose on purpose
/**
 * avenDB's FEED, AS OUR PAGES AND THE API READ CODE OFF IT (C10) — the one client for the code entries the server
 * serves to everyone (`/feed/code`, avendb/crates/avendb-server/src/feed.rs): the views and logic modules
 * (./avendb.js `loadCode`) and the asset recipes ($lib/assets/vault.js) of the server's own seed's coop, Maia City.
 * One trust anchor for all of it: the server names that vault by where it sits in the seed it was founded with
 * (`seed=1`), never by its name, and a feed that hands out more than one vault, or another's, is not what was asked
 * for. A code entry's newest file (a recipe's source) is served whole beside it, as plain text no page runs
 * (`fileOf`), and any file its row lists by its root, `seed=1` holding there too.
 */

/** avenDB's server, as browsers reach it (post-quantum key exchange only; the API reads its own feed inside, AVENDB_FEED) */
export const FEED = 'https://avendb.maia.city/feed';

/** where it serves public code entries (its feed, as /feed/posts serves posts): { code: [row] } */
export const CODE_FEED = `${FEED}/code`;

/** a vault's id, or an entry's: 64 hex digits */
const ID = /^[0-9a-f]{64}$/;

/**
 * The query for the code entries of some kinds (`view`, `logic`, `recipe`) of the server's own seed's Maia City vault.
 * @param {string[]} kinds @param {string} [feed] where /feed/code is
 */
export const seedFeedOf = (kinds, feed = CODE_FEED) => `${feed}?seed=1&type=${kinds.join(',')}`;

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
 * The rows the feed at `url` hands out, all of one vault, the seed's: { rows } or { error } (offline, a feed that
 * answers something else, more than one vault, a vault the server's seed doesn't name Maia City). Never throws.
 * `timeout` (ms) is how long the feed may take to answer.
 * @param {string} url @param {{ fetch?: typeof globalThis.fetch, timeout?: number }} [o]
 * @returns {Promise<{ rows: any[] } | { error: string }>}
 */
export async function seedRows(url, { fetch: get = globalThis.fetch, timeout = 4000 } = {}) {
	try {
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), timeout);
		const res = await get(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
		if (!res.ok) return { error: `${url} answered ${res.status}` };
		const body = await res.json();
		const rows = Array.isArray(body) ? body : (body?.code ?? body?.entries);
		if (!Array.isArray(rows)) return { error: `${url} answered no rows` };
		// the code our hosts run comes from the one vault, the seed's: a feed handing out more than one, or another's, is
		// not what was asked for
		if (new Set(rows.map((r) => r?.vault)).size > 1) return { error: `${url} handed out code of more than one vault` };
		if (rows.some((r) => r && 'seed' in r && r.seed !== 'Maia City')) return { error: `${url} handed out code of a vault that is not the seed's Maia City` };
		return { rows };
	} catch (e) {
		return { error: e?.message || String(e) };
	}
}
