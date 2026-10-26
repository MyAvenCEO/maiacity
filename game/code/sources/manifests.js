import { localFileEntries } from './file-entries.js';
import { MAIA_CITY } from './anchor.js';
import { TIERS, atMost, normalizeDiscovery, rank, schedule } from './interest.js';
/**
 * MANIFESTS v2: WHAT A PAGE WANTS, IN TIERS (step P3 of sync v2; Lean avendb/spec/AvenDB/Interest.lean `Tree`). A
 * manifest is an entry of the Maia City vault, of type `manifest`, changed only by AIP like every vault entry. It is a
 * tree of Interests in four tiers: what the screen shows `now`, what the person will open `next`, the `later` rest of
 * the screen's data, and the `idle` rest the device keeps offline. A part is another manifest, held at the tier it
 * sits in (its parts never come above it: `flatten_never_raises`), or one Interest:
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
 * hardcoded per app: a page asks for its path, and the manifests that name it say what comes in which tier. A v1
 * manifest (`priority` + `parts`) still reads, its parts at `now` (high, medium) or `later` (low).
 */

/** The title of the Maia City vault's own schema of a manifest. */
export const MANIFEST_SCHEMA = 'Manifest, v2';

const ID = '^[a-z0-9][a-z0-9-]*$';
const HEX = /^[0-9a-f]{64}$/;
const SLOT = /^\$([a-z][a-z0-9-]*)$/;

const PART = {
	type: 'object',
	properties: {
		manifest: { type: 'string', maxLength: 64, pattern: ID },
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
};

/** The schema of a manifest, v2: its id, title, the routes it is for, the slots it reads, and its tiers. */
export const MANIFEST_V2 = JSON.stringify({
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: MANIFEST_SCHEMA,
	type: 'object',
	properties: {
		kind: { const: 'manifest' },
		v: { const: 2 },
		id: { type: 'string', maxLength: 64, pattern: ID },
		title: { type: 'string', maxLength: 160 },
		note: { type: 'string', maxLength: 2000, default: '' },
		routes: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 200 }, default: [] },
		slots: { type: 'array', maxItems: 8, items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }, default: [] },
		tiers: {
			type: 'object',
			properties: Object.fromEntries(TIERS.map((t) => [t, { type: 'array', maxItems: 64, items: PART, default: [] }]))
		}
	},
	required: ['kind', 'v', 'id', 'title', 'tiers']
});

/**
 * @typedef {{type?: string[], tags?: string[], entry?: string, vault?: string}} Want
 * @typedef {{manifest?: string, want?: Want, part?: string, files?: string[], window?: {newest?: number, oldest?: boolean}, follow?: number, by?: string}} Part
 * @typedef {{kind: string, id: string, v?: number, title?: string, note?: string, routes?: string[], slots?: string[], tiers?: Record<string, Part[]>, priority?: string, parts?: any[]}} Manifest
 * @typedef {{tier: string, part: Part, want: Want, manifest: string}} Leaf
 * @typedef {{run: (op: Record<string, unknown>) => Promise<any>}} ManifestDevice
 */

/** Route `route` covers path `path`: the same path, a path under a route ending in `*`, or any path for `*`. */
/** @param {string} route @param {string} path */
export const covers = (route, path) =>
	route === '*' || (route.endsWith('*') ? path.startsWith(route.slice(0, -1)) : route === path);

/** A v1 manifest read as v2: high and medium parts on screen now, low later. @param {Manifest} m @returns {Manifest} */
export function lift(m) {
	if (m?.v === 2 || !Array.isArray(m?.parts)) return m;
	const tier = m.priority === 'low' ? 'later' : 'now';
	/** @type {(p: any) => Part[]} */
	const one = (p) => {
		if (typeof p?.manifest === 'string') return [{ manifest: p.manifest }];
		if (p?.entry) return [{ want: { entry: p.entry }, ...(p.follow ? { follow: p.follow } : {}) }];
		if (p?.query) return [{ want: { ...(p.query.type ? { type: p.query.type } : {}), ...(p.query.tags ? { tags: p.query.tags } : {}) },
			...(p.limit ? { window: { newest: p.limit } } : {}), ...(p.follow ? { follow: p.follow } : {}) }];
		return [];
	};
	const parts = m.parts.flatMap(one);
	return { kind: 'manifest', v: 2, id: m.id, title: m.title, routes: m.routes ?? [], tiers: { [tier]: parts } };
}

