import { localFileEntries } from './file-entries.js';
import { MAIA_CITY } from './anchor.js';
import { TIERS, atMost, normalizeDiscovery, rank, schedule } from './interest.js';
/**
 * ACTORS: WHAT AN APP IS AND WHAT IT LOADS, IN TIERS (task M of the one query engine, Samuel 2026-10-27: "Actor" means
 * one thing everywhere, a self-contained, addressable, self-describing entry; an app is an actor). An actor is an entry
 * of the Maia City vault, changed only by AIP like every vault entry. Its `loads` is a tree of Interests in four tiers
 * (Lean avendb/spec/AvenDB/Interest.lean `Tree`): what the screen shows `now`, what the person will open `next`, the
 * `later` rest of the screen's data, and the `idle` rest the device keeps offline. A part is another actor, held at the
 * tier it sits in (its parts never come above it: `flatten_never_raises`), or one Interest:
 *
 *   { want: { type?, tags?, entry?, vault? },   the cap selector grammar shares use; `entry` may be a slot (`$room`)
 *     part?: 'headers' | 'record' | 'files',     what of it: rows alone, the entry, or its files
 *     files?: ['media:still', 'audio/'],        which files, by the app's own tags, or a media type ending in `/`
 *     window?: { newest: n } | { oldest: true }, the newest n first, or the whole history oldest first
 *     follow?: 0..3,                             the entries its records name, a level at a time
 *     by?: 'viewport' | 'playhead' | 'camera' | 'list' }  the signal that orders it inside its tier
 *
 * Slots (`$room`, `$timeline`, `$asset`, `$original`) are bound by the route or the selection (./device.js
 * `bindView`); a slot no one bound wants nothing, never the whole vault (`unbound_slot_wants_nothing`). Nothing is
 * hardcoded per app: a page asks for its path, and the actors that name it say what comes in which tier.
 *
 * "Actor, v3" is "Manifest, v2" evolved, one schema in three versions joined by lenses: the same entries, ids and
 * history, each moved by one v3 write (scripts/propose-actors.mjs). v3 renames the kind (`manifest` to `actor`) and
 * `tiers` to `loads`, a held part `{ manifest }` to `{ actor }`, and adds the actor's `interface`, `needs` (caps) and
 * `code` (pins), empty for a data-only actor. Until the vault holds v3, a v2 manifest (or a v1 one) still reads here,
 * lifted (`lift`). The entries keep the entry type `manifest` (`ACTOR_TYPE`): a type is fixed at create, and one type
 * keeps one catalog query.
 */

/** The entry type of an actor: the 15 entries AIP-38 made keep it, so every device finds actors by one selector. */
export const ACTOR_TYPE = 'manifest';

/** The title of the Maia City vault's own schema of an actor. */
export const ACTOR_SCHEMA = 'Actor, v3';
/** The title of the version it evolves from, and of the lens between them. */
export const MANIFEST_SCHEMA = 'Manifest, v2';
export const ACTOR_LENS = 'Manifest, v2 to Actor, v3';
/** The title of v1, joined to v2 by its own lens (AIP-38 moved every manifest to v2). */
export const MANIFEST_V1_SCHEMA = 'Manifest, v1';
export const MANIFEST_LENS = 'Manifest, v1 to v2';

const ID = '^[a-z0-9][a-z0-9-]*$';
const HEX = /^[0-9a-f]{64}$/;
const SLOT = /^\$([a-z][a-z0-9-]*)$/;

/** What a v3 part names a query entry by (task C1): its address in the actor's own vault, the query's params bound to
 *  slots or entries, and the vault it reads where not the actor's own (`*` any, `$vault` the route's). */
const LOAD_QUERY = {
	query: {
		type: 'object',
		properties: { entry: { type: 'string', maxLength: 64, pattern: '^([0-9a-f]{64}|[a-z0-9][a-z0-9-]*)$' }, version: { type: 'integer', minimum: 1 } },
		required: ['entry', 'version']
	},
	bind: { type: 'object', maxProperties: 8, additionalProperties: { type: 'string', pattern: '^([0-9a-f]{64}|\\$[a-z][a-z0-9-]*)$' } },
	vault: { type: 'string', pattern: '^([0-9a-f]{64}|\\$vault|\\*)$' }
};

