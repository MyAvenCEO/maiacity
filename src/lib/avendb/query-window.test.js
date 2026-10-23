// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { createReadWindow, queryEntries, replyEntries } from './query-window.js';
import { windowRead } from './ops.js';

const id = (n) => n.toString(16).padStart(64, '0');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const node = () => {
	const calls = [];
	return { calls, run: async (op) => { calls.push(op); return { ok: { accepted: true } }; } };
};

test('replacing a query aborts its old read, replaces its scope, and rejects late priorities', async () => {
	const d = node(), pending = [];
	const view = createReadWindow({ device: () => d, read: (_, op, signal) => {
		const next = { ...deferred(), op, signal }; pending.push(next); return next.promise;
	} });
	try {
		const first = view.read({ op: 'get', entry: id(1) });
		await flush();
		const firstScope = d.calls[0].scope;
		const second = view.read({ op: 'get', entry: id(2) });
		await flush();
		expect(pending[0].signal.aborted).toBe(true);
		expect(d.calls.map((c) => c.entries)).toEqual([[id(1)], [id(2)]]);
		expect(d.calls.every((c) => c.scope === firstScope)).toBe(true);
		expect(d.calls[1].revision).toBeGreaterThan(d.calls[0].revision);
		const reply = { ok: { rows: [{ entry: id(2) }] } };
		pending[1].resolve(reply);
		expect(await second).toEqual(reply);
		pending[0].resolve({ ok: { rows: [{ entry: id(3) }] } });
		expect(await first).toBeNull();
		await flush();
		expect(d.calls.some((c) => c.entries.includes(id(3)))).toBe(false);
		expect(d.calls.at(-1).entries).toEqual([id(2)]);
	} finally { view.close(); }
});

test('independent query windows keep their own lifetimes even for the same entry', async () => {
	const d = node();
	const make = () => createReadWindow({ device: () => d, read: async () => ({ ok: { entry: id(1) } }) });
	const a = make(), b = make();
	try {
		await Promise.all([a.read({ op: 'get', entry: id(1) }), b.read({ op: 'get', entry: id(1) })]);
		await flush();
		const scopes = [...new Set(d.calls.map((c) => c.scope))];
		expect(scopes.length).toBe(2);
		a.close(); await flush();
		expect(d.calls.filter((c) => c.scope === scopes[0]).at(-1).entries).toEqual([]);
		expect(d.calls.filter((c) => c.scope === scopes[1]).at(-1).entries).toEqual([id(1)]);
	} finally { a.close(); b.close(); }
});

test('a device change clears the old device scope and rejects its pending answer', async () => {
	const a = node(), b = node(), pending = deferred();
	let d = a, signal;
	const view = createReadWindow({ device: () => d, read: (_, __, s) => { signal = s; return pending.promise; } });
	try {
		const result = view.read({ op: 'get', entry: id(1) }); await flush();
		d = b; view.invalidate(); await flush();
		expect(signal.aborted).toBe(true);
		expect(a.calls.at(-1).entries).toEqual([]);
		pending.resolve({ ok: { entry: id(2) } });
		expect(await result).toBeNull(); await flush();
		expect(b.calls).toEqual([]);
	} finally { view.close(); }
});

test('a local answer never waits for scheduling metadata to reach the node', async () => {
	const send = deferred(), calls = [];
	const d = { run: (op) => { calls.push(op); return send.promise; } };
	const view = createReadWindow({ device: () => d, read: async () => ({ ok: { entry: id(1) } }) });
	try {
		expect(await view.read({ op: 'get', entry: id(1) })).toEqual({ ok: { entry: id(1) } });
		expect(calls.length).toBe(1);
	} finally { view.close(); send.resolve({ ok: { accepted: true } }); await flush(); }
});

