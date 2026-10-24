import { localFileEntries } from './file-entries.js';
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
import { normalizeDiscovery } from './demand.js';

/** The title of the Maia City vault's own schema of a manifest. */
export const MANIFEST_SCHEMA = 'Manifest, v1';

/** How each priority ranks: what the kernel needs first, then the page, then what it may show later. */
/** @type {Record<string, number>} */
export const PRIORITY = { high: 0, medium: 1, low: 2 };

/**
 * @typedef {{type?: string[], tags?: string[]}} ManifestQuery
 * @typedef {{entry?: string, manifest?: string, query?: ManifestQuery, limit?: number, follow?: number}} ManifestPart
 * @typedef {{kind: string, id: string, priority?: string, routes?: string[], parts?: ManifestPart[]}} Manifest
 * @typedef {{entry: string, type?: string, kind?: string, tags?: string[], created?: number, record?: unknown}} ManifestRow
 * @typedef {{leaf: ManifestPart, rank: number}} RankedLeaf
 * @typedef {{run: (operation: Record<string, unknown>) => Promise<{ok?: {rows?: ManifestRow[], record?: unknown, vaults?: {id:string}[], entriesComplete?: boolean}}>}} ManifestDevice
 * @typedef {{device?: ManifestDevice, bring: (ids: string[]) => Promise<unknown>, vault?: string, fetch?: typeof globalThis.fetch, signal?: AbortSignal, prioritize?: (ids: string[], queries: {types: string[], vault?: string}[]) => unknown}} PlanOptions
 */

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
/** @param {string} route @param {string} path */
export const covers = (route, path) =>
	route === '*' || (route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : route === path);

/**
 * The parts the manifests `all` (records) declare for path `path`, walked as a composite: each manifest whose routes
 * cover the path, and each manifest it holds, once however many hold it, a cycle ending where it comes round. Each
 * leaf (an entry or a query) once, at the highest priority any manifest reaching it gives, the highest first.
 * @param {Manifest[]} all @param {string} path @returns {RankedLeaf[]}
 */
export function leavesFor(all, path) {
	const byId = new Map((all ?? []).filter((m) => m?.kind === 'manifest' && typeof m.id === 'string').map((m) => [m.id, m]));
	/** @type {Map<string, RankedLeaf>} */
	const leaves = new Map();
	/** @param {Manifest} m */
	const rankOf = (m) => PRIORITY[m.priority ?? 'medium'] ?? PRIORITY.medium;
	/** @param {Manifest} m @param {number} rank @param {Set<string>} seen */
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
/** @param {ManifestRow} row @param {ManifestQuery | undefined} q */
const fits = (row, q) =>
	(!q?.type?.length || q.type.includes(row?.type ?? row?.kind ?? '')) && (q?.tags ?? []).every((t) => (row?.tags ?? []).includes(t));

/**
 * The entries leaves `leaves` name, in their order: an entry's id, and each query's rows of `rows` (the public entries,
 * newest first), at most its `limit`. @param {{leaf: ManifestPart}[]} leaves @param {ManifestRow[]} rows @returns {string[]}
 */
export function entriesOf(leaves, rows) {
	const newest = [...(rows ?? [])].sort((a, b) => (b?.created ?? 0) - (a?.created ?? 0));
	const out = [];
	for (const { leaf } of leaves) {
		if (leaf.entry) out.push(leaf.entry);
		else {
			const found = [...new Set(newest.filter((r) => fits(r, leaf.query)).map((r) => r.entry).filter((e) => /^[0-9a-f]{64}$/.test(String(e))))];
			out.push(...(leaf.limit ? found.slice(0, leaf.limit) : found));
		}
	}
	return [...new Set(out.filter((e) => /^[0-9a-f]{64}$/.test(String(e))))];
}

const HEX = /[0-9a-f]{64}/;
const REF = /(?:vault:[0-9a-f]{64}\/|shot:)([0-9a-f]{64})/g;

/**
 * The entries a record names: each `{ entry }` pin at any depth, and each `vault:<vault>/<entry>` ref in its text, JSON
 * held in a string (a timeline's clips) read too. What a leaf that `follow`s brings next.
 * @param {any} record @returns {string[]}
 */
export function namedBy(record) {
	/** @type {Set<string>} */
	const out = new Set();
	/** @param {unknown} v @param {number} depth */
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
			if ('entry' in v && typeof v.entry === 'string' && HEX.test(v.entry) && v.entry.length === 64) out.add(v.entry);
			for (const x of Object.values(v)) visit(x, depth + 1);
		}
	};
	visit(record, 0);
	return [...out];
}

