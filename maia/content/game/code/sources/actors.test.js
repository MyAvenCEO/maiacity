// @ts-nocheck — plain JS
// Actors (./actors.js): what each app loads, trees of Interests in tiers, walked once per page, slots bound by the route
// or the selection; the repo's declarations (aven/db/page/actors.js) against the schema; and the golden gate of task
// M: every route compiles to the same Interests from the actors as from the manifests they evolved from.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { ACTOR_V3, MANIFEST_V2, QUERY_V1, actorLens, asQuery, compile, covers, leavesFor, lift, namedBy, plan, queryOp, resolve } from './actors.js';
import { ACTORS, CHAT, INLINE, QUERIES, STUDIO, ASSETS } from '../../../../../aven/db/page/actors.js';

/** what the app holds: its actors and the query entries they name */
const ALL = [...ACTORS, ...QUERIES];
import { rank } from './interest.js';

const id = (i) => i.toString(16).padStart(64, '0');
const m = (o) => ({ kind: 'manifest', v: 2, title: o.id, ...o });

const kernel = m({ id: 'kernel', routes: ['*'], tiers: { now: [{ want: { type: ['capgroup'] } }] } });
const chat = m({ id: 'chat', routes: ['/app/chat/'], tiers: {
	now: [{ manifest: 'kernel' }, { want: { type: ['room'] }, part: 'headers' }, { want: { entry: '$room' } }],
	idle: [{ want: { type: ['room'] } }]
} });
// a manifest held lower than its own tiers: its parts come no higher than where it is held
const extras = m({ id: 'extras', tiers: { now: [{ want: { type: ['story'] } }], later: [{ want: { type: ['post'] } }] } });
const page = m({ id: 'page', routes: ['/p/'], tiers: { now: [{ want: { type: ['game'] } }], next: [{ manifest: 'extras' }] } });
// a cycle comes round and ends
const loop = m({ id: 'loop', routes: ['/loop/*'], tiers: { now: [{ manifest: 'loop' }, { want: { entry: id(9) } }] } });

test('a route covers its own path, a path under it with *, and * every path', () => {
	expect(covers('/app/', '/app/')).toBe(true);
	expect(covers('/app/', '/app/x/')).toBe(false);
	expect(covers('/app/*', '/app/x/')).toBe(true);
	expect(covers('*', '/anything/')).toBe(true);
});

test('the walk holds the kernel, binds slots, and lists Interests by tier', () => {
	const leaves = leavesFor([kernel, chat], '/app/chat/', { room: id(5) });
	expect(leaves.map((l) => [l.tier, l.want])).toEqual([
		['now', { type: ['capgroup'] }],
		['now', { type: ['room'] }],
		['now', { entry: id(5) }],
		['idle', { type: ['room'] }]
	]);
	// unbound_slot_wants_nothing: no room open, no room wanted, never the whole vault
	expect(leavesFor([kernel, chat], '/app/chat/').map((l) => l.want.entry ?? 'q')).toEqual(['q', 'q', 'q']);
	expect(resolve({ entry: '$room' }, {})).toBeNull();
	expect(resolve({ entry: '$room' }, { room: 'not an id' })).toBeNull();
	expect(resolve({ type: ['room'], vault: '$vault' }, {})).toBeNull();
	expect(resolve({}, {})).toBeNull();
	// another page: the kernel alone
	expect(leavesFor([kernel, chat], '/universe/').length).toBe(1);
	expect(leavesFor([], '/app/')).toEqual([]);
	expect(leavesFor([kernel, loop], '/loop/a/').map((l) => l.want.entry ?? 'q')).toEqual(['q', id(9)]);
});

test('flatten_never_raises: a manifest held at next brings its now parts at next, its later parts at later', () => {
	const leaves = leavesFor([kernel, page, extras], '/p/');
	expect(leaves.map((l) => [l.tier, l.want.type?.[0]])).toEqual([
		['now', 'capgroup'], ['now', 'game'], ['next', 'story'], ['later', 'post']
	]);
});

