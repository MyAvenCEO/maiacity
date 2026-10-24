// @ts-nocheck — Bun tests, as the other plain JS suites.
// Persistence-interface obligation for StoredView/V1: a successful Keep must
// reach the existing worker with opaque bytes and await its acknowledgement.
// Lean proves replay semantics, not this JS/OPFS transport. Rust's warmed()
// receipt and authenticated fallback remain unchanged by this bridge repair.
import { expect, test } from 'bun:test';
import { Store as Canonical } from '../../../avendb/crates/avendb-browser/js/store.js';
import { Store as Shipped } from './device/store.js';

for (const [name, Store] of [['canonical', Canonical], ['shipped', Shipped]]) {
	test(`${name}: keeping a view slot waits for the worker and preserves its opaque bytes`, async () => {
		const sent = [];
		const worker = { postMessage: (message, transfer) => sent.push(structuredClone(message, { transfer })) };
		const store = new Store(worker);
		const bytes = new Uint8Array([0, 255, 17, 8, 0]);
		let settled = false;
		const kept = store.keep('slots/view-0', bytes).then(() => { settled = true; });
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(sent).toEqual([{ id: 0, op: 'keep', args: ['slots/view-0', new Uint8Array([0, 255, 17, 8, 0])] }]);
		worker.onmessage({ data: { id: 0, ok: undefined } });
		await kept;
		expect(settled).toBe(true);
		expect(store.calls.size).toBe(0);
		expect(bytes.byteLength).toBe(0); // ownership moved; the durable receipt still waits for the worker
	});

	test(`${name}: failed Keep rejects its receipt, and a later retry can succeed`, async () => {
		const sent = [];
		const worker = { postMessage: (message) => sent.push(message) };
		const store = new Store(worker);
		const first = store.keep('slots/keys-1', new Uint8Array([1]));
		const rejected = first.then(() => undefined, error => error);
		worker.onmessage({ data: { id: sent[0].id, error: 'fixture write failed' } });
		expect((await rejected)?.message).toBe('fixture write failed');
		expect(store.calls.size).toBe(0);
		const retry = store.keep('slots/keys-1', new Uint8Array([2]));
		worker.onmessage({ data: { id: sent[1].id, ok: undefined } });
		await retry;
		expect(store.calls.size).toBe(0);
	});
}