/** Manifests are verified local records. The device discovers and syncs them from peers in the background. */
/** @param {ManifestDevice | undefined} d
 * @param {{vault?:string, signal?:AbortSignal, fetch?:typeof globalThis.fetch}} options
 * @returns {Promise<Manifest[]>}
 */
export async function manifestsOf(d, { vault = MAIA_CITY, signal } = {}) {
 signal?.throwIfAborted();
 if (!d) return [];
 try {
  const got = await d.run({ op: 'query', vault, where: { type: ['manifest'] } });
  signal?.throwIfAborted();
  return (got?.ok?.rows ?? []).map(r => /** @type {Manifest} */ (r.record)).filter(Boolean);
 } catch (e) { signal?.throwIfAborted(); return []; }
}

/**
 * What the manifests declare for path `path`, brought by `bring` (./device.js `bringEntries`) a priority at a time, the
 * highest first; then, for leaves that `follow`, the entries the brought records name, a level at a time. The rows the
 * queries read are canonical locally held rows (`rowsFor`). Optional `prioritize` publishes known explicit IDs
 * before query discovery; it changes scheduling only, not authorization or completeness.
 * Answers the entries asked for.
 * @param {string} path @param {{ device?: any, bring: (ids: string[]) => Promise<any>, vault?: string, fetch?: any }} o
 */
// Diagnostic observations only; no routes, vault IDs or entry contents are retained.
/** @type {{ms:number, requested:number, state:string}[]} */
const manifestRuns = [];
let manifestPending = 0;
export const manifestDiagnostics = () => ({ pending: manifestPending, runs: manifestRuns.map(x => ({ ...x })) });

/** @param {string} path @param {PlanOptions} options @returns {Promise<string[]>} */
export async function bringDeclared(path, options) {
 const start = performance.now();
 manifestPending++;
 let requested = 0, state = 'failed';
 try {
  const entries = await planDeclared(path, options);
  requested = entries.length;
  state = options.signal?.aborted ? 'cancelled' : 'scheduled';
  return entries;
 } catch (error) {
  if (options.signal?.aborted) state = 'cancelled';
  throw error;
 } finally {
  manifestPending--;
  manifestRuns.push({ ms: performance.now() - start, requested, state });
  if (manifestRuns.length > 20) manifestRuns.shift();
 }
}