test('a v1 manifest still reads: high and medium parts now, low later, limits as windows', () => {
	const v1 = { kind: 'manifest', id: 'old', routes: ['/old/'], priority: 'low', parts: [{ manifest: 'kernel' }, { query: { type: ['cut'] }, limit: 8, follow: 2 }, { entry: id(3) }] };
	expect(lift(v1)).toEqual({ kind: 'actor', v: 3, id: 'old', title: undefined, note: '', routes: ['/old/'], slots: [], interface: { version: 1, description: '', methods: [], events: [], needs: [] }, code: [], loads: { later: [
		{ actor: 'kernel' }, { want: { type: ['cut'] }, window: { newest: 8 }, follow: 2 }, { want: { entry: id(3) } }] } });
	// the kernel covers every page itself, so it stays now
	expect(leavesFor([kernel, v1], '/old/').map((l) => l.tier)).toEqual(['now', 'later', 'later']);
});

test('a record names the entries of its pins and its vault refs, in JSON held in a string too', () => {
	const rec = { world: { entry: id(5), at: ['h'] }, timeline: JSON.stringify({ clips: [{ src: `vault:${id(0)}/${id(6)}@h` }] }) };
	expect(namedBy(rec).sort()).toEqual([id(5), id(6)]);
	expect(namedBy({ entry: 'short' })).toEqual([]);
});

/** a device holding rows (by type), records (by entry) and files */
function device({ rows = {}, records = {}, files = [] } = {}) {
	const calls = [];
	return {
		calls,
		run: async (op) => {
			calls.push(op);
			if (op.op === 'query') {
				const types = op.where?.type ?? op.where?.all?.flatMap((t) => t.type ?? []) ?? [];
				const out = types.flatMap((t) => rows[t] ?? []);
				return { ok: { rows: out.slice(0, op.limit ?? 512) } };
			}
			if (op.op === 'get') return records[op.entry] ? { ok: { record: records[op.entry] } } : { refused: 'NoEntry' };
			if (op.op === 'world_summary') return { ok: { vaults: [{ id: id(100) }] } };
			if (op.op === 'entry_views') return { ok: { rows: files } };
			return { ok: {} };
		}
	};
}

test('plan: windows, follows, files by tag and signals, in tiers', async () => {
	const room = id(1), cut = id(2), shot = id(3);
	const root = 'a'.repeat(64), root2 = 'b'.repeat(64);
	const d = device({
		rows: { room: [{ entry: id(10) }, { entry: id(11) }, { entry: id(12) }], cut: [{ entry: cut }] },
		records: { [cut]: { shot: { entry: shot } }, [shot]: { clip: `aven:${root}:1:1:video/mp4`, sound: `aven:${root2}:1:1:audio/wav` } },
		files: [
			{ entry: id(20), tags: ['media:proxy'], files: [{ root, media: 'video/mp4' }] },
			{ entry: id(21), tags: ['media:original'], files: [{ root: root2, media: 'audio/wav' }] },
			{ entry: id(22), tags: ['media:proxy'], files: [{ root: 'c'.repeat(64) }] }
		]
	});
	const leaves = [
		{ tier: 'now', part: { window: { newest: 2 } }, want: { type: ['room'] } },
		{ tier: 'now', part: {}, want: { entry: room } },
		{ tier: 'next', part: { follow: 2 }, want: { entry: cut } },
		{ tier: 'later', part: { follow: 2, part: 'files', files: ['media:proxy'] }, want: { entry: cut } },
		{ tier: 'later', part: { follow: 2, part: 'files', files: ['audio/'], by: 'playhead' }, want: { entry: cut } }
	];
	const published = [], readsBefore = [];
	const wants = await plan(leaves, { device: d, vault: id(100), signals: { playhead: () => 4 }, publish: (w) => (published.push(w), readsBefore.push(d.calls.length)) });
	expect(wants).toEqual([
		{ tier: 'now', entries: [id(10), id(11), room], queries: [{ types: ['room'], vault: id(100) }] },
		{ tier: 'next', entries: [cut, shot], queries: [] },
		{ tier: 'later', entries: [id(20), id(21)], queries: [] }
	]);
	// every selector and bound entry went out first, before any read of the device: they need none
	expect(readsBefore[0]).toBe(0);
	expect(published[0]).toEqual([
		{ tier: 'now', entries: [room], queries: [{ types: ['room'], vault: id(100) }] },
		{ tier: 'next', entries: [cut], queries: [] }
	]);
	// then what is on screen, before the slower walks of the lower tiers
	expect(published[1][0]).toEqual({ tier: 'now', entries: [id(10), id(11), room], queries: [{ types: ['room'], vault: id(100) }] });
	expect(published.length).toBe(leaves.length + 1);
	// the window went to the local query, newest first
	expect(d.calls.find((c) => c.op === 'query')).toMatchObject({ order: [['created', 'desc']], limit: 2 });
});

