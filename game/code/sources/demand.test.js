// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { createDemand } from './demand.js';
const id = (n) => n.toString(16).padStart(64, '0');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('selector-only leases renew, retain selectors when rows arrive, and do not infer support from old acknowledgements', async () => {
	const calls = [];
	const demand = createDemand(async (op) => { calls.push(op); return { ok: { accepted: true } }; }, { renew: 1 });
	try {
		await demand.replace([], [{ types: ['note'], predicate: 'never forwarded' }]);
		await tick();
		expect(calls.length).toBeGreaterThan(1);
		expect(calls[0].queries).toEqual([{ types: ['note'] }]);
		expect(demand.discovery()).toEqual({ supported: false, complete: false });
		await demand.add([id(1)]);
		expect(calls.at(-1).queries).toEqual([{ types: ['note'] }]);
		await demand.replace([]);
		expect(calls.at(-1).queries).toBeUndefined();
	} finally { demand.close(); }
});

test('view demand coalesces entries and releases its own scope with a newer revision', async () => {
	const calls = [];
	const demand = createDemand(async (op) => { calls.push(op); return { ok: { accepted: true } }; }, { scope: 'a'.repeat(32) });
	demand.add([id(2), id(1)]);
	demand.add([id(1), id(3), 'invalid']);
	await tick();
	expect(calls).toEqual([{ op: 'demand', scope: 'a'.repeat(32), revision: 1, entries: [id(2), id(1), id(3)] }]);
	demand.close();
	await tick();
	expect(calls[1]).toEqual({ op: 'demand', scope: 'a'.repeat(32), revision: 2, entries: [] });
	demand.add([id(5)]);
	await tick();
	expect(calls.length).toBe(2);
});

test('closing before the first send starts leaves no scope on the node', async () => {
	const calls = [];
	const demand = createDemand(async (op) => { calls.push(op); });
	demand.add([id(1)]);
	demand.close();
	await tick();
	expect(calls).toEqual([]);
});

test('old apps stop receiving unsupported demand ops', async () => {
	const calls = [];
	const demand = createDemand(async (op) => { calls.push(op); return { refused: 'BadOp', why: 'unknown op' }; }, { renew: 1 });
	demand.add([id(1)]);
	await tick();
	demand.add([id(2)]);
	await tick();
	demand.close();
	expect(calls.length).toBe(1);
});

test('lease renewal contains only scheduling metadata, and stops on close', async () => {
	const calls = [];
	const demand = createDemand(async (op) => { calls.push(op); return { ok: { accepted: true } }; }, { renew: 1 });
	demand.add([id(1)]);
	await tick();
	demand.close();
	await tick();
	expect(calls.length).toBeGreaterThan(2);
	expect(calls.every((op) => op.op === 'demand')).toBe(true);
	expect(calls.at(-1).entries).toEqual([]);
	expect(calls.map((op) => op.revision)).toEqual(calls.map((_, i) => i + 1));
	const before = calls.length;
	await tick();
	expect(calls.length).toBe(before);
});


test('query replacements carry monotonically newer demand even when acknowledgements reorder', async () => {
	const calls = [], replies = [];
	const demand = createDemand((op) => { calls.push(op); return new Promise((resolve) => replies.push(resolve)); });
	const first = demand.replace([id(1)]); await tick();
	const next = demand.replace([id(2)]); await tick();
	expect(calls.map((c) => c.entries)).toEqual([[id(1)], [id(2)]]);
	replies[1]({ ok: { accepted: true } }); expect(await next).toBe(true);
	replies[0]({ ok: { accepted: false } }); await first;
	const released = demand.replace([]); await tick();
	expect(calls[2].revision).toBe(3); expect(calls[2].entries).toEqual([]);
	replies[2]({ ok: { accepted: true } }); await released;
	demand.close(); await tick();
	expect(calls.at(-1).revision).toBe(4);
	replies.at(-1)({ ok: { accepted: true } });
});

test('a stale unsupported reply cannot disable the current accepted demand or its release', async () => {
	const calls = [], replies = [];
	const demand = createDemand((op) => { calls.push(op); return new Promise(resolve => replies.push(resolve)); });
	try {
		const first = demand.replace([id(1)]); await tick();
		const second = demand.replace([id(2)], [{ types: ['note'] }]); await tick();
		replies[1]({ ok: { accepted: true, discovery_supported: true } }); await second;
		replies[0]({ refused: 'BadOp' }); await first;
		expect(demand.discovery().supported).toBe(true);
		const third = demand.replace([id(3)]); await tick();
		expect(calls.at(-1).entries).toEqual([id(3)]);
		replies[2]({ ok: { accepted: true } }); await third;
		demand.close(); await tick();
		expect(calls.at(-1).entries).toEqual([]);
		expect(calls.at(-1).revision).toBe(4);
	} finally { demand.close(); for (const reply of replies) reply({ ok: { accepted: true } }); }
});
