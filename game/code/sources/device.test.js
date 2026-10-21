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