/** A part of an actor's `loads` (`held` names the field that holds another actor: `actor` in v3, `manifest` in v2). */
/** @param {string} held */
const part = (held) => ({
	type: 'object',
	properties: {
		[held]: { type: 'string', maxLength: 64, pattern: ID },
		...(held === 'actor' ? LOAD_QUERY : {}),
		want: {
			type: 'object',
			properties: {
				type: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 64 } },
				tags: { type: 'array', maxItems: 16, items: { type: 'string', maxLength: 128 } },
				entry: { type: 'string', pattern: '^([0-9a-f]{64}|\\$[a-z][a-z0-9-]*)$' },
				vault: { type: 'string', pattern: '^([0-9a-f]{64}|\\$vault|\\*)$' }
			}
		},
		part: { enum: ['headers', 'record', 'files'], default: 'record' },
		files: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 64 } },
		window: {
			type: 'object',
			properties: { newest: { type: 'integer', minimum: 1, maximum: 512 }, oldest: { const: true } }
		},
		follow: { type: 'integer', minimum: 0, maximum: 3, default: 0 },
		by: { enum: ['viewport', 'playhead', 'camera', 'list'] },
		note: { type: 'string', maxLength: 400 }
	}
});

/** Four tiers of parts. @param {string} held */
const tiers = (held) => ({
	type: 'object',
	properties: Object.fromEntries(TIERS.map((t) => [t, { type: 'array', maxItems: 64, items: part(held), default: [] }]))
});

/** What every version holds alike: its id, title, note, the routes it is for and the slots it reads. */
const COMMON = {
	id: { type: 'string', maxLength: 64, pattern: ID },
	title: { type: 'string', maxLength: 160 },
	note: { type: 'string', maxLength: 2000, default: '' },
	routes: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 200 }, default: [] },
	slots: { type: 'array', maxItems: 8, items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }, default: [] }
};

/** The schema of a manifest, v2 (AIP-38), as the vault holds it: the version "Actor, v3" evolves from. */
export const MANIFEST_V2 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: MANIFEST_SCHEMA,
	type: 'object',
	properties: { kind: { const: 'manifest' }, v: { const: 2 }, ...COMMON, tiers: tiers('manifest') },
	required: ['kind', 'v', 'id', 'title', 'tiers']
});

/** An interface (avendb::address, Lean Address.lean): its version, methods, events, the caps it needs, a description. */
const INTERFACE = {
	type: 'object',
	properties: {
		version: { type: 'integer', minimum: 1 },
		description: { type: 'string', maxLength: 2000 },
		methods: { type: 'array', maxItems: 64, items: { type: 'object' } },
		events: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 64 } },
		needs: { type: 'array', maxItems: 32, items: { type: 'object' } }
	},
	required: ['version', 'methods'],
	default: { version: 1, methods: [] }
};

/**
 * The schema of an actor, v3: v2's fields with `loads` for `tiers`, the actor's own interface (avendb::address: the
 * methods and events it answers and the caps it needs; no methods for an actor that only loads) and the code it pins.
 * Self-contained: nothing about an actor lives outside its entry, so any peer that reads it describes it.
 */
export const ACTOR_V3 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: ACTOR_SCHEMA,
	type: 'object',
	properties: {
		kind: { const: 'actor' },
		v: { const: 3 },
		...COMMON,
		interface: INTERFACE,
		code: {
			type: 'array',
			maxItems: 16,
			items: { type: 'object', properties: { entry: { type: 'string', pattern: '^[0-9a-f]{64}$' }, at: { type: 'array', items: { type: 'string' } } } },
			default: []
		},
		loads: tiers('actor')
	},
	required: ['kind', 'v', 'id', 'title', 'loads']
});

/**
 * @typedef {{type?: string[], tags?: string[], entry?: string, vault?: string}} Want
 * @typedef {{actor?: string, manifest?: string, query?: {entry: string, version: number}, bind?: Record<string, string>, vault?: string, want?: Want, part?: string, files?: string[], window?: {newest?: number, oldest?: boolean}, follow?: number, by?: string, note?: string}} Part
 * @typedef {{kind: string, id: string, v?: number, title?: string, note?: string, routes?: string[], slots?: string[], interface?: any, code?: any[], loads?: Record<string, Part[]>, tiers?: Record<string, Part[]>, priority?: string, parts?: any[], where?: any, window?: {limit?: number}, order?: string[], follow?: number}} Actor
 * @typedef {{tier: string, part: Part, want: Want, actor: string}} Leaf
 * @typedef {{run: (op: Record<string, unknown>) => Promise<any>}} ActorDevice
 */