test('plan: a signal orders inside a tier, nearest first; no device, the selectors alone', async () => {
	const d = device({ rows: { recipe: [{ entry: id(1) }, { entry: id(2) }, { entry: id(3) }] } });
	const far = { [id(1)]: 9, [id(2)]: 1, [id(3)]: 4 };
	const wants = await plan([{ tier: 'next', part: { by: 'list' }, want: { type: ['recipe'] } }], { device: d, signals: { list: (e) => far[e] } });
	expect(wants[0].entries).toEqual([id(2), id(3), id(1)]);
	const cold = await plan([{ tier: 'now', part: {}, want: { type: ['manifest'] } }], { vault: id(7) });
	expect(cold).toEqual([{ tier: 'now', entries: [], queries: [{ types: ['manifest'], vault: id(7) }] }]);
	const aborted = new AbortController();
	aborted.abort();
	await expect(plan([{ tier: 'now', part: {}, want: { type: ['x'] } }], { device: d, signal: aborted.signal })).rejects.toThrow();
});

test('every actor the repo declares fits the v3 schema, and the three examples hold their tiers', () => {
	const schema = JSON.parse(ACTOR_V3);
	const part = schema.properties.loads.properties.now.items;
	const known = new Set(Object.keys(part.properties));
	const ids = new Set(ACTORS.map((x) => x.id));
	expect(ids.size).toBe(ACTORS.length);
	for (const x of ACTORS) {
		for (const k of schema.required) expect(x[k]).toBeDefined();
		expect(Object.keys(x).every((k) => k in schema.properties)).toBe(true);
		expect(x).toMatchObject({ kind: 'actor', v: 3, interface: { version: 1, methods: [] }, code: [] });
		expect(x.id).toMatch(new RegExp(schema.properties.id.pattern));
		expect(Object.keys(x.loads).every((t) => ['now', 'next', 'later', 'idle'].includes(t))).toBe(true);
		for (const parts of Object.values(x.loads)) for (const p of parts) {
			expect(Object.keys(p).every((k) => known.has(k))).toBe(true);
			if (p.actor) expect(ids.has(p.actor)).toBe(true);
			if (p.want?.entry?.startsWith('$')) expect(x.slots).toContain(p.want.entry.slice(1));
			// pass 2: no want inline, each a query entry the app holds, its params bound to the actor's slots
			expect(p.want).toBeUndefined();
			if (p.query) {
				expect(QUERIES.some((q) => q.id === p.query.entry)).toBe(true);
				for (const b of Object.values(p.bind ?? {})) expect(x.slots).toContain(b.slice(1));
			}
		}
	}
	// every query entry fits its schema: its keys, an interface with one read method of its params
	const qs = JSON.parse(QUERY_V1);
	expect(new Set(QUERIES.map((q) => q.id)).size).toBe(QUERIES.length);
	for (const q of QUERIES) {
		for (const k of qs.required) expect(q[k]).toBeDefined();
		expect(Object.keys(q).every((k) => k in qs.properties)).toBe(true);
		expect(q.id).toMatch(new RegExp(qs.properties.id.pattern));
		expect(q.id.length).toBeLessThanOrEqual(64);
		expect(q.interface.methods.map((m) => m.name)).toEqual(['read']);
	}
	// chat: my rooms now, the open room's messages on open, older history idle
	const chatLeaves = leavesFor(ALL, '/app/chat/', { room: id(1) });
	expect(chatLeaves.filter((l) => l.want.entry === id(1)).map((l) => l.tier)).toEqual(['now', 'later', 'later', 'idle']);
	expect(rank(chatLeaves.find((l) => l.want.type?.includes('room')).tier)).toBe(0);
	// studio: stills and sound of the open timeline now, proxies next, originals only once one is opened
	const studio = leavesFor(ALL, '/app/studio/', { timeline: id(2) });
	expect(studio.filter((l) => l.part.files?.includes('media:proxy')).map((l) => l.tier)).toEqual(['next']);
	expect(studio.some((l) => l.part.files?.includes('media:original'))).toBe(false);
	expect(leavesFor(ALL, '/app/studio/', { timeline: id(2), original: id(3) }).find((l) => l.want.entry === id(3)).tier).toBe('later');
	// assets: the list now, the selected one and its own files (the model) now on select, the neighbours next
	const assets = leavesFor(ALL, '/app/buildings/', { asset: id(4) });
	expect(assets.filter((l) => l.want.entry === id(4)).map((l) => l.tier)).toEqual(['now', 'now', 'later']);
	expect(assets.some((l) => l.want.entry === id(4) && l.tier === 'now' && l.part.part === 'files')).toBe(true);
	// the app's #assets page is that view too
	expect(leavesFor(ALL, '/app/#assets', { asset: id(4) }).some((l) => l.part.part === 'files')).toBe(true);
	expect(assets.find((l) => l.part.by === 'list').tier).toBe('next');
	// Sandbox 4: what the camera sees, nearest first
	expect(leavesFor(ALL, '/app/games/sandbox-4/').some((l) => l.part.by === 'camera' && l.tier === 'now')).toBe(true);
	expect([CHAT, STUDIO, ASSETS].every((x) => x.v === 3)).toBe(true);
});

