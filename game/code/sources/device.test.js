// @ts-nocheck — plain JS
// The page's view (./device.js): one Interest a mounted page, set from the actors of its route, slots bound by the
// route and the selection, signals ordering a tier; no learned lists, no brings, no timers.
import { afterEach, expect, test } from 'bun:test';
import { actorDiagnostics, actorSources, bindView, deviceRows, refreshActiveView, signalView, useBuiltInActors, useDevice, useQuery, useView, viewPath, wantNow } from './device.js';
import { MAIA_CITY } from './anchor.js';
import { ACTORS, QUERIES } from '../../../src/lib/avendb/actors.js';

const id = (i) => i.toString(16).padStart(64, '0');
const turn = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 5; i++) await turn(); };

const chat = { kind: 'manifest', v: 2, id: 'chat', title: 'Chat', routes: ['/app/chat/'], tiers: {
	now: [{ want: { type: ['room'] }, part: 'headers' }, { want: { entry: '$room' } }],
	idle: [{ want: { type: ['room'] } }]
} };

/** a device holding manifests `manifests` and rows by type; `held` answers a query of type t */
function device({ manifests = [chat], rows = {}, wait } = {}) {
	const calls = [];
	return {
		calls,
		interests: () => calls.filter((c) => c.op === 'interest'),
		run: async (op) => {
			calls.push(op);
			if (op.op === 'interest') return { ok: { accepted: true } };
			if (op.op === 'query' && op.where?.type?.[0] === 'manifest') {
				if (wait) await wait;
				return { ok: { rows: manifests.map((record) => ({ record })) } };
			}
			if (op.op === 'query') return { ok: { rows: (op.where?.type ?? []).flatMap((t) => rows[t] ?? []) } };
			if (op.op === 'code') return { ok: rows.code ?? [] };
			return { ok: {} };
		}
	};
}

afterEach(() => {
	useBuiltInActors([]);
	bindView('room', null);
	signalView('list', null);
	useDevice(null);
	delete globalThis.location;
});

test('a page sets its Interest at once, then its manifest tiers; no bring, no learned list', async () => {
	globalThis.location = { pathname: '/app/chat/' };
	const d = device({ rows: { room: [{ entry: id(1) }, { entry: id(2) }] } });
	useDevice(d);
	await useView('/app/chat/', { entries: [id(9)], bind: {} });
	await settle();
	const all = d.interests();
	// before any manifest is held: the route's manifests are found from peers
	expect(all[0].wants).toEqual([{ tier: 'now', entries: [], queries: [{ types: ['manifest'], vault: MAIA_CITY }] }]);
	expect(new Set(all.map((c) => c.scope)).size).toBe(1);
	expect(all.at(-1).wants).toEqual([
		{ tier: 'now', entries: [id(9), id(1), id(2)], queries: [{ types: ['manifest'], vault: MAIA_CITY }, { types: ['room'], vault: MAIA_CITY }] }
	]);
	expect(d.calls.some((c) => c.op === 'bring' || c.op === 'demand')).toBe(false);
	expect(globalThis.localStorage).toBeUndefined();
});

test('a selection binds the slot: the open room comes now, in the same scope', async () => {
	globalThis.location = { pathname: '/app/chat/' };
	const d = device();
	useDevice(d);
	await useView('/app/chat/', {});
	await settle();
	const scope = d.interests()[0].scope;
	bindView('room', id(5));
	await settle();
	const last = d.interests().at(-1);
	expect(last.scope).toBe(scope);
	expect(last.wants[0].entries).toContain(id(5));
	bindView('room', null);
	await settle();
	expect(d.interests().at(-1).wants.flatMap((w) => w.entries)).not.toContain(id(5));
});

test('navigation clears the old scope, and a slow walk of the old page publishes nothing more', async () => {
	globalThis.location = { pathname: '/old/' };
	let release;
	const wait = new Promise((r) => (release = r));
	const d = device({ wait, manifests: [{ ...chat, routes: ['/old/', '/new/'] }] });
	useDevice(d);
	const old = useView('/old/');
	await turn();
	const oldScope = d.interests()[0].scope;
	const fresh = useView('/new/');
	await turn();
	release();
	await old;
	await fresh;
	await settle();
	const ofOld = d.interests().filter((c) => c.scope === oldScope);
	expect(ofOld.at(-1).wants).toEqual([]);
	expect(d.interests().filter((c) => c.scope !== oldScope).length).toBeGreaterThan(0);
});

test('a burst of local revisions is one walk more, never a timer', async () => {
	globalThis.location = { pathname: '/app/chat/' };
	const d = device();
	useDevice(d);
	await useView('/app/chat/', {});
	await settle();
	const walks = () => d.calls.filter((c) => c.op === 'query' && c.where?.type?.[0] === 'manifest').length;
	const before = walks();
	for (let i = 0; i < 100; i++) refreshActiveView();
	await settle();
	expect(walks() - before).toBeLessThanOrEqual(2);
	expect(walks() - before).toBeGreaterThanOrEqual(1);
});

