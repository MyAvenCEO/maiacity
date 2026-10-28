// @ts-nocheck — deterministic worker and timer doubles
import { expect, test } from 'bun:test';
import { proofWorker } from './proof-worker.js';
function fixture() {
	const workers = [], timers = new Map(); let next = 0;
	const run = proofWorker(() => {
		const w = { sent: [], terminated: 0, postMessage(m) { if (this.throwing) throw Error('transfer failed'); this.sent.push(m); }, terminate() { this.terminated++; }, reply(i, value = '[]') { this.onmessage({ data: { id: this.sent[i].id, rows: value } }); } };
		workers.push(w); return w;
	}, { later(fn) { const n = ++next; timers.set(n, fn); return n; }, cancel(n) { timers.delete(n); } });
	return { workers, timers, ask: () => run(new Uint8Array([1]), 'vault', 'recipe'), idle() { for (const [n, fn] of [...timers]) { timers.delete(n); fn(); } } };
}
test('concurrent proofs keep worker alive until every answer, then release and recreate', async () => {
	const f = fixture(), a = f.ask(), b = f.ask(), w = f.workers[0];
	w.reply(1, '[2]'); expect(await b).toBe('[2]'); f.idle(); expect(w.terminated).toBe(0);
	w.reply(0, '[1]'); expect(await a).toBe('[1]'); f.idle(); expect(w.terminated).toBe(1);
	const c = f.ask(); expect(f.workers.length).toBe(2); f.workers[1].reply(0); await c; f.idle();
});
test('new request cancels idle disposal and stale worker callbacks cannot affect replacement', async () => {
	const f = fixture(), a = f.ask(), w = f.workers[0]; w.reply(0); await a;
	const b = f.ask(); f.idle(); expect(w.terminated).toBe(0); w.reply(1); await b; f.idle();
	const c = f.ask(), replacement = f.workers[1];
	w.onerror({ message: 'late failure' }); w.onmessage({ data: { id: replacement.sent[0].id, rows: 'wrong' } });
	replacement.reply(0, 'correct'); expect(await c).toBe('correct'); f.idle();
});
test('worker failure rejects all pending requests, releases worker and permits retry', async () => {
	const f = fixture(), a = f.ask().catch(e => e.message), b = f.ask().catch(e => e.message), w = f.workers[0];
	w.onerror({ message: 'failed' }); expect(await a).toBe('failed'); expect(await b).toBe('failed'); expect(w.terminated).toBe(1);
	const c = f.ask(); f.workers[1].reply(0); expect(await c).toBe('[]'); f.idle();
});
test('proof refusal preserves other requests and transfer failure does not strand worker', async () => {
	const f = fixture(), a = f.ask().catch(e => e.message), b = f.ask(), w = f.workers[0];
	w.onmessage({ data: { id: w.sent[0].id, error: 'invalid signature' } }); expect(await a).toBe('invalid signature');
	w.throwing = true; expect(await f.ask().catch(e => e.message)).toBe('transfer failed'); f.idle(); expect(w.terminated).toBe(0);
	w.reply(1); await b; f.idle(); expect(w.terminated).toBe(1);
});
test('unreadable worker response retires failed worker', async () => {
	const f = fixture(), a = f.ask().catch(e => e.message), w = f.workers[0];
	w.onmessageerror({}); expect(await a).toContain('could not be read'); expect(w.terminated).toBe(1);
});