test('every page the app opens has an actor of its own, not the kernel alone', () => {
	// VaultApps.svelte's NAV, each opened at /app/#<page>, and the app's own pages beside it
	const pages = ['sparks', 'artifacts', 'todos', 'stories', 'docs', 'library', 'assets', 'worlds', 'models', 'code',
		'query', 'tables', 'schemas', 'lenses', 'flows', 'functions', 'history', 'jobs', 'performance', 'settings',
		'vaults', 'activity', 'postgres', 'chat'].map((p) => `/app/#${p}`);
	const own = ['/app/', '/app/chat/', '/app/studio/', '/app/aips/', '/app/coops/', '/app/factories/', '/app/ledger/',
		'/app/network/', '/app/postgres/', '/app/avendb/', '/app/maiacity-v2/proposals/', '/app/math/probe/', '/app/views/probe/',
		...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `/app/games/sandbox-${n}/`)];
	for (const path of [...pages, ...own]) {
		const mine = ACTORS.filter((m) => m.id !== 'kernel' && m.routes.some((r) => covers(r, path)));
		expect({ path, actors: mine.length }).toEqual({ path, actors: 1 });
	}
	// a vault's Models (speech models) is not the asset library at /app/models/
	expect(ACTORS.filter((m) => m.id !== 'kernel' && m.routes.some((r) => covers(r, '/app/#models'))).map((m) => m.id)).toEqual(['page-models']);
});

// The golden gate of task M (plan "avenDB one query engine", Migration pass 1): the manifests as Maia City's vault
// holds them ("Manifest, v2", the repo's declarations before the move, kept in ./actors.golden.json) and the actors
// they become compile to the same Interests on every route, with no slot bound and with every slot bound.
const GOLDEN = JSON.parse(await Bun.file(new URL('./actors.golden.json', import.meta.url)).text());

/** each route the declarations name, a route ending in `*` read at a path under it */
const routesOf = (all) => [...new Set(all.flatMap((m) => m.routes ?? []).map((r) => (r === '*' ? '/any/' : r.endsWith('*') ? `${r.slice(0, -1)}x/` : r)))];
/** a leaf as the node sees it: its tier, its want and its part, whichever name its part holds another by */
const seen = (l) => [l.tier, l.want, Object.fromEntries(Object.entries(l.part).filter(([k]) => k !== 'actor' && k !== 'manifest'))];