/** @param {string} path @param {PlanOptions} options @returns {Promise<string[]>} */
async function planDeclared(path, { device: d, bring, vault = MAIA_CITY, fetch: get = globalThis.fetch, signal, prioritize = () => {} }) {
	signal?.throwIfAborted();
	const leaves = leavesFor(await manifestsOf(d, { vault, fetch: get, signal }), path);
	signal?.throwIfAborted();
	if (!leaves.length) return [];
	// These IDs are already declared by canonical local manifests. Publish scheduling
	// hints before unrelated query materialization or transfer; hints grant no access.
	// Dispatch is independent of acknowledgement: a busy node must not delay local discovery.
	const queries = normalizeDiscovery(leaves.flatMap(({ leaf }) => leaf.query?.type?.length ? [{ types: leaf.query.type, vault }] : []));
	void Promise.resolve(prioritize(entriesOf(leaves.filter(({ leaf }) => leaf.entry), []), queries)).catch(() => {});
	signal?.throwIfAborted();
	/** @type {Set<string>} */
	const asked = new Set();
	for (const rank of [...new Set(leaves.map((l) => l.rank))]) {
		const at = leaves.filter((l) => l.rank === rank);
		// Known entries must not wait for materializing query results, particularly
		// unrelated lower-priority collections. Each rank finishes before the next.
		const explicit = entriesOf(at.filter(({ leaf }) => leaf.entry), []).filter(e => !asked.has(e));
		signal?.throwIfAborted();
		if (explicit.length) await bring(explicit);
		explicit.forEach(e => asked.add(e));
		signal?.throwIfAborted();
		const rows = await rowsFor(at, { device: d, vault, fetch: get, signal });
		const ids = entriesOf(at, rows).filter((e) => !asked.has(e));
		signal?.throwIfAborted();
		if (ids.length) await bring(ids);
		ids.forEach((e) => asked.add(e));
		// Keep each entry's remaining depth. A shallow leaf must not inherit another leaf's deeper walk.
		let frontier = new Map();
		for (const leaf of at) {
			const depth = Math.min(3, leaf.leaf.follow ?? 0);
			if (depth > 0) for (const e of entriesOf([leaf], rows)) frontier.set(e, Math.max(frontier.get(e) ?? 0, depth));
		}
		const visited = new Map();
		while (frontier.size && d) {
			const next = new Map();
			for (const [entry, depth] of frontier) {
				signal?.throwIfAborted();
				if ((visited.get(entry) ?? 0) >= depth) continue;
				visited.set(entry, depth);
				for (const e of await namedOn(d, [entry], signal)) next.set(e, Math.max(next.get(e) ?? 0, depth - 1));
			}
			signal?.throwIfAborted();
			const missing = [...next.keys()].filter((e) => !asked.has(e));
			if (missing.length) await bring(missing);
			missing.forEach((e) => asked.add(e));
			frontier = new Map([...next].filter(([, depth]) => depth > 0));
		}
	}
	signal?.throwIfAborted();
	return [...asked];
}

/**
 * The rows device `d` locally holds for queries among `leaves`, without records.
 * A local result is not proof that discovery or peer delivery is complete.
 */
/** @param {RankedLeaf[]} leaves @param {Pick<PlanOptions,"device"|"vault"|"fetch"|"signal">} options @returns {Promise<ManifestRow[]>} */
async function rowsFor(leaves, { device: d, vault, fetch: get, signal }) {
	const queries = leaves.flatMap(({ leaf }) => leaf.query ? [leaf.query] : []);
	if (!queries.length) return [];
	const typed = queries.every((q) => q.type?.length);
	const types = [...new Set(queries.flatMap((q) => q.type ?? []))];
	const rows = [];
	signal?.throwIfAborted();
	if (d) {
		try {
			const got = await d.run({ op: 'query', vault, ...(typed ? { where: { type: types } } : {}), select: [] });
			rows.push(...(got?.ok?.rows ?? []));
		} catch {
			// Nothing local yet; the native sync loop continues.
		}
	}
	return rows;
}

/** The entries the records of entries `ids` name, as device `d` holds them. */
/** @param {ManifestDevice} d @param {string[]} ids @param {AbortSignal | undefined} signal @returns {Promise<string[]>} */
async function namedOn(d, ids, signal) {
	/** @type {Set<string>} */
	const out = new Set();
	let files;

	for (const entry of ids) {
		try {
			const got = await d.run({ op: 'get', entry });
			signal?.throwIfAborted();
			for (const e of namedBy(got?.ok?.record)) out.add(e);
			const roots = [...JSON.stringify(got?.ok?.record ?? {}).matchAll(/aven:([a-f0-9]{64}):/g)].map(m => m[1]);
			if (roots.length) {
				files ??= await localFileEntries(d, { signal });
				signal?.throwIfAborted();
				for (const file of files) if (!file.deleted && file.files?.some(f => roots.includes(f.root))) out.add(file.entry);
			}
		} catch {
			signal?.throwIfAborted();
			// not held yet
		}
	}
	return [...out];
}