/** No parts in any tier: what a lens gives the version it adds a list of tiers to. */
const EMPTY = Object.freeze({ now: [], next: [], later: [], idle: [] });

/**
 * The lens from v2 (schema id `from`) to v3 (`to`): the kind `manifest` reads as `actor` and `v` 2 as 3 (a convert may
 * name one field on both sides: task K, `lens::Lane::fits` takes the two kinds as one kin once this lens joins them),
 * and the fields v3 adds read empty. As with v1 to v2, `tiers` give way to `loads` by the one write that moves an actor
 * to v3 (a v2 one opens in v3 with empty loads, and in v2 a moved one with empty tiers): a lens maps fields, and
 * renaming the part that holds another actor inside every tier is no field's map.
 * @param {string} from @param {string} to
 */
export const actorLens = (from, to) => JSON.stringify({
	lens: ACTOR_LENS,
	from,
	to,
	steps: [
		{ convert: { from: ['kind'], to: ['kind'], forward: [[{ kind: 'manifest' }, { kind: 'actor' }]], backward: [[{ kind: 'actor' }, { kind: 'manifest' }]] } },
		{ convert: { from: ['v'], to: ['v'], forward: [[{ v: 2 }, { v: 3 }]], backward: [[{ v: 3 }, { v: 2 }]] } },
		{ convert: { from: ['tiers'], to: ['loads'], forward: [[{}, { loads: EMPTY }]], backward: [[{}, { tiers: EMPTY }]] } },
		{ add: 'interface' },
		{ add: 'code' }
	]
});

/** Route `route` covers path `path`: the same path, a path under a route ending in `*`, or any path for `*`. */
/** @param {string} route @param {string} path */
export const covers = (route, path) =>
	route === '*' || (route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : route === path);

/** A v1 part as v2's. @param {any} p @returns {Part[]} */
const v1Part = (p) => {
	if (typeof p?.manifest === 'string') return [{ manifest: p.manifest }];
	if (p?.entry) return [{ want: { entry: p.entry }, ...(p.follow ? { follow: p.follow } : {}) }];
	if (p?.query) return [{ want: { ...(p.query.type ? { type: p.query.type } : {}), ...(p.query.tags ? { tags: p.query.tags } : {}) },
		...(p.limit ? { window: { newest: p.limit } } : {}), ...(p.follow ? { follow: p.follow } : {}) }];
	return [];
};

/** A v2 part as v3's: the actor it holds named `actor`, everything else as it was. @param {Part} p @returns {Part} */
const v2Part = (p) => {
	if (typeof p?.manifest !== 'string') return p;
	const { manifest, ...rest } = p;
	return { actor: manifest, ...rest };
};

/**
 * Any version read as v3 (the write `scripts/propose-actors.mjs` makes, and what the lens gives the fields it maps): a
 * v1 manifest's high and medium parts on screen now, its low ones later; a v2 manifest's tiers as loads; a record that
 * holds loads, an actor whatever kind or version it still stores. A v3 actor, or anything else, as it is.
 * @param {Actor} m @returns {Actor}
 */
export function lift(m) {
	if (!m || typeof m !== 'object' || (m.kind === 'actor' && m.v === 3)) return m;
	if (m.kind !== 'manifest' && m.kind !== 'actor') return m;
	// moved by its v3 write: what a lens edit keeps of the stored kind or version, the loads say it is an actor
	if (m.loads && typeof m.loads === 'object') {
		const { tiers: _, ...rest } = m;
		return { ...rest, kind: 'actor', v: 3 };
	}
	/** @type {Record<string, Part[]>} */
	let parts;
	const held = m.tiers ?? {};
	if (m.v === 2) parts = Object.fromEntries(TIERS.filter((t) => Array.isArray(held[t])).map((t) => [t, held[t]]));
	else if (Array.isArray(m.parts)) parts = { [m.priority === 'low' ? 'later' : 'now']: m.parts.flatMap(v1Part) };
	else return m;
	const loads = Object.fromEntries(Object.entries(parts).map(([t, ps]) => [t, ps.map(v2Part)]));
	return {
		kind: 'actor', v: 3, id: m.id, title: m.title, note: m.note ?? '', routes: m.routes ?? [], slots: m.slots ?? [],
		interface: { version: 1, description: m.note ?? '', methods: [], events: [], needs: [] }, code: [], loads
	};
}