test('unmount aborts the pending read, ignores its rejection, and prevents subsequent reads', async () => {
	const d = node(), pending = deferred(); let signal, reads = 0;
	const view = createReadWindow({ device: () => d, read: (_, __, s) => { reads++; signal = s; return pending.promise; } });
	const result = view.read({ op: 'get', entry: id(1) }); await flush();
	view.close(); view.close(); await flush();
	pending.reject(new Error('old device closed'));
	expect(await result).toBeNull();
	expect(signal.aborted).toBe(true);
	expect(d.calls.at(-1).entries).toEqual([]);
	expect(await view.read({ op: 'get', entry: id(2) })).toBeNull();
	expect(reads).toBe(1);
});

test('an active read failure releases its scope and can be retried', async () => {
	const d = node(); let fail = true;
	const view = createReadWindow({ device: () => d, read: async () => {
		await flush(); if (fail) throw new Error('read failed'); return { ok: {} };
	} });
	try {
		await expect(view.read({ op: 'get', entry: id(1) })).rejects.toThrow('read failed');
		await flush(); expect(d.calls.at(-1).entries).toEqual([]);
		fail = false;
		expect(await view.read({ op: 'get', entry: id(2) })).toEqual({ ok: {} });
	} finally { view.close(); }
});

test('explicit query IDs are prioritized even when the local result is empty', async () => {
	const d = node();
	const view = createReadWindow({ device: () => d, read: async () => ({ ok: { rows: [] } }) });
	try {
		await view.read({ op: 'query', where: { all: [{ type: ['note'] }, { any: [{ entry: [id(3), id(1)] }, { entry: [id(1), id(2)] }] }] } });
		await flush();
		expect(d.calls[0].entries).toEqual([id(3), id(1), id(2)]);
		expect(queryEntries({ where: { not: { entry: [id(4)] } } })).toEqual([]);
		expect(queryEntries({ where: { entry: Array.from({ length: 1000 }, (_, n) => id(n)) } }).length).toBe(512);
	} finally { view.close(); }
});

test('reply priorities contain only explicit valid row IDs, never arbitrary record strings', () => {
	expect(replyEntries({ ok: { entry: id(1), rows: [{ entry: id(2), record: { entry: id(3) } }, { entry: id(1) }, { entry: 'invalid' }], items: [{ entry: id(4) }] } })).toEqual([id(1), id(2), id(4)]);
	expect(replyEntries({ refused: 'NoEntry' })).toEqual([]);
});

test('effect-owned reads expose cleanup and retain older API compatibility', async () => {
	let closed = 0;
	const request = windowRead({ ask: () => { throw new Error('unscoped read'); }, window: () => ({ read: async () => ({ ok: 42 }), close: () => closed++ }) }, { op: 'query' }, null);
	expect(await request.result).toBe(42); request.close(); expect(closed).toBe(1);
	const legacy = windowRead({ ask: async () => ({ ok: 17 }) }, { op: 'query' }, null);
	expect(await legacy.result).toBe(17); legacy.close();
	const failed = windowRead({ ask: async () => { throw new Error('offline'); } }, { op: 'query' }, []);
	expect(await failed.result).toEqual([]);
});


test('repeated reactive reads reuse one scope and clearing it allows a newer query', async () => {
	const d = node();
	const view = createReadWindow({ device: () => d, read: async (_, op) => ({ ok: { entry: op.entry } }) });
	try {
		for (let n = 1; n <= 150; n++) await view.read({ op: 'get', entry: id(n) });
		await flush();
		expect(new Set(d.calls.map((c) => c.scope)).size).toBe(1);
		view.clear(); await flush(); expect(d.calls.at(-1).entries).toEqual([]);
		await view.read({ op: 'get', entry: id(151) }); await flush();
		expect(d.calls.at(-1).entries).toEqual([id(151)]);
		expect(new Set(d.calls.map((c) => c.scope)).size).toBe(1);
	} finally { view.close(); }
});


test('an effect clears a borrowed window without closing its component lifetime', async () => {
	let cleared = 0, closed = 0;
	const window = { read: async () => ({ ok: 42 }), clear: () => cleared++, close: () => closed++ };
	const api = { ask: async () => null, window: () => { throw new Error('must reuse mounted window'); } };
	const request = windowRead(api, { op: 'query' }, null, window);
	expect(await request.result).toBe(42); request.close();
	expect(cleared).toBe(1); expect(closed).toBe(0);
});
