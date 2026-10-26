// @ts-nocheck — plain JS
// The page's view (./device.js): one Interest a mounted page, set from the manifests of its route, slots bound by the
// route and the selection, signals ordering a tier; no learned lists, no brings, no timers.
import { afterEach, expect, test } from 'bun:test';
import { bindView, deviceRows, refreshActiveView, signalView, useDevice, useView, wantNow } from './device.js';
import { MAIA_CITY } from './anchor.js';

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