/** The actor part `p` holds, by its v3 name or its v2 one. @param {Part} p */
const heldBy = (p) => (typeof p?.actor === 'string' ? p.actor : typeof p?.manifest === 'string' ? p.manifest : undefined);

/**
 * QUERY ENTRIES (task C1 of the one query engine): what an actor's part wants is a named query, an entry of its own
 * (`kind: 'query'`, schema "Query, v1") that any peer reads and calls by its address, never by a bare name
 * (avendb::address: `{vault, entry, version}`, a natural id resolving as `get` resolves it). It is an actor too: its
 * interface has one method, `read`, whose params are the query's own and whose op template is the local query that
 * reads it (`run`, `{ "$": param }` where an arg goes); `where` is its selector (labels alone, A1's grammar), `window`
 * the newest `limit` of them, `order` by creation, `follow` the levels of what its records name. A part names a query
 * with `bind`, each param bound to a slot (`$room`) or an entry, and keeps what is the actor's own: the tier, which
 * part of the entries (`headers`, `files`), which files, the signal that orders it, the vault it reads.
 * `compile` gives back the want the part stood for, so a route's Interests are the same either way (the golden test).
 */

/** The kind and entry type of a query entry, and its schema's title. */
export const QUERY_KIND = 'query';
export const QUERY_TYPE = 'query';
export const QUERY_SCHEMA = 'Query, v1';

/** The schema of a query, v1: an actor (interface) with its selector, window, order and follow. */
export const QUERY_V1 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: QUERY_SCHEMA,
	type: 'object',
	properties: {
		kind: { const: QUERY_KIND },
		v: { const: 1 },
		id: { type: 'string', maxLength: 64, pattern: ID },
		title: { type: 'string', maxLength: 160 },
		note: { type: 'string', maxLength: 2000, default: '' },
		interface: INTERFACE,
		where: { type: 'object' },
		window: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 512 } } },
		order: { type: 'array', prefixItems: [{ const: 'created' }, { enum: ['asc', 'desc'] }], minItems: 2, maxItems: 2 },
		follow: { type: 'integer', minimum: 0, maximum: 3, default: 0 }
	},
	required: ['kind', 'v', 'id', 'title', 'interface', 'where']
});

/** One test or the conjunction of several, as `where` reads them. @param {any[]} atoms */
const conj = (atoms) => (atoms.length === 1 ? atoms[0] : { all: atoms });
/** The tests of a `where`: one, or those of its `all`. @param {any} w @returns {any[]} */
const atomsOf = (w) => (Array.isArray(w?.all) ? w.all : w && typeof w === 'object' ? [w] : []);

/**
 * The query entry an inline part's want stands for, and the part naming it in its place: `{ query, part }`. Its
 * entry slot (`$room`) becomes the param of that name, bound back to the slot. The query's id names what it picks
 * (`query-room` the rooms, `query-one-room-newest-50` the bound room's newest 50); `ids` (id to the query's own JSON) makes one id one query, a second meaning gets a suffix.
 * @param {Part} p @param {Map<string, string>} [ids] @returns {{ query: Actor, part: Part } | null}
 */