test('a read that found an entry missing puts it on screen now; a signal orders a tier', async () => {
	globalThis.location = { pathname: '/lib/' };
	const lib = { kind: 'manifest', v: 2, id: 'lib', title: 'Lib', routes: ['/lib/'], tiers: { next: [{ want: { type: ['recipe'] }, by: 'list' }] } };
	const d = device({ manifests: [lib], rows: { recipe: [{ entry: id(1) }, { entry: id(2) }, { entry: id(3) }] } });
	useDevice(d);
	await useView('/lib/', {});
	await settle();
	wantNow([id(7), 'bad']);
	await settle();
	expect(d.interests().at(-1).wants[0]).toMatchObject({ tier: 'now', entries: [id(7)] });
	const far = { [id(1)]: 5, [id(2)]: 0, [id(3)]: 2 };
	signalView('list', (e) => far[e]);
	await settle();
	expect(d.interests().at(-1).wants.find((w) => w.tier === 'next').entries).toEqual([id(2), id(3), id(1)]);
});

test('deviceRows reads what the device holds now, and brings nothing', async () => {
	const d = device({ rows: { code: [{ entry: id(1) }] } });
	useDevice(d);
	expect(await deviceRows(['recipe'])).toEqual([{ entry: id(1) }]);
	const empty = device();
	useDevice(empty);
	expect(await deviceRows(['recipe'])).toBeNull();
	expect(empty.calls.some((c) => c.op === 'bring')).toBe(false);
	useDevice(null);
	expect(await deviceRows(['recipe'])).toBeNull();
});

test('with no manifest of its route in the vault, the app\'s own says what comes now; the vault\'s wins', async () => {
	globalThis.location = { pathname: '/app/chat/' };
	useBuiltInActors([{ ...chat, tiers: { now: [{ want: { type: ['room'], vault: '*' }, part: 'headers' }] } }]);
	// a v1 chat manifest (Maia City's rooms alone) gives way to the app's
	const v1 = { kind: 'manifest', id: 'chat', title: 'Chat', routes: ['/app/chat/'], priority: 'medium', parts: [{ query: { type: ['room'] }, limit: 50 }] };
	// and so does one the v1-to-v2 lens reads with its tiers empty
	const lensed = { kind: 'manifest', v: 2, id: 'kernel', title: 'Kernel', routes: ['*'], tiers: { now: [], next: [], later: [], idle: [] } };
	const d = device({ manifests: [v1, lensed], rows: { room: [{ entry: id(3) }] } });
	useDevice(d);
	await useView('/app/chat/', {});
	await settle();
	const last = d.interests().at(-1).wants;
	expect(last[0].entries).toContain(id(3));
	expect(last[0].queries).toContainEqual({ types: ['room'] });
	expect(last[0].queries).not.toContainEqual({ types: ['room'], vault: MAIA_CITY });
	useDevice(null);
	// the vault holds a v2 chat manifest: only its parts go out
	const v = device({ manifests: [{ ...chat, tiers: { now: [{ want: { type: ['note'] } }] } }], rows: { room: [{ entry: id(3) }] } });
	useDevice(v);
	await useView('/app/chat/', {});
	await settle();
	const queries = v.interests().at(-1).wants.flatMap((w) => w.queries);
	expect(queries).toContainEqual({ types: ['note'], vault: MAIA_CITY });
	expect(queries.some((q) => q.types.includes('room'))).toBe(false);
	useDevice(null);
	// and so does a v3 actor the vault holds, once its AIP moved it
	const v3 = { kind: 'actor', v: 3, id: 'chat', title: 'Chat', routes: ['/app/chat/'], interface: {}, needs: [], code: [], loads: { now: [{ want: { type: ['todo'] } }] } };
	const w = device({ manifests: [v3], rows: { room: [{ entry: id(3) }] } });
	useDevice(w);
	await useView('/app/chat/', {});
	await settle();
	const moved = w.interests().at(-1).wants.flatMap((x) => x.queries);
	expect(moved).toContainEqual({ types: ['todo'], vault: MAIA_CITY });
	expect(moved.some((q) => q.types.includes('room'))).toBe(false);
});

