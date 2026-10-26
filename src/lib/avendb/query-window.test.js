// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { createReadWindow, queryEntries, queryDiscovery, replyEntries } from './query-window.js';
import { windowRead } from './ops.js';
// an Interest op seen as the one list of entries and selectors it wants (tiers aside)
/** @type {(op: any) => any} */
const flat = (op) => op?.op !== 'interest' ? op : { ...op, entries: (op.wants ?? []).flatMap((/** @type {any} */ w) => w.entries ?? []), queries: op.wants?.length ? op.wants.flatMap((/** @type {any} */ w) => w.queries ?? []) : undefined };

const id = (n) => n.toString(16).padStart(64, '0');
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const node = () => {
	const calls = [];
	return { calls, run: async (op) => { calls.push(flat(op)); return { ok: { accepted: true } }; } };
};

test('an empty first-view query publishes bounded discovery without waiting for a lease response', async () => {
	const pending = deferred(), calls = [];
	const d = { run: (op) => { calls.push(flat(op)); return pending.promise; } };
	const view = createReadWindow({ device: () => d, read: async () => ({ ok: { rows: [] } }) });
	try {
		const op = { op: 'query', vault: id(9), where: { all: [{ type: ['note'] }, { record: { private: 'not sent' } }] } };
		expect(await view.read(op)).toEqual({ ok: { rows: [] } });
		await flush();
		expect(calls[0].entries).toEqual([]);
		expect(calls[0].queries).toEqual([{ types: ['note'], vault: id(9) }]);
		expect(JSON.stringify(calls)).not.toContain('not sent');
		view.clear(); await flush();
		expect(calls.at(-1).entries).toEqual([]);
		expect(calls.at(-1).queries).toBeUndefined();
	} finally { pending.resolve({ ok: { accepted: true } }); view.close(); await flush(); }
});

test('discovery extracts only bounded positive types and never widens an invalid vault', () => {
	expect(queryDiscovery({ op: 'query', where: { not: { type: ['secret'] } } })).toEqual([]);
	expect(queryDiscovery({ op: 'query', vault: 'invalid', where: { type: ['note'] } })).toEqual([]);
	expect(queryDiscovery({ op: 'get', where: { type: ['note'] } })).toEqual([]);
	expect(queryDiscovery({ op: 'query', where: { any: [{ type: ['note', 'note'] }, { type: ['story'] }] } })).toEqual([{ types: ['note', 'story'] }]);
	expect(queryDiscovery({ op: 'query', where: { type: ['é'.repeat(33), 'note'] } })).toEqual([{ types: ['note'] }]);
	const cycle = { type: ['note'], all: [] }; cycle.all.push(cycle);
	expect(queryDiscovery({ op: 'query', where: cycle })).toEqual([{ types: ['note'] }]);
});

test('typed inventory reads publish only explicit bounded types within their vault', () => {
	for (const op of ['database', 'entry_views']) {
		expect(queryDiscovery({ op, vault: id(9), types: ['recipe', 'recipe'], where: { type: ['private'] } })).toEqual([{ types: ['recipe'], vault: id(9) }]);
		expect(queryDiscovery({ op, vault: 'invalid', types: ['recipe'] })).toEqual([]);
		expect(queryDiscovery({ op })).toEqual([]);
		expect(queryDiscovery({ op, types: Array.from({ length: 20 }, (_, i) => `type-${i}`) })[0].types.length).toBe(8);
	}
});

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
	const d = { run: (op) => { calls.push(flat(op)); return send.promise; } };
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

test('identical empty reactive reads keep discovery in flight on the same revision', async () => {
	const pending = deferred(), calls = [];
	const d = { run: (op) => { calls.push(flat(op)); return pending.promise; } };
	const view = createReadWindow({ device: () => d, read: async () => ({ ok: { rows: [] } }) });
	const op = { op: 'query', where: { type: ['note'] }, select: [] };
	try {
		for (let i = 0; i < 12; i++) { await view.read(structuredClone(op)); await flush(); }
		expect(calls.length).toBe(1);
		expect(calls[0].revision).toBe(1);
		expect(calls[0].queries).toEqual([{ types: ['note'] }]);
		view.clear(); await flush();
		expect(calls.at(-1).queries).toBeUndefined();
		expect(calls.at(-1).revision).toBe(2);
	} finally { view.close(); pending.resolve({ ok: { accepted: true } }); await flush(); }
});

test('reactive results replace old row hints and changed predicates clear them before reading', async () => {
	const d = node(); let rows = [id(1)], block = null;
	const view = createReadWindow({ device: () => d, read: async () => block ? block.promise : ({ ok: { rows: rows.map(entry => ({ entry })) } }) });
	const op = { op: 'query', where: { type: ['note'] }, select: [] };
	try {
		await view.read(op); await flush();
		const before = d.calls.length;
		await view.read(structuredClone(op)); await flush();
		expect(d.calls.length).toBe(before);
		rows = [id(2)]; await view.read(op); await flush();
		expect(d.calls.at(-1).entries).toEqual([id(2)]);
		block = deferred();
		const next = view.read({ ...op, where: { type: ['note'], tag: ['another'] } }); await flush();
		expect(d.calls.at(-1).entries).toEqual([]);
		block.resolve({ ok: { rows: [] } }); await next;
	} finally { view.close(); }
});

test('same-turn effect cleanup and reread preserve discovery; leaving still releases it', async () => {
	const d = node(), blocked = deferred(); let block = false, latestSignal;
	const view = createReadWindow({ device: () => d, read: async (_, __, signal) => {
		latestSignal = signal;
		return block ? blocked.promise : { ok: { rows: [] } };
	} });
	const op = { op: 'query', where: { type: ['note'] } };
	try {
		await view.read(op); await flush();
		for (let n = 0; n < 8; n++) {
			view.clear();
			await view.read(structuredClone(op)); await flush();
		}
		expect(d.calls.length).toBe(1);
		block = true;
		const pending = view.read(op); await flush();
		view.clear();
		expect(latestSignal.aborted).toBe(true);
		await flush();
		expect(d.calls.at(-1).revision).toBe(2);
		expect(d.calls.at(-1).queries).toBeUndefined();
		blocked.resolve({ ok: { rows: [{ entry: id(8) }] } });
		expect(await pending).toBeNull(); await flush();
		expect(d.calls.at(-1).entries).toEqual([]);
	} finally { view.close(); }
});

test('AIP discovery preserves explicit vault scope and does not send private selectors', () => {
	expect(queryDiscovery({op:'aips',vault:id(2),as:id(8),private:'secret'})).toEqual([{types:['aip','review'],vault:id(2)}]);
	expect(queryDiscovery({op:'aips',vault:'invalid'})).toEqual([]);
});

 test('opened AIP replies prioritize explicit referenced line entries', () => {
 expect(replyEntries({ok:{entry:id(1),lines:[{entry:id(2),record:{entry:id(3)}},{entry:'invalid'}]}})).toEqual([id(1),id(2)]);
 });