export function asQuery(p, ids = new Map()) {
	const want = p?.want;
	if (!want || typeof want !== 'object') return null;
	const slot = typeof want.entry === 'string' ? SLOT.exec(want.entry) : null;
	const params = slot ? [slot[1]] : [];
	/** the selector, `{ "$": param }` where an arg goes @type {any[]} */
	const atoms = [
		...(want.type?.length ? [{ type: want.type }] : []),
		...(want.tags ?? []).map((tag) => ({ tag })),
		...(want.entry ? [{ entry: [slot ? { $: slot[1] } : want.entry] }] : [])
	];
	if (!atoms.length) return null;
	const where = conj(atoms);
	const footprint = atoms.filter((a) => !a.entry);
	const window = p.window?.newest ? { limit: p.window.newest } : undefined;
	const order = p.window?.newest ? ['created', 'desc'] : p.window?.oldest ? ['created', 'asc'] : undefined;
	const follow = p.follow || undefined;
	const named = [
		...(want.type ?? []), ...(want.tags ?? []).map((t) => `tag-${t}`), ...(slot ? [`one-${slot[1]}`] : want.entry ? ['one-entry'] : []),
		...(window ? [`newest-${window.limit}`] : order ? ['oldest'] : []), ...(follow ? [`follow-${follow}`] : [])
	].join('-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52);
	const body = { where, ...(window ? { window } : {}), ...(order ? { order } : {}), ...(follow ? { follow } : {}) };
	const key = JSON.stringify(body);
	// `query-` keeps a query's natural id clear of every other entry's of the vault, which `get` resolves alike
	let id = `query-${named || 'entries'}`;
	for (let n = 2; ids.has(id) && ids.get(id) !== key; n++) id = `query-${named}-${n}`;
	ids.set(id, key);
	const run = { op: 'query', where, select: [], order: [order ?? ['created', 'desc']], limit: window?.limit ?? 512 };
	const query = {
		kind: QUERY_KIND, v: 1, id, title: id, note: p.note ?? '',
		interface: { version: 1, description: `Reads ${named.replace(/-/g, ' ') || 'entries'}.`, events: [], needs: [], methods: [
			{ name: 'read', params, ops: [{ op: 'read' }], ...(footprint.length ? { where: conj(footprint) } : {}), run }
		] },
		...body
	};
	const { want: _w, window: _n, follow: _f, ...own } = p;
	const part = { query: { entry: id, version: 1 }, ...(slot ? { bind: { [slot[1]]: String(want.entry) } } : {}), ...(want.vault ? { vault: want.vault } : {}), ...own };
	return { query, part };
}

/**
 * The inline part a part naming a query stands for, from the query entries `queries` (by id): its want from the
 * query's selector with its params bound by `bind`, its window and follow from the query's, the rest the part's own.
 * Null where no query of that id and version is held, or it reads by something a want can't say.
 * @param {Part} p @param {Map<string, Actor>} queries @returns {Part | null}
 */
export function compile(p, queries) {
	const q = p?.query ? queries.get(p.query.entry) : undefined;
	if (!q || q.v !== 1 || q.interface?.version !== p.query?.version) return null;
	/** @type {Want} */
	const want = {};
	for (const a of atomsOf(q.where)) {
		if (Array.isArray(a.type)) want.type = [...(want.type ?? []), ...a.type];
		else if (typeof a.tag === 'string') want.tags = [...(want.tags ?? []), a.tag];
		else if (Array.isArray(a.entry) && a.entry.length === 1 && !want.entry) {
			const e = a.entry[0];
			const bound = typeof e?.$ === 'string' ? p.bind?.[e.$] : e;
			if (typeof bound !== 'string') return null;
			want.entry = bound;
		} else return null;
	}
	if (p.vault) want.vault = p.vault;
	const { query: _q, bind: _b, vault: _v, ...own } = p;
	const window = q.window?.limit ? { newest: q.window.limit } : q.order?.[1] === 'asc' ? { oldest: /** @type {true} */ (true) } : undefined;
	return { want, ...(window ? { window } : {}), ...(q.follow ? { follow: q.follow } : {}), ...own };
}

/**
 * Actors `actors` with each inline want named as a query entry: `{ actors, queries }`, the queries one per meaning,
 * in the order first named. What the repo declares inline, as the vault holds it.
 * @param {Actor[]} actors @returns {{ actors: Actor[], queries: Actor[] }}
 */
export function withQueries(actors) {
	const ids = new Map();
	/** @type {Map<string, Actor>} */
	const queries = new Map();
	const named = actors.map((a) => ({
		...a,
		loads: Object.fromEntries(Object.entries(a.loads ?? {}).map(([t, ps]) => [t, ps.map((p) => {
			const q = asQuery(p, ids);
			if (!q) return p;
			if (!queries.has(q.query.id)) queries.set(q.query.id, q.query);
			return q.part;
		})]))
	}));
	return { actors: named, queries: [...queries.values()] };
}

/**
 * The op query `q` runs with args `args` (`{ room: <entry> }`): its `read` method's template with the args bound, as
 * avendb::address `bind` binds it and the engine's `call` runs it. `more` (offset, limit) narrows a page of it.
 * @param {Actor} q @param {Record<string, string>} [args] @param {{offset?: number, limit?: number}} [more]
 */
export function queryOp(q, args = {}, more = {}) {
	const read = q?.interface?.methods?.find((/** @type {any} */ m) => m.name === 'read');
	if (!read?.run) throw new Error(`query ${q?.id}: no read method`);
	const missing = (read.params ?? []).filter((/** @type {string} */ k) => typeof args[k] !== 'string');
	if (missing.length) throw new Error(`query ${q.id}: no ${missing.join(', ')}`);
	/** @param {any} v @returns {any} */
	const bind = (v) => (Array.isArray(v) ? v.map(bind) : v && typeof v === 'object' ? (typeof v.$ === 'string' && Object.keys(v).length === 1 ? args[v.$] : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bind(x)]))) : v);
	return { ...bind(read.run), ...(more.offset ? { offset: more.offset } : {}), ...(more.limit ? { limit: more.limit } : {}) };
}

