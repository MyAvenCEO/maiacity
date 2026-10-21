// @ts-nocheck — plain JS, kept loose on purpose
/**
 * MANIFESTS: WHAT A PAGE NEEDS, DECLARED (Samuel 2026-10-21: "a tree-shaking-like pattern … per core and app
 * manifests", "composite leaf pattern"). A manifest is an entry of the Maia City vault, of type `manifest`, changed only
 * by AIP like every vault entry, that names what the pages at its routes read: entries by id, queries of the public
 * entries (by type and tags, newest first, at most `limit`), and other manifests, whose parts it then holds too. So the
 * kernel is one manifest (`routes: ['*']`, the cap groups, schemas and lenses every page reads), the dashboard another
 * that holds it, each game's another, and a Studio timeline's its own (its cuts, followed to the clips and shots their
 * records name: `follow`). Nothing is hardcoded per app: a page asks for its path, and the manifests that name it say
 * what comes first.
 *
 * A device opened on a page (./device.js `useDevice`) brings what the manifests declare, then what the page learned it
 * read before (`learned`), then the rest of the vault in the background, as avendb-net syncs. A manifest that names an
 * entry no one may read, or a query that finds nothing, brings nothing: the page still reads what it reads, as before.
 * A vault that holds no manifest yet (before its AIP lands) brings nothing more than before.
 */
import { MAIA_CITY } from './anchor.js';

/** The title of the Maia City vault's own schema of a manifest. */
export const MANIFEST_SCHEMA = 'Manifest, v1';

/** How each priority ranks: what the kernel needs first, then the page, then what it may show later. */
export const PRIORITY = { high: 0, medium: 1, low: 2 };

const ID = '^[a-z0-9][a-z0-9-]*$';

/**
 * The schema of a manifest: its id (how other manifests hold it), its title, the routes it is for (a path, or a path
 * ending in `*` for every path under it, `*` alone for every page), its priority, and its parts, each one of an entry
 * (`{ entry }`), a query of the public entries (`{ query: { type?, tags? }, limit? }`), or another manifest
 * (`{ manifest }`); an entry or a query may `follow` the entries its records name, a level at a time.
 */
export const MANIFEST_V1 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: MANIFEST_SCHEMA,
	type: 'object',
	properties: {
		kind: { const: 'manifest' },
		id: { type: 'string', maxLength: 64, pattern: ID },
		title: { type: 'string', maxLength: 160 },
		note: { type: 'string', maxLength: 2000, default: '' },
		routes: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 200 }, default: [] },
		priority: { enum: ['high', 'medium', 'low'], default: 'medium' },
		parts: {
			type: 'array',
			maxItems: 128,
			items: {
				type: 'object',
				properties: {
					entry: { type: 'string', pattern: '^[0-9a-f]{64}$' },
					manifest: { type: 'string', maxLength: 64, pattern: ID },
					query: {
						type: 'object',
						properties: {
							type: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 64 } },
							tags: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 128 } }
						}
					},
					limit: { type: 'integer', minimum: 1, maximum: 512 },
					follow: { type: 'integer', minimum: 0, maximum: 3, default: 0 }
				}
			}
		}
	},
	required: ['kind', 'id', 'title', 'parts']
});

/** Route `route` covers path `path`: the same path, a path under a route ending in `*`, or any path for `*`. */
export const covers = (route, path) =>
	route === '*' || (route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : route === path);

/**
 * The parts the manifests `all` (records) declare for path `path`, walked as a composite: each manifest whose routes
 * cover the path, and each manifest it holds, once however many hold it, a cycle ending where it comes round. Each
 * leaf (an entry or a query) once, at the highest priority any manifest reaching it gives, the highest first.
 * @param {any[]} all @param {string} path @returns {{ leaf: any, rank: number }[]}
 */
export function leavesFor(all, path) {
	const byId = new Map((all ?? []).filter((m) => m?.kind === 'manifest' && typeof m.id === 'string').map((m) => [m.id, m]));
	const leaves = new Map();
	const rankOf = (m) => PRIORITY[m.priority] ?? PRIORITY.medium;
	const walk = (m, rank, seen) => {
		if (seen.has(m.id)) return;
		seen.add(m.id);
		const r = Math.min(rank, rankOf(m));
		for (const p of Array.isArray(m.parts) ? m.parts : []) {
			if (typeof p?.manifest === 'string') {
				const held = byId.get(p.manifest);
				if (held) walk(held, r, seen);
				continue;
			}
			if (!p?.entry && !p?.query) continue;
			const key = JSON.stringify([p.entry ?? null, p.query ?? null, p.limit ?? null, p.follow ?? 0]);
			const had = leaves.get(key);
			if (!had || had.rank > r) leaves.set(key, { leaf: p, rank: r });
		}
	};
	for (const m of byId.values()) {
		if ((m.routes ?? []).some((r) => typeof r === 'string' && covers(r, path))) walk(m, rankOf(m), new Set());
	}
	return [...leaves.values()].sort((a, b) => a.rank - b.rank);
}

/** Row `row` is one query `q` asks for: of one of its types, if it names any, and with all its tags. */
const fits = (row, q) =>
	(!q.type?.length || q.type.includes(row?.type ?? row?.kind)) && (q.tags ?? []).every((t) => (row?.tags ?? []).includes(t));

/**
 * The entries leaves `leaves` name, in their order: an entry's id, and each query's rows of `rows` (the public entries,
 * newest first), at most its `limit`. @param {{ leaf: any }[]} leaves @param {any[]} rows @returns {string[]}
 */
