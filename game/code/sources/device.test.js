// @ts-nocheck — plain JS
// A page's learned manifest (./device.js `learn`, `learned`, Samuel 2026-10-21: a device syncs first what its pages
// need): the entries a page read are kept per page on this browser, and a device opened on the page brings them first.
import { afterEach, expect, test } from 'bun:test';
import { AT_ONCE, bringEntries, learn, learned, useDevice } from './device.js';

const id = (i) => i.toString(16).padStart(64, '0');
const store = () => {
	const m = new Map();
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
};

afterEach(() => {
	useDevice(null);
	delete globalThis.localStorage;
});

test('a page keeps the entries it read, newest first, and a device opened on it brings them before anything else', async () => {
	globalThis.localStorage = store();
	learn([id(1), id(2)], '/app/worlds/room/');
	learn([id(3), id(1), 'not an id'], '/app/worlds/room/');
	expect(learned('/app/worlds/room/')).toEqual([id(3), id(1), id(2)]);
	expect(learned('/universe/')).toEqual([]);
	// what a page brings is learned too
	const asked = [];
	const d = { run: async (op) => (asked.push(op), op.op === 'query' ? { ok: { rows: [] } } : { ok: { new: 1, peers: 1, reached: true } }), read: async () => new Uint8Array() };
	await bringEntries([id(9)], d);
	expect(learned('')).toEqual([]);
	// a device opened on a page that read before brings those first, AT_ONCE at most
	globalThis.location = { pathname: '/app/worlds/room/' };
	const fetched = globalThis.fetch;
	globalThis.fetch = async () => new Response('{"entries":[]}');
	try {
		learn(Array.from({ length: AT_ONCE + 5 }, (_, i) => id(100 + i)));
		asked.length = 0;
		useDevice(d);
		await new Promise((r) => setTimeout(r, 10));
		const brings = asked.filter((o) => o.op === 'bring');
		expect(brings.length).toBe(1);
		expect(brings[0].entries.length).toBe(AT_ONCE);
	} finally {
		delete globalThis.location;
		globalThis.fetch = fetched;
	}
});

test('a browser that keeps nothing learns nothing, and the page reads on', async () => {
	globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
	learn([id(1)], '/x/');
	expect(learned('/x/')).toEqual([]);
});

test('cancelled demand preserves issued work but never starts another batch', async () => {
	const controller = new AbortController();
	const calls = [];
	const d = { run: async (op) => { calls.push(op); controller.abort(); return { ok: { new: 1, peers: 1, reached: true } }; } };
	const ids = Array.from({ length: AT_ONCE + 2 }, (_, i) => id(1000 - i));
	expect(await bringEntries(ids, d, { signal: controller.signal, path: '/old/' })).toBeNull();
	expect(calls.map((o) => o.entries)).toEqual([ids.slice(0, AT_ONCE)]);
});

test('navigation supersedes a slow manifest read without bringing its entries or mislearning them', async () => {
	globalThis.localStorage = store();
	globalThis.location = { pathname: '/old/' };
	const { useView } = await import('./device.js');
	let release;
	const pending = new Promise((resolve) => { release = resolve; });
	const calls = [];
	let queries = 0;
	const manifests = [
		{ kind: 'manifest', id: 'old', routes: ['/old/'], parts: [{ entry: id(1) }] },
		{ kind: 'manifest', id: 'new', routes: ['/new/'], parts: [{ entry: id(2) }] }
	];
	const result = { ok: { rows: manifests.map((record) => ({ record })) } };
	const d = { run: async (op) => {
		calls.push(op);
		if (op.op === 'query') return ++queries === 1 ? pending : result;
		return { ok: { new: 1, peers: 1, reached: true } };
	} };
	try {
		useDevice(d);
		const old = useView('/old/');
		await useView('/new/');
		release(result);
		await old;
		expect(calls.filter((o) => o.op === 'bring').map((o) => o.entries)).toEqual([[id(2)]]);
		expect(learned('/new/')).toEqual([id(2)]);
		expect(learned('/old/')).toEqual([]);
	} finally {
		delete globalThis.location;
	}
});

test('a capable node receives scoped priorities without an uncancellable legacy want', async () => {
	globalThis.location = { pathname: '/active/' };
	const { useView } = await import('./device.js');
	const calls = [];
	const d = { run: async (op) => {
		calls.push(op);
		if (op.op === 'query') return { ok: { rows: [{ record: { kind: 'manifest', id: 'active', routes: ['*'], parts: [{ entry: id(7) }] } }] } };
		if (op.op === 'demand') return { ok: { accepted: true, lease_ms: 90000 } };
		return { ok: { new: 1, peers: 1, reached: true } };
	} };
	try {
		useDevice(d);
		await useView('/active/');
		expect(calls.filter((op) => op.op === 'bring')).toEqual([{ op: 'bring', entries: [id(7)], prioritize: false }]);
		useDevice(null);
		await new Promise((r) => setTimeout(r, 1));
		const priorities = calls.filter((op) => op.op === 'demand');
		expect(priorities[0].entries).toEqual([id(7)]);
		expect(priorities.at(-1).entries).toEqual([]);
		expect(priorities.at(-1).scope).toBe(priorities[0].scope);
		expect(priorities.at(-1).revision).toBeGreaterThan(priorities[0].revision);
	} finally { delete globalThis.location; }
});

test('an older node gets the original bring shape after rejecting demand', async () => {
	globalThis.location = { pathname: '/legacy/' };
	const { useView } = await import('./device.js');
	const calls = [];
	const d = { run: async (op) => {
		calls.push(op);
		if (op.op === 'query') return { ok: { rows: [{ record: { kind: 'manifest', id: 'legacy', routes: ['*'], parts: [{ entry: id(8) }] } }] } };
		if (op.op === 'demand') return { refused: 'BadOp', why: 'unknown op' };
		return { ok: { new: 1, peers: 1, reached: true } };
	} };
	try {
		useDevice(d);
		await useView('/legacy/');
		expect(calls.filter((op) => op.op === 'bring')).toEqual([{ op: 'bring', entries: [id(8)] }]);
	} finally { delete globalThis.location; }
});


test('an empty local catalog does not wait for an unfinished background bring', async () => {
	const { deviceRows, bringRows } = await import('./device.js');
	let finish;
	const blocked = new Promise(resolve => { finish = resolve; });
	const d = { run: async op => op.op === 'code' ? { ok: [] } : op.op === 'bring' ? blocked : { ok: {} } };
	useDevice(d);
	const sync = bringRows([{ entry: id(91) }]);
	const result = await Promise.race([deviceRows(['recipe']), new Promise(resolve => setTimeout(() => resolve('blocked'), 100))]);
	finish({ ok: { new: 1 } });
	await sync;
	expect(result).toBeNull();
});