/**
 * The Interests the actors `all` load for path `path`, slots bound by `env` (`{ room: <entry>, … }`), the query
 * entries among `all` naming what a part that names one wants: each actor whose routes cover the path, and each it holds, once however many hold it (a cycle ends where it comes
 * round), its parts at the lower of their own tier and the tier they are held at (Lean `flatten`). A part whose slot
 * is unbound is left out. In tier order, then in the order declared.
 * @param {Actor[]} all @param {string} path @param {Record<string, string | undefined>} [env] @returns {Leaf[]}
 */
export function leavesFor(all, path, env = {}) {
	const lifted = (all ?? []).map(lift).filter((m) => typeof m?.id === 'string');
	const byId = new Map(lifted.filter((m) => m.kind === 'actor').map((m) => [m.id, m]));
	const queries = new Map(lifted.filter((m) => m.kind === QUERY_KIND).map((m) => [m.id, m]));
	/** @type {Leaf[]} */
	const out = [];
	/** each actor walked, at the highest tier it was held at: a lower holding adds nothing */
	const seen = new Map();
	/** @param {Actor} m @param {string} cap */
	const walk = (m, cap) => {
		if ((seen.get(m.id) ?? TIERS.length) <= rank(cap)) return;
		seen.set(m.id, rank(cap));
		for (const tier of TIERS) {
			for (const p of Array.isArray(m.loads?.[tier]) ? m.loads[tier] : []) {
				const at = atMost(cap, tier);
				const by = heldBy(p);
				if (by !== undefined) {
					const held = byId.get(by);
					if (held) walk(held, at);
					continue;
				}
				// a named query: compiled to the want it stands for (`compile`), unknown or another version wants nothing
				const inline = p?.query ? compile(p, queries) : p;
				const want = resolve(inline?.want, env);
				if (want && inline) out.push({ tier: at, part: inline, want, actor: m.id });
			}
		}
	};
	for (const m of byId.values()) {
		if ((m.routes ?? []).some((r) => typeof r === 'string' && covers(r, path))) walk(m, 'now');
	}
	return out.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l.tier) - rank(b.l.tier) || a.i - b.i).map(({ l }) => l);
}

/** Want `want` with its slots bound by `env`, or null where one is unbound (Lean `Pick.resolve`). */
/** @param {Want | undefined} want @param {Record<string, string | undefined>} env @returns {Want | null} */
export function resolve(want, env) {
	if (!want || typeof want !== 'object') return null;
	const out = { ...want };
	const slot = typeof want.entry === 'string' ? SLOT.exec(want.entry) : null;
	if (slot) {
		const bound = env?.[slot[1]];
		if (typeof bound !== 'string' || !HEX.test(bound)) return null;
		out.entry = bound;
	} else if (want.entry !== undefined && !HEX.test(String(want.entry))) return null;
	if (want.vault === '$vault') {
		if (typeof env?.vault !== 'string' || !HEX.test(env.vault)) return null;
		out.vault = env.vault;
	}
	if (!out.entry && !out.type?.length && !out.tags?.length) return null;
	return out;
}

const REF = /(?:vault:[0-9a-f]{64}\/|shot:)([0-9a-f]{64})/g;

