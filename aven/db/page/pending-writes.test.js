// @ts-nocheck
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apply, createPendingWrites, paints } from './pending-writes.js';

// what LocalWrite.lean answers (`lake exe vectors`), rows (id, value) as a record's list of rows
const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/local_writes.json', import.meta.url), 'utf8'));
const entry = 'a'.repeat(64);
const record = (rows) => ({ rows: rows.map(([id, v]) => ({ id, v })) });
const rowsOf = (r) => (r.rows ?? []).map(({ id, v }) => [id, v]);
const opOf = ({ insert, set }) => insert
	? { op: 'insert', entry, path: ['rows'], value: { id: insert[0], v: insert[1] } }
	: { op: 'set', entry, path: ['rows', { id: set[0] }, 'v'], value: set[1] };

test('what a page shows is what LocalWrite.lean shows: pending writes laid over, a refusal leaving no trace', () => {
	expect(vectors.overlays.length).toBeGreaterThan(5);
	for (const c of vectors.overlays) {
		const writes = createPendingWrites();
		const seqs = new Map(c.pending.map((p) => [p.seq, writes.add(opOf(p.op))]));
		expect(rowsOf(writes.overlay(entry, record(c.confirmed)))).toEqual(c.shown);
		for (const r of c.refused) {
			const each = createPendingWrites();
			const mine = new Map(c.pending.map((p) => [p.seq, each.add(opOf(p.op))]));
			each.settle(mine.get(r.seq), false);
			expect(rowsOf(each.overlay(entry, record(c.confirmed)))).toEqual(r.shown);
		}
		c.pending.forEach((p, i) => {
			const confirmed = record(c.confirmed);
			expect(apply(confirmed, opOf(p.op)) === confirmed).toBe(c.held[i]);
		});
		expect(seqs.size).toBe(c.pending.length);
	}
});

test('a write paints in one step, without the engine', () => {
	const writes = createPendingWrites();
	const room = { kind: 'room', messages: [{ id: 1, text: 'Hi' }] };
	const s = writes.add({ op: 'insert', entry, path: ['messages'], value: { id: 2, text: 'Hello' }, as: 'v' });
	const shown = writes.overlay(entry, room, (row, op) => ({ ...row, pending: true, actor: op.as }));
	expect(shown.messages.map((m) => m.text)).toEqual(['Hi', 'Hello']);
	expect(shown.messages[1]).toEqual({ id: 2, text: 'Hello', pending: true, actor: 'v' });
	expect(room.messages.length).toBe(1);
	expect(writes.pending(entry)).toBe(true);
	writes.settle(s, true, 3);
	expect(writes.pending(entry)).toBe(false);
	// a read made before it was accepted keeps it laid over; one after drops it, its answer holding the row
	writes.heard(entry, 2);
	expect(writes.list.length).toBe(1);
	writes.heard('b'.repeat(64), 5);
	expect(writes.list.length).toBe(1);
	writes.heard(entry, 3);
	expect(writes.list.length).toBe(0);
});

test('a refused write leaves the view as it was before it was made', () => {
	let draws = 0;
	const writes = createPendingWrites(() => draws++);
	const room = { messages: [{ id: 1, text: 'Hi', thread: [] }] };
	const reply = writes.add({ op: 'insert', entry, path: ['messages', { id: 1 }, 'thread'], value: { id: 7, text: 'Re' } });
	const edit = writes.add({ op: 'set', entry, path: ['messages', { id: 1 }, 'text'], value: 'Hi!' });
	expect(writes.overlay(entry, room)).toEqual({ messages: [{ id: 1, text: 'Hi!', thread: [{ id: 7, text: 'Re' }] }] });
	writes.settle(reply, false);
	writes.settle(edit, false);
	expect(writes.overlay(entry, room)).toBe(room);
	expect(draws).toBe(4);
});

test('a path that leads nowhere changes nothing, and nested inserts make their list', () => {
	const room = { messages: [{ id: 1 }] };
	expect(apply(room, { op: 'set', entry, path: ['messages', { id: 9 }, 'text'], value: 'x' })).toBe(room);
	expect(apply(room, { op: 'insert', entry, path: ['nowhere', 'deep'], value: { id: 1 } })).toBe(room);
	expect(apply(room, { op: 'insert', entry, path: ['messages', { id: 1 }, 'reactions'], value: { id: 2, key: '+1' } }))
		.toEqual({ messages: [{ id: 1, reactions: [{ id: 2, key: '+1' }] }] });
	expect(apply({}, { op: 'insert', entry, path: ['messages'], value: { id: 3 } })).toEqual({ messages: [{ id: 3 }] });
});

test('only inserts and sets into a named entry paint, never ones naming an earlier op\'s result', () => {
	expect(paints({ op: 'insert', entry, path: ['messages'], value: { id: 1 } })).toBe(true);
	expect(paints({ op: 'set', entry, path: ['title'], value: 'x' })).toBe(true);
	expect(paints({ op: 'create', vault: entry })).toBe(false);
	expect(paints({ op: 'set', entry: '$0', path: ['title'], value: 'x' })).toBe(false);
	expect(paints({ op: 'set', entry, path: [], value: 'x' })).toBe(false);
});
