// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE GAMES AREA of the Maia City COOP vault (A2 of /mnt/project-files/game-caps/plan.md; Samuel 2026-10-17: every
 * game lives in the COOP, public means watch and read only). Each game is one entry there, of type `game`, tagged
 * `game` and `game:<id>`, and everything else of it (its code, its configs, its AIPs) carries the same `game:<id>` tag.
 * A game is PUBLISHED while the vault gives everyone a Public share on its `game:<id>` tag: then avenDB's server lists
 * its entry on the public feed, and that listing is the one answer to "is it published?" for the pages and the API
 * alike. Withdrawing it is revoking that share. Nothing here writes: the page's seed writes the entries
 * (src/lib/avendb/seed.js), the vault's owner publishes (src/lib/app/games.svelte.js).
 *
 * A game's id is the one its code already carries (code/ `for`): its name's number, not its address's, so Sandbox 7
 * (at /app/games/sandbox-8/) is `sandbox-7`.
 *
 * A game that plays only in Samuel's tailnet (`tailnet`: Sandboxes 7 and 8, Samuel 2026-10-17) is never public: it
 * can't be published, and a Public share on its tag is not taken as publishing it.
 */

/** every game, by its id: its name and where it is played (under the site's base) */
export const GAMES = [
	{ id: 'sandbox-1', label: 'Sandbox 1', route: '/app/games/sandbox-1/' },
	{ id: 'sandbox-2', label: 'Sandbox 2', route: '/app/games/sandbox-2/' },
	{ id: 'sandbox-3', label: 'Sandbox 3', route: '/app/games/sandbox-4/' },
	{ id: 'sandbox-4', label: 'Sandbox 4', route: '/app/games/sandbox-5/' },
	{ id: 'sandbox-5', label: 'Sandbox 5', route: '/app/games/sandbox-6/' },
	{ id: 'sandbox-6', label: 'Sandbox 6', route: '/app/games/sandbox-7/' },
	{ id: 'sandbox-7', label: 'Sandbox 7', route: '/app/games/sandbox-8/', tailnet: true },
	{ id: 'sandbox-8', label: 'Sandbox 8', route: '/app/games/sandbox-9/', tailnet: true },
	{ id: 'maiacity-v1', label: 'MaiaCity V1', route: '/app/maiacity-v1/' }
];

/** the game played at `route` (without the base), if any */
export const gameOfRoute = (route) => GAMES.find((g) => route === g.route)?.id ?? null;

/** whether game `id` may be published: not one that plays only in Samuel's tailnet */
export const publishable = (id) => !GAMES.find((g) => g.id === id)?.tailnet;

/** the tag every entry of game `id` carries, and that its Public share names */
export const gameTag = (id) => `game:${id}`;

/** the tag every game's own entry carries */
export const GAME = 'game';

/** where avenDB's server lists the game entries everyone may read: the seed's Maia City's alone, never by its name */
export const GAMES_FEED = 'https://avendb.maia.city/feed/entries?seed=1&type=game';

/**
 * The games the feed's rows say are published, or null when they name none at all: before the vault holds its Games
 * area, the feed knows nothing, and each page keeps what it said before (places.ts `release`).
 */
export function publishedOf(rows) {
	const ids = new Set();
	for (const r of rows ?? []) {
		if (r?.type !== GAME && !(r?.tags ?? []).includes(GAME)) continue;
		for (const t of r?.tags ?? []) if (typeof t === 'string' && t.startsWith('game:') && publishable(t.slice(5))) ids.add(t.slice(5));
	}
	return ids.size ? ids : null;
}

/**
 * The published games, as the feed says now: a Set of ids, null when the feed names none, or { error } when it can't
 * be read (offline, a feed that answers something else). `url` is the feed's query, on the API the server's own inside.
 */
export async function loadPublished({ url = GAMES_FEED, fetch: get = globalThis.fetch, timeout = 4000 } = {}) {
	try {
		const ctl = new AbortController();
		const t = setTimeout(() => ctl.abort(), timeout);
		const res = await get(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
		if (!res.ok) return { error: `${url} answered ${res.status}` };
		const body = await res.json();
		const rows = Array.isArray(body) ? body : body?.entries;
		if (!Array.isArray(rows)) return { error: `${url} answered no rows` };
		return publishedOf(rows);
	} catch (e) {
		return { error: e?.message || String(e) };
	}
}