test('golden: every manifest lifts to the actor the repo declares of its id, field for field', () => {
	expect(GOLDEN.map((m) => m.id)).toEqual(INLINE.map((a) => a.id));
	expect(ACTORS.map((m) => m.id)).toEqual(INLINE.map((a) => a.id));
	for (const [i, m] of GOLDEN.entries()) expect(lift(m)).toEqual(INLINE[i]);
	// an actor lifts to itself
	for (const a of ACTORS) expect(lift(a)).toBe(a);
	// a moved one whose stored kind and version a lens edit kept reads as the actor it is
	expect(lift({ ...ACTORS[0], kind: 'manifest', v: 2, tiers: { now: [] } })).toEqual(ACTORS[0]);
});

test('golden: every route compiles to the same Interests from the actors and their queries as from the manifests', async () => {
	const routes = routesOf(GOLDEN);
	expect(routes.length).toBeGreaterThan(40);
	const slots = [...new Set(GOLDEN.flatMap((m) => m.slots ?? []))];
	const bound = Object.fromEntries([...slots, 'vault'].map((s, i) => [s, id(200 + i)]));
	for (const path of routes) {
		for (const env of [{}, bound]) {
			const before = leavesFor(GOLDEN, path, env), after = leavesFor(ALL, path, env);
			expect(leavesFor(INLINE, path, env).map(seen)).toEqual(before.map(seen));
			expect({ path, env, leaves: after.map(seen) }).toEqual({ path, env, leaves: before.map(seen) });
			expect(after.map((l) => l.actor)).toEqual(before.map((l) => l.actor));
			// what goes to the node: the selectors and bound entries a page asks by before any read
			expect({ path, wants: await plan(after, { vault: id(100) }) }).toEqual({ path, wants: await plan(before, { vault: id(100) }) });
		}
	}
	// and a vault holding a mix (some moved, some not) reads the same too
	const mixed = [...GOLDEN.map((m, i) => (i % 2 ? ACTORS[i] : m)), ...QUERIES];
	for (const path of routes) expect(leavesFor(mixed, path, bound).map(seen)).toEqual(leavesFor(GOLDEN, path, bound).map(seen));
});

test('the lens from v2 to v3 names both schemas and moves kind, v and tiers in one convert', () => {
	const lens = JSON.parse(actorLens(id(1), id(2)));
	expect(lens).toMatchObject({ lens: 'Manifest, v2 to Actor, v3', from: id(1), to: id(2) });
	// one convert: a write that sets loads stores kind actor and v 3 with them, a record v3 reads whole (a convert per
	// field stored loads beside kind manifest and v 2, which no schema reads: the Actors v3 AIP's NotAView, 2026-10-28)
	const EMPTY = { now: [], next: [], later: [], idle: [] };
	expect(lens.steps[0]).toEqual({ convert: { from: ['kind', 'v', 'tiers'], to: ['kind', 'v', 'loads'],
		forward: [[{ kind: 'manifest', v: 2 }, { kind: 'actor', v: 3, loads: EMPTY }]],
		backward: [[{ kind: 'actor', v: 3 }, { kind: 'manifest', v: 2, tiers: EMPTY }]] } });
	// each field v3 adds is added by the lens, and v2's schema is the one the vault holds
	const v3 = Object.keys(JSON.parse(ACTOR_V3).properties), v2 = Object.keys(JSON.parse(MANIFEST_V2).properties);
	const added = lens.steps.filter((s) => s.add).map((s) => s.add);
	expect(added).toEqual(['interface', 'code']);
	expect(v3.filter((f) => !v2.includes(f)).sort()).toEqual([...added, 'loads'].sort());
	expect(v2.filter((f) => !v3.includes(f))).toEqual(['tiers']);
	expect(JSON.parse(MANIFEST_V2).title).toBe('Manifest, v2');
});