export function entriesOf(leaves, rows) {
	const newest = [...(rows ?? [])].sort((a, b) => (b?.created ?? 0) - (a?.created ?? 0));
	const out = [];
	for (const { leaf } of leaves) {
		if (leaf.entry) out.push(leaf.entry);
		else {
			const found = newest.filter((r) => fits(r, leaf.query)).map((r) => r.entry);
			out.push(...(leaf.limit ? found.slice(0, leaf.limit) : found));
		}
	}
	return [...new Set(out.filter((e) => /^[0-9a-f]{64}$/.test(String(e))))];
}

const HEX = /[0-9a-f]{64}/;
const REF = /vault:[0-9a-f]{64}\/([0-9a-f]{64})/g;

/**
 * The entries a record names: each `{ entry }` pin at any depth, and each `vault:<vault>/<entry>` ref in its text, JSON
 * held in a string (a timeline's clips) read too. What a leaf that `follow`s brings next.
 * @param {any} record @returns {string[]}
 */
export function namedBy(record) {
	const out = new Set();
	const visit = (v, depth) => {
		if (depth > 8 || v == null) return;
		if (typeof v === 'string') {
			for (const m of v.matchAll(REF)) out.add(m[1]);
			if (v.length > 2 && (v[0] === '{' || v[0] === '[')) {
				try {
					visit(JSON.parse(v), depth + 1);
				} catch {
					// text, not JSON
				}
			}
			return;
		}
		if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
		if (typeof v === 'object') {
			if (typeof v.entry === 'string' && HEX.test(v.entry) && v.entry.length === 64) out.add(v.entry);
			for (const x of Object.values(v)) visit(x, depth + 1);
		}
	};
	visit(record, 0);
	return [...out];
}

/** avenDB's feed of the entries everyone may read (avendb-server `feed`). */
export const ENTRIES_FEED = 'https://avendb.maia.city/feed/entries';

/** The rows of the feed `url` asks for, or [] where it can't be read. */
async function feedRows(url, get) {
	try {
		const r = await get(url, { headers: { accept: 'application/json' } });
		if (!r.ok) return [];
		const { entries } = await r.json();
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

/**
 * The manifests of vault `vault`: off device `d` where it holds any, else off the feed. @returns {Promise<any[]>}
 */
export async function manifestsOf(d, { vault = MAIA_CITY, fetch: get = globalThis.fetch } = {}) {
	if (d) {
		try {
			const got = await d.run({ op: 'query', vault, where: { type: ['manifest'] } });
			const rows = got?.ok?.rows ?? [];
			if (rows.length) return rows.map((r) => r.record).filter(Boolean);
		} catch {
			// the feed then
		}
	}
	if (!get) return [];
	const rows = await feedRows(`${ENTRIES_FEED}?seed=1&vault=${vault}&type=manifest`, get);
	return rows.map((r) => r.record).filter(Boolean);
}

/**
 * What the manifests declare for path `path`, brought by `bring` (./device.js `bringEntries`) a priority at a time, the
 * highest first; then, for leaves that `follow`, the entries the brought records name, a level at a time. The rows the
 * queries read are the feed's public ones, a listing without records, and those the device already holds (`rowsFor`).
 * Answers the entries asked for.
 * @param {string} path @param {{ device?: any, bring: (ids: string[]) => Promise<any>, vault?: string, fetch?: any }} o
 */
export async function bringDeclared(path, { device: d, bring, vault = MAIA_CITY, fetch: get = globalThis.fetch }) {
	const leaves = leavesFor(await manifestsOf(d, { vault, fetch: get }), path);
	if (!leaves.length) return [];
	const rows = await rowsFor(leaves, { device: d, vault, fetch: get });
	const asked = [];
	for (const rank of [...new Set(leaves.map((l) => l.rank))]) {
		const at = leaves.filter((l) => l.rank === rank);
		const ids = entriesOf(at, rows).filter((e) => !asked.includes(e));
		if (ids.length) await bring(ids);
		asked.push(...ids);
		let follow = at.filter(({ leaf }) => (leaf.follow ?? 0) > 0);
		let from = entriesOf(follow, rows);
		for (let level = 1; follow.length && from.length && d && level <= 3; level++) {
			const named = await namedOn(d, from);
			const next = named.filter((e) => !asked.includes(e));
			if (next.length) await bring(next);
			asked.push(...next);
			follow = follow.filter(({ leaf }) => leaf.follow > level);
			from = next;
		}
	}
	return asked;
}

/**
 * The rows the queries among leaves `leaves` read, once: the feed's public rows of vault `vault` (a listing without
 * records, of the types the queries name where every one names some) and the rows device `d` holds of those types.
 */
async function rowsFor(leaves, { device: d, vault, fetch: get }) {
	const queries = leaves.map(({ leaf }) => leaf.query).filter(Boolean);
	if (!queries.length) return [];
	const typed = queries.every((q) => q.type?.length);
	const types = [...new Set(queries.flatMap((q) => q.type ?? []))];
	const kinds = typed ? `&type=${types.join(',')}` : '';
	const rows = get ? await feedRows(`${ENTRIES_FEED}?seed=1&vault=${vault}&bare=1${kinds}`, get) : [];
	if (d) {
		try {
			const got = await d.run({ op: 'query', vault, ...(typed ? { where: { type: types } } : {}), select: [] });
			rows.push(...(got?.ok?.rows ?? []));
		} catch {
			// the feed's alone
		}
	}
	return rows;
}

/** The entries the records of entries `ids` name, as device `d` holds them. */
async function namedOn(d, ids) {
	const out = new Set();
	for (const entry of ids) {
		try {
			const got = await d.run({ op: 'get', entry });
			for (const e of namedBy(got?.ok?.record)) out.add(e);
		} catch {
			// not held yet
		}
	}
	return [...out];
}