/**
 * The entries a record names: each `{ entry }` pin at any depth, and each `vault:<vault>/<entry>` ref in its text, JSON
 * held in a string (a timeline's clips) read too. What a part that `follow`s wants next.
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
			const o = /** @type {any} */ (v);
			if (typeof o.entry === 'string' && HEX.test(o.entry)) out.add(o.entry);
			for (const x of Object.values(o)) visit(x, depth + 1);
		}
	};
	visit(record, 0);
	return [...out];
}

/** The file roots a record names (`aven:<root>:…`). @param {any} record @returns {string[]} */
const rootsOf = (record) => [...JSON.stringify(record ?? {}).matchAll(/aven:([a-f0-9]{64}):/g)].map((m) => m[1]);

/** File entry `file` is one of `files` (tags, or media types ending in `/`), or any file where `files` names none. */
/** @param {any} file @param {string[] | undefined} files */
const fileFits = (file, files) =>
	!files?.length || files.some((f) => (f.endsWith('/') ? (file.files ?? []).some((/** @type {any} */ x) => String(x.media ?? '').startsWith(f)) : (file.tags ?? []).includes(f)));

/** The actors device `d` holds of vault `vault`, as stored (any version), and the query entries they name: verified
 *  local records, which it syncs from peers in the background. */
/** @param {ActorDevice | undefined} d @param {{vault?: string, signal?: AbortSignal}} [o] @returns {Promise<Actor[]>} */
export async function actorsOf(d, { vault = MAIA_CITY, signal } = {}) {
	signal?.throwIfAborted();
	if (!d) return [];
	try {
		const got = await d.run({ op: 'query', vault, where: { type: [ACTOR_TYPE, QUERY_TYPE] } });
		signal?.throwIfAborted();
		return (got?.ok?.rows ?? []).map((/** @type {any} */ r) => r.record).filter(Boolean);
	} catch {
		signal?.throwIfAborted();
		return [];
	}
}

/**
 * What leaves `leaves` want, as wants for the node (`{ tier, entries, queries }`), off what device `d` holds now: each
 * want's entries in its window, followed to what their records name, its files by the app's tags, ordered inside its
 * tier by its signal (`signals[by](entry)`, the distance to the viewport, playhead or camera). Type selectors go too,
 * so the node finds from peers what this device holds nothing of yet. `publish` gets the wants so far after each leaf,
 * so what is on screen goes out before the slower walks of the lower tiers.
 * @param {Leaf[]} leaves
 * @param {{ device?: ActorDevice, vault?: string, signals?: Record<string, (entry: string) => number>, signal?: AbortSignal, publish?: (wants: any[]) => unknown }} o
 */
export async function plan(leaves, { device: d, vault = MAIA_CITY, signals = {}, signal, publish = () => {} }) {
	/** @type {{entry: string, tier: string, dist: number}[]} */
	const works = [];
	/** @type {Map<string, {types: string[], vault?: string}[]>} */
	/** @type {Map<string, object[]>} */
	const queries = new Map(TIERS.map((t) => [t, []]));
	/** @type {{files?: any[]}} */
	const inventory = {};
	/** the bound entries, out before their leaves' walks reach them, after what the walks found (declared order kept) */
	/** @type {{entry: string, tier: string, dist: number}[]} */
	const early = [];
	const wants = () => {
		const ordered = schedule([...works, ...early]);
		return TIERS.map((tier) => ({ tier, entries: ordered.filter((w) => w.tier === tier).map((w) => w.entry), queries: queries.get(tier) ?? [] }))
			.filter((w) => w.entries.length || w.queries.length);
	};
	/** @param {Want} want */
	const where = (want) => (want.vault === '*' ? undefined : want.vault ?? vault);
	// Every leaf's selector and bound entry first, before any read of the device: they need none, and on a device whose
	// reads wait behind its catch-up the node finds the route's data from peers meanwhile (the rooms of Chat waited for
	// the kernel's read and their own so, tens of seconds on an iPhone).
	for (const { part, want, tier } of leaves) {
		const at = where(want);
		if (want.type?.length) queries.get(tier)?.push(...normalizeDiscovery([{ types: want.type, ...(at ? { vault: at } : {}) }]));
		if (want.entry && part.part !== 'files') early.push({ entry: want.entry, tier, dist: 0 });
	}
	if (leaves.length) publish(wants());
	for (const leaf of leaves) {
		signal?.throwIfAborted();
		const { part, want, tier } = leaf;
		const at = where(want);
		let ids = want.entry ? [want.entry] : d ? await rowsOf(d, want, at, part.window, signal) : [];
		if (part.window?.oldest) ids = [...ids].reverse();
		if (d && (part.follow || part.files?.length || part.part === 'files')) {
			const named = await follow(d, ids, Math.min(3, part.follow ?? 0), signal);
			const own = part.part === 'files' ? [] : [...ids, ...named];
			// a list's covers come right after its rows, in the same tier
			const files = part.part === 'files' || part.files?.length ? await filesOf(d, [...ids, ...named], part.files, inventory, signal) : [];
			ids = [...own, ...files];
		}
		const by = part.by ? signals[part.by] : undefined;
		for (const entry of ids) works.push({ entry, tier, dist: by ? distance(by, entry) : 0 });
		publish(wants());
	}
	return wants();
}