test('the engine\'s fixture of the move (avendb tests/all/actor_move.rs) is these schemas, this lens and the assets actor', () => {
	const f = JSON.parse(readFileSync(new URL('../../../../../aven/db/crates/avendb/tests/data/actors-v3.json', import.meta.url), 'utf8'));
	expect(f.manifest_v2).toBe(MANIFEST_V2);
	expect(f.actor_v3).toBe(ACTOR_V3);
	const { from, to } = JSON.parse(f.lens);
	expect(f.lens).toBe(actorLens(from, to));
	expect(f.stored).toEqual(GOLDEN.find((m) => m.id === 'assets'));
	expect(f.actor).toEqual(ACTORS.find((a) => a.id === 'assets'));
});

test('a want as a query entry and back: its slot a param bound to the slot, the rest the part\'s own', () => {
	const p = { want: { entry: '$room' }, window: { newest: 50 }, note: 'newest' };
	const { query, part } = asQuery(p);
	expect(query).toMatchObject({ kind: 'query', v: 1, id: 'query-one-room-newest-50', where: { entry: [{ $: 'room' }] }, window: { limit: 50 }, order: ['created', 'desc'] });
	expect(query.interface.methods[0]).toMatchObject({ name: 'read', params: ['room'], ops: [{ op: 'read' }] });
	// a footprint of no labels is the whole vault: the method names none
	expect(query.interface.methods[0].where).toBeUndefined();
	expect(part).toEqual({ query: { entry: 'query-one-room-newest-50', version: 1 }, bind: { room: '$room' }, note: 'newest' });
	const queries = new Map([[query.id, query]]);
	expect(compile(part, queries)).toEqual(p);
	// another version, or no such query: nothing
	expect(compile({ ...part, query: { entry: query.id, version: 2 } }, queries)).toBeNull();
	expect(compile({ ...part, query: { entry: 'none', version: 1 } }, queries)).toBeNull();
	// one id one meaning: the same want reuses it, another meaning of that name gets a suffix
	const ids = new Map();
	expect(asQuery({ want: { type: ['room'], vault: '*' }, part: 'headers' }, ids).query.id).toBe('query-room');
	expect(asQuery({ want: { type: ['room'] } }, ids).part).toEqual({ query: { entry: 'query-room', version: 1 } });
	// the read op, args bound: the same local query the walk runs
	expect(queryOp(query, { room: id(4) })).toEqual({ op: 'query', where: { entry: [id(4)] }, select: [], window: 50 });
	expect(() => queryOp(query, {})).toThrow(/no room/);
	const rooms = QUERIES.find((q) => q.id === 'query-room');
	expect(queryOp(rooms, {}, { offset: 50, limit: 50 })).toEqual({ op: 'query', where: { type: ['room'] }, select: [], order: [['created', 'desc']], limit: 50, offset: 50 });
});

test('the rooms page query: the newest window first, each older page after the answer\'s own next', () => {
	const rooms = QUERIES.find((q) => q.id === 'query-rooms-page');
	expect(queryOp(rooms, { vault: id(1), newest: 50, before: null })).toEqual({ op: 'query', vault: id(1), where: { type: ['room'] }, select: [], window: { newest: 50 } });
	expect(queryOp(rooms, { vault: null, newest: 50, before: `7.${id(4)}` })).toEqual({ op: 'query', where: { type: ['room'] }, select: [], window: { newest: 50, before: `7.${id(4)}` } });
	expect(() => queryOp(rooms, { vault: null, newest: 50 })).toThrow(/no before/);
});

test('the posts query: a page of published posts, `after` left out on the first page', () => {
	const posts = QUERIES.find((q) => q.id === 'query-posts');
	expect(queryOp(posts, { limit: 20, after: null })).toEqual({ op: 'posts', limit: 20 });
	expect(queryOp(posts, { limit: 20, after: 'p1' })).toEqual({ op: 'posts', limit: 20, after: 'p1' });
	expect(() => queryOp(posts, { limit: 20 })).toThrow(/no after/);
	// its footprint keeps to the published tag, which a Public share's cap holds
	expect(posts.interface.methods[0].where).toEqual({ all: [{ type: ['post'] }, { tag: 'content:published' }] });
	// no actor loads it: the stream reads it a page at a time
	expect(ACTORS.some((a) => Object.values(a.loads).flat().some((p) => p.query?.entry === 'query-posts'))).toBe(false);
});