test('a page the app opens by its hash is the view of that page, its manifest the one whose routes name it', () => {
	expect(viewPath({ pathname: '/app/', hash: '#chat' })).toBe('/app/#chat');
	expect(viewPath({ pathname: '/app/', hash: '#assets/908ceda0' })).toBe('/app/#assets');
	expect(viewPath({ pathname: '/app/', hash: '#performance/server' })).toBe('/app/#performance');
	expect(viewPath({ pathname: '/app/', hash: '' })).toBe('/app/');
	// a hash that names no page (an anchor, a token) leaves the path as it is
	expect(viewPath({ pathname: '/app/games/sandbox-5/', hash: '#Top_1' })).toBe('/app/games/sandbox-5/');
	expect(viewPath({ pathname: '/universe/', hash: '#' + 'x'.repeat(40) })).toBe('/universe/');
});

test("Chat's rooms are asked for before any read of a busy device answers, and the vault's manifests run once read", async () => {
	globalThis.location = { pathname: '/app/chat/' };
	useBuiltInActors([...ACTORS, ...QUERIES]);
	// a cold iPhone in its catch-up: every read waits behind the pages it applies
	let release;
	const wait = new Promise((r) => (release = r));
	const vaultChat = { ...ACTORS.find((m) => m.id === 'chat'), loads: { now: [{ actor: 'kernel' }, { want: { type: ['room'], vault: '*' }, part: 'headers' }, { want: { type: ['note'] } }] } };
	const d = device({ wait, manifests: [vaultChat], rows: { room: [{ entry: id(1) }] } });
	useDevice(d);
	const walked = useView('/app/chat/', {});
	await settle();
	// no read answered, and the node is told the rooms of every vault (the human's and the coop's) are on screen now
	const first = d.interests().at(-1).wants;
	expect(first[0].tier).toBe('now');
	expect(first[0].queries).toContainEqual({ types: ['room'] });
	expect(first[0].queries).toContainEqual({ types: ['capgroup', 'schema', 'lens'], vault: MAIA_CITY });
	expect(actorDiagnostics().running).toHaveLength(1);
	release();
	await walked;
	await settle();
	// the vault's v2 chat is what runs now, the kernel the app's own until the vault's is held
	const last = d.interests().at(-1).wants;
	expect(last.flatMap((w) => w.queries)).toContainEqual({ types: ['note'], vault: MAIA_CITY });
	expect(last[0].entries).toContain(id(1));
	const run = actorDiagnostics().runs.at(-1);
	expect(run).toMatchObject({ state: 'scheduled', matched: ['kernel', 'chat'], vaultManifests: 1, builtInManifests: 1 });
	expect(run.matchedLeaves).toBe(3);
});

test('each actor says whether it is the vault\'s or the app\'s own copy', () => {
	useBuiltInActors([...ACTORS, ...QUERIES]);
	const chat = { ...ACTORS.find((m) => m.id === 'chat') };
	const lensed = { kind: 'manifest', v: 2, id: 'kernel', title: 'Kernel', routes: ['*'], tiers: { now: [], next: [], later: [], idle: [] } };
	const sources = actorSources([chat, lensed], MAIA_CITY);
	expect(sources.get('chat')).toBe('vault');
	expect(sources.get('kernel')).toBe('built-in');
	expect(sources.get('studio')).toBe('built-in');
	// another vault's catalog holds no built-in copy
	expect([...actorSources([chat], id(5)).values()]).toEqual(['vault']);
});

test("the app's actors cover Chat by its route and its hash, the rooms of every vault now", () => {
	const { leavesFor } = require('./actors.js');
	for (const path of ['/app/chat/', '/app/#chat']) {
		const leaves = leavesFor([...ACTORS, ...QUERIES], path, {});
		expect([...new Set(leaves.map((l) => l.actor))].sort()).toEqual(['chat', 'kernel']);
		expect(leaves.find((l) => l.tier === 'now' && l.want.type?.includes('room'))?.want.vault).toBe('*');
	}
});

test("a page reads by a query entry's address: the vault's own of that id once a walk read it, else the app's", async () => {
	useBuiltInActors([...ACTORS, ...QUERIES]);
	const rooms = { entry: 'query-room', version: 1 };
	expect(useQuery(rooms, {}, { limit: 50 })).toEqual({ op: 'query', where: { type: ['room'] }, select: [], order: [['created', 'desc']], limit: 50 });
	expect(useQuery({ ...rooms, version: 2 })).toBeNull();
	expect(useQuery({ entry: 'query-none', version: 1 })).toBeNull();
	// the vault holds its own: the walk read it, and the page reads by it
	const own = { ...QUERIES.find((q) => q.id === 'query-room'), interface: { version: 1, methods: [{ name: 'read', params: [], ops: [{ op: 'read' }], run: { op: 'query', where: { type: ['room', 'note'] }, select: [] } }] } };
	globalThis.location = { pathname: '/app/chat/' };
	useDevice(device({ manifests: [own] }));
	await useView('/app/chat/', {});
	await settle();
	expect(useQuery(rooms).where).toEqual({ type: ['room', 'note'] });
});
