// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { previewPool } from './preview-pool.js';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(options = {}) {
	const starts = [], changes = [], freed = [], requests = [];
	const pool = previewPool({ changed: (...x) => changes.push(x), dispose: (x) => freed.push(x), ...options });
	const spec = (key, bytes = 4) => ({ key, bytes, load: (signal) => {
		starts.push(key); const d = deferred(); requests.push({ key, signal, ...d }); return d.promise;
	} });
	return { pool, spec, starts, changes, freed, requests };
}

test('only two readers run, shared previews load once, and last-owner release frees the URL', async () => {
	const f = fixture();
	try {
		f.pool.retain('a', f.spec('shared')); f.pool.retain('b', f.spec('shared'));
		f.pool.retain('c', f.spec('second')); f.pool.retain('d', f.spec('third')); await flush();
		expect(f.starts).toEqual(['shared', 'second']);
		f.requests[0].resolve('url-shared'); await flush();
		expect(f.starts).toEqual(['shared', 'second', 'third']);
		f.pool.release('a'); expect(f.freed).toEqual([]);
		f.pool.release('b'); expect(f.freed).toEqual(['url-shared']);
		expect(f.changes).toEqual([['shared', 'url-shared'], ['shared', null]]);
	} finally { f.pool.close(); }
});

test('encoded byte reservations cover loading and retained previews until they are released', async () => {
	const f = fixture({ maxBytes: 8 });
	try {
		f.pool.retain('a', f.spec('a', 6)); f.pool.retain('b', f.spec('b', 6)); await flush();
		expect(f.starts).toEqual(['a']);
		f.requests[0].resolve('url-a'); await flush(); expect(f.starts).toEqual(['a']);
		f.pool.release('a'); await flush(); expect(f.starts).toEqual(['a', 'b']);
		expect(f.freed).toEqual(['url-a']);
	} finally { f.pool.close(); }
});

test('leaving the viewport cancels queued work and disposes late results without publishing them', async () => {
	const f = fixture({ concurrency: 1 });
	try {
		f.pool.retain('a', f.spec('a')); f.pool.retain('b', f.spec('b')); await flush();
		f.pool.release('b'); f.pool.release('a');
		expect(f.requests[0].signal.aborted).toBe(true);
		f.pool.retain('c', f.spec('c')); await flush(); expect(f.starts).toEqual(['a']);
		f.requests[0].resolve('late-a'); await flush();
		expect(f.starts).toEqual(['a', 'c']); expect(f.freed).toEqual(['late-a']); expect(f.changes).toEqual([]);
		f.pool.close(); f.requests[1].resolve('late-c'); await flush();
		expect(f.freed).toEqual(['late-a', 'late-c']); expect(f.changes).toEqual([]);
	} finally { f.pool.close(); }
});

test('reentering the same root cannot publish an older cancelled request over the replacement', async () => {
	const f = fixture();
	try {
		f.pool.retain('row', f.spec('a')); await flush(); f.pool.release('row');
		f.pool.retain('row', f.spec('a')); await flush();
		f.requests[1].resolve('new'); await flush(); f.requests[0].resolve('old'); await flush();
		expect(f.changes).toEqual([['a', 'new']]); expect(f.freed).toEqual(['old']);
		f.pool.release('row'); expect(f.freed).toEqual(['old', 'new']);
	} finally { f.pool.close(); }
});

test('failed reads release capacity and queue and length limits reject excess work', async () => {
	const f = fixture({ maxJobs: 2, maxBytes: 8, concurrency: 1 });
	try {
		expect(f.pool.retain('bad', f.spec('bad', 9))).toBe(false);
		expect(f.pool.retain('negative', f.spec('negative', -1))).toBe(false);
		expect(f.pool.retain('a', f.spec('a'))).toBe(true);
		expect(f.pool.retain('b', f.spec('b'))).toBe(true);
		expect(f.pool.retain('c', f.spec('c'))).toBe(false); await flush();
		f.requests[0].reject(new Error('offline')); await flush(); expect(f.starts).toEqual(['a', 'b']);
		f.pool.release('a'); expect(f.pool.retain('c', f.spec('c'))).toBe(true);
		f.pool.close(); expect(f.pool.retain('late', f.spec('late'))).toBe(false);
	} finally { f.pool.close(); }
});


test('a later same-key update retries a failed preview once after bounded backoff', async () => {
	const timers = [], cancelled = [];
	const f = fixture({ scheduleRetry: (run, delay) => { const timer = { run, delay }; timers.push(timer); return timer; },
		cancelRetry: (timer) => cancelled.push(timer) });
	try {
		f.pool.retain('row', f.spec('a')); await flush();
		f.requests[0].reject(new Error('file not here yet')); await flush();
		expect(timers).toEqual([]);
		for (let i = 0; i < 20; i++) f.pool.retain('row', f.spec('a'));
		expect(timers.length).toBe(1); expect(timers[0].delay).toBeGreaterThan(0);
		expect(timers[0].delay).toBeLessThanOrEqual(1000); expect(f.starts).toEqual(['a']);
		timers[0].run(); await flush();
		expect(f.starts).toEqual(['a', 'a']); expect(f.requests[1].signal.aborted).toBe(false);
		f.requests[1].resolve('now available'); await flush();
		f.pool.retain('row', f.spec('a')); await flush();
		expect(f.changes).toEqual([['a', 'now available']]); expect(timers.length).toBe(1);
		f.pool.release('row'); expect(f.freed).toEqual(['now available']);
		// Losing the final owner cancels a scheduled retry; even a late timer cannot recreate its request.
		f.pool.retain('row', f.spec('b')); await flush();
		f.requests[2].reject(new Error('offline')); await flush();
		f.pool.retain('row', f.spec('b')); f.pool.release('row');
		expect(cancelled).toEqual([timers[1]]);
		timers[1].run(); await flush(); expect(f.starts).toEqual(['a', 'a', 'b']);
	} finally { f.pool.close(); }
});
