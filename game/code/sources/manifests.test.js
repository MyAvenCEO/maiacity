// @ts-nocheck — plain JS
// Manifests v2 (./manifests.js): trees of Interests in tiers, walked once per page, slots bound by the route or the
// selection; and the repo's declarations (src/lib/avendb/manifests.js) against the schema.
import { expect, test } from 'bun:test';
import { MANIFEST_V2, covers, leavesFor, lift, namedBy, plan, resolve } from './manifests.js';
import { MANIFESTS, CHAT, STUDIO, ASSETS } from '../../../src/lib/avendb/manifests.js';
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
	expect(lift(v1)).toEqual({ kind: 'manifest', v: 2, id: 'old', title: undefined, routes: ['/old/'], tiers: { later: [
		{ manifest: 'kernel' }, { want: { type: ['cut'] }, window: { newest: 8 }, follow: 2 }, { want: { entry: id(3) } }] } });
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
	const published = [];
	const wants = await plan(leaves, { device: d, vault: id(100), signals: { playhead: () => 4 }, publish: (w) => published.push(w) });
	expect(wants).toEqual([
		{ tier: 'now', entries: [id(10), id(11), room], queries: [{ types: ['room'], vault: id(100) }] },
		{ tier: 'next', entries: [cut, shot], queries: [] },
		{ tier: 'later', entries: [id(20), id(21)], queries: [] }
	]);
	// what is on screen went out before the slower walks of the lower tiers
	expect(published[0]).toEqual([{ tier: 'now', entries: [id(10), id(11)], queries: [{ types: ['room'], vault: id(100) }] }]);
	expect(published.length).toBe(leaves.length);
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

test('every manifest the repo declares fits the v2 schema, and the three examples hold their tiers', () => {
	const schema = JSON.parse(MANIFEST_V2);
	const part = schema.properties.tiers.properties.now.items;
	const known = new Set(Object.keys(part.properties));
	const ids = new Set(MANIFESTS.map((x) => x.id));
	expect(ids.size).toBe(MANIFESTS.length);
	for (const x of MANIFESTS) {
		for (const k of schema.required) expect(x[k]).toBeDefined();
		expect(x.id).toMatch(new RegExp(schema.properties.id.pattern));
		expect(Object.keys(x.tiers).every((t) => ['now', 'next', 'later', 'idle'].includes(t))).toBe(true);
		for (const parts of Object.values(x.tiers)) for (const p of parts) {
			expect(Object.keys(p).every((k) => known.has(k))).toBe(true);
			if (p.manifest) expect(ids.has(p.manifest)).toBe(true);
			if (p.want?.entry?.startsWith('$')) expect(x.slots).toContain(p.want.entry.slice(1));
		}
	}
	// chat: my rooms now, the open room's messages on open, older history idle
	const chatLeaves = leavesFor(MANIFESTS, '/app/chat/', { room: id(1) });
	expect(chatLeaves.filter((l) => l.want.entry === id(1)).map((l) => l.tier)).toEqual(['now', 'later', 'later', 'idle']);
	expect(rank(chatLeaves.find((l) => l.want.type?.includes('room')).tier)).toBe(0);
	// studio: stills and sound of the open timeline now, proxies next, originals only once one is opened
	const studio = leavesFor(MANIFESTS, '/app/studio/', { timeline: id(2) });
	expect(studio.filter((l) => l.part.files?.includes('media:proxy')).map((l) => l.tier)).toEqual(['next']);
	expect(studio.some((l) => l.part.files?.includes('media:original'))).toBe(false);
	expect(leavesFor(MANIFESTS, '/app/studio/', { timeline: id(2), original: id(3) }).find((l) => l.want.entry === id(3)).tier).toBe('later');
	// assets: the list now, the selected one now on select, the neighbours next
	const assets = leavesFor(MANIFESTS, '/app/buildings/', { asset: id(4) });
	expect(assets.filter((l) => l.want.entry === id(4)).map((l) => l.tier)).toEqual(['now', 'later']);
	expect(assets.find((l) => l.part.by === 'list').tier).toBe('next');
	// Sandbox 4: what the camera sees, nearest first
	expect(leavesFor(MANIFESTS, '/app/games/sandbox-4/').some((l) => l.part.by === 'camera' && l.tier === 'now')).toBe(true);
	expect([CHAT, STUDIO, ASSETS].every((x) => x.v === 2)).toBe(true);
});