/** @param {(entry: string) => number} by @param {string} entry */
const distance = (by, entry) => {
	try {
		const d = by(entry);
		return Number.isFinite(d) ? Math.max(0, d) : Number.MAX_SAFE_INTEGER;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
};

/** The entries device `d` holds that want `want` asks for, of vault `vault` (any where none), newest first, in `window`. */
/** @param {ActorDevice} d @param {Want} want @param {string | undefined} vault @param {Part['window']} window @param {AbortSignal | undefined} signal */
async function rowsOf(d, want, vault, window, signal) {
	const terms = [...(want.type?.length ? [{ type: want.type }] : []), ...(want.tags ?? []).map((tag) => ({ tag }))];
	const where = terms.length === 1 ? terms[0] : { all: terms };
	try {
		const got = await d.run({ op: 'query', ...(vault ? { vault } : {}), where, select: [], order: [['created', 'desc']], limit: window?.newest ?? 512 });
		signal?.throwIfAborted();
		return [...new Set((got?.ok?.rows ?? []).map((/** @type {any} */ r) => r?.entry).filter((/** @type {any} */ e) => HEX.test(String(e))))];
	} catch {
		signal?.throwIfAborted();
		// nothing held yet: the node's selectors find it from peers, and the view's next revision walks again
		return [];
	}
}

/** What the records of entries `ids` name, `depth` levels deep, as device `d` holds them now. */
/** @param {ActorDevice} d @param {string[]} ids @param {number} depth @param {AbortSignal | undefined} signal */
async function follow(d, ids, depth, signal) {
	const seen = new Set(ids);
	const out = [];
	let frontier = ids;
	for (let level = 0; level < depth && frontier.length; level++) {
		const next = [];
		for (const entry of frontier) {
			for (const e of namedBy(await recordOf(d, entry, signal))) {
				if (seen.has(e)) continue;
				seen.add(e);
				next.push(e);
			}
		}
		out.push(...next);
		frontier = next;
	}
	return out;
}

/** @param {ActorDevice} d @param {string} entry @param {AbortSignal | undefined} signal */
async function recordOf(d, entry, signal) {
	try {
		const got = await d.run({ op: 'get', entry });
		signal?.throwIfAborted();
		return got?.ok?.record;
	} catch {
		signal?.throwIfAborted();
		return undefined;
	}
}

/**
 * The file entries the records of `ids` name by their roots, and of `ids` those that are files, that are `files`
 * (the app's tags: media:still, media:proxy, media:original; or a media type such as `audio/`). One local file
 * inventory a walk.
 * @param {ActorDevice} d @param {string[]} ids @param {string[] | undefined} files @param {{files?: any[]}} inventory @param {AbortSignal | undefined} signal
 */
async function filesOf(d, ids, files, inventory, signal) {
	const roots = new Set();
	for (const entry of ids) for (const r of rootsOf(await recordOf(d, entry, signal))) roots.add(r);
	if (!inventory.files) {
		try {
			inventory.files = await localFileEntries(/** @type {any} */ (d), { signal });
		} catch {
			signal?.throwIfAborted();
			inventory.files = [];
		}
	}
	const asked = new Set(ids);
	return inventory.files
		.filter((f) => !f.deleted && (asked.has(f.entry) || (f.files ?? []).some((/** @type {any} */ x) => roots.has(x.root))) && fileFits(f, files))
		.map((f) => f.entry);
}