/**
 * The Interests the manifests `all` declare for path `path`, slots bound by `env` (`{ room: <entry>, … }`): each
 * manifest whose routes cover the path, and each it holds, once however many hold it (a cycle ends where it comes
 * round), its parts at the lower of their own tier and the tier they are held at (Lean `flatten`). A part whose slot
 * is unbound is left out. In tier order, then in the order declared.
 * @param {Manifest[]} all @param {string} path @param {Record<string, string | undefined>} [env] @returns {Leaf[]}
 */
export function leavesFor(all, path, env = {}) {
	const byId = new Map((all ?? []).map(lift).filter((m) => m?.kind === 'manifest' && typeof m.id === 'string').map((m) => [m.id, m]));
	/** @type {Leaf[]} */
	const out = [];
	/** each manifest walked, at the highest tier it was held at: a lower holding adds nothing */
	const seen = new Map();
	/** @param {Manifest} m @param {string} cap */
	const walk = (m, cap) => {
		if ((seen.get(m.id) ?? TIERS.length) <= rank(cap)) return;
		seen.set(m.id, rank(cap));
		for (const tier of TIERS) {
			for (const p of Array.isArray(m.tiers?.[tier]) ? m.tiers[tier] : []) {
				const at = atMost(cap, tier);
				if (typeof p?.manifest === 'string') {
					const held = byId.get(p.manifest);
					if (held) walk(held, at);
					continue;
				}
				const want = resolve(p?.want, env);
				if (want) out.push({ tier: at, part: p, want, manifest: m.id });
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

/** The manifests device `d` holds of vault `vault`: verified local records, which it syncs from peers in the background. */
/** @param {ManifestDevice | undefined} d @param {{vault?: string, signal?: AbortSignal}} [o] @returns {Promise<Manifest[]>} */
export async function manifestsOf(d, { vault = MAIA_CITY, signal } = {}) {
	signal?.throwIfAborted();
	if (!d) return [];
	try {
		const got = await d.run({ op: 'query', vault, where: { type: ['manifest'] } });
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
 * @param {{ device?: ManifestDevice, vault?: string, signals?: Record<string, (entry: string) => number>, signal?: AbortSignal, publish?: (wants: any[]) => unknown }} o
 */
export async function plan(leaves, { device: d, vault = MAIA_CITY, signals = {}, signal, publish = () => {} }) {
	/** @type {{entry: string, tier: string, dist: number}[]} */
	const works = [];
	/** @type {Map<string, {types: string[], vault?: string}[]>} */
	/** @type {Map<string, object[]>} */
	const queries = new Map(TIERS.map((t) => [t, []]));
	/** @type {{files?: any[]}} */
	const inventory = {};
	const wants = () => {
		const ordered = schedule(works);
		return TIERS.map((tier) => ({ tier, entries: ordered.filter((w) => w.tier === tier).map((w) => w.entry), queries: queries.get(tier) ?? [] }))
			.filter((w) => w.entries.length || w.queries.length);
	};
	for (const leaf of leaves) {
		signal?.throwIfAborted();
		const { part, want, tier } = leaf;
		const at = want.vault === '*' ? undefined : want.vault ?? vault;
		if (want.type?.length) queries.get(tier)?.push(...normalizeDiscovery([{ types: want.type, ...(at ? { vault: at } : {}) }]));
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
/** @param {ManifestDevice} d @param {Want} want @param {string | undefined} vault @param {Part['window']} window @param {AbortSignal | undefined} signal */
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
/** @param {ManifestDevice} d @param {string[]} ids @param {number} depth @param {AbortSignal | undefined} signal */
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

/** @param {ManifestDevice} d @param {string} entry @param {AbortSignal | undefined} signal */
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
 * @param {ManifestDevice} d @param {string[]} ids @param {string[] | undefined} files @param {{files?: any[]}} inventory @param {AbortSignal | undefined} signal
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
