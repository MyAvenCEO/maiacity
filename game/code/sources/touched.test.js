// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { touches } from './touched.js';
const e = (n) => n.toString(16).padStart(64, '0');
const change = (entries, vaults) => ({ since: [9, 1, 0], all: false, entries, vaults });

test('a change touches the reads of its vault and of its entries, and spares the rest', () => {
	const todos = { op: 'query', vault: 'v1', where: { type: ['todo'] } };
	expect(touches(todos, change([e(1)], ['v1']))).toBe(true);
	expect(touches(todos, change([e(1)], ['v2']))).toBe(false);
	expect(touches({ op: 'get', entry: e(2) }, change([e(2)], ['v2']), { ok: { entry: e(2), vault: 'v2' } })).toBe(true);
	expect(touches({ op: 'get', entry: e(3) }, change([e(2)], ['v9']), { ok: { entry: e(3), vault: 'v2' } })).toBe(false);
	// A room's new message is another entry of the room's vault.
	expect(touches({ op: 'room', entry: e(4) }, change([e(5)], ['v3']), { ok: { entry: e(4), vault: 'v3', rows: [] } })).toBe(true);
	expect(touches({ op: 'query', where: { type: ['room'] } }, change([e(5)], ['v3']), { ok: { rows: [{ entry: e(6), vault: 'v4' }] } })).toBe(false);
});
test('where it can not tell, it is touched', () => {
	expect(touches({ op: 'query', where: { type: ['room'] } }, change([e(1)], ['v1']), { ok: { rows: [] } })).toBe(true);
	expect(touches({ op: 'query', vault: 'v1' }, { all: true })).toBe(true);
	expect(touches({ op: 'query', vault: 'v1' }, null)).toBe(true);
	expect(touches({ op: 'query', vault: 'v1' }, { refused: 'BadOp' })).toBe(true);
	expect(touches({ op: 'query', vault: 'v1' }, change([], []))).toBe(false);
});

test('a read that was not current is touched by every change until it is', () => {
	const t = { all: false, entries: [], vaults: [] };
	expect(touches({ op: 'aips' }, t, { ok: [], fresh: { state: 'behind', logs: 3 } })).toBe(true);
	expect(touches({ op: 'aips' }, t, { ok: [], fresh: { state: 'offline', asOf: 1 } })).toBe(true);
	expect(touches({ op: 'aips' }, t, { ok: [], fresh: { state: 'current' } })).toBe(false);
});
